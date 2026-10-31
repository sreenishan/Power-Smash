-- 0024_organizer_search.sql: what an organizer needs to fill an event (platform wave 4 follow-ups, D-117 and D-122): find a player by
-- name, add a NEW player when nobody matches, and see the same "On the site" preview the owner sees. Organizers and scorers have no
-- database role of their own: the admin function calls these with the secret key and the VERIFIED actor id, and each function checks
-- that actor against the tournament first (app.require_competition_access, 0019).
--
-- What it adds (three RPCs, no table, no view, no column):
--   public.admin_competition_search_players(p_actor, p_tournament, p_query, p_limit, p_offset)
--       players to add entries to events of p_tournament. 'run' access to that tournament: the owner (any tournament) or its active
--       organizer; scorers are refused. Returns {items: [{id, displayName}], hasMore} and NOTHING else: no naming flag, no age status,
--       no slug, no district, no contact field, no private field (the "On the site" badge comes from admin_competition_event_naming,
--       for players already entered in this tournament). Merged players and suppressed ids or names are always left out.
--       The OWNER finds every player whose matching name holds the query (as on the Players screen).
--       An ORGANIZER finds a player (D-012: protected players are not listed to people who never dealt with them):
--         * by the FULL name typed exactly (the matching copy equals the query), anyone: they already know the name; or
--         * by part of the name, only a player the public site already names (app.competition_named_players: adult_confirmed and
--           public), or a player already entered in an event of THIS tournament, or a new player added for it
--           (provisional_tournament_id). Protected archive players never turn up from a few letters.
--       Every organizer search writes one audit row (the tournament id, the query LENGTH and the page offset: never the query) and an
--       organizer gets at most 120 searches in 10 minutes (counted from those rows), then a plain "wait a little" refusal.
--       The query is 3 to 80 characters; at most 25 rows a page, offset at most 500.
--   public.admin_competition_create_player(p_actor, p_tournament, p_record, p_reason)
--       a NEW player for an organizer who found no match: provisional, hidden, noindex, opaque slug and age 'unknown' (the column
--       defaults, D-012), created_source 'admin', provisional_tournament_id = p_tournament. Record: {name, nameNormalized} (the server
--       computes the matching copy with the parser's normalizeName, as 0020 does). Refused when the name is on the removal list or an
--       unmerged player already has exactly that matching name, with ONE neutral sentence for both ("this name cannot be added here"),
--       so an organizer cannot tell a removal request or a hidden player from an ordinary existing one. Also refused when the name
--       holds contact details (an @ or 7 or more digits). It never edits an existing player.
--       'run' access. Audited with ids and field names only (never the name).
--   public.admin_competition_event_naming(p_actor, p_event)
--       (read) for every player entered in one event (any entry status): {playerId, named}, named = app.competition_named_players.
--       Booleans only. 'run' access to the event's tournament, so an organizer's "On the site" badges tell the truth instead of reading
--       everyone as protected. The junior rule (event or tournament) is applied by the admin service on top, as for the owner.
--
-- What visitors see does not change. Nothing is switched on: organizers still need the database switch (organizer_roles_enabled, off)
-- and ORGANIZER_ACCOUNTS_ENABLED exactly 'true'.
-- House rules (0001-0023): SECURITY DEFINER with search_path = '', the access check FIRST, app.audit with ids and field names only,
-- errors start 'INVALID:', 'NOT_FOUND:', 'STALE:' or 'FORBIDDEN:', EXECUTE for service_role only. Apply after 0023, then run
-- supabase/checks/0024_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- admin_competition_search_players
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_competition_search_players(p_actor text, p_tournament uuid, p_query text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q text;
  v_rows jsonb;
  v_count integer;
  v_owner boolean;
begin
  perform app.require_competition_access(p_actor, p_tournament, 'run');
  if not exists (select 1 from public.tournaments t where t.id = p_tournament) then
    raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002';
  end if;
  v_q := lower(btrim(coalesce(p_query, '')));
  if length(v_q) < 3 or length(v_q) > 80 or v_q ~ '[[:cntrl:]]' then
    raise exception 'INVALID: type at least 3 letters of the name' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 25 then raise exception 'INVALID: ask for 1 to 25 players at a time' using errcode = '22023'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 500 then raise exception 'INVALID: the page is out of range' using errcode = '22023'; end if;
  -- the access check passed, so the actor is a uuid with a profile
  v_owner := exists (select 1 from public.profiles pr where pr.id = p_actor::uuid and pr.role = 'owner');
  if not v_owner then
    -- at most 120 organizer searches in 10 minutes, counted from the audit rows this function writes
    if (select count(*) from public.audit_log a
         where a.actor = p_actor and a.action = 'competition_search_players' and a.ts > now() - interval '10 minutes') >= 120 then
      raise exception 'INVALID: too many searches in a few minutes; wait a little and try again' using errcode = '22023';
    end if;
    perform app.audit(p_actor, 'competition_search_players', 'tournaments', p_tournament::text,
      jsonb_build_object('query_length', length(v_q), 'offset', p_offset), 'organizer player search');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'displayName', x.display_name) order by x.display_name, x.id), '[]'::jsonb), count(*)
    into v_rows, v_count
  from (
    select p.id, p.display_name
    from public.players p
    where p.merged_into is null
      and position(v_q in p.name_normalized) > 0
      and not exists (select 1 from app.suppressed_keys k where (k.kind = 'player_id' and k.value = p.id::text) or (k.kind = 'name_normalized' and k.value = p.name_normalized))
      and (
        v_owner
        or p.name_normalized = v_q
        or exists (select 1 from app.competition_named_players np where np.id = p.id)
        or p.provisional_tournament_id = p_tournament
        or exists (select 1 from public.event_entries en join public.tournament_events e on e.id = en.event_id
                    where e.tournament_id = p_tournament and (en.player1_id = p.id or en.player2_id = p.id))
      )
    order by p.display_name, p.id
    limit p_limit + 1 offset p_offset
  ) x;
  -- one row more than asked for says whether there is a next page; it is never returned
  if v_count > p_limit then
    v_rows := v_rows - p_limit;
  end if;
  return jsonb_build_object('items', v_rows, 'hasMore', v_count > p_limit);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_competition_create_player
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_competition_create_player(p_actor text, p_tournament uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_norm text;
  v_id uuid;
begin
  perform app.require_competition_access(p_actor, p_tournament, 'run');
  perform app.competition_reason(p_reason);
  if not exists (select 1 from public.tournaments t where t.id = p_tournament) then
    raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002';
  end if;
  perform app.competition_keys(p_record, array['name', 'nameNormalized'], 'new player');
  if jsonb_typeof(p_record -> 'name') <> 'string' or jsonb_typeof(p_record -> 'nameNormalized') <> 'string' then
    raise exception 'INVALID: a new player needs a name of 2 to 80 characters' using errcode = '22023';
  end if;
  v_name := p_record ->> 'name';
  v_norm := p_record ->> 'nameNormalized';
  if not app.registration_line_ok(v_name, 80) or length(btrim(v_norm)) = 0 or length(v_norm) > 120 or v_norm <> lower(btrim(v_norm)) or v_norm ~ '[[:cntrl:]]' then
    raise exception 'INVALID: a new player needs a name of 2 to 80 characters' using errcode = '22023';
  end if;
  -- a name only: no contact details (an @ or a run of 7 or more digits), the same rule as the organizer labels of 0019
  if position('@' in v_name) > 0 or length(regexp_replace(v_name, '[^0-9]', '', 'g')) >= 7 then
    raise exception 'INVALID: type the player''s name only, no phone number or email' using errcode = '22023';
  end if;
  -- one neutral sentence for a removal request, a hidden (suppressed) player and an ordinary existing one: the organizer must not be
  -- able to tell them apart
  if app.is_suppressed('name_normalized', v_norm)
     or exists (select 1 from public.players p where p.name_normalized = v_norm and p.merged_into is null) then
    raise exception 'INVALID: this name cannot be added here; choose the player from the list, or ask the owner' using errcode = '22023';
  end if;
  -- D-012: provisional, hidden, noindex, opaque slug and age 'unknown' (the column defaults); never an age from the organizer
  insert into public.players (display_name, name_normalized, identity_tier, created_source, provisional_tournament_id)
    values (v_name, v_norm, case when v_norm ~ ' ' then 'multi_token' else 'single_token' end, 'admin', p_tournament)
    returning id into v_id;
  perform app.audit(p_actor, 'competition_create_player', 'players', v_id::text,
    jsonb_build_object('tournament_id', p_tournament, 'fields', jsonb_build_array('display_name', 'name_normalized'), 'provisional', true), p_reason);
  return jsonb_build_object('id', v_id, 'displayName', v_name, 'named', false);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_competition_event_naming
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_competition_event_naming(p_actor text, p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_competition_access(p_actor, app.competition_tournament_of('event', p_event), 'run');
  if not exists (select 1 from public.tournament_events e where e.id = p_event) then
    raise exception 'NOT_FOUND: event not found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('playerId', x.pid, 'named', exists (select 1 from app.competition_named_players np where np.id = x.pid)) order by x.pid)
    from (
      select distinct u.pid
      from public.event_entries en
      cross join lateral unnest(array[en.player1_id, en.player2_id]) as u(pid)
      where en.event_id = p_event and u.pid is not null
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges: service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function public.admin_competition_search_players(text, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_competition_create_player(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_competition_event_naming(text, uuid) from public, anon, authenticated;

grant execute on function public.admin_competition_search_players(text, uuid, text, integer, integer) to service_role;
grant execute on function public.admin_competition_create_player(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_competition_event_naming(text, uuid) to service_role;
