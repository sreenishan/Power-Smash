# M2 sync notes, wave 2 (worker SYNC2)

Scope: reconcile the Supabase store adapter with the real schema (migrations 0004-0005, `src/lib/archive/types.ts`), build identity resolution, test the whole pipeline. Nothing touched a real YouTube, Supabase or Telegram service; fictional data only (ids start `fake-`, invented names and events). `tests/sync`: 174 tests, all green; locked `npm run check` has no error in my files.

## What changed

| Area | Files |
|---|---|
| Row types: the stored video IS `VideoRow` (`VideoRecord` is an alias); the sync writes `VideoWrite` (= `VideoUpsert` plus a first-insert `hidden_reason`) | `src/lib/sync/types.ts`, `record.ts` |
| Supabase adapter on the real schema | `src/lib/sync/supabase-store.ts`, `supabase-identity.ts` |
| Identity resolution (pure, over `IdentityStore`) | `src/lib/sync/identity.ts`, `identity-store.ts` |
| In-memory stores that mimic the DB triggers | `memory-store.ts`, `memory-archive.ts` |
| Pipeline: `reparse` mode, identity hook, retire instead of delete | `pipeline.ts`, `purge.ts` |
| Runner: identity store wired, `reparse` mode | `scripts/sync-run.ts` |
| Tests | `tests/sync/{schema-parity,supabase-store,supabase-identity,identity,e2e,pipeline,classify,dirty-cron}.test.ts`, `helpers.ts` |

## Adapter reconciliation (task 1)

- Tables and columns are the real ones (`videos.youtube_id`, `title_raw`, `views`, `likes`, `stats_fetched_at`, `parse_result`, `manual_override`, ...). Reads use the explicit column lists from `archive/types.ts` (never `select=*`), lists page at 1,000 rows, upserts use `UPSERT_CONFLICT_TARGETS`.
- **Visibility and locks**: a row with `visibility` is an INSERT; an update never carries `visibility`, `hidden_reason`, `manual_override` or `override_stale`. Inserts and updates are sent as separate requests (PostgREST would null a missing key across a batch). The sync's own merge also keeps `type`, `parse_status` and `is_international` when locked; the DB trigger is the backstop.
- **Suppression**: only ACTIVE tombstones (`released_at is null`, kind `youtube_id`) count; the DB triggers also force `hidden`.
- **Dirty flag**: `markDirty` calls RPC `admin_mark_dirty` (actor `sync`) through the small REST client's `insert` to `rpc/admin_mark_dirty`. `SyncState.dirtySince` is `site_state.dirty_since` when `dirty`, `lastBuildStarted` is `last_deploy_requested_at`, `lastSyncOkAt` the newest `ok` non-purge run.
- **sync_runs**: the table's `mode` check has no stats refresh or purge value, so the DB mode is mapped (`stats_recent`->`live_status`, `stats_all` and `purge`->`weekly_check`) and the real mode is kept in `trigger` (`sync:<mode>`). `quota_exhausted` is stored as `partial` with the code in `error`. The Pacific quota day, flags and the sync state (uploads playlist, ETags, backfill checkpoint, drift stamp, recent ids) live in the run's `counts` jsonb (`quota_day_key`, `sync_state`); the newest run holding a `sync_state` is the current state. No new table or column was needed.
- **Static parity test** (`tests/sync/schema-parity.test.ts`): parses `supabase/migrations/*.sql` (tables, columns, unique keys, public functions) and drives BOTH adapters through every method against a recording fetch. It fails on an unknown table, select column, filter column (`counts->>x` reduced to its column), order column, body key, RPC, or an `on_conflict` that matches no unique key; it also checks no `select=*`, no DELETE on a table without that grant, and that locks are never written.

## Identity resolution (task 2)

Input: a stored video row (`parse_result`). Output: tournaments, `tournament_aliases`, players, `player_aliases`, `matches`, `match_participants`, and review reasons for the video.

- **Which videos**: only `type = match`, parse kind `match`, entity creation allowed, not international, event scope `tamil_nadu` (the parser's location hint), video `public`. Everything else is skipped (listed videos never get players or tournaments). Skip reasons are returned.
- **Owner decision applied**: events with no detectable place are now `listed_no_player_pages` (classify.ts changed from `public`); only a detected Tamil Nadu event gets player and tournament pages. This closes the open owner question in `sync-notes.md` (default for no detectable location).
- **Matching tiers** (reusing `src/lib/identity`: `matchAlias`, `findPossibleDuplicates`): one confirmed in-scope alias links (`exact_alias`); two or more candidates are `AMBIGUOUS_ALIAS` (nothing linked, match demoted to held, reason added to the video's `review_reasons` and `hard_flags`, parse_status `needs_review`); two or more name tokens with no alias create or reuse a PROVISIONAL player scoped to the tournament edition (alias status `provisional`, `scope_tournament_id`); no tournament means plain text. Single tokens, initials, truncated and blocked names stay plain text. A rejected alias never links. The same person is never linked twice in one match. Similarity NEVER merges.
- **Possible duplicates** are written to the append-only `audit_log` (`possible_duplicate` for players, `possible_duplicate_match` for the same `match_key` in another video), actor `sync`, ids and counts only (no names). `matches.duplicate_of` is NOT set automatically (it would hide a page).
- **Age (D-012)**: new players start with the parser's participation status (`unknown` or `minor_suspected`), opaque slug `p-` + 16 hex from the player uuid, no district, photo, bio or handle, noindex, hidden, provisional. A minor signal only RAISES a protected player (the DB never lowers); an `adult_confirmed` player is never changed by the sync, the participation carries the signal and `effective_age_status` takes the stricter. Players are never created adult.
- **Tournaments**: key `(series_key, edition_year)`; a spelling variant is found through `tournament_aliases` (same edition year only); two editions reachable through one alias is ambiguous (no link, review reason). New rows: `status pending`, `visibility hidden`, `region tamil_nadu`, `source parsed`, slug `{series}-{year}-{district}` made unique with a counter. An existing tournament only gains categories, age groups, a minor signal and a missing district.
- **Matches**: new match `published` only when `auto_publish_clean_parses = true` and the parse is clean (no hard flag, no minor hold, no ambiguity); otherwise `held`. The sync never promotes a held match; it demotes a published one that gains a hold or a review reason. Field locks (`matches.manual_override`, including `participants`) and `resolution = manual` participant slots are never rewritten.
- **Suppression**: a suppressed name or player id is never linked or created; the participant row keeps no readable name (`[withheld]`); a suppressed tournament is not linked.
- **Idempotent**: re-running over the same inputs writes nothing (tested for the identity step alone and for the whole pipeline: `reparse` after a backfill leaves both stores byte-identical, makes no API call, spends no quota, does not mark dirty). jsonb key order and `+00:00` versus `Z` timestamps are normalised in the change check so a real Postgres round trip does not look like a change.
- **`reparse` mode** (new): re-reads every stored title with the current parser (no API call), merges, and re-runs identity. Use it after a parser change or after the admin confirms an alias.
- **Slug rename**: `planSlugRename()` returns the 301 rows (and flattens earlier hops) for a tournament or player slug change; the sync itself never renames a persisted slug, so it is only exercised by tests today.

## Deviations and PROPOSED decisions

1. **PROPOSED: videos are retired, not deleted.** `service_role` has no delete on `videos` (D-014) and `matches` restrict on it. A video deleted or made private upstream, or not refreshed for 29 days, is hidden (`hidden_reason removed_from_youtube`) with `title_raw`, statistics, description, thumbnail, etag, `title_normalized` and `parse_result` blanked. Stale statistics are nulled at 28 days as before.
2. **PROPOSED: sync state lives in `sync_runs.counts`** (see above) instead of new `site_state` columns.
3. **PROPOSED: the identity step records review reasons the parser does not know** (`AMBIGUOUS_ALIAS` is already a HardFlag; `SHORT_UNCERTAIN` is a sync addition stored in the plain `text[]` column).
4. Descriptions are never stored (`description` is written null): the pipeline does not use them and they can hold phone numbers (D-029). `thumbnail_url` is null (the API type carries no thumbnails and a URL is never invented).
5. The old per-video fields `channelId`, `madeForKids`, `ageRestricted`, `privacyStatus`, `commentCount`, `titleChangedAt`, `firstSeenAt` have no column and are gone (the history table and `created_at` cover the last two).

## Requests to others

- **SCHEMA / lead (needed for the 30-day rule to be fully true)**: `video_title_history` is insert-only and still holds old titles of a retired video (API-derived text). Provide a SECURITY DEFINER RPC (for example `admin_purge_video(p_actor, p_youtube_id)`) that deletes the video, its history and its match (participants cascade), audited, and allow the sync to call it; then `retireVideos` can become a real delete. A lock on `visibility` also stops a retired video from being hidden by the sync; the RPC should override it.
- **SCHEMA**: `sync_runs.mode` has no `stats_*` or `purge` value (mapped for now); optional `site_state` columns would be cleaner than `counts.sync_state`.
- **SCHEMA**: `app.mark_dirty` is reachable only through `admin_mark_dirty`, which writes an audit row every call; a `sync_mark_dirty` without the audit row would cut noise (table triggers already mark dirty for content changes).
- **Admin worker**: a possible-duplicate queue could read `audit_log` rows with `action = 'possible_duplicate'`; the admin's own scan still works without them. A video with `review_reasons` containing `AMBIGUOUS_ALIAS` or `SHORT_UNCERTAIN` should get plain-English labels.
- **Lead**: `scripts/sync-run.ts` (bundle with esbuild first) now takes `reparse`; the sync workflow can add a manual `reparse` dispatch. Cron wiring is still the lead's (see `sync-notes.md`).
- **Other workers' files**: `tests/wiring/worker-and-workflow.test.ts` had a syntax error while I ran the suite (not mine; probably mid-edit), and `tests/zz_review_cor2_parser2.test.ts` has a type error (`ebr`); both appear in locked `npm run check`.

## Open owner questions

- Confirm that a retired (deleted upstream) video may keep its match row and participant names hidden until the lead provides the purge RPC (above).
- Confirm that new tournament candidates should stay `pending` and `hidden` until the admin approves them (current behaviour, per the admin screen).
- YouTube policy: classification (match/short/live/other) stays "not cleared" (D-016 item 11).
