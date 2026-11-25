import { useEffect, useState } from 'react';
import { useGameSocket } from '../../features/game/GameSocket';
import { formatUsdc, parseUsdc } from '../../lib/arc';

interface Props {
  onOpen: (lobbyId: string) => void;
}

type Pending = { type: 'create' } | { type: 'join'; lobbyId: string };

/** Accepts a bare room code, an invite link (`/play?room=…`) or any URL ending in the code. */
function extractRoomCode(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    const url = new URL(text, window.location.origin);
    return url.searchParams.get('room') ?? url.pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    return text;
  }
}

export default function LobbyBrowser({ onOpen }: Props) {
  const { status, session, lobbies, request } = useGameSocket();
  const [name, setName] = useState('');
  const [buyIn, setBuyIn] = useState('1');
  const [joinCode, setJoinCode] = useState('');
  const [pendingAction, setPendingAction] = useState<Pending | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const ready = status === 'ready';
  const buyInUnits = parseUsdc(buyIn);
  const limits = session?.limits;
  const buyInError =
    buyInUnits === null
      ? 'enter a USDC amount'
      : limits && (buyInUnits < BigInt(limits.minBuyIn) || buyInUnits > BigInt(limits.maxBuyIn))
        ? `buy-in must be ${formatUsdc(limits.minBuyIn)}–${formatUsdc(limits.maxBuyIn)} USDC`
        : null;

  // An invite link (/play?room=CODE) pre-fills the join box.
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('room');
      if (code) setJoinCode(code);
    } catch {
      /* no window / blocked */
    }
  }, []);

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
        setJoinCode('');
        onOpen(pendingAction.lobbyId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startJoinByCode = () => {
    const code = extractRoomCode(joinCode);
    if (code.length < 6) {
      setJoinError('paste a room code or an invite link.');
      return;
    }
    setJoinError(null);
    const known = lobbies?.find((l) => l.id === code);
    if (known && session && known.playerIds.includes(session.userId)) {
      onOpen(known.id);
      return;
    }
    setError(null);
    setDisplayName('');
    setPendingAction({ type: 'join', lobbyId: code });
  };

  const modalTitle = pendingAction?.type === 'create' ? 'name your seat.' : 'who are you?';

  return (
    <div className="lobbies">
      <div className="hub">
        {/* ---------------- create room ---------------- */}
        <form
          className="hub__card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || buyInError) return;
            setDisplayName('');
            setPendingAction({ type: 'create' });
          }}
        >
          <div className="hub__head hub__head--create">
            <span className="hub__icon" aria-hidden="true">
              +
            </span>
            <h2 className="hub__title">create room</h2>
          </div>
          <div className="hub__body">
            <p className="hub__copy">start your own room, set the buy-in and share the code.</p>
            <label className="hub__field">
              <span className="hub__label">room name</span>
              <input
                className="lobbies__input"
                type="text"
                value={name}
                maxLength={64}
                placeholder="e.g. friday night chaos"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="hub__field">
              <span className="hub__label">buy-in (usdc)</span>
              <input
                className="lobbies__input"
                type="text"
                inputMode="decimal"
                value={buyIn}
                onChange={(e) => setBuyIn(e.target.value)}
                aria-invalid={Boolean(buyInError)}
              />
            </label>
            {name.trim() && buyInError && <p className="lobbies__hint hub__hint">{buyInError}</p>}
            <button
              type="submit"
              className="btn btn--lg hub__btn"
              disabled={!ready || !name.trim() || Boolean(buyInError)}
            >
              create room
            </button>
          </div>
        </form>

        {/* ---------------- join room ---------------- */}
        <form
          className="hub__card"
          onSubmit={(e) => {
            e.preventDefault();
            startJoinByCode();
          }}
        >
          <div className="hub__head hub__head--join">
            <span className="hub__icon" aria-hidden="true">
              →
            </span>
            <h2 className="hub__title">join room</h2>
          </div>
          <div className="hub__body">
            <p className="hub__copy">got a code from a friend? paste it (or the invite link) and hop in.</p>
            <label className="hub__field">
              <span className="hub__label">room code or invite link</span>
              <input
                className="lobbies__input hub__code"
                type="text"
                value={joinCode}
                placeholder="paste it here"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setJoinError(null);
                }}
                aria-invalid={Boolean(joinError)}
              />
            </label>
            {joinError && (
              <p className="lobbies__hint hub__hint" role="alert">
                {joinError}
              </p>
            )}
            <button type="submit" className="btn btn--lg hub__btn hub__btn--join" disabled={!ready || !joinCode.trim()}>
              join room
            </button>
            <p className="hub__fine">or pick an open room below.</p>
          </div>
        </form>
      </div>

      {error && !pendingAction && (
        <p className="lobbies__error" role="alert">
          {error}
        </p>
      )}

      <div className="lobbies__head">
        <h2 className="dash__heading">
          open rooms
          {lobbies && <span className="lobbies__count-chip">{lobbies.length}</span>}
        </h2>
        {status !== 'ready' && <span className="lobbies__status">{status}…</span>}
      </div>

      {!lobbies && <p className="lobbies__loading">scanning the streets…</p>}

      {lobbies && lobbies.length === 0 && (
        <div className="lobbies__empty">
          <p className="lobbies__empty-title">nothing open yet.</p>
          <p>create the first room and see who shows up.</p>
        </div>
      )}

      {lobbies && lobbies.length > 0 && (
        <ul className="lobbies__list">
          {lobbies.map((lobby) => {
            const seated = session ? lobby.playerIds.includes(session.userId) : false;
            const full = lobby.playerIds.length >= lobby.maxPlayers;
            const canJoin = !seated && !full && (lobby.status === 'waiting' || lobby.status === 'starting');
            return (
              <li key={lobby.id} className={`lobbies__card lobbies__card--${lobby.status}`}>
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
              {modalTitle}
            </h3>
            <p className="name-modal__copy">pick a display name for this room.</p>
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
