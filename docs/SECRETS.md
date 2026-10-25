# SECRETS - where each secret lives, who may see it, how to rotate it, and what to do if one leaks

Implements decision **D-027** (`docs/DECISIONS.md`). Names only: no secret value appears in this file, in `.env.example`, in the repository or in chat. Hosting moved from Cloudflare Workers to Vercel on 2026-10-22 (D-097): "Worker secret" below now means a **Vercel environment variable**, the Cloudflare deploy token and account id are replaced by the three Vercel deploy values, and Cloudflare keeps only the Turnstile secret key. Status as of 2026-10-21: M0 built, M1 built and reviewed; most of the secrets below do not exist yet and are created as the milestones reach them. **Rule since M0: Claude never sees, types, pastes or pipes a secret value. The owner enters every secret, either on the vendor's own screen (phone) or by running the loader at the PC.** (D-027's earlier wording, "Claude pipes secrets into gh and wrangler", is replaced by this rule; there is no wrangler any more, D-097.)

Part 1 is for the owner, in plain English. Part 2 is technical, for Claude Code and any developer.

---

# Part 1 - For the owner

## The five rules

1. **Never paste a password, API key, token, card number, OTP, PAN or Aadhaar number into our chat, a screenshot you send, an email or a WhatsApp message.** Chat is saved. If you do it by mistake, say so at once and we replace the key; that takes minutes.
2. **Type secrets only into the website they belong to** (the GitHub, Vercel, Cloudflare Turnstile or Supabase screen), or, at the PC, into the small file `.secrets.local` that is never uploaded, and then run the loader yourself. Nowhere else. **Claude never types a secret for you and never sees one**: its own safety rules forbid it, so you do every entering step.
3. **Providers show a key once.** Copy it, paste it straight into the right screen, and if you lose it just make a new one.
4. **Recovery codes and the backup key go on paper or in your password manager,** not in a notes app and not in chat.
5. **If in doubt, treat it as leaked and replace it.** Replacing a key is cheap. A leaked one can empty accounts or expose people's data.

## What is a secret and what is not

| Safe to share with Claude in chat | Secret: never share |
|---|---|
| Vercel organisation id and project id (identifiers), Supabase project reference, Supabase URL | Anything called a token, secret, password or key, with the exceptions on the left |
| The Supabase **publishable** key (starts `sb_publishable_`) and the Turnstile **site** key (both are meant to be public) | The Supabase **secret** key (starts `sb_secret_`), Turnstile **secret** key |
| The YouTube channel ID, the official WhatsApp number, the `age` **public** key | API tokens, bot tokens, the database connection string, the backup **private** key |

If you cannot tell, ask first and do not paste.

## How to enter a secret from your phone

Claude tells you the exact name to give each secret (for example `YOUTUBE_API_KEY`). Type the name exactly, with no spaces. The full step-by-step is at the top of `docs/OWNER_TODO.md`; in short:

- **GitHub secret:** open the `power-smash` repository, then Settings, Secrets and variables, Actions, the Secrets tab, New repository secret. Name in the Name box, value in the Secret box, Add secret. GitHub never shows the value again.
- **Vercel environment variable** (once the Vercel project exists, OT-02, and Claude tells you): Vercel dashboard, the `power-smash` project, Settings, Environment Variables, Add. Type the name, paste the value, tick only the scope Claude names (**Production** for the live site, **Preview** for tests), and where Vercel offers a **Sensitive** option turn it on for secrets (Vercel docs: secret-type values cannot be read back after saving). Save. **A saved value applies only to deployments made after you save it**, so ask Claude to redeploy (VF-V7).
- A few values are not secret and go in as GitHub **variables** (same screen, Variables tab). Claude tells you which.
- Screens change now and then. If a screen looks different, tell Claude what you see, never the secret itself.

**The `.secrets.local` file and the loader (at the PC, optional).** One line per secret in the form `NAME=value`, saved inside the project folder. It is listed in `.gitignore`, so it is never uploaded. A small loader program now exists (`scripts/load-secrets.mjs`; it has only ever been tested with made-up values, so your first run is its first real one). **You run it yourself** at the PC, in two steps. First `npm run secrets:load -- --dry-run`: it shows only names and where each would go, and sends nothing. Then `npm run secrets:load -- --repo <your-github-name>/power-smash` (Claude gives you the exact line): it copies each value to GitHub and to the **Production** scope of the Vercel project without printing it (use `--only vercel` or `--only github` to send to one place). It needs you to have signed in once to each tool at the PC (`gh auth login` for GitHub, and, for Vercel, `npm run vercel:install` once, then `npm run vercel -- login` and `npm run vercel -- link` in the project folder (the Vercel tool comes from our own locked list, never a live download; if it is not installed the loader refuses before sending anything); Claude walks you through both; `link` creates a git-ignored `.vercel` folder). Preview-scope values are not loaded by the loader: type them in the Vercel dashboard. It refuses the whole run, and sends nothing, if a name is not on its list, a value has the wrong shape for its name (for example a secret key in a public variable, or one of Cloudflare's published test keys as `TURNSTILE_SECRET_KEY`), or the file is tracked by git. It does **not** handle the plain switches in the next table (they are not secrets; you set those by hand on the Vercel or GitHub screen). Claude never runs it and never opens the file. After it has run, **delete the file**. Do not ask Claude to read it or read it back.

## Where each secret lives and who can see it

"Who can see it afterwards" means who can read the value after it is saved. In every case that is nobody on the website; what differs is what can **use** it.

| Name | What it is for | Lives in | You enter it at | Who can use it |
|---|---|---|---|---|
| `SUPABASE_SECRET_KEY` | Lets the server and the video sync read and write the database | Vercel environment variable (Production) and a GitHub secret (sync) | Vercel and GitHub screens | The site's server functions, the sync job. Never the website build. |
| `TURNSTILE_SECRET_KEY` | Spam check on forms (the real key from OT-41; never one of Cloudflare's published test keys on the live site) | Vercel environment variable (Production) | Vercel screen (the key itself comes from the Cloudflare Turnstile screen) | The server functions |
| `RESEND_API_KEY` | Sends email (from M1 go-live) | Vercel environment variable (Production) and a GitHub secret | Both screens | The server functions, the sync job |
| `EMAIL_FROM`, `OWNER_EMAIL` | Sender address, your alert address | Vercel environment variable (Production) | Vercel screen | The server functions |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alerts to your Telegram | Vercel environment variable (Production) and a GitHub secret | Both screens | The server functions, the sync job |
| `HMAC_KEY` | Scrambles visitor addresses so they are not stored raw | Vercel environment variable (Production) | You make it with a one-line command Claude gives you (the result is random and never reused) and enter it yourself (or via `.secrets.local` and the loader) | The server functions |
| `YOUTUBE_API_KEY` | Reads your public video list | Vercel environment variable (Production) and a GitHub secret | Both screens | The server functions, the sync job |
| `YOUTUBE_CHANNEL_ID` | Which channel to read (public) | GitHub secret | GitHub screen | The sync job |
| `REBUILD_DISPATCH_TOKEN` | Lets the admin Publish button (and later the cron route) ask GitHub to rebuild the site | Vercel environment variable (Production; not GitHub) | Vercel screen | The server functions |
| `CRON_SECRET` | Vercel sends it as a password with each scheduled call so only Vercel can trigger the cron route (parked, needs Pro; VF-V4) | Vercel environment variable (Production) | Vercel screen (any long random string) | The cron route |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Let GitHub publish the site (replaces `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). The token is the secret; the two ids are identifiers kept as secrets for convenience | GitHub secrets | GitHub screen | The deploy and preview jobs only |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | Lets GitHub apply database changes | GitHub secrets | GitHub screen | The database-change job only |
| `SUPABASE_DB_URL` | Read-only connection used by the weekly backup | GitHub secret | GitHub screen | The backup job only |
| `AGE_PUBLIC_KEY` | Locks the real backups (public, safe to share) | GitHub repository variable | You add it on the GitHub Variables tab (OT-31) | Anyone (it can only lock) |
| `AGE_DRILL_PUBLIC_KEY` | Locks the practice backups of made-up data (public) | GitHub repository variable | You add it on the GitHub Variables tab | Anyone (it can only lock) |
| `AGE_DRILL_KEY` | Unlocks a practice backup of made-up data only | GitHub secret | GitHub screen | The restore-practice job only |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Payments (Phase 2 only, not now) | Vercel environment variables (Production) | Vercel screen | The server functions |
| **The `age` private key** | Unlocks real backups | **Nowhere online.** Paper or your password manager, plus one sealed copy with one trusted person | Never typed into any website | Only you |

Be aware: GitHub lets **every workflow in this repository** use a repository secret. "Deploy job only" is a rule we keep by design and review, not something GitHub enforces. That is why Claude shows you any change to `.github/` before it is merged.

Never paste a secret into Claude Code's chat, a GitHub issue or a pull-request comment either. Claude works on this PC with development-project values only.

## Settings and switches that are not secrets (set by hand)

These are plain settings, not secrets, so there is nothing to hide, but a wrong value can still do harm. **You set each one yourself** on the screen named in the table, and only when Claude tells you to. The loader does not handle them. A server setting is added on the Vercel screen (project, Settings, Environment Variables, Add) with the scope Claude names (Production, or Preview for tests) and without the Sensitive option (it is plain text); remove one by deleting it there. A change applies to new deployments only. A GitHub switch is added on the repository's Settings, Secrets and variables, Actions, **Variables** tab.

| Name | What it does | Where it lives | Value, default, and the rule |
|---|---|---|---|
| `TURNSTILE_ALLOW_TEST_KEYS` | Lets the enquiry system accept Cloudflare's published spam-check **test** secrets (they accept every submission, spam robots included) | The **Preview** scope of the Vercel project only (and the local `.env` file on the PC) | Exactly `true` to allow. **Unset everywhere else. NEVER in the Production scope.** Without it, a test secret makes the form refuse to send and the health address say it is not ready (reason `turnstile_test_key`), so a slip fails safe. If it is ever on in production the health answer also shows `"testMode":true`. Claude checks this before G1 (OT-41). |
| `TELEGRAM_ALERT_PHONE_LINK` | Puts the customer's WhatsApp reply link (it contains their **phone number**) and their district in the owner alert (Telegram, and the owner email once email is on) | Vercel, Production scope | **Default: unset = OFF.** With it off the alert has only the kind of enquiry, a reference code, first name or initial, the page used, and a pointer to open the lead in Supabase Studio. Exactly `true` switches it on. Switch it on only after you have said yes in chat **and** the lawyer has updated the privacy page and consent text (OT-15, question 6 in `docs/OWNER_TODO.md`); the privacy page is worded for the default. |
| `EMAIL_ENABLED` | Switches on the owner alert email and the "we got your enquiry" email to the customer | Vercel, Production scope | Default: unset = OFF (Telegram is then the only push alert). Exactly `true` to switch on, and only after your domain is verified (OT-07) and Resend is set up (OT-40). Needs `RESEND_API_KEY`, `EMAIL_FROM` and `OWNER_EMAIL` to exist first. |
| `TURNSTILE_EXPECTED_HOSTNAMES`, `TURNSTILE_EXPECTED_ACTION` | Optional extra checks on the spam-check answer: which web addresses the widget may be served from, and the widget's action name (default `lead`) | Vercel (optional) | List the real domain and any `.vercel.app` host that shows the form; the same hostnames must be on the Turnstile widget (OT-41). In normal (non-test) mode the hostname and action checks always run. |
| `SUPABASE_URL` | Optional: the database address for the server functions only, when it should differ from `PUBLIC_SUPABASE_URL`. If it is not set, every server function (enquiries, `/go/*` click log and sponsor links, the admin API) falls back to the `PUBLIC_SUPABASE_URL` that was baked into the build (review fix, 2026-10-22); `/api/health` cannot show a missing value, so check `/go/` and the admin once on the first preview | Vercel (optional) | Must be `https://<project-ref>.supabase.co`, or the secret key is never sent. |
| `SUPABASE_ALLOW_LOCAL_URL` | Lets the server talk to a database on this PC (local development only) | Local `.env` only | Exactly `true`. **Never on a deployed site (Vercel).** |
| `LEAD_GLOBAL_HOURLY_CAP` | The most enquiries accepted per hour across all visitors before a flood brake trips and you get one "flood protection" notice | Vercel (optional) | A whole number from 1 to 10,000. Default 40 (an engineering guess, not a business fact; tune it after real traffic). |
| `LEAD_GLOBAL_DAILY_CAP` | The most enquiries stored per 24 hours across all visitors before new ones are refused | Vercel (optional) | A whole number. Default 100 (an engineering guess; tune after real traffic). |
| `SYNC_ENABLED` | Switches the YouTube sync workflow (`sync.yml`) on | GitHub repository **variable** | Exactly `true`. Set only when Claude names it, after the Supabase project, the YouTube API key and the migrations exist. |
| `CRON_ENABLED` | Switches the scheduled cron route on (rebuild request when the site is dirty, new-video check, "no sync for 8 hours" alert). Parked: the route is not wired yet, and Vercel needs the Pro plan for anything more often than once a day (VF-V4) | Vercel (plain text, Production) | Exactly `true`. Needs `CRON_SECRET`, `REBUILD_DISPATCH_TOKEN`, `ADMIN_GITHUB_REPO`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Vercel. Off by default. |
| `ADMIN_GITHUB_REPO`, `ADMIN_DEPLOY_WORKFLOW`, `ADMIN_SYNC_WORKFLOW`, `ADMIN_DISPATCH_REF`, `ADMIN_ALLOWED_ORIGINS`, `ADMIN_EDITORS_ENABLED` | Where the admin "Publish now" and "Sync now" buttons (and the cron) send their request: `owner/name`, workflow files (`deploy.yml`, `sync.yml`), branch (default `main`), extra admin web addresses, and the editors switch (exactly `true`, off at launch) | Vercel (plain text, not secret) | The only secret involved is `REBUILD_DISPATCH_TOKEN`. |
| `PUBLIC_PLACEMENT_BEACON_TOKEN` | Lets the sponsor-impression counter tell this site's own requests from random ones | Build variable (public, **not a secret**) | Any random 8 to 128 letters, digits, `_` or `-`; change it per build. |
| `PS_ARCHIVE_SOURCE` | Chooses where the archive pages read from | Build variable | `supabase` for the real build (with `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`); unset = fictional sample data. |
| `DEPLOY_ENABLED`, `PREVIEW_ENABLED`, `BACKUP_ENABLED`, `BACKUP_TELEGRAM_ALERTS` | Switch on the publish job, the private preview job, the weekly backup, and a Telegram message when a backup fails | GitHub repository **variables** | Exactly `true`. Set each only when Claude names it (OT-48). |
| `PREVIEW_PUBLIC_SUPABASE_URL`, `PREVIEW_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PREVIEW_PUBLIC_TURNSTILE_SITE_KEY`, `PREVIEW_PUBLIC_WHATSAPP_NUMBER` | The development database address, the public keys and the WhatsApp number the private preview is built with | GitHub repository **variables** (public values, not secrets) | Dev project values only (OT-03, OT-41); the WhatsApp number is the real business one (public by design, so the owner can test the buttons; set 2026-10-25 as `917373351087`, the same value as `PUBLIC_WHATSAPP_NUMBER`). |
| `PUBLIC_NOINDEX_HOST_SUFFIXES` | Extra address endings that always carry "do not list" (`.vercel.app` is always included) | Build variable (public, not secret) | Optional comma list. |
| `PS_STRICT` | Makes a build fail on any gap marker (the release gate) | Not a setting you make: the release scripts set it for the strict build | Developers: `npm run build:strict` sets it. |

How to add one of the server settings: the value you type for a switch is the plain word `true`; there is nothing secret in it. If a screen looks different from what is written here, tell Claude what you see.

## Replacing secrets (rotation)

**When:** all keys at launch, then every three months (D-027), and straight away after any leak or if anyone who had access leaves. Put the dates in your phone calendar. The Vercel deploy token and the GitHub rebuild token are created with an end date about three months out (OT-02, OT-42); if one expires, publishing or fast rebuilds stop until you make a new one.

**The pattern is always the same: make the new one, put it everywhere the old one was, check that it works, then delete the old one.** Never delete first. Claude tells you the exact order for your case. Provider screens change; if one looks different, tell Claude what you see (never the key).

| Secret | What you do |
|---|---|
| Vercel deploy token | Vercel account Settings, Tokens: create a new token with an end date about three months out, update the GitHub secret `VERCEL_TOKEN` (the two ids do not change), ask Claude to run a preview deploy, then delete the old token in Vercel. |
| Supabase secret key | Supabase project, Settings, API Keys: create a new secret key (Supabase recommends a separate one for each component, so the site and the sync job can each be revoked alone), update the Vercel variable (Production), redeploy, and update the GitHub secret, check a form and a sync run, then delete the old key. Deleting cannot be undone. |
| Supabase personal access token | Supabase, Account, Access Tokens: create a new one, update `SUPABASE_ACCESS_TOKEN`, delete the old one. |
| Backup connection `SUPABASE_DB_URL` | Set a new password for the read-only backup login (Claude walks you through it), rebuild the connection string from Supabase's Connect screen (session pooler), update the GitHub secret. |
| YouTube API key | Google Cloud console, Credentials: create a new key, restrict it to YouTube Data API v3 only and set the same daily cap (about 3,000 units), update both places, then delete the old key. |
| Telegram bot token | In Telegram open @BotFather and use its command for a new token (Telegram's docs list `/token`; older guides say `/revoke`). Update the Vercel variable (Production) and the GitHub secret, then redeploy. The old token stops working at once. |
| Turnstile secret key | Cloudflare, Turnstile, your widget: rotate the secret key if the screen offers it, otherwise create a new widget (new site key and secret). Update `TURNSTILE_SECRET_KEY` in Vercel (Production), redeploy (and update `PUBLIC_TURNSTILE_SITE_KEY` and rebuild if the widget is new). |
| Resend key | Resend, API Keys: create a new key with **Sending access** only, update both places, delete the old key. |
| GitHub rebuild token | GitHub, Settings, Developer settings, Fine-grained tokens: generate a new one with the same settings (only the `power-smash` repository, Actions: write (shown as "Read and write"), nothing else, an end date about three months out), update the Vercel variable (Production) and redeploy, delete the old token. |
| `HMAC_KEY` | Ask Claude. Changing it changes every stored visitor hash, so it is done with a key id and a short overlap. |
| Razorpay (Phase 2) | Ask Claude when we get there. |
| Backup `age` key | Not on the three-month schedule. If you ever replace it, keep the old private key as long as old backups exist. Ask Claude first. |

## If a secret leaks

Examples: you pasted a key into chat, a key appeared in a screenshot, a file with a key was uploaded, your phone was lost, or a service emailed you "your key was exposed".

1. **Do not panic and do not delete the chat message.** Deleting does not un-leak it, and we need to know what was exposed.
2. **Tell Claude straight away:** which secret (the name only, never the value), where it showed up, and roughly when.
3. **Revoke it at its own website first** (delete or roll the key on the screen for that service). Revoking takes effect in seconds and stops misuse. Claude then makes the replacement and puts it where it belongs.
4. **Claude checks for misuse** (provider logs and recent runs) and tells you what it finds in plain words.
5. **If the secret was committed to the repository,** Claude tells you before doing anything about it. Removing it from history means rewriting history, which needs your yes. Treat the key as burned even after it is removed from view.
6. **If personal data could have been read** (the Supabase secret key, the backup connection or the backup key), the breach steps in D-028 apply. India's cyber-security reporting directions (CERT-In, a 6-hour reporting window) are on the plan's compliance list; Claude will ask you to involve the lawyer. Do not wait to finish the investigation before you revoke the key.
7. **Note what happened and the date** so the lessons go into the RUNBOOK.

How serious is each one if it leaks (worst case, so you know what to revoke first):

| Secret | Worst case |
|---|---|
| Vercel deploy token | Someone could publish anything to your website. Highest priority. |
| Supabase personal access token | Someone could manage all your Supabase projects, including reading their keys. Highest priority. |
| Supabase secret key | Someone could read and change leads, subscribers and other private data. Highest priority. |
| Backup connection `SUPABASE_DB_URL` | Someone could read the whole database. High. |
| Backup `age` private key | Anyone who also gets a backup file could read it. High. Losing it means backups cannot be opened. |
| Telegram bot token | Fake alerts to you, or alerts hidden. Medium. |
| Resend key | Email sent as your domain (phishing risk). Medium. |
| Razorpay keys (Phase 2) | Payment records exposed or fake "paid" events. High. |
| YouTube API key | Your daily allowance used up; the sync pauses. Low to medium. |
| GitHub rebuild token | Someone could start rebuilds and use up free minutes; it cannot change code. Low to medium. |
| Turnstile secret, `HMAC_KEY`, drill key | Low, but replace them anyway. |
| `CRON_SECRET` | Someone could trigger the cron route (it is idempotent, and best effort); low. |

---

# Part 2 - Technical

## Key matrix (D-027)

| Variable | Kind | Lives in |
|---|---|---|
| `PUBLIC_SITE_URL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_WHATSAPP_NUMBER`, `PUBLIC_ALLOW_INDEXING`, `PUBLIC_CF_ANALYTICS_TOKEN`, `PUBLIC_HSTS_MAX_AGE` | build variables (not secret) | GitHub repository variables (read by the deploy and preview workflows), local `.env` (dev values) |
| `SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HMAC_KEY`, `YOUTUBE_API_KEY` | Vercel environment variables (secrets, runtime only; Production scope for live values, Preview scope for dev values) | Vercel dashboard or the owner-run loader (`--only vercel`, Production); local `.env` (dev values) |
| `EMAIL_ENABLED`, `TELEGRAM_ALERT_PHONE_LINK` (Vercel Production, both default unset = off); `TURNSTILE_ALLOW_TEST_KEYS` (Preview scope only), `SUPABASE_ALLOW_LOCAL_URL` (local only); **never Production**; optional `TURNSTILE_EXPECTED_HOSTNAMES`, `TURNSTILE_EXPECTED_ACTION`, `SUPABASE_URL`, `LEAD_GLOBAL_HOURLY_CAP`, `LEAD_GLOBAL_DAILY_CAP`, `CRON_ENABLED`, `ADMIN_*` | Vercel settings (plain text, not secret; the exact word `true` for a switch) | Vercel Environment Variables screen; local `.env` for the dev ones. Not handled by the loader. |
| `DEPLOY_ENABLED`, `PREVIEW_ENABLED`, `BACKUP_ENABLED`, `BACKUP_TELEGRAM_ALERTS` | GitHub switches (repository variables) | GitHub Variables tab, set by hand (OT-48); the loader refuses these names |
| Admin console (Vercel functions): `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the same Vercel variables as the enquiry endpoint), `REBUILD_DISPATCH_TOKEN` (the Publish and Sync buttons), plus the plain-text `ADMIN_*` names above. The admin sign-in itself uses Supabase accounts: **no admin password, authenticator code or recovery code is ever a repository or Vercel value** | Vercel | Vercel screen (OT-42, OT-51). Only you see these; not Claude, not the repository |
| `SYNC_ENABLED`, `PUBLIC_PLACEMENT_BEACON_TOKEN`, `PS_ARCHIVE_SOURCE`, `LEAD_GLOBAL_DAILY_CAP` | `SYNC_ENABLED` is a GitHub variable; the beacon token and archive source are public build variables (visible in the built site, not secrets); the cap is a Vercel setting | Variables tabs (OT-48) | Anyone with repository access may see variables; nobody outside may see secrets |
| Parked until the sync is approved: the cron route (`CRON_ENABLED`, `scripts/sync-worker/vercel-cron.ts`, not under `src`) needs `CRON_SECRET`, `REBUILD_DISPATCH_TOKEN`, `ADMIN_GITHUB_REPO`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and Vercel Pro | Vercel (Production) | Switch stays unset (off) |
| `REBUILD_DISPATCH_TOKEN` (fine-grained: Actions write, one repo) | Vercel secret (Production) | Vercel dashboard or loader |
| `CRON_SECRET` | Vercel secret (Production); Vercel sends it as `Authorization: Bearer` to cron paths | Vercel dashboard or loader |
| `AGE_DRILL_KEY` (private half of the drill-only `age` key; decrypts made-up dev data only, D-011); `AGE_DRILL_PUBLIC_KEY` (public half, variable) | restore-drill workflow only | `AGE_DRILL_KEY` GitHub secret; `AGE_DRILL_PUBLIC_KEY` GitHub variable |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, Telegram, Resend | sync workflow only (`sync.yml`, switch `SYNC_ENABLED`) | GitHub secrets |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (replace `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`) | deploy and preview workflows only (last step) | GitHub secrets |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | migrate workflow only | GitHub secrets |
| `SUPABASE_DB_URL` (session pooler, read-only role); `AGE_PUBLIC_KEY` (public, variable) | backup workflow only | `SUPABASE_DB_URL` GitHub secret; `AGE_PUBLIC_KEY` GitHub repository variable |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Vercel secrets (Phase 2) | Vercel dashboard or loader |
| age private key (production backups) | owner only, offline | never in any system |

`IP_HASH_SALT` is replaced by `HMAC_KEY` (random 32 bytes with a key id, server only). `REBUILD_HOOK_URL` is replaced by `REBUILD_DISPATCH_TOKEN`. Legacy Supabase names (`anon`, `service_role`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are not used (D-005). GitHub secret names cannot start with `GITHUB_`.

## Rules

- **Never:** the Supabase secret key in the build job or in any `PUBLIC_` variable; the Vercel token present during `npm ci` or the build step (it is exposed only to the deploy step), and `vercel pull` in a build job (it would copy the Production secrets there; D-097); a secret pasted into chat; a secret as a command-line argument (it lands in shell history and process lists: use stdin or a file).
- `PUBLIC_` variables are inlined into the browser bundle. A check (M1) fails the build if a `PUBLIC_` name or value looks like a secret, other than the two documented public keys.
- Claude Code works locally with dev-project values only. Production values live only in the GitHub and Vercel secret stores (plus the Turnstile secret shown once in Cloudflare) (and in the owner's password manager).
- Logs and errors carry no secrets, request bodies, phone numbers, emails or tokens (D-029). Telegram API URLs contain the bot token: redact them in logs and error messages (D-027).
- Hash secrets for visitors use `HMAC_KEY` with a key id so rotation does not orphan existing hashes (D-029).
- **Turnstile test secrets (review S-1).** Cloudflare's published test secrets (`1x`, `2x`, `3x` followed by zeros and `AA`) accept or reject every token. They are accepted only when the variable `TURNSTILE_ALLOW_TEST_KEYS` is exactly `true` (Vercel Preview scope and local only). There is no auto-detection from the key's shape and no test secret is seeded in `.env.example`. Without the variable, `/api/lead` fails closed (`degraded`) and `/api/health` reports `ready:false` with reason `turnstile_test_key`; with it, health shows `testMode:true`. Never set it in the Production scope. The loader refuses a test secret as `TURNSTILE_SECRET_KEY`. Not built yet: a release-gate fetch of the deployed `/api/health` that fails on `testMode:true` or `ready:false` (requested of the Infra group).
- **Owner alert contents (review S-5).** Default (`TELEGRAM_ALERT_PHONE_LINK` unset): kind, reference, first name or initial, source page and a pointer to the lead in Supabase Studio. No phone, no `wa.me` link, no email, no free text, no district; the same text goes in the owner email. A test fails if the default alert ever holds one. `TELEGRAM_ALERT_PHONE_LINK=true` adds the reply link and district; the privacy page, consent text and `features.telegramPhoneLink` change in the same commit.
- **Local files (D-097).** There is no `.dev.vars` any more (that was wrangler's file). Locally everything, `PUBLIC_` names and server names, goes in the git-ignored `.env` with dev values only; the server functions read `process.env`. The `.vercel` folder (from `vercel link`) is also git-ignored and holds only identifiers. Environment variables on Vercel apply to new deployments only (VF-V7).

## Entering secrets from files

- The owner's local `.secrets.local` is dotenv-formatted and git-ignored (`.gitignore` also covers `.secrets.local*`, `.secrets*` and `*.secrets`). The loader is `scripts/load-secrets.mjs` (`npm run secrets:load -- --dry-run`, then `npm run secrets:load -- --repo OWNER/power-smash`; options `--file`, `--only vercel|github`). It has an allow-list manifest that mirrors the key matrix above, refuses the whole run on an unknown name, a wrong value shape, a switch name (`DEPLOY_ENABLED`, `BACKUP_ENABLED`, `PS_STRICT`, `BACKUP_TELEGRAM_ALERTS`) or a file that git tracks or does not ignore (git is asked from the file's own folder, so a junction or short path cannot dodge it; if git cannot answer, the run is refused), and sends each value through `gh secret set`, `gh variable set` or the locked Vercel CLI's `env add NAME production --sensitive` on **standard input**, never on a command line, printing names only and redacting the vendors' output. Delete the file after use. Only fake values have been used in tests: the first real run is the owner's.
- Helpers the owner runs at the PC: `npm run telegram:chat-id` (prints, per chat that wrote to the bot, the chat number, chat type, first name and username so the owner can tell their own chat from a stranger's; warns when more than one private chat appears; never prints the token or message text) and `npm run age:keys` (wraps `age-keygen`; refuses to write the private key inside the project; shows only the public key; never downloads anything: the `age` program itself needs the owner's yes first, OT-31).
- **Who runs the loader (settled 2026-10-21): the owner, at the PC.** Claude Code wrote and tests the loader (with fake values only), documents the one line to type, and never runs it with real values, never opens `.secrets.local`, never reads the loader's input or the vendors' secret screens, and never asks for output that could contain a value. Claude's own safety rules forbid it from typing, reading or piping API keys, tokens or passwords, so this replaces the wording in D-027 ("Claude pipes secrets into `gh` and `wrangler`") and in `OWNER_TODO.md`. Equivalent path from a phone: the owner types each secret on the vendor's screen.
- Non-secret values (the `age` public keys, the Turnstile site key, project references) may be shared with Claude in chat; the owner still adds repository **variables** on the GitHub screen, because changing the owner's account settings needs the owner.
- Local runs of a script that needs a key (for example title profiling with `YOUTUBE_API_KEY`): the owner creates the git-ignored `.env` file with development values; scripts read it from the environment and never print it; Claude does not open the file.

## Scanning layers

| Layer | State |
|---|---|
| `.gitignore` | Ignores `.env`, `.env.*` (except `.env.example`), `.dev.vars`, `.dev.vars.*` (kept for safety), `.vercel`, `.secrets.local`, `*.pem`, `*.key`, `age-key*.txt`. The first commit is `.gitignore` (D-027, D-038). |
| gitleaks in CI | `secret-scan` job in `.github/workflows/ci.yml` (gitleaks-action, config `.gitleaks.toml`): default rules plus a Supabase secret-key rule and (review S-12) rules for a database URL with a password, a bare Telegram bot token, a Turnstile secret and a Resend key; allowlists only for the public-by-design values in the spec, exact placeholder shapes and the fixture files, and only for the noisy generic rule. Test files build secret-shaped fake values at run time so none is committed. `gitleaks/gitleaks-action` needs **no licence key for repositories owned by a personal account** (organisations need a free `GITLEAKS_LICENSE`); source https://github.com/gitleaks/gitleaks-action, verified 2026-10-21. gitleaks is not installed on the owner's PC, so CI is where the config is first exercised. |
| gitleaks pre-commit hook | Planned by D-027. Needs the gitleaks **binary** on the PC, a download that needs the owner's yes (the CI action does not; question 5 in `OWNER_TODO.md`). Until then CI is the net, and it catches a leak only after upload. |
| GitHub secret scanning and push protection | **Not available** on a private repository on the Free plan: GitHub lists secret scanning alerts and push protection under GitHub Secret Protection, free for public repositories only (verified 2026-10-21, https://docs.github.com/en/code-security/getting-started/github-security-features). D-002, D-027 and OT-01 originally assumed they were on; that was wrong. **Never make the repository public to get them** (`tests/fixtures/` holds real players' names). The layers in this table replace them. Buying Secret Protection is a spend that needs the owner's yes (D-036 does not list it). |
| `dist/` scan after every build | `scripts/privacy-scan.ts` reads every built file raw and decoded (entities, percent-encoding, escapes, hidden characters, base64 blobs) and fails EVERY build on a secret shape (`sb_secret_`, the legacy service-role JWT shape, Telegram token, Resend key, Turnstile secret, database URL with a password, age private key, PEM key) or on the exact value of a private variable found in the environment. Phone numbers, emails and localhost URLs fail the strict release build (`npm run build:strict`) and are only summarised in a normal build (D-027, D-029). |
| Workflow hygiene | Third-party actions pinned to full commit SHAs; `permissions: contents: read` by default; no `pull_request_target`; no secrets in PR builds; Dependabot proposes action updates (D-002). |

## Provider notes

- **GitHub.** Repository secrets are readable by every workflow in the repo; scoping is by convention and review. Environment secrets and branch protection may not be available for private repositories on GitHub Free: unverified, check Settings before relying on either. Fine-grained token permissions (GitHub's REST permission data, verified 2026-10-21, https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens): "Create a workflow dispatch event" (`POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches`, `workflow_dispatch`) needs **Actions: write**. The OT-42 token is therefore **Actions: write on this one repository** and nothing else; do not widen it. Set `DEPLOY_ENABLED` only when the deploy path is ready (see `deploy.yml`).
- **Supabase.** The publishable key is safe in the browser; the secret key returns 401 from a browser and must never be shipped (VF-B9). Supabase's docs describe creating several secret keys, rotating by create, update, confirm, delete, and recommend one key per backend component. Use one key for the Vercel functions and a separate one for the sync workflow. `service_role` bypasses RLS but not GRANTs, so keep GRANTs minimal (D-005). The DB connection string for backups uses the session pooler and a read-only role (D-011).
- **Vercel (D-097).** The deploy token is a Vercel account token with an end date about three months out (OT-02). Vercel environment variables are scoped (Production, Preview, Development, custom), a secret-type value is write-only after saving (the loader stores every Production value as **sensitive**: Vercel can never show it again in the dashboard or give it back to `vercel env pull`, it can only be replaced, Project, Settings, Environment Variables, Edit, so **keep your own copy of each value** in your password manager), 64 KB total per deployment, and a change applies to new deployments only (VF-V7). `vercel pull` is not used in CI because it would copy the Production environment into the build job.
- **Cloudflare.** Only Turnstile (the widget and its secret key), optional Web Analytics (a public token) and optional DNS or Email Routing remain. No Cloudflare API token or account id is held by this project any more.
- **YouTube.** The key is restricted to YouTube Data API v3 only; IP restriction is impractical (VF-C16). Set a Google Cloud daily quota cap (the audit suggests 3,000 units) and a quota alert. One Google Cloud project; quota sharding is prohibited (VF-C9).
- **Resend.** Sending-access key limited to the sending domain if the screen offers it. Starts at M1 go-live (D-022).
- **Backups (`backup.yml`).** The step splits `SUPABASE_DB_URL` into `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, masks the password with `::add-mask::`, unsets the URL and never puts the password on a command line (review S-13); `pg_dump` output goes straight into `age`, so no plaintext file exists. The job runs only when the repository variable `BACKUP_ENABLED` is `true`.
- **Deploy.** `deploy.yml` runs only `npm run build:strict` (`PS_STRICT=1`) on `main`, and only when `DEPLOY_ENABLED` is `true`. The Vercel token and ids are read only by the last deploy step (`vercel deploy --prebuilt --prod`), never by `npm ci` or the build.

## Incident steps (technical)

1. Revoke at the provider (delete or roll the key). Do not wait to investigate.
2. Create the replacement, update every place that held the old one (the matrix above), run a smoke check: a form post, a sync run, a deploy dry run.
3. Review provider logs for the exposure window (Supabase logs, Vercel audit log and deployment logs (plan availability unverified), Cloudflare audit log for Turnstile, GitHub audit and Actions history, Telegram bot activity).
4. If committed: do not rewrite history without the owner's yes (force pushes and history rewrites are on the ask list). Treat the secret as burned regardless.
5. Personal data possibly accessed: follow the breach runbook (D-028): first-hour steps (rotate keys, revoke sessions, disable forms, preserve logs), the CERT-In 6-hour report, and the DPDP notices from 2027-05-13. Legal questions go to the lawyer (OT-15).
6. Record the incident and the date in `docs/RUNBOOK.md` (written at M4).

## Rotation calendar

- Rotate every key at launch (G1) and every three months after (D-027). Tokens that carry an end date: Vercel deploy token and GitHub rebuild token (about three months, OT-02, OT-42). Record the actual dates in `docs/RUNBOOK.md` at M4.
- The `age` production key is outside this schedule.

## Open points (for the lead)

- Settled 2026-10-21: the `age` public keys are GitHub repository **variables** `AGE_PUBLIC_KEY` (production backups) and `AGE_DRILL_PUBLIC_KEY` (drill only); `AGE_DRILL_KEY` is the drill private half, a GitHub secret; D-011 and D-027 wording ("committed to the repo", "GitHub secrets") is being aligned in `docs/DECISIONS.md`.
- Settled: push protection and secret scanning are not available on a private Free repository (see Scanning layers); gitleaks in CI plus an optional pre-commit hook replace them.
- Settled: the owner, not Claude, runs the loader for `.secrets.local` (see Entering secrets from files). The loader script is written and tested with fake values only; its first real run is the owner's.
- Open: `scripts/check-release.ts` does not yet fetch the deployed `/api/health` and fail on `testMode:true` or `ready:false` (requested of the Infra group). Open: the `age` public key is still read from the repository variable `AGE_PUBLIC_KEY`; committing it to the repository so that a change needs a reviewed commit is deferred until the key exists (OT-31).
