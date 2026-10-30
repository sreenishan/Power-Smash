# Wave 5 integration: international events listed with links only (D-112)

Build agent: international. Everything below is for the integrator. The module, its migration and its tests are complete and green on
their own. Nothing is switched on: the release build makes no `/international/` page until `features.internationalLinks` is exactly
`true` (section 6).

## 1. Files (all new)

| Area | File |
|---|---|
| Migration | `supabase/migrations/0022_international_links.sql`, checks `supabase/checks/0022_assertions.sql` |
| Shared rules (client, server, page model; mirrored in the SQL) | `src/lib/international/link-rules.ts` |
| Build gate | `src/lib/international/in-build.ts` |
| Public data | `src/lib/international/public/{provider,seed,supabase-provider,model,load,text}.ts` |
| Page | `src/pages/international/[...page].astro`, `src/pages/international/_parts/{InternationalPage,InternationalSampleNotice}.astro` |
| Admin | `src/lib/admin/international/{types,schemas,service,memory-backend,supabase-backend}.ts` |
| Admin screen | `src/admin/screens/international/{International.tsx,logic.ts}` |
| Tests | `tests/international/{link-rules,gate,public,admin,sql,render}.test.ts` |

## 2. What it does

- The owner lists major international events by hand: name, level (free text, optional), first and last day (`date`, read as India
  time, D-030), city (optional), country, and ONE official link. The owner can add, edit, hide and show; there is no delete.
- The link must be http(s), a full address, with no user name or password, no port and no punycode or non-Latin host. Its website must
  be `bwfbadminton.com`, `tournamentsoftware.com` or `bwf.tournamentsoftware.com`, or one the owner adds under "Allowed websites".
  `www.` in front of an allowed name is accepted; any other sub-domain must be added by name. Link shorteners and IP addresses cannot be
  added. Tracking parameters (`utm_*`, `fbclid`, `gclid` and the rest of `TRACKING_PARAMS`) and the `#` part are removed before the link is
  stored. The database refuses anything else (`app.international_link_problem`, a table constraint for the shape, the RPCs for the
  allow-list).
- Nothing is fetched from or copied from the linked sites: no results, draws, rankings, logos or player data. The page leads with
  "Details and results on the official site.". Each link opens in a new tab with `rel="noopener noreferrer nofollow"`. Its visible label
  is "Official page on <host>", followed by an external-link icon and the screen-reader text "(opens the official site in a new tab)".
- `/international/` shows two lists, "Upcoming and running now" and "Recent" (ended in the last 90 days), with dates from
  `formatDateRange`. A non-release build reads the FICTIONAL seed and is `noindex`, with the sample banner. In the strict build, the seed or
  the switch being off prints a `<Todo>`.
- If the owner removes a website from the list, the api view drops every event that links to it at once, and the admin tells the owner
  how many. Showing such an event again is refused until its link is changed.

## 3. Admin actions (owner only, aal2)

The schemas are exported from `src/lib/admin/international/schemas.ts` as `INTERNATIONAL_ACTION_SCHEMAS`. The kinds are in
`INTERNATIONAL_ACTION_KINDS`, and the RPC names in `INTERNATIONAL_RPCS`.

| Action | Kind | Input (zod, strict) | Store method |
|---|---|---|---|
| `international.list` | read | `{}` | `internationalList()` returns `{ events, settings: { defaultHosts, extraHosts } }` |
| `international.save` | write | `{ id: uuid\|null, expectedRevision: int>=1\|null, name<=200, levelText<=120, startDate<=10, endDate<=10, city<=100, country<=100, officialUrl<=600, published: boolean, reason }` | `internationalSave(actor, input)` |
| `international.setPublished` | write | `{ id: uuid, published: boolean, expectedRevision: int>=1, reason }` | `internationalSetPublished(actor, input)` |
| `international.saveHosts` | write | `{ hosts: string<=300 [] (<=40), reason }` | `internationalSaveHosts(actor, input)` |

The reason is the usual `z.string().trim().min(3).max(500)`. The bounds are generous; the exact rules and their plain-English refusals are
in `link-rules.ts`. The service applies them first, so the owner sees a sentence beside the field, and the SQL applies them again.

### Wiring

- **`src/lib/admin/policy.ts`**: `international.list` is `ownerRead`; the other three are `ownerWrite`.
- **`src/lib/admin/handler.ts`**: spread `...INTERNATIONAL_ACTION_SCHEMAS` into the action table, then:
  ```ts
  case 'international.list': return fromStore(await s.internationalList(), cors);
  case 'international.save': return fromStore(await s.internationalSave(actor, input), cors);
  case 'international.setPublished': return fromStore(await s.internationalSetPublished(actor, input), cors);
  case 'international.saveHosts': return fromStore(await s.internationalSaveHosts(actor, input), cors);
  ```
- **`src/lib/admin/types.ts`**: `AdminStore extends ..., InternationalAdminStore` (from `./international/types`).
- **`memory-store.ts`**: `...createInternationalService(createMemoryInternationalBackend())`. The memory backend has its own fictional
  seed. Its `isOwner` defaults to `actor.role === 'owner'`; pass `audit` if the memory store keeps an audit list.
- **`supabase-store.ts`**: `...createInternationalService(createSupabaseInternationalBackend({ select, rpc }))`. Add the three names of
  `INTERNATIONAL_RPCS` to `COMPETITION_DETAIL_RPCS`, so the database's INVALID, STALE and NOT_FOUND sentences reach the owner:
  `admin_save_international_event`, `admin_set_international_event_published` and `admin_set_international_hosts`.
- **`http-store.ts`**: one method per action, POSTing to `/api/admin/international.<name>`, like the competition methods.
- **Nav**:
  - `src/admin/messages.ts`: add the route `international` to `ROUTES_ADMIN`.
    - `ROUTE_TITLE.international = 'International events'`
    - `ROUTE_NOTE.international = 'List big international events with one link to the official page.'`
  - `src/admin/AdminApp.tsx`: add `international: lazy(...)`. Use a thin `src/admin/screens/International.tsx` that renders
    `<InternationalScreen store={client} />` from `./international/International`. The screen takes the store as a prop and uses
    `useAdmin()` only for the actor, the notices and reloading.
  - `src/admin/screens/More.tsx`: add `'international'` to `ITEMS`, after `'competitions'`.

## 4. Database (0022)

- **New private tables**, both with RLS on, no policies, everything revoked, and SELECT for `service_role` only:
  - `public.international_events`: `id, name, level_text, start_date, end_date, city, country, official_url, published` (default false),
    plus `revision, created_at, updated_at`. It has no player, phone or contact column.
  - `public.international_settings`: one row, `id = 1, extra_hosts text[]` (default `{}`). Deleting the row is blocked.
- **New api view**: `api.public_international_events (id, name, level_text, start_date, end_date, city, country, official_url)`.
  - It is a security_barrier view with SELECT for anon and authenticated.
  - It returns published rows whose link's website (without `www.`) is a default host or one of `extra_hosts` NOW.
  - It calls no function, so anon needs nothing else.
- **RPCs** (service_role only; `app.require_owner` first; audit holds field names, counts and flags only):
  - `public.admin_save_international_event(text, uuid, jsonb, integer, text)`
  - `public.admin_set_international_event_published(text, uuid, boolean, integer, text)`
  - `public.admin_set_international_hosts(text, jsonb, text)`
  - Each calls `app.mark_dirty` when public content changes.
- **Helpers** (no grants, not SECURITY DEFINER): `app.international_default_hosts()`, `app.international_host_problem(text)`,
  `app.international_link_problem(text, text[])`, `app.international_hosts_problem(text[])`,
  `app.international_text(jsonb, text, integer, integer, boolean)`, `app.international_date(jsonb, text)` and
  `app.international_allowed_hosts()`.
- **Reused from 0017**: `app.competition_keys` and `app.competition_reason`.

### Checks run

- `node scripts/with-lock.mjs heavy -- node scripts/pg-local.mjs all`, then `stop`. Every migration from 0001 to 0022 applied, and
  checks 0001 to 0005 passed. It then **stopped at `0006_assertions.sql`**, because schema api holds views that are not on its allow-list.
  This is expected: the views are `public_international_events` (mine), and other agents' `public_registration_events`,
  `public_registration_payment` and `public_competition_live`.
- I then ran every other check by hand against the same database, under the heavy lock, with the server started and stopped by the same
  locked script, skipping 0006. Checks 0001 to 0005 and 0007 to 0022 all printed their `ok` row. 0019 to 0021 belong to other agents. The
  server was stopped afterwards.

## 5. Registries to update (the integrator's files)

**RLS_MATRIX (`src/lib/admin/policy.ts`)**
```ts
// 0022_international_links.sql (D-112): owner-entered international events and the allow-list; one api view (published rows on allowed sites)
'api.public_international_events': { private: false, grants: PUBLIC_VIEW },
'international_events': { private: true, grants: OWNER_READ_RPC_WRITE },
'international_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
```

**Anon harness (`scripts/anon-harness.mjs`)**
```js
// 0022_international_links.sql (D-112): both tables denied; the api view allows select only
{ name: 'international_events', pk: 'id', pkSample: NIL_UUID },
{ name: 'international_settings', pk: 'id', pkSample: '0' },
{ name: 'public_international_events', pk: 'id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
```

**`supabase/checks/0006_assertions.sql`**: add `'public_international_events'` to the allow-list of named later views, and mention 0022 in
its comment.

**`tests/supabase/bundle.test.ts`**: the last check's ok row is now `ok: 0022_international_links assertions passed`, unless a later
migration's comes after it.

**`tests/admin/rls-matrix-schema.test.ts`**: the api view count goes up by one for this migration (`public_international_events`).

These tests fail until the rows above exist. All the failures are expected and none is in this module:
- `tests/admin/rls-matrix-schema.test.ts`
- `tests/supabase/migration.test.ts`
- `tests/supabase/migrations-structure.test.ts` (anon harness table list)
- `tests/supabase/bundle.test.ts`
- `tests/supabase/local-pg.test.mjs` (0006 allow-list, when a local server is up)

Two other failures I saw in the same run are NOT from this area. Both point at `src/admin/screens/scoring/` (browser storage):
- `tests/admin/isolation.test.ts`
- `tests/legal/reality.test.ts`

## 6. Feature flag (`src/content/legal/status.ts`, `tests/legal/features.test.ts`)

```ts
/** Platform wave 5 (D-112). The /international/ page in the release build: international events listed with ONE link to the official page. */
readonly internationalLinks: boolean;
// features
internationalLinks: false,
// arrives / unlocks
internationalLinks: { arrives: 'platform wave 5 (owner + lawyer)', unlocks: 'the /international/ page in the release build: owner-listed international events (name, level, dates, place) with one link to the official site; nothing copied from those sites' },
```
`src/lib/international/in-build.ts` reads the flag defensively (`internationalLinksFlag()`): a missing flag counts as OFF, so nothing
changes until it is added and set to `true`.

## 7. Privacy (`src/content/legal/privacy.ts`, futureWording behind `features.internationalLinks`)

Suggested text for the lawyer to re-read (add to `docs/legal/G1_REREAD_CHECKLIST.md`):

> **Links to other websites.** Our International events page lists badminton events run by others, with a link to each event's official
> page (for example the Badminton World Federation's site). We do not copy results, draws, rankings or player details from those sites.
> When you follow a link you leave our website: the other site's own terms and privacy policy apply. Our links tell your browser not to
> send that site the address of our page.

The last sentence is true because of `rel="noreferrer"`. The page sets no cookie and loads nothing from the linked sites.

## 8. Build and runtime settings

- **New build variable** (read like `PS_COMPETITION_SOURCE`, in `src/lib/international/public/load.ts`; not a secret and not a runtime
  setting): `PS_INTERNATIONAL_SOURCE`. Only exactly `supabase` reads the view, using the existing `PUBLIC_SUPABASE_URL` and
  `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Anything else uses the fictional seed, which the strict build refuses. Add it to the deploy workflow
  next to `PS_COMPETITION_SOURCE` when the page goes live.
- **No new runtime (Vercel) variable**, no secret and no new endpoint: the page is static.

## 9. Optional, for the lead

- `src/lib/urls.ts`: an `INTERNATIONAL_ROUTES = { index: path('/international/') }` if a nav or footer link is wanted. A public nav link
  must only appear when `internationalInBuild()` is true. Otherwise the strict build would link to a page it does not make, and
  `tests/build/links.test.ts` would fail.
- A belt-and-braces prune step can use `INTERNATIONAL_OUTPUT_PATHS` (`['international']`). It is not needed: the route makes no page
  while the switch is off.
- `docs/PLATFORM_CHECKLIST.md`, wave 5 row: "international link-out listings (D-112): built (0022, /international/ behind
  internationalLinks, admin International events)".
- `CHANGELOG.md`: one line for the slice.
- The test probe for the anon harness against the live REST API, once the dev project has 0022:
  - `GET /rest/v1/public_international_events?select=id&limit=1` with `accept-profile: api` returns 200.
  - `GET /rest/v1/international_events` and `GET /rest/v1/international_settings` are refused for anon.
