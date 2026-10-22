# M1 Infra worker notes

Written 2026-10-21 by the Infra worker. Scope: BUILD_PLAN M1 items 4, 4a, 7, 8 (the build-output gates, security headers and CSP, `/go/[slug]`, the Web Analytics beacon, the backup workflow, the owner-run helper scripts, the uptime runbook draft). No secret value, real token, account, deployment or message was used or made. `DECISIONS.md`, `OWNER_TODO.md`, `BUILD_PLAN_PHASE1.md`, `VERIFIED_FACTS.md` and `CHANGELOG.md` were not touched: the lead consolidates from section 4 below.

## 1. What was built (files)

**Gates (item 7, item 4)**
- `scripts/check-placeholders.ts`: scans `dist/client` text files for the literal `TODO(owner)`. Strict (`--strict` or `PS_STRICT=1`) lists every hit as file:line:column and exits 1; normal mode prints a per-file summary and exits 0. Fail-closed on an output with no HTML page. Binary files are skipped. One explicit allowlist entry: a marker inside an XML comment of `brand/og-default.svg` (OT-23); a marker in visible text of that file, or in a comment of any other file, still fails. Lists hidden owner sections when pages carry `data-owner-hidden="<name>"` (informational).
- `scripts/privacy-scan.ts` + `scripts/lib/privacy-rules.ts`: phone numbers (Indian mobile in several formats, international), emails, secret shapes (Supabase secret key, JWT, Telegram token, Resend key, GitHub token, Google API key, age private key, PEM private key, database URL with password), the exact VALUES of private variables found in the environment, private field and secret-variable names, localhost URLs. Two severities: `critical` (secret shapes and secret values) fails EVERY build (D-027); the rest is a summary in a normal build and fails the strict build. Allowed through: only the official contacts, read from `PUBLIC_WHATSAPP_NUMBER` and from the string literals `phone`, `publicEmail`, `grievanceEmail` in `src/content/site.ts` (read as text; `null` allows nothing). Output shows file, line, rule and a masked sample, never a full value.
- `scripts/check-release.ts`: build variables (`PUBLIC_SITE_URL` https origin not localhost, `PUBLIC_ALLOW_INDEXING` exactly `true` or `false`, the six required public variables, no `workers.dev` canonical and no Cloudflare Turnstile TEST key when indexing is on, no secret-looking `PUBLIC_` name or value, optional `PUBLIC_CF_ANALYTICS_TOKEN` and `PUBLIC_HSTS_MAX_AGE` validated) and the build output (canonical links on the site origin, every page noindex unless indexing is on, home page indexable when it is, robots.txt agrees, file budget warn 10,000 and fail 14,000 per D-009, `_headers` has a CSP and stays inside the Cloudflare limits, `_redirects` under 1,800 lines). `--env-only` for a fast check before a build.
- `scripts/build-strict.mjs` (`npm run build:strict`): release check (env only), `astro build`, header finalisation, placeholder gate, privacy scan, release check on the output; the three last steps all run so one run shows every problem. `PS_STRICT=1` is set in Node, Windows-safe.
- npm scripts (the `scripts` section only): `build` now runs `scripts/build.mjs`, `build:strict`, `finalize:headers`, `check:placeholders`, `check:privacy`, `check:release`, `secrets:load`, `telegram:chat-id`, `age:keys`.
- `.github/workflows/ci.yml`: after the build it runs the three scans NON-strict (a secret-shaped value still fails). `deploy.yml`: strict build (`npm run build:strict`) when the repository variable `PS_STRICT` is `1` OR `PUBLIC_ALLOW_INDEXING` is `true`, otherwise the noindex preview build with the same three checks non-strict; passes the new public variables; the deploy step is unchanged and still a disabled placeholder.

**Headers and CSP (item 4)**
- `src/lib/infra/headers.ts` (pure): CSP builder, fixed headers, noindex rules, HSTS value, `applySecurityHeaders()` for Worker responses.
- `src/middleware.ts`: applies those headers to every Worker response (`/api/*`, `/go/*`, error pages). Never overwrites a header a route set.
- `public/_headers` (generated; a test fails if it drifts from the generator) and `scripts/finalize-headers.ts` + `scripts/lib/headers-file.ts`: after every build, `dist/client/_headers` (adapter rule first, then ours) is finalised: SHA-256 hashes of every inline script and style block of the built pages go into the CSP, `X-Robots-Tag: noindex, nofollow` goes on every page unless `PUBLIC_ALLOW_INDEXING` is `true`, the workers.dev noindex rule stays when it is, HSTS is added only when `PUBLIC_HSTS_MAX_AGE` is set, analytics hosts only when a token is set, the Supabase origin only when `PUBLIC_SUPABASE_URL` is set. Fails the build on an inline event handler or a line over 2,000 characters.
- `scripts/build.mjs`: `npm run build` = `astro build`, then the finalisation (see decision PD-2 for why it is not a `postbuild` hook).

**`/go/[slug]` (item 4)**
- `src/pages/go/[slug].ts` (on-demand, thin), `src/lib/infra/go.ts` (pure logic), `src/lib/infra/go-handler.ts` (request handling and Worker dependencies), `src/content/go-links.ts` (typed map and allowed host list, both EMPTY). 302 with UTM, 404 for unknown, malformed or expired slugs and for unsafe targets, bots and prefetch redirected but not counted, click row without raw IP or raw user agent, logged through `waitUntil`.

**Analytics (item 5 of the brief)**: `src/components/site/Analytics.astro` renders the Cloudflare Web Analytics beacon only when `PUBLIC_CF_ANALYTICS_TOKEN` is set (16 to 64 letters or digits), nothing otherwise.

**Backup (item 6)**: `.github/workflows/backup.yml` (weekly, disabled unless the repository variable `BACKUP_ENABLED` is `true`).

**Owner-run helpers (item 7)**: `scripts/load-secrets.mjs`, `scripts/telegram-chat-id.mjs`, `scripts/make-age-keys.mjs`, with `scripts/lib/secrets-file.mjs` and `scripts/lib/is-main.mjs`.

**Docs**: `docs/UPTIME_RUNBOOK_DRAFT.md` (item 8) and this file.

**Tests** (`tests/infra/`, 213 tests, 10 files, fixtures in `tests/infra/fixtures/`; secret-shaped strings are built at run time so none is committed): `check-placeholders`, `privacy-scan`, `check-release`, `headers`, `headers-file`, `go`, `go-handler`, `load-secrets`, `owner-helpers` (Telegram helper and age helper), `workflows`. Whole suite at hand-off: 57 files, 1,473 tests, all green; `astro check` 0 errors, 0 warnings.

## 2. What was proved by running it (2026-10-21, locked build)

- Normal `npm run build` passes and ends with `finalize-headers: 18 page(s) ... indexing OFF`; then `check:placeholders`, `check:privacy`, `check:release` all exit 0 (summaries only).
- `npm run build:strict` with no variables fails at step 1 listing the six missing variables, before any build.
- `build:strict` with fake production-shaped variables (indexing `false`, fake WhatsApp number) builds, finalises and then FAILS on the placeholder gate: **130 `TODO(owner)` markers in 18 files** (legal name, address, phone and email in the footer on every page; contact and legal pages; prices of every product and sponsor package on `/`, `/pricing`, `/partner`; the GST note, delivery times, travel policy, lawyer-review notes on the legal pages; owner approval of suggested inclusions and packages). `brand/og-default.svg` is reported as excused by the allowlist (its marker is inside an XML comment). The release check on the output passes (canonical links on the site origin, every page noindex, `_headers` fine).
- The same run's privacy scan allowed the official WhatsApp number everywhere it appears (83 matches, including every `wa.me` link) and reported exactly ONE hit: the example number in the lead form's validation message (see request R3). Nothing else.
- Headers of that build (read straight after it, because `dist/` is shared by all workers): `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, a CSP whose `script-src` is `'self'`, the page's inline-script hashes, `https://challenges.cloudflare.com` and (with a token) `https://static.cloudflareinsights.com/beacon.min.js`; `connect-src 'self'` plus `https://cloudflareinsights.com` (with a token) and the Supabase origin (when set); `frame-src` YouTube privacy domain and Turnstile; no `unsafe-eval`, no `unsafe-inline` for scripts or style blocks; `X-Robots-Tag: noindex, nofollow` on every page while `PUBLIC_ALLOW_INDEXING` is not `true`; with it `true` the global rule disappears and the workers.dev rule stays; `Strict-Transport-Security: max-age=300` only because the test run set it. The Astro Cloudflare adapter's `/_astro/*` immutable cache rule stays first and untouched (the `/*` rule sets no `Cache-Control`).
- A Windows finding that changed the design: `.npmrc` has `ignore-scripts=true`, and npm then skips every pre- and post- hook, so an npm `postbuild` entry never runs (observed: the first build left `_headers` unfinalised). Finalisation is therefore a step inside `npm run build` (PD-2).

## 3. Deviations from the brief or the plan

1. **`defer` on the beacon.** The vendor's current snippet is `type="module"` (deferred by nature). The tag has both; the CSP allows exactly the beacon file.
2. **`public/_headers` is generated**, not hand-written, and finalised after the build; the committed file is the fail-safe version (no inline code allowed). This is needed because Cloudflare's `_headers` cannot hold per-page hashes.
3. **`npm run build` changed** from `astro build` to `node scripts/build.mjs` (same build plus the finalisation). Direct `astro build` calls still work but leave `_headers` unfinalised; `check:release` fails strict if the CSP is missing.
4. **Extra gates beyond the brief** (cheap, D-009 and rule 9): file-count budget, canonical origin, noindex-on-every-page, robots.txt agreement, `_headers` and `_redirects` limits, Turnstile test-key refusal when indexing is on, PUBLIC_ secret check (docs/SECRETS.md promised it for M1), known-secret-value search.
5. **Allowlist is strictly the official contacts.** No example-number or example-domain exception was added to the privacy scan (see R3 for the one hit it causes).
6. **`/go` details the brief left open:** UTM never overrides a parameter the target already has; `partner` links use `utm_medium=sponsor`; a date-only expiry lasts through the end of that day in India; internal links carry no UTM; 404 (not a redirect to `/partner`) for unknown or expired slugs; HEAD requests are not counted.
7. **The first-party JavaScript size check (80 KB gzip, spec 12.5, listed in the M1 tests) belongs to no worker's list.** Not built here. It is a small script over `dist/client` (gzip the scripts each page loads); say if you want it.

## 4. Proposed decisions (for the lead to put into DECISIONS.md)

**PD-1 CSP is one header policy with build-time hashes.**
- Context: D-029 wants script hashes; static pages cannot use nonces; the Cloudflare adapter 14.3.4 does not write CSP headers (no `staticHeaders` feature); Astro's own `security.csp` emits a `<meta>` tag only (no `frame-ancestors`); `_headers` allows 100 rules and 2,000 characters per line.
- Decision: a single CSP header from `src/lib/infra/headers.ts`; the build adds the SHA-256 of each unique inline script and style block; Worker responses get a hash-less policy (on-demand HTML pages must not need inline scripts). Styles: `style-src 'self'` plus hashes, and `style-src-attr 'unsafe-inline'` so `style="..."` attributes work (they cannot run code); scripts: `script-src-attr 'none'`, so no inline event handlers.
- Consequences: about 30 distinct inline blocks fit in the line limit; the build fails above that or on an inline event handler (then switch to Astro's `security.csp` meta policy plus a smaller header). Tightening `style-src-attr` needs `build.inlineStylesheets: 'never'` (lead's `astro.config.mjs`) and no `style=` attributes in components.

**PD-2 Header finalisation is part of `npm run build`.** Context: `.npmrc` `ignore-scripts=true` makes npm skip pre/post hooks. Decision: `npm run build` runs `scripts/build.mjs`; never rely on `postbuild`. Consequence: anyone calling `astro build` directly gets an unfinalised `_headers` (the strict release check catches it).

**PD-3 Two deploy build modes.** Strict gate when `PS_STRICT` is `1` or `PUBLIC_ALLOW_INDEXING` is `true`; otherwise a noindex preview with non-strict gates. Context: `<Todo>` text is in every build (hard rule 8b), so a strict gate on every deploy would stop the owner's phone review on workers.dev before G1. Consequence: a build that search engines may index can never skip the gate; the owner sets `PS_STRICT` to `1` at G1.

**PD-4 Privacy scan severities.** Secret shapes and the values of private variables fail every build (D-027); personal data and localhost fail the strict build only (a normal build legitimately has `http://localhost:4321` canonicals).

**PD-5 Backup pipeline.** `pg_dump --format=custom --no-owner` piped straight into `age -r <public key>`: no plaintext file ever exists; runner pinned to `ubuntu-24.04`; `postgresql-client-17` from the official PostgreSQL apt repository; `age` from the Ubuntu archive; artifact kept 60 days; optional Telegram failure alert (plain text, run link only). Switches are repository variables: `BACKUP_ENABLED` (job runs only when `true`) and `BACKUP_TELEGRAM_ALERTS`. The D-011 alert "newest backup older than 9 days" is left to the M2 dead-man switch work.

**PD-6 Secrets loader contract.** `scripts/load-secrets.mjs` has an allow-list manifest that mirrors the key matrix in `docs/SECRETS.md`; refuses the whole run on an unknown name, a wrong value shape (a secret key in a public variable, a private age key in `AGE_PUBLIC_KEY`), a switch name (`DEPLOY_ENABLED`, `BACKUP_ENABLED`, `PS_STRICT`, `BACKUP_TELEGRAM_ALERTS` are set by hand), or a file that git tracks or does not ignore; sends only through `gh secret set`, `gh variable set` and `wrangler secret put` with the value on standard input; prints names only and redacts the vendors' output.

## 5. Facts verified (2026-10-21)

- Workers static assets `_headers`: 100 rules, 2,000 characters per line, matching rules combine and equal headers are comma-joined, not applied to Worker responses, a host pattern such as `https://:version.:subdomain.workers.dev/*` is documented for noindex on workers.dev. https://developers.cloudflare.com/workers/static-assets/headers/
- Adapter behaviour (installed `@astrojs/cloudflare` 14.3.4, `dist/index.js` and `dist/utils/headers.js`): it prepends `/_astro/*` immutable caching to the existing `_headers` unless a rule that matches already sets `Cache-Control`; no `staticHeaders` (no CSP written by the adapter). Confirmed on this PC: build output has the adapter block first, then our file.
- Cloudflare Web Analytics manual snippet (`type="module"`, `data-cf-beacon='{"token": ...}'`), CSP: `script-src https://static.cloudflareinsights.com/beacon.min.js`, `connect-src cloudflareinsights.com`. https://developers.cloudflare.com/web-analytics/faq/ (also `docs/m1/third-party-integration-facts.md` TP-A3, including that cookie-less behaviour is stated by Cloudflare and that `workers.dev` hostnames are untested).
- Turnstile CSP (`script-src` and `frame-src` `https://challenges.cloudflare.com`) and test keys. https://developers.cloudflare.com/turnstile/reference/content-security-policy/ , https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Astro `security.csp`: meta tag only. https://docs.astro.build/en/reference/configuration-reference/#securitycsp
- PostgreSQL client 17 on Ubuntu: `postgresql-common`, `/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh` (any option, such as `-y`, skips the prompt), then `postgresql-client-17`. https://www.postgresql.org/download/linux/ubuntu/ , https://salsa.debian.org/postgresql/postgresql-common/-/raw/master/pgdg/apt.postgresql.org.sh
- `age`: `apt install age` on Ubuntu 22.04 and later (https://github.com/FiloSottile/age); Ubuntu noble carries `1.1.1-1ubuntu0.24.04.3` (https://launchpad.net/ubuntu/noble/+source/age; packages.ubuntu.com was unreachable); the latest upstream release is v1.3.2 (tag read with `git ls-remote https://github.com/FiloSottile/age.git`), whose Windows file is `age-v1.3.2-windows-amd64.zip`, 20,250,704 bytes (https://api.github.com/repos/FiloSottile/age/releases/tags/v1.3.2). `age-keygen -o FILE` writes the key file, `-y FILE` prints its public key.
- `actions/upload-artifact` latest tag v7.0.2 = commit `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (`git ls-remote --tags https://github.com/actions/upload-artifact.git`); inputs `retention-days`, `if-no-files-found`, Node 24 runtime (its `action.yml` at that commit). Existing pins re-checked: `actions/checkout` v7.0.1 is `3d3c42e5...`.
- Telegram `getUpdates` (offset, limit, timeout, allowed_updates; fails when a webhook is set; updates kept at most 24 hours). https://core.telegram.org/bots/api#getupdates
- `gh secret set` and `gh variable set` read the value from standard input when `--body` is absent (`gh` 2.102.0 help on this PC); `wrangler secret put <key>` takes the value on standard input (Wrangler 4.150.0).
- npm 11.19 with `ignore-scripts=true` does not run `postbuild` (observed).

## 6. Requests to other workers and the lead

**Lead**
- R1 `OwnerSection.astro` (lead's file): optionally render `<template data-owner-hidden={name}></template>` (a `name` prop) when it hides its slot. `check-placeholders.ts` already reads the marker `data-owner-hidden="<name>"` and lists hidden sections. The Site-shell notes ask for the same.
- R2 `.env.example`: add `PUBLIC_ALLOW_INDEXING`, `PUBLIC_CF_ANALYTICS_TOKEN` and `PUBLIC_HSTS_MAX_AGE` (public build variables; `src/env.d.ts` already declares them). Document the new repository VARIABLES: `PS_STRICT`, `BACKUP_ENABLED`, `BACKUP_TELEGRAM_ALERTS` (and the existing `DEPLOY_ENABLED`, `AGE_PUBLIC_KEY`). Before the first deploy the owner must set all six required `PUBLIC_*` variables or the strict path refuses.
- R3 (Lead-backend, via the lead): change `invalid_phone` in `src/lib/contracts/lead-constants.ts` line 62, which contains the example `98765 43210`. A phone-shaped example in the public JavaScript trips the strict privacy scan at G1 (it is the only hit in the current build). Use wording without digits, for example "Please enter a 10-digit mobile number."
- R4 (Lead-backend): the `outbound_clicks` table is needed with columns `go_slug`, `target_type` (the link label: sponsored, partner, affiliate or internal), `target_id`, `page_path`, `utm` (text, the query string), `ua_hash`, and `ts` defaulting to now; `GRANT INSERT ... TO service_role` (the REST helper inserts with the secret key, no schema header, so the table must be where PostgREST looks by default). The route only inserts when `SUPABASE_URL` or `PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` exist; otherwise clicks are simply not stored and the redirect still works.
- R5 Docs to update from this work: `docs/SECRETS.md` (the three helper scripts now exist: names, one-line commands `npm run secrets:load -- --dry-run`, `npm run telegram:chat-id`, `npm run age:keys`), `docs/OWNER_TODO.md` (OT-08, OT-31, OT-44 can now point at them; new owner task: create the Cloudflare Web Analytics site and send the PUBLIC token), `CHANGELOG.md`, `BUILD_PLAN_PHASE1.md` M1 item 4 and 4a status.
- R6 Decide whether to add a first-party JavaScript size check (deviation 7).
- R7 Optional hardening in `astro.config.mjs` (lead's file): `build.inlineStylesheets: 'never'` would let a later change drop `style-src` hashes; not required now.

**Site-shell**: nothing is blocking. Keep inline event handlers out (the build fails on them), keep `style=` attributes few, and avoid new inline `<script>` blocks where an external module works (each unique block adds a hash to a 2,000-character line). Pages must stay noindex while the flag is off (the release check verifies it). `robots.txt` already matches (`Disallow: /go/` and `/api/` when indexing is on).

**Legal worker (via the lead)**: the privacy notice should name the Cloudflare Web Analytics beacon (cookie-less per Cloudflare, shown only when a token is set) and the `/go` click log (user-agent hash, no IP, path of the referring page).

**Email plan (note only, no change made).** `docs/m1/third-party-integration-facts.md` TP-A6b records that Cloudflare Email Service can now send mail from a Worker (`send_email` binding), and that sending to the owner's own verified destination address is free on Workers Free, while mail to arbitrary visitors needs Workers Paid. That could replace Resend for the OWNER email alert only (Resend would stay for visitor mail). It needs the domain on Cloudflare with Email Routing (OT-07) and is Beta. Not adopted; for the lead to weigh after OT-07.

## 7. Open owner questions

1. Switch on the weekly backup only after OT-27, OT-31 and OT-43 are done (`BACKUP_ENABLED`). Do you want the optional Telegram alert for a failed backup (`BACKUP_TELEGRAM_ALERTS`)? GitHub already emails the repository owner about failed scheduled runs.
2. OT-31: approve downloading `age` (Windows file `age-v1.3.2-windows-amd64.zip`, about 20 MB, from the age project's release page) before `npm run age:keys` can run. The script never downloads anything.
3. Create the Cloudflare Web Analytics site and send the token (a public identifier). Whether a `workers.dev` hostname can be registered is unknown; it may only work on the final domain.
4. HSTS timing: set `PUBLIC_HSTS_MAX_AGE` only after the real domain is live and checked (start short); `includeSubDomains` and `preload` are not emitted.
5. Sponsors, partners and affiliates for `/go`: none exist until you supply them (target, label, expiry); the map and the host list are empty.
6. The uptime tool (D-039, OT-44): the runbook draft is tool-neutral until you choose.

## 8. Not done and why

- No real `age` key, secret load, Telegram call, backup run, deployment or workflow run: all need the owner or accounts (rule 5). The workflows parse and their safety properties are tested as text, but none has run on GitHub.
- The loader, Telegram helper and key helper are tested only with fake input and fake command runners; their first real run is the owner's.
- `dist/` is shared between workers: another worker's build can replace the one you just made; inspect output straight after your own build.
