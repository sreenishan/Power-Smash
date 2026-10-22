# M4 documentation worker notes

Date: 2026-10-22. No commit, no network, no real data. Files: `docs/OWNER_GUIDE.md`, `docs/RUNBOOK.md`, `docs/guide/*.png` (19), `scripts/guide-shots.mjs`, `tests/docs/owner-docs.test.ts`, this file. No other doc was edited.

## How the screenshots are made

`node scripts/with-lock.mjs heavy -- npm run build`, then `node scripts/with-lock.mjs heavy -- node scripts/guide-shots.mjs`. The script serves the built `dist/client` with `astro preview` on port 4398 (started and always stopped by the script), drives Chromium at 390x844 and writes `docs/guide/<name>.png`. It refuses to run when the build holds a Supabase address or any `wa.me` number other than the fictional `910000000000`; it aborts any request to a non-localhost address; nothing is typed into a form; no trace or video. The admin shots show the "Preview with made-up data" banner (the in-memory store). Run on 2026-10-22: 19 pictures.

Screenshots missing because the build has no such page: per-tournament posters (only `/posters/channel/` exists in the fictional build; no tournament pages), a match or player detail page (list pages only), the sign-in screen (the preview has no login), a Mark paid screen and a Title check screen (neither is built).

## Findings for other owners (not fixed here, outside my files)

1. **Admin Enquiries screenshot:** the status and type badges at the top of each enquiry card overlap (`src/admin/screens/Inbox.tsx` lines 84-86, `Badge` in `src/admin/ui.tsx`). Likely the `rounded-pill` utility or the flex wrapper; visible at 390 px. The guide mentions it in a caption; remove the caption once fixed and re-shoot.
2. **(Superseded 2026-10-22: Mark paid, video-submission review and Title check are now built and documented, with 22 screenshots; the enquiry badge overlap is also fixed.)** Earlier finding, **no Mark paid screen:** `validateMarkPaid` exists (`src/lib/pricing-admin/mark-paid.ts`) but nothing in `src/admin` calls it. The guide says so.
3. **No approve button for video submissions** and no "mark uploaded with YouTube ID" (spec 14 Submissions). The guide gives the manual route.
4. **No Title check screen** (D-017 says it ships in Phase 1; spec 14 lists it under Phase 2). The guide says Phase 2 / not built.
5. **`restore.yml`, the retention job, `erasure_log`, the 9-day backup-age alert and the English/Tamil breach templates are not built.** The runbook marks each.
6. `deploy.yml` deploy step is still a stub; the runbook says do not flip `DEPLOY_ENABLED` until it is real.
7. Title convention v2 is described from D-017 (double pipe, category and round tokens, at most one " - ", year last). Three invented example titles were run through the real parser with no hard flag and no review flag.

## Facts used and where they came from

Takedown targets 24 h, 7 d, 3 h, 48 h: D-014 (third-party summaries, lawyer confirms). CERT-In 6 hours and 180 days: VF-E8. DPDP 13 May 2027: VF-E1. E-Commerce Amendment Rules 1 January 2027: VF-E11. Gmail Send-as January 2027: VF-F4. ASCI and DoCA rules: VF-E12, VF-E13. Domain KYC: D-023, OT-07. Switch list: `docs/SECRETS.md` and `src/content/legal/status.ts`. Local PostgreSQL: `docs/m1/tooling-notes.md`. Nothing was verified against a live service; where a step has never run it says so.

## Open points

- The owner approves title convention v2 (D-017 asks); the guide presents it as the convention to use.
- RUNBOOK section 1 carries two `TODO(owner)` markers (deputy name, domain renewal date). They are in a doc, which is allowed; fill them when known.
- Re-shoot the screenshots after any admin or page change; the docs test checks only that the files exist, are PNGs and match the script's list.
