import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGameOver,
  isPickPossible,
  outcomeOf,
  resolveRound,
  settlePot,
  settleSideBets,
  type PickInput,
} from '../src/domain/rules.ts';
import { deriveBall, hashSeed, newSeed } from '../src/domain/fairness.ts';

const pick = (userId: string, direction: 'higher' | 'lower', sideBet = 0n): PickInput => ({
  userId,
  direction,
  sideBet,
});

test('outcomeOf', () => {
  assert.equal(outcomeOf(5, 9), 'higher');
  assert.equal(outcomeOf(5, 2), 'lower');
  assert.equal(outcomeOf(5, 5), 'push');
});

test('impossible picks at the edges', () => {
  assert.equal(isPickPossible(16, 'higher'), false);
  assert.equal(isPickPossible(0, 'lower'), false);
  assert.equal(isPickPossible(8, 'higher'), true);
});

test('wrong call and no call are eliminated', () => {
  const r = resolveRound(['a', 'b', 'c'], [pick('a', 'higher'), pick('b', 'lower')], 5, 9);
  assert.equal(r.result, 'higher');
  assert.deepEqual(r.eliminated.sort(), ['b', 'c']);
});

test('push eliminates only non-callers', () => {
  const r = resolveRound(['a', 'b', 'c'], [pick('a', 'higher'), pick('b', 'lower')], 5, 5);
  assert.equal(r.result, 'push');
  assert.deepEqual(r.eliminated, ['c']);
});

test('everyone wrong but someone called = void round', () => {
  const r = resolveRound(['a', 'b'], [pick('a', 'lower')], 5, 9);
  assert.deepEqual(r, { result: 'void', eliminated: [] });
});

test('nobody called = everyone out', () => {
  const r = resolveRound(['a', 'b'], [], 5, 9);
  assert.equal(r.result, 'higher');
  assert.deepEqual(r.eliminated, ['a', 'b']);
});

test('side bets: pari-mutuel with fee, dust kept', () => {
  const picks = [pick('a', 'higher', 1_000_000n), pick('b', 'higher', 2_000_000n), pick('c', 'lower', 1_000_001n)];
  const out = settleSideBets(picks, 'higher', 500); // 5% fee
  // loser pool 1_000_001, fee 50_000, distributable 950_001
  assert.deepEqual(out, [
    { userId: 'a', amount: 1_000_000n + 316_667n, reason: 'side_win' },
    { userId: 'b', amount: 2_000_000n + 633_334n, reason: 'side_win' },
  ]);
  const paid = out.reduce((s, p) => s + p.amount, 0n);
  assert.ok(paid <= 4_000_001n);
});

test('side bets refunded on push, void, or one-sided book', () => {
  const picks = [pick('a', 'higher', 5n), pick('b', 'lower', 7n)];
  for (const result of ['push', 'void'] as const) {
    assert.deepEqual(
      settleSideBets(picks, result, 0).map((p) => [p.userId, p.amount, p.reason]),
      [['a', 5n, 'side_refund'], ['b', 7n, 'side_refund']],
    );
  }
  const oneSided = settleSideBets([pick('a', 'higher', 5n)], 'higher', 0);
  assert.deepEqual(oneSided, [{ userId: 'a', amount: 5n, reason: 'side_refund' }]);
});

test('pot: single winner pays fee', () => {
  assert.deepEqual(settlePot(10_000_000n, 250, ['w'], ['w', 'x']), {
    fee: 250_000n,
    payouts: [{ userId: 'w', amount: 9_750_000n, reason: 'pot' }],
  });
});

test('pot: abandoned table splits without fee', () => {
  const r = settlePot(10n, 1000, [], ['a', 'b', 'c']);
  assert.equal(r.fee, 0n);
  assert.deepEqual(r.payouts.map((p) => p.amount), [3n, 3n, 3n]);
});

test('game over', () => {
  assert.equal(isGameOver(1, 3, 50), true);
  assert.equal(isGameOver(3, 50, 50), true);
  assert.equal(isGameOver(2, 3, 50), false);
});

test('fairness: deterministic, in range, verifiable', () => {
  const { seed, seedHash } = newSeed();
  assert.equal(hashSeed(seed), seedHash);
  const a = deriveBall(seed, 'g', 3);
  assert.equal(a, deriveBall(seed, 'g', 3));
  for (let i = 0; i < 500; i++) {
    const b = deriveBall(seed, 'g', i);
    assert.ok(b >= 0 && b <= 16);
  }
});
