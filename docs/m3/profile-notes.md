# Catalogue profiler notes (2026-10-22)

Built: `scripts/profile-catalogue.ts` (loads `src/lib/profile/cli.ts` through jiti, because parser imports have no file extensions), `src/lib/profile/{input,shape,stats,analyse,render,gold,cli}.ts`, `tests/profile/profile.test.ts` (20 tests, GREEN), `tests/fixtures/profile-synthetic/` (all invented: videos.json, titles.txt, feed.xml, takeout-like.csv), `docs/PROFILING.md`.

## For the lead
- Add to package.json (not edited by me): `"profile": "node scripts/profile-catalogue.ts"`. Run: `npm run profile -- <input> --out tmp\profile`. Needs jiti (already used by write-archive-redirects.mjs).
- The tool reads the parser as `parseTitle(title, ctx)` and defines DoD 1 as auto-accept / match-style (match or team_tie, type match, not international), auto-accept = not (`needsReview || minorHold`). If DoD 1 is defined differently (for example international counted), change `analyse.ts`.
- Output guard: refuses an out folder inside the repo unless under `tmp\`. The default report holds no title, player name or tournament name (tested); `--show-titles`, `--gold-sample` and `--convert` write real titles, only to a folder passing the same guard.
- Takeout CSV columns are NOT verified (no network): header-name matching, loud failure when no title column.
- Not modelled: SHORT_UNCERTAIN, AMBIGUOUS_ALIAS (see PROFILING.md).
- Observation from the synthetic run: a slash-less doubles title ("A B C D vs E F G H MD Final") parses as `NO_SEPARATOR, NAME_TOO_LONG`, format `unknown`, so the "slash-less doubles" count reads the category or the word Doubles, not `format`.
