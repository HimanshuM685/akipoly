import { WebSocketServer, WebSocket } from 'ws';
import { initAuth, verifyPrivyToken, getAppId } from './auth.js';
import { initDb, withTransaction, query } from './db.js';
import {
  snapshotGame,
  spin,
  vote,
  placeBet,
  settleRound,
  claimWinnings,
  createFirstRound,
} from './game.js';
import { initPayout, transferUsdc } from './payout.js';

const rooms = new Map(); // gameId -> Set of WebSocket clients
const userSockets = new Map(); // userId -> WebSocket
const socketUserId = new Map(); // WebSocket -> userId
const socketQueues = new Map(); // WebSocket -> array of messages sent before auth
const messageCache = new Map(); // `${userId}:${message_id}` -> expiry timestamp
const MESSAGE_TTL_MS = 5 * 60 * 1000;

let dbInitialized = false;
let authInitialized = false;
let payoutInitialized = false;

function isDuplicate(userId, messageId) {
  const key = `${userId}:${messageId}`;
  const now = Date.now();
  const expiry = messageCache.get(key);
  if (expiry != null && now < expiry) return true;
  messageCache.delete(key);
  return false;
}

function markSeen(userId, messageId) {
  messageCache.set(`${userId}:${messageId}`, Date.now() + MESSAGE_TTL_MS);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of messageCache) {
    if (now >= expiry) messageCache.delete(key);
  }
}, 60000);

// Verify a user is seated in the lobby of a game before allowing game actions.
async function assertSeated(gameId, userId) {
  const res = await query(
    `select 1 from public.lobby_seats s
      join public.games g on g.lobby_id = s.lobby_id
     where g.id = $1 and s.user_id = $2`,
    [gameId, userId],
  );
  if (res.rowCount === 0) throw new Error('Not seated in this game');
}

export function initWs(server, config) {
  const { databaseUrl, privyAppId, arcRpcUrl, usdcContract, opPrivateKey, opAddress } = config;

  if (databaseUrl) {
    try {
      initDb(databaseUrl);
      dbInitialized = true;
      console.log('[ws] Database initialized');
    } catch (err) {
      console.error('[ws] Database init failed:', err.message);
    }
  } else {
    console.warn('[ws] DATABASE_URL not set — game engine calls will fail');
  }

  if (privyAppId) {
    try {
      initAuth(privyAppId);
      authInitialized = true;
      console.log('[ws] Auth initialized');
    } catch (err) {
      console.error('[ws] Auth init failed:', err.message);
    }
  } else {
    console.warn('[ws] PRIVY_APP_ID not set — auth will fail');
  }

  if (arcRpcUrl && usdcContract && opPrivateKey && opAddress) {
    initPayout(arcRpcUrl, usdcContract, opPrivateKey, opAddress);
    payoutInitialized = true;
    console.log('[ws] Payout module initialized');
  } else {
    console.warn('[ws] Payout module not initialized — missing Arc Testnet config');
  }

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    let authenticated = false;
    let currentUserId = null;
    let currentGameId = null;

    let pingTimer = null;
    let missedPongs = 0;

    function startHeartbeat() {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        missedPongs += 1;
        if (missedPongs >= 3) {
          try { ws.close(); } catch {}
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 30000);
    }

    function stopHeartbeat() {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      missedPongs = 0;
    }

    ws.on('pong', () => {
      missedPongs = 0;
    });

    startHeartbeat();

    async function handleMessage(msg) {
      // Message deduplication by (userId, message_id) with a 5-minute TTL.
      const messageId = msg.message_id;
      if (messageId) {
        if (isDuplicate(currentUserId, messageId)) return;
        markSeen(currentUserId, messageId);
      }

      try {
        switch (msg.type) {
          case 'join_game':
            currentGameId = msg.gameId;
            if (!rooms.has(currentGameId)) {
              rooms.set(currentGameId, new Set());
            }
            rooms.get(currentGameId).add(ws);
            ws.send(JSON.stringify({ type: 'joined_game', gameId: currentGameId }));
            break;

          case 'leave_game':
            if (currentGameId && rooms.has(currentGameId)) {
              rooms.get(currentGameId).delete(ws);
              if (rooms.get(currentGameId).size === 0) {
                rooms.delete(currentGameId);
              }
            }
            currentGameId = null;
            break;

          case 'spin': {
            if (!currentGameId) break;
            await assertSeated(currentGameId, currentUserId);
            const result = await withTransaction(async (client) => {
              return await spin(client, currentGameId, currentUserId);
            });
            ws.send(JSON.stringify({ type: 'spin_result', ...result }));
            await broadcastState(currentGameId, currentUserId);
            break;
          }

          case 'vote': {
            if (!currentGameId || !msg.choice) break;
            await assertSeated(currentGameId, currentUserId);
            const result = await withTransaction(async (client) => {
              return await vote(client, currentGameId, currentUserId, msg.choice);
            });
            ws.send(JSON.stringify({ type: 'vote_result', ...result }));
            await broadcastState(currentGameId, currentUserId);
            break;
          }

          case 'bet': {
            if (!currentGameId || !msg.roundId || !msg.direction || !msg.amount) break;
            await assertSeated(currentGameId, currentUserId);
            const result = await withTransaction(async (client) => {
              return await placeBet(
                client,
                currentGameId,
                msg.roundId,
                currentUserId,
                msg.direction,
                msg.amount,
              );
            });
            ws.send(JSON.stringify({ type: 'bet_result', ...result }));
            await broadcastState(currentGameId, currentUserId);
            break;
          }

          case 'settle': {
            if (!currentGameId) break;
            await assertSeated(currentGameId, currentUserId);
            const result = await withTransaction(async (client) => {
              return await settleRound(client, currentGameId, msg.force || false);
            });
            ws.send(JSON.stringify({ type: 'settle_result', ...result }));

            // Payout atomicity: settleRound inserts pending payouts.
            // Confirm on success, mark failed for retry on transfer failure.
            if (result.settled && result.pendingPayouts && payoutInitialized) {
              for (const p of result.pendingPayouts) {
                try {
                  const transfer = await transferUsdc(
                    await getUserWalletAddress(p.userId),
                    p.amount / 1e6,
                  );
                  await query(
                    `update public.payouts set status = 'confirmed', tx_hash = $1, confirmed_at = now()
                     where id = $2`,
                    [transfer.txHash, p.payoutId],
                  );
                  ws.send(JSON.stringify({
                    type: 'payout',
                    userId: p.userId,
                    amount: p.amount,
                    txHash: transfer.txHash,
                  }));
                } catch (err) {
                  console.error('[payout] failed for user', p.userId, err.message);
                  await query(
                    `update public.payouts set status = 'failed' where id = $1`,
                    [p.payoutId],
                  );
                }
              }
            }

            await broadcastState(currentGameId, currentUserId);
            break;
          }

          case 'claim': {
            if (!currentGameId) break;
            const result = await withTransaction(async (client) => {
              return await claimWinnings(client, currentGameId, currentUserId);
            });
            ws.send(JSON.stringify({ type: 'claim_result', ...result }));
            await broadcastState(currentGameId, currentUserId);
            break;
          }

          case 'get_state': {
            if (!currentGameId) break;
            const state = await withTransaction(async (client) => {
              return await snapshotGame(client, currentGameId, currentUserId);
            });
            ws.send(JSON.stringify({ type: 'state', snapshot: state }));
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
        }
      } catch (err) {
        console.error('[ws] handler error:', err);
        ws.send(JSON.stringify({ type: 'error', message: err.message || 'Internal error' }));
      }
    }

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      if (msg.type === 'auth') {
        try {
          const { userId } = await verifyPrivyToken(msg.token);
          authenticated = true;
          currentUserId = userId;
          userSockets.set(userId, ws);
          socketUserId.set(ws, userId);
          ws.send(JSON.stringify({ type: 'auth_ok', userId }));
          console.log(`[ws] user authenticated: ${userId}`);
          // Flush queued pre-auth messages in order
          const queue = socketQueues.get(ws) ?? [];
          socketQueues.delete(ws);
          for (const queued of queue) {
            await handleMessage(queued);
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
          ws.close();
        }
        return;
      }

      if (!authenticated) {
        // Queue messages sent before auth; reject unauthenticated game actions.
        const queue = socketQueues.get(ws) ?? [];
        queue.push(msg);
        socketQueues.set(ws, queue);
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
      }

      await handleMessage(msg);
    });

    ws.on('close', () => {
      stopHeartbeat();
      if (currentUserId) {
        userSockets.delete(currentUserId);
      }
      if (currentGameId && rooms.has(currentGameId)) {
        rooms.get(currentGameId).delete(ws);
        if (rooms.get(currentGameId).size === 0) {
          rooms.delete(currentGameId);
        }
      }
      socketUserId.delete(ws);
    });

    ws.on('error', (err) => {
      stopHeartbeat();
      console.error('[ws] socket error:', err);
    });
  });

  return wss;
}

async function broadcastState(gameId, excludingUserId = null) {
  if (!rooms.has(gameId)) return;

  const state = await withTransaction(async (client) => {
    // We need a userId for snapshot, but broadcast is to all. Use first socket's user.
    const firstSocket = [...rooms.get(gameId)][0];
    const uid = socketUserId.get(firstSocket);
    return await snapshotGame(client, gameId, uid);
  });

  const message = JSON.stringify({ type: 'state', snapshot: state });

  for (const client of rooms.get(gameId)) {
    if (client.readyState === WebSocket.OPEN) {
      if (excludingUserId && socketUserId.get(client) === excludingUserId) continue;
      client.send(message);
    }
  }
}

async function getUserWalletAddress(userId) {
  const result = await query(
    `select wallet_address from public.app_users where privy_user_id = $1`,
    [userId],
  );
  return result.rows[0]?.wallet_address || null;
}

export { rooms, userSockets, socketUserId };
