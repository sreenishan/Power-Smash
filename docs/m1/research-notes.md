# M1 research notes (Research worker)

Date: 2026-10-21. Scope: read-only research, no code, no accounts, nothing downloaded or run against any vendor. Files written: `docs/m1/third-party-integration-facts.md` (sections A, B, C), `docs/UPTIME_MONITOR_OPTIONS.md` (owner-facing), this file. Ids below (TP-A1 ... TP-B4, Section C) point into the facts file.

## 1. Things that contradict the brief, VERIFIED_FACTS, DECISIONS or repo files

| # | What I found | Contradicts | Suggested action (lead) |
|---|---|---|---|
| 1 | Supabase `sb_secret_` / `sb_publishable_` keys go on the **`apikey` header only**, never on `Authorization: Bearer` ("Send publishable and secret keys on the apikey header, not on Authorization: Bearer ... Because the keys aren't JWTs"). Source https://supabase.com/docs/guides/api/api-keys (TP-A4). | The brief item A4 ("`apikey`, `Authorization`") | Lead-backend must send only `apikey` (plus `Content-Type`, `Prefer`, `Content-Profile: api`). |
| 2 | Cloudflare now has **Email Service** with outbound "Email Sending" (Beta, Workers `send_email` binding). Arbitrary recipients need Workers Paid, but **sending to the owner's verified destination address is free on Workers Free** and sends "only from your routing domains" (TP-A6b). Email Routing itself is still inbound only. | VF-A22 ("Email Routing is free and inbound only") and the brief item A6 ("receive-only") are outdated | Consider a new decision: owner alert email via the `send_email` binding to the owner's verified address (no Resend needed for that channel, no daily quota use); Resend only for visitor-facing mail. Needs the domain on Cloudflare first (OT-07). Verify the binding's Free behaviour once the domain exists (unknown, see section 2). |
| 3 | The Turnstile test-keys page moved to `/turnstile/troubleshooting/testing/`. Key values in `.env.example` are identical to the page; only the comment URL (`/reference/testing/`) is stale (it redirects). | `.env.example` comment (cosmetic) | Update the URL in `.env.example` when the lead next edits it. |
| 4 | The Web Analytics manual beacon snippet now uses `type="module"` and `data-cf-beacon='{"token": ...}'` (no `defer`). The FAQ also says a `Referer`/`Origin` header is required: do not use `Referrer-Policy: no-referrer`. | Brief item A3 wording (`defer`) | Site-shell/Infra worker: use the snippet in TP-A3. |
| 5 | UptimeRobot Free has **no Telegram** (Solo, a paid plan, adds it). D-039 requires Telegram AND email. Only HetrixTools of the four options gives both on Free. | D-039/OT-44 candidate list (UptimeRobot, Better Stack, Cloudflare) did not include the tool that actually fits | Add HetrixTools to D-039 as the recommended candidate; owner decides. |
| 6 | UptimeRobot's Terms (changelog 2026-05-26) permit "any use, including commercial and business use", while its pricing page calls the Free plan "good for hobby and non-profit projects". | OT-44 step 1 hints at the hobby wording only | Reword OT-44 so it does not imply UptimeRobot forbids business use; both statements are quoted in `UPTIME_MONITOR_OPTIONS.md`. |
| 7 | **Cloudflare standalone Health Checks are not available on the Free plan** (0 checks). | D-039 lists "Cloudflare health checks" as a candidate | Drop it as a Free candidate (keep only as a paid option). |
| 8 | Prerendered pages are static assets, so Astro middleware does NOT run for them; `public/_headers` is the only place for their headers; the adapter prepends an immutable `/_astro/*` Cache-Control block to `_headers` unless a matching rule already sets Cache-Control (a `/*` Cache-Control rule would suppress it). | Confirms VF-A14, adds the adapter gotcha | Infra worker: do not set Cache-Control in a `/*` rule without an explicit `/_astro/*` rule (TP-A1.3). |
| 9 | Vitest cannot resolve `cloudflare:workers` without a `test.alias` or a `resolveId` plugin ("Vitest will fail transforming files if it cannot find the source of the import"). | Repo `vitest.config.ts` has neither (lead-owned) | Either keep endpoint files out of tests (pure handler + injected `env`), or the lead adds `test.alias` for `cloudflare:workers` to a mock file (TP-A1.2). |
| 10 | `.dev.vars` and `.env` are mutually exclusive for the Worker `env` object: if `.dev.vars` exists, `.env` values are not in `env`. Vite still reads `.env` for `import.meta.env.PUBLIC_*`, so both files can coexist. | None (clarification for `.env.example` Groups 1 and 2) | Mention in SECRETS.md if not there. |

## 2. Items I could not verify (marked `unknown` in the facts file)

1. Whether a `*.workers.dev` hostname can be registered as a Cloudflare Web Analytics site (no official page says). Test at the first preview or skip the beacon on workers.dev.
2. Whether the Web Analytics manual snippet excludes EU visitors (the "EU excluded on Free" text applies to the proxied automatic setup).
3. Exact wording of Telegram `sendMessage` errors (parse error, blocked bot, chat not found); the official docs do not list them and say `error_code` may change. Branch on `ok` and `parameters.retry_after` only.
4. Whether the Cloudflare `send_email` binding with no destination restriction accepts any verified address on Workers Free, and its production deliverability (Beta).
5. Real CPU time of the lead handler on Workers Free (10 ms limit; Cloudflare says typical auth/SSR Workers use 10-20 ms, average Worker 2.2 ms). Measure in Workers Logs after the first preview deploy.
6. Whether Supabase's `api` schema is exposed and works with `Content-Profile: api` on this project (depends on the project settings; D-005 view/grant design).
7. HetrixTools: whether sign-up needs a card; whether Terms allow business use on Free (silent); whether a specific HTTP status can be required (keyword and load failure are documented); how its "every minute from all selected locations" splits requests (worst case 5,760 a day on the health route).
8. Better Stack Free: card at sign-up, commercial-use wording (terms silent), uptime-data retention.
9. UptimeRobot Free: the pricing-page check marks are blank in the Markdown copy I could read, so email alerts on Free are "expected present" (confirm on the sign-up screen).
10. Razorpay: what the sample invoice must contain; whether a `workers.dev` or still-`noindex` site passes the instant website checks; whether live Payment Links can be created while KYC activation is pending (unchanged from VF-D1).

## 3. Proposed decisions (for the lead to put into DECISIONS.md)

1. **D-039 update (monitor).** Context: Telegram plus email on a free plan. Decision: recommend HetrixTools Free; fallback UptimeRobot Free with email and phone-app push (no Telegram); Better Stack third; Cloudflare Health Checks removed (not on Free). Consequences: owner must log in to HetrixTools at least every 90 days; terms silent on business use; ask support if written confirmation is wanted. Monitor interval: ask for 5 minutes if offered, to keep `/api/health` requests low (home page is a static asset and costs nothing).
2. **New: owner alert email channel.** Proposal: use Cloudflare `send_email` to the owner's verified address (free, no quota) once the domain is on Cloudflare; Resend stays for visitor-facing mail (free 3,000 a month, 100 a day). Interim before the domain exists: Resend test sender `onboarding@resend.dev` can send only to the Resend account's own address, which is enough for a first alert test.
3. **New: Turnstile fail mode.** Decide and document fail-open vs fail-closed when siteverify is unreachable (recommend fail-closed with a WhatsApp link shown so a lead is never lost silently); do not assert `hostname`/`action` when the test secret is in use.
4. **New: header policy for static pages.** Host-based CSP in `public/_headers` (`script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com/beacon.min.js` plus hashes, `frame-src https://challenges.cloudflare.com`, `connect-src 'self' https://cloudflareinsights.com`), trialled with `Content-Security-Policy-Report-Only` first, 2,000-character line limit; headers for on-demand responses set in code.

## 4. Requests for other workers or the lead

- Lead: Vitest alias for `cloudflare:workers` or a convention that endpoints are thin (TP-A1.2); update `.env.example` comment URL (TP-A2.3); consider adding `secrets.required` to `wrangler.jsonc` (optional hardening, TP-A1.2).
- Lead-backend: use only `apikey` for the Supabase secret key; `Prefer: return=minimal`; map 409 (`23505`) to the "duplicate" path; never log request bodies or keys; send `Idempotency-Key: lead-owner-alert/<id>` to Resend; keep the secret client per-request.
- Forms: load `api.js?render=explicit` on first interaction; call `turnstile.reset()` after every submit and on `expired-callback`; token lives 300 seconds and is single-use; use `size: 'flexible'` for 360 px screens; keep a visible WhatsApp fallback.
- Infra: `_headers` gotchas (TP-A1.3, TP-A2.4, TP-A3), `Referrer-Policy` must not be `no-referrer` on pages with the beacon, no `run_worker_first` for page routes, 64-variable limit is fine.
- Owner (via the lead): the monitor choice (`UPTIME_MONITOR_OPTIONS.md`); Turnstile production widget (OT-41), Telegram bot (OT-08), Cloudflare Web Analytics site token (account action, ask first).

## 5. Method notes

- Vendors publish Markdown copies of docs (`.../index.md` on developers.cloudflare.com; `Accept: text/markdown` on resend.com, supabase.com, razorpay.com); I used those instead of a summarising fetch tool wherever possible, so quoted wording is exact. Telegram, Astro, Vitest and PostgREST pages were read as page text. The Astro adapter behaviour for `_headers` was read from the installed package source (`node_modules/@astrojs/cloudflare/dist`, v14.3.4) and matched against the existing `dist/client/_headers`.
- No number in these files is a price or tax decision. Vendor prices quoted (Resend, Cloudflare Email Service, HetrixTools phone credits) are listings read on 2026-10-21 and are not decisions.
