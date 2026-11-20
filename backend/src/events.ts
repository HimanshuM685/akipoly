/**
 * In-process change bus between services and the WS layer. Services emit
 * after their transaction commits; the WS layer re-reads and pushes views.
 * ponytail: single process. For several instances, back this with Postgres
 * LISTEN/NOTIFY (same three events).
 */
import { EventEmitter } from 'node:events';
import type { PayoutReason } from './shared/protocol.js';

interface Events {
  lobby: [lobbyId: string];
  lobbies: [];
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

/** Emit lobby + lobby-list changes for a set of lobbies touched by a tx. */
export function lobbiesChanged(ids: Iterable<string>) {
  for (const id of new Set(ids)) events.emit('lobby', id);
  events.emit('lobbies');
}
