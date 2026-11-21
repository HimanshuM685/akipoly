/**
 * Pure game rules. No I/O — everything here is unit tested.
 *
 * Each round every alive player calls whether the next ball is higher or
 * lower than the current one, optionally backing the call with a USDC side
 * bet. Wrong call or no call = eliminated. Last player standing takes the pot.
 */
import { BALL_MAX, BALL_MIN, type Direction } from '../shared/protocol.js';

export type Outcome = 'higher' | 'lower' | 'push';
export type RoundResult = Outcome | 'void';

export interface PickInput {
  userId: string;
  direction: Direction;
  sideBet: bigint;
}

export interface Payout {
  userId: string;
  amount: bigint;
  reason: 'side_win' | 'side_refund' | 'pot' | 'split';
}

export function outcomeOf(prevBall: number, ball: number): Outcome {
  if (ball > prevBall) return 'higher';
  if (ball < prevBall) return 'lower';
  return 'push';
}

/** "higher" than 16 or "lower" than 0 can never win. */
export function isPickPossible(prevBall: number, direction: Direction): boolean {
  return direction === 'higher' ? prevBall < BALL_MAX : prevBall > BALL_MIN;
}

/**
 * Who is eliminated this round.
 * - push: only players who didn't call are out.
 * - if every alive player would be out but at least one of them called,
 *   the round is void and nobody is out (avoids a winnerless wipe-out).
 * - if nobody called at all, everyone is out (abandoned table).
 */
export function resolveRound(
  alive: readonly string[],
  picks: readonly PickInput[],
  prevBall: number,
  ball: number,
): { result: RoundResult; eliminated: string[] } {
  const outcome = outcomeOf(prevBall, ball);
  const byUser = new Map(picks.map((p) => [p.userId, p]));
  const out = alive.filter((u) => {
    const pick = byUser.get(u);
    if (!pick) return true;
    return outcome !== 'push' && pick.direction !== outcome;
  });
  const anyCalled = alive.some((u) => byUser.has(u));
  if (out.length === alive.length && alive.length > 0 && anyCalled) {
    return { result: 'void', eliminated: [] };
  }
  return { result: outcome, eliminated: out };
}

const applyFee = (amount: bigint, feeBps: number) => (amount * BigInt(feeBps)) / 10_000n;

/**
 * Pari-mutuel side bets: the losing side's stakes (minus fee) are shared by
 * the winning side pro rata. Push, void, or no counterparty = full refund.
 * Integer division dust stays in the treasury.
 */
export function settleSideBets(picks: readonly PickInput[], result: RoundResult, feeBps: number): Payout[] {
  const bets = picks.filter((p) => p.sideBet > 0n);
  const refundAll = () => bets.map((p) => ({ userId: p.userId, amount: p.sideBet, reason: 'side_refund' as const }));
  if (result === 'push' || result === 'void') return refundAll();

  const winners = bets.filter((p) => p.direction === result);
  const losers = bets.filter((p) => p.direction !== result);
  if (winners.length === 0 || losers.length === 0) return refundAll();

  const winnerPool = winners.reduce((s, p) => s + p.sideBet, 0n);
  const loserPool = losers.reduce((s, p) => s + p.sideBet, 0n);
  const distributable = loserPool - applyFee(loserPool, feeBps);
  return winners.map((p) => ({
    userId: p.userId,
    amount: p.sideBet + (distributable * p.sideBet) / winnerPool,
    reason: 'side_win' as const,
  }));
}

/**
 * Pot settlement at game end.
 * - one survivor: winner takes pot minus fee.
 * - several survivors (round cap hit): pot minus fee split evenly.
 * - nobody left (abandoned table): pot split evenly among the last round's
 *   players, no fee.
 */
export function settlePot(
  pot: bigint,
  feeBps: number,
  survivors: readonly string[],
  lastRoundPlayers: readonly string[],
): { fee: bigint; payouts: Payout[] } {
  if (survivors.length === 1) {
    const fee = applyFee(pot, feeBps);
    return { fee, payouts: [{ userId: survivors[0]!, amount: pot - fee, reason: 'pot' }] };
  }
  const sharers = survivors.length > 0 ? survivors : lastRoundPlayers;
  if (sharers.length === 0) return { fee: 0n, payouts: [] };
  const fee = survivors.length > 0 ? applyFee(pot, feeBps) : 0n;
  const share = (pot - fee) / BigInt(sharers.length);
  return {
    fee,
    payouts: share > 0n ? sharers.map((userId) => ({ userId, amount: share, reason: 'split' as const })) : [],
  };
}

/** Everyone eliminated in the same round shares the next placement. */
export function placementFor(aliveAfterCount: number): number {
  return aliveAfterCount + 1;
}

export function isGameOver(aliveAfterCount: number, roundNumber: number, maxRounds: number): boolean {
  return aliveAfterCount <= 1 || roundNumber >= maxRounds;
}
