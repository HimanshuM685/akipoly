/**
 * Read models pushed to clients. One load per change per lobby, then the
 * private `me` part is attached per socket from the same data.
 */
import type { Db } from './pool.js';
import type {
  CareerEntry,
  Direction,
  GamePlayerView,
  GameView,
  LobbySummary,
  LobbyView,
  RoundHistoryEntry,
  RoundOutcome,
  RoundPhase,
  RoundView,
} from '../shared/protocol.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function upsertUser(db: Db, userId: string, walletAddress: string | null): Promise<void> {
  await db.query(
    `insert into public.app_users (privy_user_id, wallet_address)
     values ($1, $2)
     on conflict (privy_user_id) do update
       set wallet_address = coalesce(excluded.wallet_address, public.app_users.wallet_address),
           updated_at = now()`,
    [userId, walletAddress],
  );
}

export async function listLobbies(db: Db): Promise<LobbySummary[]> {
  const res = await db.query<{
    id: string;
    name: string;
    buy_in: bigint;
    max_players: number;
    status: LobbySummary['status'];
    created_at: Date;
    player_ids: string[];
  }>(
    `select l.id, l.name, l.buy_in, l.max_players, l.status, l.created_at,
            coalesce(array_agg(p.user_id order by p.joined_at) filter (where p.user_id is not null), '{}') as player_ids
       from public.lobbies l
       left join public.lobby_players p on p.lobby_id = l.id
      where l.status in ('waiting', 'starting', 'live')
      group by l.id
      order by l.created_at desc
      limit 50`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    buyIn: r.buy_in.toString(),
    maxPlayers: r.max_players,
    status: r.status,
    playerIds: r.player_ids,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function lobbyView(db: Db, lobbyId: string): Promise<LobbyView | null> {
  const lobby = await db.query<{
    id: string;
    name: string;
    owner_user_id: string;
    buy_in: bigint;
    max_players: number;
    status: LobbyView['status'];
    starts_at: Date | null;
    game_id: string | null;
  }>(
    `select l.id, l.name, l.owner_user_id, l.buy_in, l.max_players, l.status, l.starts_at, g.id as game_id
       from public.lobbies l left join public.games g on g.lobby_id = l.id
      where l.id = $1`,
    [lobbyId],
  );
  const l = lobby.rows[0];
  if (!l) return null;
  const players = await db.query<{ user_id: string; display_name: string; ready: boolean }>(
    `select user_id, display_name, ready from public.lobby_players where lobby_id = $1 order by joined_at`,
    [lobbyId],
  );
  return {
    id: l.id,
    name: l.name,
    ownerUserId: l.owner_user_id,
    buyIn: l.buy_in.toString(),
    maxPlayers: l.max_players,
    status: l.status,
    startsAt: iso(l.starts_at),
    gameId: l.game_id,
    players: players.rows.map((p) => ({ userId: p.user_id, displayName: p.display_name, ready: p.ready })),
  };
}

export interface LoadedGame {
  view: Omit<GameView, 'me'>;
  picks: Map<string, { direction: Direction; sideBet: string }>;
}

export async function loadGame(db: Db, gameId: string): Promise<LoadedGame | null> {
  const g = (
    await db.query<{
      id: string;
      lobby_id: string;
      status: 'live' | 'finished';
      pot: bigint;
      fee: bigint;
      winner_user_id: string | null;
    }>(`select id, lobby_id, status, pot, fee, winner_user_id from public.games where id = $1`, [gameId])
  ).rows[0];
  if (!g) return null;

  const [playersRes, roundsRes] = await Promise.all([
    db.query<{ user_id: string; display_name: string; eliminated_round: number | null; placement: number | null }>(
      `select user_id, display_name, eliminated_round, placement
         from public.game_players where game_id = $1 order by display_name`,
      [gameId],
    ),
    db.query<{
      id: string;
      round_number: number;
      phase: RoundPhase;
      prev_ball: number | null;
      ball: number | null;
      seed: string;
      seed_hash: string;
      outcome: RoundOutcome | null;
      phase_ends_at: Date;
    }>(
      `select id, round_number, phase, prev_ball, ball, seed, seed_hash, outcome, phase_ends_at
         from public.rounds where game_id = $1 order by round_number desc limit 11`,
      [gameId],
    ),
  ]);

  const current = roundsRes.rows[0];
  const picks = new Map<string, { direction: Direction; sideBet: string }>();
  let round: RoundView | null = null;
  if (current) {
    const picksRes = await db.query<{ user_id: string; direction: Direction; side_bet: bigint }>(
      `select user_id, direction, side_bet from public.picks where round_id = $1`,
      [current.id],
    );
    const pools = { higher: 0n, lower: 0n };
    for (const p of picksRes.rows) {
      picks.set(p.user_id, { direction: p.direction, sideBet: p.side_bet.toString() });
      pools[p.direction] += p.side_bet;
    }
    round = {
      number: current.round_number,
      phase: current.phase,
      prevBall: current.prev_ball,
      ball: current.phase === 'betting' ? null : current.ball,
      seedHash: current.seed_hash,
      seed: current.phase === 'settled' ? current.seed : null,
      phaseEndsAt: current.phase_ends_at.toISOString(),
      picksIn: picksRes.rows.length,
      sidePools: { higher: pools.higher.toString(), lower: pools.lower.toString() },
    };
  }

  const players: GamePlayerView[] = playersRes.rows.map((p) => ({
    userId: p.user_id,
    displayName: p.display_name,
    alive: p.eliminated_round === null,
    eliminatedRound: p.eliminated_round,
    placement: p.placement,
    picked: picks.has(p.user_id),
  }));

  const history: RoundHistoryEntry[] = roundsRes.rows
    .filter((r) => r.phase === 'settled' && r.ball !== null && r.outcome)
    .map((r) => ({ number: r.round_number, prevBall: r.prev_ball, ball: r.ball!, outcome: r.outcome! }));

  return {
    view: {
      id: g.id,
      lobbyId: g.lobby_id,
      status: g.status,
      pot: g.pot.toString(),
      fee: g.fee.toString(),
      winnerUserId: g.winner_user_id,
      round,
      players,
      history,
    },
    picks,
  };
}

export function gameViewFor(loaded: LoadedGame, userId: string | null): GameView {
  const player = userId ? loaded.view.players.find((p) => p.userId === userId) : undefined;
  return {
    ...loaded.view,
    me: player ? { alive: player.alive, pick: loaded.picks.get(player.userId) ?? null } : null,
  };
}

export async function careerFor(db: Db, userId: string): Promise<CareerEntry[]> {
  const res = await db.query<{
    game_id: string;
    lobby_name: string;
    started_at: Date;
    ended_at: Date | null;
    placement: number | null;
    eliminated_round: number | null;
    buy_in: bigint;
    won: string;
  }>(
    `select g.id as game_id, l.name as lobby_name, g.started_at, g.ended_at,
            gp.placement, gp.eliminated_round, gp.buy_in,
            coalesce((select sum(p.amount) from public.payouts p
                       where p.game_id = g.id and p.user_id = gp.user_id
                         and p.reason in ('pot', 'split', 'side_win')), 0)::text as won
       from public.game_players gp
       join public.games g on g.id = gp.game_id
       join public.lobbies l on l.id = g.lobby_id
      where gp.user_id = $1
      order by g.started_at desc
      limit 20`,
    [userId],
  );
  return res.rows.map((r) => ({
    gameId: r.game_id,
    lobbyName: r.lobby_name,
    startedAt: r.started_at.toISOString(),
    endedAt: iso(r.ended_at),
    placement: r.placement,
    eliminatedRound: r.eliminated_round,
    buyIn: r.buy_in.toString(),
    won: r.won,
  }));
}
