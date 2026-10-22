# M2a sync worker notes (SYNC)

Scope: YouTube client, classification, sync pipeline, 30-day purge, dirty-flag and cron logic, Supabase store adapter. Everything runs against interfaces; nothing touched a real YouTube, Supabase or Telegram service. All fixtures are synthetic and labelled (`tests/fixtures/youtube-api/`, ids start `fake-`).

## What was built

| Area | Files |
|---|---|
| API client (channels.list, playlistItems.list, videos.list in 50-id batches), ETag, backoff, quota ledger | `src/lib/youtube/{client,quota,types}.ts` |
| Classification (live, Shorts, international, non-Tamil-Nadu) | `src/lib/youtube/classify.ts` |
| Pipeline: backfill (checkpoint resume), incremental, stats_recent, stats_all, purge | `src/lib/sync/pipeline.ts`, `record.ts` |
| 30-day rule | `src/lib/sync/purge.ts` |
| Dirty flag, debounce, dead-man switch, cron handler shape, RSS reader, workflow_dispatch request | `src/lib/sync/{dirty,cron}.ts` |
| Alerts (plain text, small codes) | `src/lib/sync/alerts.ts` |
| Stores | `src/lib/sync/memory-store.ts` (tests), `supabase-store.ts` (mocked-fetch tested only) |
| Runner (owner or workflow only) | `scripts/sync-run.ts` (bundle with esbuild first, see its header) |
| Tests | `tests/sync/*` (103 tests) |

## Rules implemented
- Quota: 1 unit per call (VF-C1), every attempt charged, fail closed at 3,000 units per Pacific quota day (D-033), counted across runs from `sync_runs`. Google `quotaExceeded` is never retried.
- API key goes in the `x-goog-api-key` header, never in a URL; errors and alerts hold only status/reason codes.
- Live: `liveBroadcastContent` live/upcoming = live; `liveStreamingDetails` alone only sets `wasLive` and `liveStatus = completed` (VF-C11).
- Shorts: UUSH set, RSS `/shorts/` link, UULF/UULV (not short), then 180 s with `#shorts` or no "vs" (the parser's rule). A short-length video with no signal at all is typed `short` but flagged `SHORT_UNCERTAIN` for review (landscape clips, VF-C10).
- International = `hidden` (reason `international`); non-Tamil-Nadu match = `listed_no_player_pages` (D-018); unlisted = hidden.
- Manual overrides: `lockedFields` (`videoType`, `visibility`, `needsReview`, `parsed`) are never overwritten. The raw title and statistics always follow YouTube.
- Suppressed ids are never fetched, stored or resurrected; they count as "known" for the incremental stop and the RSS known ids.
- Deleted or private videos (missing or private in `videos.list`) are purged. Guard: an empty `videos.list` answer for 10+ ids fails the run instead of purging.
- 30-day rule: statistics older than 28 days are nulled, rows not refreshed for 29 days deleted; runs after every sync, including failed ones. All videos refresh weekly (`stats_all`), videos under 90 days daily (`stats_recent`).
- Dirty flag: new/changed visible public content marks dirty; hidden rows and owner-hidden rows never do; view drift alone at most once per 24 h; 10-minute debounce; dead-man alert at 8 h.

## Deviations and proposed decisions
1. **PROPOSED D-0xx: stale-data margins.** D-016 says "before day 30"; the code purges statistics at 28 days and rows at 29 days to leave margin.
2. **PROPOSED: one cron expression** (`*/5 * * * *`) serves dispatch, RSS (minute % 15 == 0) and dead-man (minute < 5), using 1 of the 5 Free-plan triggers (VF-A29).
3. **`SHORT_UNCERTAIN` review reason** is an addition to the parser's review reasons, owned by the sync, not the parser.
4. `needsReview` for a match also includes the parser's `minorHold` (D-012: "hold when needsReview or minorHold"); reason stored as `MINOR_HOLD`.
5. Non-Tamil-Nadu detection (`eventScope`) uses the parser's `locationHint` (a TN district = in Tamil Nadu; any other known place = not), then "All India" / "National(s)" wording and explicit non-TN state names. No location = `unknown` (treated like Tamil Nadu: public). The owner should confirm that default (D-018 is still "proposed").

## Not done / blocked
- **Custom Worker entry is not wired.** `cron.ts` holds the pure `handleScheduled`. Wiring needs a custom entry exporting `scheduled` and re-exporting `fetch` from `@astrojs/cloudflare/handler`, plus `wrangler.jsonc` `main` and `triggers.crons`; owned by the lead. Untested against the real runtime (D-008, VF-A29).
- **Supabase adapter column names are assumed** (table list at the top of `supabase-store.ts`): `videos`, `video_suppressions`, `sync_runs`, `site_state` plus extra `site_state` columns (`uploads_playlist_id`, `channel_etag`, `playlist_first_page_etag`, `checkpoint`, `last_drift_dirty_at`). Real adapter not run against a database.
- `src/lib/archive/types.ts` did not exist; the row type is local (`src/lib/sync/types.ts`). Only the mapper in `supabase-store.ts` changes when SCHEMA's types land.
- Writing parsed matches, players and tournaments from a `VideoRecord` (identity resolution, spec 10.5) is not in this slice: the sync stores the `ParseResult` on the video row and flags review. Whoever builds resolution should read `videos.parsed`, `needsReview` and `eventScope`.
- Live check (`/live`, 2-minute cache) and the UUSH/UULF/UULV playlist smoke test (`playlistItems.list` on those playlists is undocumented, VF-C10) are not built; `PlaylistSignals` is the injection point.

## Requests to others
- SCHEMA: tables/columns above, plus a SQL `mark_dirty()` (the adapter uses an equivalent conditional PATCH), and `site_state.known_video_ids` as jsonb array.
- Lead: the sync workflow can run `esbuild` then `node tmp/sync-run.mjs <mode>`; schedule `incremental` 6-hourly, `stats_recent` daily, `stats_all` weekly. `npm run check` reports 5 pre-existing errors in `src/lib/admin/*` (not this area).

## Owner questions
- Confirm the default for events with no detectable location (currently public).
- YouTube policy: classification (match/short/live/other) stays "not cleared" (D-016 item 11, D-033 cross-reference).
