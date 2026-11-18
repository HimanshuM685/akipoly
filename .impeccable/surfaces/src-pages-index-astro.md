---
version: 1
slug: "src-pages-index-astro"
primary_target: "src/pages/index.astro"
related_targets: []
---

# Surface brief — src/pages/index.astro

Visitor mode: Persuade. The entire site is one screen with one action: enter an email, join the waitlist. No scrolling is required to convert.

Audience: board-game lovers and GameFi players alike — web3 is background detail, never the hook.

Constraints: no backend (front-end form with an integration seam at `src/lib/waitlist.ts`), no invented claims/metrics/handles, design.md binding, copy human and trademark-free except the user-pinned lowercase opening line, reduced-motion respected.

## Direction contract

THESIS: The opening splash IS the product. Akipoly is the property-trading tabletop reborn as an arcade GameFi — one viewport sells the feeling of the roll, not a feature list. It refuses the category default (gradient-blob crypto hero, orb, LED-grid gloss) and the scroll-to-learn landing page.

OWN-WORLD: Warm Ivory (#FFFDF2) ground with a faint ink dot grid; one Electric Yellow marker behind the word "monopoly"; periwinkle/bubblegum/lime hand-authored SVG sparkles at the corners; the official pixel-raccoon AKIPOLY wordmark (user artwork, centered, downscaled from the 5000px master); a single form row — white input, 3px ink border, 4px yellow hard shadow, yellow JOIN THE WAITLIST button with 5px hard ink shadow; Space Grotesk labels; one quiet legal line pinned to the bottom edge. Everything else — nav, hero, About, Showcase, footer — is gone, by user decision.

STORY: Visitor lands → registers the raccoon wordmark → reads "we create monopoly on arc" → types one email → joins → lime success panel with a share button. Nothing else competes for attention, ever.

FIRST VIEWPORT (= the whole page): centred column. Official wordmark (clamp 230–400px wide), tagline (Space Grotesk 700) with yellow stroke on "monopoly" (rotated −1°), the form (560px max): 56px white input + JOIN THE WAITLIST button, fineprint underneath, legal line pinned to the bottom, four sparkles at the corners — all rendered at `zoom: 0.8` (user-pinned 2026-11-18: "make everything 0.2x smaller; it'll add more empty spaces around"). Mobile: identical stack, full-width button. The primary action is the only element with a hard shadow on the page.

FORM: seed: none (pinned). The shape is pinned by the user on 2026-11-18, verbatim: "what if 'the splash' was the page. the logo (a little smaller than now), subtext : we create monopoly on arc, and then join waitlist with email form. remove the crosss thing." The world stays "bright neobrutalism meets arcade gaming" (design.md). Brand mark per PRODUCT.md.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
