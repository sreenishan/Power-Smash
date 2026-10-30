-- 0017_competition.sql: the competition database (platform brief Modules 3-7, 9 and 17; wave 2 "Foundations").
--
-- Events inside a tournament, entries, draws, matches, games, the rally log, unofficial local rankings, organizer and scorer
-- assignments (inert), a notification outbox, and the data-provider bookkeeping for a future LICENSED international source.
-- It reuses public.tournaments (0004) and public.players (0004/0012); it does not duplicate them.
--
-- SAFE DEFAULTS of this wave (docs/PLATFORM_CHECKLIST.md; each is a switch in public.competition_settings, all OFF, with no write path
-- in this migration: switching one on is a later, owner-approved change):
--   * Organizer, scorer and player accounts: the roles exist in the data model (organizer_assignments.role, the settings switches) but
--     are DISABLED. profiles.role stays owner | editor (0008), sign-ups stay disabled, every RPC below is owner only (app.require_owner).
--     organizer_assignments is inert: nothing reads it to grant anything.
--   * Juniors and unknown-age players are NEVER named publicly (D-012, fail closed): a player is named in an api view only if they are in
--     app.eligible_players (0006: adult_confirmed, public, non-provisional, unmerged, unsuppressed, with a public match page), and nobody
--     is named in a junior event (a junior category, an age group up to U19, a junior word, or a tournament with a minor signal). Everyone
--     else shows as a null name with is_protected = true. An adult who has no public archive match yet is therefore shown as protected
--     too, until the owner confirms them the usual way (fail closed).
--   * Registration and payments OFF: registration_enabled = false; payment_mode is 'off' and can only ever be 'off' or
--     'manual_verification' (no gateway exists here). Entries are added by the owner only.
--   * Rankings are local and UNOFFICIAL ("not an official BWF ranking"), unpublished until the owner publishes a snapshot AND switches
--     rankings_public on. ranking_snapshots.is_official can only be false.
--   * International data: data_providers start empty; a provider can only be enabled once its licence is recorded as 'licensed'
--     (licence terms unverified: TODO(lead) when a licensed source is chosen). No scraping: an import run needs an enabled provider.
--
-- House rules (0001-0016): RLS on with NO policies, everything revoked, explicit grants (service_role select only); writes only through
-- SECURITY DEFINER RPCs with a fixed search_path that call app.require_owner FIRST; audit through app.audit with field names, counts and
-- codes only (never a player's name or free text); app.mark_dirty where public content changes; errors start 'INVALID:', 'NOT_FOUND:'
-- or 'STALE:'. Check constraints and triggers mirror the engines in src/lib/competition (scoring: BWF Laws 7.1-7.4 by default).
-- Public reads only through the explicit-column api views at the end (security_barrier, never select *); the column lists are mirrored in
-- src/lib/competition/db.ts and tested by tests/competition/db.test.ts. Apply after 0016, then run supabase/checks/0017_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- Scoring rules in SQL (mirrors src/lib/competition/scoring/index.ts). Pure, immutable, no table access.
-- A ruleset is the TS Ruleset as jsonb: {gamesToWin, pointsToWin, winBy, pointCap, intervalAt, changeEndsInDecidingGameAt}.
-- Stricter than the engine on purpose (safe default): pointCap is REQUIRED and at most 30 (the engine also allows "no cap"), so every
-- stored game fits the 0..30 column checks; gamesToWin is 1 to 3 (best of five at most); winBy 1 to 10.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.competition_ruleset_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys constant text[] := array['gamesToWin', 'pointsToWin', 'winBy', 'pointCap', 'intervalAt', 'changeEndsInDecidingGameAt'];
  k text;
  v_ptw integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'the ruleset must be an object'; end if;
  for k in select jsonb_object_keys(p) loop
    if not k = any (v_keys) then return 'unknown ruleset field ' || k; end if;
  end loop;
  foreach k in array v_keys loop
    if not p ? k then return 'the ruleset field ' || k || ' is missing'; end if;
    if jsonb_typeof(p -> k) = 'null' and k in ('intervalAt', 'changeEndsInDecidingGameAt') then continue; end if;
    if jsonb_typeof(p -> k) <> 'number' or (p ->> k) !~ '^[0-9]{1,3}$' then return 'the ruleset field ' || k || ' must be a whole number'; end if;
  end loop;
  v_ptw := (p ->> 'pointsToWin')::integer;
  if (p ->> 'gamesToWin')::integer not between 1 and 3 then return 'games to win must be 1 to 3'; end if;
  if v_ptw not between 1 and 30 then return 'points to win must be 1 to 30'; end if;
  if (p ->> 'winBy')::integer not between 1 and 10 then return 'the winning lead must be 1 to 10'; end if;
  if (p ->> 'pointCap')::integer not between v_ptw and 30 then return 'the point cap must be from the points to win up to 30'; end if;
  foreach k in array array['intervalAt', 'changeEndsInDecidingGameAt'] loop
    if jsonb_typeof(p -> k) = 'number' and (p ->> k)::integer not between 1 and v_ptw - 1 then
      return k || ' must be from 1 to one less than the points to win (or null)';
    end if;
  end loop;
  return null;
end;
$$;

-- isGameOver: the cap wins outright; otherwise points to win AND the winning lead
create or replace function app.competition_game_over(p_a integer, p_b integer, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select greatest(p_a, p_b) >= (p ->> 'pointCap')::integer
      or (greatest(p_a, p_b) >= (p ->> 'pointsToWin')::integer and abs(p_a - p_b) >= (p ->> 'winBy')::integer);
$$;

-- validateGame (finished) / isValidInProgressGame (not finished): null = fine, else the reason in plain English
create or replace function app.competition_game_problem(p_a integer, p_b integer, p jsonb, p_finished boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  w integer;
  l integer;
begin
  if app.competition_ruleset_problem(p) is not null then return 'the ruleset is not usable'; end if;
  if p_a is null or p_b is null or p_a < 0 or p_b < 0 then return 'scores must be whole numbers, 0 or more'; end if;
  if not coalesce(p_finished, true) then
    if app.competition_game_over(p_a, p_b, p) then return p_a || '-' || p_b || ' is a finished score, so the game cannot be unfinished'; end if;
    return null;
  end if;
  if p_a = p_b then return p_a || '-' || p_b || ': the scores are level, so the game has no winner yet'; end if;
  w := greatest(p_a, p_b);
  l := least(p_a, p_b);
  if w > (p ->> 'pointCap')::integer then return p_a || '-' || p_b || ': no game goes past ' || (p ->> 'pointCap') || ' points'; end if;
  if not app.competition_game_over(w, l, p) then return p_a || '-' || p_b || ': the game is not over'; end if;
  if app.competition_game_over(w - 1, l, p) then return p_a || '-' || p_b || ': the game would already have ended a point earlier'; end if;
  return null;
end;
$$;

-- validateMatch: returns the winning side ('A' | 'B'), or null for an abandoned match; raises INVALID with the reason otherwise.
-- p_games is a json array of {"a": n, "b": n}. completed: every game finished and the match decided exactly by the last game.
-- walkover: no games, the side that received it wins. retired: every game but the last finished, the last may be unfinished, the match
-- not already decided; the opponent of the retiring side wins. abandoned: like retired, with no winner.
create or replace function app.competition_result_winner(p_games jsonb, p jsonb, p_status text, p_walkover_winner text, p_retiring_side text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer;
  i integer;
  g jsonb;
  a integer;
  b integer;
  v_problem text;
  wins_a integer := 0;
  wins_b integer := 0;
  v_gtw integer;
  v_decided_at integer;
begin
  v_problem := app.competition_ruleset_problem(p);
  if v_problem is not null then raise exception 'INVALID: the event ruleset is not usable: %', v_problem using errcode = '22023'; end if;
  v_gtw := (p ->> 'gamesToWin')::integer;
  if p_status is null or p_status not in ('completed', 'walkover', 'retired', 'abandoned') then
    raise exception 'INVALID: a result is completed, walkover, retired or abandoned' using errcode = '22023';
  end if;
  if p_games is null or jsonb_typeof(p_games) <> 'array' then raise exception 'INVALID: the games must be a list' using errcode = '22023'; end if;
  n := jsonb_array_length(p_games);
  if p_status <> 'walkover' and p_walkover_winner is not null then raise exception 'INVALID: only a walkover names a walkover winner' using errcode = '22023'; end if;
  if p_status not in ('retired') and p_retiring_side is not null then raise exception 'INVALID: only a retirement names a retiring side' using errcode = '22023'; end if;

  if p_status = 'walkover' then
    if n > 0 then raise exception 'INVALID: a walkover has no games' using errcode = '22023'; end if;
    if p_walkover_winner is null or p_walkover_winner not in ('A', 'B') then raise exception 'INVALID: say which side received the walkover' using errcode = '22023'; end if;
    return p_walkover_winner;
  end if;
  if n > 2 * v_gtw - 1 then raise exception 'INVALID: a match has at most % games; % were given', 2 * v_gtw - 1, n using errcode = '22023'; end if;
  if p_status = 'completed' and n = 0 then raise exception 'INVALID: a completed match needs its game scores' using errcode = '22023'; end if;
  if p_status = 'retired' and (p_retiring_side is null or p_retiring_side not in ('A', 'B')) then raise exception 'INVALID: say which side retired' using errcode = '22023'; end if;
  -- like validateMatch: a side that retires before any rally is a walkover, not a retirement (no games, or only 0-0 games)
  if p_status = 'retired' and not exists (
       select 1 from jsonb_array_elements(p_games) x
       where not (jsonb_typeof(x) = 'object' and (x ->> 'a') = '0' and (x ->> 'b') = '0')) then
    raise exception 'INVALID: no rally was played: record this as a walkover, not a retirement' using errcode = '22023';
  end if;

  for i in 1 .. n loop
    g := p_games -> (i - 1);
    if jsonb_typeof(g) <> 'object' or (select count(*) from jsonb_object_keys(g)) <> 2 or not (g ? 'a' and g ? 'b')
       or jsonb_typeof(g -> 'a') <> 'number' or jsonb_typeof(g -> 'b') <> 'number' or (g ->> 'a') !~ '^[0-9]{1,2}$' or (g ->> 'b') !~ '^[0-9]{1,2}$' then
      raise exception 'INVALID: game % must be {"a": points, "b": points} with whole numbers', i using errcode = '22023';
    end if;
    a := (g ->> 'a')::integer;
    b := (g ->> 'b')::integer;
    if p_status = 'completed' or i < n or app.competition_game_over(a, b, p) then
      v_problem := app.competition_game_problem(a, b, p, true);
      if v_problem is not null then raise exception 'INVALID: game %: %', i, v_problem using errcode = '22023'; end if;
      if a > b then wins_a := wins_a + 1; else wins_b := wins_b + 1; end if;
      if v_decided_at is null and (wins_a >= v_gtw or wins_b >= v_gtw) then v_decided_at := i; end if;
    end if;
  end loop;

  if p_status = 'completed' then
    if v_decided_at is null then raise exception 'INVALID: nobody has won % games yet, so the match is not complete', v_gtw using errcode = '22023'; end if;
    if v_decided_at < n then raise exception 'INVALID: the match was already decided after game %; no games can follow it', v_decided_at using errcode = '22023'; end if;
    return case when wins_a >= v_gtw then 'A' else 'B' end;
  end if;
  if v_decided_at is not null then raise exception 'INVALID: the match was already decided by the games played, so it cannot end this way' using errcode = '22023'; end if;
  if p_status = 'retired' then return case p_retiring_side when 'A' then 'B' else 'A' end; end if;
  return null;  -- abandoned
end;
$$;

-- The BWF default ruleset, the same values as DEFAULT_RULESET in src/lib/competition/scoring/index.ts
create or replace function app.competition_default_ruleset()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"gamesToWin": 2, "pointsToWin": 21, "winBy": 2, "pointCap": 30, "intervalAt": 11, "changeEndsInDecidingGameAt": 11}'::jsonb;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Age groups: ONLY the canonical AgeGroup vocabulary of src/lib/parser/types.ts (PC-13): U<n>, <n>+, senior, open, veterans,
-- masters, sub_junior, junior, youth, cadet, mini. Anything else ('U-17', 'Under17', 'U17B') is refused at the door.
-- competition_age_is_junior is FAIL CLOSED (D-012): an age group counts as adult ONLY when it is null or recognised as adult
-- (senior, open, veterans, masters, U20 and above, 19+ and above); everything else, unknown spellings included, is junior.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.competition_age_group_ok(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or p ~ '^(U[0-9]{1,2}|[0-9]{1,2}\+|senior|open|veterans|masters|sub_junior|junior|youth|cadet|mini)$';
$$;

create or replace function app.competition_age_is_junior(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then false
    when p in ('senior', 'open', 'veterans', 'masters') then false
    when p ~ '^U[0-9]{1,2}$' then substring(p from 2)::integer < 20
    when p ~ '^[0-9]{1,2}\+$' then left(p, -1)::integer < 19
    else true
  end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Outbox payload rule (D-029): a FLAT object of references and codes, never contact data. Keys are identifiers (letters, digits,
-- _) and never contact-like (phone, mail, whatsapp, wa, mobile, address, contact, name, to, tel, msisdn, recipient), case-insensitive.
-- Values are null, a boolean, a whole number 0..999999, a uuid, a YYYY-MM-DD date, an ISO instant, or a code (starts with a
-- letter, letters, digits, _ : -, at most 80, no run of 7 or more digits). No nested object or list, no '@', no '+', no spaces:
-- a phone number or an email address cannot fit under any key. (TODO(lead): reconcile with src/lib/notify/outbox when it is
-- wired to this table; message text is rendered at send time, never stored here.)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.competition_outbox_payload_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and jsonb_typeof(p) = 'object' and length(p::text) <= 2000
    and not exists (
      select 1 from jsonb_each(p) kv
      where kv.key !~ '^[A-Za-z][A-Za-z0-9_]{0,39}$'
         or lower(kv.key) ~ '(phone|mail|whatsapp|mobile|address|addr|contact|name|msisdn|recipient)'
         or lower(kv.key) ~ '^(to|wa|tel|cc|bcc)(_|$)'
         or not (
           jsonb_typeof(kv.value) in ('null', 'boolean')
           or (jsonb_typeof(kv.value) = 'number' and (kv.value #>> '{}') ~ '^[0-9]{1,6}$')
           or (jsonb_typeof(kv.value) = 'string' and (
                (kv.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                or (kv.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
                or (kv.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$'
                or ((kv.value #>> '{}') ~ '^[A-Za-z][A-Za-z0-9_:-]{0,79}$' and (kv.value #>> '{}') !~ '[0-9]{7,}')))
         )
    );
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- competition_settings: one row of switches, ALL OFF (the safe defaults above). No write path in this migration.
-- ------------------------------------------------------------------------------------------------------------------
create table public.competition_settings (
  id                        smallint    primary key check (id = 1),
  organizer_roles_enabled   boolean     not null default false,
  player_accounts_enabled   boolean     not null default false,
  registration_enabled      boolean     not null default false,
  payment_mode              text        not null default 'off' check (payment_mode in ('off', 'manual_verification')),
  rankings_public           boolean     not null default false,
  updated_at                timestamptz not null default now(),
  -- registration can never take payments while it is off, and there is no payment gateway mode at all
  constraint competition_settings_payments_need_registration check (payment_mode = 'off' or registration_enabled)
);
comment on table public.competition_settings is 'Competition switches (wave 2 safe defaults): accounts, registration, payments, public rankings. All off until the owner decides.';
insert into public.competition_settings (id) values (1);
create trigger competition_settings_touch_updated_at before update on public.competition_settings for each row execute function app.touch_updated_at();
create trigger competition_settings_no_delete before delete on public.competition_settings for each row execute function app.forbid_row_change();

alter table public.competition_settings enable row level security;
revoke all on table public.competition_settings from public, anon, authenticated, service_role;
grant select on public.competition_settings to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- tournament_events: one event (category + age group) inside a tournament
-- ------------------------------------------------------------------------------------------------------------------
create table public.tournament_events (
  id             uuid        primary key default gen_random_uuid(),
  tournament_id  uuid        not null references public.tournaments (id) on delete restrict,
  category       text        not null check (category in ('MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD')),
  age_group      text        check (app.competition_age_group_ok(age_group)),
  -- computed at write time (fail closed, D-012/D-109): public views read this column and never call the function, because the API
  -- roles hold no EXECUTE on schema app functions (0001 check) and a view's function calls are checked against the reader
  is_junior      boolean     not null generated always as (category in ('BS', 'GS', 'BD', 'GD') or app.competition_age_is_junior(age_group)) stored,
  format         text        not null check (format in ('knockout', 'round_robin', 'groups_knockout')),
  ruleset        jsonb       not null default app.competition_default_ruleset() check (app.competition_ruleset_problem(ruleset) is null),
  capacity       integer     check (capacity is null or capacity between 2 and 1024),
  status         text        not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.tournament_events is 'An event (category, age group, format, scoring ruleset) of a tournament. Public only when the tournament is public and the event is not a draft.';
create unique index tournament_events_unique_idx on public.tournament_events (tournament_id, category, coalesce(age_group, ''));
create trigger tournament_events_touch_updated_at before update on public.tournament_events for each row execute function app.touch_updated_at();

alter table public.tournament_events enable row level security;
revoke all on table public.tournament_events from public, anon, authenticated, service_role;
grant select on public.tournament_events to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- venues and courts (a court belongs to one tournament; a venue is optional)
-- ------------------------------------------------------------------------------------------------------------------
create table public.venues (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (name = btrim(name) and length(name) between 2 and 160 and name !~ '[[:cntrl:]]'),
  city        text        check (city is null or (city = btrim(city) and length(city) between 1 and 60 and city !~ '[[:cntrl:]]')),
  created_at  timestamptz not null default now()
);
comment on table public.venues is 'A badminton hall. Public facts only (no contact person, no phone).';

alter table public.venues enable row level security;
revoke all on table public.venues from public, anon, authenticated, service_role;
grant select on public.venues to service_role;

create table public.courts (
  id             uuid        primary key default gen_random_uuid(),
  tournament_id  uuid        not null references public.tournaments (id) on delete restrict,
  venue_id       uuid        references public.venues (id) on delete restrict,
  label          text        not null check (label = btrim(label) and length(label) between 1 and 40 and label !~ '[[:cntrl:]]'),
  sort           integer     not null default 0 check (sort between 0 and 999),
  created_at     timestamptz not null default now(),
  constraint courts_label_unique unique (tournament_id, label)
);
comment on table public.courts is 'A court used by one tournament (for example "Court 1").';

alter table public.courts enable row level security;
revoke all on table public.courts from public, anon, authenticated, service_role;
grant select on public.courts to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- event_entries: a player (singles) or a pair (doubles) in one event
-- Statuses: pending (waiting for the owner), confirmed, waitlisted, withdrawn, rejected. pending and confirmed count towards capacity.
-- (The brief's exact registration status list was not available to this migration: TODO(lead) reconcile with the registration wave.)
-- event_entry_players holds one row per player of an ACTIVE entry (not withdrawn or rejected): its primary key (event, player) is the
-- real uniqueness rule across both positions of a pair. Writes only through admin_add_entry / admin_withdraw_entry.
-- ------------------------------------------------------------------------------------------------------------------
create table public.event_entries (
  id           uuid        primary key default gen_random_uuid(),
  event_id     uuid        not null references public.tournament_events (id) on delete restrict,
  player1_id   uuid        not null references public.players (id) on delete restrict,
  player2_id   uuid        references public.players (id) on delete restrict,
  seed         integer     check (seed is null or seed between 1 and 256),
  status       text        not null default 'pending' check (status in ('pending', 'confirmed', 'waitlisted', 'withdrawn', 'rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint event_entries_distinct_players check (player2_id is null or player2_id <> player1_id)
);
comment on table public.event_entries is 'Private. An entry (one player or a pair) in an event. Names reach the public only through the api views, masked for protected players (D-012).';
create index event_entries_event_idx on public.event_entries (event_id);
create unique index event_entries_seed_idx on public.event_entries (event_id, seed) where seed is not null and status in ('pending', 'confirmed', 'waitlisted');
create trigger event_entries_touch_updated_at before update on public.event_entries for each row execute function app.touch_updated_at();

alter table public.event_entries enable row level security;
revoke all on table public.event_entries from public, anon, authenticated, service_role;
grant select on public.event_entries to service_role;

create table public.event_entry_players (
  event_id   uuid not null references public.tournament_events (id) on delete restrict,
  player_id  uuid not null references public.players (id) on delete restrict,
  entry_id   uuid not null references public.event_entries (id) on delete cascade,
  primary key (event_id, player_id)
);
comment on table public.event_entry_players is 'Private. One row per player of an active entry: a player is in an event at most once (singles or either side of a pair).';
create index event_entry_players_entry_idx on public.event_entry_players (entry_id);

alter table public.event_entry_players enable row level security;
revoke all on table public.event_entry_players from public, anon, authenticated, service_role;
grant select on public.event_entry_players to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- draws and draw_slots: one draw per event; draft -> published -> locked. A published or locked draw can never be regenerated,
-- changed or deleted (the guards below refuse it whoever writes). It locks when the first result is recorded.
-- ------------------------------------------------------------------------------------------------------------------
create table public.draws (
  id            uuid        primary key default gen_random_uuid(),
  event_id      uuid        not null references public.tournament_events (id) on delete restrict,
  seed          bigint      not null check (seed between 0 and 4294967295),
  status        text        not null default 'draft' check (status in ('draft', 'published', 'locked')),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint draws_one_per_event unique (event_id),
  constraint draws_published_at check ((status = 'draft') = (published_at is null))
);
comment on table public.draws is 'The draw of an event and the random seed it used (reproducible, src/lib/competition/types.ts seededRandom). Published = immutable.';
create trigger draws_touch_updated_at before update on public.draws for each row execute function app.touch_updated_at();

alter table public.draws enable row level security;
revoke all on table public.draws from public, anon, authenticated, service_role;
grant select on public.draws to service_role;

create table public.draw_slots (
  draw_id      uuid    not null references public.draws (id) on delete cascade,
  position     integer not null check (position between 1 and 1024),
  entry_id     uuid    references public.event_entries (id) on delete restrict,
  group_label  text    check (group_label is null or group_label ~ '^[A-Z]{1,2}$'),
  primary key (draw_id, position),
  constraint draw_slots_entry_once unique (draw_id, entry_id)
);
comment on table public.draw_slots is 'The positions of a draw: an entry, or a bye (entry_id null). group_label for group stages.';

alter table public.draw_slots enable row level security;
revoke all on table public.draw_slots from public, anon, authenticated, service_role;
grant select on public.draw_slots to service_role;

create or replace function app.competition_draw_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'INVALID: a published draw cannot be deleted or regenerated' using errcode = '42501'; end if;
    return old;
  end if;
  if new.event_id <> old.event_id then raise exception 'INVALID: a draw cannot move to another event' using errcode = '42501'; end if;
  if old.status = 'draft' then
    if new.status = 'locked' then raise exception 'INVALID: a draft draw is published before it locks' using errcode = '42501'; end if;
    return new;
  end if;
  -- published or locked: only published -> locked, nothing else changes
  if not (old.status = 'published' and new.status = 'locked' and new.seed = old.seed and new.published_at = old.published_at)
     and not (new.status = old.status and new.seed = old.seed and new.published_at = old.published_at) then
    raise exception 'INVALID: a published draw cannot be regenerated or changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger draws_guard before update or delete on public.draws for each row execute function app.competition_draw_guard();

create or replace function app.competition_draw_slots_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select d.status into v_status from public.draws d where d.id = case when tg_op = 'DELETE' then old.draw_id else new.draw_id end;
  -- a missing draw (cascade delete of a draft) is fine; anything but a draft is refused
  if v_status is not null and v_status <> 'draft' then
    raise exception 'INVALID: the slots of a published draw cannot change' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.draw_id <> new.draw_id then raise exception 'INVALID: a slot cannot move to another draw' using errcode = '42501'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger draw_slots_guard before insert or update or delete on public.draw_slots for each row execute function app.competition_draw_slots_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- competition_matches: statuses = MATCH_STATUSES (src/lib/competition/types.ts). A result counts only once confirmed; a confirmed
-- match never changes (the guard refuses). revision is the optimistic lock the admin sends back (STALE on a mismatch).
-- ------------------------------------------------------------------------------------------------------------------
create table public.competition_matches (
  id             uuid        primary key default gen_random_uuid(),
  event_id       uuid        not null references public.tournament_events (id) on delete restrict,
  round_code     text        not null check (round_code in ('F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league')),
  match_number   integer     not null check (match_number between 1 and 9999),
  group_label    text        check (group_label is null or group_label ~ '^[A-Z]{1,2}$'),
  side_a_entry   uuid        references public.event_entries (id) on delete restrict,
  side_b_entry   uuid        references public.event_entries (id) on delete restrict,
  scheduled_at   timestamptz,
  court_id       uuid        references public.courts (id) on delete restrict,
  status         text        not null default 'scheduled'
                 check (status in ('scheduled', 'ready', 'live', 'paused', 'completed', 'walkover', 'retired', 'abandoned', 'postponed', 'cancelled')),
  winner_side    text        check (winner_side is null or winner_side in ('A', 'B')),
  confirmed      boolean     not null default false,
  confirmed_at   timestamptz,
  confirmed_by   text,
  result_source  text        check (result_source is null or result_source in ('admin', 'scorer', 'import')),
  revision       integer     not null default 1 check (revision >= 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint competition_matches_number_unique unique (event_id, match_number),
  constraint competition_matches_sides_differ check (side_a_entry is null or side_b_entry is null or side_a_entry <> side_b_entry),
  constraint competition_matches_group_round check ((round_code = 'group') = (group_label is not null)),
  -- a winner exactly for the decided statuses (DECIDED_STATUSES); abandoned has none
  constraint competition_matches_winner check ((status in ('completed', 'walkover', 'retired')) = (winner_side is not null)),
  constraint competition_matches_confirmed check (
    (not confirmed and confirmed_at is null and confirmed_by is null)
    or (confirmed and confirmed_at is not null and confirmed_by is not null and status in ('completed', 'walkover', 'retired', 'abandoned'))
  ),
  constraint competition_matches_source check ((status in ('completed', 'walkover', 'retired', 'abandoned')) = (result_source is not null))
);
comment on table public.competition_matches is 'A match of an event. Results reach the public only once confirmed (api.public_competition_matches).';
create index competition_matches_event_idx on public.competition_matches (event_id, round_code, match_number);
create index competition_matches_scheduled_idx on public.competition_matches (scheduled_at) where scheduled_at is not null;
create trigger competition_matches_touch_updated_at before update on public.competition_matches for each row execute function app.touch_updated_at();

alter table public.competition_matches enable row level security;
revoke all on table public.competition_matches from public, anon, authenticated, service_role;
grant select on public.competition_matches to service_role;

create or replace function app.competition_match_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.confirmed then raise exception 'INVALID: a confirmed result cannot be changed or deleted' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.event_id <> old.event_id then raise exception 'INVALID: a match cannot move to another event' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger competition_matches_guard before update or delete on public.competition_matches for each row execute function app.competition_match_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- match_games: final points per game. 0..30 by check; the full rule (per the EVENT's ruleset, the default one included) by the trigger.
-- finished = false only for the last game of a retired or abandoned match.
-- ------------------------------------------------------------------------------------------------------------------
create table public.match_games (
  match_id     uuid     not null references public.competition_matches (id) on delete restrict,
  game_number  smallint not null check (game_number between 1 and 5),
  points_a     smallint not null check (points_a between 0 and 30),
  points_b     smallint not null check (points_b between 0 and 30),
  finished     boolean  not null default true,
  primary key (match_id, game_number)
);
comment on table public.match_games is 'Game scores of a match, side A first. Validated against the event ruleset (BWF Laws 7.1-7.4 by default).';

alter table public.match_games enable row level security;
revoke all on table public.match_games from public, anon, authenticated, service_role;
grant select on public.match_games to service_role;

create or replace function app.competition_games_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ruleset jsonb;
  v_confirmed boolean;
  v_problem text;
begin
  select e.ruleset, m.confirmed into v_ruleset, v_confirmed
    from public.competition_matches m join public.tournament_events e on e.id = m.event_id
   where m.id = case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  if coalesce(v_confirmed, false) then raise exception 'INVALID: the games of a confirmed result cannot change' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.game_number > 2 * (v_ruleset ->> 'gamesToWin')::integer - 1 then
    raise exception 'INVALID: game % is beyond the most games this event allows', new.game_number using errcode = '22023';
  end if;
  v_problem := app.competition_game_problem(new.points_a, new.points_b, v_ruleset, new.finished);
  if v_problem is not null then raise exception 'INVALID: game %: %', new.game_number, v_problem using errcode = '22023'; end if;
  return new;
end;
$$;
create trigger match_games_guard before insert or update or delete on public.match_games for each row execute function app.competition_games_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- match_score_events: the append-only rally log of live scoring (src/lib/competition/scoring LiveState is rebuilt from it).
-- idempotency_key: a scorer's retry of the same tap is stored once. No write path yet (scorer accounts are disabled).
-- ------------------------------------------------------------------------------------------------------------------
create table public.match_score_events (
  id               bigint      generated always as identity primary key,
  match_id         uuid        not null references public.competition_matches (id) on delete restrict,
  seq              integer     not null check (seq >= 1),
  kind             text        not null check (kind in ('first_server', 'rally', 'undo')),
  side             text        check (side is null or side in ('A', 'B')),
  idempotency_key  text        not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  recorded_by      text        not null,
  recorded_at      timestamptz not null default now(),
  constraint match_score_events_seq_unique unique (match_id, seq),
  constraint match_score_events_key_unique unique (match_id, idempotency_key),
  constraint match_score_events_side check ((kind = 'undo') = (side is null))
);
comment on table public.match_score_events is 'Append-only rally log (rally, undo, first server). Never updated or deleted.';
create trigger match_score_events_append_only before update or delete on public.match_score_events for each row execute function app.forbid_row_change();
create trigger match_score_events_no_truncate before truncate on public.match_score_events for each statement execute function app.forbid_row_change();

alter table public.match_score_events enable row level security;
revoke all on table public.match_score_events from public, anon, authenticated, service_role;
grant select on public.match_score_events to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- ranking_snapshots and ranking_entries: LOCAL, UNOFFICIAL rankings. Draft until the owner publishes; public only when, in addition,
-- competition_settings.rankings_public is on. A published snapshot is immutable.
-- ------------------------------------------------------------------------------------------------------------------
create table public.ranking_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  label         text        not null check (label = btrim(label) and length(label) between 2 and 120 and label !~ '[[:cntrl:]]'),
  category      text        check (category is null or category in ('MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD')),
  age_group     text        check (app.competition_age_group_ok(age_group)),
  -- computed at write time (fail closed, D-012/D-109): public views read this column and never call the function, because the API
  -- roles hold no EXECUTE on schema app functions (0001 check) and a view's function calls are checked against the reader
  is_junior     boolean     not null generated always as (coalesce(category in ('BS', 'GS', 'BD', 'GD'), false) or app.competition_age_is_junior(age_group)) stored,
  as_of         date        not null,
  is_official   boolean     not null default false check (not is_official),
  published     boolean     not null default false,
  published_at  timestamptz,
  created_by    text        not null,
  created_at    timestamptz not null default now(),
  constraint ranking_snapshots_published_at check (published = (published_at is not null))
);
comment on table public.ranking_snapshots is 'A local Power Smash ranking table, NOT an official BWF ranking. Unpublished by default.';

alter table public.ranking_snapshots enable row level security;
revoke all on table public.ranking_snapshots from public, anon, authenticated, service_role;
grant select on public.ranking_snapshots to service_role;

create table public.ranking_entries (
  snapshot_id     uuid    not null references public.ranking_snapshots (id) on delete restrict,
  player_id       uuid    not null references public.players (id) on delete restrict,
  rank            integer not null check (rank between 1 and 100000),
  points          integer not null check (points between 0 and 1000000000),
  events_counted  integer not null default 0 check (events_counted between 0 and 1000),
  primary key (snapshot_id, player_id)
);
comment on table public.ranking_entries is 'Rows of a ranking snapshot. Protected players are never named publicly (D-012).';

alter table public.ranking_entries enable row level security;
revoke all on table public.ranking_entries from public, anon, authenticated, service_role;
grant select on public.ranking_entries to service_role;

create or replace function app.competition_ranking_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_published boolean;
begin
  if tg_table_name = 'ranking_snapshots' then
    if old.published then raise exception 'INVALID: a published ranking cannot change' using errcode = '42501'; end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select s.published into v_published from public.ranking_snapshots s where s.id = case when tg_op = 'DELETE' then old.snapshot_id else new.snapshot_id end;
  if coalesce(v_published, false) then raise exception 'INVALID: the rows of a published ranking cannot change' using errcode = '42501'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger ranking_snapshots_guard before update or delete on public.ranking_snapshots for each row execute function app.competition_ranking_guard();
create trigger ranking_entries_guard before insert or update or delete on public.ranking_entries for each row execute function app.competition_ranking_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- organizer_assignments: who may run or score a tournament once accounts exist. INERT while the roles are disabled: nothing grants
-- anything from it, and no RPC writes it yet.
-- ------------------------------------------------------------------------------------------------------------------
create table public.organizer_assignments (
  id             uuid        primary key default gen_random_uuid(),
  profile_id     uuid        not null references public.profiles (id) on delete cascade,
  tournament_id  uuid        not null references public.tournaments (id) on delete cascade,
  role           text        not null check (role in ('organizer', 'scorer')),
  created_by     text        not null,
  created_at     timestamptz not null default now(),
  constraint organizer_assignments_unique unique (profile_id, tournament_id, role)
);
comment on table public.organizer_assignments is 'Inert until organizer/scorer accounts are switched on (competition_settings.organizer_roles_enabled).';

alter table public.organizer_assignments enable row level security;
revoke all on table public.organizer_assignments from public, anon, authenticated, service_role;
grant select on public.organizer_assignments to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- notification_outbox: messages waiting to be sent. The recipient is a REFERENCE only (a lead id or a profile id); no phone, email or
-- address is copied here (D-029). No delivery channel exists yet (email and WhatsApp delivery wait for credentials).
-- ------------------------------------------------------------------------------------------------------------------
create table public.notification_outbox (
  id                    uuid        primary key default gen_random_uuid(),
  kind                  text        not null check (kind ~ '^[a-z_]{1,40}$'),
  recipient_lead_id     uuid        references public.leads (id) on delete cascade,
  recipient_profile_id  uuid        references public.profiles (id) on delete cascade,
  payload               jsonb       not null default '{}'::jsonb,
  idempotency_key       text        not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,120}$'),
  status                text        not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts              integer     not null default 0 check (attempts between 0 and 20),
  last_error_code       text        check (last_error_code is null or last_error_code ~ '^[a-z_]{1,40}$'),
  created_at            timestamptz not null default now(),
  sent_at               timestamptz,
  constraint notification_outbox_key_unique unique (idempotency_key),
  constraint notification_outbox_one_recipient check (num_nonnulls(recipient_lead_id, recipient_profile_id) = 1),
  constraint notification_outbox_sent check ((status = 'sent') = (sent_at is not null)),
  -- the payload is a small object of references and codes, never contact data
  constraint notification_outbox_payload check (
    app.competition_outbox_payload_ok(payload)
  )
);
comment on table public.notification_outbox is 'Private. Outgoing notifications by reference (lead or profile id) only; no contact data copied (D-029).';
create index notification_outbox_queued_idx on public.notification_outbox (created_at) where status = 'queued';

alter table public.notification_outbox enable row level security;
revoke all on table public.notification_outbox from public, anon, authenticated, service_role;
grant select on public.notification_outbox to service_role;

-- the one enqueue path (used by later waves): idempotent on the key; a repeat returns the first row's id
create or replace function app.enqueue_notification(p_kind text, p_lead uuid, p_profile uuid, p_key text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.notification_outbox (kind, recipient_lead_id, recipient_profile_id, payload, idempotency_key)
    values (p_kind, p_lead, p_profile, coalesce(p_payload, '{}'::jsonb), p_key)
    on conflict (idempotency_key) do nothing
    returning id into v_id;
  if v_id is null then select o.id into v_id from public.notification_outbox o where o.idempotency_key = p_key; end if;
  return v_id;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- data_providers, data_import_runs, external_record_mappings: bookkeeping for a LICENSED external source (international data).
-- No provider is seeded (none is licensed; licence terms unverified, TODO(lead)). Enabled only with a recorded licence; an import run
-- needs an enabled provider. No scraping.
-- ------------------------------------------------------------------------------------------------------------------
create table public.data_providers (
  id              text        primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(id) <= 40),
  name            text        not null check (name = btrim(name) and length(name) between 2 and 120 and name !~ '[[:cntrl:]]'),
  kind            text        not null check (kind in ('licensed_api', 'licensed_file', 'owner_entry')),
  licence_status  text        not null default 'unverified' check (licence_status in ('unverified', 'licensed', 'expired', 'refused')),
  licence_ref     text        check (licence_ref is null or (length(licence_ref) between 1 and 300 and licence_ref !~ '[[:cntrl:]]')),
  enabled         boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint data_providers_enabled_needs_licence check (not enabled or (licence_status = 'licensed' and licence_ref is not null))
);
comment on table public.data_providers is 'External data sources. Disabled unless a licence is recorded. No scraping.';
create trigger data_providers_touch_updated_at before update on public.data_providers for each row execute function app.touch_updated_at();

alter table public.data_providers enable row level security;
revoke all on table public.data_providers from public, anon, authenticated, service_role;
grant select on public.data_providers to service_role;

create table public.data_import_runs (
  id               uuid        primary key default gen_random_uuid(),
  provider_id      text        not null references public.data_providers (id) on delete restrict,
  status           text        not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  records_seen     integer     not null default 0 check (records_seen >= 0),
  records_written  integer     not null default 0 check (records_written >= 0 and records_written <= records_seen),
  error_code       text        check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint data_import_runs_finished check ((status = 'running') = (finished_at is null))
);
comment on table public.data_import_runs is 'One import from a licensed provider: counts and an error code only.';

alter table public.data_import_runs enable row level security;
revoke all on table public.data_import_runs from public, anon, authenticated, service_role;
grant select on public.data_import_runs to service_role;

create or replace function app.competition_import_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.data_providers p where p.id = new.provider_id and p.enabled) then
    raise exception 'INVALID: imports need an enabled, licensed provider (no scraping)' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger data_import_runs_guard before insert on public.data_import_runs for each row execute function app.competition_import_guard();

create table public.external_record_mappings (
  id             uuid        primary key default gen_random_uuid(),
  provider_id    text        not null references public.data_providers (id) on delete restrict,
  external_type  text        not null check (external_type ~ '^[a-z_]{1,40}$'),
  external_id    text        not null check (length(external_id) between 1 and 200 and external_id !~ '[[:cntrl:]]'),
  internal_table text        not null check (internal_table in ('players', 'tournaments', 'tournament_events', 'competition_matches')),
  internal_id    uuid        not null,
  import_run_id  uuid        references public.data_import_runs (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint external_record_mappings_unique unique (provider_id, external_type, external_id)
);
comment on table public.external_record_mappings is 'Maps a provider record to our row. Keyed on (provider, external type, external id).';
create index external_record_mappings_internal_idx on public.external_record_mappings (internal_table, internal_id);

alter table public.external_record_mappings enable row level security;
revoke all on table public.external_record_mappings from public, anon, authenticated, service_role;
grant select on public.external_record_mappings to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- Internal views (schema app; no privilege for the API roles; read only through the api views, like 0006)
-- ------------------------------------------------------------------------------------------------------------------
-- an event the site may show: its tournament is public (0006 app.public_tournament_ids) and the event is not a draft.
-- is_junior is fail closed: a junior category, a junior or unrecognised age group (app.competition_age_is_junior), or a minor signal.
create view app.competition_public_events as
select e.id,
  (e.is_junior or t.is_minor_signal) as is_junior,
  -- D-018: a listed-only tournament (non-TN or undetectable place) links to no player page; names stay, like 0006 public_match_participants
  (t.visibility = 'listed_no_player_pages') as no_player_pages
from public.tournament_events e
join public.tournaments t on t.id = e.tournament_id
join app.public_tournament_ids pt on pt.id = e.tournament_id
where e.status <> 'draft';

-- the public face of an entry: a name and slug ONLY for a player in app.eligible_players, in an event that is not a junior event;
-- no slug (no player-page link) in a listed_no_player_pages tournament (D-018)
create view app.competition_entry_faces as
select en.id as entry_id,
  case when n1.named and not pe.no_player_pages then p1.slug end as player1_slug,
  case when n1.named then p1.display_name end as player1_name,
  case when n2.named and not pe.no_player_pages then p2.slug end as player2_slug,
  case when n2.named then p2.display_name end as player2_name,
  (not n1.named or (en.player2_id is not null and not n2.named)) as is_protected
from public.event_entries en
join app.competition_public_events pe on pe.id = en.event_id
join public.players p1 on p1.id = en.player1_id
left join public.players p2 on p2.id = en.player2_id
cross join lateral (select (not pe.is_junior and exists (select 1 from app.eligible_players ep where ep.id = en.player1_id)) as named) n1
cross join lateral (select (en.player2_id is not null and not pe.is_junior and exists (select 1 from app.eligible_players ep where ep.id = en.player2_id)) as named) n2;

-- a match the site may show: a public event whose draw is published (or locked)
create view app.competition_public_match_ids as
select m.id
from public.competition_matches m
join app.competition_public_events pe on pe.id = m.event_id
where exists (select 1 from public.draws d where d.event_id = m.event_id and d.status in ('published', 'locked'));

-- the rankings switch, so no api view reads the private settings table directly (the check file forbids that)
create view app.competition_rankings_public as
select cs.rankings_public as on_now
from public.competition_settings cs
where cs.id = 1;

revoke all on app.competition_public_events, app.competition_entry_faces, app.competition_public_match_ids, app.competition_rankings_public from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- Public views (schema api, publishable key). Explicit columns; names only through app.competition_entry_faces.
-- ------------------------------------------------------------------------------------------------------------------
create view api.public_competition_events with (security_barrier = true) as
select
  e.id,
  e.tournament_id,
  e.category,
  e.age_group,
  e.format,
  e.status,
  e.capacity,
  e.ruleset
from public.tournament_events e
join app.competition_public_events pe on pe.id = e.id;
grant select on api.public_competition_events to anon, authenticated;

create view api.public_competition_draws with (security_barrier = true) as
select
  d.id,
  d.event_id,
  d.status,
  d.seed,
  d.published_at
from public.draws d
join app.competition_public_events pe on pe.id = d.event_id
where d.status in ('published', 'locked');
grant select on api.public_competition_draws to anon, authenticated;

create view api.public_competition_draw_slots with (security_barrier = true) as
select
  s.draw_id,
  s.position,
  s.group_label,
  s.entry_id,
  (s.entry_id is null) as is_bye,
  en.seed,
  f.player1_slug,
  f.player1_name,
  f.player2_slug,
  f.player2_name,
  coalesce(f.is_protected, false) as is_protected
from public.draw_slots s
join public.draws d on d.id = s.draw_id
join app.competition_public_events pe on pe.id = d.event_id
left join public.event_entries en on en.id = s.entry_id
left join app.competition_entry_faces f on f.entry_id = s.entry_id
where d.status in ('published', 'locked');
grant select on api.public_competition_draw_slots to anon, authenticated;

-- status: an unconfirmed result shows as 'awaiting_result' (never its winner or games)
create view api.public_competition_matches with (security_barrier = true) as
select
  m.id,
  m.event_id,
  m.round_code,
  m.match_number,
  m.group_label,
  m.scheduled_at,
  c.label as court_label,
  case when m.status in ('completed', 'walkover', 'retired', 'abandoned') and not m.confirmed then 'awaiting_result' else m.status end as status,
  m.side_a_entry,
  fa.player1_slug as side_a_player1_slug,
  fa.player1_name as side_a_player1_name,
  fa.player2_slug as side_a_player2_slug,
  fa.player2_name as side_a_player2_name,
  coalesce(fa.is_protected, false) as side_a_protected,
  m.side_b_entry,
  fb.player1_slug as side_b_player1_slug,
  fb.player1_name as side_b_player1_name,
  fb.player2_slug as side_b_player2_slug,
  fb.player2_name as side_b_player2_name,
  coalesce(fb.is_protected, false) as side_b_protected,
  case when m.confirmed then m.winner_side end as winner_side,
  m.confirmed as result_confirmed,
  m.updated_at
from public.competition_matches m
join app.competition_public_match_ids pm on pm.id = m.id
left join public.courts c on c.id = m.court_id
left join app.competition_entry_faces fa on fa.entry_id = m.side_a_entry
left join app.competition_entry_faces fb on fb.entry_id = m.side_b_entry;
grant select on api.public_competition_matches to anon, authenticated;

create view api.public_competition_match_games with (security_barrier = true) as
select
  g.match_id,
  g.game_number,
  g.points_a,
  g.points_b,
  g.finished
from public.match_games g
join public.competition_matches m on m.id = g.match_id
join app.competition_public_match_ids pm on pm.id = m.id
where m.confirmed;
grant select on api.public_competition_match_games to anon, authenticated;

create view api.public_competition_rankings with (security_barrier = true) as
select
  s.id as snapshot_id,
  s.label,
  s.category,
  s.age_group,
  s.as_of,
  s.published_at,
  r.rank,
  r.points,
  r.events_counted,
  case when nm.named then p.slug end as player_slug,
  case when nm.named then p.display_name end as player_name,
  not nm.named as is_protected
from public.ranking_entries r
join public.ranking_snapshots s on s.id = r.snapshot_id
join public.players p on p.id = r.player_id
cross join lateral (select (
  not s.is_junior
  and exists (select 1 from app.eligible_players ep where ep.id = r.player_id)) as named) nm
where s.published
  -- a protected player is left out of a public ranking altogether, not shown as a masked row (D-012 "absent from other pages",
  -- D-109): a rank and points beside a placeholder could still identify a junior in a small local field. is_protected stays in the
  -- column list (always false here) so the view shape matches the other competition views.
  and nm.named
  and coalesce((select rp.on_now from app.competition_rankings_public rp), false);
grant select on api.public_competition_rankings to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- Small shared checks for the RPCs
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.competition_uuid(p_value jsonb, p_label text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INVALID: % must be an id', p_label using errcode = '22023';
  end if;
  return (p_value #>> '{}')::uuid;
end;
$$;

create or replace function app.competition_int(p_value jsonb, p_label text, p_min bigint, p_max bigint)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,10}$' or (p_value #>> '{}')::bigint not between p_min and p_max then
    raise exception 'INVALID: % must be a whole number from % to %', p_label, p_min, p_max using errcode = '22023';
  end if;
  return (p_value #>> '{}')::bigint;
end;
$$;

-- every key known, every key present (the admin sends the whole record)
create or replace function app.competition_keys(p_record jsonb, p_allowed text[], p_label text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then raise exception 'INVALID: the % must be an object', p_label using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_record) loop
    if not k = any (p_allowed) then raise exception 'INVALID: unknown % field %', p_label, k using errcode = '22023'; end if;
  end loop;
  foreach k in array p_allowed loop
    if not p_record ? k then raise exception 'INVALID: the % field % is missing', p_label, k using errcode = '22023'; end if;
  end loop;
end;
$$;

create or replace function app.competition_reason(p_reason text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a change needs a reason' using errcode = '22023'; end if;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_event: create (p_id null) or edit an event. Record: tournamentId, category, ageGroup, format, ruleset, capacity, status.
-- The ruleset cannot change once a game is recorded; the format cannot change once the draw is published; capacity not below the
-- active entries.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_event(p_actor text, p_id uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['tournamentId', 'category', 'ageGroup', 'format', 'ruleset', 'capacity', 'status'];
  v_tournament uuid;
  v_age text;
  v_capacity integer;
  v_problem text;
  e public.tournament_events%rowtype;
  v_old jsonb;
  v_new jsonb;
  v_fields text[];
  v_id uuid;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, v_allowed, 'event');
  v_tournament := app.competition_uuid(p_record -> 'tournamentId', 'tournamentId');
  if v_tournament is null then raise exception 'INVALID: the event needs its tournament' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'category') <> 'string' or (p_record ->> 'category') not in ('MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD') then
    raise exception 'INVALID: unknown category' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record -> 'ageGroup') not in ('string', 'null') then raise exception 'INVALID: the age group must be text or null' using errcode = '22023'; end if;
  v_age := nullif(btrim(coalesce(p_record ->> 'ageGroup', '')), '');
  if not app.competition_age_group_ok(v_age) then
    raise exception 'INVALID: the age group must be one of U<n>, <n>+, senior, open, veterans, masters, sub_junior, junior, youth, cadet, mini' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record -> 'format') <> 'string' or (p_record ->> 'format') not in ('knockout', 'round_robin', 'groups_knockout') then
    raise exception 'INVALID: unknown format' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record -> 'status') <> 'string' or (p_record ->> 'status') not in ('draft', 'open', 'closed') then
    raise exception 'INVALID: the status must be draft, open or closed' using errcode = '22023';
  end if;
  v_problem := app.competition_ruleset_problem(p_record -> 'ruleset');
  if v_problem is not null then raise exception 'INVALID: %', v_problem using errcode = '22023'; end if;
  v_capacity := app.competition_int(p_record -> 'capacity', 'capacity', 2, 1024);
  if not exists (select 1 from public.tournaments t where t.id = v_tournament) then raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002'; end if;

  v_new := jsonb_build_object('category', p_record ->> 'category', 'ageGroup', v_age, 'format', p_record ->> 'format', 'ruleset', p_record -> 'ruleset',
    'capacity', v_capacity, 'status', p_record ->> 'status');

  if p_id is null then
    begin
      insert into public.tournament_events (tournament_id, category, age_group, format, ruleset, capacity, status)
        values (v_tournament, p_record ->> 'category', v_age, p_record ->> 'format', p_record -> 'ruleset', v_capacity, p_record ->> 'status')
        returning id into v_id;
    exception when unique_violation then
      raise exception 'INVALID: this tournament already has that category and age group' using errcode = '22023';
    end;
    perform app.audit(p_actor, 'create_event', 'tournament_events', v_id::text,
      jsonb_build_object('tournament_id', v_tournament, 'category', p_record ->> 'category', 'format', p_record ->> 'format', 'status', p_record ->> 'status'), p_reason);
    if (p_record ->> 'status') <> 'draft' then perform app.mark_dirty('competition event', false); end if;
    return jsonb_build_object('id', v_id, 'created', true, 'fields', to_jsonb(array['category', 'ageGroup', 'format', 'ruleset', 'capacity', 'status']));
  end if;

  select * into e from public.tournament_events where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: event not found' using errcode = 'P0002'; end if;
  if e.tournament_id <> v_tournament then raise exception 'INVALID: an event cannot move to another tournament' using errcode = '22023'; end if;
  v_old := jsonb_build_object('category', e.category, 'ageGroup', e.age_group, 'format', e.format, 'ruleset', e.ruleset, 'capacity', e.capacity, 'status', e.status);
  select coalesce(array_agg(k order by array_position(v_allowed, k)), '{}') into v_fields
    from unnest(v_allowed) k where k <> 'tournamentId' and (v_old -> k) is distinct from (v_new -> k);
  if cardinality(v_fields) = 0 then return jsonb_build_object('id', e.id, 'created', false, 'fields', '[]'::jsonb); end if;
  if 'ruleset' = any (v_fields) and exists (select 1 from public.match_games g join public.competition_matches m on m.id = g.match_id where m.event_id = e.id) then
    raise exception 'INVALID: the scoring rules cannot change once a game is recorded' using errcode = '22023';
  end if;
  if (v_fields && array['format', 'category']) and exists (select 1 from public.draws d where d.event_id = e.id and d.status <> 'draft') then
    raise exception 'INVALID: the format and category cannot change once the draw is published' using errcode = '22023';
  end if;
  if 'category' = any (v_fields) and exists (select 1 from public.event_entries en where en.event_id = e.id) then
    raise exception 'INVALID: the category cannot change once the event has entries' using errcode = '22023';
  end if;
  if v_capacity is not null and (select count(*) from public.event_entries en where en.event_id = e.id and en.status in ('pending', 'confirmed')) > v_capacity then
    raise exception 'INVALID: the capacity is below the entries already accepted' using errcode = '22023';
  end if;
  begin
    update public.tournament_events
       set category = p_record ->> 'category', age_group = v_age, format = p_record ->> 'format', ruleset = p_record -> 'ruleset',
           capacity = v_capacity, status = p_record ->> 'status'
     where id = e.id;
  exception when unique_violation then
    raise exception 'INVALID: this tournament already has that category and age group' using errcode = '22023';
  end;
  perform app.audit(p_actor, 'update_event', 'tournament_events', e.id::text,
    jsonb_build_object('fields', to_jsonb(v_fields), 'old_status', e.status, 'new_status', p_record ->> 'status'), p_reason);
  if e.status <> 'draft' or (p_record ->> 'status') <> 'draft' then perform app.mark_dirty('competition event', false); end if;
  return jsonb_build_object('id', e.id, 'created', false, 'fields', to_jsonb(v_fields));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_add_entry: record {players: [id] or [id, id], seed: n | null, status: 'pending' | 'confirmed' | 'waitlisted'}.
-- Under the event's row lock: the number of players fits the category (singles 1, doubles 2), no player twice in the event,
-- pending and confirmed entries within the capacity (a full event refuses; the owner may waitlist instead).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_add_entry(p_actor text, p_event uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.tournament_events%rowtype;
  v_players uuid[];
  v_need integer;
  v_seed integer;
  v_status text;
  v_id uuid;
  v_pid uuid;
  i integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['players', 'seed', 'status'], 'entry');
  if jsonb_typeof(p_record -> 'players') <> 'array' or jsonb_array_length(p_record -> 'players') not between 1 and 2 then
    raise exception 'INVALID: an entry has one player (singles) or two (doubles)' using errcode = '22023';
  end if;
  v_players := '{}';
  for i in 0 .. jsonb_array_length(p_record -> 'players') - 1 loop
    v_players := v_players || app.competition_uuid(p_record -> 'players' -> i, 'each player');
  end loop;
  if array_position(v_players, null) is not null then raise exception 'INVALID: each player must be an id' using errcode = '22023'; end if;
  if cardinality(v_players) = 2 and v_players[1] = v_players[2] then raise exception 'INVALID: a pair needs two different players' using errcode = '22023'; end if;
  v_seed := app.competition_int(p_record -> 'seed', 'seed', 1, 256);
  if jsonb_typeof(p_record -> 'status') <> 'string' or (p_record ->> 'status') not in ('pending', 'confirmed', 'waitlisted') then
    raise exception 'INVALID: a new entry is pending, confirmed or waitlisted' using errcode = '22023';
  end if;
  v_status := p_record ->> 'status';

  select * into e from public.tournament_events where id = p_event for update;
  if not found then raise exception 'NOT_FOUND: event not found' using errcode = 'P0002'; end if;
  if e.status = 'closed' then raise exception 'INVALID: the event is closed to new entries' using errcode = '22023'; end if;
  v_need := case when e.category in ('MS', 'WS', 'BS', 'GS') then 1 else 2 end;
  if cardinality(v_players) <> v_need then
    raise exception 'INVALID: % needs % player(s) per entry', e.category, v_need using errcode = '22023';
  end if;
  foreach v_pid in array v_players loop
    if not exists (select 1 from public.players p where p.id = v_pid and p.merged_into is null) then
      raise exception 'NOT_FOUND: player not found (or merged into another)' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.event_entry_players ep where ep.event_id = e.id and ep.player_id = v_pid) then
      raise exception 'INVALID: a player is already entered in this event' using errcode = '22023';
    end if;
  end loop;
  if v_status in ('pending', 'confirmed') and e.capacity is not null
     and (select count(*) from public.event_entries en where en.event_id = e.id and en.status in ('pending', 'confirmed')) >= e.capacity then
    raise exception 'INVALID: the event is full (capacity %); waitlist the entry instead', e.capacity using errcode = '22023';
  end if;
  if v_seed is not null and exists (select 1 from public.event_entries en where en.event_id = e.id and en.seed = v_seed and en.status in ('pending', 'confirmed', 'waitlisted')) then
    raise exception 'INVALID: seed % is already used in this event', v_seed using errcode = '22023';
  end if;

  insert into public.event_entries (event_id, player1_id, player2_id, seed, status)
    values (e.id, v_players[1], case when cardinality(v_players) = 2 then v_players[2] end, v_seed, v_status)
    returning id into v_id;
  insert into public.event_entry_players (event_id, player_id, entry_id) select e.id, x, v_id from unnest(v_players) x;
  perform app.audit(p_actor, 'add_entry', 'event_entries', v_id::text,
    jsonb_build_object('event_id', e.id, 'players', cardinality(v_players), 'seed', v_seed, 'status', v_status), p_reason);
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

-- admin_withdraw_entry: the entry becomes withdrawn and its players are free to enter again. Allowed after the draw is published (the
-- referee decides the walkover); the audit says so.
create or replace function public.admin_withdraw_entry(p_actor text, p_entry uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  en public.event_entries%rowtype;
  v_in_draw boolean;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into en from public.event_entries where id = p_entry;
  if not found then raise exception 'NOT_FOUND: entry not found' using errcode = 'P0002'; end if;
  perform 1 from public.tournament_events where id = en.event_id for update;
  select * into en from public.event_entries where id = p_entry for update;
  if en.status in ('withdrawn', 'rejected') then raise exception 'INVALID: the entry is already %', en.status using errcode = '22023'; end if;
  v_in_draw := exists (select 1 from public.draw_slots s join public.draws d on d.id = s.draw_id where s.entry_id = en.id and d.status <> 'draft');
  update public.event_entries set status = 'withdrawn' where id = en.id;
  delete from public.event_entry_players where entry_id = en.id;
  perform app.audit(p_actor, 'withdraw_entry', 'event_entries', en.id::text,
    jsonb_build_object('event_id', en.event_id, 'old_status', en.status, 'in_published_draw', v_in_draw), p_reason);
  if v_in_draw then perform app.mark_dirty('competition entry withdrawn', false); end if;
  return jsonb_build_object('id', en.id, 'status', 'withdrawn', 'inPublishedDraw', v_in_draw);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_draw: store a DRAFT draw (the engines in src/lib/competition/draws make it; this checks its integrity).
-- Record {seed, slots: [{position, entryId | null, group | null}]}. Positions 1..n with no gaps; every confirmed entry placed exactly once
-- and nothing else; knockout: n a power of two (byes = null); round robin: no byes, no groups; groups + knockout: every slot has a group,
-- no byes, at least 2 per group. A published draw is refused (it cannot be regenerated).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_draw(p_actor text, p_event uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.tournament_events%rowtype;
  d public.draws%rowtype;
  v_seed bigint;
  v_slots jsonb;
  n integer;
  i integer;
  s jsonb;
  v_pos integer[] := '{}';
  v_entries uuid[] := '{}';
  v_groups text[] := '{}';
  v_entry uuid;
  v_group text;
  v_byes integer := 0;
  v_id uuid;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['seed', 'slots'], 'draw');
  v_seed := app.competition_int(p_record -> 'seed', 'seed', 0, 4294967295);
  if v_seed is null then raise exception 'INVALID: the draw needs the seed it used' using errcode = '22023'; end if;
  v_slots := p_record -> 'slots';
  if jsonb_typeof(v_slots) <> 'array' or jsonb_array_length(v_slots) not between 2 and 1024 then
    raise exception 'INVALID: a draw has 2 to 1024 slots' using errcode = '22023';
  end if;
  n := jsonb_array_length(v_slots);

  select * into e from public.tournament_events where id = p_event for update;
  if not found then raise exception 'NOT_FOUND: event not found' using errcode = 'P0002'; end if;
  select * into d from public.draws where event_id = e.id for update;
  if found and d.status <> 'draft' then raise exception 'INVALID: the draw is published and cannot be regenerated' using errcode = '22023'; end if;

  for i in 0 .. n - 1 loop
    s := v_slots -> i;
    perform app.competition_keys(s, array['position', 'entryId', 'group'], 'slot');
    if jsonb_typeof(s -> 'position') <> 'number' then raise exception 'INVALID: each slot needs a position' using errcode = '22023'; end if;
    v_pos := v_pos || app.competition_int(s -> 'position', 'position', 1, 1024)::integer;
    v_entry := app.competition_uuid(s -> 'entryId', 'entryId');
    if jsonb_typeof(s -> 'group') not in ('string', 'null') or (jsonb_typeof(s -> 'group') = 'string' and (s ->> 'group') !~ '^[A-Z]{1,2}$') then
      raise exception 'INVALID: a group is 1 or 2 capital letters, or null' using errcode = '22023';
    end if;
    v_group := s ->> 'group';
    if v_entry is null then
      v_byes := v_byes + 1;
    else
      if v_entry = any (v_entries) then raise exception 'INVALID: an entry is placed twice' using errcode = '22023'; end if;
      if not exists (select 1 from public.event_entries en where en.id = v_entry and en.event_id = e.id and en.status = 'confirmed') then
        raise exception 'INVALID: a slot holds an entry that is not a confirmed entry of this event' using errcode = '22023';
      end if;
      v_entries := v_entries || v_entry;
    end if;
    if (e.format = 'groups_knockout') <> (v_group is not null) then
      raise exception 'INVALID: groups belong to a groups + knockout draw, on every slot' using errcode = '22023';
    end if;
    v_groups := v_groups || v_group;
  end loop;
  if (select array_agg(x order by x) from unnest(v_pos) x) <> (select array_agg(x order by x) from generate_series(1, n) x) then
    raise exception 'INVALID: the positions must be 1 to % with no gaps or repeats', n using errcode = '22023';
  end if;
  if exists (select 1 from public.event_entries en where en.event_id = e.id and en.status = 'confirmed' and en.id <> all (v_entries)) then
    raise exception 'INVALID: every confirmed entry must be placed in the draw' using errcode = '22023';
  end if;
  if cardinality(v_entries) < 2 then raise exception 'INVALID: a draw needs at least 2 entries' using errcode = '22023'; end if;
  if e.format = 'knockout' and (n & (n - 1)) <> 0 then raise exception 'INVALID: a knockout draw has a power-of-two size (byes fill the rest)' using errcode = '22023'; end if;
  if e.format <> 'knockout' and v_byes > 0 then raise exception 'INVALID: only a knockout draw has byes' using errcode = '22023'; end if;
  if e.format = 'groups_knockout' and exists (select 1 from unnest(v_groups) g group by g having count(*) < 2) then
    raise exception 'INVALID: every group needs at least 2 entries' using errcode = '22023';
  end if;

  if d.id is null then
    insert into public.draws (event_id, seed) values (e.id, v_seed) returning id into v_id;
  else
    v_id := d.id;
    update public.draws set seed = v_seed where id = v_id;
    delete from public.draw_slots where draw_id = v_id;
  end if;
  insert into public.draw_slots (draw_id, position, entry_id, group_label)
    select v_id, (x ->> 'position')::integer, app.competition_uuid(x -> 'entryId', 'entryId'), x ->> 'group' from jsonb_array_elements(v_slots) x;
  perform app.audit(p_actor, 'save_draw', 'draws', v_id::text,
    jsonb_build_object('event_id', e.id, 'seed', v_seed, 'slots', n, 'byes', v_byes, 'replaced', d.id is not null), p_reason);
  return jsonb_build_object('id', v_id, 'status', 'draft', 'slots', n);
end;
$$;

-- admin_publish_draw: draft -> published (immutable from now on). The event must not be a draft.
create or replace function public.admin_publish_draw(p_actor text, p_draw uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.draws%rowtype;
  v_event_status text;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into d from public.draws where id = p_draw for update;
  if not found then raise exception 'NOT_FOUND: draw not found' using errcode = 'P0002'; end if;
  if d.status <> 'draft' then raise exception 'INVALID: the draw is already published' using errcode = '22023'; end if;
  select e.status into v_event_status from public.tournament_events e where e.id = d.event_id;
  if v_event_status = 'draft' then raise exception 'INVALID: open the event before publishing its draw' using errcode = '22023'; end if;
  if not exists (select 1 from public.draw_slots s where s.draw_id = d.id) then raise exception 'INVALID: the draw has no slots' using errcode = '22023'; end if;
  update public.draws set status = 'published', published_at = now() where id = d.id;
  perform app.audit(p_actor, 'publish_draw', 'draws', d.id::text, jsonb_build_object('event_id', d.event_id, 'seed', d.seed), p_reason);
  perform app.mark_dirty('draw published', false);
  return jsonb_build_object('id', d.id, 'status', 'published');
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_match: create (p_id null, p_expected_revision null) or edit a match that has not started. Record: eventId, roundCode,
-- matchNumber, groupLabel, sideA, sideB (entry ids or null while unknown), scheduledAt (ISO instant with a zone, or null), courtId.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_match(p_actor text, p_id uuid, p_record jsonb, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['eventId', 'roundCode', 'matchNumber', 'groupLabel', 'sideA', 'sideB', 'scheduledAt', 'courtId'];
  v_event uuid;
  v_round text;
  v_number integer;
  v_group text;
  v_a uuid;
  v_b uuid;
  v_at timestamptz;
  v_court uuid;
  v_tournament uuid;
  m public.competition_matches%rowtype;
  v_id uuid;
  v_rev integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, v_allowed, 'match');
  v_event := app.competition_uuid(p_record -> 'eventId', 'eventId');
  if v_event is null then raise exception 'INVALID: the match needs its event' using errcode = '22023'; end if;
  v_round := p_record ->> 'roundCode';
  if jsonb_typeof(p_record -> 'roundCode') <> 'string' or v_round not in ('F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league') then
    raise exception 'INVALID: unknown round' using errcode = '22023';
  end if;
  v_number := app.competition_int(p_record -> 'matchNumber', 'matchNumber', 1, 9999);
  if v_number is null then raise exception 'INVALID: the match needs a number' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'groupLabel') not in ('string', 'null') or (jsonb_typeof(p_record -> 'groupLabel') = 'string' and (p_record ->> 'groupLabel') !~ '^[A-Z]{1,2}$') then
    raise exception 'INVALID: a group is 1 or 2 capital letters, or null' using errcode = '22023';
  end if;
  v_group := p_record ->> 'groupLabel';
  if (v_round = 'group') <> (v_group is not null) then raise exception 'INVALID: a group match has a group, and only a group match' using errcode = '22023'; end if;
  v_a := app.competition_uuid(p_record -> 'sideA', 'sideA');
  v_b := app.competition_uuid(p_record -> 'sideB', 'sideB');
  if v_a = v_b then raise exception 'INVALID: an entry cannot play itself' using errcode = '22023'; end if;
  v_court := app.competition_uuid(p_record -> 'courtId', 'courtId');
  if jsonb_typeof(p_record -> 'scheduledAt') = 'string' then
    if (p_record ->> 'scheduledAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'INVALID: scheduledAt must be an ISO instant with a time zone' using errcode = '22023';
    end if;
    begin
      v_at := (p_record ->> 'scheduledAt')::timestamptz;
    exception when others then
      raise exception 'INVALID: scheduledAt is not a real instant' using errcode = '22023';
    end;
  elsif jsonb_typeof(p_record -> 'scheduledAt') <> 'null' then
    raise exception 'INVALID: scheduledAt must be text or null' using errcode = '22023';
  end if;

  select e.tournament_id into v_tournament from public.tournament_events e where e.id = v_event for update;
  if not found then raise exception 'NOT_FOUND: event not found' using errcode = 'P0002'; end if;
  -- a side is a CONFIRMED entry of this event (pending and waitlisted entries are not in the draw yet)
  if exists (select 1 from public.event_entries en where en.id in (v_a, v_b) and (en.event_id <> v_event or en.status <> 'confirmed'))
     or (v_a is not null and not exists (select 1 from public.event_entries en where en.id = v_a))
     or (v_b is not null and not exists (select 1 from public.event_entries en where en.id = v_b)) then
    raise exception 'INVALID: each side must be a confirmed entry of this event' using errcode = '22023';
  end if;
  if v_court is not null and not exists (select 1 from public.courts c where c.id = v_court and c.tournament_id = v_tournament) then
    raise exception 'INVALID: the court is not a court of this tournament' using errcode = '22023';
  end if;

  if p_id is null then
    if p_expected_revision is not null then raise exception 'INVALID: a new match has no revision' using errcode = '22023'; end if;
    begin
      insert into public.competition_matches (event_id, round_code, match_number, group_label, side_a_entry, side_b_entry, scheduled_at, court_id)
        values (v_event, v_round, v_number, v_group, v_a, v_b, v_at, v_court) returning id, revision into v_id, v_rev;
    exception when unique_violation then
      raise exception 'INVALID: match number % is already used in this event', v_number using errcode = '22023';
    end;
    perform app.audit(p_actor, 'create_match', 'competition_matches', v_id::text, jsonb_build_object('event_id', v_event, 'round', v_round, 'number', v_number), p_reason);
  else
    select * into m from public.competition_matches where id = p_id for update;
    if not found then raise exception 'NOT_FOUND: match not found' using errcode = 'P0002'; end if;
    if p_expected_revision is distinct from m.revision then raise exception 'STALE: the match changed since the form was opened' using errcode = '40001'; end if;
    if m.event_id <> v_event then raise exception 'INVALID: a match cannot move to another event' using errcode = '22023'; end if;
    if m.status not in ('scheduled', 'ready', 'postponed') then raise exception 'INVALID: a match that has started or ended cannot be edited here' using errcode = '22023'; end if;
    begin
      update public.competition_matches
         set round_code = v_round, match_number = v_number, group_label = v_group, side_a_entry = v_a, side_b_entry = v_b,
             scheduled_at = v_at, court_id = v_court, revision = revision + 1
       where id = m.id returning id, revision into v_id, v_rev;
    exception when unique_violation then
      raise exception 'INVALID: match number % is already used in this event', v_number using errcode = '22023';
    end;
    perform app.audit(p_actor, 'update_match_schedule', 'competition_matches', v_id::text, jsonb_build_object('event_id', v_event, 'revision', v_rev), p_reason);
  end if;
  perform app.mark_dirty('competition match', false);
  return jsonb_build_object('id', v_id, 'revision', v_rev);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_record_result: record {status, games: [{a, b}], walkoverWinner, retiringSide}. Validated server-side against the event ruleset
-- (app.competition_result_winner = validateMatch). The result stays UNCONFIRMED (not public) until admin_confirm_result. The event's
-- draw must be published; recording the first result locks it.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_record_result(p_actor text, p_match uuid, p_record jsonb, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.competition_matches%rowtype;
  v_ruleset jsonb;
  v_winner text;
  v_games jsonb;
  v_rev integer;
  i integer;
  a integer;
  b integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['status', 'games', 'walkoverWinner', 'retiringSide'], 'result');
  if jsonb_typeof(p_record -> 'status') <> 'string' then raise exception 'INVALID: the result status must be text' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'walkoverWinner') not in ('string', 'null') or jsonb_typeof(p_record -> 'retiringSide') not in ('string', 'null') then
    raise exception 'INVALID: a side is "A", "B" or null' using errcode = '22023';
  end if;

  select * into m from public.competition_matches where id = p_match for update;
  if not found then raise exception 'NOT_FOUND: match not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from m.revision then raise exception 'STALE: the match changed since the form was opened' using errcode = '40001'; end if;
  if m.confirmed then raise exception 'INVALID: a confirmed result cannot be changed' using errcode = '22023'; end if;
  -- a result needs a match that is on (scheduled, ready, live, paused), or one whose result is recorded but NOT yet confirmed (a
  -- correction before confirmation). Never a postponed or cancelled match.
  if m.status not in ('scheduled', 'ready', 'live', 'paused', 'completed', 'walkover', 'retired', 'abandoned') then
    raise exception 'INVALID: a % match cannot take a result; reschedule it first', m.status using errcode = '22023';
  end if;
  if m.side_a_entry is null or m.side_b_entry is null then raise exception 'INVALID: both sides must be known before a result' using errcode = '22023'; end if;
  if not exists (select 1 from public.draws d where d.event_id = m.event_id and d.status in ('published', 'locked')) then
    raise exception 'INVALID: publish the draw before recording results' using errcode = '22023';
  end if;
  select e.ruleset into v_ruleset from public.tournament_events e where e.id = m.event_id;
  v_games := p_record -> 'games';
  v_winner := app.competition_result_winner(v_games, v_ruleset, p_record ->> 'status', p_record ->> 'walkoverWinner', p_record ->> 'retiringSide');
  -- both sides must be confirmed entries. The one exception (the referee's walkover): the side that did NOT receive the walkover may
  -- have withdrawn after the draw was published; the side that receives it must still be confirmed.
  if exists (select 1 from public.event_entries en
             where en.id in (m.side_a_entry, m.side_b_entry) and en.status <> 'confirmed'
               and not (p_record ->> 'status' = 'walkover' and en.status = 'withdrawn'
                        and en.id = case v_winner when 'A' then m.side_b_entry else m.side_a_entry end)) then
    raise exception 'INVALID: both sides must be confirmed entries (only the losing side of a walkover may have withdrawn)' using errcode = '22023';
  end if;

  delete from public.match_games where match_id = m.id;
  for i in 1 .. jsonb_array_length(v_games) loop
    a := (v_games -> (i - 1) ->> 'a')::integer;
    b := (v_games -> (i - 1) ->> 'b')::integer;
    insert into public.match_games (match_id, game_number, points_a, points_b, finished)
      values (m.id, i, a, b, app.competition_game_problem(a, b, v_ruleset, true) is null);
  end loop;
  update public.competition_matches
     set status = p_record ->> 'status', winner_side = v_winner, result_source = 'admin', revision = revision + 1
   where id = m.id returning revision into v_rev;
  update public.draws set status = 'locked' where event_id = m.event_id and status = 'published';
  perform app.audit(p_actor, 'record_result', 'competition_matches', m.id::text,
    jsonb_build_object('status', p_record ->> 'status', 'games', jsonb_array_length(v_games), 'winner_side', v_winner, 'revision', v_rev), p_reason);
  perform app.mark_dirty('competition result recorded', false);
  return jsonb_build_object('id', m.id, 'status', p_record ->> 'status', 'winnerSide', v_winner, 'confirmed', false, 'revision', v_rev);
end;
$$;

-- admin_confirm_result: the recorded result becomes official and public. Winners advance only on a confirmed result (wave 3 wiring).
create or replace function public.admin_confirm_result(p_actor text, p_match uuid, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.competition_matches%rowtype;
  v_rev integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into m from public.competition_matches where id = p_match for update;
  if not found then raise exception 'NOT_FOUND: match not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from m.revision then raise exception 'STALE: the match changed since the form was opened' using errcode = '40001'; end if;
  if m.confirmed then raise exception 'INVALID: the result is already confirmed' using errcode = '22023'; end if;
  if m.status not in ('completed', 'walkover', 'retired', 'abandoned') then raise exception 'INVALID: record a result before confirming it' using errcode = '22023'; end if;
  update public.competition_matches
     set confirmed = true, confirmed_at = now(), confirmed_by = p_actor, revision = revision + 1
   where id = m.id returning revision into v_rev;
  perform app.audit(p_actor, 'confirm_result', 'competition_matches', m.id::text,
    jsonb_build_object('status', m.status, 'winner_side', m.winner_side, 'revision', v_rev), p_reason);
  perform app.mark_dirty('competition result confirmed', false);
  return jsonb_build_object('id', m.id, 'confirmed', true, 'revision', v_rev);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_ranking_snapshot: a NEW draft snapshot from the local ranking calculator (src/lib/competition/stats).
-- Record {label, category, ageGroup, asOf, entries: [{playerId, rank, points, eventsCounted}]}.
-- admin_publish_ranking_snapshot: the owner's approval; the table is public only while competition_settings.rankings_public is on.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_ranking_snapshot(p_actor text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
  v_cat text;
  v_age text;
  v_as_of date;
  v_entries jsonb;
  x jsonb;
  v_id uuid;
  v_seen uuid[] := '{}';
  v_pid uuid;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['label', 'category', 'ageGroup', 'asOf', 'entries'], 'ranking');
  if jsonb_typeof(p_record -> 'label') <> 'string' then raise exception 'INVALID: the label must be text' using errcode = '22023'; end if;
  v_label := btrim(p_record ->> 'label');
  if length(v_label) not between 2 and 120 or v_label ~ '[[:cntrl:]]' then raise exception 'INVALID: the label must be 2 to 120 characters' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'category') not in ('string', 'null') or coalesce(p_record ->> 'category', 'MS') not in ('MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD') then
    raise exception 'INVALID: unknown category' using errcode = '22023';
  end if;
  v_cat := p_record ->> 'category';
  if jsonb_typeof(p_record -> 'ageGroup') not in ('string', 'null') or not app.competition_age_group_ok(p_record ->> 'ageGroup') then
    raise exception 'INVALID: the age group must be one of U<n>, <n>+, senior, open, veterans, masters, sub_junior, junior, youth, cadet, mini' using errcode = '22023';
  end if;
  v_age := p_record ->> 'ageGroup';
  if jsonb_typeof(p_record -> 'asOf') <> 'string' or (p_record ->> 'asOf') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID: asOf must be YYYY-MM-DD' using errcode = '22023'; end if;
  begin
    v_as_of := (p_record ->> 'asOf')::date;
  exception when others then
    raise exception 'INVALID: asOf is not a real date' using errcode = '22023';
  end;
  if to_char(v_as_of, 'YYYY-MM-DD') <> (p_record ->> 'asOf') then raise exception 'INVALID: asOf is not a real date' using errcode = '22023'; end if;
  if v_as_of > (now() at time zone 'Asia/Kolkata')::date then raise exception 'INVALID: asOf is in the future' using errcode = '22023'; end if;
  v_entries := p_record -> 'entries';
  if jsonb_typeof(v_entries) <> 'array' or jsonb_array_length(v_entries) not between 1 and 1000 then
    raise exception 'INVALID: a ranking has 1 to 1000 rows' using errcode = '22023';
  end if;
  for x in select value from jsonb_array_elements(v_entries) loop
    perform app.competition_keys(x, array['playerId', 'rank', 'points', 'eventsCounted'], 'ranking row');
    v_pid := app.competition_uuid(x -> 'playerId', 'playerId');
    if v_pid is null then raise exception 'INVALID: each ranking row needs a player' using errcode = '22023'; end if;
    if v_pid = any (v_seen) then raise exception 'INVALID: a player appears twice in the ranking' using errcode = '22023'; end if;
    if not exists (select 1 from public.players p where p.id = v_pid and p.merged_into is null) then raise exception 'NOT_FOUND: player not found (or merged into another)' using errcode = 'P0002'; end if;
    v_seen := v_seen || v_pid;
    if app.competition_int(x -> 'rank', 'rank', 1, 100000) is null or app.competition_int(x -> 'points', 'points', 0, 1000000000) is null
       or app.competition_int(x -> 'eventsCounted', 'eventsCounted', 0, 1000) is null then
      raise exception 'INVALID: rank, points and events counted are required' using errcode = '22023';
    end if;
  end loop;
  insert into public.ranking_snapshots (label, category, age_group, as_of, created_by) values (v_label, v_cat, v_age, v_as_of, p_actor) returning id into v_id;
  insert into public.ranking_entries (snapshot_id, player_id, rank, points, events_counted)
    select v_id, (re.value ->> 'playerId')::uuid, (re.value ->> 'rank')::integer, (re.value ->> 'points')::integer, (re.value ->> 'eventsCounted')::integer
    from jsonb_array_elements(v_entries) re;
  perform app.audit(p_actor, 'save_ranking_snapshot', 'ranking_snapshots', v_id::text,
    jsonb_build_object('rows', jsonb_array_length(v_entries), 'category', v_cat, 'as_of', p_record ->> 'asOf'), p_reason);
  return jsonb_build_object('id', v_id, 'rows', jsonb_array_length(v_entries), 'published', false);
end;
$$;

create or replace function public.admin_publish_ranking_snapshot(p_actor text, p_snapshot uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ranking_snapshots%rowtype;
  v_public boolean;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into s from public.ranking_snapshots where id = p_snapshot for update;
  if not found then raise exception 'NOT_FOUND: ranking not found' using errcode = 'P0002'; end if;
  if s.published then raise exception 'INVALID: the ranking is already published' using errcode = '22023'; end if;
  if not exists (select 1 from public.ranking_entries r where r.snapshot_id = s.id) then raise exception 'INVALID: the ranking has no rows' using errcode = '22023'; end if;
  update public.ranking_snapshots set published = true, published_at = now() where id = s.id;
  select cs.rankings_public into v_public from public.competition_settings cs where cs.id = 1;
  perform app.audit(p_actor, 'publish_ranking_snapshot', 'ranking_snapshots', s.id::text, jsonb_build_object('rankings_public', v_public), p_reason);
  if v_public then perform app.mark_dirty('ranking published', false); end if;
  return jsonb_build_object('id', s.id, 'published', true, 'publiclyVisible', v_public);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges on the functions: helpers and triggers for nobody; RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.competition_ruleset_problem(jsonb) from public, anon, authenticated;
revoke all on function app.competition_game_over(integer, integer, jsonb) from public, anon, authenticated;
revoke all on function app.competition_game_problem(integer, integer, jsonb, boolean) from public, anon, authenticated;
revoke all on function app.competition_result_winner(jsonb, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.competition_default_ruleset() from public, anon, authenticated;
revoke all on function app.competition_draw_guard() from public, anon, authenticated;
revoke all on function app.competition_draw_slots_guard() from public, anon, authenticated;
revoke all on function app.competition_match_guard() from public, anon, authenticated;
revoke all on function app.competition_games_guard() from public, anon, authenticated;
revoke all on function app.competition_ranking_guard() from public, anon, authenticated;
revoke all on function app.enqueue_notification(text, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function app.competition_import_guard() from public, anon, authenticated;
revoke all on function app.competition_uuid(jsonb, text) from public, anon, authenticated;
revoke all on function app.competition_int(jsonb, text, bigint, bigint) from public, anon, authenticated;
revoke all on function app.competition_keys(jsonb, text[], text) from public, anon, authenticated;
revoke all on function app.competition_reason(text) from public, anon, authenticated;
revoke all on function app.competition_age_group_ok(text) from public, anon, authenticated;
revoke all on function app.competition_age_is_junior(text) from public, anon, authenticated;
revoke all on function app.competition_outbox_payload_ok(jsonb) from public, anon, authenticated;

revoke all on function public.admin_save_event(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_add_entry(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_withdraw_entry(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_save_draw(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_publish_draw(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_save_match(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_record_result(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_confirm_result(text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.admin_save_ranking_snapshot(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_publish_ranking_snapshot(text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_save_event(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_add_entry(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_withdraw_entry(text, uuid, text) to service_role;
grant execute on function public.admin_save_draw(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_publish_draw(text, uuid, text) to service_role;
grant execute on function public.admin_save_match(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_record_result(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_confirm_result(text, uuid, integer, text) to service_role;
grant execute on function public.admin_save_ranking_snapshot(text, jsonb, text) to service_role;
grant execute on function public.admin_publish_ranking_snapshot(text, uuid, text) to service_role;
