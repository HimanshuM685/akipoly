/**
 * Browser-side check of a revealed round (mirrors backend/src/domain/fairness.ts):
 *   sha256(seed) === seedHash
 *   ball === uint64(HMAC-SHA256(seed, `${gameId}:${round}`)[0..8]) mod 17
 */
import { BALL_MAX, BALL_MIN } from '@akipoly/shared/constants';

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function deriveBall(seed: string, gameId: string, roundNumber: number): Promise<number> {
  const key = await crypto.subtle.importKey('raw', enc.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, enc.encode(`${gameId}:${roundNumber}`));
  const n = new DataView(digest).getBigUint64(0, false);
  return BALL_MIN + Number(n % BigInt(BALL_MAX - BALL_MIN + 1));
}

export async function verifyRound(
  seed: string,
  seedHash: string,
  gameId: string,
  roundNumber: number,
  ball: number,
): Promise<{ hashOk: boolean; ballOk: boolean }> {
  const [hash, derived] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(seed)).then(hex),
    deriveBall(seed, gameId, roundNumber),
  ]);
  return { hashOk: hash === seedHash, ballOk: derived === ball };
}
