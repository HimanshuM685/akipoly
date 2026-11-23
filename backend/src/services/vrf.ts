/**
 * VRF draws: one job per round, run by the single treasury worker.
 *
 *   pending ──sign+broadcast requestBall──▶ requested
 *   requested ──receipt, wait confirmations, prove, sign+broadcast fulfill──▶ fulfilling
 *   fulfilling ──receipt with BallDrawn──▶ done   (round: drawing → rolling)
 *   any ──reverted / stuck far too long──▶ held  (needs a human; the round waits)
 *
 * Each pass moves every open job at most one step without blocking on receipts,
 * so many tables can be drawing at once. A round is never requested a second
 * time: there is no cancel and no re-request. A withheld or stuck draw stays
 * visible (held job, round in 'drawing') and is never silently replaced.
 */
import type pg from 'pg';
import { getAddress, keccak256, type Address, type Hash, type Hex } from 'viem';
import { env } from '../config/env.js';
import { afterCommit, pool, withTx } from '../db/pool.js';
import { broadcast, publicClient } from '../chain/usdc.js';
import {
  coordinatorAbi,
  coordinatorAddress,
  parseFulfillment,
  parseRequest,
  readDraw,
  readStoredBlockhash,
  signFulfill,
  signRequestBall,
  signStoreBlockhash,
  type VrfRequest,
} from '../chain/vrf.js';
import { events, lobbyChanged } from '../events.js';
import { log } from '../log.js';

const ACTIVE_POLL_MS = 250;
const REBROADCAST_AFTER_MS = 15_000;
const HOLD_AFTER_MS = 10 * 60_000;
/** Save the request block's hash to the BlockhashStore once it is this old (window is 256). */
const STORE_BLOCKHASH_AFTER_BLOCKS = 200n;

type JobStatus = 'pending' | 'requested' | 'fulfilling' | 'done' | 'held';

interface JobRow {
  round_id: string;
  game_id: string;
  lobby_id: string;
  round_number: number;
  status: JobStatus;
  request_tx: Hash | null;
  request_raw: Hex | null;
  request_id: string | null;
  pre_seed: string | null;
  request_block: bigint | null;
  min_confirmations: number | null;
  callback_gas_limit: number | null;
  num_words: number | null;
  fulfill_tx: Hash | null;
  fulfill_raw: Hex | null;
  updated_at: Date;
}

/** Thrown when a signed tx could not be broadcast: stop this pass so no later tx reuses its nonce. */
class BroadcastFailed extends Error {}
/** The signed tx's nonce was used by a different transaction: this raw tx can never land. */
class NonceConsumed extends Error {}

/** Last rebroadcast per job, so a stuck tx is resent every REBROADCAST_AFTER_MS, not every pass. */
const lastRebroadcast = new Map<string, number>();

/** Queue the draw for a round that just entered 'drawing'. Call inside the same tx. */
export async function enqueueVrfDraw(c: pg.PoolClient, roundId: string, gameId: string, roundNumber: number) {
  await c.query(
    `insert into public.vrf_jobs (round_id, game_id, round_number) values ($1, $2, $3) on conflict do nothing`,
    [roundId, gameId, roundNumber],
  );
  afterCommit(c, () => events.emit('vrf'));
}

async function send(raw: Hex): Promise<void> {
  try {
    await broadcast(raw);
  } catch (err) {
    const msg = String(err).toLowerCase();
    // Already in the pool: fine.
    if (msg.includes('already known') || msg.includes('already imported')) return;
    // Nonce used: fine only if it was used by THIS tx; otherwise it can never land.
    if (msg.includes('nonce too low')) {
      const hash = keccak256(raw);
      const seen = await publicClient.getTransaction({ hash }).catch(() => null);
      if (seen) return;
      throw new NonceConsumed(`nonce of ${hash} was used by another transaction`);
    }
    throw new BroadcastFailed(String(err));
  }
}

async function receiptOf(hash: Hash) {
  try {
    return await publicClient.getTransactionReceipt({ hash });
  } catch {
    return null; // not mined (or not seen) yet
  }
}

async function hold(job: JobRow, reason: string): Promise<void> {
  await pool.query(
    `update public.vrf_jobs set status = 'held', last_error = $2, updated_at = now() where round_id = $1`,
    [job.round_id, reason.slice(0, 500)],
  );
  lastRebroadcast.delete(job.round_id);
  log.error({ roundId: job.round_id, gameId: job.game_id, round: job.round_number, reason }, 'VRF draw held for review');
}

/** Rebroadcast a tx that hasn't landed; hold the job once it is hopeless. Returns true if held. */
async function nudge(job: JobRow, raw: Hex): Promise<boolean> {
  const age = Date.now() - job.updated_at.getTime();
  if (age > HOLD_AFTER_MS) {
    await hold(job, `${job.status} tx not mined in ${HOLD_AFTER_MS / 60_000} min`);
    return true;
  }
  const now = Date.now();
  if (age > REBROADCAST_AFTER_MS && now - (lastRebroadcast.get(job.round_id) ?? 0) > REBROADCAST_AFTER_MS) {
    lastRebroadcast.set(job.round_id, now);
    await send(raw);
  }
  return false;
}

function requestFromRow(job: JobRow): VrfRequest {
  return {
    requestId: BigInt(job.request_id!),
    preSeed: BigInt(job.pre_seed!),
    blockNumber: job.request_block!,
    minConfirmations: job.min_confirmations!,
    callbackGasLimit: job.callback_gas_limit!,
    numWords: job.num_words!,
    sender: getAddress(env.VRF_ROUNDS_ADDRESS),
  };
}

let blockhashStore: Address | null = null;
async function storeAddress(): Promise<Address> {
  blockhashStore ??= await publicClient.readContract({
    address: coordinatorAddress,
    abi: coordinatorAbi,
    functionName: 'BLOCKHASH_STORE',
  });
  return blockhashStore;
}
const storedFor = new Set<string>();

async function step(job: JobRow, head: bigint): Promise<void> {
  if (job.status === 'pending') {
    const { raw, hash } = await signRequestBall(job.game_id, job.round_number);
    await pool.query(
      `update public.vrf_jobs set status = 'requested', request_tx = $2, request_raw = $3,
              attempts = attempts + 1, updated_at = now()
        where round_id = $1 and status = 'pending'`,
      [job.round_id, hash, raw],
    );
    await send(raw);
    log.info({ gameId: job.game_id, round: job.round_number, tx: hash }, 'VRF requested');
    return;
  }

  if (job.status === 'requested') {
    if (!job.request_id) {
      const receipt = await receiptOf(job.request_tx!);
      if (!receipt) {
        await nudge(job, job.request_raw!);
        return;
      }
      if (receipt.status !== 'success') return hold(job, `requestBall reverted (${job.request_tx})`);
      const req = parseRequest(receipt);
      if (!req) return hold(job, `no RandomWordsRequested in ${job.request_tx}`);
      await pool.query(
        `update public.vrf_jobs
            set request_id = $2, pre_seed = $3, request_block = $4, min_confirmations = $5,
                callback_gas_limit = $6, num_words = $7, updated_at = now()
          where round_id = $1`,
        [job.round_id, req.requestId.toString(), req.preSeed.toString(), req.blockNumber, req.minConfirmations, req.callbackGasLimit, req.numWords],
      );
      Object.assign(job, {
        request_id: req.requestId.toString(),
        pre_seed: req.preSeed.toString(),
        request_block: req.blockNumber,
        min_confirmations: req.minConfirmations,
        callback_gas_limit: req.callbackGasLimit,
        num_words: req.numWords,
      });
    }

    const req = requestFromRow(job);
    // Chainlink nodes wait for the request's confirmations; blockhash(n) is only
    // available from block n+1, and a deeper wait guards against reorgs.
    const confirmations = BigInt(Math.max(1, req.minConfirmations));
    if (head < req.blockNumber + confirmations) return;

    const age = head - req.blockNumber;
    if (age >= 256n) {
      // Past the BLOCKHASH window: only works if the hash made it into the store.
      const stored = await readStoredBlockhash(await storeAddress(), req.blockNumber);
      if (!stored) return hold(job, `request block ${req.blockNumber} hash expired and is not in the BlockhashStore`);
    } else if (age >= STORE_BLOCKHASH_AFTER_BLOCKS && !storedFor.has(job.round_id)) {
      const { raw } = await signStoreBlockhash(await storeAddress(), req.blockNumber);
      await send(raw);
      storedFor.add(job.round_id);
    }

    const { raw, hash, output } = await signFulfill(req);
    await pool.query(
      `update public.vrf_jobs set status = 'fulfilling', fulfill_tx = $2, fulfill_raw = $3, updated_at = now()
        where round_id = $1 and status = 'requested'`,
      [job.round_id, hash, raw],
    );
    await send(raw);
    log.info({ gameId: job.game_id, round: job.round_number, tx: hash, output: output.toString() }, 'VRF fulfilled');
    return;
  }

  if (job.status === 'fulfilling') {
    const requestId = BigInt(job.request_id!);
    const receipt = await receiptOf(job.fulfill_tx!);
    if (!receipt) {
      await nudge(job, job.fulfill_raw!);
      return;
    }
    if (receipt.status === 'success') {
      const f = parseFulfillment(receipt, requestId);
      if (!f) return hold(job, `no RandomWordsFulfilled in ${job.fulfill_tx}`);
      if (!f.success || f.ball === null || f.randomWord === null) {
        return hold(job, `consumer callback failed in ${job.fulfill_tx} (raise callbackGasLimit)`);
      }
      return finish(job, f.ball, f.randomWord, job.fulfill_tx!);
    }
    // Reverted. Anyone may fulfill, so someone else may have beaten us to it.
    const draw = await readDraw(job.game_id, job.round_number);
    if (draw.fulfilled && draw.requestId === requestId) return finish(job, draw.ball, draw.randomWord, null);
    return hold(job, `fulfillRandomWords reverted (${job.fulfill_tx})`);
  }
}

/** Record the on-chain ball and start the roll. */
async function finish(job: JobRow, ball: number, randomWord: bigint, fulfillTx: Hash | null): Promise<void> {
  await withTx(async (c) => {
    await c.query(
      `update public.rounds
          set phase = 'rolling', ball = $2, phase_ends_at = now() + $3::interval,
              vrf_request_id = $4, vrf_request_tx = $5, vrf_request_block = $6,
              vrf_fulfill_tx = $7, vrf_random_word = $8
        where id = $1 and phase = 'drawing'`,
      [
        job.round_id,
        ball,
        `${env.ROLLING_MS} milliseconds`,
        job.request_id,
        job.request_tx,
        job.request_block,
        fulfillTx,
        randomWord.toString(),
      ],
    );
    await c.query(`update public.vrf_jobs set status = 'done', updated_at = now() where round_id = $1`, [job.round_id]);
    afterCommit(c, () => lobbyChanged(job.lobby_id)); // also wakes the scheduler
  });
  lastRebroadcast.delete(job.round_id);
  log.info({ gameId: job.game_id, round: job.round_number, ball }, 'ball drawn on-chain');
}

export interface VrfPass {
  /** ms until the worker should look again; null = nothing open. */
  delay: number | null;
  /**
   * A signed tx failed to broadcast and still owns the next nonce: the caller
   * must not sign anything else (payouts included) until it is rebroadcast.
   */
  blocked: boolean;
}

/** Advance every open VRF job by one step. */
export async function runVrfJobs(): Promise<VrfPass> {
  const { rows } = await pool.query<JobRow>(
    `select j.round_id, j.game_id, g.lobby_id, j.round_number, j.status, j.request_tx, j.request_raw,
            j.request_id, j.pre_seed, j.request_block, j.min_confirmations, j.callback_gas_limit,
            j.num_words, j.fulfill_tx, j.fulfill_raw, j.updated_at
       from public.vrf_jobs j join public.games g on g.id = j.game_id
      where j.status in ('pending', 'requested', 'fulfilling') and j.next_attempt_at <= now()
      order by j.created_at
      limit 50`,
  );
  if (rows.length === 0) {
    const next = await pool.query<{ at: Date | null }>(
      `select min(next_attempt_at) as at from public.vrf_jobs where status in ('pending', 'requested', 'fulfilling')`,
    );
    const at = next.rows[0]?.at;
    return { delay: at ? Math.max(0, at.getTime() - Date.now()) : null, blocked: false };
  }

  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  for (const job of rows) {
    try {
      await step(job, head);
    } catch (err) {
      if (err instanceof BroadcastFailed) {
        log.warn({ err, roundId: job.round_id }, 'VRF broadcast failed, will retry');
        return { delay: ACTIVE_POLL_MS * 4, blocked: true };
      }
      if (err instanceof NonceConsumed) {
        await hold(job, err.message);
        continue;
      }
      await pool.query(
        `update public.vrf_jobs
            set attempts = attempts + 1, last_error = $2, updated_at = updated_at,
                next_attempt_at = now() + interval '2 seconds'
          where round_id = $1`,
        [job.round_id, String(err).slice(0, 500)],
      );
      log.error({ err, roundId: job.round_id, status: job.status }, 'VRF step failed');
    }
  }
  return { delay: ACTIVE_POLL_MS, blocked: false };
}
