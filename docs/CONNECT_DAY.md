# Connect day: first real connection to Supabase and YouTube

Operator checklist for CLAUDE. Goal: the first connection is fast, safe and reversible. DEV first, PROD only after DEV is fully green. Owner-facing wording is plain English; the owner works from a phone where possible.

Related: `docs/OWNER_TODO.md` (OT-03 dev project, OT-04 YouTube key, OT-27 prod project), `docs/SECRETS.md`, `docs/RUNBOOK.md`, `supabase/README.md`, `docs/PROFILING.md` (parse report; may not exist yet: if missing, say so and skip the link), `docs/m3/connect-notes.md`.

## Ground rules (read every time)
1. **Never see, paste, type, read or pipe a secret.** Tokens, the database password, `SUPABASE_SECRET_KEY`, the YouTube key and the Turnstile secret are entered by the owner in the vendor screen or by the owner's own loader. If a value appears in chat, say so and start rotation (`docs/SECRETS.md`). Project ref, URL, publishable key and Turnstile site key are not secret.
2. **Nothing runs against PROD before DEV is green** (Part A to F all passed and the owner said yes to Part G).
3. **One PostgreSQL user at a time.** If the local PostgreSQL (`scripts/pg-local.mjs`, port 54329) is running, run `node scripts/pg-local.mjs stop` first; never run two sessions that both apply migrations or backfill. Only one operator touches the dev database at once, and only one backfill runs at once.
4. Heavy commands go through `node scripts/with-lock.mjs heavy -- <command>`.
5. No commit, push or merge without the owner's yes. No real players' names or real WhatsApp number in DEV data except what the backfill brings (real titles stay in the DEV database only, never in files, screenshots or chat).
6. At each **STOP** gate: report in plain English what passed, what failed, what happens next, and wait for a clear yes.

## Part 0: Preflight (offline)
Run: `node scripts/connect-preflight.mjs`. Offline, prints only set/unset and shape verdicts. Expected before connecting: WARN lines for unset names, no FAIL (migrations 0001..latest contiguous, one check file per migration, `archivePages` off, no switch true, `.env` ignored).
Rollback: nothing to undo (read-only).

## Part A: Ask the owner (all at once, then wait)
Ask, in this order:
1. Has the owner created the Supabase project `powersmash-dev`? Region **Mumbai (ap-south-1)**; "Automatically expose new tables and functions" **unchecked**; Data API on. (OT-03.)
2. Send me only the **project reference** (20 letters) and the project URL and the **publishable** key (starts `sb_publishable_`). Never the secret key, never the database password.
3. Is Supabase CLI use approved? It is **not installed**. Adding it as a dev dependency, or running it through `npx` (downloads it), needs the **owner's yes**: ask with name (`supabase`), approximate size and licence first. Without a yes, fall back to pasting each migration into the dashboard SQL editor (owner on PC) in order.
4. Has the owner got the YouTube Data API key (OT-04)? Not to send it.
5. Is the YouTube policy question (OT-16) answered, and has the owner agreed to a backfill into DEV?
**STOP gate 1:** do not proceed without answers 1 to 3.

## Part B: Verify the dev project (owner, phone or PC)
Owner checks in the Supabase dashboard (Project Settings): region Mumbai; Data API settings: automatic exposure of new tables off. Owner confirms in chat ("yes, Mumbai, exposure off"). If exposure is on, the owner switches it off before anything else; migrations add their own GRANTs and RLS.
Rollback: a wrong project is deleted by the owner in the dashboard (nothing of value in it yet).

## Part C: Apply migrations to DEV only
**Route A (used on 2026-10-24, needs no CLI, no download and no database password): `npm run sql:bundle`** writes two plain files to git-ignored `tmp/supabase-dev/`: `01-migrations.sql` (all migrations, run ONCE: one paste is one implicit transaction, so it is all or nothing) and `02-checks.sql` (all checks; the editor shows only the last row, and any failed check stops the run with an error). The owner opens each file in Notepad, copies it all, pastes it into the dashboard SQL editor of the DEV project and presses Run. The bundle script turns the shared `pg_temp.expect_fail` helper into CREATE OR REPLACE (five check files define it; the first real run failed on the plain CREATE, seen on 2026-10-24). Route B below (the CLI) is the alternative and needs the owner's yes first.

Owner sets the variables **names only** in their own shell; Claude never sees values:
- Owner runs, at their PC: `npx supabase login` (browser sign-in; the token stays on the PC), then `npx supabase link --project-ref <DEV ref>` (the CLI asks for the **database password**, which stays with the owner), then asks me to wait.
- **Before pushing, confirm the linked ref is DEV** (`npx supabase projects list` shows the linked one; the owner reads it out). Wrong project here is the single worst mistake.
- Dry run: `npx supabase db push --dry-run` lists which migrations would apply. Expect 0001..latest in order. Run the real push with the owner's yes: `npx supabase db push`.
- Re-run `node scripts/connect-preflight.mjs` for contiguity first.
**STOP gate 2:** the owner confirms the dry-run list and that the ref is dev.
Rollback: DEV is disposable. Reset by the owner in the dashboard (Settings, Database, reset) or drop and recreate the project; re-link and push again. Migrations are forward-only: never edit an applied migration, add a new one. (Nothing in DEV is precious until the backfill; after the backfill, a reset means a repeat backfill, 77 to 110 quota units.)

## Part D: Checks and the anon harness against DEV
1. `supabase/checks/*.sql`: run each in order against DEV (owner pastes each file in the SQL editor, or the CLI with the owner's DB password on the owner's PC, never through me). They must all pass (they raise on failure). Claude reports file names only.
2. Anon harness, with public values only:
   `PUBLIC_SUPABASE_URL=https://<dev ref>.supabase.co PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... node scripts/anon-harness.mjs`
   No secret key is used or printed. Exit 0 = no private table readable or writable by anon. Any leak: stop, do not continue, fix with a new migration.
3. `node scripts/connect-preflight.mjs --online` (one GET to the REST root; YouTube check is skipped if the key is not in this shell).
**STOP gate 3:** all checks and the harness are green. Tell the owner.
Rollback: read-only steps; nothing to undo.

## Part E: Owner user, MFA, sign-ups, profile row
Owner in the DEV dashboard (phone is fine):
1. Authentication, Providers: **disable sign-ups** ("Allow new users to sign up" off).
2. Authentication, Users: **Add user** (the owner's own email, a password only the owner knows). Copy the user's **id** (a UUID; not secret) and send it to me.
3. Enable **MFA (TOTP)**: owner enrols an authenticator app on first admin sign-in (the admin function requires `aal2`).
4. SQL editor, insert the owner profile row (exactly one owner is allowed):
```sql
insert into public.profiles (id, role, display_name)
values ('<OWNER-USER-ID-UUID>', 'owner', 'Owner');
```
5. Protected-mode settings: the migration seeds the decided defaults. Verify (read-only):
```sql
select key, value from public.archive_settings order by key;
-- expect: auto_publish_clean_parses=true, minor_match_mode=hidden, non_tn_tournament_pages=off, unknown_match_mode=noindex_minimal
```
Do not loosen any of them. Changing a value is an admin action and needs the owner's explicit yes (D-012).
Rollback: `delete from public.profiles where id = '<OWNER-USER-ID-UUID>';` and delete the user in Authentication, Users. Sign-ups back on only with the owner's yes.

## Part F: Lead endpoint live test (DEV, Turnstile TEST keys)
Names to set on the DEV deployment (Vercel project environment variables, Preview scope; the owner enters values in the Vercel screen): `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (secret), `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (secret), `HMAC_KEY` (secret), `TURNSTILE_EXPECTED_HOSTNAMES`, `TURNSTILE_ALLOW_TEST_KEYS=true` (dev/preview only), `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (optional). See `docs/SECRETS.md` for the full table and `docs/m1/leads-api.md` for the contract. Leave `EMAIL_ENABLED`, `TELEGRAM_ALERT_PHONE_LINK`, `SYNC_ENABLED`, `CRON_ENABLED`, `DEPLOY_ENABLED`, `BACKUP_ENABLED` unset.
Turnstile test keys are Cloudflare's published ones (site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`); they must never reach production.
Test: open `/api/health` on the dev URL: expect `"lead":"ready"` (exact text) and `ready:true`. Submit one enquiry with fictional data (name "Test Person", phone `910000000000`) from the dev site's contact form. Expect success; the owner sees the Telegram alert (no phone inside) and the row in Supabase Studio (Table editor, `leads`).
Rollback: delete the test rows in Studio (`leads`, `lead_events`, `consent_events` rows for the test; owner confirms) and unset the env names.
**STOP gate 4:** owner confirms the enquiry arrived. 

## Part G: YouTube key, dry run, DEV backfill
1. **Restrict the key** (owner, Google Cloud Console, Credentials, the key): API restrictions, "Restrict key", choose **YouTube Data API v3** only. Application restriction: none is possible for a server-side key from changing IPs; accept that. Quota: default 10,000 units/day.
2. Owner puts the key into the secret store (`YOUTUBE_API_KEY`) and `YOUTUBE_CHANNEL_ID` (public). Run `node scripts/connect-preflight.mjs --online`: expect "key accepted (1 quota unit)".
3. **DRY RUN (read-only, writes nothing, expect about 77 to 110 quota units).** `npx esbuild scripts/sync-run.ts --bundle --platform=node --format=esm --outfile=tmp/sync-run.mjs` then `node tmp/sync-run.mjs backfill --dry-run`, with only `YOUTUBE_API_KEY` and `YOUTUBE_CHANNEL_ID` set in that shell (no Supabase values needed). It reads the channel with the real YouTube client and runs the real parser and identity step into in-memory stores (`src/lib/sync/dry-run.ts`): no database, no Telegram, no file is written. It prints counts only, as JSON: videos by type and by parse status, review reasons and hard flags, the share of `match` videos accepted without review (`matchParseRatePercent`, the DoD 1 number), players (and how many are protected), tournaments, matches, and the quota used. It prints no title, name, video id or URL. Exit code 0 only when `"status"` is `"ok"`. Only `backfill` accepts `--dry-run`; do not substitute a real backfill. Re-run it on the same day and the quota ledger adds up per run, so check the units against the 3,000 fail-closed line (D-033).
4. **Backfill into DEV** (owner or lead runs; never with real values by Claude, D-027):
   `npx esbuild scripts/sync-run.ts --bundle --platform=node --format=esm --outfile=tmp/sync-run.mjs` then `node tmp/sync-run.mjs backfill` with `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `SUPABASE_URL` (DEV), `SUPABASE_SECRET_KEY` (DEV) set in that shell only. The run prints a summary, no secrets. It is resumable from a checkpoint; re-run the same command if it stops. One run at a time.
5. **Parse report**: read the run summary and the admin Title check; the profiling method is in `docs/PROFILING.md` (if present). Report counts only: videos, parsed clean, needs review, unknown. No real titles or names in chat, files or docs outside `tests/fixtures/`.
6. **Review unknown-age counts** with the owner: how many players are `unknown` (protected by D-012: no page, noindex, absent from search). Never lift a flag from a self-claim. Query (counts only):
```sql
select age_status, count(*) from public.players group by 1 order by 1;
```
**STOP gate 5:** the owner reviews the counts and says whether to continue to PROD.
Rollback: DEV data is disposable. To undo a backfill: reset the DEV database (Part C rollback) and re-apply; or, narrower, the purge mode (`node tmp/sync-run.mjs purge`) after checking its scope in `src/lib/sync/purge.ts`. Remember stored YouTube data must be refreshed or deleted before day 30 (D-016).

## Part H: Production (only after gates 1 to 5 and an explicit owner yes)
1. Owner creates `powersmash-prod` (OT-27), same settings as Part B, different password. Send me the ref and publishable key only.
2. `npx supabase link --project-ref <PROD ref>` (owner), **confirm the ref is PROD**, `npx supabase db push --dry-run`, owner reviews, then `npx supabase db push`. Same migration list as DEV; no extra migration only in PROD.
3. Repeat Part D (checks, anon harness with the PROD public values, preflight `--online`) and Part E (user, MFA, sign-ups off, profile row, settings verified).
4. **Do not** set Turnstile test keys or `TURNSTILE_ALLOW_TEST_KEYS` in PROD. Real Turnstile keys are the owner's own (OT list).
5. Backfill into PROD (same steps as G.4, with PROD values in the shell). Data stays **hidden by default**: `archivePages` in `src/content/legal/status.ts` stays **false**, protected-mode settings unchanged. Turning it on is a separate owner decision, with the lawyer's text (G1).
6. Run preflight offline once more: `archivePages` must still be off.
Rollback: before any real visitor data exists, PROD can be reset in the dashboard and re-applied. Once real leads exist, do **not** reset: restore from the weekly encrypted backup (`docs/RUNBOOK.md`) and ask the owner first. A backfill alone can be purged (G rollback). Rotate keys if any value was exposed.

## Never
- Paste, request, read or echo a secret, the database password, `.env`, `.dev.vars` or `.secrets.local`.
- Run anything against PROD before DEV is green and the owner says yes.
- Run `db push` without a `--dry-run` first and the owner's confirmation of the linked ref.
- Use Turnstile test keys, `SUPABASE_ALLOW_LOCAL_URL`, or the local PostgreSQL in PROD.
- Switch on `archivePages`, `SYNC_ENABLED`, `CRON_ENABLED`, `EMAIL_ENABLED`, `DEPLOY_ENABLED`, `BACKUP_ENABLED` or `TELEGRAM_ALERT_PHONE_LINK` on connect day without a separate owner yes.
- Edit an already-applied migration. Add a new one.
- Install the Supabase CLI or any package without the owner's yes.
- Put real titles or player names in files, screenshots, issues or chat.
