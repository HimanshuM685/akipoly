/**
 * Game state machine. Every round row moves betting → rolling → settled;
 * the scheduler advances rows whose phase_ends_at has passed.
 *
 *   round 0 (opening): rolling → settled          (reveals the first ball)
 *   round n:           betting → rolling → settled (call higher/lower, roll, settle)
 */
import type pg from 'pg';
import type { Hash } from 'viem';
import { env } from '../config/env.js';
import { withTx } from '../db/pool.js';
import { deriveBall, newSeed } from '../domain/fairness.js';
import {
  isGameOver,
  isPickPossible,
  placementFor,
  resolveRound,
  settlePot,
  settleSideBets,
  type PickInput,
} from '../domain/rules.js';
import { verifyIncomingTransfer } from '../chain/usdc.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { lobbiesChanged } from '../events.js';
import { enqueuePayouts } from './payouts.js';
import type { Direction } from '../shared/protocol.js';

const BETTING_MS = env.BETTING_SECONDS * 1000;
const ms = (n: number) => `${n} milliseconds`;

export interface RoundRow {
  id: string;
  game_id: string;
  lobby_id: string;
  pot: bigint;
  round_number: number;
  phase: 'betting' | 'rolling' | 'settled';
  prev_ball: number | null;
  ball: number | null;
  seed: string;
  phase_ends_at: Date;
}

/** Create the game for a lobby whose countdown finished. Lobby row must be locked. */
export async function startGame(c: pg.PoolClient, lobbyId: string, buyIn: bigint): Promise<string | null> {
  const players = (
    await c.query<{ user_id: string; display_name: string }>(
      `select user_id, display_name from public.lobby_players where lobby_id = $1 and ready order by joined_at`,
      [lobbyId],
    )
  ).rows;
  const seated = Number(
    (await c.query<{ n: bigint }>('select count(*) as n from public.lobby_players where lobby_id = $1', [lobbyId]))
      .rows[0]!.n,
  );
  if (players.length < 2 || players.length !== seated) {
    await c.query(`update public.lobbies set status = 'waiting', starts_at = null, updated_at = now() where id = $1`, [
      lobbyId,
    ]);
    return null;
  }

  const gameId = (
    await c.query<{ id: string }>(`insert into public.games (lobby_id, pot) values ($1, $2) returning id`, [
      lobbyId,
      buyIn * BigInt(players.length),
    ])
  ).rows[0]!.id;
  await c.query(
    `insert into public.game_players (game_id, user_id, display_name, buy_in)
     select $1, u, n, $4 from unnest($2::text[], $3::text[]) as t(u, n)`,
    [gameId, players.map((p) => p.user_id), players.map((p) => p.display_name), buyIn],
  );
  await c.query(`update public.lobbies set status = 'live', starts_at = null, updated_at = now() where id = $1`, [
    lobbyId,
  ]);

  const { seed, seedHash } = newSeed();
  await c.query(
    `insert into public.rounds (game_id, round_number, phase, ball, seed, seed_hash, phase_ends_at)
     values ($1, 0, 'rolling', $2, $3, $4, now() + $5::interval)`,
    [gameId, deriveBall(seed, gameId, 0), seed, seedHash, ms(env.ROLLING_MS)],
  );
  return gameId;
}

async function openRound(c: pg.PoolClient, gameId: string, roundNumber: number, prevBall: number) {
  const { seed, seedHash } = newSeed();
  await c.query(
    `insert into public.rounds (game_id, round_number, phase, prev_ball, seed, seed_hash, phase_ends_at)
     values ($1, $2, 'betting', $3, $4, $5, now() + $6::interval)`,
    [gameId, roundNumber, prevBall, seed, seedHash, ms(BETTING_MS)],
  );
}

/** Advance a due round by one phase. Round row must be locked. */
export async function advanceRound(c: pg.PoolClient, round: RoundRow): Promise<void> {
  if (round.phase === 'betting') {
    const ball = deriveBall(round.seed, round.game_id, round.round_number);
    await c.query(
      `update public.rounds set phase = 'rolling', ball = $2, phase_ends_at = now() + $3::interval where id = $1`,
      [round.id, ball, ms(env.ROLLING_MS)],
    );
    return;
  }
  if (round.phase === 'rolling') await settleRound(c, round);
}

async function settleRound(c: pg.PoolClient, round: RoundRow): Promise<void> {
  const ball = round.ball!;
  if (round.round_number === 0) {
    await c.query(`update public.rounds set phase = 'settled', outcome = 'opening' where id = $1`, [round.id]);
    await openRound(c, round.game_id, 1, ball);
    return;
  }

  const alive = (
    await c.query<{ user_id: string }>(
      `select user_id from public.game_players where game_id = $1 and eliminated_round is null`,
      [round.game_id],
    )
  ).rows.map((r) => r.user_id);
  const picks: PickInput[] = (
    await c.query<{ user_id: string; direction: Direction; side_bet: bigint }>(
      `select user_id, direction, side_bet from public.picks where round_id = $1`,
      [round.id],
    )
  ).rows.map((p) => ({ userId: p.user_id, direction: p.direction, sideBet: p.side_bet }));

  const { result, eliminated } = resolveRound(alive, picks, round.prev_ball!, ball);
  const out = new Set(eliminated);
  const survivors = alive.filter((u) => !out.has(u));

  if (eliminated.length > 0) {
    await c.query(
      `update public.game_players set eliminated_round = $3, placement = $4
        where game_id = $1 and user_id = any($2::text[])`,
      [round.game_id, eliminated, round.round_number, placementFor(survivors.length)],
    );
  }

  await enqueuePayouts(
    c,
    settleSideBets(picks, result, env.HOUSE_FEE_BPS).map((p) => ({
      key: `side:${round.id}:${p.userId}`,
      userId: p.userId,
      amount: p.amount,
      reason: p.reason,
      gameId: round.game_id,
    })),
  );
  await c.query(`update public.rounds set phase = 'settled', outcome = $2 where id = $1`, [round.id, result]);

  if (isGameOver(survivors.length, round.round_number, env.MAX_ROUNDS)) {
    await finishGame(c, round, survivors, alive);
  } else {
    await openRound(c, round.game_id, round.round_number + 1, ball);
  }
}

async function finishGame(c: pg.PoolClient, round: RoundRow, survivors: string[], lastRoundPlayers: string[]) {
  const { fee, payouts } = settlePot(round.pot, env.HOUSE_FEE_BPS, survivors, lastRoundPlayers);
  await enqueuePayouts(
    c,
    payouts.map((p) => ({
      key: `pot:${round.game_id}:${p.userId}`,
      userId: p.userId,
      amount: p.amount,
      reason: p.reason,
      gameId: round.game_id,
    })),
  );
  if (survivors.length > 0) {
    await c.query(`update public.game_players set placement = 1 where game_id = $1 and user_id = any($2::text[])`, [
      round.game_id,
      survivors,
    ]);
  }
  await c.query(
    `update public.games set status = 'finished', fee = $2, winner_user_id = $3, ended_at = now() where id = $1`,
    [round.game_id, fee, survivors.length === 1 ? survivors[0] : null],
  );
  await c.query(`update public.lobbies set status = 'finished', updated_at = now() where id = $1`, [round.lobby_id]);
}

export interface PickRequest {
  userId: string;
  walletAddress: string | null;
  gameId: string;
  roundNumber: number;
  direction: Direction;
  sideBet: bigint;
  txHash: string | undefined;
  /** When the request reached the server; side-bet verification can take a moment. */
  arrivedAt: Date;
}

export async function placePick(req: PickRequest): Promise<void> {
  const paying = req.sideBet > 0n;
  if (paying) {
    if (req.sideBet > env.MAX_SIDE_BET_USDC) throw badRequest('side bet is above the table limit');
    if (!req.txHash) throw badRequest('side bet needs a payment transaction');
    if (!req.walletAddress) throw new AppError('NO_WALLET', 'no embedded wallet linked to this account');
    await verifyIncomingTransfer({ txHash: req.txHash as Hash, from: req.walletAddress, amount: req.sideBet });
  }

  let rejection = null as AppError | null;
  const lobbyId = await withTx(async (c) => {
    if (paying) {
      const recorded = await c.query(
        `insert into public.chain_transfers (tx_hash, user_id, from_address, amount, purpose)
         values ($1, $2, $3, $4, 'side_bet') on conflict do nothing`,
        [req.txHash, req.userId, req.walletAddress, req.sideBet],
      );
      if (recorded.rowCount === 0) throw new AppError('PAYMENT_INVALID', 'that transaction was already used');
    }

    const round = (
      await c.query<RoundRow & { alive: boolean | null }>(
        `select r.*, g.lobby_id, g.pot,
                (select gp.eliminated_round is null from public.game_players gp
                  where gp.game_id = r.game_id and gp.user_id = $3) as alive
           from public.rounds r join public.games g on g.id = r.game_id
          where r.game_id = $1 and r.round_number = $2
          for update of r`,
        [req.gameId, req.roundNumber, req.userId],
      )
    ).rows[0];

    if (!round) rejection = notFound('round not found');
    else if (round.alive === null) rejection = badRequest('you are not playing this game');
    else if (!round.alive) rejection = badRequest('you are out — spectate till the end');
    else if (round.phase !== 'betting' || req.arrivedAt > round.phase_ends_at) rejection = conflict('calls are closed');
    else if (!isPickPossible(round.prev_ball!, req.direction)) rejection = badRequest(`nothing is ${req.direction}`);

    if (!rejection && round) {
      const inserted = await c.query(
        `insert into public.picks (round_id, user_id, direction, side_bet, side_bet_tx)
         values ($1, $2, $3, $4, $5) on conflict do nothing`,
        [round.id, req.userId, req.direction, req.sideBet, paying ? req.txHash : null],
      );
      if (inserted.rowCount === 0) rejection = conflict('you already called this round');
    }

    if (rejection) {
      if (paying) {
        await enqueuePayouts(c, [
          { key: `refund:${req.txHash}`, userId: req.userId, amount: req.sideBet, reason: 'refund', gameId: req.gameId },
        ]);
      }
      return round?.lobby_id ?? null;
    }

    // Everyone alive has called → close betting now; the scheduler rolls next tick.
    await c.query(
      `update public.rounds set phase_ends_at = now()
        where id = $1
          and (select count(*) from public.picks where round_id = $1) >=
              (select count(*) from public.game_players where game_id = $2 and eliminated_round is null)`,
      [round!.id, round!.game_id],
    );
    return round!.lobby_id;
  });

  if (lobbyId) lobbiesChanged([lobbyId]);
  if (rejection) throw rejection;
}
