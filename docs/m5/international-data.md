# International data (Module 8): facts, decision and the adapter layer

Wave 2 of the platform brief, written 2026-10-30. Facts only, each with its source and the date it was read. Anything not
confirmed from a primary source is marked **unverified**. Nothing here is legal advice; licence questions go to the owner and the
lawyer (CLAUDE.md "Ask first").

## Recommendation (safe default)

- **No scraping** of bwfbadminton.com, tournamentsoftware.com or any other site. International data comes only from a **licensed
  source** through its documented interface, after the owner (and the lawyer) sign an agreement.
- The adapter layer (`src/lib/providers/`) is built and tested, but the **production registry is empty**: every provider reports
  `not_registered`, `disabled`, `awaiting_licence` or `awaiting_credentials`, never a fake success.
- Nothing is wired to a page, a schedule, a route or the database. International rankings, when they exist, are the provider's
  rankings and stay separate from the local, unofficial rankings (which stay unpublished until the owner approves).

## Facts found (read 2026-10-30)

| # | Fact | Source | Status |
|---|---|---|---|
| F1 | BWF has a "Data Hub" built with PASS Consulting Group that holds data from BWF-sanctioned competitions (player data, results, rankings; badminton and Para badminton; historical and current). The article names tournament hosts, member associations, continental confederations and "various sports portals and apps" as users. It does not describe a public API or how outsiders get access. Article dated 2023-10-26. | https://www.pass-consulting.com/en/news/data-center-for-the-badminton-world-federation/ | Confirmed that it exists; **access terms unverified** |
| F2 | Stats Perform signed a five-year deal (from January 2022) as the exclusive distributor of live streams and real-time data from BWF events to licensed betting operators; media get clips and live scores through its Pressbox service. Coverage named: World Championships, Thomas & Uber Cup, Sudirman Cup, World Tour levels, World Tour Finals. Reported 2021-07-20. | https://igamingbusiness.com/stats-perform-scores-exclusive-streaming-and-data-deal-with-badminton-world-federation/ ; press release https://www.statsperform.com/insights/stats-perform-adds-exclusive-coverage-of-elite-bwf-badminton-tournaments-to-its-live-video-and-data-service/ (not opened) | Secondary report; **whether it still runs after 2026, and whether a media (non-betting) licence for a website is offered, unverified** |
| F3 | Sportradar is the official data partner of **Badminton Europe** (continental, not BWF) for its competitions, since 2015, extended in 2020/2021. | https://insidersport.com/2020/07/28/badminton-europe-names-sportradar-as-official-data-partner/ ; https://media.sportbusiness.com/news/badminton-europe-signs-comprehensive-data-and-ott-deal-with-sportradar | Secondary reports; **current status unverified**; covers European events only |
| F4 | BWF announced the closure of its Tournament Software websites (bwf.tournamentsoftware.com, bwfpara.tournamentsoftware.com) from 2025-01-07 (news item dated 2024-10-21). | https://corporate.bwfbadminton.com/news-single/2024/10/21/closure-of-tournament-software-websites-from-7-january-2025/ (title seen in search; the page returned HTTP 403 to our fetch) | Title confirmed; **content unverified** |
| F5 | tournamentsoftware.com robots.txt disallows, for all user agents, paths including `/tournament/`, `/ranking/`, `/player/`, `/profile/`, `/league/` and `/sport/`. | https://www.tournamentsoftware.com/robots.txt (fetched 2026-10-30) | Confirmed |
| F6 | bwfbadminton.com robots.txt only disallows `/24-live-blog/` and the plain-text terms page. robots.txt is not a licence: it says nothing about permission to reuse data. | https://bwfbadminton.com/robots.txt (fetched 2026-10-30) | Confirmed |
| F7 | The terms and conditions of bwfbadminton.com and tournamentsoftware.com (any clause on scraping, automated access or reuse of results and rankings) could not be read: the BWF page returned HTTP 403 and no tournamentsoftware.com terms page was found. | https://bwfbadminton.com/terms-and-conditions/ | **Unverified** |
| F8 | No official, public, self-service BWF API was found in this research. | Searches 2026-10-30 | **Unverified** (absence of evidence only) |

## What was not established (TODO for the lead and the owner)

- TODO(lead): read the current BWF and tournamentsoftware.com terms of use in a normal browser and record the exact clauses on
  automated access and data reuse (F7). Until then assume reuse is NOT permitted.
- TODO(owner): if international data is wanted, ask BWF (and, for European events, Badminton Europe) in writing whether a media or
  fan-site data licence exists, what it covers, the price and the attribution rules. Claude does not send this (messaging anyone is
  ask-first).
- TODO(lead): if a commercial provider (F2, F3 or another) is considered, record its offer, coverage, price and licence terms from the
  provider itself; no price or term is assumed here.
- Badminton Association of India / Tamil Nadu sources were out of scope for this wave: **unverified**.

## The adapter layer (`src/lib/providers/`)

| File | What it does |
|---|---|
| `types.ts` | Normalised entities (`ProviderTournament`, `ProviderDraw`, `ProviderMatch`, `ProviderPlayer`, `ProviderRanking`), the `DataProvider` interface (`listTournaments`, `getTournament`, `getDraws`, `getMatches`, `getRankings`), the idempotency key `(provider, externalType, externalId)`, validators (fail closed). |
| `errors.ts` | `TransientProviderError`, `ProviderTimeoutError`, `RateLimitedError` (with Retry-After), `ProviderAuthError`, `PermanentProviderError`; `parseRetryAfter` (seconds or HTTP-date, injected clock). |
| `retry.ts` | Exponential backoff with equal jitter, per-call timeout (aborts the call's signal), Retry-After honoured exactly, a Retry-After above `maxRetryAfterMs` stops the run. Sleep, timer, clock and random are injected; `realSleep` is the production sleep. |
| `registry.ts` | `ProviderRegistry`: a provider is handed out only when the switch is exactly `true`, a **signed** licence is recorded and every credential is present (names reported, never values). `createProductionRegistry()` is empty. |
| `merge.ts` | Conflict policy: verified fields never overwritten (conflict reported), local-only fields set once, omitted/null provider values never erase local data, lists replaced as a whole. |
| `map.ts` | Entity to stored data, and to the competition vocabulary (`Entry`, `MatchResult` in `src/lib/competition/types.ts`). Imported players always get `ageStatus: 'unknown'` (protected, D-012) whatever the provider hints; imported results are `confirmed: false` unless the caller explicitly trusts the provider's final flag. |
| `sync.ts` | `runSync` and `runSyncFromRegistry`: idempotent upserts through an injected `SyncStore` (no delete method), incremental cursors per stream saved after each page, sync history entry on every run (statuses `succeeded`, `partial`, `failed`, `rate_limited`, `credentials_rejected`, `cancelled`, or the registry status such as `awaiting_credentials`). |

### Review fixes (wave 2)

- **Total validators.** `validateTournament`, `validateDraw`, `validateMatch` and `validateRanking` take `unknown` and never throw: a null
  item, `{}`, or a missing `events`, `entries`, `players`, `playerExternalIds`, `games` or `rows` list is a problem, so the item is rejected
  and counted (`code: invalid`). As a second guard, the sync processes every item inside a try: any other non-fatal throw rejects that one
  item (`code: item_failed`). A store failure or cancellation still stops the run. A page without an item list stops only that stream.
  One bad provider record therefore never ends a run as `unexpected` and never blocks a stream's cursor.
- **Cursor contract.** A provider's `syncCursor` MUST be an updated-since / high-water mark covering CHANGED items, not only new ones
  (documented on `Page` in `types.ts`). Guard for providers that cannot do that: `SyncStore.listOpenTournamentIds` (optional) returns
  the stored tournaments that still have a match in an open status (`scheduled`, `ready`, `live`, `paused`, `postponed`;
  `OPEN_MATCH_STATUSES`). A default run (no `tournamentExternalIds`) adds them to its targets, refreshes their draws and re-reads their
  matches from the start, so a match stored as live is picked up when it completes. Explicit `tournamentExternalIds` win. A Supabase
  store must implement this query (TODO(lead), with the store itself).

Tests: `tests/providers/` with a FICTIONAL `FakeProvider` and an in-memory store (`tests/providers/fake-provider.ts`, test-only,
not exported from `src/lib/providers/index.ts`; `isolation.test.ts` checks this and that no production file fetches a URL).

### Left for later (needs the lead or the owner)

- A Supabase `SyncStore` (migration with RLS, explicit grants, `api` views only for anything public) and the admin screens for sync
  history and conflicts. Not built: no licensed source, and SQL was outside this wave's area.
- Reading provider switches and credentials through `src/lib/runtime-env.ts` (names only in `docs/SECRETS.md`).
- A schedule or trigger (owner-approved; same parking rules as the YouTube sync).
- Any public display: protected players (D-012) and the YouTube/legal switches apply; international rankings must be labelled as the
  provider's, with the provider's required attribution (unverified until a licence exists).

## Link-out listings (wave 5, D-112, 2026-10-31)

Separate from the adapter layer above and needing no licence: the owner types in major international events (name, level text, dates,
city, country) with ONE link to the official page. Nothing is fetched, scraped or copied from the linked site (no results, draws,
rankings, logos or player data); the page says "Details and results on the official site".

- Rules: `src/lib/international/link-rules.ts` (shared by the admin form, the service and the page model; mirrored by
  `app.international_link_problem` in `supabase/migrations/0022_international_links.sql`). Allowed websites: `bwfbadminton.com`,
  `tournamentsoftware.com`, `bwf.tournamentsoftware.com` (with or without `www.`), plus hosts the owner adds in the admin. http(s) only;
  user names, ports, punycode, IP addresses and link shorteners refused; tracking parameters and the `#` part removed before storing.
- Note F4 above: BWF announced the closure of `bwf.tournamentsoftware.com` from 2025-01-07 (content unverified). The host stays on the
  default list because the brief names it; a link to a closed site is the owner's choice and can be edited or hidden.
- Public view `api.public_international_events` (published rows on an allowed website only), page `/international/` behind
  `features.internationalLinks`, admin screen "International events". Integration notes: `docs/m5/integration/international.md`.
