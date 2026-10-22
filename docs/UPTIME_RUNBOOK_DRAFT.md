# Uptime runbook (DRAFT)

Status: draft written 2026-10-21 for BUILD_PLAN M1 item 8, decision D-039 and task OT-44. **The monitoring tool is NOT chosen.** That choice belongs to the owner (D-039); the options and the recommendation are in `docs/UPTIME_MONITOR_OPTIONS.md`. Wherever this page says "the monitor" it means whichever tool the owner approves. No free-plan limit is quoted here on purpose: read each limit on the tool's own sign-up screen on the day you sign up, because free plans change.

Plain English first, technical notes at the end. Nobody but the owner signs up, pays or enters a password (Claude never does).

---

## 1. What this is for

If the enquiry form or the home page stops working, nobody tells you, and you silently lose enquiries (that is lost money). A monitor is a free robot that opens two web addresses every few minutes and messages you if either fails. It is separate from the video-sync alarm planned for M2 (D-008), which only watches the sync.

## 2. What is watched

| What | Address | The monitor expects | Why this address |
|---|---|---|---|
| Home page | the home page of the site | a normal answer (HTTP 200) and one word that must appear on the page | The home page is a plain file served by Cloudflare. If it fails, the whole site or its publishing is broken. The word check catches a page that loads but is wrong or empty. |
| Enquiry health | `GET /api/health` on the same site | a normal answer (HTTP 200) and the exact text `"lead":"ready"` (with the quotes) | This is the small address of the enquiry system. It writes nothing, reads no database and shows no secret. It answers with a short status. When a deployment has lost the secrets the form needs, it says `"lead":"unconfigured"` and `"ready":false`, so a check for the exact text `"lead":"ready"` raises the alarm before a customer notices (a check for the bare word `ready` would NOT, because `"ready":false` contains it) (visitors would still be sent to WhatsApp by the form's fallback, but you want to know). |

Which site address: until the real domain is live (D-023) there is no public address a monitor can reach (a `.vercel.app` preview is behind a Vercel login, D-097), so the monitor is set up at launch. At G1 the monitor is pointed at the production address, and the drill below is repeated (section 5). The exact addresses and the two words are given to the owner in chat when the site is deployed; the home page word is chosen once the pages are final (for example the business name, which is always on the page).

Notes: `/api/health` is not cached and is marked noindex (D-029, D-039). The home page is a static file, while `/api/health` runs a Vercel function (D-097). So pick a modest check interval for that one when the tool lets you choose; a faster interval buys almost nothing for a form that gets few enquiries a day.

## 3. Where alerts go

Both channels, always (D-039):

1. **Telegram**, through the monitoring tool's own Telegram connection (usually a link to the tool's own bot that you press Start on). **Never give the tool the token of your own Power Smash Alerts bot** (OT-08, OT-44). If a tool insists on that token, stop and tell Claude; we choose another tool.
2. **Email** to the business Gmail (OT-14).

Why both: if Telegram has a problem, the email still reaches you, and the other way round.

## 4. Setting it up (owner, on the phone)

The tool-specific steps are in `docs/UPTIME_MONITOR_OPTIONS.md` (written for the tool Claude recommends) and in `docs/OWNER_TODO.md` OT-44. In outline, whichever tool is approved:

1. Sign up with the business Gmail; turn on two-step verification; if any screen asks for a card or a payment, stop and tell Claude.
2. Connect Telegram through the tool's own bot and add your business email as the second contact.
3. Add the two monitors from section 2, each with both alert contacts.
4. If the tool has a "send test notification" button, press it and check both channels.
5. Put a repeating reminder in your phone for anything the tool requires to keep the free plan alive (for example a periodic login), if its own terms say so.
6. Tell Claude "monitors added". Claude never signs up for you.

## 5. The alert drill (required before G1)

BUILD_PLAN M1 item 8 and D-039 want proof, before the site goes public, that a real failure reaches you on **both** channels. Do this once the monitors exist and the test site is on its `workers.dev` address.

**Rule: never break the live site for a drill.** Do not deploy a failing build and do not change the site. Use one of these two harmless methods.

- **Method A (no change at all, preferred).** In the monitor, add a THIRD monitor pointing at an address on the same site that does not exist, for example `/drill-this-page-does-not-exist` (the site answers 404, which the monitor treats as a failure). Give it the same two alert contacts.
- **Method B (edit one setting).** Edit the keyword of the `/api/health` monitor to a word that is not in the answer (for example `drillwordabsent`). The monitor then reports "word not found" and counts it as down. Put the real word back afterwards.

Steps:

1. Agree a time in chat. Keep your phone nearby with Telegram and email open.
2. Note the clock time, then switch on Method A or B.
3. Wait for the alert. The wait depends on the check interval and on how many failed checks the tool needs before it alerts; both are settings you can read in the monitor. Do not touch anything meanwhile.
4. Write down for each channel: did a message arrive, and at what time? (Telegram: time; email: time and whether it landed in the inbox or in spam.)
5. Switch the drill off (delete the third monitor, or restore the keyword). Wait for the "back up" messages if the tool sends them, and write down whether they arrived.
6. Send Claude the four facts: Telegram arrived yes or no and when; email arrived yes or no and when; the recovery messages yes or no; the monitors show "up" again.

**Pass:** both the Telegram message and the email arrived, the monitors are back to normal, and the drill setting is removed. **Fail:** anything else. Do not go live (the drill is on the G1 list); fix the contacts or the tool settings and run it again.

Record the date and result in `docs/RUNBOOK.md` when it exists (M4).

Repeat the drill when: the monitors are moved to the real domain at the cut-over (D-023); an alert contact changes (new email or new Telegram connection); the tool changes; the `/api/health` address or its answer changes.

## 6. When a real alert arrives

1. On your phone open both addresses from section 2. Which one is failing?
2. **Home page down, health fine:** the static site or its publishing has a problem. Tell Claude; check the last run on GitHub (Actions, the Deploy workflow). A failing gate keeps the previous version live (D-008), so a red run usually means the old site is still up and something else is wrong.
3. **Health says `unconfigured`:** a deployment lost the form's secrets (Vercel project, Settings, Environment Variables). The form shows visitors the WhatsApp fallback meanwhile. Tell Claude; with your yes the secrets are checked and re-entered by you (Claude never sees them).
4. **Both down:** check Vercel's status page and the Vercel project (is the latest deployment healthy, was the plan changed?), then tell Claude. A rollback (Vercel Instant Rollback, unverified, or deploying the previous commit through the Deploy workflow) is done with your yes (D-008).
5. Write down what happened and when, so the lesson goes into the RUNBOOK (M4).

## 7. If no free tool fits

D-039's fallback: a scheduled check from our own system (a scheduled GitHub workflow or a Vercel cron route) that calls the same two addresses and alerts through the same two channels. It is weaker, because it can fail together with the platform it watches, so it is a stop-gap only. We decide together if that happens; nothing is built for it until then.

## 8. Technical notes (for Claude and developers)

- `GET /api/health` (`src/pages/api/health.ts`, logic in `src/lib/leads/health.ts`, owned by the Lead-backend worker): GET and HEAD, no outbound call, no database access, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`. A test asserts it writes no row (BUILD_PLAN M1 tests). Its JSON body carries `ok`, `service`, `lead` (`ready` or `unconfigured`), `ready` (true or false) and, when not ready, a one-word `reason` (`missing_secrets`, `supabase_url` or `turnstile_test_key`; it also carries `testMode:true` if the spam-check test key is ever switched on in production). **The monitor keyword must be the whole text `"lead":"ready"` (quotes included), not the bare word `ready`:** the bare word also appears in `"ready":false`, so a plain `ready` check would stay green during a failure (found by the Lead-backend fix worker, P-F5). If the tool supports "alert when this text is present", also alert on `"ready":false`.
- The function's security headers (CSP and the rest) reach the health answer through `src/middleware.ts`; nothing in them affects a monitor.
- Open items, all the owner's or the lead's: the tool choice (D-039, OT-44); the two keywords once the pages are final; the production addresses at G1; the first drill; the date of the first drill in the RUNBOOK.
- Not verified here, deliberately: any free-plan limit, check interval, card requirement or commercial-use clause of any tool. Read them on the day, on the tool's own pages (`docs/UPTIME_MONITOR_OPTIONS.md` records what was read on 2026-10-21 and where).
