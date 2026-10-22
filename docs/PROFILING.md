# Profiling the real catalogue (BUILD_PLAN M0 item 5, DoD 1)

**Why:** after the first YouTube fetch we measure how many real titles the parser accepts on its own (DoD 1 asks for at least 90% of match-style titles) and how big the review queue will be. The tool reads titles, runs the real parser and writes a report. It never goes online and never writes into the repo.

## Step by step (owner or lead, at the PC)
1. **Get the titles.** Easiest: run the normal sync/backfill once (`docs/SECRETS.md` for the key) so the videos are in Supabase, then export the `videos` table as JSON (Supabase Studio, table `videos`, export). The tool reads the sync's own row shape (`title_raw`, `duration_s`, `published_at`, `type`). Or save the raw `videos.list` responses from the existing sync client as one JSON file. No key? The channel's RSS feed (`https://www.youtube.com/feeds/videos.xml?channel_id=<id>`, saved as a `.xml` file) holds only the 15 newest videos: fine for a smoke check, not for the DoD 1 number.
2. **Run it** (quote the folder: the path has a space):
   `node scripts\profile-catalogue.ts C:\path\to\videos.json --out tmp\profile`
   (the lead adds `"profile": "node scripts/profile-catalogue.ts"` to package.json; until then use the line above).
3. **Read** `tmp\profile\profile-report.md`. It has no titles or names.
4. **Send the lead** only the numbers from sections 1, 4 and 9 of that report (or the whole `profile-report.md`: it is counts only). Never send titles, the private file or the gold sample.

## Accepted input
| Input | How it is read |
|---|---|
| JSON array of strings | each string is a title |
| JSON array of objects, or `{ "items": [...] }`, or a list of such pages | YouTube-shaped (`snippet.title`, `contentDetails.duration`, `liveStreamingDetails`, `status.privacyStatus`), the sync's VideoRecord (`title_raw`, `duration_s`, `published_at`, `type`, `live_status`) or `{ "title": ... }`. Private and title-less entries are skipped |
| Text file | one title per line |
| `.csv` | needs a header with a column whose name contains `title` (`Video Title (Original)` wins over translated ones); `id`/`video id`, a `duration` column (milliseconds if the header says `ms`) and a `publish` column are used when found. The tool prints which columns it chose |
| YouTube channel RSS (Atom) XML | 15 newest; `/shorts/` links mark Shorts |
| Google Takeout "videos" CSV | read by the same header-name rule as `.csv`. **Not verified:** the official Takeout column names could not be checked offline, so none are assumed. If the title column is not found the tool stops and lists the columns it saw; rename a header to `title` and run again |

`--convert` turns any of these into one clean `videos.normalised.json` (real titles: tmp only).

## Options
- `--out <folder>` default `tmp\profile`. The tool refuses any folder inside the repo except under `tmp\` (git-ignored).
- `--show-titles` also writes `PRIVATE-titles-and-names.md` and `.json`: real titles, player names (possibly under-18) and tournament names, with examples for each review pattern. It prints a warning. Keep it on the PC.
- `--gold-sample N --seed S` draws N titles at random (stratified so rare kinds such as international or live are included; the same seed gives the same sample) to `gold-sample-seedS.csv`/`.json` for the OT-35 labelling. The `owner_*` columns are empty for you to fill. Real titles: tmp only.

## What the numbers mean
- **Match-style** = the parser says match or team tie, it is not a Short, not live and not international (international videos are hidden and never wait in the queue).
- **Held** = the parser wants a review, or a minor-player hold applies (D-012). **Auto-accept** = everything else.
- **DoD 1 number** = auto-accept / match-style, with a 95% Wilson interval (the honest range for this many titles). PASS only when the whole interval is at or above 90%; LIKELY PASS if only the middle is. **The review queue size** is the held count: that is what you will click through at launch.
- It does not include the sync's `SHORT_UNCERTAIN` or the later `AMBIGUOUS_ALIAS` reasons, so the real queue can be a little bigger.
- **Age:** the parser never confirms an adult, so every player starts protected (no profile page) until you confirm. The report shows how many players appear with a junior hint (`minor_suspected`) versus no age info (`unknown`).
- **Shapes** (anonymised patterns) replace letters with classes: `Aaaa` Capitalised word, `AAA` ALL CAPS, `aaa` lower case, `T` Tamil word, `9` a digit, `*3` three in a row. Words that are never names (vs, final, MS, cup...) stay readable.
- **What to fix first** ranks the ten commonest title shapes in the review queue, with the reasons, plus how much of the queue the ten cover. Fix the top one in the parser or the title habits, run again.
- Also reported: text before side A, doubles written without a slash, first-name-only players, tournament clusters (and series that may be split in two), name collisions, possible duplicate videos and near-identical names. Counts only by default; the names are in the private file.

Notes for the lead: tests use only invented titles in `tests/fixtures/profile-synthetic/`; code is `src/lib/profile/`; see `docs/m3/profile-notes.md`.
