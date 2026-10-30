# Wave 4 integration: organizer and scorer accounts (D-108)

Owner: wave 4 build agent. For the integrator. Everything below is built and tested in its own files; nothing is wired into the shared registries yet, so today **only the owner can sign in, exactly as before**.

## 1. What exists

| Area | Files |
|---|---|
| Migration | `supabase/migrations/0019_competition_accounts.sql`, `supabase/checks/0019_assertions.sql` |
| Server modules | `src/lib/admin/accounts/` (`types.ts`, `rules.ts`, `access.ts`, `schemas.ts`, `scoped-store.ts`, `service.ts`, `memory-backend.ts`, `supabase-backend.ts`) |
| Auth | `src/lib/admin/auth.ts` (new: `authorizePlatform`, `authorizeEnrolCheckPlatform`, `isPlatformActionAllowed`, `PlatformAuthDeps`; the old functions are unchanged) |
| Supabase Auth | `src/lib/admin/gotrue.ts` (new: `createGoTrueAdmin` (server only, secret key: `invite`, `ban`), `parseInviteRedirect`, `setInvitedPassword`, `passwordProblem`) |
| Screens | `src/admin/screens/accounts/Accounts.tsx` (owner), `AcceptInvite.tsx` (invited person, before sign-in), `logic.ts` |
| Tests | `tests/admin/accounts-{auth,scope,service,supabase,sql}.test.ts`, `tests/admin-ui/accounts-render.test.ts` |

**Files outside my list that I had to touch (please review):** `supabase/checks/0017_assertions.sql` and `supabase/checks/0018_assertions.sql`. Their "the owner check comes first" tests now also accept `app.require_competition_access` as the first check (0019 replaces those RPCs), and the 0017 "no new role on profiles" test now refuses only a `player` role. Without these two edits the local checks fail on 0017/0018 after 0019 is applied. The diff is 10 lines.

## 2. Migration 0019 in short

- `profiles.role` accepts `owner | editor | organizer | scorer` (constraint name kept: `profiles_role_check`). New `disabled_at`, `disabled_by`. An organizer/scorer row needs a label with no `@` and fewer than 7 digits; only an organizer/scorer can be disabled. Still exactly one owner. No email column anywhere.
- `organizer_assignments` gains `revoked_at`, `revoked_by`; the always-unique constraint is replaced by a unique index on ACTIVE rows; a guard trigger keeps a row fixed and a revoke final.
- `app.require_competition_access(p_actor text, p_tournament uuid, p_needed text)`: owner always; otherwise ALL of: `competition_settings.organizer_roles_enabled`, profile is organizer/scorer and not disabled, ACTIVE assignment to that tournament with the profile's role; `run` needs organizer, `score` organizer or scorer. Null tournament (unknown id) = FORBIDDEN for non-owners. Error `FORBIDDEN:`.
- Replaced with the same signatures, body byte-identical except the first statement (pinned by `tests/admin/accounts-sql.test.ts`):
  - `run`: `admin_save_event`, `admin_add_entry`, `admin_withdraw_entry`, `admin_set_entry`, `admin_save_draw`, `admin_publish_draw`, `admin_save_match`, `admin_confirm_result`, `admin_save_court`
  - `score`: `admin_record_result`
  - Owner only, unchanged: `admin_save_venue`, `admin_save_ranking_snapshot`, `admin_publish_ranking_snapshot`, `admin_set_ranking_points`, `admin_competition_rankable_players`, and every non-competition RPC.
- New owner-only RPCs: `admin_create_account(text, uuid, jsonb, text)`, `admin_assign_tournament(text, uuid, uuid, text)`, `admin_revoke_assignment(text, uuid, text)`, `admin_disable_account(text, uuid, text)`, `admin_set_organizer_access(text, boolean, text)`. Audits hold ids, role and counts only.
- **Two switches, both default off:** the database switch `competition_settings.organizer_roles_enabled` (owner sets it from the Accounts screen) AND the server switch `ORGANIZER_ACCOUNTS_ENABLED` exactly `true`.
- **Risk for later waves:** any later migration that does `create or replace` on one of the ten scoped RPCs must keep the `app.require_competition_access` first line, or it silently makes the RPC owner-only again (safe, but it breaks organizers) or, worse, drops the check. Extend `tests/admin/accounts-sql.test.ts` to compare against the newest definition when that happens. 0020 (registrations, another agent) does not touch them.

Local result (0001..0019 only, scratch db, 2026-10-31): every check printed its ok row, including `ok: 0019_competition_accounts assertions passed`. `pg-local all` with 0020 present stops at 0006 (the api allow-list does not know 0020's views yet; not mine).

## 3. Shared registries: what to add

### policy.ts
- `export type AdminRole` moves to `PlatformRole` (`'owner' | 'editor' | 'organizer' | 'scorer'`); or import `PlatformRole` from `accounts/types.ts` and widen `Actor.role` in `types.ts`.
- Add to `ADMIN_ACTIONS`: spread `ACCOUNT_ACTIONS` from `src/lib/admin/accounts/access.ts` (`accounts.list` owner read; `accounts.invite`, `accounts.assign`, `accounts.revokeAssignment`, `accounts.disable`, `accounts.setAccess` owner write).
- Role-to-action map: `SCOPED_ACTION_NEEDS` in `accounts/access.ts` (do not copy it; import it):
  - organizer: `competition.tournaments|event|courts` (read), `saveEvent, addEntry, withdrawEntry, setEntry, generateDraw, publishDraw, syncMatches, saveMatch, schedule, confirmResult, saveCourt` (run), `recordResult` (score)
  - scorer: `competition.tournaments|event` (read), `recordResult` (score)
  - never: `competition.rankings|ranking|settings|computeRanking|publishRanking|saveVenue|approvePointsTable`, and nothing outside `competition.*`.
- `isActionAllowed` can stay for owner/editor; use `isPlatformActionAllowed(role, action, { editorsEnabled, organizerAccountsEnabled })` from `auth.ts` at the handler.
- RLS_MATRIX: **no new rows** (no new table or view). Organizers and scorers have no database role: they reach the database only through the admin function (service_role) and the scoped RPCs. Suggested comment on `profiles` and `organizer_assignments`: "0019: written only by the owner account RPCs; read by the admin function for the role and the per-tournament check".

### handler.ts
1. `SCHEMAS`: spread `ACCOUNT_SCHEMAS` from `accounts/schemas.ts`.
2. Replace `authorizeAdmin(request, actionName, deps.auth)` with `authorizePlatform(request, actionName, deps.auth)`; `deps.auth` becomes `PlatformAuthDeps` (`roles` returns `PlatformRole | null`, plus `organizerAccountsEnabled`). `isAdminAction` must also accept account actions.
3. Enrol check: `authorizeEnrolCheckPlatform` instead of `authorizeEnrolCheck` (an invited person must enrol TOTP at aal1).
4. **The per-tournament check before the store**: `AdminHandlerDeps` gains `scope: ScopeDeps | null`. In `run()`, for every `competition.*` action use
   `const comp = actor.role === 'owner' ? s : deps.scope ? createScopedCompetitionStore(s, actor, deps.scope) : null` and answer 403 when `comp` is null for a scoped role. Route all 22 competition cases through `comp`. For any non-competition action a scoped role never gets here (auth refused it).
5. Account cases: `accounts.list -> s.accountsList()`, `accounts.invite -> s.accountsInvite(actor, input)`, `accounts.assign -> s.accountsAssign`, `accounts.revokeAssignment -> s.accountsRevokeAssignment`, `accounts.disable -> s.accountsDisable`, `accounts.setAccess -> s.accountsSetAccess`.

### types.ts
- `AdminStore extends ... AccountsStore` (from `accounts/types.ts`); widen `AdminRole`/`Actor` as above.

### memory-store.ts
- State: `accounts?: MemoryAccountsState` (`emptyAccountsState(<preview owner id>)`).
- `const accounts = createAccountsService(createMemoryAccountsBackend({ state, tournaments: () => <approved tournaments as {id,name,startDate}>, audit, now, newId }), { invites: null, organizerAccountsEnabled: false })` and delegate `ACCOUNTS_STORE_METHODS` like the competition methods. Preview never sends email (`invites: null`; the screen then says so).
- Scope for the preview: `createMemoryScopeDeps(() => state.accounts, () => state.competition)`.

### supabase-store.ts
- `createAccountsService(createSupabaseAccountsBackend({ select, rpc }), { invites: createGoTrueAdmin({ url, secretKey, fetch }), organizerAccountsEnabled, redirectTo })`.
- Add `ACCOUNT_RPCS` (from `accounts/supabase-backend.ts`) to `COMPETITION_DETAIL_RPCS`, so the database's own sentences ("this person already has this tournament") reach the owner.
- Scope: `createSupabaseScopeDeps({ select })` (reads fresh per request: profile, the switch, active assignments; resolves event/entry/draw/match/court to the tournament).

### http-store.ts
Six posts: `accountsList -> 'accounts.list' {}`, `accountsInvite -> 'accounts.invite'`, `accountsAssign`, `accountsRevokeAssignment`, `accountsDisable`, `accountsSetAccess` (input as given, actor ignored).

### config.ts (and runtime-env.ts, SECRETS.md)
- `roles`: replace with `createSupabaseRoleLookup({ select })` from `accounts/supabase-backend.ts` (reads `role,disabled_at`; ended account = null). Until then the old owner/editor lookup keeps organizers out.
- New runtime env names (server only, not secret):
  - `ORGANIZER_ACCOUNTS_ENABLED`: exactly `true` lets organizers and scorers sign in and work; anything else = owner only. Read with `organizerAccountsEnabled(value)` from `accounts/access.ts`.
  - `ADMIN_INVITE_REDIRECT_URL` (optional): the admin address the invitation link opens, for example `https://<admin host>/admin/`. Must also be in Supabase Auth's allowed redirect URLs (owner step). Absent = Supabase uses the project's Site URL.
- The invite uses the existing `SUPABASE_SECRET_KEY`; no new secret.

### AdminApp.tsx, More.tsx, Login.tsx (navigation)
- Nav filter: `navAreasFor(actor.role)` (`accounts/access.ts`): `null` = every area (owner); organizer/scorer = `['competitions']` only (land on Competitions, hide the tab bar entries and More). Editors `[]`.
- More (owner only): entry "Accounts", plain text "Invite organizers and scorers, and choose their tournaments.", lazy `import('./screens/accounts/Accounts').then(m => ({ default: m.Accounts }))`.
- Competitions screens: `competitionUiFor(actor.role)` gives `rankings, venues, addEvent, editEvent, entries, draw, schedule, courts, updateMatches, editMatch, recordResult, confirmResult, seesProtectedNames`. Hide the Rankings card and the venue form for non-owners; for a scorer show only the Results tab with the record form (no confirm button, no match edit). The server refuses anyway; this only avoids buttons that always fail. The fixed reason strings ("... by owner") should say "by organizer"/"by scorer" for those roles.
- Login: on load, `parseInviteRedirect(location.hash)`; if not null, clear the fragment (`history.replaceState`) at once and show `<AcceptInvite setPassword={(pw) => setInvitedPassword(cfg, invite.accessToken, pw)} onDone={...back to sign in} />`. After the password, the normal sign-in and TOTP enrolment run; `session.enrolCheck` must use `authorizeEnrolCheckPlatform`.

### status.ts, features.test.ts, privacy.ts (legal switch)
- New flag `organizerAccounts: false`, `{ arrives: 'platform wave 4 (owner + lawyer)', unlocks: 'organizer and scorer accounts by invitation: their email and name held by Supabase Auth, results entered by invited organizers and scorers' }`. Tie the server switch to it if you want one source (the env switch stays required).
- **Privacy wording to change when it is on**: the competitionPages text says "Results on these pages are entered by Power Smash." That stops being true. Proposed futureWording `organizerAccounts.enteredBy`: "Entries, draws and results on these pages are entered by Power Smash or by tournament organizers and scorers whom Power Smash has invited and given access to that tournament only. Results are shown only after Power Smash or the tournament's organizer has confirmed them."
- Proposed futureWording `organizerAccounts.staffAccounts` (people we invite): "If we invite you to help run a tournament, we use your email address to send the invitation and to let you sign in (it is held by our sign-in provider, Supabase), and we keep a name you are known by, your role and the tournaments you can work on. We record which changes you make. When your access ends we keep that record of changes."
- G1 re-read checklist: add both sentences.

### RUNBOOK.md (owner steps, plain English)
1. Supabase, Authentication, URL configuration: add the admin address (`ADMIN_INVITE_REDIRECT_URL`) to the allowed redirect URLs.
2. Supabase, Authentication, Emails, "Invite user": read the template. **Unverified (not checked against a live project):** the default subject is "You have been invited" and the body says you have been invited to create a user on the site, with an "Accept the invite" link. The owner may reword it in Supabase; do not promise anything there that the site does not do.
3. MFA stays required for every role (aal2 on every action); TOTP must be enabled in the project (already an owner step, OT-51).
4. To start: Accounts screen, "Turn access on" AND set `ORGANIZER_ACCOUNTS_ENABLED=true` on Vercel (Production), then redeploy. To stop at once: "Turn access off" (no redeploy needed).
5. Ending an account cannot be undone; inviting the same email again needs the Supabase user removed first (an owner step in Supabase, a hard delete: ask first).

### anon-harness.mjs, tests/supabase/bundle.test.ts, 0006_assertions.sql
- No new table and no api view: the manifest and the 0006 allow-list need nothing for 0019.
- Optional anon probes: `rpc/admin_create_account`, `rpc/admin_set_organizer_access`, `rpc/admin_revoke_assignment` must be refused for anon (covered by `0019_assertions.sql` part B too).
- `bundle.test.ts` expects the checks bundle to end with the 0018 ok line; it must become the last check file's line (`ok: 0019_competition_accounts assertions passed` while 0019 is last; 0020 exists now). My check file follows the "set the real owner aside" rule.

### DECISIONS.md (proposed, for the owner or lead)
- **Scorers see "Protected player"** for anyone not `adult_confirmed` and for everyone in a junior event (D-109 keeps names to the owner and the assigned organizer). Decided from the stored age status and the event's junior flag, not the public naming rule, so a scorer sees confirmed adults by name even if their public profile is hidden.
- **Two switches** for organizer access (database + server), both required.
- **An organizer's "On the site" badges show everyone as protected** (fail closed): the naming preview asks an owner-only RPC (`admin_competition_rankable_players`). A scoped read RPC would fix it later.
- **Organizers cannot search players yet**: the Entries screen uses `players.search`, which is owner-only (it would expose every player, juniors included). Proposed follow-up: a scoped `competition.searchPlayers` limited to `app.competition_named_players` plus players already entered in the organizer's tournaments. Until then an organizer can confirm, seed, withdraw and draw, but adding a new entry needs the owner.
- **Ending an account is final** (no re-enable); the owner invites again with another address.

### CHANGELOG.md (proposed lines)
- Wave 4 (off): organizer and scorer accounts by the owner's invitation (D-108). Migration 0019 adds the two roles, revocable assignments and a per-tournament access check in every competition RPC (rankings, venues and the points table stay owner only). New owner screen Accounts (invite, give or take away a tournament, end an account, the access switch). Organizers and scorers stay switched off: the database switch and `ORGANIZER_ACCOUNTS_ENABLED` are both off.

## 4. Test probes for the integrator (after wiring)
- Handler: organizer token (aal2) + `ORGANIZER_ACCOUNTS_ENABLED` true: `competition.event` of an assigned event 200; of another tournament 403; `competition.rankings` 403; `accounts.list` 403; `dashboard` 403. Scorer: `competition.recordResult` 200, `competition.confirmResult` 403. Switch false: every organizer call 403. aal1: 403 for all. Owner: unchanged on every existing test.
- `session.enrolCheck` for an organizer at aal1: allowed only with the switch on and no factor yet.
- Memory preview: `accounts.invite` answers the "cannot be sent from here" sentence.
- Existing `tests/admin/handler.test.ts` and `auth.test.ts` must stay green (the old functions are untouched).

## 5. Test results (my files)
- `npx vitest run tests/admin/accounts-*.test.ts tests/admin-ui/accounts-render.test.ts`: 6 files, 70 tests passed.
- Local SQL (0001..0019): every check ok, including 0019.
- `npm run check`: no error in my files (the one error it found, in my render test, is fixed).
