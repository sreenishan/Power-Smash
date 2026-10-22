# Brand kit (M0 draft)

Status: **draft for the owner's approval (OT-23)**. Built in M0 from spec sections 5 and 19 and D-002.
Everything here is original work. There is no photo of a player and no broadcast, federation or third-party mark.
Preview it on a phone: open `docs/brand-preview.html` (one file, no network needed).

## What exists

| Deliverable | File |
|---|---|
| Colour, type scale, spacing, radii, shadows, motion, focus ring, tabular figures (CSS custom properties **and** a Tailwind 4 `@theme` block) | `src/styles/tokens.css` |
| Self-hosted fonts, font stacks, `:lang(ta)` rules | `src/styles/fonts.css` |
| Single Tailwind entry (imports Tailwind, tokens, fonts) | `src/styles/global.css` |
| Logo, light and dark; symbol, light and dark; social avatar; default Open Graph image | `public/brand/logo-full-light.svg`, `logo-full-dark.svg`, `logo-symbol.svg`, `logo-symbol-dark.svg`, `social-avatar.svg`, `og-default.svg` |
| Favicon (SVG) | `public/favicon.svg` |
| Contrast check, style check, logo builder, preview builder | `scripts/brand-contrast.mjs`, `brand-tokens-check.mjs`, `brand-logo.mjs`, `brand-preview.mjs` |
| Licence texts (3 OFL fonts, Lucide) | `docs/licenses/` |
| Owner-facing preview | `docs/brand-preview.html` |

**Not generated: PNG and ICO rasters.** No image rasteriser is installed and none may be installed without approval.
The site works with the SVGs, but these need a raster and wait for an approved tool:

| Raster | Needed for |
|---|---|
| `og-default.png` 1200 x 630 | WhatsApp, Facebook and X link previews do not render SVG `og:image` files; the default image must be PNG or JPEG |
| `favicon.ico` (16, 32, 48) and `favicon-192.png`, `favicon-512.png`, `apple-touch-icon.png` (180) | older browsers, iOS home screen, installable-app icons (spec 5.2 "favicon set") |
| `social-avatar-1024.png` (and a 800 px copy if a platform asks) | uploading the avatar to YouTube, WhatsApp Business, Instagram |

Candidate routes, none tried: a one-off Node script with an approved package (for example `@resvg/resvg-js` or `sharp`), or
the Microsoft Edge that ships with Windows 10 run headless (`msedge --headless --screenshot`), which needs no install but
needs the lead's okay under rule 3. The SVGs are the masters; the rasters are derived.

## Colour tokens

Spec 5.3 hex values are used exactly (checked by `brand-tokens-check.mjs`). Naming: CSS `--ps-court`; Tailwind `bg-ps-court`,
`text-ps-ink`, `border-ps-border`, with opacity (`bg-ps-court/50`). Tailwind's default palette is left in place (`bg-red-500`
still works): if the team wants brand-only colours, add `--color-*: initial;` at the top of the `@theme inline` block (not tried).

| Token | Hex | Use |
|---|---|---|
| `--ps-court` | `#0B6E4F` | Primary: buttons, links, key headings |
| `--ps-court-deep` | `#064532` | Hover states, dark sections |
| `--ps-ink` | `#0B1416` | Body text; broadcast dark backgrounds |
| `--ps-volt` | `#C6F432` | Accent on **dark** only: highlights, live scores, CTA fills with ink text. Never text on a light background |
| `--ps-feather` | `#F7F8F5` | Page background |
| `--ps-white` | `#FFFFFF` | Cards, court lines, text on dark |
| `--ps-slate` | `#5B6B70` | Secondary text (light surfaces only) |
| `--ps-border` | `#DDE3E1` | Decorative dividers only (1.2:1, see contrast) |
| `--ps-live` | `#C62A1F` | LIVE badges, critical alerts |

**Derived tokens (not in the spec; need the owner's or a designer's approval).** Each closes a gap the contrast check found.

| Token | Hex | Why |
|---|---|---|
| `--ps-mist` | `#A7B6BA` | Secondary text on ink, ink-soft and court-deep. Slate fails AA on ink (3.35:1) |
| `--ps-ink-soft` | `#142428` | Card surface inside a dark section |
| `--ps-court-tint` | `#E6F2EC` | Selected chip, soft green background (court text on it is 5.44:1) |
| `--ps-live-tint` | `#FDECEA` | Soft alert background (live text on it is 4.89:1) |
| `--ps-border-on-dark` | `#2A3D41` | Decorative divider on dark sections |

**Semantic roles** follow the surface: `--ps-bg`, `--ps-surface`, `--ps-fg`, `--ps-fg-muted`, `--ps-heading`, `--ps-line`,
`--ps-line-strong` (slate: the edge of inputs and outline buttons, 5.20:1), `--ps-link`, `--ps-focus`. Tailwind: `bg-page`,
`bg-surface`, `text-fg`, `text-fg-muted`, `text-heading`, `border-line`, `border-line-strong`, `text-link`, `ring-focus`. A dark
section is `class="ps-surface-dark"` (ink) or `ps-surface-court` (court-deep); it re-binds those roles, so everything inside
re-colours itself. Do not put these classes on `<html>` (the unlayered `:root` values would win).

## Typography

Fonts are self-hosted from the installed Fontsource packages (nothing is fetched at runtime), **woff2 only**, every face with
`font-display: swap` and a `unicode-range`, so a face downloads only when the page has characters it covers.

| Role | Stack (first entries) | Loaded |
|---|---|---|
| Headings (`font-display`, h1 to h4) | Barlow Condensed, **Noto Sans Tamil**, Arial Narrow, Roboto Condensed, system sans | 700, 800, and 800 italic only |
| Body and UI (`font-sans`) | Inter Variable, Noto Sans Tamil, system sans | variable weight 100 to 900, upright, Latin subset |
| Tamil (`font-tamil`) | Noto Sans Tamil, Inter Variable, Nirmala UI | static 400 and 600, Tamil subset |
| Numbers (`ps-num`, `ps-score`) | Inter, or Barlow Condensed 800, with tabular figures (`tnum`) | no extra file |

Noto Sans Tamil is second in the heading stack because Barlow has no Tamil glyphs (D-002).

**Fluid scale** (`clamp()` between a 360 px and a 1200 px viewport; verified by `brand-tokens-check.mjs`):

| Step | Utility | Size (rem) | px at 360 / 1200 | Line height | Style |
|---|---|---|---|---|---|
| H1 | `text-h1` | 2.25 to 4 | 36 / 64 | 1.0 | Barlow Condensed 800, uppercase |
| H2 | `text-h2` | 1.75 to 2.75 | 28 / 44 | 1.05 | Barlow Condensed 800, uppercase |
| H3 | `text-h3` | 1.375 to 1.875 | 22 / 30 | 1.15 | Barlow Condensed 700 |
| H4 | `text-h4` | 1.125 to 1.375 | 18 / 22 | 1.25 | Barlow Condensed 700 |
| Lead | `text-lead` | 1.0625 to 1.25 | 17 / 20 | 1.55 | Inter 400 |
| Body | `text-body` | 1 | 16 | 1.6 | Inter 400 (never smaller) |
| Small | `text-small` | 0.875 | 14 | 1.5 | Inter |
| Caption | `text-caption` | 0.75 | 12 | 1.4 | Inter, the floor |
| Score | `text-score`, `ps-score` | 2.5 to 4.5 | 40 / 72 | 1.0 | Barlow Condensed 800, tabular |

**Tamil** (`:lang(ta)`, set `lang="ta"` on Tamil text): smaller heading steps (H1 28 to 52 px), taller line height (body 1.75),
no letter-spacing, no uppercase, no faux bold or italic, and any weight of 600 or more maps to the 600 face. **DRAFT:** these
numbers are an estimate; a native reader must review the Tamil on a phone before launch. The Tamil copy in the preview is the
spec Appendix B draft and is labelled as needing native review.

**Font budget** (D-002 target about 150 KB on a typical English page; bytes of woff2 files, decimal kB):

| Page | Files | Size |
|---|---|---|
| Typical English page | Barlow 700 + 800, Inter Latin | 93.2 kB |
| English page that also uses the 800 italic | + Barlow 800 italic | 116.9 kB |
| Tamil text and a rupee price, every face in use | + Noto Sans Tamil 400 + 600 | 147.1 kB |

**The rupee sign.** U+20B9 is not in the Latin subset of Barlow or Inter; it sits in `latin-ext` (Inter's is 85 KB). The Tamil
subset of Noto Sans Tamil has it and is in every stack, so prices render with that 15 KB face. `latin-ext` is deliberately not
loaded. If the owner dislikes the mixed rupee glyph, the alternatives are Barlow `latin-ext` 700/800 (14.6 kB each, headings only)
or Inter `latin-ext` (85 kB, avoid).

## Spacing, radii, shadows, motion, focus

- **8 px grid.** `--ps-space-1..12` are 8, 16, 24, 32, 40, 48, 64, 80, 96 px. The Tailwind unit is left at 4 px (so `p-4` is
  16 px, the usual meaning); the even steps (`p-2`, `p-4`, `p-6`, `p-8`) are on the grid. Helpers: `px-gutter`, `py-section`
  (48 to 96 px fluid), `gap-block` (24 to 40 px), `max-w-page` (1200 px), `h-header`, `min-h-tap` (44 px), and `ps-container`
  (1200 px content, 16 px gutters on mobile, 24 px from 768 px, 32 px from 1280 px).
- **Radii** replace Tailwind's `sm`, `md`, `lg`, `xl` (4, 8, 12, 16 px) and add `rounded-pill`.
- **Shadows:** `shadow-card`, `shadow-raised`, `shadow-overlay` (ink-tinted).
- **Motion:** 150, 200, 250 ms (`--ps-dur-fast/base/slow`), easing `ease-ps`, `ps-transition` utility. Tailwind 4 has no duration
  namespace, so use `duration-(--ps-dur-base)`. Under `prefers-reduced-motion` the durations drop to 0.01 ms and animations stop
  (including the LIVE-dot `animate-live-pulse`).
- **Focus:** every link, button, field and `[tabindex]` gets a 3 px outline with a 2 px gap on `:focus-visible` (court on
  light, volt on dark). `scroll-padding-top` leaves room for the sticky header so focus is not hidden behind it (WCAG 2.2, 2.4.11).
- Utilities: `ps-num` (tabular figures), `ps-score`, `ps-italic` (800 italic), `ps-container`, `ps-transition`, `ps-focus-ring`.
- Component-scoped `<style>` blocks that use `@apply` or theme values need `@reference "../styles/global.css";`.

## Contrast (WCAG 2.2 AA)

Reproduce: `node scripts/brand-contrast.mjs` (add `--markdown` or `--json`). It reads the hex values from `tokens.css`.
Result on 2026-10-21: **48 pairs: 37 pass, 0 fail, 9 banned-by-design (fail on purpose), 2 decorative.**

**No pair the spec asks for fails AA.** What the check found:

1. **Spec reference ratio wrong (minor):** slate on feather is **5.20:1**, not 5.1:1 (the brief understates it; still AA). White on court 6.25 (spec 6.3), ink on volt 14.55 (14.6) and white on live 5.59 (5.6) match.
2. **`--ps-border` (1.21:1 on feather, 1.30 on white) fails the 3:1 needed for the edge of a control** (WCAG 1.4.11). The spec lists it as "borders, dividers"; use it for dividers only. Inputs and outline buttons use `--ps-line-strong` (slate, 5.20:1).
3. **Slate on ink is 3.35:1 (fails AA text).** The spec gives no secondary-text colour for dark sections, hence the derived `mist` (8.92:1 on ink).
4. **Red on ink is 3.33:1 (fails AA text).** LIVE and alerts on dark must be a red fill with white text, not red text.
5. **Court on ink is 2.98:1 (fails even 3:1).** Court-green text, icons or focus rings do not work on ink: use volt there.
6. Volt on feather or white is 1.20 and 1.28:1: the spec rule "never text on light" is right.

Full table (generated):

| ID | Foreground | Background | Ratio | AA text (4.5) | AA large / UI (3) | AAA (7) | Verdict | Use |
|---|---|---|---|---|---|---|---|---|
| L1 | `ink` #0B1416 | `feather` #F7F8F5 | 17.49 | yes | yes | yes | PASS | Body text on the page background |
| L2 | `ink` #0B1416 | `white` #FFFFFF | 18.65 | yes | yes | yes | PASS | Body text on cards |
| L3 | `slate` #5B6B70 | `feather` #F7F8F5 | 5.20 | yes | yes | NO | PASS | Secondary text on the page background |
| L4 | `slate` #5B6B70 | `white` #FFFFFF | 5.55 | yes | yes | NO | PASS | Secondary text on cards |
| L5 | `court` #0B6E4F | `feather` #F7F8F5 | 5.86 | yes | yes | NO | PASS | Links and key headings on the page background |
| L6 | `court` #0B6E4F | `white` #FFFFFF | 6.25 | yes | yes | NO | PASS | Links and key headings on cards |
| L7 | `court-deep` #064532 | `feather` #F7F8F5 | 10.34 | yes | yes | yes | PASS | Link hover on the page background |
| L8 | `live` #C62A1F | `feather` #F7F8F5 | 5.25 | yes | yes | NO | PASS | Critical alert text on the page background |
| L9 | `live` #C62A1F | `white` #FFFFFF | 5.59 | yes | yes | NO | PASS | Critical alert text on cards |
| F1 | `white` #FFFFFF | `court` #0B6E4F | 6.25 | yes | yes | NO | PASS | Primary button label (spec reference 6.3) |
| F2 | `white` #FFFFFF | `court-deep` #064532 | 11.02 | yes | yes | yes | PASS | Primary button label on hover |
| F3 | `ink` #0B1416 | `volt` #C6F432 | 14.55 | yes | yes | yes | PASS | CTA fill with ink text (spec reference 14.6) |
| F4 | `white` #FFFFFF | `live` #C62A1F | 5.59 | yes | yes | NO | PASS | LIVE badge (spec reference 5.6) |
| F5 | `court` #0B6E4F | `court-tint` #E6F2EC | 5.44 | yes | yes | NO | PASS | Selected chip, derived tint |
| F6 | `ink` #0B1416 | `court-tint` #E6F2EC | 16.23 | yes | yes | yes | PASS | Body text on the court tint |
| F7 | `live` #C62A1F | `live-tint` #FDECEA | 4.89 | yes | yes | NO | PASS | Alert text on the soft alert background, derived tint |
| F8 | `ink` #0B1416 | `live-tint` #FDECEA | 16.30 | yes | yes | yes | PASS | Body text on the soft alert background |
| F9 | `ink` #0B1416 | `border` #DDE3E1 | 14.34 | yes | yes | yes | PASS | Text on a border-coloured chip or table header |
| D1 | `white` #FFFFFF | `ink` #0B1416 | 18.65 | yes | yes | yes | PASS | Text on dark sections |
| D2 | `feather` #F7F8F5 | `ink` #0B1416 | 17.49 | yes | yes | yes | PASS | Text on dark sections (softer white) |
| D3 | `volt` #C6F432 | `ink` #0B1416 | 14.55 | yes | yes | yes | PASS | Highlights, live scores, links on dark |
| D4 | `mist` #A7B6BA | `ink` #0B1416 | 8.92 | yes | yes | yes | PASS | Secondary text on dark, derived (slate fails here, see X3) |
| D5 | `white` #FFFFFF | `ink-soft` #142428 | 15.99 | yes | yes | yes | PASS | Text on a card inside a dark section |
| D6 | `mist` #A7B6BA | `ink-soft` #142428 | 7.65 | yes | yes | yes | PASS | Secondary text on a card inside a dark section |
| D7 | `volt` #C6F432 | `ink-soft` #142428 | 12.48 | yes | yes | yes | PASS | Highlights on a card inside a dark section |
| D8 | `white` #FFFFFF | `court-deep` #064532 | 11.02 | yes | yes | yes | PASS | Text on the deep-green band |
| D9 | `volt` #C6F432 | `court-deep` #064532 | 8.60 | yes | yes | yes | PASS | Highlights on the deep-green band |
| D10 | `mist` #A7B6BA | `court-deep` #064532 | 5.27 | yes | yes | NO | PASS | Secondary text on the deep-green band |
| D11 | `white` #FFFFFF | `court` #0B6E4F | 6.25 | yes | yes | NO | PASS | Text on a court-green card |
| D12 | `volt` #C6F432 | `court` #0B6E4F | 4.88 | yes | yes | NO | PASS | Volt on court-green (allowed, still dark) |
| U1 | `court` #0B6E4F | `feather` #F7F8F5 | 5.86 | yes | yes | NO | PASS | Focus ring on light surfaces |
| U2 | `volt` #C6F432 | `ink` #0B1416 | 14.55 | yes | yes | yes | PASS | Focus ring on dark sections |
| U3 | `volt` #C6F432 | `court-deep` #064532 | 8.60 | yes | yes | yes | PASS | Focus ring on the deep-green band |
| U4 | `slate` #5B6B70 | `feather` #F7F8F5 | 5.20 | yes | yes | NO | PASS | Input and outline-button edge on the page (line-strong) |
| U5 | `slate` #5B6B70 | `white` #FFFFFF | 5.55 | yes | yes | NO | PASS | Input edge on a card (line-strong) |
| U6 | `mist` #A7B6BA | `ink` #0B1416 | 8.92 | yes | yes | yes | PASS | Input edge on dark (line-strong) |
| U7 | `court` #0B6E4F | `white` #FFFFFF | 6.25 | yes | yes | NO | PASS | Secondary button outline and icons on cards |
| X1 | `volt` #C6F432 | `feather` #F7F8F5 | 1.20 | NO | NO | NO | BANNED | Volt as text on the light page (spec: never) |
| X2 | `volt` #C6F432 | `white` #FFFFFF | 1.28 | NO | NO | NO | BANNED | Volt as text on a white card (spec: never) |
| X3 | `slate` #5B6B70 | `ink` #0B1416 | 3.35 | NO | yes | NO | BANNED | Slate secondary text on a dark section (use mist) |
| X4 | `live` #C62A1F | `ink` #0B1416 | 3.33 | NO | yes | NO | BANNED | Red text on a dark section (use a live FILL with white text) |
| X5 | `court` #0B6E4F | `ink` #0B1416 | 2.98 | NO | NO | NO | BANNED | Court-green text, icon or ring on ink (use volt) |
| X6 | `slate` #5B6B70 | `court-deep` #064532 | 1.98 | NO | NO | NO | BANNED | Slate on the deep-green band (use mist) |
| X7 | `slate` #5B6B70 | `border` #DDE3E1 | 4.27 | NO | yes | NO | BANNED | Slate text on a border-coloured fill (use ink) |
| X8 | `border` #DDE3E1 | `feather` #F7F8F5 | 1.21 | NO | NO | NO | BANNED | `--ps-border` as the ONLY edge of an input or button (decorative dividers only) |
| X9 | `border` #DDE3E1 | `white` #FFFFFF | 1.30 | NO | NO | NO | BANNED | `--ps-border` as the ONLY edge of a control on a card |
| Z1 | `ink-soft` #142428 | `ink` #0B1416 | 1.16 | - | - | - | INFO | Dark card surface against the dark section (surface step only) |
| Z2 | `border-on-dark` #2A3D41 | `ink` #0B1416 | 1.63 | - | - | - | INFO | Divider on a dark section |

| Spec 5.3 reference | Spec says | Computed | Result |
|---|---|---|---|
| white on court | about 6.3:1 | 6.25:1 | matches |
| ink on volt | about 14.6:1 | 14.55:1 | matches |
| slate on feather | about 5.1:1 | 5.20:1 | **spec value is off (understated)** |
| white on live | about 5.6:1 | 5.59:1 | matches |

Ratios are shown rounded down (WCAG forbids rounding up). Thresholds: normal text 4.5, large text (24 px, or 19 px bold) 3, UI components and graphics 3.

## Logo

Concept: **POWER SMASH** in a heavy condensed italic, plus a shuttle diving to the lower right with three speed streaks behind it
(the "shuttle trail"). A tapered speed bar under the words echoes the streaks. Light version: POWER in ink, SMASH, trail and cork
in court green. Dark version: POWER and the skirt in white, SMASH, trail and cork in volt. Volt never appears on light.

- The wordmark is **outlined**: real SVG `<path>` data from Barlow Condensed Black Italic (SIL OFL-1.1) read with
  opentype.js 2.0.0 (it reads `.woff` directly). There is no `<text>` element and no font dependency; the shuttle is drawn from plain
  geometry in `scripts/brand-logo.mjs`. See `docs/licenses/README.md` for why this is allowed.
- The Open Graph image is 1200 x 630: ink, faint doubles-court lines, the dark lockup. **It contains no tagline text.** The zone for it
  (x 150, y 405, 900 x 90) is marked only by an XML comment and an empty `<g id="tagline-zone"/>`; nothing visible is a placeholder.
- The favicon uses a simplified symbol (one solid skirt, two heavy streaks) so it reads at 16 px.
- The social avatar keeps the symbol inside the central circle, so a circle crop (YouTube, WhatsApp, Instagram) loses nothing.

**Regenerate** (deterministic: the same input writes byte-identical files):

```
node scripts/brand-logo.mjs            # rewrites public/brand/*.svg and public/favicon.svg
node scripts/brand-preview.mjs         # rebuilds docs/brand-preview.html from them
```

Needs only the installed `opentype.js` (dev) and `@fontsource/barlow-condensed` files. Colours come from `tokens.css`.
**After the owner picks a tagline:** set `TAGLINE_DEFAULT` at the top of `scripts/brand-logo.mjs` (or trial it with
`node scripts/brand-logo.mjs --tagline="..."`) and re-run; the tagline is outlined (Barlow Condensed 700, uppercase, white) into
the reserved zone and the TODO comment disappears. If a designer supplies files, drop them over the SVGs in `public/brand/`:
nothing in the code refers to their contents.

## What the owner approves (OT-23)

1. **The logo**: yes, or what to change (shuttle, slant, speed bar, colours). Designer files replace these without code changes.
2. **One tagline** from spec 5.1: A "Tamil Nadu badminton, on record." / B "Every player. Every match. Every smash." / C "Where Tamil
   Nadu badminton lives." Nothing is pre-selected; the preview shows all three the same way.
3. **The five derived colours** (`mist`, `ink-soft`, `court-tint`, `live-tint`, `border-on-dark`) and the strong-border rule, which the spec did not specify.
4. **Tamil lines** are drafts and need a native speaker before launch (spec Appendix B).

## Report: spec section 5 (and nearby) wrong or unclear

1. **5.3 reference ratio:** slate on feather is 5.20:1, not 5.1:1. Harmless.
2. **5.3 has no pair rules for dark sections.** Slate (secondary text), live (red) and court (green) all fail on ink. Needs the derived `mist` and the "LIVE is a fill" rule above.
3. **5.3 `--ps-border` "Borders, dividers"** is ambiguous: at 1.2:1 it cannot be a form-field or button edge under WCAG 2.2 AA (1.4.11). Used for dividers only; strong edge added.
4. **5.3 "map into the Tailwind theme"** is Tailwind 3 wording; Tailwind 4 uses `@theme` (already recorded in D-002).
5. **5.4 weights** say Barlow Condensed 700 to 800 and Noto Sans Tamil 400 to 600; D-002 loads only 700, 800 (+ 800 italic) and 400, 600. A 500 Tamil weight renders as 400. Fine, but "italic allowed" is only at 800.
6. **5.4 versus spec section 4 (rupees):** the rupee sign is not in the Latin font subsets; see "The rupee sign" above for the chosen fallback. The spec does not say how prices should render.
7. **5.2 "favicon set", "default Open Graph image":** an SVG `og:image` is not shown by WhatsApp, Facebook or X, and a favicon set implies PNG and ICO. Both need a rasteriser (not installed) before G1. Keep the file small for WhatsApp previews (a commonly quoted limit is about 300 KB; unverified, test it).
8. **5.5 "8 px spacing grid" versus Tailwind's 4 px unit:** kept 4 px as the Tailwind unit and made even steps the grid. Changing `--spacing` to 0.5rem would make `p-4` 32 px, which surprises anyone who knows Tailwind.
9. **Appendix B Tamil H1 does not translate its English H1.** The English is "Tamil Nadu badminton, on record." (tagline A); the Tamil draft means "Home of Tamil Nadu badminton" (the spec says so), which matches tagline C. Whichever tagline the owner picks, the Tamil line needs rewriting by a native speaker.
10. **5.5 "Icons: Lucide"** is ISC, but the installed licence adds an MIT notice for 115 Feather-derived icons: keep both notices (small correction to VERIFIED_FACTS VF-F14).
11. **Placeholder gate vs. the OG file.** `og-default.svg` contains the literal `TODO(owner)` in an XML comment, as the M0 brief asked. `scripts/check-placeholders.ts` (M1) must either skip `public/brand/*.svg` or run after the tagline is added (the comment is then gone). Do not ship the file to production before the owner has picked.

## Verification (2026-10-21)

| Check | Command | Result |
|---|---|---|
| Contrast | `node scripts/brand-contrast.mjs` | 0 required pairs fail; 3 of 4 spec reference ratios match |
| Styles | `node scripts/brand-tokens-check.mjs` | all PASS: braces and comments balance, 9 spec hex values exact, every `var(--ps-*)` resolves, H1 is 36 px at 360 px and 64 px at 1200 px, durations 150/200/250 ms, 6 `@font-face` rules (all swap, all with unicode-range, all files exist), Tailwind 4.3.3 generates all 52 promised utilities |
| Real pipeline | a one-off Vite 8.3.4 + `@tailwindcss/vite` build of `global.css` from a scratch folder outside the repo (not `astro build`) | built without warnings; emitted exactly the 6 `.woff2` files (14.6, 15.6, 22.4, 22.5, 23.8, 48.3 kB) and a stylesheet of 18.6 kB (4.4 kB gzip) for a test page using about 30 utilities |
| Logos | `node scripts/brand-logo.mjs` | 7 SVGs; each has 0 `<text>` elements, no external reference, a `<title>`; re-running gives identical bytes |
| Preview | `node scripts/brand-preview.mjs` | one 301 KiB file, no `<script>`, no `http(s)` URL, fonts embedded as base64; three taglines unselected; Tamil labelled "Draft Tamil: needs native review"; read in the Browser pane at a phone width |

Not verified: how the page renders in Safari, a real mid-range Android phone, or with real Tamil text read by a native speaker.
`astro build` and Lighthouse (CLS from font swapping, font bytes on the built page) are for the lead; the fallback-font metric
adjustment (`size-adjust` and friends) was not added because its numbers would be unverified.

## Lead's to-do

- In the base layout: `import "../styles/global.css";`, `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, set `<html lang="en">` and `lang="ta"` on Tamil fragments.
- Add a third-party notices page or file generated from `docs/licenses/` (OFL and ISC ask that the notice travels with the files).
- After a rasteriser is approved: the PNG and ICO set in the table at the top; then `<meta property="og:image">` must point at the PNG.
