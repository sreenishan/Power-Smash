# Lawyer briefing pack - Power Smash website (DRAFT for review)

Prepared 2026-10-21 by the Legal-drafts worker for Milestone M1. **This pack is a set of drafts and questions for an Indian lawyer. It is not legal advice, and nothing in it says the website is compliant with any law.** The owner forwards it (OT-15). Items for the chartered accountant are marked **CA** and are kept out of the lawyer's questions.

Contents: 0 How to use this pack; 1 The business; 2 What the website collects and does; 3 What to review; 4 Questions for the lawyer; 5 Dates and facts the drafts rely on; 6 What could not be verified; 7 Items for the CA; 8 How answers are put into the website.

References such as D-012 or VF-E9 point to the project's decision records (`docs/DECISIONS.md`) and verified-facts list (`docs/VERIFIED_FACTS.md`), which can be sent on request. Real players' names are never in this pack.

---

## 0. How to use this pack

1. Read section 1 and 2 (about 10 minutes) for the business and the data flows.
2. Review the six draft pages (section 3) and the two agreement drafts. Mark changes directly on the text; the website's wording lives in plain files, so any change you make can be put in without a rewrite.
3. Answer the questions in section 4. Short answers are fine. For each question the pack says what the website does **today** (the safe default) and what is needed from you. The website already has settings for the open choices (section 8), so an answer changes a setting rather than the design.
4. Tell the owner in plain words, ideally one line per question: "default is fine", "change to X", or "need more facts".

Please say which facts in section 5 you checked against the Gazette. Most come from law-firm and explainer summaries, because the Gazette PDFs could not be read by machine (section 6).

---

## 1. The business

Power Smash is a YouTube-first badminton media brand for Tamil Nadu players and tournaments. As of October 2026 the channel (@PowerSmash) has about 88K subscribers and 1.9K videos, with channel memberships on, an Instagram account and a Facebook page. The owner already films tournaments informally, promotes events with pamphlets, and accepts match videos from the community.

The website being built has three parts:

- **Archive:** pages for matches, players and tournaments, built from the owner's YouTube catalogue (video title, thumbnail, length, views). Player, tournament and category details are read out of the video titles by Power Smash's own software and labelled "Match details by Power Smash". Everyone whose adult status is not confirmed is treated as a protected player (section 4A). The archive is not part of the first public launch (gate G1); it follows (gate G2).
- **Storefront:** priced services for organisers (coverage and live streaming), sponsors (placements), and players and parents (highlight reels, HD match files). Payment by Razorpay Payment Links or bank transfer. **Every price, advance, refund rule and tax treatment is the owner's decision and is still blank in the drafts.**
- **Hub:** WhatsApp-first enquiries, instant alerts to the owner, later an email and WhatsApp Channel alerts list.

Money flows (Phase 1): coverage and live-stream fees from organisers and associations; sponsor placements; player products; support through YouTube memberships (paid by YouTube). Later: featured listings, affiliate links, an own tournament with entry fees (not in Phase 1), merchandise.

People involved: the owner (a sole operator, entity type still to be decided with a CA, section 7), organisers and associations, players (many under 18), parents and guardians, sponsors, and service providers (Vercel, Cloudflare, Supabase, Telegram, Resend, Razorpay, Google/YouTube, GitHub). Hosting moved from Cloudflare to Vercel on 2026-10-22 (D-097); Cloudflare now provides only the form spam check (Turnstile), the optional page counter and, later, email forwarding.

---

## 2. What the website collects and does (Phase 1)

| Where | Fields | Purpose | Notice or consent text (id) | Kept for | Handled by |
|---|---|---|---|---|---|
| Enquiry forms: book coverage, partner with us, contact, player products | Name, organisation, phone or WhatsApp, email, event or enquiry details, budget range, notes, optional "permission already agreed with the organiser?" (yes, no, unsure), source page and campaign tags, time, a hash of the connection address (not the address) | Reply, quote, arrange service, records, spam limits | Notice `lead-notice` (shown on the form; no tick; version stored with every submission) | Until closed, then anonymised after 24 months (spec 15.4, D-028) | Cloudflare (site and spam check), Supabase (database; region named on the page only once the production project exists and the owner confirms it), Telegram (owner alert; **by default only the kind of enquiry, the reference, a first name or initial and the source page: no phone, no email, no free text**; a reply link that contains the phone number is a switch that stays OFF until the owner and you agree, finding S-5 and C-4), Resend (automatic customer email, after the domain is verified; it promises a reply time only if the owner sets one) |
| List your tournament | Tournament, organiser or association, contact person, phone, email (optional), venue, dates, categories, entry details, registration link, a link to a poster (no file upload at launch) | Review and publish a listing | `lead-notice`; separate unticked box `tournament-public-contact` for showing the contact publicly | Until removed | As above. LATER (M2d): the organiser's phone checked by a one-time WhatsApp message before any contact is shown (D-015); at launch the owner checks by hand |
| WhatsApp or email messages | Number or address, name, message | Reply | None on the form; the website only links to WhatsApp | As the conversation | WhatsApp (Meta), owner's mailbox |
| Payments | Not collected by us: payment happens on Razorpay's page (or another way named in a quote). We receive status, amount, reference and the contact details the provider passes on | Confirm payment, accounts | Mentioned in the privacy policy | Accounting records as the CA confirms. LATER (M3): when payment records are stored by the site, contact fields are redacted after 90 days | Razorpay |
| Site use | IP address and request data at the host; taps on WhatsApp buttons and forms started or sent (button or form, page, time; a daily-changing hash; no name or number); page-view statistics only in a build that has the Cloudflare Web Analytics token; LATER (M3): taps on sponsor links through the counting link | Security, fixing faults, totals | Privacy policy | Events 90 days then daily totals (D-028); security logs are kept by the providers for the period their service sets (question 4F) | Cloudflare |
| Hide, remove, correct, claim requests (Phase 1 handled by WhatsApp, email or phone; the form is a later milestone) | Name, contact, what and why, the reply to a message we send as proof of control, for children the parent's name. LATER (M2d): one-time code; age proof viewed privately then deleted | Handle requests | Notice `request-notice` (later form) | Until resolved plus 12 months, then redacted (D-028) | As above |
| Later (not in Phase 1 launch): alerts sign-up, "send your match video" form | Email (alerts); name, role, phone, email, video link, event details, rights confirmations (video) | Alerts; review and publish a submitted video | `alerts-signup`, `adult-confirmation`; `video-rights`, `video-licence`, `video-removal` (all drafted, none live; their page wording is held back until the flags `emailAlerts` and `videoSubmissions` are switched on) | Not yet fixed (a Todo appears when the flag is switched on) | As above |

What the site never does: show card or UPI-credential fields; use advertising cookies or the Google Analytics and Meta pixels; store cookies or other data in the visitor's browser (a test guards this); let visitors publish comments or uploads (no public user-generated content in Phase 1, D-014); sell personal data; market to people under 18; send marketing from enquiry details without a separate consent.

Page-load contact with third parties at launch: Cloudflare (hosting; Web Analytics only when its token is set, which says it does not use cookies or local storage); Cloudflare Turnstile runs when a visitor starts a form. **No YouTube content is loaded at launch** (no player, no thumbnails, no YouTube API call). LATER (M2c): YouTube thumbnails from `i.ytimg.com` (Google sees the visitor's request) and the YouTube player, which loads only after a tap with a visible "This loads YouTube" line first. The page wording for these is held back until the flags `youtubeEmbeds` and `youtubeApiData` are switched on (`docs/legal/G1_REREAD_CHECKLIST.md`).

---

## 3. What to review

| # | Item | Where | Decision ids | Owner inputs still blank in it |
|---|---|---|---|---|
| 1 | Privacy Policy (page `/privacy`) | `src/content/legal/privacy.ts` | D-012, D-014, D-015, D-016, D-028, D-029, D-037 | Legal name, postal address, grievance officer; backup copy retention |
| 2 | Terms of Use (`/terms`) | `src/content/legal/terms.ts` | D-016, D-019, D-020, D-037 | Legal name, court city for disputes |
| 3 | Cancellation and Refund Policy (`/refunds`) | `src/content/legal/refunds.ts` | D-020, D-021 | **Everything numeric**: advance, cancellation windows, refund shares, timelines, gateway-fee treatment (structure only) |
| 4 | Delivery Policy (`/delivery`), also the payment gateway's shipping page | `src/content/legal/delivery.ts` | D-019, D-020 | Delivery times and the time allowed to report a problem. Travel policy and live-stream venue needs are optional owner text: hidden until the owner supplies them |
| 5 | Disclosures (`/disclosures`) | `src/content/legal/disclosures.ts` | D-016, D-037 | None (the optional self-audit date is hidden until supplied) |
| 6 | Content Removal and Takedown Policy (`/content-removal`) | `src/content/legal/contentRemoval.ts` | D-012, D-014, D-015, D-019 | Contact routes come from the owner's details. The target time for rights disputes is optional: its table row is hidden until it is set with you |
| 7 | Notice and consent texts | `src/content/consent.ts` | D-028, D-019 | None |
| 8 | Coverage agreement (draft, per event) | `docs/legal/coverage-agreement-draft.md` | D-019 | All fees, dates, scope, ownership option |
| 9 | Video-submission licence (draft) | `docs/legal/video-submission-licence-draft.md` | D-019 | Any payment or credit terms |

Every legal page shows a "draft, not yet reviewed by a lawyer" notice until the owner records your review. A page cannot go live while the notice is on.

How the pages were written: plain English, short paragraphs, a table of contents. Each statement is based on the decision records and verified facts above. The pages do not claim compliance with any law.

**What the pages say at launch (G1) and what is held back.** A page may only say what is true on the day it is published. Wording about something that does not exist yet (a one-time code to check who is asking, the YouTube player and YouTube API Services, player and match pages with the protected-player rules, sponsor banners beside the player, the "send your video" form, email alerts) or about a practice the owner has not confirmed (the health-claims rule, a backup copy outside GitHub, "no paid coverage without the agreement") is written, but held back in a `futureWording` block next to each page and shown only when a switch is turned on with the feature. The list of switches, with the milestone for each, is `docs/legal/G1_REREAD_CHECKLIST.md`. **For questions below that concern a held-back feature (marked LATER) you do not need to answer for launch, but answers now save a second review.** One switch is set by the owner and the lawyer together: whether the owner's Telegram alert may carry a reply link that contains the customer's phone number (default: it does not).

---

## 4. Questions for the lawyer

For each: **context**, **what the website does today**, **what is needed from you**.

### A. Children and protected players (D-012, D-013, D-015; DPDP Act s.9; VF-E2 to VF-E5, VF-E19)

*LATER: the protected-player wording appears on the pages when the archive launches (G2). At G1 there are no player pages; the pages say only that forms are for adults, that a parent can ask us to hide a child's name or remove a video, page or listing, and that we aim to act within 48 hours.*

Context: many players in tournament videos are under 18 and a video title rarely shows age. DPDP s.9(1) needs verifiable parental consent before processing a child's data, s.9(3) bars tracking and targeted advertising aimed at children, and the Act's duties start about 2027-05-13. The Fourth Schedule exemptions read as not covering a sports publisher, and the Act reads as not grandfathering data collected without consent (s.5(2)).

Today: every player whose adult status is not confirmed (including "unknown", the usual case for old videos) is **protected**: no profile page, name only as plain text in the title or match details, no search-engine indexing, absent from search and lists, no sponsor banner, tracking, "follow" button or share text naming them, a neutral court picture instead of the thumbnail. Only the owner (bulk action) or a verified claim sets "adult confirmed". Two settings control match pages for protected players: `unknown_match_mode` and `minor_match_mode`, each "noindex and minimal page" or "hidden". Recommended launch values: minimal for unknown; hidden for suspected or confirmed minors until a parent agrees.

1. Is the protected-by-default model adequate under DPDP and the SPDI Rules, or must unknown-age players also be hidden?
2. **Legacy videos** already on YouTube that name probable minors: choose between (a) parent contact and a consent backfill, (b) blur, unlist or retitle before 2027-05-13, (c) another approach. Does s.3(c)(ii) (data made public by the person or under a legal duty to publish) help for tournament draws or spectator videos?
3. **Parent verification (D-015).** The flow proves control of a phone number with a one-time code on WhatsApp (or an emailed link), names the parent, and views age proof privately then deletes it. Rule 10 illustrates verification by held identity data or a virtual token (DigiLocker). Is the phone-code method enough for (a) hide or removal requests and (b) lifting a protected flag or showing a child's page? What stronger method should be added (the flow is built so one can be)?
4. Is a generic sponsor banner on an adult's page, or a cross-tournament player profile of a child, "targeted advertising" or "behavioural monitoring" under s.9(3)? Today neither appears on protected pages.
5. Do you agree no Fourth Schedule exemption applies to a sports media publisher?
6. Is the 48-hour target to act on a parent's removal request, "hide first, verify after", reasonable (the DPDP outer limit for grievance answers is 90 days)?
7. Is the policy text on children and protected players (Privacy Policy section "Children and protected players") accurate and sufficient?

### B. Rights in footage and event permission (D-019; Copyright Act 1957 s.2(uu), s.17, s.19; BAI Competition Regulations; VF-E15, VF-E16)

Context: the BAI Competition Regulations (an undated edition on the BAI website; status unknown) give commercial, television, internet, webcasting and film rights at BAI-sanctioned tournaments to BAI and, by grant, to the promoting Affiliated Unit; cl. 3.14.2 makes the Affiliated Unit obtain any legally required player consent and says the user of photographs or images assumes sole legal liability; cl. 13.11 needs BAI's prior written approval for virtual imaging or advertising on the TV signal. Under Copyright Act s.17(b) an organiser who pays for a film may be its first owner unless the contract says otherwise; s.19 needs an assignment in writing signed by the assignor (default 5 years, India only if unstated). Nothing was found for the Tamil Nadu state association, district bodies or the National Sports Governance Act 2025.

Today: the tournament record has a `filming_permission` field (status, who granted, date, scope, document reference). Monetised coverage, a live stream or a "Covered by Power Smash" badge needs it granted for that event; the admin warns when it is not. The coverage draft (`docs/legal/coverage-agreement-draft.md`) and the video-submission licence draft are the templates. Existing backfilled content starts with permission unknown, and **the website does not assume it was granted**.

1. Who holds filming, streaming and commercial rights at (a) BAI-sanctioned events, (b) state association events, (c) district and private tournaments in Tamil Nadu? Is the BAI edition in force?
2. Is written permission by WhatsApp or email enough, or is a signed licence needed? Is a ticked web box plus a one-time code or an emailed acceptance a "signed writing" for a copyright licence or assignment (s.19)?
3. Review the coverage agreement: the ownership options (Power Smash owns with a licence to the organiser; organiser owns with a licence to Power Smash; joint), the licence scope, sponsor overlay rights, and the takedown and minors clauses. Which default do you recommend?
4. **Existing content** filmed without written permission: what is the exposure, how should we approach retrospective permission, and what should happen if an association or organiser objects (today: hide while checking, D-014)?
5. Player-image consent: who carries the liability under BAI cl. 3.14.2 in practice, and should the coverage agreement shift it to the organiser by warranty and indemnity?
6. Do stream overlays (sponsor logos, scoreboard) count as "virtual imaging or advertising" needing BAI approval (cl. 13.11)?
7. Review the video-submission licence (non-exclusive, worldwide, for the life of the video on the channel, publish and monetise on YouTube and the site, credit, removal on valid request). Is a minors-in-video route (parent confirmation) needed, and is "no broadcast or third-party footage" enough to avoid infringement?

### C. Entity and invoicing: for the CA, not the lawyer (D-020, D-021)

See section 7. The lawyer need only know that the entity (individual, proprietorship or company) is undecided and that the legal name on the pages must match it.

### D. E-Commerce Rules 2020 and Amendment Rules 2026 (D-037; VF-E10, VF-E11, VF-E14)

Context: the 2020 Rules ask a seller for legal name and address, customer-care and grievance-officer details (acknowledge within 48 hours, redress within one month), the total price with all charges, and refund and delivery terms. The Amendment Rules 2026 (notified about 2026-09-09 to 2026-09-11; sources differ; in force 2027-01-01) are reported to add: a copy of the recorded complaint to the complainant; National Consumer Helpline convergence; compliance with the 2023 Dark Patterns Guidelines with an annual self-audit and a displayed certificate; the lowest price of the preceding 30 days when showing a reduction; sponsored-listing labels; no ranking manipulation; express and affirmative consent for specified data uses.

Today: legal name, address, phone, email and grievance officer are shown through the pages and the footer (blank until the owner supplies them, which blocks launch). The pages say a complaint copy is sent, give the 48 hours and one month figures, point to the National Consumer Helpline (toll-free 1915, consumerhelpline.gov.in, read from its official page 2026-10-21), and state price transparency and no-dark-pattern practices. A "self-audit" section is built but **hidden** until a date is supplied.

1. Does a sole proprietor selling its own services and digital files (no marketplace) count as an e-commerce entity, and which duties apply from 2027-01-01?
2. Must we register with the National Consumer Helpline, and do we need to publish a self-audit certificate (the draft shows only a hidden dated self-audit statement)?
3. Grievance officer: may it be the owner? Must the officer be resident in India? Are 48 hours and one month right for a service business?
4. Is the Delivery Policy (no physical goods, no shipping) enough for the gateway's "shipping policy" requirement and the Rules' delivery-terms duty?
5. Which consumer-law protections cannot be waived, for consumers (players and parents) as opposed to business customers (organisers, sponsors), so the Cancellation and Refund Policy structure does not conflict with them? (All numbers in it are the owner's choice.)

### E. IT Intermediary Rules (G.S.R. 120(E), in force 2026-02-20; VF-E9)

Context: takedown on a court order or reasoned government notification 36 hours changed to 3 hours; grievance disposal 15 days to 7 days; non-consensual intimate imagery 24 hours to 2 hours; the 24-hour acknowledgement dates from 2021.

Today: no public user-generated content (no comments or open uploads); tournament listings and submitted videos go through owner review. The Content Removal Policy states **operating targets**: acknowledge 24 hours, decide 7 days, court or government notice 3 hours, minors 48 hours. They are adopted whether or not the Rules apply (D-014).

1. Is Power Smash an "intermediary" for any feature (tournament listings, the video-submission form, an alerts list)? If so, which duties apply: grievance officer details, published rules, quarterly user notice, takedown on notice, appeals?
2. Are the targets and the way the policy words them (targets, not guarantees) acceptable? Is a counter-notice or appeal route needed?
3. For rights-holder or organiser objections the policy says we "may hide it while we look into it". Is that safe against abuse (false claims) and is a time limit needed? (A Todo marks the target time for rights disputes.)

### F. Privacy, DPDP, SPDI Rules and CERT-In (D-028, D-029; VF-E1, VF-E6, VF-E7, VF-E8, VF-E17)

Today: a privacy policy and a grievance contact are live at launch (the SPDI Rules and IT Act s.43A apply now); DPDP duties are treated as starting about 2027-05-13 (earlier date of two sites; the Rules were published 2025-11-13).

1. Is the Privacy Policy sufficient under s.43A and the SPDI Rules at launch, and does it fit the DPDP notice and rights duties from 2027-05-13? We collect no sensitive personal data by design.
2. **Legal basis.** Under DPDP there is no legitimate-interest ground (s.7 is a closed list). The draft says we rely on consent and, where the law allows, other lawful grounds (such as a request the person made, or a legal duty). Which ground fits (a) an enquiry sent through a form, (b) a WhatsApp message from someone who contacts us first, (c) a tournament listing, (d) a payment record?
3. **Cross-border and processors.** Vercel (hosting; the pages come from its worldwide network, and the form-handling code runs in the one region we set, intended Mumbai, not yet confirmed after a first deploy), Cloudflare (Turnstile, optional page counter), Telegram, GitHub (and, later, Google/YouTube and a private cloud-storage account) handle data on terms and in places the provider chooses; Supabase (planned: Mumbai) and Resend (planned: Tokyo) are chosen by us, and the page names a region only once the account exists and the owner confirms it. Any restriction? Must the policy name every country? (D-028 intends to name every processor and country; the provider table shows what is known.)
4. **Retention.** Closed leads anonymised after 24 months (spec 15.4); request records until resolved plus 12 months; events 90 days; encrypted backups about two months (later, once an erasure log exists, re-applied after any restore). Event documents deleted 30 days after the event (spec 15.4) are held back until such documents exist: **please say whether that rule may cover a permission letter, because a permission letter is our proof of rights and may need to be kept as long as the video is published (D-019)**. Logs: the CERT-In direction (rolling 180 days, copy in India) and DPDP Rule 6(1)(e) (one year) differ; D-028 plans one 12-month policy that covers both. The policy now says only that the hosting and database providers keep logs for the period their service sets and delete them; the free plans keep logs for much less than 180 days, so please say whether a longer log is needed for a site like this and which Cloudflare or Supabase logs count.
5. **CERT-In.** Reporting listed incidents within 6 hours, 180-day logs, NTP clocks, a contact point: do these bind a small site run by a sole proprietor, and what should the breach procedure (written in M4) say?
6. **Breach.** One sentence is in the policy. Is that enough, and what should the template to affected people and the Data Protection Board (72-hour report from 2027-05-13) contain?
7. Is an IP address alone personal data? Does Cloudflare Web Analytics or Turnstile need a consent banner (today: none)?
8. Does the form-notice design (a notice on every form, a version number and an append-only consent record, separate boxes per purpose, nothing pre-ticked) give usable evidence of consent, and are the texts in `src/content/consent.ts` adequate? The Tamil versions will be reviewed by a native speaker later (English only for now).
9. Is a separate "data contact" needed in addition to the grievance officer?
10. Data collected before 2027-05-13: D-028 says the policy states it is in scope when the duties start. The draft says the same in general words. OK?

### G. YouTube API Services and policies (D-016; VF-C3 to VF-C9, VF-C25, VF-C26; `docs/YOUTUBE_POLICY_QUERY_DRAFT.md`)

*LATER: the YouTube wording below is held back and appears when the site starts to use the YouTube API (M2a) or the video player (M2c). At G1 the pages do not mention YouTube API Services, because none is used.*

Context: the Developer Policies (updated 2026-10-15) ban creating "new or derived data or metrics" (III.E.4.h); the guide says title and thumbnail must be unmodified; non-authorised API data may be stored at most 30 days; no sponsorship on a page containing API data unless the page has enough independent content (III.G.1.d); nothing on or in the player (III.G.1.c); no charging to watch (III.F.3). No text says whether parsing titles into player and tournament pages is allowed; the owner will ask YouTube (OT-16). The privacy policy must state that the site uses YouTube API Services, link the Google Privacy Policy, and the terms must say users are bound by the YouTube Terms of Service (III.A.1, III.A.2).

Today: the raw title is shown unmodified; parsed details are labelled "Match details by Power Smash"; no composite or view-based scores; API values refreshed or deleted before day 30; sponsor slots only beside the player and only on pages with their own content; the HD file is separate footage delivered outside YouTube. The wording is in the Privacy Policy section "YouTube API Services" and in the Terms section "YouTube".

1. Please review the YouTube wording in the Privacy Policy and Terms (the required statements and links are present; the paraphrase is ours).
2. Does the mix of our own parsed records and API data create liability for the owner beyond API termination, and does selling a separate HD file of the owner's own footage raise any contract issue with YouTube?
3. Should you review the query to YouTube before the owner sends it?

### H. Terms, refunds, disclosures and removal wording

1. **Terms of Use:** the booking-by-written-confirmation clause ("a WhatsApp message or an email is fine"), the limit-of-liability paragraph ("to the extent the law allows"), the jurisdiction clause (the city is blank; OT-21 item 3), the licence-by-form wording for videos, and "a confirmed booking continues on the terms that applied".
2. **Cancellation and Refund Policy:** the structure only. Please confirm the headings cover what a gateway and consumer law expect (advance, cancellation by the customer, rescheduling, cancellation by us, digital files, sponsor packages, how refunds are paid, gateway fee, how to ask).
3. **Disclosures:** the page now promises only what the spec records as the owner's practice (a paid or other material connection is disclosed in the video or live stream itself, out loud and on screen, with YouTube's paid-promotion setting) and links to the ASCI guidelines instead of restating their label-length rules. The health, injury and supplement claims rule is held back until the owner confirms it as his own practice. Is this wording safe to publish given the owner's actual practice?
4. **Razorpay's own prohibited-business list** (terms Part A clause 17) sits near entry-fee tournaments (a later Power Smash Open); Razorpay's written confirmation is planned. No action unless you see a Phase 1 issue.

---

## 5. Dates and facts the drafts rely on

Confidence is "medium" unless stated. "Third-party summary" means a law-firm or explainer page, not the Gazette.

| Fact | Date | Basis |
|---|---|---|
| DPDP Rules 2025 published (G.S.R. 846(E)); Rules 1, 2, 17-21 from publication; consent-manager Rule 4 about 2026-11-13; Rules 3, 5-16, 22, 23 and Act s.3-17 and the penalty section about **2027-05-13** (two sites say 05-14; the earlier date is used) | 2025-11-13 | Third-party summary; the PIB release (2025-11-14) was found but its PDF could not be read by machine |
| DPDP Removal of Difficulties Order 2026 (S.O. 5458(E)), no commencement date changed | 2026-10-05 | Third-party summary |
| s.9 children: under 18, verifiable parental consent, no tracking or targeted advertising; penalties up to Rs 200 crore for s.9, Rs 250 crore for security safeguards | in force about 2027-05-13 | Third-party reproduction of the Act |
| IT (Intermediary Guidelines) Amendment Rules 2026, G.S.R. 120(E): takedown 3 hours, grievance 7 days, intimate imagery 2 hours; 24-hour acknowledgement from 2021 | in force 2026-02-20 | Third-party summaries (two sources agreed on 2026-10-21) |
| Consumer Protection (E-Commerce) (Amendment) Rules 2026 | notified about 2026-09-09 to 2026-09-11 (sources differ); in force **2027-01-01** | Third-party summaries (three sources agreed on 2026-10-21); Gazette text not read |
| Consumer Protection (E-Commerce) Rules 2020: seller details, grievance officer, 48-hour acknowledgement, one-month redress, total price | in force | Third-party summary |
| SPDI Rules 2011 and IT Act s.43A apply until the DPDP duties start | now | Third-party summary |
| CERT-In Directions: 6-hour incident reporting, 180-day logs | in force since 2022-06-27 | Third-party summary |
| ASCI influencer guidelines: disclose up front, label durations, live-stream announcement at start and end; DoCA Know-Hows: continuous live-stream label in audio and video; penalties via Consumer Protection Act 2019 s.21 | ASCI addendum 2023-08-17, PDF 2025-04; DoCA 2023-01-20 | ASCI PDF read directly (high); DoCA via summary |
| BAI Competition Regulations cl. 3.10-3.15, 13.11 | undated edition | Official PDF text extracted; in-force status unknown |
| Copyright Act 1957 s.2(uu), s.17(b), s.19 | in force | Official statute text |
| YouTube Developer Policies III.A, III.E.4, III.F.3, III.G.1; Terms of Service link `https://www.youtube.com/t/terms`; Google Privacy Policy `https://policies.google.com/privacy` | policies updated 2026-10-15 | Official, read 2026-10-21 through a summarising tool |
| National Consumer Helpline toll-free 1915, `consumerhelpline.gov.in` | read 2026-10-21 | Official page |
| Razorpay refund: the 2% fee and GST on it are not returned; settlement T+2 working days per the docs | 2026-10-20 | Official |

---

## 6. What could not be verified

- The Gazette texts of the DPDP Rules, the IT Rules 2026 and the E-Commerce Amendment Rules 2026 (figures come from summaries; the Amendment Rules' G.S.R. number and notification date differ between sources).
- Whether the BAI regulations edition is in force, and any Tamil Nadu state or district rules.
- Where Telegram, Razorpay and Google process data, and whether the production database region is Mumbai (planned, the project may not exist yet). The policy table says "Chosen by the provider" where the provider decides, and "Chosen when we set up the account" for Supabase and Resend until the owner confirms the region.
- What Cloudflare Turnstile or the YouTube player stores on a visitor's device (a browser test is planned; the policy makes no specific cookie claim, as D-016 requires).
- Whether the "right to nominate" and Data Protection Board complaint routes need to be in the policy (left out until you confirm).
- Whether a ticked box with a one-time code is enough for a copyright licence (untested in law).
- Rule 10 methods beyond the DigiLocker example, and whether a sports media publisher has any exemption (assumed none).
- Whether a sole proprietor is an e-commerce entity, and whether it must register with the National Consumer Helpline.

---

## 7. Items for the CA (not the lawyer)

Entity (individual, proprietorship, company) and that PAN, bank account name, domain registrant, Razorpay entity and invoices match (D-020); GST registration (threshold Rs 20 lakh for services; inter-state exemption; AdSense as zero-rated export that still counts); invoice type: plain receipt while unregistered or a tax invoice, receipt vouchers on advances, credit notes on refunds (D-021); reverse charge on sponsorship by a non-corporate supplier to a company or firm, and whether a banner is "sponsorship" or "advertising" (VF-D17); TDS category under the Income-tax Act 2025 s.393 (VF-D18); whether using a personal UPI for business collection is acceptable (the website does not show one, D-020 item 4); which accounting records to keep and for how long (feeds the retention table); a sample invoice for Razorpay (`docs/razorpay/SAMPLE_INVOICE.html`, all values fake). The Razorpay fee (2% plus 18% GST on it) and UPI MDR are not written anywhere on the pages.

---

## 8. How answers are put into the website

| If you say | What changes |
|---|---|
| Hide unknown-age matches; or keep minimal pages | `unknown_match_mode` and `minor_match_mode` settings (admin); no code change |
| A stronger parent verification method | Added to the claim and removal flow (D-015); the flow is built to accept one |
| Different retention periods | The retention table in the Privacy Policy and the scheduled cleanup job (M4). The job must be running before the first record reaches the stated age (`docs/legal/G1_REREAD_CHECKLIST.md`) |
| Different response targets | The table in the Content Removal Policy (wording file) |
| A consent text must change | `src/content/consent.ts`; every text has an id and a version, and a changed text gets a new version, so old consents stay linked to the wording shown |
| Changes to any page | The wording files named in section 3; the "last updated" date moves; the owner records your review and the draft notice is removed page by page |
| The Telegram alert may carry the reply link with the customer's phone number | Switch `telegramPhoneLink` in `src/content/legal/status.ts` and the Worker variable `TELEGRAM_ALERT_PHONE_LINK` together, after the policy sentence in the provider table has been reviewed (default: off) |
| A held-back feature is launching, or the owner confirms a practice | The lead turns that switch on in `src/content/legal/status.ts`; the held-back wording appears and the "last updated" date moves |

Nothing here has been sent to any authority, YouTube, Razorpay or any person.
