# tests/fixtures - provenance

**PRIVATE REPOSITORY ONLY.** Some titles below contain the names of real players, possibly under-18 players. Never copy these files into seed data, previews, screenshots, public repositories or the built site (see `docs/DECISIONS.md` D-017 and D-012).

| File | What it is | Origin |
|---|---|---|
| `real-titles.raw.json` | 70 real Power Smash video titles, a bare JSON array of strings | Captured from the channel's public RSS feed and channel pages on 2026-10-20 in two independent captures; every title here is byte-exact in both. Replace with API-sourced titles at the M2 backfill. |
| `real-titles.unconfirmed.json` | 19 real titles NOT confirmed byte-exact (4 differed between captures, 15 were seen only once) | Same capture. Do NOT use as parser expectations until re-fetched through the YouTube API. |
| `titles.proposed.json` | 76 proposed parser fixtures | From the parser audit. `origin` is `real-from-spec` for exactly 3 entries (the spec's Appendix A.5 titles) and `synthetic` for the other 73. Synthetic titles are invented for testing and must never be presented as real. |

The parser must pass `titles.proposed.json` and `real-titles.raw.json` (expected values for real titles are set after the M0 catalogue profiling and gold-set labelling; see `docs/BUILD_PLAN_PHASE1.md` M0 and M2b).
