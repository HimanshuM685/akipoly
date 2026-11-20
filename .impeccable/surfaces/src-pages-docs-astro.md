---
version: 1
slug: "src-pages-docs-astro"
primary_target: "src/pages/docs.astro"
related_targets: []
---

# Surface brief — src/pages/docs.astro

Visitor mode: Read. The docs page explains what Akipoly is in plain language — no hype, no invented dates, no fake metrics. A Three.js monopoly theme background (drifting dice, streets, tiles in brand colours with ink outlines) sits behind the content to reinforce the arcade feel without distracting from reading.

Audience: the curious visitor who clicked "?" from the landing page and wants to understand what Akipoly actually is before joining the waitlist.

Constraints: no invented claims, dates, tokenomics, or testimonials. design.md binding. Reduced-motion respected. Single CTA: "join the waitlist" → `/`. Back button → `/`. Waterwave transition on entry/exit.

## Direction contract

THESIS: The docs page answers "what is this thing?" with honest, human copy. The Three.js monopoly background (slower, subtler than the landing page's) decorates without competing — it's Read mode, so comprehension comes first, expression second.

OWN-WORLD: Warm Ivory (#FFFDF2) ground with ink dot grid, overlaid by a gentle Three.js monopoly theme (animated dice, streets, property tiles drifting in Electric Yellow, Periwinkle, Tangerine, Lime Mint, Bubblegum Pink, Electric Violet with ink outlines); back link and wordmark at top; tl;dr card; explainer sections (short version / what you actually do / why arc / who it's for / when it launches / fine print); JOIN THE WAITLIST button back to `/`; legal line; sign-off with Arc whitepaper link. Background moves gently, respects prefers-reduced-motion (frozen).

STORY: Visitor arrives from the landing page's "?" badge → reads the tl;dr → scans the explainer sections → understands Akipoly → clicks JOIN THE WAITLIST back to `/` → signs up. The background hints at the minigame feel throughout.

FIRST VIEWPORT: back link + wordmark → tl;dr card → title "what is akipoly?" → explainer sections → CTA → legal → sign-off. All rendered at normal zoom (no `zoom: 0.8` override — docs is Read mode, readability over arcade styling).

MOBILE: identical stack, sections stack vertically, no additional breakpoints beyond the existing 640px/620px.

EVALUATED DIRECTIONS:
- Static sparkle-only background — replaced by Three.js monopoly theme to match the landing page's new animated direction.

FORM: N/A (docs is Read mode, no form — CTA is a link to `/`).

FINISH: copy human and trademark-free, no invented claims, every raster carries provenance.