import { useState } from 'react';
import { BALL_MAX, BALL_MIN } from '../../../backend/src/shared/constants';
import type { Direction, GameView } from '../../../backend/src/shared/protocol';
import { useGameSocket } from './GameSocket';
import { usePayUsdc } from './usePayUsdc';
import { formatUsdc, parseUsdc } from '../../lib/arc';

interface Props {
  game: GameView;
}

/** Call higher/lower for the current round, optionally backed by a USDC side bet. */
export default function PickPanel({ game }: Props) {
  const { session, request, paidRequest, pendingPayments, status } = useGameSocket();
  const pay = usePayUsdc();
  const [direction, setDirection] = useState<Direction | null>(null);
  const [sideBet, setSideBet] = useState('');
  const [step, setStep] = useState<'idle' | 'paying' | 'sending'>('idle');
  const [error, setError] = useState<string | null>(null);

  const round = game.round!;
  const callPending = pendingPayments.some(
    (p) => p.type === 'game.pick' && p.gameId === game.id && p.roundNumber === round.number,
  );
  const prev = round.prevBall ?? 8;
  const sideUnits = sideBet.trim() ? parseUsdc(sideBet) : 0n;
  const maxSide = session ? BigInt(session.limits.maxSideBet) : 0n;
  const sideError =
    sideUnits === null ? 'enter a USDC amount' : sideUnits > maxSide ? `max ${formatUsdc(maxSide)} usdc` : null;

  const lockIn = async () => {
    if (!direction || !session || sideError || sideUnits === null) return;
    setError(null);
    try {
      const pick = { type: 'game.pick' as const, gameId: game.id, roundNumber: round.number, direction };
      if (sideUnits > 0n) {
        setStep('paying');
        await paidRequest(
          (onSent) =>
            pay(session.treasury, sideUnits, (hash) => {
              onSent(hash);
              setStep('sending');
            }),
          (txHash) => ({ ...pick, sideBet: sideUnits.toString(), txHash }),
        );
      } else {
        setStep('sending');
        await request(pick);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep('idle');
    }
  };

  const choice = (d: Direction) => {
    const impossible = d === 'higher' ? prev >= BALL_MAX : prev <= BALL_MIN;
    return (
      <button
        type="button"
        aria-pressed={direction === d}
        className={`game__choice game__choice--${d} ${direction === d ? 'game__choice--active' : ''}`}
        onClick={() => setDirection(d)}
        disabled={impossible || step !== 'idle'}
        title={impossible ? `nothing is ${d} than ${prev}` : undefined}
      >
        {d}
      </button>
    );
  };

  if (callPending && step === 'idle') {
    return <p className="game__locked">side bet sent — locking in your call as soon as you&apos;re back online…</p>;
  }

  return (
    <div className="game__bet" role="group" aria-label="Make your call">
      <div className="game__vote">
        {choice('higher')}
        {choice('lower')}
      </div>
      <label className="game__side">
        <span>side bet (optional)</span>
        <input
          type="text"
          inputMode="decimal"
          value={sideBet}
          placeholder="0"
          onChange={(e) => setSideBet(e.target.value)}
          aria-label="Side bet in USDC"
          aria-invalid={Boolean(sideError)}
          disabled={step !== 'idle'}
        />
        <span>usdc</span>
      </label>
      <p className="game__side-pools">
        side pools — higher {formatUsdc(round.sidePools.higher)} · lower {formatUsdc(round.sidePools.lower)} usdc
      </p>
      {sideError && <p className="lobbies__hint">{sideError}</p>}
      <button
        type="button"
        className="btn btn--lg game__lock"
        disabled={!direction || Boolean(sideError) || step !== 'idle' || status !== 'ready'}
        onClick={() => void lockIn()}
      >
        {step === 'paying' ? 'confirm in wallet…' : step === 'sending' ? 'locking in…' : 'lock in'}
      </button>
      {error && (
        <p className="lobbies__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
