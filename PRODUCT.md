# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (static output, no server requirements). Client-side interactivity is plain TypeScript in the form component — no UI framework. Fonts via Google Fonts (Chango display; Space Grotesk body).

## Users

Both sides of the fence, web3-light: people who love property-trading board games and people already playing in GameFi. The page must convert both; web3 is background detail, never the hook.

## Product Purpose

Akipoly reimagines the classic property-trading board game as a playful GameFi experience on Arc. This surface is the single waitlist screen: one viewport, one action — understand that Akipoly exists in under five seconds, and join the waitlist.

## Positioning

The nostalgia and chaos of property trading, rebuilt as a modern arcade-bright GameFi for a new generation. It is not a casino, not a corporate DeFi product, and not a generic SaaS landing page: it is a premium-feeling arcade brand you want to click.

## Operating Context

Visitors arrive from social posts, communities and word of mouth. Most decide in seconds whether this is fun or forgettable. The site carries no backend: the waitlist form is a front-end with an integration seam for a future backend endpoint.

## Capabilities and Constraints

- Waitlist form: validated email field (required + format), visible inline error and a success state. No backend exists; submissions are not persisted to any server until an endpoint is wired in.
- No real launch date, no token details, no social metrics, no testimonials: none exist, none may be invented.
- Copy must be human and must not use Monopoly/Hasbro trademarks — except inside the user-pinned opening line "we create monopoly on arc", used verbatim and lowercase.
- `design.md` (user-attached, at `E:\editshit\design.md`) is binding for every visual decision: palette, typography roles, 3px ink borders, hard offset shadows, motion restraint, accessibility rules.
- Technical: one page, one screen, semantic HTML, accessible form controls, responsive, respects `prefers-reduced-motion`, minimal dependencies.
- The wordmark/favicon artwork is user-supplied and authoritative (`The AKI Chapter.png`).

## Brand Commitments

- Binding visual direction: "bright neobrutalism meets arcade gaming" per the attaching design.md (Electric Yellow #FFF500, Periwinkle #9DB7FB, Tangerine #FF6B4A, Lime Mint #B8F28B, Bubblegum Pink #FF80B5, Electric Violet #A78BFA, Ink Black #171717, Warm Ivory #FFFDF2).
- The single-screen structure itself is user-pinned (2026-11-18): logo, the tagline "we create monopoly on arc", the email form, a minimal legal line. No hero, no About, no Showcase, no nav, no footer navigation.
- Tagline is used exactly, lowercase: "we create monopoly on arc". Arc is a chain Akipoly is built on — name-drop it, never explain it, never invent chain claims.
- Chango (display) + Space Grotesk (body/UI). Uppercase reserved for short labels and buttons.
- Voice: playful, confident, short, funny where it earns it. No hype decks, no "unleash", no corporate Web3 tone.
- Official brand mark (user-supplied 2026-11-18): periwinkle bubble-letter AKIPOLY wordmark with a pixel raccoon head. Never redraw it; derive from the master.
- Relationship to the classic board game: affectionate inspiration only; no borrowed artwork, names or marks.

## Evidence on Hand

- `E:\editshit\design.md` (visual system) — exists, user-attached.
- `E:\editshit\The AKI Chapter.png` (official logo artwork) — exists, user-attached.
- No product screenshots, gameplay art, community numbers, testimonials, or press exist. None may be fabricated.
- No backend, no waitlist endpoint, no real socials or handles yet.

## Product Principles

1. One screen, one action: the whole site exists to collect an email address.
2. Keep it short, keep it bold, keep it fun — zero scrolling required.
3. Never fabricate traction, claims or assets; keep placeholders legal and minimal.
4. Neobrutalist tactility over SaaS polish: thick borders, hard shadows, real hover/press feedback.
5. Fast, accessible, honest: instant load, keyboard-friendly, readable contrast, reduced-motion respected.

## Accessibility & Inclusion

WCAG-conscious contrast per design.md §10: single h1 (the wordmark), visible focus rings, labelled + associated error text (`aria-describedby`, `aria-invalid`), `role="alert"` on errors, `role="status"` on success, 44×44px+ touch targets, colour never the sole carrier of meaning, reduced-motion support, readable at browser zoom.
