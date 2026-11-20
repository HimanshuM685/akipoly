import { useCallback, useEffect, useRef, useState } from 'react';
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
    status: 'awaiting_spin' | 'voting' | 'settled' | 'refunded';
    opened_at: string;
    seconds_left: number;
    high_pool: number;
    low_pool: number;
  };
  me: {
    is_host: boolean;
    is_seated: boolean;
    is_eliminated: boolean;
    vote: string | null;
    needs_name: boolean;
    my_bet: { direction: string; amount: number } | null;
    claimable: number;
  };
}

interface Props {
  gameId: string;
  onLobbyLeft: () => void;
}

// Pool ball colors (1–15, 0 = cue white) — matches the physical ball set
const ballColors: Record<number, string> = {
  1: '#FFD700',
  2: '#0000FF',
  3: '#FF0000',
  4: '#800080',
  5: '#FFA500',
  6: '#008000',
  7: '#800000',
  8: '#000000',
  9: '#FFD700',
  10: '#0000FF',
  11: '#FF0000',
  12: '#800080',
  13: '#FFA500',
  14: '#008000',
  15: '#800000',
  0: '#FFFFFF',
};

export default function LiveGame({ gameId, onLobbyLeft }: Props) {
  const apiFetch = useApiFetch();
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<'higher' | 'lower' | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [respawing, setRespawing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([]);
  const prevBallRef = useRef<number | null>(null);
  const previousStateRef = useRef<GameState | null>(null);
  const [resultFlash, setResultFlash] = useState<'win' | 'loss' | 'push' | null>(null);

  // Derived values — declared BEFORE useEffect calls that reference them
  const round = state?.round ?? null;
  const ended = state?.game.ended ?? false;
  const isHost = state?.me.is_host ?? false;
  const playersLeft = state?.players.filter((p) => !p.is_host && !p.is_eliminated).length ?? 0;
  const votesIn = state?.players.filter((p) => !p.is_host && p.vote_locked).length ?? 0;
  const totalPool = round ? round.high_pool + round.low_pool : 0;
  const clockFromServer = round?.seconds_left ?? 30;

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<GameState>(`/api/games/${gameId}/state`);

      // Detect newly eliminated players and show toasts
      if (previousStateRef.current) {
        const prevEliminated = new Set(
          previousStateRef.current.players.filter((p) => p.is_eliminated).map((p) => p.user_id),
        );
        const newlyEliminated = next.players.filter(
          (p) => p.is_eliminated && !prevEliminated.has(p.user_id),
        );

        for (const p of newlyEliminated) {
          const prevPlayer = previousStateRef.current.players.find((x) => x.user_id === p.user_id);
          const name = p.display_name ?? 'A player';
          let reason = "didn't vote in time";
          if (prevPlayer?.vote_locked) {
            reason = 'guessed wrong';
          }
          const toastId = Date.now() + Math.random();
          setToasts((prev) => [...prev, { id: toastId, message: `${name} was eliminated — ${reason}.` }]);
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toastId));
          }, 5000);
        }
      }

      setState(next);
      previousStateRef.current = next;

      // Auto-settle when timer expires (round is in voting and time is up)
      if (next.round?.status === 'voting' && next.round?.seconds_left! <= 0) {
        await apiFetch(`/api/games/${gameId}/settle`, { method: 'POST' });
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiFetch, gameId]);

  useEffect(() => {
    load();
    let interval: number;

    if (!state) {
      interval = window.setInterval(load, 1200);
    } else if (round?.status === 'awaiting_spin') {
      // Host hasn't spun yet — poll less often
      interval = window.setInterval(load, 3000);
    } else if (round?.status === 'voting') {
      // Active voting — poll more often, aligned to server seconds_left
      interval = window.setInterval(load, 1000);
    } else {
      // Settled or game over — stop polling
      return;
    }

    return () => window.clearInterval(interval);
  }, [load, state, round?.status]);

  useEffect(() => {
    setIntent(state?.me.vote === 'higher' || state?.me.vote === 'lower' ? state.me.vote : null);
  }, [state?.me.vote]);

  useEffect(() => {
    if (round?.ball != null && prevBallRef.current !== round.ball) {
      prevBallRef.current = round.ball;
    }
  }, [round?.ball]);

  useEffect(() => {
    if (round?.ball != null && prevBallRef.current !== null && prevBallRef.current !== round.ball) {
      const ball = round.ball;
      const prev = prevBallRef.current;
      if (ball > prev) setResultFlash('win');
      else if (ball < prev) setResultFlash('loss');
      else setResultFlash('push');
    }
  }, [round?.ball]);

  const justSpun = round?.ball != null && prevBallRef.current !== null && prevBallRef.current !== round.ball;

  const lockedIn = state?.me.vote === 'higher' || state?.me.vote === 'lower';
  const winner = ended && state?.game.winner_user_id
    ? state.players.find((p) => p.user_id === state.game.winner_user_id)
    : null;

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

  const placeBet = async () => {
    if (!round) return;
    if (!intent || !betAmount) return;
    const amt = parseInt(betAmount, 10);
    if (isNaN(amt) || amt <= 0) return;

    try {
      await apiFetch(`/api/games/${gameId}/bet`, {
        method: 'POST',
        body: JSON.stringify({ round_id: round.id, direction: intent, amount: betAmount }),
      });
      // Also lock in the vote — bet without vote doesn't count
      await apiFetch(`/api/games/${gameId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ vote: intent }),
      });
      setBetAmount('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const lockIn = async () => {
    if (!intent || lockedIn) return;
    try {
      await apiFetch(`/api/games/${gameId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ vote: intent }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const respin = async () => {
    setRespawing(true);
    try {
      await apiFetch(`/api/games/${gameId}/settle`, {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRespawing(false);
    }
  };

  const claim = async () => {
    setClaiming(true);
    try {
      await apiFetch(`/api/games/${gameId}/claim`, { method: 'POST' });
      await load();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClaiming(false);
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

  return (
    <div className={`game ${resultFlash ? `game--flash-${resultFlash}` : ''}`}>
      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.message}
            </div>
          ))}
        </div>
      )}
      <div className="game__header">
        <h2 className="dash__heading">{state.lobby.name}</h2>
        <span className="game__stat">round {round?.number ?? state.lobby.current_round}</span>
        <span className="game__stat">{playersLeft} standing</span>
      </div>

      {round?.ball != null && (
        <div
          className={`game__ball ${justSpun ? 'game__ball--spin' : ''}`}
          style={{
            backgroundColor: ballColors[round.ball] ?? '#171717',
            color: round.ball === 8 ? '#FFFDF2' : '#171717',
          }}
        >
          {round.ball}
        </div>
      )}

      {round && (
        <div className="game__pools">
          <span className="game__pool">HIGH: {round.high_pool}</span>
          <span className="game__pool">LOW: {round.low_pool}</span>
          <span className="game__pool">Total: {totalPool}</span>
        </div>
      )}

      {!ended && round?.status === 'awaiting_spin' && (
        isHost ? (
          <button
            type="button"
            className="btn btn--lg game__spin"
            onClick={spin}
            disabled={spinning}
          >
            {spinning ? 'spinning…' : 'spin the ball'}
          </button>
        ) : (
          <p className="game__hint">waiting for the host to spin the ball…</p>
        )
      )}

      {!ended && round?.status === 'voting' && (
        <>
          <p className={`game__clock ${clockFromServer <= 5 && clockFromServer > 0 ? 'game__clock--urgent' : ''}`} aria-label="Seconds left to lock in">{clockFromServer}s</p>
          {isHost ? (
            <div className="game__btn-row">
              <p className="game__hint">
                players voting… {votesIn}/{playersLeft} locked in
              </p>
              <button
                type="button"
                className="btn dash__btn"
                onClick={respin}
                disabled={respawing}
              >
                {respawing ? 'respinning…' : 'respin the ball'}
              </button>
            </div>
          ) : state.me.is_eliminated ? (
            <p className="game__hint game__hint--out">you are out — spectate till the end.</p>
          ) : state.me.my_bet ? (
            <p className="game__locked">
              locked in: <strong>{state.me.my_bet.direction}</strong> {state.me.my_bet.amount} — waiting for the spin
            </p>
          ) : (
            <>
              <div className="game__bet" role="group" aria-label="Place your bet">
                <label>Amount</label>
                <input
                  type="number"
                  min="1"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  placeholder="e.g. 10"
                  aria-label="Bet amount"
                />
                <div className="game__choice">
                  <button
                    type="button"
                    aria-pressed={intent === 'higher'}
                    className={`game__choice game__choice--higher ${intent === 'higher' ? 'game__choice--active' : ''}`}
                    onClick={() => setIntent('higher')}
                    disabled={!betAmount || parseInt(betAmount, 10) <= 0}
                  >
                    higher
                  </button>
                  <button
                    type="button"
                    aria-pressed={intent === 'lower'}
                    className={`game__choice game__choice--lower ${intent === 'lower' ? 'game__choice--active' : ''}`}
                    onClick={() => setIntent('lower')}
                    disabled={!betAmount || parseInt(betAmount, 10) <= 0}
                  >
                    lower
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn--lg game__lock"
                  disabled={!intent || !betAmount || parseInt(betAmount, 10) <= 0}
                  onClick={placeBet}
                >
                  place bet
                </button>
              </div>
            </>
          )}
        </>
      )}

      <ul className="game__roster">
        {state.players.map((player) => (
          <li
            key={player.user_id}
            className={`game__seat ${player.is_eliminated ? 'game__seat--out' : ''} ${player.is_host ? 'game__seat--host' : ''} ${ended && state.game.winner_user_id === player.user_id ? 'game__seat--winner' : ''}`}
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
            {ended && state.game.winner_user_id === player.user_id && (
              <span className="game__crown">👑</span>
            )}
          </li>
        ))}
      </ul>

      {state.me.claimable > 0 && !ended && (
        <div className="game__claim">
          <p className="game__hint">you have {state.me.claimable} claimable</p>
          <button
            type="button"
            className="btn dash__btn"
            onClick={claim}
            disabled={claiming}
          >
            {claiming ? 'claiming…' : 'claim winnings'}
          </button>
        </div>
      )}

      {ended && (
        <div className="game__over" role="status">
          <p className="game__over-title">game over.</p>
          <p className="game__over-winner">
            {winner ? `${winner.display_name ?? 'someone'} has won.` : 'nobody left standing.'}
          </p>
          {state.me.claimable > 0 && (
            <>
              <p className="game__hint">you have {state.me.claimable} claimable</p>
              <button
                type="button"
                className="btn dash__btn"
                onClick={claim}
                disabled={claiming}
              >
                {claiming ? 'claiming…' : 'claim winnings'}
              </button>
            </>
          )}
          <button type="button" className="btn dash__btn" onClick={onLobbyLeft}>back to lobbies</button>
        </div>
      )}

      {error && <p className="lobbies__error" role="alert">{error}</p>}
    </div>
  );
}
