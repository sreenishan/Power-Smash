# Power Smash — Website & Revenue Platform

### Product Requirements & Technical Build Specification

| | |
|---|---|
| **Client** | Power Smash — Tamil Nadu badminton media ([YouTube @PowerSmash](https://www.youtube.com/@PowerSmash)) |
| **Product** | Public website + admin console + automation (together, "the Platform") |
| **Working domain** | `powersmash.in` — working assumption; replace through configuration if a different domain is purchased |
| **Document** | Product requirements + technical specification, v1.0 |
| **Date** | 20 October 2026 |
| **Audience** | Claude Code (build agent) · Power Smash owner (approver) |
| **Status** | Approved for Phase 1 build, pending owner inputs (§20) |

> **Owner — how to use this file**
>
> 1. Create an empty folder on your computer and put this file inside it.
> 2. Open Claude Code in that folder.
> 3. Send: **"Read power-smash-website-spec.md fully, follow Section 0, and start Phase 1."**
> 4. Claude Code will reply with a plan and a short list of things it needs from you (§20). Send those, then let it build.

---

## At a glance

| | |
|---|---|
| **What we're building** | A fast, mobile-first website that turns the Power Smash YouTube archive into searchable **player, match and tournament pages**, and sells **services to organizers, players and sponsors** — all run from a simple admin console. |
| **Why it wins** | Power Smash owns something nobody else has: a 1.9K-video archive centred on Tamil Nadu tournament badminton, and the player names attached to it. The site makes that archive discoverable on Google and shareable on WhatsApp, then converts attention into bookings and sponsorships. |
| **How it earns** | Tournament coverage & live streaming · Sponsorships & placements · Player products (highlight reels, HD match files) · Featured listings · Affiliate gear · Own events · Fan support · Merchandise (§4) |
| **Stack** | Astro + TypeScript + Tailwind (React islands) · Supabase · Cloudflare · GitHub Actions · Razorpay (§12) |
| **Timeline** | Phase 1 launch ≈ 2–3 weeks · Phase 2 monetization ≈ +3–4 weeks · Phase 3 ongoing (§17) |
| **Running cost at launch** | Domain + free tiers; paid upgrades only when revenue justifies them (§12.6) |

## Contents

0. Instructions for Claude Code
1. Executive summary
2. Goals & success metrics
3. Audiences & user stories
4. Revenue model
5. Brand & design system
6. Information architecture
7. Page specifications
8. Monetization features
9. Growth, SEO & distribution
10. Content engine: YouTube sync & title parser
11. Data model & data security
12. Technical architecture
13. Integrations & configuration
14. Admin console
15. Legal, privacy & compliance
16. Analytics & reporting
17. Roadmap & acceptance criteria
18. Testing & QA
19. Deliverables
20. Owner inputs checklist
21. Owner operating playbook
- Appendix A — Title parsing specification
- Appendix B — Copy deck (English + draft Tamil)
- Appendix C — Package & pricing templates
- Appendix D — Message templates

---

## 0. Instructions for Claude Code

Read this section first. These rules apply to every phase.

1. **Read the whole document before writing code.** Then reply with (a) a build plan for the current phase — milestones, assumptions, risks — and (b) the owner inputs from §20 that block it. Ask for missing inputs in one batch. Where an input doesn't block progress, continue with a visible placeholder.
2. **Build in phases (§17).** Don't start Phase 2 features until Phase 1 passes its acceptance criteria, but design the data model so later phases need no rewrites.
3. **Use the recommended stack (§12).** Deviate only for a concrete blocker, and record every such decision with its reason in `docs/DECISIONS.md`.
4. **Verify before you rely.** This spec was written in October 2026. Check the current versions, APIs, quotas and plan terms of every third-party service at build time.
5. **Never fabricate.** Statistics come from the YouTube API or the owner. Testimonials, sponsor names and logos, prices, addresses and audience figures come only from the owner. Use visible placeholders — `TODO(owner): …` — and keep them listed in `docs/OWNER_TODO.md`. Public pages must not launch with placeholders.
6. **No third-party imagery as brand assets.** No photos of famous players, no BWF or broadcast frames, no brand logos unless a sponsor supplies them with permission.
7. **Privacy by default.** Apply the junior-player rules (§15.3). Private fields never reach the public build (§11.4). Secrets live only in environment variables.
8. **Ask before anything that costs money, can't be undone, or acts on the owner's public accounts** — buying a domain, enabling paid plans, deleting data, writing to YouTube, messaging customers.
9. **Design for a non-developer owner.** Every routine task must be possible from the admin console on a phone. Write `docs/OWNER_GUIDE.md` in plain English.
10. **Create `CLAUDE.md`** at the repository root with commands, conventions, an architecture summary and a pointer to this spec, so future sessions stay consistent.
11. **Work in small vertical slices.** Commit often with clear messages, keep tests green, and update `CHANGELOG.md`.

---

## 1. Executive summary

Power Smash is a YouTube-first badminton media brand dedicated to Tamil Nadu players and tournaments — district, state, South-India level and open events. As of October 2026 the channel has about **88K subscribers and 1.9K videos**, channel memberships enabled, an Instagram account and a Facebook page. It already informally offers tournament filming and pamphlet promotion, and accepts match videos from the community.

The Platform turns that reach into a business. It does three jobs:

1. **The Archive** — every player and every match, searchable, with a page per player, per match and per tournament, generated automatically from the YouTube catalogue.
2. **The Storefront** — clear, priced, bookable services for organizers, players and sponsors, with online payments.
3. **The Hub** — one owned home that connects YouTube, Instagram, Facebook and WhatsApp, and builds an opt-in audience that no platform algorithm can take away.

**Positioning (draft):** *Tamil Nadu badminton, on record.*

**Strategic moat:** original local tournament footage plus the player names attached to it. Grassroots players search for themselves, and nobody else competes for those searches.

---

## 2. Goals & success metrics

### 2.1 Business goals

| ID | Goal |
|---|---|
| G1 | **Diversified revenue** — at least four income streams live within 90 days of launch (§4). |
| G2 | **Default media partner** for Tamil Nadu tournaments — organizers think "Power Smash" when they plan coverage. |
| G3 | **Owned audience** — an opt-in alerts list (WhatsApp/email) independent of any platform. |
| G4 | **Search presence** — rank for Tamil Nadu player names, tournament names and "{district} badminton tournament". |
| G5 | **Low-effort operations** — each new upload needs no more than 10 minutes of admin work. |

### 2.2 Starting targets (90 days after launch — recalibrate after month 1)

| Metric | Target |
|---|---|
| Pages indexed by Google | ≥ 2,000 |
| Qualified enquiries (coverage + sponsorship) | ≥ 10 per month |
| Paying sponsors | ≥ 2 |
| Paid player orders | ≥ 10 per month |
| Alerts subscribers | ≥ 1,000 |
| Median lead response time | < 24 hours |

### 2.3 Product KPIs (visible in the admin)

Enquiry-to-paid conversion rate · revenue by stream · sponsor click-through rate · WhatsApp shares of player pages · searches with zero results (content gaps) · share of new uploads parsed without manual review.

---

## 3. Audiences & user stories

### 3.1 Personas

| Persona | Who | What they want | What they pay for |
|---|---|---|---|
| **Player** | Amateur to state-level, roughly 14–40 | Find, watch and share their matches | Highlight reels, HD match files |
| **Parent of a junior** | Parents of U-9 to U-19 players | Progress videos, coaching analysis, trial and admission material — with privacy | Reels, files, season packs |
| **Organizer** | District associations, clubs, academies, corporates | Entries, promotion, professional coverage and live streams, sponsor visibility | Coverage packages, featured listings |
| **Sponsor** | Sports shops, racket/shuttle dealers, academies, physio and nutrition clinics, local brands | Reach the Tamil Nadu badminton community with measurable results | Monthly and per-tournament sponsorship |
| **Academy / coach** | Coaching centres and independent coaches | More students | Featured directory listings |
| **Fan** | Followers of Tamil Nadu badminton | Watch matches, follow players and tournaments | Memberships, merchandise |

### 3.2 User stories

| ID | Story |
|---|---|
| US-P1 | As a **player**, I can search my name and see all my matches on one page, so I can share it. |
| US-P2 | As a **player**, I can order a highlight reel or an HD file of my matches and pay online. |
| US-P3 | As a **player**, I can claim my profile and correct my name, district and academy. |
| US-J1 | As a **parent**, I can ask for my child's page to be hidden or corrected and get a quick response. |
| US-O1 | As an **organizer**, I can list my tournament for free and upgrade it to featured. |
| US-O2 | As an **organizer**, I can see coverage packages with prices and book with an advance payment. |
| US-O3 | As an **organizer**, I get a printable QR poster so players at my venue can find their videos. |
| US-S1 | As a **sponsor**, I can see audience numbers and packages and send an enquiry in under two minutes. |
| US-S2 | As a **sponsor**, I receive a monthly report of impressions and clicks. |
| US-A1 | As an **academy**, I can list my academy and coaches and pay to be featured. |
| US-F1 | As a **fan**, I can get tournament alerts on WhatsApp or email. |
| US-OW1 | As the **owner**, new YouTube uploads appear on the site automatically with players and tournament linked. |
| US-OW2 | As the **owner**, every enquiry lands in one inbox with a status, and I get an instant Telegram or email alert. |
| US-OW3 | As the **owner**, I can fix a wrongly parsed title or merge two spellings of a player's name in under a minute. |

---

## 4. Revenue model

| # | Stream | Who pays | How the Platform enables it | Pricing model | Phase |
|---|---|---|---|---|---|
| R1 | **Tournament coverage & live streaming** | Organizers, associations, academies, corporates | Services and pricing pages, booking form, leads inbox, payment links, QR posters | Package price + advance | P1 enquiry & manual payment link → P2 online payment |
| R2 | **Sponsorship & placements** | Sports retailers, racket/shuttle dealers, academies, physio/nutrition, local brands | Partner page & media kit, scheduled placements, tracked clicks, monthly reports | Monthly, per tournament or quarterly | P1 placements & tracking → P2 automated reports |
| R3 | **Player products** | Players, parents | Order buttons on player and match pages: highlight reel, HD match file, season pack | Fixed price per item | P1 enquiry → P2 checkout |
| R4 | **Featured listings** | Organizers, academies, coaches | Paid upgrade when submitting a tournament; academy directory | Per listing or per period | P2 |
| R5 | **Affiliate commerce** | Retailers (commission on purchases by players and fans) | Gear page with tracked affiliate links; owner tags the same products in videos via YouTube Shopping | Commission | P2 |
| R6 | **Own event — Power Smash Open** | Players (entry fees), sponsors | Event microsite: registration, payments, sponsor inventory | Entry fees + sponsorship | P3 |
| R7 | **Fan support** | Fans | Support page linking channel memberships, Super Thanks/Super Chat and the WhatsApp Channel | Platform payouts | P1 |
| R8 | **Merchandise** | Fans, players | Jerseys and tees store | Product margin | P3 |

**Pricing principles**

- Every price is owner-configured in the admin: INR, a GST-inclusive/exclusive flag, and a type of "fixed", "starting from" or "on quote".
- A public **/pricing** page must list real or "starting from" prices, because the payment gateway checks for one (§15.2).
- Store money as integer **paise**. Display with Indian digit grouping (₹1,25,000).

---

## 5. Brand & design system

### 5.1 Brand essence

- **Personality:** fast · bold · proud · community-first · trustworthy.
- **Design idea:** *broadcast-grade presentation, grassroots heart* — the polish of a sports-TV graphics package, applied to local players.
- **Tagline options (owner picks one):** "Tamil Nadu badminton, on record." · "Every player. Every match. Every smash." · "Where Tamil Nadu badminton lives."

### 5.2 Logo

The current channel avatar is a photograph of a professional player, which cannot serve as a brand mark. Create an original SVG wordmark — **POWER SMASH** in a heavy, condensed italic — with a simple shuttle-trail symbol. Deliver the full logo, the symbol alone, light and dark versions, a favicon set, a social avatar and a default Open Graph image. The owner approves it; a designer's version can replace it later without code changes.

### 5.3 Colour tokens

Define these as CSS custom properties and map them into the Tailwind theme.

| Token | Hex | Use |
|---|---|---|
| `--ps-court` | `#0B6E4F` | Primary — buttons, links, key headings |
| `--ps-court-deep` | `#064532` | Hover states, dark sections |
| `--ps-ink` | `#0B1416` | Body text; "broadcast" dark backgrounds |
| `--ps-volt` | `#C6F432` | Accent on dark backgrounds only — highlights, live scores, CTA fills with ink text |
| `--ps-feather` | `#F7F8F5` | Page background |
| `--ps-white` | `#FFFFFF` | Cards, court-line motifs, text on dark |
| `--ps-slate` | `#5B6B70` | Secondary text |
| `--ps-border` | `#DDE3E1` | Borders, dividers |
| `--ps-live` | `#C62A1F` | LIVE badges, critical alerts |

Meet WCAG 2.2 AA contrast. Reference ratios: white on court ≈ 6.3:1 · ink on volt ≈ 14.6:1 · slate on feather ≈ 5.1:1 · white on live ≈ 5.6:1. Never use volt as text on a light background.

### 5.4 Typography

| Role | Font | Notes |
|---|---|---|
| Display / headings | **Barlow Condensed** 700–800 | Uppercase for H1/H2 display lines; italic allowed for energy |
| Body / UI | **Inter** 400–600 | Default UI font |
| Tamil | **Noto Sans Tamil** 400–600 | Applied with `:lang(ta)` |
| Numbers | Inter with tabular figures | Stats, scoreboards, prices |

Load only the weights and subsets in use, with `font-display: swap`; self-hosting is preferred for performance. Use a fluid type scale with `clamp()` — H1 around 2.25rem on mobile, up to about 4rem on desktop.

### 5.5 Layout, components & motion

- **Mobile-first.** 360–414 px is the primary design width. Max content width 1200 px, 8 px spacing grid, 16 px side gutters on mobile, never any horizontal scroll.
- **Core components:** SiteHeader (sticky, compacts on scroll) · SearchOverlay · MatchCard (thumbnail, duration, category/age badge, round, "A vs B" lockup, tournament, date, views) · PlayerCard · TournamentCard (date block, level badge, district, "Featured" ribbon) · StatCounter (scoreboard style) · CategoryBadge · LiveBadge · PackageCard · SponsorStrip (labelled "Partners") · SponsorBanner (labelled "Sponsored", space reserved so nothing shifts) · ShareBar (WhatsApp first) · FilterChips (bottom-sheet drawer on mobile) · Breadcrumbs · EmptyState · Toast · form fields · admin DataTable.
- **Motifs:** subtle court-line SVG patterns; a "vs" lockup on match cards inspired by broadcast lower-thirds; scoreboard-style counters.
- **Motion:** 150–250 ms transitions; no autoplaying video or audio; respect `prefers-reduced-motion`.
- **Imagery:** YouTube thumbnails for matches; Power Smash's own venue and action stills for hero sections (owner-supplied); no generic stock clichés.
- **Icons:** one open-source set (for example, Lucide).
- **Theme:** light content pages with dark "broadcast" sections (hero, live, stats). A full dark mode is optional (P3).

### 5.6 Voice

Short, energetic and respectful. Celebrate every player; never mock a mistake, a loss or a junior. English first, with Tamil for key lines (Appendix B).

---

## 6. Information architecture

### 6.1 Sitemap

| Route | Page | Phase |
|---|---|---|
| `/` | Home | P1 |
| `/matches` | Match library (filters, sort, search) | P1 |
| `/matches/[slug]` | Match page | P1 |
| `/players` | Player directory | P1 |
| `/players/[slug]` | Player profile | P1 |
| `/tournaments` | Upcoming calendar + past archive | P1 |
| `/tournaments/[slug]` | Tournament page | P1 |
| `/tournaments/submit` | List your tournament | P1 |
| `/services` | Services overview | P1 |
| `/pricing` | All prices (needed for payment-gateway activation) | P1 |
| `/book` | Coverage booking enquiry | P1 |
| `/partner` | Sponsorship & media kit | P1 |
| `/submit-video` | Send your match video | P1 |
| `/live` | Live & upcoming streams | P1 |
| `/support` | Join / support the channel | P1 |
| `/alerts` | Tournament alerts sign-up | P1 (simple) → P2 (follow players) |
| `/about`, `/contact` | About, Contact | P1 |
| `/privacy`, `/terms`, `/refunds`, `/delivery`, `/disclosures`, `/content-removal` | Legal pages | P1 |
| `/go/[slug]` | Tracked outbound redirects (sponsors, gear) | P1 |
| `/admin/*` | Admin console (authenticated, `noindex`) | P1 |
| `/order/[product]` | Player-product checkout | P2 |
| `/gear` | Gear picks (affiliate) | P2 |
| `/academies`, `/academies/[slug]` | Academy & coach directory | P2 |
| `/open` | Power Smash Open (own event) | P3 |
| `/stories`, `/stories/[slug]` | News & stories | P3 |
| `/shop` | Merchandise | P3 |
| `/ta/...` | Tamil versions of key pages | P3 |

### 6.2 Navigation

- **Header:** Matches · Players · Tournaments · Services · Partner with us · **[Book coverage]** (button) · Search.
- **Footer:** About · Contact · Pricing · Send your video · List your tournament · Support · social links · legal links · partners strip (only when real partners exist).

### 6.3 URL rules

- Lowercase, hyphenated and stable. Player slugs come from the display name; collisions get a disambiguator (`karthik-r-madurai`) or a counter (`karthik-2`).
- Match slug: `{side-a}-vs-{side-b}-{short-id}`. Tournament slug: `{name}-{year}-{city}`.
- Renames and merges create permanent 301 redirects (`slug_redirects` table).

---

## 7. Page specifications

Every public page has a unique `<title>` and meta description from templates, a canonical URL, Open Graph tags, breadcrumbs (except Home) and the standard footer.

### 7.1 Home `/`

**Purpose:** show scale and freshness within five seconds, then route visitors to *find my match*, *book coverage* or *partner with us*.

Sections, in order:

1. **Announcement bar** (optional, admin-controlled) — for example, "LIVE now: District Championship Finals".
2. **Hero** (dark broadcast style) — headline, sub-line, large search box (players + tournaments), stat counters (subscribers, matches on record, players on record, tournaments covered), primary CTA *Find your match*, secondary CTA *Book coverage*. The API returns rounded subscriber counts, so display them as "88K+".
3. **Live / upcoming strip** — shown only when a stream is live or scheduled.
4. **Latest matches** — 8 MatchCards → `/matches`.
5. **Upcoming tournaments** — featured first → `/tournaments`; CTA *List your tournament — free*.
6. **Trending players** — most viewed in the last 30 days, adults only; CTA *Claim your profile*.
7. **Services teaser** — three PackageCards → `/services`.
8. **Partners strip** — real sponsors only, hidden when there are none; CTA *Become a partner*.
9. **Community** — WhatsApp Channel, Instagram, Facebook, YouTube *Join*.

SEO title: "Power Smash — Tamil Nadu Badminton Match Videos, Players & Tournaments".

### 7.2 Match library `/matches`

- Grid of MatchCards with filters for year, tournament, category (MS/WS/MD/WD/XD/BS/GS/BD/GD), age group, round and district; sort by newest or most viewed.
- Pick an approach that stays fast with 2,000+ items (a pre-built JSON index with client-side filtering, or paginated static pages). Pagefind powers text search.

### 7.3 Match page `/matches/[slug]`

- Lite YouTube embed (privacy-enhanced domain; the iframe loads on tap), H1 "A1 / A2 vs B1 / B2", a meta row (tournament link, category, age group, round, date, views) and player chips linking to profiles.
- CTAs: *Get this match in HD* · *Make my highlight reel* (P1 enquiry → P2 checkout) · ShareBar.
- Sponsor banner slot; related matches (same tournament, same players); a "Watch on YouTube" link.
- Structured data: `VideoObject` (name, description, thumbnailUrl, uploadDate, ISO 8601 duration, embedUrl) + `BreadcrumbList`.

### 7.4 Player directory `/players`

- Search-first (large input), A–Z index, filters for district, academy, category and active year.
- Cards show name, district/academy (when provided), matches on record and latest match date. Junior cards show only the name and match count.

### 7.5 Player profile `/players/[slug]`

- **Header:** name (plus a "Verified" badge once claimed), district/academy chips (when provided), categories played, stats (matches on record, tournaments, first seen, latest match), ShareBar, *Claim / update this profile*, primary CTA *Get my highlight reel*.
- **Matches:** grid with year, tournament and category filters, newest first.
- **Played with / against:** partner and frequent-opponent links (hidden for juniors).
- **Tournaments:** linked list.
- Sponsor banner slot.
- Footer note: *"Is this you or your child? Request a change or removal."* → profile request form.
- **Junior mode:** see §15.3.
- SEO title: "{Name} — Badminton Match Videos | Power Smash". Description: "{N} match videos of {Name} from {top tournaments}…". Structured data: `ProfilePage` with `Person` (adults only), `BreadcrumbList`, and an `ItemList` of videos.

### 7.6 Tournaments `/tournaments`

- Two tabs: **Upcoming** (grouped by month, featured pinned with a ribbon) and **Past** (archive with video counts).
- Filters for district, level, month and category. CTAs: *List your tournament — free* and *Book coverage for your tournament*.

### 7.7 Tournament page `/tournaments/[slug]`

- **Upcoming:** poster, dates, venue (map link), organizer, categories, entry details, registration link/contact (shown only with the organizer's consent), a "Covered by Power Smash" badge when booked, ShareBar, add-to-calendar (`.ics`), *Get alerts*.
- **Past:** all matches grouped by category, then round (Final, SF, QF…); most-watched matches; a "Coverage presented by {sponsor}" slot.
- Organizer CTA: *Is this your tournament? Book coverage or feature it.*
- Structured data: `SportsEvent` (name, startDate, endDate, location, organizer, eventStatus) + `BreadcrumbList`.

### 7.8 List your tournament `/tournaments/submit`

- **Fields:** tournament name, organizer/association, contact person, phone (WhatsApp), email, venue, city/district, dates, categories and age groups, entry fee and registration details, registration link, poster (image ≤ 5 MB), consent to show contact details publicly, listing type (*Free* / *Featured* — P1 records the request, P2 takes payment), a checkbox *I'm interested in Power Smash coverage* (which also creates a coverage lead), Turnstile.
- **Result:** the tournament is stored as `pending`, the owner is alerted, and the organizer sees a confirmation with a reference code and a WhatsApp link.

### 7.9 Services `/services` and Pricing `/pricing`

- **Services:** hero ("Broadcast-quality coverage for your tournament"), package groups for organizers, players and promotion (Appendix C), a process timeline (Enquire → Quote → Advance → Coverage day → Delivery → Balance), deliverables, FAQs (travel outside the home district, power and internet needs for live streams, delivery times, cancellations), real testimonials only, and CTAs *Book coverage* and *WhatsApp us*.
- **Pricing:** every product with an INR price or a "starting from" price, inclusions, a GST note, delivery timelines, and links to the refund and delivery policies.

### 7.10 Book coverage `/book`

- A three-step mobile form: **Event** (name, dates, venue, district, level, courts, categories, expected entries) → **Services** (package, live stream yes/no, match days, add-ons) → **Contact** (name, organization, phone/WhatsApp, email, budget range, notes, consent, Turnstile).
- Creates a `coverage` lead with a reference such as `PS-2026-0012`, alerts the owner, and shows a confirmation with a prefilled WhatsApp message quoting the reference.

### 7.11 Partner with us `/partner`

- **Why Power Smash:** who the audience is — players, parents, coaches and organizers across Tamil Nadu.
- **Numbers:** live channel stats from the API, plus owner-entered audience data from YouTube Studio (top locations, age and gender split, monthly views, average view duration) labelled "as of {date}".
- **Packages** (Appendix C) with deliverables, a visual preview of placements, real past partners and case studies only, a media-kit download (P1 uploaded PDF → P2 generated from live data), and an enquiry form (company, contact, budget, objectives, start month) that creates a `sponsorship` lead.
- Note on the page: "Paid placements are always labelled."

### 7.12 Send your match video `/submit-video`

Replaces the current email / Google Drive / Telegram intake.

- **Fields:** submitter name, role (player, parent/guardian, coach, organizer, other), phone, email, video link (Google Drive or another share link — required in P1; direct upload in P2), tournament, date, category, round, players on each side, notes.
- **Required confirmations** (unticked by default): *I am 18 or older* · *I recorded this video or have the right to share it* · *I allow Power Smash to publish and monetise it on YouTube and this website* · *I understand Power Smash will remove a video on a valid request from a player, parent/guardian or rights holder*.
- Store the consent text version, a timestamp and a salted IP hash.
- **Admin queue:** approve → owner uploads to YouTube → links the YouTube ID → optional on-page credit "Video: {name}".

### 7.13 Live `/live`

- The current live stream (if any) at the top, scheduled streams below, and a list of past streams.
- Data comes from a cached server endpoint (at most one YouTube API call per 2 minutes) plus sync data. CTA: *Join the channel* (memberships, Super Chat).

### 7.14 Support `/support`

Channel membership (*Join*) link, a Super Thanks/Super Chat explainer, WhatsApp Channel, Instagram, Facebook, *Share the channel* and *Send your video*.

### 7.15 About `/about` & Contact `/contact`

- **About:** story, mission, team (owner-supplied), coverage stats, districts covered, press mentions (if any).
- **Contact:** legal/registered name, physical address, phone/WhatsApp, domain email, hours, a contact form (creates a `general` lead) and a grievance contact. These details are required for payment-gateway activation (§15.2).

### 7.16 Legal pages

See §15.1.

### 7.17 Error pages

404 and 500 pages with a search box and popular links.

---

## 8. Monetization features

### 8.1 Leads pipeline — the core of the business

- Every enquiry form (coverage, sponsorship, player products, listings, contact) creates a `lead` with its type, source page, UTM data and a reference code `PS-YYYY-NNNN`. Tournament submissions, video submissions, profile requests and alert sign-ups go to their own queues (§11) but alert the owner the same way.
- Status flow: `new → contacted → quoted → won → completed`, or `lost` (with a reason).
- **Instant alerts** to the owner via Telegram and email: a summary plus a one-tap WhatsApp link to the customer (`wa.me` with a prefilled greeting).
- **Auto-acknowledgement** email to the customer (when an email is given) with the reference and expected reply time.
- **Admin:** kanban board and table, notes, follow-up dates, a morning Telegram digest of follow-ups due, CSV export.

### 8.2 Payments (Razorpay)

- **Phase 1:** the owner creates Payment Links in the Razorpay Dashboard (usable before the website is activated) and pastes them into the lead; a static UPI QR on `/pricing` covers small amounts; the admin has *Mark paid* with a reference.
- **Phase 2** (after the gateway approves the website):
  - Checkout for fixed-price products (player products, featured listings).
  - Payment Links via the API for custom quotes and advances — created from a lead and sent by WhatsApp or email.
  - Webhooks with signature verification and idempotency, updating orders and leads.
  - PDF receipts with sequential numbering; refunds recorded according to the refund policy.
- Implement behind a `PaymentProvider` interface so another Indian gateway can be swapped in.
- Server endpoints run on Cloudflare Workers, so use REST calls with `fetch` and Web Crypto for HMAC (Node-only SDKs may not run there).
- GST settings: registered yes/no, GSTIN, rate. Receipts show GST only when registered.

### 8.3 Sponsor placements & reporting (ad inventory)

- **Slots:** `home_partner_strip`, `footer_partner_strip`, `player_page_banner`, `match_page_banner`, `tournament_page_banner`, `tournament_coverage_title` (per tournament), `gear_page_banner`.
- **Placement record:** sponsor, creatives (desktop and mobile, alt text, optional headline), destination URL, `go` slug, start and end dates, priority, label ("Sponsored" or "Partner").
- **Scheduling without rebuild lag:** embed the active and upcoming schedule in each page; a tiny script picks the creative for today's date, with space reserved so the layout never shifts.
- **Tracking:** impressions through a lightweight batched beacon; clicks through `/go/[slug]`, which logs the click and then redirects (302) with `utm_source=powersmash&utm_medium=sponsor&utm_campaign={placement}`.
- **Reporting:** per sponsor, per month — impressions, clicks, CTR, top pages — exported as PDF/CSV in a branded "Power Smash Partner Report".
- **Guardrails:** at most one banner above the fold, never inside the video player, no pop-ups, always labelled.

### 8.4 Player products (P2)

- **Products:** Highlight reel (short edit from chosen matches) · HD match file (per match) · Season pack (all matches in a year) · Custom edit (on quote).
- **Flow:** CTA on a player or match page → `/order/[product]?player=…&match=…` → choose matches (pre-ticked) → contact details → pay → order moves `paid → in_production → delivered` → owner alerted → owner pastes the delivery link → customer notified by email, and the owner gets a one-tap prefilled WhatsApp message to send.
- The owner-set delivery time is shown before payment. **P1 fallback:** the same form creates a lead and the owner sends a payment link.

### 8.5 Featured listings (P2)

- **Featured tournament:** pinned on `/tournaments` and the home page, with a ribbon and a social-share bundle (owner checklist); runs until the event date.
- **Featured academy:** top of district results, a badge, photos and a WhatsApp button; billed monthly.
- Purchased during submission or later through a link; expiry is date-based.

### 8.6 Gear & affiliate (P2)

- `/gear` organised by category: rackets, shoes, strings, shuttles, grips, bags, accessories. Curated picks with the owner's short notes (true statements only).
- Links go through `/go/` for click logging. Show an affiliate disclosure at the top of the page and near the links, using each program's required wording.
- Owner guide reminder: tag the same products in videos through YouTube Shopping.

### 8.7 Alerts list — the owned audience

- `/alerts` and inline forms: name, WhatsApp number and/or email, districts, interests (tournament alerts, new videos of followed players, Power Smash Open), explicit consent and an 18+ confirmation; email uses double opt-in.
- **P2:** *Follow this player* — an email when a followed player's new match is published.
- Admin CSV export for broadcasting through the WhatsApp Channel or Business app, or an email tool; an unsubscribe link in every email.

### 8.8 Power Smash Open (P3)

An event microsite: overview, categories and fees, rules, schedule, venue, registration (per category; partner names for doubles; age proof only for age categories, stored privately and deleted 30 days after the event), Checkout, a public entry list (names only), sponsor inventory, and links to live streams and results.

### 8.9 Merchandise (P3)

Simple product pages with sizes and Checkout, or links to a print-on-demand partner.

---

## 9. Growth, SEO & distribution

### 9.1 Technical SEO

Static HTML · semantic headings · unique titles and descriptions from templates · canonical URLs · XML sitemaps split by type (matches, players, tournaments, pages) with `lastmod` · `robots.txt` · breadcrumbs · structured data (`VideoObject`, `SportsEvent`, `ProfilePage`/`Person` for adults, `Organization` with `sameAs` links to YouTube, Instagram and Facebook) · Open Graph and Twitter cards · 301 redirects for renamed or merged slugs · strong internal linking (player ↔ match ↔ tournament ↔ partner/opponent).

### 9.2 Search intent the templates must serve

"{player} badminton" · "{tournament} {year}" · "{district} badminton tournament" · "badminton tournament Tamil Nadu {year}" · "Chennai badminton tournament". Use these naturally in titles and headings — no keyword stuffing.

### 9.3 WhatsApp-first sharing

- A ShareBar on every content page, WhatsApp first, with prefilled English and Tamil text (Appendix B).
- **Open Graph images:** P1 uses a branded default; P2 adds dynamic images per player, match and tournament (name, tournament, "Watch on Power Smash"). Generate them at build time or on demand with caching, and keep the host's per-deployment file-count limits in mind.

### 9.4 QR posters

The admin generates printable A4/A3 posters (print CSS or PDF) for each tournament — "Find your match videos — scan" — plus a generic channel poster. QR targets carry `utm_source=qr&utm_medium=venue&utm_campaign={tournament-slug}`.

### 9.5 YouTube → website loop

- **P2:** an admin **Description helper** for each synced video: copy-ready text linking to each player page and the tournament page (with `utm_source=youtube&utm_medium=description&utm_campaign={videoId}`), plus a suggested pinned comment.
- **P3 (optional):** write these links into YouTube descriptions automatically through OAuth, with a dry-run preview and owner approval per batch.

### 9.6 Profile links

Use consistent UTM conventions for the Instagram bio, the Facebook page button and the YouTube channel links. The website should become the **first** link on the YouTube channel.

### 9.7 Claim-your-profile loop

Players claim their profile → the data improves (district, academy, consented photo) → they share their page → more traffic and more claims.

### 9.8 Webmaster tools

Verify Google Search Console and Bing Webmaster Tools, submit the sitemaps, and monitor indexing and errors.

### 9.9 Engagement (P3)

Player of the Month fan vote (one vote per device per day, Turnstile-protected) and Rally of the Week.

---

## 10. Content engine: YouTube sync & title parser

### 10.1 Source

- YouTube Data API v3 with a server-side API key restricted to that API.
- Channel ID: `UCRhIwO47uhJIM5Iw4uybcFQ`. Uploads playlist: confirm through `channels.list → contentDetails.relatedPlaylists.uploads` (normally the channel ID with `UC` replaced by `UU`).
- The RSS feed `https://www.youtube.com/feeds/videos.xml?channel_id=UCRhIwO47uhJIM5Iw4uybcFQ` can serve as a cheap "anything new?" check.

### 10.2 API usage

`channels.list` (statistics, contentDetails) · `playlistItems.list` (uploads, 50 per page) · `videos.list` (snippet, contentDetails, statistics, liveStreamingDetails, status; 50 IDs per call). Avoid `search.list`, which is expensive in quota. Use ETags and exponential backoff, and log quota use per run.

### 10.3 Sync modes

| Mode | When | What |
|---|---|---|
| Backfill | Once, at setup | All uploads (~1.9K) |
| Incremental | Every 6 hours | Newest uploads, until already-known IDs are reached |
| Stats refresh | Daily for videos < 90 days old; weekly for all | Views, likes, live status — keeps stored API data fresh |
| Live check | On demand, cached ≤ 2 minutes | Feeds `/live` |
| Manual | Admin *Sync now* | Incremental sync + rebuild |
| Re-parse | After parser upgrades | Re-runs the parser on videos that were not manually edited |

### 10.4 Pipeline

fetch → upsert `videos` → classify (match / short / live / other) → parse the title (Appendix A) → resolve tournament and players → upsert `matches` and `match_participants` → flag `needs_review` when confidence is below 0.7 → if public content changed, trigger a debounced rebuild → record the run in `sync_runs` → alert the owner on Telegram if anything fails.

**Manual edits are sacred:** a field corrected in the admin is never overwritten by a later sync or re-parse.

### 10.5 Identity resolution

- Names are normalised (Appendix A.3), then matched exactly against `player_aliases`. An exact match means the same player.
- **Never auto-merge on fuzzy similarity.** Surface "possible duplicates" (for example, edit distance ≤ 2) in the admin instead.
- Admin tools: **Merge** (choose the canonical record; aliases and old slugs redirect) · **Split** (move selected matches to a new player) · **Rename** (the old name is kept as an alias).
- Same name, different people: split them and add a disambiguator (district or academy), shown in the UI and the slug.

### 10.6 Classification rules

- **Shorts:** the API has no Shorts flag. Treat videos of 180 seconds or less without a "vs" pattern as `short` (the admin can override). Shorts are excluded from match pages but may feed a Shorts rail.
- **Live:** when `liveStreamingDetails` is present → `live` (upcoming, active or completed).
- **International / broadcast content:** titles with country codes (`[IND]`, `(JPN)`) or known international events (BWF World Tour events, Olympics, World Championships and similar) → `is_international = true` → **hidden from the site by default**, with no player or tournament pages. This keeps the focus on Power Smash's own Tamil Nadu archive and avoids third-party broadcast-rights problems.

### 10.7 Visibility & takedowns

Every video, player and tournament has a `visibility` field (public/hidden). *Hide everywhere* is one click in the admin and triggers a rebuild. Hidden and deleted videos are purged from public data on the next sync.

### 10.8 Title convention for new uploads

Ask the owner to title future uploads like this:

```
A1/A2 vs B1/B2 || {Category} {Age group} {Round} - {Tournament} {Year}, {City}
e.g. S. KUMAR/R. VIJAY vs M. ARUN/K. RAJESH || MD Senior SF - Example District Championship 2026, Madurai
```

(Names and event are illustrative.) The admin offers a **Title check** tool that validates a planned title before upload.

---

## 11. Data model & data security

Postgres on Supabase. Every table has `created_at` and `updated_at`. Enum values are shown in square brackets; fields marked \* are private.

### 11.1 Content

| Table | Key columns |
|---|---|
| `videos` | `youtube_id` PK · `title_raw` · `description` · `published_at` · `duration_s` · `views` · `likes` · `thumbnail_url` · `type` [match, short, live, other] · `live_status` [none, upcoming, live, completed] · `is_international` · `parse_status` [parsed, needs_review, ignored] · `parser_version` · `parse_confidence` · `manual_override` (jsonb of locked fields) · `visibility` · `last_synced_at` · `etag` |
| `tournaments` | `id` · `slug` · `name` · `edition_year` · `level` [district, state, zonal, national, open, corporate, veterans, school_college, other] · `city` · `district` · `venue` · `start_date` · `end_date` · `organizer_name` · `organizer_phone`\* · `organizer_email`\* · `show_contact_public` · `categories` text[] · `entry_info` · `registration_url` · `poster_path` · `status` [pending, published, completed, cancelled, rejected] · `is_featured` · `featured_until` · `covered_by_power_smash` · `source` [parsed, submitted, admin] · `visibility` |
| `tournament_aliases` | `alias_normalized` PK · `tournament_id` |
| `players` | `id` · `slug` · `display_name` · `name_normalized` · `disambiguator` · `district` · `academy_id` · `is_junior` · `claimed` · `photo_path` (with consent only) · `bio` · `instagram_handle` · `noindex` · `visibility` · `merged_into` |
| `player_aliases` | `alias_normalized` PK · `player_id` |
| `matches` | `id` · `video_id` (unique) · `tournament_id` · `category` [MS, WS, MD, WD, XD, BS, GS, BD, GD, unknown] · `age_group` · `round` [R128, R64, R32, R16, QF, SF, F, 3P, league, group, unknown] · `format` [singles, doubles, unknown] · `played_on` |
| `match_participants` | `match_id` · `player_id` · `side` [A, B] · `position` — primary key (`match_id`, `player_id`) |
| `slug_redirects` | `from_path` PK · `to_path` |

### 11.2 Business

| Table | Key columns |
|---|---|
| `leads` | `id` · `ref_code` · `type` [coverage, sponsorship, player_product, featured_listing, academy_listing, general] · `status` [new, contacted, quoted, won, completed, lost] · `name`\* · `organization` · `phone`\* · `email`\* · `whatsapp_ok` · `payload` jsonb · `budget_range` · `value_paise` · `source_path` · `utm` jsonb · `follow_up_on` · `notes` · `lost_reason` |
| `products` | `id` · `key` · `audience` [organizer, player, sponsor, academy] · `name` · `description` · `inclusions` · `price_paise` · `price_type` [fixed, starting_from, quote] · `gst_inclusive` · `delivery_days` · `active` · `sort` |
| `orders` | `id` · `ref_code` · `lead_id` · `product_key` · `items` jsonb · `amount_paise` · `gst_paise` · `status` [pending_payment, paid, in_production, delivered, cancelled, refunded] · `provider` [razorpay, upi_manual, bank_transfer, cash] · `provider_ref` · `paid_at` · `delivery_url`\* · `delivered_at` · customer name, phone, email\* |
| `payment_events` | `id` · `provider` · `event_id` (unique — idempotency) · `event_type` · `payload` · `signature_ok` · `received_at` |
| `sponsors` | `id` · `name` · `website` · `logo_path` · contact fields\* · `notes` |
| `placements` | `id` · `sponsor_id` · `slot` · `creative_desktop_path` · `creative_mobile_path` · `alt` · `headline` · `target_url` · `go_slug` · `start_date` · `end_date` · `priority` · `label` · `status` |
| `placement_stats_daily` | `placement_id` · `date` · `impressions` · `clicks` |
| `academies` (P2) | `id` · `slug` · `name` · `district` · `address` · `coaches` jsonb · `photos` · `public_contact` (with consent) · `website` · `socials` · `is_featured` · `featured_until` · `status` |
| `gear_items` (P2) | `id` · `name` · `brand` · `category` · `image_path` · `affiliate_url` · `merchant` · `note` · `featured` · `sort` · `go_slug` |

### 11.3 Community & system

| Table | Key columns |
|---|---|
| `video_submissions` | `id` · `ref_code` · submitter fields\* · `role` · `link_url` · `storage_key` · match fields · `consents` jsonb (text versions + values) · `consent_at` · `ip_hash` · `status` [new, approved, uploaded, rejected] · `youtube_id` |
| `profile_requests` | `id` · `player_id` · `type` [claim, update, hide, remove] · requester name and contact\* · `relationship` [self, parent_guardian, coach, other] · `details` · `status` · `resolved_at` · `resolution_note` |
| `subscribers` | `id` · name, email, phone\* · `districts` · `interests` · `consent_at` · `consent_version` · `email_confirmed_at` · `unsubscribed_at` |
| `outbound_clicks` | `id` · `go_slug` · `target_type` · `target_id` · `page_path` · `utm` · `ua_hash` · `ts` (no raw IP) |
| `events` | `id` · `name` · `page_path` · `props` jsonb · `session_hash` (daily-salted) · `ts` |
| `site_settings` | `key` PK · `value` jsonb — contact details, social links, WhatsApp number, announcement bar, media-kit figures (with as-of date), GST settings, UPI details |
| `channel_stats` | `date` · `subscribers` · `views` · `videos` (daily snapshot for media-kit trends) |
| `sync_runs` | `id` · `mode` · `started_at` · `finished_at` · `status` · `counts` · `error` |
| `profiles` | `user_id` · `role` [owner, editor] |
| `audit_log` | `id` · `actor` · `action` · `entity` · `entity_id` · `diff` · `ts` |

### 11.4 Security rules

- **Row-Level Security on every table.**
- The public build reads only through **public views** (`public_players`, `public_matches`, `public_tournaments` and so on) that expose public columns of rows where `visibility = 'public'`. Private fields (\*) are never selected by the build.
- Forms submit to server endpoints that validate input (zod), verify Turnstile and rate-limit, then insert using the service role. No direct anonymous writes.
- The admin uses an authenticated Supabase session; RLS grants access by role (`owner`, `editor`). The owner account requires MFA.
- **CI guard:** scan the build output for phone numbers and email addresses, and fail the build if any appear other than the official contact details.

---

## 12. Technical architecture

### 12.1 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Astro** (latest stable), TypeScript in strict mode | Static-first HTML for thousands of SEO pages; minimal JavaScript; islands for interactivity |
| Styling & UI | **Tailwind CSS** + small **React** islands (search, filters, forms) | Fast to build, consistent tokens |
| Admin | **React SPA** at `/admin` (TanStack Query/Table, react-hook-form + zod) using Supabase Auth + RLS | Rich CRUD without a second app |
| Data, auth, storage | **Supabase** — Postgres, Auth with MFA, Storage for posters, logos and creatives | Managed Postgres; its dashboard doubles as an emergency admin |
| Hosting & edge | **Cloudflare** — static assets plus Workers for server endpoints (Astro Cloudflare adapter), DNS, Turnstile, Email Routing, Web Analytics, R2 (optional, for uploads and backups) | Fast in India, low cost |
| Jobs & CI/CD | **GitHub Actions** — CI, scheduled sync, backups, deploys | Transparent logs, free allowances |
| Search | **Pagefind** — static index built at deploy | Free, fast, no server |
| Payments | **Razorpay** — Dashboard Payment Links (P1); Checkout + Payment Links API + webhooks (P2) | UPI, cards, netbanking |
| Email | **Resend** or equivalent, with the domain authenticated (SPF/DKIM) | Transactional email |
| Owner alerts | **Telegram Bot API** | Free and instant; the owner already uses Telegram |
| Video embeds | Lite YouTube facade on the privacy-enhanced domain | Performance and privacy |
| OG images (P2) | Satori + resvg | Branded share images |
| QR codes | `qrcode` | Venue posters |
| Testing | Vitest, Playwright, axe-core, Lighthouse CI | Quality gates |

**Hosting rule:** this site sells services and carries sponsors and affiliate links, so it is a commercial site. Use only plans that permit commercial use — for example, Vercel's free Hobby plan is limited to personal, non-commercial projects. Confirm Cloudflare's current plan terms during setup.

### 12.2 Rendering & freshness

- **Prerender** every public content page at build time from the public views (~2K matches, several thousand players, hundreds of tournaments).
- **Server endpoints (Workers):** form submissions, `/go/*`, the impression beacon, live status, Razorpay webhooks (P2), and privileged admin actions (sync, rebuild, payment-link creation — each verifies the Supabase JWT and role).
- **Rebuilds:** after a sync that changed public content, and after admin publishes. Debounce them (at most one build per 10 minutes) and provide a *Publish now* button. The admin shows "Changes go live in about N minutes".
- Sponsor scheduling and live status are resolved client-side or at the edge, so they never wait for a rebuild.

### 12.3 Environments

Local (Supabase CLI) · Preview (per pull request) · Production. Seed data for local and preview uses fictional names; real data lives only in production.

### 12.4 Repository layout (proposed)

```
/
├─ CLAUDE.md · README.md · CHANGELOG.md · .env.example
├─ docs/               DECISIONS.md · OWNER_GUIDE.md · OWNER_TODO.md · RUNBOOK.md
├─ src/
│  ├─ pages/           public routes · api/ endpoints · admin/ shell
│  ├─ components/      ui/ · match/ · player/ · tournament/ · sponsor/ · forms/
│  ├─ layouts/
│  ├─ lib/             supabase · youtube · parser · seo · payments · notify · analytics
│  ├─ admin/           React SPA
│  └─ styles/          tokens.css
├─ scripts/            sync.ts · backfill.ts · reparse.ts · backup.ts · seed.ts
├─ supabase/           migrations/ · policies · seed.sql
├─ tests/              unit/ · e2e/ · fixtures/titles.json
└─ .github/workflows/  ci.yml · sync.yml · backup.yml · deploy.yml
```

### 12.5 Performance budgets (mobile, mid-range Android, 4G)

| Metric | Budget |
|---|---|
| Largest Contentful Paint | ≤ 2.5 s on the Home, Player, Match and Tournament templates |
| Cumulative Layout Shift | ≤ 0.1 |
| Interaction to Next Paint | ≤ 200 ms |
| JavaScript per public page | ≤ 80 KB gzip (the YouTube iframe loads only on tap) |
| Lighthouse (mobile) | Performance ≥ 90 · Accessibility ≥ 95 · Best Practices ≥ 95 · SEO ≥ 95 |

### 12.6 Cost plan

- **Launch:** domain + free tiers (Cloudflare, Supabase Free, GitHub Actions, an email free tier, Telegram).
- **Supabase Free caveats:** projects pause after about a week of inactivity (the 6-hourly sync should keep the project active — confirm how Supabase measures activity), and the free plan includes no automated backups — so the weekly backup job (§12.7) is mandatory.
- **Upgrade triggers:** move to Supabase Pro once revenue starts or the database nears its free limit; move to a paid Cloudflare Workers plan if request or script-size limits are hit. Keep CI minutes and build counts within free allowances (build on the host when that's cheaper).

### 12.7 Operations

- A weekly `pg_dump` backup through GitHub Actions to private storage (R2 or a private artifact store) with 8-week retention. The restore drill is documented in `RUNBOOK.md` and tested once before launch.
- Sync, webhook and build failures alert the owner on Telegram.
- An uptime check on the home page and the form endpoint.

---

## 13. Integrations & configuration

### 13.1 Environment variables (`.env.example`)

| Variable | Purpose |
|---|---|
| `PUBLIC_SITE_URL` | For example `https://powersmash.in` |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | Client access (RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server and CI only |
| `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID` | Sync (`UCRhIwO47uhJIM5Iw4uybcFQ`) |
| `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Form protection |
| `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_EMAIL` | Email |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Owner alerts |
| `PUBLIC_WHATSAPP_NUMBER` | `917373351087` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Payments (P2) |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Deploys |
| `REBUILD_HOOK_URL` (or a workflow-dispatch token) | Debounced rebuilds |
| `IP_HASH_SALT` | Privacy-preserving hashing |
| `R2_*` (optional) | Uploads and backups |

### 13.2 Seed values for `site_settings`

| Key | Value |
|---|---|
| YouTube | https://www.youtube.com/@PowerSmash |
| Channel membership (Join) | https://www.youtube.com/channel/UCRhIwO47uhJIM5Iw4uybcFQ/join |
| Instagram | https://www.instagram.com/power_smash_youtube/ |
| Facebook | https://www.facebook.com/Power-Smash-Tamil-Nadu-badminton-players-1877488702345552/ |
| WhatsApp | +91 73733 51087 (`https://wa.me/917373351087`) |
| Current email | powersmash1102@gmail.com — publicly replaced by `hello@{domain}`, forwarded with Cloudflare Email Routing |
| WhatsApp Channel | `TODO(owner)` |
| Legal name & address | `TODO(owner)` |

---

## 14. Admin console

Mobile-usable, fast and forgiving — confirmations on destructive actions, and undo wherever possible.

| Area | Capabilities |
|---|---|
| **Dashboard** | New leads, orders, pending reviews and submissions · revenue this month by stream · placements expiring within 14 days · top pages and searches · last sync status · *Sync now* · *Publish now* |
| **Inbox (leads)** | Kanban and table views · filters · lead timeline and notes · follow-up dates · quick actions: WhatsApp (prefilled), email, attach/create payment link, mark won/lost · CSV export |
| **Orders** (P2) | Status changes · delivery link · resend notification · receipts |
| **Videos** | Filters by parse status · **Needs review** queue showing the raw title beside the parsed fields · player chips with autocomplete/create · tournament select/create · category, age group, round · international toggle · visibility · bulk actions · re-parse |
| **Players** | Search · edit · junior flag · noindex · merge / split / rename · possible-duplicates queue · profile-requests queue with a response timer |
| **Tournaments** | Create and edit · approve or reject submissions · featured dates · coverage flag · coverage-sponsor slot · **QR poster generator** · share-text generator (English/Tamil) |
| **Sponsors & placements** | Sponsors, creatives and schedules · calendar view of slots · creative preview · monthly partner report (CSV in P1, branded PDF in P2) |
| **Products & pricing** | Prices, inclusions, delivery days, visibility · GST settings |
| **Submissions** | Video submissions queue · open link · approve · mark uploaded with the YouTube ID |
| **Gear, Academies** (P2) · **Stories** (P3) | Create, edit, archive |
| **Subscribers** | Segments by district and interest · CSV export |
| **YouTube helper** (P2) | Description and pinned-comment text per video · Title check |
| **Settings** | Contact details, social links, announcement bar, media-kit figures (with as-of date), UPI details, legal entity details |
| **Users & audit** | Owner/editor roles · MFA for the owner · audit-log viewer |

---

## 15. Legal, privacy & compliance

*Claude Code drafts these texts; the owner must have the final versions reviewed by a qualified professional. Nothing in this section is legal advice.*

### 15.1 Pages required at launch

Privacy Policy · Terms of Use · Cancellation & Refund Policy (with concrete timelines) · Delivery Policy (how and when digital deliverables and coverage services are delivered — this covers the gateway's "shipping policy" requirement for a services business) · Pricing · About · Contact (legal name, physical address, phone, email, grievance contact) · Disclosures (sponsorship and affiliate) · Content Removal & Takedown Policy.

### 15.2 Payment-gateway readiness

Razorpay activation asks for a live website with About, Contact, Pricing, Terms, Privacy, Cancellation/Refund and Shipping policy pages before live API keys are issued, while Payment Links created in the Razorpay Dashboard can be used before that. Phase 1 therefore uses Dashboard links, and Phase 2 integrates the API once the site is approved.

### 15.3 Junior players (under 18) — defaults

- A player is marked `is_junior` automatically when they appear in an under-age category (U-9 to U-19, or BS/GS/BD/GD), and stays junior until an admin changes it. This is conservative by design; the admin or a verified claim can lift it.
- **Shown:** name, categories, matches, tournaments. **Not shown:** photo, bio, social handles, partner/opponent analytics, and district/academy unless a parent or guardian provides them.
- No `Person` structured data for juniors. A per-player `noindex` is available and is applied automatically on a parent's request.
- Hide and removal requests from a parent or guardian: target action within 48 hours, verified by phone or WhatsApp.
- Claims for juniors come only through a parent or guardian. No marketing to minors; the alerts sign-up requires an 18+ confirmation.

### 15.4 Personal data

Design to the principles of India's Digital Personal Data Protection Act, 2023: a clear notice on every form, purpose-limited collection, explicit and unticked consent boxes, easy withdrawal and unsubscribe, deletion on request, retention limits (closed leads anonymised after 24 months; event documents deleted 30 days after the event), reasonable security safeguards, and a breach-response procedure in `RUNBOOK.md`.

### 15.5 Advertising disclosures

- **On the site:** every paid placement is labelled "Sponsored" or "Partner", with an affiliate disclosure on `/gear` and near affiliate links.
- **In videos and posts** (owner practice, captured in `OWNER_GUIDE.md`): disclose paid partnerships according to ASCI's influencer guidelines and the government's endorsement guidelines — inside the video itself, spoken and on screen, including during live streams — and tick YouTube's paid-promotion setting.

### 15.6 Copyright & content

- Video submissions require rights confirmations, stored with the text version and a timestamp.
- `/content-removal` explains how players, parents and rights holders request removal, with a target response within 48 hours.
- International and broadcast footage is excluded by default (§10.6). Sponsor and brand logos are used only with permission. Fonts and icons use open licences.

### 15.7 YouTube API Services

Follow the YouTube API Services Terms and Developer Policies: the privacy policy states that the site uses YouTube API Services and links to the YouTube Terms of Service and the Google Privacy Policy; the embedded player is never modified or obscured; stored API data is refreshed on schedule (§10.3); and data for deleted or private videos is purged.

### 15.8 Cookies

No third-party advertising or tracking cookies by default (Cloudflare Web Analytics is cookieless). If Google Analytics is added later, add a consent banner first.

### 15.9 Tax (owner action)

The admin supports sequential receipt numbering and GST settings. The owner should confirm GST registration and invoicing requirements with a chartered accountant.

---

## 16. Analytics & reporting

- **Pageviews:** Cloudflare Web Analytics (cookieless).
- **First-party events** (stored in `events`, no personal data): `search` (query, result count) · `whatsapp_click` (context) · `share_click` (channel, page type) · `form_start` / `form_submit` (form id) · `order_start` / `payment_success` · `outbound_click` (sponsor or gear) · `alerts_signup` · `profile_request`.
- **Admin analytics:** a funnel per form · top players and tournaments · zero-result searches (who people look for but can't find) · traffic by UTM source (QR vs YouTube description vs Instagram vs Facebook) · sponsor report data.
- **Monthly owner report** (P2; 1st of each month via Telegram and email): visits, enquiries, conversions, revenue by stream, top pages, sponsor performance.
- **Search Console** verified, with sitemaps submitted.

---

## 17. Roadmap & acceptance criteria

### Phase 0 — Setup (days 1–2)

Repository, `CLAUDE.md`, CI skeleton, environments, Supabase and Cloudflare projects, DNS for the owner's domain, design tokens, logo draft, parser fixtures.

### Phase 1 — Launch (target ≈ 2–3 weeks)

**Scope:** Home · Matches and match pages · Players and profiles · Tournaments and tournament pages · List your tournament · Services · Pricing · Book · Partner (with an uploaded media kit) · Send your video · Live · Support · Alerts (simple) · About · Contact · legal pages · `/go` redirects · YouTube backfill, 6-hourly sync, parser and review queue · admin (dashboard, inbox, videos, players, tournaments, placements, products & pricing, submissions, settings, users) · Telegram and email alerts · QR posters · sponsor placements with click and impression tracking · Pagefind search · SEO foundations · analytics · backups.

**Definition of Done**

1. The backfill completes; at least 90% of match-style titles parse without review on the real catalogue, and the rest appear in the review queue.
2. Player, match and tournament pages exist for all public parsed content; international content is hidden by default.
3. A new upload appears on the site within one sync-and-rebuild cycle; sync failures alert the owner.
4. Every Phase 1 form works end to end on a phone: Turnstile, validation, storage, owner alert, reference code, and a confirmation with a WhatsApp link.
5. From a phone, the owner can sign in with MFA, fix a parse, merge two players, approve a tournament, move a lead through its statuses, add a sponsor placement, edit prices and generate a QR poster.
6. Legal pages, `/pricing` and `/contact` with real details are live (gateway-ready), and no `TODO(owner)` remains on any public page.
7. Sitemaps and structured data validate, and Search Console is verified.
8. The performance and accessibility budgets (§12.5) pass on the key templates, and axe reports no serious violations.
9. The CI privacy scan passes (no private contact data in the build).
10. The weekly backup runs, and one restore has been tested.
11. `README.md`, `OWNER_GUIDE.md` (with screenshots), `RUNBOOK.md`, `DECISIONS.md`, `OWNER_TODO.md` and `CHANGELOG.md` are complete.

### Phase 2 — Monetization engine (target ≈ 3–4 weeks after launch)

**Scope:** Razorpay Checkout, Payment Links API, webhooks and receipts · player-product ordering (`/order`) · paid featured listings · automated partner reports and a generated media kit · `/gear` with affiliate tracking · academy directory · claim-your-profile flow · follow-a-player alerts · dynamic OG images · YouTube description helper · direct video upload (optional).

**Definition of Done:** test-mode payments pass end to end, including duplicate webhook deliveries; live mode is enabled after gateway approval; a partner report is generated from real data; affiliate and sponsor clicks are logged; claims are handled in the admin; WhatsApp link previews show the dynamic images.

### Phase 3 — Scale & community (ongoing)

Power Smash Open microsite with registration and payments · Tamil versions of key pages (`hreflang`) · Player of the Month vote · Stories/news · merchandise · optional YouTube description automation (OAuth, dry run, approval) · optional dark mode.

---

## 18. Testing & QA

- **Unit:** the title parser (Appendix A fixtures plus at least 50 real titles captured during the backfill, as snapshots), name normalisation, slugs, price and GST maths, webhook signature verification.
- **Integration:** sync against recorded API responses (no live API calls in CI); RLS tests (anonymous users cannot read private columns; editors cannot change roles).
- **End-to-end (Playwright, mobile viewport):** search → player → match; book coverage; list a tournament; send a video; admin login → approve a submission → publish.
- **Accessibility:** axe on the key templates, keyboard navigation, visible focus, labelled fields and clear error messages.
- **Performance:** Lighthouse CI against the §12.5 budgets.
- **Pre-launch content QA:** placeholders resolved, prices confirmed, policies reviewed, links checked.

---

## 19. Deliverables

- The production website on the owner's domain, with the admin console, scheduled jobs and backups.
- Source code in a private GitHub repository under the owner's account.
- Documentation: `README.md`, `CLAUDE.md`, `docs/OWNER_GUIDE.md` (plain English, covering every routine task), `docs/RUNBOOK.md` (sync failures, payment issues, takedowns, restore), `docs/DECISIONS.md`, `docs/OWNER_TODO.md`, `CHANGELOG.md`.
- Brand kit: logo SVGs, favicon set, default OG image, colour and type tokens.
- Printable QR poster templates.

---

## 20. Owner inputs checklist

| # | Input | Needed for | Phase |
|---|---|---|---|
| 1 | Domain chosen and purchased (for example `powersmash.in`) | DNS, email, launch | P0 |
| 2 | Accounts: GitHub, Cloudflare, Supabase | Code, hosting, data | P0 |
| 3 | YouTube Data API key (Claude Code provides step-by-step instructions) | Sync | P0 |
| 4 | Logo approval or existing logo files; tagline choice | Brand | P0 |
| 5 | Legal/business name, physical address, phone, email | Contact and legal pages, gateway | P1 |
| 6 | Service packages: inclusions, prices, delivery times, travel policy | Services, pricing | P1 |
| 7 | Cancellation and refund rules, with timelines | Policies | P1 |
| 8 | Sponsor packages and prices; real past partners and testimonials (with permission) | Partner page | P1 |
| 9 | YouTube Studio audience figures (locations, age, gender, monthly views) with the date | Media kit | P1 |
| 10 | Telegram account for alerts (bot set up with Claude Code's help) | Notifications | P1 |
| 11 | WhatsApp Channel link | Community | P1 |
| 12 | UPI ID or QR | Phase 1 payments | P1 |
| 13 | Own photos (venues, action, crowd) | Hero imagery | P1 |
| 14 | Priority players, districts and academies for review | Data quality | P1 |
| 15 | Razorpay account with KYC complete | Payments | P2 |
| 16 | Affiliate accounts and gear picks | Gear page | P2 |
| 17 | Power Smash Open plan (dates, venue, categories, fees) | Event | P3 |

---

## 21. Owner operating playbook

*Reference for the owner; Claude Code turns this into `docs/OWNER_GUIDE.md`.*

- **Every upload:** use the title convention (§10.8) → after the sync, clear the review queue (about 5 minutes) → paste the Description-helper text into YouTube → share the player pages on WhatsApp and Instagram, tagging the players.
- **Every tournament you film:** put up the QR poster, ask the organizer to announce the website, and offer a coverage quote for the next edition.
- **Daily:** reply to new leads within 24 hours (Telegram alerts) and clear follow-ups.
- **Weekly:** approve tournament and video submissions; post upcoming tournaments on the WhatsApp Channel.
- **Monthly:** send partner reports, update the media-kit figures, review prices, and check zero-result searches for missing players or tournaments.
- **Quarterly:** pitch new sponsors with the updated media kit and plan events.
- **Always:** label paid promotions and honour removal requests quickly.

---

## Appendix A — Title parsing specification

### A.1 Grammar

```
TITLE      := SIDE_A  VS  SIDE_B  [ SEP  META ]
VS         := "vs" | "vs." | "v/s" | "v" | "versus"      (case-insensitive, surrounded by spaces)
SEP        := "||" | "|" | "::" | " - "                  (first occurrence after SIDE_B)
SIDE       := PLAYER [ ("/" | "&" | "+" | " and ") PLAYER ]
PLAYER     := NAME [ SEED ] [ COUNTRY ] [ PAREN_HINT ]
SEED       := "(" digits ")" | "[" digits "]"
COUNTRY    := "[" A-Z{3} "]" | "(" A-Z{3} ")"            (validated against a 3-letter country-code list)
PAREN_HINT := "(" text ")"   → district if it matches a Tamil Nadu district, otherwise an affiliation hint
```

Strip hashtags (`#\w+`) and emojis before parsing.

### A.2 META tokens (order-independent)

| Kind | Accepted forms → canonical value |
|---|---|
| Category | `MS`, `Men's Singles` → MS · `WS`, `Women's Singles` → WS · `MD`, `Men's Doubles` → MD · `WD`, `Women's Doubles` → WD · `XD`, `MXD`, `Mixed Doubles` → XD · `BS`, `Boys Singles` → BS · `GS`, `Girls Singles` → GS · `BD`, `Boys Doubles` → BD · `GD`, `Girls Doubles` → GD |
| Age group | `U9`, `U-9`, `Under 9` … `U19` → `U9`…`U19` · `Senior` · `Open` · `35+`, `40+`, `45+`, `50+`, `55+`, `60+`, `Veterans`, `Masters` |
| Round | `Final`, `Finals`, `F` → F · `Semi Final`, `SemiFinal`, `Semis`, `SF` → SF · `Quarter Final`, `QuarterFinal`, `QuaterFinal` (a common misspelling), `QF` → QF · `Pre Quarter`, `PQF`, `R16` → R16 · `R32` · `R64` · `League` · `Group` · `3rd Place`, `Bronze` → 3P |
| Year | `19xx` / `20xx` |
| Location | a trailing `, {City}` or a known district name → location hint |
| Tournament | whatever remains, trimmed of separators, with spaces collapsed |

### A.3 Normalisation

- Unicode NFKC, trim, collapse whitespace, standardise punctuation.
- **Display name:** Title Case; initials stay upper-case with a dot and a space (`S.KARTHIK` → `S. Karthik`); Tamil-script names are preserved.
- **`name_normalized`:** lower-case ASCII, dots removed, single spaces (`S. Karthik` → `s karthik`).
- **Slug:** kebab-case of the display name; transliterate non-Latin scripts.
- **Never infer gender from names.** `format` comes only from player counts; `category` only from explicit tokens.

### A.4 Output

```ts
type Category = 'MS' | 'WS' | 'MD' | 'WD' | 'XD' | 'BS' | 'GS' | 'BD' | 'GD';
type Round = 'R128' | 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F' | '3P' | 'league' | 'group';

type ParsedPlayer = {
  raw: string;
  displayName: string;
  normalized: string;
  seed?: number;
  country?: string;
  districtHint?: string;
  affiliationHint?: string;
};

type ParsedTitle = {
  kind: 'match' | 'non_match';
  sideA: ParsedPlayer[];
  sideB: ParsedPlayer[];
  format: 'singles' | 'doubles' | 'unknown';
  category: Category | null;
  ageGroup: string | null;
  round: Round | null;
  year: number | null;
  tournamentName: string | null;
  locationHint: string | null;
  isInternational: boolean;
  confidence: number;   // 0..1 — below 0.7 goes to the review queue
  issues: string[];     // e.g. 'UNEVEN_SIDES', 'NO_TOURNAMENT', 'SHORT_NAME'
};
```

**Confidence:** start at 1.0 · −0.3 for uneven side sizes · −0.3 when no tournament is found · −0.2 when any player name is shorter than 2 characters · no VS token → `non_match`.

### A.5 Fixtures

Real titles visible on the channel. They appear truncated ("…") in the channel view — capture the full titles during the backfill and complete these fixtures.

| # | Input | Expected |
|---|---|---|
| 1 | `VELAVAN/BHARATH SANJAI vs GANESH/KUPPURAJ \|\| Open State Badminton …` | match · doubles · A: Velavan, Bharath Sanjai · B: Ganesh, Kuppuraj · category null · tournament "Open State Badminton …" · international false |
| 2 | `PRAKASH RAJ/KARNIKA vs SANTHOSH/JERLIN \|\| South India Level Badminton Tournament 2026 …` | match · doubles · A: Prakash Raj, Karnika · B: Santhosh, Jerlin · category **null** (do not infer mixed doubles from names) · year 2026 · tournament "South India Level Badminton Tournament 2026" |
| 3 | `LAKSHYA SEN (9) [IND] vs KOKI WATANABE (JPN) \|\| MS QuaterFinal - Singapore Open 2026` | match · singles · A: Lakshya Sen (seed 9, IND) · B: Koki Watanabe (JPN) · MS · QF · 2026 · tournament "Singapore Open 2026" · **international true → hidden** |

Add synthetic fixtures for: `vs` in different cases and `v/s`; `&` as the partner separator; initials such as `S.KARTHIK`; `U-13 BS Final`; `35+ MD SF`; a title with no separator; a compilation (`Best Rallies | District Championship 2026` → `non_match`); hashtags and emojis; extra spaces; Tamil-script names; misspelt rounds (`QuaterFinal`, `Semifinal`); singles with a district hint such as `(MADURAI)`.

---

## Appendix B — Copy deck

*English lines are final drafts. Tamil lines are drafts and must be reviewed by a native speaker before launch.*

| Placement | English | Tamil (draft) |
|---|---|---|
| Home H1 | Tamil Nadu badminton, on record. | தமிழ்நாட்டு பேட்மிண்டனின் இல்லம் *(means "Home of Tamil Nadu badminton")* |
| Home sub-line | {matches}+ matches. {players}+ players. Find yours, share it — and book Power Smash for your next tournament. | — |
| Tagline | Every player. Every match. Every smash. | ஒவ்வொரு வீரர். ஒவ்வொரு போட்டி. ஒவ்வொரு ஸ்மாஷ். |
| Search placeholder | Search a player or tournament… | வீரர் அல்லது போட்டியைத் தேடுங்கள்… |
| Primary CTA | Find your match | உங்கள் போட்டி வீடியோவைக் கண்டுபிடியுங்கள் |
| Booking CTA | Book coverage | கவரேஜ் புக் செய்யுங்கள் |
| Organizer hero | Your tournament deserves broadcast-quality coverage. | — |
| Listing CTA | List your tournament — free | — |
| Sponsor hero | Reach Tamil Nadu's badminton community — players, parents, coaches and organizers. | — |
| Player CTA | Get my highlight reel | — |
| Claim prompt | Is this you? Claim your profile. | — |
| Player share text | Watch all my badminton matches on Power Smash 🏸 {url} | என் அனைத்து பேட்மிண்டன் போட்டிகளையும் Power Smash-இல் பாருங்கள் 🏸 {url} |
| Form success | Thanks! Your reference is {ref}. We reply within 24 hours — or chat with us on WhatsApp now. | — |
| Placement label | Sponsored | — |

---

## Appendix C — Package & pricing templates

*Inclusions are suggestions. The owner sets the final inclusions and every price.*

### C.1 Tournament coverage (organizers)

| Package | Suggested inclusions | Price |
|---|---|---|
| **Essential** | Finals day · 1 camera · finals uploaded with player names · tournament page on the website | `TODO(owner)` |
| **Pro** | Semi-finals + finals · 2 cameras · highlights video · pamphlet promotion on all channels · featured listing | `TODO(owner)` |
| **Broadcast** | Live stream with scoreboard and sponsor overlays · multi-court recording · full uploads · highlights · venue QR posters | `TODO(owner)` |
| Add-ons | Extra match day · extra court · travel outside the home district | `TODO(owner)` |

### C.2 Player products

| Product | Description | Price |
|---|---|---|
| Highlight reel | A 2–3 minute edit from chosen matches | `TODO(owner)` |
| HD match file | Full match, downloadable | `TODO(owner)` |
| Season pack | All of a player's matches from one year | `TODO(owner)` |
| Custom edit | Coaching cut, trial showreel and similar | On quote |

### C.3 Promotion & listings

| Product | Description | Price |
|---|---|---|
| Tournament promotion | Pamphlet shared on YouTube community, Instagram, Facebook and the WhatsApp Channel, plus a featured listing until the event | `TODO(owner)` |
| Featured academy | Top of district results, badge, photos, WhatsApp button — per month | `TODO(owner)` |

### C.4 Sponsorship (monthly unless stated)

| Package | Suggested deliverables | Price |
|---|---|---|
| **Rally Partner** | Partner strip on the website · link in the descriptions of all uploads that month · weekly Instagram story | `TODO(owner)` |
| **Court Partner** | Rally Partner + banners on player and match pages + logo on uploads + monthly report | `TODO(owner)` |
| **Coverage Partner** (per tournament) | "Coverage presented by {brand}" in titles and overlays · venue banner · tournament-page banner · live-stream overlay | `TODO(owner)` |
| **Title Partner** (quarterly) | Everything above + priority placements + Power Smash Open naming rights (P3) | `TODO(owner)` |

All sponsored content is labelled as described in §15.5.

---

## Appendix D — Message templates

**Lead auto-reply (email)**
> **Subject:** We've got your request — {ref}
>
> Hi {name}, thanks for contacting Power Smash. We've received your {request type} and will reply within 24 hours. For anything urgent, WhatsApp us: {wa_link}. Reference: {ref}.

**Organizer follow-up (WhatsApp, prefilled from the admin)**
> Hi {name}, this is Power Smash. Thanks for your enquiry for {tournament} ({dates}). Could you confirm the number of courts and categories? We'll send your quote today. Ref {ref}.

**Payment link (WhatsApp or email)**
> Hi {name}, here's the payment link for {item}: {link}. Amount: ₹{amount}. Ref {ref}. Thank you!

**Sponsor outreach (sent personally by the owner)**
> Hi {name}, I run Power Smash — a Tamil Nadu badminton channel with {subscribers} subscribers and {matches}+ match videos watched by players, parents and coaches across the state. We're opening a few partner slots for {month}: your brand on our videos and website, with a monthly report of views and clicks. May I send you our media kit? — {owner}, {site}/partner

---

*End of specification.*

