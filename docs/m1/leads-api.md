# Lead API (M1) - `POST /api/lead`

Owner: Lead-backend worker. Contract in code: `src/lib/contracts/lead.ts` (zod schema, types, `validateLeadRequest`) and `src/lib/contracts/lead-constants.ts` (constants and response types, **no zod**: import this one from browser code to keep the bundle small, with `import type` for the types).

Changes to the contract are additive only (new optional field, new kind). The lead is told about every change.

## 1. Request

`POST /api/lead` with `Content-Type: application/json` (anything else gets 415). Body at most **20 KB** (413 above). Same-origin only: a browser `Origin` header that is not this site is refused.

The body is one object whose `kind` selects the shape. Unknown keys are stripped silently. Text is NFC-normalised, trimmed, length-capped; limits are in `LEAD_LIMITS` (code points, not bytes), so set `maxlength` from there.

### Fields every kind has

| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | `coverage` \| `sponsorship` \| `general` \| `player_product` \| `tournament_submission` | yes | `LEAD_KINDS` |
| `name` | string 2-80 | yes | Letters (any script, Tamil included), digits, space and `. , ' ( ) -`. Links, `@`, `< >`, a leading `= + - @`, and a run of more than 6 digits (a phone number pasted into the box; "2026-27 U19" is fine) are rejected. For `tournament_submission` this is the **contact person**. |
| `phone` | string | yes (except `general`) | Any common format: `98765 43210`, `098765 43210`, `+91 98765 43210`, Tamil digits. Stored and returned as digits with country code, e.g. `919876543210`. A leading `+` with a non-91 country code is accepted as an international number (8-15 digits). |
| `email` | string | no | ASCII only, lower-cased. Blank = absent. D-025: the first step has no email. |
| `organization` | string <=120 | no | For `tournament_submission` this is the **organizer or association**. |
| `whatsappOk` | boolean | no (default `false`) | "This number is on WhatsApp" tick. Never pre-ticked. |
| `contactPreference` | `whatsapp` \| `call` \| `email` | no | The "call me back" option of D-025 is `call`. |
| `lang` | `en` \| `ta` | no (default `en`) | |
| `source` | `{ path?: string, utm?: { source, medium, campaign, term, content } }` | no | **Lenient**: a bad value is dropped, it never rejects the lead. `path` must start with `/` (query and fragment are cut off); each utm value <= 64 chars. |
| `idempotencyKey` | uuid | yes | `crypto.randomUUID()`, created once per form instance. Re-send the **same** key when retrying the same submission. |
| `token` | string | yes | The Turnstile response token (`[A-Za-z0-9._-]`, <= 2,048 chars). Missing or empty gives `code: "turnstile"`. |
| `consent` | `{ id: "lead-notice", version: string }` | yes | Use `CONSENT.leadNotice.id` and `.version` from `src/content/consent.ts`. The server stores them with a timestamp. |
| `website` | string | no | **Honeypot**: render an input named `website` that people never see (off-screen, `aria-hidden`, `tabindex="-1"`, `autocomplete="off"`). It must stay empty. If it is filled the server answers with a normal-looking success and stores nothing. |
| `elapsedMs` | integer | no | Milliseconds from the visitor's first interaction with the form to submit. Under `MIN_FILL_MS` (1,000) is refused with `rate_limited` (retry works). |

### `kind: "coverage"` (spec 7.10, "Book coverage")

Required beyond the common fields: `phone`, `eventName`.

| Field | Type | Notes |
|---|---|---|
| `eventName` | string <=120 | Required. The "what" of D-025. |
| `startDate`, `endDate` | `YYYY-MM-DD` | Optional in the contract (so step 1 can be sent alone), but **D-025 asks for the date in step 1, so the form should require `startDate`**. `endDate` cannot be before `startDate`. Read as Asia/Kolkata dates. |
| `venue` | string <=120 | |
| `district` | string <=60 | Free text for now (the district list arrives with M2). |
| `level` | string <=40 | Free text label chosen by the form. |
| `courts` | integer 1-64 | A digit string is accepted. |
| `categories` | string[] (<=12 items, each <=40) | e.g. `["U13 Boys Singles"]` |
| `expectedEntries` | integer 1-10,000 | |
| `packageKey` | slug | Key of a package card (lowercase letters, digits, `_`, `-`; <=48). No price is ever sent or trusted. |
| `serviceKeys` | slug[] (<=12) | |
| `liveStream` | boolean | yes/no; leave out when unanswered. |
| `matchDays` | integer 1-30 | |
| `addOns` | slug[] (<=12) | |
| `organizerName` | string <=120 | Organizer or promoting association (D-019). |
| `filmingPermission` | `yes` \| `no` \| `unsure` | Has written filming and monetisation permission already been agreed? (D-019) |
| `budgetRange` | string <=60 | Label chosen by the form. |
| `notes` | string <=1,500 | Multi-line. At most 2 links. |

### `kind: "sponsorship"` (spec 7.11, "Partner with us")

Required: `phone`, `company` (<=120).
Optional: `companyUrl` (https only), `objectives` (multi-line <=1,500), `budgetRange`, `startMonth` (`YYYY-MM`), `packageKey` (slug), `notes`.

### `kind: "general"` (contact page, anything else)

Required: `message` (5-1,500, multi-line) and **a phone or an email** (otherwise `phone: "contact_required"`).
Optional: `topic` (slug).

### `kind: "player_product"` (future use)

Required: `phone`, `productKey` (slug).
Optional: `playerSlug` (slug of a **public** player page only), `matchRefs` (<=5 YouTube video ids, 11 characters each), `notes` (<=800).
No free-text player names, nothing about minors (D-012).

### `kind: "tournament_submission"` (spec 7.8, "List your tournament")

Required: `phone`, `tournamentName` (<=120), `startDate`.
Optional: `endDate`, `venue`, `city`, `district`, `categories` (string[]), `ageGroups` (string[]), `entryFee` (text <=60, not a number: the organizer's own wording), `registrationDetails` (<=800), `registrationLink` (https only), `posterUrl` (https link only, **no file upload in M1**, D-035), `listingType` (`free` default \| `featured`; P1 only records the request), `coverageInterest` (boolean, default `false`: when true the server **also creates a coverage lead** with the same contact and the event name/dates/venue).
`publicContactConsent`: `{ id: "tournament-public-contact", version, given: boolean }`, the **separate checkbox** (`CONSENT.tournamentPublicContact`). Leave it out or send `given: false` for "no". It never defaults to true.

## 2. Response

JSON, `Cache-Control: no-store`, `X-Robots-Tag: noindex`.

### Success (HTTP 201, or 200 for a replay)

```json
{ "ok": true, "ref": "PS-2026-7K3QDM", "waLink": "https://wa.me/91...?text=...", "replay": false }
```

- `ref`: `PS-<IST year>-<6 characters>`, random, never sequential; characters from `0-9 A-Z` without `I L O U`. Pattern in `REF_CODE_PATTERN`.
- `waLink`: prefilled WhatsApp message quoting the reference (no personal data in the text). Absent when no WhatsApp number is configured: then hide the button.
- `replay: true` when the same `idempotencyKey` was already stored (double click, retry after a dropped connection): the **same `ref`** is returned.
- With `coverageInterest`, the tournament lead has its own `ref`; the coverage lead's reference is internal (the owner is alerted for both).

### Failure

```json
{ "ok": false, "code": "validation", "message": "Some details need fixing. ...", "fieldErrors": { "phone": "invalid_phone" }, "correlationId": "c-4f9a1b2c", "waLink": "https://wa.me/..." }
```

| `code` | HTTP | When | What the form does |
|---|---|---|---|
| `validation` | 400 (not JSON), 413 (body too large), 415 (not `application/json`), 422 (a field is invalid) | `fieldErrors` maps a field path (`name`, `source`, `publicContactConsent.version` ...) to a field code | Show each field error inline and move focus to the first one. |
| `turnstile` | 403 | Spam check missing, expired (tokens live 5 minutes) or already used, or failed | Reset the widget, ask the visitor to tick it again. Keep the typed data and keep the same `idempotencyKey` (nothing was stored). |
| `rate_limited` | 429 | Too many tries from this connection or for this phone/email, or submitted too fast. `retryAfterSec` is set. | Show the message and the WhatsApp link (`waLink`). |
| `duplicate` | 409 | The `idempotencyKey` was used earlier for a **different** submission | Make a new `idempotencyKey` and reload the form state. |
| `degraded` | 503 | We could not store the enquiry (database down). The owner was alerted if Telegram works. | Show "message us on WhatsApp" with `waLink`; keep the typed data and allow a retry with the same key. |
| `server` | 500 | Unexpected error | Show the message, the `correlationId` and `waLink`. |

Field error codes (`FIELD_ERROR_CODES`, plain-English defaults in `FIELD_ERROR_MESSAGES`): `required`, `too_short`, `too_long`, `invalid`, `control_chars`, `url_not_allowed`, `formula_not_allowed`, `html_not_allowed`, `too_many_digits`, `invalid_phone`, `invalid_email`, `invalid_date`, `invalid_url`, `contact_required`, `consent_required`. Input values are never echoed back.

## 3. What the server does (order matters for retries)

1. Method (POST only), content type, body size, JSON, zod validation.
2. Honeypot filled: fake success, nothing stored. Under 1 second fill time: `rate_limited`.
3. Per-connection limit (salted IP hash): the Workers Rate Limiting binding if configured, plus a database counter.
4. **Idempotency lookup**: the same `idempotencyKey` with the same phone returns the same `ref` before any Turnstile call (a Turnstile token works only once, so a retry could not re-verify it).
5. Turnstile `siteverify`, fail closed (a network error, a missing secret or a non-matching hostname/action is a `turnstile` failure).
6. Per phone and per email limit (database counter).
7. Insert into `leads` (a trigger writes the `created` row in `lead_events`).
8. Telegram alert to the owner (plain text, D-029 content rules). Email alert and the customer acknowledgement only when `EMAIL_ENABLED=true` (off until the domain is verified, D-022).
9. Respond.

Never stored or logged: the token, the IP address (only a salted HMAC), request bodies.

## 4. Other endpoints

- `GET /api/health`: 200 `{ "ok": true, ... }`, no database access, `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
- `POST /api/event`: `{ "name": "whatsapp_click", "path": "/book", "props": { "context": "sticky" } }`. Allow-listed names (`EVENT_NAMES`): `whatsapp_click`, `share_click`, `form_start`, `form_submit`, `form_error`, `outbound_click`. Returns 204. No personal data: unknown props are dropped. Use `navigator.sendBeacon` with a `Blob` of type `application/json`. See `src/lib/contracts/event.ts`.

## 5. Notes for the forms

- Load Turnstile on first interaction (D-010) and render it with `data-action="lead"` (the server checks the action when it is configured).
- The `token` is single use: after any failed submit (except a network error before the response) reset the widget and get a new token.
- Do not compute reference codes, prices or WhatsApp links in the browser; use `waLink` from the response.
- Keep the typed form data when an error comes back; the visitor should never have to retype.
