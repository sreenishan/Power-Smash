# UI polish notes (M4)

Plain notes for whoever reads the UI changes. Each section is one implementer's work; this first section is the shared design system and the content pages ("marketing").

## Marketing: shared design system and content pages

Scope: `src/styles/components.css`, `src/components/ui/*`, the content pages (home, services, pricing, about, support, 404) and the shared hero, CTA and card components. Nothing was added to `package.json`, no new font, image or dependency, no new script. Copy, prices, claims and data are unchanged. Every existing class, prop and token still works (the changes only add).

### What changed

| Finding | What was done |
|---|---|
| M-01 button groups | New recipe `.ps-actions` (a row of buttons: natural widths from 640 px, and on a phone every button spans the row so the primary and its neighbours share one width and one left edge). New recipe `.ps-actions-card` for the buttons at the foot of a card (a grid: two columns only when each gets 15 rem, otherwise stacked at equal width). Used in `PageHero`, `CtaBlock`, `EmptyState`, `PackageCard`, the home hero and band rows, About, Support and 404. Pairs of non-primary buttons now use one variant: Home "Pricing" and "All tournaments", About "Contact" and Support "Contact us" are `secondary` like their neighbour. |
| M-02 desktop home hero | From 1024 px the home hero is two columns (copy and buttons left, the two stat tiles and the as-of note right). From 1024 px the court lines are drawn whole inside the right half of every `.ps-hero` and `.ps-pattern` band, fitted to the band's height (`top`/`bottom` 8 percent, `right` 3 percent, `width: min(40rem, 40%)`), still at the existing 7 percent opacity. Phones and tablets keep the cropped bleed. `.ps-hero-lg` padding is 5 rem on desktop (the tall phone padding is no longer needed). |
| M-03 card titles | Card titles are `text-h3` (22 to 30 px) in `PackageCard` and the home route cards; the "How it works" step titles are `text-h3`; the "Add-ons" heading is a real h3 (was shrunk to h4 size) and the add-on card names are real h4 headings. `PriceTag` amounts are `font-bold` (700, was 800) so a real price cannot out-rank the package name. |
| M-04 grid counts | New helper `cardGridClass(count)` in `src/components/ui/card-grid.ts`: 1 card = one column, 2 = two from 768, 3 = three from 1024 only (no two-column step that leaves an orphan), 4 = two from 768 and four from 1280, more = two then three. Used for the home route cards and teaser, the Services and Pricing groups and the sponsor row. A lone card (Promotion) uses `PackageCard wide`: two columns from 768 (name and summary left, price and buttons right, divided by a hairline). Add-on lists use `gap-6` like the packages above them. |
| M-05 support text | Explicit spaces around the YouTube Help links ("Help: Buy ... and Buy Super Thanks."). The channel URL card no longer uses `break-all`: 14 px on phones, 16 px from 640 px, `break-words` as a safety net. |
| M-06 section links | New `JumpNav` component and a `jump` slot on `PageHero`: pills with a 44 px tap height under the hero text on Services (For organizers, For players and parents, Promotion) and Pricing (Tournament coverage, Player products, Promotion, Sponsorship). The labels are the section titles the pages already show. Pricing sections now carry ids (`organizers`, `players`, `promotion`, `sponsorship`). |

Two small decisions that differ from the finding text, with the reason:
- Four-card rows go to four columns at 1280 px (`xl`), not 1024 px (`lg`). At 1024 px four columns are about 226 px wide, which is narrower than the "Ask on WhatsApp" button (about 205 px plus the card padding), so labels wrapped.
- `CtaBlock` switches to side-by-side at 1024 px (`lg`), not 768 px, so at tablet width the two buttons sit in one row under the text instead of in a ragged stack beside it.

### What to check (Playwright and the owner)

- Home at 1280: hero is about 510 px tall, headline on two lines, tiles on the right over a whole court; "How can we help?" is visible without scrolling at 1280 by 800.
- Phones: every button group is full width and aligned; nothing was added to the JS on view.
- Pricing and Services: the pills scroll to the right section under the sticky header (the existing `scroll-padding-top`).
- `PackageCard` markup now has two wrapper divs; on a normal card they use `display: contents`, so spacing is identical to before.

### Not done here

- `src/pages/500.astro` still has its own `flex flex-wrap gap-3` button row (it mirrors the 404 page). It is outside the listed pages; see the shared requests in the report.
- `TournamentCard` titles stay `text-h4` (not in the selected findings).

### Verified (marketing)

Two build rounds, photographed at 390, 768 and 1280 on home, services, pricing, about, support, tournaments, live, privacy and 404 (after photos in the session scratchpad `ui/after/marketing`). No horizontal overflow, one h1 per page, no text under 12 px, first-party JS budget unchanged (heaviest page 77,925 bytes gzip, limit 81,920). `npm run check`: 0 errors. `npx vitest run tests/site tests/legal tests/lib tests/forms tests/archive tests/admin`: all pass. `PS_REQUIRE_DIST=1 npx vitest run tests/build`: pass. Playwright `pages.spec.ts` on both phone sizes plus an extra axe pass over home, services, pricing, about, support, tournaments, live and the 404 page: zero axe violations of any impact.

## Product: archive, forms and admin

Scope: `src/components/archive/*`, `src/components/forms/TurnstileWidget.tsx`, `src/admin/*`, `src/pages/matches/[slug].astro`, `src/pages/players/*`, `src/pages/alerts.astro`, plus two small files the archive findings name: `src/lib/archive/matches-client.ts` and `src/lib/archive/labels.ts`. No copy, price, claim or data changed; no new dependency, font, image or script; nothing added to the JS on view that matters (heaviest page 77,974 bytes gzip, limit 81,920; `/matches/` is 4,157 bytes).

### What changed

| Finding | What was done |
|---|---|
| F-01 empty video panel | With the YouTube embed off, the panel now holds the real volt button (`ps-btn ps-btn-volt ps-btn-lg`, a Lucide Play icon, 244 x 52 px) centred on the dark panel over the court lines at a low level. The "(opens in a new tab)" text for screen readers stays. The caption link under the panel now shows only when the click-to-load player is on, because otherwise it repeated the button. The link rule in the panel's CSS skips `.ps-btn`, so the button keeps its colours. |
| F-02 match cards | With thumbnails off (today) a card has a 56 px header strip (volt VS tag and the category) instead of a 16:9 black block: a card is 171 px tall on a phone (was 341) and 264 px at 1280. The category (or the round when there is no category) is shown once; the small line under the title now holds only what the strip does not (the round). New helper `cardLabels()` in `src/lib/archive/labels.ts` decides this, and both `MatchCard.astro` and `renderCard` in `matches-client.ts` use it, so the two stay the same. With thumbnails on, the picture block is unchanged. The category text is no longer hidden from screen readers (the strip is the only place it appears now); only the VS tag is. |
| F-03 filters on a phone | The Search field stays visible. Year, Tournament, Category, Age group, Round, District, Sort and Clear sit in a `<details>` titled "More filters", closed on a phone and tablet and opened by `installMatchFilters` from 1024 px up. The first result now starts a short scroll down, not a screen and a half. |
| F-04 hero tone | The match list, players list, match page and player page use `PageHero tone="dark"`. The buttons are volt ("Book coverage", "Get my highlight reel"), one per band. |
| F-05 raw title | The match page wraps its hero in a div with `[&_h1]:normal-case [&_h1]:text-h2`, so the h1 shows the title in its own casing at the h2 size (28 px on a phone, 44 px at 1280; three lines on a phone, was four). The text is untouched. This was done locally because `PageHero` is a shared file; see the shared request. |
| F-06 player profile | Matches on record and Tournaments are two `StatCounter` tiles (volt Barlow numerals) in a dark rounded panel; First seen and Latest match are two labelled rows in the same panel (to the right from 640 px, below on a phone). The "Counts are read from video titles by Power Smash." note stays under the panel. Chips use `ps-chip ps-chip-court` (district, academy) and `ps-chip ps-chip-ink` (categories). Partner and Opponent names have the link colour and an underline. |
| F-07 spam-check placeholder | The sentence now sits inside the reserved 65 px box, drawn as a dashed box, as one element. The line the status text uses once the widget is there is kept as an empty 21 px row under it, so the whole area is exactly as tall as the loaded state and nothing moves when the widget loads (measured: the Send button stays at the same y while the form starts). Same words; `min-h-[65px]` kept in both places the E-1 test reads. |
| F-08 alerts notice | "Email alerts are not switched on yet. Signing up saves your address for when they are. Until then you will not get any email from us." is now a green-edged note above the form on every width. The same bullet was removed from the "Good to know" box so it is not said twice. Words unchanged. |
| F-09 missing space | `players/[slug].astro`: the space after "removal," is there, and under the sentence a primary button "Send us a request" (to the content-removal page, full width on a phone) is the main action; the inline link stays. `support.astro` was already fixed by the marketing work (explicit spaces around the YouTube Help links), so nothing was done there. |
| F-10 admin video cards | The five "Lock this" ticks moved into one closed panel per card, "Lock fields (N)" with N the number of ticked fields, with the field name on each tick (Tournament, Category, Age group, Round, Players) and the old sentence as the panel's intro. Approve is full width; "Not a match video" and "Keep hidden" share the next row. The review page with both sample cards is 2,227 px tall at 390. `Button` in `src/admin/ui.tsx` got an optional `className`. |

### Decisions that differ from the finding text

- F-10: the finding asked for the same label text on each tick. Five boxes with the same name are hard to tell apart for a screen reader once they are away from their fields, so each box is named after its field and the sentence "Lock this: the sync must not change it" is kept once as the intro.
- F-07: the finding said a 65 px box. The box is 65 px, plus the 21 px status row beneath it, kept empty on purpose (the height of the whole area is what the E-1 test protects).
- F-03: closed below 1024 px, not below 640 px, because at tablet width the eight controls are still four rows.

### Not done

- At 1280 the Match details card is taller than the video column, so there is blank space under the video lower down the page. A `lg:sticky lg:top-24 lg:self-start` on the video column would keep the video on screen while the card is read; not added because it could not be checked in a build round.
- Unhydrated forms: before a form scrolls into view its fields and Send button are disabled in the HTML, and the Send button is drawn at 70 percent opacity (white on green about 3.3:1). An automatic scan of `/contact/` at 390 before the form has been scrolled to reports one "serious" contrast item for that reason. After hydration axe is clean. This was already the case before this work and is not changed here.

### Shared request

- `src/components/ui/PageHero.astro`: add an optional `rawTitle?: boolean` prop that puts `normal-case text-h2` on the h1. The match page can then drop its wrapper div (`[&_h1]:...`) and pass `rawTitle`.

### Verified (product)

Two build rounds, photographed at 390 and 1280 on matches, two match pages, players, two player pages, admin and the seven form pages, plus the admin screens at 390 (after photos in the session scratchpad `ui/after/product`). First-party JS budget fine (above). Playwright checks (scratch, `tmp/zz-product-check.mjs`): axe wcag2a/2aa/21a/21aa shows no critical or serious item on `/matches/`, both match pages, `/players/`, both player pages, `/alerts/`, `/contact/` (after hydration), `/request/`, `/book/` at both widths and on the admin video screen with a lock panel open; exactly one h1 on each; no horizontal overflow; the filter panel is closed at 390 and open at 1280; a card drawn by the script has the same strip as the built one; the watch button is 52 px tall; all decision buttons are at least 48 px tall. `npx vitest run tests/site tests/legal tests/lib tests/forms tests/archive tests/admin`: 1,308 pass. `PS_REQUIRE_DIST=1 npx vitest run tests/build`: pass. `npm run check`: 0 errors.

## Review fixes

The reviewer found no regressions (an empty list), so this pass only applied the sensible shared-file requests the two implementers left open. Copy, prices, claims and data are unchanged; no dependency, font, image or script was added; the JS on view is unchanged (heaviest page 77,975 bytes gzip, limit 81,920).

| Request | What was done |
|---|---|
| 500 page button row | `src/pages/500.astro`: the button row is now `ps-actions mt-8`, like the 404 page. Measured: on a phone both buttons are 358 px wide, one under the other, on one left edge (404 and 500 identical); at 1280 they sit side by side at their natural widths. |
| Raw title on the match page (F-05) | `PageHero` has an optional `rawTitle` prop that puts `normal-case text-h2` on the h1. The match page passes it and the wrapper div with `[&_h1]:...` is gone. Measured before and after: 28.6 px on a phone and 44 px at 1280, text-transform none, weight 800, one h1; the page looks the same. |
| Footer heading wrap (M-07) | In the screenshots "Players & parents" wrapped at 1280 (and at tablet width), so its first link sat lower than its neighbours; at 390 it already fitted on one line (by 2 px), so the wrap named for 390 was not reproduced. Two small changes in `SiteFooter.astro` and `components.css`: the heading tracking is 0.12em (was 0.14em), which makes the label fit on one line at 768 and at 1280 (161 px of text in a 162 px column); and the four link groups now share one heading row through subgrid (`.ps-footer-group`), so when a heading still wraps (640 and 1024 px) the first links of all four columns stay on one line instead of one column starting lower. Where nothing wraps (390, 768, 1280) the layout is the same as before, row gaps included. Browsers without subgrid keep the old stacked columns. The nav has `content-start` so the shared rows keep their natural height. |
| Unhydrated Send button contrast | `src/components/forms/styles.ts`: `disabled:opacity-70` is removed from the shared button base (the pending state keeps `aria-disabled:opacity-70`, which axe does not score). Before a form hydrates, the Send button is in a disabled fieldset and was drawn at 70 percent (white on green about 3.3:1); it is now full colour (white on court green, about 6.2:1) and still has the wait cursor and the "Loading the form..." line above it. A scan of `/contact/`, `/book/` and `/request/` at 390 before anything is scrolled or touched now reports zero critical or serious items. |

### Not done

- Product pages adopting `ps-actions`, `ps-actions-card` and `cardGridClass()` for their own button rows and grids: this was an offer, not a defect, and no screenshot showed a problem there. Left for the next pass that touches those pages.
- Where the first link of a footer column is a two-line link ("Highlight reels and match files") its first text line sits about 10 px above the single-line first links of the other columns, because the link box is taller than the 44 px minimum and its text is centred. The boxes themselves start on one line. Not changed: it is the link's own wrapping, not the heading.

### Verified (review fixes)

Three locked rounds (build, tests/build, photographs, JS budget, a scratch layout and axe script that is not kept). After photos in the session scratchpad `ui/after/fix` for home, contact, a match page, services, pricing and 404 at 390 and 1280: no horizontal overflow, one h1 each, no text under 12 px. `PS_REQUIRE_DIST=1 npx vitest run tests/build`: 14 pass, 2 skipped. `npx vitest run tests/site tests/legal tests/lib tests/forms tests/archive tests/admin`: 1,308 pass. `npx playwright test tests/e2e/pages.spec.ts`: 44 pass (axe, zero critical or serious items, no horizontal scroll at 360 and 390). `npm run check`: 0 errors, 0 warnings, 2 hints. No server was left running.
