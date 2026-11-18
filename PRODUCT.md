# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (static output, no server requirements, zero client JS except the waitlist form logic). The user picked "Astro or Next.js"; Astro was chosen for a single static, conversion-focused landing page. Client-side interactivity is plain TypeScript, not a UI framework, to keep the bundle tiny.

## Users

Both sides of the fence, web3-light: people who love property-trading board games and people already playing in GameFi. The page must convert both; web3 is background detail, never the hook.

## Product Purpose

Akipoly reimagines the classic property-trading board game as a bold, playful digital GameFi experience. This surface is the single-page landing site whose job is to make a first-time visitor understand what Akipoly is within seconds and join the waitlist. One primary action, everywhere: JOIN THE WAITLIST.

## Positioning

The nostalgia and strategy of property trading, rebuilt as a modern arcade-bright GameFi experience for a new generation. It is not a casino, not a corporate DeFi product, and not a generic SaaS landing page: it is a premium-feeling arcade brand you want to click.

## Operating Context

Visitors arrive from social posts, communities and word of mouth. Most decide in seconds whether this is fun or forgettable. The site carries no backend today: the waitlist form is a front-end with an integration seam for a future backend endpoint.

## Capabilities and Constraints

- Waitlist form: validated email field (format + required), visible error and success states. No backend exists; submissions are not persisted to any server until an endpoint is wired in.
- No real launch date, no token details, no social metrics, no testimonials: none exist, none may be invented.
- Copy must be human and must avoid AI-slop phrasing; it must not use Monopoly/Hasbro trademarks. "Inspired by the classic property-trading board game experience" is the ceiling for any comparison.
- `design.md` (user-attached, at `E:\editshit\design.md`) is binding for every visual decision: palette, typography (Archivo Black + Space Grotesk), 3px ink borders, 5px hard offset shadows, radius/spacing scales, motion restraint, accessibility rules.
- Technical: reusable components, semantic HTML, accessible form controls, responsive across mobile/tablet/desktop, respects `prefers-reduced-motion`, no unnecessary dependencies.
- Social links, copyright line and the waitlist endpoint are configurable placeholders until real values are supplied.

## Brand Commitments

- Binding visual direction: "bright neobrutalism meets arcade gaming" per the attaching design.md (Electric Yellow #FFF500, Periwinkle #9DB7FB, Tangerine #FF6B4A, Lime Mint #B8F28B, Bubblegum Pink #FF80B5, Electric Violet #A78BFA, Ink Black #171717, Warm Ivory #FFFDF2).
- Display face: Chango; body/UI: Space Grotesk. Uppercase reserved for short labels and buttons.
- Opening line (user-pinned): "we create monopoly on arc". Arc is a chain Akipoly is built on — name-drop it, never explain it, never invent chain claims.
- Voice: playful, confident, short, funny where it earns it. No hype decks, no "unleash", no corporate Web3 tone.
- Official brand mark (user-supplied 2026-11-18, `The AKI Chapter.png`): periwinkle bubble-letter AKIPOLY wordmark with a pixel raccoon head. Favicons and in-site logo usage derive from it via `scripts/build-icons.mjs`; do not redraw it.
- Relationship to the classic board game: affectionate inspiration only; no borrowed artwork, names or marks. The word "monopoly" appears only inside the user-pinned opening line, in lowercase.

## Evidence on Hand

- `E:\editshit\design.md` (visual system) — exists, user-attached.
- No product screenshots, no gameplay, no artwork, no community numbers, no testimonials, no press. Absolutely none of these may be fabricated; conceptual SVG illustration is used and labelled as such.
- No backend, no waitlist endpoint, no real socials or handles yet.

## Product Principles

1. One action, one page: every CTA routes to the waitlist.
2. Keep it short, keep it bold, keep it fun — no lengthy explanations, no excessive scrolling.
3. Never fabricate traction, claims or assets; label concepts honestly and keep placeholders configurable.
4. Neobrutalist tactility over SaaS polish: thick borders, hard shadows, real hover/press feedback.
5. Fast, accessible, honest: quick load, keyboard-friendly, readable contrast, reduced-motion respected.

## Accessibility & Inclusion

WCAG-conscious contrast as per design.md §10: visible focus rings, keyboard-accessible controls, labels for icon-only controls, touch targets ≥ 44×44px, colour never the sole carrier of meaning, reduced-motion support, readable at browser zoom.
