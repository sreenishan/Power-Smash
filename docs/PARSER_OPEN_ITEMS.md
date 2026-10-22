# PARSER_OPEN_ITEMS - what the M0 parser work could not settle

Written at the end of Milestone M0 (2026-10-21) from the parser worker's findings, `tests/fixtures/expected.proposed.json` (the `note`, `decision_pending` and `pending_fields` entries), `tests/fixtures/README.gold-seed.md` and the header comment of `src/lib/parser/types.ts`.

**This file lists open items. It decides nothing.** Each row says what conflicts, which decision or owner answer would resolve it, and who decides. M2b (`docs/BUILD_PLAN_PHASE1.md`, section c) must reconcile every row: close it with a recorded decision or owner answer (or a documented spec or plan correction), update the affected fixtures, and mark the row closed here.

**Privacy.** Fixtures are named by id only (`PF-001` to `PF-076`, in `tests/fixtures/titles.proposed.json`). No real title or player name appears in this file; the real titles stay in `tests/` of this private repository (D-012, D-017).

How the open items show up in the tests today:

- Nine fixtures carry `pending_fields` (PF-014, PF-025, PF-039, PF-041, PF-059, PF-063, PF-064, PF-065, PF-071). The comparison helper skips those paths, so they are not asserted until the item is closed. PF-041 is pending as a whole and its test is skipped (1 skipped test).
- The 147 intentional red tests (`npm run test:red`) fail only with "parseTitle returned NOT_IMPLEMENTED". None of the items below is the cause of a red test; they will matter when M2b turns the tests green.
- `Status` is `open` for every row on 2026-10-21.

Statuses of the decisions named below are as in `docs/DECISIONS.md` on 2026-10-21: D-012 and D-018 are "proposed - needs owner approval"; D-017 and D-033 are "adopted".

---

## 1. Needs an owner or lawyer decision

| ID | Fixture(s) | The conflict or gap | Resolved by | Who decides | Status |
|---|---|---|---|---|---|
| PO-01 | PF-014, PF-063, PF-065 (synthetic titles that carry a minor signal: an U-13 token with a junior category, "Sub Junior Girls Singles", "Under 15 Boys Singles") | The audit gives `review=N` for these (the parse is clean), but D-012 says a match with a **real minor signal** is held in review instead of being auto-published. The skeleton models the hold as a separate `minorHold` field and leaves it pending in the fixtures, so the pipeline must hold a match when `needsReview \|\| minorHold`. Whether and how the hold applies depends on the protected-mode decision. | D-012 approval, including the `minor_match_mode` and `unknown_match_mode` settings and the lawyer's view on legacy children's data | Owner, with a lawyer (D-012 status) | open |
| PO-02 | PF-064 | An "U-21" title: D-012's text says U-21 is **not** an age signal and the audit says `junior=false (owner to confirm)`, but D-012 is still proposed, so `ageSignals` and `minorHold` are pending. The fixture asserts only `ageGroup = U21`. | D-012 approval (the owner confirms U-21 is not a minor signal) | Owner, with a lawyer | open |
| PO-03 | PF-039 | A team tie (state against state) whose tournament text carries an under-15 token. The audit says both "ignored" and review for `TEAM_SIDE`; the skeleton models it as `team_tie` with no player rows and the `TEAM_SIDE` hard flag. Whether the under-15 token makes the video a held minor-related match (`minorHold`) is pending. | D-012 approval; D-018 for how team ties are shown | Owner | open |
| PO-04 | PF-059 | A title whose only country code is IND. PC-17 fixes the `INDIA_ONLY_CODE` hard flag, but whether such a title is treated as international and hidden is the owner's content-scope policy, so `isInternational` is pending. | D-018 approval (`hidden`, `listed_no_player_pages` or `public` for India-only coded and national events) | Owner | open |
| PO-05 | PF-041 (and PF-040 for the Tamil-only family) | A Tamil-script title that uses Tamil words for "versus" and "final". Without a reviewed Tamil vocabulary (PC-24) the title is a `non_match`; the whole expectation is pending and the test is skipped. The vocabulary is a small list of words that a native speaker must approve. | A native Tamil speaker's review of the vocabulary (OT-32), then the vocabulary recorded as data | Owner (native Tamil reviewer, OT-32) | open |
| PO-06 | Gold seed, all 70 entries in `tests/fixtures/gold-seed.real70.json` | Every label is a **proposed** first guess by Claude (`review_state: proposed`). 37 are marked high confidence, 19 medium and 14 low; 33 entries are `unsure` (fields most often unsure: players 21, tournament 14, format 13). Nothing counts as ground truth until the owner confirms or corrects it. | The owner's phone spot-check, about 10 titles at a time, `unsure` entries first (OT-35); `review_state` becomes `owner_confirmed` or `owner_corrected` | Owner | open |

---

## 2. Needs a spec or plan reconciliation by Claude in M2b

| ID | Fixture(s) | The conflict or gap | Resolved by | Who decides | Status |
|---|---|---|---|---|---|
| PO-10 | PF-022, PF-062 | **D-017's legacy mode contradicts the fixtures.** D-017 says: do not guess partner splits unless a doubles token is present and each side has exactly two tokens; otherwise `format = unknown` and `needs_review`. The fixtures expect a two-word name on one side to be ONE player and the format to be singles (spec A.3: format comes from player counts). D-017's title convention v2 is for **future** uploads; legacy mode must still parse legacy titles. | An amendment to D-017 (or to the fixtures) recorded in `DECISIONS.md` before M2b starts coding the format rule | Claude proposes; the owner is asked only if the change alters what is published | open |
| PO-11 | PF-001, PF-002, PF-062 | The audit's review lists for these fixtures omit `NO_ROUND`, `NO_YEAR` (and, for PF-062, `NO_CATEGORY`). PC-03 charges them, so the derived scores differ from the audit's partial lists (for example 35 and 40 for the two truncated titles). The fixtures follow PC-03. | Correct the audit's review lists for these fixtures (the PC-03 and PC-26 rows in `SPEC_AUDIT.md` section 5 name them) so the audit and the fixtures agree | Claude | open |
| PO-12 | PF-040 (and PF-041) | **`NO_LATIN_KEY` is an invented hard flag.** The audit expects `review=Y` for a Tamil-only name, but PC-03's hard-flag list has nothing for it and `SINGLE_TOKEN_NAME` twice scores 90 (no review). The skeleton added `NO_LATIN_KEY` as a 14th hard flag (`HARD_FLAGS` in `types.ts`) because no pinned transliteration exists, so no slug and no `latin_key` can be made (D-017: Tamil slugs are entered by hand). | Confirm `NO_LATIN_KEY` and add it to PC-03's list in `SPEC_AUDIT.md` and D-017, or replace it with another rule and change the fixtures | Claude proposes; the lead confirms | open |
| PO-13 | PF-057, PF-049 | PF-057 keeps the city abbreviations CBE and MDU as `affiliationHint`. If the districts table (PC-28) seeds them as aliases of Coimbatore and Madurai, the expectation changes to a district hint. PC-17 and PC-28 also say these abbreviations are not country codes. PF-049 needs the alias for Trichy in the same table. | Decide the contents of the seeded districts table (38 districts and their informal spellings), then update PF-057 or PC-28 | Claude proposes; the owner confirms the alias list (it is data) | open |
| PO-14 | PF-071 | A title with a "LIVE" marker, a finals-day text and a court number. The audit says `type = live`; D-033 (adopted) makes live status API-driven (`liveBroadcastContent`) and the fixture supplies no context. Whether a title-only "LIVE" marker classifies as live is not stated, so `videoType` and `liveStatus` are pending. The junk-tournament guard (no tournament made from "Finals Day" or "Court 1") is asserted. | Clarify D-033 (or add a title-only rule), then give the fixture a `ParseContext` or update its expectation | Claude | open |
| PO-15 | All fixtures with a hard flag (for example PF-001, PF-051) | PC-03's text says a hard flag forces review whatever the score, but does not say that it also subtracts points. The skeleton subtracts 30 points per distinct hard flag (`HARD_FLAG_PENALTY_POINTS`) so the score stays in step with risk in the review queue, and the expected scores in `expected.proposed.json` depend on it (PF-051's "exactly 70 points" matches this rule). A score of exactly 70 with no hard flag is not reviewed ("below 70"). | Record the 30-point rule in PC-03 or D-017, or change the constant and the fixtures | Claude | open |
| PO-16 | PF-021 (and the normalise and identity tests) | A hyphenated name is counted as ONE token for the identity tier (judged safest, because such names are common given names and must not be linkable). The audit only requires that the hyphen is not the " - " separator and that the key folds it to a space. | Record the one-token rule in PC-01 or PC-12 or D-013 | Claude | open |
| PO-17 | PF-014, PF-063, PF-065, PF-039 (see PO-01) | The two-field model (`needsReview` for parse quality, `minorHold` for a real minor signal) is the skeleton's choice; D-012 says only "held in review". After D-012 is decided, the wording in D-012 and D-017 must describe the same model the code and fixtures use. | Align the D-012 and D-017 wording with the model, after PO-01 to PO-03 are decided | Claude | open |
| PO-18 | PF-001, PF-002 | For a title cut off by the channel view, the skeleton sets `tournamentLinkPolicy = blocked` (the tournament text cannot be trusted). PC-03 makes `TRUNCATED_TITLE` a hard flag but says nothing about tournament linking. | Record the rule in PC-03 or PC-11 | Claude | open |
| PO-19 | `tests/fixtures/real-titles.unconfirmed.json` (19 titles) | 4 titles are not byte-exact and 15 have a single capture, so none is used in a test or in the gold seed. They become usable only after they are re-fetched from the API or RSS. The gold set also grows from 70 to 150-200 titles after the backfill. | M2a backfill supplies the byte-exact titles; extend the gold set with the same schema | Claude (the owner then spot-checks the new labels, PO-06) | open |

---

## 3. Cosmetic

| ID | Fixture(s) | The conflict or gap | Resolved by | Who decides | Status |
|---|---|---|---|---|---|
| PO-30 | PF-025 | The audit writes single-letter names as "A" but the initials rule (spec A.3, PC-12) renders a lone initial as "A.". `displayName` is not asserted for this fixture (listed in `pending_fields`). | Choose the rendering and update the audit wording or the fixture | Claude | open |
| PO-31 | PF-006, PF-032 | The audit says `review = Y or N` (PF-006) and `N or Y per NO_TOURNAMENT policy` (PF-032). PC-03 settles both: PF-006 scores 90 (no review) and PF-032 scores 50 (review). Nothing is pending in the tests. | Update the audit wording to the settled values | Claude | open |
| PO-32 | PF-015 | `nameKey` has the format `karthik\|s` (words, a bar, initials) in this module. The audit only requires the key to equal the key of the other spelling of the same name (PF-014). | Document the key format in `normalize.ts` and PC-12 | Claude | open |
| PO-33 | PF-027 | The audit says "notes court=3". The parser output has no court field, so it is not asserted; "#3" is not a hashtag and `signals` stays empty. | Decide whether a court field is wanted; otherwise reword the audit | Claude | open |
| PO-34 | PF-037, PF-069, PF-074 | PF-037: the audit lists the matched compilation keywords, only the reason is asserted. PF-069: a short clip with "vs" is modelled as `videoType short`, `kind non_match`, reason `SHORT_FORM`; the audit only says "short, not a match page". PF-074: `matchKey` is opaque and the test only compares two keys. | Note the modelling choices in `types.ts` and the audit rows | Claude | open |

---

## Where each group goes next

- Section 1 items are the owner's questions. They are listed in the M2 "Owner must supply first" text of the build plan and travel with D-012, D-018, OT-32 and OT-35. Until they are answered the build supports every option through settings (BUILD_PLAN, M2), and the fixtures keep the affected fields pending.
- Section 2 items are closed by Claude in M2b, before the parser code for each rule is written, by editing `DECISIONS.md` (D-012, D-017, D-033) and `SPEC_AUDIT.md` section 5 and then the fixtures.
- Section 3 items are tidied in the same pass.
- When every row is closed, the `pending_fields` and `decision_pending` entries in `expected.proposed.json` are removed, the skipped PF-041 test is enabled (or stays skipped with the Tamil vocabulary still unreviewed, said plainly), and this file is replaced by a one-line "all closed on <date>" note.
