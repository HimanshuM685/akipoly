// The browser verifier (src/lib/fairness.ts) must agree with the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveBall, newSeed } from '../src/domain/fairness.ts';
import { verifyRound } from '../../frontend/src/lib/fairness.ts';

test('client verifier accepts server rounds and rejects tampering', async () => {
  for (let round = 0; round < 25; round++) {
    const { seed, seedHash } = newSeed();
    const ball = deriveBall(seed, 'game-1', round);
    assert.deepEqual(await verifyRound(seed, seedHash, 'game-1', round, ball), { hashOk: true, ballOk: true });
    assert.equal((await verifyRound(seed, seedHash, 'game-1', round, (ball + 1) % 17)).ballOk, false);
    assert.equal((await verifyRound(seed + '0', seedHash, 'game-1', round, ball)).hashOk, false);
  }
});
