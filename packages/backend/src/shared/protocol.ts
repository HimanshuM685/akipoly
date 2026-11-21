/**
 * WebSocket protocol — backend side.
 * Imports shared types from @akipoly/shared/protocol and adds zod validation
 * schemas. Zod never ships to the browser.
 */

import { z } from 'zod';

export {
  BALL_MAX,
  BALL_MIN,
  MAX_PLAYERS,
} from './constants.js';

export type {
  Direction,
  LobbyStatus,
  LobbySummary,
  LobbyPlayerView,
  LobbyView,
  RoundPhase,
  RoundOutcome,
  RoundView,
  GamePlayerView,
  RoundHistoryEntry,
  MyGameView,
  GameView,
  CareerEntry,
  PayoutStatus,
  LedgerEntry,
  ReviewRound,
  GameReview,
  ErrorCode,
  ServerMessage,
  AuthOk,
  Ack,
  ServerError,
  LobbiesMsg,
  LobbyMsg,
  GameMsg,
  CareerMsg,
  PayoutMsg,
  PayoutReason,
  ClientMessageType,
} from '@akipoly/shared/protocol';

const uuid = z.string().uuid();
const baseUnits = z.string().regex(/^\d{1,18}$/, 'amount must be base units');
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'invalid tx hash');
const displayName = z.string().trim().min(1).max(32);
const reqId = z.string().max(64).optional();

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), reqId, token: z.string().min(10).max(8192) }),
  z.object({ type: z.literal('lobbies.watch'), reqId }),
  z.object({ type: z.literal('lobby.watch'), reqId, lobbyId: uuid }),
  z.object({ type: z.literal('lobby.unwatch'), reqId }),
  z.object({
    type: z.literal('lobby.create'),
    reqId,
    name: z.string().trim().min(1).max(64),
    displayName,
    buyIn: baseUnits,
  }),
  z.object({ type: z.literal('lobby.join'), reqId, lobbyId: uuid, displayName }),
  z.object({ type: z.literal('lobby.leave'), reqId, lobbyId: uuid }),
  z.object({ type: z.literal('lobby.ready'), reqId, lobbyId: uuid, txHash }),
  z.object({ type: z.literal('lobby.unready'), reqId, lobbyId: uuid }),
  z.object({
    type: z.literal('game.pick'),
    reqId,
    gameId: uuid,
    roundNumber: z.number().int().min(1),
    direction: z.enum(['higher', 'lower']),
    sideBet: baseUnits.optional(),
    txHash: txHash.optional(),
  }),
  z.object({ type: z.literal('career.get'), reqId }),
  z.object({ type: z.literal('game.review'), reqId, gameId: uuid }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
