/**
 * Leaderboard: every signed-up wallet ranked by the USDC it holds on Arc.
 * Balances are read on-chain in one multicall pass and cached briefly, so a
 * burst of viewers costs one chain read, not one each.
 */
import { getAddress, isAddress, type Address } from 'viem';
import { pool } from '../db/pool.js';
import { usdcBalances } from '../chain/usdc.js';
import type { LeaderboardEntry, LeaderboardView } from '../shared/protocol.js';

const CACHE_MS = 30_000;
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
  return { rows, byWallet: new Map(rows.map((r) => [r.walletAddress, r])), readAt: Date.now() };
}

async function snapshot(): Promise<Snapshot> {
  if (cached && Date.now() - cached.readAt < CACHE_MS) return cached;
  inFlight ??= readSnapshot()
    .then((s) => (cached = s))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
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
