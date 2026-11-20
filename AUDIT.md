# Akipoly — Impeccable Audit Report

**Surface audited:** `src/pages/index.astro` (landing / waitlist) + shared `src/styles/global.css`, with repo-wide observations for `/dashboard`, `/docs`, and API routes.  
**Platform:** web · **Scope:** technical code-level audit (not a design critique) · **Status:** issues documented only, nothing fixed  
**Method:** manual verification of source against `PRODUCT.md`, `DESIGN.md`, and `design.md` (the pinned visual system). The bundled `impeccable detect` tool could not be invoked in this shell (Windows path limitation); all Implementation Integrity findings below were verified directly in the code.

---

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3/4 | WCAG AA met on the landing page; fineprint/legal contrast is a narrow 4.66:1 pass; placeholder text is low-contrast |
| 2 | Performance | 3/4 | Lean static landing; above-fold wordmark image is an unoptimized 211 KB PNG; perpetual twinkle animation (killed under reduced motion) |
| 3 | Theming | 3/4 | Full `:root` token system used consistently; brand accent hexes (`#a33a2a`, `#ffe9e2`, SVG fills) hard-coded instead of token-referenced |
| 4 | Responsive Design | 3/4 | Landing is mobile-ready (≥44 px touch targets, form stacks at 620 px); `/dashboard` has sub-44 px touch targets (copybtn 36 px, career refresh 36×36, wallet mini 32 px) |
| 5 | Implementation Integrity | 3/4 | Coherent product-specific system matching `design.md`; doc/code gaps (demo mode, backend claim), dead component (`Waitlist.astro`), real credentials sitting on disk in `.env` |
| **Total** | | **15/20** | **Good (14–17) — address weak dimensions** |

Rating bands: 18–20 Excellent, 14–17 Good, 10–13 Acceptable, 6–9 Poor, 0–5 Critical.

---

## Implementation Integrity Verdict

**Pass.** The implementation expresses a coherent, product-specific system. Verified evidence:
- Tokens, hard-offset shadows (no blur/glass), 3 px borders, radius scale, and the dot-grid ground all match `design.md` §12 and are used consistently across `global.css`.
- One `h1` (the wordmark), skip link → `#main`, `lang="en"`, `theme-color`, one action (JOIN THE WAITLIST) — matches the pinned single-screen structure.
- No borrowed Monopoly/Hasbro artwork or marks; "monopoly" appears only inside the pinned line `we create monopoly on arc` (lowercase, verbatim) — verified by grep across `src/` and the Markdown files.
- `WaitlistForm.astro` implements labelled input (`for`/`id`), `autocomplete="email"`, `inputmode="email"`, `aria-describedby`, `aria-invalid` toggled only when invalid, `role="alert"` on error, `role="status"` on success, `novalidate`, visible focus rings.

Drift noted (kept separate from visual judgment): see findings below.

---

## Executive Summary

- **Audit Health Score: 15/20 — Good (14–17)**
- **Total issues:** 0 P0 · 0 P1 · 5 P2 · 2 P3
- **Top critical issues:** none blocking; the highest-severity items are operational (secrets on disk) and doc/code mismatches rather than user-facing blockers.
- **Recommended next steps:** fix dashboard touch targets, sync `DESIGN.md`/PRODUCT.md with the implemented waitlist seam, remove `Waitlist.astro` dead code, rotate secrets, then run `/impeccable polish`.

No WCAG AA violation was found on the landing page, so there is no P1 release blocker.

---

## Detailed Findings by Severity

### [P2] Fineprint/legal contrast is a narrow AA pass
- **Location:** `src/styles/global.css` — `.page__legal` (line ~279) and `.docs__legal` / fineprint at `color: rgba(23, 23, 23, 0.6)` (~0.75 rem / 12 px)
- **Category:** Accessibility
- **Impact:** Small legal/fineprint text sits at ~4.66:1 against Warm Ivory — technically above the 4.5:1 AA bar but with almost no headroom; any browser/OS rendering difference could push it below AA for low-vision users.
- **WCAG/Standard:** WCAG 2.1 SC 1.4.3 Contrast (Minimum) 4.5:1
- **Recommendation:** Darken the fineprint color (e.g. `rgba(23,23,23,0.72–0.8)`) or switch to a slightly darker token so it clears 4.5:1 with margin; verify with a contrast tool.
- **Suggested command:** `/impeccable colorize`

### [P2] Sub-44 px touch targets on `/dashboard`
- **Location:** `src/styles/global.css` — `.dash__copybtn` (`min-height: 36px`, ~line 952), `.career__refresh` (`36px × 36px`, ~line 1807), `.wallet-chip__mini` (`min-height: 32px`, ~line 1274)
- **Category:** Responsive Design
- **Impact:** Touch targets below the 44×44 px WCAG AA ideal (24×24 CSS px minimum with spacing exceptions) on the dashboard surface; users with motor impairments or on small screens may miss taps.
- **WCAG/Standard:** WCAG 2.2 SC 2.5.8 Target Size (Minimum)
- **Recommendation:** Raise these to ≥44 px min-height/min-width, or confirm the spacing exception applies (a 24 CSS px circle around each overlaps no other undersized target).
- **Suggested command:** `/impeccable adapt`

### [P2] Dead component with colliding form IDs
- **Location:** `src/components/Waitlist.astro` — unreferenced (not imported anywhere); defines its own `#waitlist-form`, `#waitlist-email`, `#waitlist-submit`, `#waitlist-success`
- **Category:** Implementation Integrity
- **Impact:** Dead code that ships in the component tree; if ever imported alongside `WaitlistForm.astro` it would create duplicate `id`s (invalid HTML, breaks `label for`/`aria-describedby` association and `getElementById`).
- **Recommendation:** Remove `Waitlist.astro` (the landing page uses `WaitlistForm.astro`).
- **Suggested command:** `/impeccable distill`

### [P2] `DESIGN.md` describes a demo/localStorage waitlist mode that the client doesn't implement
- **Location:** `DESIGN.md` (Components — WaitlistForm, "Unset ⇒ demo mode: validates, animates to success, stores in localStorage only") vs `src/components/WaitlistForm.astro` and `src/lib/waitlist.ts`
- **Category:** Implementation Integrity
- **Impact:** Documentation promises an offline demo mode, but the client always POSTs to `/api/waitlist` and surfaces an error alert on failure — nothing is stored in localStorage. Operators testing without a backend will see errors instead of the documented demo success.
- **Recommendation:** Either implement the documented localStorage demo fallback in `WaitlistForm.astro`/`waitlist.ts`, or correct `DESIGN.md` (and `PRODUCT.md`, which says "no backend exists" while `/api/waitlist.ts` writes to Neon) to match the implementation.
- **Suggested command:** `/impeccable document`

### [P2] Real credentials present on disk in `.env`
- **Location:** `.env` (git-ignored, **not** tracked in git — verified via `git ls-files`) containing a real Neon `DATABASE_URL` with password and a `VERCEL_OIDC_TOKEN` JWT
- **Category:** Implementation Integrity
- **Impact:** If the file is ever exposed or accidentally committed, the database is directly readable/writable and the OIDC token is usable. `README.md` already notes the Privy app secret was pasted in chat once and should be treated as compromised/rotated.
- **Recommendation:** Rotate the Neon database password and the Privy app secret; keep `.env` out of git (already git-ignored — confirm it never gets staged); never prefix secrets with `PUBLIC_`.
- **Suggested command:** `/impeccable harden`

### [P3] Above-fold wordmark image is an unoptimized 211 KB PNG
- **Location:** `src/pages/index.astro` line 72 (`/icons/akipoly-wordmark@1000.png`, 210,929 bytes) — used in the `h1` above the fold
- **Category:** Performance
- **Impact:** Largest above-fold asset; not lazy-loadable (it's the primary visual) and stored as PNG rather than a more compact format.
- **Recommendation:** Re-compress/convert the wordmark (WebP or optimized PNG) via `scripts/build-icons.mjs`, targeting a smaller above-fold payload.
- **Suggested command:** `/impeccable optimize`

### [P3] Placeholder text low contrast
- **Location:** `src/styles/global.css` — `.field input::placeholder` (`color: rgba(23, 23, 23, 0.45)`, line ~327)
- **Category:** Accessibility
- **Impact:** Placeholder is faint; not a WCAG requirement (placeholders are exempt from contrast), but reduces form legibility.
- **Recommendation:** Darken placeholder slightly (contrast not sole carrier since label + value exist).
- **Suggested command:** `/impeccable typeset`

---

## Patterns & Systemic Issues

- No recurring single-mistake pattern on the landing page — the component is consistent and self-contained.
- Systemic: documentation lags implementation in two places (waitlist demo mode; "no backend exists" claim vs. the wired Neon endpoint). Treat `PRODUCT.md`/`DESIGN.md` as living docs and resync them after any seam change.
- Systemic: brand accent colors (`#a33a2a` error red, `#ffe9e2` error fill, inline SVG fills) exist as hard-coded hexes alongside the token system; as more surfaces are added these are the most likely drift source.

---

## Positive Findings

- **Contrast:** excellent core pairs — ink/paper ≈ 18:1, button ink-on-yellow ≈ 16:1, success ink-on-lime ≈ 14:2, error text ≈ 5.32:1 — all clear WCAG AA.
- **Focus & semantics:** visible `:focus-visible` rings everywhere (3 px ink offset), skip link → `#main`, one `h1`, `aria-hidden` decorative SVGs, `lang="en"`, `aria-describedby` + `aria-invalid` + `role="alert"`/`"status"` on the form.
- **Reduced motion:** `prefers-reduced-motion` forces animations/transitions to `0.01 ms` with iteration count 1 and sets `scroll-behavior: auto` — preserves state changes without movement; the waterwave transition is skipped entirely.
- **Token discipline:** every colour in `global.css` flows from `:root` tokens; hard-offset shadows only (no blur/glass); 4 px spacing scale.
- **Performance:** static Astro output, Google Fonts preloaded with `display=swap`, compositor-only `transform`/`opacity` animations, minimal client-side JS on the landing page, route-level code splitting (Privy/viem/three only load on `/dashboard`).
- **API hygiene:** `/api/waitlist` validates input, guards body size (2048 bytes), returns 413/400/503/500 appropriately, handles idempotent re-submits (PG 23505 → `already: true`), sets `Cache-Control: no-store`.
- **Secret hygiene:** `.env` is git-ignored and not tracked; `.env.example` documents vars without real values.

---

## Recommended Actions

Priority order (P2 first, then P3); end with polish.

1. **[P2] `/impeccable colorize`**: Darken fineprint/legal text (`rgba(23,23,23,0.6)`) so contrast clears 4.5:1 AA with margin; verify across the landing, docs, and dashboard legal lines.
2. **[P2] `/impeccable adapt`**: Raise dashboard touch targets to ≥44 px (`.dash__copybtn`, `.career__refresh`, `.wallet-chip__mini`) or confirm the WCAG spacing exception applies.
3. **[P2] `/impeccable distill`**: Remove the unreferenced `src/components/Waitlist.astro` to eliminate duplicate-ID risk and dead code.
4. **[P2] `/impeccable document`**: Resync `DESIGN.md`/`PRODUCT.md` with the implemented waitlist seam (remove/implement the localStorage demo mode; correct the "no backend exists" claim now that `/api/waitlist` writes to Neon).
5. **[P2] `/impeccable harden`**: Rotate the Neon DB password and Privy app secret (reportedly exposed in chat); keep `.env` git-ignored and never `PUBLIC_`-prefixed.
6. **[P3] `/impeccable optimize`**: Re-compress `/icons/akipoly-wordmark@1000.png` (211 KB, above fold).
7. **[P3] `/impeccable typeset`**: Slightly darken the email input placeholder (`rgba(23,23,23,0.45)`).
8. **[Final] `/impeccable polish`**: Final quality pass after the above fixes, then re-run `/impeccable audit` to confirm the score improves.

> You can ask me to run these one at a time, all at once, or in any order you prefer.
> Re-run `/impeccable audit` after fixes to see your score improve.

---

*End of report. No changes were made to the codebase during this audit.*
