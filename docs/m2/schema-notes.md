# M2 schema notes (worker SCHEMA)

Files: `src/lib/archive/types.ts` (row, view, RPC types, enum and column lists), `supabase/migrations/0004_archive_core.sql`, `0005_archive_safety.sql`, `0006_archive_api.sql`, `supabase/checks/0004..0006_assertions.sql`, `tests/supabase/archive-types.test.ts`, `archive-structure.test.ts`. Applied and checked on the local PostgreSQL 17 (`node scripts/pg-local.mjs`): all checks print `ok`. Nothing was run against Supabase (none exists yet). Fictional data only.

## Tables (schema public, all private, RLS on, no policies, anon and authenticated hold nothing)

| Migration | Tables |
|---|---|
| 0004 | `videos`, `video_title_history`, `tournaments`, `tournament_private` (organizer contact), `tournament_aliases`, `players`, `player_aliases`, `matches`, `match_participants`, `slug_redirects`, `sync_runs` |
| 0005 | `archive_settings`, `site_state` (one row), `audit_log` (append-only), `suppression` (tombstones) |

## Grants matrix (service_role only; EXECUTE and table rights are explicit)

| Table | service_role |
|---|---|
| videos, tournaments, players, player_aliases, matches, sync_runs, archive_settings, suppression | select, insert, update (no delete: tombstones, D-014) |
| video_title_history, audit_log | select, insert (append-only; audit_log also has a trigger that refuses update, delete, truncate) |
| site_state | select, update (the row exists; no insert, delete or truncate) |
| tournament_private, tournament_aliases, match_participants, slug_redirects | select, insert, update, delete (erasure request, reparse, redirect flattening) |

Schema `api`: `anon` and `authenticated` hold only USAGE on the schema and SELECT on the seven views. Schema `app` (helpers and internal views) is closed to them; no function is executable by them. Admin RPCs: EXECUTE for service_role only.

## `api` views (explicit columns, masking in SQL, `security_barrier`)

`public_videos`, `public_matches`, `public_match_participants`, `public_players`, `public_tournaments`, `public_slug_redirects`, `public_archive_modes`. Rules: a match page is `full` (all participants adult_confirmed), `minimal` (noindex, raw title only, no names, age group masked) or hidden, decided by the worst effective age status and by `unknown_match_mode` (default `noindex_minimal`) and `minor_match_mode` (default `hidden`). A junior category, an age group up to U19, a minor-signal tournament, no participants, a suppressed participant, a held, duplicate or `minor_hold` match fail closed. Players appear only when adult_confirmed, non-provisional, unmerged, unsuppressed, with a confirmed alias or 3 or more published matches, and in a fully public video. Non-Tamil-Nadu tournaments are hidden unless `non_tn_tournament_pages = on`; listed-only videos never link a player page. No organizer phone or email, no description, no age evidence, no 410 paths.

## Other rules in the database (not only in code)

- `players_protected_rules` check: a protected player (not adult_confirmed) has no district, photo, bio or handle, is noindex and hidden, with an opaque slug (`p-` + 16 hex). The `players_guard` trigger applies this, turns an old named slug into a 410 row, never lets the sync lower a status or lift to adult_confirmed, and only `admin_set_age_status` can.
- Suppression triggers force `hidden` for a suppressed video, player (id or normalised name) or tournament; a suppressed player is never linked again.
- Field locks (`manual_override`, PC-20) are restored by trigger unless the change comes from an admin RPC; a retitled locked video gets `override_stale`.
- `site_state.dirty` is set by triggers only for changes that alter public pages (not for stats, `last_synced_at`, etag); `urgent` is set by an emergency hide.
- RPCs (SECURITY DEFINER, audit row, mark dirty): `admin_merge_players`, `admin_split_player`, `admin_rename_player`, `admin_set_age_status`, `admin_update_player`, `admin_emergency_hide`, `admin_release_suppression`, `admin_update_video`, `admin_update_match`, `admin_mark_dirty`.

## Deviations and PROPOSED decisions

1. **Views are not `security_invoker`** (brief said they should be). anon has no privilege on any base table (D-005), so a `security_invoker` view would return nothing. The views are owned by the migration role, `security_barrier` stops filter functions running before the masking. Supabase's advisor may list "security definer view": accepted. PostgreSQL checks EXECUTE on functions inside a view against the CALLER, so the helper logic is in internal VIEWS in schema `app` (not functions); a check proves anon can execute nothing.
2. **RPCs live in schema public, not `app`**: PostgREST only exposes `public` and `api`. They are executable by service_role only. The database cannot verify the human: the Worker verifies the JWT (aal2, D-006) and passes the user id as `p_actor`. `profiles` / `auth.uid()` are not used here (no `profiles` table exists yet).
3. **410 (gone) paths are not public.** They would name hidden entities. The static build cannot emit a 410 from absence; proposal: the Worker looks up a 404 in `slug_redirects` with the service key at runtime. Owner/lead decision.
4. **Player page threshold uses 3 published matches** (each match is its own video, so "3 matches in 2 videos" reduces to this), plus a confirmed alias as the alternative (D-013).
5. Tombstones: `suppression` has no delete; a release only stamps `released_*` and does not show anything again (the admin must unhide explicitly).
6. `matches.publish_state` defaults to `held`; the pipeline must publish clean parses (`auto_publish_clean_parses`, stored, not yet read by any code).
7. Sub-case: `admin_emergency_hide` by name matches plain-text participants approximately (lower-case, punctuation removed): it can over-hide, never under-hide by that route.
8. Not built (out of this slice): `districts` table (SA-N05), `orders`/`payments` (D-032), `profiles`, `video_submissions`, `profile_requests`.

## Requests to others

- Shared test files edited (needed to keep `npm test` green): `tests/supabase/migration-rules.ts` (api read grants, views in api/app), `migrations-structure.test.ts` (gap allowed for a migration waiting in `supabase/proposed`: 0003; views allowed; manifest filter), `migration.test.ts` (all migrations), `anon-harness.test.mjs` (api views readable), `local-pg.test.mjs` (table list, timeouts). `scripts/anon-harness.mjs` MANIFEST now lists my 15 tables, 7 api views and (added for the placements worker, who may move them) the 5 `0007_placements` tables.
- Sync worker: write with `on_conflict` from `UPSERT_CONFLICT_TARGETS`; never send `visibility`, `manual_override` or `age_status = adult_confirmed`; check `suppression` is enforced by trigger, not needed in code.
- Admin worker: all privileged writes through the RPCs; a plain table update of a locked field is silently reverted.
- Lead: `supabase/README.md` should list 0004-0006 and the three new checks (not edited: not my file).

## Open owner questions

Confirm `unknown_match_mode` / `minor_match_mode` / `non_tn_tournament_pages` launch values with the lawyer (D-012, D-018); decide how 410 is served (note 3).

## Fix wave (S2-5, S2-7, S2-9, match slugs, 30-day purge)

- **S2-9**: `admin_set_age_status(p_actor, p_player_ids, p_status, p_evidence, p_reason, p_override_minor boolean default false)`. `minor_confirmed` to `adult_confirmed` is refused unless `p_override_minor = true`; the override writes audit action `age_override_minor`. `minor_suspected` and `unknown` can still be confirmed with evidence.
- **S2-7**: a name tombstone now (a) marks existing unlinked participants and aliases of that name suppressed/rejected (trigger `suppression_apply`), (b) marks NEW participants and aliases on insert (`participants_guard`, `aliases_guard`; the raw name is normalised in SQL like `name_normalized`), (c) `app.video_mode` also checks the raw name, so a match naming a suppressed person is hidden.
- **Match slugs**: `matches.slug` / `slug_kind` persisted (opaque `match-` + 16 hex by default, unique). `api.public_matches.slug` returns the stored named slug only for a `full` match, otherwise the opaque one. When a participant stops being an adult (`players_guard`) or is emergency-hidden, `app.retire_match_slugs` makes the slug opaque and writes a 410 row for the old `/matches/<slug>/`. Protected players already only hold opaque slugs.
- **S2-5**: nothing added. `profiles`, `profile_requests`, `admin_set_setting`, `admin_dismiss_duplicate`, `admin_resolve_profile_request`, `admin_decide_tournament` are in 0008; the sync store reads `suppression` (not `video_suppressions`) and `videos.youtube_id`. Remaining mismatches are in the callers, not the schema.
- **410/301 data** for the build: 301 rows to public pages are readable (`api.public_slug_redirects`); 410 rows stay private (they would list hidden names), to be served at runtime by a Worker with the service key (open decision C2-1).
- **30-day purge (0009)**: `public.admin_purge_stale_api_data(p_actor text, p_older_than_days integer default 29) returns jsonb` (service_role only, 1..30). Deletes old `video_title_history` rows (all but the newest row of a live video; all old rows of a retired video, retired = `title_raw = ''`), blanks leftover API fields of retired videos, deletes their match and participants (and match redirect rows). Never touches `suppression`; the video row stays hidden. One audit row, none on a no-op re-run; returns counts `{history_rows, videos_blanked, matches, participants, redirects}`. Retire first (sync), call this daily.
