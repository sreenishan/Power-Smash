# M1 Lead-backend notes (Lead-backend worker)

Date: 2026-10-21. Scope: the lead endpoint, notifications, events, health, the database migration, the anon harness and their tests. No account was created, no real secret or real vendor call was used, nothing was committed, pushed or deployed, and no migration was run. Everything external is exercised only with a mocked `fetch` and fake values.

Results at hand-over: `npm test` 57 files / 1472 tests green (my part: 16 files / 218 tests in `tests/leads`, `tests/security`, `tests/notify`, `tests/supabase`); locked `npm run check` 0 errors; locked `npm run build` succeeds and the server bundle contains the three endpoints (`lead`, `event`, `health` chunks); a scan of `dist/client` finds no `sb_secret_`, no Telegram, Resend or siteverify URL.

## 1. What I built

| Area | Files |
|---|---|
| Contract (zod, types, error codes, field error mapping) | `src/lib/contracts/lead.ts`, `src/lib/contracts/lead-constants.ts` (no zod: import this from browser code), `src/lib/contracts/event.ts` |
| Lead handler (pure factory `createLeadHandler(deps)`) | `src/lib/leads/handler.ts`, `config.ts`, `store.ts`, `ref.ts` |
| Events and health | `src/lib/leads/event-handler.ts`, `src/lib/leads/health.ts` |
| Notifications | `src/lib/notify/telegram.ts`, `email.ts`, `alerts.ts` |
| Security helpers | `src/lib/security/text.ts` (sanitisers, phone, email, https URL, CSV cell), `hash.ts` (HMAC pseudonyms), `ratelimit.ts`, `turnstile.ts` |
| Supabase REST client | `src/lib/supabase/rest.ts` |
| Runtime environment | `src/lib/runtime-env.ts` (+ `src/lib/cloudflare-workers.d.ts`, a 3-line ambient type for `cloudflare:workers`) |
| Routes (thin wrappers, `prerender = false`) | `src/pages/api/lead.ts`, `event.ts`, `health.ts` (the G0 health stub was replaced) |
| Database | `supabase/migrations/0001_lead_funnel.sql`, `supabase/checks/0001_assertions.sql`, `supabase/README.md` |
| Anon harness | `scripts/anon-harness.mjs` |
| Docs | `docs/m1/leads-api.md` (request/response shapes for the Forms worker), this file |
| `.env.example` | appended "GROUP 9" (names only): `EMAIL_ENABLED`, `TURNSTILE_EXPECTED_HOSTNAMES`, `TURNSTILE_EXPECTED_ACTION`, `SUPABASE_URL`, and the `HMAC_KEY` format note |

The contract file was created first and changed only additively afterwards (`LeadErrorResponse.ref`, an optional field). The Forms worker imports it (types, `validateLeadRequest`, `FIELD_ERROR_MESSAGES`).

## 2. How the endpoint behaves (summary; details in `docs/m1/leads-api.md`)

Order: method, origin, content type, 20 KB body cap (streamed, not trusted from the header), JSON, zod validation, honeypot / fill time, configuration check, per-connection limit, **idempotency lookup**, Turnstile (fail closed), per-phone and per-email limit, insert, owner alert, response.

- **Idempotency before Turnstile** because a Turnstile token works once (`timeout-or-duplicate` on replay): a retry with the same `idempotencyKey` and the same contact returns the same `ref` (HTTP 200, `replay: true`) without calling Turnstile, creating a row or alerting twice. The same key with a different contact is `duplicate` (409). Two identical requests racing are settled by the `leads_idempotency_key_uq` constraint.
- **Reference code** `PS-<IST year>-<6 chars>`: 30 random bits from the injected random source (`crypto.getRandomValues` in production), Crockford base32 without I L O U, never sequential; a collision on `leads_ref_code_uq` retries with a new suffix (up to 4 times).
- **What is stored**: the contract fields in `leads` columns, kind-specific fields in `payload` jsonb, consent id/version/timestamp, a pseudonymous IP hash (`kid.<32 hex>`, HMAC of the IPv4 or the IPv6 /64), `alert_state`. The raw IP, the Turnstile token and the request body are never stored or logged. A DB trigger writes the `created` row of `lead_events`.
- **Tournament listing with the coverage box ticked** also creates a linked coverage lead (own reference, deterministic idempotency key so a retry cannot duplicate it, `parent_lead_id` set); the owner is alerted once for both.
- **Logs** are JSON lines with only: outcome, error code, kind, reference, correlation id, HTTP status. A test spies on every `console` method across success, database failure, Telegram failure and validation failure and asserts that no name, phone, email, IP, token, secret, Telegram URL or note appears.
- **Supabase secret key** goes on the `apikey` header only, never on `Authorization` (docs/m1/third-party-integration-facts.md TP-A4; https://supabase.com/docs/guides/api/api-keys). Two tests assert it: `tests/leads/handler.test.ts` ("uses the secret key on the apikey header only") checks every outgoing call and that no other header contains the key; `tests/supabase/rest.test.ts` checks the client for every verb. Inserts use `Prefer: return=minimal`.
- **Health** (`GET`/`HEAD /api/health`) makes no outbound call and no database access of any kind (no read either: D-039 does not ask for one). Tests: a `fetch` spy is never called, and a source scan finds no `fetch(`, Supabase or write call in the two health files. It answers 200 always, with `{ok, service, lead}` where `lead` is `ready` or `unconfigured` (secrets missing), so a keyword monitor can alert on `unconfigured`.
- **Events** (`POST /api/event`): six allow-listed names (`whatsapp_click`, `share_click`, `form_start`, `form_submit`, `form_error`, `outbound_click`), per-event allow-listed props with slug-like values only (a phone, email, name or 6+ digit run cannot ride along), bare paths only (no query string), `is_bot` flag, per-connection rate limit, session hash from a random daily salt kept 48 hours in `daily_salts` (D-029), 204 on success, `text/plain` accepted for `sendBeacon`.

### Degraded modes (what I chose and why)

The rule is: a lead is never lost silently, and the visitor always has a way to reach the owner.

1. **Database cannot store the lead** (insert fails, DB down, secret missing): HTTP 503 `degraded` with the WhatsApp fallback link (`waLink`), a *provisional* `ref` quoted in the WhatsApp text, and a correlation id. In parallel the owner gets a Telegram alert (and an email if email is on) marked `LEAD NOT SAVED (database problem)` with the same minimal content and the customer's WhatsApp link, so the owner can follow up even though nothing is in the database. Why 503 and not a fake success: the visitor must not believe a stored enquiry exists; the form keeps the typed data and offers WhatsApp now. The alert is only sent after Turnstile passed, so a spammer cannot trigger it. If Telegram is also down, a `degraded_unalerted` log line records it.
2. **Database fine, Telegram (and email) fail**: the lead is saved and the visitor gets success. The row is marked `alert_state = 'failed'` (indexed, visible in Supabase Studio) and a `lead_events` row `alert_failed` is added. Telegram is retried once on network/5xx errors. With `EMAIL_ENABLED=true` the owner email is an independent second channel, so the lead is only `failed` if every configured channel failed.
3. **Rate-limit counters unavailable**: fail open (do not block a lead); the insert then shows whether the database is really down.
4. **Turnstile unreachable or wrong**: fail closed (`turnstile` code, WhatsApp link included), nothing stored, nobody alerted.
5. **Unconfigured endpoint** (no Supabase, Turnstile secret or `HMAC_KEY`): `degraded` with the WhatsApp link, no alert (nothing can be verified), and `/api/health` reports `lead: "unconfigured"`.

Not built (follow-up for M2a, which needs the custom Worker entry for crons anyway): a job that re-sends alerts for rows with `alert_state <> 'sent'`. The data to drive it exists (column, partial index, events). Until then the owner finds failed alerts in Studio.

## 3. Deviations from the brief, spec and plan

| # | Deviation | Why |
|---|---|---|
| 1 | Telegram text is **plain text, no `parse_mode`** (the brief said HTML escaping). | D-029: "Telegram text is plain (no parse mode)". Nothing to escape or inject; visitor values reduced to a letters-only first name and a one-line district. |
| 2 | The Telegram "deep link" of D-029 is taken to be the **customer's `wa.me` link** (built with `waLink()`), which contains the customer's phone number inside the URL. | Spec 8.1 and the brief want a one-tap reply link. Alternative if the owner objects: an admin deep link (M3) and no number in Telegram. Open question 1. |
| 3 | Private tables are in schema `public`, not `api`. | The Worker reaches them with the secret key; `api` is for public views (D-005). Requires `public` to stay in the project's exposed schemas, otherwise add `Content-Profile` headers (supabase/README.md). |
| 4 | `status`, `type`, `alert_state` are `text` with CHECK constraints, not Postgres enum types. | Easier additive changes (no `ALTER TYPE`). |
| 5 | `leads.type` accepts `tournament_submission` (not in spec 11.2's list). | Tournament listings are stored as leads until the M3 tournament queue. |
| 6 | Migration file is `0001_lead_funnel.sql` (the brief's name), not a timestamp. | The CLI accepts it; rename before the first push if timestamps are preferred. |
| 7 | Consent version is stored **as supplied** by the form if it is plausible (`^[A-Za-z0-9._-]{1,40}$`) and the id is `lead-notice`; it is not pinned to the current version. | An open tab from before a text change must not lose a lead. The stored value is what the form says it showed. |
| 8 | Honeypot hit returns a normal success **with a WhatsApp link** and stores nothing. | Browser autofill can fill a hidden field; a real person still gets a way to reach us. |
| 9 | The fill-time check uses the client-reported `elapsedMs` and answers `rate_limited` (retry works). Absent value = no check. | A client value is spoofable, but bots are lazy, and a false positive costs a few seconds, not a lead. |
| 10 | Coverage `startDate` is optional in the contract; D-025 says the form should require it. | Loosening later is breaking, tightening is not: the Forms worker enforces it in the UI. |
| 11 | `noindex` and `no-store` on every API response; `/api/health` returns an extra word `lead`. | D-029, D-039 ("minimal status") with one operational word. |
| 12 | Telegram 429 is not retried (the research note suggests one retry after a short wait). | Volume is one chat at lead rates; the email channel covers it; a retry would add latency inside the visitor's request. |

## 4. Proposed decisions (for the lead to record in DECISIONS.md)

**P1 Lead degraded mode (new).** Context: spec 12.7 and D-029 ask for no silent loss and a WhatsApp fallback. Decision: section 2 "Degraded modes" above (503 plus provisional reference plus WhatsApp link when the lead cannot be stored; success plus `alert_state='failed'` when only the alert fails; fail closed on Turnstile; fail open on counters). Consequences: the owner may receive an alert for a lead that is not in the database and must reply on WhatsApp; the `degraded` alert is not deduplicated against a retry that later succeeds (the reference differs).

**P2 Rate limits and hashing (new).** Decision: per connection (HMAC of IPv4 or IPv6 /64) 20 per hour in the database counter plus the optional Workers Rate Limiting binding; per phone 3 an hour and 8 a day; per email 3 an hour and 8 a day; one acknowledgement mail per address per 24 hours; counter rows older than 2 days purged opportunistically. These are engineering defaults, not business facts (India's carrier NAT puts many people behind one IP, so the IP limit is generous). Hashes are HMAC-SHA-256 with `HMAC_KEY` = `<key id>:<random secret of at least 32 characters>`, output `kid.<32 hex>` (128 bits), documented as pseudonymous. Consequence: tune the numbers after real traffic; the rules are constants in `src/lib/security/ratelimit.ts`.

**P3 Private tables and the REST exposure (new).** Decision: the M1 private tables live in `public` with RLS, no policies, all privileges revoked from `public`/`anon`/`authenticated`, and explicit grants to `service_role` only (leads: select, insert, update; no delete, retention anonymises). The exposed-schema setting must keep `public`. Consequence: `scripts/anon-harness.mjs` and `supabase/checks/0001_assertions.sql` are the guard; add every future table to both.

**P4 Owner alert email via Cloudflare (optional, from the Research worker).** The notify code keeps the owner alert behind one function (`notifyNewLead`); if the lead adopts Cloudflare's `send_email` binding for owner mail (free to a verified address, TP-A6b), only `alerts.ts` changes.

## 5. What the lead applies once OT-03 exists (the dev Supabase project)

Nothing was run. Full steps are in `supabase/README.md`. In short:

1. Owner creates `powersmash-dev` (Mumbai) and keeps `public` in Project Settings, API, Exposed schemas.
2. Apply `supabase/migrations/0001_lead_funnel.sql` to the DEV project: dashboard SQL editor (simplest, works from a phone), or `npx supabase link --project-ref <dev ref>` then `npx supabase db push` (`.npmrc` has `ignore-scripts=true`, so the CLI's binary download needs a decision first; `db push` needs no Docker, VF-B15).
3. Run `supabase/checks/0001_assertions.sql` in the SQL editor: it must return `ok: 0001_lead_funnel assertions passed`.
4. Run `node scripts/anon-harness.mjs` with the dev URL and the **publishable** key only (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`): exit code 0 and "RESULT: 0 leaks". It refuses any key that is not `sb_publishable_...`.
5. Only then production (OT-27).

The SQL itself is untested against a real Postgres (no Docker here): it is covered by static tests on its text and by the assertions script, which is the real check. Review the SQL once on dev.

## 6. Exact names the endpoints read

Worker secrets or variables (read through `import('cloudflare:workers')`, falling back to `process.env`; `src/lib/runtime-env.ts`): `SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `HMAC_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_EMAIL`, `EMAIL_ENABLED` (exactly `true` to enable email; unset until the domain is verified), `PUBLIC_WHATSAPP_NUMBER`, `PUBLIC_SITE_URL`, `PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`), optional `TURNSTILE_EXPECTED_HOSTNAMES` (comma list; default is the request hostname), optional `TURNSTILE_EXPECTED_ACTION` (default `lead`; `-` skips). `PUBLIC_WHATSAPP_NUMBER`, `PUBLIC_SUPABASE_URL` and `PUBLIC_SITE_URL` also fall back to the build-time `import.meta.env` value.
Optional bindings: `LEAD_RATE_LIMITER`, `EVENT_RATE_LIMITER` (Workers Rate Limiting). Not a secret; add to `wrangler.jsonc` (lead-owned file). Syntax checked 2026-10-21 at https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ (needs Wrangler 4.36+, installed 4.150; `period` must be 10 or 60; "permissive, eventually consistent"):

```jsonc
"ratelimits": [
  { "name": "LEAD_RATE_LIMITER",  "namespace_id": "1001", "simple": { "limit": 5,  "period": 60 } },
  { "name": "EVENT_RATE_LIMITER", "namespace_id": "1002", "simple": { "limit": 60, "period": 60 } }
]
```

`HMAC_KEY` format: `<key id>:<random secret, at least 32 characters>`, for example `k1:` plus 32 random bytes in base64url (the owner generates and enters it, `docs/SECRETS.md`). With Cloudflare's published Turnstile test secrets the hostname and action checks are skipped automatically. The local `.dev.vars` file holds dev values (never `.env`, see the Research note on `.dev.vars` vs `.env`).

## 7. Facts verified (official sources, 2026-10-21)

- Turnstile siteverify: POST `https://challenges.cloudflare.com/turnstile/v0/siteverify`, JSON accepted, token max 2,048 characters, valid 300 seconds, single use, response fields `success`, `hostname`, `action`, `error-codes`: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/. Test secrets and the dummy answer (hostname `localhost`, action `test`): https://developers.cloudflare.com/turnstile/troubleshooting/testing/.
- Telegram `sendMessage`: `text` 1-4,096 characters, `link_preview_options.is_disabled`, 429 carries `parameters.retry_after`: https://core.telegram.org/bots/api#sendmessage.
- Resend: POST `https://api.resend.com/emails`, Bearer key, `Idempotency-Key` (max 256 characters, 24 hours), 409 on idempotency conflict, 429 rate limit: https://resend.com/docs/api-reference/emails/send-email. I also send a `User-Agent` header (harmless; the docs do not require one).
- Astro adapter: `import { env } from 'cloudflare:workers'`; `Astro.locals.runtime` removed; `locals.cfContext.waitUntil` exists in adapter 14.3.4 (read from `node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.d.ts`): https://docs.astro.build/en/guides/integrations-guide/cloudflare/.
- Supabase: secret key on `apikey` only (https://supabase.com/docs/guides/api/api-keys); PostgREST unique violation is HTTP 409 with code `23505` and a `details` text that echoes the values, so errors are reduced to status, code and constraint name (research TP-A4).
- Workers Free: 10 ms CPU per request, 50 subrequests (research TP-A7). A lead request makes roughly 10 to 18 subrequests (rate counters, lookup, Turnstile, insert, alert, state update); CPU time is **not measured**: measure in Workers Logs after the first preview deploy (research item 5). If it is tight, drop the database IP counter and rely on the binding.

## 8. Open owner questions

1. May the Telegram alert carry the customer's WhatsApp link (which contains their phone number) as the one-tap reply (deviation 2)? Telegram is a private 1:1 chat with the owner.
2. Is "within 24 hours" (the Appendix D template) still the promise the acknowledgement email should make once email is on? It is a parameter (`replyWindow`).
3. After the domain is verified, should the owner alert email go through Resend (as built) or Cloudflare's free `send_email` to the owner's verified address (research P4)?
4. Which uptime monitor (OT-44): the monitor should call `GET /api/health` and, if it supports keywords, alert when the body contains `unconfigured`.

## 9. Requests for other workers and the lead

- **Lead:** add the `ratelimits` bindings above to `wrangler.jsonc` (optional but recommended); decide how the Supabase CLI binary is allowed under `ignore-scripts=true`; add the CHANGELOG entry and decision records (P1 to P4, deviations 1 to 3); consider the retention jobs of D-028 (events and outbound clicks 90 days then aggregated, leads anonymised after 24 months, nothing builds them yet); consider the `retryFailedAlerts` job at M2a.
- **Lead / Infra:** CSP needs no extra `connect-src` for these endpoints (same origin); all external calls (Turnstile siteverify, Telegram, Resend, Supabase) are server-side only. The client bundle for the forms includes zod through `validateLeadRequest` (the `LeadForm` chunk is 29 KB raw, 9.7 KB gzip in this build): check against the 80 KB budget.
- **Lead / Infra:** `src/lib/cloudflare-workers.d.ts` is a minimal ambient declaration of `cloudflare:workers`; delete it if `wrangler types` output is adopted (a duplicate declaration would conflict).
- **Forms worker:** read `docs/m1/leads-api.md`. Render the Turnstile widget with `data-action="lead"`; keep the same `idempotencyKey` on every retry of the same submission (including after `turnstile`, `rate_limited` and `degraded` errors) and reset the widget for a fresh token; send `elapsedMs` only if measured from the first interaction; the honeypot field is named `website`; show `waLink` from the response (never build your own for the confirmation); on `degraded` show the WhatsApp link and keep the typed data.
- **Whoever builds `/go/[slug]`:** the `outbound_clicks` table and its grant (service_role insert only) exist; columns `go_slug`, `target_type`, `target_id`, `page_path`, `utm`, `ua_hash`, `is_bot`. `src/lib/security/hash.ts` has `pseudonym()` for the user-agent hash. I did not build `/go`.
- **Admin (M3):** use `csvSafeCell()` from `src/lib/security/text.ts` for every CSV export cell (D-029); free-text fields keep a leading `=`, `+`, `-` or `@` verbatim in the database on purpose.

## 10. Packages

None added or wanted. (Zod 4.6.7 is used as installed; WebCrypto and `fetch` are built in.)
