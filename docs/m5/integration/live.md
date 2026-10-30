# Wave 5 integration: near-live scores (D-113)

Owner: wave 5 build agent (live scores). For the integrator. Everything below is built and tested in its own files; nothing is wired into the shared registries, so today **nothing a visitor or the owner sees has changed**: the live region is not on any page (`features.liveScores` does not exist yet, so it reads as off), the endpoint answers `{"live": false}` (and would anyway, because `LIVE_SCORES_ENABLED` is not in `runtime-env.ts`), and the console is not in the admin menu.

## 1. What exists

| Area | Files |
|---|---|
| Migration | `supabase/migrations/0021_live_scores.sql`, `supabase/checks/0021_assertions.sql` |
| Shared rules (client + server + SQL copies) | `src/lib/live-scores/rules.ts` (kinds, tap key rule, window bounds, cache header, the two switches), `replay.ts` (rally log replayed by the scoring engine; cues), `in-build.ts` (`liveScoresInBuild`, `liveScoresServerOn`) |
| Public contract and endpoint | `src/lib/live-scores/public.ts` (view columns, row check, masking, JSON), `handler.ts`; route `src/pages/api/live-scores/[event].ts` (`prerender = false`) |
| Event page script | `src/components/competition/live/LiveScores.astro` (gate), `LiveScoresRegion.astro` (region + module script + `:global` table styles), `client.ts` |
| Admin | `src/lib/admin/live-scoring/` (`types.ts`, `schemas.ts`, `service.ts`, `memory-backend.ts`, `supabase-backend.ts`) |
| Console | `src/admin/screens/scoring/Scoring.tsx` (`ScoringScreen`, `LiveSettingsCard`, `MatchList`, `ScoringConsole`, `ConsoleBody`), `logic.ts` |
| Tests | `tests/live-scores/*.test.ts` (8 files) + `fixtures.ts`; `tests/e2e/live-scores.spec.ts` (written, not run) |

**One file outside my list, as allowed:** `src/pages/competitions/[tournament]/[event].astro` got two lines (an import and the element; Astro needs both):

```astro
import LiveScores from '../../../components/competition/live/LiveScores.astro';
  <LiveScores eventId={e.id} />
```

(placed just before the "Order of play" section). Please also update that page's header comment ("Static, no client JavaScript ... Never 'Live' on this page"): it is still true while `features.liveScores` is off; with it on the page carries the small live script, and "Live" appears only inside the live region, only for a point younger than the window.

## 2. Migration 0021 in short

- `competition_settings` gains `live_scores_public boolean default false` (the owner's database switch) and `live_window_seconds integer default 300` (60..3600).
- New table `public.match_live_state` (one row per scored match: current game, games won, finished games, server, `last_point_at`). RLS on, no policies, everything revoked, service_role select only. Written only by the RPCs; a cache of the append-only rally log `match_score_events` (0017), rebuilt on every tap. No personal data.
- `app.competition_live_replay(uuid, jsonb)` replays the log by the event ruleset (the same rules as `replayScoreEvents` and the engine: rally, undo as a compensating tap, first server only before the first rally). `app.competition_live_store` writes the cache row. Both: no privilege for any API role, `search_path = ''`.
- `public.admin_live_score(p_actor text, p_match uuid, p_record jsonb)`: `{kind: 'rally'|'undo'|'first_server', side: 'A'|'B'|null, key, expectedSeq}`. Same key again = stored once, answers `duplicate: true` and the current state (a key reused for a different tap is INVALID). `expectedSeq` not equal to the last seq = `STALE`. Rally/undo only while `live`; first server while scheduled/ready/live and before any rally. Returns `{matchId, duplicate, seq, status, revision, state}`.
- `public.admin_live_match_status(p_actor, p_match, p_record jsonb, p_expected_revision integer, p_reason text)`: `{action: start|pause|resume|end, endStatus: completed|retired|abandoned|null, retiringSide}`. Start needs both sides confirmed entries and a published draw. End writes `match_games` from the log, `winner_side`, `result_source = 'scorer'`, **unconfirmed** (public only after `admin_confirm_result`), locks the draw (like `admin_record_result`). Completed needs the log to show the match won and must agree with `app.competition_result_winner`. A walkover is not possible here (Results screen). `mark_dirty` on start and end.
- `public.admin_set_live_scores(p_actor, p_record {public, windowSeconds}, p_reason)`: owner only, always.
- `api.public_competition_live` (security_barrier, explicit columns): live/paused, unconfirmed matches of public events with a published draw, only while `live_scores_public` is on. `is_live` = status live AND last point within the window (and at most 1 minute in the future). Names only through `app.competition_entry_faces` (0018, `app.competition_named_players`); a missing face counts as protected. Columns: `match_id, event_id, category, age_group, is_junior, round_code, match_number, group_label, court_label, status, is_live, live_window_seconds, game_number, points_a, points_b, games_a, games_b, finished_games, server_side, last_update, side_a_player1_name, side_a_player2_name, side_a_protected, side_b_player1_name, side_b_player2_name, side_b_protected` (no slug, no entry id).
- Audit: `live_start`, `live_pause`, `live_resume`, `live_end`, `live_undo`, `live_first_server`, `set_live_scores`, with ids, counts and codes only. **Rallies are not written to `audit_log` one by one**: the append-only rally log records `recorded_by` (the verified actor) and `recorded_at` for every tap (proposed decision below).

### Access: switch to scorers once 0019 is in (it is in the tree now)
Both scoring RPCs call `app.require_owner(p_actor)` first. After 0019, replace that first statement in a later migration (or in 0021 before it ships) with:

```sql
perform app.require_competition_access(p_actor, app.competition_tournament_of('match', p_match), 'score');
```

in `admin_live_score` and `admin_live_match_status` only. `admin_set_live_scores` stays `app.require_owner`. `0021_assertions.sql` already accepts either first statement (same regex as 0018). The behaviour tests use the owner and an editor (FORBIDDEN), so they stay green; add a scorer probe (assigned tournament ok, other tournament FORBIDDEN, switch off FORBIDDEN) when you switch.

### Local SQL result (2026-10-31)
- `node scripts/with-lock.mjs heavy -- node scripts/pg-local.mjs all` then `stop`: every migration 0001..0021 applied; checks 0001..0005 ok; **0006 fails** with "schema api holds an object that is not one of the seven archive views or a named later view" (0020's two views and my view are not on the allow-list yet; not fixable from my files).
- By hand (scratch database, all migrations, server stopped afterwards): every check file 0001..0021 except 0006 printed its ok row, including `ok: 0021_live_scores assertions passed`, `ok: 0019_competition_accounts assertions passed`, `ok: 0020_registrations assertions passed`. A copy of 0006 with the three views added to the allow-list printed `ok: 0006_archive_api assertions passed`.

## 3. Shared registries: what to add

### policy.ts
`ADMIN_ACTIONS`:
- `'competition.liveMatches': ownerRead`, `'competition.liveMatch': ownerRead`, `'competition.liveSettings': ownerRead`
- `'competition.liveScore': ownerWrite`, `'competition.liveStatus': ownerWrite`, `'competition.saveLiveSettings': ownerWrite`

Access per action for the accounts wave (`LIVE_SCORING_ACCESS` in `src/lib/admin/live-scoring/schemas.ts`; import it into `SCOPED_ACTION_NEEDS`): `liveMatches`, `liveMatch` = read (organizer, scorer); `liveScore`, `liveStatus` = `score` (organizer, scorer); `liveSettings`, `saveLiveSettings` = owner only. For a scorer, `liveMatches` must be filtered to the assigned tournaments (the scoped store; `LiveMatchFacts.tournamentId` is there for it), and `liveMatch`/`liveScore`/`liveStatus` resolve the match to its tournament (`app.competition_tournament_of('match', id)`).

`RLS_MATRIX`:
- `'api.public_competition_live': { private: false, grants: PUBLIC_VIEW }` (comment: "0021_live_scores.sql (D-113): live and paused matches only while the owner's switch is on; names only through the competition faces")
- `'match_live_state': { private: true, grants: OWNER_READ }` (comment: "0021: written only by admin_live_score / admin_live_match_status")

### handler.ts
1. `SCHEMAS`: spread `LIVE_SCORING_SCHEMAS` from `src/lib/admin/live-scoring/schemas.ts` (zod objects, `.strict()`, with refinements: undo has no side; only `end` names an `endStatus`; only `retired` names a `retiringSide`).
2. Cases:
   - `competition.liveMatches` -> `s.liveScoringMatches(actor)`
   - `competition.liveMatch` -> `s.liveScoringMatch(input, actor)`
   - `competition.liveSettings` -> `s.liveScoringSettings()`
   - `competition.liveScore` -> `s.liveScoringScore(actor, input)`
   - `competition.liveStatus` -> `s.liveScoringStatus(actor, input)`
   - `competition.saveLiveSettings` -> `s.liveScoringSaveSettings(actor, input)`
3. The 64 KB body cap is plenty (a tap is under 200 bytes).

### types.ts
`AdminStore extends ... LiveScoringAdminStore` (from `src/lib/admin/live-scoring/types.ts`). Method names: `LIVE_SCORING_STORE_METHODS`.

### memory-store.ts
- State: `live: MemoryLiveState` = `emptyLiveState()` (from `live-scoring/memory-backend.ts`).
- `const liveScoring = createLiveScoringService(createMemoryLiveScoringBackend({ competition: () => state.competition, live: () => state.live, tournaments: <the same CompTournamentRef list the competition backend gets>, players: <the same CompPlayerRef list>, audit: (actor, action, entity, id, reason) => <the store's audit>, markDirty: <the store's markDirty>, now }))`, then delegate `LIVE_SCORING_STORE_METHODS`.
- Optional preview seed: start one seed match so the preview console shows a live match (fictional names only).

### supabase-store.ts
- `createLiveScoringService(createSupabaseLiveScoringBackend({ select, rpc }))` and delegate the six methods.
- Add `LIVE_SCORING_RPCS` (`admin_live_score`, `admin_live_match_status`, `admin_set_live_scores`) to `COMPETITION_DETAIL_RPCS`, so the database's own sentences ("the match is paused; resume it first", "the score was changed on another device ...") reach the scorer. Without it the console still works but shows generic messages.

### http-store.ts
- `liveScoringMatches: () => post('competition.liveMatches')` (actor ignored, like the others)
- `liveScoringMatch: (o) => post('competition.liveMatch', o)`
- `liveScoringSettings: () => post('competition.liveSettings')`
- `liveScoringScore: noActor('competition.liveScore')`, `liveScoringStatus: noActor('competition.liveStatus')`, `liveScoringSaveSettings: noActor('competition.saveLiveSettings')`
- A network failure must come back as `BACKEND_ERROR` with no `errors.form` (it already does): the console treats exactly that as "send again".

### AdminApp.tsx / More.tsx (navigation)
- More (owner; later organizers and scorers too): entry **"Live scoring"**, text "Score a match point by point from your phone, and choose whether the website shows live scores.", lazy `import('./screens/scoring/Scoring').then((m) => ({ default: () => <m.ScoringScreen store={client} /> }))`.
- For scorers later (`navAreasFor`): the scorer's landing area should include Live scoring; hide `LiveSettingsCard` for non-owners (pass a prop or render `ScoringConsole`/`MatchList` directly).
- `ScoringScreen` takes an optional `storage` prop (a `StorageLike`). Leave it unset: see "browser storage" below.

### status.ts, features.test.ts, privacy.ts (legal switch)
- New flag `liveScores: false`, `{ arrives: 'platform wave 5 (owner + lawyer)', unlocks: 'near-live scores on event pages (refreshed about every minute while a match is scored), "Live" only while points are arriving; names follow the competition rule (Protected player)' }`. `liveScoresInBuild()` / `liveScoresServerOn()` read it as exactly `true` (missing = off), so no code change is needed when it is added.
- Proposed `futureWording` `liveScores.nearLive` (privacy, next to `competitionPages.protectedPlayers`): "While a match is being scored, its event page shows the score as it stands, refreshed about once a minute. The score is entered point by point by Power Smash or by a scorer we have invited for that tournament. We record which account entered each point and when. Players are named on live scores under the same rule as on our competition pages; everyone else is shown as \"Protected player\". A live score is not a result: results count only once they are confirmed." (The middle sentence about invited scorers belongs with `organizerAccounts` from wave 4; drop it if that flag is still off.)
- G1 re-read checklist: add the sentence above and the "Live" rule.

### runtime-env.ts and SECRETS.md
- New runtime variable (server only, **not secret**): `LIVE_SCORES_ENABLED`. Exactly `true` switches the endpoint on (together with `features.liveScores`). Add it to `RuntimeEnv` and `NAMES`; the route already passes `getRuntimeEnv()` to `liveScoresServerOn` (`src/pages/api/live-scores/[event].ts`), so nothing else changes.
- No new secret. The endpoint reads with the **publishable** key, which is the public build variable `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (read through `src/config/env.ts`, inlined at build time); the URL is `SUPABASE_URL` or `PUBLIC_SUPABASE_URL` (runtime) or the baked build value. **Check on a preview** that `PUBLIC_SUPABASE_PUBLISHABLE_KEY` is set in the build job, or the switched-on endpoint answers 503 `unavailable`.

### src/lib/infra/vercel-routes.ts (not on the forbidden list, but shared: please make this change)
`NO_STORE_PATHS` forces `Cache-Control: no-store` on every `/api/*` route except `/api/placements`. Add `/api/live-scores/` to the exception, for example `'^/(?:api(?!/placements/?$)(?!/live-scores/)|go|cdn-cgi)(?:/.*)?$'`, and extend its test. Without it the route rule would overwrite the endpoint's `public, s-maxage=60, stale-while-revalidate=30` and every visitor's poll would reach the function and the database. Error answers already set `no-store` themselves.

**Cache facts are UNVERIFIED:** neither `docs/VERIFIED_FACTS.md` nor `docs/m3/vercel-facts.md` states how Vercel's CDN treats `s-maxage` and `stale-while-revalidate` on a function response (and whether a config.json route header replaces or merges with the function's own header). Verify on a preview: two GETs within a minute, the second should show `x-vercel-cache: HIT`, and the response must not show `no-store`. If Vercel needs it, `CDN-Cache-Control` or `Vercel-CDN-Cache-Control` are the documented alternatives (also unverified here).

### scripts/anon-harness.mjs
```js
  // 0021_live_scores.sql (D-113): the live state is denied; the live api view allows select only
  { name: 'match_live_state', pk: 'match_id', pkSample: NIL_UUID },
  { name: 'public_competition_live', pk: 'match_id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
```
RPC probes (must be refused for anon): `rpc/admin_live_score`, `rpc/admin_live_match_status`, `rpc/admin_set_live_scores` (also covered by part B of `0021_assertions.sql`).

### supabase/checks/0006_assertions.sql
Add `'public_competition_live'` to the allow-list array of later views (next to 0020's `public_registration_events`, `public_registration_payment` and wave 5's `public_international_events`), and the comment "0021 public_competition_live".

### tests (shared)
- `tests/supabase/bundle.test.ts`: the checks bundle must end with the LAST check file's ok row (`ok: 0021_live_scores assertions passed` while 0021 is last).
- `tests/admin/rls-matrix-schema.test.ts`: the api view count goes up by one for 0021 (plus the other waves' views).
- `tests/supabase/migration.test.ts`, `migrations-structure.test.ts`: pass once the harness rows above are in.
- `tests/competition-public/pages-source.test.ts` "the event page never claims a live score": its regex `/\blive\b(?!=)/` now matches the import path `components/competition/live/LiveScores.astro`. Proposed: test the page source with the `LiveScores` import line and element removed (and keep `live={false}` on the result scoreboards), and add: the only live element is `<LiveScores eventId={e.id} />`, gated by `features.liveScores` (`tests/live-scores/sources.test.ts` already pins the gate).

### CHANGELOG.md (proposed line)
- Wave 5 (off): near-live scores (D-113). Migration 0021 adds the scoring RPCs (rally, undo as a compensating tap, idempotent on the tap key, STALE on an old sequence; start, pause, resume, end writes an unconfirmed result), the owner's live switch and window, and the public view `api.public_competition_live`. New endpoint `/api/live-scores/<event-id>` (cached about a minute), a small script on event pages and the phone scoring console. Everything is off: `features.liveScores`, `LIVE_SCORES_ENABLED` and the owner's database switch.

### RUNBOOK.md (owner steps, plain English)
1. To show live scores: in the admin, Live scoring, "Turn live scores on"; the website switch (`features.liveScores`, after the lawyer's re-read) and `LIVE_SCORES_ENABLED=true` on Vercel (Production; a new deployment is needed) must also be on.
2. To stop at once: "Turn live scores off" in the admin (no deployment needed; visitors stop seeing scores within about a minute and a half, the cache time).
3. Scoring: open the match, choose who serves first, Start, then tap the side that won each rally. Undo takes back the last point. End the match when it is over, then confirm the result on the Results screen; only then is it on the website and does the winner move on.
4. With no signal at the court, keep tapping: taps wait in the app and are sent when the connection is back. Do not reload the page while taps are waiting (they are kept in memory only).

## 4. Proposed decisions (DECISIONS.md, for the owner or lead)
- **Three switches for live scores**: `features.liveScores` (legal), `LIVE_SCORES_ENABLED` (server) and the owner's `competition_settings.live_scores_public` (admin, instant off). All default off.
- **"Live" window = 5 minutes by default**, owner-adjustable 1 to 60 minutes; a point more than a minute in the future is not "Live" (clock skew).
- **Rallies are audited by the rally log itself**, not by one `audit_log` row per tap; undos, the first server, status changes and the setting are in `audit_log`.
- **Ending from the console records an unconfirmed result** (`result_source = 'scorer'`, also for the owner); confirming stays a separate step on the Results screen. A walkover is never recorded from the console.
- **The endpoint is addressed by the event id (uuid)**, not by the event code (`ms-u17` is unique only inside its tournament).
- **Waiting taps are kept in memory only.** Our Privacy Policy says the site stores nothing in the browser (`tests/legal/reality.test.ts`, `tests/admin/isolation.test.ts`), so the console does not use browser storage. `saveQueue`/`loadQueue` are ready if the owner and the lawyer later agree to a policy sentence ("the admin app keeps unsent scores on the scorer's device until they are sent"); then pass `storage={window.localStorage}` to `ScoringScreen` and update both tests' allow-lists.
- **Scorers see names by the stored age status** (owner sees all names; others see a name only for `adult_confirmed` in a non-junior event), the same rule wave 4 proposed for the competition screens.
- **No realtime subscription** (D-113): polling about every minute, only while the event has a live or paused match and the page is visible.

## 5. Test probes for the integrator (after wiring)
- Handler: owner token, `competition.liveScore` with a stale `expectedSeq` -> the STALE code with the database sentence in `errors.form`; same key twice -> 200 `duplicate: true`; an editor -> 403; body with an extra field -> 400 (strict schema).
- Endpoint on a preview with all three switches on and one fictional match scored: `GET /api/live-scores/<event-id>` -> 200, `cache-control: public, s-maxage=30, stale-while-revalidate=15`, `"isLive": true`; after `LIVE_SCORES_ENABLED` is unset (new deployment) -> `{"live": false}`; `GET /api/live-scores/ms` -> 400 `no-store`.
- Event page with `features.liveScores` on and a uuid event: the region is hidden until a match is live; `PS_E2E_LIVE_PAGE=<that page> npm run e2e -- tests/e2e/live-scores.spec.ts`.
- JS budget: the event page's live script is about 2 KB gzip (`tests/live-scores/client.test.ts` measures the esbuild bundle: 4,255 bytes raw, 1,961 bytes gzip on 2026-10-31); run `check:js-budget` on a build with the flag on.

## 6. Test results (my files, 2026-10-31)
- `npx vitest run tests/live-scores`: 8 files, 118 tests passed.
- `node scripts/with-lock.mjs heavy -- npm run check`: 0 errors, 0 warnings (3 hints, none in my files).
- Neighbouring suites (`tests/competition-public tests/competition-ui tests/competition tests/legal tests/supabase tests/admin tests/admin-ui tests/site tests/security tests/forms` with mine): 8 failures, all registry tests listed above (RLS matrix, anon harness, bundle last row, which also fail for 0019/0020 alone) plus the `pages-source` "never claims a live score" regex.
- Local SQL: see section 2.
