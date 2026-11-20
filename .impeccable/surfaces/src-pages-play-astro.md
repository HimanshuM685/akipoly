---
version: 1
slug: "src-pages-play-astro"
primary_target: "src/pages/play.astro"
related_targets: []
---

# Surface brief — src/pages/play.astro

Visitor mode: Operate. The minigame seat is where visitors play the Akipoly Hi-Lo game after signing in with Privy. It's a task-completion surface: join/create a lobby, spin the ball, vote higher/lower, place bets, claim winnings, check career history. The interface recedes — the game artifact leads.

Audience: signed-in players who want to play the minigame on Arc Testnet. Web3 is background detail — Privy creates embedded wallets automatically, no seed phrases.

Constraints: noindex/nofollow (preview only). `PUBLIC_PRIVY_APP_ID` required; Privy App Secret never in client bundle. Reduced-motion respected. `arc testnet preview — nothing here holds real value. don't bet your life.` disclaimer on the page.

## Direction contract

THESIS: The play page is the minigame itself — a Hi-Lo betting game on Arc Testnet. A Three.js monopoly game background (animated dice drifting behind the panels) sets the arcade tone. The React island (Dashboard.tsx) handles Privy auth, wallet, lobby browser, lobby room, live game, and career screens.

OWN-WORLD: Warm Ivory (#FFFDF2) ground with ink dot grid, overlaid by a Three.js monopoly game background (animated dice in brand colours with ink outlines, slower than the landing page); back link and wordmark at top; "play the minigame" title; Privy-gated React island (sign-in screen → wallet panel → lobbies → live game → career); legal line with testnet disclaimer. Waterwave transition on entry/exit from `/` and `/docs`.

STORY: Visitor clicks "play" chip from landing page → arrives at `/play` → sees sign-in screen or wallet panel → joins/creates a lobby → plays Hi-Lo → checks career history → signs out. The background dice reinforce the game feel without blocking gameplay.

FIRST VIEWPORT: skip link → back link + wordmark → title → Privy-gated React island content → legal line. Waterwave overlay plays on navigation.

MOBILE: identical stack, React island adapts to screen size, no additional breakpoints.

EVALUATED DIRECTIONS:
- Previously named `/dashboard` — renamed to `/play` because a dashboard implies analytics/overview, not an active game table. `/play` is action-oriented and matches the minigame purpose.
- Title previously "play the devnexus minigame" — changed to "play the minigame" to remove the placeholder "devnexus" reference.

FORM: N/A (play is Operate mode, forms exist within the React island: lobby name input, display name modal, bet amount input — all handled by Dashboard.tsx subcomponents).

FINISH: testnet disclaimer present, no real-value claims, Privy auth server-side verified via JWKS, all game logic conditional SQL updates for concurrency safety.