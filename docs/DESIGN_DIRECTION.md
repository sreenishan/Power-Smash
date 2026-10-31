# Design direction (premium visual upgrade)

Status: v1, written by the design-system worker. Page workers: apply THIS file; do not invent new colours, radii or one-off CSS.
Goal (spec 5.1): broadcast-grade sports media with a grassroots heart. Confident, uncluttered, high contrast, fast.
Everything is CSS: no new JavaScript, fonts, images or libraries. Copy is the owner's: change layout and styling only.

Source files: tokens `src/styles/tokens.css`, recipes `src/styles/components.css` (all the `ps-*` classes below), fonts `src/styles/fonts.css`.
Tailwind utilities still work and win over the recipes (recipes sit in the `components` layer).

## 1. Surfaces and colour rules

| Surface | How | Text | Accent | Notes |
|---|---|---|---|---|
| Page (default) | nothing (feather `#F7F8F5`) | `text-fg` ink, `text-fg-muted` slate | court (links, rules, icons) | Never volt as text or icon here. |
| Light band | `<Section tone="surface">` (white, hairline top and bottom) | same | court | Alternate default and surface bands down a page. |
| Broadcast band (dark) | `<Section tone="dark">` or `class="ps-surface-dark"` | white, `text-fg-muted` = mist | volt (text, icons, rules, focus) | Court green is never text or an icon on ink (2.98:1). Red only as a fill with white text. |
| Court band | `<Section tone="court">` or `ps-surface-court` (CTA, footer strip) | white, mist | volt | Deep green with a gradient; mist is allowed (D10). |
| Card on light | `ps-card` | ink / slate | court | White, hairline border, soft shadow. |
| Card on dark | `ps-card` inside a dark band | white / mist | volt | Automatically ink-soft; no shadow, a faint top highlight. |

Rules: use semantic utilities (`text-fg`, `text-fg-muted`, `text-heading`, `bg-surface`, `border-line`, `text-link`) so a card re-colours itself inside a dark band. Only use `text-ps-volt` on dark or court surfaces. Control edges are `border-line-strong` (3:1 or better). `--ps-border` / `border-line` is decoration only (dividers, card hairlines). Never put a coloured fill behind slate text.
Derived tokens added in this upgrade (checked by `node scripts/brand-contrast.mjs`): `--ps-volt-hover #DAF87A` (volt button hover), `--ps-ink-raised #1B3138` (hovered card on dark).

Dark hero recipe: `ps-surface-dark ps-hero`. Gradient (ink to court-deep) plus court lines, all CSS and one SVG file.

## 2. Type

Barlow Condensed (display, `font-display`) for h1 to h4, buttons, scoreboard numerals, nav labels. Inter for body and UI. Noto Sans Tamil is already in both stacks; `:lang(ta)` switches off uppercase and tracking for anything inside `lang="ta"`.

| Role | Use | Notes |
|---|---|---|
| H1 `h1` / `text-h1` | one per page, page title | 36 to 64 px, 800, uppercase, line height 1.0 |
| H2 `h2` / `text-h2` | section titles | 28 to 44 px, 800, uppercase |
| H3 `h3` / `text-h3` | card and sub-section titles, price | 22 to 30 px, 700, sentence case |
| H4 `h4` / `text-h4` | card titles | 18 to 22 px, 700 |
| Lead `text-lead` | one intro line under a heading | 17 to 20 px, `text-fg-muted`, max width `max-w-2xl` |
| Body `text-body` | paragraphs | 16 px, never smaller |
| Small `text-small` | helper text, meta | 14 px |
| Eyebrow `ps-eyebrow` | small caps label ABOVE a heading (tracked, with a skewed tick) | 13 px, 700, muted |
| Numbers `ps-num` | prices, dates, counts | tabular figures |
| Score `ps-score` | scoreboard numerals only | Barlow 800, 40 to 72 px |

Max line length for prose: `max-w-prose` (65 ch) or `max-w-2xl`. Never centre long paragraphs.

## 3. Spacing (8 px grid)

Section vertical padding: `py-section` (48 to 96 px, `<Section>` does it). Gap between blocks in a section: `mt-8` (heading to content), `gap-6` between cards (`gap-4` on 360 px grids of 2). Card padding `p-5 sm:p-6`. Inside a card: title, `mt-2` summary, `mt-4` price, `mt-5` actions. Container: `ps-container` (16 px gutters, 24 from 768, 32 from 1280, max 1200). Touch targets: at least 44 px (`min-h-tap`; every `ps-btn` already is).

## 4. Radius, elevation, borders

Radius: `rounded-md` 8 px (buttons, inputs, nav items), `rounded-lg` 12 px (cards, panels), `rounded-pill` (chips). Never `rounded-2xl` or fully round cards.
Elevation: 0 flat band; 1 `shadow-card` (cards at rest, `ps-card`); 2 `shadow-raised` (hover or lift); 3 `shadow-overlay` (mobile menu, popovers). Dark surfaces use hairline borders and tint, not shadows. Borders: 1 px `border-line` on cards; 2 px only on controls (`border-line-strong`) and dashed empty states.

## 5. Motifs (use sparingly: at most ONE per screen)

- **Court lines**: `ps-hero` and `<Section pattern>` and the footer draw a badminton court outline (files `public/brand/court-lines.svg` for dark, `court-lines-ink.svg` for light) at 6 to 10 percent opacity, bottom right. Decorative, no markup needed.
- **Skewed accent rule**: `<span class="ps-rule" aria-hidden="true"></span>` (a 12-degree skewed bar, court on light, volt on dark). SectionHeading and PageHero add it for you. Use `ps-rule ps-rule-sm` inside cards.
- **Lower-third tag**: `<span class="ps-lowerthird">Live now</span>`: a volt label with angled ends, ink text. For a single highlight per page (a date, "Covered by Power Smash", a package badge). Not for body copy, not more than one per card.
- **Scoreboard**: `StatCounter` (volt numerals, label bar) on a dark band only. Group in a `grid grid-cols-2 gap-4 md:grid-cols-4`.

## 6. Recipes (copy these)

Section heading (always through the component):
`<SectionHeading eyebrow="Services" title="..." lead="..." />` renders eyebrow, h2, rule, lead. Eyebrow is optional (the owner owns the text; do not invent one: use only wording the page already has).

Bands: `<Section tone="default|surface|dark|court" pattern>`; `pattern` (new, optional) adds the court lines. Hero: `<PageHero tone="dark">` for inner pages; Home hero: `<section class="ps-surface-dark ps-hero ps-hero-lg">` with the `ps-container` inside, h1, `<span class="ps-rule">`, lead, buttons (`mt-8 flex flex-wrap gap-3`).

Buttons (`<Button variant size>`, all already restyled; labels are uppercase display text):
- Primary action on LIGHT: `variant="primary"` (court fill, white text). One per band.
- Primary action on DARK or court: `variant="volt"` (volt fill, ink text). One per band.
- Secondary: `variant="secondary"` (court outline, light surfaces only).
- Quiet: `variant="quiet"` (surface-aware outline; works on both).
- Sizes: `sm` (header, dense), `md` (default), `lg` (hero and CTA). Never build a button with hand-written classes: use `ps-btn ps-btn-primary|volt|secondary|quiet` plus `ps-btn-sm|lg` for non-link elements.

Cards: `class="ps-card ps-card-hover p-5 sm:p-6"` (hover lift only when the whole card is a link; make it a link with `after:absolute after:inset-0` on the title link and `relative` on the card; `ps-card` is already `relative`). `ps-card-accent` adds the skewed top tick (packages, route cards). `PackageCard`, `TournamentCard`, `StatCounter`, `FaqList`, `EmptyState` are done. Icon in a card: `<span class="ps-icon-tile"><Icon size={24} aria-hidden="true" /></span>`.

Chips and badges: ONE vocabulary for the public site, the competition pages and the admin. `ps-chip` (body font, 13 px, bold, sentence case, pill, 26 px tall) + a tone: `ps-chip-neutral` (outline), `ps-chip-court` (done or confirmed, tint), `ps-chip-ink` (solid), `ps-chip-live` (red FILL with white text, never red text on dark). The competition `StatusBadge` and the admin `Badge` (`src/admin/ui.tsx`) are thin wrappers over `ps-chip`: they add a tick (court / good), a dot (neutral, ink, live) or an alert icon (admin warn, danger). The words always carry the meaning.

Information notes (never the alert red; an information note is not an error):
- `ps-note` + `ps-note-icon`: a note card (surface, court accent edge, Lucide Info 20 px). `ps-note-band` + `ps-note-band-inner`: a full-width strip under the header on the soft court tint. Use the shared `src/components/site/notices/SampleNotice.astro` (`placement="band" | "inline"`, pass the page's `data-*` test hook); the competition, archive and international sample notices all render it.
- Admin: `ps-admin-callout ps-admin-callout-info` (the same court tint) for information, `ps-admin-callout-warn` (alert edge) only for warnings; the admin preview strip uses the same tint. There is no third tone.

Score cards, brackets, entries: names never break inside themselves (each player in a `white-space: nowrap` span, a doubles pair one player per line, breaking only at " / "); game numbers in fixed narrow columns, Barlow tabular figures; the winner gets a tick, bold text and an accent bar (never colour alone).

Other recipes added in the premium pass (components.css unless noted): `ps-hero-home`, `ps-hero-stats`, `ps-hero-stats-note` (home hero and its framed channel figures), `ps-section-split` (`-body`, `-aside`: a heading row with links at its right end), `ps-cta-panel` (a CTA card: heading left, buttons right), `ps-pkg`, `ps-pkg-head` (package cards whose dividers, prices and buttons line up across a row), `ps-ticks` (a tick list), `ps-form-aside` ("Good to know" card), `ps-form-wa` ("Prefer WhatsApp?" row), `ps-loading` (a pulsing dot, still under reduced motion), `ps-tick` (a framed, full-row tick box; defined in `src/components/forms/FormSection.astro`), and the footer set `ps-footer-nav`, `ps-footer-list`, `ps-social`, `ps-social-link`, `ps-legal-list`.

Breadcrumbs: on phones (below 640 px) a deep trail shows only the parent link with a back chevron; the full trail stays for screen readers and in the JSON-LD. Long hero eyebrows and h1s wrap balanced.

Icons (Lucide): 18 px inside small buttons and meta rows, 20 px in buttons and list ticks, 24 px in icon tiles, 28 px at most for feature icons. Always `aria-hidden="true"` when decorative. Colour: `text-link` (court on light, volt on dark).

Lists of cards: `grid gap-6 md:grid-cols-2 lg:grid-cols-3` (360 px: one column). Equal height cards: the `li` wraps the card, the card has `h-full`.

Forms and panels: unchanged tokens; wrap a form in `<div class="ps-card p-4 sm:p-6">` if you need the premium frame (do not edit the form kit).

## 6a. Dark mode

Dark mode follows the device setting (`prefers-color-scheme`); `data-theme="light"` on `<html>` opts out and `data-theme="dark"` forces it. There is no on-page switch (it would need JavaScript). Every colour comes from the semantic roles, so a component written with them needs nothing extra; the dark values and the measured contrast pairs are in `docs/BRAND.md` ("Dark mode"). Rules: volt fills always keep ink text; court and live FILLS stay the same, only court and live TEXT switches to the bright variants; the admin adds two scoped tokens (`--ps-admin-chip-bg`, `--ps-admin-chip-edge`) with their own dark values in `src/admin/admin.css`.

## 7. Header and footer

Header: ink bar, hairline, volt active-page underline; it compacts (64 to 56 px, shadow appears) as you scroll, CSS only (scroll-driven animation, a progressive enhancement; browsers without it keep the full height). Footer: ink with court lines, a volt-to-court hairline on top, grouped link columns with eyebrows, WhatsApp and social links, legal row. Pages do not touch either.

## 8. Motion

150 to 250 ms only, easing `--ps-ease`. Allowed: colour and shadow changes, 1 to 2 px lift on hover (`ps-card-hover`, buttons), 1 px press on `:active`, the chevron turn in FAQs, `ps-rise` (an opacity and 8 px rise entrance, 250 ms) on the hero text only. No parallax, no auto-playing carousels, nothing looping except the LIVE dot. `prefers-reduced-motion` already zeroes durations and the header compaction is wrapped in `no-preference`.

## 9. Do and do not

Do: one primary button per band, generous whitespace (sections breathe at 48 to 96 px), uppercase only for h1/h2/buttons/eyebrows, numbers in `ps-num`. Do not: use volt on a light surface as text, use two motifs in one card, centre-align body text, stack more than 3 accent colours, add shadows to dark cards, hard-code colours or px sizes, leave a heading without a clear level (one h1, then h2, then h3). `<Todo>` badges stay loud (red dashed): do not restyle or hide them.
