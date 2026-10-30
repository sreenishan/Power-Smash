# Go-live checklist (G1: the public website)

Written 2026-10-30 from the project's own records (OWNER_TODO, RUNBOOK G1 list, BUILD_PLAN gates, the legal re-read checklist, SECRETS)
and from the release build itself. Where the records disagree, this list follows `docs/RUNBOOK.md` (G1 list). Tick items as they are done.

**Who:** You = the owner. Claude = done here, in the code. **Cost:** only amounts the records state; "fee unknown" means you agree it.

**Where things stand today**

- The private preview works (behind your Vercel login), and the dev database is up to date (migrations 0001 to 0016, all checks pass, anonymous-access test 0 leaks).
- Nothing is public. The first release leaves the video archive out (D-107), so the release build refuses, on purpose, while **111 owner inputs on 24 pages** are missing (see section B; it was 164 on 77 pages with the archive), and every deploy so far has been skipped (`DEPLOY_ENABLED` is off).
- G1 is the public site: services, booking, contact, tournaments you list, legal pages. The public video archive (players, matches, tournament pages from videos) is **G2**, later.

---

## A. Start now: decisions and people (these take the longest)

- [ ] **A1. Decide who receives the money** (individual, sole proprietor or company) with a CA (OT-05). The legal name on every page must match it. *You + CA, fee unknown.* Blocks: the legal name, Razorpay, the domain registrant name.
- [ ] **A2. CA answers:** GST registration, receipt or tax invoice, GST on sponsorship, TDS, whether personal UPI is allowed. *CA.*
- [ ] **A3. Hire an Indian lawyer** (data protection plus media or sports), agree a fixed fee, send them `docs/legal/LAWYER_BRIEFING.md` (OT-15). *You, fee unknown.* Blocks G1: the six legal pages cannot go live without their review.
- [ ] **A4. Lock down your accounts:** a business Google account, two-step sign-in on everything, recovery codes on paper (OT-14). *You, free.* (Not recorded as done.)
- [ ] **A5. Answer the open plan questions** (in DECISIONS "Decisions awaiting the owner"): yes to Vercel Pro for the live site (#15); which uptime tool, HetrixTools recommended (#6); whether pages may show your rounded, dated figures (#3); the reply-time wording or "no promise" (D-046); an extra front door for the admin page, recommended no for launch (OT-49). *You, free.*
- [x] **A6. The domain:** **www.elitetournaments.in** (your decision, 2026-10-30, D-106). It is already connected to the Vercel project; `powersmash.in` is not bought.

## B. Your content (fills the 111 gaps the release build refuses)

- [ ] **B1. Business details (OT-19):** postal address to publish, grievance officer's name and email. (Legal name, phone, email and the WhatsApp number are already in.) *75 pages wait on this (the footer).*
- [ ] **B2. Prices (OT-20):** a price or "on quote" for each of the 17 products and partner packages (Essential, Pro, Broadcast, Season pack, Highlight reel, HD match file, Custom edit, Extra court, Extra match day, Travel outside the home district, Tournament promotion, Title, Coverage, Court and Rally Partner, and the rest), whether prices include GST (confirm with the CA), the delivery time for each product, and how long after the event videos are published. Use the price worksheet (OT-13). *Claude never sets a price.*
- [ ] **B3. Booking and refund rules (OT-21, 11 answers):** advance (how much, when the balance is due), date changes, how a cancellation counts, early and late cancellation windows and refunds, the cut-off, refunds after a file is delivered, fix/replace/refund for a delivery problem and the time to report it, how long a refund takes, payment-fee handling, sponsor-package cancellations, and the city whose courts have jurisdiction (with the lawyer).
- [ ] **B4. Approvals:** the suggested package and sponsor-package inclusions (OT-20, OT-22); the logo and a tagline (OT-23; say yes to the small SVG-to-PNG tool for the share picture).
- [ ] **B5. YouTube Studio figures, dated (OT-12):** top locations, age and gender, monthly views, average view duration, with the "as of" date. (The current channel figures go stale on 19 January 2027.)
- [ ] **B6. Confirm in chat** the 10 plain practice statements and the figures on the legal pages (24 months, 12 months, 90 days, 48 hours and the rest), from `docs/legal/G1_REREAD_CHECKLIST.md`. *You; the lawyer reviews.*
- [ ] **B7. Lawyer review of the six legal pages** (Privacy, Terms, Refunds, Delivery, Disclosures, Content Removal) and the consent texts, plus their launch questions. Claude then turns each page's "reviewed by lawyer" switch on. *Lawyer, then Claude.*
- [ ] **B8. Optional:** a UPI ID or QR after the bank and CA agree (OT-24).

## C. Accounts and services

- [ ] **C1. Confirm the domain** (OT-07): registered in your real name (matching A1), .IN ID check (KYC) **verified**, registrar lock and two-step sign-in on, renewal date noted, and tell Claude the registrar and who hosts the DNS. *You. Cost: the renewal at your registrar.*
- [ ] **C2. Production database** `powersmash-prod` in Mumbai (OT-27): Data API exposing `public` and `api`, automatic exposure off, sign-ups off. *You, free.* Then Claude prepares `npm run sql:bundle` (all migrations 0001 to 0016), you paste it and the checks, and Claude runs the anonymous-access test against prod (must be 0 leaks).
- [ ] **C3. Your admin sign-in on prod** (OT-51): user, owner role, two authenticators, enrolment off. *You.*
- [ ] **C4. Production spam check** (Turnstile, OT-41): a production widget; the site key to Claude in chat, the secret key typed by you into Vercel. *You, free.*
- [ ] **C5. Telegram alert bot and chat id** (OT-08). *You, free.* (Not recorded as done.)
- [ ] **C6. Razorpay account and KYC** (OT-06). *Records: no setup fee, 2% + GST per payment, a Rs 199 KYC fee plus tax may apply.*
- [ ] **C7. Backups:** the `age` key pair (OT-31; downloading `age` needs your yes), then the read-only backup login (OT-43, Claude writes the migration), then `BACKUP_ENABLED=true` and one green backup. *You + Claude, free.*
- [ ] **C8. Buy Vercel Pro**, shortly before go-live. *USD 20 a month per seat. Only you buy it.*

## D. Wiring (names only; you enter every secret value yourself, never in chat)

- [ ] **D1. Vercel Production settings:** `SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `HMAC_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TURNSTILE_EXPECTED_HOSTNAMES`, `ADMIN_ALLOWED_ORIGINS`. Never `TURNSTILE_ALLOW_TEST_KEYS` in Production.
- [ ] **D2. GitHub repository variables for the release build:** `PUBLIC_SITE_URL` (`https://www.elitetournaments.in`), `PUBLIC_ALLOW_INDEXING` (stays `false` until D5), `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TURNSTILE_SITE_KEY` (all prod values). `PUBLIC_WHATSAPP_NUMBER` is already set. Optional, with your yes: `PS_LIVE_SOURCE=supabase` (the Live page reads your admin pins).
- [ ] **D3. Already done:** the deploy secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (the preview has deployed with them), and the `PREVIEW_*` variables.
- [ ] **D4. The domain in Vercel:** both addresses are already connected; make `www.elitetournaments.in` the main address and let `elitetournaments.in` redirect to it. Then email forwarding for `hello@elitetournaments.in` and the grievance address, then Resend (sending subdomain `mail.elitetournaments.in`, OT-40) and `EMAIL_ENABLED=true`. *You; Claude asks before any DNS or Vercel change.*
- [ ] **D4a. After ANY change in Vercel (Domains, Settings, the plan), check the login wall:** **power-smash, Settings, Deployment Protection, Vercel Authentication**: "Require Log In" on, **All Deployments**, saved. Until launch day (F3) the whole site must ask for a login. It has been found off twice (2026-10-23 and 2026-10-30); both times the preview job refused to upload and Claude confirmed it from outside. *You; Claude re-checks from outside when you tell it.*
- [ ] **D5. Switch indexing on only at the domain cut-over:** `PUBLIC_ALLOW_INDEXING=true` once `PUBLIC_SITE_URL` is `https://www.elitetournaments.in` (the release check refuses indexing on a vercel.app address or with test keys).

## E. Claude's engineering items before G1

- [x] **E1. Leave the video archive out of the G1 build** (your decision 2026-10-30, D-107; done: the release build now leaves it out until the archive switch is on, and the owner inputs fell to 111 on 24 pages). The release build refuses every archive page (players, matches, tournament pages from videos, and the "From our videos" and featured-from-database sections) while the archive switch is off, and that switch waits for you and the lawyer to approve the protected-player rules (D-012, a G2 item). Either the G1 build leaves those pages out, or the archive is approved first. *Claude, with your choice.*
- [ ] **E2. The real publish step** in the deploy workflow, and the G1 re-read of every built legal page against what is actually live (`docs/legal/G1_REREAD_CHECKLIST.md`).
- [ ] **E3. Open safety items:** flood protection on `/api/event` (R-45), the retention job running (R-31), a release-gate check of the live `/api/health`, and the function timing on a preview.
- [ ] **E4. One real test enquiry end to end** on a preview: form, database, Telegram alert, spam check. Only the access test has been done so far.
- [ ] **E5. The uptime monitor** (OT-44) on the real domain, with an alert drill on both channels, and its keyword once the pages are final. *You sign up; Claude guides.*

## F. Launch day (in this order)

- [ ] **F1. All gates green:** `npm run build:strict` passes (0 owner gaps), tests pass, type check 0 errors, build-output tests pass.
- [ ] **F2. You approve every page on your phone** on the last private preview.
- [ ] **F3. Set `DEPLOY_ENABLED=true`** (OT-48), and at the same time relax Vercel's login protection so the public can see the live site (Claude changes the preview guard to match). *You set both switches.*
- [ ] **F4. Check the live site:** pages, a test enquiry, the Telegram alert, `/api/health` ready, the uptime monitor green.
- [ ] **F5. Replace every key** once at launch, then every three months (RUNBOOK).

## After launch (not needed for G1)

Search Console and Bing (OT-36), analytics (OT-45), the "Publish now" token (OT-42), the YouTube policy question (OT-16) and API key (OT-04) for the archive, and the e-commerce rules check due by 1 January 2027 (OT-34, lawyer or CA). The public archive (G2) needs D-012, D-016 and the YouTube answer first.
