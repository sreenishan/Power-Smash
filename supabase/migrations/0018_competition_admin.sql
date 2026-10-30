-- 0018_competition_admin.sql: the owner writes the competition admin screens need and 0017 did not have (platform wave 3).
--
--   public.admin_set_entry            confirm, waitlist, re-open or reject an entry and set its seed (0017 could only add or withdraw;
--                                     a draw takes CONFIRMED entries only, so without this nothing could ever be drawn)
--   public.admin_save_venue           create or edit a venue (a hall: name and city, public facts only)
--   public.admin_save_court           create or edit a court of a tournament ("Court 1"); the scheduler places matches on courts
--   public.admin_set_ranking_points   the owner approves the local ranking points table (D-110): saving it IS the approval. Until a
--                                     table is approved the admin refuses to calculate a ranking (it never uses example points).
--   app.competition_named_players     who competition pages may NAME (lead decision, wave 3): adult_confirmed, public, not
--                                     provisional, unmerged, not suppressed (app.suppressed_keys by player id or name key). Unlike
--                                     app.eligible_players (0006, the ARCHIVE rule, unchanged) it needs no published YouTube match.
--                                     Everyone else, and everyone in a junior event or minor-signal tournament, is "Protected player".
--   public.admin_competition_rankable_players  (read) which of a list of players app.competition_named_players holds. The admin
--                                     ranks only these, so a stored rank never has a gap that points at a left-out player (D-012, D-109).
--   app.competition_public_events (0017) is replaced with the same columns: a school_college tournament level is junior too.
--   app.competition_entry_faces (0017) is replaced with the same columns: names come from app.competition_named_players. A slug stays
--                                     only for a player who also has an archive page (app.eligible_players); competition pages do
--                                     not link to player pages.
--   api.public_competition_events (0017) gains is_junior as its LAST column (never null: an unknown counts as junior).
--   public.admin_publish_ranking_snapshot (0017) is replaced: it refuses a snapshot with any row that is protected NOW (a player
--                                     hidden, made provisional, merged, suppressed or not adult since it was worked out, or a junior
--                                     snapshot), with a plain message naming how many rows.
--   competition_settings gains ranking_points_table, ranking_points_approved_at and ranking_points_approved_by (all null = none).
--   public.admin_publish_draw (0017) is replaced: it now also refuses a draft draw whose entries are not exactly today's confirmed
--                                     entries (an entry added as confirmed, confirmed or withdrawn after the draw was made, or a second
--                                     admin tab), under the event's row lock like the entry RPCs.
--   api.public_competition_rankings (0017) is replaced with the same columns: only rows named by app.competition_named_players, the
--                                     rank renumbered over them (rank() over the stored rank), so a left-out row never shows as a gap.
--
-- What visitors see changes in one way only: an adult_confirmed, public player with no archive match yet is now NAMED in a published
-- draw and its matches (the lead's competition naming rule); nobody protected is named. Rankings stay unpublished until the owner
-- publishes a snapshot AND the rankings_public switch (no write path, still off) is on. No new table.
-- House rules (0001-0017): SECURITY DEFINER with search_path = '', app.require_owner FIRST, app.audit with ids, counts and codes only
-- (never a player's name), errors start 'INVALID:', 'NOT_FOUND:' or 'STALE:', EXECUTE for service_role only.
-- Apply after 0017, then run supabase/checks/0018_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- The points table shape (mirrors src/lib/admin/competition/validate.ts pointsTableProblems). null = fine, else the reason.
-- {label, levels: {<tournament level>: {<finish>: points}}, windowDays, bestN}. Levels are the tournaments.level vocabulary (0004),
-- finishes the stats/ranking.ts FINISHES; points are whole numbers 0..100000 and at least one is above 0.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.competition_points_table_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_levels constant text[] := array['district', 'state', 'zonal', 'national', 'open', 'corporate', 'veterans', 'school_college', 'other'];
  v_finishes constant text[] := array['W', 'F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', 'group', 'league'];
  k text;
  lv record;
  pt record;
  v_any boolean := false;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'the points table must be an object'; end if;
  for k in select jsonb_object_keys(p) loop
    if not k = any (array['label', 'levels', 'windowDays', 'bestN']) then return 'unknown points table field ' || k; end if;
  end loop;
  if jsonb_typeof(p -> 'label') is distinct from 'string' or length(btrim(p ->> 'label')) not between 2 and 120 or (p ->> 'label') ~ '[[:cntrl:]]' then
    return 'the table needs a name of 2 to 120 characters';
  end if;
  if jsonb_typeof(p -> 'windowDays') is distinct from 'number' or (p ->> 'windowDays') !~ '^[0-9]{1,4}$' or (p ->> 'windowDays')::integer not between 1 and 3660 then
    return 'the ranking window must be 1 to 3660 days';
  end if;
  if jsonb_typeof(p -> 'bestN') is distinct from 'number' or (p ->> 'bestN') !~ '^[0-9]{1,2}$' or (p ->> 'bestN')::integer not between 1 and 50 then
    return 'count 1 to 50 best results';
  end if;
  if jsonb_typeof(p -> 'levels') is distinct from 'object' or not exists (select 1 from jsonb_object_keys(p -> 'levels')) then
    return 'add points for at least one tournament level';
  end if;
  for lv in select key, value from jsonb_each(p -> 'levels') loop
    if not lv.key = any (v_levels) then return 'unknown tournament level ' || lv.key; end if;
    if jsonb_typeof(lv.value) <> 'object' then return 'the points of each level must be an object'; end if;
    for pt in select key, value from jsonb_each(lv.value) loop
      if not pt.key = any (v_finishes) then return 'unknown finish ' || pt.key; end if;
      if jsonb_typeof(pt.value) <> 'number' or (pt.value #>> '{}') !~ '^[0-9]{1,6}$' or (pt.value #>> '{}')::integer > 100000 then
        return 'points must be whole numbers from 0 to 100000';
      end if;
      if (pt.value #>> '{}')::integer > 0 then v_any := true; end if;
    end loop;
  end loop;
  if not v_any then return 'at least one finish must give some points'; end if;
  return null;
end;
$$;

alter table public.competition_settings
  add column ranking_points_table jsonb,
  add column ranking_points_approved_at timestamptz,
  add column ranking_points_approved_by text;
alter table public.competition_settings add constraint competition_settings_points_approved check (
  (ranking_points_table is null) = (ranking_points_approved_at is null) and (ranking_points_table is null) = (ranking_points_approved_by is null)
);
alter table public.competition_settings add constraint competition_settings_points_shape check (
  ranking_points_table is null or app.competition_points_table_problem(ranking_points_table) is null
);
comment on column public.competition_settings.ranking_points_table is 'The local ranking points table the owner approved (D-110). Null = none approved: no ranking can be calculated.';

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_entry: record {status: pending | confirmed | waitlisted | rejected, seed: 1..256 | null}.
-- Under the event's row lock (like admin_add_entry): a withdrawn or rejected entry stays so (add it again instead); an entry in a
-- published draw cannot change (withdraw it: the referee decides the walkover); moving into pending or confirmed respects the
-- capacity; a seed is unique among the entries that hold a place; rejected frees the players and drops the seed. A DRAFT draw that
-- holds or should hold the entry is out of date and is removed (the owner makes the draw again).
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
  perform app.require_owner(p_actor);
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
-- admin_save_venue: create (p_id null) or edit. Record {name, city}. Public facts only (no contact person, no phone).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_venue(p_actor text, p_id uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_city text;
  v_id uuid;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['name', 'city'], 'venue');
  if jsonb_typeof(p_record -> 'name') <> 'string' then raise exception 'INVALID: the venue needs a name' using errcode = '22023'; end if;
  v_name := btrim(p_record ->> 'name');
  if length(v_name) not between 2 and 160 or v_name ~ '[[:cntrl:]]' then raise exception 'INVALID: the venue name must be 2 to 160 characters' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'city') not in ('string', 'null') then raise exception 'INVALID: the city must be text or empty' using errcode = '22023'; end if;
  v_city := nullif(btrim(coalesce(p_record ->> 'city', '')), '');
  if v_city is not null and (length(v_city) > 60 or v_city ~ '[[:cntrl:]]') then raise exception 'INVALID: the city must be 60 characters or fewer' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.venues (name, city) values (v_name, v_city) returning id into v_id;
    perform app.audit(p_actor, 'create_venue', 'venues', v_id::text, jsonb_build_object('has_city', v_city is not null), p_reason);
    return jsonb_build_object('id', v_id, 'created', true);
  end if;
  update public.venues set name = v_name, city = v_city where id = p_id returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND: venue not found' using errcode = 'P0002'; end if;
  perform app.audit(p_actor, 'update_venue', 'venues', v_id::text, jsonb_build_object('has_city', v_city is not null), p_reason);
  return jsonb_build_object('id', v_id, 'created', false);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_court: create (p_id null) or edit. Record {tournamentId, venueId, label, sort}. A court never moves to another
-- tournament; its label is unique within the tournament. The label is public (api.public_competition_matches.court_label), so a
-- change to a court that has matches marks the site dirty.
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
  perform app.require_owner(p_actor);
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
-- admin_set_ranking_points: the owner approves the points table (replaces any earlier one). Audits the shape only (levels, window,
-- best N), never the numbers. Publishes nothing: a ranking still needs a snapshot, the owner's publish and the rankings_public switch.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_ranking_points(p_actor text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
  v_had boolean;
  v_at timestamptz := now();
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  v_problem := app.competition_points_table_problem(p_record);
  if v_problem is not null then raise exception 'INVALID: %', v_problem using errcode = '22023'; end if;
  select cs.ranking_points_table is not null into v_had from public.competition_settings cs where cs.id = 1 for update;
  update public.competition_settings
     set ranking_points_table = jsonb_build_object('label', btrim(p_record ->> 'label'), 'levels', p_record -> 'levels',
           'windowDays', (p_record ->> 'windowDays')::integer, 'bestN', (p_record ->> 'bestN')::integer),
         ranking_points_approved_at = v_at, ranking_points_approved_by = p_actor
   where id = 1;
  perform app.audit(p_actor, 'approve_ranking_points', 'competition_settings', '1',
    jsonb_build_object('levels', (select count(*) from jsonb_object_keys(p_record -> 'levels')), 'window_days', (p_record ->> 'windowDays')::integer,
      'best_n', (p_record ->> 'bestN')::integer, 'replaced', coalesce(v_had, false)), p_reason);
  return jsonb_build_object('approvedAt', v_at);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- app.competition_named_players: the players competition pages may NAME (lead decision, wave 3). The same tests as
-- app.eligible_players (0006) WITHOUT the published-match and alias parts: a competition entry is its own reason to be named, and
-- competition pages never link to player pages. Fail closed: any other age status, a hidden or listed player, a provisional or
-- merged one, or a suppressed id or name key is left out. The junior rule (event or tournament) is applied where it is used.
-- Internal (schema app): no privilege for the API roles; read only through the api views and the owner RPCs.
-- ------------------------------------------------------------------------------------------------------------------
create view app.competition_named_players as
select p.id
from public.players p
where p.age_status = 'adult_confirmed'
  and p.visibility = 'public'
  and not p.is_provisional
  and p.merged_into is null
  and not exists (select 1 from app.suppressed_keys k where (k.kind = 'player_id' and k.value = p.id::text) or (k.kind = 'name_normalized' and k.value = p.name_normalized));
revoke all on app.competition_named_players from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- app.competition_public_events (replaces 0017; same columns): an event is junior when the event itself is junior, the tournament
-- carries the minor signal, OR the tournament's level is school_college. Nothing sets is_minor_signal from the level (0004 default
-- false, 0014 edits the level only), so without the level test a School/college tournament would name its adult players. Fail
-- closed: an unknown minor signal counts as one. Mirrors tournamentOf in src/lib/admin/competition/supabase-backend.ts and the
-- memory store (minorSignal = is_minor_signal or level school_college).
-- ------------------------------------------------------------------------------------------------------------------
create or replace view app.competition_public_events as
select e.id,
  (e.is_junior or coalesce(t.is_minor_signal, true) or coalesce(t.level = 'school_college', false)) as is_junior,
  (t.visibility = 'listed_no_player_pages') as no_player_pages
from public.tournament_events e
join public.tournaments t on t.id = e.tournament_id
join app.public_tournament_ids pt on pt.id = e.tournament_id
where e.status <> 'draft';
revoke all on app.competition_public_events from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- app.competition_entry_faces (replaces 0017; same columns): a name ONLY for a player in app.competition_named_players, in an event
-- that is not junior (e.is_junior or the tournament's minor signal); a slug only when that player ALSO has an archive page
-- (app.eligible_players) and the tournament is not listed-only (D-018). Everyone else: no name, no slug, is_protected.
-- ------------------------------------------------------------------------------------------------------------------
create or replace view app.competition_entry_faces as
select en.id as entry_id,
  case when n1.named and n1.has_page and not pe.no_player_pages then p1.slug end as player1_slug,
  case when n1.named then p1.display_name end as player1_name,
  case when n2.named and n2.has_page and not pe.no_player_pages then p2.slug end as player2_slug,
  case when n2.named then p2.display_name end as player2_name,
  (not n1.named or (en.player2_id is not null and not n2.named)) as is_protected
from public.event_entries en
join app.competition_public_events pe on pe.id = en.event_id
join public.players p1 on p1.id = en.player1_id
left join public.players p2 on p2.id = en.player2_id
cross join lateral (select
  (not coalesce(pe.is_junior, true) and exists (select 1 from app.competition_named_players np where np.id = en.player1_id)) as named,
  exists (select 1 from app.eligible_players ep where ep.id = en.player1_id) as has_page) n1
cross join lateral (select
  (en.player2_id is not null and not coalesce(pe.is_junior, true) and exists (select 1 from app.competition_named_players np where np.id = en.player2_id)) as named,
  (en.player2_id is not null and exists (select 1 from app.eligible_players ep where ep.id = en.player2_id)) as has_page) n2;
revoke all on app.competition_entry_faces from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- api.public_competition_events (replaces 0017): the same columns in the same order, then is_junior LAST (create or replace view may
-- only append). It is the event's own junior flag or the tournament's minor signal; never null (an unknown counts as junior). The
-- public pages use it to show "Protected player" for every entry of a junior event without guessing from the age group.
-- ------------------------------------------------------------------------------------------------------------------
create or replace view api.public_competition_events with (security_barrier = true) as
select
  e.id,
  e.tournament_id,
  e.category,
  e.age_group,
  e.format,
  e.status,
  e.capacity,
  e.ruleset,
  coalesce(pe.is_junior, true) as is_junior
from public.tournament_events e
join app.competition_public_events pe on pe.id = e.id;
grant select on api.public_competition_events to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_competition_rankable_players: of p_players, the ids in app.competition_named_players (the competition naming rule). A read: no
-- reason, no audit, no write. Owner only like every competition RPC.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_competition_rankable_players(p_actor text, p_players uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_actor);
  if p_players is null or cardinality(p_players) = 0 then return array[]::uuid[]; end if;
  if cardinality(p_players) > 20000 then raise exception 'INVALID: too many players at once' using errcode = '22023'; end if;
  return coalesce((select array_agg(np.id order by np.id) from app.competition_named_players np where np.id = any (p_players)), array[]::uuid[]);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_publish_draw (replaces 0017): draft -> published (immutable from now on). The event must not be a draft, and the draw must hold
-- exactly the event's confirmed entries, checked under the event's row lock (admin_add_entry, admin_withdraw_entry and admin_set_entry
-- take the same lock), so an entry confirmed, added as confirmed or withdrawn after the draw was made, or a second admin tab, cannot
-- publish an out-of-date draw.
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
  perform app.require_owner(p_actor);
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
-- admin_publish_ranking_snapshot (replaces 0017): the owner's approval. It now REFUSES a snapshot in which any row is protected NOW:
-- a player no longer in app.competition_named_players (made hidden, provisional, merged, suppressed or not adult after the ranking was
-- worked out), or every row of a junior snapshot. The message says how many rows, in plain English; the owner works the ranking out
-- again (the admin then leaves those players out). The public view would drop such rows anyway; refusing keeps the table the owner
-- approves and the public table the same. Mirrors rankingProtectedMessage in src/lib/admin/competition/service.ts.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_publish_ranking_snapshot(p_actor text, p_snapshot uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ranking_snapshots%rowtype;
  v_public boolean;
  v_protected integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  select * into s from public.ranking_snapshots where id = p_snapshot for update;
  if not found then raise exception 'NOT_FOUND: ranking not found' using errcode = 'P0002'; end if;
  if s.published then raise exception 'INVALID: the ranking is already published' using errcode = '22023'; end if;
  if not exists (select 1 from public.ranking_entries r where r.snapshot_id = s.id) then raise exception 'INVALID: the ranking has no rows' using errcode = '22023'; end if;
  select count(*) into v_protected from public.ranking_entries r
   where r.snapshot_id = s.id
     and (coalesce(s.is_junior, true) or not exists (select 1 from app.competition_named_players np where np.id = r.player_id));
  if v_protected > 0 then
    raise exception 'INVALID: % in this ranking % now protected (age not confirmed, hidden, provisional, merged or removed on request), so it cannot be published. Work the ranking out again.',
      case when v_protected = 1 then '1 player' else v_protected::text || ' players' end, case when v_protected = 1 then 'is' else 'are' end
      using errcode = '22023';
  end if;
  update public.ranking_snapshots set published = true, published_at = now() where id = s.id;
  select cs.rankings_public into v_public from public.competition_settings cs where cs.id = 1;
  perform app.audit(p_actor, 'publish_ranking_snapshot', 'ranking_snapshots', s.id::text, jsonb_build_object('rankings_public', v_public), p_reason);
  if v_public then perform app.mark_dirty('ranking published', false); end if;
  return jsonb_build_object('id', s.id, 'published', true, 'publiclyVisible', v_public);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- api.public_competition_rankings (replaces 0017; same columns, types and grants): only named rows (a player in
-- app.competition_named_players, in a non-junior snapshot), with the rank renumbered over THOSE rows. rank() over the stored rank keeps
-- ties (1, 2, 2, 4) but closes every gap a left-out row would leave (a player protected after publishing), so a rank can never point at
-- a hidden, protected or suppressed player (D-012, D-109). The admin ranks only named players and publishing refuses a protected row;
-- this is the third lock. Window functions run after WHERE, so left-out rows take no rank. A slug only with an archive page.
-- ------------------------------------------------------------------------------------------------------------------
create or replace view api.public_competition_rankings with (security_barrier = true) as
select
  s.id as snapshot_id,
  s.label,
  s.category,
  s.age_group,
  s.as_of,
  s.published_at,
  (rank() over (partition by r.snapshot_id order by r.rank))::integer as rank,
  r.points,
  r.events_counted,
  case when exists (select 1 from app.eligible_players ep where ep.id = r.player_id) then p.slug end as player_slug,
  p.display_name as player_name,
  false as is_protected
from public.ranking_entries r
join public.ranking_snapshots s on s.id = r.snapshot_id
join public.players p on p.id = r.player_id
where s.published
  and not coalesce(s.is_junior, true)
  and exists (select 1 from app.competition_named_players np where np.id = r.player_id)
  and coalesce((select rp.on_now from app.competition_rankings_public rp), false);
grant select on api.public_competition_rankings to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges: the helper for nobody; the RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.competition_points_table_problem(jsonb) from public, anon, authenticated;
revoke all on function public.admin_set_entry(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_save_venue(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_save_court(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_set_ranking_points(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_set_entry(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_save_venue(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_save_court(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_set_ranking_points(text, jsonb, text) to service_role;
revoke all on function public.admin_competition_rankable_players(text, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_competition_rankable_players(text, uuid[]) to service_role;
-- create or replace keeps the 0017 privileges of admin_publish_draw and admin_publish_ranking_snapshot; restated so this file alone
-- shows them
revoke all on function public.admin_publish_draw(text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_publish_draw(text, uuid, text) to service_role;
revoke all on function public.admin_publish_ranking_snapshot(text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_publish_ranking_snapshot(text, uuid, text) to service_role;
