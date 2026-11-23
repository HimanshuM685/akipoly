/**
 * In-process change bus between services and the WS layer. Services emit
 * after their transaction commits; the WS layer re-reads and pushes views.
 * ponytail: single process. For several instances, back this with Postgres
 * LISTEN/NOTIFY (same events).
 */
import { EventEmitter } from 'node:events';
import type { PayoutReason } from './shared/protocol.js';

interface Events {
  lobby: [lobbyId: string];
  lobbies: [];
  /** Payouts were enqueued and committed. */
  payouts: [];
  /** A VRF draw was queued and committed. */
  vrf: [];
  payout: [userId: string, payout: { amount: string; reason: PayoutReason; txHash: string }];
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export const events = {
  emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    bus.emit(event, ...args);
  },
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void) {
    bus.on(event, listener as (...a: unknown[]) => void);
  },
};

/**
 * One table changed in a way the lobby list doesn't show (a call, a phase
 * change): only that table's watchers are refreshed.
 */
export function lobbyChanged(id: string) {
  events.emit('lobby', id);
}

/** Lobby + lobby-list changes (seats, readiness, status) for lobbies touched by a tx. */
export function lobbiesChanged(ids: Iterable<string>) {
  for (const id of new Set(ids)) events.emit('lobby', id);
  events.emit('lobbies');
}
