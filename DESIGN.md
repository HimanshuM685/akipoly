# Akipoly — DESIGN.md

> How this project implements the pinned system at `E:\editshit\design.md` ("Arc Monopoly — Visual
Design System", concept **Electric Playground**). This file documents the **built** system in
`src/styles/global.css` and `src/components/*.astro`. The pinned file is the upstream source of
truth for intent; differences are called out explicitly — do not treat this file as a fork of it.

## Creative direction

**World name:** Electric Playground — reimagined as a bright neobrutalist arcade GameFi landing
page ("the feeling of the roll", per the surface brief
`.impeccable/surfaces/src-pages-index-astro.md`). **One line:** warm ivory ground with an ink dot
grid, flat white cards, 3px ink borders and 5px hard offset shadows, one yellow headline plate, a
hand-authored SVG board world, and a single primary action everywhere — JOIN THE WAITLIST. The
page refuses category defaults: no gradient-blob crypto hero, no orb, no LED-grid gloss, no soft
pastel gamification. Web3 is background detail, never the hook; every CTA routes to the waitlist
(`EXPLORE AKIPOLY` scrolls to the showcase).

**Upstream deviations (deliberate, user-pinned):**
- Display face is **Chango** — not the upstream Brick Sans (commercial, unavailable), not the
  earlier Archivo Black placeholder; user picked Chango 2026-11-18.
- Upstream "floating panel" shadow is reused for ink panels; everything else uses the pinned
  shadow set.

## Colour

Tokens from `:root` — hex values are exact:

| Token | Value | Role in this build |
|---|---|---|
| `--color-primary` | `#FFF500` | Electric Yellow. Primary CTA, hero/intro headline plates, ticker strip, selection, waitlist accents |
| `--color-secondary` | `#9DB7FB` | Periwinkle. Secondary CTA, SVG backdrop shapes |
| `--color-action` | `#FF6B4A` | Tangerine. `.btn--accent`, board tiles |
| `--color-success` | `#B8F28B` | Lime Mint. Success panel, check badges, board tiles |
| `--color-reward` | `#FF80B5` | Bubblegum Pink. WAITLIST OPEN / RENT DUE stickers, sparkles |
| `--color-special` | `#A78BFA` | Electric Violet. BANK/TAX tiles, CONCEPT ART sticker |
| `--color-ink` | `#171717` | Ink Black. Text, all borders, all hard shadows, dark panels |
| `--color-paper` | `#FFFDF2` | Warm Ivory. Page ground (with dot grid), intro splash, light text on dark |
| `--color-white` | `#FFFFFF` | White. Cards, inputs, die face |

Inline dark-surface tints (not tokens): `rgba(255,253,242,0.85)` panel copy; `0.72` / `0.62` /
`0.6` fine print & meta; `0.22` / `0.2` hairline dividers. On light: `rgba(23,23,23,0.78)` hero
note, `0.88` card copy, `0.66` caption, `0.45` placeholder. Error/alert on dark: `#ffc0ae` text,
`#ffe9e2` fill, `#2a2a2a` surface / `#ffb4a0` border.

**Accent discipline:** the four accents are used sparingly — never all four in one component.
Yellow is reserved for the primary action and the one headline plate it shares.

**Focus-ring colours and why:**
- Light surfaces (paper/white): `3px solid var(--color-ink)`, offset 2–3px — ink on ivory/white is
  the highest-contrast pair in the system.
- Dark panels (waitlist, footer): `var(--color-primary)` — ink would vanish on ink; yellow-on-ink
  matches the panel accent.
- Success panel & share control: `var(--color-success)` — lime on ink, keeping colour meaning
  consistent. The skip link (ink fill) uses yellow.

Colour is never the sole carrier of state: errors carry icon + text + `aria-invalid`; success
carries a check glyph.

## Typography

| Token | Value | Use |
|---|---|---|
| `--font-display` | `"Chango", "Arial Black", sans-serif` | Display statements, section titles, wordmark, board SVG lettering |
| `--font-body` | `"Space Grotesk", "Segoe UI", sans-serif` | Everything else |

Both load from Google Fonts (`Chango`; `Space Grotesk` 400–700) with preconnect. No other
families.

Scale actually implemented (fluid `clamp`):
- Hero h1 `clamp(2.4rem, 4.6vw, 3.55rem)` lh 1.02 · `.section-title` `clamp(2rem, 5.2vw, 3.25rem)`
  lh 0.98 · waitlist title `clamp(2.4rem, 6.5vw, 4.25rem)` lh 0.95 · intro logo `clamp(3rem, 15vw,
  6.6rem)`; tagline `clamp(1.05rem, 3.4vw, 1.5rem)`
- Body 16px / 1.6; lead copy 1.125rem / 1.55
- Labels & buttons 0.78–0.85rem, 700, uppercase, ls 0.06–0.1em (0.24em for the in-panel "The
  Details" label — body font, not display); nav links 0.8rem

Rules: tight leading on display type; sentence case for prose; uppercase only for short labels,
buttons, stickers, board tiles; two families max; Chango never sets body copy.

## Layout & spacing

- `.container`: `width: min(1200px, 100% - clamp(2.5rem, 6vw, 6rem))`, centred.
- `.section`: `padding-block: clamp(56px, 9vw, 96px)`; `scroll-margin-top: calc(var(--nav-height)
  + 8px)`; `--nav-height: 72px`; sticky nav, 3px ink bottom border.
- 4px spacing scale: `--space-1..20` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.
- Hero grid `1.3fr / 0.7fr` → 1fr ≤1150px; about why-band `7fr / 5fr` → 1fr ≤1100px; cards 3-up →
  1fr ≤820px.
- Reading widths: `.section-copy` 56ch; `.hero__sub` 34ch (48ch ≤1150px); about copy 58–62ch;
  `.waitlist__copy` 46ch; form max 560px.
- Body ground: `radial-gradient(rgba(23,23,23,0.09) 1.4px, transparent 1.4px)` at 26px — a dot
  **pattern**, not a colour gradient.

## Visual language

**Borders:** `--border-width: 3px` solid ink everywhere; emphasis borders in SVG art run 4–6px.
1px hairlines only as dividers on dark.

**Shadows (hard offset only — never soft blur):**

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `5px 5px 0 var(--color-ink)` | Buttons, cards, hero plate |
| `--shadow-hover` | `7px 7px 0 var(--color-ink)` | Button/card hover |
| `--shadow-pressed` | `2px 2px 0 var(--color-ink)` | Button/close active |
| `--shadow-float` | `8px 8px 0 var(--color-ink)` | Ink panels |

Inline variants: feature-card icon 4px, waitlist input `4px 4px 0 #FFF500`, success panel `6px 6px
0 var(--color-primary)`, input focus shadow transition 150ms.

**Radius:** `--radius-card: 10px`, `--radius-button: 8px`, `--radius-input: 8px`, `--radius-panel:
14px`, `--radius-badge: 6px`. No pills.

**Decoration vocabulary (hand-authored inline SVG, flat, thick outlines):** tile-ring board (ivory
board, coloured ring, corner tiles JAIL / BANK / TAX / GO, yellow or ink centre tile AKIPOLY +
ROLL · TRADE · OWN); white die showing five leaning on the board's bottom-right corner; "A" coins;
sparkles/star polygons; rotated stickers with offset hard shadows: "WAITLIST OPEN" (pink, hero),
"CONCEPT ART" (violet, showcase), "RENT DUE! +200" (pink, showcase); yellow headline plate at −1°
(hero + intro); squiggle underline; backdrop circles and rotated yellow blocks. Art is labelled
concept art in-copy.

**Anti-patterns (do not introduce):**
- No soft/blurred shadows — only hard offset tokens above.
- No gradients or glassmorphism (the body dot grid is a pattern, not a gradient; keep it).
- No eyebrow kickers above section titles (the in-panel "The Details" label is a panel heading,
  not a kicker).
- No auto-scroll marquee — the ticker strip is static by design.
- No bounce/elastic easing, no parallax, no looping motion other than the art `bob` (which yields
  to reduced motion).

## Components

Present in `src/components/`:

- **Logo** — pixel raccoon head (`/icons/akipoly-head@96.png`) + Chango AKIPOLY
  wordmark; `variant="dark" | "light"` (light = paper wordmark on ink); → `#top`.
  Wordmark artwork (user-supplied master `The AKI Chapter.png`) ships cropped and
  downscaled in `public/icons/` for the splash and favicon set.
- **Nav** — sticky, paper, ink bottom border. Links: About, How It Looks; CTA `.btn.nav__cta`
  (44px min-height) → `#waitlist`. Links hidden ≤640px.
- **Hero** — `#top`. h1 ROLL THE DICE. / OWN THE BOARD. (`.hero__hl` yellow plate, −1°,
  `--shadow-card`); sub copy; CTAs (`.btn--lg` yellow primary; `.btn--secondary` periwinkle);
  lime-check note "Free to join. No wallet needed."; HeroArt with bobbing WAITLIST OPEN sticker.
- **TickerTape** — static yellow strip, ink top/bottom borders, Chango `BUY ◆ BUILD ◆ COMPETE ◆
  TRADE ◆ ROLL ◆ OWN`, `aria-hidden="true"`.
- **About** — `#about`. Why band: two paragraphs (the social engine of property trading, rebuilt
  on Arc) + `.details` ink panel (ON ARC / WITH YOUR PEOPLE / YOURS TO KEEP). Cards BUY / BUILD /
  COMPETE (`.feature-card.card--lift`; icon chips lime/periwinkle/pink, 4px ink shadow).
- **Showcase** — `#showcase`, padding-top 0. "THE BOARD IS YOURS." + BoardMockup (concept board;
  fanned cards Pier 9 / Marina Mile / Rooftop Row; CONCEPT ART and RENT DUE stickers); caption
  "Mockups, not screenshots — the real board lands when the game does."
- **Waitlist** — `#waitlist`. Ink panel (`--radius-panel`, `--shadow-float`): title GET FIRST
  DIBS., copy, deco sparkles (hidden ≤620px). Two mutually exclusive states:
  - Form: label "Email address", white input (56px, 3px ink border, yellow hard shadow), inline
    error `.field__error` (`role="alert"`, icon + text, `#ffe9e2` fill), submit
    `.btn.waitlist__submit` (spinner + "Rolling…"), `.form-alert` on failure (`role="alert"`),
    fineprint.
  - Success: `.waitlist__success` lime panel (`role="status"`, focus moved here), share button
    ("Spread the word" → clipboard, reverts after 2s).
  - Logic in the component script; seam `src/lib/waitlist.ts`; env `PUBLIC_WAITLIST_ENDPOINT` (see
    Open items). Unset ⇒ demo mode: validates, animates to success, stores in `localStorage` only.
- **Footer** — ink ground, `Logo variant="light"`, tagline "Own the board. Make your move."; three
  social icon buttons (X / Instagram / YouTube, `aria-label`s, `rel="me"`, `href="#"`
  placeholders); bottom bar © year + not-affiliated notice.
- **Intro (splash)** — Full-screen, `role="dialog" aria-modal="true"`, labelled "Akipoly — we
  create monopoly on Arc". AKIPOLY wordmark, tagline "we create **monopoly** on arc" (pinned line,
  lowercase), yellow JOIN THE WAITLIST CTA, close button (`aria-label`), sparkles. `inert` on
  `#page-shell` + `html.intro-open` freezes scroll; dismisses on Escape / scroll / touchmove /
  backdrop press / close button; focus returns to `hero-title` (or `#waitlist` via its CTA); deep
  links remove it pre-paint; no-JS hides it (`noscript`); reduced motion removes its transition
  and the 380ms delay.

**Buttons** (`.btn`): inline-flex, 48px min-height (`.btn--lg` 56px); variants `.btn--secondary`
(periwinkle), `.btn--accent` (tangerine); disabled = 55% opacity, no shadow, no transform.

## Motion

- Hovers 140–180ms ease (`.btn` 160, card 180, nav link 140, others 150).
- **Press physics:** hover lifts `translate(2px, −2px)`, shadow → 7px; active presses
  `translate(3px, 3px)`, shadow → 2px; cards lift `translate(2px, −3px)`.
- Intro: `transform`/`opacity` 340ms `cubic-bezier(0.16, 1, 0.3, 1)` slide-up (`.intro--closing`,
  −102%); removal after 380ms (0ms reduced).
- Art `bob 4.2s ease-in-out infinite` (`translateY 0 → −10px`, `transform-box: fill-box`) — the
  only looping animation.
- Success `pop 320ms cubic-bezier(0.16, 1, 0.3, 1)` (scale .92 → 1); spinner `spin 700ms linear
  infinite`.
- **Reduced motion** (`@media (prefers-reduced-motion: reduce)`): `html` scroll-behavior auto; all
  animations/transitions forced to `0.01ms`, iteration count 1; intro transition removed.
- No auto-scroll, marquee, parallax, or bounce.

## Responsive

Breakpoints actually in CSS (`max-width`): **1150px** (hero → 1fr, art ≤520px centred, sub copy
48ch), **1100px** (why-band → 1fr, copy 62ch), **820px** (feature cards → 1fr), **640px** (nav
links hidden; intro sparkles mr/bl hidden; tl repositioned; details stack), **620px** (waitlist
form → column, submit full-width, deco sparkles hidden), **520px** (hero CTAs full-width). **No
920px rule exists in the implemented CSS — do not invent one.** Section padding and container
gutters are fluid via `clamp`; `overflow-x: clip` on body.

## Accessibility

- Skip link → `#main` (ink fill, yellow ring on focus).
- Landmarks: `header.nav`, `main#main`, `footer`; sections via `aria-labelledby`.
- Splash: `role="dialog" aria-modal="true"`; `inert` page shell while open;
  Escape/scroll/backdrop/close dismiss; focus returns (see Components).
- Ticker `aria-hidden`; decorative SVGs `aria-hidden`; informative SVGs (`HeroArt`, `BoardMockup`)
  `role="img"` + descriptive `aria-label`.
- Form: `label for`, `autocomplete="email"`, `inputmode="email"`,
  `aria-describedby="waitlist-email-error"`, `aria-invalid="true"` only when invalid,
  `role="alert"` for error and failure alert, `role="status"` + focus on success
  (`tabindex="-1"`); `novalidate` — JS validation.
- Icon-only controls carry `aria-label`s; touch targets ≥ 44×44px (nav CTA 44, buttons 48/56,
  socials 48, close 48); explicit `:focus-visible` rings everywhere (colours per Colour); never
  removed.
- Colour never sole carrier of meaning; reduced motion honoured; selection yellow on ink;
  `theme-color #FFF500`; `lang="en"`; one `h1`.

## Content rules

- **Voice:** playful, confident, short, funny where it earns it. No hype decks, no "unleash", no
  corporate Web3 tone, no AI-slop phrasing.
- **No invented claims:** no launch date, token details/economics, social metrics, testimonials,
  press, user counts. Concept art labelled as such; "Mockups, not screenshots" is the standing
  caption.
- **Trademark ceiling:** "inspired by the classic property-trading board game experience" is the
  max comparison; no borrowed artwork/marks. **"monopoly" appears only in the pinned lowercase
  opening line** — "we create monopoly on arc" (splash tagline; meta copy echoes the idea without
  the word). Everywhere else: "property-trading".
- **Arc** is a chain Akipoly is built on: name-drop it (About, details panel, meta description),
  never explain it, never invent chain claims.
- One action, one page: JOIN THE WAITLIST everywhere; secondary action only scrolls. "In 2026" is
  the only time-stamp and is deliberately vague.

## Verification

Re-render / re-check (policy-managed Windows: prefix the build with the WASI fallback — see
README; ordinary machines need nothing special):

```sh
NAPI_RS_FORCE_WASI=true npm run build   # policy-managed Windows
npm run build                            # ordinary machines → dist/
node scripts/cdp-shot.mjs <url> <out.png> <w> <h> [dismiss]   # screenshot + overflow check
node scripts/cdp-test.mjs                # waitlist valid/invalid paths via CDP
node scripts/cdp-test-intro.mjs          # splash open/Escape/deep-link behaviour
```

Expected: clean build, no horizontal overflow, no console errors, splash dismisses and removes
itself, waitlist error → success paths work. Astro `^7.4.12`, static output. (See
`scripts/cdp-shot.mjs` header for exact flags.)

## Open items

- **Waitlist backend seam** — `PUBLIC_WAITLIST_ENDPOINT` (`.env.example`). Unset ⇒ demo mode
  (localStorage only). Endpoint must accept `POST { "email": string, "source": "landing-page" }`,
  return 2xx on success. `src/lib/waitlist.ts` is the single integration point.
- **Placeholder socials** — footer `href="#"`; replace with real URLs in `Footer.astro`
  `SOCIAL_LINKS` (keep `rel="me"`).
- **Placeholder legal line** — footer copyright entity not yet supplied.
- **No real artwork** — all visuals are hand-authored inline SVG concept pieces; final game art
  replaces HeroArt/BoardMockup.
- **Chango substitution** — upstream pins Brick Sans (commercial, unavailable); Archivo Black was
  interim; user chose Chango 2026-11-18. If licensed later, swap `--font-display` + the fonts
  `<link>` only.
- **npm audit** — high-severity advisories in build-time transitive deps (`picomatch` ReDoS); not
  shipped to browser; `--force` deliberately rejected (would downgrade Astro a major).
- Waitlist success copy / fineprint not legal-reviewed; keep claim-free until the backend exists.
  `.impeccable/` and `.gemini/` are not part of the app.
