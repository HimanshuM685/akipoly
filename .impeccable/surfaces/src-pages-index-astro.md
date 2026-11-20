---
version: 1
slug: "src-pages-index-astro"
primary_target: "src/pages/index.astro"
related_targets: []
---

# Surface brief — src/pages/index.astro

Visitor mode: Persuade + Experience tease. The site sells the waitlist while showing what's coming — an animated monopoly minigame plays in the background to hook players before they sign up. The waitlist remains the primary action, but the background teases the product so visitors understand what they're joining.

Audience: board-game lovers and GameFi players alike — web3 is background detail, never the hook. The minigame teaser shows the arcade feel up front.

Constraints: no backend (front-end form with an integration seam at `src/lib/waitlist.ts`), no invented claims/metrics/handles, design.md binding, copy human and trademark-free except the user-pinned lowercase opening line, reduced-motion respected.

## Direction contract

THESIS: The opening splash sells both the waitlist and the coming minigame. A Three.js animated monopoly background plays behind the content — dice, board streets, and property tiles drifting slowly in brand colours — giving visitors an immediate feel for the arcade GameFi experience. The waitlist stays the one action, but the background tells the story of what Akipoly will be.

OWN-WORLD: Warm Ivory (#FFFDF2) ground with a faint ink dot grid, now overlaid by a slow-moving Three.js monopoly background (animated dice, streets, tiles in Electric Yellow, Periwinkle, Tangerine, Lime Mint, Bubblegum Pink, Electric Violet with ink outlines); one Electric Yellow marker behind the word "monopoly"; the official pixel-raccoon AKIPOLY wordmark (user artwork, centered, downscaled from the 5000px master); a single form row — white input, 3px ink border, 4px yellow hard shadow, yellow JOIN THE WAITLIST button with 5px hard ink shadow; Space Grotesk labels; one quiet legal line pinned to the bottom edge. The background moves gently and never blocks the form.

STORY: Visitor lands → sees the animated monopoly background tease → registers the raccoon wordmark → reads "we create monopoly on arc" → understands what's coming → types one email → joins → lime success panel with a share button. The background hints at the minigame without demanding attention away from the form.

FIRST VIEWPORT (= the whole page): centred column over the animated background. Official wordmark (clamp 230–400px wide), tagline (Space Grotesk 700) with yellow stroke on "monopoly" (rotated −1°), optional one-line minigame teaser, the form (560px max): 56px white input + JOIN THE WAITLIST button, fineprint underneath, legal line pinned to the bottom — all rendered at `zoom: 0.8` (user-pinned 2026-11-18: "make everything 0.2x smaller; it'll add more empty spaces around"). Mobile: identical stack, full-width button, background scales to fit. The JOIN THE WAITLIST button remains the only hard-shadowed interactive element on top of the background.

EVALUATED DIRECTIONS (tried and rejected against the pinned constraints):
- Static sparkle-only background — replaced by the animated Three.js monopoly teaser to show what's coming.
- `page__deck` descriptor paragraph under the tagline — removed; the animated background now communicates the product feel without extra copy.

FORM: seed: none (pinned). The shape is pinned by the user on 2026-11-18, verbatim: "what if 'the splash' was the page. the logo (a little smaller than now), subtext : we create monopoly on arc, and then join waitlist with email form. remove the crosss thing." The world stays "bright neobrutalism meets arcade gaming" (design.md). Brand mark per PRODUCT.md.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
