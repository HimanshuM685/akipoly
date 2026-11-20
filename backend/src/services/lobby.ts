/**
 * Lobby lifecycle. No dealer: whoever creates the lobby is just the first
 * player. Everyone pays the buy-in by pressing Ready; when ≥2 players are
 * seated and all are ready, a short countdown starts the game.
 *
 *   waiting ⇄ starting → live → finished
 *   waiting → cancelled (last player left)
 */
import type pg from 'pg';
import type { Hash } from 'viem';
import { env } from '../config/env.js';
import { pool, withTx } from '../db/pool.js';
import { verifyIncomingTransfer } from '../chain/usdc.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { lobbiesChanged } from '../events.js';
import { enqueuePayouts } from './payouts.js';
import { startGame } from './game.js';
import { MAX_PLAYERS } from '../shared/protocol.js';

interface LobbyRow {
  id: string;
  owner_user_id: string;
  buy_in: bigint;
  status: 'waiting' | 'starting' | 'live' | 'finished' | 'cancelled';
  max_players: number;
}

interface PlayerRow {
  user_id: string;
  ready: boolean;
  buy_in_tx: string | null;
}

async function lockLobby(c: pg.PoolClient, lobbyId: string): Promise<LobbyRow> {
  const lobby = (
    await c.query<LobbyRow>(
      `select id, owner_user_id, buy_in, status, max_players from public.lobbies where id = $1 for update`,
      [lobbyId],
    )
  ).rows[0];
  if (!lobby) throw notFound('lobby not found');
  return lobby;
}

async function player(c: pg.PoolClient, lobbyId: string, userId: string): Promise<PlayerRow | undefined> {
  return (
    await c.query<PlayerRow>(
      `select user_id, ready, buy_in_tx from public.lobby_players where lobby_id = $1 and user_id = $2`,
      [lobbyId, userId],
    )
  ).rows[0];
}

/** One table at a time. Players knocked out of a live game may move on. */
async function assertNotSeatedElsewhere(c: pg.PoolClient, userId: string, lobbyId: string | null) {
  const res = await c.query(
    `select 1 from public.lobby_players p
       join public.lobbies l on l.id = p.lobby_id
       left join public.games g on g.lobby_id = l.id
       left join public.game_players gp on gp.game_id = g.id and gp.user_id = p.user_id
      where p.user_id = $1
        and l.id is distinct from $2::uuid
        and l.status in ('waiting', 'starting', 'live')
        and not (l.status = 'live' and (gp.user_id is null or gp.eliminated_round is not null))
      limit 1`,
    [userId, lobbyId],
  );
  if (res.rowCount) throw conflict('you are already seated at another table — leave it first');
}

/** waiting ⇄ starting depending on whether everyone seated has paid. */
async function syncCountdown(c: pg.PoolClient, lobbyId: string) {
  await c.query(
    `update public.lobbies l
        set status = case when s.n >= 2 and s.n = s.ready then 'starting' else 'waiting' end,
            starts_at = case when s.n >= 2 and s.n = s.ready
                             then coalesce(l.starts_at, now() + $2::interval) else null end,
            updated_at = now()
       from (select count(*) as n, count(*) filter (where ready) as ready
               from public.lobby_players where lobby_id = $1) s
      where l.id = $1 and l.status in ('waiting', 'starting')`,
    [lobbyId, `${env.START_COUNTDOWN_MS} milliseconds`],
  );
}

const refundKey = (txHash: string) => `refund:${txHash}`;

export async function createLobby(userId: string, name: string, displayName: string, buyIn: bigint): Promise<string> {
  if (buyIn < env.MIN_BUY_IN_USDC || buyIn > env.MAX_BUY_IN_USDC) throw badRequest('buy-in is outside the table limits');
  const id = await withTx(async (c) => {
    await assertNotSeatedElsewhere(c, userId, null);
    const lobbyId = (
      await c.query<{ id: string }>(
        `insert into public.lobbies (owner_user_id, name, buy_in, max_players) values ($1, $2, $3, $4) returning id`,
        [userId, name, buyIn, MAX_PLAYERS],
      )
    ).rows[0]!.id;
    await c.query(`insert into public.lobby_players (lobby_id, user_id, display_name) values ($1, $2, $3)`, [
      lobbyId,
      userId,
      displayName,
    ]);
    return lobbyId;
  });
  lobbiesChanged([id]);
  return id;
}

export async function joinLobby(userId: string, lobbyId: string, displayName: string): Promise<void> {
  await withTx(async (c) => {
    const lobby = await lockLobby(c, lobbyId);
    if (await player(c, lobbyId, userId)) return;
    if (lobby.status !== 'waiting' && lobby.status !== 'starting') throw conflict('this game already started');
    const count = Number(
      (await c.query<{ n: bigint }>('select count(*) as n from public.lobby_players where lobby_id = $1', [lobbyId]))
        .rows[0]!.n,
    );
    if (count >= lobby.max_players) throw conflict('table is full');
    await assertNotSeatedElsewhere(c, userId, lobbyId);
    await c.query(`insert into public.lobby_players (lobby_id, user_id, display_name) values ($1, $2, $3)`, [
      lobbyId,
      userId,
      displayName,
    ]);
    await syncCountdown(c, lobbyId); // a new unpaid player stops the countdown
  });
  lobbiesChanged([lobbyId]);
}

export async function leaveLobby(userId: string, lobbyId: string): Promise<void> {
  await withTx(async (c) => {
    const lobby = await lockLobby(c, lobbyId);
    // Live or finished: nothing to undo. Leaving a live game = no more calls.
    if (lobby.status !== 'waiting' && lobby.status !== 'starting') return;
    const p = await player(c, lobbyId, userId);
    if (!p) return;

    await c.query(`delete from public.lobby_players where lobby_id = $1 and user_id = $2`, [lobbyId, userId]);
    if (p.buy_in_tx) {
      await enqueuePayouts(c, [{ key: refundKey(p.buy_in_tx), userId, amount: lobby.buy_in, reason: 'refund' }]);
    }

    const next = (
      await c.query<{ user_id: string }>(
        `select user_id from public.lobby_players where lobby_id = $1 order by joined_at limit 1`,
        [lobbyId],
      )
    ).rows[0];
    if (!next) {
      await c.query(`update public.lobbies set status = 'cancelled', starts_at = null, updated_at = now() where id = $1`, [
        lobbyId,
      ]);
      return;
    }
    if (lobby.owner_user_id === userId) {
      await c.query(`update public.lobbies set owner_user_id = $2 where id = $1`, [lobbyId, next.user_id]);
    }
    await syncCountdown(c, lobbyId);
  });
  lobbiesChanged([lobbyId]);
}

/** Ready = buy-in paid. Verifies the on-chain transfer before seating the money. */
export async function readyUp(userId: string, walletAddress: string | null, lobbyId: string, txHash: string) {
  if (!walletAddress) throw new AppError('NO_WALLET', 'no embedded wallet linked to this account');
  const pre = (await pool.query<LobbyRow>(`select buy_in, status from public.lobbies where id = $1`, [lobbyId]))
    .rows[0];
  if (!pre) throw notFound('lobby not found');
  await verifyIncomingTransfer({ txHash: txHash as Hash, from: walletAddress, amount: pre.buy_in });

  let rejection = null as AppError | null;
  await withTx(async (c) => {
    const recorded = await c.query(
      `insert into public.chain_transfers (tx_hash, user_id, from_address, amount, purpose)
       values ($1, $2, $3, $4, 'buy_in') on conflict do nothing`,
      [txHash, userId, walletAddress, pre.buy_in],
    );
    if (recorded.rowCount === 0) throw new AppError('PAYMENT_INVALID', 'that transaction was already used');

    const lobby = await lockLobby(c, lobbyId);
    const p = await player(c, lobbyId, userId);
    if (lobby.status !== 'waiting' && lobby.status !== 'starting') rejection = conflict('this game already started');
    else if (!p) rejection = badRequest('take a seat before paying');
    else if (p.ready) rejection = conflict('you already paid the buy-in');

    if (rejection) {
      // Money arrived but can't be used: send it straight back.
      await enqueuePayouts(c, [{ key: refundKey(txHash), userId, amount: pre.buy_in, reason: 'refund' }]);
      return;
    }
    await c.query(`update public.lobby_players set ready = true, buy_in_tx = $3 where lobby_id = $1 and user_id = $2`, [
      lobbyId,
      userId,
      txHash,
    ]);
    await syncCountdown(c, lobbyId);
  });
  lobbiesChanged([lobbyId]);
  if (rejection) throw rejection;
}

/** Unready = take the buy-in back before the game starts. */
export async function unready(userId: string, lobbyId: string): Promise<void> {
  await withTx(async (c) => {
    const lobby = await lockLobby(c, lobbyId);
    if (lobby.status !== 'waiting' && lobby.status !== 'starting') throw conflict('this game already started');
    const p = await player(c, lobbyId, userId);
    if (!p?.ready || !p.buy_in_tx) return;
    await c.query(
      `update public.lobby_players set ready = false, buy_in_tx = null where lobby_id = $1 and user_id = $2`,
      [lobbyId, userId],
    );
    await enqueuePayouts(c, [{ key: refundKey(p.buy_in_tx), userId, amount: lobby.buy_in, reason: 'refund' }]);
    await syncCountdown(c, lobbyId);
  });
  lobbiesChanged([lobbyId]);
}

/** Scheduler: start a lobby whose countdown ran out. Returns false if skipped. */
export async function startDueLobby(c: pg.PoolClient, lobbyId: string): Promise<boolean> {
  const lobby = (
    await c.query<LobbyRow>(
      `select id, buy_in, status from public.lobbies
        where id = $1 and status = 'starting' and starts_at <= now()
        for update skip locked`,
      [lobbyId],
    )
  ).rows[0];
  if (!lobby) return false;
  await startGame(c, lobby.id, lobby.buy_in);
  return true;
}
