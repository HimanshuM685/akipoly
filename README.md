# Akipoly — landing page

One screen. One action. **Akipoly**, a GameFi project that reimagines the
classic property-trading board game with an arcade, neobrutalist twist.
Static [Astro](https://astro.build) site — no server required.

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

Deploy `dist/` anywhere static (Vercel or Netlify recommended; both detect
Astro automatically). No environment variables are required.

## Wiring up the waitlist backend

The form is front-end only. Set `PUBLIC_WAITLIST_ENDPOINT` (see `.env.example`)
to a URL that accepts `POST { "email": string, "source": "landing-page" }` and
returns 2xx on success. When the variable is unset, the form runs in demo mode:
it validates, animates to a success state, and keeps the submission in this
browser's `localStorage` only — nothing is sent anywhere. `src/lib/waitlist.ts`
is the single integration seam.

## Structure

```
src/pages/index.astro          the page — one screen, one action
src/pages/docs.astro           /docs — the "what is this thing" explainer
src/components/WaitlistForm.astro  email form + success state + client script
src/components/CookieBanner.astro  one-line cookie note (localStorage ack)
src/components/Waterwave.astro     the rising-tide page transition between / and /docs
src/styles/global.css          design tokens (from design.md) + all styles
src/lib/waitlist.ts            waitlist integration seam
public/icons/                  generated icon set (see below)
scripts/cdp-shot.mjs           dev-only: screenshot + overflow check via raw CDP
scripts/cdp-test.mjs           dev-only: drives the waitlist form (valid/invalid)
scripts/build-icons.mjs        dev-only: regenerate icons from the master logo
scripts/cdp-test-wave.mjs      dev-only: waterwave / <-> /docs transition state machine
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
