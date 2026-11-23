# Akipoly — DESIGN.md

> How this project implements the pinned system at `E:\editshit\design.md` ("Arc Monopoly — Visual
> Design System", concept **Electric Playground**). This file documents the **built** system in
> `src/styles/global.css` and `src/components/WaitlistForm.astro`. The pinned file is the upstream
> source of truth for intent; differences are called out explicitly — do not treat this file as a
> fork of it.

## Creative direction

**World name:** Electric Playground — a bright neobrutalist arcade GameFi waitlist page. **One
action:** email → JOIN THE WAITLIST. **One line:** "Roll. Trade. Own the Arc." with a yellow marker
on "Own the Arc.". The home page is a split hero on a plain warm-ivory ground: copy and form on the
left, a flat sunburst medallion (rotating "ROLL • TRADE • OWN" ring around the wordmark) on the
right, then three Roll / Trade / Own cards and a scrolling ticker band. The page refuses category
defaults: no gradient-blob crypto hero, no 3D orb, no LED-grid gloss, no nav, no footer navigation.

**Revisions (user-directed, 2026-11-23) to earlier pins:**

- Tagline "we create monopoly on arc" → **"Roll. Trade. Own the Arc."**
- Single-screen / one-viewport structure and the 0.8 `zoom` → removed; the page is full size and
  scrolls slightly (hero + step cards + ticker).
- Display face Chango → Bagel Fat One → Pixelify Sans → **Jersey 25** (pixel-style, fine pixel grid
  so it stays readable); body face Space Grotesk → **Bricolage Grotesque**.
- Dot-grid background removed; floating 3D dice (Three.js canvas) removed.

## Colour

Tokens from `:root` — hex values are exact:

| Token | Value | Role in this build |
|---|---|---|
| `--color-primary` | `#FFF500` | Electric Yellow. JOIN THE WAITLIST button, input hard shadow, headline marker on "Own the Arc.", sunburst disc, "Roll" card, selection |
| `--color-secondary` | `#9DB7FB` | Periwinkle. Form card, sparkle |
| `--color-action` | `#FF6B4A` | Tangerine. Badge status dot |
| `--color-success` | `#B8F28B` | Lime Mint. Success panel, "Own" card |
| `--color-reward` | `#FF80B5` | Bubblegum Pink. "Trade" card, sparkle |
| `--color-special` | `#A78BFA` | Electric Violet. Decorative sparkle |
| `--color-ink` | `#171717` | Ink Black. Text, borders, hard shadows |
| `--color-paper` | `#FFFDF2` | Warm Ivory. Page ground (plain, no pattern) |
| `--color-white` | `#FFFFFF` | White. Email input |

Accent discipline: accents are flat fills only (no gradients). Yellow marks the primary action,
the headline marker and the medallion; periwinkle/pink/mint fill the form card and step cards.

**Focus rings:** light surfaces (paper/white) — `3px solid var(--color-ink)`, 3px offset; ink on
ivory/white is the highest-contrast pair in the system. Skip link (ink fill) — yellow ring.

Colour is never the sole carrier of state: errors carry icon + text + `aria-invalid`; success
carries a check glyph.

## Typography

| Token | Value | Use |
|---|---|---|
| `--font-display` | `"Jersey 25", "Arial Black", sans-serif` | Home headline, step-card titles, medallion ring text, ticker, docs emphasis words. Single weight (400) — never faux-bold it. |
| `--font-body` | `"Bricolage Grotesque", "Segoe UI", sans-serif` | Subline, labels, buttons, fineprint, legal |

Both load from Google Fonts with preconnect (index, docs and play pages). No other families.

- Headline `clamp(3.2rem, 7.4vw, 6rem)` / 1.02 · subline `clamp(1rem, 1.6vw, 1.15rem)` 500 ·
  legal 0.75rem (ink 60%) · fineprint 0.8rem
- Labels & buttons 0.78–0.95rem, 700, uppercase, ls 0.06–0.14em
- Body 16px / 1.6

Rules: sentence case for prose; uppercase only for short labels and buttons; two families max.

## Layout & spacing

- `main.page.home`: flex column, centred, `zoom: 1`, `min-height: calc(100dvh - 56px)` (the 56px is
  the ticker band), `overflow: clip`. The home styles live in the "Home page" section of
  `global.css` and are scoped under `.page.home`.
- Composition: `.home__hero` — 2-column grid (1.05fr / 0.95fr, max 1120px). Left `.home__copy`:
  badge → headline → subline → form card (max 560px). Right `.home__art`: medallion. Below: three
  `.home__step` cards (max 900px), legal line, then the `.home__ticker` band (56px, full bleed).
- Reading widths: form 560px; subline 44ch; legal 60ch.
- Body ground: plain Warm Ivory — no dot grid, no canvas, no gradients.
- 4px spacing scale: `--space-1..20` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.

## Visual language

**Borders:** `--border-width: 3px` solid ink everywhere.

**Shadows (hard offset only — never soft blur):**

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `5px 5px 0 var(--color-ink)` | JOIN THE WAITLIST button, success panel |
| `--shadow-hover` | `7px 7px 0 var(--color-ink)` | Button hover |
| `--shadow-pressed` | `2px 2px 0 var(--color-ink)` | Button active |
| `--shadow-float` | `8px 8px 0 var(--color-ink)` | Form card, medallion disc |

Inline variants: input `4px 4px 0 #FFF500`; headline marker `6px 6px 0 var(--color-ink)`; badge
`3px 3px 0`; wordmark `drop-shadow(4px 4px 0 ink)`.

**Radius:** `--radius-card: 10px`, `--radius-button: 8px`, `--radius-input: 8px`, `--radius-panel:
14px`, `--radius-badge: 6px`. The only pill is the "Waitlist open" badge; the medallion is a circle.

**Decoration vocabulary:** the official artwork leads — periwinkle bubble-letter wordmark, pixel
raccoon — set inside a flat sunburst disc (`repeating-conic-gradient` yellow/pale yellow, 3px ink
border, float shadow) with a rotating SVG `textPath` ring ("ROLL • TRADE • OWN"). Supporting: four
hand-authored SVG sparkles, a tilted yellow marker behind "Own the Arc." (−2°), slightly rotated
form card and step cards (yellow "Roll", pink "Trade", mint "Own"), and an ink ticker band.

**Anti-patterns (do not introduce):**

- No soft/blurred shadows — hard offset tokens only.
- No gradients or glassmorphism. (The sunburst is a flat hard-edged conic stripe pattern.)
- No 3D, WebGL canvases, floating objects, or dot/grid background patterns.
- Don't swap the display font for a coarse pixel face (Press Start 2P, Silkscreen, Pixelify at
  large sizes) — readability of the headline comes first.
- No bounce/elastic easing, no parallax. No nav or footer navigation.
- No invented claims in the step cards or subline (see Content rules).

## Components

Present in the repo:

- **index.astro** — the page: skip link, "?" explainer badge (top-right → `/docs`),
  "play" action chip directly below it (→ `/play`, new tab), decorative sparkles, `.home__hero`
  (badge "Waitlist open · Built on Arc", headline "Roll. Trade. Own the Arc.", subline,
  `.page__form.home__card` id `waitlist` wrapping `WaitlistForm`; medallion with h1 > wordmark
  image — 1 h1 only), `.home__steps` (Roll / Trade / Own cards), legal line, `.home__ticker`
  (aria-hidden, duplicated groups for a seamless loop), `Waterwave`, `CookieBanner`.
- **play.astro** (`/play`) — Privy-gated minigame seat on Arc Testnet. Static shell (back link,
  wordmark, sparkle, legal line) + a `Dashboard.tsx` React island (`client:only="react"`) wired
  to Privy (`PrivyProvider`, `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'`,
  `defaultChain: arcTestnet` from `viem/chains`). Logged out: "sign in to claim your seat." +
  yellow sign-in button. Logged in: "you're in." + wallet card (address + copy, USDC balance
  via `getBalance` on the Arc RPC, explorer link, sign out). Recipient of the landing page's
  "dashboard" chip (opens in a new tab).
- **docs.astro** (`/docs`) — the "what is this thing" explainer for the curious, in the same
  Electric Playground language as the home page: sticker-chip top bar, "the explainer" badge,
  headline with yellow marker + sunburst medallion (raccoon head, rotating ring), TL;DR sticker,
  sticky "on this page" nav (chip row ≤900px, active section via IntersectionObserver), six
  numbered section cards (coloured, striped header band; Buy / Build / Compete sticker trio;
  marker-pen `.docs__mark` highlights), a "ready to roll?" CTA card → `/`, the whitepaper
  sign-off + hidden jumpscare link (kept as-is), legal line, ticker band, and a fixed
  reading-progress bar. Cards rise in via CSS `animation-timeline: view()` where supported.
  No new claims, no invented dates, no tokenomics.
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
- Perpetual motion on the home page (all disabled under reduced motion): sparkles `twinkle
  2.2–3.4s`; badge dot `homePulse 1.6s`; wordmark `homeFloat 4.5s`; sunburst disc `homeSpin 60s`;
  ring text `homeSpin 40s reverse`; ticker `homeTicker 28s linear`. Step cards lift on hover
  (`translate(2px,−4px)`, shadow → 7px).
- Waterwave layers undulate ±26px while covering/uncovering; the overlay removes itself after
  `animationend` (900ms safety timeout).
- No parallax. The ticker is decorative (aria-hidden) and carries no information.

## Responsive

Breakpoints: **900px** (hero → single column, medallion first at ≤320px, copy centred), **760px**
(step cards stack, max 420px; form card un-rotated), **640px** (top-left sparkle repositions),
**620px** (form row → column, full-width button). Headline fluid via `clamp`. Do not invent more.
(Mobile layout has not yet been visually verified.)

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
- **Trademark ceiling:** the page copy no longer uses "monopoly". It survives only in the
  user-pinned X share caption in `WaitlistForm.astro` ("the first monopoly market on arc…").
  Everywhere else: "property-trading".
- **Arc** is a chain Akipoly is built on: name-drop it, never explain it, never invent chain claims.
- One primary action: JOIN THE WAITLIST. (The header chips "?" and "play" are secondary navigation.)

## Verification

Re-render / re-check (policy-managed Windows: prefix the build with the WASI fallback — see README):

```sh
NAPI_RS_FORCE_WASI=true npm run build   # policy-managed Windows
npm run build                            # ordinary machines → dist/
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
  rasters/SVG in `public/icons/` were generated from it.
- **npm audit** — high-severity advisories in build-time transitive deps (`picomatch` ReDoS); not
  shipped to browser; `--force` deliberately rejected (would downgrade Astro a major).
