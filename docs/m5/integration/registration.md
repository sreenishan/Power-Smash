# Wave 5 integration: registration with manual payment verification (D-111)

Build agent: registration. Everything below is for the integrator; the module, its migration and its tests are complete and green on
their own. Nothing here is switched on: four switches must all be on before anyone can register (see section 9).

## 1. Files (all new)

| Area | File |
|---|---|
| Migration | `supabase/migrations/0020_registrations.sql`, checks `supabase/checks/0020_assertions.sql` |
| Shared rules (client and server, no zod) | `src/lib/registration/constants.ts` |
| Request contract (zod, server) | `src/lib/registration/contract.ts` |
| Notice text (draft for the lawyer) | `src/lib/registration/consent.ts` (`registration-notice`, `2026-10-31-draft2` (adults only, D-123)) |
| Endpoint logic | `src/lib/registration/handler.ts`, `store.ts` (the two RPC calls), `alert.ts` (owner alert) |
| Form logic (client) | `src/lib/registration/form-logic.ts` |
| Build gate | `src/lib/registration/in-build.ts` |
| Public data | `src/lib/registration/public/{provider,model,load}.ts` |
| Endpoint route | `src/pages/api/register.ts` (`prerender = false`) |
| Page | `src/pages/register/[tournament]/[event].astro` |
| Components | `src/components/registration/RegistrationForm.tsx` (island), `PaymentDetails.astro` |
| Admin | `src/lib/admin/registration/{types,schemas,service,memory-backend,supabase-backend}.ts` |
| Admin screen | `src/admin/screens/registrations/{Registrations.tsx,logic.ts}` |
| Tests | `tests/registration/*.test.ts` (5 files), `tests/e2e/registration.spec.ts` (written, not run) |

### Why the page is `/register/<tournament>/<event>/` and not `/competitions/<tournament>/<event>/register/`

- `tests/competition-public/pages-source.test.ts` (wave 3) pins the exact route list of `src/pages/competitions/` and requires
  `noindex={... source === 'seed'}` on every page there. A register route inside that folder fails that test. A form page should be noindex
  always.
- The sibling family is switched on its own (`features.registrations`) and its output folder `register` can be pruned on its own
  (`REGISTRATION_OUTPUT_PATHS` in `src/lib/registration/public/model.ts`).
- The competition pages stay static, without client JavaScript. The register page has one React island.
- The tournament slug and the event code are the competition pages' own (D-115), so the address is still easy to read.
- If the lead prefers `/competitions/.../register/`, move the file and change `registrationPath()`. Then add the route to the
  pages-source test's list and give that test's noindex rule an exception for the register page.

## 2. Admin actions (owner only, aal2)

The zod schemas are exported from `src/lib/admin/registration/schemas.ts` as `REGISTRATION_ACTION_SCHEMAS`. The read or write kind of
each action is in `REGISTRATION_ACTION_KINDS`.

| Action | Kind | Input (zod, strict) | Store method |
|---|---|---|---|
| `registrations.settings` | read | `{}` | `registrationSettings()` |
| `registrations.events` | read | `{}` | `registrationEvents()` |
| `registrations.list` | read | `{ eventId: uuid }` | `registrationList(input)` |
| `registrations.saveSettings` | write | `{ enabled: boolean, paymentInstructions: string\|null (<=1000), upiId: string\|null (<=130), payeeName: string\|null (<=80), reason }` | `registrationSaveSettings(actor, input)` |
| `registrations.setEvent` | write | `{ eventId, open: boolean, entryFeePaise: int 1..100000000 \| null, reason }` | `registrationSetEvent(actor, input)` |
| `registrations.verifyPayment` | write | `{ registrationId, amountPaise: int 0..100000000, expectedRevision, reason }` | `registrationVerifyPayment(actor, input)` |
| `registrations.convert` | write | `{ registrationId, players: [{playerId: uuid} \| {newName: string 2..80}] (1..2), status: 'pending'\|'confirmed'\|'waitlisted', expectedRevision, reason }` | `registrationConvert(actor, input)` |
| `registrations.reject` | write | `{ registrationId, expectedRevision, reason }` | `registrationReject(actor, input)` |

The reason is the handler's usual `z.string().trim().min(3).max(500)`. A rejection's reason is private: the owner sees it in the admin,
and it goes into the audit log.

### Wiring

- **`src/lib/admin/policy.ts`**: add each action as `ownerRead` or `ownerWrite`, following `REGISTRATION_ACTION_KINDS`.
- **`src/lib/admin/handler.ts`**: spread the schemas into the action table (`...REGISTRATION_ACTION_SCHEMAS`). Then add the dispatch
  cases:
  ```ts
  case 'registrations.settings': return fromStore(await s.registrationSettings(), cors);
  case 'registrations.events': return fromStore(await s.registrationEvents(), cors);
  case 'registrations.list': return fromStore(await s.registrationList(input), cors);
  case 'registrations.saveSettings': return fromStore(await s.registrationSaveSettings(actor, input), cors);
  case 'registrations.setEvent': return fromStore(await s.registrationSetEvent(actor, input), cors);
  case 'registrations.verifyPayment': return fromStore(await s.registrationVerifyPayment(actor, input), cors);
  case 'registrations.convert': return fromStore(await s.registrationConvert(actor, input), cors);
  case 'registrations.reject': return fromStore(await s.registrationReject(actor, input), cors);
  ```
- **`src/lib/admin/types.ts`**: `export interface AdminStore extends CompetitionAdminStore, RegistrationAdminStore` (import the type from
  `./registration/types`).
- **`memory-store.ts`**: `...createRegistrationService(createMemoryRegistrationBackend())`. The memory backend has its own fictional seed
  of events, registrations and players. To make a conversion appear in the competition entries, a later step can share one store with
  the competition memory backend.
- **`supabase-store.ts`**: `...createRegistrationService(createSupabaseRegistrationBackend({ select, rpc }))`. Also add the five RPC
  names to `COMPETITION_DETAIL_RPCS`, so the database's plain INVALID sentences reach the owner: `admin_set_registration_settings`,
  `admin_set_event_registration`, `admin_verify_registration_payment`, `admin_convert_registration`, `admin_reject_registration`.
- **`http-store.ts`**: one method per action, POSTing to `/api/admin/registrations.<name>` like the competition methods.
- **Nav (`src/admin/AdminApp.tsx`, `src/admin/screens/More.tsx`)**: add an entry "Registrations" with the hint "people who registered
  for events on the website". Render `<RegistrationsScreen store={client} />` from `src/admin/screens/registrations/Registrations.tsx`.
  The screen takes the store as a prop and uses `useAdmin()` only for the actor, the notices and reloading.

## 3. Database (0020)

- **New private table**: `public.event_registrations`. Contact phone and email, names as typed, payment reference, verification,
  conversion and rejection. It has RLS on, no policies, everything revoked, and SELECT for `service_role` only.
- **New columns**:
  - `competition_settings.registration_payment_instructions`, `registration_upi_id` and `registration_payee_name`: all null. The UPI id
    and the payee name come as a pair. This adds the first write path for the 0017 switch `registration_enabled`, through
    `admin_set_registration_settings`, which also sets `payment_mode` to `manual_verification` or `off`.
  - `tournament_events.registration_open`: default false.
  - `tournament_events.entry_fee_paise`: null means no fee is shown. The range is 1 to 100,000,000.
- **New internal view**: `app.registration_open_settings` (no grants).
- **New api views**: `api.public_registration_events (event_id, entry_fee_paise)` and
  `api.public_registration_payment (payment_instructions, upi_id, payee_name)`. Both are security_barrier views with SELECT for anon and
  authenticated. Neither holds a name or any contact data.
- **RPCs (service_role only)**:
  - For the endpoint: `registration_lookup(uuid, uuid, text)` and `registration_submit(jsonb)`.
  - For the owner: `admin_set_registration_settings(text, jsonb, text)`, `admin_set_event_registration(text, uuid, jsonb, text)`,
    `admin_verify_registration_payment(text, uuid, jsonb, integer, text)`, `admin_convert_registration(text, uuid, jsonb, integer, text)`
    and `admin_reject_registration(text, uuid, integer, text)`.
- **Helpers (no grants)**: `app.registration_card_like(text)`, `app.registration_line_ok(text, integer)` and
  `app.registration_event_is_junior(uuid)`.
- **Junior events**: never take registrations. The view leaves them out, and both the event RPC and the submit RPC refuse them.
  Collecting a child's details needs a parental-consent flow (DPDP) that the lawyer has not approved.
- **Conversion**: goes through `admin_add_entry`, so the capacity, category and duplicate rules are the same and audited the same.
  - A new player is inserted with the column defaults: `age_status 'unknown'`, `is_provisional true`, hidden, noindex and an opaque
    slug, so it is never named (D-012, D-109, D-116).
  - An existing player keeps their own age status.
  - A suppressed name key is refused.
- **Capacity**: active registrations plus pending and confirmed entries, counted under the event's row lock.

### Checks run

- I ran `node scripts/with-lock.mjs heavy -- node scripts/pg-local.mjs all`, then `stop`. Every migration from 0001 to 0020 applied, and
  checks 0001 to 0005 passed. It then **stopped at `0006_assertions.sql`**, because schema api now holds two views that are not on its
  allow-list (expected; see section 4).
- I then ran every other check by hand against the same database, under the lock, skipping 0006: 0001 to 0005 and 0007 to 0020 all
  printed their `ok` row (0019 belongs to another agent). The server was stopped afterwards.

## 4. Registries to update (the integrator's files)

**RLS_MATRIX (`src/lib/admin/policy.ts`)**
```ts
// 0020_registrations.sql (D-111): registrations are private; two api views (event id + fee; payee payment texts) allow select only
'api.public_registration_events': { private: false, grants: PUBLIC_VIEW },
'api.public_registration_payment': { private: false, grants: PUBLIC_VIEW },
'event_registrations': { private: true, grants: OWNER_READ_RPC_WRITE },
```

**Anon harness (`scripts/anon-harness.mjs`)**
```js
// 0020_registrations.sql (D-111): the registrations table is denied; the two api views allow select only
{ name: 'event_registrations', pk: 'id', pkSample: NIL_UUID },
{ name: 'public_registration_events', pk: 'event_id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
{ name: 'public_registration_payment', pk: 'payee_name', pkSample: '__no_such_payee__', schema: 'api', expectSelect: true },
```

**`supabase/checks/0006_assertions.sql`**: add `'public_registration_events', 'public_registration_payment'` to the allow-list of named
later views, and mention 0020 in its comment.

**`tests/supabase/bundle.test.ts`**: the last check's ok row is now `ok: 0020_registrations assertions passed`, or a later migration's.

These tests fail until the rows above exist. All the failures are expected and none is in this module:
- `tests/admin/rls-matrix-schema.test.ts`
- `tests/supabase/migration.test.ts` (anon harness)
- `tests/supabase/migrations-structure.test.ts` (anon harness table list)
- `tests/supabase/bundle.test.ts`
- `tests/supabase/local-pg.test.mjs` (0006 allow-list, when a local server is up)

## 5. Feature flag (`src/content/legal/status.ts`, `tests/legal/features.test.ts`)

- `registrations: false`.
- arrives: `platform wave 5 (owner + lawyer)`.
- unlocks: `registration pages on the website (/register/<tournament>/<event>/): players register for an open adult event, with the
  owner's fee and payment texts; payment is made outside the website and checked by hand by the owner; junior events never take
  registrations`.
- `src/lib/registration/in-build.ts` reads the flag defensively (`features.registrations === true`). Until the flag exists it counts as
  off, so no cast is needed after you add it.
- The strict release build carries the pages only with `competitionPages` AND `registrations` both on.

## 6. Privacy `futureWording` (`src/content/legal/privacy.ts`, behind `features.registrations`)

Draft for the lawyer:

> **Registering for an event.** When you register a player for an event on our website, we collect the player's name (and a partner's
> name for doubles), a mobile number, an email address if you give one, and the payment reference if you type one. We use them only to
> handle the registration and to contact you about that event, and we share them only with the event's organiser and the service
> providers that run this website. We do not ask for a date of birth or an age, and we never ask for card details, a UPI PIN or a
> password. The fee is paid outside our website; we check payments by hand. The phone number, email address and payment reference are
> never shown on the website. A registered player is named on our competition pages only after we have confirmed that the player is an
> adult; until then, and always in junior events, the player is shown as "Protected player". Junior events do not take registrations on
> our website. We keep registrations [retention period: lawyer to decide], then delete the contact details.

The retention period has to be decided, and no purge job is built for it yet (section 10).

## 7. Runtime environment (`src/lib/runtime-env.ts`, `docs/SECRETS.md`)

- `REGISTRATION_ENABLED` (a switch, not a secret). Add it to `RuntimeEnv` and `NAMES`.
- The endpoint is open only when the value is exactly `true`. Until `NAMES` lists it, `getRuntimeEnv()` drops it, so the endpoint stays
  closed.
- `/api/register` reuses the lead endpoint's settings and needs no other new name:
  - `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
  - the `TURNSTILE_*` settings (the same widget action, `lead`, because the form reuses `TurnstileWidget`)
  - `HMAC_KEY`
  - `TELEGRAM_*`
  - `EMAIL_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM` and `OWNER_EMAIL`
  - `PUBLIC_WHATSAPP_NUMBER` and `PUBLIC_SITE_URL`
- `TELEGRAM_ALERT_PHONE_LINK` is deliberately ignored for registrations: a registration may be for a child, so no phone ever goes into
  its alert.

## 8. Owner alert

The Telegram message and the owner email (when email is on) hold only these lines:

- `New registration PSR-YYYY-XXXXXX`
- `Event: MS U19`
- `Player initial: R`
- `Fee: none shown`, `Fee: not paid yet` or `Fee: payment reference given, check it`
- `Open the admin: More, then Registrations (reference ...)`

When the database is down, the first line is `REGISTRATION NOT SAVED ...` instead. No acknowledgement email goes to the registrant in this
wave.

## 9. The switches (all off) and the order to turn them on

1. The owner switches registration on in the admin. This writes `competition_settings.registration_enabled`. Without it the database
   refuses every registration (`closed`) and both api views are empty.
2. The owner opens each event in the admin (`registration_open`) and sets its fee in rupees (stored in paise, or empty).
3. Vercel: set `REGISTRATION_ENABLED=true`. Otherwise the endpoint answers `closed` (409) without reading the request body.
4. `features.registrations` and `features.competitionPages` go on after the lawyer has re-read the notice in
   `src/lib/registration/consent.ts` and the privacy text above. Without them, the release build has no registration pages.

## 10. Open items (for the lead, the owner and the lawyer)

- **Links into the new pages.**
  - The competition event page `src/pages/competitions/[tournament]/[event].astro` (wave 3's file) should link to the registration page
    when one exists, with `registrationPath(t.slug, e.code)` and `loadRegistrationSite()`.
  - The sitemap needs nothing, because the page is noindex.
- **`/api/health`**: may report `registration: 'open' | 'closed'` (from `registrationSwitchOn`).
- **Retention.** Rejected and converted registrations keep their contact data until a purge exists. The lawyer decides the period; then a
  0010-style purge goes into a later migration.
- **DECISIONS.md (proposed record).**
  - The registration route lives at `/register/`.
  - Junior events never take registrations on the site.
  - A payment reference is 8 to 30 letters and digits with at least 6 digits.
  - A card-like number (Luhn check), or text containing PIN, password, OTP or CVV, is refused and never stored.
  - The phone link is never used in a registration alert.
  - Registrations count towards capacity.
  - A fee registration must be verified before conversion; an amount of 0 means the fee was waived.
  - A new player record starts provisional with unknown age.
- **G1 checklist.**
  - Re-read the notice and the privacy text.
  - Confirm junior events are refused.
  - Confirm the alert holds no contact data.
  - Confirm the admin's payment texts show nothing by default.
- **CHANGELOG.md**: add a line for wave 5 registration (the files above), with the test result lines below.
- **Owner inputs.** The owner's payment instructions, UPI id and payee name, and each event's fee. Nothing is defaulted.
- **Housekeeping.** While computing the notice's pinned hash, `npx tsx` was fetched into the npm cache (not the project; `package.json`
  and the lockfile are unchanged).

## 11. Test probes

- `npx vitest run tests/registration` passes on its own (5 files, 85 tests):
  - `parity.test.ts`: the form rules equal the server rules, and the SQL shapes match.
  - `handler.test.ts`: the switch, refusals, Turnstile, idempotency, every database outcome, degraded mode, the per-phone limit, the
    alert content and the logs.
  - `admin.test.ts`: the memory flow, the Supabase backend's RPC names and arguments, and the schemas.
  - `public.test.ts`: the page model, the gate, the provider, the alert text, the notice hash pin and the page source.
  - `sql.test.ts`: the static house rules.
- `supabase/checks/0020_assertions.sql`:
  - anon and authenticated are denied the table and the RPCs;
  - no api row holds a fictional phone, email, name or reference;
  - a junior event is refused;
  - capacity, duplicates, partner rules, replay, conflict and a taken reference;
  - verify before convert, STALE, FORBIDDEN for an editor;
  - a converted new player is unknown, provisional and not named, and a pair holding them is protected;
  - a suppressed name is refused;
  - switching off empties both views;
  - audit rows hold no private data.
- `tests/e2e/registration.spec.ts` needs a developer build and the stubs. It checks the singles and doubles pages, the 404 for a junior
  event, inline errors and focus, a card number refused in the browser, a good send with the notice id, and "full" shown in plain
  English.
- After wiring, also probe:
  - `POST /api/admin/registrations.convert` as an editor gives 403.
  - `registrations.setEvent` on a junior event gives `INVALID` with the plain sentence.
  - The anon harness gives 2xx on both views and denies `event_registrations`.
