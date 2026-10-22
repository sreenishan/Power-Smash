# M2/M3 wave: BUSINESS worker notes

Date: 2026-10-22. Scope: sponsor placements, partner report, inbox view-models, pricing-admin logic. Libraries, two endpoints, one component and one migration; no admin UI, no commit, no deploy, no real secret or account. Everything runs against interfaces with in-memory fakes or a mocked `fetch`; the one SQL file was applied and exercised on the local PostgreSQL 17 (`scripts/pg-local.mjs`).

## What was built

| Area | Files | Tests |
|---|---|---|
| Slot catalogue, schedule resolver, guard, validation, public JSON, go-link derivation | `src/lib/placements/{slots,schedule,expiry,guard,validate,public,hosts}.ts` | `tests/placements/{slots,schedule,guard,validate,public}.test.ts` |
| `/api/placements` (cached JSON), beacon endpoint, store adapters, runtime wiring, browser script | `src/lib/placements/{api-handler,beacon,beacon-constants,store,runtime,client}.ts`, `src/pages/api/placements.ts`, `src/pages/api/placement-beacon.ts` | `tests/placements/{api-handler,beacon,store-client}.test.ts` |
| Slot component | `src/components/site/PlacementSlot.astro` (not used by any page yet) | source checks in `guard.test.ts` |
| Migration | `supabase/migrations/0007_placements.sql`, `supabase/checks/0007_assertions.sql` (new file, same pattern as 0001/0002) | `tests/placements/migration-pg.test.mjs` (11 tests, skipped unless the local server is up) |
| Partner report, CSV writer | `src/lib/reports/{csv,partner-report}.ts` | `tests/reports/*` |
| Inbox | `src/lib/inbox/{status,lead,followup,filters,actions,export}.ts` | `tests/inbox/*` |
| Pricing admin | `src/lib/pricing-admin/{price-input,product-edit,mark-paid}.ts` | `tests/pricing-admin/*` (the brief named no test folder for this part) |

Counts (this wave's files): placements 107 (96 Vitest + 11 SQL, run on the local server), reports 44, inbox 49, pricing-admin 60. `npm run check` (locked): 0 errors.

## How it fits together

- **Placements**: the HTML never holds a placement. `<PlacementSlot slot page scope>` renders a reserved-size, always-labelled box only when `checkSlotOnPage` allows it, so a protected page, a page without independent content, a switched-off slot or a non-content page gets no box, no token and no beacon. A ~1 KB script (`client.ts`, bundled by Astro, so no new CSP hash) fetches `/api/placements`, picks today's creative in India with the shared resolver, draws it with DOM calls, and sends one batched beacon on pagehide.
- **Schedule rules**: live from start date through end date inclusive (IST); a one-tournament placement beats a global one; then priority; then earlier start; then id. `findOverlaps` reports `tie` (same priority, refused by `validatePlacement`) or `priority`. `expiringWithin(placements, today, 14)` feeds the dashboard card.
- **Public JSON** lists only explicit fields (id, slot, scope, image URLs, alt, headline, label, `/go/<slug>`, dates, priority). Live placements plus those starting within one day, so a creative can change at midnight India time without a refetch. Cache: `public, max-age=60, s-maxage=300, stale-while-revalidate=600`; `purgePlacementsCache` for the admin edit.
- **Clicks** go through the existing `/go` handler. `placementsToGoData()` turns placements into the `GoLinks` map and allowed hosts the handler already takes: `targetId` = placement id, label `sponsored`/`partner`, `expires` = end date, target host must equal the sponsor's registered host or a subdomain. `rollup_placement_clicks(day)` (SQL, idempotent) recomputes the day's clicks from `outbound_clicks` joined on `go_slug`, so `src/lib/infra` needed no change.
- **Beacon** (`beacon.ts`, documented at the top of the file): POST only, same origin, 2 KB cap read from the stream, per-build token (constant-time), bots answered 204 and never counted, Workers binding plus per-isolate window plus the DB counter (`reserve`, only when there is something new), each item must name a placement live today for its slot, path on the route allow-list for that slot, per-tournament placement only on its own page, visible at least 1,000 ms, daily-salted session hash (HMAC of salt, IP, UA; no raw IP stored anywhere), dedupe in memory then atomically in SQL. Everything accepted or dropped silently answers 204 (no oracle).
- **SQL**: `bump_stat(placement_id, date, impressions, clicks, page_path)`, `record_placement_impressions(day, session_hash, items)`, `rollup_placement_clicks(day)`; tables `sponsors`, `placements`, `placement_stats_daily`, `placement_page_stats_daily`, `placement_impression_seen`. RLS on, no policies, everything revoked then granted to `service_role` only (no delete on sponsors, placements or counters; functions executable by `service_role` only, fixed `search_path`). The local run confirmed constraints (https target, go slug format and uniqueness, dates, active needs an image, scope rule), counters, dedupe, bot-free click rollup, and anon/authenticated denial.
- **Partner report**: `buildPartnerReport` per sponsor and month (IST), totals, per placement, top pages; CTR in basis points by integer arithmetic and shown only with at least one impression; a month with no rows says so; partial month flagged; the counting rules and the ad-blocker note are always included; no scores or reach estimates. `partnerReportCsv` writes sections with `toCsv`.
- **CSV writer** (`reports/csv.ts`, shared with the inbox): text cells whose first visible character (after spaces, tabs, zero-width and bidi marks) is `= + - @`, or that start with tab or CR, get a leading apostrophe; typed numbers never do; no digit grouping and a dot decimal; money by `paiseToDecimal`; BOM for Excel.
- **Inbox**: `status.ts` (new > contacted > quoted > won > completed, lost with a 3 to 500 character reason, reopen lost to new, one step back to undo, completed final), `followup.ts` (overdue, due today, upcoming, none; closed leads never due; date validation), `filters.ts` (status, type, text, follow-up, created range, value; sorts; board columns with count and the sum of values that are set; move-to buttons), `actions.ts` (WhatsApp reply through `waLink()` with a reference-only greeting, never a hand-written wa.me; safe `mailto:` with the reference in the subject), `export.ts` (owner with `aal2` only, 5,000-row cap, audit entry that names no lead, defused cells, India time).
- **Pricing admin**: `parseRupeesToPaise` (no floats, no default, blank is null, Indian or Western grouping, zero refused), `validateProductEdit` (fixed and starting-from need a price when visible; a visible quote without a price needs the owner's wording approval; GST yes, no or unknown; delivery days or unknown), `validateMarkPaid` (gross, gateway fee, GST on fee, net settled, TDS, net received, certificate received and date, document type limited by GST registration, settlement status). A test scans the pricing code for percentage, rate and rupee literals.

## PROPOSED decisions (for DECISIONS.md, not written there)

1. **Placement slot sizes** are 728x90 / 320x100 banners, an 88/72 px strip and a 28 px coverage-title line. Design choices to reserve space, not facts; change them in `slots.ts` only.
2. **Beacon token** is the build variable `PUBLIC_PLACEMENT_BEACON_TOKEN`. It sits in the page source, so it only stops replays and scripts that never loaded the page; the real controls are the rest of the list. Without it the beacon answers 503 unconfigured (nothing counts).
3. **Creatives bucket** is a public Storage bucket named `creatives`; `creativeBaseUrl()` builds `<project>/storage/v1/object/public/creatives`. The bucket and its upload policy belong with the admin upload work.
4. **Empty banner** keeps its box and shows a quiet house link "Partner with Power Smash" to `/partner/` (no sponsor label, not a paid placement); an empty strip collapses (it is at the end of the page).
5. **Document type** `payment_receipt` is added to the three in D-021 (invoice, receipt_voucher, credit_note) because D-021 also says an unregistered business issues a plain payment receipt. While GST registration is false or unknown only `payment_receipt` may be chosen.
6. **Mark paid meaning of the fields** (CA to confirm): `gross` includes any TDS the payer withheld, so a sponsor who pays invoice minus TDS does not leave the invoice wrongly open; `netSettled = gross - fee - GST on fee` (only when both fee amounts are typed); `netReceived = netSettled - TDS`.
7. **Lost-reason presets** (Price, No reply, Went with someone else, Not a fit, Dates did not work, Duplicate enquiry) are tap-to-fill wording only.
8. **Lead types** in the inbox include `video_submission` and `alerts_signup` from `supabase/proposed/0003_lead_kinds_m3.sql`.
9. **Beacon limits** (30 a minute per connection per isolate, 240 an hour in the DB counter, 1,000 ms visible, at most 8 items, 2 KB) are engineering defaults, not business facts.

## Requests to others

- **Anon harness manifest** (`scripts/anon-harness.mjs`, `MANIFEST`): add `sponsors`, `placements`, `placement_stats_daily` (pk `placement_id`), `placement_page_stats_daily`, `placement_impression_seen`. Until then `tests/supabase/migration.test.ts` and `tests/supabase/migrations-structure.test.ts` fail on the manifest comparison (the same two tests also fail for the SCHEMA worker's tables until that manifest is updated).
- **`tests/supabase/local-pg.test.mjs`** hard-codes the eight table names and "2 check files": with 0007 (and the SCHEMA tables) it needs a generic assertion. It only runs when the local server is up, and it is now failing on the live server.
- **`src/lib/supabase/rest.ts`**: no rpc method; `placements/store.ts` carries a small `createRpcClient` with the same URL and key safety rules. Add `rpc()` there and delete the adapter.
- **`src/lib/infra` and `src/content/go-links.ts`** (no edit made): M3 moves `/go` slugs to the database (D-031). The lead should load `placements` + `sponsors` + the target URLs and call `placementsToGoData()` to build the `links` and `allowedHosts` that `createGoDeps` takes; the static `goLinks` map stays for non-placement links. The click-log row already carries `target_id` = placement id.
- **`src/lib/runtime-env.ts`**: a dedicated `BEACON_RATE_LIMITER` binding would be cleaner; the route shares `EVENT_RATE_LIMITER` for now. `src/env.d.ts` could declare `PUBLIC_PLACEMENT_BEACON_TOKEN` (it type-checks without).
- **`.env.example` / secrets docs**: add the public variable name `PUBLIC_PLACEMENT_BEACON_TOKEN` (any random string of 8 to 128 letters, digits, `_` `-`, changed per build). It is not a secret.
- **Scheduled jobs**: a nightly call to `rollup_placement_clicks(day)` for today and yesterday (IST), and deleting `placement_impression_seen` rows older than 2 days (`delete ... where day < ...`; `service_role` has the grant). Same Worker cron or workflow as the other retention jobs.
- **ARCHIVE worker**: pass `isProtected` explicitly into `PlacementSlot` (it fails closed: anything but `false` counts as protected), and wire `isPathProtected` into `createBeaconRouteHandler` once the archive can say whether a path is a protected page. The beacon cannot know that by itself.
- **ADMIN worker**: the admin writes `sponsors` and `placements` through SECURITY DEFINER RPCs that audit (D-007); this migration grants only `service_role`. Use `validatePlacement`, `expiringWithin`, `findOverlaps`, `buildPartnerReport`, the inbox and pricing modules as they are; call `purgePlacementsCache` after a placement edit.
- **Page integration**: `SponsorStrip.astro` (static partners from `partners.ts`) still exists; the lead decides whether `<PlacementSlot slot="home_partner_strip">` / `footer_partner_strip` replace it. The slot must sit beside the video player, never inside it.

## Open owner questions

- Which sponsors and prices exist (none are invented here); the sponsor package content is D-024.
- Is the match-page banner wanted at all (off by default, D-035 row 2)?
- The CA must confirm the Mark paid field meanings, the document types and the TDS handling (D-021).
- Lawyer: the privacy page should say the placement beacon stores a daily pseudonymous session hash (no IP, no cookie) for 2 days and daily counts after that. This wording is not written (`src/content/legal` is not mine).

## Not verified here

- `PlacementSlot.astro` type-checks (`astro check`) but is rendered by no page yet, so its browser behaviour and bundle size are untested; `client.ts` has pure-function tests only (no DOM in Vitest). Run `check:js-budget` after the lead adds the slot to a page.
- Real Supabase REST behaviour for the rpc route (only the local PostgreSQL functions and a mocked `fetch` were run).

## Fix wave (S2-1, B2-12, S2-3, S2-4, S2-10)

- **S2-1 / B2-12 CSV**: `sanitizeText` now folds NFKC (full-width and small-form `= + - @`, U+2212), skips leading whitespace, controls and invisible (Cf, bidi, zero-width) characters, and also prefixes any value that STARTS with a control or format character. It runs before control characters are stripped. Tests: a generated corpus (about 2,000 combinations) plus the reviewers' cases; Tamil, commas, quotes and newlines stay escaped.
- **S2-3**: `placements/path-gate.ts` builds an allow-list from `public_players` (not noindex) and `public_tournaments` (`page_eligible`), cached 5 minutes. The beacon refuses (204, stores nothing) any path not on it, and fails closed if the lookup fails. Match pages are NOT counted (their slugs are not in the views): the footer strip on a match page records nothing; the match banner is off by default. `PageContext.isNoindex` makes `PlacementSlot` render nothing on a minimal page, like `isProtected`.
- **S2-4**: the session hash is now HMAC(daily salt, connection, page class); the user agent is not in it. Dedupe key = salted hash + placement + IST day (SQL primary key) with the page class inside the hash. The database rate counter now fails CLOSED (503, nothing counted). Token rotation per build is the owner/CI step (`PUBLIC_PLACEMENT_BEACON_TOKEN`).
- **S2-10, for the Wiring worker (I did not edit `src/lib/infra`)**: in `src/pages/go/[slug].ts` load active `placements` (`PLACEMENT_COLUMNS` + `target_url`), the `sponsors` (`id`, `website`), build `targets = { [placement.id]: target_url }`, call `placementsToGoData(placements, targets, sponsors)` from `src/lib/placements/public.ts`, and pass `links = { ...goLinks, ...data.links }` and `allowedHosts = [...goAllowedHosts, ...data.allowedHosts]` to `createGoDeps`. `placementsToGoData` already enforces target host = sponsor host or subdomain. `validatePlacement` now takes `sponsorWebsite` and enforces the same rule at save time. A SQL trigger for it is not added (it needs the sponsor row join; propose for the Admin RPC).
