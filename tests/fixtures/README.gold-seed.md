# Gold seed (proposed labels)

**PRIVATE REPOSITORY ONLY.** `gold-seed.real70.json` contains real players' names, possibly under-18 players. Never copy it into seed data, previews, screenshots, docs outside `tests/` or any web service (`docs/DECISIONS.md` D-012, D-017).

## What it is

`gold-seed.real70.json` holds **proposed** labels (by Claude, not yet checked by anyone) for the 70 real titles in `real-titles.raw.json`, matched by position (`index`; the title is repeated so drift is detected by `tests/parser/gold-seed.integrity.test.ts`). Per title: kind (match, non_match, team_tie), the players on each side, format, category, age group, round, tournament (series name without the year), year, location and `is_international`.

Rules used when labelling:

- Category only from an explicit token, never from names. Format only from player counts or an explicit doubles word.
- A side whose partner split the title does not decide has `split: "ambiguous"`, `players: null` and a list of `plausible_readings`.
- `confidence_of_label` is high, medium or low. `unsure: true` means a label field is a real judgement; `unsure_fields` and `unsure_reasons` say which and why. `risk_tags` record what makes the title hard to PARSE (first-name-only players, text before side A, slash-less doubles, two VS tokens, ...) even when the label itself is clear.
- Spelling is kept as written (typos are noted, not fixed). No title from `real-titles.unconfirmed.json` is used.

## How the owner checks it (OT-35)

About 10 titles at a time are sent to the owner's phone with the proposed label. The owner taps OK or corrects the wrong fields. Start with `unsure: true` entries. After a check, `review_state` changes from `proposed` to `owner_confirmed` or `owner_corrected`. Only confirmed or corrected entries count as ground truth.

## How it will be used

The parser is NOT compared with these labels yet. From M2b, a scorecard script compares `parseTitle()` with every `owner_confirmed` / `owner_corrected` entry, field by field (precision and recall per field), which is how the Definition-of-Done item 1 (D-017) is measured. Snapshots only detect change; the gold set measures correctness.

## How it will grow to 150-200 titles

After the API backfill (M2a) the full title list exists. The set is extended to 150-200 titles, stratified by upload year and by whether the title uses the double pipe, with the same schema; titles are taken from the API (byte-exact) and appended with new `index` values. The 4 not-byte-exact and 15 single-capture titles in `real-titles.unconfirmed.json` become usable only after they are re-fetched from the API. Priority for the extra labels: the most-viewed titles, because those are the ones the owner will review in the queue.
