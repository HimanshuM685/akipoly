/**
 * Drives time-based transitions: lobby countdowns and round phases.
 * Event-driven: it sleeps until the next deadline and is woken by changes.
 * Only due rows are read (partial indexes), each advanced in its own tx with
 * FOR UPDATE SKIP LOCKED, so it is safe to run on several instances and one
 * stuck game never blocks the rest.
 */
import { pool, withTx } from '../db/pool.js';
import { advanceRound, type RoundRow } from '../services/game.js';
import { startDueLobby } from '../services/lobby.js';
import { events, lobbiesChanged, lobbyChanged } from '../events.js';
import { log } from '../log.js';

// While rows are scheduled, re-check at least this often (clock safety net).
const MAX_SLEEP_MS = 5_000;
const MIN_SLEEP_MS = 20;
const RETRY_FAILED_MS = 1_000;
const BATCH = 50;

/** Returns how many due rows failed, so a broken row can't spin the loop. */
async function advanceDueRounds(): Promise<number> {
  let failed = 0;
  const due = await pool.query<{ id: string }>(
    `select id from public.rounds
      where phase in ('betting', 'drawing', 'rolling') and phase_ends_at <= now()
      order by phase_ends_at limit $1`,
    [BATCH],
  );
  for (const { id } of due.rows) {
    try {
      const changed = await withTx(async (c) => {
        const round = (
          await c.query<RoundRow>(
            `select r.id, r.game_id, g.lobby_id, g.pot, r.round_number, r.phase, r.prev_ball, r.ball, r.phase_ends_at
               from public.rounds r join public.games g on g.id = r.game_id
              where r.id = $1 and r.phase in ('betting', 'drawing', 'rolling') and r.phase_ends_at <= now()
              for update of r skip locked`,
            [id],
          )
        ).rows[0];
        if (!round) return null;
        const { finished } = await advanceRound(c, round);
        return { lobbyId: round.lobby_id, finished };
      });
      // Phase changes only matter to that table; a finished game also leaves the list.
      if (changed?.finished) lobbiesChanged([changed.lobbyId]);
      else if (changed) lobbyChanged(changed.lobbyId);
    } catch (err) {
      failed += 1;
      log.error({ err, roundId: id }, 'advancing round failed');
    }
  }
  return failed;
}

async function startDueLobbies(): Promise<number> {
  let failed = 0;
  const due = await pool.query<{ id: string }>(
    `select id from public.lobbies where status = 'starting' and starts_at <= now() limit $1`,
    [BATCH],
  );
  for (const { id } of due.rows) {
    try {
      if (await withTx((c) => startDueLobby(c, id))) lobbiesChanged([id]);
    } catch (err) {
      failed += 1;
      log.error({ err, lobbyId: id }, 'starting lobby failed');
    }
  }
  return failed;
}

/**
 * ms until the next countdown or round phase is due; null = nothing scheduled.
 * Measured on the database clock (deadlines are written with now()), so skew
 * between this server and Postgres can't cause busy-looping or late phases.
 */
async function msUntilNextDue(): Promise<number | null> {
  const res = await pool.query<{ ms: number | null }>(
    `select (extract(epoch from least(
               (select min(phase_ends_at) from public.rounds where phase in ('betting', 'drawing', 'rolling')),
               (select min(starts_at) from public.lobbies where status = 'starting')
             ) - now()) * 1000)::float8 as ms`,
  );
  return res.rows[0]?.ms ?? null;
}

// Sleeps until the next due row instead of polling, and sleeps indefinitely
// when nothing is scheduled so an idle Neon database can autosuspend. Any
// committed change (lobby event) wakes it.
let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = true;
let wakeAgain = false;
/** Set once this tick has read the next deadline; earlier wakes are our own writes. */
let readNextDue = false;

async function loop(): Promise<void> {
  if (stopped) return;
  if (running) {
    // Never overlap ticks. Wakes raised by this tick's own writes happen before
    // it reads the next deadline, so only later (external) changes need a rerun.
    if (readNextDue) wakeAgain = true;
    return;
  }
  running = true;
  readNextDue = false;
  if (timer) clearTimeout(timer);
  timer = null;
  let delay: number | null;
  try {
    const failed = (await startDueLobbies()) + (await advanceDueRounds());
    readNextDue = true;
    delay = await msUntilNextDue();
    if (failed > 0 && delay !== null) delay = Math.max(delay, RETRY_FAILED_MS);
  } catch (err) {
    log.error({ err }, 'scheduler tick failed');
    delay = 1000;
  } finally {
    running = false;
  }
  if (wakeAgain) {
    wakeAgain = false;
    delay = 0;
  }
  if (delay !== null && !stopped) timer = setTimeout(() => void loop(), Math.max(MIN_SLEEP_MS, Math.min(delay, MAX_SLEEP_MS)));
}

export function wakeScheduler(): void {
  void loop();
}

export function startScheduler(): void {
  if (!stopped) return;
  stopped = false;
  events.on('lobby', wakeScheduler);
  void loop();
  log.info('scheduler started');
}

export function stopScheduler(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
