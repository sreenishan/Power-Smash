# ARCHIVE worker notes (M2c public pages)

Scope: public match and player pages, match list with filters, player directory, JSON indexes, sitemaps, protected-player rules, page-budget guard. Spec 7.2 to 7.5, 9.1 to 9.3; D-009, D-010, D-012, D-013, D-016, D-018, D-035.

## What was built

Library `src/lib/archive/` (new files beside SCHEMA's `types.ts`, which was not touched):
- `provider.ts` the provider interface (`ArchiveProvider.load() -> RawArchive`), raw record types, settings, `TOURNAMENT_PAGES_BUILT`.
- `seed.ts` FICTIONAL provider (default): 40 matches, 12 players (8 adult, 2 unknown, 1 minor_confirmed, 1 minor_suspected; two adults share a name), 5 tournaments (4 Tamil Nadu, 1 non-TN `listed_no_player_pages`). Video ids `fake-m00001`..; names "Demo/Sample/Mock/Trial ...".
- `supabase-provider.ts` REST provider: reads the six `api` views with the PUBLISHABLE key, 1,000-row pages, stable `order`, `accept-profile: api`, errors never carry a response body. Mocked-fetch tests only.
- `select.ts` chooses the source: seed unless `PS_ARCHIVE_SOURCE` is exactly `supabase` and the URL and publishable key exist.
- `protected.ts` the one place for D-012 (fail closed). `model.ts` builds the public model (`PublicArchive`): hidden matches are dropped there and never leave. `slugs.ts`, `search.ts`, `sitemap.ts`, `jsonld.ts`, `labels.ts`, `budget.ts`, `matches-client.ts`, `players-client.ts`.
- Components `src/components/archive/`: `MatchCard`, `MatchListPage`, `VideoFacade`, `ShareBar`, `ArchiveSeedNotice`.
- Pages: `/matches/`, `/matches/page/N/`, `/matches/[slug]/`, `/matches/index.json`, `/players/`, `/players/[slug]/`, `/search-index.json`, `/sitemap-index.xml`, `/sitemap-{matches,players,tournaments,pages}.xml`.
- `src/lib/urls.ts`: additive `ARCHIVE_ROUTES`, `matchPath`, `playerPath`, `matchListPath` (kept out of `ROUTES` because nav.ts treats every ROUTES value as a footer-linked M1 page).

## Rules implemented (all tested)

- Player: `adult_confirmed` with at least one full match gets a profile (indexable, directory, sitemap, search). `unknown` gets a MINIMAL page (noindex, name plus removal link, opaque slug `player-<id>`, no stats, no list, no JSON-LD, no share) only while `unknown_match_mode = noindex_minimal`. Minors: no page. A missing player id or unrecognised status is treated as unknown.
- Match: `full` (all adult), `listed` (non-TN event, raw title, no player or tournament links, "All India"), `minimal` (an unknown participant: noindex, generic title and description, no parsed details, no names or links, no JSON-LD except breadcrumbs, no share, opaque slug `match-<id>`, not in list, related lists, sitemap or JSON), `hidden` (a minor, a hidden event or video, or a dangling tournament reference: no page, dropped in `model.ts`).
- The raw title is the H1 on every kind (D-016); for `minimal` pages it is the only place a protected name can appear, and the tab title, description and Open Graph tags are generic.
- Search index: adult profiles and tournaments only (compact arrays). Match list JSON: full and listed only. Sitemaps: indexable pages only, with lastmod from real dates.
- Page budget: `assessBudget` warns at 10,000, fails above 14,000; `loadPublicArchive()` calls it on the estimated page count and fails the build above the line.
- Strict gate: `ArchiveSeedNotice` prints a `<Todo>` in the strict build while the source is the seed, and while `features.archivePages` is false. So `build:strict` refuses to ship made-up data or the unapproved archive wording.
- YouTube images and the player load only while `features.youtubeEmbeds` is true; otherwise a plain "Watch on YouTube" link and a placeholder block (nothing is requested from YouTube).

## Tests (`tests/archive/`, 70)

`slugs` (stability, collisions, reserved), `model` (classification, leakage matrix over the seed: search index, match index, sitemaps, public model, slugs, `hidden` mode, a player flipped to minor), `lib` (budget, JSON-LD escaping, search, filters, sitemap builders, provider selection), `supabase-provider` (pagination, headers, failure without body, runaway loop, reshaping, fail-closed settings), `dist-leakage` (scans every built file; skips without `dist/client`, `PS_REQUIRE_DIST=1` makes it required).

## Deviations and PROPOSED decisions

1. **Match slug is derived, not stored.** `PublicMatch` (SCHEMA's view) has no slug column, so `slugs.ts` builds `{side-a}-vs-{side-b}-{last 8 of video id}` for full matches and `match-<id>` otherwise. Stored slugs win when a provider supplies them. If a player is renamed the URL changes. PROPOSED: SCHEMA adds a persisted `slug` to `matches` (and a `slug_redirects` row on change), then the provider passes it through (`RawMatch.slug` already exists).
2. **Unknown-age player pages exist (minimal, noindex)**, following the owner decision in the common brief. CLAUDE.md D-012 text says "no profile page" for unknown; the two differ. Switch `unknown_match_mode` to `hidden` to remove them.
3. **Matches with an unknown participant** are not listed in `/matches` and not in any index (only their own noindex page exists). PROPOSED to keep.
4. **Non-TN (listed) events** are matches without parsed players. A non-TN event with a protected participant is treated like any other protected match (stricter than D-018 alone).
5. **Tournament links.** The archive tournament pages are not built here. `TOURNAMENT_PAGES_BUILT = false` keeps tournament names as plain text and out of the search index and sitemap links. When the tournament pages worker lands, flip it (one constant) and the links, sitemap and index entries appear.
6. **Spec 7.4 filters (district, academy, category, active year) on /players and the year/tournament/category filters on a player's match grid were not built**; search plus A to Z covers search-first. Spec 7.3 sponsor banner slot is not built (M3, `features.sponsorBanners` is off). Tamil share text (Appendix B) not added; English only.
7. **Match page "Views on YouTube"** shows the stored count without a score; `likes` is read from the view but never shown. D-016 day-30 refresh stays the sync's job.
8. `/matches/` order-by "Most viewed on YouTube" is a plain sort of the stored count, not a score.

## Requests to others

- LEAD: add `/matches/` and `/players/` to header and footer (`nav.ts` and its tests; ARCHIVE_ROUTES holds the paths) and move them into `ROUTES` when linked.
- LEAD: `src/pages/robots.txt.ts` should pass `sitemapUrl: absoluteUrl('/sitemap-index.xml', site)` (it passes `null` today). Not edited, not my file.
- LEAD/CI: set `PS_ARCHIVE_SOURCE=supabase` plus `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` only for the real build; flip `features.archivePages` and `features.youtubeEmbeds` only after the owner and lawyer approve D-012 wording (OT items).
- SCHEMA: view `0006_archive_api.sql` was not yet present when I wrote the provider; `supabase-provider.ts` follows `types.ts` (public_videos, public_matches, public_match_participants, public_players, public_tournaments, public_archive_modes). Needed: (a) `public_players` should only hold adult profiles (a `noindex` row is read as unknown age); (b) participants with `player_slug = null` are shown nowhere except the raw title; (c) matches with `page_mode = 'none'` are expected in `public_videos` with `type = 'match'`.
- Other workers: `tests/build/links.test.ts` currently fails on `admin/index.html: no canonical link` (not my page).

## Open owner questions

- OT: confirm D-012 behaviours above (minimal page for unknown age; minimal match not listed).
- Real data source is not connected: until the owner creates the Supabase projects and approves, every archive page shows a "Sample data" banner and the strict build refuses.

## Fix wave (review S2-2, S2-6, S2-7, B2-7, B2-8, C2-1, Tamil search)

- **S2-2** `SponsorStrip` renders nothing (no marker either) under `/players/` and `/matches/`, where every protected and minimal page lives.
- **S2-6 reconciled with the owner decision** (minimal noindex page): an unknown-age player page now shows NO name (H1 "Player page", generic title, opaque `player-<id>` address, removal link only). A name is shown only on a minimal MATCH page, where YouTube's own raw title already shows it. Names are in no sitemap, search index, JSON or other page. `MinimalPlayer` has no name field. Deviation 2 above is superseded by this.
- **S2-7** `RawArchive.suppressedNames`: a tombstoned name hides the player and every video whose raw title holds the name, even with no player row linked (normalised, word boundaries). The provider must pass the names (the view should expose normalised suppressed names or hold such videos; schema need below).
- **B2-7** tournaments sort newest first, undated last, ties by slug (explicit -1/0/1).
- **B2-8** a stored slug is ignored for any opaque match and always for minimal players; the old address goes to `PublicArchive.superseded` (redirect to the opaque page, or gone).
- **Tamil search**: `normaliseQuery` is NFC, keeps vowel signs and the virama, strips zero-width joiners; matching starts only at grapheme boundaries (`includesAtBoundary`). Tests in `fixes.test.ts`.
- **C2-1 redirects**: `src/lib/archive/redirects.ts` (pure) and `scripts/write-archive-redirects.mjs` (writes `dist/client/_redirects` from the same provider; uses jiti, run after `astro build`). Cloudflare `_redirects` supports 200/301/302/303/307/308 only, no 410, so removed or protected-old addresses are 301 to the neutral noindex page `/matches/gone/`. Chains flattened, loops dropped, live pages never redirected away, targets are always pages of this build (opaque for protected). Fails the step above 1,800 lines (limits: 2,000 static, 100 dynamic, 1,000 characters a line). `_redirects` is not uploaded or served as a file.

Requests: LEAD chain `node scripts/write-archive-redirects.mjs` in `scripts/build.mjs` and `build-strict.mjs` after `astro build` and before `finalize-headers`. WIRING (owns `supabase-provider.ts`): fill `RawArchive.redirects` from `api.public_slug_redirects` (readAll), and `suppressedNames`/`gonePaths` only from a privileged source (none public). SCHEMA needs: persisted `matches.slug` and `players.slug` must be opaque for non-adult rows and rewritten (with a `slug_redirects` row) when age status changes; a view or hold for name-only suppression of unlinked participants (`raw_name` normalised vs suppressed `name_normalized`); a real 410 needs the Worker lookup (open decision).
