# Wave 5 integration: notifications (D-114)

Build agent: notifications. Everything below is for the integrator. The module, its migration and its tests are complete and green on
their own. Nothing is switched on: email to subscribers needs five switches (section 9), notices need two.

What this wave builds:

1. A Supabase outbox store over `public.notification_outbox`. The outbox rules of 0017 and the TS outbox are reconciled into one rule
   set, tested on both sides.
2. Email subscriptions with double opt-in, and one-click unsubscribe.
3. Email delivery through the existing Resend path, only when `EMAIL_ENABLED` is exactly `true`. The Resend idempotency key is the
   outbox key.
4. Owner-entered in-site notices, with `api.public_site_notices` and a banner component.
5. The WhatsApp Channel as a link only, from `site.whatsappChannelUrl`.

## 1. Files

| Area | File |
|---|---|
| Migration | `supabase/migrations/0023_notifications.sql`, checks `supabase/checks/0023_assertions.sql` |
| Outbox (now owned by this wave) | `src/lib/notify/outbox/payload.ts` (new: the shared rules), `supabase-store.ts` (new), `store.ts` (TODO(lead) removed), `types.ts` (`Recipient.audience`), `consent.ts` (subscriber rule), `adapters.ts` (list footer and unsubscribe headers), `index.ts` (exports) |
| Email transport | `src/lib/notify/email.ts`: optional `headers`, allow-listed to `List-Unsubscribe` and `List-Unsubscribe-Post`. Every existing test stays green. |
| Shared sign-up rules (client and server, no imports) | `src/lib/notices/constants.ts` |
| Endpoints logic | `src/lib/notices/handlers.ts`, `subscriber-store.ts`, `tokens.ts`, `emails.ts` |
| Sending to the list | `src/lib/notices/dispatch.ts` (`createSubscriberDispatch`) |
| Notices | `src/lib/notices/site-notices.ts` (rules and model), `provider.ts` (build-time read), `channel.ts` (WhatsApp Channel link), `switches.ts` |
| Endpoint routes (`prerender = false`) | `src/pages/api/notify/subscribe.ts`, `confirm.ts`, `unsubscribe.ts` |
| Components | `src/components/site/notices/SiteNoticeBanner.astro`, `StayUpdated.astro`, `SubscribeForm.tsx` (island) |
| Admin | `src/lib/admin/notices/{types,schemas,service,memory-backend,supabase-backend}.ts` |
| Admin screen | `src/admin/screens/notices/{Notices.tsx,logic.ts}`. `Notices.tsx` also exports `StaffNoticesPanel`, for the organizer and scorer home. |
| Tests | `tests/notices/*.test.ts` (6 files plus `helpers.ts`), `tests/notify-outbox/payload-parity.test.ts`, `tests/notify-outbox/supabase-store.test.ts` |

## 2. Admin actions

The zod schemas are exported from `src/lib/admin/notices/schemas.ts` as `NOTICES_ACTION_SCHEMAS`. Who may run each action is in
`NOTICES_ACTION_KINDS`. The reason field is the usual `z.string().trim().min(3).max(500)`.

| Action | Kind | Who | Input (zod, strict) | Store method |
|---|---|---|---|---|
| `notices.list` | read | owner | `{}` | `noticesList()` |
| `notices.staff` | read | owner, organizer, scorer | `{}` | `noticesStaff()` |
| `notices.save` | write | owner | `{ id: uuid\|null, expectedRevision: int\|null, title (<=200), body\|null (<=1000), linkPath\|null, linkUrl\|null, linkLabel\|null, audience: 'public'\|'staff', startsAt\|null, endsAt\|null, reason }` | `noticesSave(actor, input)` |
| `notices.publish` | write | owner | `{ id: uuid, published: boolean, expectedRevision: int, reason }` | `noticesPublish(actor, input)` |
| `notify.summary` | read | owner | `{}` | `notifySummary(actor)` |
| `notify.saveSettings` | write | owner | `{ emailSubscribeOpen: boolean, reason }` | `notifySaveSettings(actor, input)` |
| `notify.queueAnnouncement` | write | owner | `{ announcementId: uuid, title (<=300), body (<=4000), reason }` | `notifyQueueAnnouncement(actor, input)` |
| `notify.dispatch` | write | owner | `{}` | `notifyDispatch(actor)` |

- `notices.staff` returns only published staff notices whose window is open. It holds nothing private.
- `notify.summary` returns counts only, never an address.
- `notify.dispatch` runs the dispatcher once, over subscriber records only. It answers `INVALID` with `EMAIL_NOT_READY` when email is not
  set up.
- The store methods are typed in `NoticesAdminStore` (`src/lib/admin/notices/types.ts`). They are built by
  `createNoticesService(backend)` in `src/lib/admin/notices/service.ts`.

### Wiring

- **`src/lib/admin/policy.ts`**:
  - `notices.staff`: a read that the owner, organizers and scorers may run. Use the wave 4 role helper; until roles exist, owner only.
  - Every other action: `ownerRead` or `ownerWrite`, following `NOTICES_ACTION_KINDS`.
- **`src/lib/admin/handler.ts`**: spread `...NOTICES_ACTION_SCHEMAS` into the action table, then add these cases:
  ```ts
  case 'notices.list': return fromStore(await s.noticesList(), cors);
  case 'notices.staff': return fromStore(await s.noticesStaff(), cors);
  case 'notices.save': return fromStore(await s.noticesSave(actor, input), cors);
  case 'notices.publish': return fromStore(await s.noticesPublish(actor, input), cors);
  case 'notify.summary': return fromStore(await s.notifySummary(actor), cors);
  case 'notify.saveSettings': return fromStore(await s.notifySaveSettings(actor, input), cors);
  case 'notify.queueAnnouncement': return fromStore(await s.notifyQueueAnnouncement(actor, input), cors);
  case 'notify.dispatch': return fromStore(await s.notifyDispatch(actor), cors);
  ```
- **`src/lib/admin/types.ts`**: `AdminStore extends ..., NoticesAdminStore` (import it from `./notices/types`).
- **`memory-store.ts`**: `...createNoticesService(createMemoryNoticesBackend())`. The data is a fictional seed, and email is never ready.
- **`supabase-store.ts`**:
  ```ts
  ...createNoticesService(createSupabaseNoticesBackend({ select, rpc, ...createSubscriberDispatch({ config: leadConfig, fetch, now: () => new Date() }) }))
  ```
  - `createSubscriberDispatch` is in `src/lib/notices/dispatch.ts`. It returns `{ emailReady, dispatch }`.
  - `leadConfig` is `await getLeadConfig()` from `src/lib/runtime-env.ts`.
  - Also add the names in `NOTICES_DETAIL_RPCS` (`supabase-backend.ts`) to `COMPETITION_DETAIL_RPCS`, so the database's plain INVALID
    sentences reach the owner.
- **`http-store.ts`**: one method per action, POSTing to `/api/admin/<action>` like the competition methods.
- **Nav (`src/admin/AdminApp.tsx`, `src/admin/screens/More.tsx`)**:
  - Add an entry "Notices and email" with the hint "short notices on the website, and update emails to people who signed up".
  - Render `<NoticesScreen store={client} />` from `src/admin/screens/notices/Notices.tsx`.
  - On the organizer and scorer home (wave 4), render `<StaffNoticesPanel store={client} />`.

## 3. Database (0023)

### Outbox reconciliation

The table is `notification_outbox` (0017).

New columns:
- `channel`: default `in_app`.
- `recipient_subscriber_id`: references `notify_subscribers`.
- `subject`, `body`.
- `not_before`, `expires_at`, `lease_until`.
- `skip_reason`: the TS `SkipReason` list.

Changed constraints:
- status: gains `sending`.
- key: now `^[A-Za-z0-9:%_-]{8,200}$`, the form `keys.ts` produces.
- one recipient: lead, profile or subscriber.
- a subscriber is reached by email only.
- `sending` requires a lease, and `skipped` requires a reason.

One rule, tested on both sides:
- **Payload**: `app.competition_outbox_payload_ok` (unchanged).
  - Its one TS copy (`src/lib/competition/db.ts`) is re-exported by `src/lib/notify/outbox/payload.ts`.
  - The store writes only `{event, revision}` there.
- **Message text**: new `app.notify_text_ok`, TS twin `outboxTextProblem`. It refuses:
  - an email address;
  - 9 or more digits, separators allowed;
  - a `wa.me`, `tel:` or `api.whatsapp.com` link;
  - control characters.
- **Shared cases**: they live between the `payload-cases` and `text-cases` markers in `0023_assertions.sql`. pg-local runs them in SQL, and
  `tests/notify-outbox/payload-parity.test.ts` runs them in TS.

**Deviation from 0017's comment:** the rendered subject and body are now stored. 0017 said message text is "never stored here". That is
still true for the payload. Addresses are still never stored: the adapter looks them up at send time. A DECISIONS record is proposed in
section 10.

0017's `app.enqueue_notification` keeps working: it writes in-app rows with no text, which the dispatcher never picks up. Nothing calls
it today.

### New private tables

All three have RLS on, no policies, everything revoked, and SELECT for `service_role` only.

- **`notify_subscribers`**:
  - Columns: email (lower case), status (`pending`, `active` or `unsubscribed`), consent id and version, `consent_at`,
    `confirmed_at`, `unsubscribed_at`, the confirmation count and time.
  - Only the SHA-256 hash of the confirmation token is stored, valid for 48 hours.
- **`notify_settings`**: one row, `email_subscribe_open = false`.
- **`site_notices`**:
  - Columns: title, body, link (`link_path` or allow-listed `link_url`, plus `link_label`), audience (`public` or `staff`),
    `starts_at`, `ends_at`, `published` (default false), `revision`.
  - Every text passes `app.notify_text_ok`.

### api views

Both are security_barrier views with SELECT for anon and authenticated only.

- `api.public_site_notices (id, title, body, link_path, link_url, link_label, starts_at, ends_at, updated_at)`: published public notices
  whose window is open now.
- `api.public_notify_settings (email_subscribe_open)`.

### RPCs (`service_role` only)

For the endpoints:
- `notify_subscribe(jsonb)`: the owner's switch is checked first. The outcome goes to the server only.
- `notify_confirm(text)`.
- `notify_unsubscribe(uuid)`: never blocked by a switch. It skips every queued email to that subscriber with `consent_withdrawn`.

For the dispatcher:
- `notify_outbox_enqueue(jsonb)`: at most 500 records a batch, idempotent on the key.
- `notify_outbox_cas(text, text, integer, jsonb)`: changes the delivery state only. A final state is never reopened.

For the owner (`app.require_owner` first, audited with field names and counts only):
- `admin_save_site_notice(text, uuid, jsonb, integer, text)`
- `admin_publish_site_notice(text, uuid, boolean, integer, text)`
- `admin_set_notify_settings(text, jsonb, text)`
- `admin_queue_subscriber_announcement(text, jsonb, text)`: keys equal the TS `idempotencyKey`, so a second press queues nothing.
- `admin_notify_summary(text)`: read, counts only.

A public notice change, publish or unpublish, and the sign-up switch call `app.mark_dirty`, because static pages need a rebuild.

**Helpers (no grants at all):** `app.notify_text_ok(text, integer, boolean)`, `app.site_notice_link_ok(text)`,
`app.site_notice_path_ok(text)`.

### Checks run

1. `node scripts/with-lock.mjs heavy -- node scripts/pg-local.mjs all`, then `stop`:
   - Every migration from 0001 to 0023 applied.
   - Checks 0001 to 0005 passed.
   - It then **stopped at `0006_assertions.sql`**, because schema api holds views not on its allow-list. This was expected: the views of
     0020, 0021, 0022 and 0023 (section 4).
2. Then, under the lock, against the same freshly applied database, every other check by hand with psql, skipping 0006:
   - 0001 to 0005 and 0007 to 0023 all printed their `ok` row.
   - 0019 to 0022 belong to other agents.
   - The last row was `ok: 0023_notifications assertions passed`.
3. The server was stopped afterwards.

## 4. Registries to update (the integrator's files)

**RLS_MATRIX (`src/lib/admin/policy.ts`)**
```ts
// 0023_notifications.sql (D-114): subscribers, switches and notices are private; two api views allow select only
'api.public_site_notices': { private: false, grants: PUBLIC_VIEW },
'api.public_notify_settings': { private: false, grants: PUBLIC_VIEW },
'notify_subscribers': { private: true, grants: OWNER_READ_RPC_WRITE },
'notify_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
'site_notices': { private: true, grants: OWNER_READ_RPC_WRITE },
```
(`notification_outbox` already has its row.)

**Anon harness (`scripts/anon-harness.mjs`)**
```js
// 0023_notifications.sql (D-114): subscribers, switches and notices are denied; the two api views allow select only
{ name: 'notify_subscribers', pk: 'id', pkSample: NIL_UUID },
{ name: 'notify_settings', pk: 'id', pkSample: '0' },
{ name: 'site_notices', pk: 'id', pkSample: NIL_UUID },
{ name: 'public_site_notices', pk: 'id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
{ name: 'public_notify_settings', pk: 'email_subscribe_open', pkSample: 'false', schema: 'api', expectSelect: true },
```

**`supabase/checks/0006_assertions.sql`**: add `'public_site_notices', 'public_notify_settings'` to the allow-list of named later views,
and mention 0023 in its comment.

**`tests/supabase/bundle.test.ts`**: the last check's ok row becomes `ok: 0023_notifications assertions passed`.

These tests fail until the rows above (and the other wave 5 agents' rows) exist. All the failures are expected and none is in this
module:
- `tests/admin/rls-matrix-schema.test.ts`
- `tests/supabase/bundle.test.ts`
- `tests/supabase/migration.test.ts`
- `tests/supabase/migrations-structure.test.ts`
- `tests/supabase/local-pg.test.mjs` (0006 allow-list, when a local server is up)

`tests/competition-public/pages-source.test.ts` ("the event page never claims a live score") also fails. That comes from the uncommitted
change to `src/pages/competitions/[tournament]/[event].astro` (live scores area), not from this wave.

## 5. Feature flags (`src/content/legal/status.ts`, `tests/legal/features.test.ts`)

- **`emailNotifications: false`**:
  - arrives: `platform wave 5 (owner + lawyer, after the sending domain, OT-40)`.
  - unlocks: `the email updates sign-up with double opt-in (email address only, 18 or older, a confirmation link, one-click unsubscribe in
    every email) and announcement emails from the admin`.
  - The existing `emailAlerts` flag (M3, the `alerts_signup` lead form) covers the older sign-up that only saves addresses. Suggestion:
    when `emailNotifications` goes on, retire the `alerts_signup` form on `/alerts/` in favour of `StayUpdated`, and show the privacy
    row of section 6 instead of (or merged with) the `emailAlerts` row.
- **`siteNotices: false`**:
  - arrives: `platform wave 5 (owner)`.
  - unlocks: `short notices from the owner in a banner on the website pages, and the WhatsApp Channel button in the "Stay updated"
    block`.
- Both flags are read defensively by `src/lib/notices/switches.ts`: a missing flag counts as off, so no cast is needed after you add
  them.

## 6. Privacy `futureWording` (`src/content/legal/privacy.ts`, behind `features.emailNotifications`)

Draft for the lawyer:

> **Email updates.** If you sign up for Power Smash updates by email, we collect only your email address, the time you signed up and the
> version of the notice you saw. We first send one email with a link to confirm the address; nothing else is sent until you open that
> link, and an unconfirmed sign-up is never used. You must be 18 or older to sign up. We use the address only to send the updates you
> asked for. Every email has a link that stops the emails at once, with one click. We never show your address on the website, never put
> it in our alerts to ourselves, and share it only with the service that sends our emails (Resend). We keep a confirmed address until you
> unsubscribe, and after that [retention period: lawyer to decide].

- collectRow: `['Sign up for email updates', 'Your email address, the time you signed up and confirmed, and the version of the notice you saw.', 'To send the updates you asked for after you confirm your address, and to show that you asked for them. Every email has a one-click unsubscribe link.']`
- retentionRow: `['Email updates list', todo('how long we keep an email address after you unsubscribe or never confirm (D-114)')]`
- Service providers table: add Resend ("sends our emails"). Its region is not checked yet, so the entry needs the lawyer and VERIFIED_FACTS.

For `features.siteNotices`: nothing to add (notices hold no personal data). The WhatsApp Channel sentence already exists on `/alerts/`:
"You do not share your number with us."

## 7. Runtime and build environment (`src/lib/runtime-env.ts`, `docs/SECRETS.md`)

**`NOTIFY_SUBSCRIBE_ENABLED`** (a switch, not a secret). Add it to `RuntimeEnv` and `NAMES`.
- The sign-up and confirm endpoints are open only when the value is exactly `true`.
- Until `NAMES` lists it, `getRuntimeEnv()` drops it, so they stay closed.
- The unsubscribe endpoint never reads it.

Reused names, no new secret:
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
- the `TURNSTILE_*` settings (the widget action is `lead`, because the form reuses `TurnstileWidget`)
- `HMAC_KEY`: rate-limit pseudonyms and the unsubscribe-link HMAC (purpose `notify_unsubscribe`)
- `EMAIL_ENABLED`, `RESEND_API_KEY` and `EMAIL_FROM`
- `PUBLIC_SITE_URL`: links in emails, https only. Without it nothing is sent.

New BUILD variables:
- **`PS_NOTICES_SOURCE`**: exactly `supabase` to read `api.public_site_notices` with the publishable key.
  - The release build needs it AND `features.siteNotices`.
  - Otherwise a release build shows no notice.
- **`PS_NOTICES_SAMPLE`**: exactly `1` in a developer build shows the fictional sample banner.
  - Never in a release build.
  - Off by default, so other pages and the e2e snapshots do not change.

## 8. Where to include the components

- **`SiteNoticeBanner.astro`**: once per page in `src/layouts/BaseLayout.astro`, directly after `<SiteHeader />`.
  - It renders nothing when there are no notices (the default).
  - It reads the notices once per build (`siteNoticesOnce`).
- **`StayUpdated.astro`**: on `/alerts/`, replacing the `alerts-whatsapp-channel` OwnerSection and the `alerts_signup` form once
  `emailNotifications` is on. Optionally also on `/support/` or in the footer.
  - The channel button needs `features.siteNotices` AND a real Channel link in `site.whatsappChannelUrl` (OT-09).
  - The form needs `features.emailNotifications`.
  - It renders nothing when both are off.
  - The footer and `/alerts/` could also use `whatsappChannelLink()` (`src/lib/notices/channel.ts`) instead of the raw setting, so that
    a non-channel value never shows a button.
- **`StaffNoticesPanel`** (`src/admin/screens/notices/Notices.tsx`): on the organizer and scorer home.

## 9. The switches (all off) and the order to turn them on

1. The owner verifies the sending domain (OT-40), and Vercel gets `EMAIL_ENABLED=true`, `RESEND_API_KEY` (owner), `EMAIL_FROM` and
   `PUBLIC_SITE_URL` (https).
2. Vercel: `NOTIFY_SUBSCRIBE_ENABLED=true` (the integrator adds the name first).
3. The lawyer re-reads the notice (`SUBSCRIBE_CONSENT`, version `2026-10-31-draft1`) and the privacy text. Then
   `features.emailNotifications` goes on, which shows the form.
4. The owner opens the sign-up in the admin (Notices and email, then "Open the email sign-up"). Until then the database answers `closed`.
5. Sending stays manual: the owner queues an announcement, then presses "Send queued emails now". There is no schedule. A cron route
   would need the owner's yes (CLAUDE.md "Ask first").
6. Notices: the owner writes and publishes them in the admin at any time, but they reach visitors only with `features.siteNotices` on
   and `PS_NOTICES_SOURCE=supabase` in the release build. They appear after the next site update; the admin says so.

**Owner alerts.** Subscriptions send no owner alert at all: there is no Telegram message and no owner email. Nothing about a subscriber
reaches any alert, log or audit row (tests check the logs).

## 10. Proposed DECISIONS record, and open items

### Proposed DECISIONS.md record (D-114 consequences, wave 5)

- The outbox stores the rendered subject and body, never an address. They are checked by `app.notify_text_ok`: no email, no 9-digit
  run, no `wa.me` or `tel:` link.
- The payload holds `{event, revision}` only.
- Recipients are `lead:`, `profile:` or `subscriber:` references.
- The email list:
  - double opt-in, with a token hash and a 48-hour link;
  - one generic answer to every sign-up;
  - a GET on a link never changes anything (a page with a button);
  - unsubscribe by HMAC link, with RFC 8058 one-click headers, never behind a switch.
- Subscribers get announcements by email only. The D-012 protected-player rule does not apply to them, because the list is not tied to a
  player, but the sign-up asks for 18 or older. Nothing is lifted from that answer.
- Sending is manual from the admin, over subscriber records only.
- Notices:
  - no contact data;
  - links only to site pages or the brand's own YouTube, Instagram, Facebook or WhatsApp Channel accounts;
  - shown at build time.
- The WhatsApp Channel is a link only.

### Open items

- **Retention.** Pending sign-ups that were never confirmed, and unsubscribed addresses, stay until a purge exists. The lawyer decides
  the period; then a 0010-style purge goes into a later migration. Delete nothing before that decision.
- **HMAC_KEY rotation.** A rotation makes older unsubscribe links fail (`verifyUnsubscribe` uses the current key only). Before any
  rotation, keep the old key id for unsubscribe checks, or re-send. Add this to the RUNBOOK key-rotation steps.
- **Timing.** Without a Vercel request context (`waitUntil`), the sign-up awaits the confirmation email before answering. That makes a
  new address answer more slowly than a known one. On Vercel `afterResponseIfAvailable()` removes the difference; note this for review.
- **WhatsApp Channel link format.** The form (`https://whatsapp.com/channel/<16-40 letters and digits>`) comes from public links, not
  vendor documentation. Re-check it against the owner's real link (OT-09) and record it in VERIFIED_FACTS.
- **Resend facts.** The `headers` parameter ("Custom headers to add to the email") and the 256-character, 24-hour `Idempotency-Key` were
  re-checked on 2026-10-31 at https://resend.com/docs/api-reference/emails/send-email. Record them in `docs/VERIFIED_FACTS.md`. Resend's
  data region is unchecked.
- **Other recipients.**
  - Registration and competition notifications to leads or profiles need their own address lookup and consent re-check. Use the
    `other` parameter of `subscriberAddressResolver` and `subscriberRecheck`, or a separate dispatcher with
    `createSupabaseOutboxStore(db, { recipientType: 'lead' })`.
  - The subscriber dispatcher never touches them.
  - No in-app inbox table exists yet: in-app records stay `not_configured`.
- **Staff notices scope.** Staff notices go to every signed-in organizer and scorer. Per-tournament notices would need a `tournament_id`
  and the wave 4 assignment check.
- **G1 checklist.**
  - Re-read the sign-up notice and the privacy text.
  - Confirm one answer for every address, one-click unsubscribe in a real mail client, no address in alerts or audit rows, and no
    contact data in notices.
- **RUNBOOK.**
  - How to open and close the sign-up.
  - How to queue and send an announcement.
  - What "Not sent" means: no consent, unsubscribed, or email off.
- **CHANGELOG.md**: add a line for wave 5 notifications (the files above) with the test lines below.

## 11. Test probes

`npx vitest run tests/notices tests/notify-outbox tests/notify` passes on its own: 12 files, 207 tests.

- **`tests/notify-outbox/payload-parity.test.ts`**:
  - the SQL cases run through the TS rules;
  - the SQL patterns equal the TS constants;
  - every key from `keys.ts` fits the table check;
  - the SQL announcement key equals the TS key.
- **`tests/notify-outbox/supabase-store.test.ts`**:
  - the store against a fake database with the SQL semantics: idempotent enqueue, refusal before the call, compare and set, no change
    to the message;
  - memory and Supabase stores give equal outcomes;
  - the subscriber consent rule;
  - the list footer and one-click headers, with a verified link;
  - sendEmail allows only those two headers;
  - one full dispatch: sends once, skips the unsubscribed address, leaves others alone, and does nothing when not set up.
- **`tests/notices/handlers.test.ts`**:
  - the switches;
  - one answer for every address;
  - only a token hash is stored;
  - the confirmation email link;
  - honeypot, origin and limits;
  - GET pages never change state, with no-referrer and CSP headers;
  - one-click unsubscribe works with every switch off, and a forged link is refused;
  - logs hold no address.
- **`tests/notices/site-notices.test.ts`**:
  - the notice rules equal the SQL patterns and view columns;
  - the window and order;
  - links;
  - the build source (fail closed in release);
  - the Channel link;
  - the email texts;
  - component source checks: no `set:html`, no `wa.me`, no owner marker.
- **`tests/notices/admin.test.ts`**:
  - the service over the memory backend (revision, STALE, field errors, staff filter, idempotent queue, "not set up");
  - the Supabase backend's RPC names and arguments;
  - the schemas and roles;
  - the screen helpers (India time).
- **`tests/notices/sql.test.ts`**: the static house rules of 0023, the endpoints (`prerender = false`, runtime-env only), and client and
  server email parity.
- **`tests/notices/subscribe-form.test.ts`**: the island's answer handling.
- **`supabase/checks/0023_assertions.sql`**:
  - structure, grants and helpers;
  - the shared rule cases;
  - closed by default and owner only;
  - sign-up, too_soon, confirm once, expiry, already_active;
  - the announcement key and idempotency;
  - enqueue refusals for a phone, an email, the channel, a sent status or an address recipient;
  - compare and set: a claim once, never reopened;
  - the 0017 enqueue still works;
  - an unsubscribe with the switch closed skips queued mail, and signing up again needs a new confirmation;
  - every notice refusal, STALE, the public view window and audience, the dirty flag;
  - the summary holds counts only;
  - audit rows hold no text or address;
  - anon is denied everything but the two views.

`npm run check` (under the lock): 0 errors, 0 warnings, 3 hints, none in these files.

After wiring, also probe:
- `POST /api/admin/notices.save` as an editor gives 403.
- `notices.staff` as an organizer gives 200 with staff notices only.
- The anon harness gives 2xx on both views and denies the three tables.
- `POST /api/notify/subscribe` with the switch off gives 409 `closed`.
- A real one-click unsubscribe from a Gmail test inbox, once email is set up (owner).
