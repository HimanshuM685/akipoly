import { useCallback, useEffect, useState } from 'react';
import type { LeaderboardEntry, LeaderboardView } from '../../../backend/src/shared/protocol';
import { useGameSocket } from '../../features/game/GameSocket';
import { addressUrl, formatUsdc } from '../../lib/arc';

const shorten = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const MEDALS = ['🥇', '🥈', '🥉'];

function Row({ e }: { e: LeaderboardEntry }) {
  return (
    <li className={`career__row ${e.isMe ? 'lb__me' : ''}`}>
      <span className="career__place lb__rank">{MEDALS[e.rank - 1] ?? `#${e.rank}`}</span>
      <span className="career__meta">
        <strong>
          <a className="lb__wallet" href={addressUrl(e.walletAddress)} target="_blank" rel="noreferrer">
            {shorten(e.walletAddress)}
          </a>
          {e.isMe && <span className="lb__you"> (you)</span>}
        </strong>
      </span>
      <span className="career__pts">{formatUsdc(e.balance)} usdc</span>
    </li>
  );
}

export default function LeaderboardPanel() {
  const { request, status } = useGameSocket();
  const [board, setBoard] = useState<LeaderboardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setBoard(null);
    request<LeaderboardView>({ type: 'leaderboard.get' })
      .then(setBoard)
      .catch((err: Error) => setError(`couldn't load the leaderboard — ${err.message}`));
  }, [request]);

  useEffect(() => {
    if (status === 'ready') load();
  }, [status, load]);

  if (error) {
    return (
      <div className="career__error">
        {error}
        <button type="button" className="btn career__retry" onClick={load}>
          try again
        </button>
      </div>
    );
  }

  if (!board) return <p className="career__loading">counting everyone&apos;s usdc…</p>;

  if (board.entries.length === 0) {
    return (
      <div className="career__empty">
        <p className="career__empty-title">no players yet.</p>
        <p>once people sign in, the richest wallets show up here.</p>
      </div>
    );
  }

  return (
    <div className="career">
      <div className="career__header">
        <h3 className="career__title">richest wallets</h3>
        <button type="button" className="career__refresh" onClick={load} aria-label="Refresh">
          ↻
        </button>
      </div>
      <ol className="career__list">
        {board.entries.map((e) => (
          <Row key={e.walletAddress} e={e} />
        ))}
        {board.me && (
          <>
            <li className="lb__divider" aria-hidden="true">
              ⋯
            </li>
            <Row e={board.me} />
          </>
        )}
      </ol>
      <p className="lb__note">
        usdc held on arc · {board.total} {board.total === 1 ? 'player' : 'players'} · refreshed{' '}
        {new Date(board.updatedAt).toLocaleTimeString()}, every 30 s at most
      </p>
    </div>
  );
}
