/**
 * Payouts: enqueued inside the settling transaction (atomic with game state),
 * sent later by a single worker. Lifecycle:
 *   pending → sent (signed raw tx + hash stored, then broadcast) → confirmed
 *   pending → failed after MAX_ATTEMPTS signing errors
 *   sent    → held when it never lands (needs a human), failed if reverted
 *   held    ← enqueued above MAX_AUTO_PAYOUT_USDC
 */
import type pg from 'pg';
import type { Hash, Hex } from 'viem';
import { env } from '../config/env.js';
import { afterCommit, pool, withTx } from '../db/pool.js';
import { broadcast, signUsdcTransfer, transferStatus } from '../chain/usdc.js';
import { events } from '../events.js';
import { log } from '../log.js';
import { AppError } from '../errors.js';
import type { PayoutReason } from '../shared/protocol.js';

const MAX_ATTEMPTS = 5;
const POLL_MS = 2_000;
const REBROADCAST_AFTER_MS = 30_000;
const HOLD_AFTER_MS = 10 * 60_000;

export interface PayoutRequest {
  key: string;
  userId: string;
  amount: bigint;
  reason: PayoutReason;
  gameId?: string | null;
}

/** Record an accepted incoming transfer; each tx hash can be used once. */
export async function recordTransfer(
  client: pg.PoolClient,
  t: { txHash: string; userId: string; from: string; amount: bigint; purpose: 'buy_in' | 'side_bet' },
): Promise<void> {
  const res = await client.query(
    `insert into public.chain_transfers (tx_hash, user_id, from_address, amount, purpose)
     values ($1, $2, $3, $4, $5) on conflict do nothing`,
    [t.txHash, t.userId, t.from, t.amount, t.purpose],
  );
  if (res.rowCount === 0) throw new AppError('PAYMENT_INVALID', 'that transaction was already used');
}

/**
 * Idempotent: the same key is only ever paid once. Call inside a tx.
 * Never throws for a missing wallet — that payout is held for review so a
 * settlement can always commit.
 */
export async function enqueuePayouts(client: pg.PoolClient, payouts: readonly PayoutRequest[]): Promise<void> {
  if (payouts.some((p) => p.amount > 0n)) afterCommit(client, () => events.emit('payouts'));
  for (const p of payouts) {
    if (p.amount <= 0n) continue;
    const held = p.amount > env.MAX_AUTO_PAYOUT_USDC;
    await client.query(
      `insert into public.payouts (idempotency_key, user_id, to_address, amount, reason, game_id, status, last_error)
       select $1, u.privy_user_id, coalesce(u.wallet_address, ''), $3, $4, $5,
              case when u.wallet_address is null or $6 then 'held' else 'pending' end,
              case when u.wallet_address is null then 'no wallet on file'
                   when $6 then 'above MAX_AUTO_PAYOUT_USDC' end
         from public.app_users u
        where u.privy_user_id = $2
       on conflict (idempotency_key) do nothing`,
      [p.key, p.userId, p.amount, p.reason, p.gameId ?? null, held],
    );
  }
}

interface SentRow {
  id: string;
  user_id: string;
  amount: bigint;
  reason: PayoutReason;
  tx_hash: Hash;
  raw_tx: Hex;
  updated_at: Date;
}

async function sendNext(): Promise<boolean> {
  const row = await withTx(async (c) => {
    const res = await c.query<{ id: string; to_address: string; amount: bigint; attempts: number }>(
      `select id, to_address, amount, attempts from public.payouts
        where status = 'pending' and next_attempt_at <= now()
        order by next_attempt_at
        limit 1 for update skip locked`,
    );
    const p = res.rows[0];
    if (!p) return null;
    try {
      const { raw, hash } = await signUsdcTransfer(p.to_address, p.amount);
      await c.query(
        `update public.payouts
            set status = 'sent', tx_hash = $2, raw_tx = $3, attempts = attempts + 1, updated_at = now()
          where id = $1`,
        [p.id, hash, raw],
      );
      return { id: p.id, raw };
    } catch (err) {
      const attempts = p.attempts + 1;
      await c.query(
        `update public.payouts
            set status = $2, attempts = $3, last_error = $4, updated_at = now(),
                next_attempt_at = now() + ($5 || ' seconds')::interval
          where id = $1`,
        [p.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, String(err).slice(0, 500), 5 * 2 ** attempts],
      );
      log.error({ err, payoutId: p.id, attempts }, 'payout signing failed');
      return { id: p.id, raw: null };
    }
  });
  if (!row) return false;
  if (!row.raw) return true;
  try {
    await broadcast(row.raw);
    return true;
  } catch (err) {
    // Committed as 'sent' first; confirmSent rebroadcasts. Stop draining so the
    // next payout doesn't get signed with the same (still unused) nonce.
    log.warn({ err, payoutId: row.id }, 'broadcast failed, will retry');
    return false;
  }
}

async function confirmSent(): Promise<void> {
  const { rows } = await pool.query<SentRow>(
    `select id, user_id, amount, reason, tx_hash, raw_tx, updated_at
       from public.payouts where status = 'sent' order by updated_at limit 25`,
  );
  for (const p of rows) {
    const status = await transferStatus(p.tx_hash);
    if (status === 'success') {
      await pool.query(`update public.payouts set status = 'confirmed', updated_at = now() where id = $1`, [p.id]);
      events.emit('payout', p.user_id, { amount: p.amount.toString(), reason: p.reason, txHash: p.tx_hash });
      continue;
    }
    if (status === 'reverted') {
      await pool.query(
        `update public.payouts set status = 'failed', last_error = 'reverted', updated_at = now() where id = $1`,
        [p.id],
      );
      log.error({ payoutId: p.id, txHash: p.tx_hash }, 'payout reverted');
      continue;
    }
    const age = Date.now() - p.updated_at.getTime();
    if (age > HOLD_AFTER_MS) {
      await pool.query(
        `update public.payouts set status = 'held', last_error = 'not mined in time', updated_at = now() where id = $1`,
        [p.id],
      );
      log.error({ payoutId: p.id, txHash: p.tx_hash }, 'payout stuck, held for review');
    } else if (age > REBROADCAST_AFTER_MS) {
      await broadcast(p.raw_tx).catch(() => undefined);
    }
  }
}

/** ms until the worker has something to do; null = queue empty. */
async function msUntilWork(): Promise<number | null> {
  const res = await pool.query<{ next_pending: Date | null; has_sent: boolean }>(
    `select (select min(next_attempt_at) from public.payouts where status = 'pending') as next_pending,
            exists (select 1 from public.payouts where status = 'sent') as has_sent`,
  );
  const row = res.rows[0];
  if (row?.has_sent) return POLL_MS; // waiting on confirmations
  return row?.next_pending ? row.next_pending.getTime() - Date.now() : null;
}

// Event-driven like the scheduler: idle queue = no polling (Neon can sleep);
// every committed enqueue wakes it through the payouts event.
let timer: NodeJS.Timeout | null = null;
let busy = false;
let stopped = true;
let wakeAgain = false;

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
    while (await sendNext()) {
      /* drain the queue */
    }
    await confirmSent();
    delay = await msUntilWork();
  } catch (err) {
    log.error({ err }, 'payout worker tick failed');
    delay = POLL_MS;
  } finally {
    busy = false;
  }
  if (wakeAgain) {
    wakeAgain = false;
    delay = 0;
  }
  if (delay !== null && !stopped) timer = setTimeout(() => void work(), Math.max(50, Math.min(delay, 60_000)));
}

export function startPayoutWorker(): void {
  if (!stopped) return;
  stopped = false;
  events.on('payouts', () => void work());
  void work();
  log.info('payout worker started');
}

export function stopPayoutWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
