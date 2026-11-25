/**
 * Leaderboard end-to-end check: drives `leaderboard.get` through the real
 * router against a THROWAWAY Postgres, with live USDC balances from Arc
 * testnet. It seeds `app_users` (deleting what is there), so it refuses any
 * database that isn't local.
 *
 *   docker run -d --name lb-db -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/postgres npm run migrate:dev
 *   DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/postgres npm run check:leaderboard
 *   docker rm -f lb-db
 *
 * Needs network access to the Arc testnet RPC. Sends no transactions.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// ---- safety: never run against a real database ---------------------------
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('set DATABASE_URL to a throwaway Postgres');
const host = new URL(dbUrl).hostname;
if (!['localhost', '127.0.0.1', 'db', 'postgres'].includes(host)) {
  console.error(`refusing to run against ${host}: this script deletes app_users. Use a throwaway local DB.`);
  process.exit(1);
}

// ---- config (must be set before the server's config loads) ----------------
// The holders below are on testnet, and nothing here should touch funds.
process.env.ARC_NETWORK = 'testnet';
process.env.PAYOUT_WORKER = 'false';
process.env.PRIVY_APP_ID ??= 'leaderboard-check';
process.env.TREASURY_PRIVATE_KEY = `0x${randomBytes(32).toString('hex')}`;
process.env.VRF_ORACLE_KEY = `0x${randomBytes(32).toString('hex')}`;
process.env.VRF_ROUNDS_ADDRESS ??= `0x${'11'.repeat(20)}`;
process.env.VRF_COORDINATOR_ADDRESS ??= `0x${'22'.repeat(20)}`;
process.env.LOG_LEVEL ??= 'warn';

const { getAddress } = await import('viem');
const { WebSocket } = await import('ws');
const { pool } = await import('../src/db/pool.js');
const { route } = await import('../src/ws/router.js');
const { Session } = await import('../src/ws/hub.js');

// Arc testnet addresses that hold USDC (RICH > MC3 > 0).
const RICH = '0x0000000000000000000000000000000000000001';
const MC3 = '0xcA11bde05977b3631167028862bE2a173976CA11'; // Multicall3
const LAST = '0xffffffffffffffffffffffffffffffffffffff00'; // sorts last among zero balances
// Random wallets with no USDC; never starting with ff so LAST stays last.
const randomWallet = () => `0x0a${randomBytes(19).toString('hex')}`;

type Reply = { type: string; reqId?: string; code?: string; data?: any };

await pool.query('delete from public.app_users');
const users: [string, string | null][] = [
  ['did:me', RICH.toLowerCase()], // stored lowercase: must still match the viewer
  ['did:mc3', MC3],
  ['did:dup', RICH], // same wallet, different case: counted once
  ['did:bad', 'not-an-address'], // skipped
  ['did:nowallet', null], // skipped
  ['did:last', LAST],
];
for (let i = 0; i < 120; i++) users.push([`did:z${i}`, randomWallet()]);
for (const [id, wallet] of users) {
  await pool.query('insert into public.app_users (privy_user_id, wallet_address) values ($1, $2)', [id, wallet]);
}

/** A session on a fake socket that records what the server sends. */
function session(userId: string | null) {
  const sent: Reply[] = [];
  const socket = { readyState: WebSocket.OPEN, bufferedAmount: 0, send: (d: string) => sent.push(JSON.parse(d)) };
  const s = new Session(socket as unknown as InstanceType<typeof WebSocket>);
  s.userId = userId;
  return { s, sent };
}

async function ask(userId: string | null, reqId = 'r1'): Promise<Reply> {
  const { s, sent } = session(userId);
  await route(s, JSON.stringify({ type: 'leaderboard.get', reqId }));
  assert.equal(sent.length, 1, 'exactly one reply');
  return sent[0]!;
}

// 1. Not signed in → rejected.
const anon = await ask(null);
assert.equal(anon.type, 'error');
assert.equal(anon.code, 'UNAUTHENTICATED');
console.log('✓ unauthenticated request rejected');

// 2. Signed-in viewer at the top.
const t0 = Date.now();
const top = await ask('did:me');
const ms = Date.now() - t0;
assert.equal(top.type, 'ack', JSON.stringify(top));
assert.equal(top.reqId, 'r1');
const v = top.data;
const expectedTotal = 3 + 120; // RICH, MC3, LAST + randoms (dup, bad and null dropped)
assert.equal(v.total, expectedTotal);
assert.equal(v.entries.length, 100, 'top 100 only');
assert.equal(v.entries[0].walletAddress, getAddress(RICH));
assert.equal(v.entries[0].rank, 1);
assert.equal(v.entries[0].isMe, true, 'viewer matched despite lowercase in the DB');
assert.equal(v.entries[1].walletAddress, getAddress(MC3));
assert.equal(v.entries[1].rank, 2);
assert.ok(BigInt(v.entries[0].balance) > BigInt(v.entries[1].balance), 'highest balance first');
assert.ok(BigInt(v.entries[1].balance) > 0n);
assert.ok(
  v.entries.slice(2).every((e: any) => e.balance === '0' && e.rank === 3),
  'equal balances share a rank',
);
assert.equal(v.me, null, 'viewer is already in entries');
assert.equal(new Set(v.entries.map((e: any) => e.walletAddress)).size, 100, 'no duplicate wallets');
assert.ok(!Number.isNaN(Date.parse(v.updatedAt)));
console.log(`✓ ranking correct (${v.total} wallets, ties share a rank, live chain read in ${ms} ms)`);

// 3. Viewer outside the top 100 → own row returned separately.
const low = (await ask('did:last')).data;
assert.equal(low.entries.some((e: any) => e.isMe), false);
assert.ok(low.me, 'own row present');
assert.equal(low.me.walletAddress, getAddress(LAST));
assert.equal(low.me.isMe, true);
assert.equal(low.me.rank, 3);
console.log('✓ viewer outside the top 100 gets their own row');

// 4. Viewer without a wallet → board still loads.
const noWallet = (await ask('did:nowallet')).data;
assert.equal(noWallet.me, null);
assert.equal(noWallet.entries.some((e: any) => e.isMe), false);
console.log('✓ viewer with no wallet still sees the board');

// 5. Cached snapshot shared by concurrent viewers; "isMe" stays per viewer.
const [a, b, c] = await Promise.all([ask('did:mc3', 'a'), ask('did:me', 'b'), ask('did:z1', 'c')]);
for (const r of [a, b, c]) assert.equal(r.data.updatedAt, v.updatedAt, 'same cached snapshot');
assert.equal(a.data.entries[1].isMe, true);
assert.equal(b.data.entries[1].isMe, false);
console.log('✓ cached snapshot reused, "isMe" still per viewer');

// 6. Malformed requests → BAD_REQUEST, not a crash.
{
  const { s, sent } = session('did:me');
  await route(s, '{not json');
  await route(s, JSON.stringify({ type: 'leaderboard.get', reqId: 'x'.repeat(65) }));
  assert.equal(sent[0]?.code, 'BAD_REQUEST');
  assert.equal(sent[1]?.code, 'BAD_REQUEST');
  console.log('✓ malformed requests → BAD_REQUEST');
}

await pool.query('delete from public.app_users');
await pool.end();
console.log('\nall leaderboard checks passed');
