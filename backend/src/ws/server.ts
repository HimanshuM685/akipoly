/**
 * WebSocket transport: origin check, size limit, heartbeat, per-socket rate
 * limit. Game logic lives in the router and services.
 */
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type RawData } from 'ws';
import { env } from '../config/env.js';
import { log } from '../log.js';
import { removeSession, Session } from './hub.js';
import { route } from './router.js';

const HEARTBEAT_MS = 30_000;
const RATE_PER_SEC = 10;
const BURST = 30;

const allowedOrigins = new Set(
  env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

function originAllowed(req: IncomingMessage): boolean {
  if (allowedOrigins.size === 0) return true;
  return allowedOrigins.has(req.headers.origin ?? '');
}

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    maxPayload: 16 * 1024,
    verifyClient: (info: { req: IncomingMessage }) => originAllowed(info.req),
  });

  wss.on('connection', (socket) => {
    const session = new Session(socket);
    let alive = true;
    let tokens = BURST;
    let refilledAt = Date.now();
    // Process a socket's frames in order (auth must land before what follows).
    let chain = Promise.resolve();

    socket.on('pong', () => {
      alive = true;
    });

    socket.on('message', (data: RawData) => {
      const now = Date.now();
      tokens = Math.min(BURST, tokens + ((now - refilledAt) / 1000) * RATE_PER_SEC);
      refilledAt = now;
      if (tokens < 1) {
        session.send({ type: 'error', code: 'RATE_LIMITED', message: 'slow down' });
        return;
      }
      tokens -= 1;
      const raw = data.toString();
      chain = chain.then(() => route(session, raw));
    });

    socket.on('close', () => removeSession(session));
    socket.on('error', (err) => log.warn({ err }, 'socket error'));

    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on('close', () => clearInterval(heartbeat));
  });

  return wss;
}
