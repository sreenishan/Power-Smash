# M1 Site-shell worker notes

Status: built, 2026-10-21. `npm test` green, `npm run check` clean for every file this worker owns, locked `npm run build` succeeds.
Everything below is a DRAFT for the lead and the owner; nothing is published, committed or sent.

## 1. What was built (files)

**Layout and chrome**
- `src/layouts/BaseLayout.astro` (Props API unchanged: `title`, `description`, `canonicalPath`, `noindex`, `lang`, slot `head`; added optional `ogImagePath`, `ogImageAlt`, `ogType`, `jsonLd`, `organization`). Header, footer, skip link, canonical, Open Graph, Twitter, theme-color, JSON-LD blocks, `noindex` forced ON unless `PUBLIC_ALLOW_INDEXING === 'true'`.
- `src/components/site/`: `SiteHeader.astro`, `SiteFooter.astro`, `SponsorStrip.astro`, `WhatsAppButton.astro`, `TournamentCard.astro`, `nav.ts` (header, footer and legal links; `M1_ROUTES`), `whatsappText.ts` (prefilled text per page type and per package).
- `src/components/ui/`: `Button.astro` + `button.ts`, `Section`, `SectionHeading`, `PageHero`, `Breadcrumbs` (also emits BreadcrumbList), `JsonLd`, `PriceTag`, `PackageCard`, `StatCounter`, `EmptyState`, `CtaBlock`, `FaqList`.

**Content (all DRAFT, nothing the owner has not supplied)**
- `src/content/site.ts` extended: `channel` (88K / 1.9K / "October 2026", owner-stated, rounded, dated), `gstNote` (null), `about` (story, mission null; team, districts empty).
- `src/content/products.ts` (Appendix C.1 to C.3, every price `null`, `inclusionsApproved: false`, `gstInclusive: null`, `deliveryDays: null`, `quoteWordingApproved: false`), `sponsor-packages.ts` (Appendix C.4, same rules), `tournaments.ts` (empty list, validation, upcoming/past split, `publicContact`), `partners.ts`, `testimonials.ts` (both empty, shown only with `permissionRecorded`), `faq.ts` (four spec topics, every answer null so the whole FAQ is hidden).

**Libraries**
- `src/lib/money.ts` (`formatInr`, `priceDisplay`), `src/lib/jsonld.ts` (safe serialiser, Organization, BreadcrumbList, SportsEvent), `src/lib/seo.ts` (indexing helpers, `robotsTxt`, `PAGE_META`, `titleWithBrand`, `withTrailingSlash`), `src/lib/dates.ts` (NEW, see deviations).
- `src/config/env.ts` (`allowIndexing`), `src/env.d.ts` (`PUBLIC_ALLOW_INDEXING`, `PUBLIC_CF_ANALYTICS_TOKEN`, `PUBLIC_HSTS_MAX_AGE`).

**Pages** (English only, one H1 each, unique title and description, breadcrumbs except Home and the error pages)
`/`, `/services`, `/pricing`, `/support`, `/about`, `/tournaments`, `/tournaments/[slug]` (zero pages while the list is empty), `/404`, `/500`, `/robots.txt`.

**Tests** `tests/site/` (7 files: money, jsonld, seo, dates, products, nav, content). Covered: `formatInr` (0, 100, 12345600, 1250000000 = Rs 1,25,00,000.00, negatives, rejection of non-integers), the PriceTag decision function, the `</script>` / `&` / U+2028 / U+2029 JSON-LD payloads, robots output, `noindex` forcing, date handling (the D-030 20-October case), nav links limited to existing M1 pages, WhatsApp text without personal data, product invariants (every price null, nothing approved, no money, tax or time figure in any text), FAQ / partner / testimonial hiding, tournament contact gating.

## 2. Deviations from the brief, spec or plan

1. **`src/lib/dates.ts` created** although it is not on my ownership list: D-030 and CLAUDE.md require ONE date module and none existed. Lead: keep, move or extend it; my pages, `tournaments.ts` and the footer year use it.
2. **Organizer phone and email are not in the tournament record at all** (brief says show the contact only when `showContact` is true). D-029 (adopted) says organizer contacts never appear in static HTML (click-to-reveal edge endpoint, M3) and the privacy scan will flag them. The record therefore carries only `contact.name` and a public https `registrationUrl`, both shown only when `showContact` is true.
3. **Featured academy (Appendix C.3) is not listed**: it needs the academy directory (Phase 2, D-024).
4. **Header "Services" and "Partner with us" are labelled by audience**: "Organizers" (`/services`), "Sponsors" (`/partner`), "Players & parents" (`/services#players`), then Tournaments, a Book coverage button (lg and up, and inside the mobile menu) and a WhatsApp button. Spec 6.2's Matches, Players and Search entries are left out until those pages exist.
5. **No search box on Home, 404 or 500** (search arrives with the archive in M2).
6. **No separate "Deliverables" section on /services**: the package cards list the suggested inclusions, which are the deliverables. Add a section only after the owner fixes the final inclusions (OT-20).
7. **Share the channel (/support)** shows the channel URL as copyable text instead of a WhatsApp share button: `waLink()` needs a number and builds no share link. Request below.
8. **The Home H1** is an interim line, "Tamil Nadu badminton, on camera.", used only while `site.tagline` is null; the owner's chosen tagline (OT-23) replaces it. It is deliberately NOT tagline A ("on record"): nothing is pre-selected.
9. **Canonical URLs end with a slash** (`/about/`), matching the built `about/index.html`; `withTrailingSlash()` in `seo.ts` is the one place to change if the lead picks `trailingSlash: 'never'`. Internal links written without a slash (`/services`) cost one redirect on Cloudflare's default HTML handling: either switch the config to files (`build.format: 'file'`) or link with slashes. Lead decision.
10. **`set:html` appears in exactly one file**, `src/components/ui/JsonLd.astro`, fed only by `safeJsonLd()` (D-029 requires the safe serialiser; Astro cannot print JSON in a script tag without it). Any lint ban on `set:html` must allow that one file.

## 3. Proposed decisions (for the lead to put in DECISIONS.md)

- **P-1 Indexing switch.** Title: Indexing is opt-in per build. Context: hard rule 9. Decision: `env.allowIndexing` is true only when `PUBLIC_ALLOW_INDEXING === 'true'`; `BaseLayout` adds `<meta name="robots" content="noindex">` otherwise (a page can only add noindex, never remove it); `robots.txt` is `Disallow: /` otherwise; with indexing on it allows all, keeps `/api/` and `/go/` out and lists a sitemap only when one is passed (none in M1). Consequences: set the variable only in the G1 deploy; the Infra worker's `X-Robots-Tag` is the second layer.
- **P-2 Price display rule.** Title: A price is shown only if supplied. Decision: `priceDisplay()` returns an amount only for a positive integer of paise ("Starting from" for `starting_from`; GST wording only if `gstInclusive` is not null); "On quote - message us on WhatsApp" only for type `quote` with no amount AND `quoteWordingApproved` true; anything else renders `<Todo what="price for ...">`. Consequences: the strict gate fails until OT-20 (and OT-13 for "on quote") is answered.
- **P-3 Draft inclusions are shown with ONE page-level Todo** (`needsInclusionApproval`), not hidden: the owner needs to see the suggestions on the phone to approve them; a strict build fails until `inclusionsApproved` is true.
- **P-4 Owner-stated channel figures** live in `site.channel` with their as-of month; Home and About show "about 88K subscribers and 1.9K videos ... as of October 2026". They are not API data (D-016 item 5 clock does not apply); they switch to synced numbers in M2. Update `asOf` whenever the owner restates them.
- **P-5 Suggested lead products** (`suggestedLead: true`): Essential, Tournament promotion, Rally Partner, per D-024. The Home teaser shows these three until the owner chooses under OT-20.
- **P-6 `/book?package=<slug>` and `/partner?package=<slug>`** are the enquiry links for every product and sponsor package (slugs in `products.ts` and `sponsor-packages.ts`).

## 4. Facts verified

- YouTube Help, checked 2026-10-21 (fetched pages): "Buy a Super Chat or Super Sticker" https://support.google.com/youtube/answer/9178363 (paid, highlighted messages or stickers in live chat during a creator's broadcast; availability is by listed country) and "Buy Super Thanks" https://support.google.com/youtube/answer/9632365 (a purchasable animation over an eligible video plus a distinct comment; limited to listed countries and to eligible creators). `/support` says only that, makes no claim about which of them are enabled on this channel, no fee or perk claim, and links both pages. (https://support.google.com/youtube/answer/7277005 is the purchase-details page and https://support.google.com/youtube/answer/9277242 returned 404, so neither is cited.)
- Lucide 1.56.0 has no YouTube, Instagram or Facebook brand icons; social links are text links.
- Channel figures "88K subscribers and 1.9K videos": spec section 1 and VF-C14 (public channel page, 2026-10-20).

## 5. Intended TODO(owner) markers (strict gate fails on all of them until supplied)

Every page of the site carries one footer marker: **legal name, address, phone and email in the footer (OT-19)** (shown while any of the four is null in `site.ts`).

| Page | Markers |
|---|---|
| `/` | price for Essential, Tournament promotion, Rally Partner (3) |
| `/services` | approval of suggested package inclusions (1); price for Essential, Pro, Broadcast, Extra match day, Extra court, Travel outside the home district, Highlight reel, HD match file, Season pack, Custom edit, Tournament promotion (11) |
| `/pricing` | GST note (1), delivery time for each product (1), approval of suggested inclusions (1); the 11 prices above plus Rally Partner, Court Partner, Coverage Partner, Title Partner (4) |
| `/support`, `/about`, `/tournaments`, `/404`, `/500` | footer marker only |

Hidden (no marker) until supplied: WhatsApp button (no `PUBLIC_WHATSAPP_NUMBER`), WhatsApp Channel link, tagline, About story / mission / team / districts, partners strip, testimonials, FAQ items, tournaments (the page shows an EmptyState with "List your tournament - free" and "Book coverage").

## 6. Build inspection (locked build, `dist/client`, 2026-10-21 08:03)

- 19 pages built; my 8 pages each have exactly one `<h1>`, one `<main>`, `<meta name="robots" content="noindex">`, a unique title and a 69 to 145 character description, canonical, Open Graph and Twitter tags. `robots.txt` is `User-agent: *` / `Disallow: /` (indexing not enabled).
- First-party JavaScript on my pages: **none** (no `<script src>`, no islands; the only `<script>` is JSON-LD data). The `_astro/*.js` files in `dist` belong to the forms pages (React runtime 65.8 kB gzip, LeadForm 45 kB gzip, loaded only where the form islands are). CSS: 7.5 kB gzip, shared. Fonts: only the Barlow, Inter and Noto Tamil woff2 files from M0.
- Phone-width check (360 px emulation of the built pages in the Browser pane): no horizontal overflow on `/`, `/services`, `/pricing`, `/support`, `/about`, `/tournaments`, `/404`, `/500` (`scrollWidth === clientWidth`), no tap target under 44 px found by the script, header fits (logo, menu button). WhatsApp button not visible because no number is set in dev; it is hidden by design.
- Not tested: Safari, a real phone, a screen reader, the WhatsApp button's look with a number, axe (no tool installed).

## 7. Requests for the lead and other workers

1. **Lead (`docs`)**: record P-1 to P-6; decide the trailing-slash policy (deviation 9); allow `set:html` in `src/components/ui/JsonLd.astro` in any lint ban.
2. **Infra worker / `scripts/check-placeholders.ts`**: `public/brand/og-default.svg` contains the literal `TODO(owner)` in an XML comment (D-041 item 6c): the gate must skip `public/brand/*.svg` or run after the tagline is set. Also add `PUBLIC_ALLOW_INDEXING` (and `PUBLIC_CF_ANALYTICS_TOKEN`) to `.env.example` and the deploy workflow; `PUBLIC_ALLOW_INDEXING=true` only at G1. The type declarations are in `src/env.d.ts` now.
3. **Lead / `OwnerSection.astro` (lead's file)**: for the "section reappears when its input is supplied" gate test, a hidden section leaves no trace. Suggest it also render `<template data-owner-hidden={name}></template>` (an optional `name` prop) so the test can list what is hidden. I have not changed the file.
4. **Lead / `src/lib/whatsapp.ts`**: add `waShareLink(text)` (wa.me share link without a number) so `/support` can offer "Share on WhatsApp"; until then it shows the copyable URL.
5. **Book worker and Partner worker**: read `?package=<slug>` on `/book` and `/partner` (slugs: `essential`, `pro`, `broadcast`, `extra-match-day`, `extra-court`, `travel-outside-home-district`, `highlight-reel`, `hd-match-file`, `season-pack`, `custom-edit`, `tournament-promotion`; `rally-partner`, `court-partner`, `coverage-partner`, `title-partner`) and import `src/content/sponsor-packages.ts` for the packages. Pages should wrap content in `<div class="ps-container py-section">` or use `ui/Section.astro` and `ui/PageHero.astro`; `BaseLayout` does not wrap `<slot />`.
6. **Click logger**: every WhatsApp button carries `data-wa-click` and `data-wa-source="<where>"`, ready for a delegated `whatsapp_click` handler (no JS shipped now).
7. **Owner (OT-23 and others)**: the Open Graph image is an SVG, which WhatsApp, Facebook and X do not render; a PNG needs the rasteriser decision in D-041 item 5. Until then change only `DEFAULT_OG_IMAGE_PATH` in `src/lib/seo.ts` once `og-default.png` exists.
8. **Another worker's file** (not mine, not touched): `npm run check` reports 1 error, `src/lib/forms/idempotency.ts:17:35` (`Crypto` is not assignable to `RandomSource`). Also, the file-writing tool turned ` ` escapes into literal separator characters in at least one worker's regex (it broke `src/lib/forms/whatsapp-prefill.ts` earlier and my `jsonld.ts` once); I fixed mine with `String.fromCharCode`. Worth a grep of `src` and `tests` for U+2028 and U+2029.
9. **Packages wanted but not installed**: none. For the PNG set, see D-041 item 5.
10. **Sponsor package text** (Court Partner "banners on player and match pages", Title Partner "Power Smash Open naming rights") still follows Appendix C.4 and conflicts with D-016 item 6 and D-024; the lead and owner decide the final text under OT-22.
