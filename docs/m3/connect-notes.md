# Connect-day kit notes

Files: `docs/CONNECT_DAY.md` (operator checklist), `scripts/connect-preflight.mjs` (read-only preflight), `tests/connect/preflight.test.ts` (12 tests, mocked fetch, synthetic env).

Preflight: offline by default (env names set/unset plus shape, migrations 0001..latest contiguous, one `supabase/checks/NNNN_assertions.sql` per migration, `archivePages` off in `src/content/legal/status.ts`, no env switch true, `.env` in `.gitignore`). `--online` adds two GETs only: `<url>/rest/v1/` and YouTube `channels?part=id` (1 quota unit); each skipped when its env is unset; the key is never printed. Exit 1 on any FAIL.

**Status 2026-10-24 (real run):** the owner created the Supabase DEV project `powersmash-dev` (reference `blmahgsbjwpyruxkcnxn`, **South Asia (Mumbai) ap-south-1**; a first attempt landed in Tokyo by mistake, was empty and was deleted and recreated, because a project's region cannot be changed). All 10 migrations were applied through the SQL editor (route A) and all 10 checks passed (`ok: 0010_retention assertions passed`), which also proves the default-privilege rules. Still open: the anon harness (needs the publishable key), the owner user, sign-ups off, MFA and the profile row (Part E), the Preview-scope settings (Part F) and the YouTube key and dry run (Part G).

Open items for the lead:
- ~~`scripts/sync-run.ts` has no `--dry-run`~~ Built by the lead on 2026-10-22: `node tmp/sync-run.mjs backfill --dry-run` (`src/lib/sync/dry-run.ts`, `tests/sync/dry-run.test.ts`); CONNECT_DAY Part G.3 updated. Never run against the real YouTube API yet.
- ~~`docs/PROFILING.md` does not exist yet~~ It exists now.
- The Supabase CLI is not installed; CONNECT_DAY gates its use on the owner's yes, with a dashboard SQL-editor fallback.
- Wording says "Vercel project env, or Worker env" because the Vercel port is in progress; adjust when the port lands.
