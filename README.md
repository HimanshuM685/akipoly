# Akipoly — landing page

One screen. One action. **Akipoly**, a GameFi project that reimagines the
classic property-trading board game with an arcade, neobrutalist twist.
Astro site — static pages plus one serverless route (`/api/waitlist`).

The entire page: the official wordmark, the tagline "we create monopoly on
arc", the waitlist email form, and a minimal legal line. Built with
`design.md`'s "Electric Playground" system.

## Develop

```sh
npm install
npm run dev       # local dev server
npm run build     # static build → dist/
npm run preview   # serve the build locally
```

Deploy to Vercel (it detects Astro automatically). Set `DATABASE_URL` for the
waitlist function and `PUBLIC_PRIVY_APP_ID` for the dashboard; the site itself
is static otherwise.

## Wiring up the waitlist backend

The form posts to `/api/waitlist` — an Astro serverless function (Vercel) that
inserts into the Neon `waitlist` table. The database connection string lives in
the server-only `DATABASE_URL` env var (set it in the **Vercel project
settings**, never in `.env` that gets committed, never `PUBLIC_*`).

```sh
# Vercel → Project → Settings → Environment Variables:
DATABASE_URL=postgresql://neondb_owner:<password>@<pooler-endpoint>/neondb?sslmode=require&channel_binding=require
```

`.env.example` documents the var without real credentials. `PUBLIC_WAITLIST_ENDPOINT`
can override the endpoint (e.g. pointing a fork elsewhere). Without any setup,
the function returns 503 with a friendly message instead of crashing the page.

Local note: if your ISP refuses to resolve `*.neon.tech` (DNS `Query refused`),
local dev can target the pooler **IP** with `DATABASE_TLS_SERVERNAME` set to the
pooler hostname (certificate is still validated). On Vercel set `DATABASE_URL`
to the normal hostname URL and skip the `DATABASE_TLS_SERVERNAME` override —
that file (`.env`) is never committed either way.

## /play — the game (Privy + real Arc USDC)

`/play` is a React island gated by [Privy](https://docs.privy.io). First sign in
creates an embedded wallet on Arc. All game state lives in the WebSocket game
server in `backend/` (single authority for lobbies and games); the Astro site
only serves pages and the waitlist endpoint.

**Rules.** Anyone opens a table with a USDC buy-in; others join (max 10).
Pressing **Ready** pays the buy-in from the player's wallet to the treasury; the
server verifies the transfer on-chain. When ≥2 players are seated and all are
ready, a 3 s countdown starts the game. An opening ball rolls, then each round
every player still standing calls whether the next ball (00–16) is **higher or
lower** — optionally backing the call with a USDC side bet (pari-mutuel per
round). Wrong call or no call = out; same ball = push. Last player standing
takes the pot (minus `HOUSE_FEE_BPS`). Balls are provably fair: the server
publishes `sha256(seed)` before calls close and reveals the seed after.

**Network toggle.** `ARC_NETWORK` (server) and `PUBLIC_ARC_NETWORK` (site) pick
`testnet` (chain 5042002, free USDC from https://faucet.circle.com/) or
`mainnet` (chain 5042). USDC is the ERC-20 interface at
`0x3600000000000000000000000000000000000000` (6 decimals) on both.

Site env (`.env`, see `.env.example`): `PUBLIC_PRIVY_APP_ID`, `PUBLIC_WS_URL`,
`PUBLIC_ARC_NETWORK`. In the Privy dashboard, **enable identity tokens** — the
socket authenticates with them and reads the embedded wallet from them.

### Game server (`backend/`)

TypeScript, Node ≥20, Postgres (Neon pooled endpoint), viem.

```sh
cd backend
cp .env.example .env          # fill DATABASE_URL, PRIVY_APP_ID, TREASURY_PRIVATE_KEY…
npm ci
npm run migrate:dev           # 001_init DROPS the old game tables (keeps app_users)
npm run dev                   # ws://localhost:8081, /health, /ready
npm test                      # rule + fairness unit tests
```

**Production (Docker).** On the server, in `backend/`:

```sh
cp .env.example .env              # once: fill in the real values
docker compose up -d --build      # builds, applies pending migrations, starts; restarts on crash/reboot
docker compose logs -f            # logs
git pull && docker compose up -d --build   # update
```

The container listens on 8081 and is published on the host at `PORT` (or
`WS_PORT`) from `backend/.env`, default 8081. Migrations run on every start;
already-applied ones are skipped. Moving off pm2: run `pm2 delete akipoly-game`
once so the port is free.

```
backend/src/shared/        protocol (zod) + Arc network table, imported by the site too
backend/src/config/env.ts  validated env (fails fast)
backend/src/db/            pool (error-safe), migration runner, read-model views
backend/src/domain/        pure rules + provably-fair ball (unit tested)
backend/src/chain/usdc.ts  verify incoming USDC, sign/broadcast payouts
backend/src/services/      lobby + game state machines, payout queue/worker
backend/src/scheduler/     advances due rounds/countdowns (SKIP LOCKED, multi-instance safe)
backend/src/ws/            transport (rate limit, heartbeat), router, per-user push hub
```

Payouts are written in the same transaction that settles a round, then sent by
one worker that signs each transfer before broadcasting it (a crash can only
rebroadcast the same tx, never pay twice). Payouts above `MAX_AUTO_PAYOUT_USDC`
or that never land are marked `held` for manual review. The treasury is a
custodial hot wallet: keep it small and sweep it.

## Structure

```
src/pages/index.astro          the page — one screen, one action
src/pages/docs.astro           /docs — the "what is this thing" explainer
src/pages/play.astro           /play — Privy-gated game
src/pages/api/waitlist.ts      POST → insert into Neon `waitlist` (serverless)
src/components/Dashboard.tsx    the /play island (Privy, socket provider, screens)
src/components/dashboard/       lobby list, lobby room, live game, wallet, career
src/features/game/             socket client, USDC payment hook, ball reel, pick panel
src/lib/arc.ts                 Arc network config for the site (PUBLIC_ARC_NETWORK)
src/components/WaitlistForm.astro  email form + success state + client script
src/components/CookieBanner.astro  one-line cookie note (localStorage ack)
src/components/Waterwave.astro     the rising-tide page transition between / and /docs
src/styles/global.css          design tokens (from design.md) + all styles
src/lib/waitlist.ts            waitlist client seam
public/icons/                  generated icon set (see below)
```

All illustration is original (inline SVG sparkles; the logo artwork itself is
the user-supplied master at `E:\editshit\The AKI Chapter.png`). Colours and spacing follow `design.md`; display
type is **Chango** (the pinned Brick Sans is commercial and unavailable;
Archivo Black was the earlier placeholder).

## Notes

- `npm audit` reports high-severity advisories in build-time transitive deps
  (`picomatch` ReDoS). They are not shipped to the browser and the suggested
  `npm audit fix --force` would downgrade Astro across a major — evaluated and
  deliberately not applied.
- On policy-managed Windows machines where Application Control blocks the
  native `@astrojs/compiler-binding` `.node` binary, build with the WASI
  fallback: install `@emnapi/core`, `@emnapi/runtime`, `@tybys/wasm-util`,
  `@napi-rs/wasm-runtime` and `@astrojs/compiler-binding-wasm32-wasi` (versions
  matching this `package.json`'s Astro), then `NAPI_RS_FORCE_WASI=true npm run
  build`. Ordinary machines need none of this. Note: any `npm install`/`npm
  uninstall` PRUNES these manually-placed packages (and `pngjs`); re-extract
  them from `%TEMP%\opencode\wasm-binding` tarballs afterwards.
- `.impeccable/` holds the surface brief and review evidence; `.gemini/` was
  written by `npx impeccable install` and is not part of the app.
