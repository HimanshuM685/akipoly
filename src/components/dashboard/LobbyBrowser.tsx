import { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../../lib/client-api';

interface Lobby {
  id: string;
  name: string;
  max_players: number;
  status: 'waiting' | 'live' | 'finished' | 'cancelled';
  players: number;
  seated: boolean;
  created_at: string;
}

interface Props {
  onOpen: (lobbyId: string) => void;
}

export default function LobbyBrowser({ onOpen }: Props) {
  const apiFetch = useApiFetch();
  const [lobbies, setLobbies] = useState<Lobby[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'create' } | { type: 'join'; lobbyId: string } | null>(null);
  const [displayName, setDisplayName] = useState('');

  const load = useCallback(
    (soft = false) => {
      if (soft) setRefreshing(true);
      else {
        setLobbies(null);
        setError(null);
      }
      apiFetch<{ lobbies: Lobby[] }>('/api/lobbies')
        .then((data) => setLobbies(data.lobbies ?? []))
        .catch((err: Error) => setError(err.message))
        .finally(() => setRefreshing(false));
    },
    [apiFetch],
  );

  useEffect(load, [load]);

  const commitName = async () => {
    if (!pendingAction) return;
    const clean = displayName.trim().slice(0, 32);
    if (!clean) return;

    setCreating(true);
    setError(null);
    try {
      if (pendingAction.type === 'create') {
        const res = await apiFetch<{ lobby: Lobby }>('/api/lobbies', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), displayName: clean }),
        });
        setName('');
        setPendingAction(null);
        onOpen(res.lobby.id);
      } else {
        await apiFetch(`/api/lobbies/${pendingAction.lobbyId}/join`, {
          method: 'POST',
          body: JSON.stringify({ displayName: clean }),
        });
        setPendingAction(null);
        onOpen(pendingAction.lobbyId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="lobbies">
      <div className="lobbies__head">
        <h2 className="dash__heading">lobbies near you.</h2>
        <button
          type="button"
          className="lobbies__refresh"
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label="Refresh lobbies"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className={refreshing ? 'spin' : ''}>
            <path d="M14.5 9a5.5 5.5 0 1 1-1.61-3.89M14.5 2v3.5H11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {refreshing ? '…' : 'refresh'}
        </button>
      </div>

      <form
        className="lobbies__create"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setDisplayName('');
          setPendingAction({ type: 'create' });
        }}
      >
        <input
          className="lobbies__input"
          type="text"
          value={name}
          maxLength={64}
          placeholder="name your lobby…"
          onChange={(e) => setName(e.target.value)}
          aria-label="Lobby name"
        />
        <button type="submit" className="btn dash__btn" disabled={!name.trim()}>
          open lobby
        </button>
      </form>

      {error && <p className="lobbies__error" role="alert">{error}</p>}

      {!lobbies && !error && <p className="lobbies__loading">scanning the streets…</p>}

      {lobbies && lobbies.length === 0 && (
        <div className="lobbies__empty">
          <p className="lobbies__empty-title">nothing open yet.</p>
          <p>be the ghost at the party — open the first lobby and see who shows up.</p>
        </div>
      )}

      {lobbies && lobbies.length > 0 && (
        <ul className="lobbies__list">
          {lobbies.map((lobby) => (
            <li key={lobby.id} className="lobbies__card">
              <div className="lobbies__meta">
                <strong className="lobbies__name">{lobby.name}</strong>
                <span className="lobbies__count">{lobby.players}/{lobby.max_players} players</span>
                <span className="lobbies__tag">{lobby.status === 'live' ? 'live' : 'waiting'}</span>
              </div>
              <button
                type="button"
                className="btn lobbies__join"
                onClick={() => {
                  if (lobby.seated) {
                    onOpen(lobby.id);
                    return;
                  }
                  setDisplayName('');
                  setPendingAction({ type: 'join', lobbyId: lobby.id });
                }}
              >
                {lobby.seated ? 'rejoin' : 'join'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendingAction && (
        <div className="name-modal" role="dialog" aria-modal="true" aria-labelledby="name-modal-title">
          <div className="name-modal__panel">
            <h3 id="name-modal-title" className="name-modal__title">who are you?</h3>
            <p className="name-modal__copy">
              pick a display name for this lobby. once you take the seat, that's you for the rest of the game.
            </p>
            <input
              className="lobbies__input"
              autoFocus
              maxLength={32}
              type="text"
              placeholder="display name…"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') setPendingAction(null);
              }}
              aria-label="Display name"
            />
            <div className="name-modal__actions">
              <button type="button" className="btn name-modal__cancel" onClick={() => setPendingAction(null)}>
                cancel
              </button>
              <button
                type="button"
                className="btn btn--lg name-modal__confirm"
                onClick={commitName}
                disabled={creating || !displayName.trim()}
              >
                {creating ? 'saving…' : 'save my seat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
