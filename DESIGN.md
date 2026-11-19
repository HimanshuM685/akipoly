# Akipoly — DESIGN.md

> How this project implements the pinned system at `E:\editshit\design.md` ("Arc Monopoly — Visual
> Design System", concept **Electric Playground**). This file documents the **built** system in
> `src/styles/global.css` and `src/components/WaitlistForm.astro`. The pinned file is the upstream
> source of truth for intent; differences are called out explicitly — do not treat this file as a
> fork of it.

## Creative direction

**World name:** Electric Playground — a bright neobrutalist arcade GameFi waitlist page. **One
viewport, one action.** **One line:** the official wordmark on a warm-ivory dot grid, the user-pinned
line "we create monopoly on arc" with a yellow marker on "monopoly", and email → JOIN THE WAITLIST.
The page refuses category defaults: no gradient-blob crypto hero, no orb, no LED-grid gloss, no
scroll-to-learn marketing page, no nav, no footer navigation. One action, one page.

**Upstream deviations (deliberate, user-pinned):**

- Display face is **Chango** — not the upstream Brick Sans (commercial, unavailable), not the
  earlier Archivo Black placeholder; user picked Chango 2026-11-18. (Chango is used sparingly — the
  artwork itself carries the display voice; only the fine print and panel headings are set in the
  body face.)
- The single-screen structure is user-pinned (2026-11-18): logo, tagline, email form, legal line.
  Upstream sections (hero/about/showcase/nav/footer) were removed by explicit user decision.

## Colour

Tokens from `:root` — hex values are exact:

| Token | Value | Role in this build |
|---|---|---|
| `--color-primary` | `#FFF500` | Electric Yellow. JOIN THE WAITLIST button, input hard shadow, headline marker on "monopoly", selection |
| `--color-secondary` | `#9DB7FB` | Periwinkle. Decorative sparkle |
| `--color-action` | `#FF6B4A` | Tangerine. Reserved |
| `--color-success` | `#B8F28B` | Lime Mint. Success panel |
| `--color-reward` | `#FF80B5` | Bubblegum Pink. Decorative sparkle |
| `--color-special` | `#A78BFA` | Electric Violet. Decorative sparkle |
| `--color-ink` | `#171717` | Ink Black. Text, borders, hard shadows |
| `--color-paper` | `#FFFDF2` | Warm Ivory. Page ground (with dot grid) |
| `--color-white` | `#FFFFFF` | White. Email input |

Accent discipline: the four accents appear at most once each as corner sparkles. Yellow is
reserved for the single action and the one marker behind "monopoly".

**Focus rings:** light surfaces (paper/white) — `3px solid var(--color-ink)`, 3px offset; ink on
ivory/white is the highest-contrast pair in the system. Skip link (ink fill) — yellow ring.

Colour is never the sole carrier of state: errors carry icon + text + `aria-invalid`; success
carries a check glyph.

## Typography

| Token | Value | Use |
|---|---|---|
| `--font-display` | `"Chango", "Arial Black", sans-serif` | The three buy/build/compete emphasis words in the docs list. Everything else is set in the body face; the artwork carries the display voice. |
| `--font-body` | `"Space Grotesk", "Segoe UI", sans-serif` | Everything set in type: tagline, labels, buttons, fineprint, legal |

Both load from Google Fonts with preconnect. No other families.

- Tagline `clamp(1.05rem, 3vw, 1.4rem)` 700 · legal 0.75rem (ink 60%) · fineprint 0.8rem (ink 62%)
- Labels & buttons 0.78–0.95rem, 700, uppercase, ls 0.06–0.14em
- Body 16px / 1.6

Rules: sentence case for prose; uppercase only for short labels and buttons; two families max.

## Layout & spacing

- `.page`: `height: 100%` of `html, body { height: 100% }`, flex column, centred, `overflow: auto`
  (scrolls internally only on very short viewports), fluid vertical padding. **The whole
  composition renders at `zoom: 0.8`** (user-pinned 2026-11-18 — "make everything 0.2x smaller;
  it'll add more empty spaces around"). Viewport units are not used for height for exactly this
  reason. The skip link sits outside the zoomed shell and stays full size. Do not "fix" the
  whitespace or the zoom.
- Composition order: h1 > wordmark → tagline → form (560px max) → fineprint, legal line pinned to
  the bottom via `margin-top: auto`.
- Reading widths: form 560px; legal 60ch.
- Body ground: `radial-gradient(rgba(23,23,23,0.09) 1.4px, transparent 1.4px)` at 26px — a dot
  **pattern**, not a colour gradient.
- 4px spacing scale: `--space-1..20` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.

## Visual language

**Borders:** `--border-width: 3px` solid ink everywhere.

**Shadows (hard offset only — never soft blur):**

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `5px 5px 0 var(--color-ink)` | JOIN THE WAITLIST button, success panel |
| `--shadow-hover` | `7px 7px 0 var(--color-ink)` | Button hover |
| `--shadow-pressed` | `2px 2px 0 var(--color-ink)` | Button active |
| `--shadow-float` | `8px 8px 0 var(--color-ink)` | Available for ink panels (currently unused) |

Inline variants: input `4px 4px 0 #FFF500`; "monopoly" marker `4px 4px 0 var(--color-ink)`.

**Radius:** `--radius-card: 10px`, `--radius-button: 8px`, `--radius-input: 8px`, `--radius-panel:
14px`, `--radius-badge: 6px`. No pills.

**Decoration vocabulary:** the official artwork is the whole show — periwinkle bubble-letter
wordmark, pixel raccoon. Supporting: four hand-authored SVG sparkles (pink TL, periwinkle TR, lime
BL, violet BR), repositioned slightly at ≤640px, and the yellow marker behind "monopoly" at −1°.

**Anti-patterns (do not introduce):**

- No soft/blurred shadows — hard offset tokens only.
- No gradients or glassmorphism (the body dot grid is a pattern, not a gradient; keep it).
- No eyebrow kickers above headings.
- No auto-scroll content of any kind. No bounce/elastic easing, no parallax.
- No extra sections. The shape is pinned; do not re-add nav, hero, About, Showcase or a footer.

## Components

Present in the repo:

- **index.astro** — the page: skip link, "?" explainer badge (top-right → `/docs`),
  "dashboard" action chip directly below it (→ `/dashboard`, new tab), decorative
  sparkles, h1 > wordmark image (1 h1 only), tagline, `.page__form` (id `waitlist`), legal line,
  `WaitlistForm`, `CookieBanner`.
- **dashboard.astro** (`/dashboard`) — Privy-gated seat on Arc Testnet. Static shell (back link,
  wordmark, sparkle, legal line) + a `Dashboard.tsx` React island (`client:only="react"`) wired
  to Privy (`PrivyProvider`, `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'`,
  `defaultChain: arcTestnet` from `viem/chains`). Logged out: "sign in to claim your seat." +
  yellow sign-in button. Logged in: "you're in." + wallet card (address + copy, USDC balance
  via `getBalance` on the Arc RPC, explorer link, sign out). Recipient of the landing page's
  "dashboard" chip (opens in a new tab).
- **docs.astro** (`/docs`) — the "what is this thing" explainer for the curious: TL;DR card,
  plain-language sections (the short version / what you actually do / why Arc / who it's for /
  when it launches / the fine print), a JOIN THE WAITLIST button back to `/`, and its own legal
  line. No new claims, no invented dates, no tokenomics.
- **CookieBanner** — one-line honest note ("We don't do creepy tracking cookies. One localStorage
  note so we don't nag you. That's it.") with a single GOT IT action; dismissal persists in
  `localStorage` (`akipoly:cookie-ack`); `role="region"` + label; reduced-motion safe.
- **WaitlistForm** — `#waitlist-form`. Label "Email address"; white 56px input (3px ink border,
  yellow hard shadow); inline error `.field__error` (`role="alert"`, icon + #a33a2a text,
  `#ffe9e2` fill); submit `.btn.btn--lg` (spinner + "Rolling…" while running); `.form-alert`
  on failure (`role="alert"`); fineprint. Success state `.wl-success` (lime, `role="status"`,
  focus moved here) with share link ("Spread the word" → X intent, preloaded caption — user-pinned:
  "the first monopoly market on arc, and we are already in. where rest of y'all at? @akipolyhq is
  here." — origin appended from `window.location.origin`, opens in a new tab).
  Logic in the component script; seam `src/lib/waitlist.ts`; env `PUBLIC_WAITLIST_ENDPOINT`.
  Unset ⇒ demo mode: validates, animates to success, stores in `localStorage` only.
- **Waterwave** — the full-screen takeover tide between `/` and `/docs`. Fixed full-viewport
  overlay, Electric Yellow sky flood + two sine wave bands (periwinkle over ink) that completely
  cover the screen at the peak of a navigation. Clicking an internal link to `/` or `/docs` plays
  `wave-cover` (520ms, tide rises), sets `akipoly:wave-nav` in sessionStorage, and navigates;
  the incoming page's pre-paint inline head script adds `wave-pending` so it starts covered,
  then `wave-uncover` drains the tide (620ms). Modifier-key clicks are respected; without JS or
  with reduced motion it's a plain full-page load; `pointer-events: none` except mid-transition.

## Motion

- Button hover 160ms ease; press physics: hover `translate(2px,−2px)` shadow → 7px; active
  `translate(3px,3px)` shadow → 2px. Spin 700ms for the loading spinner. Success `pop 320ms
  cubic-bezier(0.16, 1, 0.3, 1)`.
- **Reduced motion**: `html` scroll-behavior auto; all animations/transitions forced to `0.01ms`,
  iteration count 1; the waterwave transition is skipped entirely (plain navigation).
- Landing sparkles `twinkle 2.2–3.4s ease-in-out infinite` (scale/rotate/opacity pulse,
  staggered via `.twinkle--2/3/4`) — the only perpetual motion on the page besides the spinner.
- Waterwave layers undulate ±26px while covering/uncovering; the overlay removes itself after
  `animationend` (900ms safety timeout).
- No loops over content, no auto-scroll, no parallax.

## Responsive

Breakpoints: **640px** (top-left sparkle repositions), **620px** (form row → column, full-width
button). Logo/tagline fluid via `clamp`; `overflow-x: clip` on body. These are the only
breakpoints — do not invent more.

## Accessibility

- Skip link → `#main` (ink fill, yellow ring on focus).
- One `h1` (the wordmark). Sparkles + all decorative SVG are `aria-hidden="true"`.
- Form: `label for`, `autocomplete="email"`, `inputmode="email"`, `aria-describedby`, error gets
  `aria-invalid="true"` only when invalid, `role="alert"` on error/failure; `novalidate`.
- Icon-only share/close controls carry labels or visible text; touch targets ≥ 44×44px.
- Explicit `:focus-visible` rings everywhere (colours per Colour); never removed.
- Colour never sole carrier of meaning; reduced motion honoured; selection yellow on ink;
  `theme-color #FFF500`; `lang="en"`.

## Content rules

- **Voice:** playful, confident, short, funny where it earns it. No hype decks, no "unleash", no
  corporate Web3 tone, no AI-slop phrasing.
- **No invented claims:** no launch date, token details/economics, social metrics, testimonials,
  press, user counts. "One email when we launch" is the only launch promise on the page.
- **Trademark ceiling:** "monopoly" appears **only** inside the user-pinned opening line "we create
  monopoly on arc", lowercase, exactly as the user wrote it. Everywhere else: "property-trading".
- **Arc** is a chain Akipoly is built on: name-drop it, never explain it, never invent chain claims.
- One action, one page: JOIN THE WAITLIST. There is no second action.

## Verification

Re-render / re-check (policy-managed Windows: prefix the build with the WASI fallback — see README):

```sh
NAPI_RS_FORCE_WASI=true npm run build   # policy-managed Windows
npm run build                            # ordinary machines → dist/
node scripts/cdp-shot.mjs <url> <out.png> <w> <h>   # screenshot + overflow check
node scripts/cdp-test.mjs                # waitlist valid/invalid paths via CDP
```

Expected: clean build, no horizontal overflow, no console errors, waitlist error → success paths
work. Astro `^7.4.12`, static output.

## Open items

- **Waitlist backend seam** — `PUBLIC_WAITLIST_ENDPOINT` (`.env.example`). Unset ⇒ demo mode
  (localStorage only). Endpoint must accept `POST { "email": string, "source": "landing-page" }`,
  return 2xx on success. `src/lib/waitlist.ts` is the single integration point.
- **Placeholder legal line** — footer copyright entity not yet supplied; uses © year +
  not-affiliated notice. No social links exist on the one-screen page by design.
- **Official artwork provenance** — master is `E:\editshit\The AKI Chapter.png`; all derived
  rasters/SVG in `public/icons/` come from `scripts/build-icons.mjs`.
- **npm audit** — high-severity advisories in build-time transitive deps (`picomatch` ReDoS); not
  shipped to browser; `--force` deliberately rejected (would downgrade Astro a major).
