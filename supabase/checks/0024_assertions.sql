-- 0024_assertions.sql - self-check for migration 0024_organizer_search.sql (an organizer's player search, a new provisional player, and
-- the "On the site" preview for one event). Run it after applying 0001..0024. It changes nothing: the behaviour tests run in a
-- sub-transaction that is rolled back, with FICTIONAL people and tournaments. It raises an exception naming the first broken rule and
-- ends with one row `ok`.

create function pg_temp.expect_code(p_sql text, p_code text, p_label text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_code || ':%' then return; end if;
    raise exception 'ASSERT FAIL: % failed with the wrong error: %', p_label, sqlerrm;
  end;
  raise exception 'ASSERT FAIL: expected an error but the statement succeeded: %', p_label;
end
$f$;

-- the error text a statement raises (null when it succeeds), to compare two refusals
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    return sqlerrm;
  end;
  return null;
end
$f$;

create function pg_temp.expect_fail(p_sql text, p_label text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'ASSERT FAIL: expected an error but the statement succeeded: %', p_label;
end
$f$;

-- ------------------------------------------------------------------------------------------------------------------
-- A. structure
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  fn text;
  rpcs text[] := array['public.admin_competition_search_players(text,uuid,text,integer,integer)', 'public.admin_competition_create_player(text,uuid,jsonb,text)',
    'public.admin_competition_event_naming(text,uuid)'];
begin
  foreach fn in array rpcs loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
    -- the per-tournament check is the first statement, at the organizer level ('run': scorers are refused)
    if (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure) !~ '\mbegin\s+perform app\.require_competition_access\(p_actor, [^;]*''run''\);' then
      raise exception 'ASSERT FAIL: % does not call app.require_competition_access(..., ''run'') first', fn;
    end if;
    if (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure) ~ 'require_owner' then raise exception 'ASSERT FAIL: % is owner only', fn; end if;
  end loop;
  -- the search returns only id and display name: no naming flag (D-012: it would tell an organizer who is an adult) and no other column
  if (select pr.prosrc from pg_proc pr where pr.oid = 'public.admin_competition_search_players(text,uuid,text,integer,integer)'::regprocedure)
     ~ '(age_status|age_signal|slug|district|academy|bio|photo_path|instagram|disambiguator|age_confirmed)' then
    raise exception 'ASSERT FAIL: the organizer search reads a player field it must not return';
  end if;
  if (select pr.prosrc from pg_proc pr where pr.oid = 'public.admin_competition_search_players(text,uuid,text,integer,integer)'::regprocedure) ~ '''named''' then
    raise exception 'ASSERT FAIL: the organizer search returns a naming flag';
  end if;
  -- no view in api calls these
  if exists (select 1 from pg_views where schemaname = 'api' and definition ~ 'admin_competition_(search_players|create_player|event_naming)') then
    raise exception 'ASSERT FAIL: an api view calls an organizer RPC';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  o1 text := 'c0240000-0000-4000-8000-0000000000e1';   -- organizer of t1
  s1 text := 'c0240000-0000-4000-8000-0000000000e2';   -- scorer of t1
  o2 text := 'c0240000-0000-4000-8000-0000000000e3';   -- organizer of t2 only
  t1 uuid := 'c0240000-0000-4000-8000-000000000001';
  t2 uuid := 'c0240000-0000-4000-8000-000000000002';
  pa uuid := 'c0240000-0000-4000-8000-0000000000b1';   -- adult_confirmed, public: named
  pb uuid := 'c0240000-0000-4000-8000-0000000000b2';   -- unknown age: protected (an archive player nobody entered yet)
  pe uuid := 'c0240000-0000-4000-8000-0000000000b5';   -- minor_confirmed: protected, never found from a few letters
  pc uuid := 'c0240000-0000-4000-8000-0000000000b3';   -- suppressed by id: never found
  pd uuid := 'c0240000-0000-4000-8000-0000000000b4';   -- merged into pa: never found
  d jsonb := app.competition_default_ruleset();
  e1 uuid;
  e2 uuid;
  j jsonb;
  k text;
  v_new uuid;
  v_audit bigint;
  v_refusal text;
  r text := 'fake 0024 check';
begin
  begin
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility) values
      (t1, 'fake-srch-open-2026', 'Fake Srch Open', 'fake srch open', 2026, 'tamil_nadu', 'published', 'public'),
      (t2, 'fake-srch-other-2026', 'Fake Srch Other', 'fake srch other', 2026, 'tamil_nadu', 'published', 'public');
    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (pa, 'Fake Srch Alpha', 'fake srch alpha', 'multi_token'), (pb, 'Fake Srch Beta', 'fake srch beta', 'multi_token'),
      (pc, 'Fake Srch Gamma', 'fake srch gamma', 'multi_token'), (pd, 'Fake Srch Delta', 'fake srch delta', 'multi_token'),
      (pe, 'Fake Srch Junior', 'fake srch junior', 'multi_token');
    insert into public.suppression (kind, value, reason, created_by) values ('player_id', pc::text, 'fake takedown', 'fake-admin'),
      ('name_normalized', 'fake srch kilo', 'fake removal request', 'fake-admin');
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pa], 'adult_confirmed', 'fake admin review', 'test');
    perform public.admin_update_player(v_actor, pa, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_set_age_status(v_actor, array[pe], 'minor_confirmed', 'fake admin review', 'test');
    perform public.admin_create_account(v_actor, o1::uuid, jsonb_build_object('role', 'organizer', 'displayName', 'Fake Org One', 'tournamentIds', jsonb_build_array(t1)), r);
    perform public.admin_create_account(v_actor, s1::uuid, jsonb_build_object('role', 'scorer', 'displayName', 'Fake Scorer One', 'tournamentIds', jsonb_build_array(t1)), r);
    perform public.admin_create_account(v_actor, o2::uuid, jsonb_build_object('role', 'organizer', 'displayName', 'Fake Org Two', 'tournamentIds', jsonb_build_array(t2)), r);
    execute 'reset role';
    update public.players set merged_into = pa where id = pd;

    -- ---------------------------------------------------------------- the switch off: only the owner
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, o1, t1), 'FORBIDDEN', 'an organizer searching while the switch is off');
    j := public.admin_set_organizer_access(v_actor, true, r);

    -- ---------------------------------------------------------------- search: assigned organizer and owner allowed; others refused
    -- an organizer, a few letters: only the player the public site already names (protected archive players stay out)
    j := public.admin_competition_search_players(o1, t1, 'Fake Srch', 10, 0);
    if jsonb_array_length(j -> 'items') <> 1 or j #>> '{items,0,id}' <> pa::text or (j ->> 'hasMore')::boolean then
      raise exception 'ASSERT FAIL: an organizer''s partial search did not find exactly the named player: %', j;
    end if;
    -- only the two fields, for every row
    for k in select distinct jsonb_object_keys(x) from jsonb_array_elements(j -> 'items') x loop
      if k not in ('id', 'displayName') then raise exception 'ASSERT FAIL: the organizer search returned the field %', k; end if;
    end loop;
    if (select count(*) from jsonb_object_keys(j)) <> 2 then raise exception 'ASSERT FAIL: the search answer has extra keys: %', j; end if;
    -- the full name typed exactly finds a protected player (the organizer already knows the name); a part of it does not
    j := public.admin_competition_search_players(o1, t1, 'fake srch beta', 10, 0);
    if jsonb_array_length(j -> 'items') <> 1 or j #>> '{items,0,id}' <> pb::text then raise exception 'ASSERT FAIL: the exact name did not find the protected player: %', j; end if;
    j := public.admin_competition_search_players(o1, t1, 'srch bet', 10, 0);
    if jsonb_array_length(j -> 'items') <> 0 then raise exception 'ASSERT FAIL: part of a protected player''s name found them: %', j; end if;
    j := public.admin_competition_search_players(o1, t1, 'srch junior', 10, 0);
    if jsonb_array_length(j -> 'items') <> 0 then raise exception 'ASSERT FAIL: part of a minor''s name found them: %', j; end if;
    -- suppressed (by id or by name) and merged players: never, not even by the exact name
    j := public.admin_competition_search_players(o1, t1, 'fake srch gamma', 10, 0);
    if jsonb_array_length(j -> 'items') <> 0 then raise exception 'ASSERT FAIL: a suppressed player was found by the exact name'; end if;
    j := public.admin_competition_search_players(o1, t1, 'fake srch delta', 10, 0);
    if jsonb_array_length(j -> 'items') <> 0 then raise exception 'ASSERT FAIL: a merged player was found by the exact name'; end if;
    -- the owner is unchanged: any tournament, every unsuppressed unmerged player
    j := public.admin_competition_search_players(v_actor, t2, 'fake srch', 25, 0);
    if jsonb_array_length(j -> 'items') <> 3 or exists (select 1 from jsonb_array_elements(j -> 'items') x where x ->> 'id' in (pc::text, pd::text)) then
      raise exception 'ASSERT FAIL: the owner search is wrong: %', j;
    end if;
    for k in select distinct jsonb_object_keys(x) from jsonb_array_elements(j -> 'items') x loop
      if k not in ('id', 'displayName') then raise exception 'ASSERT FAIL: the owner search returned the field %', k; end if;
    end loop;
    -- paging: one at a time says there is more
    j := public.admin_competition_search_players(v_actor, t1, 'fake srch', 1, 0);
    if jsonb_array_length(j -> 'items') <> 1 or not (j ->> 'hasMore')::boolean then raise exception 'ASSERT FAIL: paging is wrong: %', j; end if;
    j := public.admin_competition_search_players(v_actor, t1, 'fake srch', 1, 2);
    if jsonb_array_length(j -> 'items') <> 1 or (j ->> 'hasMore')::boolean then raise exception 'ASSERT FAIL: the last page is wrong: %', j; end if;
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, v_actor, gen_random_uuid()), 'NOT_FOUND', 'the owner, an unknown tournament');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, o1, t2), 'FORBIDDEN', 'an organizer searching for an unassigned tournament');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, o1, gen_random_uuid()), 'FORBIDDEN', 'an organizer, an unknown tournament (no hint)');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, s1, t1), 'FORBIDDEN', 'a scorer searching');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, o2, t1), 'FORBIDDEN', 'another tournament''s organizer searching');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players('fake-admin', %L, 'fake srch', 10, 0)$q$, t1), 'FORBIDDEN', 'a non-uuid actor');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fa', 10, 0)$q$, o1, t1), 'INVALID', 'a two-letter query');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 26, 0)$q$, o1, t1), 'INVALID', 'too many rows');
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 501)$q$, o1, t1), 'INVALID', 'too far a page');

    -- ---------------------------------------------------------------- a new provisional player
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Echo", "nameNormalized": "fake srch echo"}', %L)$q$, s1, t1, r), 'FORBIDDEN', 'a scorer adding a player');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Echo", "nameNormalized": "fake srch echo"}', %L)$q$, o2, t1, r), 'FORBIDDEN', 'another tournament''s organizer adding a player');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Echo", "nameNormalized": "fake srch echo"}', %L)$q$, o1, t2, r), 'FORBIDDEN', 'an organizer adding a player to an unassigned tournament');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Echo", "nameNormalized": "fake srch echo"}', '')$q$, o1, t1), 'INVALID', 'no reason');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Echo", "nameNormalized": "fake srch echo", "ageStatus": "adult_confirmed"}', %L)$q$, o1, t1, r), 'INVALID', 'an organizer sending an age');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "X", "nameNormalized": "x"}', %L)$q$, o1, t1, r), 'INVALID', 'a one-letter name');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Beta", "nameNormalized": "fake srch beta"}', %L)$q$, o1, t1, r), 'INVALID', 'a name that already exists');
    -- one neutral sentence: an existing player, a player hidden by a removal (suppressed id) and a name on the removal list read the same
    v_refusal := pg_temp.error_of(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Beta", "nameNormalized": "fake srch beta"}', %L)$q$, o1, t1, r));
    if v_refusal is null or v_refusal ~* 'removal|exists|suppress|hidden' then raise exception 'ASSERT FAIL: the existing-name refusal is not neutral: %', v_refusal; end if;
    if pg_temp.error_of(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Gamma", "nameNormalized": "fake srch gamma"}', %L)$q$, o1, t1, r)) is distinct from v_refusal
       or pg_temp.error_of(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Kilo", "nameNormalized": "fake srch kilo"}', %L)$q$, o1, t1, r)) is distinct from v_refusal then
      raise exception 'ASSERT FAIL: an organizer can tell a removal request or a hidden player from an ordinary existing name';
    end if;
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake 910000000000", "nameNormalized": "fake 910000000000"}', %L)$q$, o1, t1, r), 'INVALID', 'a phone number as a name');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "fake@example.test", "nameNormalized": "fake example test"}', %L)$q$, o1, t1, r), 'INVALID', 'an email as a name');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Lima", "nameNormalized": "FAKE SRCH LIMA"}', %L)$q$, o1, t1, r), 'INVALID', 'a matching name that is not lower case');
    j := public.admin_competition_create_player(o1, t1, '{"name": "Fake Srch Echo", "nameNormalized": "fake srch echo"}', r);
    v_new := (j ->> 'id')::uuid;
    if (j ->> 'named')::boolean or j ->> 'displayName' <> 'Fake Srch Echo' or (select count(*) from jsonb_object_keys(j)) <> 3 then raise exception 'ASSERT FAIL: the new player answer is wrong: %', j; end if;
    if not exists (select 1 from public.players p where p.id = v_new and p.is_provisional and p.visibility = 'hidden' and p.noindex and p.age_status = 'unknown'
                   and p.slug_kind = 'opaque' and p.created_source = 'admin' and p.provisional_tournament_id = t1) then
      raise exception 'ASSERT FAIL: the new player is not provisional, hidden, noindex, unknown age and scoped to the tournament';
    end if;
    -- the owner adds one the same way, to any tournament
    j := public.admin_competition_create_player(v_actor, t2, '{"name": "Fake Srch Foxtrot", "nameNormalized": "fake srch foxtrot"}', r);

    -- ---------------------------------------------------------------- the event preview: booleans only, run access
    e1 := (public.admin_save_event(o1, null, jsonb_build_object('tournamentId', t1, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 8, 'status', 'open'), r) ->> 'id')::uuid;
    e2 := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t2, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 8, 'status', 'open'), r) ->> 'id')::uuid;
    perform public.admin_add_entry(o1, e1, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'confirmed'), r);
    perform public.admin_add_entry(o1, e1, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed'), r);
    perform public.admin_add_entry(o1, e1, jsonb_build_object('players', jsonb_build_array(v_new), 'seed', null, 'status', 'pending'), r);
    -- once entered in this tournament (or added for it), a protected player turns up from a few letters for its organizer only
    j := public.admin_competition_search_players(o1, t1, 'fake srch', 25, 0);
    if (select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(j -> 'items') x) is distinct from (select array_agg(v order by v) from unnest(array[pa::text, pb::text, v_new::text]) v) then
      raise exception 'ASSERT FAIL: the organizer does not find exactly the named player and the players of their own tournament: %', j;
    end if;
    j := public.admin_competition_search_players(o2, t2, 'fake srch', 25, 0);
    if (select array_agg(x ->> 'displayName' order by x ->> 'displayName') from jsonb_array_elements(j -> 'items') x) is distinct from array['Fake Srch Alpha', 'Fake Srch Foxtrot'] then
      raise exception 'ASSERT FAIL: another tournament''s organizer finds this tournament''s protected players: %', j;
    end if;
    j := public.admin_competition_event_naming(o1, e1);
    if jsonb_array_length(j) <> 3 then raise exception 'ASSERT FAIL: the preview does not cover every entered player: %', j; end if;
    for k in select distinct jsonb_object_keys(x) from jsonb_array_elements(j) x loop
      if k not in ('playerId', 'named') then raise exception 'ASSERT FAIL: the preview returned the field %', k; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(j) x where (x ->> 'named')::boolean) <> 1
       or not exists (select 1 from jsonb_array_elements(j) x where x ->> 'playerId' = pa::text and (x ->> 'named')::boolean) then
      raise exception 'ASSERT FAIL: the preview names the wrong players: %', j;
    end if;
    if public.admin_competition_event_naming(v_actor, e1) is distinct from j then raise exception 'ASSERT FAIL: the owner and the organizer see a different preview'; end if;
    if jsonb_array_length(public.admin_competition_event_naming(v_actor, e2)) <> 0 then raise exception 'ASSERT FAIL: an empty event has a preview'; end if;
    perform pg_temp.expect_code(format($q$select public.admin_competition_event_naming(%L, %L)$q$, s1, e1), 'FORBIDDEN', 'a scorer asking for the preview');
    perform pg_temp.expect_code(format($q$select public.admin_competition_event_naming(%L, %L)$q$, o2, e1), 'FORBIDDEN', 'another tournament''s organizer asking for the preview');
    perform pg_temp.expect_code(format($q$select public.admin_competition_event_naming(%L, %L)$q$, o1, e2), 'FORBIDDEN', 'an organizer asking about an unassigned event');
    perform pg_temp.expect_code(format($q$select public.admin_competition_event_naming(%L, %L)$q$, o1, gen_random_uuid()), 'FORBIDDEN', 'an organizer, an unknown event (no hint)');
    perform pg_temp.expect_code(format($q$select public.admin_competition_event_naming(%L, %L)$q$, v_actor, gen_random_uuid()), 'NOT_FOUND', 'the owner, an unknown event');
    -- the owner-only naming RPC stays owner only
    perform pg_temp.expect_code(format($q$select public.admin_competition_rankable_players(%L, array[%L]::uuid[])$q$, o1, pa), 'FORBIDDEN', 'an organizer asking the owner-only naming RPC');

    -- ---------------------------------------------------------------- organizer searches are audited (no query) and limited
    execute 'reset role';
    if (select count(*) from public.audit_log where action = 'competition_search_players' and actor = o1) < 5 then
      raise exception 'ASSERT FAIL: an organizer search was not audited';
    end if;
    if exists (select 1 from public.audit_log where action = 'competition_search_players' and (actor = v_actor or diff::text ~* 'srch|beta|junior'
               or entity_id is distinct from t1::text and actor = o1)) then
      raise exception 'ASSERT FAIL: a search audit row holds the query, or the owner''s searches were audited';
    end if;
    if exists (select 1 from public.audit_log where action = 'competition_search_players' and (select array_agg(dk.key order by dk.key) from jsonb_object_keys(diff) as dk(key)) is distinct from array['offset', 'query_length']) then
      raise exception 'ASSERT FAIL: a search audit row holds more than the query length and the offset';
    end if;
    insert into public.audit_log (actor, action, entity, entity_id, diff, reason)
      select o1, 'competition_search_players', 'tournaments', t1::text, '{"query_length": 9, "offset": 0}'::jsonb, 'fake'
        from generate_series(1, 120);
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, o1, t1), 'INVALID', 'an organizer past the search limit');
    j := public.admin_competition_search_players(o2, t2, 'fake srch', 10, 0);
    j := public.admin_competition_search_players(v_actor, t1, 'fake srch', 10, 0);

    -- ---------------------------------------------------------------- revoking and the switch take effect at once
    j := public.admin_set_organizer_access(v_actor, false, r);
    perform pg_temp.expect_code(format($q$select public.admin_competition_event_naming(%L, %L)$q$, o1, e1), 'FORBIDDEN', 'an organizer after the switch went off');
    perform pg_temp.expect_code(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Golf", "nameNormalized": "fake srch golf"}', %L)$q$, o1, t1, r), 'FORBIDDEN', 'an organizer adding a player after the switch went off');
    j := public.admin_competition_search_players(v_actor, t1, 'fake srch', 10, 0);
    execute 'reset role';

    -- ---------------------------------------------------------------- audit: ids and field names only; anon: nothing
    select count(*) into v_audit from public.audit_log where action = 'competition_create_player';
    if v_audit <> 2 or (select count(*) from public.audit_log where action = 'competition_create_player' and actor = o1) <> 1 then
      raise exception 'ASSERT FAIL: a new player was not audited under its own actor';
    end if;
    if exists (select 1 from public.audit_log where action = 'competition_create_player' and diff::text ~* 'fake srch|@') then
      raise exception 'ASSERT FAIL: a new-player audit row holds a name';
    end if;
    execute 'set local role anon';
    perform pg_temp.expect_fail(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, v_actor, t1), 'anon searching');
    perform pg_temp.expect_fail(format($q$select public.admin_competition_create_player(%L, %L, '{"name": "Fake Srch Hotel", "nameNormalized": "fake srch hotel"}', 'r')$q$, v_actor, t1), 'anon adding a player');
    perform pg_temp.expect_fail(format($q$select public.admin_competition_event_naming(%L, %L)$q$, v_actor, e1), 'anon asking for the preview');
    execute 'reset role';
    execute 'set local role authenticated';
    perform pg_temp.expect_fail(format($q$select public.admin_competition_search_players(%L, %L, 'fake srch', 10, 0)$q$, o1, t1), 'authenticated searching');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0024_organizer_search assertions passed' as result;
