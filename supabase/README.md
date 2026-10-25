# supabase/ - migrations and checks

Written in M1 by the Lead-backend worker; the archive, safety, API, placements and admin migrations (0004-0008) arrived in M2/M3. **Nothing here has been applied to a hosted project yet.** Since M1 the whole sequence has been applied and checked on a LOCAL throwaway PostgreSQL 17 (`docs/m1/tooling-notes.md`, `docs/m2/admin2-notes.md`): that proves the SQL, the privileges and the triggers, but not PostgREST, GoTrue or the Supabase extras, so the first real run against the dev project (OT-03) is still the real test (finding C-6). Never apply a migration to production before it has run on dev. Fictional data only, always.

## Files, in apply order (each migration is followed by its check)

| Order | Migration | Check | What it is |
|---|---|---|---|
| 1 | `migrations/0001_lead_funnel.sql` | `checks/0001_assertions.sql` | The private lead funnel: `leads`, `lead_events`, `events`, `outbound_clicks`, `rate_limit_hits`, `daily_salts`. RLS on, no anon/authenticated policies, default grants revoked (also from `service_role`), explicit grants to `service_role` only (D-005). Its checks 8 and 9 cover EVERY table in `public`. |
| 2 | `migrations/0002_consent_records.sql` | `checks/0002_assertions.sql` | Consent evidence (D-028): `notice_versions` and the append-only `consent_events`. |
| 3 | `migrations/0003_lead_kinds_m3.sql` | `checks/0003_assertions.sql` | Additive: `video_submission` and `alerts_signup` lead kinds (re-creates `leads_type_check`). Was `supabase/proposed/0003_...`; see "The old proposed 0003" below. |
| 4 | `migrations/0004_archive_core.sql` | `checks/0004_assertions.sql` | Archive tables: videos, title history, tournaments, `tournament_private`, aliases, players, matches, participants, `slug_redirects`, `sync_runs`. |
| 5 | `migrations/0005_archive_safety.sql` | `checks/0005_assertions.sql` | `archive_settings`, `site_state` (dirty flag), append-only `audit_log`, `suppression` tombstones, and the guard triggers (protected players, locks, suppression). |
| 6 | `migrations/0006_archive_api.sql` | `checks/0006_assertions.sql` | The seven `api.public_*` views (the only public read surface) and the admin RPCs (merge, split, rename, age status, emergency hide, release, update video/match/player, mark dirty). |
| 7 | `migrations/0007_placements.sql` | `checks/0007_assertions.sql` | Sponsors, placements, daily counters and their functions. |
| 8 | `migrations/0008_admin_rpcs.sql` | `checks/0008_assertions.sql` | `profiles` (role source), `profile_requests`, `player_dup_dismissed`; `app.require_owner`; RPCs `admin_set_setting`, `admin_dismiss_duplicate`, `admin_decide_tournament`, `admin_resolve_profile_request`, `admin_set_match_lock`. Check 0008 also asserts, for every table, that `service_role` never truncates and deletes only from a short list, and that the audit log cannot be changed. |

Other files: `local/roles.sql` (local PostgreSQL only: the roles a hosted project already has; never run it on Supabase), `../scripts/anon-harness.mjs` (API-level check with the **publishable** key: every table and view must deny select, insert, update and delete; `MANIFEST` lists them all, `expectSelect: true` for the `api` views), `../scripts/pg-local.mjs` (the local server).

Each check raises an exception that names the broken rule, or returns an `ok: <number>_<name> assertions passed` row. The static tests in `tests/supabase/` and `tests/admin/rls-matrix-schema.test.ts` read the SQL text; the local tests need the server up.

The migration file names follow the brief (`0001_...`). The Supabase CLI accepts any numeric prefix. If the lead prefers timestamps, rename the files before the first push; never rename after it has been applied.

### The old proposed 0003

`supabase/proposed/0003_lead_kinds_m3.sql` was kept out of `migrations/` only because the migration order test refuses a gap. Nothing had been applied anywhere, so it now simply takes the free number 0003 (`migrations/0003_lead_kinds_m3.sql`, with `checks/0003_assertions.sql`): the sequence 0001 to 0008 has no gap, `supabase/proposed/` is gone, and `tests/supabase/local-pg.test.mjs` asserts the two kinds are accepted. If the owner already applied 0001, 0002 and 0004 or later to a project before this change, apply 0003 by hand there (it only re-creates one constraint, so the order does not matter).

## Run it locally (no Docker, no account)

The portable PostgreSQL is in `tools/pg/` (git-ignored). One session at a time may start it.

```
node scripts/pg-local.mjs start      # starts the server on 127.0.0.1:54329 (trust auth, fictional data only)
node scripts/pg-local.mjs reset      # drops and re-creates the database psdev
node scripts/pg-local.mjs apply      # roles.sql, then every migration in order (stops at the first error)
node scripts/pg-local.mjs check      # every checks/*.sql; each must print its ok row
npx vitest run tests/supabase tests/admin   # includes the local-pg tests while the server is up (they skip otherwise)
node scripts/pg-local.mjs stop       # ALWAYS stop it when done
```

To run one check by hand: `tools/pg/pgsql/bin/psql.exe -h 127.0.0.1 -p 54329 -U postgres -d psdev -v ON_ERROR_STOP=1 -f supabase/checks/0008_assertions.sql`.

## The owner's admin row (needed once, after the first admin user exists)

The admin role comes only from `public.profiles` (D-006), never from token metadata, and no API role can write that table. After the owner's user exists in the project (Authentication, Users), insert the row once in the SQL editor with the user's id:

```
insert into public.profiles (id, role, display_name) values ('<the owner user id>', 'owner', 'Owner');
```

There is exactly one `owner` row (a unique index). Editors stay disabled at launch (D-007). `p_actor` of every admin RPC must be this id: the 0008 functions refuse any other actor.

## One-time prerequisites (the owner does these, OT-03)

1. Create the dev project `powersmash-dev` in the Mumbai region (`ap-south-1`). Do not reuse production.
2. In **Project Settings, Data API, Settings, Exposed schemas**: keep `public` (the server functions reach the private tables in `public` with the secret key; the anon role has no grant on them) **and add `api`** (the public archive build reads the seven `api.public_*` views with the publishable key and the `Accept-Profile: api` header; without `api` here every view answers HTTP 406, found on the first live run, 2026-10-24). If the lead later moves to an `api`-only exposure (D-005), add `Content-Profile`/`Accept-Profile` headers to `src/lib/supabase/rest.ts`.
3. Note the project URL (not secret) and create a **secret** key for the Worker. The owner enters the secret on the Cloudflare Worker secret screen as `SUPABASE_SECRET_KEY`; Claude never sees it (`docs/SECRETS.md`).

## How the lead applies the migration to the DEV project

Pick one. Option A needs no tools and works from a phone.

**A. Supabase dashboard (SQL editor), simplest.** Open the dev project, SQL editor, new query, paste `migrations/0001_lead_funnel.sql`, run. Then paste `checks/0001_assertions.sql`, run; it must return `ok: 0001_lead_funnel assertions passed`. Then do the same for every later migration and its check, in the order of the table above (each prints its own `ok:` row).

**B. Supabase CLI (what the migrate workflow will do):**

```
# one time, at the PC; the project path contains a space, so quote it
cd "C:\Users\Admin\Desktop\Power Smash"
npx supabase login                       # opens a browser; the owner signs in (needs SUPABASE_ACCESS_TOKEN in CI)
npx supabase link --project-ref <DEV project ref>
npx supabase migration list              # shows 0001 as not yet applied
npx supabase db push --dry-run           # prints what would run
npx supabase db push                     # applies it to the linked DEV project
```

Notes for B: `.npmrc` sets `ignore-scripts=true` (D-002) and the `supabase` npm package downloads its binary in a post-install step, so a plain `npx supabase` may not find the binary. The lead decides how to allow that (a one-time `npm rebuild supabase` with a note in DECISIONS, or the official standalone binary, which needs the owner's yes to download). `db push`, `migration list`, `link` and `login` work against a hosted project without Docker (VF-B15). `db diff`, `db pull`, `db dump` and `db reset` need Docker and are not used.

## Verify after applying

1. Every `checks/NNNN_assertions.sql` returns `ok`.
2. With dev values in the environment (publishable key only, never the secret key):

   ```
   # PowerShell
   $env:PUBLIC_SUPABASE_URL = "https://<dev ref>.supabase.co"
   $env:PUBLIC_SUPABASE_PUBLISHABLE_KEY = "<sb_publishable_... key>"
   node scripts/anon-harness.mjs
   ```

   Exit code 0 and "0 leaks" is a pass. Any exposed table is listed and the exit code is 1.
3. Supabase dashboard, Advisors (security): no lint on the tables (the `api` views are definer views on purpose, see `docs/m2/schema-notes.md`).

## Rules for the next migrations (same pattern, D-005)

- A static test (`tests/supabase/migrations-structure.test.ts`) parses every migration and fails when a `create table` has no `enable row level security`, no revoke for anon and authenticated, or any grant to a role other than `service_role`.
- Every new table: `enable row level security`, `revoke all ... from public, anon, authenticated`, explicit `grant` to `service_role` (or to a specific role), comments on every private column, and an entry in `scripts/anon-harness.mjs` (`MANIFEST`) and in `checks/` assertions.
- Public data only through views in the `api` schema with explicit column lists; add the view to the harness manifest with `expectSelect: true`.
- Functions go in schema `app`, `set search_path = ''`, `revoke all on function ... from public, anon, authenticated`.
- Money in integer paise; instants `timestamptz`; event dates `date` (D-030).
