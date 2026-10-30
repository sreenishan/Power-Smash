-- 0019_competition_accounts.sql: organizer and scorer accounts (platform wave 4, D-108). Invitation only; sign-ups stay disabled.
--
--   profiles.role                      gains 'organizer' and 'scorer' (still exactly one owner; editors stay off, D-007). New columns
--                                      disabled_at and disabled_by: a disabled account has no access at all from that moment.
--                                      An organizer or scorer row needs a display name with no contact data (no "@", fewer than seven
--                                      digits), like profile_requests.summary (0008). No email is stored here: it stays in Supabase Auth.
--   organizer_assignments (0017)       gains revoked_at and revoked_by: revoking keeps the row (the history) and ends the access at once.
--                                      At most one ACTIVE row per person, tournament and role (partial unique index); the old
--                                      always-unique constraint is dropped so a tournament can be given back after a revoke. A guard
--                                      trigger keeps the row's who/what fixed and a revoke final.
--   app.require_competition_access(p_actor, p_tournament, p_needed)
--                                      the scoped access check. The owner always passes (same rule as app.require_owner). Anyone
--                                      else passes only when ALL hold: the organizer/scorer switch in competition_settings is on
--                                      (organizer_roles_enabled, set only by the owner through admin_set_organizer_access), the
--                                      profile is an organizer or scorer, not disabled, and holds an ACTIVE assignment to that
--                                      tournament with the same role; p_needed 'run' needs an organizer assignment, 'score' an
--                                      organizer or scorer one. A missing object (null tournament) is refused for everyone but the
--                                      owner, so a non-owner cannot even learn whether an id exists. Error: 'FORBIDDEN:'.
--   app.competition_tournament_of(kind, id)  the tournament an event, entry, draw, match or court belongs to (null when not found).
--   app.competition_record_uuid(record, key) a uuid from a jsonb record, or null (never raises: the access check runs before validation).
--   The competition RPCs below are REPLACED with the same signatures and bodies; only their first statement changes from
--   app.require_owner to app.require_competition_access (the owner's behaviour is unchanged, error for error):
--     run   (organizer, owner)          admin_save_event, admin_add_entry, admin_withdraw_entry, admin_set_entry, admin_save_draw,
--                                       admin_publish_draw, admin_save_match, admin_confirm_result, admin_save_court
--     score (scorer, organizer, owner)  admin_record_result (record, never confirm and never publish)
--   Owner only, unchanged: venues (admin_save_venue, shared by every tournament), rankings and the points table
--   (admin_save_ranking_snapshot, admin_publish_ranking_snapshot, admin_set_ranking_points, admin_competition_rankable_players), and
--   every archive, money and settings RPC.
--   New owner-only RPCs (the Accounts screen):
--     public.admin_create_account        records an invited person (the Supabase Auth user id from the invite), role and tournaments
--     public.admin_assign_tournament     gives one more tournament to an organizer or scorer
--     public.admin_revoke_assignment     ends one assignment at once
--     public.admin_disable_account       ends an account at once (every assignment revoked too); the owner and editors cannot be disabled here
--     public.admin_set_organizer_access  the database switch competition_settings.organizer_roles_enabled (off by default)
--
-- What visitors see does not change: no view, no public column, no page. Nothing is switched on: the database switch stays off, and the
-- admin also needs ORGANIZER_ACCOUNTS_ENABLED exactly 'true' before an organizer or scorer can sign in.
-- House rules (0001-0018): RLS stays on with no policies, nothing for anon or authenticated, service_role reads only; SECURITY DEFINER
-- with search_path = '', the access check FIRST, app.audit with ids, counts and codes only (never a name or an email), errors start
-- 'INVALID:', 'NOT_FOUND:', 'STALE:' or 'FORBIDDEN:', EXECUTE for service_role only.
-- Apply after 0018, then run supabase/checks/0019_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- profiles: two more roles, and a disabled state
-- ------------------------------------------------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'editor', 'organizer', 'scorer'));
alter table public.profiles add column disabled_at timestamptz;
alter table public.profiles add column disabled_by text;
alter table public.profiles add constraint profiles_disabled_pair check ((disabled_at is null) = (disabled_by is null));
-- an organizer or scorer row is created only by admin_create_account; its label carries no contact data
alter table public.profiles add constraint profiles_scoped_label check (
  role not in ('organizer', 'scorer')
  or (display_name is not null and display_name = btrim(display_name) and length(display_name) between 2 and 60
      and display_name !~ '[[:cntrl:]]' and position('@' in display_name) = 0 and length(regexp_replace(display_name, '[^0-9]', '', 'g')) < 7)
);
-- only an organizer or scorer can be disabled (the owner's own access is never switched off from the admin)
alter table public.profiles add constraint profiles_disable_scoped_only check (disabled_at is null or role in ('organizer', 'scorer'));
comment on table public.profiles is 'Private. Admin users: id = the GoTrue user id, role owner | editor | organizer | scorer (editors are off, D-007; organizers and scorers by invitation, D-108). Read by the admin function with the secret key to decide the role; written only by the owner row by hand and by admin_create_account / admin_disable_account.';
comment on column public.profiles.disabled_at is 'Set when the owner ends an organizer or scorer account: from then on the person has no access (database and admin).';

-- ------------------------------------------------------------------------------------------------------------------
-- organizer_assignments: revocable, with history
-- ------------------------------------------------------------------------------------------------------------------
alter table public.organizer_assignments drop constraint organizer_assignments_unique;
alter table public.organizer_assignments add column revoked_at timestamptz;
alter table public.organizer_assignments add column revoked_by text;
alter table public.organizer_assignments add constraint organizer_assignments_revoked_pair check ((revoked_at is null) = (revoked_by is null));
create unique index organizer_assignments_active_unique on public.organizer_assignments (profile_id, tournament_id, role) where revoked_at is null;
create index organizer_assignments_tournament_idx on public.organizer_assignments (tournament_id) where revoked_at is null;
comment on table public.organizer_assignments is 'Which tournaments an organizer or scorer may work on (D-108). Active while revoked_at is null. Read by app.require_competition_access; written only by the owner RPCs of 0019.';

create or replace function app.competition_assignment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.profile_id <> old.profile_id or new.tournament_id <> old.tournament_id or new.role <> old.role
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'INVALID: an assignment cannot change; revoke it and make a new one' using errcode = '22023';
  end if;
  if old.revoked_at is not null and (new.revoked_at is distinct from old.revoked_at or new.revoked_by is distinct from old.revoked_by) then
    raise exception 'INVALID: a revoked assignment stays revoked' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger organizer_assignments_guard before update on public.organizer_assignments for each row execute function app.competition_assignment_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- helpers
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.competition_record_uuid(p_record jsonb, p_key text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' or jsonb_typeof(p_record -> p_key) is distinct from 'string'
     or (p_record ->> p_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return (p_record ->> p_key)::uuid;
end;
$$;

create or replace function app.competition_tournament_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_id is null then return null; end if;
  if p_kind = 'event' then
    select e.tournament_id into v from public.tournament_events e where e.id = p_id;
  elsif p_kind = 'entry' then
    select e.tournament_id into v from public.event_entries en join public.tournament_events e on e.id = en.event_id where en.id = p_id;
  elsif p_kind = 'draw' then
    select e.tournament_id into v from public.draws d join public.tournament_events e on e.id = d.event_id where d.id = p_id;
  elsif p_kind = 'match' then
    select e.tournament_id into v from public.competition_matches m join public.tournament_events e on e.id = m.event_id where m.id = p_id;
  elsif p_kind = 'court' then
    select c.tournament_id into v from public.courts c where c.id = p_id;
  else
    raise exception 'INVALID: unknown kind of competition record' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- app.require_competition_access: the owner, or an active organizer/scorer assignment to that tournament (see the header)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.require_competition_access(p_actor text, p_tournament uuid, p_needed text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
begin
  if p_needed is null or p_needed not in ('run', 'score') then
    raise exception 'INVALID: unknown access level' using errcode = '22023';
  end if;
  if p_actor is null or p_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'FORBIDDEN: the actor may not change this tournament' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = p_actor::uuid;
  if found and p.role = 'owner' then return; end if;
  if found and p.role in ('organizer', 'scorer') and p.disabled_at is null and p_tournament is not null
     and coalesce((select s.organizer_roles_enabled from public.competition_settings s where s.id = 1), false)
     and exists (select 1 from public.organizer_assignments a
                  where a.profile_id = p.id and a.tournament_id = p_tournament and a.revoked_at is null and a.role = p.role
                    and (a.role = 'organizer' or p_needed = 'score')) then
    return;
  end if;
  raise exception 'FORBIDDEN: the actor may not change this tournament' using errcode = '42501';
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_event: the 0017 body unchanged except the first statement: 'run' access to the event's tournament (the record's tournamentId, and for an edit the stored event's too).
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
  perform app.require_competition_access(p_actor, app.competition_record_uuid(p_record, 'tournamentId'), 'run');
  if p_id is not null then perform app.require_competition_access(p_actor, app.competition_tournament_of('event', p_id), 'run'); end if;
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
-- admin_add_entry: the 0017 body unchanged except the first statement: 'run' access to the event's tournament.
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
  perform app.require_competition_access(p_actor, app.competition_tournament_of('event', p_event), 'run');
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

-- ------------------------------------------------------------------------------------------------------------------
-- admin_withdraw_entry: the 0017 body unchanged except the first statement: 'run' access to the entry's tournament.
-- ------------------------------------------------------------------------------------------------------------------
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
  perform app.require_competition_access(p_actor, app.competition_tournament_of('entry', p_entry), 'run');
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
-- admin_set_entry: the 0018 body unchanged except the first statement: 'run' access to the entry's tournament.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_entry(p_actor text, p_entry uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  en public.event_entries%rowtype;
  e public.tournament_events%rowtype;
  v_status text;
  v_seed integer;
  v_draft uuid;
begin
  perform app.require_competition_access(p_actor, app.competition_tournament_of('entry', p_entry), 'run');
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['status', 'seed'], 'entry');
  if jsonb_typeof(p_record -> 'status') <> 'string' or (p_record ->> 'status') not in ('pending', 'confirmed', 'waitlisted', 'rejected') then
    raise exception 'INVALID: an entry is pending, confirmed, waitlisted or rejected' using errcode = '22023';
  end if;
  v_status := p_record ->> 'status';
  v_seed := app.competition_int(p_record -> 'seed', 'seed', 1, 256);

  select * into en from public.event_entries where id = p_entry;
  if not found then raise exception 'NOT_FOUND: entry not found' using errcode = 'P0002'; end if;
  select * into e from public.tournament_events where id = en.event_id for update;
  select * into en from public.event_entries where id = p_entry for update;
  if en.status in ('withdrawn', 'rejected') then raise exception 'INVALID: the entry is %; add it again instead', en.status using errcode = '22023'; end if;
  if v_status = 'rejected' then v_seed := null; end if;
  if en.status = v_status and en.seed is not distinct from v_seed then
    return jsonb_build_object('id', en.id, 'status', en.status, 'seed', en.seed, 'draftDrawCleared', false);
  end if;
  if exists (select 1 from public.draw_slots s join public.draws d on d.id = s.draw_id where s.entry_id = en.id and d.status <> 'draft') then
    raise exception 'INVALID: the entry is in a published draw; withdraw it instead' using errcode = '22023';
  end if;
  if v_status in ('pending', 'confirmed') and en.status not in ('pending', 'confirmed') and e.capacity is not null
     and (select count(*) from public.event_entries x where x.event_id = e.id and x.status in ('pending', 'confirmed')) >= e.capacity then
    raise exception 'INVALID: the event is full (capacity %)', e.capacity using errcode = '22023';
  end if;
  if v_seed is not null and exists (select 1 from public.event_entries x where x.event_id = e.id and x.id <> en.id and x.seed = v_seed and x.status in ('pending', 'confirmed', 'waitlisted')) then
    raise exception 'INVALID: seed % is already used in this event', v_seed using errcode = '22023';
  end if;

  select d.id into v_draft from public.draws d
   where d.event_id = e.id and d.status = 'draft'
     and (exists (select 1 from public.draw_slots s where s.draw_id = d.id and s.entry_id = en.id) or v_status = 'confirmed' or en.status = 'confirmed');
  if v_draft is not null then delete from public.draws where id = v_draft; end if;

  update public.event_entries set status = v_status, seed = v_seed where id = en.id;
  if v_status = 'rejected' then delete from public.event_entry_players where entry_id = en.id; end if;
  perform app.audit(p_actor, 'set_entry', 'event_entries', en.id::text,
    jsonb_build_object('event_id', e.id, 'old_status', en.status, 'new_status', v_status, 'seed', v_seed, 'draft_draw_cleared', v_draft is not null), p_reason);
  return jsonb_build_object('id', en.id, 'status', v_status, 'seed', v_seed, 'draftDrawCleared', v_draft is not null);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_draw: the 0017 body unchanged except the first statement: 'run' access to the event's tournament.
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
  perform app.require_competition_access(p_actor, app.competition_tournament_of('event', p_event), 'run');
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

-- ------------------------------------------------------------------------------------------------------------------
-- admin_publish_draw: the 0018 body unchanged except the first statement: 'run' access to the draw's tournament.
-- ------------------------------------------------------------------------------------------------------------------
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
  perform app.require_competition_access(p_actor, app.competition_tournament_of('draw', p_draw), 'run');
  perform app.competition_reason(p_reason);
  select * into d from public.draws where id = p_draw;
  if not found then raise exception 'NOT_FOUND: draw not found' using errcode = 'P0002'; end if;
  select e.status into v_event_status from public.tournament_events e where e.id = d.event_id for update;
  select * into d from public.draws where id = p_draw for update;
  if not found then raise exception 'NOT_FOUND: draw not found' using errcode = 'P0002'; end if;
  if d.status <> 'draft' then raise exception 'INVALID: the draw is already published' using errcode = '22023'; end if;
  if v_event_status = 'draft' then raise exception 'INVALID: open the event before publishing its draw' using errcode = '22023'; end if;
  if not exists (select 1 from public.draw_slots s where s.draw_id = d.id) then raise exception 'INVALID: the draw has no slots' using errcode = '22023'; end if;
  if exists (
       select 1 from public.event_entries x
        where x.event_id = d.event_id and x.status = 'confirmed'
          and not exists (select 1 from public.draw_slots s where s.draw_id = d.id and s.entry_id = x.id))
     or exists (
       select 1 from public.draw_slots s
        where s.draw_id = d.id and s.entry_id is not null
          and not exists (select 1 from public.event_entries x where x.id = s.entry_id and x.event_id = d.event_id and x.status = 'confirmed')) then
    raise exception 'INVALID: the confirmed entries changed after this draw was made; make the draw again, then publish it' using errcode = '22023';
  end if;
  update public.draws set status = 'published', published_at = now() where id = d.id;
  perform app.audit(p_actor, 'publish_draw', 'draws', d.id::text, jsonb_build_object('event_id', d.event_id, 'seed', d.seed), p_reason);
  perform app.mark_dirty('draw published', false);
  return jsonb_build_object('id', d.id, 'status', 'published');
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_match: the 0017 body unchanged except the first statement: 'run' access to the record's event's tournament, and for an edit the stored match's too.
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
  perform app.require_competition_access(p_actor, app.competition_tournament_of('event', app.competition_record_uuid(p_record, 'eventId')), 'run');
  if p_id is not null then perform app.require_competition_access(p_actor, app.competition_tournament_of('match', p_id), 'run'); end if;
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
-- admin_record_result: the 0017 body unchanged except the first statement: 'score' access to the match's tournament (a scorer may record, never confirm).
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
  perform app.require_competition_access(p_actor, app.competition_tournament_of('match', p_match), 'score');
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

-- ------------------------------------------------------------------------------------------------------------------
-- admin_confirm_result: the 0017 body unchanged except the first statement: 'run' access to the match's tournament (organizer or owner only).
-- ------------------------------------------------------------------------------------------------------------------
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
  perform app.require_competition_access(p_actor, app.competition_tournament_of('match', p_match), 'run');
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
-- admin_save_court: the 0018 body unchanged except the first statement: 'run' access to the record's tournament, and for an edit the stored court's too.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_court(p_actor text, p_id uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament uuid;
  v_venue uuid;
  v_label text;
  v_sort integer;
  c public.courts%rowtype;
  v_id uuid;
begin
  perform app.require_competition_access(p_actor, app.competition_record_uuid(p_record, 'tournamentId'), 'run');
  if p_id is not null then perform app.require_competition_access(p_actor, app.competition_tournament_of('court', p_id), 'run'); end if;
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['tournamentId', 'venueId', 'label', 'sort'], 'court');
  v_tournament := app.competition_uuid(p_record -> 'tournamentId', 'tournamentId');
  if v_tournament is null then raise exception 'INVALID: the court needs its tournament' using errcode = '22023'; end if;
  v_venue := app.competition_uuid(p_record -> 'venueId', 'venueId');
  if jsonb_typeof(p_record -> 'label') <> 'string' then raise exception 'INVALID: the court needs a name' using errcode = '22023'; end if;
  v_label := btrim(p_record ->> 'label');
  if length(v_label) not between 1 and 40 or v_label ~ '[[:cntrl:]]' then raise exception 'INVALID: the court name must be 1 to 40 characters' using errcode = '22023'; end if;
  v_sort := app.competition_int(p_record -> 'sort', 'sort', 0, 999);
  if v_sort is null then raise exception 'INVALID: the court needs its order (0 to 999)' using errcode = '22023'; end if;
  if not exists (select 1 from public.tournaments t where t.id = v_tournament) then raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002'; end if;
  if v_venue is not null and not exists (select 1 from public.venues v where v.id = v_venue) then raise exception 'NOT_FOUND: venue not found' using errcode = 'P0002'; end if;

  if p_id is null then
    begin
      insert into public.courts (tournament_id, venue_id, label, sort) values (v_tournament, v_venue, v_label, v_sort) returning id into v_id;
    exception when unique_violation then
      raise exception 'INVALID: this tournament already has a court with that name' using errcode = '22023';
    end;
    perform app.audit(p_actor, 'create_court', 'courts', v_id::text, jsonb_build_object('tournament_id', v_tournament, 'sort', v_sort), p_reason);
    return jsonb_build_object('id', v_id, 'created', true);
  end if;

  select * into c from public.courts where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: court not found' using errcode = 'P0002'; end if;
  if c.tournament_id <> v_tournament then raise exception 'INVALID: a court cannot move to another tournament' using errcode = '22023'; end if;
  begin
    update public.courts set venue_id = v_venue, label = v_label, sort = v_sort where id = c.id;
  exception when unique_violation then
    raise exception 'INVALID: this tournament already has a court with that name' using errcode = '22023';
  end;
  perform app.audit(p_actor, 'update_court', 'courts', c.id::text, jsonb_build_object('tournament_id', v_tournament, 'label_changed', c.label <> v_label, 'sort', v_sort), p_reason);
  if c.label <> v_label and exists (select 1 from public.competition_matches m where m.court_id = c.id) then perform app.mark_dirty('court renamed', false); end if;
  return jsonb_build_object('id', c.id, 'created', false);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_create_account: record an invited person. p_user is the Supabase Auth user id the invite returned (the admin function makes
-- the invite with the secret key first). p_record = {role: organizer | scorer, displayName, tournamentIds: [uuid, ...]}. Audits the
-- role and the number of tournaments, never the name.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_create_account(p_actor text, p_user uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_name text;
  v_ids uuid[] := '{}';
  v_id uuid;
  i integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['role', 'displayName', 'tournamentIds'], 'account');
  if p_user is null then raise exception 'INVALID: the account needs the id of the invited user' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'role') <> 'string' or (p_record ->> 'role') not in ('organizer', 'scorer') then
    raise exception 'INVALID: the role must be organizer or scorer' using errcode = '22023';
  end if;
  v_role := p_record ->> 'role';
  if jsonb_typeof(p_record -> 'displayName') <> 'string' then raise exception 'INVALID: the account needs a name' using errcode = '22023'; end if;
  v_name := btrim(p_record ->> 'displayName');
  if length(v_name) not between 2 and 60 or v_name ~ '[[:cntrl:]]' or position('@' in v_name) > 0 or length(regexp_replace(v_name, '[^0-9]', '', 'g')) >= 7 then
    raise exception 'INVALID: the name must be 2 to 60 characters, with no email address or phone number' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record -> 'tournamentIds') <> 'array' or jsonb_array_length(p_record -> 'tournamentIds') not between 1 and 50 then
    raise exception 'INVALID: choose 1 to 50 tournaments' using errcode = '22023';
  end if;
  for i in 0 .. jsonb_array_length(p_record -> 'tournamentIds') - 1 loop
    v_id := app.competition_uuid(p_record -> 'tournamentIds' -> i, 'each tournament');
    if v_id is null then raise exception 'INVALID: each tournament must be an id' using errcode = '22023'; end if;
    if v_id = any (v_ids) then raise exception 'INVALID: a tournament is listed twice' using errcode = '22023'; end if;
    if not exists (select 1 from public.tournaments t where t.id = v_id) then raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002'; end if;
    v_ids := v_ids || v_id;
  end loop;
  if exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'INVALID: this person already has an account' using errcode = '22023';
  end if;

  insert into public.profiles (id, role, display_name) values (p_user, v_role, v_name);
  insert into public.organizer_assignments (profile_id, tournament_id, role, created_by)
    select p_user, t, v_role, p_actor from unnest(v_ids) as t;
  perform app.audit(p_actor, 'create_account', 'profiles', p_user::text, jsonb_build_object('role', v_role, 'tournaments', cardinality(v_ids)), p_reason);
  return jsonb_build_object('id', p_user, 'role', v_role, 'tournaments', cardinality(v_ids));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_assign_tournament: one more tournament for an active organizer or scorer (with the role of the account)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_assign_tournament(p_actor text, p_profile uuid, p_tournament uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_id uuid;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into p from public.profiles where id = p_profile for update;
  if not found or p.role not in ('organizer', 'scorer') then raise exception 'NOT_FOUND: account not found' using errcode = 'P0002'; end if;
  if p.disabled_at is not null then raise exception 'INVALID: this account has been ended; invite the person again instead' using errcode = '22023'; end if;
  if not exists (select 1 from public.tournaments t where t.id = p_tournament) then raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.organizer_assignments a where a.profile_id = p.id and a.tournament_id = p_tournament and a.role = p.role and a.revoked_at is null) then
    raise exception 'INVALID: this person already has this tournament' using errcode = '22023';
  end if;
  insert into public.organizer_assignments (profile_id, tournament_id, role, created_by) values (p.id, p_tournament, p.role, p_actor) returning id into v_id;
  perform app.audit(p_actor, 'assign_tournament', 'organizer_assignments', v_id::text, jsonb_build_object('profile_id', p.id, 'tournament_id', p_tournament, 'role', p.role), p_reason);
  return jsonb_build_object('id', v_id, 'profileId', p.id, 'tournamentId', p_tournament, 'role', p.role);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_revoke_assignment: ends one assignment; the very next call by that person for that tournament is refused
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_revoke_assignment(p_actor text, p_assignment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.organizer_assignments%rowtype;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into a from public.organizer_assignments where id = p_assignment for update;
  if not found then raise exception 'NOT_FOUND: assignment not found' using errcode = 'P0002'; end if;
  if a.revoked_at is not null then raise exception 'INVALID: this assignment has already been removed' using errcode = '22023'; end if;
  update public.organizer_assignments set revoked_at = now(), revoked_by = p_actor where id = a.id;
  perform app.audit(p_actor, 'revoke_assignment', 'organizer_assignments', a.id::text, jsonb_build_object('profile_id', a.profile_id, 'tournament_id', a.tournament_id, 'role', a.role), p_reason);
  return jsonb_build_object('id', a.id, 'revoked', true);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_disable_account: ends an organizer or scorer account and revokes every active assignment, at once. The owner and editors
-- cannot be disabled here. (The admin function also bans the Supabase Auth user, best effort; the database refusal does not wait for it.)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_disable_account(p_actor text, p_profile uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  n integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into p from public.profiles where id = p_profile for update;
  if not found or p.role not in ('organizer', 'scorer') then raise exception 'NOT_FOUND: account not found' using errcode = 'P0002'; end if;
  if p.disabled_at is not null then raise exception 'INVALID: this account has already been ended' using errcode = '22023'; end if;
  update public.profiles set disabled_at = now(), disabled_by = p_actor where id = p.id;
  update public.organizer_assignments set revoked_at = now(), revoked_by = p_actor where profile_id = p.id and revoked_at is null;
  get diagnostics n = row_count;
  perform app.audit(p_actor, 'disable_account', 'profiles', p.id::text, jsonb_build_object('role', p.role, 'assignments_revoked', n), p_reason);
  return jsonb_build_object('id', p.id, 'disabled', true, 'assignmentsRevoked', n);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_organizer_access: the database switch for organizer and scorer access (competition_settings.organizer_roles_enabled)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_organizer_access(p_actor text, p_enabled boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  if p_enabled is null then raise exception 'INVALID: the switch must be on or off' using errcode = '22023'; end if;
  select cs.organizer_roles_enabled into v_old from public.competition_settings cs where cs.id = 1 for update;
  update public.competition_settings set organizer_roles_enabled = p_enabled where id = 1;
  perform app.audit(p_actor, 'set_organizer_access', 'competition_settings', '1', jsonb_build_object('old', v_old, 'new', p_enabled), p_reason);
  return jsonb_build_object('enabled', p_enabled, 'changed', v_old is distinct from p_enabled);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges: helpers for nobody; RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.competition_assignment_guard() from public, anon, authenticated, service_role;
revoke all on function app.competition_record_uuid(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function app.competition_tournament_of(text, uuid) from public, anon, authenticated, service_role;
revoke all on function app.require_competition_access(text, uuid, text) from public, anon, authenticated, service_role;

revoke all on function public.admin_save_event(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_add_entry(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_withdraw_entry(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_set_entry(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_save_draw(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_publish_draw(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_save_match(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_record_result(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_confirm_result(text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.admin_save_court(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_save_event(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_add_entry(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_withdraw_entry(text, uuid, text) to service_role;
grant execute on function public.admin_set_entry(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_save_draw(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_publish_draw(text, uuid, text) to service_role;
grant execute on function public.admin_save_match(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_record_result(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_confirm_result(text, uuid, integer, text) to service_role;
grant execute on function public.admin_save_court(text, uuid, jsonb, text) to service_role;

revoke all on function public.admin_create_account(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_assign_tournament(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_revoke_assignment(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_disable_account(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_set_organizer_access(text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_create_account(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_assign_tournament(text, uuid, uuid, text) to service_role;
grant execute on function public.admin_revoke_assignment(text, uuid, text) to service_role;
grant execute on function public.admin_disable_account(text, uuid, text) to service_role;
grant execute on function public.admin_set_organizer_access(text, boolean, text) to service_role;
