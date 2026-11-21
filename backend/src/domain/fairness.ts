/**
 * Provably fair ball. Before bets close the server publishes sha256(seed);
 * after the round it reveals the seed. Anyone can recompute:
 *   ball = uint64(HMAC-SHA256(seed, `${gameId}:${round}`)[0..8]) mod 17
 * (64-bit mod 17 bias is ~1e-18, negligible.)
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { BALL_MAX, BALL_MIN } from '../shared/protocol.js';

const RANGE = BigInt(BALL_MAX - BALL_MIN + 1);

export function hashSeed(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function newSeed(): { seed: string; seedHash: string } {
  const seed = randomBytes(32).toString('hex');
  return { seed, seedHash: hashSeed(seed) };
}

export function deriveBall(seed: string, gameId: string, roundNumber: number): number {
  const digest = createHmac('sha256', seed).update(`${gameId}:${roundNumber}`).digest();
  return BALL_MIN + Number(digest.readBigUInt64BE(0) % RANGE);
}
