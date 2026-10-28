# Worker ADMIN notes (M2d minimal admin and safety)

Status: built, tests green, no accounts, no real calls, nothing committed. Everything runs against interfaces with in-memory or mocked-fetch implementations.

## What was built

| Area | Files |
|---|---|
| Identity rules (pure) | `src/lib/identity/` : `status.ts` (merge takes the more restrictive status, minor + adult_confirmed blocked without a logged override, split inherits, confirm-adult rules), `alias.ts` (exact-alias tiers confirmed / ambiguous / provisional / text_only, alias move on merge), `duplicates.ts` (edit distance, same name key, weak flag for one-word names, never auto-merges), `operations.ts` (`planMerge`, `planSplit`, `planRename`, `applyMergeUndo`, slug choice, redirects), `redirects.ts` (flattening, loop rejection, 410), `suppression.ts` (tombstones, name/id/video keys) |
| Auth guard (pure) | `src/lib/admin/auth.ts` : `jose` verify against an injected key source, issuer, audience, expiry, ES256/RS256 only, `aal2` for every route, role only from a `profiles` lookup, editors off (D-007), generic 401/403, 503 if the lookup fails; `createJwksKeySource` (injected fetch, cached, one rate-limited refresh on an unknown key id) |
| Policy tables | `src/lib/admin/policy.ts` : action policy and `RLS_MATRIX` (table x role x operation) |
| Handler and endpoints | `handler.ts` (strict zod per action, origin check, 64 KB cap, audit via store), `dispatch.ts` (GitHub `workflow_dispatch`, Actions token `REBUILD_DISPATCH_TOKEN`), `config.ts` (env to deps), route `src/pages/api/admin/[action].ts` (`prerender = false`, `POST /api/admin/<action>`) |
| Stores | `types.ts` (`AdminStore`), `memory-store.ts` (fictional seed, used by tests and preview), `supabase-store.ts` (RPCs from `AdminRpcArgs`, secret key on `apikey` only, never echoes response bodies), `http-store.ts` (browser side), `gotrue.ts` (password + TOTP + enrolment) |
| UI | `src/admin/` (React, mobile-first, lazy chunk) and `src/pages/admin/index.astro` (empty noindex shell, own layout) |
| Tests | `tests/admin/` (122 tests, 7 files) |

Areas: Dashboard (counts, Sync now, Publish now, Emergency hide with the owner checklist, recent activity), Videos to check (raw YouTube title beside "Match details by Power Smash", per-field lock), Players (search, rename, split, bulk confirm adult, possible duplicates with merge and "not the same person", player requests), Tournaments (candidates: approve / hide / reject), Settings (protected modes only). Every destructive step has an inline confirmation; undo is offered for protected-mode changes, merge (preview store only), bulk confirm adult and emergency hide (release).

## Rules enforced (each has a test)

- Admin API: POST only; token, then `aal2`, then role from `profiles`, then policy; editors always 403 at launch; unknown action 404; strict body schemas; foreign Origin refused; no-store and noindex on every response.
- Merge: more restrictive status wins; minor + adult_confirmed is 409 unless an override reason is given, which is written to the audit log as a separate row; a suppressed (taken down) player can never be merged; a merge that makes an adult protected gives the kept player an opaque slug and a 410 for the old named slug (no redirect to a page that no longer exists).
- Split: the new person inherits status, signals and consent, is provisional and hidden, gets an opaque slug when protected, and the parent gets `rejected` alias rows so the next sync does not re-link them (PC-02).
- Rename: a protected player's slug never changes; an adult gets a new named slug (counter on collision) and a 301 from the old one.
- Bulk confirm adult: max 200; never from `minor_confirmed` (needs age proof, D-015), never for withdrawn consent or merged rows; undo can only restore a protected status.
- Protected modes: only the two keys, only `noindex_minimal` or `hidden`, audited with old and new value, undoable.
- Emergency hide: hides, removes the entity's redirects (410), adds id and name suppressions, requests a publish automatically, returns the four owner-only steps; release is audited.
- Admin shell: noindex, canonical only (no public header, footer, analytics, JSON-LD), no link from any public file, no `dangerouslySetInnerHTML`, no browser storage, no secret names in `src/admin`. Admin JS is a dynamic import behind a small loader; the page is 70.5 KiB on view (under the 80 KiB budget), the app chunk is "lazy".

## Deviations and PROPOSED decisions (for the lead; I did not edit DECISIONS.md)

1. **PROPOSED D-A1: the admin API is one Worker route `/api/admin/<action>` on the same origin as the admin page.** D-006 mentions a separate `admin.<domain>` SPA hostname; the same-origin route works on workers.dev now and an `ADMIN_ALLOWED_ORIGINS` list allows the future admin hostname.
2. **PROPOSED D-A2: the admin app is a React island (`client:only`) with hash routing, not a separate Vite SPA.** It reuses the site's tokens and build, and loads as a lazy chunk. Hash routing as in D-006.
3. **Tokens live in memory only.** A reload signs the owner out (no `sessionStorage`). Trade-off: more sign-ins on a phone, no token at rest. Revisit if it is too annoying.
4. **Dispatch config names are new (non-secret):** `ADMIN_GITHUB_REPO` (`owner/name`), `ADMIN_DEPLOY_WORKFLOW` (default `deploy.yml`), `ADMIN_SYNC_WORKFLOW` (no default: no sync workflow exists yet), `ADMIN_DISPATCH_REF` (default `main`), `ADMIN_ALLOWED_ORIGINS`, `ADMIN_EDITORS_ENABLED` (exactly `true`). Please add them to `.env.example` and `docs/SECRETS.md` (the only secret is the existing `REBUILD_DISPATCH_TOKEN`; the Worker also needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as the lead endpoints do). The Worker reads them through `src/lib/admin/config.ts`, not `runtime-env.ts` (I do not own that file).
5. **Duplicate detection on the real database** runs in TypeScript over at most 2,000 live players, blocked by first letter, to keep Worker CPU low. A SQL version (pg_trgm, the GIN index D-032 already adds) would be better; see requests.
6. **JS budget:** the `/admin/` page loads React (about 70 KiB on view). Suggest excluding `admin/index.html` from `check:js-budget` later; the budget exists for visitors.
7. Style classes in `src/admin` are Tailwind utilities from the shared stylesheet, so a few admin-only utility classes may enter the global CSS. Negligible.

## Requests to others

- **SCHEMA** (`src/lib/archive/types.ts` and the migrations, which did not exist yet when I finished):
  - Tables read by the admin: `profiles(id, role)`, `profile_requests(id, player_id, kind, status, received_at, summary)` (summary must hold no phone or email), `player_dup_dismissed(player_a, player_b)`, `matches.manual_override` (used for per-field locks, read-modify-write by the Worker).
  - RPCs the store calls that are NOT in `AdminRpcArgs`: `admin_set_setting(p_actor, p_key, p_value, p_reason)` (must allow only `unknown_match_mode` and `minor_match_mode` for this toggle and audit old and new values), `admin_dismiss_duplicate(p_actor, p_a, p_b, p_reason)`, `admin_decide_tournament(p_actor, p_id, p_decision, p_reason)` with decisions `promote | reject | hide` (promote of a non-Tamil-Nadu event must stay `listed_no_player_pages`, D-018), `admin_resolve_profile_request(p_actor, p_id, p_decision, p_reason)`. Until they exist those methods fail closed with BACKEND_ERROR.
  - `admin_update_match` with `p_changes` containing `publish_state` is used on approve; please confirm it is accepted.
  - A SQL duplicate-suggestion RPC (pg_trgm) would replace the TypeScript scan.
  - The RLS matrix in `src/lib/admin/policy.ts` is my statement of intent: owner reads, writes only through audited RPCs, editors nothing, `audit_log` append-only. Reconcile it with your grants and anon harness; `tests/admin/policy.test.ts` fails if the API views list and the matrix drift.
- **LEAD**: add the env names above to `.env.example` and `docs/SECRETS.md`; create the sync workflow (`ADMIN_SYNC_WORKFLOW`); the real admin sign-in needs the owner user, `profiles` row with role `owner`, and two TOTP factors (D-006); add the RUNBOOK "MFA reset".
- **Whoever builds the claims flow**: `profile_requests` is only listed and resolved here; the claim, removal and junior forms and the click-to-chat proof (D-015) are not part of this worker.

## Not built or limited (be honest)

- **Not run against a live Supabase.** GoTrue paths (`token?grant_type=password|refresh_token`, `factors`, `factors/:id/challenge`, `factors/:id/verify`) are written from the documented API and tested with mocked fetch only. Re-check them when a project exists (spec rule 4).
- **No undo of a merge against the database** (the RPC has no inverse); the preview store has it. After a real merge, a split plus manual checks is the way back.
- **Tournament and participant edits** in the Videos queue are read and lockable but not editable there (the Supabase store answers INVALID); change them in the Tournaments and Players tools.
- Players screen has no pagination beyond the first 50 results; duplicates show up to 40 pairs. Profile requests and the Tournaments list show up to 100.
- No rate limiting on `/api/admin/*` (a Workers rate-limit binding could be added; the guard already needs a valid aal2 token first).
- Visual check was not done in a browser (no server was started). The page builds, the app chunk is emitted and the static guards pass.
- `docs/SPEC_AUDIT.md` review findings on roles/MFA are covered as follows: role never from metadata (tested), `aal2` on every action including reads (tested), no HS256 or `alg none` (tested), generic bodies (tested), editors disabled (tested). Two TOTP factors are only advised on screen, not enforced.

## Fix wave (S2-8, B2-13, C2-7)

### S2-8 TOTP enrolment from a password-only session
- New route `POST /api/admin/session.enrolCheck` is the ONLY action that accepts an aal1 session: a valid token plus an `owner` row in `profiles`, then the Worker asks the GoTrue admin API (service key) how many factors the user has. `allowed` is true only for zero factors; no counter configured, a non-owner, or an editor all answer not allowed. Every other action still needs aal2 (tested).
- `gotrue.enrollTotp` now refuses to call GoTrue unless the Worker said yes AND the session has no factor (verified or not). The sign-in screen asks the Worker first.
- This is a client-side guard: someone holding only the password could call GoTrue directly. The real lock is a Supabase setting, so it is an OWNER STEP (not verified against a live project): create the owner user, enrol BOTH authenticators straight away (phone plus a second device), insert the `profiles` owner row, then turn TOTP enrolment OFF in the Supabase Auth MFA settings (keep verification on). Re-enable it only for the "MFA reset" recovery in the runbook. Also keep the JWT expiry short (Auth settings); sign-out does not revoke an access token before it expires.

### B2-13 split then merge back lost the alias (fixed, reproduced first)
- `moveAliases` ranked rejected above confirmed. Now confirmed > rejected > provisional (an explicit owner merge outranks the rejection a split wrote), and `planMerge` always leaves the dropped display name as a CONFIRMED alias of the survivor.
- `matchAlias` treated `A KUMAR` as a single token. A name now links or becomes provisional with two or more tokens of which at least one is a real word (`isLinkableName`); `GANESH` and `S K` stay text only.
- `tests/admin/roundtrip.test.ts`: the review repro plus 60 seeded random sequences of merge / split / rename: no confirmed alias lost, redirect created, a second identical merge is refused and changes nothing, renaming to the same name twice is idempotent (no extra alias, redirect or slug change), no duplicate alias rows, no redirect chains.

### C2-7 owner phone tasks without a screen
New areas (each a lazy chunk; the bottom bar has Home, Enquiries, Videos, Players, More; More lists Tournaments, Sponsors, Prices, Posters, Settings). All through `AdminStore`, validated by the existing libraries, confirmed in the UI and audited:
- **Tournament submissions**: Tournaments has a "Submitted by organizers" tab (candidate `source`), approval needs a three-point checklist ticked (organizer is real, dates and place, filming permission); promote/reject/hide use `admin_decide_tournament` (0008).
- **Enquiries** (`leads.list`, `leads.update`): status moves from `src/lib/inbox` (lost needs a reason, reopening clears it), notes, follow-up date (`validateFollowUpDate`), value in rupees typed by the owner (integer paise, never defaulted), WhatsApp and email reply links from `quickActions`.
- **Sponsor placements** (`placements.list/create/setStatus`): `validatePlacement` (link must be on the sponsor's own website, unique link name, equal-priority tie refused), always created as a draft; switch on / pause / end (ended is final, no image = cannot switch on).
- **Prices** (`products.list/save`): `validateProductEdit`; no default price anywhere (seed and baseline have none); a visible fixed or starting-from product needs a price; price changes audited with old and new paise and mark the site dirty.
- **QR posters** (`posters.list`): channel plus approved tournaments; link from `buildQrTarget`, QR drawn from `qrMatrix` as SVG shapes (no HTML injection); refuses without a usable `PUBLIC_SITE_URL`, warns on a local address.

Database mapping (what exists in the migrations and what does not):
- Leads, sponsors, placements: `service_role` has select/insert/update (0001, 0007) but there is NO admin RPC. The store writes with the service key and writes the `audit_log` row FIRST (fail closed: no change without its audit row; tested). Audit rows hold field names only, never notes or contact data; a status move also adds a `lead_events` row (`status_changed`, from/to only).
- Prices: there is no products table or RPC. `listProducts` returns the content baseline (no prices); `saveProduct` validates and calls the PROPOSED RPC `admin_save_product(p_actor text, p_slug text, p_record jsonb, p_reason text)`, which fails closed (generic backend error) until a 0009 migration provides it and a table the build reads.
- REQUEST (SCHEMA/lead): 0009 with `product_overrides` (or similar) plus `admin_save_product`, and, ideally, audited RPCs for lead update and placement create/status so the Worker needs no direct table writes.
- Placement images are uploaded in Supabase Storage for now; the form takes the file name. Sponsors are created in Supabase for now (the Sponsors screen only lists them).
- The field lock now calls `admin_set_match_lock` (0008), mapped to the SQL field names.

### Notes
- Admin2 edited files in my area before this wave (policy matrix, field-lock RPC); I re-read them first and kept their changes.
- Budget: `/admin/` is 70.5 KiB on view (unchanged); each area is a separate lazy chunk (largest Players 11.6 KB raw) behind the 88 KB lazy app chunk. `npm run check:js-budget` OK.
- 154 admin tests pass (`tests/admin/`), locked `npm run check` has no errors in my files.

## Mark paid, video submissions, Title check

Built (each screen a lazy chunk; `/admin/` is 70.6 KiB on view, `npm run check:js-budget` OK; Title check is the largest chunk at about 39 KB raw because it carries the parser):
- **Mark paid** (Enquiries, "Record payment", `src/admin/screens/MarkPaid.tsx`). The owner types every figure: payment method (UPI, bank, Razorpay link, cash), UTR or payment id, date, amount received, gateway fee and GST on it (0 allowed), TDS and certificate date, GST registered (not set / yes / no), document type (only a payment receipt until GST is set to yes), optional invoice total. Blank stays "not entered" (`src/lib/admin/money-input.ts`, integer paise, no default amount or rate). The same rules (`validateMarkPaid`) run in the form and in the store; errors are plain English. A review step shows received, fee, TDS, settled and after-TDS amounts (plain subtraction of typed figures) and the status the enquiry will take. Store methods `markPaid` and `listPayments`, actions `payments.mark` and `payments.list`.
  - Status rule (PROPOSED, the owner to confirm): a payment makes the enquiry Won; a payment that settles a typed invoice total makes it Completed; a lost enquiry must be reopened first; the lead status machine decides.
  - Database: there is no payments table in the migrations and no RPC. A payment is stored as an append-only `lead_events` row (`payment_recorded`, meta = the record: paise amounts, method, reference; no name, phone or email). Order: audit row FIRST (fail closed), the event, then the status move. The audit text holds provider, document type and gross, never the UTR. REQUEST (SCHEMA/lead): a `payments` table and an audited RPC (D-020/D-021), after which the store can drop the event storage.
  - Not built: the document itself (receipt or invoice PDF/number), GST registration as a saved setting (the screen asks each time), editing or reversing a recorded payment.
- **Video submissions** (More, "Video submissions", `Submissions.tsx`, `src/lib/admin/submissions.ts`). Status machine new > approved > uploaded | rejected (new may go straight to rejected). Approve; Reject with a reason (3 to 500 characters); "Mark uploaded with YouTube video id" only after approval, id exactly 11 characters (letters, digits, - _; a pasted address gets a specific message). Each card shows the link as plain text (never fetched or embedded; clickable only for a plain https address, with `rel="noopener nofollow noreferrer"`), the stored answers (footage source, organizer, filming permission, under-18 visible with a warning) and the four rights confirmations with the wording version stored and a note when the site now has a newer version; unticked or missing boxes are flagged and warn against approving. Store methods `listSubmissions`, `reviewSubmission`, actions `submissions.list`, `submissions.review`.
  - Database: the review state is `payload.review` of the lead (leads has its own different status column, so `approved/uploaded/rejected` cannot go there); the lead status follows only when its machine allows (approved = contacted, uploaded = completed, rejected = lost with the reason). Audit row first, then the payload and status patch, then a `lead_events` row. Consent rows come from `consent_events`. REQUEST: an audited RPC `admin_review_video_submission` and a status column or table if the owner wants reporting.
- **Title check** (Videos, tab "Title check", `TitleCheck.tsx`, pure `src/lib/admin/title-check.ts`). Uses `parseTitle` read-only. Shows players per side, category, age group, round, tournament, year (and whether it came from the title), place, confidence, a verdict (will auto-accept, or will need review with the reasons in plain English), suggestions for title convention v2 (double pipe, at most one dash and none in the tournament name, category, round, year last, initial plus surname, length over 100, hashtags), and a copy-ready corrected title. Any age signal (including brackets, trailing or hashtag ages, an age in the tournament name, an age-like word the site does not know) shows a plain warning first and can never read as accepted; the tests include the adversarial age corpus idea (14 spellings) and check the warning against the parser's `minorHold`. Nothing is sent anywhere.

Tests: `tests/admin/title-check.test.ts` (27), `mark-paid-submissions.test.ts`, `money-input.test.ts`; e2e `tests/e2e/admin.spec.ts` (10 tests: 9 at 360 and 390 px, 1 at 1280x800 run in the 360 project only: flows, no horizontal scroll, no request outside localhost, axe with zero critical or serious violations, and since 2026-10-28 an open message box never hiding the end of a screen or pushing Close off it). Admin tests: 205 pass. Seed references changed from `PS-2026-DEMO0n` to `PS-2026-DEMK0n` (the reference format excludes the letter O).

### Doc changes needed (not mine to edit)
- `docs/OWNER_GUIDE.md`:
  - "Mark an order as paid (NOT LIVE YET, partly not built)" (line ~112): the screen now exists in Enquiries, "Record payment"; describe the fields, the review step, the Won / Completed rule, that the document itself (receipt or invoice) is still not generated, and that the GST setting is asked each time.
  - "Video someone sends you" (line ~152): there is now Approve, Reject (with a reason) and "Mark uploaded with YouTube video id" in More, Video submissions; replace the manual workaround; mention the four rights boxes and the wording versions shown.
  - Line ~65 and ~208: the Title check screen exists in Videos, tab "Title check" (it is Phase 1, not Phase 2); the "Description helper" is still not built.
  - Weekly list (line ~79): point "approve tournament and video submissions" at More, Tournaments and More, Video submissions.
- M4 docs and `docs/BUILD_PLAN_PHASE1.md` / spec section 14: mark Mark paid, Submissions and Title check as built in the admin, with the storage caveats above (events table for payments, `payload.review` for submissions) and the open requests.
- `docs/DECISIONS.md`: PROPOSED decisions: (1) the Won / Completed rule after a payment; (2) payments stored as `lead_events` until a payments table exists; (3) submission review state in `payload.review`.
