# Fan4ever feature-parity audit (2026-10-29)

Read-only audit. Nothing in this document is built yet. The reference is Fan4ever (https://www.fan4ever.com/). Only these reference facts are verified: the public website menu (Tournaments, Players, Matches, Results, Live Scores, Videos), whose page contents could not be inspected because the browser blocked the site's app scripts, and the Google Play listing (real-time scores and match stats, court booking and schedules, joining tournaments and following events, highlights and trending plays, news, a fan community). Anything else about Fan4ever is unverified and not assumed.

## Summary

I compared what is verified about Fan4ever with your project and merged five area reviews into one table of 56 features. I checked the claims that decide what can be built now against the code and the decision records.

**Where it overlaps with Fan4ever.** You already have the content side: tournament lists and detail pages, player and match pages, search, a live-stream page, alert sign-up and an owner admin.

- It works on made-up test data only. Nothing is connected to the real database or to YouTube.
- The legal switches are all off, including the ones for archive pages, video embeds and email alerts.
- The release build refuses test data, so nothing can go public by accident.

**What makes Fan4ever different is mostly things your rules rule out.** Live scores, match statistics, rankings, results and community features all need one of two things:
- data you don't have (nobody keeps score for you), or
- public user accounts, which your rules switch off.

Your rules also protect junior players, and a live scoreboard would show their names in real time. I recommend not building these, or only building them after you make a deliberate decision and a new decision record is written. Court booking is a different business from your coverage booking.

**I can build about 23 items now without breaking any rule.** All of them stay hidden behind the existing switches. The main ones:
- Tournament filters, a "today" state, featured ribbons, add-to-calendar and share buttons.
- Archive tournament pages, built on test data only.
- Turning organizer submissions into items for your approval.
- A filming-permission record that defaults to "unknown" and hides the "Covered by Power Smash" badge until permission is granted.
- Player directory and profile filters.
- A home-page search box and a "Recently added" strip.
- Admin editing of adult players' district and bio.
- Setting the pinned live video from your phone instead of from a code file.
- The alerts back end and morning Telegram digest, with sending switched off.
- The missing products table, so saving a price in the admin stops failing.
- Admin hardening.

**I checked these facts directly:**
- Tournament pages are switched off in the code.
- Every legal switch is off.
- The price-save function exists in no database migration.
- The filming-permission fields exist nowhere in the database.
- No page shows a sponsor slot.
- The home page has no search box.

**Waiting on you:**
- Approving the archive launch and video embeds, with the lawyer.
- Whether to show match winners, which needs you to enter them.
- Starting Phase 2 (claim your profile, follow a player, payments) or Phase 3 (event registration, news).
- Allowing the download of the tool that makes the share-preview image.

**Waiting on outside services:** Supabase, the YouTube API key and policy reply, the domain, Turnstile, the Telegram bot, the Resend email service and Vercel.

## Feature-parity matrix

| # | Feature | Reference (Fan4ever, verified only) | Existing in Power Smash | Status | Missing work | Dependencies / rules | Plan phase |
|---|---|---|---|---|---|---|---|
| 1 | Tournament list (Upcoming / Past) | Menu "Tournaments"; Play "following upcoming events" | `src/pages/tournaments/index.astro` (owner list `src/content/tournaments.ts`, empty today; comment "No filters yet", spot-checked) | Partial | "Today/ongoing" state, featured ribbon + pinning, video counts on past events (spec 7.6); real entries | OT-11 owner list; D-005/D-029 (no organizer contacts in HTML) | P1 M1/M2c. BUILD NOW (code); data from owner |
| 2 | Tournament filters (district, level, month, category) | Not verifiable | None on /tournaments; the search index includes tournaments with slug null | Missing | Spec 7.6 filter chips on fictional/owner data | D-010, D-018 | P1 M2c. BUILD NOW |
| 3 | Tournament detail page | "Following upcoming events" | `tournaments/[slug].astro` (dates, venue, level, categories, organizer, consented registration link, JSON-LD); builds 0 pages | Partial | Map link, ShareBar, add-to-calendar .ics (no .ics code in src, spot-checked), "Get alerts" link, poster display | D-015/D-028/D-029 (contact only with consent); D-016 sponsor slot | P1 M1/M3. BUILD NOW (except sponsor slot) |
| 4 | Archive tournament pages (past matches by category and round) | Menu "Tournaments/Results/Matches" | Parser, identity, migrations 0004/0006/0008; `TOURNAMENT_PAGES_BUILT = false` (provider.ts:117, spot-checked) | UI only | Build the archive variant on the seed, then flip the constant; real data later | D-013 (3+ matches), D-018, D-016, D-012; archivePages flag | P1 M2c-3. BUILD NOW on seed; publishing = G2 (owner) |
| 5 | Organizer tournament submission | Not verifiable | `/tournaments/submit` LeadForm, lead kind tournament_submission | Partial | Convert the lead into a pending tournament candidate (feeds the admin "Submitted" tab); poster stays a link (D-035) | Supabase for real use; D-028 consents | P1 M3. BUILD NOW (conversion code + tests on the memory store) |
| 6 | Admin Tournaments screen (approve / hide / reject) | Not verifiable | `src/admin/screens/Tournaments.tsx`, RPC admin_decide_tournament (memory store only) | Built (D-102) | Edit fields (dates, venue, categories, featured + featured_until, covered flag); owner-flow e2e | D-006/D-007 audited RPCs; D-013 | P1 M3-1. BUILD NOW |
| 7 | Filming permission record (D-019) | Not verifiable | Form question only; no column in any migration (spot-checked) | Missing | Migration + admin fields defaulting to `unknown`; badge/live stream blocked unless `granted` (fail closed) | D-019 is "proposed" (owner + lawyer review the templates); ask-first (e) 12 says build the safe default and ask | P1 M3. BUILD NOW as a fail-closed default; wording/scope needs the owner + lawyer |
| 8 | Featured tournament listing | Not verifiable | `is_featured`/`featured_until` columns (0004, api view 0006); request-only field in the form | Admin toggle built (D-102); no page shows it yet | Admin toggle, ribbon/pin on the list (free, owner-set) | Paid featured = Phase 2 (D-020); no price (D-021) | P1 display: BUILD NOW; paid: P2 |
| 9 | Tournament QR posters | Not verifiable | `src/pages/posters/*`, `src/lib/qr/*`, admin Posters.tsx | Partial | Generate from admin/DB tournaments; fix isLocalHost gap B2-16 | Real domain (OT-07) for final QR | P1 M3-4. BUILD NOW (gap fix); final URL blocked |
| 10 | Joining / registering for tournaments, entry lists | Play "joining tournaments" | None; organizer's external link only (D-015) | Missing | Only for the brand's own Open (spec 8.8) | Phase 3, ask-first (e) 15; D-012 minors; Razorpay; DPDP | P3. NOT NOW (owner decision) |
| 11 | Draws / brackets | Not verifiable | Round parsed from titles only | Missing | Needs a draw data source | Not in spec; never fabricate; D-016 derived data; D-012 | Not in spec. NOT RECOMMENDED unless owner supplies data |
| 12 | Match schedules / order of play / court assignment | Play "managing schedules" (for court booking) | None | Missing | New fixtures model | Not in spec (spec rule 3); D-012 would name juniors | Not in spec. Owner decision |
| 13 | Following events / alerts sign-up | "Following upcoming events" | `/alerts` email form; nothing sent (EMAIL_ENABLED off, emailAlerts=false) | Partial | Subscribers table, double opt-in, one-tap unsubscribe, suppression list, admin Subscribers + CSV export (code only, sending off) | Sending = OT-07/OT-40, EMAIL_ENABLED (ask-first), lawyer; D-026 proposed | P1 M3. BUILD NOW (code, switched off); sending blocked |
| 14 | WhatsApp Channel follow button | Not verifiable | Hidden OwnerSection | UI only | None (owner supplies link) | OT-09; ask-first (e) 3 | P1. OWNER ONLY |
| 15 | Follow a player | Not verifiable (events only) | None | Missing | Follow UI, trigger, email | Spec 8.7/17 Phase 2; D-012 | P2. Owner decision |
| 16 | Player directory /players | Menu "Players" | A-Z list of adult_confirmed players with a full profile (fictional seed), nav hidden while archivePages=false | Partial | Spec 7.4 filters (district, academy, category, active year), academy on cards | D-012/D-013; seed refused by strict build; G2 ask-first | P1 M2c. BUILD NOW on seed |
| 17 | Player + tournament search (JSON index, Tamil) | One review: "finding players" | `search-index.json.ts`, `search.ts`, `players-client.ts` | Works on seed | Measure real index size; Tamil depends on OT-32 | D-010; D-012 never index protected | P1 M2c. Done (seed) |
| 18 | Home search box + "Recently added" rail | Not verifiable | Home is M1 "lite": "NO search box and NO latest matches" (spot-checked); no "Recently added" in src | Missing | Hero search (reuse the client) and a site-data rail, both gated on archivePages, excluding protected matches; watch the JS budget | D-035 row 1 (rail instead of trending); D-012; check:js-budget | P1 M2c. BUILD NOW behind the flag |
| 19 | Player profile page | Menu "Players" | `players/[slug].astro` (counts, matches with raw titles, partners/opponents, JSON-LD, removal link) | Partial | Match-grid filters (year/tournament/category), linked tournament names, the "Request an update" CTA pointing to /request/ | D-012/D-013, D-016 (label "by Power Smash", no aggregate views) | P1 M2c. BUILD NOW; Verified badge / claim = P2 |
| 20 | Protected-player and protected-match handling | Not verifiable | `protected.ts` (fail closed), minimal noindex pages, SQL checks, leakage tests | Works on seed/local PG | Live anon RLS tests in CI (M4); lawyer sign-off | D-012/D-076/D-078; mode switches ask-first (e) 6 | P1. Done in code |
| 21 | Admin edit of player district / academy / bio (adults) | Not verifiable | Columns exist; admin has only confirm-adult/rename/split/merge | Built (D-100) | Audited RPC + admin form, adults only (protected rows stay empty by DB check) | D-006/D-007; D-012; academies table is P2 (use text) | P1. BUILD NOW |
| 22 | Identity resolution (aliases, merge, split, rename + redirects) | Not verifiable | `src/lib/identity/*`, admin Players tabs, RPCs 0008 | Partial | Disambiguator in UI, merge undo, owner-flow e2e timing | Spec 10.5 no auto-merge; D-012/D-014 | P1 M2d. BUILD NOW (gaps) |
| 23 | Player photos | Not verifiable | Column only, never rendered | Missing | Consented upload + approval | Phase 2 claim flow; D-015/D-012; spec rule 6 | P2. Owner decision |
| 24 | Claim / correct / hide requests | Not verifiable | `/request/` form + admin "Player requests" tab | Partial | One-time code proof, claimant edits, Verified badge | D-015 proposed (owner + lawyer); D-012 no self-claim lifts a flag; claim flow is P2 | P1 intake done; rest needs the owner |
| 25 | Player SEO (sitemap, JSON-LD, slug redirects) | Not verifiable | `sitemap-players.xml.ts`, `jsonld.ts`, `write-archive-redirects.mjs` | Works on seed | Structured-data check in CI (M4) | D-012/D-013; indexing at launch ask-first | P1. BUILD NOW (CI check) |
| 26 | Match library /matches + filters + sort | Menu "Matches", "Videos" | `matches/index.astro`, paging, `index.json.ts`, `filterMatches()` (year, tournament, category, age group, round, district, text; newest / most viewed) | Works on seed | Real data; nav link when archivePages is on | D-016 (views as a plain sort only, D-077); D-012; G2 ask-first | P1 M2c. Code done; launch needs the owner |
| 27 | Match detail page | Play "detailed match stats" | `matches/[slug].astro` (raw-title H1, details labelled "by Power Smash", views, VideoObject JSON-LD, related, CTAs) | Partial | Real data, embeds; no stats (no source) | D-016 item 3; D-012/D-078 | P1 M2c. Code done |
| 28 | Video playback (click-to-load embed) and thumbnails | Not verifiable | `VideoFacade.astro`, `live-facade.ts`, `ytThumb()`; gated by youtubeEmbeds=false | UI only | Flip the flag; honour embeddable/madeForKids from API data | youtubeEmbeds = owner + lawyer; D-016 item 7; legal switch ask-first | P1. Owner/lawyer decision |
| 29 | Related matches | Not verifiable | `model.ts` relatedness | Works on seed | Real data | D-012, D-016 | P1. Done |
| 30 | WhatsApp share bar | Not verifiable | `ShareBar.astro` on match and player pages | Partial | Add to tournament pages; Tamil text (OT-32) | D-025/D-029 waShareLink; D-012 | P1. BUILD NOW (tournament pages) |
| 31 | Default Open Graph image + icons | Not verifiable | Pending | Missing | PNG converter download | Ask-first (e) 9 (download, D-041) | P1. Owner decision (install) |
| 32 | Highlights / Shorts rail | Play "match highlights" | Shorts classifier in parked sync; highlight reel = enquiry only | Missing | Shorts rail from API data | D-016 item 11 (content-type inference not cleared), OT-16, youtubeApiData | P1 optional. Blocked |
| 33 | Trending plays / trending players | Play "trending plays" | Removed by D-016 item 4 / D-035 row 1 | Missing | Nothing, unless YouTube replies in writing | D-016 III.E.4.h | NOT RECOMMENDED |
| 34 | /live page (pinned stream, past streams) | Menu "Live Scores" (a scores page, not proven to be a stream page) | `live.astro` + `content/live.ts` (pin set by editing code) | Built (D-101) | Admin-editable pin and past-streams list (owner works from a phone), scheduled-streams layout on fakes | youtubeEmbeds off; spec 7.13 | P1 M3-5. BUILD NOW (admin pin + layout) |
| 35 | Automatic live-status check (2-minute cached) | Not verifiable | `classify.ts`, `record.ts`; sync parked | Partial | Endpoint + RSS detector | youtubeApiData flag, API key OT-04, OT-16, Vercel Pro (spend) | P1 M2a-3. Blocked |
| 36 | Live scores, real-time scoring, court-wise live | Menu "Live Scores"; Play "real-time scores" | Nothing; the parser drops "live score"/"court N" as noise | Missing | Whole new subsystem (scorer accounts, realtime, UI) | Not in spec; D-006/D-007 (no third-party accounts); D-012 (would name juniors live); never fabricate; ask-first (e) 2, 12, 15 | NOT RECOMMENDED in Phase 1 |
| 37 | Game scores on match pages (`score_text`) | Play "detailed match stats" | Parsed only when the title has one; in no public view | Missing | View column + display | D-016 III.E.4.h (derived from API data, not cleared), OT-16; D-012 | Not in spec. Owner decision after the YouTube reply |
| 38 | Winners / Results page / win-loss | Menu "Results" | `matches.winner_side` always null | Missing | Owner-entered winners, admin field, Results page | Never fabricate; not in spec; D-012; owner data-entry effort | Not in spec. Owner decision |
| 39 | Detailed match statistics, rankings, leaderboards | Play "detailed match stats" | View count only | Missing | No data source exists | Never fabricate; D-016 (no composite / per-player aggregates) | NOT RECOMMENDED |
| 40 | Title parser | n/a | `src/lib/parser/` v1.0.0-m2b.1, gold scorecard (13 of 38 match titles auto-accept, D-082) | Works | Raise the auto-accept rate against fixtures (never weaken a fixture) | D-017, D-082; OT-35 owner spot-check | P1 M2b. BUILD NOW (improvement) |
| 41 | Admin video review queue + Title check | Not verifiable | `Videos.tsx`, `TitleCheck.tsx` (memory store) | Partial | Real backend | OT-51, Supabase | P1. Blocked (backend) |
| 42 | YouTube sync + 30-day purge, sync failure alerts | Not verifiable | `src/lib/sync/*`, parked | UI only | Activation, live check, smoke test | youtubeApiData, OT-04, OT-16, SYNC_ENABLED, Vercel Pro; reality test | P1 M2a. Blocked |
| 43 | Video submission (/submit-video) + admin queue | Not verifiable | Form + `Submissions.tsx`; videoSubmissions=false | Partial | Lawyer licence wording, footer link | OT-15; legal flag ask-first | P1 M3. Blocked (lawyer) |
| 44 | News / stories | Play "latest badminton news" | None | Missing | Whole feature | Spec 17 Phase 3; ask-first (e) 15; never fabricate | P3. Owner decision |
| 45 | Public sign-up, fan profiles, comments, likes, community feed, find-a-partner, in-app notifications | Play "community of fans"; one review "finding players" | None | Missing | New product area | D-006 sign-ups disabled; D-014 no public UGC in P1; D-012/DPDP minors; D-005/D-029 no contact data | NOT RECOMMENDED (P1); fan vote = P3 (spec 9.9) |
| 46 | Court booking / court schedules | Play "court booking and managing schedules" | None (/book is media-coverage booking, a different thing) | Missing | Venues, slots, payments | Not in spec; payments P2 (D-020); ask-first (e) 1, 12, 15 | NOT RECOMMENDED / owner strategy decision |
| 47 | Coverage booking /book + lead inbox | Not comparable | `book.astro`, `/api/lead`, `Inbox.tsx` | Partial | Calendar/timeline views, CSV export screen | Prices OT-19..22 (D-020/D-021); OT-41; deploy | P1 M1/M3. BUILD NOW (inbox views); go-live blocked |
| 48 | Owner admin sign-in (TOTP, aal2) | Not verifiable | `Login.tsx`, `auth.ts` (jose), `/api/admin/[action]` | Partial | Rate limit on /api/admin/*, admin axe/e2e on the memory store | Real run needs OT-51, Supabase; D-006/D-086/D-087 | P1 M3. BUILD NOW (rate limit, tests) |
| 49 | Users and audit viewer (owner only) | Not verifiable | `audit.list` action only | Partial | Audit viewer screen; editors stay off | D-007 proposed (owner-only) | P1 M3. BUILD NOW (viewer) |
| 50 | Telegram alerts + morning digest | Not verifiable | `telegram.ts`, `alerts.ts`; digest = `dueLeads()` only | Partial | Digest builder + no-contact-data test (sender off); D-006 alerts on role changes, CSV exports, setting changes | OT-08 bot; D-045; cron/schedule switch | P1 M1/M3. BUILD NOW (code); sending blocked |
| 51 | Email ack + owner email copy | Not verifiable | `email.ts`, gated by EMAIL_ENABLED | Partial | None in code | OT-07/OT-40; D-022/D-046; switch ask-first | P1. Blocked |
| 52 | Products and prices admin | Not verifiable | `Prices.tsx`; RPC `admin_save_product` exists in no migration (spot-checked: only in supabase-store.ts) | Broken | Migration with a products table + the RPC (no default price), build reads it | D-020/D-021, (e) 13 (Claude never sets a price); OT-20 values | P1 M3. BUILD NOW (schema only) |
| 53 | Mark paid / payment records | Not verifiable | `MarkPaid.tsx` writes lead_events; no orders/payments tables | Partial | orders/payments tables per D-021, document numbering | CA meaning of the fields (D-091 proposed); paymentRecords flag | P1 M3. Owner/CA decision |
| 54 | Razorpay checkout, /order products, static UPI QR | Not verifiable | None (UPI QR deliberately held) | Missing | PaymentProvider, webhooks, receipts | Phase 2 (D-020 item 6); UPI QR held (D-035 row 16); ask-first (e) 1, 15 | P2. Owner decision |
| 55 | Sponsor placements + /go click tracking + partner report | Not verifiable | `src/lib/placements/*`, `PlacementSlot` rendered by no page (spot-checked), `/go/[slug]`, partner-report CSV | Partial | Wire PlacementSlot into eligible adult/independent-content pages behind sponsorBanners=false; partner report screen; creative upload | D-016 item 6/D-031/D-089; D-012; D-069; sponsorBanners/sponsorLinkTracking flags; bucket needs owner yes | P1 M3. BUILD NOW (wiring behind flags) |
| 56 | Real data pipeline (Supabase + YouTube backfill) for all archive pages | Not verifiable | `supabase-provider.ts`, sync, migrations; seed by default | UI only | Create projects, backfill, enable sync | OT-03/OT-27, OT-04, OT-16, lawyer OT-28; ask-first (e) 2, 6, 10 | P1. Blocked |

## Can be built now (Phase 1 scope, no owner decision, behind the existing switches)

- **[S] Tournament list: add a 'today/ongoing' state, featured ribbon and pinning from owner-set is_featured/featured_until, video counts on past events (spec 7.6)**. Phase 1 spec item; uses the existing owner list and the 0004/0006 columns; no price, no contact data, no external service
- **[M] Tournament filter chips (district, level, month, category) on /tournaments**. Spec 7.6, Phase 1; client-side over public fields only; D-010/D-018 already respected by the data layer
- **[M] Tournament detail extras: add-to-calendar .ics, map link (venue text only), ShareBar via waShareLink(), 'Get alerts' link**. Spec 7.7; no organizer contact data (D-029); .ics is a static file per prerendered page; tested with fictional data
- **[L] Archive tournament page variant (matches grouped by category, then round) on the fictional seed, then flip TOURNAMENT_PAGES_BUILT**. BUILD_PLAN M2c-3 is Phase 1; pages stay unpublished because archivePages=false and the strict build refuses the seed; D-013 (3+ matches) and D-012 rules enforced in tests
- **[M] Turn a tournament_submission lead into a pending tournament candidate so the admin 'Submitted' tab has a feed (memory store + supabase-store + migration)**. The contract already says M3 does this; the candidate is pending and hidden until the owner approves (D-006/D-007 audited RPC); contacts stay in tournament_private
- **[M] Admin Tournaments: edit fields (dates, venue, categories, covered flag, free featured toggle with featured_until) through an audited RPC**. Owner-only admin (D-006/D-007), no payment involved; paid featured stays Phase 2
- **[M] Filming-permission fields (D-019) as a fail-closed default: migration with status default 'unknown', admin fields, and a guard that hides the 'Covered by Power Smash' badge unless 'granted'**. Ask-first (e) 12 says build the safe default behind a setting and then ask; nothing becomes public or less strict; the owner and lawyer still settle the template wording
- **[S] Fix the QR poster isLocalHost gap (B2-16) and let the admin Posters screen use database tournaments**. Phase 1 M3-4; noindex, unlinked pages; the final QR target simply waits for the domain
- **[M] Player directory filters (district, academy as text, category, active year) on /players**. Spec 7.4, Phase 1; seed data only; only adult_confirmed players are in the list (D-012)
- **[M] Profile improvements: match-grid filters (year, tournament, category), linked tournament names, a 'Request an update' button to the existing /request/ form**. Spec 7.5 Phase 1 items; links only to pages that exist; no Verified badge or claim proof (those wait for D-015/P2)
- **[M] Home hero search box and a 'Recently added' rail, both behind features.archivePages and excluding protected matches**. Spec 7.1 + D-035 row 1 (site data, not views, so no D-016 issue); hidden while the flag is false; must pass check:js-budget
- **[M] Admin edit of district, academy (text) and bio for adult players only, through an audited SECURITY DEFINER RPC**. Owner-only admin; the DB check already keeps these empty for protected players (D-012); no player accounts
- **[M] Identity tools gaps: disambiguator in the admin UI, merge undo record, owner-flow e2e on the memory store**. Phase 1 M2d; fictional data; no auto-merge (spec 10.5)
- **[S] WhatsApp share bar on tournament pages**. Uses waShareLink() only (D-025/D-029); never on protected pages (D-012)
- **[M] /live: admin-editable pin and past-streams list (instead of editing src/content/live.ts), plus a scheduled-streams layout tested with fakes**. Spec 7.13 / M3-5; the player still renders only when youtubeEmbeds is true; owner-from-phone rule in CLAUDE.md
- **[M] Parser auto-accept improvements against the gold fixtures**. Phase 1 M2b; real titles stay in tests/fixtures; fixtures are never weakened; age scan stays fail closed (D-082)
- **[L] Alerts back end with sending switched off: subscribers table, double opt-in tokens, one-tap unsubscribe, suppression list, admin Subscribers screen and confirmed-email CSV export**. Phase 1 M3 (D-026); EMAIL_ENABLED stays off, so nothing reaches anyone; no phone export
- **[M] Morning Telegram digest builder plus the D-006 alerts on role changes, CSV exports and setting changes, with a test that no contact data appears**. Phase 1 M3-1c; no bot exists yet, so nothing is sent; D-045 no-contact rule enforced by test
- **[M] Products migration plus the admin_save_product RPC (no default price) so the Prices screen stops failing closed**. Schema only; Claude sets no price (D-021, (e) 13); values come from the owner (OT-20)
- **[M] Wire PlacementSlot into eligible pages behind features.sponsorBanners=false, and a partner-report screen over the existing CSV code**. Phase 1 M3; hidden while the flag is false; never in the player, never on protected pages (D-016 item 6, D-031, D-012)
- **[M] Admin hardening: rate limit on /api/admin/*, audit viewer screen, axe and e2e checks on the memory-store admin**. Phase 1 M3; owner-only (D-006/D-007); no editors enabled
- **[M] Lead inbox views (lead timeline, calendar list of follow-ups) and the CSV export screen**. Phase 1 M3 (D-091); paise only, no prices set; no drag-and-drop kanban (D-035 row 9)
- **[S] Structured-data validation for player/match/tournament JSON-LD in CI**. M4 engineering check; runs on the build output with fictional data

## Needs the owner's decision

- **Launch the archive (players, matches, tournaments pages, nav links)**: Approve the protected-player modes and the archivePages legal switch, and launch G2 (rule: D-012/D-013 (proposed), features.archivePages, BUILD_PLAN (e) item 6; D-077 strict build refuses the seed)
- **YouTube embeds and thumbnails**: Owner + lawyer approve the embed/cookie wording and switch youtubeEmbeds (rule: D-016 item 7, D-093/D-094, CLAUDE.md ask-first (legal-wording switch))
- **Filming permission wording and scope (beyond the safe default)**: Approve D-019 and the organizer licence template with the lawyer; decide whether coverageAgreementRequired is switched on (rule: D-019 (proposed - owner + lawyer), (e) item 12)
- **Winners / Results page and win-loss records**: Whether to show results at all, and whether the owner will enter winners per match (titles do not carry them) (rule: Never fabricate (CLAUDE.md); not in spec (spec rule 3, new DECISIONS entry); D-012)
- **Game scores parsed from titles (score_text)**: Whether to display them, after YouTube's written reply on derived data (rule: D-016 III.E.4.h, OT-16; D-012)
- **Match schedules / order of play / court assignment**: New scope and a data source (organizer or owner entry) (rule: Not in spec (spec rule 3); D-012; (e) item 15 for new feature areas)
- **Claim-your-profile, Verified badge, player photos, follow a player**: Approve D-015 with the lawyer and decide to start Phase 2 (rule: D-015 (proposed), D-012 (no self-claim lifts a flag), spec 17 Phase 2, (e) item 15)
- **Player registration for the brand's own event, entry lists, news/stories**: Decide to start Phase 3 (rule: Spec 8.8 and 17 Phase 3; (e) item 15; D-012/DPDP for minors)
- **Paid featured listings, online checkout, /order products, static UPI QR**: Start Phase 2, set prices, Razorpay/CA/bank confirmations (rule: D-020/D-021, D-035 row 16, (e) items 1, 13, 15)
- **Mark paid: orders/payments tables and document numbering**: CA confirms the meaning of the fee, GST and TDS fields (rule: D-021, D-091 (proposed), (e) item 12)
- **Default Open Graph image and icons**: Approve downloading an SVG-to-PNG converter (name, size, licence first) (rule: CLAUDE.md ask-first (installing), D-041, (e) item 9)
- **Court booking (Fan4ever-style)**: Whether Power Smash wants to enter court booking at all (a different business) (rule: Not in spec; payments Phase 2 (D-020); (e) items 1, 12, 15)
- **Owner-only admin for Phase 1 (no editors)**: Confirm D-007 (rule: D-007 (proposed))

## Blocked by an outside dependency

- **Real archive data (players, matches, tournaments) and the sync**: Supabase prod/dev projects (OT-03/OT-27), YouTube API key (OT-04), YouTube policy reply (OT-16), lawyer on children's data (OT-28), youtubeApiData switch; production backfill is ask-first (e) 10
- **Automatic live-status check on /live and the Shorts/highlights rail**: YouTube API + youtubeApiData flag, OT-16 (content-type inference, D-016 item 11), Vercel Pro for sub-daily cron (owner purchase)
- **Real owner tournament entries and published tournament pages**: Owner's tournament list (OT-11); organizer permission (OT-17)
- **Lead forms going live (book, tournament submit, request, submit-video, alerts)**: Supabase, production Turnstile keys (OT-41), Vercel project and DEPLOY_ENABLED (OT-02), owner inputs OT-12, OT-19 to OT-22
- **Telegram alerts and digest actually sending**: Telegram bot and chat id (OT-08)
- **Email alerts, acknowledgements, double opt-in mail**: Verified domain (OT-07), Resend (OT-40), EMAIL_ENABLED (ask-first), lawyer wording (emailAlerts flag)
- **Admin with real sign-in (TOTP, aal2) and every admin queue on real data**: Supabase project plus the owner's OT-51 steps
- **WhatsApp Channel button**: Owner creates the Channel and supplies the link (OT-09)
- **Final QR poster target and Search Console**: Real domain (OT-07), Search Console (OT-36)
- **Video submissions**: Lawyer-approved licence/Terms (OT-15), videoSubmissions flag

## Not recommended

- **Live scores, real-time scoring by authorised scorers, court-wise live listings**: No data source exists and the spec has none; it needs third-party scorer accounts, which conflicts with D-006/D-007 (sign-ups disabled, owner-only admin); it would name juniors in real time (D-012); never-fabricate rule. Revisit only as a separate owner-approved project
- **Detailed match statistics, rankings, leaderboards**: Never fabricate (statistics only from the YouTube API or the owner); D-016 bans composite scores, per-player aggregate views and derived metrics (III.E.4.h)
- **Trending plays / trending players (view-based)**: Removed by D-016 item 4 and D-035 row 1; only possible if YouTube's written reply (OT-16) allows it. The 'Recently added' rail is the approved substitute
- **Draws and brackets inferred from video titles**: Inferring a bracket from titles is derived data (D-016) and risks fabricated results; it would also name protected players (D-012)
- **Public sign-up, fan profiles, comments, likes, community feed, find-a-partner, in-app notifications**: D-006 (sign-ups disabled), D-014 (no public user-generated content in Phase 1), D-012 and DPDP (unknown age is protected; contacting minors), D-005/D-029 (no contact data in public); none of it is in the spec
- **Win-loss aggregates shown on player profiles**: Even with owner-entered winners, a per-player record is a derived aggregate close to D-016's 'no per-player aggregate views'; get the owner's and lawyer's view first
