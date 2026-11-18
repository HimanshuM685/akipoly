# Akipoly — landing page

Single-page waitlist site for **Akipoly**, a GameFi project that reimagines the
classic property-trading board game with an arcade, neobrutalist twist.
Built with [Astro](https://astro.build) (static output, no server required).

## Develop

```sh
npm install
npm run dev       # local dev server
npm run build     # static build → dist/
npm run preview   # serve the build locally
```

Deploy `dist/` anywhere static (Vercel or Netlify recommended; both detect
Astro automatically). No environment variables are required for a static deploy.

## Wiring up the waitlist backend

The form is front-end only. Set `PUBLIC_WAITLIST_ENDPOINT` (see `.env.example`)
to a URL that accepts `POST { "email": string, "source": "landing-page" }` and
returns 2xx on success. When the variable is unset, the form runs in demo mode:
it validates, animates to a success state, and keeps the submission in this
browser's `localStorage` only — nothing is sent anywhere. `src/lib/waitlist.ts`
is the single integration seam.

## Structure

```
src/pages/index.astro      page shell + head
src/components/            Intro (opening splash), Nav, Hero, HeroArt,
                           TickerTape, About, Showcase, BoardMockup,
                           Waitlist, Footer, Logo
src/styles/global.css      design tokens (from design.md) + all styles
src/lib/waitlist.ts        waitlist integration seam
scripts/cdp-shot.mjs       dev-only: screenshot + overflow check via raw CDP
scripts/cdp-test.mjs       dev-only: drives the waitlist form (valid/invalid)
scripts/cdp-test-intro.mjs dev-only: splash open/Escape/deep-link behaviour
scripts/build-icons.mjs    dev-only: from the master logo PNG, keys the black
                           ground, locates the raccoon head, and emits the full
                           favicon set (16/32/48/180/192/512, maskable, pixel
                           favicon.svg, transparent wordmark + head)
```

Every fresh load opens on a full-screen splash (AKIPOLY + "we create monopoly
on arc" + waitlist CTA); it dismisses on Escape, scroll, backdrop press or the
close button, is skipped for deep links (`/#waitlist` etc.) and hidden without
JS. All illustration (besides the logo artwork) is original, hand-authored
inline SVG — no stock imagery. The icon set is generated from the user's
master logo (`E:\editshit\The AKI Chapter.png`) via `scripts/build-icons.mjs`.
Colours and spacing follow `design.md`; display type is **Chango** (the pinned
Brick Sans is commercial and unavailable; Archivo Black was the earlier
placeholder).

## Logo & icons

The master artwork is `E:\editshit\The AKI Chapter.png` (5000×5000, transparent).
`scripts/build-icons.mjs` crops the wordmark, isolates the raccoon head, and
emits `public/icons/` — favicon.svg (quantised pixel-art, ~58KB), favicon
16/32/48, apple-touch-icon, PWA icons 192/512, a maskable 512, and downscaled
wordmark/head PNGs used by the splash, nav and footer. Re-run it any time the
master file changes:

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
