/**
 * WebSocket protocol types shared by server and client.
 * Types only — no zod. The backend keeps its own zod schema file
 * (backend/src/shared/protocol.ts) that re-exports these types and adds
 * validation. Zod never ships to the browser.
 */

export type Direction = 'higher' | 'lower';
export type PayoutReason = 'refund' | 'pot' | 'side_win' | 'side_refund' | 'split';

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
  ball: number | null;
  seedHash: string;
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
  paidIn: string;
  won: string;
}

export type PayoutStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'held';

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
  players: {
    userId: string;
    displayName: string;
    placement: number | null;
    eliminatedRound: number | null;
  }[];
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
  | 'PAYMENT_PENDING'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface AuthOk {
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

export interface Ack {
  type: 'ack';
  reqId?: string;
  data?: unknown;
}

export interface ServerError {
  type: 'error';
  reqId?: string;
  code: ErrorCode;
  message: string;
}

export interface LobbiesMsg {
  type: 'lobbies';
  lobbies: LobbySummary[];
}

export interface LobbyMsg {
  type: 'lobby';
  lobby: LobbyView | null;
  serverNow: number;
}

export interface GameMsg {
  type: 'game';
  game: GameView;
  serverNow: number;
}

export interface CareerMsg {
  type: 'career';
  reqId?: string;
  games: CareerEntry[];
}

export interface PayoutMsg {
  type: 'payout';
  amount: string;
  reason: PayoutReason;
  txHash: string;
}

export type ServerMessage =
  | AuthOk
  | Ack
  | ServerError
  | LobbiesMsg
  | LobbyMsg
  | GameMsg
  | CareerMsg
  | PayoutMsg;

export type ClientMessageType =
  | 'auth'
  | 'lobbies.watch'
  | 'lobby.watch'
  | 'lobby.unwatch'
  | 'lobby.create'
  | 'lobby.join'
  | 'lobby.leave'
  | 'lobby.ready'
  | 'lobby.unready'
  | 'game.pick'
  | 'career.get'
  | 'game.review';

interface ClientMessageBase {
  reqId?: string;
}

export type ClientMessage =
  | ({ type: 'auth' } & ClientMessageBase & { token: string })
  | ({ type: 'lobbies.watch' } & ClientMessageBase)
  | ({ type: 'lobby.watch' } & ClientMessageBase & { lobbyId: string })
  | ({ type: 'lobby.unwatch' } & ClientMessageBase)
  | ({
      type: 'lobby.create';
    } & ClientMessageBase & {
      name: string;
      displayName: string;
      buyIn: string;
    })
  | ({ type: 'lobby.join' } & ClientMessageBase & { lobbyId: string; displayName: string })
  | ({ type: 'lobby.leave' } & ClientMessageBase & { lobbyId: string })
  | ({
      type: 'lobby.ready';
    } & ClientMessageBase & {
      lobbyId: string;
      txHash: string;
    })
  | ({ type: 'lobby.unready' } & ClientMessageBase & { lobbyId: string })
  | ({
      type: 'game.pick';
    } & ClientMessageBase & {
      gameId: string;
      roundNumber: number;
      direction: Direction;
      sideBet?: string;
      txHash?: string;
    })
  | ({ type: 'career.get' } & ClientMessageBase)
  | ({ type: 'game.review' } & ClientMessageBase & { gameId: string });
