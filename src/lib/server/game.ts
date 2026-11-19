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
 */
import { randomInt } from 'node:crypto';
import { HttpError } from './db';

export const ROUND_SECONDS = 30;
export const MAX_PLAYERS = 10;

interface SeatRow {
  user_id: string;
  display_name: string | null;
  wallet_address: string | null;
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
  me: { is_host: boolean; is_seated: boolean; is_eliminated: boolean; vote: string | null };
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
    `select s.user_id, u.display_name, u.wallet_address, s.joined_at
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
    `select id, round_number, ball, status, opened_at
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

  const players = seats.map((seat) => {
    const result = results.get(seat.user_id);
    return {
      user_id: seat.user_id,
      display_name: seat.display_name,
      is_host: seat.user_id === g.host_user_id,
      is_eliminated: result?.eliminated_round != null,
      eliminated_round: result?.eliminated_round ?? null,
      points: result?.points ?? 0,
      vote_locked: votes.has(seat.user_id),
    };
  });

  const meVote = meUserId ? votes.get(meUserId) ?? null : null;
  const meResult = meUserId ? results.get(meUserId) : null;
  const meSeat = meUserId ? seats.some((s) => s.user_id === meUserId) : false;

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
        }
      : null,
    me: {
      is_host: meUserId === g.host_user_id,
      is_seated: meSeat,
      is_eliminated: meResult?.eliminated_round != null,
      vote: meVote,
    },
  };
}

/** Create round 1 waiting for a spin when a game starts. */
export async function createFirstRound(client: import('pg').Client, gameId: string) {
  await client.query(
    `insert into public.rounds (game_id, round_number, status) values ($1, 1, 'awaiting_spin')`,
    [gameId],
  );
}

export async function spin(client: import('pg').Client, gameId: string, userId: string) {
  // Lock the game row while we mutate the round.
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

  const ball = randomInt(0, 17); // 0..16 uniform
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

  // Seated, non-eliminated players may vote.
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

  // Previous ball (round 1 has none).
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

  // Who is still in?
  const eliminatedRes = await client.query(
    `select user_id from public.game_results where game_id = $1 and eliminated_round is not null`,
    [gameId],
  );
  const outIds = new Set(eliminatedRes.rows.map((r) => r.user_id));
  const active = seats.filter((s) => !outIds.has(s.user_id));

  const expired = Date.now() > new Date(round.opened_at).getTime() + ROUND_SECONDS * 1000;
  const everyoneVoted = active.length > 0 && active.every((s) => votes.has(s.user_id));
  if (!force && !everyoneVoted && !expired) {
    return { settled: false, reason: 'waiting for lock-ins' };
  }

  // Determine eliminations.
  const eliminatedThisRound: string[] = [];
  for (const s of active) {
    const vote = votes.get(s.user_id);
    let correct = true;
    if (!vote) correct = false; // no lock-in = out
    else if (prevBall != null) {
      if (round.ball > prevBall) correct = vote === 'higher';
      else if (round.ball < prevBall) correct = vote === 'lower';
      else correct = true; // push
    }
    if (!correct) eliminatedThisRound.push(s.user_id);
  }

  // Points: +1 for every survivor on a real comparison.
  const survivors = active.filter((s) => !eliminatedThisRound.includes(s.user_id));
  if (prevBall != null) {
    for (const s of survivors) {
      await client.query(
        `insert into public.game_results (game_id, user_id, points)
         values ($1, $2, 1)
         on conflict (game_id, user_id) do update set points = public.game_results.points + 1`,
        [gameId, s.user_id],
      );
    }
  }
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
  // Game over only when the round actually produced eliminations and at most
  // one non-host voter survives it. Round 1 never ends the game by itself.
  const gameOver = round.round_number >= 2 && survivorsNow.length <= 1;
    // Game over — winner is the survivor (or the last eliminated).
    const winner = survivorsNow[0]?.user_id ?? (eliminatedThisRound.length > 0 ? eliminatedThisRound[eliminatedThisRound.length - 1] : null);
    await client.query(
      `update public.games set winner_user_id = $1, ended_at = now() where id = $2`,
      [winner, gameId],
    );
    // Final placements: sorted by eliminated_round DESC, winner last.
    const finalResults = await client.query(
      `select gr.user_id, gr.eliminated_round, s.joined_at
         from public.game_results gr
         join public.lobby_seats s on s.lobby_id = $1 and s.user_id = gr.user_id
        where gr.game_id = $2`,
      [g.lobby_id, gameId],
    );
    const ordered = [...finalResults.rows].sort((a, b) => {
      if (a.user_id === winner) return -1;
      if (b.user_id === winner) return 1;
      const ae = a.eliminated_round ?? 0;
      const be = b.eliminated_round ?? 0;
      return be - ae;
    });
    let place = 1;
    for (const row of ordered) {
      await client.query(
        `update public.game_results set placement = $1 where game_id = $2 and user_id = $3`,
        [place++, gameId, row.user_id],
      );
    }

    // Dealer account never voted and was never eliminated — record them as well
    // so career shows the game for the host too.
    const allSeats = await client.query(
      `select user_id from public.lobby_seats where lobby_id = $1`,
      [g.lobby_id],
    );
    for (const seat of allSeats.rows) {
      await client.query(
        `insert into public.game_results (game_id, user_id, placement, points)
         values ($1, $2, null, 0)
         on conflict (game_id, user_id) do nothing`,
        [gameId, seat.user_id],
      );
    }
    // Players with no game_results row at all (host never voted, never out): count as last?
    await client.query(
      `update public.lobbies set status = 'finished', updated_at = now() where id = $1`,
      [g.lobby_id],
    );
    return { settled: true, game_over: true, winner, ball: round.ball };
  }

  // Next round.
  await client.query(
    `insert into public.rounds (game_id, round_number, status) values ($1, $2, 'awaiting_spin')`,
    [gameId, round.round_number + 1],
  );
  await client.query(
    `update public.lobbies set current_round = $1, updated_at = now() where id = $2`,
    [round.round_number + 1, g.lobby_id],
  );
  return { settled: true, game_over: false, ball: round.ball, next_round: round.round_number + 1 };
}
