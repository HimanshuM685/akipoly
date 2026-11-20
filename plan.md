# Plan.md — Akipoly Backend + Arc Implementation (Node.js)

## 1. Overview

Migrate the Akipoly minigame from polling-based Vercel serverless functions to a real-time WebSocket backend on a VPS, with full Arc Testnet USDC reward settlement.

**Current state:** Static Astro pages on Vercel + serverless API routes + Neon Postgres + Privy auth. Game state is polled every 1–3 seconds. No blockchain reward settlement.

**Target state:** Static Astro landing/docs on Vercel + Node.js WebSocket backend on VPS + Neon Postgres + Arc Testnet USDC settlement. Clients receive game state pushes over WebSocket; winners are paid in USDC on Arc Testnet.

---

## 2. System Architecture

```
Browser (Astro + React island)
    │ WSS (wss://vps:8080) + Privy JWT
    ▼
┌─────────────────────────────────────────┐
│         VPS (Node.js WebSocket)         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ WS Router   │  │  Room Manager   │  │
│  │ (auth, JWT) │  │  (game rooms)   │  │
│  └──────┬──────┘  └─────────┬───────┘  │
│         │                   │          │
│         └──────────┬────────┘          │
│                    ▼                   │
│           ┌───────────────┐            │
│           │  Game Engine  │            │
│           │  (JS port of  │            │
│           │   game.ts)    │            │
│           └──────┬────────┘            │
│                  │                     │
│         ┌────────▼────────┐            │
│         │     pg (pg)     │            │
│         └────────┬────────┘            │
│                  │                     │
│         ┌────────▼────────┐            │
│         │   Neon PG       │            │
│         │   (Arc Testnet  │            │
│         │    waitlist+)   │            │
└─────────┴─────────────────┘
                  │
                  │ USDC transfers (viem)
                  ▼
        ┌─────────────────────┐
        │   Arc Testnet       │
        │   USDC Contract     │
        │   (ERC-20)          │
        └─────────────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend language | Node.js (TypeScript) | Same language as frontend; `ws` and `pg` already in deps |
| WebSocket server | `ws` (already installed) | Simple, production-ready WS server |
| Database client | `pg` (already installed) | Neon Postgres driver |
| JSON | built-in `JSON` | Message serialization |
| JWT verification | `jose` (already installed) | Verify Privy identity tokens via JWKS |
| HTTP health check | `http` built-in | Simple health endpoint |
| Arc USDC transfers | `viem` (already installed) | Sign and broadcast ERC-20 transfers on Arc Testnet |
| Process manager | `pm2` or `systemd` | Keep Node process alive on VPS |
| Reverse proxy | `nginx` or `Caddy` | Terminate WSS, route static assets |

---

## 4. Arc Testnet Implementation

### 4.1 Network Configuration
- **Chain:** Arc Testnet
- **Chain ID:** 5042002
- **Native gas:** USDC
- **RPC:** Arc Testnet RPC endpoint
- **Explorer:** Arc Testnet explorer (for transaction links)

### 4.2 Wallet Model
Users sign in with Privy (email/social). Privy creates an embedded wallet automatically on first login (`createOnLogin: 'users-without-wallets'`).

The operator (Akipoly) maintains a **hot wallet** on Arc Testnet funded with USDC for payouts. Player wallet addresses come from Privy embedded wallets — read-only via `viem` on the frontend, linked in `app_users.wallet_address`.

### 4.3 USDC Contract
- **Token:** USDC on Arc Testnet
- **Contract address:** To be deployed/provided by Arc (ERC-20 standard)
- **Decimals:** 6 (standard USDC)
- **Operator approval:** Operator hot wallet must hold sufficient USDC balance

### 4.4 Reward Settlement Flow

```
Round settles in Node.js game engine
        │
        ▼
Winners identified + payout amounts calculated
        │
        ▼
USDC transfer(s) submitted to Arc Testnet via viem
        │
        ▼
Transaction hashes recorded in Neon (payouts table)
        │
        ▼
WebSocket broadcast: { type: "payout", userId, amount, txHash }
        │
        ▼
Client shows: "You won X USDC! Tx: 0x..."
```

### 4.5 Database Schema Additions (Neon)

```sql
CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL,  -- in USDC decimals (6dp)
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',  -- pending, confirmed, failed
    created_at TIMESTAMPTZ DEFAULT now(),
    confirmed_at TIMESTAMPTZ
);
```

### 4.5 Security Considerations
- **Operator hot wallet:** Never store private key in frontend. Keep in VPS env var. Limit hot wallet balance.
- **Withdrawal limits:** Per-game and per-day caps on operator payouts.
- **Idempotency:** Payouts keyed by `(game_id, round_id, user_id)` to prevent double-payment on retries.
- **Reconciliation:** Periodic job comparing Neon `payouts` table vs Arc Testnet USDC transfer history.

---

## 5. Backend Architecture (Node.js WebSocket)

### 5.1 Package Dependencies (already in package.json)
- `ws` — WebSocket server
- `pg` — Neon Postgres client
- `jose` — JWT verification for Privy
- `viem` — Arc Testnet USDC transfers

### 5.2 WebSocket Protocol

**Client → Server:**
```json
{ "type": "auth", "token": "<privy_identity_token>" }
{ "type": "spin", "gameId": "..." }
{ "type": "vote", "gameId": "...", "choice": "higher" }
{ "type": "bet", "gameId": "...", "roundId": "...", "direction": "higher", "amount": "10" }
{ "type": "claim", "gameId": "..." }
{ "type": "join_lobby", "lobbyId": "..." }
{ "type": "create_lobby", "name": "..." }
```

**Server → Client (broadcast to room):**
```json
{ "type": "state", "gameId": "...", "snapshot": { ...full GameSnapshot... } }
{ "type": "toast", "message": "Sarah was eliminated — guessed wrong." }
{ "type": "payout", "userId": "...", "amount": 500, "txHash": "0x..." }
{ "type": "error", "message": "..." }
```

### 5.3 Room Manager

```javascript
const rooms = new Map(); // gameId -> Set of WebSocket clients
const userSockets = new Map(); // userId -> WebSocket
```

On `auth`: join room based on lobby/game context. On game state change: broadcast snapshot to all clients in the room.

### 5.4 Auth Flow

1. Client connects via WSS
2. Client sends `{ type: "auth", "token": "<privy_jwt>" }`
3. Server fetches Privy JWKS from `https://auth.privy.io/api/v1/apps/{APP_ID}/jwks.json`
4. Verifies ES256 signature, issuer `privy.io`, audience = App ID
5. Extracts `sub` as `userId`
6. Associates `userId` with WebSocket connection
7. Subsequent messages require auth

---

## 6. Porting game.ts to Node.js

The existing `src/lib/server/game.ts` contains:
- `randomBall()` — rejection sampling 0–16
- `snapshotGame()` — full game state query
- `spin()`, `vote()`, `placeBet()`, `settleRound()`, `claimWinnings()`, etc.

**Node.js port plan:**
- Replace `pg` queries with same `pg` client (already used in API routes)
- Replace `randomBytes` with `crypto.randomBytes` (Node built-in)
- Keep identical SQL queries and business logic
- Same conditional SQL updates for concurrency safety (`for update`, conditional updates)

---

## 7. Frontend Changes (`LiveGame.tsx`)

**Remove:**
- `setInterval(load, 1200)` polling
- `fetch` calls to `/api/games/[id]/*`

**Add:**
- Single WebSocket connection on mount
- `wss://` to VPS
- Send `auth` token on connect
- Send `spin`, `vote`, `bet`, `claim` via WebSocket messages
- Render `state` snapshots as they arrive
- Render `toast` messages for eliminations
- Render `payout` messages for USDC wins

---

## 8. Deployment (VPS)

```
VPS (Ubuntu/Debian)
├── Node.js app: /opt/akipoly-game/server
├── process manager: pm2 or systemd
├── nginx: WSS termination on 443 → 8080
├── Env vars:
│   DATABASE_URL=postgres://...
│   PRIVY_APP_ID=...
│   PRIVY_JWKS_URL=https://auth.privy.io/api/v1/apps/{id}/jwks.json
│   ARC_RPC_URL=https://...
│   ARC_USDC_CONTRACT=0x...
│   OPERATOR_PRIVATE_KEY=0x...
│   OPERATOR_ADDRESS=0x...
│   WS_PORT=8080
```

---

## 9. Phased Rollout

| Phase | Task |
|-------|------|
| 1 | Node.js WebSocket server skeleton + Privy JWT verify |
| 2 | Port `game.ts` engine to Node.js + Neon connection |
| 3 | WebSocket room manager + broadcast |
| 4 | Frontend: replace polling with WebSocket |
| 5 | Arc Testnet USDC payouts + `payouts` table |
| 6 | Operator hot wallet funding + test transactions |
| 7 | Load testing + reconnection handling |
| 8 | Production deploy to VPS |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| WebSocket disconnect mid-game | Clients reconnect and re-fetch full state via REST fallback |
| Operator hot wallet compromised | Limit hot wallet balance; use multisig or cold storage for reserves |
| Double-spend on retry | Idempotency key on `(game_id, round_id, user_id)` in `payouts` |
| Neon DNS issues | Use pooler IP + SNI override in `pg` TLS config |
| Privy JWKS downtime | Cache JWKS keys with short TTL; fail closed on auth |
| Node.js single-thread blocking | Keep game logic synchronous and fast; DB queries are async |

---

## 11. Immediate Next Steps

1. Create `backend/` directory, `package.json` with dependencies
2. Implement `backend/src/auth.js` — Privy JWT verification
3. Implement `backend/src/db.js` — `pg` connection to Neon
4. Port `src/lib/server/game.ts` → `backend/src/game.js`
5. Implement `backend/src/ws.js` — WebSocket room manager + broadcast
6. Wire up `backend/src/index.js`
7. Update `LiveGame.tsx` to use WebSocket instead of polling
8. Add Arc USDC payout logic + `payouts` table migration

--- 

## 12. Backend File Structure

```
backend/
├── package.json
├── .env.example
├── src/
│   ├── index.js          # Entry point: HTTP + WS server
│   ├── auth.js           # Privy JWT verification
│   ├── db.js             # Neon Postgres client
│   ├── game.js           # Ported game engine (spin, vote, bet, settle)
│   ├── ws.js             # WebSocket room manager + broadcast
│   └── payout.js         # Arc Testnet USDC transfers via viem
├── migrations/
│   └── 001_payouts.sql   # Neon schema for payouts table
└── ecosystem.config.js   # pm2 config
```

--- 
