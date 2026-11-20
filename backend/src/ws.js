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

let dbInitialized = false;
let authInitialized = false;
let payoutInitialized = false;

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
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
          ws.close();
        }
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
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
            const result = await withTransaction(async (client) => {
              return await spin(client, currentGameId, currentUserId);
            });
            ws.send(JSON.stringify({ type: 'spin_result', ...result }));
            await broadcastState(currentGameId, currentUserId);
            break;
          }

          case 'vote': {
            if (!currentGameId || !msg.choice) break;
            const result = await withTransaction(async (client) => {
              return await vote(client, currentGameId, currentUserId, msg.choice);
            });
            ws.send(JSON.stringify({ type: 'vote_result', ...result }));
            await broadcastState(currentGameId, currentUserId);
            break;
          }

          case 'bet': {
            if (!currentGameId || !msg.roundId || !msg.direction || !msg.amount) break;
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
            const result = await withTransaction(async (client) => {
              return await settleRound(client, currentGameId, msg.force || false);
            });
            ws.send(JSON.stringify({ type: 'settle_result', ...result }));

            // Handle payouts if settled and payout module initialized
            if (result.settled && result.winners && payoutInitialized) {
              for (const w of result.winners) {
                try {
                  const payout = await transferUsdc(
                    await getUserWalletAddress(w.user_id),
                    w.payout / 1e6,
                  );
                  await query(
                    `insert into public.payouts (game_id, round_id, user_id, amount_usdc, tx_hash, status)
                     values ($1, $2, $3, $4, $5, 'confirmed')`,
                    [currentGameId, result.round_id || null, w.user_id, w.payout, payout.txHash],
                  );
                  ws.send(JSON.stringify({
                    type: 'payout',
                    userId: w.user_id,
                    amount: w.payout,
                    txHash: payout.txHash,
                  }));
                } catch (err) {
                  console.error('[payout] failed for user', w.user_id, err.message);
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
    });

    ws.on('close', () => {
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
