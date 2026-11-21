import { useState } from 'react';
import { useGameSocket } from '../../features/game/GameSocket';
import { formatUsdc, parseUsdc } from '../../lib/arc';

interface Props {
  onOpen: (lobbyId: string) => void;
}

type Pending = { type: 'create' } | { type: 'join'; lobbyId: string };

export default function LobbyBrowser({ onOpen }: Props) {
  const { status, session, lobbies, request } = useGameSocket();
  const [name, setName] = useState('');
  const [buyIn, setBuyIn] = useState('1');
  const [pendingAction, setPendingAction] = useState<Pending | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = status === 'ready';
  const buyInUnits = parseUsdc(buyIn);
  const limits = session?.limits;
  const buyInError =
    buyInUnits === null
      ? 'enter a USDC amount'
      : limits && (buyInUnits < BigInt(limits.minBuyIn) || buyInUnits > BigInt(limits.maxBuyIn))
        ? `buy-in must be ${formatUsdc(limits.minBuyIn)}–${formatUsdc(limits.maxBuyIn)} USDC`
        : null;

  const commitName = async () => {
    const clean = displayName.trim().slice(0, 32);
    if (!pendingAction || !clean) return;
    setBusy(true);
    setError(null);
    try {
      if (pendingAction.type === 'create') {
        const res = await request<{ lobbyId: string }>({
          type: 'lobby.create',
          name: name.trim(),
          displayName: clean,
          buyIn: buyInUnits!.toString(),
        });
        setName('');
        setPendingAction(null);
        onOpen(res.lobbyId);
      } else {
        await request({ type: 'lobby.join', lobbyId: pendingAction.lobbyId, displayName: clean });
        setPendingAction(null);
        onOpen(pendingAction.lobbyId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lobbies">
      <div className="lobbies__head">
        <h2 className="dash__heading">open tables.</h2>
        {status !== 'ready' && <span className="lobbies__status">{status}…</span>}
      </div>

      <form
        className="lobbies__create"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || buyInError) return;
          setDisplayName('');
          setPendingAction({ type: 'create' });
        }}
      >
        <input
          className="lobbies__input"
          type="text"
          value={name}
          maxLength={64}
          placeholder="name your table…"
          onChange={(e) => setName(e.target.value)}
          aria-label="Table name"
        />
        <label className="lobbies__buyin">
          <span>buy-in</span>
          <input
            className="lobbies__input lobbies__input--amount"
            type="text"
            inputMode="decimal"
            value={buyIn}
            onChange={(e) => setBuyIn(e.target.value)}
            aria-label="Buy-in in USDC"
            aria-invalid={Boolean(buyInError)}
          />
          <span>usdc</span>
        </label>
        <button type="submit" className="btn dash__btn" disabled={!ready || !name.trim() || Boolean(buyInError)}>
          open table
        </button>
      </form>
      {name.trim() && buyInError && <p className="lobbies__hint">{buyInError}</p>}

      {error && !pendingAction && (
        <p className="lobbies__error" role="alert">
          {error}
        </p>
      )}

      {!lobbies && <p className="lobbies__loading">scanning the streets…</p>}

      {lobbies && lobbies.length === 0 && (
        <div className="lobbies__empty">
          <p className="lobbies__empty-title">nothing open yet.</p>
          <p>open the first table and see who shows up.</p>
        </div>
      )}

      {lobbies && lobbies.length > 0 && (
        <ul className="lobbies__list">
          {lobbies.map((lobby) => {
            const seated = session ? lobby.playerIds.includes(session.userId) : false;
            const full = lobby.playerIds.length >= lobby.maxPlayers;
            const canJoin = !seated && !full && (lobby.status === 'waiting' || lobby.status === 'starting');
            return (
              <li key={lobby.id} className="lobbies__card">
                <div className="lobbies__meta">
                  <strong className="lobbies__name">{lobby.name}</strong>
                  <span className="lobbies__count">
                    {lobby.playerIds.length}/{lobby.maxPlayers} players · {formatUsdc(lobby.buyIn)} usdc buy-in
                  </span>
                  <span className={`lobbies__tag lobbies__tag--${lobby.status}`}>{lobby.status}</span>
                </div>
                <button
                  type="button"
                  className="btn lobbies__join"
                  disabled={!ready || (!seated && !canJoin && lobby.status !== 'live')}
                  onClick={() => {
                    if (seated || !canJoin) {
                      onOpen(lobby.id);
                      return;
                    }
                    setError(null);
                    setDisplayName('');
                    setPendingAction({ type: 'join', lobbyId: lobby.id });
                  }}
                >
                  {seated ? 'rejoin' : canJoin ? 'join' : lobby.status === 'live' ? 'watch' : 'full'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pendingAction && (
        <div className="name-modal" role="dialog" aria-modal="true" aria-labelledby="name-modal-title">
          <div className="name-modal__panel">
            <h3 id="name-modal-title" className="name-modal__title">
              who are you?
            </h3>
            <p className="name-modal__copy">pick a display name for this table.</p>
            <input
              className="lobbies__input"
              autoFocus
              maxLength={32}
              type="text"
              placeholder="display name…"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitName();
                if (e.key === 'Escape') setPendingAction(null);
              }}
              aria-label="Display name"
            />
            {error && (
              <p className="lobbies__error" role="alert">
                {error}
              </p>
            )}
            <div className="name-modal__actions">
              <button type="button" className="btn name-modal__cancel" onClick={() => setPendingAction(null)}>
                cancel
              </button>
              <button
                type="button"
                className="btn btn--lg name-modal__confirm"
                onClick={() => void commitName()}
                disabled={busy || !displayName.trim()}
              >
                {busy ? 'saving…' : 'take the seat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
