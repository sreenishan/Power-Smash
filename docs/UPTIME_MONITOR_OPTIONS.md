# Uptime monitor: which free tool to use (for the owner)

Written 2026-10-21 for decision D-039 and task OT-44. Plain English. I read each company's own pricing and terms pages today; the web addresses are at the bottom so you can check them yourself. Free plans change often, so before you sign up, look at the screen you see and tell me if it differs from what is written here.

## What a monitor is, and why we need one

A monitor is a free robot that opens a web address every few minutes. If the address stops answering, it sends you a message. We need two:

1. Your home page.
2. A small health address on the enquiry system (`/api/health`). It only answers "OK" and writes nothing.

Without this, the enquiry form could break and nobody would notice until a customer told you. The alarm already planned for video syncing does not cover this, and neither does the planned Cloudflare timer (it runs on the same platform it would be watching, so if that platform stops, the timer stops with it and says nothing).

## My recommendation

**Use HetrixTools, on its free plan.** It is the only one of the four I checked whose free plan sends alerts to both Telegram and email, which is what the plan asks for (D-039).

Why, in short:

- Free plan: 15 monitors, checks every minute, alerts by email and Telegram (and other apps) with no paid plan needed.
- Telegram works through HetrixTools' own Telegram bot, so you never share the token of your own Power Smash Alerts bot (that stays private, as OT-44 requires).
- It can look for a word on the page, so it notices if a page loads but is wrong.

Things to know before you say yes (I have not hidden the downsides):

- **Log in at least once every 90 days.** The free plan is free for life only if you do. HetrixTools emails you a warning when you are close. Put a repeating reminder on your phone.
- Its terms do not say anything about business use on the free plan. They do not forbid it either. If you want it in writing, ask their support before relying on it.
- Free support answers tickets within about a day, after paying customers.
- It keeps 15 days of activity log on the free plan. That is enough for alerts; we only need to know "is it down now?".
- Whether it asks for a card at sign-up is not stated on its pricing page. If it asks for a card or any payment, stop and tell me (OT-44).

## The four options side by side

Checked on 2026-10-21 on each company's own pages. "Free plan" means the plan that costs nothing.

| | HetrixTools (recommended) | UptimeRobot | Better Stack | Cloudflare health checks |
|---|---|---|---|---|
| Free monitors | 15 | 50 | 10 (shared with "heartbeats") | None on the free plan |
| How often it checks | every 1 minute | every 5 minutes | every 3 minutes | not available |
| Telegram alert on free | **Yes** | **No** (needs a paid plan) | **No** (not built in) | not available |
| Email alert on free | Yes | Yes | Yes | not available |
| Other free alerts | Slack, Discord, webhooks and more; text/phone alerts cost 10 cents each | Phone app alerts, Discord, Pushover, Google Chat and a few more | Slack | not available |
| Looks for a word on the page | Yes | Yes | Yes | not applicable |
| Business use on free | Terms are silent | Terms say yes ("any use, including commercial"); its pricing page calls the free plan "for hobby and non-profit projects", so the two pages disagree | Pricing page says "free for personal projects"; terms are silent, so unclear | not applicable |
| Card needed to sign up | Not stated | No ("No credit card required") | Not stated | not applicable |
| History kept on free | 15 days of activity log | 3 months | Not stated | not applicable |
| Catch | Log in every 90 days | No Telegram on free | No Telegram on free | Paid plans only, and needs the domain on Cloudflare |

What this means:

- **UptimeRobot** is the big well-known name and its terms allow business use, but its free plan cannot send Telegram alerts. On free you would get email plus the UptimeRobot phone app. That fails the "Telegram and email both" rule in D-039, so it is the fallback only if you decide email plus phone app is enough.
- **Better Stack** is a good product but its free plan is aimed at personal projects, has no Telegram, and has only 10 monitors. Third choice.
- **Cloudflare's own health checks** are not available on the free Cloudflare plan, so they are out. (Cloudflare's other free alerts are about billing, attacks and certificates, not "is my Worker answering".)
- The old **Worker timer** plan (D-008; now a parked Vercel cron or a GitHub schedule, D-097) is not a monitor. It is the stop-gap if no tool fits, and it is weaker for the reason above.

## How many requests will the monitor cost us?

The home page is a plain file. Only `/api/health` runs a Vercel function. (The old 100,000 requests a day Cloudflare limit no longer applies, D-097; Vercel's own usage allowance and overage rates are on its pricing page and the Pro credit amount is not verified, VF-V3.) At one check a minute from one place that is 1,440 a day; HetrixTools can check from up to 4 places, which could be up to about 5,800 a day if each place checks every minute (their page does not say exactly how it splits). That is small next to normal traffic. If HetrixTools lets you pick a longer gap such as 5 minutes, pick it: it cuts this to about a fifth and we lose almost nothing.

## Steps if you choose HetrixTools (on your phone)

I never sign up or pay for you. You do these, I wait in chat. Do not paste any password or code into chat.

1. Open your phone browser and go to `hetrixtools.com`. Open the pricing page, find the plan called **Free**, tap **Start free**.
2. Sign up with the business Gmail (OT-14). Use a new password stored in your password manager. If the screens offer two-step verification, turn it on. If any screen asks for a card or payment, stop and tell me.
3. Open Telegram. In the search box type `hetrixtools_bot` and open it. Tap **START**. The bot replies with your Chat ID (a number). Copy it.
4. Back in HetrixTools, open the menu and tap **Contact Lists**. Open **Default Contact** (it already holds your email). Find the **Telegram** box, paste the Chat ID, tap **Save**. If you see a **Send test notification** button, press it and tell me if the test reached both Telegram and your email.
5. Open the menu, tap **Uptime Monitors**, tap **Add Monitor**, choose **Website**.
   - Monitor Name: `Power Smash home page`.
   - Website Link: the home page address I give you in chat (a private `.vercel.app` preview address is behind a Vercel login and a monitor cannot reach it: sign up for the monitor once the real domain is live).
   - Contact List: Default Contact.
   - Locations: leave what it suggests (up to 4 are allowed on free).
   - Keyword: I will give you one word that must appear on the page (optional but useful).
   - If it shows **Advanced Settings** and a **Checkup Frequency**, choose 5 minutes if it offers it.
   - Tap **Add Monitor**.
6. Do step 5 again for the second monitor: Name `Power Smash enquiry health`, Website Link = the `/api/health` address I give you, Keyword = the word I give you for it.
7. Wait a couple of minutes, tap **Refresh Table**, and tell me both show as up.
8. Set a repeating reminder on your phone every 60 days: "Log in to HetrixTools".
9. Before launch I will make the health address fail once on purpose. You tell me whether both the Telegram message and the email arrived. That is the test D-039 asks for.
10. If any screen looks different from what I described, tell me what you see. If no free option works for you, say so and we use the weaker stop-gap check from our own system.

When the real domain goes live (G1) we change the two addresses in the same screens; I will tell you the new ones.

## If you prefer UptimeRobot

It works with email only (no Telegram) on the free plan: sign up at `uptimerobot.com`, add the same two addresses as "HTTP(s)" monitors, alert contact = your email, and install their phone app for push alerts. Their free plan checks every 5 minutes, keeps 3 months of history and says "No credit card required". You would be accepting that Telegram is not part of the monitor alert (your own Power Smash Alerts bot still tells you about new enquiries). Tell me if you want this route and I will write the exact steps.

## What I need from you

Reply in chat with one of: "HetrixTools", "UptimeRobot", "Better Stack", or "none, use the stop-gap". D-039 then becomes adopted.

## Where I read this (all on 2026-10-21)

- HetrixTools pricing: https://hetrixtools.com/pricing/uptime-monitor/ ; terms: https://hetrixtools.com/terms-of-service/ ; Telegram steps: https://docs.hetrixtools.com/telegram-integration/ ; website monitor steps: https://docs.hetrixtools.com/add-a-website-uptime-monitor/ ; 90-day rule: https://docs.hetrixtools.com/free-accounts-inactivity/
- UptimeRobot pricing: https://uptimerobot.com/pricing/ (machine-readable copy https://uptimerobot.com/pricing.md) ; terms: https://uptimerobot.com/terms/ ; fair use: https://uptimerobot.com/terms-fair-use
- Better Stack pricing: https://betterstack.com/pricing ; check frequency: https://betterstack.com/docs/uptime/check-frequency/ ; terms: https://betterstack.com/terms
- Cloudflare health checks: https://developers.cloudflare.com/health-checks/ ; notifications list: https://developers.cloudflare.com/notifications/notification-available/
