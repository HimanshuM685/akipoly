/**
 * The ball. While a round is rolling it cycles through numbers, slowing down,
 * and lands on the server's ball exactly at the round's reveal time, so every
 * player sees the same roll at the same moment.
 */
import { useEffect, useRef, useState } from 'react';
import { BALL_MAX, BALL_MIN } from '../../../backend/src/shared/constants';

const BALL_COLORS: Record<number, string> = {
  0: '#F4F1E6',
  1: '#FFD700',
  2: '#2563EB',
  3: '#E11D48',
  4: '#7C3AED',
  5: '#F97316',
  6: '#16A34A',
  7: '#8B1E3F',
  8: '#171717',
  9: '#FDE047',
  10: '#60A5FA',
  11: '#FB7185',
  12: '#A78BFA',
  13: '#FDBA74',
  14: '#4ADE80',
  15: '#C2410C',
  16: '#14B8A6',
};
const DARK = new Set([2, 3, 4, 7, 8, 15]);

const pad = (n: number) => String(n).padStart(2, '0');
const randomBall = (not: number | null) => {
  let n: number;
  do n = BALL_MIN + Math.floor(Math.random() * (BALL_MAX - BALL_MIN + 1));
  while (n === not);
  return n;
};

interface Props {
  /** Ball to show when not rolling (or to land on). */
  value: number | null;
  rolling: boolean;
  /** Epoch ms (server clock) when the roll lands. */
  landAt: number;
  rollingMs: number;
  clockOffset: number;
  label: string;
}

export default function BallReel({ value, rolling, landAt, rollingMs, clockOffset, label }: Props) {
  const [shown, setShown] = useState<number | null>(value);
  const [phase, setPhase] = useState<'idle' | 'rolling' | 'landed'>('idle');
  const lastShown = useRef<number | null>(value);

  useEffect(() => {
    if (!rolling) {
      setShown(value);
      setPhase('idle');
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer: number | undefined;
    const step = () => {
      const remaining = landAt - (Date.now() + clockOffset);
      if (remaining <= 0 && value !== null) {
        lastShown.current = value;
        setShown(value);
        setPhase('landed');
        return;
      }
      if (!reduced) {
        const next = randomBall(lastShown.current);
        lastShown.current = next;
        setShown(next);
      } else {
        setShown(null);
      }
      // Ease out: fast flicker at first, slow clicks just before landing.
      const progress = Math.min(1, Math.max(0, 1 - remaining / rollingMs));
      const delay = 55 + 420 * progress * progress;
      timer = window.setTimeout(step, Math.max(16, Math.min(delay, remaining > 0 ? remaining : 120)));
    };
    setPhase('rolling');
    step();
    return () => window.clearTimeout(timer);
  }, [rolling, value, landAt, rollingMs, clockOffset]);

  const n = shown;
  return (
    <div className="ballreel">
      <div
        className={`game__ball ${phase === 'rolling' ? 'game__ball--rolling' : ''} ${phase === 'landed' ? 'game__ball--landed' : ''}`}
        style={{
          backgroundColor: n === null ? 'var(--color-paper)' : BALL_COLORS[n],
          color: n !== null && DARK.has(n) ? '#FFFDF2' : '#171717',
        }}
        role="img"
        aria-label={phase === 'rolling' ? 'ball rolling' : n === null ? 'no ball yet' : `ball ${n}`}
      >
        <span className="game__ball-num">{n === null ? '??' : pad(n)}</span>
      </div>
      <p className="ballreel__label" aria-live="polite">
        {phase === 'rolling' ? 'rolling…' : label}
      </p>
    </div>
  );
}
