import { useEffect, useRef, useState } from 'react';
import type { GameView, LobbyView, RoundOutcome } from '../../../backend/src/shared/protocol';
import { useCountdown, useGameSocket } from '../../features/game/GameSocket';
import BallReel from '../../features/game/BallReel';
import PickPanel from '../../features/game/PickPanel';
import { formatUsdc } from '../../lib/arc';

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

  return (
    <div className={`game ${flash ? `game--flash-${flash}` : ''}`}>
      <div className="game__header">
        <h2 className="dash__heading">{lobby.name}</h2>
        <span className="game__stat">round {round?.number ?? 0}</span>
        <span className="game__stat">{alive.length} standing</span>
        <span className="game__stat">pot {formatUsdc(game.pot)} usdc</span>
      </div>

      {round && (
        <BallReel
          value={ballValue}
          rolling={round.phase === 'rolling'}
          landAt={new Date(round.phaseEndsAt).getTime()}
          rollingMs={rollingMs}
          clockOffset={clockOffset}
          label={ballLabel}
        />
      )}

      {!ended && round?.phase === 'betting' && (
        <>
          <p
            className={`game__clock ${secondsLeft <= 5 && secondsLeft > 0 ? 'game__clock--urgent' : ''}`}
            aria-label="Seconds left to call"
          >
            {secondsLeft}s · {round.picksIn}/{alive.length} called
          </p>
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
        </>
      )}

      {game.history.length > 0 && (
        <ol className="game__history" aria-label="Recent balls">
          {game.history.map((h) => (
            <li key={h.number} className={`game__history-item game__history-item--${h.outcome}`}>
              <span>{String(h.ball).padStart(2, '0')}</span>
              <small>{h.outcome === 'opening' ? 'start' : h.outcome}</small>
            </li>
          ))}
        </ol>
      )}

      <ul className="game__roster">
        {game.players.map((p) => (
          <li
            key={p.userId}
            className={`game__seat ${p.alive ? '' : 'game__seat--out'} ${p.userId === game.winnerUserId ? 'game__seat--winner' : ''}`}
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

      {round && (
        <details className="game__fair">
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

      {ended && (
        <div className="game__over" role="status">
          <p className="game__over-title">game over.</p>
          <p className="game__over-winner">
            {winner
              ? `${winner.displayName} takes ${formatUsdc(BigInt(game.pot) - BigInt(game.fee))} usdc.`
              : 'no single winner — the pot was split.'}
          </p>
          {winner?.userId === session?.userId && <p className="game__hint">payout is on its way to your wallet.</p>}
          <button type="button" className="btn dash__btn" onClick={onLeave}>
            back to tables
          </button>
        </div>
      )}
    </div>
  );
}
