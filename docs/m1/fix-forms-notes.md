# Forms fix notes (M1 review-fix wave)

Owner of this file: Forms fix worker. Written 2026-10-21. Covers `/book`, `/partner`, `/contact`, `/tournaments/submit` and the shared form kit.
This file replaces sections 1, 2 and 5 of `docs/m1/forms-notes.md` where they disagree (the island is now one generic island, the
numbers are new, P3 is answered); the rest of `forms-notes.md` still holds.

## 1. Result in one table

| Finding | Verdict | What changed (short) |
|---|---|---|
| C-1 JS budget | **fixed** | every form page: 82,269 B -> **77,495 B gzip** measured the strict way (inline scripts included). 75.7 KiB (77.5 kB). See section 2. |
| B-1 phone marks | fixed (shared code) | the client uses the same `normalisePhone` as the Worker, which now strips the invisible marks (R-PHONE). Parity tests with NBSP, NNBSP, thin space, zero-width and bidi marks. |
| B-2 text characters | fixed (shared code) | the client imports `LABEL_CHARS_RE` and `NAME_CHARS_RE` from `lead-constants.ts` (R-TEXT). Parity tests with rupee sign, dashes, curly quotes, `% ! ? ·`, and the characters that must stay refused. |
| B-18 date window | fixed | start date: real date from yesterday to 1,095 days ahead in India time, code `date_out_of_range`, one sentence. Client clock injectable. See 3.3 for what the server does and does not check. |
| B-4 elapsedMs | fixed | client clamps to 0..24 h and restarts its timer after a SUCCESSFUL send only; a retry keeps the original start and never carries less than `MIN_FILL_MS` (follow-up N-2). |
| B-5 degraded retry | fixed | only "no answer at all" (network, timeout) is retried automatically; any answer, `degraded` included, is final; the widget is reset and the visitor sends again with a fresh token. |
| B-10 submit before hydration | fixed | fieldset disabled in the server HTML, "Loading the form..." hint, `<noscript>` block with WhatsApp. Browser-checked. |
| B-13 trimmed value | fixed | `checkForm` checks the trimmed value that `buildPayload` sends. |
| B-14 stale spam-check message | fixed | cleared when the widget reports solved. Browser-checked. |
| C-18 permission wording | fixed | "written permission or agreement" for filming, publishing and earning, Yes / Not yet / Not sure. |
| R-TOPIC | fixed | `/contact?topic=<key>` from an allow-list. |
| C-20 no browser test | **deferred (owner approval)**, partly mitigated | no Playwright (rule). I ran a manual smoke test of all four pages in the built-in browser with a stubbed spam check (section 6) and list what a browser test must cover (section 7). |
| R-LINKS (my pages) | done | the four pages, `FormSection.astro` and the consent notice take their internal links from `ROUTES` / `cfg.privacyHref` (`src/lib/urls.ts`). |

Checks at the end: `npm test` **green** (84 files, 2,241 tests passed, 2 skipped; `tests/forms`: 10 files, **283** tests, was 175); `npm run check`:
**0 errors in my files** (the type check also reads everything under the project root, so no build output or scratch bundle may sit
inside it: my build snapshot lives in the system temp folder). Locked production builds: green (several during the work).

## 2. C-1: first-party JavaScript on the form pages

### Method (strict)

`tmp/measure-js-strict.mjs <dir> [page]` (gzip level 9): for each HTML page, every `<script type="module" src>`, every island entry
(`component-url`, `renderer-url`), the **static import closure** of all of those, plus the **inline `<script>` blocks** (Astro's island and
`client:visible` scripts, 2,181 B; JSON-LD is data and is skipped). Dynamic `import()` is not followed; it is reported as "lazy".
`tmp/build-snapshot.mjs` builds with Cloudflare's published test key and a fictional WhatsApp number (so the island renders) and copies
`dist/client` to the system temp folder (run it under the heavy lock). Budget unit: the review's numbers are KiB (82,269 B = 80.3 KiB), so
"76 KB" is read as 76 KiB = 77,824 B. In kilobytes of 1,000 B the result is 77.5 kB.

### Before and after (gzip bytes, strict, per page)

| Page | Before (original `dist`: chunk sizes read at the start) | After |
|---|---|---|
| `/book` | 82,269 | **77,495** |
| `/partner` | 81,747 | **77,495** |
| `/contact` | 81,295 | **77,495** |
| `/tournaments/submit` | 82,210 | **77,495** |
| a page with no form (for example `/about`) | 1,829 (site-wide script, `analytics` and `lead-constants`) | **717** |

All four pages now load the same files. Breakdown of the 77,495 B on every form page:

| Part | Bytes | Whose |
|---|---|---|
| `client.js` (React DOM + Astro's React glue) | 65,681 | fixed (Astro/React) |
| `react.js` | 3,087 | fixed |
| inline scripts (island element 1,918 + visible directive 263) | 2,181 | fixed (Astro) |
| site-wide `wa-click` script + `analytics` | 378 + 339 | other (was 378 + 553 + 901 for `lead-constants`) |
| `LeadForm` (the whole first screen of the form, all four pages) | 3,986 | mine |
| `preload-helper` (Vite's dynamic-import helper) | 852 | fixed, see below |
| `icons` + `styles` (alert icon, class strings, React's JSX shim) | 303 + 688 | mine / fixed |
| total | **77,495** | 75.7 KiB |

What a visitor loads after that (gzip, all lazy): first touch of the form: engine 8,559 + events 293 (+ `ChoiceField` 1,007 on the multi-step
forms); reaching the last step: spam check logic 876 + 943; sending: thank-you screen 1,160 + WhatsApp button 1,117 (or failure panel 1,471).
All lazy chunks together: 15,426. The total a visitor can ever load is about the same as before (92.9 KB against 92.8 KB); the change is what
loads **on view**.

### How the 4.8 KB came off

1. **One island entry, the form definition built at build time.** `BookForm`, `PartnerForm`, `ContactForm` and `TournamentSubmitForm` are gone. Each page builds
   its `FormDef` in the Astro frontmatter (`defs/*.ts`, run at build time only) and hands it to `LeadForm` as a prop. The labels, hints and
   options therefore live in the page's HTML props instead of in JavaScript: JS -1.4 to -2 KB on every page, HTML +0.7 to +1.9 KB gzip
   (`/contact` +738 B, `/partner` +1,284, `/tournaments/submit` +1,629, `/book` +1,915). The browser also no longer carries the field factories. Total bytes per page
   went down; the bytes that moved are data, not code to compile.
2. **The part of the state machine the page needs at once is tiny** (`flow-base.ts`: state shape, starting state from `FormDef.initial`, typing, the
   address-bar preset). Next, Back, Send, results (`flow.ts`) and the whole send procedure (`controller.ts`, new, pure TypeScript, tested with fakes) load with the engine on the
   first touch. The island passes the engine a small `Controls` object (how to read the latest state, how to change it, where the spam-check token is).
3. **`analytics.ts` no longer imports the constants file.** Every page loads it through the site-wide `wa-click` script, and it was pulling `lead-constants` (901 B) onto
   every page. The form events moved to `events.ts` (loads with the engine). Non-form pages lost 1.1 KB of JavaScript.
4. **Choice controls are a lazy chunk** (`ChoiceField.tsx`: select, radio, tick boxes): no form shows one on its first step. The first touch fetches it before the visitor reaches step 2.
5. **The spam check's working part is a lazy chunk** (`TurnstileLogic.tsx`); the page only draws the reserved box and one sentence.
6. **One component draws every text box** (the old `Field`, `TextArea`, `Select`, `Checkbox`, `RadioGroup`, `FieldParts` are merged into `FieldRenderer` + `ChoiceField`); the dead
   "form is blocked" panel and its `waLink` import are gone from the island (`FormSection.astro` already renders that case); the icons used only after sending are in `icons-more.tsx`;
   the step bar is plain divs (the visible text "Step 2 of 3: Services" already carries the meaning); the sending spinner is CSS.

### What I could not remove, and what I tried

- **Vite's preload helper, 852 B + about 280 B of dependency list inside `LeadForm`.** Every dynamic `import()` is wrapped by it. I tried `vite.build.modulePreload: false` in a
  scratch copy of the config (own output folder): the built page was **byte-for-byte the same size** and the helper chunk was still there (Astro's own Vite settings evidently win, or the wrapper stays whatever the option says; I did not dig further).
  So I found no config fix and do not recommend that line.
- React DOM, React and Astro's two inline scripts are 71.0 KB of the 77.5. Below about 76.5 KB the only lever left is not shipping React DOM to the forms
  (Preact alias or hand-written forms, proposed decision P3 in `forms-notes.md`, lead-only dependency change). With the present structure the forms cannot reach 76,000 B.

### Guards added

`tests/forms/bundle-guard.test.ts`: the first-load graph is **exactly** a 12-file list (a new static import has to be added there on purpose); the engine, reducer logic, validation, Turnstile logic, thank-you
screens, choice boxes, WhatsApp code, the constants file and every form definition must not be reachable without `import()`; every page builds its own definition and hydrates with `client:visible`;
`analytics.ts` has no runtime imports and `EVENT_PATH` equals the contract's endpoint. A real size check belongs in the build (request R-1 below).

## 3. The behaviour findings

### 3.1 B-1, B-2 (R-PHONE, R-TEXT)

The Lead-backend worker put the shared parts in `src/lib/contracts/lead-constants.ts` (`stripPhoneIgnorables`, `NAME_CHARS_RE`, `LABEL_CHARS_RE`, `ELAPSED_MS_MAX`, `istToday`, `isStartDateInWindow`, the new field code
`date_out_of_range`) and `normalisePhone` strips the marks itself. `src/lib/forms/rules.ts` imports them, so the client no longer has its own copy of the lists and the phone clean-up.
Because both sides now call the same function, `tests/forms/parity.test.ts` also asserts the **outcomes** (a number with NBSP, NNBSP, thin space, zero-width space, direction marks is accepted; en dash, soft hyphen and a letter O are refused;
the rupee sign, en and em dash, curly quotes, `% ! ? ·` are accepted in label boxes and not in a person's name; `| ; [ ] { } \ ` = < >` and CR/LF/TAB stay refused), so a change that breaks both at once is still caught.
A deterministic fuzz corpus (seeded; 20,870 candidate values: tricky characters at the start, inside and at the end of eight realistic values per kind, plus random strings) runs through **every** text, multi-line, phone, email,
link, date, number and list box of all four forms, client against server. Result: no differences.

### 3.2 B-13 (trimmed value)

`checkForm` now checks `textOf(raw).trim()`, the value `buildPayload` sends. The fuzz run confirmed the review's claim (edge BOM, U+2028/9, line breaks were the only differences).

### 3.3 B-18 / R-DATE

- The server checks the window for **`startDate` only** (kinds `coverage` and `tournament_submission`), with its own code `date_out_of_range` (message from `FIELD_ERROR_MESSAGES`, the agreed sentence). The client does the same
  (`{ kind: 'startDate' }` rule in `rules.ts`): a start date outside the window gives `date_out_of_range`; a date that is not a real date still gives `invalid_date` ("Please pick a valid date.").
- `endDate` and `startMonth` are checked as plain dates by the server (2000-2100, real), and so by the client. A last day cannot be before the first day, so it is bounded below; it is not bounded above (a last day in 2099 passes). If the owner wants more, that
  is a Lead-backend change plus the same one-line rule here: **request B-1 below**.
- The clock is injectable: `checkForm(form, values, now)`, `validateStep`, `validateValues`, `checkValue(..., now)`; the server has `validateLeadRequest(body, { now })`. Tests pin `Date` with `pinClock()` (fake timers for `Date` only) and
  compare both sides at six instants around midnight India time (18:29:59.999 and 18:30:00.000 UTC, New Year, a leap day) for every date from three days before to three days after each edge.

### 3.4 B-4 / R-ELAPSED

`clampElapsed` (payload.ts): whole milliseconds inside 0..`ELAPSED_MS_MAX`; a non-number is left out. The island keeps `startedAt`; the engine restarts it **only after a successful send**.
**Follow-up N-2 (correctness re-check):** my first version restarted the timer after *every* send. After a field error or a failure the visitor fixes one character and presses Enter within a second of that keystroke:
`elapsedMs` was below `MIN_FILL_MS` (1 s), the server answered `rate_limited` and there is no Try again. Now: the original start is kept after a field error, a failure, a `degraded` answer, a lost connection and a rate limit;
and, as belt and braces, a *retry* (a send was already made for this form) sends `max(elapsed, MIN_FILL_MS)`, while a first send is reported as it is. Tests (written first, 5 failed against the old code): `tests/forms/controller.test.ts`, "B-4 / R-ELAPSED / N-2".

### 3.5 B-5

`isSafeToRetry` is now `network` or `timeout` only (no answer at all; safe because the server reads the idempotency key before it looks at the token). 502/503/504 pages and the server's `degraded` are final for the attempt: `resetSpamCheck: true`
(unchanged) resets the widget, the visitor sees the real "We could not save your enquiry just now..." message with the WhatsApp fallback, and "Try again" needs a fresh token (the idempotency key is kept, so nothing is duplicated).
Browser-checked against a mock Worker: after `degraded` exactly **one** POST, the widget reset, and the second send used `tok-2`, the same key, and no timer.

### 3.6 B-10

Server HTML: `<fieldset role="none" disabled>` around every control and button, `<p role="status">Loading the form...</p>`; after hydration an effect enables it and removes the hint (`ready` state; SSR and the first client render agree, no mismatch).
`FormSection.astro` adds a `<noscript>` block ("This form needs JavaScript", plus the WhatsApp button through `WhatsAppButton.astro` / `waLink()`, or only the sentence when no number is configured). With JavaScript off the hint text "Loading the form..." is also shown
(the noscript block below it explains); I left that. Pressing the button or Enter before hydration cannot do anything: every control is disabled (browser-checked: no navigation, no request).

### 3.7 B-14

`TurnstileLogic` calls `onSolved`; the engine's `clearSpamWait` clears the banner only when it is the "still finishing" sentence. Browser-checked.

### 3.8 C-18

Label: "Do you have written permission or agreement from the organizer or association for us to film the matches, publish them and earn money from them?". Options **Yes / Not yet / Not sure** (values unchanged: `yes`, `no`, `unsure`).
Hint: "A WhatsApp message or an email counts as written. If it is not agreed yet, choose "Not yet" or "Not sure": we can help you ask." The side-column bullet on `/book` says the same. Still required; "Not sure" is a complete answer.
Wording is plain English; the owner has not confirmed it (forms-notes open question 2 still stands, and the lawyer reads D-019 wording).

### 3.9 R-TOPIC

`FormDef.preset = { param, field, options?, prefix? }`; `presetValue()` looks the parameter up in an allow-list and only a match gives a value (the option's value, or `prefix + label` taken from the **list**, never from the address bar).
`/contact?topic=<key>`: the list is `topicOptions()` = every key in `products.ts` and `sponsor-packages.ts`; a match fills the empty message box with "I would like to know more about: <name>". `/book?package=` and `/partner?package=` use the same mechanism
(field options as the list). Tests: every real key pre-fills and the text passes the server contract; unknown keys, free text, markup, `__proto__`, case and spacing tricks give nothing. Browser-checked (a key, and free text with `<b>` giving an empty box).
The product pages' links (`/contact/?topic=<key>` for non-coverage products) are Shell's, in `products.ts` (read-only for me).

## 4. Files

**Changed or new** (`src/lib/forms/`): `flow-base.ts` (new), `controller.ts` (new), `events.ts` (new), `flow.ts`, `engine.ts`, `analytics.ts` (sender only), `rules.ts`, `validate.ts`, `submit.ts`, `payload.ts`, `steps.ts`, `types.ts`,
`turnstile.ts`, `widget-text.ts`, `page-config.ts`, `defs/common.ts`, `defs/coverage.ts`, `defs/sponsorship.ts`, `defs/tournament.ts`, `defs/general.ts`.
(`src/components/forms/`): `LeadForm.tsx` (rewritten), `FieldRenderer.tsx` (rewritten, text boxes), `ChoiceField.tsx` (new), `TurnstileWidget.tsx`, `TurnstileLogic.tsx` (new), `ConsentNotice.tsx`, `StepIndicator.tsx`, `SubmitButton.tsx`, `icons.tsx`,
`icons-more.tsx` (new), `styles.ts`, `styles-more.ts` (new), `WhatsAppButton.tsx`, `Confirmation.tsx`, `FormSection.astro`. Pages: `book.astro`, `contact.astro`, `partner.astro`, `tournaments/submit.astro`.
**Deleted:** `BookForm.tsx`, `PartnerForm.tsx`, `ContactForm.tsx`, `TournamentSubmitForm.tsx`, `Field.tsx`, `TextArea.tsx`, `Select.tsx`, `Checkbox.tsx`, `RadioGroup.tsx`, `FieldParts.tsx`.
**Tests** (`tests/forms/`): `helpers.ts` (`NOW`, `pinClock`), `bundle-guard`, `parity` (fuzz, edges, midnight, R-PHONE/R-TEXT/R-ELAPSED), `validation` (C-18, B-13, R-DATE, R-TEXT), `flow` (flow-base, B-14, presets), `submit` (B-5), `payload` (B-4), `page-config`
(R-TOPIC, plain JSON props, privacy link), `turnstile`, `whatsapp-and-analytics`, `controller` (new: Next, Send, B-4, B-5, B-14 end to end with fakes).
**Not shipped** (`tmp/`): `measure-js-strict.mjs`, `build-snapshot.mjs`, `inspect-pages.mjs`, `serve-snap.mjs` (mock Worker for the browser smoke test), `measure-island.mjs` (quick estimate without a build).
**Regression evidence** (each fix was checked by undoing it): checking the raw value again fails 2 B-13 tests; the old retry rule fails 6 (submit and controller); removing the clamp fails 3 (payload and controller).

## 5. Proposed decisions (the lead consolidates into DECISIONS.md)

**P-F1. One generic form island; the form definition is built at build time and passed as props.**
- Context: spec 12.5 (80 KB), review C-1. The four per-page entries each carried their definition and the field factories (1.4 to 2 KB gzip of JavaScript).
- Decision: pages build `FormDef` in Astro frontmatter (`defs/*.ts`, never bundled for the browser) and pass it as JSON props to the one `LeadForm` island; `FormDef.initial` carries the starting values.
- Consequences: JS on view -1.4 to -2 KB, HTML +0.7 to +1.9 KB gzip; one island chunk shared by the four pages (cached across them); a new form needs a `defs/` file and a page, no island file.

**P-F2. Loading in four layers (replaces P2 in `forms-notes.md`).**
- On view: React plus `LeadForm` (the first screen), 77.5 KB with Astro's scripts. First touch: the engine (Next, Back, Send, validation, reducer, payload, events) and, on multi-step forms, the choice boxes. Last step: the spam check logic. Send: the thank-you screen or the failure panel.
- Consequence: the "budget" is read as **on view**, strict (static closure plus inline scripts). Please record this definition in D-010 and wire the check (R-1).

**P-F3. The form is disabled in the page until it has loaded, with a noscript explanation** (review B-10). The three-state button labels are unchanged. A visitor on a slow phone sees "Loading the form..." instead of a form that reloads the page.

**P-F4. The timer sent with a lead restarts only after a successful send; a retry keeps the original start and never reports less than the minimum fill time** (3.4).

## 6. Manual smoke test in the built-in browser (stands in for C-20 until Playwright is approved)

Built with the test key, served by `tmp/serve-snap.mjs` (a throw-away Node server that mocks `/api/lead` and `/api/event`; stopped afterwards), Turnstile replaced by a stub in the page (no Cloudflare script was needed; once I forgot the stub and the real script loaded for one page: no data was sent
to it, it only rendered the always-pass test widget). The pane was hidden, so `IntersectionObserver` never fires: I re-created the island element with an observer stub to trigger `client:visible`; everything after that is the real code.
- `/book/`: server HTML disabled with the hint; after hydration enabled, hint gone, **no console errors, no hydration mismatch**; first Next with an empty step shows the four errors, focus on the first box, engine fetched on that first touch; typing (a pasted phone with NBSP and NNBSP, a name with en dash, curly quote, rupee sign and `!`) clears them;
  steps 2 and 3 render (select, radios, tick boxes from the lazy chunk, C-18 wording and hint, consent notice with `/privacy/`, spam check "passed"); Send against a mock that answers `degraded`: one POST, failure panel with focus and the correlation code, widget reset;
  "Try again" with no new token: no POST, the "still finishing" sentence and focus on the spam check; widget solved: the sentence disappears; Send again: second POST with the new token and the same key (this run was before the N-2 fix, which left the second POST without `elapsedMs`; now it carries the time since the original start); thank-you screen with the reference, focus on its heading; events `form_start` and `form_submit` carried only fixed labels.
- `/contact/?topic=pro`: the box got "I would like to know more about: Pro"; `?topic=Hello there<b>`: empty box. Before hydration all six controls `:disabled`, a click on the button and an Enter key did nothing (no request, no navigation).
- `/tournaments/submit/`: three steps, free listing pre-selected, both tick boxes unticked, `₹500 per player – 20% off!` accepted in the fee box.
- `/partner/?package=rally-partner`: the package box shows Rally Partner on step 2.
Not checked: the 360 px layout and keyboard order by eye (pane hidden), axe, Lighthouse, a real Turnstile widget, a screen reader.

## 7. What a browser test (Playwright, C-20) should cover once the owner approves the download

Mobile viewport (360 x 640 and 390 x 844) and a desktop one, against the production build served locally with the Worker mocked (as `tmp/serve-snap.mjs`) and Cloudflare's test keys; no Playwright test is written (rule).
1. Each of the four pages: no horizontal scroll at 360 px, one `h1`, the form disabled and "Loading the form..." in the first paint, enabled after hydration, no console error or hydration warning.
2. Keyboard only: tab order through step 1, Enter in a box submits the step, focus on the first error, on the step heading when a step opens, on the failure panel and on the thank-you heading.
3. axe on every step of every form (labels, `aria-describedby` on errors, the two live regions, the radio groups, contrast of the error colour).
4. The real Turnstile test widget renders in its box at 300 to 360 px, `flexible` size, and a send with the always-pass key succeeds against the mock; the always-block key shows the spam-check message and the reset button.
5. Send paths against the mock: success, `validation` (field error opens the right step), `turnstile`, `rate_limited` (no Try again), `degraded` (one request only, WhatsApp fallback, fresh token), network drop (one retry with the same body), timeout, 413.
6. Pasted values: a phone with NBSP, a name with rupee sign and dashes, a date outside the window, a past start date; text left open for a day (fake clock) still sends.
7. `?package=` on `/book/` and `/partner/`, `?topic=` on `/contact/` (a key and an unknown value).
8. With JavaScript disabled: the noscript block shows and the WhatsApp link is correct.
9. Page weight: the strict JS total of each form page (the same measure as `tmp/measure-js-strict.mjs`) at or under the budget; LCP and CLS on throttled mobile (the consent notice and spam box are in the first HTML on `/contact`, so no shift).

## 8. Requests

**Lead**
- **R-1** Add the build check the review asked for (`scripts/check-js-budget.ts` or a step of `build:strict`): `tmp/measure-js-strict.mjs` is a working prototype (module scripts, island entries, static closure, inline scripts, gzip level 9; prints the lazy total).
  Suggested limits: warn above 76 KiB, fail above 80 KiB per page, and record "on view, strict" in D-010 (P-F2). Today: 77,495 B on every form page.
- **R-2** `tsconfig.json` includes `**/*`, so `astro check` type-checks scripts and any file under `tmp/` and **built bundles**: a copy of `dist/client` left under the project makes the check fail with hundreds of errors. Consider `exclude: ["tmp"]`. (My snapshots are in the system temp folder.)
- **R-3** `docs/m1/forms-notes.md` sections 1, 2, 5 (P2, P3) are superseded by this file; replace or edit when consolidating. P3 stays open: the forms cannot reach 76,000 B without removing React DOM.
- **R-4** Open owner questions in `forms-notes.md` section 8 are unchanged, plus: is the new C-18 wording right for organizers (question 2)?

**Lead-backend** (only if wanted)
- **B-1** The window is applied to `startDate` only. `endDate` can be any real date up to 2100 and `startMonth` any month 2000-2100 (a past start month passes). If the owner wants them limited too, add the rule server-side and tell me; the client change is a one-line rule in `RULE_BY_NAME` / the month case.
- **B-2** The rule sets (`NAME_RULES`, `SHORT_RULES`, ...) are still copied in `rules.ts`; the character lists and the date window are now shared, the limits come from `LEAD_LIMITS`. Exporting the rule sets from a zod-free module would remove the last copy (request R1 in `forms-notes.md`).
- **B-3** `elapsedMs`: a non-integer is clamped to 0 and then refused as "too fast" (`rate_limited`). The client never sends one; if you would rather treat a bad value as missing, change `clampElapsedMs` and the contract together.

**Shell**
- Links to non-coverage products should be `/contact/?topic=<key>` (`products.ts` `enquiryTarget`), coverage packages `/book/?package=<key>`, sponsor packages `/partner/?package=<key>`: the forms read exactly these.

## 9. Not done / known limits

- 1,494 B above 76,000 B; see section 2 (it is under 76 KiB).
- The two server-side gaps in 8 (B-1) are outside my files.
- No keyboard-order, 360 px, axe, Lighthouse or real-widget run (section 7).
- With JavaScript off, "Loading the form..." and the noscript block are both visible.
- **N-4 (hint that changes after 10 s without hydration): skipped, not clean in my files.** A pure-CSS swap needs `@keyframes` (two stacked sentences, one hidden by a 0 s animation delayed 10 s, the other revealed by it) and there is no keyframes definition I may edit
  (`tokens.css`, `FormSection.astro` were outside the follow-up; an inline `<style>` would need a CSP hash). The Tailwind `starting:` variant needs no keyframes but has the wrong failure mode: a browser without `@starting-style` (Safari before 17.5, Firefox before 129) would show
  "The form could not load" at once while the form is merely loading. Suggest: the lead adds one `@keyframes ps-reveal` utility next to the other tokens, then the change in `LeadForm.tsx` is two spans.

## 10. Finding E-1 (first tap on Send lost on `/contact/` and `/alerts/`): fixed

Cause: the first pointer-down marks the form as started and the spam-check box swapped its 65 px placeholder for a one-line loading fallback while the widget chunk loaded; the Send button moved up under the finger and the click was lost. Fix: the fallback keeps the same `min-h-[65px]` area (`TurnstileWidget.tsx`). Guard: `bundle-guard.test.ts` "E-1". The `test.fail` marker was removed from `tests/e2e/forms.spec.ts`; the e2e suite passes (124 tests) after a locked build.

## 11. /request/: profile and content-removal requests (M2/M3 conformance, spec 7.5 footer, 15.3, 15.6, D-012, D-015, D-019)

One form (`src/pages/request.astro`, `src/lib/forms/defs/request.ts`), one step: **what do you need** (claim a profile / correct details / hide a profile / remove a video or other content), **link or description** (text only, up to 300 characters, links allowed, never fetched or opened), **you are** (self, parent_guardian, coach, rights_holder, other), name, phone or WhatsApp number, optional details. No email box. Single step, so the request notice, spam check and Send are on the first screen.

**New lead kinds for the Schema worker (exact names, additive): `profile_request` and `content_removal`.** The form picks the kind from the first box: "remove a video or other content" sends `content_removal` (`requestType: remove_content`); the other three send `profile_request` (`requestType`: `claim_profile`, `correct_details`, `hide_profile`). Payload keys beyond the common ones: `requestType`, `what`, `relationship`, `details`; they go to `leads.payload` through the existing `payloadOf`, the phone and name use the common columns. `consent` carries the **request notice** (`id: request-notice`, version from `CONSENT.requestNotice`), so `leads.consent_id` and `consent_events` hold it; the contract refuses the lead notice id on these kinds and the request notice id on the others. The migration needs `leads.type` (check constraint or enum) to accept both names; I did not touch migrations. Other places that list kinds and were extended additively (outside my folders, one line each): `src/lib/notify/telegram.ts` (`KIND_LABELS`: "Profile request", "Content removal request"), `src/lib/inbox/lead.ts` (`LEAD_TYPES`, `TYPE_LABELS`). The owner alert is unchanged (kind, ref, first name, page; no phone by default, no `what`, no details).

Parent or guardian: the relationship box's hint, the page's side column and the thank-you steps all say that a one-time code sent to the parent's own phone is a **later** step, not switched on yet, and that sending the form hides or removes nothing by itself (`PARENT_VERIFICATION_NOTE`). No timing is promised: the page and the thank-you screen name a time only when `site.replyTimePromise` is set (otherwise "We do not promise a time" / "as soon as we can").

Privacy: the WhatsApp fallback text carries only the request type (no `messageField`; only `requestType` is `summary`); events carry only the kind that was sent (`form_submit` now reports the kind actually sent, `kindOf`); the details box and the page ask not to write a child's full name, school or address.

Code changes that other forms share: `FormDef.kindBy` and `FormDef.noticeKey` (types), `kindOf()` and the notice choice in `payload.ts`, the `what` and `details` rules in `rules.ts` (parity-tested, fuzzed), `requestNotice` in `page-config.ts`, `M3_ROUTES.request` in `urls.ts` (the sitemap and the known-pages list pick it up from there), the two kind labels in `whatsapp-prefill.ts` and the request steps in `confirmation-text.ts`.

**SSR fix found on the way** (`FieldRenderer.tsx`): a lazy `ChoiceField` drawn on a form's FIRST screen made React stream a "Loading..." line and a swap script into the page HTML depending on build order (`/alerts/` had both, `/submit-video/` neither). The server build now loads `ChoiceField` up front (`import.meta.env.SSR`); the browser bundle keeps the lazy chunk. Checked on `/alerts/`, `/submit-video/`, `/request/`: no suspense fallback, no swap script (`tmp/inspect-island.mjs`).

Checks: JS budget on `/request/` 77,485 B (same as the other form pages, `npm run check:js-budget` OK); `tests/forms` 12 files, 367 tests (new `request-form.test.ts`; parity and fuzz extended with `what` and `details`); e2e: `tests/e2e/request.spec.ts` (5 tests) plus `/request/` added to `FORM_PAGES` (hydration, empty submit, spam-check timing, full send, 503 fallback, axe, no horizontal scroll); full suite 150 passed after the fix of one selector of mine.

**For the Legal worker:** `src/pages/content-removal.astro` should link to `M3_ROUTES.request` (`/request/`); the legal text there should match the "later verification" wording above. **For the lead:** the header or footer link to `/request/` (spec 7.5), moving `request` from `M3_ROUTES` to `ROUTES` when linked; `leads.type` in the migration (above); WhatsApp text for `/request/` uses the generic greeting (add a line in `whatsappText.ts` if wanted).
