import { useCallback, useEffect, useState } from 'react';
import type { CareerEntry } from '@akipoly/shared/protocol';
import { useGameSocket } from '../../features/game/GameSocket';
import { formatUsdc } from '../../lib/arc';

interface Props {
  onReview: (gameId: string) => void;
  onOpenTable: (lobbyId: string) => void;
}

export default function CareerPanel({ onReview, onOpenTable }: Props) {
  const { request, status } = useGameSocket();
  const [games, setGames] = useState<CareerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setGames(null);
    request<{ games: CareerEntry[] }>({ type: 'career.get' })
      .then((res) => setGames(res.games))
      .catch((err: Error) => setError(`couldn't load career — ${err.message}`));
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

  if (!games) return <p className="career__loading">loading your games…</p>;

  if (games.length === 0) {
    return (
      <div className="career__empty">
        <p className="career__empty-title">no games yet.</p>
        <p>join or open a table — your history will show up here.</p>
      </div>
    );
  }

  return (
    <div className="career">
      <div className="career__header">
        <h3 className="career__title">your recent games</h3>
        <button type="button" className="career__refresh" onClick={load} aria-label="Refresh">
          ↻
        </button>
      </div>
      <ul className="career__list">
        {games.map((g) => {
          const net = BigInt(g.won) - BigInt(g.paidIn);
          return (
            <li key={g.gameId}>
              <button
                type="button"
                className="career__row career__row--btn"
                onClick={() => (g.status === 'live' ? onOpenTable(g.lobbyId) : onReview(g.gameId))}
              >
                <span className="career__place">
                  {g.placement === 1 ? '🏆' : g.placement ? `#${g.placement}` : '—'}
                </span>
                <span className="career__meta">
                  <strong>{g.lobbyName}</strong>
                  <small>
                    {g.endedAt ? new Date(g.endedAt).toLocaleDateString() : 'in progress'} · in {formatUsdc(g.paidIn)} ·
                    out {formatUsdc(g.won)}
                  </small>
                </span>
                <span className={`career__pts ${net >= 0n ? 'career__pts--up' : 'career__pts--down'}`}>
                  {net >= 0n ? '+' : '−'}
                  {formatUsdc(net >= 0n ? net : -net)} usdc
                </span>
                <span className="career__go" aria-hidden="true">
                  {g.status === 'live' ? 'rejoin ›' : 'review ›'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
