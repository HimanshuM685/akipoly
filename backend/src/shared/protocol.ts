/**
 * WebSocket protocol shared by server and client.
 *
 * Client → server messages are zod schemas (the server validates every frame).
 * The web client only imports *types* from here, so zod never ships to the
 * browser. Money is always a string of USDC base units (6 decimals).
 */
import { z } from 'zod';

export { BALL_MAX, BALL_MIN, MAX_PLAYERS } from './constants.js';

export type Direction = 'higher' | 'lower';

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
export type ClientMessageType = ClientMessage['type'];

// ---------------------------------------------------------------------------
// Server → client views
// ---------------------------------------------------------------------------

export type LobbyStatus = 'waiting' | 'starting' | 'live' | 'finished' | 'cancelled';

export interface LobbySummary {
  id: string;
  name: string;
  buyIn: string;
  maxPlayers: number;
  status: LobbyStatus;
  playerIds: string[];
  createdAt: string;
}

export interface LobbyPlayerView {
  userId: string;
  displayName: string;
  ready: boolean;
}

export interface LobbyView {
  id: string;
  name: string;
  ownerUserId: string;
  buyIn: string;
  maxPlayers: number;
  status: LobbyStatus;
  /** ISO time the game starts once everyone is ready. */
  startsAt: string | null;
  gameId: string | null;
  players: LobbyPlayerView[];
}

export type RoundPhase = 'betting' | 'rolling' | 'settled';
export type RoundOutcome = 'higher' | 'lower' | 'push' | 'void' | 'opening';

export interface RoundView {
  number: number;
  phase: RoundPhase;
  prevBall: number | null;
  /** Present while rolling (bets are closed) and after. */
  ball: number | null;
  /** sha256(seed), published before bets close. */
  seedHash: string;
  /** Revealed once settled, so anyone can check the ball. */
  seed: string | null;
  phaseEndsAt: string;
  picksIn: number;
  sidePools: { higher: string; lower: string };
}

export interface GamePlayerView {
  userId: string;
  displayName: string;
  alive: boolean;
  eliminatedRound: number | null;
  placement: number | null;
  picked: boolean;
}

export interface RoundHistoryEntry {
  number: number;
  prevBall: number | null;
  ball: number;
  outcome: RoundOutcome;
}

export interface MyGameView {
  alive: boolean;
  pick: { direction: Direction; sideBet: string } | null;
}

export interface GameView {
  id: string;
  lobbyId: string;
  status: 'live' | 'finished';
  pot: string;
  fee: string;
  winnerUserId: string | null;
  round: RoundView | null;
  players: GamePlayerView[];
  history: RoundHistoryEntry[];
  me: MyGameView | null;
}

export interface CareerEntry {
  gameId: string;
  lobbyId: string;
  status: 'live' | 'finished';
  lobbyName: string;
  startedAt: string;
  endedAt: string | null;
  placement: number | null;
  eliminatedRound: number | null;
  buyIn: string;
  /** Buy-in plus accepted side bets. */
  paidIn: string;
  /** Pot/split payouts plus side-bet winnings and refunds. */
  won: string;
}

// ---------------------------------------------------------------------------
// Game review (career → click a game)
// ---------------------------------------------------------------------------

export type PayoutStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'held';

/** One USDC movement for the viewing player. in = player → treasury, out = treasury → player. */
export interface LedgerEntry {
  flow: 'in' | 'out';
  kind: 'buy_in' | 'side_bet' | PayoutReason;
  amount: string;
  txHash: string | null;
  status: PayoutStatus;
  roundNumber: number | null;
  at: string;
}

export interface ReviewRound {
  number: number;
  prevBall: number | null;
  ball: number;
  outcome: RoundOutcome;
  seed: string;
  seedHash: string;
  picks: { userId: string; direction: Direction; sideBet: string }[];
  eliminated: string[];
  sideResults: { userId: string; amount: string; reason: 'side_win' | 'side_refund' }[];
}

export interface GameReview {
  gameId: string;
  lobbyId: string;
  lobbyName: string;
  status: 'live' | 'finished';
  startedAt: string;
  endedAt: string | null;
  buyIn: string;
  pot: string;
  fee: string;
  winnerUserId: string | null;
  treasury: string;
  players: { userId: string; displayName: string; placement: number | null; eliminatedRound: number | null }[];
  /** Settled rounds only (seeds are never exposed before settle). */
  rounds: ReviewRound[];
  ledger: LedgerEntry[];
  me: { userId: string; placement: number | null; eliminatedRound: number | null };
}

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'NO_WALLET'
  | 'PAYMENT_INVALID'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type ServerMessage =
  | {
      type: 'auth_ok';
      reqId?: string;
      userId: string;
      walletAddress: string | null;
      network: 'testnet' | 'mainnet';
      treasury: string;
      limits: { minBuyIn: string; maxBuyIn: string; maxSideBet: string };
      timing: { bettingMs: number; rollingMs: number };
      serverNow: number;
    }
  | { type: 'ack'; reqId?: string; data?: unknown }
  | { type: 'error'; reqId?: string; code: ErrorCode; message: string }
  | { type: 'lobbies'; lobbies: LobbySummary[] }
  | { type: 'lobby'; lobby: LobbyView | null; serverNow: number }
  | { type: 'game'; game: GameView; serverNow: number }
  | { type: 'career'; reqId?: string; games: CareerEntry[] }
  | { type: 'payout'; amount: string; reason: PayoutReason; txHash: string };

export type PayoutReason = 'refund' | 'pot' | 'side_win' | 'side_refund' | 'split';
