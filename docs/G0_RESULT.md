# G0 RESULT - Windows 10 smoke test (milestone M0)

> **2026-10-22 note (D-097):** hosting moved from Cloudflare Workers to Vercel. This file is the evidence for the retired Cloudflare plan (wrangler, workerd, Workers file and cron limits); it stays as the record of what was tested on the owner's Windows 10 PC. The Windows 10 result still holds for Node, Astro, Vite and the test tools; it says nothing about the Vercel CLI (unverified, VF-V7).

Run on 2026-10-20 (follow-up checks 2026-10-21) on the owner's PC: Windows 10 Pro build 19042, Intel Core i3-4030U (2 cores, 4 threads), 8.1 GB RAM, Node 24.20.0, npm 11.19.0. The project folder path contains a space (`C:\Users\Admin\Desktop\Power Smash`) and nothing was moved. The PC was shared with other workers during the runs, so times are indicative, not lab figures.

## Plain English summary (for the owner)

**Verdict: PASS.** The tools Cloudflare says are "not supported" on Windows 10 (Wrangler and the workerd engine) in fact ran fine on this PC. No fallback was needed.

- The local test site starts in about 30 seconds and stayed up and answering for more than 60 seconds (checked every 5 seconds, no failures).
- The site build finished every time, including a stress test of 15,000 pages. With the faster build mode (called `node`) it takes about 1.5 minutes and under 1 GB of memory. With Cloudflare's own mode (called `workerd`) it takes about 14 minutes and about 1.5 GB. Both worked; the fast mode is now the default.
- The "dry run" of the deploy (everything except actually uploading) worked without logging in to anything.
- Type checking (`astro check`) and the unit-test tool both run. One extra small development package (`@types/node`, type definitions only) had to be added so type checking could pass.
- Nothing needed Docker, WSL, a Windows upgrade or any change to your system settings.

**One finding for the plan, in plain words.** Every page becomes one file. 15,000 pages made about 15,000 files, which is 75% of Cloudflare's Free limit of 20,000 files, and above the plan's own safety line (warn at 10,000, fail above 14,000). So the plan's file budget is really a page budget. Your real catalogue is about 1,900 videos, so the stress test is far beyond what is expected, but the count must be watched as players and tournaments pages are added (details in "What the file count means" below).

**Still open (not failures):**
- A real hello-world deploy from GitHub Actions: needs your Cloudflare account (OT-02) and a GitHub repository. Not attempted.
- Playwright smoke test: needs a 500 MB browser download, which needs your approval. Not attempted.
- Lighthouse on Node 24: not run (it needs that browser). Not attempted.
- Build time on a GitHub Actions runner: needs the repository. Not measured.

## Evidence

All numbers below come from `scripts/g0-measure.mjs` (it samples the working-set memory of the whole process tree, node plus workerd plus helpers, about once a second using `wmic`) and from the command exit codes. Raw JSON of each run was kept in the git-ignored `spike/` folder.

### Step 1 and 2: skeleton, `astro dev`, `astro preview`

| Check | Command | Result |
|---|---|---|
| Install scripts | none run (`.npmrc` `ignore-scripts=true`) | `esbuild.exe` 0.28.2, `workerd.exe` (version 2026-10-06) and `sharp` all start without any `npm rebuild`. Allow-list needed: **none**. |
| `astro dev`, prerender `workerd` (adapter default) | `node scripts/g0-dev-check.mjs --mode dev --hold 60` | exit 0. Banner "ready in 26.3 s" (first run 29.4 s); `/`, `/g0/1/`, `/api/health` all HTTP 200; held 62.5 s, 25 checks, 0 failures; peak memory 974 MB (node 719 MB, workerd 168 MB). Server stopped, no process left. |
| `astro dev`, prerender `node` | same, default config | exit 0. Ready in 30.2 s; held 62.5 s; 27 checks, 0 failures; peak 1,200 MB (node 946 MB, workerd 157 MB). |
| `astro preview` after build | `node scripts/g0-dev-check.mjs --mode preview --hold 20` | exit 0. Ready in 12.3 s; all 11 checks HTTP 200; peak 572 MB. |
| workerd on Windows 10 build 19042 | all runs above | Runs. No crash, no hang in about 10 separate dev, preview, build and dry-run sessions. |

`/api/health` returned `{"ok":true,"service":"power-smash","route":"/api/health"}` (the one `prerender = false` route, run inside workerd).

### Step 3: `astro build` matrix (`NODE_OPTIONS` was never set; no out-of-memory happened)

`prerenderEnvironment` exists in `@astrojs/cloudflare` 14.3.4 (type `'workerd' | 'node'`, default `'workerd'`; confirmed in `node_modules/@astrojs/cloudflare/dist/index.d.ts`). Pages come from one `getStaticPaths` over an in-memory array (no per-page files on disk).

| Pages | Prerender | Exit | Wall time | Peak memory, whole tree | Largest single process | Lowest free system RAM seen |
|---|---|---|---|---|---|---|
| 8,000 | workerd | 0 | 482.6 s (8 min 3 s) | 1,236 MB | node 573 MB, workerd 566 MB | 2,476 MB |
| 8,000 | node | 0 | 89.0 s | 671 MB | node 583 MB | 3,197 MB |
| 15,000 | workerd | 0 | 859.8 s (14 min 20 s) | 1,455 MB | node 567 MB, workerd 829 MB | 2,379 MB |
| 15,000 | node | 0 | 97.3 s | 754 MB | node 667 MB | 3,235 MB |

So `node` prerender is 5.4 times faster at 8,000 pages and 8.8 times faster at 15,000 pages, and uses about half the memory. workerd prerender memory grows with page count (566 MB to 829 MB in workerd); node prerender barely does. Static output of both modes for the same pages was byte-identical (`diff -r` of `dist/client`, 20-page build).

Output size (counted by `scripts/g0-count.mjs`; limit is 20,000 static files per Worker version on the Free plan, VF-A10):

| Pages | Files in `dist/client` | Of which uploaded as assets | Share of 20,000 | Size | `dist/server` | Total in `dist/` |
|---|---|---|---|---|---|---|
| 8,000 | 8,010 | 8,008 | 40.0% | 2.9 MB | about 15 files, 0.65 MB | about 8,025 |
| 15,000 | 15,010 | 15,008 | 75.0% | 5.5 MB | about 15 files, 0.65 MB | about 15,025 |

The 15,010 are 15,001 HTML files (15,000 generated plus the hello page), 7 logo and icon SVGs that another worker put in `public/`, and 2 config files (`_headers`, `.assetsignore`) that Cloudflare does not count as assets. (The first 8,000-page workerd build ran before those SVGs existed and shows 8,001.)

### Step 4: `npx wrangler deploy --dry-run` (Wrangler 4.150.0, no login asked, no network)

| Pages | Exit | Time | Peak memory | Worker bundle |
|---|---|---|---|---|
| 20 | 0 | 7.5 s | not sampled | 13 modules, 655.37 KiB; "Total Upload: 660.15 KiB / gzip: 172.02 KiB" |
| 8,000 | 0 | 72.4 s | 491 MB | same bundle (655.37 KiB; 660.15 KiB / gzip 172.02 KiB) |
| 15,000 | 0 | 153.3 s | 558 MB | 13 modules, 655.54 KiB; "Total Upload: 660.32 KiB / gzip: 172.10 KiB" |

Only binding: `env.ASSETS`. No KV namespace (`kv_namespaces: []`), because sessions are switched off. The Worker size limit is 64 MiB, so the bundle uses about 1%. Static assets are not counted in "Total Upload".
Gotcha: wrangler prints "Read 30012 files from the assets directory" for the 15,000-page build. That number counts directories as well (15,010 files plus 15,002 folders), so it is about double the real asset count. The real count that Cloudflare limits is 15,008.

### Step 5: Vitest and `astro check`

| Check | Command | Result |
|---|---|---|
| Vitest with its own config (no Cloudflare plugin, D-002) | `npx vitest run scripts/g0-smoke.test.mjs` | exit 0, 3 of 3 tests pass, 0.5 s |
| Whole `npm test` | `npm test` | exit 1 on the final run: 817 tests, 669 pass, 147 fail, 1 skipped. Every failure is in `tests/parser/fixtures.red.test.ts` and `tests/parser/real-titles.smoke.test.ts`, the parser worker's test-first files that are labelled RED on purpose ("parser lands in M2b"). An earlier run also had 3 files that could not load while a fixture file was still being written. Not a G0 or Windows problem; the lead decides how the default `npm test` should treat RED tests (for example a separate script or an exclude until M2b). |
| `astro check` on TypeScript 6.0.3 | `npm run check` | First run exit 1: 5 errors "Cannot find name 'process'/'node:fs'" because `@types/node` was not installed. After adding `@types/node` 24.19.2 (devDependency, exact pin): exit 0, 0 errors, 0 warnings, 1 hint (unused variable in `scripts/brand-logo.mjs`, not mine). 48.9 s, peak 841 MB. |
| `npm run build` (20 pages, both prerender modes) | `npm run build` | exit 0 in both (18.6 s node, 60.8 s workerd on a busy machine). |

### Step 6: PENDING (not attempted, by rule)

| Item | Status | Reason |
|---|---|---|
| Real hello-world deploy to workers.dev from GitHub Actions | PENDING | Needs the owner's Cloudflare account and API token (OT-02) and a pushed repository. Not deployed from this PC either (D-008). |
| Playwright smoke test | PENDING | Browsers are about 500 MB; needs the owner's approval. |
| Lighthouse on Node 24 | PENDING | Needs the browser above; run after approval. |
| Build timing on a GitHub Actions runner (VF-A24) | PENDING | Needs the repository and Actions. |

### Step 7: Cron Triggers on Workers Free (official docs, read 2026-10-20)

Source: https://developers.cloudflare.com/workers/platform/limits/ (Account plan limits table and CPU time table).

- Cron Triggers are available on Workers Free: the limit is **5 Cron Triggers per account** (Workers Paid: 250).
- CPU time per Cron Trigger invocation: **10 ms on Free** (Paid: 30 seconds for a schedule under 1 hour, 15 minutes for 1 hour or more). Cloudflare counts CPU time as time spent running code, so waiting for a network reply should not eat it (not re-tested here), but any parsing must stay tiny.
- Free-plan limits that also apply: 100,000 requests a day, 50 subrequests per invocation.
- https://developers.cloudflare.com/workers/configuration/cron-triggers/ says changes can take up to 15 minutes to propagate and cron expressions run on UTC; it does not itself state Free availability, which is why the limits table is the source. The pricing page https://developers.cloudflare.com/workers/platform/pricing/ does not say whether cron runs count toward the 100,000 a day; treat as unverified.
- Not tested in G0: the adapter's default Worker entry (`@astrojs/cloudflare/entrypoints/server`) exports only `fetch`. A cron needs either a custom entry file that exports `scheduled` plus `fetch` from `@astrojs/cloudflare/handler` (that path is exported by adapter 14.3.4), or a second small Worker. Decide at the milestone that builds the RSS detector (D-008).
- D-008 names two Worker crons (5-minute dispatcher, 10 to 15 minute RSS detector; the nightly deploy and 6-hourly sync run in GitHub Actions) and does not say where the dead-man switch runs, so 2 or 3 of the 5 are used. One cron expression can also serve both if the handler checks the time.

## What the file count means for the plan

- One page is one file (`dist/client/<route>/index.html`). File count is about pages plus 8 to 10, so the plan's budget is a page budget. At 15,000 pages the count (15,008 assets, 75%) is under the hard Free limit of 20,000 but above D-009's CI "fail" line of 14,000 (and above the 10,000 warning line). At 8,000 pages (40%) it passes.
- D-009's gate must count regular files in `dist/client` (the upload set), not "entries" and not `dist/server`. Wrangler's own "Read N files" message is about twice the real count and must not be used.
- Everything else that lands in `dist/` shares the same budget: the one JSON search index (D-010), fonts, `_astro` assets, sitemaps, favicons and the owner's later pages. Pagefind would add roughly one file per indexed page (VF-A12), which is why D-010 keeps players out of it.
- Page counts expected from the real catalogue are not known until M2 profiling (about 1,900 videos are expected). The 15,000-page run is a stress test and not a forecast. The decision for the owner arises only if the planned page total approaches 14,000: either drop low-value pages (D-013 tiers already do part of this) or move to Workers Paid (100,000-file limit, USD 5 a month minimum, D-036).

## Versions and doc discrepancies found

1. Installed Astro 7.3.8 and `@astrojs/cloudflare` 14.3.4 (the 7-day `min-release-age` rule), while D-002 and VF-A2 name 7.4.x and 14.4.x. Astro prints "New version of Astro available: 7.4.1". All G0 results are for 7.3.8 and 14.3.4; re-run the quick checks when the pins move.
2. `session: false` is accepted by Astro 7.3.8 (its config schema allows `false`), but the adapter docs page does not mention it. Without it the adapter adds an auto-provisioned `SESSION` KV binding. With it, the generated `dist/server/wrangler.json` has `"kv_namespaces": []`, so the deploy token needs no KV permission (this removes the KV-edit-scope risk written in D-001).
3. Cloudflare's own Astro guide (https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/) still shows an older setup: `main` pointing to `./dist/_worker.js/index.js`, an `assets` block, and a hand-written `public/.assetsignore`. Adapter 14 does not need those: the Astro docs value `"main": "@astrojs/cloudflare/entrypoints/server"` works, and the build writes `dist/server/wrangler.json`, a `.wrangler/deploy/config.json` redirect that `wrangler deploy` follows, and its own `.assetsignore`. The Cloudflare page also says the adapter sets `output: 'server'`; the build log shows `output: "static"`, `mode: "server"`.
4. `tsc` does not find Node types by itself under TypeScript 6.0.3: `@types/node` must be a devDependency or `astro check` fails on `process` and `node:` imports.
5. Wrangler's "Read N files" counts directories (see Step 4).
6. Wrangler officially supports Windows 11 only (https://developers.cloudflare.com/workers/wrangler/install-and-update/, "macOS 13.5+, Windows 11, and Linux distros that support glib 2.35"). It works here on Windows 10 build 19042, but that is not a support guarantee; keep the CI-built production path (D-008).
7. Astro and Wrangler print anonymous-telemetry notices. The G0 runs used `ASTRO_TELEMETRY_DISABLED=1` and `WRANGLER_SEND_METRICS=false` in the environment. `astro telemetry disable` writes a user-level setting, so it was not run; the owner or lead can decide.

## Reproduce

```
node scripts/g0-measure.mjs --label build-15000-node --env ASTRO_TELEMETRY_DISABLED=1 --env PS_G0_PAGES=15000 --env PS_PRERENDER_ENV=node -- npx astro build
node scripts/g0-count.mjs dist/client
node scripts/g0-measure.mjs --label dryrun --env WRANGLER_SEND_METRICS=false --env CI=1 -- npx wrangler deploy --dry-run
node scripts/g0-dev-check.mjs --mode dev --hold 60
node scripts/g0-dev-check.mjs --mode preview --hold 20
```

`PS_G0_PAGES` (default 20) sets the number of generated `/g0/<n>/` pages and `PS_PRERENDER_ENV` (`node` default, or `workerd`) selects the prerender runtime. The generated page route `src/pages/g0/[id].astro` and the hello page are throwaway skeleton pages (`noindex`, not public) and are removed when M1 starts.
