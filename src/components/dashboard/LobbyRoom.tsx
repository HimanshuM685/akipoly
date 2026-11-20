import { useState } from 'react';
import type { LobbyView } from '../../../backend/src/shared/protocol';
import { useCountdown, useGameSocket } from '../../features/game/GameSocket';
import { usePayUsdc } from '../../features/game/usePayUsdc';
import { formatUsdc, network } from '../../lib/arc';

interface Props {
  lobby: LobbyView;
  onLeave: () => void;
}

export default function LobbyRoom({ lobby, onLeave }: Props) {
  const { status, session, request, paidRequest, clockOffset, toast } = useGameSocket();
  const pay = usePayUsdc();
  const [step, setStep] = useState<'idle' | 'paying' | 'verifying' | 'refunding' | 'leaving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const startsIn = useCountdown(lobby.status === 'starting' ? lobby.startsAt : null, clockOffset);

  const me = session ? lobby.players.find((p) => p.userId === session.userId) : undefined;
  const readyCount = lobby.players.filter((p) => p.ready).length;
  const pot = BigInt(lobby.buyIn) * BigInt(readyCount);
  const open = lobby.status === 'waiting' || lobby.status === 'starting';
  const busy = step !== 'idle' || status !== 'ready';

  const readyUp = async () => {
    if (!session) return;
    setError(null);
    try {
      setStep('paying');
      await paidRequest(
        (onSent) =>
          pay(session.treasury, BigInt(lobby.buyIn), (hash) => {
            onSent(hash);
            setStep('verifying');
          }),
        (txHash) => ({ type: 'lobby.ready', lobbyId: lobby.id, txHash }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep('idle');
    }
  };

  const unready = async () => {
    setError(null);
    setStep('refunding');
    try {
      await request({ type: 'lobby.unready', lobbyId: lobby.id });
      toast('buy-in refund is on its way');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep('idle');
    }
  };

  const leave = async () => {
    setStep('leaving');
    try {
      if (me && open) await request({ type: 'lobby.leave', lobbyId: lobby.id });
      onLeave();
    } catch (err) {
      setError((err as Error).message);
      setStep('idle');
    }
  };

  if (lobby.status === 'cancelled') {
    return (
      <div className="room">
        <p className="dash__copy">this table closed.</p>
        <button type="button" className="btn dash__btn" onClick={onLeave}>
          back to tables
        </button>
      </div>
    );
  }

  return (
    <div className="room">
      <div className="room__head">
        <h2 className="dash__heading">{lobby.name}</h2>
        <span className="room__tag">{lobby.status === 'starting' ? `starting in ${startsIn}` : lobby.status}</span>
      </div>

      <div className="room__stakes">
        <span>
          buy-in <strong>{formatUsdc(lobby.buyIn)} usdc</strong>
        </span>
        <span>
          pot <strong>{formatUsdc(pot)} usdc</strong>
        </span>
      </div>

      <p className="dash__copy">
        press ready to pay the buy-in. when everyone is ready the ball starts rolling. call higher or lower each
        round — wrong call or no call and you&apos;re out. last one standing takes the pot.
      </p>

      <ul className="room__seats">
        {lobby.players.map((p) => (
          <li key={p.userId} className={`room__seat ${p.ready ? 'room__seat--ready' : ''}`}>
            <span className="room__avatar" aria-hidden="true">
              {p.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="room__seat-name">
              {p.displayName}
              {p.userId === session?.userId && ' (you)'}
            </span>
            {p.userId === lobby.ownerUserId && <span className="room__badge">host</span>}
            <span className={`room__ready ${p.ready ? 'room__ready--yes' : ''}`}>{p.ready ? 'ready' : 'not ready'}</span>
          </li>
        ))}
      </ul>

      {lobby.players.length < 2 && <p className="game__hint">waiting for at least one more player…</p>}

      <div className="room__actions">
        {me && open && !me.ready && (
          <button type="button" className="btn btn--lg dash__btn" onClick={() => void readyUp()} disabled={busy}>
            {step === 'paying'
              ? 'confirm in wallet…'
              : step === 'verifying'
                ? 'verifying payment…'
                : `ready · pay ${formatUsdc(lobby.buyIn)} usdc`}
          </button>
        )}
        {me && open && me.ready && (
          <button type="button" className="btn dash__btn" onClick={() => void unready()} disabled={busy}>
            {step === 'refunding' ? 'refunding…' : 'not ready · refund me'}
          </button>
        )}
        <button type="button" className="btn room__leave" onClick={() => void leave()} disabled={step !== 'idle'}>
          {step === 'leaving' ? 'leaving…' : 'leave table'}
        </button>
      </div>

      {network.faucetUrl && (
        <p className="dash__fineprint">
          need test USDC?{' '}
          <a href={network.faucetUrl} target="_blank" rel="noopener noreferrer">
            get some from the Circle faucet ↗
          </a>{' '}
          (pick Arc Testnet).
        </p>
      )}

      {error && (
        <p className="lobbies__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
