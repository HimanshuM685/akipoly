/**
 * One WebSocket per signed-in user for lobbies and games.
 * - authenticates with the Privy identity token before any action
 * - every action is a request with a reqId → resolves on ack, rejects on error
 * - reconnects with backoff and re-watches what the UI was watching
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getIdentityToken } from '@privy-io/react-auth';
import type {
  ClientMessage,
  GameView,
  LobbySummary,
  LobbyView,
  ServerMessage,
} from '../../../backend/src/shared/protocol';
import { formatUsdc, txUrl } from '../../lib/arc';

const WS_URL = (import.meta.env.PUBLIC_WS_URL as string | undefined) ?? 'wss://ws.akipoly.xyz';
const REQUEST_TIMEOUT_MS = 60_000;

type Outgoing = ClientMessage extends infer M ? (M extends { type: string } ? Omit<M, 'reqId'> : never) : never;
type AuthOk = Extract<ServerMessage, { type: 'auth_ok' }>;

export type SocketStatus = 'connecting' | 'authenticating' | 'ready' | 'offline';

export interface Toast {
  id: number;
  message: string;
  href?: string;
}

interface GameSocketValue {
  status: SocketStatus;
  session: AuthOk | null;
  lobbies: LobbySummary[] | null;
  lobby: LobbyView | null;
  game: GameView | null;
  /** serverTime - Date.now(), for local countdowns. */
  clockOffset: number;
  request: <T = unknown>(msg: Outgoing) => Promise<T>;
  watchLobby: (lobbyId: string | null) => void;
  toasts: Toast[];
  toast: (message: string, href?: string) => void;
}

const Ctx = createContext<GameSocketValue | null>(null);

export function useGameSocket(): GameSocketValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useGameSocket must be used inside <GameSocketProvider>');
  return value;
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: number;
}

const payoutLabel: Record<string, string> = {
  pot: 'you won the pot',
  split: 'pot split',
  side_win: 'side bet won',
  side_refund: 'side bet refunded',
  refund: 'buy-in refunded',
};

export function GameSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [session, setSession] = useState<AuthOk | null>(null);
  const [lobbies, setLobbies] = useState<LobbySummary[] | null>(null);
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const watchedLobby = useRef<string | null>(null);
  const seq = useRef(0);

  const toast = useCallback((message: string, href?: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, message, href }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const rawSend = (msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const authInFlight = useRef(false);
  const authenticate = useCallback(async () => {
    setStatus('authenticating');
    const token = await getIdentityToken().catch(() => null);
    if (!token) {
      setStatus('offline');
      toast('could not get a sign-in token — enable identity tokens in Privy, then sign in again');
      return;
    }
    authInFlight.current = true;
    rawSend({ type: 'auth', token });
  }, [toast]);

  useEffect(() => {
    let closedByUs = false;
    let retry = 0;
    let retryTimer: number | undefined;

    const failAll = (reason: string) => {
      for (const p of pending.current.values()) {
        window.clearTimeout(p.timer);
        p.reject(new Error(reason));
      }
      pending.current.clear();
    };

    const handle = (msg: ServerMessage) => {
      switch (msg.type) {
        case 'auth_ok':
          retry = 0;
          authInFlight.current = false;
          setSession(msg);
          setClockOffset(msg.serverNow - Date.now());
          setStatus('ready');
          rawSend({ type: 'lobbies.watch' });
          if (watchedLobby.current) rawSend({ type: 'lobby.watch', lobbyId: watchedLobby.current });
          return;
        case 'lobbies':
          setLobbies(msg.lobbies);
          return;
        case 'lobby':
          setClockOffset(msg.serverNow - Date.now());
          if (msg.lobby && msg.lobby.id !== watchedLobby.current) return;
          setLobby(msg.lobby);
          return;
        case 'game':
          setClockOffset(msg.serverNow - Date.now());
          if (msg.game.lobbyId === watchedLobby.current) setGame(msg.game);
          return;
        case 'payout':
          toast(`${payoutLabel[msg.reason] ?? 'payout'}: +${formatUsdc(msg.amount)} USDC`, txUrl(msg.txHash));
          return;
        case 'ack':
        case 'career':
        case 'error': {
          const p = msg.reqId ? pending.current.get(msg.reqId) : undefined;
          if (p) {
            pending.current.delete(msg.reqId!);
            window.clearTimeout(p.timer);
            if (msg.type === 'error') p.reject(new Error(msg.message));
            else p.resolve(msg.type === 'ack' ? msg.data : msg);
            return;
          }
          if (msg.type === 'error') {
            if (msg.code !== 'UNAUTHENTICATED') return toast(msg.message);
            if (authInFlight.current) {
              // The token itself was rejected: say so once instead of retrying forever.
              authInFlight.current = false;
              setStatus('offline');
              toast(msg.message);
            } else {
              void authenticate(); // session expired mid-game: refresh once
            }
          }
        }
      }
    };

    const connect = () => {
      setStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => void authenticate();
      ws.onmessage = (e) => {
        try {
          handle(JSON.parse(e.data as string) as ServerMessage);
        } catch (err) {
          console.error('[ws] bad message', err);
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        failAll('connection lost — try again');
        setSession(null);
        if (closedByUs) return;
        setStatus('offline');
        const delay = Math.min(15_000, 1000 * 2 ** retry++);
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closedByUs = true;
      window.clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [authenticate, toast]);

  const request = useCallback(<T,>(msg: Outgoing): Promise<T> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('not connected yet'));
    const reqId = `r${++seq.current}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.current.delete(reqId);
        reject(new Error('the server took too long to answer'));
      }, REQUEST_TIMEOUT_MS);
      pending.current.set(reqId, { resolve: resolve as (d: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ ...msg, reqId }));
    });
  }, []);

  const watchLobby = useCallback((lobbyId: string | null) => {
    if (watchedLobby.current === lobbyId) return;
    watchedLobby.current = lobbyId;
    setLobby(null);
    setGame(null);
    rawSend(lobbyId ? { type: 'lobby.watch', lobbyId } : { type: 'lobby.unwatch' });
  }, []);

  const value = useMemo(
    () => ({ status, session, lobbies, lobby, game, clockOffset, request, watchLobby, toasts, toast }),
    [status, session, lobbies, lobby, game, clockOffset, request, watchLobby, toasts, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Seconds left until an ISO deadline, ticking locally against server time. */
export function useCountdown(deadline: string | null | undefined, clockOffset: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - (now + clockOffset)) / 1000));
}
