# Vendor facts check, 2026-10-31 (platform waves 4 and 5)

What this is: a check of the vendor facts that waves 4 and 5 left unverified (D-117 accounts, D-119 and D-124 live scores, D-120 email list), read from the vendors' own pages on 2026-10-31. The facts themselves, with their sources, are rows VF-S1 to VF-S9, VF-V12 to VF-V17 and VF-R1 to VF-R5 in `docs/VERIFIED_FACTS.md` section J. This file adds the comparison with the code and what the owner needs to know.

Method and limits:
- Research only. No account was created, nothing was signed in to, no invitation or email was sent, no credential was used.
- Pages were read with a summarising fetch tool; a few quotes were checked twice. For Supabase Auth's REST endpoints the primary source is the vendor's own Auth server repository README (`github.com/supabase/auth`) and the supabase-js source, because the docs pages show only the SDK.
- "Unverified" means no vendor page said it. Nothing here was tested against a live project: every item still needs one check on the dev project or the first preview before its switch goes on.

## 1. Supabase Auth (accounts, D-117)

| Question | Answer | Code | Result |
|---|---|---|---|
| Invite endpoint | `POST /auth/v1/invite` `{email}`, admin key, `redirect_to` as a query parameter; answers the new user with `id` (VF-S1) | `createGoTrueAdmin().invite` does exactly this | matches |
| Which header carries the secret key | Docs: `sb_secret_` keys go on `apikey` ONLY; on `Authorization: Bearer` the platform may answer `Invalid JWT` (VF-S9) | `gotrue.ts` (admin headers) and `src/lib/admin/config.ts` line 127 send the key on both headers; so did both steps of `.github/workflows/retention.yml` (`/rest/v1/rpc/...`) | **retention.yml fixed (review 2026-10-31):** both steps now send the key on `apikey` only, like `src/lib/supabase/rest.ts` does for every other PostgREST call (`tests/infra/retention-workflow.test.ts` checks it; `sync.yml` sends no Bearer secret either). **gotrue.ts and config.ts not changed** (the Auth admin endpoints are a different service and the docs do not say which form they accept). Lead: on the dev project, try the Auth admin calls with `apikey` only and with both; if Bearer is refused, drop the `authorization` header in both places. Also run the Retention workflow once as a dry run on the dev project to confirm `apikey`-only works there |
| Redirect | Must be on the allow list (wildcards allowed); behaviour when it is not on the list is unverified (VF-S2) | `ADMIN_INVITE_REDIRECT_URL`, RUNBOOK step 1 adds it to the list | matches |
| Link and email | `ConfirmationURL` goes to `/auth/v1/verify` and comes back with `#access_token=...&type=invite` (VF-S3) | `parseInviteRedirect` expects this fragment | matches |
| Email text | Default heading "You've been invited", link "Accept invitation" (VF-S3) | `docs/m5/integration/accounts.md` step 2 quotes different words ("You have been invited", "Accept the invite") | doc wording out of date (not my file) |
| Link scanners | Some mail systems open links automatically and use the invitation up (VF-S3) | Not handled; the person would see an expired or used link | risk; the fix is a custom template with `{{ .TokenHash }}` and a "Continue" button that verifies on a click (a later change, needs the owner's yes) |
| Expiry | 1 hour by default ("Email OTP Expiration"), shared with every email link (VF-S4) | Not mentioned to the owner | owner item below |
| Sign-ups disabled | Invites still work (the only way to create users) (VF-S5) | as assumed | matches |
| Who receives the invitation | The built-in sender delivers ONLY to project team members, 2 an hour (VF-S5) | D-006/D-022 say custom SMTP comes at go-live; the accounts RUNBOOK steps do not list it | owner item below |
| Ending an account | `ban_duration` `876000h` is the documented 100-year ban; `none` lifts it; access tokens stay valid up to 1 hour (VF-S6) | `BAN_DURATION = '876000h'`; the database check stops the person at once | matches |
| Setting the password | `PUT /auth/v1/user`; blocked if "Require current password when updating" is on; strength rules may refuse a password (VF-S7) | `setInvitedPassword` maps 422 to `invalid_credentials` | matches; owner setting below |
| MFA | TOTP on by default on every project; enrol from aal1, verify gives aal2 (VF-S8) | as assumed | matches |

## 2. Vercel cache (live scores, D-119, D-124)

| Question | Answer | Code | Result |
|---|---|---|---|
| Is `s-maxage` on a function answer cached? | Yes, on all plans, per region, best effort (VF-V12) | `LIVE_SCORES_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=15'` | matches |
| What blocks caching | an `Authorization` request header, `set-cookie`, `private`/`no-store`, `Vary: Cookie` or `*`, non-GET (VF-V12) | the endpoint sets none of these | matches |
| Route header vs function header | a function's own `Cache-Control` overrides a route header (stated for `vercel.json`; the `config.json` route form is inference) (VF-V13) | `NO_STORE_PATHS` exempts `/api/live-scores/<id>` anyway | matches |
| What the browser sees | Vercel strips `s-maxage` and `stale-while-revalidate`; the browser gets `public, max-age=0, must-revalidate` (VF-V13) | `docs/m5/integration/live.md` line 150 expects the client to see `cache-control: public, s-maxage=30, stale-while-revalidate=15` | **doc expectation wrong** (not my file): the preview check should look for `x-vercel-cache: HIT` or `STALE` only. Comment in `src/lib/live-scores/rules.ts` updated |
| CDN-Cache-Control / Vercel-CDN-Cache-Control | Supported; `Vercel-CDN-Cache-Control` wins and is never sent on (VF-V13) | not used; not needed | no change |
| Query strings | Part of the cache key for functions (VF-V14) | a query string is refused (400, no-store) | matches |
| New deployment | Starts with an empty cache (key includes the deployment) (VF-V14) | | fine |
| The 45-second bound (D-124) | holds per region; a failed refresh serves the old copy only inside the `stale-while-revalidate` window (VF-V14) | | matches |
| Deployment Protection and cache | Not stated whether a cache hit is served before the protection check (VF-V15) | | unverified: check on the first preview that a signed-out request to a protected address gets the Vercel login, not a cached answer |

Side note (not in my area): `src/lib/placements/api-handler.ts` still describes the Cloudflare Cache API and `purgePlacementsCache`; on Vercel there is no `caches.default`, so the purge is a no-op and purging would need a `Vercel-Cache-Tag` header. Its `max-age=60` part is either kept or replaced by `max-age=0` for the browser (VF-V13 pages differ): check on a preview.

## 3. Resend (email list, D-120)

| Question | Answer | Code | Result |
|---|---|---|---|
| Data region | Sending from us-east-1, eu-west-1, sa-east-1 or Tokyo; ALL account data (metadata, logs, API records) is stored in the United States whatever the region (VF-R1) | | LAWYER item: the privacy text must say the email provider stores data in the US |
| Idempotency-Key | 1 to 256 characters, 24 hours. Same key and payload: the first answer again, nothing sent twice. 409 = different payload with the same key, or the same key still in flight (VF-R2) | `email.ts` treats every 409 as sent; `keys.ts` keys are at most 256 characters | **contradiction, fixed by the integrator (D-128)**: a 409 is no longer counted as sent. `concurrent_idempotent_requests` (or an unreadable 409) is retried later with the same key; `invalid_idempotent_request` is a permanent failure. Tested in `tests/notify/email.test.ts` |
| 24-hour window | After 24 hours the same key sends again (VF-R2) | the dispatcher reclaims a stuck `sending` record when someone next runs it, which could be days later | risk noted in `dispatcher.ts`; possible fix: mark a record older than 24 hours as failed for email instead of resending |
| List-Unsubscribe | Supported through the `headers` object; one-click needs `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; the address must accept a POST (200 or 202) and show a page on GET; stop within 48 hours (VF-R3) | `adapters.ts` sends both headers; `/api/notify/unsubscribe` accepts GET (page) and POST (unsubscribes, 200 page) | matches (Resend says "blank page"; an HTML page with 200 is accepted by RFC 8058) |
| Domain verification | DKIM and SPF records (TXT and MX on `send` plus TXT on `resend._domainkey` for older domains, CNAMEs for domains made after about August 2026); up to 72 hours; grey cloud on Cloudflare (VF-R4) | | owner item (OT-07, OT-40) |
| Tracking | open and click tracking are optional; default unknown (VF-R5) | text-only mail | owner item |

## 4. Vercel Deployment Protection: why it might switch itself off (for the owner)

Nothing in Vercel's documentation says the setting resets on its own when a domain is added or the plan changes. But several things can leave the site open without anyone touching the switch itself:

1. **Adding your real domain under "Standard Protection".** Standard protects everything EXCEPT production domains. The day `www.elitetournaments.in` is added as a production domain, it is public under Standard. Only "All Deployments" keeps it closed. (VF-V16)
2. **Turning Vercel Authentication off, even for a minute.** Every existing deployment becomes public at once; people who signed in before get back in without signing in again. (VF-V16)
3. **Exceptions and bypasses.** A Shareable Link, a "Protection Bypass for Automation" secret, a Deployment Protection Exception (a listed domain becomes public), the OPTIONS allowlist or a Trusted Source each let people past the login. (VF-V16)
4. **A new or re-made project.** A new project takes the team's default protection, which may be "None". (VF-V16; VF-V10 saw Standard on this account's new project.)
5. **Vercel itself.** The project settings carry markers that Vercel applied protection changes after its April 2026 security incident and after a 2025 vulnerability (both towards "all"). Their meaning is not documented. (VF-V17)
6. **Plan changes.** Vercel Authentication, Standard and All Deployments are free on every plan, so moving between Hobby and Pro should not change them; not stated anywhere (unverified). Password Protection is Pro only.

What the API shows: `GET /v9/projects/<id>` returns `ssoProtection.deploymentType` (`all`, `all_except_custom_domains`, `preview`, `prod_deployment_urls_and_all_previews`; empty when off), plus `passwordProtection`, `trustedIps`, `protectionBypass` and `optionsAllowlist` (VF-V17). The `preview.yml` guard accepts only `all` and stops on anything else, including an empty setting: correct. It checks only at upload time and does not look at exceptions, shareable links or bypass secrets; a later step could also refuse when `protectionBypass` or exceptions are present (a lead decision).

Two knock-on effects while "All Deployments" is on:
- **Email unsubscribe links on the protected address would hit the Vercel login**, so one-click unsubscribe would fail. Do not send list email (`NOTIFY_SUBSCRIBE_ENABLED`, `EMAIL_ENABLED`) from a protected deployment.
- **An invitation link whose redirect is a protected admin address** first shows the Vercel login to the invited person (who has no Vercel account). Invitations only make sense once the admin address is public behind its own sign-in.

## 5. Owner items (plain English)

- Before inviting anyone: set up Supabase to send its emails through Resend (Supabase, Authentication, Emails, SMTP settings). Without it the invitation email only reaches people on your Supabase team, and only 2 an hour.
- An invitation link works for 1 hour by default. Tell the person to open it soon. If it has run out, invite them again. (The setting is "Email OTP Expiration"; it also changes every other sign-in email link.)
- Some work email systems open links by themselves and use the invitation up. If someone says the link "has expired" straight away, tell Claude: the email can be changed to a "Continue" button page.
- In Supabase, Authentication, leave "Require current password when updating" OFF, or invited people cannot set their first password.
- Supabase's own invitation email says "You've been invited" and "Accept invitation". You may reword it; do not promise anything the site does not do.
- Resend keeps its records in the United States even if you send from Tokyo. The lawyer should see this for the privacy page.
- In Resend, keep open tracking and click tracking off.
- Vercel: keep "All Deployments" until launch (G1). When you add your real domain, check the protection setting the same day. Never turn Vercel Authentication off "just to test".

## 6. Left open (needs a live project or preview)

- VF-S9: does the Auth admin API accept the secret key on `Authorization: Bearer` (`gotrue.ts`, `config.ts`)? And one dry run of the Retention workflow (both steps, `apikey` only) on the dev project. (dev project)
- Every row marked "unverified (summarised: ...)" in `docs/VERIFIED_FACTS.md` section J: open the vendor page itself and confirm or correct the quoted wording; check the two odd `ssoProtection` field names of VF-V17 against the live API answer. (anyone, dev project)
- VF-S2: what happens when `redirect_to` is not on the allow list. (dev project)
- The error code for inviting an address that already has an account (`already_registered` mapping). (dev project)
- VF-V15: is a cache hit served before the protection check? (first preview)
- VF-V13: the exact `cache-control` the browser gets for `/api/live-scores/<id>` and `/api/placements`. (first preview)
- VF-V17: which `deploymentType` the dashboard writes for Standard today.
- VF-R5: Resend tracking defaults.
