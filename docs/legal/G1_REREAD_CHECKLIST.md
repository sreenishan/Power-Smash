# G1 re-read checklist for the legal pages (DRAFT, for the lead and the owner)

Written 2026-10-21 by the Legal fix worker (review finding C-11). **This is not legal advice, and nothing here says the website is compliant with any law.** It exists so the six legal pages are re-read against what is really live before the first public launch (G1), and again each time a held-back feature ships.

The rule: **a legal page says only what is true on the day it is published.** Anything about a feature that does not exist yet, or a practice the owner has not confirmed, is written but held back in a `futureWording` block (`privacyFuture`, `termsFuture`, `disclosuresFuture`, `contentRemovalFuture` in `src/content/legal/*.ts`) and appears only when its switch in `src/content/legal/status.ts` is `true`. Tests (`tests/legal/features.test.ts`, `tests/legal/reality.test.ts`) fail if a switch and the code disagree.

## 1. Before G1: the five-minute re-read

1. Run the strict build (`npm run build:strict`) and open the six built pages (`dist/client/privacy/`, `terms/`, `refunds/`, `delivery/`, `disclosures/`, `content-removal/`) on a phone-sized window.
2. For each page, read every sentence and ask: *is this true today, on this site, as built?* If not, move the sentence into the page's `futureWording` block with the right switch, or ask the owner.
3. Set the facts in `src/content/legal/facts.ts` that are now known: `supabaseRegion` (after OT-27, read it in the Supabase dashboard), `resendRegion` (after OT-40). Leave a fact `null` if unsure: the page then says "Chosen when we set up the account".
4. Confirm each item in section 4 (owner practices) in chat with the owner. Flip a switch in section 2 only with a recorded yes.
5. Check section 3 (things that must be running for a sentence to be true).
6. Move `lastUpdated` in `src/content/legal/meta.ts` whenever any wording changes; the lawyer reviews the final text; only then the lead sets `reviewedByLawyer: true` for that page.

## 2. The switches (`features` in `src/content/legal/status.ts`)

All are `false` today except `cloudflareWebAnalytics`, which follows the build (true only when `PUBLIC_CF_ANALYTICS_TOKEN` is valid: the same moment the beacon is on the page).

| Switch | Arrives | What it adds to the pages | Check before switching on |
|---|---|---|---|
| `youtubeApiData` | M2a | "YouTube API Services" section (Privacy), the agreement to be bound by the YouTube Terms of Service (Terms), Google Privacy Policy and YouTube Terms links, "YouTube and Google" provider row | The sync really calls the API; the Developer Policies III.A wording still matches (re-read, VF-C8) |
| `youtubeEmbeds` | M2c | Click-to-load player and thumbnails: cookie bullet, provider row, Terms sentence | A browser test of what the iframe and Turnstile store (D-016 item 8) before any cookie claim; the visible "This loads YouTube" line is live |
| `archivePages` | M2c | Player, match and tournament pages; protected-player rules and "Match details by Power Smash" (Privacy, Terms, Disclosures, Content Removal) | **D-012 approved by the owner (still PROPOSED).** The protected rules are enforced in the `api` views and tests (M2c) |
| `competitionPages` | platform wave 3 (owner + lawyer) | The `/competitions/` pages in the release build, and a Privacy paragraph (children section): draws, order of play and results name only adults whose age is confirmed; anyone under 18 or not confirmed, and every player in a junior event or at a school or college event, is "Protected player"; anyone under 18 or not confirmed is left out of local rankings with places renumbered; results from junior and school or college events do not count towards local rankings; results are entered by Power Smash (owner-only admin); local rankings are not official BWF rankings. Re-check that the database treats a tournament whose level is School/college as junior (0018 `app.competition_public_events`) before switching on | **Owner and lawyer agree** to the protected-player rule for competition data: named only when `age_status = 'adult_confirmed'`, visibility public, not provisional, not merged, not suppressed (no video needed); every `is_junior` event or minor-signal tournament is all protected. The rule is enforced in the `api` views and tests; competition pages never link to player pages |
| `organizerAccounts` | platform wave 4 (owner + lawyer) | A Privacy collect row "Help run a tournament at our invitation" (email held by Supabase Auth, a name, role, tournaments, a record of changes kept after access ends); with `competitionPages` on too, the competition sentence becomes "Entries, draws and results on these pages are entered by Power Smash or by tournament organizers and scorers whom Power Smash has invited and given access to that tournament only. Results are shown only after Power Smash or the tournament's organizer has confirmed them."; with `liveScores` on too, the live paragraph names invited scorers; a Children paragraph "Organisers we invite for a tournament can see the names of all the players entered in it, including players we do not name on the website. Scorers we invite see a name only when we have confirmed that the player is an adult, and never in junior events." (D-122, D-124) | **Owner and lawyer agree.** The server also needs this flag on: `ORGANIZER_ACCOUNTS_ENABLED` alone opens nothing (D-122). The server setting `ORGANIZER_ACCOUNTS_ENABLED` is exactly `true` and the owner's database switch (admin, Accounts) is on in the same change. Re-read Supabase's invitation email text (unverified, `docs/m5/integration/accounts.md`). Only results confirmed by the owner or the tournament's organizer are public |
| `registrations` | platform wave 5 (owner + lawyer) | The `/register/<tournament>/<event>/` pages in the release build (with `competitionPages`), a Privacy collect row "Register a player for an event", a paragraph (no date of birth or age, never card details, a UPI PIN or a password; payment outside the website, checked by hand; contact data never shown; a player named only once confirmed adult; junior events never take registrations; every registered player must be 18 or over; the collect row says Power Smash handles registrations itself and shares them only with its service providers) and a retention Todo | The lawyer re-reads the registration notice (`src/lib/registration/consent.ts`, `registration-notice`, version `2026-10-31-draft2`: adults only, no parent-or-guardian sentence, no organiser sharing, D-123) and this wording; registering an under-18 player stays off the website until the lawyer approves a parental-consent flow; the retention period is decided and a purge exists before the first registration reaches it; a junior event is refused by the database; the owner alert holds no contact data; the admin's payment texts show nothing by default; `REGISTRATION_ENABLED` is exactly `true` |
| `liveScores` | platform wave 5 (owner + lawyer) | A Privacy paragraph: the event page shows the score as it stands while a match is scored, which account entered each point is recorded, names follow the competition rule, a live score is not a result. "Live" shows only while points are arriving (the owner's window, 5 minutes by default) | `LIVE_SCORES_ENABLED` is exactly `true` and the owner's live switch is on; a preview shows the cached answer (`x-vercel-cache: HIT`, no `no-store`; unverified, `docs/m5/integration/live.md`) |
| `internationalLinks` | platform wave 5 (owner + lawyer) | The `/international/` page in the release build and a Privacy paragraph "Links to other websites" (nothing copied from those sites; their own terms apply; our links send no referrer) | Every listed link is on an allowed website; `PS_INTERNATIONAL_SOURCE=supabase` in the release build. Note: `bwf.tournamentsoftware.com` may have closed (unverified, `docs/m5/international-data.md` F4) |
| `emailNotifications` | platform wave 5 (owner + lawyer, after OT-40) | The "Stay updated" sign-up form, a Privacy collect row "Sign up for email updates", a paragraph (double opt-in, 18 or over, one-click unsubscribe, address shared only with Resend and the database host Supabase) and a retention Todo | The sending domain is verified (OT-40), `EMAIL_ENABLED` and `NOTIFY_SUBSCRIBE_ENABLED` are exactly `true`; the lawyer re-reads the sign-up notice (version `2026-10-31-draft1`); one-click unsubscribe works in a real mail client; every sign-up gets the same answer; no address in alerts, logs or audit rows; Resend's data region is recorded. Decide with `emailAlerts`: the older alerts form on `/alerts/` is retired in favour of "Stay updated" |
| `siteNotices` | platform wave 5 (owner) | The notice banner on website pages and the WhatsApp Channel button in "Stay updated"; a Privacy cookies bullet "WhatsApp Channel" (following happens in WhatsApp, no number shared; notices hold no contact details) | `PS_NOTICES_SOURCE=supabase` in the release build; a real channel link in `site.whatsappChannelUrl` (OT-09); no notice holds contact data |
| `requestVerification` | M2d | One-time code wording (Privacy, Content Removal) | The code flow is live and sends nothing but the code |
| `ageProofChecks` | M2d | Age proof viewed privately and deleted (Privacy, Content Removal) | **D-015 approved (still PROPOSED).** The deletion really happens |
| `emailAlerts` | M3 | Alerts sign-up row, the 18+ confirmation sentence, a retention Todo | D-026 decided; the alerts notice and consent text are live; the owner answers the retention Todo |
| `videoSubmissions` | M3 | The "send your video" section (Terms), form row (Privacy), a retention Todo | The form, the licence and the three confirmations are live |
| `sponsorBanners` | M2c/M3 | "Banners sit beside the video player" (Disclosures) | Slots exist, beside the player only (D-016 item 6) |
| `sponsorLinkTracking` | M3 | "A click ... goes through a Power Smash link that counts the click" and the tap-recording sentence | `SponsorStrip` and every sponsor link really go through `/go/<slug>` (`tests/legal/reality.test.ts` also fails if `go-links.ts` holds a sponsored or partner link while this is off) |
| `paymentRecords` | M3 | "Payment records ... redacted after 90 days" retention row | The site stores payment events and the redaction job exists |
| `eventDocuments` | P3 | "Event documents are deleted 30 days after the event" (spec 15.4) | **Lawyer question first:** must this not cover a permission letter, which is our proof of rights and may need keeping for as long as the video is published (D-019)? |
| `erasureLog` | M2d or later | "We keep an erasure log ..." sentence (backups) | The `erasure_log` table exists (it is NOT in `0001_lead_funnel.sql`, finding C-10) and the restore procedure applies it |
| `offsiteBackupCopy` | owner | "GitHub and a private cloud-storage account" row and its retention Todo | The owner confirms the encrypted copy outside GitHub exists and how long it is kept (D-011) |
| `coverageAgreementRequired` | owner | "We do not start paid coverage without that agreement" (Terms) | **D-019 approved (still PROPOSED)** and the owner works that way for every paid job |
| `healthClaimsRule` | owner | Health, injury and supplement claims section (Disclosures) | The owner says it is his own practice |
| `telegramPhoneLink` | owner + lawyer | The Telegram row says an alert carries a reply link that contains the phone number | **Both** the owner and the lawyer agree, **and** the Worker variable `TELEGRAM_ALERT_PHONE_LINK` is set to exactly `true` in the same change (R-TELEGRAM-PHONE). Also re-read the `lead-notice` consent text (it does not mention the phone going to Telegram) |
| `cloudflareWebAnalytics` | build | "We count page views with Cloudflare Web Analytics" and the statistics sentences | Nothing to do by hand: it follows the token. A build without a token says nothing about page views |

When a switch is turned on, `tests/legal/features.test.ts` ("the pages as rendered now follow the flags") starts requiring its words on the live pages, and `tests/legal/features.test.ts` ("only the build-driven flag may be on today") must be edited on purpose to allow it.

## 3. Sentences that are true at G1 only if something is running

| Sentence (page) | Needs | Owner of the work |
|---|---|---|
| Closed enquiries are anonymised 24 months after closing; request records redacted 12 months after resolution; taps and form events 90 days then daily totals (Privacy, Content Removal) | The retention job (M4) **running before the first record reaches the stated age**. The first deadline is about 90 days after G1 (events). Until the job exists the owner must do it by hand | Lead (M4) |
| Encrypted backups kept about two months, deleted automatically (Privacy) | `backup.yml` enabled (`BACKUP_ENABLED`), the `age` public key committed (OT-31), artifact retention set to 56 to 60 days (D-011) | Lead, owner |
| An alert carries the kind, reference, first name or initial and the page, and no phone, email or free text (Privacy) | Telegram alert code that follows R-TELEGRAM-PHONE **including the "LEAD NOT SAVED" degraded alert** (it must obey the same switch) | Lead-backend |
| Vercel "hosts and delivers this website" and "the code that handles forms and enquiries runs in one region that we set" (Privacy provider table; added 2026-10-22 when hosting moved from Cloudflare, D-097) | After the first real deploy, confirm in the Vercel project that the function region really is the one set (intended Mumbai, `bom1`; a prebuilt deploy may ignore `vercel.json`, so the dashboard setting counts, OT-02). If it is not Mumbai, say which region in that row. Cloudflare's row now covers only Turnstile and the optional page counter | Lead, owner |
| "When you start a form, Cloudflare Turnstile runs" (Privacy) | The widget loads on first interaction (forms notes, `gate.ts`) | Forms |
| "Our own pages do not store cookies or other data in your browser" (Privacy) | Nothing in `src` uses cookies or browser storage (guarded by `tests/legal/reality.test.ts`) | All |
| "A scrambled code made from your internet connection address ... we do not store the address itself" (Privacy) | `leads.ip_hash` and `events.session_hash` stay hashes; no raw IP column or log (`supabase/migrations/0001_lead_funnel.sql`, D-029) | Lead-backend |
| Automatic emails "once email sending is switched on" (Privacy) | `EMAIL_ENABLED=true` only after the domain is verified (D-022). The email promises a reply time only when the owner sets `site.replyTimePromise` (R-ACK-PROMISE) | Lead-backend |
| Security and access logs are kept by the providers "for the period their service sets" (Privacy) | Nothing; it is true of every plan. **Open lawyer question:** whether a CERT-In style 180-day log is needed (briefing 4F item 4) | Lawyer |
| Complaint acknowledged within 48 hours, copy sent, resolved within one month (Terms, Privacy) | The owner can really do it; he reads the grievance mailbox daily (OT-19) | Owner |
| Court order or government notice: act within 3 hours (Content Removal) | The owner's phone is reachable (D-014). Written as a target, not a guarantee | Owner |

## 4. Owner practices written as plain statements (the owner confirms each in chat)

None of these is a number. Each is the owner's own practice or a business term, so a lawyer cannot confirm it for him.

| Statement | Page and section |
|---|---|
| A booking exists when we confirm it in writing (a WhatsApp message or an email is fine) and any advance has been paid | Terms, Enquiries, quotes and bookings |
| Before you pay, the pricing page or our quote shows the total including every charge; tax is explained on the pricing page and in the quote or invoice | Terms; Delivery (charges); Disclosures (prices) |
| We ask the organiser or promoting association to agree in writing about filming, ownership and use | Terms, Enquiries, quotes and bookings |
| We give you a receipt or invoice for your payment (the CA decides the form, D-021) | Refunds, How you pay |
| A refund for a payment made through the payment provider goes back to the payment method used | Refunds, How refunds are paid |
| A digital file is sent on WhatsApp or by email | Delivery, What we deliver |
| For a request about a player under 18: hide first, then verify; target 48 hours (D-014, spec 15.3) | Content Removal; Privacy (Children) |
| A paid or other material connection is disclosed in the video or live stream itself, out loud and on screen, with YouTube's paid-promotion setting (spec 15.5) | Disclosures |
| No countdown timers, no pre-ticked boxes, no hidden fees, no auto-renewing membership; a reduced price also shows the lowest price of the previous 30 days (D-037) | Disclosures |
| A complaint's copy is sent to the complainant as it is recorded (D-037, E-Commerce Amendment Rules 2026: third-party summary) | Terms, Privacy |

## 5. Every number on the pages and where it comes from

All appear in `tests/legal/numbers.test.ts` with their source; a new number fails the test until it is added on purpose. No price, fee, percentage, tax rate or currency amount is written on any page. **None of the figures below is invented; the owner approves them under OT-30 and the lawyer reviews them.**

| Figure | Page | Source |
|---|---|---|
| 24 months (closed enquiries anonymised) | Privacy, consent text `lead-notice` | Spec 15.4, D-028 |
| 12 months (request records redacted after resolution) | Privacy, Content Removal, consent text `request-notice` | D-028 |
| 90 days (events then daily totals; outer limit for answering a request) | Privacy | D-028; DPDP Rule 14(3) outer limit (third-party summary, VF-E6) |
| About two months (encrypted backups) | Privacy | D-011 (artifact kept 56 to 60 days) |
| 48 hours (grievance acknowledged; parent's removal request target) | Privacy, Terms, Content Removal | E-Commerce Rules 2020 (VF-E10, D-037); spec 15.3; D-014 |
| One month (grievance resolved) | Privacy, Terms | E-Commerce Rules 2020 (VF-E10, D-037) |
| 24 hours and 7 days (removal request: acknowledge, decide); 3 hours (court order or reasoned government notice) | Content Removal | D-014 (IT Rules 2026: third-party summary, VF-E9). Operating targets, not guarantees |
| 30 days (lowest price of the previous 30 days) | Disclosures | E-Commerce Amendment Rules 2026 (VF-E11, D-037: third-party summary) |
| 13 May 2027 (DPDP duties start) | Privacy | VF-E1 (third-party summary) |
| 1915 (National Consumer Helpline) | Terms | Official page read 2026-10-21 |
| Held back: 30 days (event documents; flag `eventDocuments`); 90 days (payment records; flag `paymentRecords`) | Privacy | Spec 15.4; D-028 |

The ASCI label-length figures (3 seconds, 15 seconds, 2 minutes) were removed from the Disclosures page: they were presented as the owner's own practice. The page links to the ASCI guidelines instead.

## 6. Optional owner text (hidden until supplied; never a Todo)

Set these in `src/content/legal/facts.ts`. While `null`, the item is hidden and the build leaves an invisible `data-owner-hidden` marker that `npm run check:placeholders` lists.

| Fact | Where it shows | Marker |
|---|---|---|
| `travelPolicy`: the owner's words on travel outside his home district | Delivery Policy, "Travel and venue needs" | `legal-travel-policy` |
| `liveStreamVenueNeeds`: what he needs at a venue for a live stream | Delivery Policy, "Travel and venue needs" | `legal-live-stream-venue-needs` |
| `rightsDisputeTarget`: the target time for a rights dispute (set with the lawyer) | Content Removal, "How fast we aim to act", last row | `legal-rights-dispute-target` |
| `darkPatternSelfAuditDate` | Disclosures, "Our self-audit" | `legal-dark-pattern-self-audit-date` |
| `removalFormPath` | Content Removal, "How to ask" | (the option simply does not show) |
| `supabaseRegion`, `resendRegion` | Privacy, provider table, "Where" column | (the cell says "Chosen when we set up the account") |

Required owner input stays a Todo because the page cannot be honest without it: legal name, address, phone, email, grievance officer (OT-19), the advance and refund rules (OT-21), delivery times and the time allowed to report a problem (OT-20, OT-21), the court city, and the lawyer's review of each page (OT-15).

## 7. Pages added after M1 (re-read 2026-10-22)

| Page | Legal wording today |
|---|---|
| `/request/` (claim, correct, hide, remove) | Linked from Content Removal ("Use our online request form", via `legalFacts.removalFormPath`) and Privacy ("use the request form"). No response time is promised on the link. The one-time code for parents is still LATER (`requestVerification` off). |
| `/submit-video/`, `/alerts/` | **Pages exist but their switches (`videoSubmissions`, `emailAlerts`) are still off, so Privacy and Terms say nothing about them.** Before these pages go public the lead must switch both on (owner's yes) and re-read the held-back wording and the consent texts. |
| Competition pages (`/competitions/`) | Switched off (`competitionPages`): the strict release build leaves the pages out and the Privacy paragraph on "Protected player" stays held back until the owner and the lawyer approve. |
| Archive pages (`/players/`, `/matches/`) | Switched off (`archivePages`): protected-player wording stays held back until D-012 is approved and the pages go public. |
