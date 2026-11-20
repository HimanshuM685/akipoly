/**
 * Hi-Lo game engine — the single source of truth for round flow and
 * eliminations. All transitions are conditional SQL updates so concurrent
 * calls are safe.
 *
 * Rules (locked with the owner):
 *  - pool ball 00–16, dealt by the host (dealer)
 *  - host never votes, never wins
 *  - non-host players lock in "higher" or "lower" for the next number
 *  - on settle: wrong call → out; equal ball is a push (nobody out)
 *  - no vote before the timer ends → out
 *  - last player standing wins
 *  - rounds ALWAYS run the full 30s cooldown (host may force-respin earlier)
 */
import { randomBytes } from 'node:crypto';
import { HttpError } from './db';

export const ROUND_SECONDS = 30;
export const MAX_PLAYERS = 10;

interface SeatRow {
  user_id: string;
  display_name: string | null;
  joined_at: string;
}

export interface GameSnapshot {
  game: { id: string; lobby_id: string; ended: boolean; winner_user_id: string | null };
  lobby: { id: string; host_user_id: string; name: string; status: string; current_round: number };
  players: Array<{
    user_id: string;
    display_name: string | null;
    is_host: boolean;
    is_eliminated: boolean;
    eliminated_round: number | null;
    points: number;
    vote_locked: boolean;
  }>;
  round: null | {
    id: string;
    number: number;
    ball: number | null;
    status: 'awaiting_spin' | 'voting' | 'settled';
    opened_at: string;
    seconds_left: number;
  };
  me: {
    is_host: boolean;
    is_seated: boolean;
    is_eliminated: boolean;
    vote: string | null;
    needs_name: boolean;
  };
}

// Uniform 0–16 from raw bytes with rejection sampling. No modulo bias.
function randomBall(): number {
  const max = 17;
  const bucket = 256 - (256 % max);
  for (;;) {
    const byte = randomBytes(1)[0];
    if (byte < bucket) return byte % max;
  }
}

/**
 * Commit-reveal randomness (temporary, operator-trusted).
 *
 * NOT cryptographically secure unbiased randomness — suitable only as a
 * placeholder until Chainlink VRF is integrated. The operator generates a
 * seed offchain, commits its hash onchain before betting, then reveals the
 * seed after betting closes. The ball is derived deterministically from the
 * seed + gameId + roundId + previousBall, mapped to 1–15 excluding the
 * previous ball via rejection sampling.
 *
 * Trust assumption: the operator must not collude with players. The seed
 * hash commitment prevents the operator from changing it after bets are in,
 * but the operator knows the seed before revealing and could choose not to
 * reveal (triggering a refund timeout).
 */
export interface RandomnessCommit {
  commitment: string; // hex keccak256 of the seed
  committedAt: Date;
  revealedSeed: string | null;
  revealedAt: Date | null;
}

export function hashSeed(seed: string): string {
  // Simple deterministic hash for commit-reveal. In production this would
  // be keccak256 via viem/ethers; here we use a stable offchain-compatible
  // digest so the operator can compute it offchain and submit onchain.
  // Uses the same algorithm as the frontend hashSeedLocal so commitments
  // computed in the browser match server-side verification.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  // Produce a hex string of 64 chars (simulating bytes32) for compatibility.
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return '0x' + hex.repeat(8).slice(0, 64);
}

export function deriveBallFromSeed(
  seed: string,
  gameId: string,
  roundNumber: number,
  prevBall: number | null,
): number {
  // Deterministic derivation: sha256-like mixing of seed + gameId + round + prevBall
  const input = `${seed}:${gameId}:${roundNumber}:${prevBall ?? 'none'}`;
  const buf = Buffer.from(input, 'utf8');
  // Simple hash to get a pseudo-random value
  let hash = 5381;
  for (let i = 0; i < buf.length; i++) {
    hash = ((hash << 5) + hash + buf[i]) | 0;
  }
  const raw = Math.abs(hash >>> 0);
  const bucket = Math.floor(4294967296 / 14) * 14; // 14 valid balls (1–15 excluding prev)
  let idx = raw % 4294967296;
  // Rejection sampling to avoid modulo bias
  while (idx >= bucket) {
    // Re-mix with the input to get a new value
    const mixed = Buffer.from(`${input}:${idx}`, 'utf8');
    hash = 5381;
    for (let i = 0; i < mixed.length; i++) {
      hash = ((hash << 5) + hash + mixed[i]) | 0;
    }
    idx = (hash >>> 0) % 4294967296;
  }
  const ballIndex = idx % 14; // 0–13
  // Map to 1–15 excluding prevBall
  const available = Array.from({ length: 15 }, (_, i) => i + 1).filter(
    (b) => prevBall == null || b !== prevBall,
  );
  return available[ballIndex] ?? 1;
}

export async function snapshotGame(
  client: import('pg').Client,
  gameId: string,
  meUserId: string | null,
): Promise<GameSnapshot> {
  const gameRes = await client.query(
    `select g.id, g.lobby_id, g.winner_user_id, g.ended_at is not null as ended,
            l.host_user_id, l.name, l.status, l.current_round
       from public.games g
       join public.lobbies l on l.id = g.lobby_id
      where g.id = $1`,
    [gameId],
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, 'game not found');
  const g = gameRes.rows[0];

  const seatsRes = await client.query(
    `select s.user_id, coalesce(s.display_name, u.display_name) as display_name, s.joined_at
       from public.lobby_seats s
       join public.app_users u on u.privy_user_id = s.user_id
      where s.lobby_id = $1
      order by s.joined_at asc`,
    [g.lobby_id],
  );
  const seats: SeatRow[] = seatsRes.rows;

  const resultsRes = await client.query(
    `select user_id, eliminated_round, points from public.game_results where game_id = $1`,
    [gameId],
  );
  const results = new Map(resultsRes.rows.map((r) => [r.user_id, r]));

  const roundRes = await client.query(
    `select id, round_number, ball, status, opened_at, coalesce(high_pool, 0) as high_pool, coalesce(low_pool, 0) as low_pool
       from public.rounds where game_id = $1
      order by round_number desc limit 1`,
    [gameId],
  );
  const roundRow = roundRes.rows[0] ?? null;

  const votesRes = roundRow
    ? await client.query(
        `select user_id, vote from public.round_votes where round_id = $1`,
        [roundRow.id],
      )
    : { rows: [] as Array<{ user_id: string; vote: string }> };
  const votes = new Map(votesRes.rows.map((r) => [r.user_id, r.vote]));

  const betsRes = roundRow
    ? await client.query(
        `select user_id, direction, amount from public.bets where round_id = $1 and settled = false`,
        [roundRow.id],
      )
    : { rows: [] };
  const bets = new Map(betsRes.rows.map((r) => [r.user_id, { direction: r.direction, amount: parseInt(r.amount, 10) }]));

  const claimsRes = roundRow
    ? await client.query(
        `select user_id, coalesce(sum(claimable), 0) as claimable from public.bets
         where game_id = $1 and settled = true and claimable > 0 group by user_id`,
        [gameId],
      )
    : { rows: [] };
  const claims = new Map(claimsRes.rows.map((r) => [r.user_id, parseInt(r.claimable, 10)]));

  const players = seats.map((seat) => {
    const result = results.get(seat.user_id);
    const bet = bets.get(seat.user_id);
    return {
      user_id: seat.user_id,
      display_name: seat.display_name,
      is_host: seat.user_id === g.host_user_id,
      is_eliminated: result?.eliminated_round != null,
      eliminated_round: result?.eliminated_round ?? null,
      points: result?.points ?? 0,
      vote_locked: votes.has(seat.user_id),
      my_bet: bet ? { direction: bet.direction, amount: bet.amount } : null,
    };
  });

  const meVote = meUserId ? votes.get(meUserId) ?? null : null;
  const meResult = meUserId ? results.get(meUserId) : null;
  const meSeat = meUserId ? seats.find((s) => s.user_id === meUserId) ?? null : null;
  const myBet = meUserId ? bets.get(meUserId) ?? null : null;
  const myClaimable = meUserId ? claims.get(meUserId) ?? 0 : 0;

  const secondsLeft = roundRow
    ? Math.max(0, ROUND_SECONDS - Math.floor((Date.now() - new Date(roundRow.opened_at).getTime()) / 1000))
    : 0;

  return {
    game: { id: g.id, lobby_id: g.lobby_id, ended: Boolean(g.ended), winner_user_id: g.winner_user_id ?? null },
    lobby: { id: g.lobby_id, host_user_id: g.host_user_id, name: g.name, status: g.status, current_round: g.current_round },
    players,
    round: roundRow
      ? {
          id: roundRow.id,
          number: roundRow.round_number,
          ball: roundRow.ball,
          status: roundRow.status,
          opened_at: roundRow.opened_at,
          seconds_left: secondsLeft,
          high_pool: roundRow.high_pool,
          low_pool: roundRow.low_pool,
        }
      : null,
    me: {
      is_host: meUserId === g.host_user_id,
      is_seated: meSeat != null,
      is_eliminated: meResult?.eliminated_round != null,
      vote: meVote,
      needs_name: meSeat != null && !meSeat.display_name,
      my_bet: myBet,
      claimable: myClaimable,
    },
  };
}

export async function createFirstRound(client: import('pg').Client, gameId: string) {
  await client.query(
    `insert into public.rounds (game_id, round_number, status) values ($1, 1, 'awaiting_spin')`,
    [gameId],
  );
}

export async function spin(client: import('pg').Client, gameId: string, userId: string) {
  const gameRes = await client.query(
    `select g.id, g.lobby_id, l.host_user_id, l.status
       from public.games g join public.lobbies l on l.id = g.lobby_id
      where g.id = $1 for update of g`,
    [gameId],
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, 'game not found');
  const g = gameRes.rows[0];
  if (g.host_user_id !== userId) throw new HttpError(403, 'only the host spins the ball');
  if (g.status !== 'live') throw new HttpError(409, 'game is not live');

  const roundRes = await client.query(
    `select id, round_number, ball, status from public.rounds
      where game_id = $1 order by round_number desc limit 1 for update`,
    [gameId],
  );
  const round = roundRes.rows[0];
  if (!round) throw new HttpError(409, 'no round to spin');
  if (round.status !== 'awaiting_spin') {
    throw new HttpError(409, 'round already spinning or settled');
  }

  const ball = randomBall();
  await client.query(
    `update public.rounds
        set ball = $1, status = 'voting', opened_at = now()
      where id = $2`,
    [ball, round.id],
  );
  await client.query(
    `update public.lobbies set current_round = $1, updated_at = now() where id = $2`,
    [round.round_number, g.lobby_id],
  );
  return { ball };
}

export async function vote(
  client: import('pg').Client,
  gameId: string,
  userId: string,
  choice: 'higher' | 'lower',
) {
  if (choice !== 'higher' && choice !== 'lower') throw new HttpError(400, 'vote must be higher or lower');

  const gameRes = await client.query(
    `select g.id, l.host_user_id, l.status
       from public.games g join public.lobbies l on l.id = g.lobby_id
      where g.id = $1 for update of g`,
    [gameId],
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, 'game not found');
  const g = gameRes.rows[0];
  if (g.status !== 'live') throw new HttpError(409, 'game is not live');
  if (g.host_user_id === userId) throw new HttpError(403, 'the host does not vote');

  const roundRes = await client.query(
    `select id, status from public.rounds
      where game_id = $1 order by round_number desc limit 1 for update`,
    [gameId],
  );
  const round = roundRes.rows[0];
  if (!round) throw new HttpError(409, 'no active round');
  if (round.status !== 'voting') throw new HttpError(409, 'round is not open for votes');

  const eligibility = await client.query(
    `select 1 from public.lobby_seats s
      where s.lobby_id = (select lobby_id from public.games where id = $1) and s.user_id = $2`,
    [gameId, userId],
  );
  if (eligibility.rowCount === 0) throw new HttpError(403, 'you are not seated in this game');

  const eliminated = await client.query(
    `select 1 from public.game_results where game_id = $1 and user_id = $2 and eliminated_round is not null`,
    [gameId, userId],
  );
  if (eliminated.rowCount) throw new HttpError(409, 'you are out — you cannot vote');

  const existingVote = await client.query(
    'select vote from public.round_votes where round_id = $1 and user_id = $2',
    [round.id, userId],
  );
  if (existingVote.rowCount) throw new HttpError(409, 'you already locked in');

  await client.query(
    `insert into public.round_votes (round_id, user_id, vote)
     values ($1, $2, $3)`,
    [round.id, userId, choice],
  );
  return { ok: true };
}

/** Place a bet on HIGH or LOW for the current round. */
export async function placeBet(
  client: import('pg').Client,
  gameId: string,
  roundId: string,
  userId: string,
  direction: 'higher' | 'lower',
  amount: string,
) {
  const betAmount = parseInt(amount, 10);
  if (isNaN(betAmount) || betAmount <= 0) {
    throw new HttpError(400, 'bet amount must be a positive integer');
  }

  const gameRes = await client.query(
    `select g.id, l.host_user_id, l.status
       from public.games g join public.lobbies l on l.id = g.lobby_id
      where g.id = $1 for update of g`,
    [gameId],
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, 'game not found');
  const g = gameRes.rows[0];
  if (g.status !== 'live') throw new HttpError(409, 'game is not live');
  if (g.host_user_id === userId) throw new HttpError(403, 'the host cannot bet');

  const roundRes = await client.query(
    `select id, status from public.rounds where id = $1 and game_id = $2 for update`,
    [roundId, gameId],
  );
  if (roundRes.rowCount === 0) throw new HttpError(404, 'round not found');
  const r = roundRes.rows[0];
  if (r.status !== 'voting') throw new HttpError(409, 'betting is closed for this round');

  const seatRes = await client.query(
    `select 1 from public.lobby_seats where lobby_id = (select lobby_id from public.games where id = $1) and user_id = $2`,
    [gameId, userId],
  );
  if (seatRes.rowCount === 0) throw new HttpError(403, 'you are not seated in this game');

  const eliminated = await client.query(
    `select 1 from public.game_results where game_id = $1 and user_id = $2 and eliminated_round is not null`,
    [gameId, userId],
  );
  if (eliminated.rowCount) throw new HttpError(409, 'you are out — you cannot bet');

  const existing = await client.query(
    `select 1 from public.bets where round_id = $1 and user_id = $2`,
    [roundId, userId],
  );
  if (existing.rowCount) throw new HttpError(409, 'you already placed a bet this round');

  await client.query(
    `insert into public.bets (game_id, round_id, user_id, direction, amount, settled, claimable)
     values ($1, $2, $3, $4, $5, false, $5)`,
    [gameId, roundId, userId, direction, betAmount],
  );

  const poolCol = direction === 'higher' ? 'high_pool' : 'low_pool';
  await client.query(
    `update public.rounds set ${poolCol} = coalesce(${poolCol}, 0) + $1 where id = $2`,
    [betAmount, roundId],
  );

  return { ok: true, amount: betAmount, direction };
}

/** Commit a randomness seed hash for a round (operator only). */
export async function commitRandomness(
  client: import('pg').Client,
  gameId: string,
  roundId: string,
  userId: string,
  commitment: string,
) {
  const gameRes = await client.query(
    `select l.host_user_id from public.games g
       join public.lobbies l on l.id = g.lobby_id
      where g.id = $1 for update of g`,
    [gameId],
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, 'game not found');
  if (gameRes.rows[0].host_user_id !== userId) throw new HttpError(403, 'only the host can commit randomness');

  const existing = await client.query(
    `select 1 from public.randomness_commits where game_id = $1 and round_id = $2`,
    [gameId, roundId],
  );
  if (existing.rowCount) throw new HttpError(409, 'randomness already committed for this round');

  await client.query(
    `insert into public.randomness_commits (game_id, round_id, commitment, committed_at)
     values ($1, $2, $3, now())`,
    [gameId, roundId, commitment],
  );
  return { ok: true, commitment };
}

/** Reveal the randomness seed and derive the ball (operator only). */
export async function revealRandomness(
  client: import('pg').Client,
  gameId: string,
  roundId: string,
  userId: string,
  seed: string,
) {
  const gameRes = await client.query(
    `select g.id, g.lobby_id, l.host_user_id, g.status
       from public.games g join public.lobbies l on l.id = g.lobby_id
      where g.id = $1 for update of g`,
    [gameId],
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, 'game not found');
  const g = gameRes.rows[0];
  if (g.host_user_id !== userId) throw new HttpError(403, 'only the host can reveal randomness');

  const commitRes = await client.query(
    `select commitment, revealed_seed from public.randomness_commits
     where game_id = $1 and round_id = $2 for update`,
    [gameId, roundId],
  );
  if (commitRes.rowCount === 0) throw new HttpError(404, 'no randomness commitment found');
  if (commitRes.rows[0].revealed_seed) throw new HttpError(409, 'randomness already revealed');

  const expected = hashSeed(seed);
  if (expected !== commitRes.rows[0].commitment) {
    throw new HttpError(400, 'invalid seed — does not match commitment');
  }

  const roundRes = await client.query(
    `select id, round_number, ball, status from public.rounds where id = $1 for update`,
    [roundId],
  );
  if (roundRes.rowCount === 0) throw new HttpError(404, 'round not found');
  const r = roundRes.rows[0];

  // Get previous ball for exclusion
  let prevBall: number | null = null;
  if (r.round_number > 1) {
    const prev = await client.query(
      `select ball from public.rounds where game_id = $1 and round_number = $2`,
      [gameId, r.round_number - 1],
    );
    prevBall = prev.rows[0]?.ball ?? null;
  }

  const ball = deriveBallFromSeed(seed, gameId, r.round_number, prevBall);

  await client.query(
    `update public.randomness_commits set revealed_seed = $1, revealed_at = now()
     where game_id = $2 and round_id = $3`,
    [seed, gameId, roundId],
  );

  await client.query(
    `update public.rounds set ball = $1, status = 'voting', opened_at = now()
     where id = $2`,
    [ball, roundId],
  );

  return { ball, seed, commitment: commitRes.rows[0].commitment };
}

/** Claim winnings or refunds for a player. Pull-based, reentrancy-safe. */
export async function claimWinnings(
  client: import('pg').Client,
  gameId: string,
  userId: string,
) {
  const claimRes = await client.query(
    `select coalesce(sum(claimable), 0) as total from public.bets
     where game_id = $1 and user_id = $2 and settled = true and claimable > 0`,
    [gameId, userId],
  );
  const total = parseInt(claimRes.rows[0]?.total ?? '0', 10);
  if (total <= 0) throw new HttpError(400, 'nothing to claim');

  // Zero the claimable balances first (checks-effects-interactions)
  await client.query(
    `update public.bets set claimable = 0 where game_id = $1 and user_id = $2 and settled = true and claimable > 0`,
    [gameId, userId],
  );

  return { claimable: total };
}

/** Refund all bets for a round when no winning-side bets exist. */
export async function refundBets(
  client: import('pg').Client,
  gameId: string,
  roundId: string,
) {
  await client.query(
    `update public.bets set settled = true, claimable = amount
     where round_id = $1 and settled = false`,
    [roundId],
  );
  await client.query(
    `update public.rounds set status = 'refunded' where id = $1`,
    [roundId],
  );
  return { ok: true, roundId };
}

/** Settle the current round: eliminations, points, next round or game end. */
export async function settleRound(
  client: import('pg').Client,
  gameId: string,
  force: boolean,
) {
  const gameRes = await client.query(
    `select g.id, g.lobby_id, l.host_user_id, l.status
       from public.games g join public.lobbies l on l.id = g.lobby_id
      where g.id = $1 for update of g`,
    [gameId],
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, 'game not found');
  const g = gameRes.rows[0];
  if (g.status !== 'live') throw new HttpError(409, 'game is not live');

  const roundRes = await client.query(
    `select id, round_number, ball, status, opened_at from public.rounds
      where game_id = $1 order by round_number desc limit 1 for update`,
    [gameId],
  );
  const round = roundRes.rows[0];
  if (!round) throw new HttpError(409, 'no round');
  if (round.status !== 'voting') return { settled: false, reason: 'round is not open' };

  const votersRes = await client.query(
    `select s.user_id from public.lobby_seats s
      where s.lobby_id = $1 and s.user_id <> $2`,
    [g.lobby_id, g.host_user_id],
  );
  const seats: Array<{ user_id: string }> = votersRes.rows;

  let prevBall: number | null = null;
  if (round.round_number > 1) {
    const prev = await client.query(
      `select ball from public.rounds where game_id = $1 and round_number = $2`,
      [gameId, round.round_number - 1],
    );
    prevBall = prev.rows[0]?.ball ?? null;
  }

  const votesRes = await client.query(
    `select user_id, vote from public.round_votes where round_id = $1`,
    [round.id],
  );
  const votes = new Map(votesRes.rows.map((r) => [r.user_id, r.vote]));

  const betsRes = await client.query(
    `select user_id, direction, amount from public.bets where round_id = $1 and settled = false`,
    [round.id],
  );
  const bets = new Map(betsRes.rows.map((r) => [r.user_id, { direction: r.direction, amount: parseInt(r.amount, 10) }]));

  const highPoolRes = await client.query(
    `select coalesce(high_pool, 0) as high_pool from public.rounds where id = $1`,
    [round.id],
  );
  const lowPoolRes = await client.query(
    `select coalesce(low_pool, 0) as low_pool from public.rounds where id = $1`,
    [round.id],
  );
  const highPool = parseInt(highPoolRes.rows[0]?.high_pool ?? '0', 10);
  const lowPool = parseInt(lowPoolRes.rows[0]?.low_pool ?? '0', 10);

  const eliminatedRes = await client.query(
    `select user_id from public.game_results where game_id = $1 and eliminated_round is not null`,
    [gameId],
  );
  const outIds = new Set(eliminatedRes.rows.map((r) => r.user_id));
  const active = seats.filter((s) => !outIds.has(s.user_id));

  const expired = Date.now() > new Date(round.opened_at).getTime() + ROUND_SECONDS * 1000;
  if (!force && !expired) {
    return { settled: false, reason: 'waiting for the cooldown' };
  }

  // Determine winning direction.
  let highWins: boolean | null = null;
  if (prevBall != null) {
    if (round.ball > prevBall) highWins = true;
    else if (round.ball < prevBall) highWins = false;
    // equal ball = push (nobody wins, refund all)
  }

  const winningPool = highWins ? highPool : lowPool;
  const totalPool = highPool + lowPool;
  const winningSideBets = highWins ? highPool : lowPool;

  // Eliminations and payout calculation.
  const eliminatedThisRound: string[] = [];
  const winners: Array<{ user_id: string; bet: number; payout: number }> = [];
  const refundDue: Array<{ user_id: string; amount: number }> = [];

  for (const s of active) {
    const vote = votes.get(s.user_id);
    const bet = bets.get(s.user_id);

    // No vote before timer ends → out.
    if (!vote) {
      eliminatedThisRound.push(s.user_id);
      // Refund their bet if they placed one.
      if (bet) refundDue.push({ user_id: s.user_id, amount: bet.amount });
      continue;
    }

    let correct = true;
    if (prevBall != null) {
      if (round.ball > prevBall) correct = vote === 'higher';
      else if (round.ball < prevBall) correct = vote === 'lower';
      else correct = true; // push — nobody out
    }

    if (!correct) {
      eliminatedThisRound.push(s.user_id);
      // Refund their bet.
      if (bet) refundDue.push({ user_id: s.user_id, amount: bet.amount });
      continue;
    }

    // Correct call — survivor.
    if (bet) {
      if (highWins === null) {
        // Push — refund all bets.
        refundDue.push({ user_id: s.user_id, amount: bet.amount });
      } else if ((highWins && bet.direction === 'higher') || (!highWins && bet.direction === 'lower')) {
        // Winner — proportional payout.
        const payout = winningSideBets > 0
          ? Math.floor((bet.amount * totalPool) / winningSideBets)
          : bet.amount;
        winners.push({ user_id: s.user_id, bet: bet.amount, payout });
      } else {
        // Bet on losing side — eliminated.
        eliminatedThisRound.push(s.user_id);
        refundDue.push({ user_id: s.user_id, amount: bet.amount });
      }
    }
  }

  // Credit claimable balances for winners.
  for (const w of winners) {
    await client.query(
      `update public.bets set settled = true, claimable = $1
       where game_id = $2 and user_id = $3 and round_id = $4`,
      [w.payout, gameId, w.user_id, round.id],
    );
    await client.query(
      `insert into public.game_results (game_id, user_id, points)
       values ($1, $2, $3)
       on conflict (game_id, user_id) do update set points = public.game_results.points + $3`,
      [gameId, w.user_id, w.payout],
    );
  }

  // Credit claimable balances for refunds.
  for (const r of refundDue) {
    await client.query(
      `update public.bets set settled = true, claimable = $1
       where game_id = $2 and user_id = $3 and round_id = $4`,
      [r.amount, gameId, r.user_id, round.id],
    );
  }

  // Mark eliminated players.
  for (const userId of eliminatedThisRound) {
    await client.query(
      `insert into public.game_results (game_id, user_id, eliminated_round, placement)
       values ($1, $2, $3, null)
       on conflict (game_id, user_id) do update set eliminated_round = excluded.eliminated_round`,
      [gameId, userId, round.round_number],
    );
  }

  await client.query(
    `update public.rounds set status = 'settled', closed_at = now() where id = $1`,
    [round.id],
  );

  const survivorsNow = active.filter((s) => !eliminatedThisRound.includes(s.user_id));
  const gameOver = round.round_number >= 2 && survivorsNow.length <= 1;
  if (gameOver) {
    const winner = survivorsNow[0]?.user_id ?? null;
    await client.query(
      `update public.games set winner_user_id = $1, ended_at = now() where id = $2`,
      [winner, gameId],
    );

    const allSeats = await client.query(
      `select user_id from public.lobby_seats where lobby_id = $1`,
      [g.lobby_id],
    );
    for (const seat of allSeats.rows) {
      if (seat.user_id !== winner) {
        await client.query(
          `insert into public.game_results (game_id, user_id, placement, points)
           values ($1, $2, null, 0)
           on conflict (game_id, user_id) do nothing`,
          [gameId, seat.user_id],
        );
      }
    }
    if (winner) {
      await client.query(
        `insert into public.game_results (game_id, user_id, placement, points)
         values ($1, $2, 1, 0)
         on conflict (game_id, user_id) do update set placement = 1`,
        [gameId, winner],
      );
    }
    await client.query(
      `update public.lobbies set status = 'finished', updated_at = now() where id = $1`,
      [g.lobby_id],
    );
    return { settled: true, game_over: true, winner, ball: round.ball, winners, refunds: refundDue.length };
  }

  await client.query(
    `insert into public.rounds (game_id, round_number, status) values ($1, $2, 'awaiting_spin')`,
    [gameId, round.round_number + 1],
  );
  await client.query(
    `update public.lobbies set current_round = $1, updated_at = now() where id = $2`,
    [round.round_number + 1, g.lobby_id],
  );
  return { settled: true, game_over: false, ball: round.ball, next_round: round.round_number + 1, winners, refunds: refundDue.length };
}
