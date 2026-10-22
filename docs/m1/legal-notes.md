# M1 Legal-drafts worker notes

Date: 2026-10-21. Worker: Legal-drafts (Milestone M1). Everything here is a draft for a lawyer (OT-15). **Nothing is legal advice and no page claims compliance, certification or approval.** No account was created, nothing was sent or published, no package was installed.

## 1. What I built (files)

**Content as data (pure TypeScript, tested):** `src/content/legal/` with `status.ts` (the per-page `reviewedByLawyer` flag and the shared Todo text), `meta.ts` (`lastUpdated`, allowed link hosts and paths, the official URLs), `facts.ts` (facts not in `site.ts`: online removal form path, self-audit date; both `null`), `model.ts` (the content model and builders), `routes.ts` (contact routes through `waLink()`, grievance rows), `view.ts` (owner facts into render nodes; a missing fact becomes a Todo), `index.ts`, and one file per page: `privacy.ts`, `terms.ts`, `refunds.ts`, `delivery.ts`, `disclosures.ts`, `contentRemoval.ts`.

**Components:** `src/components/legal/` `LegalDocument.astro` (H1, last-updated, draft notice, "in short", table of contents, H2/H3 sections), `LegalDraftNotice.astro`, `LegalBlock.astro`, `LegalInline.astro`, `LegalNode.astro`, and `GrievanceOfficer.astro` (reusable on `/contact`).

**Pages:** `src/pages/{privacy,terms,refunds,delivery,disclosures,content-removal}.astro` (thin: BaseLayout plus LegalDocument).

**Consent:** `src/content/consent.ts` refined. `leadNotice` and `tournamentPublicContact` keep their ids and moved to version `2026-10-21-draft2` (wording changed). Added, for later forms: `alertsSignup`, `adultConfirmation`, `videoRights`, `videoLicence`, `videoRemoval` (M3) and `requestNotice` (M2d), all `2026-10-21-draft1`. None is pre-ticked by design; notices (leadNotice, requestNotice) are text only.

**Tests:** `tests/legal/` `docs.test.ts`, `numbers.test.ts`, `links.test.ts`, `view.test.ts`, `status.test.ts`, `wording.test.ts`, `consent.test.ts`, `helpers.ts` (result counts in section 9).

**Docs:** `docs/legal/LAWYER_BRIEFING.md`, `docs/legal/coverage-agreement-draft.md`, `docs/legal/video-submission-licence-draft.md`, `docs/razorpay/SAMPLE_INVOICE.html`, `docs/razorpay/README.md`, this file.

## 2. How the draft-notice mechanism works

Each page renders `LegalDocument`, which always renders `<LegalDraftNotice page=...>`. While `src/content/legal/status.ts` has `reviewedByLawyer: false` for that page the notice shows `<Todo what="lawyer review of this page (OT-15)">`, which prints `TODO(owner): lawyer review of this page (OT-15)` and so fails the strict gate (`PS_STRICT=1`). **The lead sets the flag to `true` and `reviewedOn` to the date, page by page, only after the lawyer has reviewed the final wording.** A test refuses a `true` flag without a valid date. Any wording change should also move `lastUpdated` in `meta.ts`.

## 3. Built pages: what I checked (locked build, 2026-10-21)

The six pages built to `dist/client/<slug>/index.html`. In each: one H1; headings in order with no skipped level (H1, then H2 sections); the table of contents present; the lawyer-review Todo notice present; `noindex` present (the shell's default); the only external links are the allowed hosts plus the shell's own footer social links. Counts of `TODO(owner)` per page with every owner input still missing: privacy 10, terms 10, refunds 24, delivery 13, disclosures 8, content-removal 10. On a 375 px emulation the tables stack into labelled rows and my content did not cause horizontal scroll. One observation for the Site-shell worker: in that emulation the footer's full-width WhatsApp button measured about 1 px wider than the viewport (may be an emulation artefact).

## 4. Deviations from the spec or plan

1. **Legal H2s are sentence case and smaller** than the brand's uppercase display H2 (long plain-English headings in capitals are hard to read). Scoped to `.ps-legal` in `LegalDocument.astro`. The H1 uses the H2 size for the same reason. Revert in that one style block if the owner wants strict brand headings.
2. **Spec 15.4 "event documents deleted 30 days after the event"** is stated in the Privacy Policy as written, although the feature (P3) and the retention job (M4) do not exist yet. The job must implement every retention row in the policy (section 7).
3. The **Disclosures page publishes our paraphrase of the ASCI and DoCA points as the owner's practice** ("we aim to follow"). Spec 15.5 says the owner's practice lives in `OWNER_GUIDE.md`; the public wording therefore needs the owner's agreement that it matches what he does.
4. **No online removal form in M1.** The spec and the brief say the form route is hidden when missing. `legalFacts.removalFormPath` is `null` until M2d, so the page offers WhatsApp (via `waLink()`), email and an urgent-order phone line, each hidden when missing, and a Todo if no route exists.

## 5. Proposed decisions (for the lead to record)

**P-1 Legal pages are data, rendered by one component; the lawyer flag lives in `status.ts`.** Context: tests must read every sentence and a draft legal page must never ship by accident. Decision: wording lives in `src/content/legal/*.ts`; `status.ts` holds `reviewedByLawyer` per page; the draft notice is a Todo while false. Consequences: wording edits happen in `.ts` files (not `.astro`), a lawyer's mark-up maps one-to-one to a file, tests guard numbers, links and claims.

**P-2 Public response targets in the Content Removal Policy are stated as operating targets, not guarantees.** Context: D-014 adopts 24 hours (acknowledge), 7 days (decide), 3 hours (court or reasoned government notice), 48 hours (minors); the 2026 figures come from third-party summaries and whether Power Smash is an intermediary is a lawyer question. Decision: the page says "These are our targets. They are not a guarantee, and a legal order can set a different time." Consequences: the lawyer may tighten or relax them without a code change.

**P-3 Consent keys for later forms are defined now** (`alertsSignup`, `adultConfirmation`, `videoRights`, `videoLicence`, `videoRemoval`, `requestNotice`) so the lawyer reviews all wording together; versions are pinned by hash in `tests/legal/consent.test.ts` (an edit without a version bump fails; a bump without a new pin fails).

**P-4 Hide-section rule at section level for legal pages.** `LegalSection.showWhen` hides a section, its heading and its table-of-contents entry until a fact is supplied (used for the optional dark-pattern self-audit date, D-037). Whether a certificate is needed at all is a lawyer or CA question (briefing D2).

**P-5 `site.ts` additions (Site-shell worker owns the file).** See section 8.

## 6. Facts I verified (URL and date; all read on 2026-10-21 unless stated)

| Fact | Source | Basis |
|---|---|---|
| YouTube Developer Policies III.A.1: API clients must display a link to the YouTube Terms of Service (`https://www.youtube.com/t/terms`) and state in their own terms that users agree to be bound by it. III.A.2: the privacy policy must be easy to reach, say the client uses YouTube API Services, reference and link the Google Privacy Policy, explain what user information is accessed, collected, stored and shared, say whether third parties serve ads, say whether information is stored on or read from users' devices (cookies or similar); the Authorized Data items (revocation via Google security settings, contact for complaints) apply only if OAuth data is used, which this site does not. Page "last updated 2026-10-15 UTC" | https://developers.google.com/youtube/terms/developer-policies | Official, read through a summarising fetch tool that reproduced the numbered text; the page names the older Google URL `http://www.google.com/policies/privacy`, the pages use `https://policies.google.com/privacy` as the brief says (I did not test that the old URL redirects) |
| API Services Terms of Service (updated 2026-09-14 UTC): section 7 needs a published privacy policy describing user information accessed, collected and stored; section 24.3 deletion of API data on termination. The "link Google Privacy Policy" duty is in the Developer Policies, not in these Terms | https://developers.google.com/youtube/terms/api-services-terms-of-service | Official, summarising tool |
| National Consumer Helpline: toll-free **1915** (8 AM to 8 PM), online portal consumerhelpline.gov.in, UMANG app, WhatsApp. Used in the Terms (number 1915 and link). I did not write the WhatsApp number | https://consumerhelpline.gov.in/ | Official |
| Cloudflare Privacy Policy exists at this URL, "Last Updated November 4th, 2025" (linked for Turnstile) | https://www.cloudflare.com/privacypolicy/ | Official |
| Cloudflare Web Analytics beacon stores nothing in the browser (no cookies, localStorage, sessionStorage), discards the client IP at the nearest data centre, collects page-load id, referrer, landing path and timings | `docs/m1/third-party-integration-facts.md` lines 146 to 147 (Research worker, same day) | Official (via that file); the policy says "Cloudflare says it does not use cookies or local storage for this and does not fingerprint your device" |
| E-Commerce (Amendment) Rules 2026: in force 2027-01-01; duties as in VF-E11 (copy of complaint, National Consumer Helpline integration, dark-patterns compliance with annual self-audit and certificate, 30-day lowest price, sponsored labels, search manipulation, consent). A Moneylife article of 2026-09-12 puts notification at about 2026-09-11 and gives no G.S.R. number; VF-E11 says 2026-09-09; sources differ. Inc42 and Corpseed agree on the duties and on 1 January | https://www.moneylife.in/article/new-ecommerce-rules-to-rein-in-dark-patterns-misleading-listings-and-hidden-charges-from-1st-january/81643.html ; https://inc42.com/buzz/govt-tightens-ecommerce-rules-ahead-of-the-festive-season/ | Third-party summaries. Gazette text not read |
| DPDP Rules 2025 notified 2025-11-13, phased: immediate, consent managers 12 months, full compliance by 2027-05-13 (18 months) | Search summaries of Legal500, Hogan Lovells, AZB, Mondaq; the PIB PDF https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf was found but could not be read by machine here (no PDF tool on this PC) | Third-party; one official document found but unread |
| IT Intermediary Amendment Rules 2026 (G.S.R. 120(E)), in force 2026-02-20; grievance officer acknowledges within 24 hours and resolves within 7 days; sensitive-content grievances 2 hours; appeal to a Grievance Appellate Committee within 30 days, resolved within 30 days; the 3-hour takedown figure | Search summaries citing Mondaq, indialaw.in, GKToday | Third-party. **New against VERIFIED_FACTS:** the appeal route (Grievance Appellate Committee, 30 days). I left it out of the public page and put it in the lawyer's question E2 |

## 7. Unverified items and conservative choices

1. **Every India-law timeline and duty is from third-party summaries**; the Gazette texts (DPDP Rules, IT Rules 2026, E-Commerce Amendment Rules 2026) were not read. The pages state the figures as our own operating targets or commitments, never as "the law requires X". The lawyer reads the Gazette (briefing section 5 and 6).
2. **Where data is processed.** The provider table says "Mumbai, India" for Supabase (D-004 plans it; the production project may not exist yet, OT-27) and "Tokyo, Japan" for Resend (D-022 plans it); for Cloudflare, Telegram, Razorpay, Google and GitHub the table says the provider chooses. Re-check at G1.
3. **Cookie and storage behaviour of Turnstile and the YouTube iframe is not claimed** beyond "may" (D-016 item 8 requires a browser test first). The policy says Cloudflare's own page explains Turnstile.
4. **Retention rows not yet decided or implemented:** security and access logs (policy says "the period that Indian security rules require", D-028 leaves 180 days versus 12 months open); the off-GitHub backup copy (D-011 says the owner's Google Drive; its retention is not decided, the policy says encrypted backups are kept "about two months", which is only the GitHub artifact window of 56 to 60 days); tax and accounting records ("as tax and accounting law requires, our accountant confirms").
5. **"Right to nominate" (DPDP) and Data Protection Board complaints** are left out of the Privacy Policy until the lawyer confirms them (Board had no members on 2026-10-07, VF-E1).
6. **Whether a sole proprietor is an e-commerce entity** and must show a self-audit certificate or register with the National Consumer Helpline is open (briefing D1, D2); the Disclosures self-audit section is hidden by default.
7. **BAI regulations** edition and force are unknown (VF-E16); the coverage agreement is a template with options.
8. The statement "a WhatsApp message or an email is fine" as written confirmation of a booking (Terms) is a legal question (briefing H1).
9. The Privacy Policy describes the protected-player rules of D-012, which are built in M2 and apply when the archive launches (G2). They are true as policy at G1 (no player pages exist yet) but the lead should re-read them at G2.
10. The brief's Google Privacy URL (`https://policies.google.com/privacy`) is used; the Developer Policies still print the older `http://www.google.com/policies/privacy`.

## 8. Questions for the owner (plain English; all are Todos on the pages until answered)

**Money pages cannot go live without these (G1):**
1. **OT-19.** Legal name, the postal address you are willing to publish, phone, public email (after the domain is verified), the **grievance officer's** name, email and phone, and who answers removal requests and can be reached by phone within hours (a court order: 3 hours; a parent's removal request: 48 hours).
2. **Cancellation and refund rules (OT-21).** Please decide, in one line each: (a) the advance (amount or share) and when the balance is due; (b) the early cancellation window and what is refunded; (c) the late cancellation window and what is refunded; (d) the cut-off after which nothing is refunded (for example once coverage starts or a file is delivered); (e) how and from when a cancellation counts (for example, the day we receive your message); (f) the rules for changing the date or event; (g) what you offer if you cancel or cannot deliver (refund, a new date, or credit); (h) what happens once a digital file is delivered, how long a customer has to report a problem, and whether you fix, replace or refund; (i) the rules for sponsor and partner packages already partly delivered; (j) how long a refund takes to reach the customer; (k) whether the payment gateway's fee (which Razorpay does not return on a refund) is deducted from refunds or you absorb it. **Do not promise that the fee is returned.**
3. **Delivery (OT-20).** How long after the event videos are published; the delivery time for each product (match file, highlight reel, season pack, custom edit); your travel policy outside your home district; what you need at a venue for a live stream (power, internet); how long customers have to report a problem.
4. **Where disputes are decided (OT-21 item 3).** Which city's courts, decided with the lawyer.
5. **Lawyer (OT-15).** Forward `docs/legal/LAWYER_BRIEFING.md` with the two agreement drafts and the page list. Ask them to answer each question A to H in one line.

**Please confirm (no number needed):**
6. The Disclosures page promises that in your videos and live streams you announce paid links at the start and end of live streams, keep an on-screen label for the whole stream, label for the stated durations, and treat gifted gear as a material connection. Is that really what you do or will do?
7. The Privacy Policy says that for players whose age you have not confirmed you create no player page, show no sponsor banner and ask search engines not to index. Do you agree (D-012)?
8. The Terms say a booking exists when you confirm it in writing (a WhatsApp message is fine) and any advance is paid.
9. How long you want to keep your own offline backup copy (Google Drive), so the policy's backup row is accurate.
10. Whether you also want a different **data contact** (for parents and players) from the grievance officer.

## 9. Requests for other workers and the lead

**Site-shell worker (owns `site.ts`, footer, `/contact`):**
- Add to `src/content/site.ts`: `grievanceOfficerPhone: null as string | null` (OT-19 step 4 asks for the officer's phone; the legal pages use it when present and fall back to `phone`), and, if the owner wants one, a `dataContactName` and `dataContactEmail`. The legal code reads `grievanceOfficerPhone` optionally, so nothing breaks until then.
- Show seller details on `/contact` (legal name, address, phone, grievance officer): you can import `src/components/legal/GrievanceOfficer.astro`, which prints the same block with Todos for missing values. The footer already links the six legal pages (`nav.ts` `legalLinks`; `tests/legal/docs.test.ts` checks the paths match my pages).
- `/pricing`, `/contact` are linked from the legal pages as internal paths; they must exist.

**Lead:**
- Flip `status.ts` flags after the lawyer's review; bump `lastUpdated` in `meta.ts` whenever wording changes.
- When the M2d online removal form exists, set `legalFacts.removalFormPath`.
- The **retention job (M4)** must implement the Privacy Policy rows: enquiries anonymised 24 months after closing; removal and correction request records redacted 12 months after resolution; raw events and link-tap records 90 days then daily totals; payment-event contact fields redacted after 90 days; event documents deleted 30 days after the event; age proof deleted right after the check; backups about two months with the erasure log re-applied after a restore.
- The strict gate (`PS_STRICT=1`) will fail on these pages until: the lawyer flag is true (6 pages), OT-19 is supplied, the refund and delivery Todos are answered and the court city is set. That is intended.
- `docs/DECISIONS.md` and `docs/OWNER_TODO.md`: consider a line in OT-15 that the pack is `docs/legal/LAWYER_BRIEFING.md`, and in OT-21 the eleven refund questions in section 8.
- Add the legal pages to the sitemap when M2c builds it (they should be indexable at G1).
- New fact for `VERIFIED_FACTS.md` (third-party): IT Rules 2026 appeal route to a Grievance Appellate Committee within 30 days; NCH toll-free 1915 (official).

**Forms and Lead-backend workers:** use `CONSENT.<key>.id` and `.version` from `src/content/consent.ts` (already done by `lead.ts` and `payload.ts`); `version` must match `^[A-Za-z0-9._-]{1,40}$` and still does.

**Packages:** none wanted or installed.

## 10. Results (2026-10-21, after the last source change)

- Locked `npm run build`: succeeded; the six pages built; inspected (section 3).
- `npx vitest run tests/legal`: 7 files, 181 tests, all pass. Full `npm test`: 1,024 tests pass in 30 files; 1 file fails to load, `tests/forms/page-config.test.ts` (Forms worker: it imports a `.tsx` component and Vite cannot parse it in the node test config). Not caused by this worker's files.
- Locked `npm run check`: 214 files, 1 error, 0 warnings, 7 hints. The one error is `src/lib/forms/idempotency.ts:17` (`Crypto` not assignable to `RandomSource`, Forms worker). No error, warning or hint comes from the legal files.
