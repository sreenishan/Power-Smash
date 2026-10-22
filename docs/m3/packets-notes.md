# Review packets notes

Files: `scripts/review-packets.mjs`, `docs/review-packets/TAMIL_REVIEW.md` (generated), `docs/review-packets/SPOTCHECK_HOWTO.md`, `tests/review-packets/review-packets.test.ts`.

- `node scripts/review-packets.mjs tamil` regenerates the Tamil packet from spec Appendix B and the Tamil words in `src/` (non-comment lines). `tamil --check` exits 1 if stale. The test fails when the packet is stale or a Tamil word in `src/` is missing, so a new Tamil string forces a regeneration.
- Today `src/` holds Tamil only in `src/lib/parser/vocab.ts` (13 age words, fail-closed list). No Tamil words for versus, rounds or categories exist (PO-05); the packet has empty rows for the reviewer.
- English glosses of the 13 age words in the script (`AGE_GLOSS`) are the developer's reading, labelled unverified in the packet. The Tamil reviewer instruction sentence is also marked "suggestion, unverified".
- The Appendix B Home H1 mismatch (Tamil = "Home of Tamil Nadu badminton", English = "on record") is flagged in row TB-01.
- `node scripts/review-packets.mjs spot-check` writes `tmp/spot-check/spot-check.html` from `tests/fixtures/gold-seed.real70.json`. The generator refuses any output folder inside the repo except `tmp/` (git-ignored). Tests use a synthetic mini seed. Export JSON holds taps and notes by title index, no titles.
- The how-to defers sharing of the answers file ("tell Claude when done") until the owner is told how to share it safely.
- Not touched: builds, gates, workflows, configs, DECISIONS/OWNER_TODO/CHANGELOG (lead to add a CHANGELOG line and an npm script if wanted).
