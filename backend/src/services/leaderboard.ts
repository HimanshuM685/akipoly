/**
 * Leaderboard: every signed-up wallet ranked by the USDC it holds on Arc.
 * Balances are read on-chain in one multicall pass and cached briefly, so a
 * burst of viewers costs one chain read, not one each.
 */
import { getAddress, isAddress, type Address } from 'viem';
import { pool } from '../db/pool.js';
import { usdcBalances } from '../chain/usdc.js';
import { AppError } from '../errors.js';
import { log } from '../log.js';
import type { LeaderboardEntry, LeaderboardView } from '../shared/protocol.js';

const CACHE_MS = 30_000;
/**
 * Answer within this long even if the chain read hasn't finished (the client
 * gives up at 60 s). The read keeps going and fills the cache for the retry.
 */
const REPLY_WITHIN_MS = 20_000;
const TOP = 100;

interface Ranked {
  rank: number;
  walletAddress: Address;
  balance: bigint;
}

interface Snapshot {
  rows: Ranked[];
  byWallet: Map<Address, Ranked>;
  readAt: number;
}

let cached: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

async function readSnapshot(): Promise<Snapshot> {
  const startedAt = Date.now();
  const res = await pool.query<{ wallet_address: string }>(
    'select distinct wallet_address from public.app_users where wallet_address is not null',
  );
  const wallets = [
    ...new Set(res.rows.map((r) => r.wallet_address).filter((a) => isAddress(a)).map((a) => getAddress(a))),
  ];
  const balances = await usdcBalances(wallets);

  const sorted = wallets
    .map((walletAddress, i) => ({ walletAddress, balance: balances[i] ?? 0n }))
    .sort((a, b) =>
      a.balance === b.balance ? a.walletAddress.localeCompare(b.walletAddress) : a.balance > b.balance ? -1 : 1,
    );

  const rows: Ranked[] = [];
  sorted.forEach((r, i) => {
    const prev = rows[i - 1];
    rows.push({ ...r, rank: prev && prev.balance === r.balance ? prev.rank : i + 1 });
  });
  log.info({ wallets: wallets.length, ms: Date.now() - startedAt }, 'leaderboard balances read');
  return { rows, byWallet: new Map(rows.map((r) => [r.walletAddress, r])), readAt: Date.now() };
}

async function snapshot(): Promise<Snapshot> {
  if (cached && Date.now() - cached.readAt < CACHE_MS) return cached;
  if (!inFlight) {
    const startedAt = Date.now();
    inFlight = readSnapshot()
      .then((s) => (cached = s))
      .catch((err: unknown) => {
        log.warn({ err, ms: Date.now() - startedAt }, 'leaderboard balances read failed');
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
    // Nobody may be waiting on it (stale cache served, or deadline passed).
    inFlight.catch(() => undefined);
  }
  // A slightly old board beats a spinner: refresh in the background.
  if (cached) return cached;
  return withinDeadline(inFlight);
}

function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError('INTERNAL', 'balances are still loading from Arc, try again in a moment')),
      REPLY_WITHIN_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export async function leaderboardFor(viewerWallet: string | null): Promise<LeaderboardView> {
  const snap = await snapshot();
  const me = viewerWallet && isAddress(viewerWallet) ? getAddress(viewerWallet) : null;
  const view = (r: Ranked): LeaderboardEntry => ({
    rank: r.rank,
    walletAddress: r.walletAddress,
    balance: r.balance.toString(),
    isMe: r.walletAddress === me,
  });

  const entries = snap.rows.slice(0, TOP).map(view);
  const mine = me ? snap.byWallet.get(me) : undefined;
  return {
    entries,
    me: mine && !entries.some((e) => e.isMe) ? view(mine) : null,
    total: snap.rows.length,
    updatedAt: new Date(snap.readAt).toISOString(),
  };
}
