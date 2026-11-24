import { useEffect, useRef, useState } from 'react';
import type { GameView, LobbyView, RoundOutcome } from '../../../backend/src/shared/protocol';
import { useCountdown, useGameSocket } from '../../features/game/GameSocket';
import BallReel from '../../features/game/BallReel';
import PickPanel from '../../features/game/PickPanel';
import { formatUsdc } from '../../lib/arc';
import { burst } from '../../scripts/fx-lib';

interface Props {
  lobby: LobbyView;
  game: GameView;
  onLeave: () => void;
}

const outcomeText: Record<RoundOutcome, string> = {
  higher: 'higher!',
  lower: 'lower!',
  push: 'same ball — push, nobody out.',
  void: 'everyone missed — round void, nobody out.',
  opening: 'opening ball.',
};

export default function LiveGame({ lobby, game, onLeave }: Props) {
  const { session, clockOffset, toast } = useGameSocket();
  const [flash, setFlash] = useState<'win' | 'loss' | 'push' | null>(null);
  const prevGame = useRef<GameView | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const confettiDone = useRef(false);

  const round = game.round;
  const ended = game.status === 'finished';
  const secondsLeft = useCountdown(round?.phase === 'betting' ? round.phaseEndsAt : null, clockOffset);
  const alive = game.players.filter((p) => p.alive);
  const winner = game.players.find((p) => p.userId === game.winnerUserId);
  const rollingMs = session?.timing.rollingMs ?? 3500;

  // Round results: eliminations toasts + a flash for my own outcome.
  useEffect(() => {
    const before = prevGame.current;
    prevGame.current = game;
    const latest = game.history[0];
    if (!before || !latest || before.history[0]?.number === latest.number) return;
    const wasAlive = new Set(before.players.filter((p) => p.alive).map((p) => p.userId));
    for (const p of game.players) {
      if (!p.alive && wasAlive.has(p.userId)) toast(`${p.displayName} is out.`);
    }
    if (latest.outcome === 'opening') return;
    const meBefore = before.me;
    if (!meBefore?.alive) return;
    if (latest.outcome === 'push' || latest.outcome === 'void') setFlash('push');
    else setFlash(game.me?.alive ? 'win' : 'loss');
  }, [game, toast]);

  const celebrate = (count: number) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = stageRef.current?.getBoundingClientRect();
    if (r) burst(r.left + r.width / 2, r.top + r.height * 0.38, count);
  };

  // Confetti when you survive a round, and a big one when you win the game.
  useEffect(() => {
    if (flash === 'win') celebrate(14);
  }, [flash]);

  useEffect(() => {
    if (ended && winner?.userId === session?.userId && !confettiDone.current) {
      confettiDone.current = true;
      celebrate(40);
    }
  }, [ended, winner, session]);

  // Clear the flash on its own timer so later pushes can't cancel the reset.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(t);
  }, [flash]);

  const ballLabel = (() => {
    if (!round) return '';
    const latest = game.history[0];
    const last = latest ? `${outcomeText[latest.outcome]} ` : '';
    if (round.phase === 'betting') return `${last}next ball: higher or lower than ${round.prevBall}?`;
    if (round.phase === 'settled' && latest) return `rolled ${latest.ball} — ${outcomeText[latest.outcome]}`;
    return '';
  })();

  const ballValue = round ? (round.phase === 'betting' ? round.prevBall : round.ball) : null;

  const bettingMs = session?.timing.bettingMs ?? 30000;
  const pct = Math.max(0, Math.min(100, (secondsLeft * 1000 * 100) / bettingMs));
  const betting = !ended && round?.phase === 'betting';
  const urgent = secondsLeft <= 5 && secondsLeft > 0;

  return (
    <div className={`game arena ${flash ? `game--flash-${flash}` : ''}`}>
      <section className="arena__stage" aria-label="Game table" ref={stageRef}>
        <header className="arena__bar">
          <div className="arena__title">
            <span className="arena__eyebrow">table</span>
            <h2 className="arena__name">{lobby.name}</h2>
          </div>
          <dl className="arena__stats">
            <div className="arena__stat">
              <dt>round</dt>
              <dd key={round?.number ?? 0} className="arena__pop">{round?.number ?? 0}</dd>
            </div>
            <div className="arena__stat">
              <dt>standing</dt>
              <dd key={alive.length} className="arena__pop">{alive.length}</dd>
            </div>
            <div className="arena__stat arena__stat--pot">
              <dt>pot</dt>
              <dd key={String(game.pot)} className="arena__pop">{formatUsdc(game.pot)} <small>usdc</small></dd>
            </div>
          </dl>
        </header>

        {round && (
          <div className="arena__court">
            <BallReel
              value={ballValue}
              rolling={round.phase === 'rolling'}
              landAt={new Date(round.phaseEndsAt).getTime()}
              rollingMs={rollingMs}
              clockOffset={clockOffset}
              label={ballLabel}
            />
          </div>
        )}

        {betting && round && (
          <div className="arena__call">
            <div className={`arena__timer ${urgent ? 'arena__timer--urgent' : ''}`}>
              <div className="arena__timer-track" aria-hidden="true">
                <div className="arena__timer-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="arena__timer-text" aria-label="Seconds left to call">
                <strong>{secondsLeft}s</strong>
                <span>
                  {round.picksIn}/{alive.length} called
                </span>
              </p>
            </div>
            {!game.me ? (
              <p className="game__hint">you&apos;re watching this table.</p>
            ) : !game.me.alive ? (
              <p className="game__hint game__hint--out">you are out — spectate till the end.</p>
            ) : game.me.pick ? (
              <p className="game__locked">
                locked in: <strong>{game.me.pick.direction}</strong>
                {BigInt(game.me.pick.sideBet) > 0n && ` · ${formatUsdc(game.me.pick.sideBet)} usdc side bet`}
              </p>
            ) : (
              <PickPanel key={round.number} game={game} />
            )}
          </div>
        )}

        {ended && (
          <div className="game__over" role="status">
            <p className="game__over-title">game over.</p>
            <p className="game__over-winner">
              {winner
                ? `${winner.displayName} takes ${formatUsdc(BigInt(game.pot) - BigInt(game.fee))} usdc.`
                : 'no single winner — the pot was split.'}
            </p>
            {winner?.userId === session?.userId && <p className="game__hint">payout is on its way to your wallet.</p>}
            <button type="button" className="btn btn--lg dash__btn" onClick={onLeave}>
              back to tables
            </button>
          </div>
        )}
      </section>

      <aside className="arena__rail">
        <section className="arena__card">
          <h3 className="arena__card-title">
            players <span>{alive.length}/{game.players.length}</span>
          </h3>
          <ul className="game__roster">
            {game.players.map((p) => (
              <li
                key={p.userId}
                className={`game__seat ${p.alive ? '' : 'game__seat--out'} ${p.userId === game.winnerUserId ? 'game__seat--winner' : ''} ${p.userId === session?.userId ? 'game__seat--me' : ''}`}
              >
                <span className="game__seat-avatar" aria-hidden="true">
                  {p.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="game__seat-name">
                  {p.displayName}
                  {p.userId === session?.userId && ' (you)'}
                </span>
                {p.alive && round?.phase === 'betting' && (
                  <span className={`game__called ${p.picked ? 'game__called--yes' : ''}`}>{p.picked ? 'called' : '…'}</span>
                )}
                {!p.alive && <span className="game__out">out r{p.eliminatedRound}</span>}
                {p.userId === game.winnerUserId && <span className="game__crown">👑</span>}
              </li>
            ))}
          </ul>
        </section>

        {game.history.length > 0 && (
          <section className="arena__card">
            <h3 className="arena__card-title">recent balls</h3>
            <ol className="game__history" aria-label="Recent balls">
              {game.history.map((h) => (
                <li key={h.number} className={`game__history-item game__history-item--${h.outcome}`}>
                  <span>{String(h.ball).padStart(2, '0')}</span>
                  <small>{h.outcome === 'opening' ? 'start' : h.outcome}</small>
                </li>
              ))}
            </ol>
          </section>
        )}

        {round && (
          <details className="game__fair arena__card">
            <summary>provably fair</summary>
            <p>
              round {round.number} commitment: <code>{round.seedHash}</code>
            </p>
            {round.seed && (
              <p>
                seed: <code>{round.seed}</code>
              </p>
            )}
            <p>ball = uint64(HMAC-SHA256(seed, &quot;gameId:round&quot;)[0..8]) mod 17 · gameId {game.id}</p>
          </details>
        )}
      </aside>
    </div>
  );
}
