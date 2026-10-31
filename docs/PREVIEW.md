# PREVIEW - how to open the private preview on your phone

Plain English for the owner. Written 2026-10-22 for the Vercel host (decision D-097). The preview is a copy of the site with **made-up data** that only people logged in to your Vercel account can open. It may show red "TODO" gap badges on purpose: that is what lets you review unfinished pages. The real, public site is a different thing (strict build, real domain, Vercel Pro).

Facts below come from Vercel's own pages as recorded in `docs/VERIFIED_FACTS.md` (VF-V2, VF-V7) and the deploy notes in `docs/m3/vercel-deploy-notes.md`. Anything marked **unverified** has not been tried on a real Vercel account yet; the first preview is the test, and if a screen looks different, tell me what you see (never a password or a key).

## Made-up competitions on the preview (development project only)

The preview's `/competitions/` pages (draws, order of play, results, rankings) read the **development** Supabase project. It starts empty, so those pages show nothing until you add the made-up competition data once. Everything in it is invented: "Demo" players such as "Demo Arun Fakeson", towns called Sampleville and Fakenagar, tournaments called "Demo Lakeside Open", "Demo Riverside Championship" and "Demo Schools Cup". No real player, club, hall or place; no phone number or email.

**Add it (once):**
1. Open supabase.com, the **development** project (never the live one), **SQL Editor**, **New query**.
2. Open `supabase/demo/competition-demo.sql` in the repository (GitHub app or website), copy the whole file and paste it into the editor.
3. **Before Run**, find the line with `PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE` (near the top) and put the **development** project's reference there in place of that text (the short code in the development project's web address; it is not a secret). This is the safety catch: as it is in the repository the file refuses with "this does not look like the development project" and adds nothing, so a paste into the live project by mistake does nothing. Then tap **Run**.
4. It should say `DEMO: added 3 made-up tournaments ...`. If it says the data is already there, nothing was changed. If it says no owner account was found, finish the owner sign-in set-up first (OT-51).
5. Run the **Preview** job again (a preview reads the data when it is built).

**What the preview then shows:** one finished tournament (two weeks ago) with men's singles, mixed doubles and an under-15 boys' event, every result in (one walkover, one player who retired); one tournament in ten days with draws and an order of play but nothing played yet (including a round robin and a draw with byes); one School/college tournament. Some players show as **"Protected player"** on purpose: the under-15 event, everyone in the School/college tournament, the players whose age is not confirmed and a pair with a player who may be under 18. One local men's singles ranking is shown: for this the add step switches **public rankings on in the development project only** (the live project is never touched).

**Take it away again:** the same way, with `supabase/demo/competition-demo-remove.sql`. It needs no change before Run. It removes only the demo rows and puts the rankings switch back as it was. If there is no demo data (it was already removed, or this is the wrong project), it says so and changes nothing at all. If it refuses with a message, something real points at the demo data (for example you entered a real player in a demo event); nothing was removed, tell me what it says. The admin's history log keeps its lines about the demo (that log can never be edited), which is expected.

**Dates go stale:** the dates are set on the day you add the data. Once the "in ten days" tournament has passed (and ten days later the School/college one), the preview shows tournaments that look upcoming but are already over. To refresh them, run the removal, then the add step again (with the reference line filled in), then the Preview job.

## Before the first preview (one time)

1. OT-01 done (repository on GitHub) and OT-02 done (Vercel account, project, the three deploy values stored as GitHub secrets; the project is made from the command line with **no repository connected**, so Vercel's own Git deploys cannot publish anything, and the function region is Mumbai). Hobby (free) is fine for a private preview. The live site needs Pro (OT-02, D-097).
2. OT-03 done (the development Supabase project) and the Turnstile test or dev widget (OT-41), so the preview has made-up data. These are four public values stored as GitHub **variables**: `PREVIEW_PUBLIC_SUPABASE_URL`, `PREVIEW_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PREVIEW_PUBLIC_TURNSTILE_SITE_KEY` and `PREVIEW_PUBLIC_WHATSAPP_NUMBER` (the business number, so every WhatsApp button works on the preview). They are not secrets. All four were set on 2026-10-25.
3. In the Vercel project, under the **Preview** scope of Environment Variables, the development server settings are present (the list is in `docs/SECRETS.md`), including `TURNSTILE_ALLOW_TEST_KEYS` = `true` **only under Preview, never under Production**.
4. In the Vercel project, Settings, **Deployment Protection**: **Vercel Authentication** is on and set to **All Deployments** (not Standard Protection). Standard Protection leaves the production address public, and the first deployment of a new project becomes the production deployment even without `--prod` (this happened on 2026-10-23, VF-V11). The Preview job now checks this and stops if it is not so. Do not switch it off. A new project starts with it on (seen on a real Hobby project on 2026-10-23, Standard Protection), but still look at the screen.
5. In GitHub, set the variable `PREVIEW_ENABLED` to `true` (OT-48). Only you do this, after I tell you.

## Start a preview (phone is fine)

1. Open the GitHub app or github.com, the `power-smash` repository, the **Actions** tab.
2. Tap **Preview** in the list of workflows, then **Run workflow**, pick the branch I tell you, tap the green **Run workflow** button.
3. Wait for the green tick (a few minutes; the build is slow, the first one the slowest). If it shows a red cross, tap it and send me the name of the failing step (not the whole log if it could hold a key; the log never prints secrets, but check before pasting).
4. Tap the finished run, the **Deploy a Vercel preview** step, and find the address that ends in `.vercel.app`. Or send me "preview done" and I give it to you from the log.

## Open it

1. Tap the address. Vercel shows a **Log in to Vercel** screen: that is the protection working. Log in with the account that owns the project (two-step verification on, OT-14).
2. You then see the Power Smash pages. Expect: a "Sample data" banner on the archive, red TODO badges where your input is missing, no real WhatsApp number, and forms that talk to the development database only.
3. Search engines are told not to list it: Vercel adds a "noindex" header to previews by itself (VF-V2) and our build adds its own.

## Rules for the preview

- **Do not share the address as if it were public.** Strangers see the Vercel login and cannot get in. To let someone else look, **invite them to your Vercel team** (Pro charges per seat, VF-V3) rather than turning protection off. Do not create "shareable links" unless I tell you how and for how long.
- Preview data is made up. Never put real players' names, your real WhatsApp number or your personal Gmail into it.
- The preview never uses your real domain and never replaces the live site. Production changes only through the strict deploy job.
- An uptime monitor cannot see a protected preview (it would hit the Vercel login). Monitors are set up after the real domain is live (OT-44).
- A new Environment Variable value applies to **new** previews only: after changing one in Vercel, run the Preview job again.

## Remove or stop previews

- To stop new previews: delete the GitHub variable `PREVIEW_ENABLED` (or set it to anything but `true`).
- Old preview deployments can stay; they are protected and noindex. To delete one, Vercel dashboard, the project, **Deployments**, the deployment, the menu, **Delete** (this is destructive: ask me first if unsure).
- Vercel Hobby allows 100 deployments a day and Pro 6,000 (VF-V3): not a concern for a private preview.

## What can go wrong

| What you see | What it means | What to do |
|---|---|---|
| The Preview job is skipped (grey) | `PREVIEW_ENABLED` is not `true` | Set it (OT-48) |
| Red cross at "Deploy a Vercel preview": "Deploy credentials are missing" | One of the three GitHub secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) is not stored | Re-check OT-02 step 7 |
| Red cross at the Vercel CLI step with another message | The CLI could not run with only the ids (**unverified**) or the token expired | Tell me the one-line message; the fix is mine or a new token (OT-02) |
| The address opens without a Vercel login | Protection is off, or set to Standard Protection (which leaves the production address public) | Switch Vercel Authentication on and choose **All Deployments**, and tell me; treat the preview as public until then |
| "Deployment Protection" screen asks you to request access | You are logged in with another account | Log in with the owner account |
| Forms say "temporarily unavailable" | Preview-scope settings (dev Supabase, Turnstile test settings) are missing | Check step 3 of "Before the first preview" |
