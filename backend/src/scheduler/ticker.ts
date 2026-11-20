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
import { events, lobbiesChanged } from '../events.js';
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
      where phase in ('betting', 'rolling') and phase_ends_at <= now()
      order by phase_ends_at limit $1`,
    [BATCH],
  );
  for (const { id } of due.rows) {
    try {
      const lobbyId = await withTx(async (c) => {
        const round = (
          await c.query<RoundRow>(
            `select r.id, r.game_id, g.lobby_id, g.pot, r.round_number, r.phase, r.prev_ball, r.ball, r.seed, r.phase_ends_at
               from public.rounds r join public.games g on g.id = r.game_id
              where r.id = $1 and r.phase in ('betting', 'rolling') and r.phase_ends_at <= now()
              for update of r skip locked`,
            [id],
          )
        ).rows[0];
        if (!round) return null;
        await advanceRound(c, round);
        return round.lobby_id;
      });
      if (lobbyId) lobbiesChanged([lobbyId]);
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

/** ms until the next countdown or round phase is due; null = nothing scheduled. */
async function msUntilNextDue(): Promise<number | null> {
  const res = await pool.query<{ next: Date | null }>(
    `select least(
       (select min(phase_ends_at) from public.rounds where phase in ('betting', 'rolling')),
       (select min(starts_at) from public.lobbies where status = 'starting')
     ) as next`,
  );
  const next = res.rows[0]?.next;
  return next ? next.getTime() - Date.now() : null;
}

// Sleeps until the next due row instead of polling, and sleeps indefinitely
// when nothing is scheduled so an idle Neon database can autosuspend. Any
// committed change (lobby event) wakes it.
let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = true;
let wakeAgain = false;

async function loop(): Promise<void> {
  if (stopped) return;
  if (running) {
    wakeAgain = true; // never overlap ticks
    return;
  }
  running = true;
  if (timer) clearTimeout(timer);
  timer = null;
  let delay: number | null;
  try {
    const failed = (await startDueLobbies()) + (await advanceDueRounds());
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
