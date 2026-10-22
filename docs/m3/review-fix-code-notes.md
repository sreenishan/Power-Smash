# Review fix wave: code defects (2026-10-22)

Four defects from the independent security review of the Vercel port, fixed in `src/`, `tests/` and `astro.config.mjs` only. No commit, no push. Plain notes.

## FIX 1: the baked `PUBLIC_SUPABASE_URL` was invisible to three runtime readers

Problem: `SUPABASE_URL` is a Vercel runtime variable, but `PUBLIC_SUPABASE_URL` is a GitHub BUILD variable (inlined into the bundle, not in the function's environment). `getLeadConfig` fell back to the inlined value, so `/api/health` said `"lead":"ready"`. Three other readers looked only at `process.env` and went dead without saying so: the `/go` click log (`src/lib/infra/go-handler.ts`), the database sponsor links (`src/lib/infra/go-sponsor-links.ts`) and the admin API (`src/pages/api/admin/[action].ts` -> `src/lib/admin/config.ts`, answered 503).

Change:
- `src/lib/runtime-env.ts`: new `bakedPublicSupabaseUrl()` (the plain expression `import.meta.env.PUBLIC_SUPABASE_URL`, trimmed, blank = undefined) and `withBakedSupabaseUrl(source, baked?)` (returns a COPY of the source with `PUBLIC_SUPABASE_URL` filled from the baked value only when neither `SUPABASE_URL` nor `PUBLIC_SUPABASE_URL` is set at run time; never writes to `process.env`; invents nothing when there is no baked value).
- `getRuntimeEnv()` now runs `pick(withBakedSupabaseUrl(process.env))`. That fixes the `/go` click log and the sponsor links (both read `getRuntimeEnv()` in `src/pages/go/[slug].ts`) without touching them.
- `src/pages/api/admin/[action].ts`: `readEnv()` returns `withBakedSupabaseUrl(process.env)`.
- `getLeadConfig` is unchanged (still passes the same build-time fallbacks; the result is identical because the precedence is the same).

Tests: `tests/lib/runtime-env-baked.test.ts` (precedence rule: baked fills only when no runtime URL, never overrides `SUPABASE_URL` or a runtime `PUBLIC_SUPABASE_URL`, blank runtime = unset, nothing invented, copy not mutation, the result passes `isAcceptableSupabaseUrl`; the three readers (`createGoDeps`, `resolveGoData`, `buildAdminDeps`) work from the baked value and the runtime URL still wins; a baked non-https URL still gives a null admin config; `getLeadConfig` behaviour unchanged; a source guard that the admin route uses the helper).

Needs a preview to prove: under vitest `vi.stubEnv` writes both `import.meta.env` and `process.env`, so the true split (value baked into the bundle, absent from the function's environment) cannot be reproduced. The helper and the rule are proven; the end-to-end proof is a Vercel preview built with `PUBLIC_SUPABASE_URL` as a build variable and no runtime `SUPABASE_URL`: then `/go/<sponsor slug>` should log clicks and `/api/admin/...` should answer 401, not 503.

Supporting evidence from the build: in the built chunk `runtime-env_*.mjs` the build-time public values are literals (`publicWhatsappNumber: "910000000000"`, `publicSiteUrl: "http://localhost:4321"`) and the new default is `baked = void 0` (the Supabase URL is unset in this build). So Vite does inline `import.meta.env.PUBLIC_*` inside the function bundle; with `PUBLIC_SUPABASE_URL` set at build time the same spot becomes the literal URL.

## FIX 2: `waitUntil` had no fallback

Problem: `afterResponse` wraps `@vercel/functions` `waitUntil`, which returns undefined silently without a request context (`globalThis[Symbol.for('@vercel/request-context')]`). `/api/lead` always passed it, so the handler never awaited the owner alert: with no context (or a function frozen early) the lead was stored and the Telegram or email alert lost.

Change:
- `src/lib/after-response.ts`: `hasRequestContext()` (true only when the symbol context exists and `.get()?.waitUntil` is a function; never throws) and `afterResponseIfAvailable()` (returns `afterResponse` or `undefined`).
- `src/pages/api/lead.ts`, `src/pages/api/placements.ts`, `src/pages/go/[slug].ts` now pass `waitUntil: afterResponseIfAvailable()`.
- `src/lib/infra/go-handler.ts`: `waitUntil` is optional in `GoDeps` and in the `createGoDeps` parts. When absent (or when it throws) `handleGo` awaits the click log before returning the 302; `click()` never rejects and an extra `.catch` guards it, so a logging failure still cannot break the redirect.
- `src/pages/api/event.ts` and `src/pages/api/placement-beacon.ts`: no change needed. Their handlers (`src/lib/leads/event-handler.ts`, `src/lib/placements/beacon.ts`) take no `waitUntil` and run no un-awaited work, so they already await everything. A source test pins that.
- Lead handler (`src/lib/leads/handler.ts`, unchanged): with no `waitUntil` it already awaits the alert (`runLater` returns the promise). One side effect: the occasional rate-counter purge is guarded by `deps.waitUntil` and is skipped when there is no context. On Vercel a context exists, so it still runs there.
- Placements handler (`api-handler.ts`, unchanged): already awaits the cache write when `waitUntil` is absent.

Tests: `tests/lib/after-response.test.ts` (context detection incl. malformed and throwing contexts, `afterResponseIfAvailable`, `afterResponse` swallows rejections and a throwing `waitUntil`, source guards: no route passes the bare `afterResponse`, lead/placements/go use `afterResponseIfAvailable`, event and beacon code has no `waitUntil`), `tests/leads/routes.test.ts` (lead route: with a context the alert goes to `waitUntil`; with none the alert is already sent when `POST` returns), `tests/infra/go-handler.test.ts` (no `waitUntil`: click logged before the redirect; failure still redirects; a throwing `waitUntil` treated as absent; `createGoDeps` keeps it optional), `tests/infra/go-route-context.test.ts` (the real `/go/[slug]` route with one fictional link: no context = click written before the 302; context = handed to `waitUntil`; database down still redirects), `tests/mocks/request-context.ts` (helper that installs a fake Vercel context).

Behaviour change the owner should know: when a function has no request context the visitor waits for the owner alert (`/api/lead`: for as long as the Telegram and email calls take) or the click log (`/go/*`: one database insert, capped by the 6 s database timeout in `src/lib/supabase/rest.ts`) before the answer. With Vercel's real context nothing changes. Not proven here: that Vercel's Node runtime really sets `globalThis[Symbol.for('@vercel/request-context')]` for these functions (it is what `@vercel/functions` itself reads). A preview should confirm that a lead alert still arrives and that `waitUntil` is the path taken.

## FIX 3: `/api/placements` cache bypass

Problem: no `caches.default` on Node, so the route passed `cache: null`. The Vercel CDN keys by the full URL, so `?x=<random>` ran the function and read the database every time.

Change: `src/lib/placements/memory-cache.ts` (new): `createMemoryCache({ now, ttlMs, maxEntries, maxBodyChars })` returning a `CacheLike`: 60 s TTL by default, injected clock, at most 8 entries (expired ones cleared first, then the oldest dropped), no non-200, no non-GET, no body over 256 KiB, a fresh `Response` per match. `src/pages/api/placements.ts` keeps one module-level instance and uses it when `caches.default` is absent, so the handler's existing query-ignoring key applies. HEAD (answered from the cache, never fills it) and 503-not-cached are unchanged handler behaviour and are tested on top of the new cache.

Tests: `tests/placements/memory-cache.test.ts` (hit, fresh response per match, expiry with a fake clock at 59,999 and 60,000 ms, re-put restarts the clock, size cap, expired-first eviction, errors/HEAD/oversize not stored, delete and `purgePlacementsCache`; handler on top of it: 20 random query strings read the database once, same body and headers on a hit, re-read after 60 s, 503 never cached, HEAD warm and cold, 405; the real route file: random query strings reach the database once, a 500 gives 503 every time, `caches.default` is preferred when present).

Behaviour change: the schedule can be up to 60 s stale per function instance after an admin edit (the CDN already allowed 5 minutes; `purgePlacementsCache` is not called anywhere yet).

## FIX 4: `/_image`

`astro:assets`, `<Image>`, `<Picture>`, `getImage` and `/_image` appear nowhere in `src/` (checked by grep and pinned by a test), so the endpoint is unused. `astro.config.mjs` now sets `image.endpoint.entrypoint` to `src/lib/infra/image-endpoint-disabled.ts`, which answers 404 (`no-store`, noindex) to every method and imports no image code. Astro still lists the route, so `.vercel/output/config.json` still routes `^/_image/?$` to the function, but the function answers 404 without running sharp. `scripts/finalize-headers.ts` and `src/lib/infra/vercel-routes.ts` were not touched.

Tests: `tests/infra/image-endpoint.test.ts` (404 for GET/HEAD/POST/PUT/DELETE, no image code in the file, the config entrypoint points at an existing file, `imageService: false` kept, no use of Astro image optimisation anywhere in `src/`).

Build result (verified): `npm run build` exits 0. `.vercel/output/config.json` is unchanged in shape: the same 22 routes, including `^/_image/?$` -> `_render`. I called the built function entry (`.vercel/output/functions/_render.func/.vercel/output/server/entry.mjs`, default export `fetch(Request)`, no server started) and `/_image` answered 404 (`no-store`, text/plain) for GET with a local href, GET with a remote YouTube href and POST. `/api/health` 200, `/api/placements` 200 (GET and HEAD, `?x=` variants), `/go/anything` 404, `/api/lead` GET 405 and `/api/admin/whoami` POST 503 (no settings) all behave as before. Side effect: the function bundle no longer pulls in sharp (the `functions` folder went from 24 MB to 3.4 MB; `sharp` and `@img` are gone from `_render.func/node_modules`), so cold starts are lighter. `astro check` first reported that `image.endpoint` needs `route` next to `entrypoint`; `route: '/_image'` (Astro's default) is now written out.

## Verification (2026-10-22, all heavy commands under the heavy lock, TZ=Asia/Kolkata for the test run)
- `npx vitest run` on every touched or added test file: green (13 files, 132 tests at the first run; the image-endpoint file was re-run inside the full run after the config fix).
- `npm test`: 161 files passed, 2 skipped; 3,790 tests passed, 28 skipped, 0 failed.
- `PS_REQUIRE_DIST=1 npx vitest run tests/build`: 14 passed, 2 skipped (the two "build output must exist" guards, which only run when the output is missing).
- `npm run check`: 0 errors (the two hints are in `scripts/brand-logo.mjs` and `scripts/restore-drill.mjs`, not touched).
- `npm run build`: exit 0 (non-strict developer build).
- `npm run e2e`: 168 passed (Playwright, phone sizes 360 and 390).
- Mutation check: with the memory cache removed from the placements route, the route-level test fails, as it should.

## Not done or needs a preview
- FIX 1: the true build-time/runtime split (see above).
- FIX 2: that Vercel sets the request context symbol on these functions (see above).
- `npm run build:strict` was not run (it fails on purpose while owner inputs are missing); none of these changes touch what it checks.
