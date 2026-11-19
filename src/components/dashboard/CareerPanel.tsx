import { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/client-api';

interface CareerGame {
  id: string;
  started_at: string | null;
  ended_at: string | null;
  lobby_name: string;
  placement: number | null;
  points: number;
  eliminated_round: number | null;
}

export default function CareerPanel() {
  const apiFetch = useApiFetch();
  const [games, setGames] = useState<CareerGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setGames(null);
    apiFetch<{ games: CareerGame[] }>('/api/career')
      .then((data) => setGames(data.games ?? []))
      .catch((err: Error) => setError(`couldn't load career — ${err.message}`));
  }, [apiFetch]);

  useEffect(load, [load]);

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

  if (!games) {
    return <p className="career__loading">loading your games…</p>;
  }

  if (games.length === 0) {
    return (
      <div className="career__empty">
        <p className="career__empty-title">no games yet.</p>
        <p>join or create a lobby — your history will show up here.</p>
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
        {games.map((game) => (
          <li key={game.id} className="career__row">
            <span className="career__place">
              {game.placement === 1 ? '🏆' : game.placement ? `#${game.placement}` : '—'}
            </span>
            <span className="career__meta">
              <strong>{game.lobby_name}</strong>
              {game.ended_at ? (
                <small>{new Date(game.ended_at).toLocaleDateString()}</small>
              ) : (
                <small>in progress</small>
              )}
            </span>
            <span className="career__pts">{game.points} pts</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
