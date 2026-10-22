# Forms worker notes (M1)

Owner of this file: Forms worker. Written 2026-10-21. Covers `/book`, `/partner`, `/contact`, `/tournaments/submit` and the shared form kit.

## 1. What was built

Pages (all use `BaseLayout`, one H1, `PageHero`, a WhatsApp button next to the form, a React island with `client:visible`):

| Route | File | Lead kind | Steps |
|---|---|---|---|
| `/book` | `src/pages/book.astro` | `coverage` | 3: Event > Services > Contact (D-025: step 1 asks four things) |
| `/partner` | `src/pages/partner.astro` | `sponsorship` | 2: About you > Your plan |
| `/contact` | `src/pages/contact.astro` | `general` | 1 |
| `/tournaments/submit` | `src/pages/tournaments/submit.astro` | `tournament_submission` | 3: Tournament > Details > Listing |

Astro helpers: `src/components/forms/FormSection.astro` (form + "Good to know" column + WhatsApp button; renders the blocked state, see 4), `src/lib/forms/page-config.ts` (build-time config for the pages only: Turnstile mode, WhatsApp number, package options from `products.ts` / `sponsor-packages.ts`, consent texts).

React kit (`src/components/forms/`): `Field`, `TextArea`, `Select`, `Checkbox` (never pre-ticked), `RadioGroup`, `FieldRenderer` (incl. tick-box group for add-ons), `StepIndicator`, `SubmitButton` (aria-disabled pending state), `FormStatus` (always-mounted `aria-live` polite + assertive regions), `ConsentNotice`, `Honeypot` (field name `website`), `TurnstileWidget`, `WhatsAppButton`, `Confirmation`, `FailurePanel`, `LeadForm` (the one generic island), and four thin entries `BookForm`, `PartnerForm`, `ContactForm`, `TournamentSubmitForm`. Shared class strings in `styles.ts`, inline icons in `icons.tsx`.

Pure logic (`src/lib/forms/`, all tested in Node): `defs/{common,coverage,sponsorship,general,tournament}.ts` (the forms as data; `definitions.ts` is a barrel for tests), `flow.ts` (step state machine), `steps.ts`, `rules.ts` + `validate.ts` (client validation), `payload.ts`, `attribution.ts` (page path + 5 UTM values), `idempotency.ts`, `submit.ts` (timeout, one safe retry, outcome type), `turnstile.ts` + `gate.ts` + `widget-text.ts`, `analytics.ts`, `whatsapp-prefill.ts`, `summary.ts`, `confirmation-text.ts`, `engine.ts` (lazy bundle entry).

Tests (`tests/forms/`, 9 files, 175 tests): `flow`, `validation`, `parity`, `payload`, `submit` (also error-code messages and idempotency), `turnstile`, `whatsapp-and-analytics`, `page-config`, `bundle-guard`. Whole suite at the end: 57 files, 1473 tests green. `npm run check`: 0 errors, 0 warnings. Locked build: green.

Behaviour worth knowing:
- Idempotency key: one UUID per form session, **reused** when the same data is sent again (a retry after a timeout), replaced when the visitor changed the data or after a `duplicate` answer or a success. `submitLead` retries once after a dropped connection, a timeout, a gateway 5xx, or `degraded`, with the same body. This relies on the server looking up the idempotency key before Turnstile (leads-api.md section 3, step 4: confirmed).
- After every failed send the Turnstile widget is reset (a token is single use).
- Failure screen: the visitor's input stays in the form; a "Try again" button (when it can help); a WhatsApp button with a prefilled summary (event name, date, package, district, level, listing type and the visitor's own message text, scrubbed of emails, links and long digit runs; never name, phone, email, organisation, company or organizer); the correlation id.
- Confirmation: reference code, "We reply within X." **only** when `site.replyTimePromise` is set, else "We will get back to you as soon as we can."; WhatsApp button prefilled with the reference only; "what happens next". It never says an email was sent (D-022).
- Focus: first error on a failed Next or Send (steps open first if the error is on another step); step heading when a step opens; confirmation or failure heading when they appear. Errors are linked with `aria-describedby`; inputs are 16 px; targets 44 px (`min-h-tap`).
- `?package=<slug>` (Site-shell request): **done** on `/book` (coverage packages) and `/partner` (sponsor packages). The slug preselects the Package box after hydration, only if it is one of the offered options (`preselectedOption`, tested). The Partner page package buttons link to `/partner?package=<slug>#enquiry`.
- Legal worker request: **done**. `/contact` renders `src/components/legal/GrievanceOfficer.astro` (legal name, address, phone, email, grievance officer, each a `<Todo>` until supplied, OT-19). Optional opening hours are hidden until `site.contactHours` exists.

## 2. Measured JavaScript (spec 12.5: 80 KB gzip per public page)

Measured on the locked production build, 2026-10-21, with `PUBLIC_TURNSTILE_SITE_KEY` set to Cloudflare's published test key and a fictional WhatsApp number (so the island is rendered). Gzip of the files under `dist/client/_astro/` plus the page's inline hydration scripts (Astro's `astro-island` and `client:visible` scripts, 5.2 KB raw, 2.0 KB gzip, same on every page).

| Page | Loads at hydration (static imports) | + inline | After the first touch and a send (all lazy chunks) | + inline |
|---|---|---|---|---|
| `/book` | 77.2 KB | **79.2 KB** | 88.0 KB | 90.0 KB |
| `/partner` | 76.7 KB | **78.7 KB** | 87.5 KB | 89.5 KB |
| `/contact` | 76.3 KB | **78.3 KB** | 87.0 KB | 89.1 KB |
| `/tournaments/submit` | 77.1 KB | **79.2 KB** | 87.9 KB | 90.0 KB |

Breakdown (gzip): `client.js` (React DOM + the Astro React renderer) 64.3 KB and `react.js` 2.9 KB are fixed: 67.2 KB before any form code. Form shell (`LeadForm` chunk) 8.6 KB, page entry 0.4 to 1.4 KB. Lazy chunks: `engine` (validation rules, sender, payload) 6.2 KB, `turnstile` logic 0.7 KB, `Confirmation` 1.1 KB, `FailurePanel` 1.4 KB, `WhatsAppButton` 0.8 KB, `analytics` 0.5 KB (10.7 KB together). Cloudflare's own Turnstile script is third-party and not counted.

**Result.** What a visitor loads when the page is viewed is under 80 KB on all four pages (78.3 to 79.2 KB with inline scripts), with only about 0.8 to 1.7 KB of headroom. The lazy chunks are fetched on the first focus, tap or key press (and the thank-you screens when Send is pressed); a visitor who fills in and sends the form loads about 87 to 90 KB in total. If the lead reads the budget as "everything the page can ever load", the forms are about 10 KB over. React is 67 KB of it, so the real fix is outside this slice: see proposed decision P3.

How it got here (it was 111 KB first): the zod contract cannot be shipped to the browser (it added about 30 KB gzip), so the client uses `rules.ts` (see P1); form definitions are split per kind so a page loads one; and the consent texts reach the island as props. `tests/forms/bundle-guard.test.ts` fails if zod, the contract, the validation rules, the sender, the Turnstile logic or the thank-you screens are imported eagerly, or if a page loads another page's form definition.

## 3. Page checks (built HTML)

Each of the four pages has exactly one `<h1>`, one `<astro-island client="visible">`, a server-rendered first step with `<form method="post" novalidate>` (so a keystroke before hydration can never put typed data into the address bar), no Cloudflare or other third-party script in the HTML, and no `TODO(owner)` of ours except the intended ones: `/book` and `/tournaments/submit` only the footer one; `/contact` the footer plus the six OT-19 details from `GrievanceOfficer`; `/partner` the footer plus the package approval and four package prices (Site-shell's `PackageCard` rule). A build with no `PUBLIC_TURNSTILE_SITE_KEY` renders no island and no form on any of the four pages, shows "This form is not switched on yet" plus the WhatsApp button, and prints `TODO(owner): PUBLIC_TURNSTILE_SITE_KEY (OT-41)...` so the strict gate fails until the key exists (an outcome the lead may want to know before running a strict build without the key).

Privacy scan follow-up: no user-visible text in the forms (hints, placeholders, errors) contains an example phone number; the phone hints say "A 10-digit mobile number. You do not need to type +91." A search of `dist/client` (html and js) after the final build found no `98765`, `43210` or ten-digit pattern (the lead changed the `invalid_phone` message in `lead-constants.ts`). Fictional numbers remain only in `tests/forms/` (not shipped).

Final state, 2026-10-21: `npm test` 57 files / 1474 tests green (forms: 9 files, 175 tests), `npm run check` 0 errors, locked build green.

Not done: no real-browser run (no Playwright or browser was used; rule 4), so keyboard order, focus movement, the widget rendering and the 360 px layout are verified by code and tests only. The Playwright tests in the plan need the lead's go-ahead for the browser download.

## 4. Deviations from the brief and spec

1. **Client validation does not use the zod schemas** (brief: "reuse the same zod schemas"). Reason: size (above). Instead `src/lib/forms/rules.ts` copies the contract's field rules using the same primitives (`cleanText`, `normalisePhone`, `normaliseEmail`, `normaliseHttpsUrl`) and limits, and `tests/forms/parity.test.ts` compares it with `validateLeadRequest` on about 350 good and bad inputs across every field of every form (plus selects, the phone-or-email rule and end-before-start). A change in the contract that is not copied fails that test. The server stays the authority.
2. **Three forms are multi-step, not only `/book`** (D-025 says step 1 of `/book`, `/partner` and `/tournaments/submit` has four fields).
3. `/book` filming-permission question (D-019) is **required** (Yes / No, not yet / Not sure; "Not sure" is a valid answer). `startDate` is required by the form although optional in the contract (as leads-api.md advises).
4. Budget is free text "Your budget" (the contract allows a label up to 60 characters and no run of more than 6 digits); I did not invent budget bands.
5. `whatsappOk` is derived (true only if the visitor picked "WhatsApp" as the way to reach them); there is no pre-ticked box. `contactPreference` is an optional radio.
6. The Partner page does not repeat the spec's "players, parents, coaches and organizers across Tamil Nadu" (D-024 asks to drop it unless Studio supports it); it says "Reach Tamil Nadu's badminton community." and shows the owner-stated channel figures from `site.channel` with their date.
7. `form_error` event is not sent (the brief names three events).

## 5. Proposed decisions (for DECISIONS.md, the lead consolidates)

**P1. Client-side validation copy with a parity test.**
- Context: the zod contract adds about 30 KB gzip to each form page; React already uses 67 KB of the 80 KB budget.
- Decision: the browser validates with `rules.ts` (same primitives and limits); the Worker validates with zod; `parity.test.ts` keeps them identical.
- Consequences: two places to change a rule; the test catches drift. Better fix (request R1): a zod-free module of rule sets that both import.

**P2. Forms load in three layers.**
- Context: spec 12.5 (80 KB), D-010 (nothing heavy on the page-load path).
- Decision: at hydration only React plus the first screen; on the first focus, tap or key: the engine and Turnstile logic; on Send: the thank-you and failure screens.
- Consequences: a visitor who sends loads about 10 KB more than one who only looks.

**P3. Decide the React weight question.**
- Context: React DOM is 64.3 KB gzip of every form page; the forms cannot get below about 77 KB on view without removing React.
- Options: (a) accept the current numbers (under 80 KB on view); (b) alias React to Preact (needs `@astrojs/preact` and `preact`, about 4 KB gzip, not installed; rule 2 forbids me adding them); (c) vanilla TypeScript forms. Recommendation: (a) now, (b) if more islands are added to the same pages.

**P4. A missing Turnstile key renders a `TODO(owner)` and no form in any non-development build** (never a form that silently skips the check). In a development build the form shows a clearly marked dev-only notice and the server decides.

## 6. Facts verified

- Turnstile explicit render, widget options, `reset`/`remove`, token lifetime (300 s) and single use: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ and `.../widget-configurations/`, read 2026-10-21 (also in `docs/m1/third-party-integration-facts.md` TP-A2). Script URL `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=<callback>`; `size: 'flexible'` fits 360 px (minimum 300 px).
- Test keys (`1x00000000000000000000AA` always passes): https://developers.cloudflare.com/turnstile/troubleshooting/testing/, read 2026-10-21. The widget action is `lead` (the server checks it).
- Event prop names per event from `src/lib/contracts/event.ts`: `form_start {form}`, `form_submit {form, ok}`, `whatsapp_click {context, page_type}`; values are slugs. `tests/forms/whatsapp-and-analytics.test.ts` runs our event bodies through the Worker's `validateEvent` and checks that nothing is dropped.

## 7. Requests

**Lead (tsconfig, headers, gate)**
- tsconfig has `jsx: preserve` and no `jsxImportSource`; every `.tsx` I wrote starts with `/** @jsxImportSource react */`. Setting `"jsx": "react-jsx", "jsxImportSource": "react"` in `tsconfig.json` would remove the need. Vitest cannot parse `.tsx`, so React files hold no logic that tests need.
- CSP for the form pages: `script-src https://challenges.cloudflare.com`, `frame-src https://challenges.cloudflare.com`, `connect-src 'self'` (the island posts to `/api/lead` and `/api/event`). Do not set `Cache-Control` in a `/*` rule (it stops the adapter adding the immutable `/_astro/*` block).
- `/tournaments/[slug]` must never generate the slug `submit` (the static route would clash).
- `scripts/check-placeholders.ts`: the forms' `TODO(owner): PUBLIC_TURNSTILE_SITE_KEY (OT-41)...` is deliberate in a build without the key.

**Site-shell worker (`src/content/site.ts`)** (I read these defensively; absent = hidden or no promise; none was edited)
- `replyTimePromise: string | null`, for example `"24 hours"` (Confirmation shows "We reply within 24 hours." only if set). Needs an owner answer.
- `mediaKitPdfPath: string | null`, a public path such as `/media-kit.pdf`. The `/partner` download button shows only if set.
- `contactHours: string | null` for `/contact` (hidden when null).
- The WhatsApp buttons rendered by `components/site/WhatsAppButton.astro` carry `data-wa-click` / `data-wa-source`, but I found no script that listens for them: the buttons on my four pages (hero, side column) are therefore not logged. Buttons inside the island (confirmation, failure panel) do send `whatsapp_click`. If a global listener is added, it can call the same `POST /api/event` body `{name:'whatsapp_click', path, props:{context}}`.

**Lead-backend worker**
- R1: export the field rule sets from a zod-free module (`NAME_RULES`, `ORG_RULES`, `SHORT_RULES`, `TINY_RULES`, `LONG_RULES`, `NOTE_RULES`, the character patterns, the integer ranges) and import them in `lead.ts`; then `src/lib/forms/rules.ts` can drop its copy.
- The contract lacks nothing the forms needed. Fields unused by the forms: `serviceKeys`, `topic`, `player_product`. `level`, `district` and `budgetRange` are free text; the forms offer a fixed `level` list (District, State, South India, Open, Other: the spec's own wording).
- The 20 KB cap and `MIN_FILL_MS` are respected (the form sends `elapsedMs` from the first touch; a very fast Send gets `rate_limited` and the visitor sees the wait text).

## 8. Open owner questions

1. Do you promise a reply time (the spec sample says 24 hours)? Until you say, no promise is shown.
2. Is the filming-permission question wording right for organizers, and should it stay required?
3. Do you have a media kit PDF to publish on `/partner`? (Hidden until then.)
4. Opening hours for `/contact`? (Hidden until then.)
5. Featured tournament listing: the form records a request only and says "you do not pay on this page". Right wording?
