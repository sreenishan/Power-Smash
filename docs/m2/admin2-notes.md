# Worker ADMIN2 notes (M2: admin RPCs, schema reconciliation, local SQL run)

Status: built; nothing committed, no account, no real call, fictional data only. The local PostgreSQL was started by this worker and stopped at the end.

## What was built

- `supabase/migrations/0008_admin_rpcs.sql` and `supabase/checks/0008_assertions.sql`.
  - Tables (private, RLS on, no policy, nothing for anon/authenticated): `profiles` (id, role owner|editor; one owner by unique index; no foreign key to the GoTrue users table because migrations never touch `auth`), `profile_requests` (kinds claim|correction|removal|junior, statuses new|in_review|resolved|rejected, `summary` refuses an `@` and seven or more digits), `player_dup_dismissed` (pair stored once, smaller id first).
  - `service_role` privileges: `profiles` and `player_dup_dismissed` select only; `profile_requests` select + insert (the claim form inserts, the admin resolves through the RPC). Writes only through the audited functions.
  - `app.require_owner(p_actor)`: p_actor must be the uuid of a `profiles` row with role `owner`, else `FORBIDDEN`. Used by every NEW RPC.
  - RPCs (SECURITY DEFINER, `search_path = ''`, EXECUTE service_role only, one audit row each): `admin_set_setting` (only `unknown_match_mode` and `minor_match_mode`, values `noindex_minimal|hidden`, audit holds old and new), `admin_dismiss_duplicate`, `admin_decide_tournament` (promote: Tamil Nadu becomes public, any other region `listed_no_player_pages`, international stays hidden, a suppressed tournament is refused; reject: rejected + hidden; hide), `admin_resolve_profile_request` (resolve|reject, only from new or in_review), `admin_set_match_lock` (new, see bug 1).
  - `admin_update_match` with `publish_state` in `p_changes` IS accepted (confirmed in 0006 and exercised by check 0006).
- `RLS_MATRIX` reconciled with the schema: removed `subscribers`, `sponsor_contacts`, `erasure_log` (no such tables); added `video_title_history`, `player_dup_dismissed`, `notice_versions`, `profile_requests`, `sponsors`, `placements`, `placement_stats_daily`, `placement_page_stats_daily`, `rate_limit_hits`, `daily_salts`, `placement_impression_seen`. New test `tests/admin/rls-matrix-schema.test.ts` parses every migration and fails when a table or api view is missing from, or extra in, the matrix. `tests/admin/policy.test.ts` lists were updated to tables that exist.
- `scripts/anon-harness.mjs` MANIFEST: `profiles`, `profile_requests`, `player_dup_dismissed` added.
- `supabase/README.md` rewritten: every migration and check in order, local run steps, the owner row, the old proposed 0003.

## The old proposed 0003 (decision)

Nothing was applied anywhere, so `supabase/proposed/0003_lead_kinds_m3.sql` was moved to `supabase/migrations/0003_lead_kinds_m3.sql` (it takes the free number 0003, no gap: 0001..0008), with `supabase/checks/0003_assertions.sql`; `supabase/proposed/` was removed. Tests updated: `tests/supabase/local-pg.test.mjs` (now asserts both kinds accepted and an unknown kind refused) and `tests/supabase/migrations-structure.test.ts` ("creates nothing" accepts an `alter table ... add constraint` migration). `scripts/pg-local.mjs proposed` still works (no proposed files means it equals a normal apply). PROPOSED decision for the lead: record "0003 moved into migrations as 0003, 2026-10-22". If a hosted project ever had 0001, 0002 and 0004+ applied, apply 0003 by hand there.

## The local run (PostgreSQL 17.11, `node scripts/pg-local.mjs`)

`reset`, `apply` (roles.sql + 0001..0008), `check`: all nine check files return their ok row. Behaviours exercised in rolled-back transactions (check 0006 already covered most; check 0008 adds the rest): merge / split / rename / emergency hide (video, player, name, tournament) / confirm adult; minor + adult merge refused without the override and audited with it; unknown merged into adult makes the survivor non-public; a suppressed name cannot be confirmed as an adult, merged, or created as an adult; suppression stops a sync resurrecting a video; every RPC writes an audit row, a refused call writes none; audit_log update, delete and truncate are refused for the owner role and for service_role; anon and authenticated are denied every table and RPC; service_role never holds TRUNCATE, REFERENCES or TRIGGER on any table and can delete only from a short list (generic loop over every table in `public`, so a future table is covered). A deliberate mutation (require_owner made a no-op) made check 0008 fail, so the check can fail. Also probed by hand: a two-step merge chain flattens (both old paths 301 to the final page) and an emergency hide of the survivor turns all three paths into 410.

## SQL bugs found and fixed (migrations were never applied, so edited in place)

1. **Field lock was a silent no-op (store + SQL).** `supabase-store.ts` locked a field by PATCHing `matches.manual_override`, but the 0005 guard trigger puts `manual_override` back to its old value for every write outside an admin RPC. Fix: new RPC `admin_set_match_lock` (0008) and the store calls it (`src/lib/admin/supabase-store.ts`, test updated; the unused `patch` helper was removed). Check 0008 proves the direct write is undone and the RPC works.
2. **Error codes never reached the store (0006).** The store maps a PostgREST error to a code by looking for words such as `SUPPRESSED`, `MINOR_ADULT_MERGE_BLOCKED`, `ALREADY_MERGED`, `SAME_PLAYER`, `NOT_FOUND`, `EMPTY_NAME` in the message, but the 0006 messages did not contain them (everything became BACKEND_ERROR). The messages of `admin_merge_players`, `admin_split_player`, `admin_rename_player`, `admin_set_age_status`, `admin_release_suppression`, `admin_update_video`, `admin_update_match` now start with the code (wording otherwise unchanged; no check depends on the text).
3. **0003 gap** (see above).
No other plainly wrong SQL was found in 0004-0007 (no change to 0004, 0005, 0007).

## Deviations, open points

- Only the NEW RPCs call `app.require_owner`. The 0006 RPCs still accept any non-empty actor (the Worker verifies JWT, aal2 and the profiles role first). PROPOSED: add `perform app.require_owner(p_actor)` to every 0006 admin RPC once the sync no longer calls them with a system name, and make the 0006 check insert the fake owner first. Left alone to avoid breaking the SCHEMA worker's check and tests mid-wave.
- `archive_settings` still grants service_role insert and update directly (needed for the sync's upsert target `archive_settings`), so a setting can be changed without an audit row by any holder of the secret key; the admin toggle goes through `admin_set_setting`. Tightening needs a decision on who seeds that table.
- `admin_resolve_profile_request` only records the decision. A resolved `removal` request does NOT hide anything; the owner uses Emergency hide (D-014). `junior` and `claim` flows (D-015 proof) belong to whoever builds the forms.
- No SQL duplicate-suggestion RPC (pg_trgm) was written; the TypeScript scan stays (admin-notes item 5).
- Placement and sponsor admin RPCs (0007 header says they arrive with the admin migration) are NOT in 0008: nothing in the admin store calls them yet. Whoever builds the sponsor admin screen needs RPCs (create sponsor, create or end a placement) written in a 0009 in the same pattern.
- `profiles` has no foreign key to the GoTrue users table; the owner row is inserted by hand (README). The structural test forbids migrations naming `auth.*`.
- `src/lib/archive/types.ts` (SCHEMA's file) has no `AdminRpcArgs` entries for the five new RPCs; the store calls them with untyped args. Request to SCHEMA: add them (additive).
- Not run against Supabase/PostgREST/GoTrue (none exists); the REST-level anon harness stays OT-03.
- `tests/admin/isolation.test.ts` now exempts `src/lib/sync/` (server-side sync, new in this wave) from "no file outside the admin imports identity".

## Requests to others

- SCHEMA: `AdminRpcArgs` additions above; keep `supabase/README.md` table in sync when adding 0009+ (and add the check file, `expect_fail` helper pattern is in 0006/0008).
- LEAD: record the 0003 move in DECISIONS; add the `profiles` owner insert to the OT list (after the owner user exists); run the migrations in order on the dev project when OT-03 exists.
