/**
 * Drives time-based transitions: lobby countdowns and round phases.
 * Only due rows are read (partial indexes), each advanced in its own tx with
 * FOR UPDATE SKIP LOCKED, so it is safe to run on several instances and one
 * stuck game never blocks the rest.
 */
import { pool, withTx } from '../db/pool.js';
import { advanceRound, type RoundRow } from '../services/game.js';
import { startDueLobby } from '../services/lobby.js';
import { lobbiesChanged } from '../events.js';
import { log } from '../log.js';

const TICK_MS = 250;
const BATCH = 50;

async function advanceDueRounds(): Promise<void> {
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
      log.error({ err, roundId: id }, 'advancing round failed');
    }
  }
}

async function startDueLobbies(): Promise<void> {
  const due = await pool.query<{ id: string }>(
    `select id from public.lobbies where status = 'starting' and starts_at <= now() limit $1`,
    [BATCH],
  );
  for (const { id } of due.rows) {
    try {
      if (await withTx((c) => startDueLobby(c, id))) lobbiesChanged([id]);
    } catch (err) {
      log.error({ err, lobbyId: id }, 'starting lobby failed');
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await startDueLobbies();
      await advanceDueRounds();
    } catch (err) {
      log.error({ err }, 'scheduler tick failed');
    } finally {
      running = false;
    }
  }, TICK_MS);
  log.info('scheduler started');
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
