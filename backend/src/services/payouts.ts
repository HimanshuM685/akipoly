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
import { pool, withTx } from '../db/pool.js';
import { broadcast, signUsdcTransfer, transferStatus } from '../chain/usdc.js';
import { events } from '../events.js';
import { log } from '../log.js';
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

/** Idempotent: the same key is only ever paid once. Call inside a tx. */
export async function enqueuePayouts(client: pg.PoolClient, payouts: readonly PayoutRequest[]): Promise<void> {
  for (const p of payouts) {
    if (p.amount <= 0n) continue;
    const res = await client.query(
      `insert into public.payouts (idempotency_key, user_id, to_address, amount, reason, game_id, status)
       select $1, u.privy_user_id, u.wallet_address, $3, $4, $5, $6
         from public.app_users u
        where u.privy_user_id = $2 and u.wallet_address is not null
       on conflict (idempotency_key) do nothing`,
      [p.key, p.userId, p.amount, p.reason, p.gameId ?? null, p.amount > env.MAX_AUTO_PAYOUT_USDC ? 'held' : 'pending'],
    );
    if (res.rowCount === 0) {
      const exists = await client.query('select 1 from public.payouts where idempotency_key = $1', [p.key]);
      if (exists.rowCount === 0) throw new Error(`payout ${p.key}: user ${p.userId} has no wallet`);
    }
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

let timer: NodeJS.Timeout | null = null;
let busy = false;

export function startPayoutWorker(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      while (await sendNext()) {
        /* drain the queue */
      }
      await confirmSent();
    } catch (err) {
      log.error({ err }, 'payout worker tick failed');
    } finally {
      busy = false;
    }
  }, POLL_MS);
  log.info('payout worker started');
}

export function stopPayoutWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
