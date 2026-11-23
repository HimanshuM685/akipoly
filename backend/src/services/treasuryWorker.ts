/**
 * The treasury worker: the only code that signs treasury transactions. VRF
 * draws (requestBall, then fulfillRandomWords) and USDC payouts share the one
 * treasury key, so they share one loop. Every tx takes its nonce from the
 * chain's pending count and is broadcast before the next one is signed. Run it
 * in exactly one process (PAYOUT_WORKER=true).
 *
 * VRF jobs go first in each pass: a table is waiting on them. Payouts can take
 * a second longer.
 *
 * Event-driven like the scheduler: an idle queue means no polling (Neon can
 * sleep), and every committed enqueue wakes it.
 */
import { events } from '../events.js';
import { log } from '../log.js';
import { confirmSent, msUntilPayoutWork, sendNext } from './payouts.js';
import { runVrfJobs } from './vrf.js';

const ERROR_RETRY_MS = 2_000;

let timer: NodeJS.Timeout | null = null;
let busy = false;
let stopped = true;
let wakeAgain = false;

const earliest = (...delays: (number | null)[]) =>
  delays.reduce<number | null>((min, d) => (d === null ? min : min === null ? d : Math.min(min, d)), null);

async function work(): Promise<void> {
  if (stopped) return;
  if (busy) {
    wakeAgain = true;
    return;
  }
  busy = true;
  if (timer) clearTimeout(timer);
  timer = null;
  let delay: number | null;
  try {
    const vrf = await runVrfJobs();
    if (vrf.blocked) {
      // A VRF tx owns the next nonce but didn't broadcast: signing a payout now
      // would take that nonce and strand the VRF tx. Retry the broadcast first.
      delay = vrf.delay;
    } else {
      while (await sendNext()) {
        /* drain the payout queue */
      }
      await confirmSent();
      delay = earliest(vrf.delay, await msUntilPayoutWork());
    }
  } catch (err) {
    log.error({ err }, 'treasury worker tick failed');
    delay = ERROR_RETRY_MS;
  } finally {
    busy = false;
  }
  if (wakeAgain) {
    wakeAgain = false;
    delay = 0;
  }
  if (delay !== null && !stopped) timer = setTimeout(() => void work(), Math.max(50, Math.min(delay, 60_000)));
}

export function startTreasuryWorker(): void {
  if (!stopped) return;
  stopped = false;
  events.on('payouts', () => void work());
  events.on('vrf', () => void work());
  void work();
  log.info('treasury worker started (VRF draws + payouts)');
}

export function stopTreasuryWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
