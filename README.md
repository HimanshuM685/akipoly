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

## /dashboard (Privy auth, Arc Testnet)

`/dashboard` is a React island (Astro `@astrojs/react`, `client:only="react"`)
gated by [Privy](https://docs.privy.io). Sign in with email/social/external
wallet; a Privy-embedded wallet is created automatically on first sign in
(`createOnLogin: 'users-without-wallets'`) on **Arc Testnet** (chain id
5042002, native gas USDC, `viem/chains` provides `arcTestnet`). After login the
page shows the wallet address (copy), live USDC balance read straight from the
Arc RPC, the Arc explorer link, and sign out.

Required env var (copy `.env.example` to `.env`, which is git-ignored):

```sh
PUBLIC_PRIVY_APP_ID=cmwn8o8ul00cg0gjwj5ly4uex   # your app id — public by design
```

**The Privy App Secret is configuration we will never touch.** It must not
appear in `.env`, in source, or in any bundle; it belongs in a server-side
backend when one exists. (The owner pasted it once in chat — treat it as
compromised and rotate it in the Privy dashboard.)


## Structure

```
src/pages/index.astro          the page — one screen, one action
src/pages/docs.astro           /docs — the "what is this thing" explainer
src/pages/dashboard.astro      /dashboard — Privy-gated Arc Testnet seat
src/pages/api/waitlist.ts      POST → insert into Neon `waitlist` (serverless)
src/components/Dashboard.tsx    the /dashboard island (PrivyProvider, wallet, USDC balance)
src/components/WaitlistForm.astro  email form + success state + client script
src/components/CookieBanner.astro  one-line cookie note (localStorage ack)
src/components/Waterwave.astro     the rising-tide page transition between / and /docs
src/styles/global.css          design tokens (from design.md) + all styles
src/lib/waitlist.ts            waitlist client seam
public/icons/                  generated icon set (see below)
scripts/cdp-shot.mjs           dev-only: screenshot + overflow check via raw CDP
scripts/cdp-test.mjs           dev-only: drives the waitlist form (valid/invalid)
scripts/build-icons.mjs        dev-only: regenerate icons from the master logo
scripts/cdp-test-wave.mjs      dev-only: waterwave / <-> /docs transition state machine
scripts/db.mjs                 dev-only: direct Neon access (DNS-filtered networks)
scripts/db-schema.mjs          dev-only: Neon schema probe via serverless driver
```

All illustration is original (inline SVG sparkles; the logo artwork itself is
the user-supplied master at `E:\editshit\The AKI Chapter.png`, processed by
`scripts/build-icons.mjs`). Colours and spacing follow `design.md`; display
type is **Chango** (the pinned Brick Sans is commercial and unavailable;
Archivo Black was the earlier placeholder).

## Logo & icons

`scripts/build-icons.mjs` crops the wordmark, isolates the raccoon head, and
emits `public/icons/` — favicon.svg (quantised pixel-art), favicon 16/32/48,
apple-touch-icon, PWA icons 192/512, a maskable 512, and downscaled
wordmark/head PNGs used by the page and favicons:

```sh
node scripts/build-icons.mjs "E:\editshit\The AKI Chapter.png"
```

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
