# Power Smash Runbook

For operators (Claude Code or a technical helper). Written 2026-10-22 at the M4 documentation step. Companion to `docs/OWNER_GUIDE.md` (owner) and `docs/SECRETS.md` (secret handling). Decisions are cited as D-nnn; vendor and legal facts as VF-xnn (`docs/VERIFIED_FACTS.md`, most legal figures are third-party summaries: the lawyer confirms them).

**Reality check (read first).** Nothing is deployed or public. The deploy step is a stub, no Supabase project or YouTube key exists, no commit has been made, and the scheduled cron, sync, backup, email and retention jobs are off or not built. Every procedure below is marked **[built]**, **[built, off]**, **[not built]** or **[drill pending]**. A step that has never run against a real service says so; re-check it the first time (spec rule 4). Claude never types, reads or pipes a secret value (D-027): where a step needs one, the owner enters it on the vendor's screen.

## Contents

1. Roles, contacts and where things live
2. Sync failure
3. Payment issue
4. Takedown and emergency hide
5. Breach and CERT-In
6. MFA reset
7. Key rotation, per secret
8. Backup and restore drill
9. KYC and renewal dates
10. The uptime drill
11. Redirects and the 410 gap
12. Cron parked
13. Retention and purge jobs
14. Rollback, deploy, promote and change a setting
15. Feature switches: how to flip each one safely
16. Launch checklists G1, G2, G3
17. Log of drills and incidents

---

## 1. Roles, contacts and where things live

| Thing | Where | Notes |
|---|---|---|
| Owner | Reachable by phone for takedowns (3-hour target, D-014) | Named deputy (OT-31): `TODO(owner)` first name and role, not yet supplied |
| Lawyer | OT-15 | Not yet found |
| CA | OT-05 | Not yet engaged |
| Code and CI | Private GitHub repo (D-038); workflows `ci.yml`, `deploy.yml`, `sync.yml`, `backup.yml`; no `restore.yml` yet **[not built]** | |
| Site | Vercel project (static pages plus Node functions in `bom1`; Pro plan for the live site, owner purchase) (D-097, supersedes D-001) | Production deploy only from `deploy.yml`: strict build on GitHub, then `vercel deploy --prebuilt --prod`; `main` only; Vercel's own Git deploys disconnected (D-008, D-065, `docs/m3/vercel-deploy-notes.md`) |
| Database | Supabase `powersmash-prod` and `powersmash-dev` (D-004) | Neither exists yet (OT-03, OT-27) |
| Alerts | Telegram bot (OT-08); email via Resend when `EMAIL_ENABLED` | |
| Admin | `/admin/`, owner only, password + TOTP at `aal2` (D-006, D-086) | Editors disabled (`ADMIN_EDITORS_ENABLED` unset, D-007) |
| Health | `GET /api/health`, keyword exactly `"lead":"ready"` (D-067) | |

Heavy commands share one lock on the dev PC: `node scripts/with-lock.mjs heavy -- <command>`.

## 2. Sync failure [built, off]

The sync (`sync.yml`, switch `SYNC_ENABLED`) runs every 6 hours (`incremental`), plus `stats_recent` daily at 00 UTC and `stats_all` on Sundays; `workflow_dispatch` offers a mode (`incremental`, `backfill`, `reparse`, ...). Admin "Sync now" dispatches it through `ADMIN_SYNC_WORKFLOW=sync.yml` (D-085). It never ran for real.

Symptoms: Telegram "no good sync for 8 hours" (dead-man, D-008, `src/lib/sync/cron.ts`), a red `sync.yml` run, stale archive.

1. Open the latest `Sync` run in GitHub Actions. Read the error code (alerts hold only status and reason codes, never a response body).
2. **`quotaExceeded`:** the daily allowance (about 3,000 units per Pacific quota day, D-033) is used up. Google's error is never retried. Wait for the Pacific reset; do not raise the cap casually. Check `sync_runs` for which run spent it.
3. **401/403 from YouTube:** the API key is wrong, restricted wrongly or revoked: rotate it (section 7). Never read the key; check the Google Cloud console restrictions with the owner.
4. **Supabase errors:** check the project is not paused (Free projects pause after inactivity, OT-03) and the secret key is valid.
5. **"empty videos.list answer for 10+ ids":** the run fails on purpose instead of retiring videos. Re-run once; if it repeats, do not override, tell the owner.
6. Re-run with `workflow_dispatch` mode `incremental`. A backfill resumes from its checkpoint.
7. After a parser change or an admin alias decision run mode `reparse` (no API call, no quota, idempotent).
8. 30-day rule (D-016, D-081): stored statistics are nulled at 28 days and video rows retired at 29. **A sync outage longer than about 4 weeks starts hiding videos.** If an outage will run past 3 weeks, tell the owner.
9. Record the cause in section 17.

## 3. Payment issue

Phase 1 takes money outside the site: Razorpay Payment Links created in the dashboard (D-020), manual UPI or bank transfer. The owner records a payment in the admin (Enquiries, **Record payment**, D-091); the owner types every figure, the site fills in no amount, fee or rate. There is no payment webhook **[not built]** and `features.paymentRecords` stays false.

**Storage today: payments are events on the lead.** There is no `payments` table and no RPC in the migrations. A recorded payment is an append-only `lead_events` row (`payment_recorded`, meta = integer paise amounts, method, reference; no name, phone or email). Order: audit row first (fail closed, holds provider, document type and gross, never the UTR), then the event, then the status move. To list payments, read the `lead_events` rows of that kind (`payments.list`). A recorded payment cannot be edited or reversed in the admin **[not built]**: a correction means a compensating note by an operator, with the CA's advice. A `payments` table and an audited RPC (D-020, D-021) will replace the event storage; plan a copy of existing events into it then. Status rule (proposed, owner to confirm): a payment makes the lead Won; a payment settling a typed invoice total makes it Completed; a lost lead must be reopened first. The receipt or invoice document itself is not generated and GST registration is asked on each entry, not saved.

- **Customer says they paid, nothing shows:** look in the Razorpay dashboard (payments, then payment links) and the bank. Match the link's reference to the enquiry reference. Do not tell the customer a settlement time (T+2 is a plan, VF-D6).
- **Link expired or wrong amount:** create a new fixed-amount link (VF-D9: one-time, fixed, `expire_by` at least 15 minutes ahead). Never edit an amount in place.
- **Refund:** per the Refund page the lawyer reviewed (OT-21). Razorpay does not return its fee on refunds (VF-D5). Do the refund in the dashboard; record it in the enquiry notes.
- **Wrong person paid / suspected fraud:** do not refund to a different account; ask the CA.
- **Account frozen or KYC query from Razorpay:** the owner replies on the Razorpay screen. PAN, bank-account name and registrant must match (VF-D2).
- **Video submission review state** is stored in `payload.review` of the lead (approved, uploaded, rejected; lead status follows: Contacted, Completed, Lost with the reason), plus a `lead_events` row; an audited RPC `admin_review_video_submission` is requested, not built.
- **Records:** the Mark paid meanings (`gross`, fee, GST on fee, net, TDS) and the document types await the CA (D-021, D-091). An unregistered business issues a plain payment receipt only.
- **Phase 2 webhook issues** (signature, retries, disabled webhook): see D-020 item 6 and VF-D7; not applicable yet.

## 4. Takedown and emergency hide [built, not deployed; drill pending]

Targets (D-014, D-062: targets, not guarantees): acknowledge within **24 hours**; resolve within **7 days**; court order or reasoned government notification within **3 hours**; a parent or guardian asking to hide or remove a child within **48 hours** (hide on receipt, then verify; DPDP's 90-day outer limit is looser, VF-E6). The 3-hour and 7-day figures come from third-party summaries of the February 2026 IT Rules amendment (VF-E9); the lawyer confirms. Whether Power Smash is an intermediary for any feature is a legal question; the targets are operating standards either way.

Intake: `/request/` (kinds claim, correct, hide, remove) and the content removal page create `profile_request` and `content_removal` leads (D-093); `profile_requests` also holds rows resolved in the admin Players screen. `admin_resolve_profile_request` only records the decision; **a resolved removal request hides nothing by itself**: use Emergency hide.

Procedure:
1. Log the time received. Acknowledge within 24 hours (3 hours for a court or government notice).
2. Identify the entity (player, video, tournament). For a possible minor, hide first and verify later. Verification of a parent is a lawyer decision (D-015, VF-E3).
3. **Admin, Home, Emergency hide** (`admin_emergency_hide`, audited). It (a) sets the hidden flag, (b) adds suppressions by id and by normalised name so sync, reparse, merge and backfill cannot recreate it, (c) removes the entity's redirect rows, (d) requests a publish (`urgent`), and (e) returns the owner checklist: publish now, after the new deployment is live, open each affected URL in a private tab to confirm the old page is gone (the site no longer sits behind a Cloudflare cache; how long Vercel keeps cached copies of the previous deployment is unverified, D-097), set the YouTube video private or unlisted, send a Search Console Removals request.
4. Name matching by emergency hide can over-hide plain-text participants but never under-hides (D-081).
5. Confirm the live copy is gone: open the old address (it shows the neutral "no longer available" page, section 11), check `/search-index.json`, the sitemaps and the match list.
6. Record received, hidden and live-copies-gone times in the audit trail and section 17.
7. Reply to the requester in plain words; never promise removal of copies elsewhere.
8. Releasing a suppression is deliberate, audited and never re-shows anything by itself (D-081). Ask the owner first.

Drill [pending, needs a deployed site]: hide a made-up player on the dev project, time hide-to-gone, restore. BUILD_PLAN G2 requires it.

## 5. Breach and CERT-In

What counts: any unauthorised access to, or loss of, personal data (leads, phone numbers, emails, backups, the Supabase secret key, the age private key) or to the site or its keys. Legal duties (all from third-party summaries, lawyer to confirm, D-028, D-037):
- **CERT-In (binding now):** report listed cyber-security incidents within **6 hours of noticing** (VF-E8). Keep ICT logs for a rolling **180 days**, a copy within India, clocks in sync. Name a point of contact. Reporting is by email or form to CERT-In (the owner submits; Claude drafts the text with only facts).
- **SPDI Rules and IT Act s.43A (now):** reasonable security practices; privacy policy and grievance contact (VF-E7).
- **DPDP (from 13 May 2027):** inform each affected person without delay; report to the Data Protection Board within 72 hours (VF-E1, VF-E6). Re-check the date.

First hour:
1. **Revoke first, investigate second.** Roll or delete the exposed key at the vendor (section 7; worst-case order in `docs/SECRETS.md`: Vercel deploy token, Supabase personal access token, Supabase secret key, then backup connection and age key).
2. Revoke admin sessions: change the owner password and, if needed, sign out all sessions in Supabase Auth; keep JWT expiry short (OT-51).
3. Disable intake if leads are at risk: remove the Vercel environment variable `TURNSTILE_SECRET_KEY` (Production scope) and redeploy (the form then reports not ready and visitors are sent to the WhatsApp fallback, D-043; `/api/health` shows `unconfigured`). Do not delete data.
4. **Preserve logs:** export the Vercel team audit log (availability by plan unverified), Cloudflare audit log (Turnstile account), Supabase logs, GitHub audit and Actions history, Telegram bot activity for the exposure window. Do not rewrite git history without the owner's yes.
5. Decide scope: which tables, how many people, which dates. Audit rows hold field names only, never contact data.
6. Within 6 hours of noticing: tell the owner and the lawyer; the owner files the CERT-In report. Note the time of noticing at the top of the incident record.
7. Notify affected people (English and Tamil templates are a gap: **[not built]**, ask the lawyer) and, once DPDP applies, the Board within 72 hours.
8. After: rotate everything that could be affected, write the lessons in section 17, add a test if code was at fault.

## 6. MFA reset [built, not tried on a real project]

Setup rule (OT-51, D-086): the owner enrols **two** authenticators (phone plus a second device) on first sign-in, inserts the `profiles` owner row, then **switches TOTP enrolment OFF** in Supabase Auth MFA settings (verification stays ON). The Worker route `session.enrolCheck` allows enrolment only when the user has zero factors.

Lost one device: sign in with the other, add a replacement factor? Enrolment is off, so do the following reset.

Reset (owner at the Supabase dashboard; Claude never sees passwords or codes):
1. Confirm identity by a means other than the lost device (the owner on a call with the deputy, or the recovery codes kept in the password manager, OT-51 step 6).
2. Supabase, Authentication: temporarily switch TOTP **enrolment ON**.
3. Remove the user's old factors (Supabase user page, factors) so `enrolCheck` sees zero.
4. Sign in to `/admin/`, enrol two new authenticators immediately.
5. Switch enrolment **OFF** again. Check that a second enrolment attempt is refused.
6. Set a new password if the old one may be known; revoke old sessions.
7. Record the reset in section 17 with the reason. This is a security event: if a device was stolen, run section 5.

Not enforced by code: two factors are advised on screen only (admin-notes). Verify the Supabase screens against the real project the first time (not verified).

## 7. Key rotation, per secret

Rule (D-027): all keys at launch, every three months, and immediately after a leak. Pattern: **make the new one, put it everywhere the old one lived, check it works, then delete the old one.** The owner enters each value on the vendor screen or with the loader. Calendar dates are in section 9. Full steps in `docs/SECRETS.md` "Replacing secrets"; per-secret operator notes:

| Secret | Lives in | Rotate | Smoke check afterwards |
|---|---|---|---|
| `VERCEL_TOKEN` (with `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, which are identifiers and do not rotate) | GitHub secret | Vercel account Settings, Tokens: create a new token with an end date about 3 months out; update the GitHub secret; delete the old token in Vercel. | A run of the Preview workflow (no `--prod`); a production test deploy through `deploy.yml` only with the owner's yes |
| `SUPABASE_SECRET_KEY` | Vercel environment variable (Production) + GitHub secret (sync) | New secret key per component; update both; delete old (irreversible) | One form post (`/api/health` says ready), one sync run |
| `SUPABASE_ACCESS_TOKEN` | GitHub secret | New personal token, delete old | Migrate workflow dry run |
| `SUPABASE_DB_URL` | GitHub secret (backup) | New password for the read-only backup role; rebuild the session-pooler string | Manual `backup.yml` run |
| `YOUTUBE_API_KEY` | Vercel (Production) + GitHub | New key, YouTube Data API v3 only, same daily cap | `sync.yml` incremental run |
| `TELEGRAM_BOT_TOKEN` | Vercel (Production) + GitHub | @BotFather new token (old dies at once) | Send a test lead alert on dev |
| `TURNSTILE_SECRET_KEY` (+ site key if new widget) | Vercel (Production); site key is a GitHub build variable | Rotate in Cloudflare Turnstile; a new widget needs a rebuild with the new `PUBLIC_TURNSTILE_SITE_KEY` | A form post on preview; `/api/health` not `turnstile_test_key` |
| `RESEND_API_KEY` | Vercel (Production) + GitHub | Sending-access key only | A test email while `EMAIL_ENABLED` is on in preview |
| `REBUILD_DISPATCH_TOKEN` | Vercel environment variable (Production) | Fine-grained token, one repo, Actions write, about 3 months | Admin "Publish now" |
| `HMAC_KEY` | Vercel environment variable (Production) | Operator task: needs a key id and an overlap, because visitor hashes change (D-044). It also signs the unsubscribe links of the email updates (D-114): a new key makes older unsubscribe links fail, so keep the old key id for unsubscribe checks (or send fresh links) before rotating | Rate limits and click dedupe still work; an old unsubscribe link still works |
| `AGE_DRILL_KEY` / `AGE_DRILL_PUBLIC_KEY` | GitHub | Make a new drill-only pair; low risk (made-up data only) | `restore.yml` once built |
| `age` production private key | Owner, offline | **Not on the schedule.** Replace only after asking; keep the old private key as long as old backups exist | Decrypt the newest backup in the restore drill |
| Razorpay keys | Phase 2 | Not applicable yet | |

If a secret may have leaked: section 5 first, then this table.

## 8. Backup and restore drill

**Production backup** [built, off]: `backup.yml`, weekly, only when `BACKUP_ENABLED=true`. Plain `pg_dump --format=custom --no-owner` piped straight into `age -r <AGE_PUBLIC_KEY>`, no plaintext file, through the session pooler with `postgresql-client-17`, artifact kept 60 days, optional Telegram failure alert (`BACKUP_TELEGRAM_ALERTS`) (D-011, D-072). Needs OT-27, OT-31, OT-43. **Gaps:** no alert when the newest backup is older than 9 days **[not built]**; the off-GitHub copy and its retention are undecided (D-072); Storage objects are not in `pg_dump` and are backed up separately **[not built]**.

**Automated restore drill** `restore.yml` **[not built]**: planned to restore a made-up-data dev dump, encrypted to the drill-only key, into a Postgres 17 container, apply `erasure_log` (itself **[not built]**, D-050) and assert row counts, RLS and grants.

**Manual real-data drill** (D-011, once before G3 and after a major schema change; needs the owner's approval to install anything):
1. Local PostgreSQL 17 portable build is already approved and unpacked at `tools/pg/` (git-ignored) with data in `tools/pgdata/`, port 54329, trust auth, 127.0.0.1 only (`docs/m1/tooling-notes.md`). Commands: `node scripts/pg-local.mjs <init|start|stop|status|reset|apply|check|all>` (`npm run pg:local -- <cmd>`). **Always `stop` when done.**
2. The `age` program must be on the PC: **not installed; needs the owner's yes** (name, size, licence first).
3. Download the newest backup artifact (GitHub Actions) to a folder **outside the project**.
4. The owner saves the private `age` key from the password manager to a temporary file outside the project (Claude never sees it), then runs `age -d -i <keyfile> -o <dump> <file>.age`, then deletes the key file.
5. `pg_restore --no-owner -d <scratch db>` into a throwaway database (not `psdev` or `pstest`). Supabase's own `auth` and `storage` schemas may need manual steps.
6. Verify: row counts against the dashboard, every table has RLS on, `anon` and `authenticated` hold nothing (`supabase/checks/*.sql` via `node scripts/pg-local.mjs check` on a database built from the migrations), the latest `leads` row is present.
7. Re-apply `erasure_log` (when it exists) so erased people do not come back.
8. Delete the decrypted dump and the scratch database. Log date, backup date, row counts and result in section 17.

Local checks that exist today: `node scripts/pg-local.mjs apply` then `check` ran all nine check files green on 2026-10-22 (`docs/m2/admin2-notes.md`); not yet on Supabase or PostgREST (REST anon harness `scripts/anon-harness.mjs` waits for OT-03).

## 9. KYC and renewal dates

| Item | Date or cycle | Action | Source |
|---|---|---|---|
| `.IN` domain KYC | Within the registrar's window at purchase; unverified domains go to ServerHold and take down site and email | Finish e-KYC in the same sitting, wait for "verified" before moving nameservers; record registry contact and the **renewal date** here when bought (not bought yet; list renewal about Rs 625 plus GST at one registrar, 2026-10-20) | D-023, OT-07, VF-F7 to VF-F10 |
| Domain renewal | `TODO(owner)` after purchase | Calendar reminder 60 and 14 days before; registrar lock and two-step on | OT-07 |
| **Gmail "Send as" ends** | **January 2027** | Reply as `hello@` through Resend or Brevo from the admin, not Gmail Send-as; decide before launch (OT-33) | VF-F4, D-022 |
| **Consumer Protection (E-Commerce) (Amendment) Rules 2026** | **1 January 2027** | Complaint copies, dark-pattern self-audit and certificate, 30-day lowest price if discounts are shown, sponsored labels, consent for data uses. Lawyer or CA scope (OT-34) | VF-E11, VF-E14, D-037 |
| **DPDP Rules main duties** | **13 May 2027** (two sites say 14 May; use the earlier) | Verifiable parental consent for children's data, breach notice to the Board within 72 hours, grievance within 90 days; re-check the Gazette and whether the 18-to-12-month proposal was notified | VF-E1, VF-E2, VF-E6 |
| DPDP consent managers | 13 November 2026 | Not relevant to Power Smash today | VF-E1 |
| CERT-In | Binding now | 6-hour reports, 180-day log retention | VF-E8 |
| Vercel deploy token and GitHub rebuild token | Created with an end date about 3 months out | Rotate before expiry (section 7) | OT-02, OT-42 |
| All other keys | Every 3 months | Section 7 | D-027 |
| Uptime monitor login | If the tool requires periodic login (HetrixTools: every 90 days; set a 60-day reminder) | Log in | D-039, OT-44 |
| Razorpay 0% fee window | 90 days or Rs 5,00,000 from activation (activations on or after 1 July 2026) | Activate close to when you start taking money | VF-D4, D-020 |
| `.npmrc` age rule and dependency re-check | Each milestone | Re-check versions and terms (spec rules 3, 4) | CLAUDE.md |
| Stored YouTube API data | Refresh or delete before day 30 (code: 28 and 29 days) | Keep the sync healthy (section 2) | D-016, D-081 |

## 10. The uptime drill [not done; monitor not chosen]

The full procedure is `docs/UPTIME_RUNBOOK_DRAFT.md` (sections 4 and 5) and the options are in `docs/UPTIME_MONITOR_OPTIONS.md` (recommended HetrixTools, owner decides, D-039, D-067). Summary:

1. Two monitors: the home page (HTTP 200 plus one word that is always on the page) and `GET /api/health` (HTTP 200 and the exact text `"lead":"ready"` with quotes; never the bare word `ready`, because `"ready":false` contains it).
2. Alerts to Telegram through the tool's own bot (**never** give it your Power Smash bot token) and to the business email.
3. Drill, before G1, never breaking the live site: Method A, a third monitor on a nonexistent address; or Method B, temporarily change the health keyword to a word that is absent. Record, for Telegram and email, whether it arrived and when, then the recovery messages. Pass only if both arrived and the drill setting is removed.
4. Repeat after any change to the monitors, contacts, tool, domain cut-over or health response.
5. When a real alert comes: `docs/UPTIME_RUNBOOK_DRAFT.md` section 6. `"lead":"unconfigured"` means a deployment lost the form secrets; visitors see the WhatsApp fallback meanwhile.

Record the result in section 17.

## 11. Redirects and the 410 gap

- `scripts/write-archive-redirects.mjs` writes `tmp/archive-redirects.json` from the archive provider; `scripts/finalize-headers.ts` turns each row into a redirect route in `.vercel/output/config.json` (Build Output API) (`docs/m3/port-B-notes.md`). Merges and renames produce 301 rows; removed or protected-old addresses are **301 to the neutral noindex page `/matches/gone/`**, not 410, because Vercel redirect rules only allow 301, 302, 303, 307 and 308 (VF-V5; D-080, D-097, amending D-014 step 4). The page names nobody.
- Limits: the step fails above 1,800 redirect rules. Vercel counts headers, redirects and rewrites together against 2,048 routes per deployment (VF-V5); the header rules use about 10.
- **Gap:** search engines see a 301 then a noindex page, which may drop the address slower than a 410. A real 410 would be a small on-demand route (reached by a rewrite) that reads `slug_redirects` with the service key: **proposed, not built** (D-080, OT-50). Until then, after an emergency hide also file the Search Console Removals request.
- Check after a hide: the old address redirects to `/matches/gone/`; the list, search index and sitemaps no longer contain the name.
- **Trailing slash (to verify on the first preview):** no `trailingSlash` setting is used (it would also redirect POSTs to `/api/*`). Open `/book` (no slash) and `/api/lead` with and without a slash on the first preview and record what Vercel does (VF-V5: default unstated).

## 12. Cron parked [built, not active]

The Cloudflare `scheduled()` Worker entry is deleted (D-097). The 6-hourly YouTube sync is the GitHub Actions schedule in `sync.yml` (runs only when `SYNC_ENABLED` is `true`; works on any Vercel plan). The parked replacement for the 5-minute dirty-flag, RSS and dead-man check is `scripts/sync-worker/vercel-cron.ts`: an HTTP GET route that answers 401 unless `Authorization: Bearer <CRON_SECRET>` matches, then calls the pure handler in `src/lib/sync/cron.ts` (D-085). It sits outside `src` and `vercel.json` has no `crons`, because `tests/legal/reality.test.ts` fails if any non-parked file imports `lib/sync` while `features.youtubeApiData` is false (D-094).

To activate (owner approval, then operator): the Vercel **Pro** plan must be active (Hobby allows one cron run a day at most and refuses faster schedules at deploy, VF-V4); copy the file into the `api/cron` folder of the site's pages, named `sync.ts` (the folder does not exist yet); add `crons` with `*/5 * * * *` to the Vercel configuration; set `CRON_SECRET` and `CRON_ENABLED=true` (plus `ADMIN_GITHUB_REPO`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REBUILD_DISPATCH_TOKEN`) in Vercel, Production scope; flip `features.youtubeApiData`; deploy through `deploy.yml`; then watch the first runs in the Vercel project's Logs for duration and errors. A cron call is best effort, is not retried and can run twice (VF-V4): the handler must stay idempotent. Fallback: the 6-hourly `sync.yml` plus manual Sync now. Until the cron is wired, GitHub emails the owner when a scheduled run fails, and pauses schedules after 60 days without repository activity. The placements nightly jobs (`rollup_placement_clicks`, purge of `placement_impression_seen` older than 2 days) are **not** in this cron yet.

## 13. Retention and purge jobs

| Job | State | Rule |
|---|---|---|
| YouTube 30-day purge | **[built]** as sync step and `admin_purge_stale_api_data` (migration 0009), runs after every sync | D-081 |
| Closed leads anonymised after 24 months; event documents 30 days after the event | **[not built]** (M4 deliverable: scheduled workflow with a dry-run report and dated-fixture test) | Spec 15.4, D-028 |
| `events` and `outbound_clicks` 90 days, `rate_limit_hits`, `daily_salts`, `placement_impression_seen` | **[not built]** | D-028, D-044, R-31 |
| `payment_events` redaction after 90 days | Not applicable (`paymentRecords` off) | D-028 |
| `erasure_log` re-applied after a restore | **[not built]** | D-050 |

R-31: the retention job must run before the first record reaches its stated age (about 90 days after G1 for `events`). Set the Supabase storage alert at 70 percent of the 500 MB Free database.

## 14. Rollback, deploy, promote and change a setting (Vercel)

**Normal deploy.** Only `deploy.yml` publishes production (D-008, D-097): push to `main` or **Run workflow** on the Deploy job. It runs the strict build, checks `.vercel/output/config.json` exists, then uploads with `vercel deploy --prebuilt --prod`. If any gate fails, nothing is uploaded and the previous deployment stays live. Vercel's own Git integration must stay disconnected (or Ignored Build Step `exit 0`) so nothing else reaches production. The owner approves every production deploy (CLAUDE.md ask-first). Gates before a new build is uploaded: strict placeholder and privacy gates, release check, JS budget; the file budget (warn 10,000 / fail above 14,000, D-009) stays as a soft guard. The post-deploy "HTTP 200 on 10 key URLs" check is **[not built yet]** (D-008).

**Roll back (fast).** Vercel dashboard, the project, **Deployments**, pick the last good production deployment, then **Instant Rollback** (or **Promote to Production** on an older deployment). *Unverified:* Vercel's rollback and promote options, their plan limits and exact wording were not in the research (`docs/m3/vercel-facts.md`); check Vercel's own page before the first real use and record what you find here. Rolling back changes which build is live; it does not change environment variables or the database. Tell the owner and record it in section 17.

**Roll back (always works).** Revert the bad commit on `main` (a pull request the owner merges) and let `deploy.yml` publish it, or run the Deploy job on a known-good commit of `main`. Slower (a full strict build), but needs nothing from the Vercel dashboard.

**Change an environment variable.** Vercel project, Settings, Environment Variables; pick the right scope (Production or Preview). **A change applies to new deployments only** (VF-V7): after saving, deploy again (run the Deploy job; whether the dashboard's Redeploy reuses the new values for a prebuilt deployment is unverified). Then smoke-check `/api/health` (`"lead":"ready"`). Never put a test key or `TURNSTILE_ALLOW_TEST_KEYS` under Production.

**Open the private preview.** See `docs/PREVIEW.md`.

**Database.** A migration is not rolled back with the site: write migrations forward-only and test on dev first. The rollback drill (M4 deliverable) is **[drill pending]**.

## 15. Feature switches: how to flip each one safely

General rules: a switch is the exact word `true`; anything else is off (`src/lib/runtime-env.ts`, `docs/SECRETS.md`). **Claude does not flip a switch without the owner's clear yes in chat** (CLAUDE.md "Ask first"). Flip on dev or preview first where one exists. After flipping, run the checks and record the date in section 17. To switch off: unset or set to anything but `true`.

### 15a. Legal feature flags in `src/content/legal/status.ts` (`features`)

Flipping one changes what the public legal pages say. Each flip is a code change plus a lawyer re-read against `docs/legal/G1_REREAD_CHECKLIST.md` (D-061, D-062). Only the lead flips; `tests/legal/features.test.ts` and `tests/legal/reality.test.ts` must stay green. Every flag is `false` today except `cloudflareWebAnalytics`, which follows the build.

Common checklist for every flag: (1) the feature really exists and works; (2) the owner said yes in chat; (3) the lawyer read the exact wording that appears (G1 re-read checklist); (4) flip in a small change with CHANGELOG entry; (5) `npm test`, `npm run check` under the lock, then `npm run build:strict`; (6) confirm the new sentences appear on the page and nothing else moved; (7) record the date.

| Flag | Unlocks | Extra checks before flipping |
|---|---|---|
| `youtubeApiData` | YouTube API Services statement, Terms and Privacy links | YouTube key exists; OT-16 answered or risk accepted in writing (D-016); sync works on dev; activates the cron import guard (section 12) |
| `youtubeEmbeds` | Click-to-load player and thumbnails | "This loads YouTube" notice present; no image requests before click; privacy page names the iframe, `i.ytimg.com`, Turnstile |
| `archivePages` | Player, match and tournament pages; protected-player wording | Owner approved D-012 modes and D-078; lawyer saw junior text (OT-28); `PS_ARCHIVE_SOURCE=supabase` build with real data; anon and privacy tests green; "Sample data" banner gone |
| `competitionPages` | Draw, order-of-play, result and local-ranking pages under /competitions/ (D-115, D-116) | Owner approved the naming rule (only owner-confirmed adults named; juniors, unknown age and school or college events shown as "Protected player"); lawyer re-read the privacy wording (G1 checklist); `PS_COMPETITION_SOURCE=supabase` build with real data; anon and privacy tests green; "Sample data" notice gone |
| `organizerAccounts` | Invited organizers and scorers (D-108): a privacy row about their accounts, and "entered by Power Smash or by invited organizers and scorers" on competition and live score wording | Only together with `ORGANIZER_ACCOUNTS_ENABLED=true` (15b) and the owner's "Turn access on" on the admin Accounts screen; owner yes and lawyer re-read; Supabase's invitation email text read by the owner |
| `registrations` | Registration pages `/register/<tournament>/<event>/` (D-111) and their privacy wording | Lawyer re-read the notice in `src/lib/registration/consent.ts`; retention decided and a purge built; `competitionPages` on; `REGISTRATION_ENABLED=true` (15b); a test registration on preview shows no phone in the Telegram alert |
| `liveScores` | Near-live scores on event pages (D-113) | `LIVE_SCORES_ENABLED=true` (15b) and the owner's "Turn live scores on"; a preview shows the endpoint is cached (`x-vercel-cache: HIT`) |
| `internationalLinks` | The /international/ page (D-112) | `PS_INTERNATIONAL_SOURCE=supabase` in the release build; every link opens the official page; lawyer re-read the "Links to other websites" paragraph |
| `emailNotifications` | The email updates sign-up (D-114) | Sending domain verified (OT-40), `EMAIL_ENABLED` and `NOTIFY_SUBSCRIBE_ENABLED` on (15b); lawyer re-read the sign-up notice and privacy paragraph; a real one-click unsubscribe tried from a test inbox; decide the retention period |
| `siteNotices` | The notice banner and the WhatsApp Channel button (D-114) | `PS_NOTICES_SOURCE=supabase` in the release build; a real channel link in `site.whatsappChannelUrl` (OT-09). Previews show real notices only while this flag is on. A notice's start and end times apply at the next site update: press "Publish now" just after a start or end time (D-125). /alerts/ changes to "Stay updated" only with `emailNotifications` |
| `requestVerification` | One-time code for requesters | Code flow built and tested |
| `ageProofChecks` | Age proof viewed and deleted | D-015 approved; deletion proven |
| `emailAlerts` | Alerts sign-up wording, 18+ confirmation | Double opt-in email path works (needs `EMAIL_ENABLED`) |
| `videoSubmissions` | "Send your video" licence wording | Licence draft reviewed (OT-15); a place to read submissions |
| `sponsorBanners` | Banners beside the player | YouTube answer; D-089 match-page banner approved; labelled "Sponsored" |
| `sponsorLinkTracking` | `/go` counted links | Rate-limit rule (OT-46); `/go` brake tested |
| `paymentRecords` | Stored payment records, 90-day redaction | Redaction job built; CA confirms fields (D-021) |
| `eventDocuments` | Event documents deleted after 30 days | P3 only |
| `erasureLog` | Erasure sentence about restored backups | `erasure_log` built and re-applied in the restore drill |
| `offsiteBackupCopy` | Private cloud backup copy named | The copy really exists, retention decided |
| `coverageAgreementRequired` | "No paid coverage without the written agreement" | D-019 approved and in daily use |
| `healthClaimsRule` | Health, injury, supplement claims rule | Owner confirms it as his practice |
| `telegramPhoneLink` | Owner alerts carry a phone link | **Only together with the Vercel environment variable `TELEGRAM_ALERT_PHONE_LINK=true`**, owner yes AND lawyer-updated privacy page (D-045). Test that the default alert holds no phone, link or email |
| `cloudflareWebAnalytics` | Page-view wording | Follows the build token; never set by hand |

Per-page `legalStatus.<page>.reviewedByLawyer` is set true only after the lawyer reviewed that page's final wording (with `reviewedOn`); until then the strict build refuses (D-061).

### 15b. Server settings (Vercel project, Settings, Environment Variables; scope Production unless noted)

| Switch | Safe flip checklist |
|---|---|
| `EMAIL_ENABLED` | Domain verified (OT-07), Resend domain records verified (OT-40), secrets `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_EMAIL` exist; test on preview; check SPF and DKIM; confirm the customer text and owner email carry no contact data beyond policy; redeploy after saving |
| `TELEGRAM_ALERT_PHONE_LINK` | See `telegramPhoneLink` above; flip last, verify one alert on a test lead, tell the owner what Telegram now holds |
| `CRON_ENABLED` | Section 12 complete first (Pro plan, route copied, `CRON_SECRET` set); flip after the deploy; watch the first cron runs in the Vercel Logs |
| `TURNSTILE_ALLOW_TEST_KEYS` | **Preview scope only. Never Production.** Confirm `/api/health` on production is not `"testMode":true` before G1 |
| `SUPABASE_ALLOW_LOCAL_URL` | Local env file only, never deployed |
| `ADMIN_EDITORS_ENABLED` | Off at launch (D-007); only after editors are approved, MFA enforced for them and the RLS matrix re-checked |
| `ORGANIZER_ACCOUNTS_ENABLED` | Organizer and scorer accounts (D-108). Before: Supabase, Authentication, URL configuration lists the admin address (`ADMIN_INVITE_REDIRECT_URL`); TOTP is on in the project (OT-51). Start: admin Accounts, "Turn access on", AND this setting exactly `true`, AND `features.organizerAccounts` (the server checks all three, D-122), then redeploy. **To stop at once: "Turn access off" in the admin** (no redeploy). Ending an account cannot be undone; inviting the same email again needs the Supabase user removed first (a hard delete: ask first) |
| `REGISTRATION_ENABLED` | Registrations (D-111). Order: the owner switches registration on in the admin (More, Registrations), opens each event and sets its fee (or none), then this setting exactly `true`, then `features.registrations` (the endpoint needs both, D-122). Off = the form answers "closed" without reading anything. A fee change shows on the registration page only after "Publish now"; recording less than the fee asks a second time (D-123). Owner texts (how to pay, the UPI id, a reject reason) refuse phone numbers, emails and WhatsApp links; a UPI id made from a phone number is refused |
| `LIVE_SCORES_ENABLED` | Live scores (D-113). Order: `features.liveScores`, this setting exactly `true` (new deployment), then "Turn live scores on" in the admin (Live scoring). **To stop at once: "Turn live scores off" in the admin**; visitors stop seeing scores within the cache time (`s-maxage=30, stale-while-revalidate=15`: about 45 seconds; the same delay applies when you protect or remove a player mid-match, D-124). Before switching on, check on a preview that a second request within 30 seconds shows `x-vercel-cache: HIT` and that a query string is refused (400). Scoring: open the match, choose who serves first, Start, tap the side that won each rally, Undo takes back the last point, End, then confirm the result on the Results screen. With no signal keep tapping (taps wait in memory); do not reload or sign in again while taps are waiting (they are lost): write the score down first. "You no longer have access" means the assignment was revoked or the account ended |
| `NOTIFY_SUBSCRIBE_ENABLED` | Email updates (D-114). Order: email works (`EMAIL_ENABLED`), this setting exactly `true`, `features.emailNotifications` (sign-up and confirm need both, D-122), then "Open the email sign-up" in the admin (Notices and email). Sending is manual: queue an announcement, then "Send queued emails now". "Not sent" means no consent, unsubscribed, or email off. Unsubscribe always works |
| `LEAD_GLOBAL_HOURLY_CAP`, `LEAD_GLOBAL_DAILY_CAP` | Engineering guesses (40 and 100); tune with real traffic; a too-low cap refuses real customers |
| `ADMIN_GITHUB_REPO`, `ADMIN_DEPLOY_WORKFLOW`, `ADMIN_SYNC_WORKFLOW`, `ADMIN_DISPATCH_REF`, `ADMIN_ALLOWED_ORIGINS` | Plain settings; check Publish now and Sync now after any change (`ADMIN_ALLOWED_ORIGINS` must list the real admin hostname) |

### 15c. GitHub repository variables (Settings, Secrets and variables, Actions, Variables tab)

| Switch | Safe flip checklist |
|---|---|
| `SYNC_ENABLED` | OT-03, OT-04 done, migrations 0001 to 0009 applied on dev and checked, YouTube key restricted with a daily cap, OT-16 answered, `features.youtubeApiData` plan agreed; first run is a manual `workflow_dispatch` on dev; read the run summary; then enable |
| `BACKUP_ENABLED` | OT-27, OT-31 (`AGE_PUBLIC_KEY` variable set, private key safe offline), OT-43 (read-only backup role); first run manual; confirm the artifact exists and a restore test is planned (section 8) |
| `BACKUP_TELEGRAM_ALERTS` | After backup works; confirm a failure alert on a deliberately wrong test |
| `DEPLOY_ENABLED` | Do not flip until the Vercel project, the three deploy secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) and Vercel Pro exist (OT-02), Vercel's Git deploys are disconnected, and the first deploy has been tried (the prebuilt CLI path is unproven on a real account); `build:strict` must pass (no gap markers), owner approves the pages on the phone; deploys only from `main`; the first real deploy goes to the `.vercel.app` address, not the real domain |
| `PREVIEW_ENABLED` | Preview job only; needs the three `PREVIEW_PUBLIC_*` variables and Vercel Authentication on (`docs/PREVIEW.md`); never affects production |
| `PUBLIC_*` build variables | Real values only in the deploy workflow; `PUBLIC_ALLOW_INDEXING=true` only at the cut-over (D-056); `PUBLIC_WHATSAPP_NUMBER` real number only in the production build, never in dev or screenshots |

## 16. Launch checklists

Status words as in the build plan: **DONE**, **PARTIAL**, **PENDING-owner**, **PENDING-deploy**. Today none of G1, G2, G3 is reachable (owner and lawyer inputs, no deployed site). Items come from `docs/BUILD_PLAN_PHASE1.md` (G1 under M1, G2 under M2, G3 under M4, DoD table section f).

### G1: money pages go live

Owner inputs
- [ ] Legal name, address, phone, email, grievance contact (OT-19)
- [ ] Service packages, prices or approved "on quote" wording, delivery times, travel policy (OT-20)
- [ ] Cancellation and refund rules with timelines (OT-21)
- [ ] Sponsor packages, real partners, testimonials if shown (OT-22)
- [ ] Logo and tagline approved (OT-23)
- [ ] WhatsApp Business number set as `PUBLIC_WHATSAPP_NUMBER`, Channel link if used (OT-09)
- [ ] Reply-time wording decided or "no promise" (OT-30, D-046)
- [ ] Entity and payment method decided with the CA (OT-05); GST status and invoice type
- [ ] Razorpay account and a Payment Link tested for a small real amount (OT-06)
- [ ] Domain bought, KYC verified (OT-07)

Lawyer and CA
- [ ] All six legal pages reviewed, `legalStatus` flags set (OT-15); G1 re-read checklist done (`docs/legal/G1_REREAD_CHECKLIST.md`)
- [ ] E-commerce rules checklist (OT-34); CA confirms Mark paid meanings (D-021)

Accounts and infrastructure
- [ ] Vercel account and project, Pro plan active (owner purchase), region `bom1`, Deployment Protection set to **All Deployments** while the site is private (the production `.vercel.app` address is public under Standard Protection, VF-V11), no repository connected to Vercel, deploy credentials stored (OT-02, D-097); the first prebuilt deploy has run. **At G1 the owner switches Vercel Authentication to Standard Protection (or off for Production) so the public can open the live site, and the guard step in `.github/workflows/preview.yml` that demands `all` is relaxed in the same change; forgetting this leaves the live site behind a Vercel login**
- [ ] Production Supabase project, migrations applied, REST anon harness green (OT-27, OT-03)
- [ ] Telegram bot (OT-08); production Turnstile widget and keys (OT-41); `TURNSTILE_ALLOW_TEST_KEYS` unset on production and `/api/health` has no `testMode`
- [ ] `age` public key set and first `backup.yml` run green (OT-31, OT-43)
- [ ] Uptime monitor live and the alert drill passed on both channels (OT-44, section 10)
- [ ] Admin sign-in set up, two authenticators, enrolment off (OT-51); extra admin front door decision (OT-49)
- [ ] Domain cut-over, then in order: Email Routing, Resend verification (OT-40), customer acknowledgement and email alerts switched on
- [ ] Function duration and cold-start checked on the first preview (Vercel Logs); retention purge for the growing tables built before G1 (R-31); share image PNG decision (D-041)

Gates
- [ ] `npm run build:strict` passes: no `TODO(owner)` on any public page, no "Sample data" banner, privacy scan, release check, JS budget (D-065, D-066)
- [ ] `check:placeholders` hidden-section list reviewed
- [ ] `npm test`, `npm run check` (0 errors), `PS_REQUIRE_DIST=1 npx vitest run tests/build`
- [ ] Owner approved every page on the phone
- [ ] Keys rotated at launch (section 7)

### G2: public archive go-live

- [ ] YouTube reply (OT-16) or the risk accepted in writing (D-016)
- [ ] Children's-names and unknown-age policy answered by the lawyer (OT-28); protected modes confirmed (D-012, D-076, D-078)
- [ ] Lawyer saw the junior and removal text; takedown policy reviewed
- [ ] YouTube key and `SYNC_ENABLED` working on production; backfill sample approved by the owner (OT-35)
- [ ] Privacy and anon tests green on the live REST API
- [ ] Emergency hide drill (section 4) passed on a deployed site
- [ ] Protected-modes drill: the owner flips both modes, the next build follows, the audit trail shows who
- [ ] Profile-request flow works end to end
- [ ] Backup and restore job passing (`restore.yml` built)
- [ ] `features.youtubeApiData`, `youtubeEmbeds`, `archivePages` flipped through section 15a
- [ ] Public tournament pages built or consciously deferred; 410 route decision (OT-50)
- [ ] If any item is not green, G2 moves to the end of M4

### G3: Phase 1 complete (both halves of the Definition of Done)

Engineering complete (all tests)
- [ ] DoD 1 parser gold set (90 percent of match titles no hard flag, 95 percent auto-accepted fields correct)
- [ ] DoD 3 timed unlisted upload within the target, sync failure alert proved
- [ ] DoD 4 every form works end to end on a phone (`tests/e2e/forms.spec.ts`, mobile viewports)
- [ ] DoD 5 owner flow on a phone under 90 seconds per task, `aal1` rejected
- [ ] DoD 7 sitemaps and structured data validate
- [ ] DoD 8 Lighthouse (Home, a player, a match, a tournament; three runs, median at or above budget) and axe zero critical or serious; first-party JS under 80 KB gzip per page
- [ ] DoD 9 CI privacy scan and anon allowlist tests
- [ ] DoD 10 weekly backup run history, automated restore drill, manual real-data restore drill done once (section 8)
- [ ] Rollback drill (section 14); retention and cleanup job built with a dry-run report (section 13)
- [ ] Full RLS and permission matrix; XSS, CSV, ICS and upload test suites

Launch gate
- [ ] DoD 6 real legal pages, pricing and contact live; no `TODO(owner)` anywhere public
- [ ] DoD 11 README, OWNER_GUIDE, RUNBOOK, DECISIONS, OWNER_TODO, CHANGELOG complete; owner read the guide on the phone
- [ ] Search Console and Bing verified after launch (OT-36)
- [ ] Lawyer and CA review loop closed; final prices and refund rules
- [ ] G5 measurement plan started: ten minutes of admin per upload, measured in the first week of real use
- [ ] Dates in section 9 are on the owner's calendar

## 17. Log of drills and incidents

Add one line per event: date, what, who, result, follow-up.

| Date | Event | Result | Follow-up |
|---|---|---|---|
| 2026-10-21 | G0 Windows 10 smoke test | Passed (`docs/G0_RESULT.md`) | |
| 2026-10-22 | Migrations then in place (0001 to 0008) on local PostgreSQL 17.11, nine check files (`docs/m2/admin2-notes.md`) | All ok; 0009 and Supabase not yet covered | OT-03 |
| (none yet) | Uptime alert drill | Not done | After OT-44 |
| (none yet) | Emergency hide drill | Not done | After deploy |
| (none yet) | Manual restore drill | Not done | Before G3 |
| (none yet) | Rollback drill | Not done | After deploy |
