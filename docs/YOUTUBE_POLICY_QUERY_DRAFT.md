# YouTube policy question - draft for the owner to send (D-016, OT-16)

**Status: DRAFT. Not sent.** Claude does not submit this; the owner does, from the Google account that owns the channel (`docs/BUILD_PLAN_PHASE1.md` section e, items 3 and 4). Prepared 2026-10-20. Lines marked `TODO(owner)` are for you to fill in. This file is internal: nothing in it goes on a public page.

Contents: Part A cover note for the owner; Part B the question, ready to paste; Part C what was checked and where; Part D what each answer means for the build.

---

# Part A - Cover note for the owner (plain English)

**What this is.** YouTube's developer rules ban creating "new or derived data" from YouTube's data, and no text says whether turning your video titles into player, match and tournament pages counts. Only YouTube can say. This is one written question to them. Claude never assumes the answer.

**How to send it.**
1. Sign in with the Google account that owns the channel (the business account from OT-14).
2. Open **https://support.google.com/youtube/contact/yt_api_form**. Its title is "YouTube Data API Services Audit and Quota Extension Form". It is the route YouTube's own Developer Policies Guide points to for developers who are unsure about compliance (the guide says to apply for an API Compliance Audit through it). I found no other documented route for policy questions: the YouTube API support page lists only a bug and feature issue tracker (not for policy) and the policy documents themselves.
3. On 2026-10-20 the form offered two choices, both about a compliance audit (to ask for more quota, or to keep the current quota after a re-audit). **You are not asking for more quota.** Choose the compliance-audit option, and write in the first line that this is a policy-interpretation question and not a quota request. If the form now offers a "policy question" or "other" choice, use that. If it looks different from this, tell Claude what you see.
4. Fill in the form's own fields (organisation, your contact details, the Google Cloud project number from the Google Cloud console, API client name "Power Smash website"). The site has no public address yet: say "in development, not yet public". Do not make up a web address.
5. Paste Part B into the free-text box about the business and how the API is used. If the box is short, paste the **Short version** and add: "A full written description is available on request."
6. The form asks for screenshots of the homepage, privacy policy and terms, and for a demo login or a screencast. None exists yet. Say so plainly. Claude can make a short screencast of a private preview with made-up data once the match page exists (about M2c), and send it if they ask. Do not send a screenshot of anything that is not real.
7. **Never include** an API key, a password, or any real player's name. The example title in Part B is invented.
8. Save the confirmation email. When a reply arrives, send Claude its text; Claude stores it in `docs/` (file name chosen then).

**What to attach.** Nothing is required. Helpful later, only if asked: the screencast above and the draft privacy-policy text (the YouTube sentences are in D-016 item 8).

**What to expect.** I found no response time published on the support pages. The form is built for audits and quota requests, so the reply may be an audit questionnaire or a general pointer to the policies, not a clean yes or no. That is normal and is not a refusal. It can take days or weeks. If they ask for something (a screencast, a demo account, a clearer description), tell Claude and we answer it together.

**What happens meanwhile.** The build carries on with the safeguards in D-016: the unmodified title on every match page, parsed details labelled "by Power Smash", no scores built from views, no "Trending" by views, statistics never older than 30 days, sponsor slots only beside the player and only on pages with real content of their own. The public archive (gate G2) waits for YouTube's reply, or for you to accept the leftover risk in writing in chat (D-016 item 10). Money pages (M1) do not depend on this.

**If the answer is "no".** Claude proposes using a download of your own channel data (Google Takeout or YouTube Studio export) plus the public RSS feed for the titles, and keeps the API only for the thumbnail, views, duration and embed flags (D-016 item 2, Option B). We decide together then.

**Before you send.** Tell Claude the day you will send it. Claude re-reads the three policy pages that day, because the Developer Policies page was last updated on 2026-10-15 and the pages change often (VF-C25).

---

# Part B - The question (ready to paste)

**Title:** Policy interpretation question before launch: parsing public video titles into archive pages (not a quota request)

## Short version

I own the YouTube channel Power Smash (@PowerSmash). I am building an archive website of my channel's public Tamil Nadu badminton tournament videos. The site reads video data with a server-side API key. It shows the title and thumbnail unmodified, and beside them a separate block labelled as my own data in which my software has read out players, tournament, category and round from the title text. I have no composite scores and no view-based rankings, I refresh API data within 30 days, and sponsor slots sit beside the player only on pages with substantial content of my own. I am not asking for more quota. I would like a written answer on whether this is permitted: derived data (III.E.4.h), unmodified titles, 30-day storage, sponsorship on pages with API data (III.G.1.d), and a separately sold HD file (III.F.3.a). The full description and the specific questions are below.

## Full text

**1. Who I am and what I am asking**

- I own the channel Power Smash (handle @PowerSmash, channel ID UCRhIwO47uhJIM5Iw4uybcFQ; about 88K subscribers and 1.9K videos as shown publicly, rounded). I also operate the website described below. Name: `TODO(owner)`. Google Cloud project: `power-smash`, project number `TODO(owner)`.
- This is a policy-interpretation question. I am not requesting more quota. I would like a written reply before the archive pages go public.

**2. How the API is used**

- Server side only, with an API key restricted to the YouTube Data API v3. No OAuth and no user data. Calls: `channels.list`, `playlistItems.list` and `videos.list` (snippet, contentDetails, statistics, status, liveStreamingDetails). No `search.list`. One catalogue read of about 75 to 110 quota units, then about 20 units a day.
- Fields kept: title, thumbnail URL, duration, view and like counts, published date, embeddable and made-for-kids flags, content rating, region restrictions, live status.

**3. What the website does**

The site is an archive of the public tournament videos on my channel. Each match video has a page that:

- embeds the YouTube player (click to load, one tap starts playback, nothing placed over or inside the player, plus a "Watch on YouTube" link);
- shows the video's title exactly as the API returns it, and the unmodified thumbnail from i.ytimg.com;
- shows the view count as returned, labelled "YouTube views";
- shows a separate block labelled "Match details by Power Smash": player names, tournament, category, round and year. My own software reads these out of the title text; they are my own records, keyed by the video ID, and I can correct them by hand. Example of an invented title (not a real one): `S. KUMAR/R. VIJAY vs M. ARUN/K. RAJESH || MD Senior SF - Example District Championship 2026, Madurai`;
- links to player and tournament pages, which are my own pages listing those records.

To decide which videos get a match page, my software also classifies each video as a match, a Short, a live replay or other, using title patterns, duration and which of YouTube's own playlist types (uploads, Shorts, long-form, live) the video belongs to.

What the site does not do: no composite score, no ranking built from views, no totals of views per player, no "most viewed in 30 days" figure. Lists may be sorted by the YouTube view count as returned.

**4. Refresh and storage**

Each video's API data is stored with the time it was fetched and refreshed at least weekly (view counts normally daily). Data not refreshed within 28 days is hidden from the site, and I intend that stored API data is refreshed or deleted within 30 calendar days. Channel-level statistics are kept for at most 30 days. Videos found removed, private or not embeddable are taken off the public pages.

**5. Money and sponsors**

- I offer filming and live-streaming of tournaments to organisers and plan to sell sponsorship to local businesses. Sponsor slots are static images, labelled "Sponsored" or "Ad". They sit beside the player, never over or inside it and never on the thumbnail.
- Slots appear only on pages with substantial content of my own, such as tournament pages and player pages. A banner on a match page appears only if that page passes an independent-value test, and it is off by default.
- No one is charged to watch a YouTube video and watching is never gated.
- Separately, I may sell a high-definition file of a match from footage recorded by Power Smash, delivered by download outside YouTube. The YouTube version stays free to watch. A button on the match page opens a WhatsApp enquiry; payment happens off the page.

**6. My questions**

1. **Derived data (III.E.4.h, and the Developer Policies Guide on derived data).** Is it permitted to read structured facts (players, tournament, category, round, year) out of the title text the API returns, store them as my own records, and show them in a block clearly labelled as my own data beside the unmodified API data? Is classifying videos as match, Short, live replay or other from title patterns, duration and YouTube's playlist types allowed, given that the guide lists inferring content categories as something not to do? If permission needs a formal amendment or audit, which one, and through which form?
2. **Combining with my own data (the guide's section on merging data).** A player page lists and counts the matches in my records and shows each video's YouTube data (title, thumbnail, views) beside them, clearly distinguished. I compute no scores or view-based totals. Is that acceptable?
3. **Titles and thumbnails (the guide's rule that title and thumbnail must be visible and unmodified).** On a video's own page I show the title unmodified, with my labelled details below. On cards and lists, may I show a heading built from my parsed details (for example "A vs B") with the unmodified title one tap away on the video's page, or must the unmodified title appear wherever the video is listed?
4. **Storage (III.E.4.d and the rule to display the most updated data, III.E.4.f).** Please confirm that title, thumbnail URL, duration and statistics fetched with an API key may be stored for up to 30 calendar days and must then be refreshed or deleted. Do the records I created from title text count as stored API data under that rule? If a video is later removed or made private, must the player and tournament details that came from its title also be deleted?
5. **Sponsorship on pages with API data (III.G.1.d, and III.G.1.c on ads in or on the player).** What counts as enough independent value? Does a tournament page with my own organiser, venue and category information, plus a list of matches, count? Do my parsed "Match details" count as content not obtained from YouTube, or are they treated as derived from API data? Is a static sponsor image beside, not over, the player acceptable on a page that passes that test?
6. **Charging (III.F.3.a, and the guide's rule on fees for services that are free on YouTube).** Is selling a separate high-definition file of a match, delivered outside YouTube while the YouTube video remains free to watch, permitted, including a button on the match page that opens an enquiry?
7. **If the answers are no.** Would it be treated differently if I take the titles for parsing from an export of my own channel data (Google Takeout or YouTube Studio) and the public RSS feed, and use the API only for thumbnail, views, duration and embed flags? Does it change any answer that I own the channel and operate the site, for example if I authorise the site with OAuth for my own channel?

**7. What I am doing meanwhile**

The archive pages are not public yet. I show the title and thumbnail unmodified, label my data as mine, build no composite or view-based scores, keep API data within 30 days, keep sponsor slots away from the player and limited to pages with substantial content of my own, and never charge to watch. I will change the design to follow your answer.

**8. Request**

Please reply in writing to the email address of this Google account, and say if any of the above needs a different process (an amendment, an audit or a call). Thank you.

---

# Part C - What was checked, and where (for Claude and the lead)

Read on 2026-10-20 through a summarising fetch tool (paraphrases, not verbatim text). Re-read the live pages on the day the owner sends this.

| Item | Source | What the live page showed |
|---|---|---|
| Developer Policies, last updated 2026-10-15 UTC | https://developers.google.com/youtube/terms/developer-policies | III.E.4.d: non-authorized data stored at most 30 calendar days, then delete or refresh. III.E.4.f: display the most updated data, historical data acceptable if time-contextualised. III.E.4.h: no replacing API data with independently calculated data, no creating new or derived data or metrics; clear and prominent disclosure where non-YouTube data is shown beside API data. III.F.3.a: no charging to watch the embedded player; III.F.3.b: no gating video behind actions other than play. III.G.1.c: no ads or sponsorship on the audiovisual content or player without written approval. III.G.1.d: no ads or sponsorship on pages with API data unless other valuable content is present. Section numbers match VERIFIED_FACTS (VF-C3 to VF-C5); III.E.4.f, III.F.3.b and III.E.4.j (Made For Kids status check) are new to this file. |
| Developer Policies Guide, last updated 2026-09-14 UTC | https://developers.google.com/youtube/terms/developer-policies-guide | Title and thumbnail must be visible and unmodified (custom play buttons over the thumbnail are fine). Derived data: simple combinations of API data only are fine; merging with other sources, inferring content categories, ranking channels' views and custom channel scores are listed as prohibited. No fee for services that are free on YouTube. Developers unsure about compliance are told to apply for an API Compliance Audit through the form. |
| Derived Metrics Policy, last updated 2026-09-14 UTC | https://developers.google.com/youtube/terms/derived-metrics-policy | An amendment route, applied for through a form under the "Analytics & Reporting" use case; for approved developers it allows custom scores, content tagging, leaderboards and storing statistical metrics for up to 36 months. The page shows no section id (VF-C4 records it as III.L, effective 2026-06-01: unconfirmed). Power Smash is not an analytics product, so this route probably does not fit, but it is named here in case YouTube points to it. |
| Contact route | https://support.google.com/youtube/contact/yt_api_form ; https://developers.google.com/youtube/v3/support | The form is the "YouTube Data API Services Audit and Quota Extension Form"; its two choices are compliance audits (more quota; or keep quota after a re-audit); sign-in encouraged, not required; it asks for organisation details, business model, API client details, Cloud project numbers, screenshots of privacy policy, homepage and terms, and a demo login or screencast. The support page lists the issue tracker (bugs and feature requests) and policy documents only, with no response time. |

Notes for the lead:
- `OWNER_TODO.md` OT-16 says to use "the contact form it links for compliance questions". The only linked form is the audit and quota-extension form above; there is no dedicated policy-question form. Part A says so.
- D-033 classifies videos by title, duration and playlist membership. The Policies Guide lists inferring content categories as a "do not". D-016 does not address this; the draft discloses it (Part B, questions 1) so it is asked rather than hidden.
- D-016 item 5 hides API-derived fields at 28 days. Part B states the intent that stored API data is refreshed or deleted within 30 days, which is what III.E.4.d requires. The build must match what is told to YouTube.
- The example title in Part B is invented (modelled on the spec's section 10.8 format). Real titles contain real players' names and must never be sent to any web service.

---

# Part D - What each answer means for the build

| YouTube's answer | Build consequence |
|---|---|
| Parsing and labelled "by Power Smash" data are fine | Keep D-016 as built; record the reply in `docs/`. |
| Parsing is fine only with an amendment or audit | Owner decides whether to apply; the archive launch (G2) waits or the owner accepts the risk in writing. |
| Parsing is not allowed | Option B (D-016 item 2): titles from Takeout or Studio export plus RSS; API only for rendering fields. Re-plan M2b. |
| Raw title must appear everywhere a video is listed | Cards show the raw title; parsed headings only in the labelled block. |
| Parsed fields count as API data under the 30-day rule | Refresh or delete on the same 30-day clock; player and tournament records tied to live videos. |
| Sponsor strip not allowed on match pages, only on pages with independent content | Matches D-016 item 6; match-page banner stays off. |
| HD file service not allowed or restricted | Remove the match-page button; offer the service only off video pages. |
| Generic reply or no reply | Owner decides whether to accept the residual risk (D-016 item 10); the build stays on the safeguards. |
