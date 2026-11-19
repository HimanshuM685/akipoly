import { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/client-api';

interface PlayerRow {
  user_id: string;
  display_name: string | null;
  is_host: boolean;
  is_eliminated: boolean;
  eliminated_round: number | null;
  points: number;
  vote_locked: boolean;
}

interface GameState {
  game: { id: string; lobby_id: string; ended: boolean; winner_user_id: string | null };
  lobby: { id: string; host_user_id: string; name: string; status: string; current_round: number };
  players: PlayerRow[];
  round: null | {
    id: string;
    number: number;
    ball: number | null;
    status: 'awaiting_spin' | 'voting' | 'settled';
    opened_at: string;
    seconds_left: number;
  };
  me: { is_host: boolean; is_seated: boolean; is_eliminated: boolean; vote: string | null };
}

interface Props {
  gameId: string;
  onLobbyLeft: () => void;
}

export default function LiveGame({ gameId, onLobbyLeft }: Props) {
  const apiFetch = useApiFetch();
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [votingChoice, setVotingChoice] = useState<'higher' | 'lower' | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [clock, setClock] = useState(30);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<GameState>(`/api/games/${gameId}/state`);
      setState(next);
      setClock(next.round?.seconds_left ?? 30);
      // Auto resolve rounds that have hit their timer or all lock-ins.
      await apiFetch(`/api/games/${gameId}/settle`, { method: 'POST' }).catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiFetch, gameId]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 1200);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setClock((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    setVotingChoice(state?.me.vote === 'higher' || state?.me.vote === 'lower' ? state.me.vote : null);
  }, [state?.me.vote]);

  const spin = async () => {
    setSpinning(true);
    try {
      await apiFetch(`/api/games/${gameId}/spin`, { method: 'POST' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSpinning(false);
    }
  };

  const vote = async (choice: 'higher' | 'lower') => {
    if (votingChoice === choice) return;
    if (votingChoice) {
      setError('already locked in');
      return;
    }
    setVotingChoice(choice);
    try {
      await apiFetch(`/api/games/${gameId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ vote: choice }),
      });
      await load();
    } catch (err) {
      // Server rejected — you already locked in. Keep the first vote.
      setVotingChoice(null);
      setError((err as Error).message);
    }
  };

  if (error && !state) {
    return (
      <div className="room__error">
        {error}
        <button type="button" className="btn dash__btn" onClick={onLobbyLeft}>back to lobbies</button>
      </div>
    );
  }

  if (!state) {
    return <p className="room__loading">waking the table…</p>;
  }

  const round = state.round;
  const ended = state.game.ended;
  const isHost = state.me.is_host;
  const playersLeft = state.players.filter((p) => !p.is_host && !p.is_eliminated).length;
  const votesIn = state.players.filter((p) => !p.is_host && p.vote_locked).length;

  const winPlayer = ended && state.game.winner_user_id
    ? state.players.find((p) => p.user_id === state.game.winner_user_id)
    : null;

  return (
    <div className="game">
      <div className="game__header">
        <h2 className="dash__heading">{state.lobby.name}</h2>
        <span className="game__stat">round {round?.number ?? state.lobby.current_round}</span>
        <span className="game__stat">{playersLeft} standing</span>
      </div>

      <div className="game__ball" aria-label="Current ball">
        {round?.ball ?? '—'}
      </div>

      {!ended && round?.status === 'awaiting_spin' && (
        isHost ? (
          <button type="button" className="btn btn--lg game__spin" onClick={spin} disabled={spinning}>
            {spinning ? 'spinning…' : 'spin the ball'}
          </button>
        ) : (
          <p className="game__hint">waiting for the host to spin…</p>
        )
      )}

      {!ended && round?.status === 'voting' && (
        <>
          <p className="game__clock" aria-label="Seconds left to lock in">{clock}s</p>
          {isHost ? (
            <p className="game__hint">
              players voting… {votesIn}/{playersLeft} locked in
            </p>
          ) : state.me.is_eliminated ? (
            <p className="game__hint game__hint--out">you are out — spectate till the end.</p>
          ) : (
            <div className="game__vote">
              <button
                type="button"
                disabled={votingChoice !== null}
                className={`game__choice game__choice--higher ${votingChoice === 'higher' ? 'game__choice--active' : ''}`}
                onClick={() => vote('higher')}
                aria-pressed={votingChoice === 'higher'}
              >
                higher
              </button>
              <button
                type="button"
                disabled={votingChoice !== null}
                className={`game__choice game__choice--lower ${votingChoice === 'lower' ? 'game__choice--active' : ''}`}
                onClick={() => vote('lower')}
                aria-pressed={votingChoice === 'lower'}
              >
                lower
              </button>
            </div>
            {votingChoice && <p className="game__locked">locked in: {votingChoice}</p>}
          )}
        </>
      )}

      <ul className="game__roster">
        {state.players.map((player) => (
          <li
            key={player.user_id}
            className={`game__seat ${player.is_eliminated ? 'game__seat--out' : ''} ${player.is_host ? 'game__seat--host' : ''}`}
          >
            <span className="game__seat-avatar" aria-hidden="true">
              {(player.display_name ?? 'A').slice(0, 1).toUpperCase()}
            </span>
            <span className="game__seat-name">{player.display_name ?? 'anonymous'}</span>
            {player.is_host && <span className="room__dealer">dealer</span>}
            {player.is_eliminated && <span className="game__out">out</span>}
            {!player.is_eliminated && !player.is_host && (
              <span className="game__seat-pts">{player.points} pts</span>
            )}
          </li>
        ))}
      </ul>

      {ended && (
        <div className="game__over" role="status">
          <p className="game__over-title">game over.</p>
          <p className="game__over-winner">
            {winPlayer ? `${winPlayer.display_name ?? 'someone'} takes it.` : 'nobody left standing.'}
          </p>
          <button type="button" className="btn dash__btn" onClick={onLobbyLeft}>back to lobbies</button>
        </div>
      )}

      {error && <p className="lobbies__error" role="alert">{error}</p>}
    </div>
  );
}
