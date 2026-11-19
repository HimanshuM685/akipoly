import { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/client-api';

interface Seat {
  user_id: string;
  display_name: string | null;
  joined_at: string;
  is_host: boolean;
}

interface LobbyState {
  lobby: {
    id: string;
    name: string;
    max_players: number;
    status: 'waiting' | 'live' | 'finished' | 'cancelled';
    current_round: number;
    host_user_id: string;
  };
  seats: Seat[];
  gameId: string | null;
  gameEnded: boolean;
  me: { is_host: boolean; is_seated: boolean };
}

interface Props {
  lobbyId: string;
  onDone: () => void;
  onGameStarted: (gameId: string) => void;
}

export default function LobbyRoom({ lobbyId, onDone, onGameStarted }: Props) {
  const apiFetch = useApiFetch();
  const [state, setState] = useState<LobbyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(() => {
    apiFetch<LobbyState>(`/api/lobbies/${lobbyId}/state`)
      .then((data) => {
        setState(data);
        if (data.lobby.status === 'live' && data.gameId) onGameStarted(data.gameId);
      })
      .catch((err: Error) => setError(err.message));
  }, [apiFetch, lobbyId, onGameStarted]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 1600);
    return () => window.clearInterval(timer);
  }, [load]);

  const startGame = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await apiFetch<{ gameId: string }>(`/api/lobbies/${lobbyId}/state`, {
        method: 'POST',
      });
      onGameStarted(res.gameId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const leaveLobby = async () => {
    setLeaving(true);
    try {
      await apiFetch(`/api/lobbies/${lobbyId}/leave`, { method: 'POST' });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setLeaving(false);
    }
  };

  if (error && !state) {
    return (
      <div className="room__error">
        {error}
        <button type="button" className="btn dash__btn" onClick={onDone}>back to lobbies</button>
      </div>
    );
  }

  if (!state) {
    return <p className="room__loading">finding a seat…</p>;
  }

  const l = state.lobby;
  const isHost = state.me.is_host;
  const canStart = isHost && state.seats.length >= 2 && l.status === 'waiting';

  return (
    <div className="room">
      <div className="room__head">
        <h2 className="dash__heading">{l.name}</h2>
        <span className="room__tag">{l.status}</span>
      </div>

      <p className="dash__copy">
        {isHost
          ? 'you are the host-spinner. everyone else votes — you never do.'
          : 'waiting for the host to spin the ball.'}
      </p>

      <ul className="room__seats">
        {state.seats.map((seat) => (
          <li key={seat.user_id} className="room__seat">
            <span className="room__avatar" aria-hidden="true">{(seat.display_name ?? 'A').slice(0, 1).toUpperCase()}</span>
            <span className="room__seat-name">{seat.display_name ?? 'anonymous'}</span>
            {seat.is_host && <span className="room__dealer">dealer</span>}
          </li>
        ))}
      </ul>

      <div className="room__actions">
        {isHost && (
          <button
            type="button"
            className="btn dash__btn"
            onClick={startGame}
            disabled={!canStart || starting}
          >
            {starting ? 'starting…' : canStart ? 'start game' : 'need at least one other voter'}
          </button>
        )}
        <button type="button" className="btn room__leave" onClick={leaveLobby} disabled={leaving}>
          {leaving ? 'leaving…' : isHost ? 'disband lobby' : 'leave lobby'}
        </button>
      </div>

      {error && <p className="lobbies__error" role="alert">{error}</p>}
    </div>
  );
}
