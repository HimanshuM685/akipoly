/**
 * Who is watching what, and pushing fresh views to them. Each change loads
 * the lobby/game once, then attaches every socket's private `me` part.
 */
import { WebSocket } from 'ws';
import { pool } from '../db/pool.js';
import { gameViewFor, listLobbies, loadGame, lobbyView } from '../db/views.js';
import { events } from '../events.js';
import { log } from '../log.js';
import type { ServerMessage } from '../shared/protocol.js';

/** A client this far behind is dropped instead of buffered without limit. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
/** Tabs per user; the oldest is closed (4000) when a newer one authenticates. */
const MAX_SOCKETS_PER_USER = 5;
export const CLOSE_OPENED_ELSEWHERE = 4000;

export const serialize = (msg: ServerMessage) =>
  JSON.stringify(msg, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

export class Session {
  userId: string | null = null;
  walletAddress: string | null = null;
  lobbyId: string | null = null;
  watchingList = false;

  constructor(readonly socket: WebSocket) {}

  send(msg: ServerMessage): void {
    this.sendRaw(serialize(msg));
  }

  /** Send an already-serialized message (fan-out serializes once for everyone). */
  sendRaw(data: string): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      log.warn({ userId: this.userId }, 'dropping slow client');
      this.socket.terminate();
      return;
    }
    this.socket.send(data);
  }
}

const rooms = new Map<string, Set<Session>>();
const listWatchers = new Set<Session>();
const byUser = new Map<string, Set<Session>>();

export function bindUser(s: Session): void {
  if (!s.userId) return;
  const set = byUser.get(s.userId) ?? new Set();
  set.add(s);
  byUser.set(s.userId, set);
  // Set keeps insertion order, so the first entries are the oldest tabs.
  for (const old of set) {
    if (set.size <= MAX_SOCKETS_PER_USER) break;
    if (old === s) continue;
    set.delete(old);
    old.socket.close(CLOSE_OPENED_ELSEWHERE, 'opened elsewhere');
  }
}

export function unwatchLobby(s: Session): void {
  if (!s.lobbyId) return;
  const room = rooms.get(s.lobbyId);
  room?.delete(s);
  if (room?.size === 0) rooms.delete(s.lobbyId);
  s.lobbyId = null;
}

export async function watchLobby(s: Session, lobbyId: string): Promise<void> {
  unwatchLobby(s);
  const room = rooms.get(lobbyId) ?? new Set();
  room.add(s);
  rooms.set(lobbyId, room);
  s.lobbyId = lobbyId;
  await pushLobbyTo(lobbyId, [s]);
}

export async function watchList(s: Session): Promise<void> {
  s.watchingList = true;
  listWatchers.add(s);
  s.send({ type: 'lobbies', lobbies: await listLobbies(pool) });
}

export function removeSession(s: Session): void {
  unwatchLobby(s);
  listWatchers.delete(s);
  if (s.userId) {
    const set = byUser.get(s.userId);
    set?.delete(s);
    if (set?.size === 0) byUser.delete(s.userId);
  }
}

async function pushLobbyTo(lobbyId: string, sessions: Iterable<Session>): Promise<void> {
  const lobby = await lobbyView(pool, lobbyId);
  const game = lobby?.gameId ? await loadGame(pool, lobby.gameId) : null;
  const serverNow = Date.now();
  const lobbyMsg = serialize({ type: 'lobby', lobby, serverNow });
  for (const s of sessions) {
    s.sendRaw(lobbyMsg);
    // Game views differ per player (`me`), so those are serialized per socket.
    if (game) s.send({ type: 'game', game: gameViewFor(game, s.userId), serverNow });
  }
}

// Coalesce bursts (e.g. several picks in one tick) into one push per lobby.
const pendingLobbies = new Set<string>();
let lobbyFlush: NodeJS.Timeout | null = null;
let listFlush: NodeJS.Timeout | null = null;

events.on('lobby', (lobbyId) => {
  if (!rooms.has(lobbyId)) return;
  pendingLobbies.add(lobbyId);
  lobbyFlush ??= setTimeout(() => {
    lobbyFlush = null;
    const ids = [...pendingLobbies];
    pendingLobbies.clear();
    for (const id of ids) {
      const room = rooms.get(id);
      if (room) pushLobbyTo(id, room).catch((err) => log.error({ err, lobbyId: id }, 'push lobby failed'));
    }
  }, 50);
});

events.on('lobbies', () => {
  if (listWatchers.size === 0) return;
  listFlush ??= setTimeout(() => {
    listFlush = null;
    listLobbies(pool)
      .then((lobbies) => {
        const msg = serialize({ type: 'lobbies', lobbies });
        for (const s of listWatchers) s.sendRaw(msg);
      })
      .catch((err) => log.error({ err }, 'push lobby list failed'));
  }, 150);
});

events.on('payout', (userId, payout) => {
  for (const s of byUser.get(userId) ?? []) s.send({ type: 'payout', ...payout });
});
