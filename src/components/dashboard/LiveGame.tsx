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

export default function LiveGame({ gameId, onLobbyLeft }: Props) {
  const apiFetch = useApiFetch();
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<'higher' | 'lower' | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [respawing, setRespawing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [seed, setSeed] = useState('');
  const [commitment, setCommitment] = useState('');
  const [clock, setClock] = useState(30);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<GameState>(`/api/games/${gameId}/state`);
      setState(next);
      setClock(next.round?.seconds_left ?? 30);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiFetch, gameId]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 1200);
    return () => window.clearInterval(poll);
  }, [load]);

  // Reset commitment when round changes so cross-round contamination doesn't occur
  useEffect(() => {
    setCommitment('');
  }, [round?.id]);

  useEffect(() => {
    const t = window.setInterval(() => setClock((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    setIntent(state?.me.vote === 'higher' || state?.me.vote === 'lower' ? state.me.vote : null);
  }, [state?.me.vote]);

  const lockedIn = state?.me.vote === 'higher' || state?.me.vote === 'lower';
  const round = state?.round ?? null;
  const ended = state?.game.ended ?? false;
  const isHost = state?.me.is_host ?? false;
  const playersLeft = state?.players.filter((p) => !p.is_host && !p.is_eliminated).length ?? 0;
  const votesIn = state?.players.filter((p) => !p.is_host && p.vote_locked).length ?? 0;
  const totalPool = round ? round.high_pool + round.low_pool : 0;

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

  const commitRandomness = async () => {
    if (!round) return;
    setCommitting(true);
    try {
      const c = hashSeedLocal(seed);
      setCommitment(c);
      await apiFetch(`/api/games/${gameId}/commit`, {
        method: 'POST',
        body: JSON.stringify({ round_id: round.id, commitment: c }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  const revealRandomness = async () => {
    if (!round || !seed) return;
    setRevealing(true);
    try {
      await apiFetch(`/api/games/${gameId}/reveal`, {
        method: 'POST',
        body: JSON.stringify({ round_id: round.id, seed }),
      });
      setSeed('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevealing(false);
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
      setBetAmount('');
      setIntent(null);
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
      const res = await apiFetch(`/api/games/${gameId}/claim`, { method: 'POST' });
      await load();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  // Simple local hash for commitment UI (server does real verification)
  function hashSeedLocal(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return '0x' + hex.repeat(8).slice(0, 64);
  }

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
    <div className="game">
      <div className="game__header">
        <h2 className="dash__heading">{state.lobby.name}</h2>
        <span className="game__stat">round {round?.number ?? state.lobby.current_round}</span>
        <span className="game__stat">{playersLeft} standing</span>
      </div>

      <div className="game__ball" aria-label="Current ball">
        {round?.ball ?? '—'}
      </div>

      {round && (
        <div className="game__pools">
          <span className="game__pool">HIGH: {round.high_pool}</span>
          <span className="game__pool">LOW: {round.low_pool}</span>
          <span className="game__pool">Total: {totalPool}</span>
        </div>
      )}

      {!ended && round?.status === 'awaiting_spin' && (
        <>
          {isHost ? (
            <>
              <p className="game__hint">commit randomness seed before spinning</p>
              <div className="game__commit">
                <input
                  type="text"
                  placeholder="seed phrase (any text)"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  aria-label="randomness seed"
                />
                <button
                  type="button"
                  className="btn dash__btn"
                  onClick={commitRandomness}
                  disabled={committing || !seed}
                >
                  {committing ? 'committing…' : 'commit seed'}
                </button>
              </div>
              {commitment && (
                <p className="game__hint">commitment: {commitment.slice(0, 16)}…</p>
              )}
              {commitment && !round.ball && (
                <>
                  <p className="game__hint">reveal to generate the ball</p>
                  <button
                    type="button"
                    className="btn dash__btn"
                    onClick={revealRandomness}
                    disabled={revealing || !seed}
                  >
                    {revealing ? 'revealing…' : 'reveal seed'}
                  </button>
                </>
              )}
              {round.ball && (
                <button
                  type="button"
                  className="btn btn--lg game__spin"
                  onClick={spin}
                  disabled={spinning}
                >
                  {spinning ? 'spinning…' : 'spin the ball'}
                </button>
              )}
            </>
          ) : (
            <p className="game__hint">waiting for the host to commit and spin…</p>
          )}
        </>
      )}

      {!ended && round?.status === 'voting' && (
        <>
          <p className="game__clock" aria-label="Seconds left to lock in">{clock}s</p>
          {isHost ? (
            <>
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
            </>
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
