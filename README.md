# Power Smash

Website, admin console and automation for **Power Smash**, a Tamil Nadu badminton media brand ([YouTube @PowerSmash](https://www.youtube.com/@PowerSmash)). It turns the channel's tournament archive into searchable player, match and tournament pages, and sells coverage, sponsorship and player products from one simple admin console that the owner can run from a phone.

**Status (2026-10-21): Phase 1, milestones M0 and M1 built (hosting moved from Cloudflare to Vercel on 2026-10-22, D-097); M1 has had its review-fix wave.** There is no public site yet: the strict release build refuses while owner inputs are missing (see `docs/OWNER_TODO.md`), and the deploy step in `deploy.yml` is still a stub. The Windows 10 smoke-test gate (G0, `docs/DECISIONS.md` D-003) **passed** on the owner's PC (local checks only; `docs/G0_RESULT.md`). Still pending: the real publish from GitHub, the Lighthouse speed check (both need the Vercel account and project, OT-02) and Playwright's browser download (about 500 MB, needs the owner's approval). Nothing has been committed yet; the owner chooses the git identity first (D-038). This repository is **private**: `tests/fixtures/` holds real players' names (some possibly under 18) taken from public video titles, so the repository must never be made public and those files must never be copied into seed data, previews or screenshots.

## Stack

Astro 7 (TypeScript strict) with Tailwind 4 and small React islands, on Vercel (the `@astrojs/vercel` adapter: prerendered static pages plus a few on-demand Node functions in the Mumbai region `bom1`; Pro plan needed for the live commercial site, owner purchase); Supabase (Postgres, Auth, Storage) in Mumbai; GitHub Actions for CI, sync, backup and deploy; Cloudflare only for Turnstile, optional Web Analytics and email forwarding. The full picture and the reasons are in `docs/DECISIONS.md` (D-097 for the host, D-001 to D-011 for the rest; D-001 is superseded).

## Requirements

- Node 24 (see `.nvmrc`; `package.json` allows `>=22.22.0`) and npm 11 (the 7-day package-age rule in `.npmrc` needs a recent npm).
- git.
- No Docker (it is never installed on the owner's PC, D-004). No Supabase local stack.
- Windows 10 note: the old Cloudflare tooling (wrangler, workerd) was proven on this PC at gate G0 (2026-10-21, `docs/G0_RESULT.md`), but it is no longer the host (D-097). Builds for release run on Vercel or GitHub Linux machines; whether the Vercel CLI runs on Windows 10 is unverified (VF-V7). The dev PC is slow (2 cores, 8 GB RAM): a full build is slow, so use the heavy lock below.
- The project path contains a space (`C:\Users\Admin\Desktop\Power Smash`). Quote it in every shell command.

## Run it

```
npm ci                  # install exactly what package-lock.json says (install scripts are off)
npm run dev             # development server (Astro default: http://localhost:4321)
npm run build           # NON-STRICT developer build into dist/ (reports placeholders, never blocks)
npm run build:strict    # the release gate (PS_STRICT=1): fails on any TODO(owner), private data or missing release variable
npm run preview         # serve the build locally
npm run check           # astro check (type check)
npm run check:js-budget # first-party JavaScript per built page (gzip, 81,920 bytes) - run after a build
npm test                # tests that must pass (green)
npm run e2e             # Playwright phone-size checks (needs a fresh build; run under the heavy lock)
npm run pg:local -- start|apply|check|stop   # portable local PostgreSQL, fictional data; one user at a time, always stop it
```

`npm run build` is for development: it prints a "NON-STRICT" notice on its first and last line. Only `npm run build:strict` is a release build, and it is the only build `deploy.yml` runs. It needs the six `PUBLIC_*` release variables (names in `.env.example`) and fails today on purpose until the owner supplies the missing inputs. Never call `astro build` directly: the headers step in `npm run build` would be skipped.

Heavy commands (builds, type checks, measuring runs) take a shared lock so two sessions never run them at once on the slow dev PC: `node scripts/with-lock.mjs heavy -- npm run build`.

Local configuration: copy `.env.example` to `.env` for the public build variables and to the local env file named in `docs/SECRETS.md` for server settings, using **development-project values only**. Both files are git-ignored. Read `docs/SECRETS.md` before putting anything in them. Secret values are entered only by the owner (on the vendor's screen or with the loader at the PC); Claude Code never sees, types or pipes them.

Do not run `npm install <package>` casually: every dependency is pinned exactly and `typescript` must stay on 6.0.x (TypeScript 7 breaks `astro check`). Dependency changes are made deliberately and the lockfile diff is reviewed (D-002).

## Test it

```
npm run check       # astro check (type check): 0 errors expected
npm test            # vitest run: only the tests that must be green (about 2,240 pass at the M1 review fixes)
npm run e2e        # Playwright against scripts/serve-output.mjs on port 4399 (starts and stops it itself)
npm run test:watch  # vitest in watch mode

# The build-output tests (hidden sections, every internal link resolves) read .vercel/output/static and skip without it:
npm run build
PS_REQUIRE_DIST=1 npx vitest run tests/build
```

On Windows PowerShell set the variable first: `$env:PS_REQUIRE_DIST = "1"; npx vitest run tests/build`.

**`npm test` is green.** The title parser (M2b) is implemented; the former test-first RED files are ordinary tests and `test:red` is only a leftover alias. Playwright (`npm run e2e`) and the local PostgreSQL (`tools/pg/`, git-ignored) were installed on 2026-10-22 with the owner's approval; Lighthouse is not set up yet. The build also writes the removed-archive-address redirects (`tmp/archive-redirects.json`) and merges them into `.vercel/output/config.json` in the headers step.

CI (`.github/workflows/ci.yml`) runs a secret scan (gitleaks), then `npm ci`, `npm run check`, `npm test`, `npm run build`, the placeholder, privacy and release summaries (secret-shaped values fail the run), `npm run check:js-budget` and `PS_REQUIRE_DIST=1 npx vitest run tests/build` on every pull request and every push to `main` (not `test:red`). GitHub's own secret scanning is not available on a private repository on the Free plan, so gitleaks is the safety net; never make the repository public to get scanning. Production deploys happen only from `deploy.yml`, never from a laptop (D-008), and that workflow runs only the strict build on `main` and stays switched off until the Vercel project exists (OT-02), Pro is active for a real launch (D-097) and the owner sets `DEPLOY_ENABLED` (OT-48).

## Where things live

| Path | What |
|---|---|
| `power-smash-website-spec.md` | The product and technical specification (v1.0). Section 0 holds the rules for Claude Code. |
| `CLAUDE.md` | Short guide for Claude Code sessions: commands, conventions, rules. |
| `docs/BUILD_PLAN_PHASE1.md` | Milestones M0 to M4, gates, risks, what Claude Code will not do without asking. |
| `docs/DECISIONS.md` | Decision records D-001 to D-097 (where the plan departs from the spec, and why; D-097 moves hosting to Vercel). |
| `docs/VERIFIED_FACTS.md` | Third-party facts and pinned versions, with sources and dates. |
| `docs/SPEC_AUDIT.md` | Spec audit findings and the parser corrections PC-01 to PC-30. |
| `docs/OWNER_TODO.md` | What the owner has to do, in order, in plain English. |
| `docs/SECRETS.md` | Where each secret lives, who may see it, rotation, and what to do if one leaks. |
| `docs/YOUTUBE_POLICY_QUERY_DRAFT.md` | Draft written question for YouTube about the developer policies (not sent). |
| `docs/G0_RESULT.md` | Evidence for gate G0 (Windows 10 smoke test, build times, file counts, cron limits); describes the Cloudflare plan that was replaced by Vercel (D-097). |
| `docs/m3/` | The Vercel move: research (`vercel-facts.md`), the coupling inventory and the port workers' notes. |
| `docs/PREVIEW.md` | How the owner opens the private preview on a phone (Vercel login). |
| `docs/BRAND.md`, `docs/brand-preview.html` | Brand kit notes (colours, contrast results, fonts) and the page where the owner looks at the logo and taglines (OT-23). |
| `docs/m1/` | Milestone M1 worker notes and the review-fix notes (`fix-*-notes.md`), the lead endpoint contract (`leads-api.md`) and `third-party-integration-facts.md`. |
| `docs/legal/` | Lawyer briefing pack, the G1 re-read checklist for the legal pages, and the two agreement drafts. |
| `docs/UPTIME_MONITOR_OPTIONS.md`, `docs/UPTIME_RUNBOOK_DRAFT.md` | Which free uptime monitor to use (owner decision) and the alert drill. |
| `docs/licenses/` | Licence texts for bundled fonts and icons. |
| `public/brand/` | Logo and brand SVG files (the PNG share image needs a converter tool the owner has not yet approved). |
| `src/`, `scripts/` | Site code (money pages, forms, the lead and event endpoints under `src/pages/api/`, `/go`, legal pages, the parser skeleton in `src/lib/parser`) and the Node scripts (build and release gates, the owner-run helpers, G0 measurements, brand checks). |
| `.env.example` | Every environment variable name, grouped by where it is set. Names only. |
| `tests/fixtures/` | Parser fixtures (private repository only). See its README. |
| `.github/` | CI, deploy workflow (Vercel) and Dependabot configuration. |
| `CHANGELOG.md` | What changed, newest first. |

Still to come (not written yet): `docs/OWNER_GUIDE.md` and `docs/RUNBOOK.md` (M4) and the rest of `src/` as milestones M2 and M3 are built. `supabase/` holds the migrations and their check scripts; the SQL has not yet been run on a real Postgres (see `docs/m1/fix-backend-notes.md` section 6).

## Rules that apply to everyone who touches this repo

- No secret value in any file, commit, issue or chat. Names only. See `docs/SECRETS.md`.
- No commit, push or pull-request merge without the owner's clear yes.
- Never invent prices, statistics, testimonials, sponsor names, addresses or URLs. `TODO(owner)` markers are allowed in docs and drafts, never on a public page.

## Licence

Not set. The repository is private and no licence has been granted.
