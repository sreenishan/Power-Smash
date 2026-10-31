# Platform build checklist (the owner's 24-module brief, started 2026-10-30)

Progress of the "complete badminton platform" brief, wave by wave. Each wave is built by parallel agents in separate folders, reviewed,
tested and opened as a pull request for the owner to merge. **Nothing here is published until the owner switches it on.**

## Owner decisions (2026-10-30)

D-108 organizer and scorer accounts by invitation; D-109 juniors and unknown-age players never named; D-110 results, statistics and a local ranking from entered results only; D-111 free registration with manual payment verification; D-112 international events listed with links only; D-113 near-live scores about every minute; D-114 email, WhatsApp Channel and in-site notices. Each is built in a wave and switched on only after review.

## Safe defaults (until each wave is reviewed and switched on)

| Area | Default built | Who can change it |
|---|---|---|
| Organizer, scorer and player accounts | Roles exist in the data model, **switched off**; sign-ups stay disabled; only the owner signs in (D-006, D-007) | Owner |
| Junior and unknown-age players | Never named publicly in draws, scores, entries or rankings; shown as "Protected player" (D-012, fail closed) | Owner + lawyer |
| Tournament registration | Built, **switched off** | Owner |
| Payments | Manual verification only; no gateway without credentials | Owner + CA (Razorpay keys, OT-06) |
| Rankings | Local Power Smash table only, labelled "not an official BWF ranking", unpublished until the owner approves the points (table decided 2026-10-31, D-129; approved on the live project when the owner saves it in the admin) | Owner |
| International (BWF) data | Adapter awaiting a licensed source; **no scraping**, no invented data | Owner (licence) |
| Live scores | Shown only when an authorised scorer is sending updates | Owner |

## Waves

| Wave | Content | Status |
|---|---|---|
| Audit | Status of all 24 modules, owner decisions, phased plan | done (7 decisions answered: D-108 to D-114) |
| A. Engines | Scoring rules and live rally state, draws (knockout with seeding and byes, round robin, groups), bracket progression, scheduling and conflict report, statistics and local ranking calculator (`src/lib/competition/`) | built and reviewed (pull request: engines + foundations) |
| 2. Foundations | Competition database schema 0017 (events, entries, draws, matches, games, score log, rankings, organizer assignments, notification outbox, data providers), international data adapter, notification outbox, competition UI components | built and reviewed; checks 0001 to 0017 pass locally; the dev Supabase project needs the 0017 bundle pasted |
| 3. Wiring | Admin screens and server actions for events, entries, draws, scheduling, scoring and results; public tournament pages showing draws, schedules and results | built and reviewed (migration 0018; D-115 routes, D-116 naming rule); pull request after wave 2 |
| 4. Accounts | Organizer and scorer access limited to their own tournaments, by invitation (D-108) | built, integrated and review-fixed, switched off (migration 0019, admin Accounts; D-117, D-122) |
| 5. Registration | Free registration on the site, manual payment verification (D-111); near-live scores endpoint (D-113); international link-out listings (D-112); email updates and notices (D-114) | built, integrated and review-fixed (D-122 to D-125), switched off (migrations 0020 to 0023; /register/, /api/live-scores/, /international/, the notice banner; D-118 to D-121) |
| Follow-ups | Organizer player search and new players (migration 0024, D-126), screens per role and `?preview-as=` in the preview; keep-for periods and the clean-up of registrations and email sign-ups (migration 0025, D-127); vendor facts re-read (`docs/m5/vendor-facts-2026-10-31.md`); leftover review findings of waves A to 5 (D-128) | built and integrated, switched off |
| 6. Integrations | International data (licensed source), payment gateway, email and WhatsApp delivery | after credentials |

## Owner and lawyer steps still open from the follow-ups

- [ ] Keep-for periods for registrations and email sign-ups decided by the lawyer and entered by the owner in the admin (Settings, "How long to keep registrations and email sign-ups"). Both are empty until then, so nothing is removed. The lawyer said whether a code (hash) of a deleted unsubscribed address may be kept; the box "Remember removed unsubscribed addresses as a code" stays unticked until they say yes. One dry run of the Retention workflow was read. `RETENTION_ENABLED` is on before the first registration or sign-up reaches its period.
- [ ] The owner confirmed the organizer search rule (D-126): a few letters find only players the website already names or players already in that tournament; anyone else (unknown age, juniors, the video archive) only by the full name typed exactly; 25 a page, 120 searches in 10 minutes, each search recorded without what was typed.
- [ ] Enter the approved points table (D-129) in the admin, Competitions -> Rankings ("Rankings and points table", then "Enter the points table"), on the LIVE project: "Power Smash local ranking 2026", 364 days, best 6, the numbers in D-129. The admin form has a separate "group" box and "league" box for every level: type the D-129 group / league number into BOTH (a box left empty scores 0 for those events). Leave the school_college row empty. Saving it is the formal approval and is audited; until then no ranking can be worked out. The dev project has the same table for the preview only (`supabase/demo/points-table-2026-dev.sql`). Once it is there, the demo seed (`competition-demo.sql`) refuses to run again, and the demo removal keeps the table, so reseeding the demo would need a change to the seed first.
- [ ] The organizer and scorer browser test (`tests/e2e/admin-organizer.spec.ts`) has run after a build.

## Test results

Recorded per wave in the pull request and in `CHANGELOG.md`.
