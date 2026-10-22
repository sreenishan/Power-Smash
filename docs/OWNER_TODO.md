# OWNER_TODO - what you need to do, in order

Written in plain English for the Power Smash owner, who works from a phone. Updated 2026-10-22 (after the M2 and M3 build wave, and after you chose Vercel as the host: OT-02 is now the Vercel account; see decision D-097). Items use the same ids everywhere (`OT-01` and so on). Every row of section 20 of the spec is covered; each item says which row.

---

## Questions waiting for you right now (after the M2 build)

**Already answered on 2026-10-22, nothing more to do:** the PostgreSQL download (yes, done), the Playwright browsers (yes, done), people whose age is unknown (a minimal page that Google is told not to list), and events outside Tamil Nadu (listed, with no player pages).

Answer in chat with a plain "yes" or "no" (or a change); several in one message is fine, for example "1 yes. 2 no. 3 yes." Nothing here costs money unless it says so. Where a question has a safe default that is already switched on, "no answer" is the same as "no". Most important first.

**1. Send YouTube your written question, and ask the lawyer the children's-data question. Please do both first: they can take weeks (OT-16, OT-15, OT-28).** These are the two slowest things in the project and only other people can answer them. The YouTube question is already written (`docs/YOUTUBE_POLICY_QUERY_DRAFT.md`, Part B; steps in OT-16). The lawyer question is how we must treat players under 18 and players whose age is unknown (OT-28). The build does not wait, but the public archive cannot open (G2) until both are answered. *If you wait:* nothing breaks today; the archive launch moves later by exactly as long as you wait.

**2. Your name and email for code changes (OT-01, D-038).** Every saved change carries a name and an email. Tell me the name to show and the email (the safest is GitHub's "noreply" address: GitHub, Settings, Emails). *If you say no or do nothing:* I cannot make the first save (a commit), so nothing goes to GitHub, no automatic checks run, and the work exists only on this PC. I never save or upload without your yes.

**3. Supabase, in this order: the development project (OT-03), then the production project (OT-27).** Supabase is the database. The database files were run successfully on a PC copy of PostgreSQL on 2026-10-22, but never on Supabase itself, so the next real test needs the `powersmash-dev` project (made-up data only). Exact steps are in OT-03 (phone and PC) and OT-27; you only ever send me the "project reference" (a short code, not a secret). *If you say no or wait:* the archive, the admin and the enquiry database stay on made-up local data and nothing can be tried for real.

**4. The YouTube API key (OT-04).** It lets the site read your public video list. Free. The steps are unchanged in OT-04; you enter the key yourself and never send it to me. *If you wait:* your video catalogue cannot be loaded, so the archive shows made-up sample data only.

**5. Do you want an extra front door on the admin page? (OT-49).** Today the admin page asks for your email, password and a code from your authenticator app. An extra front door would make a stranger unable to even see the sign-in box. With the move to Vercel the two options are: Cloudflare Access (needs your domain on Cloudflare; its free terms are **not verified**) or Vercel Password Protection (an add-on of USD 20 a month per project on the Pro plan, from Vercel's own page). My recommendation: **no extra door for launch**; the password plus the two-step code is already strong. *If you say no:* nothing changes; the sign-in box is just visible to anyone who finds the address.

**6. Admin sign-in setup: steps only you can do (OT-51).** After the production Supabase project exists, you create your admin user, set up two authenticator codes (your phone plus a second device) and then switch off new-code enrolment in Supabase. Steps are in OT-51; I tell you when. *If you skip it:* the admin console cannot be used for real.

**7. Should removed pages say exactly "gone" (a true 410), using a small extra server route? (optional; OT-50).** When a video, player or event is taken down, the old address should ideally tell Google "this is gone for good". A static site cannot say that; it can only send visitors on to a neutral "no longer available" page, which is what is built now and which works and hides the name. A small server route that looks up the removed address could answer "gone" properly (Vercel's redirect rules cannot send 410), at the price of one more moving part. My recommendation: skip it at first. *If you say no:* removed addresses go to the neutral page.

**8. Events whose place cannot be worked out from the title.** Today these are listed with the video only and get no player pages (the safe default; you did not have to choose). Do you want that to stay? *If you say no:* tell me the alternative (for example "treat them as Tamil Nadu"); I would still ask you to check them one by one (OT-35).

**9. The key for automatic updates, `REBUILD_DISPATCH_TOKEN` (OT-42).** One narrow GitHub key that lets the site's server say "rebuild the site" when a new video appears and lets the admin's Publish button work. I ask at the right moment; steps are in OT-42; you enter it on the Vercel screen yourself. (the admin's Publish button keeps using it; the parked cron route would too) *If you wait:* the site still rebuilds on its schedule, but new videos take hours to appear and the Publish button does nothing.

**10. The two switches that start the automatic jobs (OT-48).** Nothing runs until you set them, and I name each one when its time comes.
- `SYNC_ENABLED` = `true` starts the job that reads your YouTube channel every 6 hours and updates the archive data. It needs OT-03, OT-04 and the YouTube answer from question 1 first.
- `BACKUP_ENABLED` = `true` starts the weekly encrypted copy of your database. It needs OT-27, OT-31 and OT-43 first.

*If you never switch them on:* the archive never refreshes and there are no backups; both are needed before launch.

**11. May I install an image-converter for PNG icons and share pictures? (name not chosen yet; OT-23, D-041)** WhatsApp and others do not show SVG share pictures. Before I ask for your yes I name the tool, its size and its licence. *If you say no:* links shared on WhatsApp show no picture and there are no PNG app icons.

**12. May I download the gitleaks program for local secret checks?** It checks the code on this PC for passwords and keys before each save. A copy also runs on GitHub. *If you say no:* only the GitHub check runs; it still works but catches a leaked key after upload (replacing a key takes minutes).

**13. Should the Telegram alert show the customer's phone number? (default NO; the lawyer must agree first)** Today the alert holds only the kind of enquiry, a reference code, the first name or initial, the page used, and a pointer to open it in Supabase Studio. A one-tap reply link would put the phone number on Telegram's servers, so the lawyer must update the privacy page first (OT-15). Recommendation: leave it off at launch. *If you say no or do nothing:* alerts stay bare and you read the number in Supabase Studio (the admin console will make this easier once it is live, question 6).

**14. May I add a private preview address so you can review unfinished pages on your phone? (OT-47)** The real publish job refuses while any page shows a gap marker "TODO(owner)". A separate button you press yourself would publish unfinished pages to a private Vercel test address only, with made-up data and a "do not list" tag. Vercel puts a sign-in in front of it (Vercel Authentication, free on every plan per Vercel's docs), so only people you invite to your Vercel team can open it. It needs OT-02 first. *If you say no:* you review through my screenshots, and the first time you see the live site on your phone is at the end.

**20. May the live site run on Vercel Pro (USD 20 a month)? (OT-02, D-097).** Vercel's terms say the free Hobby plan is for personal, non-commercial use only. Power Smash advertises paid services and sponsor slots, so the live site needs the Pro plan, USD 20 a month for one seat (Vercel's pricing page, read 2026-10-22; the exact included usage credit is not verified). **You buy it yourself in the Vercel dashboard, shortly before the public launch (G1); I never buy it and never type a card.** Until then the private preview may use the free Hobby plan. *If you say no:* the site cannot go live on Vercel; we would have to choose another host (decision D-097 would be reopened).

**15. Which uptime monitor? I recommend HetrixTools (free). Read the catch (OT-44, D-039).** It sends alerts to both Telegram and email on the free plan; the others do not. The catch: log in at least every 90 days or the free account is marked inactive, so set a 60-day phone reminder. The health check must look for the exact text `"lead":"ready"` (straight quotes; I give you the line to copy). The comparison is in `docs/UPTIME_MONITOR_OPTIONS.md`. *If you say no:* choose another (UptimeRobot with email and phone-app alerts is the fallback) or "use the stop-gap" (a weaker check from our own system). No hurry: monitors need the live address first.

**16. May the confirmation screen promise a reply time? If yes, what time? (OT-30)** Today it says "We will get back to you as soon as we can." with no time. Give a time you can really keep, or "no promise". *If you say no:* nothing changes.

**17. When do you send payment details? (OT-20)** (a) with the quote; (b) after the customer accepts the quote; (c) a Razorpay Payment Link on WhatsApp (needs OT-06). Say it in your own words. *If you do not answer:* the pricing page says nothing about when payment is asked for.

**18. Sponsor package inclusions: approve or change (OT-22).** "Banners on player and match pages" and "Power Smash Open naming rights" are held back (not built yet; YouTube's rules limit where sponsor slots go). Tell me yes or what to add, remove or reword. *If you wait:* the Partner page keeps its gap marker, which blocks the strict publish (G1).

**19. Look at the logo and taglines (OT-23).** Open `docs/brand-preview.html` on the PC. Tell me yes or what to change, and which tagline you want. *If you wait:* G1 cannot happen and the footer tagline stays hidden.

---

## What you can look at now

You cannot open the Power Smash site from a public address yet. That needs your Vercel account and project (OT-02), a real publish step (the one in the GitHub deploy file is still being rewritten for Vercel), and either every gap filled or your yes to the private preview (question 14). The publish job also stays off until I tell you to switch it on (OT-48).

What exists today and what you can see:

1. **The logo and tagline page.** At the PC, double-click `docs/brand-preview.html` (question 19).
2. **QR poster pages.** A printable A4 and A3 poster with a QR code for every tournament in the sample data. They show made-up tournaments, and the QR code is replaced by a gap marker until the real web address is set, so do not print them yet.
3. **The admin console, on made-up data.** The review screens (title check, players, matches, tournaments, duplicates, removals, sponsor slots) built on fictional data with names like "Demo" and "Sample", never real players. It is not connected to a real database or a real sign-in yet.
4. **The archive pages, on made-up data.** Match list, match pages, player directory and search, each with a "Sample data" banner. The strict publish job refuses while that banner is there, on purpose.
5. **Screenshots and a local copy from me.** I send phone-size screenshots of any page in chat, or start a copy on this PC (the address begins `http://localhost`; only this PC can open it).

What you cannot see until the site is deployed (OT-02 and the steps above): the site on your phone from the internet, your real WhatsApp button (it needs your number as a build setting), forms that really send (they need OT-41 and OT-03), real match pages from your YouTube catalogue, the real admin sign-in, and anything on your own domain (OT-07).

---

## READ THIS FIRST: where secrets go

**Never paste a password, API key, token, card number, OTP, PAN or Aadhaar number into our chat, into a screenshot you send me, or into any email or WhatsApp message.** Chat is saved. If you ever paste one by mistake, tell me straight away and we will replace it. Replacing a key takes minutes; a leaked one can empty your accounts.

**I never see a secret, and I never type one for you.** My own safety rules forbid me from entering, reading or copying passwords, API keys or tokens, even if you offer. So you enter every secret yourself, and I only tell you the exact name and which screen to use. (Earlier drafts of this plan said I would load secrets for you "without printing them". That is no longer the plan.)

Where secrets go instead:

1. **Type them straight into the website they belong to**, on the secret or settings screen of GitHub, Vercel, Cloudflare (for Turnstile only) or Supabase. You can do this from your phone. I will tell you the exact name to give each secret (for example `YOUTUBE_API_KEY`). Two screens come up again and again:
   - **GitHub secret:** open the `power-smash` repository, then Settings, then Secrets and variables, then Actions, then the Secrets tab, then New repository secret. Type the name in the Name box and paste the value in the Secret box, then Add secret.
   - **Vercel environment variable** (once the Vercel project exists, OT-02, and I tell you): Vercel dashboard, open the `power-smash` project, **Settings**, **Environment Variables**, **Add**. Type the name, paste the value, tick only the scope I name (**Production**, **Preview** or both; never **Development** unless I say), and where Vercel offers a **Sensitive** toggle turn it on for secrets so the value is hidden after saving (Vercel docs: secret-type values are write-only after save). Save. **A new value applies only to deployments made after you save it**, so I will tell you when to redeploy.
   - Screen names change now and then. If a screen looks different from what I describe, tell me what you see (never the secret itself).
2. **Or, at the PC, with a small loader.** You put your secrets in a small file called `.secrets.local` inside the project folder. That file is never uploaded anywhere. I write a loader program (it does not exist yet) and give you the one line to type; **you run it yourself** at the PC, and it copies each value to the right place without showing it. I never open `.secrets.local`, never run the loader, and never ask you to show me its contents. When it has finished, you delete the file. The loader is explained in `docs/SECRETS.md`.
3. **Your password manager or paper** holds everything else (recovery codes, the backup key). Do not keep recovery codes in your notes app.

When I ask for "the project reference" or "the account ID", those are not secrets: they are short labels and are safe to send.

How approvals work: I never spend money, publish, message anyone or change your accounts without a clear "yes" from you in chat. Money items show the exact amount first.

Tags used below: **[PHONE]** you can do it from your phone; **[PC]** needs the computer once; **[CA]** needs a chartered accountant; **[LAWYER]** needs a lawyer; **[FREE]** no cost; prices are only quoted where a source verified them on 2026-10-20 and they can change, so always check the total at checkout.

---

## The two short lists to read first

**Blocks M1 START** (I do not start the money-page build, milestone M1, until these two are done):

| ID | Item | Why it blocks |
|---|---|---|
| OT-30 | Approve the plan decisions and spend rules | Several decisions are marked "proposed". I will not treat them as settled without your yes. |
| OT-14 | Lock down your accounts | The business Google account and two-step verification protect every account and key used from here on. It is also the very first item in Part A. |

**START NOW - long lead time** (the build does not wait for these, but how soon you earn does; each one is slow because someone else sets the pace):

| ID | Item | Why it is slow |
|---|---|---|
| OT-05 | Decide who receives the money, with a CA | You need an accountant's appointment, and Razorpay, the domain and the invoices all depend on the answer. |
| OT-06 | Razorpay account and KYC | Razorpay publishes no approval time; its bank partner decides. |
| OT-07 | Buy powersmash.in and finish .IN KYC | A .IN domain is switched off if the government-ID check is not finished, and email waits for it. |
| OT-15 | Find a lawyer | No price or timing is known; the legal pages cannot go public without a review. |
| OT-16 | Send YouTube a written question | Only YouTube can answer, and it sets its own pace. |

**How long the build takes, in plain English.** About 40 working days of build, or 52 with a 30% cushion for surprises. That is roughly 10 to 11 weeks counted from Monday 26 October 2026, weekdays only, with holidays not counted, so the cushioned end falls around 5 January 2027. The money pages (services, pricing, booking, partner, contact) can be READY about ten working days after the Part A inputs arrive. But the public go-live, called **G1**, also needs four things that are not mine to build: your legal pages reviewed by a lawyer, a verified domain, real prices (or your approved "on quote" wording), and a Razorpay Payment Link tested for a small real amount. If any of those is late, G1 waits for it. The earlier you start the START NOW list, the less G1 waits.

**Before G1 (the public money-page go-live) you must have finished:** OT-05 and OT-06 (so the Payment Link test can happen), OT-07 (the domain shows "verified") and then OT-40 (Resend, the email sender), OT-08 (Telegram bot), OT-12 (Studio figures), OT-13 (prices, or your approval of "on quote"), OT-15 (lawyer reviews the legal pages), OT-19, OT-20, OT-21, OT-22 (packages), OT-23 (logo), OT-27 (production database), OT-31 (backup key), OT-41 (production Turnstile keys), OT-43 (backup connection), OT-44 (uptime monitor, with its alert drill) and OT-48 (the GitHub switches). Also needed, with no OT of their own: the Open Graph PNG and app icons (question 4; link previews on WhatsApp show no picture without them), and a tagline chosen (question 12). **Not needed for G1:** OT-09 (Channel link), OT-25 (photos), OT-32 (Tamil review), OT-45 (Web Analytics), OT-46 (sponsor-link rule) and OT-47 (private preview). Until you supply those, the page sections that need them are hidden automatically, and they appear on the next build after you send the input. No page ever shows a "to do" note to visitors.

**The steps that wait for the domain to show "verified" (OT-07), in this order:** switch the site to your real web address; set up email forwarding for `hello@` and the grievance address; OT-40 Resend; then the customer confirmation email and the email alert channel are switched on; and Razorpay's website review (OT-06). Until the domain is verified, enquiries alert you on Telegram and the customer sees a WhatsApp link on the confirmation screen.

## The order, at a glance

**Part A - do these first. They block the next build step (M0). About one sitting.** OT-14 comes first because it creates the business Google account and the two-step verification that OT-01 to OT-04 use.

| Order | ID | Item | Spec section 20 row | Cost | Blocks |
|---|---|---|---|---|---|
| 1 | OT-14 | Lock down your accounts | - | free | the start of M0 in practice (OT-01 to OT-04 use the business Google account and two-step verification it sets up), and M1 start |
| 2 | OT-01 | GitHub account, private repository, commit name and email | 2 | free | M0 |
| 3 | OT-02 | Vercel account and project (Hobby is free for the private preview; Pro, USD 20 a month, before launch) | 2 | free now; Pro at G1 | the real test deploy, the private preview and the Lighthouse speed check; the local checks are done and passed |
| 4 | OT-03 | Supabase account and the development project | 2 | free | M0 database step |
| 5 | OT-04 | YouTube Data API key | 3 | free | M0 title profiling |

**Questions waiting for you right now** (twenty, most important first) are at the top of this file, each with what happens if you say no. Right after them is "What you can look at now", which explains why you cannot open the site on your phone yet. The local checks did not wait for any of these: the Windows 10 test passed on 2026-10-21 (`docs/G0_RESULT.md`).

**Part B - start this week. They take a long time to come back, so start them even though the build does not wait for them. They decide how soon you earn.**

| Order | ID | Item | Row | Cost | Blocks |
|---|---|---|---|---|---|
| 6 | OT-05 | Decide who receives the money, with a CA | 5, 12, 15 | CA fee unknown | Razorpay, domain, M3 payment fields |
| 7 | OT-06 | Razorpay account and KYC | 15 | see item | first online payment |
| 8 | OT-07 | Buy powersmash.in and finish .IN KYC | 1 | see item | custom domain, email, Razorpay website review |
| 9 | OT-08 | Telegram bot for alerts | 10 | free | M1 alert testing |
| 10 | OT-09 | WhatsApp Business app and WhatsApp Channel | 11 | check store | only the display of the Channel button and link (hidden until you send the link); not G1 |
| 11 | OT-10 | Standard block in YouTube descriptions | - | free | nothing; starts traffic |
| 12 | OT-11 | List the next 90 days of tournaments and your prospects | - | free | nothing; it is your revenue engine |
| 13 | OT-12 | YouTube Studio audience figures | 9 | free | M1 go-live (partner page) |
| 14 | OT-13 | Price worksheet and ten conversations | 6, 8 | free | M1 go-live |
| 15 | OT-15 | Find a lawyer | - | unknown | G1, G2, M4 |
| 16 | OT-16 | Send YouTube a written question | - | free | public archive launch |
| 17 | OT-17 | Gather organizer permissions for events you already filmed | - | free | M3 data, lawyer opinion |
| 18 | OT-18 | Schedule a test live stream | - | free | nothing |

**Part C - can wait. Needed before launch, or later.** The rows are in a sensible order to do them: the ones that start M1 or block G1 first, then the rest. OT-40 to OT-44 are the account and key steps for email, spam protection, deploy trigger, backup and uptime monitoring. OT-45 to OT-48 were added after M1: the analytics token, the sponsor-link rule, the private preview address and the GitHub switches.

| ID | Item | Row | Blocks |
|---|---|---|---|
| OT-30 | Approve the plan decisions and spend rules | - | M1 START (see the short list at the top) |
| OT-19 | Legal name, address, phone, email, grievance contact | 5 | G1 (cannot be hidden: the pages are not honest without them) |
| OT-20 | Service packages, prices, delivery times, travel policy | 6 | G1 |
| OT-21 | Cancellation and refund rules with timelines | 7 | G1 |
| OT-22 | Sponsor packages, real partners, testimonials | 8 | G1 for the packages; partner logos and testimonials stay hidden until you supply them |
| OT-23 | Logo approval and tagline | 4 | G1 |
| OT-24 | UPI ID or QR, after a bank check | 12 | G1 (small payments only; no QR until the bank and CA agree, D-035 row 16) |
| OT-27 | The production Supabase project | 2 | M1 go-live, M2 backfill |
| OT-31 | Backup key custody and a takedown deputy | - | G1 (before the first real lead, because backups start then) |
| OT-43 | Supabase backup connection (new) | - | G1 (the weekly backup starts with the first real lead; needs OT-27) |
| OT-41 | Cloudflare Turnstile widget for the production forms (new) | - | G1 (production forms); Cloudflare's published test keys are used until then |
| OT-44 | Uptime monitor sign-up (new) | - | G1 (M1 go-live) |
| OT-40 | Resend account, domain records and API key (new) | - | the customer confirmation email and production sign-in mail; needs OT-07 verified first; it is one of the domain-dependent steps in the G1 list |
| OT-42 | GitHub deploy-trigger token (new) | - | M2a (sync-triggered deploys, Publish now) |
| OT-25 | Your own photos | 13 | only the display of your photos (the brand pattern shows until then); not G1 |
| OT-32 | Native Tamil review | - | only the display of Tamil lines (English only until then); not G1 |
| OT-26 | Priority players, districts and academies | 14 | M2 |
| OT-28 | Decide the children's-names policy | - | G2 |
| OT-29 | Decide what to show of non-Tamil-Nadu events | - | M2 default |
| OT-33 | How you reply from hello@ | - | nothing |
| OT-34 | E-commerce rules checklist | - | by 1 Jan 2027 |
| OT-35 | Check sample title labels on your phone | - | M2 |
| OT-36 | After launch: Search Console and Bing | 9.8 | DoD 7 |
| OT-37 | Phase 2: affiliate accounts and gear picks | 16 | Phase 2 |
| OT-38 | Phase 3: Power Smash Open plan | 17 | Phase 3 |
| OT-39 | Only if the Windows 10 test fails (it passed on 2026-10-21: nothing to do) | - | M0 fallback, not needed |
| OT-45 | Cloudflare Web Analytics site and its public token (new) | - | nothing (page counts only); not G1 |
| OT-46 | Cloudflare rate-limit rule on sponsor links (new) | - | the first sponsor link going live (M3); not G1 |
| OT-47 | A private preview address for unfinished pages (new) | - | nothing; it lets you look early (question 7) |
| OT-48 | GitHub switches for publishing and backups (new) | - | G1 (publishing) and the first real backup |
| OT-49 | Cloudflare Access in front of the admin page (new) | - | nothing; recommended before real admin use |
| OT-50 | True "gone" pages with a small server route (new, optional) | - | nothing |
| OT-51 | Set up your admin sign-in (new) | - | real use of the admin console; needs OT-27 |

Costs mentioned are the verified ones; where no price is verified I say so and you set the budget. I never set prices for your services.

---

# PART A - DO THESE FIRST

## OT-14 Lock down your accounts [PHONE] [FREE]

**What and why.** One stolen Gmail or phone could take your channel, domain, payments and website. This is the **first blocker**: it creates the one business Google account, and the two-step verification, that OT-01 to OT-04 all use, so do it before anything else. It also has to be finished before M1 starts.

**Steps.**
1. Use one business Google account (separate from your personal one) for the channel and for every service in this list. If you do not have one yet, create it now.
2. Turn on two-step verification, or a passkey, on that Google account now (in your Google account, under Security).
3. Turn on two-step verification on Telegram too (Telegram, Settings, Privacy and Security, Two-Step Verification). If the screen looks different, tell me what you see.
4. From here on, the minute you create each new account (GitHub, Cloudflare, Supabase, and later your domain registrar with its "registrar lock", Razorpay, Resend), turn on two-step verification straight away. Each item below reminds you.
5. Write the recovery codes on paper and keep them somewhere safe. Not in chat, not in notes.
6. Add a second device or a trusted second person who can help you recover an account.
7. Later I add a footer line saying payment links only come from official sources.

**Cost.** Free.  **Blocks.** The start of M0 in practice (the next four items use the account and two-step verification from this one), and the start of M1.  **Order.** 1 (first).

## OT-01 GitHub account, private repository, commit name and email (spec row 2) [PHONE] [PC] [FREE]

**What and why.** GitHub holds the code, runs the automatic checks, the video sync and the weekly backup, and publishes the site. The repository must be **private**: the test files contain real players' names from your video titles, and a public repository switches off its own scheduled jobs after 60 days without activity. Keep it under your **personal** GitHub account, not an organisation (the free secret check, gitleaks, needs no licence key on a personal account; an organisation would need a free key).

**Important: do NOT make the repository public to get GitHub's secret scanning.** An earlier version of the plan said GitHub's "secret scanning" and "push protection" would be switched on for this repository. That was wrong. GitHub's own documentation (checked 2026-10-21, https://docs.github.com/en/code-security/getting-started/github-security-features) says those two features are free only for public repositories; on a private repository they need GitHub's paid product, called Secret Protection. Making the repository public to get them would publish real players' names (some possibly under 18), so we never do that, and I will not pay for Secret Protection without your yes and an exact price.

**What protects the repository instead** (free):
1. **Secret files are never saved.** The ignore list (`.gitignore`) keeps files such as `.env`, `.dev.vars` and `.secrets.local` out of the code, and it is the very first thing we save.
2. **gitleaks on GitHub.** A free program that looks for passwords and keys in every upload and every proposed change. It runs automatically. It needs no key or sign-up because the repository is on your personal account.
3. **gitleaks on this PC (optional, needs your yes).** A check that runs just before each save and stops a leaked key leaving the PC. Its download needs your approval (question 5 at the top of this file); until you say yes, only the GitHub check runs.
4. **A scan of the finished website** before it is published, which fails the build if anything that looks like a secret is in it (this arrives with milestone M1).
5. **You** never type a secret into chat or a code file (see "READ THIS FIRST").

**Steps.**
1. On your phone browser go to github.com and sign up with the business Google account from OT-14 (or log in if you have an account). Turn on two-step verification and save the recovery codes on paper.
2. Create a new repository named `power-smash`. Choose **Private**. Do not add any files.
3. In GitHub Settings, Emails, tick "Keep my email addresses private" and note the "noreply" address GitHub shows. That address is safe to use for commits.
4. Tell me in chat: your GitHub username, the repository name, the name you want shown on code changes, and the email to use (the noreply address from step 3 is a good choice). This is question 1 at the top of this file.
5. Once, at the PC: you sign in to GitHub yourself. I give you the one line to type; a GitHub page opens in your browser and you approve it there, following the on-screen steps. Your password and any one-time code are typed only by you and never go into chat; I never type them for you.
6. I never save (commit) or upload (push) anything without your yes. The first save contains only the ignore list.

**Cost.** Free.  **Blocks.** M0 (repository and automatic checks).  **Order.** 2.

## OT-02 Vercel account and project (spec row 2; replaces the Cloudflare account) [PHONE] [PC] [FREE to start; Pro USD 20 a month before launch]

**What and why.** You chose Vercel to host the website and its small server functions (decision D-097). Vercel's free **Hobby** plan is only for personal, non-commercial use (its terms), so it is fine for a **private preview** but not for the live site, which advertises paid services: for launch you need the **Pro** plan (USD 20 a month, Vercel's pricing page, read 2026-10-22). **You buy Pro yourself; I never buy it and never enter a card.** Cloudflare is still used for the free spam check (Turnstile, OT-41), the optional page counter (OT-45) and, if you choose, email forwarding and DNS. You do not need a Cloudflare account just to publish.

**Timing.** Any time now. Needed for the first real publish, the private preview and the Lighthouse speed check. The local checks already passed (2026-10-21, `docs/G0_RESULT.md`) and needed no accounts.

**Steps (Part 1: the free account and the project).**
1. Sign up at vercel.com and choose **Continue with GitHub**, using the GitHub account from OT-01. Pick the **Hobby** plan when asked. Turn on two-step verification on GitHub first (OT-14); your Vercel login follows it. **Do not add a card yet.**
2. Vercel asks which repositories it may see. Allow **only the `power-smash` repository** (not "All repositories"). This is an OAuth permission: I will not tap it for you.
3. Tap **Add New**, then **Project**, find `power-smash`, tap **Import**. (The repository must already be on GitHub, OT-01.)
4. On the import screen: **Framework Preset** should say **Astro** (if it does not, pick Astro). Leave the commands as they are: the real build is made by GitHub's machines (see step 7), not by Vercel. **Do not tap Deploy** on this screen. If Vercel starts a build by itself, it is harmless but not needed; we turn that off in the next step.
5. Open the project's **Settings**:
   - **General**, **Node.js Version**: choose **24.x** (Vercel supports 24.x and 22.x; the project's `package.json` also names it).
   - **Functions**, **Function Region**: choose **Mumbai, India (bom1)** so the site's server code runs next to the Supabase database in Mumbai. Vercel's default for new projects is the US (iad1), so this change matters. On Hobby only one region can be chosen; that is fine.
   - **Deployment Protection**: Vercel says the **Vercel Authentication** option is on all plans. Make sure **Standard Protection** (or **All Deployments**) is switched on with **Vercel Authentication**, so only you (and people you invite) can open preview addresses. Production, once you launch, stays public. Whether new projects start with this on is not verified: look at the screen and tell me what it shows.
   - **Git**: this is important. Our plan is that **only the GitHub deploy job publishes the live site** (it builds with the strict checks and uploads the finished result), so Vercel's own automatic deploys must be off. Open **Settings**, **Git**, and **Disconnect** the repository. If you prefer to keep it connected, set **Ignored Build Step** to the command `exit 0` instead. Tell me which you did. (This is from our deploy notes, `docs/m3/vercel-deploy-notes.md`; the exact Vercel screen wording is not verified.)
6. **Environment variables** (Settings, **Environment Variables**): these are the settings the site's server code reads while it runs (the Supabase secret key, the Turnstile secret key, the email key and so on). The public build settings (website address, WhatsApp number, public keys) are **GitHub** variables instead, because GitHub builds the site. I give you the list by NAME in `docs/SECRETS.md` and in chat, one batch at a time. **You** type each value in the Vercel screen (never in chat). For each variable pick the scope: **Production** for the live site, **Preview** for the private preview and test builds. Use the **test** values (for example Turnstile test keys, a dev Supabase project) on **Preview** only, and the real values on **Production** only. Remember: a changed value applies to new builds only, so after any change I ask you to redeploy.
7. **Deploy credentials for GitHub (needed for any publish or preview).** GitHub's deploy job needs three values, stored as **GitHub secrets**: `VERCEL_TOKEN` (a password: Vercel account **Settings**, **Tokens**, create one named `power-smash-deploy`, with an expiry about three months ahead, and put the date in your calendar), `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (identifiers, not passwords: they are on the project's **Settings**, **General** screen and the team's settings; I will tell you where if the screen differs). **You** enter all three on the GitHub secret screen (top of this file); I never see the token. Do not paste the token in chat. Tell me only "done".
8. Tell me "Vercel project made" and the project name. If any screen looks different from what I describe, tell me what you see (never a secret).

**Steps (Part 2: Pro, only before launch).**
1. When I say G1 is close, open the project's **Settings** or the account's **Billing**, choose **Pro** and read the total on screen (USD 20 a month per seat, plus usage above the included credit). Check what Vercel shows about GST or tax for India. **You** enter the card or payment details; I never do. Tell me "Pro active" (no card number).
2. Do not invite extra people to the Vercel team unless needed: Pro is priced per seat.

**What you will see on the first preview.** After the code is on GitHub, you set the switch `PREVIEW_ENABLED` to `true` (OT-48) and press **Run workflow** on the Preview job (OT-47); the job prints a Vercel address ending `.vercel.app` in its log (Actions tab, the run, the last step). Opening it asks you to **log in to Vercel**; that is the protection working. After login you see the Power Smash pages with made-up sample data and the red "TODO" gap badges (the preview is allowed to show them; the live strict build is not). Vercel also adds a "do not list in search engines" header to preview addresses by itself. If a page says "Deployment Protection" or asks you to request access, tap **Log in** with the account that owns the project.

**Which Cloudflare pieces remain:** Turnstile (free spam check, OT-41), Cloudflare Web Analytics (optional counter, OT-45; it needs your real domain), Email Routing for `hello@` (needs the domain on Cloudflare, OT-07 and OT-33), and optionally the DNS for the domain. Gone: the Worker, `workers.dev` addresses, the Cloudflare deploy token and the Account ID. If you already made a Cloudflare account, keep it for the pieces above and do **not** create a deploy token.

**Cost.** Hobby: free (private preview only; GitHub's free minutes cover the build). Pro: USD 20 a month per seat from Vercel's pricing page (read 2026-10-22); the included usage credit and overage rates beyond the figures in `docs/VERIFIED_FACTS.md` (VF-V3) are not verified; check the pricing page when you buy.  **Blocks.** The real test deploy, the private preview, the Lighthouse check; Pro blocks the public launch (G1).  **Order.** 3.

## OT-03 Supabase account and the development project (spec row 2) [PHONE] [PC] [FREE]

**What and why.** Supabase is the database. The free plan allows **two** active projects, and a project's region cannot be changed later, so we create both in Mumbai. This first one, `powersmash-dev`, holds only made-up test data. The real one comes later (OT-27).

**Steps.**
1. Sign up at supabase.com (signing in with GitHub is fine). Turn on two-step verification.
2. Make sure you have **no other free Supabase projects**. Create a new project named `powersmash-dev`, region **South Asia (Mumbai)**.
3. Choose a long database password and keep it only in your password manager. **Do not send it to me.**
4. On the create screen make sure "Automatically expose new tables" is **not** ticked. If you cannot find it, tell me and I will check with you.
5. Create a personal access token (Account, Access Tokens) named `claude-build`. **You** enter it as the GitHub secret `SUPABASE_ACCESS_TOKEN`, or put it in `.secrets.local` and run the loader yourself (both are described at the top of this file). I never see it and never type it for you.
6. Send me only the **project reference** (the short code in the project's web address) and "done".

**Cost.** Free. Supabase Pro (from USD 25 a month) is only for later, at the triggers in OT-30; whether your card works for USD payments is not verified, so check it when the time comes.  **Blocks.** M0 (database checks).  **Order.** 4.

## OT-04 YouTube Data API key (spec row 3) [PHONE] [PC] [FREE]

**What and why.** The key lets the site read your public video list (titles, thumbnails, views). It is free. The daily allowance is 10,000 units; reading your whole catalogue once costs only about 75 to 110.

**Steps.**
1. On the Google account that owns the channel, open console.cloud.google.com and create one project named `power-smash`. Use one project only.
2. Open the library, find **YouTube Data API v3**, and enable it.
3. Create an API key. Edit it: under API restrictions choose "Restrict key" and tick **only** YouTube Data API v3. Do not add website or IP restrictions; they do not work for our servers.
4. If the screen lets you, set a daily quota cap of about 3,000 units, so a mistake cannot use the whole allowance.
5. **You** enter the key as a GitHub secret named `YOUTUBE_API_KEY`, or put it in `.secrets.local` and run the loader yourself (both are described at the top of this file). I never see the key and never type it for you. If I need to run a check on this PC with it, I tell you how to put it in the local `.dev.vars` file yourself, and I never open that file. Tell me only "done".
6. Screens may be labelled slightly differently. If you get stuck, send me a screenshot **with the key hidden**.

**Cost.** Free.  **Blocks.** M0 title profiling.  **Order.** 5.

---

# PART B - START THIS WEEK (long waits; the build does not wait for them)

## OT-05 Decide who receives the money, with a CA (spec rows 5, 12, 15) [CA] [PHONE]

**What and why.** Your name on the PAN, the bank account, the Razorpay account, the domain and the invoices must all match. Whether you are an individual, a proprietorship or a company changes the Razorpay paperwork, GST, and what sponsors can pay you. This is the biggest lead-time item you control.

**Steps.**
1. Book a short call with a chartered accountant this week.
2. Tell them about your YouTube and AdSense income, sponsors, coverage fees, and possible merchandise later (goods are treated differently).
3. Ask these questions. Each one has a plain-English meaning so you know what you are asking:
   - **(a) Do I need GST registration now?** GST is India's sales tax on services. The threshold in my sources is Rs 20 lakh a year counted across India per PAN, and it may count AdSense income; the CA must confirm.
   - **(b) Which entity should receive the money?** In plain words: is the income yours personally, a proprietorship in your name, or a company? This changes Razorpay's paperwork and what sponsors can pay you.
   - **(c) What document do I give a customer while I am unregistered, and which ones once I am registered?** The names you may hear: a **tax invoice** (the bill that shows GST); an **advance receipt voucher** (a receipt you issue on the day a customer pays money in advance, before you have done the work, for example 50% before an event; once you are GST-registered, tax can fall due on that advance, so you give this receipt then and the final invoice later); a **credit note** (a document that reduces an earlier invoice, for example after a refund).
   - **(d) Does "reverse charge" apply to my sponsors?** In plain words: normally you add GST to your bill and pay it to the government. Under reverse charge the business paying you pays that GST to the government itself, so your bill to them may be written differently. My sources say sponsorship paid to you by a company or firm may fall under this when you are not a company (a rule they date from 16 January 2025). Ask whether it applies to me, and whether a banner or a video mention counts as "sponsorship" or as "advertising".
   - **(e) How will sponsors deduct TDS?** TDS means "tax deducted at source". A business paying you may keep back a small percentage of what it owes and send it to the tax office in your name. You receive less cash on the day, but you claim that tax as credit when you file your return. Under the new Income-tax Act 2025 the list of such payments is in Section 393; ask which line applies when a sponsor pays me, and what percentage to expect.
   - **(f) Which bank account should I use,** savings or current?
   - **(g) May I show my personal UPI QR** (the square code people scan to pay) for small amounts? Until you have a clear yes from the bank and the CA, the pricing page will not show one (D-035 row 16).
4. Write the answers down. Tell me only: the entity type, whether you are GST-registered, and which document type to use. Do not send bank or PAN numbers.

**Cost.** CA fee: no price is known; you set the budget.  **Blocks.** Razorpay (OT-06), the domain registrant name (OT-07), the payment fields in M3, the legal name on the site (OT-19).  **Order.** 6.

## OT-06 Razorpay account and KYC (spec row 15, moved up from Phase 2) [PHONE] [FREE to open]

**What and why.** Razorpay Payment Links let you take advances and payments from day one. They need **no website**. Razorpay has no published approval time and the bank partner decides, so start now.

**Steps.**
1. First check whether you already have a **CKYC record** (any bank, demat or mutual-fund KYC). It can make activation take minutes instead of days.
2. Sign up at razorpay.com with your business phone and email.
3. Choose the entity type from OT-05. Have ready: PAN, Aadhaar or DigiLocker access, a bank account whose name matches, and for a proprietorship two business proofs (UDYAM, GST, Shop and Establishment, IEC or a postpaid bill).
4. Describe the business truthfully: sports video coverage, sponsorship and advertising services, digital video products.
5. Finish the video KYC on your phone if asked.
6. **Do not submit the website for review yet.** That step needs live pages and a sample invoice; I will tell you when.
7. When the account is active I will tell you how to make one small test Payment Link and pay it yourself.

**Cost.** No setup or yearly fee. Each payment costs 2% plus 18% GST on that fee (about 2.36%). New accounts activated on or after 2026-07-01 pay 0% platform fee for 90 days or Rs 5,00,000, whichever comes first (tax on the fee still applies); the clock starts at activation, so activate when you are ready to take money. A Rs 199 KYC fee plus tax may apply. Refunds do not return the fee. Check the live dashboard before quoting any of this to a customer.  **Blocks.** Your first online payment (not the build). Budget about a week plus a buffer.  **Order.** 7.

## OT-07 Buy powersmash.in and finish .IN KYC (spec row 1) [PHONE] [owner pays]

**What and why.** (Reminder: `.IN` domains need the government-ID check, KYC, or the domain is switched off.) The site can be built and shown on a private Vercel preview address (ending `.vercel.app`) first, so the domain does not block the build. It does block your email address (`hello@powersmash.in`), the custom web address and Razorpay's website review. `.IN` domains need a government-ID check (KYC) the moment you buy; if it is not done the domain is switched off, taking the site and email down with it.

**Steps.**
1. Choose a registrar **after** looking at the checkout total with GST and the price for years 2 and 3. Verified list prices on 2026-10-20: Domain India Rs 575 first year, Rs 625 renewal, plus 18% GST, with free WHOIS privacy; Hostinger Rs 1 first year only if you take a 3-year term, then Rs 899 a year; GoDaddy India Rs 1 with a 3-year purchase or Rs 99 for new customers, then Rs 899. Say no to bundled add-ons. Promotions change.
2. Tell me which registrar and the checkout total. On 2026-10-20 the registry showed `powersmash.in` as not registered. I will ask for your "yes" before you pay.
3. Register it in your real name and address exactly as on your ID, matching the entity from OT-05. Use your **Gmail** as the contact email, never `hello@powersmash.in`.
4. Complete the registrar's e-KYC (usually through DigiLocker) in the same sitting and wait until it shows **verified**. Turn on the registrar's two-step verification and its "registrar lock" the same day (OT-14).
5. Do not change any DNS settings until the registrar shows it **verified**.
6. **Connect it to Vercel (after verified, and after OT-02 and Pro).** In the Vercel project open **Settings**, **Domains**, **Add**, type `powersmash.in` and follow what the screen offers; also add `www.powersmash.in` and let one redirect to the other as the screen suggests. Vercel then lists the **DNS records** you must add (the research did not verify the exact records, so copy them from the Vercel screen, not from me). You add them where the domain's DNS is managed: either at the registrar's DNS screen, or in Cloudflare if you chose Cloudflare for DNS (needed for free email forwarding, OT-33; in Cloudflare set the Vercel records to **DNS only**, the grey cloud, as Vercel's own guidance for proxied domains is not verified). Wait until Vercel shows a green tick, then tell me. **I do not change DNS myself; you do, after saying yes.**
7. Note the renewal date. Do not buy `powersmash.com`; it is registered and parked for sale.

**Cost.** As in step 1 (you pay; I never buy).  **Blocks.** The custom domain, Email Routing, Resend email verification and Razorpay website review, not the build.  **Order.** 8.

## OT-08 Telegram bot for alerts (spec row 10) [PHONE] [FREE]

**What and why.** Every new enquiry reaches you instantly on Telegram. Email becomes the second channel once your domain is verified and the email sender is set up (OT-40). Until then Telegram is the only push alert, and the enquiry list is the record.

**Steps.**
1. In Telegram message **@BotFather**, send `/newbot` and follow the prompts (name it "Power Smash Alerts").
2. BotFather replies with a long **token**. That is a password. **You** enter it yourself, on the secret screens or through `.secrets.local` and the loader (both described at the top of this file), as `TELEGRAM_BOT_TOKEN`. Do not paste it to me.
3. Open your new bot and press **Start**. A bot cannot message you until you do.
4. Tell me "bot ready". The alerts also need your **chat number** (`TELEGRAM_CHAT_ID`; the number is not a secret, the token is). I never use your token, so there is a small helper that you run yourself at the PC (`npm run telegram:chat-id`): it asks Telegram which chats have written to the bot and shows, for each chat, the number, the chat type and the first name and username, never the token or any message text. Anyone who finds the bot's name can message it, so use only the chat whose name and username are yours; if two private chats show up, or a name you do not know, stop and tell me. I give you the one line when we reach alert testing. Keep it a private chat; do not add the bot to a group.

**Cost.** Free.  **Blocks.** Testing alerts in M1, and G1: Telegram is the first alert channel, and the email channel only joins it after your domain is verified and Resend is switched on (OT-07, OT-40).  **Order.** 9.

## OT-09 WhatsApp Business app and WhatsApp Channel (spec row 11) [PHONE]

**What and why.** For the first months your real inbox is WhatsApp. The Channel is the place where fans and organizers follow your news.

**Steps.**
1. Install the WhatsApp Business app and set up the business profile (name, address or hours, description). Check with the app first whether your number can be used.
2. Add a catalogue (the packages, with no prices until you decide), quick replies for the messages in Appendix D, and labels: New, Quoted, Won, Lost.
3. Create a **WhatsApp Channel**: Updates tab, create channel, name, description, icon (use the approved logo, not a photo of a famous player).
4. Copy the Channel's invite link and send it to me. It is public.
5. Know the limits: a Channel is one-way and cannot be filled from a list of numbers. Business-app broadcast lists reach only people who saved your number, and hold 256 people.

**Cost.** I have no verified price; check the store listing.  **Blocks.** Only the display of the Channel button and link. It does **not** block G1: until you send the link, the Channel button on the support page and in the footer is hidden automatically and appears on the next build after you send it. The alerts sign-up page in M3 also points to the Channel, so send it before then.  **Order.** 10.

## OT-10 Standard block in your YouTube descriptions (new) [PHONE] [FREE]

**What and why.** Your 88K-subscriber channel is the best place to find organizers and sponsors, and this costs nothing and needs no website.

**Steps.**
1. In YouTube Studio open Settings, Upload defaults, and edit the default description.
2. Add a short block: how to book coverage on WhatsApp (your number from the spec), how to partner, and your WhatsApp Channel link. I will write the wording for you to approve. No prices.
3. Add the same block to your 20 most-viewed videos and pin a comment with the same line on the top few.
4. When the site is live I give you tracked links so we can count the clicks.
5. If a video is sponsored, tick YouTube's "Includes paid promotion" and follow the disclosure checklist I will put in the OWNER_GUIDE.

**Cost.** Free.  **Blocks.** Nothing.  **Order.** 11.

## OT-11 List the next 90 days of tournaments and your prospects (new) [PHONE] [FREE]

**What and why.** Organizers choose a media partner through people they know. Your warmest prospects are the organizers you have already filmed. The 90 days from today end about 18 January 2027, so these events are your first sales.

**Steps.**
1. Open a Google Sheet or notes with columns: tournament, organizer, contact (kept only here), dates, last contact, next step.
2. Add every tournament you know of in the next 90 days and every organizer you filmed before.
3. Pick five to message first, with a sample video link.
4. Send me only the counts and dates (so I can build the tournament list). Keep phone numbers in your own sheet.

**Cost.** Free.  **Blocks.** Nothing. This is the revenue engine.  **Order.** 12.

## OT-12 YouTube Studio audience figures (spec row 9) [PHONE] [FREE]

**What and why.** YouTube only gives the website rounded subscriber counts, and rules stop us storing them for more than 30 days. Sponsors want real numbers, so you give them dated screenshots from Studio.

**Steps.**
1. In YouTube Studio open Analytics and set the last 28 days; note views and watch time. Repeat for 90 days.
2. Open the Audience tab: top locations, age and gender, returning viewers.
3. Take screenshots with the date range visible.
4. Note whether Studio shows country, state or city; we will not promise district-level targeting until we know.
5. Send me the screenshots. Repeat monthly.

**Exactly what the /partner page needs from you.** The Partner page now has a dated "audience" block. Until you supply the figures it shows one marked gap (a badge reading "TODO(owner): the audience figures from YouTube Studio ..."), and that gap stops the strict publish job, so these figures are a G1 input. Send me these, in the words and numbers Studio shows, and I copy them exactly (I never compute, round or invent a figure):
1. **The date.** The day you read the figures and the date range they cover (for example "last 28 days, read on <the date>"). **No figure is ever shown without its date**, so if you send figures with no date, the page still shows the gap and shows no figure.
2. **Monthly views.**
3. **Top locations**, with each place and its share exactly as Studio shows it (as many as you want shown, usually the top few).
4. **Age groups**, each group with its share.
5. **Gender split**, each with its share.
6. **Average view duration.**

You may send only some of these: the page shows only the ones you supply, with no empty rows. The date is required whatever you send. Optional: a media-kit PDF for sponsors; the "Download media kit" button on the Partner page stays hidden until you give me the file.

**Keep them fresh.** The release check is built to refuse figures older than 90 days. The channel figures already on the Home and About pages ("about 88K subscribers and 1.9K videos, as of October 2026", confirmed on the public channel page on 2026-10-20) go stale on **19 January 2027**, so send fresh Studio or channel figures before then, and then every month.

**Cost.** Free.  **Blocks.** M1 go-live: the partner page needs your dated Studio figures, so send them before G1.  **Order.** 13.

## OT-13 Price worksheet and ten conversations (spec rows 6 and 8, groundwork) [PHONE] [FREE]

**What and why.** I will never set your prices. This is a way to arrive at them, using real answers instead of guesses.

**Steps.**
1. For each product (tournament promotion, finals-day coverage, HD match file, season pack, highlight reel, sponsor starter) write your hours (shoot, edit, upload, travel), crew, travel, equipment, data cost, the payment fee (2% plus tax on the fee) and the margin you want. The total is the floor.
2. Ask five organizers and five shop owners what they pay today for pamphlets, flex banners, photographers and Instagram promotion. Write down their real answers.
3. Ask a shop what a new customer is worth and how many it needs for a sponsorship to pay for itself.
4. Offer two or three options shown as "starting from" or "on quote".
5. Quote five prospects in two weeks. Log yes, no or negotiate, and why.
6. Decide the advance and cancellation terms (OT-21). Never discount without removing something.

**Cost.** Free.  **Blocks.** M1 go-live (prices, or your approval of "on quote").  **Order.** 14.

## OT-15 Find a lawyer (new) [LAWYER]

**What and why.** The spec says legal texts must be reviewed by a professional. A lawyer is the one thing the build cannot replace. The questions are about children's names, rights to tournament footage, takedowns, and new rules that start around launch.

**Steps.**
1. Find an Indian lawyer with data-protection and media or sports experience (ask your CA or other creators).
2. Ask for a fixed fee for a one-time review and get a quote. **I have no price; you set the budget.**
3. At the end of M1 I give you the draft texts and a short question list: the children's-names options and legacy children's data; whether a phone or WhatsApp declaration is enough to verify a parent; the badminton federation's rules on rights; a coverage agreement and a submit-video licence; takedown timelines; the new e-commerce rules (including registration with the National Consumer Helpline); whether you count as an "intermediary"; CERT-In duties.
4. Tell me their conclusions in plain words. I build them behind settings so nothing needs rewriting.
5. Forward them the briefing pack `docs/legal/LAWYER_BRIEFING.md` (it holds the questions A to H and the two agreement drafts). The six legal pages are drafts: each says only what is true today, and wording about things that do not exist yet is held back behind switches. Before G1 I re-read every page against `docs/legal/G1_REREAD_CHECKLIST.md`. Two extra questions for the lawyer: the privacy page and consent text if you ever switch on the Telegram phone link (question 6 at the top of this file), and whether the "event documents deleted 30 days after the event" rule would wrongly delete an organiser's permission letter.

**Cost.** Unknown; your budget.  **Blocks.** G1 and G2 (public pages) and M4.  **Order.** 15.

## OT-16 Send YouTube a written question (new) [PHONE] [FREE]

**What and why.** YouTube's developer rules ban creating "new or derived data" from their data, and nobody can say whether turning your titles into player and tournament pages is allowed. Only YouTube can answer. I will not assume the answer. Two more risks went into the question: YouTube's policy guide lists "inferring content categories" as something not to do, and my software sorts each video into match, Short, live replay or other; and YouTube's rules say stored YouTube data must be refreshed or deleted within 30 days (policy III.E.4.d), so the site will refresh or delete it before day 30, not just hide it.

**The route (checked 2026-10-20).** There is **no separate "policy question" form**. The only official form I found is the one YouTube's own policy guide points to for developers who are unsure about compliance: "YouTube Data API Services Audit and Quota Extension Form" (https://support.google.com/youtube/contact/yt_api_form). It is built for audits and quota requests, so you use it for this question with a clear note. The question is already written: it is Part B of `docs/YOUTUBE_POLICY_QUERY_DRAFT.md` (not sent; I never send it for you).

**Steps.**
1. Tell me the day you plan to send it. I re-read YouTube's three policy pages that day, because they change often.
2. Sign in with the Google account that owns the channel (the business account from OT-14) and open the form above.
3. The form offers two choices, both about a compliance audit. **You are not asking for more quota.** Choose the compliance-audit option and write in the first line: "This is a policy-interpretation question, not a quota request." If the form now offers "policy question" or "other", use that. If it looks different, tell me what you see.
4. Fill in the form's own fields: your name and contact details, the Google Cloud project number (from the Google Cloud console, project `power-smash`) and the API client name "Power Smash website". For the website say "in development, not yet public". Do not make up an address.
5. Paste Part B of the draft into the free-text box (use its "Short version" if the box is short, and add "A full written description is available on request").
6. The form asks for screenshots and a demo login or screencast. None exists yet: say so plainly. Do not send a screenshot of anything that is not real. When a private preview with made-up data exists (about M2c) I can make a short screencast if they ask.
7. **Never include** an API key, a password or a real player's name.
8. Save the confirmation email. When a reply arrives, send me its text.
9. If their answer is "no", I will propose using a download of your own channel data (Google Takeout) for the titles instead; we decide then.

**What to expect.** I found no published reply time. The reply may be an audit questionnaire or a pointer to the policies rather than a clean yes or no. That is normal, not a refusal, and it can take days or weeks.

**Cost.** Free.  **Blocks.** The public archive launch (G2), not the build.  **Order.** 16.

## OT-17 Gather organizer permissions for events you already filmed (new) [PHONE] [FREE]

**What and why.** The badminton federation's rules put commercial, webcast and film rights at its tournaments with the federation or the promoting association. I will not assume your old videos had permission. Written permission (even a WhatsApp message) is what protects you.

**Steps.**
1. After M0 I give you the list of tournaments in your catalogue.
2. For each, look for a WhatsApp or email message where the organizer or association agreed to your filming and publishing. Take screenshots.
3. Mark any event that had an exclusive media partner.
4. Send me a simple list: event, "have permission" or "unknown". No phone numbers.
5. For every new event, ask the organizer to confirm in writing before you film. The lawyer's template comes later.

**Cost.** Free.  **Blocks.** The permission data in M3; the lawyer's opinion.  **Order.** 17.

## OT-18 Schedule a test live stream (new) [PHONE] [FREE]

**What and why.** We do not know how YouTube shows scheduled streams to our code. A short test settles it.

**Steps.**
1. In YouTube Studio create an unlisted scheduled live stream (and, if you can, an unlisted Premiere).
2. Tell me the title and time.
3. Start it for a minute so it appears as live, then end it.
4. I check how it appears.

**Cost.** Free.  **Blocks.** Nothing (it improves the Live page).  **Order.** 18.

---

# PART C - CAN WAIT

## OT-19 Legal name, address, phone, email and grievance contact (spec row 5) [PHONE]

**What and why.** Razorpay and the e-commerce rules need your legal name and address on the site. A home address becomes public; an office or registered address is better.

**Steps.**
1. Confirm the legal name matches the entity from OT-05.
2. Choose the address you are happy to publish.
3. Confirm the phone, and that `hello@` will forward to your Gmail.
4. Name the **grievance officer** and a **data contact** (the person parents and players write to) with phone and email.
5. Name who answers takedown messages and can be reached by phone within hours (a court or government order must be acted on within 3 hours; a parent's removal request within 48 hours).

**Exactly what the pages show as marked gaps today (from the strict build, 2026-10-21).** Each gap is a badge reading "TODO(owner): ..." that visitors would see, which is why the strict publish job refuses until it is filled. For this item the gaps are:
- **Every page (18 of them), in the footer:** one gap, "legal name, address, phone and email in the footer". It stays until all four are supplied.
- **The Contact page and all six legal pages (Privacy, Terms, Refunds, Delivery, Disclosures, Content Removal):** a block of six lines, each a gap until supplied: **business name** (legal name), **postal address** to publish, **grievance officer's name**, **grievance officer's email**, **phone** for customer care and grievances (the grievance officer's own phone if you give a separate one, otherwise the business phone), and the **public email** (needs your domain verified, OT-07; never your personal Gmail).
- **Each of the six legal pages** also shows "lawyer review of this page (OT-15)" until the lawyer has seen the final wording. That one is cleared by the lawyer's review, not by you.
- **Optional, not blocking (hidden until you supply them):** opening hours for the Contact page; a separate data contact for parents and players (tell me if you want a different person from the grievance officer).
- In the Content Removal page, if no way to reach you for removal requests exists (a WhatsApp number or a public email), it shows a gap too; your WhatsApp number covers it once it is set.

**Cost.** Free.  **Blocks.** G1. These cannot be hidden automatically, because the pages are not honest without a legal name, address, phone and email.  **When.** Before the end of M1.

## OT-20 Service packages, prices, delivery times, travel policy (spec row 6) [PHONE]

**What and why.** The pricing page must show real or "starting from" prices because Razorpay checks for one. I never set a price.

**Steps.**
1. Choose two or three products to lead with (suggested: tournament promotion, finals-day coverage, a sponsor starter). The rest show as "also available".
2. For each: what is included, the price or "starting from" or "on quote", whether GST is included (ask the CA), delivery time.
3. Your travel policy outside your home district, and power and internet needs for live streams.
4. Send these in chat as a short list. I show you the pricing page to approve.
5. Answer question 10 at the top of this file: when and how you send payment details (with the quote, after the customer accepts, or by payment link on WhatsApp).

**Exactly what the pages show as marked gaps today (from the strict build, 2026-10-21).**
- **Prices.** A gap "price for <product>" appears wherever a price would be, until you give a price, a "starting from" price, or approve the words "on quote". The products: **Essential, Pro, Broadcast, Extra match day, Extra court, Travel outside the home district, Highlight reel, HD match file, Season pack, Custom edit, Tournament promotion** (11 on the Services and Pricing pages), plus the four sponsor packages **Rally Partner, Court Partner, Coverage Partner, Title Partner** (on Pricing and Partner). The Home page shows three of them: Essential, Tournament promotion, Rally Partner. I never set a price. The "on quote" wording also needs your yes before it replaces a gap.
- **Approval of the suggested inclusions** (what each package contains): one gap on Services, one on Pricing, and one on Partner (that last one is OT-22). The two inclusions removed for not existing yet are in question 11.
- **Pricing page:** the **GST note** (whether prices include GST; ask your CA, OT-05) and **delivery time for each product**.
- **Delivery Policy page:** **how long after the event the videos are published**, the **delivery time for each product**, and the **time allowed to report a problem** with a delivery (also OT-21). The Delivery page also needs the six contact lines of OT-19.
- **Optional, hidden until you supply them (not blocking):** your travel policy outside your home district; what you need at a venue for a live stream (power, internet); the one-line payment-timing sentence on Pricing (question 10).

**Cost.** Free.  **Blocks.** G1.  **When.** Before the end of M1.

## OT-21 Cancellation and refund rules with timelines (spec row 7) [PHONE] [LAWYER to review]

**What and why.** The refund policy needs concrete timelines. A refund does not give back the gateway fee, so do not promise that it does.

**Steps.**
1. Decide the advance percentage and the cancellation windows (for example, days before the event).
2. Decide refund timelines and how digital deliverables are delivered and confirmed.
3. Decide who settles disputes.
4. Send the rules; I draft the policy; the lawyer reviews it.

**Exactly what the pages show as marked gaps today (from the strict build, 2026-10-21).** The Refunds page has the most. Each line below is a gap until you decide it; please answer each in one line:
1. Whether you ask for an **advance**, how much (an amount or a share of the price) and **when the balance is due**.
2. The **early cancellation window** (for example how many days before the event) and **what is refunded** for it.
3. The **late cancellation window** (closer to the event) and **what is refunded** for it.
4. The **cut-off after which no refund is given** (for example once coverage has started or a file has been delivered) and **what is refunded after it**.
5. **How and from when a cancellation counts** (for example the day we receive your message).
6. **The rules for changing the date or the event**: how often, how much notice, any extra charge.
7. **What you offer if you cancel or cannot deliver**: a refund of the undelivered part, a new date, or a credit.
8. **The rule once a digital file has been delivered**, the **time allowed to report a problem**, and whether you **fix it, replace it or refund it**.
9. **The rules for sponsor and partner packages**, including one already partly delivered.
10. **How long a refund takes** to reach the customer.
11. **Whether the payment gateway's fee is taken off a refund or you bear it.** Razorpay does not return its fee on a refund, so never promise that it does.
- **Terms page:** the **city whose courts decide disputes** (decide it with the lawyer).
- **Delivery Policy page:** the time allowed to report a problem with a delivery is the same answer as item 8; the delivery times are OT-20.
- **GST note:** it lives on the Pricing page (OT-20); ask the CA (OT-05).

**Cost.** Free (lawyer fee in OT-15).  **Blocks.** G1.  **When.** Before the end of M1.

## OT-22 Sponsor packages, real partners, testimonials (spec row 8) [PHONE]

**What and why.** Only real sponsors and real testimonials, with their permission, ever appear on the site.

**Steps.**
1. Decide the sponsor starter's deliverables (spoken mention and logo on uploads, link in descriptions, pinned comment, WhatsApp Channel post) and any founding-partner pilot terms. Terms are yours. Two suggested items are no longer on the public pages because the pages or features they promise do not exist yet: "banners on player and match pages" (milestone M2, and limited by YouTube's rules, D-016) and "Power Smash Open naming rights" (Phase 3). They come back only when the feature exists and you agree (question 11 at the top of this file). The Partner page shows a gap "approval of the suggested sponsor package inclusions" and four package price gaps (Rally Partner, Court Partner, Coverage Partner, Title Partner) until you answer.
2. List real past partners and ask each for written permission to show their logo or a quote.
3. Decide a promo code or WhatsApp keyword for each sponsor.
4. Remember: every sponsored video needs the disclosure checklist; health or supplement sponsors have extra rules.

**Cost.** Free.  **Blocks.** G1 for the sponsor packages (at least the two or three products to lead with). It does **not** block G1 for partner logos or testimonials: those sections stay hidden until you supply real ones with written permission.  **When.** Before the end of M1.

## OT-23 Logo approval and tagline (spec row 4) [PC] [FREE]

**What and why.** Your channel picture is a photo of a professional player, so it cannot be the brand mark. I drew an original wordmark (POWER SMASH, heavy condensed italic, with a shuttle-trail symbol). This is question 12 at the top of this file.

**Steps.**
1. At the PC, open the file `docs\brand-preview.html` inside the Power Smash folder (double-click it; it opens in your browser). It shows the draft logo and three tagline options, and it does not pick one.
2. Reply yes, or tell me what to change. If you have a designer's files, send them.
3. Pick one tagline: "Tamil Nadu badminton, on record." or "Every player. Every match. Every smash." or "Where Tamil Nadu badminton lives." The spec's draft Tamil home headline means "Home of Tamil Nadu badminton", which matches the third option, not the English headline in the spec. Whichever tagline you pick, the Tamil line needs a native speaker's review (OT-32).

**A note on the share picture.** The picture that appears when someone shares a Power Smash link on WhatsApp or Facebook (its technical name is the Open Graph image) has to be a PNG file. My drawing is an SVG, and the tool that turns SVG into PNG is not on your PC. I will ask before installing one: I will tell you its name, download size and licence first, and install nothing without your yes (question 4 at the top of this file). Until the PNG exists, a link shared on WhatsApp shows no picture.

**Cost.** Free.  **Blocks.** G1.  **When.** Now (it is waiting on you) or during M1.

## OT-24 UPI ID or QR, after a bank check (spec row 12) [PHONE]

**What and why.** Banks treat personal UPI IDs and business collections differently, and there is no official rule either way. A personal QR on a business page is a risk to your own account.

**Steps.**
1. Ask your bank: is this a savings or current account, may it receive business payments by QR, and what are the limits?
2. Or ask for a merchant QR from the bank or from Razorpay (listed at 0.99% a transaction; check the dashboard).
3. Until the bank and your CA agree, no personal QR goes on the site; use Razorpay Payment Links or bank transfer.
4. Larger amounts (above Rs 1 lakh per UPI payment by default) go by Payment Link, netbanking or transfer.
5. Send me only the public ID you want shown, if any.

**Cost.** As found at the bank or Razorpay.  **Blocks.** G1 for small payments only.  **When.** Before the end of M1.

## OT-25 Your own photos (spec row 13) [PHONE] [FREE]

**What and why.** The hero images should be yours: venues, action, crowds. No photos of famous players, no broadcast frames.

**Steps.**
1. Choose 10 to 20 of your own photos with no identifiable children, unless a parent has signed a release.
2. Send the originals (or a shared album link).
3. I tell you if a photo needs to be replaced.

**Cost.** Free.  **Blocks.** Only the display of your photos. It does **not** block G1: until you send photos the pages show the Power Smash brand pattern instead, and your photos replace it on the next build.  **When.** Any time; best before you show the home page to sponsors.

## OT-26 Priority players, districts and academies (spec row 14) [PHONE] [FREE]

**What and why.** Only confirmed adults get player pages. The more players you confirm, the more pages exist at launch.

**Steps.**
1. I give you the most-viewed names from the catalogue report after M0.
2. Mark each as "adult, yes" or "not sure". Do not guess.
3. Add each person's district and academy (spelling matters).
4. Do not include phone numbers.
5. Send the list. Anyone you do not confirm stays as plain text.

**Cost.** Free.  **Blocks.** Data quality in M2.  **When.** During M2.

## OT-27 The production Supabase project (spec row 2, second half) [PHONE] [PC] [FREE]

**What and why.** This is the real database. Same steps as OT-03, with the name `powersmash-prod`, Mumbai, "Automatically expose new tables" not ticked. The real video catalogue goes here (hidden by default).

**Steps.** Repeat OT-03 steps 3, 4 and 6 for the new project. **You** enter its keys yourself, on the secret screens or through `.secrets.local` and the loader (both described at the top of this file); I never see them. Send me only the project reference.

**Cost.** Free; Pro from USD 25 a month at your first signed sponsor, first paid order, or database near 300 MB (OT-30).  **Blocks.** M1 go-live and M2 backfill; the backup connection (OT-43) builds on it.  **When.** Before M1 go-live.

## OT-28 Decide the children's-names policy (new) [LAWYER] [PHONE]

**What and why.** Most of your old catalogue has no age in the title, so most players count as "age unknown". Indian data-protection law (DPDP, from about 13 May 2027) treats under-18s specially, and the old "show unless a parent objects" approach probably does not fit. This is your call, with the lawyer.

**Steps.**
1. Read the options in the plan's decision table (D-012).
2. Your answer on 2026-10-22 for age unknown: a minimal page marked "do not index" (no name on a player page). Suspected or confirmed under-18: hide until a parent opts in. The lawyer still has to confirm this (question 1 at the top).
3. Decide whether to contact parents of juniors already on your channel (a consent drive) or blur, unlist or retitle junior videos before May 2027.
4. Reply in chat. The lawyer confirms before launch.

**Cost.** Free (lawyer fee in OT-15).  **Blocks.** G2 (public archive).  **When.** During M2.

## OT-29 Decide what to show of non-Tamil-Nadu events (new) [PHONE]

**What and why.** About three quarters of your newest long videos are national events outside Tamil Nadu, mostly in Bangalore. The site's tagline says Tamil Nadu.

**Steps.**
1. Choose: hide them; list them without player pages (my recommendation); or give them full pages.
2. Tell me what to do with international broadcast clips (default: hidden) and with titles marked only [IND] (I will ask case by case).
3. Reply in chat.

**Answered 2026-10-22:** non-Tamil-Nadu events are listed without player pages. Events whose place cannot be detected from the title get the same treatment until you say otherwise (question 8 at the top).

**Cost.** Free.  **Blocks.** Nothing now.  **When.** Done.

## OT-30 Approve the plan decisions and spend rules (new) [PHONE]

**What and why.** Several decisions are marked "proposed" and I will not treat them as settled without your yes.

**Steps.**
1. Read the "Decisions I need from you" table in `BUILD_PLAN_PHASE1.md`.
2. Reply yes, no or change, row by row. The table includes the timeline (D-034: about 40 working days, 52 with a 30% cushion), the 16 scope changes in D-035 (for example the pricing-page UPI QR held until your bank and CA agree) and the choice of uptime monitor (D-039).
3. Approve or change the spend rules: Vercel Pro (USD 20 a month per seat) before the public launch (a given, not a trigger; D-097) and extra Vercel usage only if a bill shows it; Supabase Pro (from USD 25 a month) at the first signed sponsor, the first paid order, or when the database nears 300 MB; GitHub extra minutes at USD 0.006 a minute only after we try Workers Builds; the lawyer and CA budget is yours.
4. I still ask again, with the exact amount, before every purchase.
5. Answer the two M1 decisions at the top of this file: whether the confirmation screen may promise a reply time (question 9) and whether the Telegram alert may carry the customer's phone number (question 6, default no; the lawyer must agree first, OT-15).

**Cost.** Free to answer.  **Blocks.** M1 START (it is on the short list at the top).  **When.** Before M1 starts.

## OT-31 Backup key custody and a takedown deputy (new) [PC] [FREE]

**What and why.** The weekly backup is a full copy of the database, locked with a free, widely used file-locking tool called `age` (the choice recorded in D-011) so that a leaked file is useless. The locking half (the **public** key) is safe to keep in GitHub as a plain variable. The unlocking half (the **private** key) must only ever be held by you, offline. You need this **before G1**, not later: the weekly backup starts the moment the first real enquiry exists, so the key must be in place before the public go-live. Also, takedown deadlines are short, so someone else must be able to prompt you.

**Steps.**
1. Once, at the PC. **You make the key yourself; I never see the private half.** The `age` program is a small download, so I first tell you its name, where it comes from and its size and ask for your yes. Then I give you the one line to type. It saves the **private** key to a file in a folder outside the project and shows you the **public** line on screen. I never print the private key in chat and it never goes into the project or any online service.
2. You open that file at the PC and store the **private** key in your password manager or write it on paper. Give a sealed copy to one trusted person (D-011 calls this the escrow copy). Then delete the file yourself (I show you how, and I never delete it for you without your yes).
3. The **public** line is safe to share. Add it as a GitHub **variable** (not a secret) named `AGE_PUBLIC_KEY`: open the `power-smash` repository, Settings, Secrets and variables, Actions, the **Variables** tab, New repository variable. The private key never goes anywhere online.
4. Name one trusted deputy who can reach you by WhatsApp when you are away. Send me their first name and role only.
5. Before launch (M4) we run **one real restore test together**, at the PC. It uses a throwaway copy of the free database program PostgreSQL 17 on your computer (I tell you the download size and ask first), and you unlock the latest backup with your private key from your password manager or paper: you save the key to a temporary file outside the project, run the one-line unlock command I give you, then delete the temporary file. I never see the key. This is the only time the private key is used, and it never goes online. When the test is done, the throwaway copy and the unlocked file are deleted.
6. A second, separate **practice** key is needed for the automatic restore practice runs (D-011). You make it the same way, in a different file. Its public line goes into a GitHub variable named `AGE_DRILL_PUBLIC_KEY`, and its private half into the GitHub **secret** `AGE_DRILL_KEY`, which you enter yourself. It only ever unlocks made-up test data, so a leak is low risk, but never mix it up with the real key. I ask for it when the restore practice is ready.

**Cost.** Free.  **Blocks.** G1: the public key must be set as the GitHub variable `AGE_PUBLIC_KEY` and the first backup run green before go-live (it is on the G1 list, together with OT-43).  **Order.** Before G1; the same sitting as OT-43 is easiest.

## OT-32 Native Tamil review (Appendix B) [PHONE]

**What and why.** The Tamil lines in the spec are drafts. A native speaker must review them, and the privacy notice summary in Tamil, before they go live.

**Steps.**
1. Find a native speaker you trust (a friend, a teacher or a paid reviewer).
2. I send the list of Tamil lines.
3. They approve or correct each line.
4. Tamil goes live only after this.

**Cost.** Unknown.  **Blocks.** Only the display of Tamil lines. It does **not** block G1: until a native speaker approves the Tamil, those lines show in English only, and Tamil appears on the next build after approval.  **When.** Any time; English goes first.

## OT-33 How you reply from hello@ (new) [PHONE]

**What and why.** Google says it is ending the Gmail "Send mail as" feature for third-party addresses in January 2027 (exact day unpublished). Google's own help page names addresses such as Yahoo and Outlook; other sources say custom-domain addresses like `hello@yourdomain` are included too, but I have not confirmed that. The plan does not depend on it either way: replies go out through the admin, so I will not build around Send-as.

**Steps.**
1. Default (free): you reply from a button on each enquiry in the admin; the reply goes out as `hello@` and is saved on the enquiry.
2. Optional: a real mailbox. Zoho Mail Free is webmail-only, and whether its mobile app and an India data centre are available is not verified; Google Workspace costs money (price not verified); Fastmail is another option.
3. Tell me if you want one of these; it does not block anything.

**Cost.** Default free; others unverified.  **Blocks.** Nothing.  **When.** Any time.

## OT-34 E-commerce rules checklist (new) [LAWYER or CA]

**What and why.** New e-commerce rules take effect on 1 January 2027: a grievance officer, a copy of each recorded complaint, registration with the National Consumer Helpline, a yearly "dark patterns" self-check with a certificate shown on the site, and care with "was and now" prices.

**Steps.**
1. Ask your lawyer or CA whether a sole proprietor selling its own services and digital files must register and publish the certificate.
2. Keep your published prices steady (no countdown timers or fake discounts).
3. Tell me their answer; I add the pages and checks.

**Cost.** Free to ask (professional fee in OT-15 or OT-05).  **Blocks.** Needed by 1 January 2027.  **When.** During M1 to M3.

## OT-35 Check sample title labels on your phone (new) [PHONE] [FREE]

**What and why.** To know how well the title reader works, we compare it with human answers on 150 to 200 real titles. I propose the labels; you correct them.

**Steps.**
1. I send about 10 titles at a time with my proposed players, tournament, category, round.
2. Tap "OK" or fix the wrong ones.
3. Do a few sessions of five minutes each.

**Cost.** Free.  **Blocks.** Measuring DoD 1 (M2).  **When.** During M0 to M2.

## OT-36 After launch: Google Search Console and Bing (spec 9.8) [PHONE] [FREE]

**What and why.** To make Google and Bing find the pages, and to tell us when something is wrong.

**Steps.**
1. After the domain is live, you sign in to Search Console with the business Google account and add the domain.
2. It shows a text record. You add it where your domain's DNS lives (the registrar or Cloudflare); I add nothing myself without your approval.
3. Submit the sitemaps (I give you the links) and repeat for Bing.
4. Check back weekly for errors.

**Cost.** Free.  **Blocks.** DoD 7 (final).  **When.** At launch.

## OT-37 Phase 2: affiliate accounts and gear picks (spec row 16) [PHONE] [FREE]

**What and why.** Gear links can earn commission, but slowly. Apply only after the site is live with real content.

**Steps.**
1. In YouTube Studio open Earn, then Shopping, and check that the affiliate tab appears and which shops (Flipkart, Myntra, Amazon and others) it lists.
2. After launch, apply to Amazon Associates India and Flipkart's affiliate programme. A source says Amazon may close a new account without three qualifying sales in 180 days, but that is not confirmed on an Amazon page.
3. List only gear you really use, with true notes.
4. Amazon requires the sentence "As an Amazon Associate I earn from qualifying purchases." to be shown.

**Cost.** Free.  **Blocks.** Phase 2.  **When.** After launch.

## OT-38 Phase 3: Power Smash Open plan (spec row 17) [PHONE]

**What and why.** Dates, venue, categories and fees for your own event. Razorpay lists "sports bets" and "games of chance" as prohibited and does not name entry-fee tournaments, so ask them in writing before building payments. Under-18 entries must come through a parent.

**Steps.**
1. Write down dates, venue, categories, fees, and prizes.
2. Ask Razorpay support in writing whether this is allowed; keep the reply.
3. Send me the plan when ready.

**Cost.** Free.  **Blocks.** Phase 3.  **When.** Later.

## OT-39 Only if the Windows 10 test fails (new) [PHONE]

**What and why.** Cloudflare's tools (the old host) officially supported Windows 11, not your Windows 10; the local test passed on 2026-10-21 (`docs/G0_RESULT.md`). With the move to Vercel (D-097) that question is mostly moot: the real builds run on Vercel's or GitHub's Linux machines. Whether Vercel's command-line tool runs on your Windows 10 PC is not verified; you do not need it. What is still pending is the real publish (needs OT-02) and the Lighthouse speed check. If any of that fails, I would move the heavy work to the cloud (no cost, a little slower). Only if that were not enough would we talk about other options.

**Steps.**
1. Nothing to do now.
2. If cloud builds are ever needed, you need to do nothing (they use the GitHub account from OT-01 and the Vercel project from OT-02).
3. Only if I ask: choose whether to try WSL2 or upgrade to Windows 11. I do not know the cost; I will not install or change anything without your yes.

**Cost.** None unless you choose to upgrade.  **Blocks.** Nothing now (the test passed).  **When.** Done; I report again only if the real publish test fails.

## OT-40 Resend account, domain records and API key (new) [PHONE] [FREE]

**What and why.** Resend is the service that sends email from the site: the "we got your enquiry" message to customers, your replies from the admin as `hello@`, the double opt-in message for the alerts list, and later Supabase's production sign-in emails. It only sends once it has checked that you own the domain (called "verifying the domain"), so this item **waits for OT-07 to show verified**. Until then nothing is broken: new enquiries alert you on Telegram, and the customer's confirmation screen shows a WhatsApp link instead of a confirmation email. Nothing before that point waits for this item.

**Steps.**
1. Wait until OT-07 shows "verified" and the domain is connected (the DNS screen where you add records is either the registrar's or Cloudflare's). Then continue.
2. Sign up at resend.com with the business Gmail (OT-14). Turn on two-step verification if the account settings offer it.
3. Open **Domains** and tap **Add Domain**. Domain name: the sending subdomain I tell you (planned: `mail.powersmash.in`; Resend strongly recommends a subdomain rather than the main domain). Region: Tokyo (`ap-northeast-1`), the one the plan chose. If the list is labelled differently, tell me what you see.
4. Resend then shows a short table of DNS records (name, type, value). DNS records are the public notes that tell the internet which services may send email for your domain. Typically there is one for SPF, one for DKIM and one or more mail-server records. Add each one where your domain's DNS lives (the steps below are for Cloudflare; at a registrar the screen is similar): open your domain, then **DNS**, then **Records**, then **Add record**; choose the same Type, paste the Name and Content, and tap **Save**. Three traps, taken from Resend's own Cloudflare guide: set **Proxy status** to **DNS only** (grey cloud) wherever Cloudflare shows that choice; leave TTL on **Auto**; and in the Name box paste only the part before your domain name, because Cloudflare adds the domain itself. For a mail-server (MX) record also type the priority number Resend shows.
5. If Resend shows a **Sign in to Cloudflare** shortcut, skip it. It would give Resend permission to change your DNS. Adding the records by hand is safer.
6. Back in Resend, tap the button to verify the records. It often turns green within about 15 minutes; Resend says it can take up to 72 hours. If it still fails after that, tap **Restart verification** and tell me exactly what the screen says.
7. Make the key: open **API Keys** and create one named `power-smash-production`. For permission choose **Sending access**, not Full access, and limit it to your domain if the screen offers that choice. Resend shows the key **once**, so copy it now.
8. **You** enter the key as `RESEND_API_KEY`, as a Vercel environment variable (Production scope) and, if the workflows need it, as a GitHub secret (the screens are described near the top of this file). Or, at the PC, put it in `.secrets.local` and run the loader yourself, which copies it to both. I never see the key and never type it for you. Never in chat.
9. Tell me "Resend verified" and "key stored". With your yes I then switch on the customer confirmation email and the email alert channel, and point Supabase's production sign-in mail at Resend (Supabase's own sender only reaches team members, two emails an hour).
10. If any screen looks different from what I describe, tell me what you see.

**Cost.** Free to start. Resend's free quota is 100 emails a day and 3,000 a month (D-022); paid plans only at the triggers in OT-30, and I ask first with the exact amount.  **Blocks.** The customer confirmation email, the email alert channel, "Reply as hello@" in the admin, and Supabase production sign-in mail. It needs OT-07 verified first and is one of the domain-dependent steps in the G1 list. It blocks nothing before the domain is verified.  **Order.** Right after OT-07 shows verified.

## OT-41 Cloudflare Turnstile widget for the production forms (new) [PHONE] [FREE]

**What and why.** Turnstile is Cloudflare's spam check on the enquiry and other forms: it tells people from robots without making people solve puzzles. Each form needs two keys: a **site key** (public, sits in the page) and a **secret key** (private, checked by the server). Until the real keys exist I use Cloudflare's published **test keys** on previews and tests; they let every test pass and must never be used on the live site.

**A test key must never be on the Production scope of the Vercel project (new rule).** Cloudflare's published test secret accepts every submission, including a robot's, so if it ever reached the live site the spam check would silently be switched off. So the enquiry system refuses a test secret unless one extra setting is present: `TURNSTILE_ALLOW_TEST_KEYS`, with the value exactly `true`. That setting is for the **Preview** scope only. **Never add it to Production.** If a test secret is on Production without the setting, the form refuses to send (visitors see the WhatsApp fallback), and the health address says it is not ready, so a mistake fails safe. If someone ever does turn it on in production, the health answer also shows `"testMode":true`. How to check yourself: Vercel dashboard, the project, Settings, Environment Variables, and filter by **Production**. There must be **no** variable named `TURNSTILE_ALLOW_TEST_KEYS` there. If you see one, delete it and tell me. The secrets loader also refuses to load a test secret as `TURNSTILE_SECRET_KEY`. The full list is in `docs/SECRETS.md`.

**Steps.**
1. Do this after OT-02 (you need the Cloudflare account). In the Cloudflare dashboard open **Turnstile** and tap **Add widget**.
2. **Widget name:** `power-smash-production`.
3. **Hostname management:** add the hostnames I give you (your domain once it exists, and the `.vercel.app` preview address; the site checks the hostname, so every address that shows the form must be listed in the matching `TURNSTILE_EXPECTED_HOSTNAMES` setting too). The free plan allows up to 10 hostnames per widget, and you can add more later in the widget's **Settings**.
4. **Widget mode:** choose **Managed** unless I tell you otherwise (the other choices are Non-Interactive and Invisible). Leave the optional pre-clearance setting off.
5. Tap **Create**. Cloudflare shows the **Site key** and the **Secret key**.
6. The **Site key** is public: send it to me in chat, and I set it as the build variable `PUBLIC_TURNSTILE_SITE_KEY`.
7. The **Secret key** is a password. **You** enter it as the Vercel environment variable `TURNSTILE_SECRET_KEY`, **Production** scope (the screen is described near the top of this file; it exists once OT-02 is done), or put it in `.secrets.local` at the PC and run the loader yourself. I never see it and never type it for you. **Never in chat.**
8. Check that Production has no `TURNSTILE_ALLOW_TEST_KEYS` variable (see the rule above), and that `TURNSTILE_SECRET_KEY` is the real secret from step 5, not a test key.
9. Tell me "Turnstile done". If any screen looks different from what I describe, tell me what you see.

**Cost.** Free. Turnstile stays on Cloudflare and works from any host, Vercel included (it needs a free Cloudflare account; nothing is hosted there). Cloudflare's Turnstile plans page (read 2026-10-20) lists a Free plan with up to 20 widgets, 10 hostnames per widget and unlimited challenges. If Cloudflare ever asks for a card or a payment here, stop and tell me.  **Blocks.** The production forms at G1. Before then the test keys are used, so the build is not held up.  **Order.** Any time after OT-02 and before G1, once the hostnames are known.

## OT-42 GitHub token for the deploy trigger (new) [PHONE] [FREE]

**What and why.** When a new video or an edit changes the public site, a small scheduled job on the site's server (the Cloudflare Worker cron of the old plan no longer exists; the parked Vercel replacement is described in `docs/m3/vercel-deploy-notes.md`) tells GitHub "rebuild and publish the site", and the admin's "Publish now" button does the same instantly (D-008). To tell GitHub that, that job needs a key. We make a **narrow** one: a GitHub "fine-grained token" that works on the one `power-smash` repository only and may only start the existing publish job (GitHub calls this a "workflow dispatch", and the permission it needs is **Actions: write**). It cannot change code or settings or touch your other repositories. Without it the site still rebuilds on the nightly and six-hourly schedule, but new videos can take hours to appear.

**Steps.**
1. Do this when I ask at the start of M2a. Making it earlier only risks it expiring unused.
2. Sign in at github.com. Tap your profile picture, then **Settings**, then at the bottom of the left menu **Developer settings**, then **Personal access tokens**, then **Fine-grained tokens**, then **Generate new token**.
3. **Token name:** `power-smash-rebuild-trigger`. In the optional description write: "Lets the Power Smash site start a rebuild. Nothing else."
4. **Expiration:** choose a date about three months ahead (the plan replaces keys quarterly) and put it in your phone calendar. If it expires, new videos fall back to the scheduled rebuilds until you make a new token.
5. **Resource owner:** your own account (the one that owns `power-smash`).
6. **Repository access:** choose **Only select repositories** and tick **power-smash** only. Never "All repositories".
7. **Permissions:** open **Repository permissions**, find **Actions** and set it to **Read and write** (this is "Actions: write", on this one repository only). Leave every other permission at "No access". (GitHub adds a read-only "Metadata" permission by itself; that is fine.)
8. Tap **Generate token**. GitHub shows the token **once**: copy it now.
9. **You** enter it as the secret `REBUILD_DISPATCH_TOKEN` as a Vercel environment variable, **Production** scope (the screen is described near the top of this file), or put it in `.secrets.local` at the PC and run the loader yourself. I never see it and never type it for you. It is a Vercel secret, not a GitHub secret. Never in chat.
10. Tell me "token stored". If any screen looks different from what I describe, tell me what you see.

**Cost.** Free.  **Blocks.** M2a: the sync-triggered deploys, the RSS detector's rebuilds and "Publish now". It does not block M0, M1 or G1.  **Order.** When I ask at the start of M2a, after OT-01 and OT-02.

## OT-43 Supabase backup connection (new) [PHONE] [PC] [FREE]

**What and why.** Every week a GitHub machine copies your whole production database (D-011). To do that it needs the database's connection address, called the **session pooler** connection string, and a login that can only **read** the data, never change or delete it, so a leaked address could not damage anything. The string contains a password, so it is a **secret** (`SUPABASE_DB_URL`), never in chat. Backups must begin with the first real enquiry, so this is on the G1 list. It needs OT-27 (the production project) first, and goes together with OT-31 (the backup key).

**Steps.**
1. Tell me when OT-27 is done. I then add the read-only backup login to the production database through a migration (a recorded, reversible change with no password inside it) and tell you when it is ready.
2. Set that login's password. **You** choose a long password in your password manager and set it in Supabase; I give you the exact steps when we get here. I never make or see the password. If the screen looks different from what I describe, tell me what you see.
3. In Supabase open the **production** project and tap **Connect** at the top of the project page. Choose the **Session pooler** connection string (port 5432). Do not choose Direct connection (GitHub's machines cannot use it) or Transaction pooler. Copy the string from that screen; do not type the host yourself, because Supabase's host name cannot be guessed.
4. The string has a placeholder where the password goes, and the login name before the first dot is normally `postgres`. For the backup, the login name is the read-only backup login I tell you, followed by a dot and the project reference. Put that login's password in place of the placeholder.
5. **You** save the finished string as the GitHub secret `SUPABASE_DB_URL` (the screen is described near the top of this file), or in `.secrets.local` for the loader you run yourself. I never see it. Never paste it in chat. If you want me to check its shape, tell me only the host name part (the bit ending `pooler.supabase.com`) and the port, never the password.
6. I run the first backup from GitHub and tell you whether it passed. The plan wants one green run before G1.
7. If a read-only login turns out not to work with the backup tool, I tell you, and we decide together before you hand over the main database password.

**Cost.** Free.  **Blocks.** The weekly backup, which must start with the first real enquiry, so the first green run is on the G1 list.  **Order.** After OT-27 and before G1; the same sitting as OT-31 is easiest.

## OT-44 Uptime monitor sign-up (new) [PHONE] [FREE]

**What and why.** A "monitor" is a free robot that opens a web address every few minutes and messages you if it fails. The plan has two: your home page, and a small health address on the enquiry system (`/api/health`, which only answers with a short status and writes nothing). Without it, the enquiry form could break silently and you would lose enquiries without knowing. The sync alarm in the plan only covers video syncing, so it does not replace this (D-039). This is question 8 at the top of this file.

**What I found (read on each company's own pages on 2026-10-21; the full table and the web addresses are in `docs/UPTIME_MONITOR_OPTIONS.md`).** You want alerts on both Telegram and email. Only **HetrixTools** sends both on its free plan (15 monitors, a check every minute, its own Telegram bot, so you never share the token of your Power Smash Alerts bot). UptimeRobot's free plan has no Telegram (email and its phone app only). Better Stack's free plan has no Telegram. Cloudflare's own health checks are not on the free plan, so they are out. **My recommendation: HetrixTools, free plan.**

**What "log in every 90 days" means.** HetrixTools' free plan stays free only while you log in to your HetrixTools account at least once every 90 days. If you do not, it marks the account "inactive", and it emails you twice: a warning before, a notice after. Its page does not say in so many words that the checks stop, so assume they do: a silent monitor protects nothing. Logging in again reactivates the account. So set a repeating reminder on your phone every 60 days, "Log in to HetrixTools". Other things to know: its terms are silent on business use on the free plan (not forbidden; ask their support if you want it in writing), free support answers within about a day, and it keeps 15 days of activity log. I do not know whether sign-up asks for a card.

**The health-check keyword (new).** The health monitor must look for the exact text `"lead":"ready"`, with straight quotation marks (the page also contains `"ready":false` when something is broken, so the bare word `ready` would stay green during a failure). Phone keyboards turn straight quotes into curly ones, which would never match, so I will send the text on a line of its own for you to copy and paste. If the tool also offers "alert when this text appears", use `"ready":false` for it. The home page monitor looks for one word that is always on the page; I give you the word once the pages are final.

**Steps.**
1. Decide in chat (question 8): "HetrixTools", "UptimeRobot" (email and phone app only; I write its steps), "Better Stack", or "none, use the stop-gap". I never sign up for you.
2. **Wait until the test site has a web address** (OT-02 and question 14). A monitor needs an address that answers, so there is nothing to sign up for before then. I send you the two exact addresses (the home page, and the `/api/health` address). Until your own domain is live they are `.vercel.app` addresses (private previews are behind a Vercel login, so a monitor cannot reach them: expect to sign up for the monitor only once the real domain is live); at G1 we change them to your real domain.
3. Open your phone browser and go to `hetrixtools.com`. Open the pricing page, find the plan called **Free**, tap **Start free**. Sign up with the business Gmail (OT-14) and a new password stored in your password manager. If it offers two-step verification, turn it on. **If any screen asks for a card or a payment, stop and tell me.**
4. Open Telegram. In the search box type `hetrixtools_bot`, open it and tap **START**. The bot replies with your Chat ID (a number). Copy it. This is HetrixTools' own bot, not your Power Smash Alerts bot, and the number is not a secret.
5. Back in HetrixTools open the menu and tap **Contact Lists**, then **Default Contact** (it already holds your email). Find the **Telegram** box, paste the Chat ID, tap **Save**. If you see **Send test notification**, press it and tell me whether the test reached both Telegram and your email.
6. Open the menu, tap **Uptime Monitors**, **Add Monitor**, **Website**. Name: `Power Smash home page`. Website Link: the home page address I gave you. Contact List: Default Contact. Locations: leave what it suggests (up to 4 on the free plan). Keyword: the word I give you. If it shows **Advanced Settings** and a **Checkup Frequency**, choose **5 minutes** if offered (the health address counts toward Cloudflare's free daily allowance, and a slower check costs us almost nothing). Tap **Add Monitor**.
7. Do step 6 again for the second monitor: Name `Power Smash enquiry health`, Website Link = the `/api/health` address, Keyword = the copied text `"lead":"ready"`.
8. Wait a couple of minutes, tap **Refresh Table**, and tell me both show as up.
9. Set the repeating phone reminder every 60 days: "Log in to HetrixTools".
10. **The alert drill, before G1.** we make a monitor fail on purpose once, and I never break the live site. I tell you the moment; you either add a third monitor for a page that does not exist (I give you the address) or change the health monitor's keyword to a made-up word for a few minutes, then undo it. You tell me four things: did the Telegram message arrive and when; did the email arrive and when (and did it land in the inbox or in spam); did the "back up" messages arrive; do the monitors show up again. Both channels must arrive. The step-by-step is in `docs/UPTIME_RUNBOOK_DRAFT.md`.
11. If no free tool fits, I tell you, and the stop-gap is a check that runs from our own system (weaker, because it can fail together with the thing it watches). We decide then.
12. If any screen looks different from what I describe, tell me what you see.

**Cost.** Free tiers only. If a tool asks for a card or a payment, stop and tell me; I will not sign up or pay for you.  **Blocks.** M1 go-live (G1): it is on the G1 list, and the drill must have passed.  **Order.** After OT-08 and once the test site has an address (OT-02, question 7); before G1.

## OT-45 Cloudflare Web Analytics site and its public token (new) [PHONE] [FREE]

**What and why.** Cloudflare Web Analytics counts page views without cookies. The site shows its small counting script only when it is given a public identifier (called the token); with no token there is no script and the privacy page says nothing about page counts. The token is **not a secret**: it sits in the page for anyone to see, so you may send it to me in chat. It is a nice-to-have, not part of G1.

**Steps.**
1. Do this after the test site has an address (OT-02) and you have said yes to the account change in chat. I ask first because it is a change to your Cloudflare account (you need a free Cloudflare account for this; OT-02 says which Cloudflare pieces remain).
2. In the Cloudflare dashboard open **Web Analytics** (in the side menu under analytics, or use the search box) and choose to add a site. Use the option that gives you a **snippet** to paste into a page (not the automatic setup that needs your domain proxied). Whether Cloudflare accepts a `.vercel.app` address here is not verified; if it refuses, wait for your real domain (OT-07).
3. The snippet contains a line with `token` followed by a long code. Send me only that code. Do not change anything else.
4. I tell you to add it as a GitHub **variable** (not a secret) named `PUBLIC_CF_ANALYTICS_TOKEN`: open the `power-smash` repository, Settings, Secrets and variables, Actions, the **Variables** tab, New repository variable. The privacy page then mentions page counting on the next publish, automatically.
5. If any screen looks different from what I describe, tell me what you see.

**Cost.** Free.  **Blocks.** Nothing (it is not on the G1 list).  **Order.** Any time after OT-02.

## OT-46 Rate-limit rule on sponsor links (new) [PHONE] [to be checked]

**What and why.** Every sponsor or partner link will go through a Power Smash counting link that starts `/go/`. The site already limits how many clicks one link can add to the database per minute, but that limit works per machine and is a brake, not a wall. A stronger protection is a rule that slows down anyone who hammers those links. On the old Cloudflare plan this was a Cloudflare dashboard rule; on Vercel it would be a Vercel firewall (WAF) rule. **I have not verified** whether Vercel's firewall rate limiting is included in the Hobby or Pro plan or what it costs, and I will not guess. Do this before the first sponsor link goes live, not now: there are no sponsor links yet.

**Steps.**
1. Nothing to do now. When the first sponsor link is about to go live I check Vercel's own pages, tell you what is included and what it costs, and give you the exact screen and the rule (path begins `/go/`, a limit per minute that I will propose).
2. You make the rule yourself in the Vercel dashboard and tell me "rule added". It is a change to your Vercel project, so I ask for your yes first.

**Cost.** To be checked (I ask before anything is spent).  **Blocks.** The first sponsor link going live (M3). Not G1.  **Order.** When I ask.

## OT-47 A private preview address for unfinished pages (new) [PHONE] [FREE]

**What and why.** This is question 14 at the top of this file. The real publish job refuses to publish while any page shows a gap marker, so you could not see the pages on your phone until every gap is filled. A separate preview path lets you review the unfinished pages early, on a private Vercel address, never on your real domain. The how-to is in `docs/PREVIEW.md`.

**Steps.**
1. Answer question 14 in chat.
2. If yes, and after OT-02: the separate job is written (`.github/workflows/preview.yml`, off until you set `PREVIEW_ENABLED`; it also starts for pull requests made inside this repository, which only matters once I open one for you). It starts when you press its button on GitHub (Actions tab, choose **Preview**, **Run workflow**) and only ever makes a **preview** deployment (never Production, never the real domain). It marks every page "do not list this" for search engines, shows the gap markers on purpose, and uses made-up test data and no real WhatsApp number. It uses the development database values from three GitHub variables (`PREVIEW_PUBLIC_SUPABASE_URL`, `PREVIEW_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PREVIEW_PUBLIC_TURNSTILE_SITE_KEY`; public values, OT-03 and OT-41). I do not turn it on without your yes.
3. You open the address I send you on your phone and **log in to Vercel** when it asks. Vercel's Deployment Protection (Vercel Authentication, available on every plan per Vercel's docs) blocks everyone who is not logged in to your Vercel team. Do not turn that protection off, and do not create a shareable link for strangers.
4. When every gap is filled, the preview is switched off and the real strict job is the only way to publish.

**Cost.** Free (Hobby is enough for a private preview; the live site needs Pro, OT-02).  **Blocks.** Nothing (it only lets you look early).  **Order.** After OT-02 and your yes to question 14.

## OT-48 GitHub switches for publishing and backups (new) [PHONE] [FREE]

**What and why.** The automatic jobs below are switched off on purpose until you turn them on, so nothing publishes or backs up before it is ready. Each switch is a **GitHub variable** (not a secret) that you set by hand on the Variables tab; I never set it for you. Set each one **only when I tell you**, because switching on too early would publish or back up before the steps behind it are done.

| Switch (variable name) | Value to type | What it turns on | When I will tell you |
|---|---|---|---|
| `DEPLOY_ENABLED` | `true` | The publish job (strict: it refuses while any gap marker is on a page) | After OT-02 is done (with Pro active for a real launch), the real publish step is written and the first test publish is agreed with you (not before) |
| `PREVIEW_ENABLED` | `true` | The private preview job (made-up data, behind your Vercel login, never your real domain) | After OT-02 and your yes to question 14 |
| `BACKUP_ENABLED` | `true` | The weekly encrypted database backup | After OT-27, OT-31 and OT-43 are done |
| `SYNC_ENABLED` | `true` | The job that reads your YouTube channel every 6 hours and refreshes the archive data (`sync.yml`) | After OT-03, OT-04 and the YouTube answer (OT-16) |
| `CRON_ENABLED` (a **Vercel** environment variable, Production scope, not a GitHub one) | `true` | The scheduled check for new videos and its "no sync for 8 hours" alert. Parked: it would run as a Vercel cron route, which needs Pro for anything more often than once a day (`docs/m3/vercel-deploy-notes.md`); the 6-hourly sync itself runs on GitHub and does not need it | After the sync works and OT-42 is done |
| `BACKUP_TELEGRAM_ALERTS` | `true` | A Telegram message when a backup fails (optional; GitHub already emails the repository owner about failed scheduled jobs) | Optional, together with `BACKUP_ENABLED`: say in chat if you want it |

**Steps.**
1. Wait for my message that names the switch.
2. Open the `power-smash` repository, Settings, Secrets and variables, Actions, the **Variables** tab, New repository variable. Type the name exactly, the value `true`, and save.
3. Tell me "switch set" and the name. To turn a switch off again, delete the variable.
4. If any screen looks different from what I describe, tell me what you see.

**Cost.** Free (GitHub's free minutes cover these jobs; I watch the usage).  **Blocks.** G1 (publishing) and the first real backup.  **Order.** As in the table.


## OT-49 An extra front door for the admin page (new, optional) [PHONE] [to be checked]

**What and why.** The admin already needs password plus authenticator code (D-006). An extra layer would hide even the sign-in box from strangers. Two options exist after the move to Vercel (D-097): **Cloudflare Access** (needs your domain on Cloudflare; free-plan terms and whether it asks for a card are **not verified**) or **Vercel Password Protection** (Pro only, USD 20 a month per project, per Vercel's docs). My recommendation is to skip it for launch (question 5). I check the vendor's own pages before you do anything.

**Steps.** I give them after the check and your yes. If a card is asked for, stop and tell me.

**Cost.** Cloudflare Access: to be checked. Vercel Password Protection: USD 20 a month per project.  **Blocks.** Nothing; optional.  **Order.** After OT-02 and OT-51.

## OT-50 True "gone" pages with a small server route (new, optional) [PHONE]

**What and why.** See question 7 at the top. Removed addresses currently go to a neutral "no longer available" page (a 301 redirect). A real "410 gone" answer needs a small server route (Vercel's redirect rules cannot send 410) that checks a private list at the moment someone visits. Nothing to do unless you say yes; I would then build it and ask you to approve before it is switched on.

**Cost.** Free within the plan's function limits (to be re-checked).  **Blocks.** Nothing.  **Order.** Optional, after launch.

## OT-51 Set up your admin sign-in (new) [PHONE] [PC] [FREE]

**What and why.** The admin console lets only you in, with your password plus a code from an authenticator app (called MFA, "multi-factor"). The final lock is a Supabase setting that only you can change. This has not been tried on a real Supabase project yet; if a screen differs from the steps, tell me what you see (never a password or code).

**Steps.** Do this after OT-27 (production project), when I ask.
1. In the Supabase dashboard, Authentication, add one user: your business email and a long password kept in your password manager. Sign-ups stay switched off.
2. I give you one line to add your user to the `profiles` table with the role `owner` (you run it in Supabase's SQL screen; I never see your password).
3. Open the admin address and sign in. It asks you to enrol an authenticator: add it on your phone **and** on a second device straight away, so losing one phone does not lock you out.
4. In Supabase, Authentication, MFA settings: switch **enrolment OFF** but keep **verification ON**. Now nobody who steals just your password can add their own authenticator. Switch enrolment on again only for the written "MFA reset" recovery (in the runbook).
5. Also set a short login-token expiry in the Auth settings. Signing out does not cancel a token before it expires, so shorter is safer.
6. Keep your recovery codes in your password manager or on paper, not in a notes app.
7. Tell me "admin sign-in done".

**Cost.** Free.  **Blocks.** Using the admin console for real.  **Order.** After OT-27.
