# M2b parser notes (2026-10-21)

`parseTitle` is implemented in `src/lib/parser/parse.ts` (tables in `vocab.ts`, version `1.0.0-m2b.1`). The 147 former RED tests are GREEN (146 pass, 1 skipped: PF-041, Tamil vocabulary, PO-05). `npm test`: 2,534 pass, 3 skipped. `npm run check`: 0 errors. No fixture expectation was changed (the audit and the fixtures agreed with each other, so nothing needed correcting).

## Files touched
`src/lib/parser/{parse,vocab,index}.ts` (new, new, narrowed), `tests/parser/{parse.edge,gold-scorecard}.test.ts` and `helpers/scorecard.ts` (new), header comments of the two former red test files, `vitest.config.ts` (RED_TESTS removed), `vitest.red.config.ts` (kept as a thin config so the `test:red` script still runs).

## Left for the lead (outside my ownership)
- Delete `vitest.red.config.ts` and the `test:red` script in `package.json`; update CLAUDE.md, README.md, CHANGELOG.md, BUILD_PLAN (rows 6a, M2b) and DECISIONS D-017 text that still say the tests are red.
- Mark the PARSER_OPEN_ITEMS rows below closed or still open (that file is not mine).

## Gold-seed agreement (70 real titles, labels still `proposed`)
Run `npx vitest run tests/parser/gold-scorecard.test.ts --silent=false`. Kind agreement 70/70. Per field (precision / recall): format 0.77 / 0.82, category 1.00 / 0.94, round 1.00 / 0.95, year 1.00 / 0.94, tournament 0.80 / 0.76, location 1.00 / 0.69, players 0.95 / 0.83, international 1.00 / 1.00, age group n/a / 0 (the two gold values are "senior" in a free-text tournament name, which PC-04 deliberately does not extract). 32 of 70 are non-matches; of the 38 match-style titles 13 auto-accept and 25 go to review (most because of NO_SEPARATOR, a bare first-name side, a team tie or INDIA_ONLY_CODE). These are agreement numbers with a first guess, not correctness: the owner's spot-check (OT-35) is what makes them ground truth.

## Decisions taken where the audit is silent
1. **Hyphenated names are one token** (PO-16 closed): `describeName` already did this; the fixtures rely on it.
2. **30 points per hard flag** (PO-15) is applied exactly as the M0 constants say; exactly 70 is not reviewed.
3. **`NO_LATIN_KEY`** (PO-12) is raised for any player without a Latin key unless the name is mixed-script (then only `MIXED_SCRIPT_NAME`, PF-042).
4. **Truncation** (PO-18): a title ending inside side B truncates that last player (policy `blocked`); a title ending inside the meta blocks the tournament link.
5. **Legacy split (PO-10)**: a slash-less side is ONE player (PF-022 stands). It is split in two only when a doubles token is present (a doubles category or the word Doubles), NO side has an explicit partner separator, and each side has exactly two name tokens (D-017). A side with more than three name tokens or 40 characters raises `NAME_TOO_LONG`, becomes `blocked`, and the format is `unknown`.
6. **VS (PC-06)**: any priority token (vs, vs., v/s, versus) is used when exactly one exists; two or more are `AMBIGUOUS_VS` (so a title with a team line and a player line stays unresolved and in review). A bare `v` needs exactly one candidate with two-plus-letter neighbours. A missing side is also treated as ambiguous (no invented players).
7. **No separator (PC-09)**: side B ends at the first category, round, age, year, tournament noun, `in`/`at`, an ALL-CAPS-to-mixed-case shift, or after 7 words; text before side A is cut after the last such word. `NO_SEPARATOR` is raised only when meta text follows side B with no separator (a score alone does not raise it; a ` - ` counts as a separator).
8. **Token acceptance (PC-04)**: tokens are accepted in a pure token part (a ` - ` or `|` piece made only of tokens), next to a category, or when unambiguous; "Final", "Semi", "League", "Group", "Open", "Senior", "Veterans", "Masters", "Bronze", "Mini" and a lone "F" are ambiguous. Two-letter category codes need bare letters (`M.S.` is not MS). Unambiguous minor words (U-n, Under n, Junior, Sub Junior, Youth, Cadet) are signals wherever they appear.
9. **Tournament** = the first leftover text in reading order (before side A, then after side B, then later segments); a leading ordinal is the edition; the last 19xx/20xx is the year; `2025-26` gives `seasonLabel`; dd/mm/yyyy is `playedOn`; ALL-CAPS or all-lower-case names are Title Cased. A known place as the LAST word of a longer name, or after a comma, is `locationHint` (a place in the middle, as in "Madurai District", is not, PF-004/028). A comma plus an all-caps code (", KBA") is dropped as an organiser.
10. **Team tie (PC-16)**: both sides are a state, district, known city or contain a team word (kings, shuttlers, XI ...), or a city ends the left text and a city is the right side.
11. **Gear and keywords** are checked only when a VS exists, gear first (PF-038 expects GEAR_VS). A title with no VS is `NO_VS` even if it says Highlights (PF-035).
12. **International**: any non-IND code, or a known event name (World Championship, All England, Singapore Open ...). IND-only codes raise `INDIA_ONLY_CODE` and leave `isInternational` false (PO-04 stays the owner's call). `SRI` is not a country code.
13. **Keys** `nameNormalized` and `latinKey` come from the display name, so `KP ARUN` and `K. P. Arun` agree (types.ts says so; the PF-017 fixture requires it). `nameKey` comes from the raw name (position-insensitive).
14. Shorts: `UUSH` playlist or RSS `/shorts/` link, otherwise duration at most 180 s with `#shorts` or no VS, otherwise `#shorts` alone. A short clip with a VS and no `#shorts` (PC-15 "goes to review") is NOT specially flagged: there is no hard flag for it in PC-03. Left open.

## Still open and why
- **Skipped test**: PF-041 (PO-05, Tamil words for versus and final need a native reviewer; the Tamil title is a `non_match` until then).
- **Pending fields kept as the fixtures declare** (PO-01 to PO-04, PO-14, PO-30): the parser emits the protective value for each (minor signals set `minorHold`; U-21 is no signal; IND-only is not international; a title-only "LIVE" is `other`; a lone initial renders "A."). They need the owner's D-012 / D-018 answers, not code.
- **Gold-seed gaps** (visible as the disagreements above): "senior" inside a free-text tournament name, trailing ", India", organiser prefixes ("SKM - ..."), a place at the START of a tournament name (PF-028 forbids the rule), and two VS tokens (kept ambiguous on purpose).
- PO-13 (CBE and MDU stay `affiliationHint`; the districts table in `vocab.ts` has no abbreviations), PO-19 (more titles after the backfill) and PO-06 (owner spot-check) are unchanged.

## Fix wave (review B2-1 to B2-5, 2026-10-22)
- **B2-1 / B2-2 (age, critical):** an age scan now runs over the WHOLE title plus hashtags (`scanAgeWords` in `parse.ts`): bracketed `(U15)` `[U15]` `(Junior)` `(Sub Junior)` `(Boys U15)`, prefix, trailing and unseparated ages, `U-15` `U 15` `U/15` `U.15` `15U` `15-U` `Under-15` `Under Fifteen` `Sub-Jr` `15 years` `15 yr old`, other-script digits (Arabic-Indic, Tamil), full-width letters, hashtags. Each is a real minor signal (players `minor_suspected`, `minorHold`). Bracketed ages are never stored as an affiliation and age words are removed from names. Words that look like an age but are unmapped (`Kids`, `School`, `Jr`, `Teenagers`, `U15A`, bare `Under`, Tamil junior/children words, listed only to fail closed, OT-32) raise the hard flag `UNKNOWN_AGE_TOKEN` (always reviewed) and now also make the players `minor_suspected` (they were `unknown`). `minorHold` stays false for them (smoke invariant).
- **B2-3:** a score anywhere after side B is peeled (text after it is kept as meta), and trailing or leading video words (live, replay, today, match, telecast, HD, full, video, stream) are stripped from names. A noise word in the MIDDLE of a name is not flagged (no suitable hard flag in PC-03): left open.
- **B2-4:** impossible dates are never stored (`playedOn` null, the text is removed, the year kept, leap years handled); a non start+1 season suffix (`2025-27`) leaves no stray text.
- **B2-5:** `parseTitle` parses at most 300 characters (`rawTitle` stays complete) and flags `TRUNCATED_TITLE` beyond that.
- Regression corpus: `tests/parser/age-corpus.test.ts` (44 minor, 10 unmapped, 5 adult controls, noise, date and cap cases; all synthetic). Gold-seed agreement is unchanged (same table as above). The admin Title check should also cap its input (outside my files).
- Unrelated failures seen in `npm test` during this wave (tests/archive/dist-leakage, tests/forms/validation) and 5 `astro check` errors are outside the parser files.
