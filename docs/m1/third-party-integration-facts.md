# M1 third-party integration facts (Research worker)

Status: SECTION A is complete (written 2026-10-21). Section B (uptime monitors) is appended below when finished.
Every fact carries an official source URL and "verified 2026-10-21" (read live on that date). Items that could not be verified say `unknown`. Nothing here is a price, tax rate or legal advice. No account was created and no secret was used.

How the pages were read: Cloudflare, Resend and Supabase docs were read as raw Markdown (the vendors publish a Markdown copy of each page), Telegram, Astro, Vitest and PostgREST docs as page text. Where a fact comes from the installed package source instead of a doc page, it says so.

Corrections to the task brief (read these first):

1. **Supabase secret keys go in the `apikey` header only.** The brief lists "`apikey`, `Authorization`". The official guidance for `sb_secret_` / `sb_publishable_` keys is: send them on `apikey`, NOT on `Authorization: Bearer`, because they are not JWTs (TP-A4).
2. **Cloudflare is no longer receive-only for email.** There is now Cloudflare Email Service with an outbound "Email Sending" (Beta). Arbitrary recipients need Workers Paid, but sending to the owner's own *verified destination address* is free on Workers Free (TP-A6c). Email Routing itself is still inbound/forwarding. This contradicts the "inbound only" wording of VF-A22.
3. **The Turnstile test-keys page moved** to `https://developers.cloudflare.com/turnstile/troubleshooting/testing/` (the old `/reference/testing/` redirects there). `.env.example` already cites the old URL; the key values in it are correct.
4. **The Web Analytics beacon snippet now uses `type="module"`** (not `defer`), see TP-A3.

---

## TP-A1 Astro 7.3.x + @astrojs/cloudflare 14.3.x runtime facts

Installed: astro 7.3.8, @astrojs/cloudflare 14.3.4. Repo config seen: `wrangler.jsonc` (`main: @astrojs/cloudflare/entrypoints/server`, `compatibility_flags: ["nodejs_compat"]`, no `assets` block, no `vars`), `astro.config.mjs` (`prerenderEnvironment: 'node'` by default, `session: false`, `imageService: 'passthrough'`).

### A1.1 Reading secrets, variables and bindings in a `prerender = false` endpoint

- Official pattern (adapter docs): `import { env } from 'cloudflare:workers';` then `env.MY_VARIABLE`, `env.MY_KV`. The old `Astro.locals.runtime.env` was REMOVED in the Astro 6 line; do not use it.
  Source: https://docs.astro.build/en/guides/integrations-guide/cloudflare/ (sections "Environment variables and bindings" and the v13/v14 upgrade notes); Cloudflare's own page: https://developers.cloudflare.com/workers/configuration/secrets/ ("Importing `env` from `cloudflare:workers` to access secrets from anywhere in your code") and https://developers.cloudflare.com/workers/runtime-apis/bindings/ . Verified 2026-10-21.
- `astro:env` also works: declare the variable in `env.schema` in `astro.config.mjs` with `envField.string({ context: 'server', access: 'secret' })`, then `import { NAME } from 'astro:env/server'`. The adapter docs say Cloudflare variables and secrets "are also compatible with the astro:env API". Secrets are validated whenever anything is imported from `astro:env/server` (dummy values needed at build). Source: https://docs.astro.build/en/guides/environment-variables/ , verified 2026-10-21. (Not currently configured in this repo; `cloudflare:workers` `env` is the simpler route.)
- Where each kind lives (adapter docs + Workers docs):
  - Non-secret `vars`: in `wrangler.jsonc` under `"vars"`. Never put a secret there (Cloudflare caution).
  - Secrets: `npx wrangler secret put <KEY>` (production) - the OWNER/loader does this, never Claude (docs/SECRETS.md). Locally `.dev.vars` in the project root (dotenv syntax), git-ignored.
  - Limits: Workers Free allows 64 variables (secrets + text) per Worker, each 5 KB (https://developers.cloudflare.com/workers/platform/limits/ , verified 2026-10-21). `.env.example` Group 2 has about 12 names, well inside.
- `process.env`: with `nodejs_compat` (already in `wrangler.jsonc`) `process.env` also exposes the bindings in a Worker (https://developers.cloudflare.com/workers/configuration/secrets/), but use `env` from `cloudflare:workers` for clarity.
- Do not create a long-lived client in module scope from a secret: Cloudflare warns isolates can be reused after a secret changes; build the client per request (https://developers.cloudflare.com/workers/runtime-apis/bindings/ , "How to access env"). Verified 2026-10-21.
- **On-demand code always runs in workerd**, even when `prerenderEnvironment: 'node'` (adapter docs: "On-demand rendered pages are unaffected by this option and always run in workerd"). So `cloudflare:workers` works in endpoints. **Prerendered pages and anything they import must NOT import `cloudflare:workers`** under `prerenderEnvironment: 'node'` (the comment in `astro.config.mjs` already says this).

### A1.2 Local `astro dev` and tests: how to fall back

- `astro dev` runs on-demand code in workerd through the Cloudflare Vite plugin (VF-A2), so `import { env } from 'cloudflare:workers'` works in dev. Secrets for dev come from `.dev.vars` (adapter docs: "To set secrets for local development, add a `.dev.vars` file to the root of the Astro project").
- Cloudflare: "Put secrets for use in local development in either a `.dev.vars` file or a `.env` file ... Choose to use either `.dev.vars` or `.env` but not both. If you define a `.dev.vars` file, then values in `.env` files will not be included in the `env` object during local development." (https://developers.cloudflare.com/workers/configuration/secrets/ , verified 2026-10-21). This matters here: `.env` holds the PUBLIC_* build variables (read by Vite as `import.meta.env`, unaffected) while `.dev.vars` holds Worker secrets (`SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY` ...). Because Vite still reads `.env` for `import.meta.env.PUBLIC_*`, having both files is fine; just do not expect `.env` values in `env.*`.
- Wrangler can declare required secret names with the `secrets` config property (`secrets.required`); when set, only those keys are loaded from `.dev.vars`/`.env` and missing ones give a warning (same page; verified 2026-10-21). Optional hardening, not required.
- **Vitest (separate config, no Astro/Cloudflare plugins, `vitest.config.ts`) cannot resolve `cloudflare:workers`.** Vitest docs: "By default, Vitest will fail transforming files if it cannot find the source of the import", and the two documented fixes are `test.alias` (redirect to a mock file) or a plugin `resolveId` that returns the id, followed by `vi.mock(..., factory)` (https://vitest.dev/guide/mocking/modules#mocking-non-existing-module , verified 2026-10-21). Recommended design (inference, not tested here):
  1. Put all logic in pure modules that take an `env`-shaped parameter: `handleLead(request, env: LeadEnv, deps)`. Tests pass a plain object plus a mocked `fetch`.
  2. Keep `src/pages/api/lead.ts` a thin file: `import { env } from 'cloudflare:workers'; export const POST = ({ request }) => handleLead(request, env)`; tests never import that file.
  3. If a test must import an endpoint file, the lead adds `test.alias: { 'cloudflare:workers': 'tests/mocks/cloudflare-workers.ts' }` to `vitest.config.ts` (lead-owned file).
- Also `npm run build` with `PS_STRICT` etc. is unaffected: `env` from `cloudflare:workers` is only evaluated at request time in workerd.

### A1.3 `public/_headers` vs the adapter's generated `_headers`

Read from the installed adapter source (`node_modules/@astrojs/cloudflare/dist/index.js` and `dist/utils/headers.js`, v14.3.4) and confirmed against a build output in `dist/client/_headers`:

- `public/_headers` is copied to `dist/client/_headers` by Astro. At `astro:build:done` the adapter reads that file and, **unless a rule that matches `/_astro/probe` already sets `Cache-Control`**, it PREPENDS this block:
  ```
  /_astro/*
    Cache-Control: public, max-age=31536000, immutable
  ```
  (existing content is kept after it). If no `public/_headers` exists the adapter creates the file with just that block (that is what `dist/client/_headers` contains today).
- Gotcha: a catch-all rule such as `/*` that sets `Cache-Control` COUNTS as a match for `/_astro/probe`, so the adapter then skips its immutable block and hashed assets would lose the long cache. Either do not set `Cache-Control` in a `/*` rule, or add your own `/_astro/*` rule with the immutable value (the adapter's detector also treats `! Cache-Control` (detach) as "already handled").
- Cloudflare `_headers` rules (https://developers.cloudflare.com/workers/static-assets/headers/ , page updated 2026-09-22, verified 2026-10-21):
  - A request matching several rules inherits ALL of their headers; the same header named twice is joined with a comma (so two rules each setting `X-Robots-Tag` produce `a, b`).
  - `! Header-Name` on a more specific rule removes a header set by a broader one.
  - Max 100 rules, 2,000 characters per line (a long CSP line must fit in 2,000 characters).
  - Splat `*` only once per URL pattern; placeholders `:name`; absolute `https://` URL patterns allowed (useful to scope `X-Robots-Tag: noindex` to `https://*.workers.dev/*` style hosts; the page's own example uses `https://:version.:subdomain.workers.dev/*`).
  - Rules apply only to static asset responses. **"Custom headers defined in the `_headers` file are not applied to responses generated by your Worker code, even if the request URL matches a rule"**. Redirects are applied before headers.
  - Headers in `_headers` override Cloudflare's defaults (default `Cache-Control: public, max-age=0, must-revalidate` + `ETag` on assets).

### A1.4 Does Astro middleware run for static assets / prerendered pages?

- No. Order of serving (https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ , updated 2026-10-12): "Cloudflare will first attempt to serve static assets if one matches the incoming request ... If an appropriate static asset is not found, Cloudflare will invoke your Worker script." Prerendered pages are static assets, so the Worker (and Astro middleware) is not invoked for them. Only `assets.run_worker_first` changes that, and with it on the Free plan, matching requests count against the 100,000/day and get **429 after the cap** instead of falling back to assets (https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ , verified 2026-10-21). Do not enable `run_worker_first` for page routes (D-009 budget).
- Astro itself: middleware "rendering occurs at build time for all prerendered pages, but occurs when the route is requested for pages rendered on demand" (https://docs.astro.build/en/guides/middleware/ , verified 2026-10-21). So headers a middleware sets on a prerendered page are NOT sent at request time.
- Consequence: security headers for prerendered pages go in `public/_headers`; headers for on-demand responses (`/api/*`, `/go/*`, beacon, webhooks, admin actions) must be set in the response code or in middleware (middleware runs for on-demand routes in the Worker). This confirms VF-A14.

### A1.5 Setting response headers for prerendered pages

- Use `public/_headers` (above). For a per-page header, give the page a path rule (`/pricing`, `/services/*`), not a file extension rule; the rule matches the request URL.
- Optional extra: Astro's `security.csp` (since astro 6.0) emits a `<meta http-equiv="content-security-policy">` per page with SHA-256 hashes of Astro's own scripts and styles. Limits stated in the docs: external scripts/styles are not covered (you must add sources yourself), `<ClientRouter />` is unsupported, it is not applied in `astro dev` (test with build + preview), and a `<meta>` CSP cannot carry `frame-ancestors`/`report-uri`-style header-only directives. Source: https://docs.astro.build/en/reference/configuration-reference/#securitycsp , verified 2026-10-21. Static pages cannot use per-request nonces, so a header CSP for them must be host-based (`script-src 'self' https://challenges.cloudflare.com ...`) plus hashes for any inline script (inference from the static model).

---

## TP-A2 Cloudflare Turnstile

Sources (all verified 2026-10-21): https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ (updated 2026-06-17), https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/ (2026-06-28), https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ (2026-09-16), https://developers.cloudflare.com/turnstile/troubleshooting/testing/ (2026-10-20), https://developers.cloudflare.com/turnstile/reference/content-security-policy/ (2026-05-05).

### A2.1 Widget script and rendering

- Script URL (must be this exact URL; proxying or caching it "will cause Turnstile to fail when future updates are released"):
  - implicit: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
  - explicit: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>`
  - explicit with a ready callback: `...api.js?render=explicit&onload=onTurnstileLoad` (a global function). Inside `turnstile.ready(() => { ... })` is also supported.
- Optional resource hint: `<link rel="preconnect" href="https://challenges.cloudflare.com" />`.
- D-010 (load on first form interaction): inject the script tag from JS on first focus/pointer event on the form, with `?render=explicit` (`onload=` or `turnstile.ready`), then call `turnstile.render(container, opts)`. Docs recommend explicit rendering for dynamic content and conditional rendering "based on visitor interactions".
- Explicit API: `const id = turnstile.render('#container', { sitekey, callback, ... })`; `turnstile.reset(id)` ("to reset the widget if the given widget timed out or expired"); `turnstile.getResponse(id)`; `turnstile.isExpired(id)`; `turnstile.remove(id)` ("will not call any callback and will remove all related DOM elements"); `turnstile.execute('#container')` when `execution: 'execute'`.
- Render options (JS key = data attribute without `data-`): `sitekey`; `callback(token)`; `error-callback(errorCode)`; `expired-callback()` (token expired, does NOT reset the widget); `timeout-callback()` (interactive challenge unsolved in time, resets the widget); `before-interactive-callback`, `after-interactive-callback`, `unsupported-callback`; `theme` `auto|light|dark` (default auto); `size` `normal` (300x65) `flexible` (100%, min 300) `compact` (150x140); `appearance` `always` (default) `execute` `interaction-only`; `execution` `render` (default) `execute`; `retry` `auto|never`, `retry-interval` ms (default 8000, < 900000); `refresh-expired` `auto|manual|never` (default auto); `refresh-timeout` `auto|manual|never`; `language` `auto` or ISO 639-1/regional code; `tabindex` (default 0); `action` (<= 32 chars `[A-Za-z0-9_-]`); `cData` (<= 255 chars `[A-Za-z0-9_-]`); `response-field` (default true) and `response-field-name` (default `cf-turnstile-response`); `feedback-enabled`.
- Hidden field: inside a `<form>` the widget adds `<input type="hidden" name="cf-turnstile-response">`. In a JSON-fetch form (our `/api/lead`), read the token from the `callback` or `turnstile.getResponse(id)` and put it in the JSON body.
- Accessibility note for the form worker: `size: 'flexible'` fits a 360 px viewport (min 300 px); `compact` is 150 px wide.

### A2.2 Siteverify

- `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Request fields: `secret` (required), `response` (required, the token), `remoteip` (optional), `idempotency_key` (optional UUID "to safely retry validation requests"). Accepts `application/x-www-form-urlencoded` OR `application/json`; always returns JSON.
- Response fields: `success` (bool), `challenge_ts` (ISO 8601), `hostname`, `error-codes` (array), `action`, `cdata`, `metadata.ephemeral_id` (Enterprise only). Failure example: `{"success": false, "error-codes": ["invalid-input-response"]}`.
- Error codes: `missing-input-secret`, `invalid-input-secret`, `missing-input-response`, `invalid-input-response` (token invalid, malformed or expired), `bad-request`, `timeout-or-duplicate` (token already validated or expired), `internal-error`.
- Token: max 2048 characters; valid 300 seconds (5 minutes) from generation; **single use**: "A replayed token will be rejected with the `timeout-or-duplicate` error code". After expiry the widget must be refreshed (`turnstile.reset`).
- Mandatory: "You must call the Siteverify API to complete your Turnstile implementation" (tokens can be forged). Optional hardening Cloudflare shows: compare `action` and `hostname` with expected values.
- Design notes for the lead-backend worker (inference): treat a `fetch` failure or `internal-error` as "verification unavailable" (decide fail-closed vs fail-open as a documented choice, since failing closed loses leads when Cloudflare is down); do NOT assert `hostname`/`action` equality when the test secret is in use (the documented dummy success response in the testing page is `hostname: "localhost"`, `action: "test"`, `cdata: "test-data"`, which will not match real values); send `remoteip` from `CF-Connecting-IP`.

### A2.3 Published TEST keys (copied exactly from https://developers.cloudflare.com/turnstile/troubleshooting/testing/ , verified 2026-10-21)

Test sitekeys:

| Sitekey | Behaviour | Widget type |
|---|---|---|
| `1x00000000000000000000AA` | Always passes | Visible |
| `2x00000000000000000000AB` | Always fails | Visible |
| `1x00000000000000000000BB` | Always passes | Invisible |
| `2x00000000000000000000BB` | Always fails | Invisible |
| `3x00000000000000000000FF` | Forces interactive challenge | Visible |

Test secret keys:

| Secret key | Behaviour |
|---|---|
| `1x0000000000000000000000000000000AA` | Always passes validation |
| `2x0000000000000000000000000000000AA` | Always fails validation |
| `3x0000000000000000000000000000000AA` | Returns the "token already spent" error (`timeout-or-duplicate`) |

Rules from the same page:
- Test sitekeys generate the dummy token `XXXX.DUMMY.TOKEN.XXXX`. Test secrets "only accept the dummy token, reject real tokens"; production secrets reject the dummy token. So a deployed preview must pair a test sitekey with a test secret (never mix with a real key).
- They work on any domain including `localhost`, `127.0.0.1`, `0.0.0.0`.
- Documented pairings: `1x...AA` sitekey + `1x...AA` secret = pass; `2x...AB` sitekey + `2x...AA` secret = fail; `1x...AA` sitekey + `3x...AA` secret = `timeout-or-duplicate`; `3x...FF` sitekey + `1x...AA` secret = interactive challenge then pass.
- Success response with test keys (documentation example): `{"success": true, "challenge_ts": "2022-02-28T15:14:30.096Z", "hostname": "localhost", "error-codes": [], "action": "test", "cdata": "test-data"}`.
- Cross-check: `.env.example` already carries `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`, identical to the page. Its comment URL `/turnstile/reference/testing/` redirects to the page above (the page moved); update the comment to the new URL at the next edit of that file (lead-owned).

### A2.4 Content-Security-Policy directives Turnstile needs

- `script-src https://challenges.cloudflare.com`
- `frame-src https://challenges.cloudflare.com`
- `connect-src 'self'` only for pre-clearance mode (we do not use it).
- Cloudflare recommends the nonce approach (nonce on the `api.js` tag, propagated to dynamic resources; works with `strict-dynamic`), which is not available for prerendered pages. The documented alternative is exactly the two host sources above.
- Cloudflare also notes you "cannot set your own CSP and/or Referer-Policy via meta tags or Transform rules in challenge pages" (this concerns Cloudflare's own challenge pages, not Turnstile widgets on our pages).
- Combined with Web Analytics (TP-A3) a header CSP for the form pages needs: `script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com/beacon.min.js` (plus inline hashes), `frame-src https://challenges.cloudflare.com`, `connect-src 'self' https://cloudflareinsights.com` (manual beacon) and the Supabase/API origins only if the browser calls them (it must not call Supabase with a secret key; leads go through our own `/api/lead`).

---

## TP-A3 Cloudflare Web Analytics

Sources (verified 2026-10-21): https://developers.cloudflare.com/web-analytics/ (updated 2026-04-16, "Available on all plans"), https://developers.cloudflare.com/web-analytics/about/ , https://developers.cloudflare.com/web-analytics/get-started/ (2026-04-17), https://developers.cloudflare.com/web-analytics/faq/ (2026-07-14), https://developers.cloudflare.com/web-analytics/limits/ (2026-08-12), https://developers.cloudflare.com/speed/observatory/rum-beacon/ (2026-10-05), https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/ .

- **Free?** Yes: "free, privacy-first analytics ... without changing your DNS or using Cloudflare's proxy"; "Available on all plans". Limit for sites not proxied through Cloudflare: 10 sites per account (docs "Limits" page; FAQ calls it a soft limit adjustable via support). Rules (path include/exclude) are 0 on Free and only for proxied sites.
- **Cookieless?** The RUM beacon "does not store any data in the browser or access any storage data, such as cookies, localStorage, sessionStorage, IP address, or IndexedDB"; Cloudflare "does not track individual end users across our customers' Internet properties"; the client IP is discarded at the nearest data centre. Collected fields: page-load id, referrer, landing path, performance timings, Core Web Vitals. UTM/query strings are not logged; custom events are not supported.
- **Snippet** (manual setup, from the FAQ, current wording): 
  ```html
  <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "$SITE_TOKEN"}'></script>
  ```
  The FAQ says to add `type="module"` for manual embeds (it keeps the script from loading in Internet Explorer; the dashboard instructions include it). Place before the closing `</body>` tag. Alternative query form (for tag managers): `...beacon.min.js?token=$SITE_TOKEN`. There is no `defer`; `type="module"` scripts are deferred by nature.
- **Where the token comes from:** Cloudflare dashboard > Web Analytics > Add a site > enter the hostname > Done > copy the JS snippet from "Manage site". The token is in `data-cf-beacon`. It is a public identifier (it is in page source), not a secret; supply it as a PUBLIC_ build variable (the repo's rule: token-gated, render nothing when missing). The OWNER creates this in the Cloudflare dashboard (account action: ask first).
- **Hostnames:** for a site NOT proxied by Cloudflare (our case until the domain is on Cloudflare), you type the hostname and install the snippet manually; for proxied sites automatic injection is the default and can also be switched to manual. Cloudflare matches hostnames by postfix: registering `example.com` accepts beacons from `www.example.com`, `blog.staging.example.com`, `fooexample.com`, but not `example.com.br`; the same token can serve subdomains with the same apex.
- **workers.dev:** `unknown`. No official page says whether a `*.workers.dev` hostname can be registered as a Web Analytics site; the docs only say any hostname can be entered for a non-proxied site, and the beacon reports to `https://cloudflareinsights.com/cdn-cgi/rum`. Treat it as untested; prove it on the first preview or skip analytics on workers.dev (the privacy-safe default since the beacon is token-gated anyway). Custom domain: yes, either manual snippet (hostname = our domain) or automatic injection once the domain is proxied; note automatic injection does not work if the response has `Cache-Control: public, no-transform`.
- **Beacon endpoints:** manual embed reports to `https://cloudflareinsights.com/cdn-cgi/rum` (POST only; GET returns 405); automatic injection reports to our own `https://<domain>/cdn-cgi/rum`.
- **CSP:** `script-src ... https://static.cloudflareinsights.com/beacon.min.js` (if the snippet uses the `?token=` query form the full URL incl. query must be listed); `connect-src ... cloudflareinsights.com` for manual embeds (`'self'` for automatic injection). The vendor says to trial with `Content-Security-Policy-Report-Only` first.
- **Referrer-Policy:** the FAQ says a `Referer` header is required for the beacon (a change to require only `Origin` is "in-flight"); do not set `Referrer-Policy: no-referrer` on pages with the beacon; `strict-origin-when-cross-origin` (the YouTube-recommended value, VF-C7) is compatible (cross-origin POST carries Origin and an origin-only Referer). Treat this as inference for the second half.
- **SRI:** not possible for the manual snippet ("we do not support version-pinning our beacon script").
- Data: unsampled for 7 days, then aggregated to about 10%; dashboard access to the previous six months; the beacon is blocked by ad blockers (Brave, DuckDuckGo extension etc.).
- EU: "Free customers have RUM enabled automatically, with EU traffic excluded" applies to the proxied automatic setup; for a manual snippet the page does not say EU visitors are excluded (`unknown`; privacy note for the privacy policy wording).

---

## TP-A4 Supabase REST (PostgREST) insert with the new secret key

Sources (verified 2026-10-21): https://supabase.com/docs/guides/api/api-keys (Markdown copy), https://docs.postgrest.org/en/stable/references/api/tables_views.html (Insert, Upsert), https://docs.postgrest.org/en/stable/references/api/preferences.html , https://docs.postgrest.org/en/stable/references/errors.html , https://supabase.com/docs/guides/cli/config (`api.max_rows`), https://supabase.com/docs/reference/javascript/v1/select .

- Endpoint: `POST https://<project-ref>.supabase.co/rest/v1/<table_or_view>` with a JSON object body and `Content-Type: application/json`. For an `api`-schema table the schema must be exposed and selected with `Content-Profile: api` on writes (`Accept-Profile` on reads) (PostgREST: "For POST, PATCH, PUT and DELETE, select the schema with Content-Profile"; reads use Accept-Profile; https://docs.postgrest.org/en/stable/references/api/schemas.html , verified 2026-10-21; the Supabase API settings must list the `api` schema as exposed, D-005). `unknown` for this exact repo until the `api` schema exposure is tested in M1; flag for the lead.
- Headers: `apikey: <sb_secret_...>` (required, and the ONLY place the key goes). Official: "Send publishable and secret keys on the `apikey` header, not on `Authorization: Bearer`. Because the keys aren't JWTs, anything that tries to verify one as a JWT fails." The `apikey` header "is mandatory and not configurable" (Securing your API). So the brief's `Authorization` header is not needed (and must not carry the secret key). Do not copy the key into any other header or log (docs: log at most 6 characters of the random part after the prefix, or a SHA-256 hash).
- Role mapping: secret key -> Postgres role `service_role`, which has `BYPASSRLS`; **table GRANTs still apply** ("A missing grant returns a permission error, including for `service_role`"). The Data API default-grants change (VF-B7) means the migration must `GRANT INSERT ON ... TO service_role` explicitly. Policies are never evaluated for `service_role`.
- `sb_secret_` keys must never be sent from a browser: "A secret key doesn't work in a browser. Supabase matches on the `User-Agent` header and returns HTTP 401" and "Never put one in a browser, a shipped application, or source control ... A browser, even on `localhost`". The block is only a guard; a leaked key still works from other tools. Consequence: do not set a browser-like `User-Agent` on the Worker's fetch, and never expose the key as `PUBLIC_*`. Also use a separate secret key per backend component (docs recommend).
- `Prefer: return=minimal`: PostgREST docs say "With Prefer: return=minimal, no response body will be returned. This is the default mode for all write requests." Success is `201 Created` with an empty body. `return=headers-only` gives a `Location` header; `return=representation` returns the row (and then also needs SELECT permission). Use `return=minimal` for the lead insert so the secret-key role needs only INSERT and no PII comes back in the response.
- Unique violation: PostgreSQL `23505` becomes **HTTP 409** (and `23503` foreign-key violation also 409). Error body shape: `{"code":"23505","details":"...","hint":null,"message":"duplicate key value violates unique constraint \"...\""}`. `23502` (not-null) is 400. `42501` insufficient privilege is 403 for authenticated or 401 otherwise. Other 4xx/5xx mapping table is in the errors page.
- Idempotent inserts (optional): `POST /rest/v1/<table>?on_conflict=<unique_col>` with `Prefer: resolution=ignore-duplicates, return=minimal` ignores duplicates instead of returning 409; `resolution=merge-duplicates` upserts. Do not log the response body or request body (contains PII).
- 1,000-row limit: "By default, Supabase projects will return a maximum of 1,000 rows" (`api.max_rows` default 1000, changeable in the project API settings; PostgREST `db-max-rows`). It applies to reads/lists, not to a single-row insert; it matters for any list read (VF-B11, already recorded).
- Key naming in Supabase docs: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`; legacy `anon`/`service_role` keys are deprecated "by the end of 2026" (same page; matches VF-B9).
- Rotation: create a new secret key, replace everywhere, confirm, then delete the old one (delete cannot be undone). The owner does this.

---

## TP-A5 Telegram Bot API `sendMessage`

Sources (verified 2026-10-21; Bot API 10.3 is the current version on the page, dated 2026-08-24): https://core.telegram.org/bots/api#sendmessage , https://core.telegram.org/bots/api#making-requests , https://core.telegram.org/bots/api#html-style , https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this .

- URL: `https://api.telegram.org/bot<token>/sendMessage` over HTTPS; GET or POST; parameters may be a query string, `application/x-www-form-urlencoded` or `application/json`. UTF-8 only. The token is part of the URL: never log the URL (the repo already notes this in `.env.example`).
- Required params: `chat_id` (integer or string) and `text` ("1-4096 characters after entities parsing"). Optional that matter here: `parse_mode` (`HTML`, `MarkdownV2`, legacy `Markdown`), `entities`, `link_preview_options` (e.g. `{"is_disabled": true}`), `disable_notification`, `protect_content`, `message_thread_id`, `reply_markup`.
- Response: JSON with boolean `ok`; on success `result` is the sent Message; on failure `ok:false`, `description` (human readable), `error_code` (integer, "its contents are subject to change in the future") and sometimes `parameters` (ResponseParameters: `retry_after` seconds after a flood-control hit, `migrate_to_chat_id`).
- HTML parse mode: supported tags are only `<b>/<strong>`, `<i>/<em>`, `<u>/<ins>`, `<s>/<strike>/<del>`, `<span class="tg-spoiler">`/`<tg-spoiler>`, `<a href="...">`, `<tg-emoji>`, `<tg-time>`, `<code>`, `<pre>` (optionally with nested `<code class="language-...">`), `<blockquote>` and `<blockquote expandable>`. "All <, > and & symbols that are not a part of a tag or an HTML entity must be replaced with the corresponding HTML entities (< with &lt;, > with &gt;, & with &amp;)". Only these named entities are supported: `&lt;`, `&gt;`, `&amp;` and `&quot;`; all numeric entities work. So for untrusted visitor text, escape `&` first, then `<` and `>` (a three-replace function) and wrap values in `<b>`/`<code>` yourself; any other tag or a stray `<` makes the API reject the message with a 400 "can't parse entities" style error (the exact wording is not in the official docs: `unknown`). Prefer `<code>` for user-supplied values or no `parse_mode` at all (plain text needs no escaping) for visitor-entered fields.
- MarkdownV2 would need escaping of `_ * [ ] ( ) ~ ` > # + - = | { } . !` with a backslash; HTML is simpler and is what the brief asks for.
- 4096-character limit applies to the text "after entities parsing" (i.e. tag characters do not count; visible characters do). Truncate the text yourself (e.g. to 3,500 characters) before sending; do not split mid-tag/entity.
- Rate limits (FAQ): "In a single chat, avoid sending more than one message per second. We may allow short bursts that go over this limit, but eventually you'll begin receiving 429 errors." Groups: no more than 20 messages per minute. Bulk to many users: about 30 messages per second. One owner chat at our lead volume is far inside this; no queueing needed, but a retry must respect the delay.
- 429 handling: the response carries `parameters.retry_after` (seconds to wait). A Worker should NOT sleep long inside the request (Free plan 10 ms CPU but wall time is fine; still keep latency low): do one retry after `min(retry_after, ~2 s)` or give up and rely on the email channel, and always make the lead write independent of the notification result.
- Other error codes (400 bad request e.g. parse or chat problems, 401 invalid token, 403 bot blocked/cannot initiate chat, 404 chat/endpoint, 429 flood) are conventional HTTP codes; the official page does not enumerate them (`unknown` for exact messages), and says `error_code` content may change, so branch on `ok` and `parameters.retry_after`, not on description text.
- A bot can only message a user who has started the bot (the owner presses Start once); the chat id of a private chat equals the user id (documented behaviour of private chats; the owner obtains it per the OT-08 steps).

---

## TP-A6 Resend REST email send, and Cloudflare email options

Sources (verified 2026-10-21): https://resend.com/docs/api-reference/emails/send-email , https://resend.com/docs/dashboard/emails/idempotency-keys , https://resend.com/docs/api-reference/errors , https://resend.com/docs/api-reference/rate-limit , https://resend.com/docs/introduction , https://resend.com/docs/knowledge-base/403-error-resend-dev-domain , https://resend.com/pricing , https://developers.cloudflare.com/email-service/ (+ `/platform/pricing/`, `/platform/limits/`, `/api/send-emails/workers-api/`, `/configuration/email-routing-addresses/`).

### A6a Resend API

- Request: `POST https://api.resend.com/emails`, headers `Authorization: Bearer <re_... key>` and `Content-Type: application/json`. Body: `from` (required; `Name <email@domain>` allowed), `to` (required; string or array, max 50), `subject` (required), `html` and/or `text` (if only HTML is given a text part is generated unless you pass an empty string), plus optional `cc`, `bcc`, `reply_to`, `headers` (custom), `tags` (name/value of ASCII letters, digits, `_`, `-`, <= 256 chars), `attachments` (40 MB total after Base64), `scheduled_at`, `template`. Response on success: JSON containing the email `id` (the cURL example on the page).
- Idempotency: header `Idempotency-Key: <string>` on `POST /emails` (and batch): unique per request, max 256 characters, "expire after 24 hours". Same key + same body within 24 h returns the same response without sending again; same key with a different body returns 409 `invalid_idempotent_request`; concurrent duplicate returns 409 `concurrent_idempotent_requests`; empty or over-long key returns 400 `invalid_idempotency_key`. Recommended format from the docs: `<event-type>/<entity-id>`; for us e.g. `lead-owner-alert/<lead id>`. This makes a Worker retry safe.
- Key types: an API key can be "Sending access" only (restricted to sending); error `restricted_api_key` 401 "This API key is restricted to only send emails" appears when such a key is used on other endpoints. Use a sending-only key (matches `.env.example`).
- Auth/validation errors seen on send: 401 `missing_api_key`, 401/400 `validation_error` "API key is invalid", 403 `validation_error` "domain is not verified", 403 `validation_error` "You can only send testing emails to your own email address" (resend.dev sender), 422 `missing_required_field`, 429 `rate_limit_exceeded`, 429 `daily_quota_exceeded` (free plan, resets 00:00 UTC), 429 `monthly_quota_exceeded`.
- **Domain verification requirement:** "To get started with Resend, you'll need: 1. Your own domain, verified with Resend". Until a domain is verified, the shared test sender `onboarding@resend.dev` can only send to the email address of the Resend account itself ("The `resend.dev` domain is only available for testing purposes and can only send emails to the email address associated with your Resend account"). The `from` address must use the verified domain; verification means adding the DNS records Resend lists (SPF/DKIM) to the domain (OT-07 domain first). Note: sending TO the owner's own account address with `onboarding@resend.dev` works without a domain, which is enough for a first owner-alert email test, but deliverability/branding is test-grade (inference on the last part).
- Limits: default 10 requests per second per team (headers `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after`; a 429 carries `retry-after`). Free plan daily quota resets at midnight UTC, not rolling; "Both sent and received emails count towards" the quotas.
- **Free tier (pricing page, verified 2026-10-21):** Free = USD 0/month, 3,000 emails/month, 100 emails/day (the page states both: "The Free plan is limited to 100 emails per day"), 3 domains, 1 webhook endpoint, 3 inboxes, 30-day data retention, ticket support; inbound email and the REST API are included in all plans. Paid transactional plans start at USD 20/month (Pro, 50,000 emails); no price decision is needed for M1.

### A6b Cloudflare Email Routing is receive-only: partly outdated

- Email Routing: forwards or processes INBOUND mail (to a verified destination address or a Worker), free on Workers Free/Paid, 200 rules per domain, 200 destination addresses per account, 25 MiB inbound size. It cannot send mail by itself.
- But Cloudflare now documents **Cloudflare Email Service** (updated 2026-10-15) with "Email Sending (Beta)" for outbound transactional mail through a Workers `send_email` binding, a REST API (`POST /accounts/{account_id}/email/sending/send`, Bearer API token) or authenticated SMTP. Pricing page (updated 2026-06-09): Workers Free = outbound "Not available" for arbitrary recipients; Workers Paid = 3,000 included per month then USD 0.35 per 1,000.
- **Free exception that matters to us:** "Sending to verified destination addresses in your account is free on all plans, including when only Email Routing is configured", "do not count toward the monthly quota or daily limits", and "You can only send from your routing domains" (limits page). So the owner-alert email could be sent from the Worker for free to the owner's verified destination address with:
  ```jsonc
  { "send_email": [{ "name": "EMAIL" }] }   // wrangler.jsonc
  ```
  ```ts
  await env.EMAIL.send({ to: ownerVerifiedAddress, from: 'alerts@<routing domain>', subject, text });
  ```
  Requirements: the domain is on Cloudflare with Email Routing onboarded (OT-07/OT-24 domain decision first), the owner's address is added and verified under Email Service > Email Routing > Destination Addresses, and Beta status accepted. Max message 25 MiB to verified destinations (5 MiB otherwise). `send()` throws an Error with a `code` on failure; it returns `{ messageId }`. Locally the simulator limits binary attachments (irrelevant for text alerts).
- It cannot email the visitor (arbitrary recipient) on Workers Free. Visitor-facing confirmation emails therefore still need Resend (3,000/month free) or another provider; owner alerts can use either. This is a proposal for the lead (new decision: owner alert via Cloudflare `send_email` to a verified address, Resend only for visitor mail), not an adopted change. Untested: `unknown` whether a binding with no `destination_address` restriction accepts any verified address on Free (the docs describe restriction attributes in "send bindings"); verify when the domain exists.

---

## TP-A7 Cloudflare Workers Free limits that matter for `/api/lead`

Source: https://developers.cloudflare.com/workers/platform/limits/ (page updated 2026-10-12, verified 2026-10-21); https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (2026-04-23).

| Limit | Workers Free |
|---|---|
| Requests | 100,000 per day per account, resets at midnight UTC; on excess Cloudflare returns Error 1027 (fail closed) or bypasses the Worker (fail open, route mode) |
| CPU time per HTTP request | 10 ms (waiting on `fetch`/database does NOT count) |
| CPU time per Cron Trigger | 10 ms |
| Subrequests per invocation | 50 (each redirect hop counts) |
| Simultaneous outgoing connections per request | 6 |
| Memory | 128 MB per isolate |
| Startup | 1 s for global scope |
| Variables per Worker (secrets + text) | 64, each 5 KB |
| Cron Triggers per account | 5 |
| Static asset files per Worker version | 20,000 |

- A lead request makes about 3 subrequests (Turnstile siteverify, Supabase insert, Telegram, plus Resend = 4), so 50 is no constraint; the real constraint is 10 ms CPU: JSON parse, zod validation, HMAC hashing and `JSON.stringify` are cheap, but avoid heavy loops, large regexes, big libraries, or `console.log` of large objects. The docs say typical auth/SSR Workers use 10-20 ms, i.e. close to the limit, so keep the handler lean and measure `cpu time` in Workers Logs after the first deploy (`unknown` until measured).
- Static asset requests are free and unlimited; Worker invocations (the form POST, `/go/*`, health, beacon, uptime pings) are billable and share the 100,000/day pool. The uptime monitor ping rate counts (section B).
- Cloudflare also warns (billing page) that with `run_worker_first` on Free, requests matching those patterns return 429 after the cap.

---

## Cross-check summary against the task list

| Item | Status |
|---|---|
| A1 Astro/adapter | done; installed-source check of `_headers` merge; Vitest alias needed for `cloudflare:workers` |
| A2 Turnstile | done; test keys copied exactly from the official page |
| A3 Web Analytics | done; workers.dev support `unknown` |
| A4 Supabase | done; header correction (apikey only) |
| A5 Telegram | done; exact 400/403 wording `unknown` (not in official docs) |
| A6 Resend + email | done; new finding: Cloudflare Email Service outbound exists |
| A7 Workers Free limits | done |

---

# SECTION B - Uptime monitors (technical sources; owner-facing text is `docs/UPTIME_MONITOR_OPTIONS.md`)

All verified 2026-10-21 from the vendors' own pages (read live). Decision context: D-039 (home page + `GET /api/health`, alerts to BOTH Telegram and email, free tier, owner approves and signs up, OT-44).

## TP-B1 UptimeRobot

Sources: https://uptimerobot.com/pricing/ and its machine-readable copy https://uptimerobot.com/pricing.md ; terms https://uptimerobot.com/terms/ (changelog: 2026-05-26 "Added Fair Use Policy; updated Services Provided and No Resale or Redistribution of Service"); https://uptimerobot.com/terms-fair-use .

- Free plan: EUR 0; **50 monitors; 5-minute check interval**; HTTP, port, ping and keyword monitors; "Only 5 integrations": Google Chat, Discord, Pushover, Pushbullet, Splunk; 1 basic status page; data retention **3 months**; mobile app (iOS/Android) on every plan; platform API on every plan; two-factor authentication on every plan; "No credit card required" (pricing page tagline).
- **Telegram is NOT on Free.** `pricing.md`: Solo adds "Slack, Mattermost, Telegram, MS Teams" (9 integrations); Free has 5 (above). Email alert contacts are a personal channel ("Email, SMS, Voice call, Email2SMS ... available to all team members"; the page's check-mark cells are blank in the Markdown copy, so on Free treat email as expected-present and confirm on the sign-up screen). SMS/voice credits are not included on Free (one-time purchase possible).
- Free lacks: API monitoring, UDP, multi-location, slow-response alerts, DNS, SSL/domain-expiry, **heartbeat monitoring**, **custom headers and statuses**, maintenance windows, recurring/prolonging notifications.
- Commercial use: Terms of Service: "UptimeRobot is available for any use, including commercial and business use", subject to the Fair Use Policy (no multi-account abuse, no circumventing limits; "reduction of monitor or notification capacity" possible for accounts whose use looks inconsistent). The pricing page blurb for Free says "Good for hobby and non-profit projects". The two statements conflict in tone; the legally operative terms permit commercial use. Re-check before relying: this was non-commercial-only in earlier years to my knowledge (not verified here), the current text no longer says so.
- Card: none for Free per the page. Paid prices not needed.
- Health endpoint fit: 5-minute interval on a Worker `/api/health` = at most 288 requests/day.

## TP-B2 Better Stack (Better Uptime)

Sources: https://betterstack.com/pricing (Markdown copy) ; https://betterstack.com/docs/uptime/check-frequency/ ; https://betterstack.com/terms .

- Free tier ("Free for personal projects ($0/month)"): **10 monitors & heartbeats** (shared), 1 status page, **"Slack & e-mail alerts"**; plus telemetry allowances (not relevant).
- **Check frequency: "from 3 minutes for free plans to 30 seconds for paid plans".**
- Alert channels on paid uptime: phone calls, SMS, push, e-mail, Slack, MS Teams, Zapier, webhooks, REST API. **No native Telegram** found in the pricing page or docs index (a Telegram route would need Webhooks, which the page lists as a paid Uptime feature); `unknown` whether any Free workaround exists.
- HTTP(S) keyword checks are listed under uptime features. Free-plan data retention for uptime: `unknown` (the page gives retention only for telemetry products).
- Commercial use on Free: pricing says "personal projects"; the Terms of Service text contains no free-plan clause either way (`unknown`/ambiguous). Card at sign-up: `unknown` (not stated on the pricing page).

## TP-B3 Cloudflare own options

Sources: https://developers.cloudflare.com/health-checks/ (updated 2026-08-14) ; https://developers.cloudflare.com/notifications/notification-available/ (updated 2026-10-20).

- **Standalone Health Checks are not available on the Free plan**: table "Free: Availability No, Number of checks 0; Pro 10; Business 50; Enterprise 1,000". The page notes the functionality is now part of "Smart Shield".
- Platform Notifications are pre-built alert types (billing usage, DDoS, certificate expiry, Pages deploy events, Health Check status and so on); none of them is an external uptime check of a Workers hostname on the Free plan. (Health Checks status notification requires Health Checks.)
- Conclusion: Cloudflare alone cannot be the monitor on Free. The D-008 Cron Trigger plan is not a monitor either: it runs inside the platform being watched (shared fate) and the Free plan has only 5 Cron Triggers per account (VF-A29, https://developers.cloudflare.com/workers/platform/limits/).

## TP-B4 One more credible option: HetrixTools Uptime Monitor

Sources: https://hetrixtools.com/pricing/uptime-monitor/ ; https://hetrixtools.com/terms-of-service/ ; https://docs.hetrixtools.com/telegram-integration/ ; https://docs.hetrixtools.com/add-a-website-uptime-monitor/ ; https://docs.hetrixtools.com/free-accounts-inactivity/ .

- Free: "$0 forever" ("Free for life"); **15 uptime monitors** (+15 server monitors); "Checkup frequency: Every minute on every plan"; **4 of 12 locations**; 15-day activity log (uptime report history "Unlimited ... on every plan"); public status pages and weekly/monthly reports on every plan; normal support (tickets answered "within 24 hours" for free users, paying users first).
- **Alerts "on every plan"**: Email, Phone calls, SMS, **Telegram**, Slack, Discord, Microsoft Teams, Google Chat, Mattermost, RocketChat, PagerDuty, Opsgenie, ilert, VictorOps, Jira, Pushover, Pushbullet, ntfy.sh, Webhooks. Phone/SMS need credits (none included on Free; USD 0.10 each); multiple email recipients are not on Free (one address).
- Website monitor fields (docs): name, URL, contact list, optional **keyword** ("if not found, the website will be considered offline"), locations, advanced: timeout, maximum redirects, checkup frequency, number of failed tries, number of failed locations. Whether a specific HTTP status code can be required: not stated in the page read (`unknown`); non-loading and keyword-missing count as down.
- Telegram setup (docs): search the bot `hetrixtools_bot`, press START, copy the Chat ID, paste it in the Telegram section of a Contact List, save. This is HetrixTools' own bot, so the owner's own alerts-bot token is never shared (OT-44 rule).
- **Condition on Free: log in at least once every 90 days** ("FREE for life with just one condition"); warning emails are sent near day 90 and when marked inactive; logging in reactivates. Terms 10.1: "(For free accounts only)" accounts and monitors may be disabled for inactivity. Terms 3.3: one free account per person/organisation.
- Commercial use on Free: Terms of Service contain no free-plan commercial restriction (silent) -> `unknown`; no clause forbids it either. Card at sign-up: `unknown` (not stated on the pricing page).
- Request cost: "checks every minute from all your selected locations, throughout the minute" - whether each location fires every minute is not specified; worst case 4 x 1,440 = 5,760 requests/day on a Worker health route (about 5.8% of the 100,000/day Free pool, VF-A10). The home page is a static asset (free, unmetered, TP-A7).

## Comparison against D-039 criteria

| Criterion | UptimeRobot Free | Better Stack Free | Cloudflare Health Checks | HetrixTools Free |
|---|---|---|---|---|
| Free | yes | yes | no (Pro+) | yes |
| Monitors | 50 | 10 (+heartbeats) | 0 | 15 |
| Interval | 5 min | 3 min | n/a | 1 min |
| Telegram on free | no | no | n/a | yes |
| Email on free | yes (expected, confirm) | yes | n/a | yes |
| Keyword | yes | yes | n/a | yes |
| Commercial use on free | terms yes; pricing blurb says hobby | "personal projects"; terms silent | n/a | terms silent |
| Card to sign up | "No credit card required" | unknown | n/a | unknown |
| Retention | 3 months | unknown | n/a | 15-day activity log |

Recommendation (owner approves; D-039): **HetrixTools Free** (only option with Telegram AND email on Free); UptimeRobot Free is the fallback if the owner accepts email plus phone-app push without Telegram. Risks to carry into the decision record: 90-day login rule, terms silent on commercial use, card requirement unknown, monitor service is a third party that may change its Free plan.

Drill (D-039 test): make the monitored health URL fail once (for example a deploy that returns 503, or temporarily point the monitor keyword at a word that is absent) and confirm both Telegram and email arrive; with HetrixTools the keyword route is the cleanest because it needs no code change. Real alert-delivery time to the owner's phone is `unknown` until the drill.

---

# SECTION C - Razorpay website-review and Payment Link wording (re-check of VF-D1)

Sources (read 2026-10-21): https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details/ (Markdown copy `.md`), https://razorpay.com/docs/payments/payment-links/faqs.md . The M1 manual payment path (Payment Link created in the Dashboard and sent to the customer, no live API keys) depends on these.

Result: **VF-D1's wording still holds; nothing contradicts it.** Details and small additions:

- Business Website Details (the live-key website review): "You must provide your live website or mobile app details during account activation. Without these details, you will not be able to access live mode API keys and hence cannot accept payments from your website or app." Immediately followed by: "**You can still accept payments from customers using Invoices and Payment Links generated via the Dashboard.**" (new explicit sentence: the Dashboard-made Payment Link path does not need the website review or live API keys; it still needs an activated Razorpay account, see below).
- Website owner steps (unchanged): Website URL; links for **About us, Contact us, Pricing details, Terms and conditions, Privacy policy, Refunds policy**; **upload a sample invoice (PNG, JPG or PDF)**; test-account credentials only if the site needs a login to pay (otherwise answer "No" to the login question); "Submit website for review". For ADDITIONAL websites the sixth page is named "Cancellation/Refund policy", a reason of at least 50 words is required, review is manual, and the feature "is available only if your services/products fall under the e-commerce business category". One main website plus five additional ones are allowed.
- For the primary website, "instant checks are run to validate your website, policy pages and business industry. In case the website requirements are not met, you can re-check and enter the valid URLs as prompted or create policy pages with Razorpay." So the pages must exist and be publicly reachable when the review is submitted. How Razorpay's checker fetches them, and whether a `workers.dev` preview URL or a site that is still `noindex` (until G1) passes, is `unknown` (the doc does not say); treat submitting before the real domain is live as a risk to test with the owner. Razorpay "may reach out ... via email, WhatsApp, SMS and Dashboard".
- No Shipping/Delivery page is in the official list (unchanged from VF-D1; keep the Delivery page anyway).
- **What the sample invoice must contain: `unknown`.** The official page gives only the accepted formats. (A Razorpay learning article lists seller name/address/contact, tax ID, invoice number, itemised lines, total with tax, but that is general invoicing advice, not a stated review rule.) M1 invoice template must not carry made-up prices: use the owner's supplied package names with price fields clearly marked as an illustrative sample only if the owner agrees; `TODO(owner)` must not appear in the uploaded file either.
- Payment Links FAQ (re-read): "You do not need a website or mobile app to use Payment Links" (create in Dashboard, send by SMS/email, customer pays); fixed amounts only; one-time only; no direct WhatsApp integration (SMS and email notifications only, `notify` flags in the API); cannot cancel a link in `paid` or `partially_paid` state (only `issued`); a "Report Payment Link" option is shown by default; **customer email and phone entered at link creation are NOT auto-filled on the hosted page ("as per our updated security policy")**, the customer types them again; **Razorpay cannot send an invoice automatically after payment via Payment Links** ("You need to handle invoice generation on your end after receiving payment confirmation"); support details (phone, email, website/contact link) can be shown on the link under Account & Settings > Business settings > Customer support details.
- Still undocumented (unchanged from VF-D1): whether live Payment Links can be created while KYC activation is still pending. M1 should not promise it.
- Implication for M1 copy: the `/pricing` page's "pay by Payment Link" text should say the link arrives by SMS/email (not WhatsApp automatically) and that the customer re-enters contact details; the owner sends the link by hand (WhatsApp paste is manual and allowed, the restriction is only on Razorpay's own WhatsApp integration).
