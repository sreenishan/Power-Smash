-- 0018_assertions.sql - self-check for migration 0018_competition_admin.sql (entry status and seed, venues, courts, the approved
-- ranking points table). Run it after applying 0001..0018. It changes nothing: the behaviour tests run in a sub-transaction that is
-- rolled back, with a FICTIONAL tournament and players. It raises an exception naming the first broken rule and ends with one row `ok`.

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
  rpcs text[] := array['public.admin_set_entry(text,uuid,jsonb,text)', 'public.admin_save_venue(text,uuid,jsonb,text)',
    'public.admin_save_court(text,uuid,jsonb,text)', 'public.admin_set_ranking_points(text,jsonb,text)'];
  -- the 10 RPCs 0019 (D-108) scopes to an assigned tournament; no other RPC may use app.require_competition_access
  scoped text[] := array['public.admin_save_event(text,uuid,jsonb,text)', 'public.admin_add_entry(text,uuid,jsonb,text)',
    'public.admin_withdraw_entry(text,uuid,text)', 'public.admin_set_entry(text,uuid,jsonb,text)', 'public.admin_save_draw(text,uuid,jsonb,text)',
    'public.admin_publish_draw(text,uuid,text)', 'public.admin_save_match(text,uuid,jsonb,integer,text)',
    'public.admin_record_result(text,uuid,jsonb,integer,text)', 'public.admin_confirm_result(text,uuid,integer,text)',
    'public.admin_save_court(text,uuid,jsonb,text)'];
  check_re text;
  fn text;
  c text;
begin
  foreach fn in array rpcs loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
    -- only the RPCs 0019 scopes may use the per-tournament check; every other one keeps exactly app.require_owner(p_actor)
    check_re := case when fn = any (scoped) then 'perform app\.require_(owner\(p_actor\);|competition_access\(p_actor, )'
                     else 'perform app\.require_owner\(p_actor\);' end;
    if regexp_instr((select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure), check_re) = 0
       or regexp_instr((select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure), check_re)
          > position('perform app.competition_reason' in (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure))
       or (not fn = any (scoped) and position('require_competition_access' in (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure)) > 0) then
      raise exception 'ASSERT FAIL: % does not call the right access check first (owner only, or one of the 10 RPCs 0019 scopes)', fn;
    end if;
  end loop;
  -- the read RPC (no reason, so require_owner is simply its first statement) and the replaced publish RPCs
  foreach fn in array array['public.admin_competition_rankable_players(text,uuid[])', 'public.admin_publish_draw(text,uuid,text)',
                            'public.admin_publish_ranking_snapshot(text,uuid,text)'] loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: the privileges of % are wrong', fn;
    end if;
    if (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure) !~ (case when fn = any (scoped)
         then '\mbegin\s+perform app\.require_(owner\(p_actor\);|competition_access\(p_actor, )'
         else '\mbegin\s+perform app\.require_owner\(p_actor\);' end) then
      raise exception 'ASSERT FAIL: % does not call the right access check first (owner only, or one of the 10 RPCs 0019 scopes)', fn;
    end if;
  end loop;
  if position('competition_named_players' in pg_get_viewdef('api.public_competition_rankings'::regclass)) = 0
     or position('rank()' in pg_get_viewdef('api.public_competition_rankings'::regclass)) = 0 then
    raise exception 'ASSERT FAIL: the public ranking view does not renumber its named rows';
  end if;
  -- the competition naming rule: an internal view nobody in the API can read; the faces, the rankings and the rankable RPC use it
  if not exists (select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'app' and cl.relname = 'competition_named_players' and cl.relkind = 'v') then
    raise exception 'ASSERT FAIL: app.competition_named_players is missing';
  end if;
  foreach c in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(c, 'app.competition_named_players', 'SELECT') or has_table_privilege(c, 'app.competition_entry_faces', 'SELECT') then
      raise exception 'ASSERT FAIL: % can read the internal competition naming views', c;
    end if;
  end loop;
  if position('competition_named_players' in pg_get_viewdef('app.competition_entry_faces'::regclass)) = 0
     or position('competition_named_players' in (select pr.prosrc from pg_proc pr where pr.oid = 'public.admin_competition_rankable_players(text,uuid[])'::regprocedure)) = 0
     or position('competition_named_players' in (select pr.prosrc from pg_proc pr where pr.oid = 'public.admin_publish_ranking_snapshot(text,uuid,text)'::regprocedure)) = 0 then
    raise exception 'ASSERT FAIL: a competition naming decision does not use app.competition_named_players';
  end if;
  -- the naming rule does NOT need a published archive match (that is app.eligible_players, the archive rule): tested by behaviour
  -- below (pf, an adult with no video, is in the named set; the set is compared to the expected ids exactly)
  -- a school_college tournament level is junior even without the minor-signal flag (nothing sets the flag from the level)
  if position('school_college' in pg_get_viewdef('app.competition_public_events'::regclass)) = 0 then
    raise exception 'ASSERT FAIL: app.competition_public_events does not treat a school_college tournament as junior';
  end if;
  -- api.public_competition_events: the 0017 columns in order, then is_junior last, boolean
  if (select jsonb_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = 'public_competition_events')
     is distinct from '["id", "tournament_id", "category", "age_group", "format", "status", "capacity", "ruleset", "is_junior"]'::jsonb
     or (select data_type from information_schema.columns where table_schema = 'api' and table_name = 'public_competition_events' and column_name = 'is_junior') <> 'boolean' then
    raise exception 'ASSERT FAIL: api.public_competition_events does not end with is_junior';
  end if;
  if not coalesce((select 'security_barrier=true' = any (cl.reloptions) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = 'public_competition_events'), false)
     or not has_table_privilege('anon', 'api.public_competition_events', 'SELECT') or has_table_privilege('anon', 'api.public_competition_events', 'INSERT') then
    raise exception 'ASSERT FAIL: api.public_competition_events lost its barrier or grants';
  end if;
  fn := 'app.competition_points_table_problem(jsonb)';
  if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'ASSERT FAIL: an API role can run %', fn;
  end if;
  foreach c in array array['ranking_points_table', 'ranking_points_approved_at', 'ranking_points_approved_by'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'competition_settings' and column_name = c) then
      raise exception 'ASSERT FAIL: competition_settings.% is missing', c;
    end if;
  end loop;
  -- the settings table stays private and read-only for service_role (writes only through the RPCs)
  if has_table_privilege('anon', 'public.competition_settings', 'SELECT') or has_table_privilege('service_role', 'public.competition_settings', 'UPDATE') then
    raise exception 'ASSERT FAIL: competition_settings privileges changed';
  end if;
  -- no api view reads the settings (the points table is owner data until a ranking is published)
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class vw on vw.oid = r.ev_class join pg_namespace n on n.oid = vw.relnamespace
             where n.nspname = 'api' and d.refobjid = 'public.competition_settings'::regclass and d.refobjsubid in (
               select a.attnum from pg_attribute a where a.attrelid = 'public.competition_settings'::regclass and a.attname like 'ranking_points%')) then
    raise exception 'ASSERT FAIL: an api view reads the ranking points table';
  end if;
  -- the shape rule (pure)
  if app.competition_points_table_problem('{"label": "Fake table", "levels": {"district": {"W": 100, "F": 60}}, "windowDays": 364, "bestN": 4}') is not null then
    raise exception 'ASSERT FAIL: a good points table is refused';
  end if;
  if app.competition_points_table_problem('{"label": "Fake table", "levels": {"galaxy": {"W": 100}}, "windowDays": 364, "bestN": 4}') is null
     or app.competition_points_table_problem('{"label": "Fake table", "levels": {"district": {"W": 0}}, "windowDays": 364, "bestN": 4}') is null
     or app.competition_points_table_problem('{"label": "Fake table", "levels": {"district": {"Gold": 5}}, "windowDays": 364, "bestN": 4}') is null
     or app.competition_points_table_problem('{"label": "Fake table", "levels": {"district": {"W": 5.5}}, "windowDays": 364, "bestN": 4}') is null
     or app.competition_points_table_problem('{"label": "Fake table", "levels": {"district": {"W": 5}}, "windowDays": 0, "bestN": 4}') is null
     or app.competition_points_table_problem('{"label": "Fake table", "levels": {"district": {"W": 5}}, "windowDays": 364, "bestN": 4, "phone": "x"}') is null then
    raise exception 'ASSERT FAIL: a bad points table is accepted';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  t1 uuid := 'c0180000-0000-4000-8000-000000000001';
  t2 uuid := 'c0180000-0000-4000-8000-000000000002';
  pa uuid := 'c0180000-0000-4000-8000-0000000000b1';
  pb uuid := 'c0180000-0000-4000-8000-0000000000b2';
  pc uuid := 'c0180000-0000-4000-8000-0000000000b3';
  pd uuid := 'c0180000-0000-4000-8000-0000000000b4';  -- adult_confirmed but hidden (private): protected
  pf uuid := 'c0180000-0000-4000-8000-0000000000b6';  -- adult_confirmed, public, not provisional, NO video: named in competitions
  pg uuid := 'c0180000-0000-4000-8000-0000000000b7';  -- minor suspected: protected
  ph uuid := 'c0180000-0000-4000-8000-0000000000b8';  -- adult_confirmed, public, still provisional: protected
  pi uuid := 'c0180000-0000-4000-8000-0000000000b9';  -- adult_confirmed, public, suppressed by player id: protected
  pj uuid := 'c0180000-0000-4000-8000-0000000000ba';  -- adult_confirmed, public, suppressed by name key: protected
  t3 uuid := 'c0180000-0000-4000-8000-000000000003';  -- a public tournament with a minor signal (a school event)
  t4 uuid := 'c0180000-0000-4000-8000-000000000004';  -- a public tournament whose LEVEL is school_college, minor-signal flag false
  e6 uuid;
  m0 uuid := 'c0180000-0000-4000-8000-0000000000a0';
  e3 uuid;
  e4 uuid;
  e5 uuid;
  dr3 uuid;
  slots jsonb;
  k integer;
  v_msg text;
  n integer;
  v text;
  ev2 uuid;
  en_x uuid;
  dr2 uuid;
  rs uuid;
  ids uuid[];
  d jsonb := app.competition_default_ruleset();
  ev uuid;
  en_a uuid;
  en_b uuid;
  en_c uuid;
  dr uuid;
  ve uuid;
  co uuid;
  j jsonb;
begin
  begin
    -- a real owner may already exist (OT-51); set it aside for this rolled-back test only
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility) values
      (t1, 'fake-adm-open-2026', 'Fake Adm Open', 'fake adm open', 2026, 'tamil_nadu', 'published', 'public'),
      (t2, 'fake-adm-other-2026', 'Fake Adm Other', 'fake adm other', 2026, 'tamil_nadu', 'published', 'hidden');
    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (pa, 'Fake Adm Alpha', 'fake adm alpha', 'multi_token'), (pb, 'Fake Adm Beta', 'fake adm beta', 'multi_token'), (pc, 'Fake Adm Gamma', 'fake adm gamma', 'multi_token'),
      (pd, 'Fake Adm Delta', 'fake adm delta', 'multi_token');
    -- pa and pb become eligible adults the usual way (as in 0017_assertions); pd is an adult whose page stays hidden
    insert into public.videos (youtube_id, title_raw, visibility, type) values ('fake-c18', 'FAKE ADM ALPHA vs FAKE ADM BETA | Fake Adm Open 2026', 'public', 'match');
    insert into public.matches (id, video_id, tournament_id, category, round, publish_state) values (m0, 'fake-c18', t1, 'MS', 'F', 'published');
    insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution, link_policy, identity_tier, age_status) values
      (m0, 'A', 1, 'FAKE ADM ALPHA', pa, 'provisional', 'provisional_ok', 'multi_token', 'unknown'),
      (m0, 'B', 1, 'FAKE ADM BETA', pb, 'provisional', 'provisional_ok', 'multi_token', 'unknown');
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pa, pb, pd], 'adult_confirmed', 'fake admin review', 'test');
    perform public.admin_update_player(v_actor, pa, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_update_player(v_actor, pb, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_rename_player(v_actor, pa, 'Fake Adm Alpha', 'fake adm alpha', 'give a named slug', 'fake-adm-alpha');
    perform public.admin_rename_player(v_actor, pb, 'Fake Adm Beta', 'fake adm beta', 'give a named slug', 'fake-adm-beta');
    execute 'reset role';
    if (select count(*) from app.eligible_players where id in (pa, pb)) <> 2 or exists (select 1 from app.eligible_players where id in (pc, pd))
       or (select age_status from public.players where id = pd) <> 'adult_confirmed' then
      raise exception 'ASSERT FAIL: setup: the fictional players are not as planned';
    end if;

    execute 'set local role service_role';
    ev := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 2, 'status', 'open'), 'test') ->> 'id')::uuid;
    en_a := (public.admin_add_entry(v_actor, ev, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'pending'), 'test') ->> 'id')::uuid;
    en_b := (public.admin_add_entry(v_actor, ev, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'pending'), 'test') ->> 'id')::uuid;
    en_c := (public.admin_add_entry(v_actor, ev, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'waitlisted'), 'test') ->> 'id')::uuid;

    -- ---------------------------------------------------------------- admin_set_entry
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', 'r')$q$, v_editor, en_a), 'FORBIDDEN', 'an editor confirming an entry');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', '')$q$, v_actor, en_a), 'INVALID', 'no reason');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "withdrawn", "seed": null}', 'r')$q$, v_actor, en_a), 'INVALID', 'withdrawn through set_entry');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed"}', 'r')$q$, v_actor, en_a), 'INVALID', 'a missing field');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', 'r')$q$, v_actor, gen_random_uuid()), 'NOT_FOUND', 'an unknown entry');
    j := public.admin_set_entry(v_actor, en_a, '{"status": "confirmed", "seed": 1}', 'test');
    if j ->> 'status' <> 'confirmed' or (j ->> 'seed')::integer <> 1 then raise exception 'ASSERT FAIL: set_entry did not confirm: %', j; end if;
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": 1}', 'r')$q$, v_actor, en_b), 'INVALID', 'a seed used twice');
    perform public.admin_set_entry(v_actor, en_b, '{"status": "confirmed", "seed": 2}', 'test');
    -- the capacity (2) is taken: a waitlisted entry cannot move up
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', 'r')$q$, v_actor, en_c), 'INVALID', 'confirming past the capacity');
    -- rejected frees the player: they can be entered again (waitlisted, as the event is full)
    perform public.admin_set_entry(v_actor, en_c, '{"status": "rejected", "seed": null}', 'test');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "pending", "seed": null}', 'r')$q$, v_actor, en_c), 'INVALID', 'reviving a rejected entry');
    perform public.admin_add_entry(v_actor, ev, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'waitlisted'), 'test');

    -- a draft draw holding the entry is removed when the entry changes; a published draw blocks the change
    dr := (public.admin_save_draw(v_actor, ev, jsonb_build_object('seed', 7, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null))), 'test') ->> 'id')::uuid;
    j := public.admin_set_entry(v_actor, en_b, '{"status": "pending", "seed": 2}', 'test');
    if not (j ->> 'draftDrawCleared')::boolean then raise exception 'ASSERT FAIL: the out-of-date draft draw was not reported cleared'; end if;
    execute 'reset role';
    if exists (select 1 from public.draws where event_id = ev) then raise exception 'ASSERT FAIL: the out-of-date draft draw is still there'; end if;
    execute 'set local role service_role';
    perform public.admin_set_entry(v_actor, en_b, '{"status": "confirmed", "seed": 2}', 'test');
    dr := (public.admin_save_draw(v_actor, ev, jsonb_build_object('seed', 7, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null))), 'test') ->> 'id')::uuid;
    perform public.admin_publish_draw(v_actor, dr, 'test');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "pending", "seed": 1}', 'r')$q$, v_actor, en_a), 'INVALID', 'changing an entry in a published draw');
    j := public.admin_set_entry(v_actor, en_a, '{"status": "confirmed", "seed": 1}', 'unchanged');
    if (j ->> 'draftDrawCleared')::boolean then raise exception 'ASSERT FAIL: an unchanged entry reported a change'; end if;

    -- ---------------------------------------------------------------- venues and courts
    perform pg_temp.expect_code(format($q$select public.admin_save_venue(%L, null, '{"name": "X", "city": null}', 'r')$q$, v_actor), 'INVALID', 'a one-letter venue');
    perform pg_temp.expect_code(format($q$select public.admin_save_venue(%L, null, '{"name": "Fake Hall", "city": null, "phone": "910000000000"}', 'r')$q$, v_actor), 'INVALID', 'a venue with a phone field');
    perform pg_temp.expect_code(format($q$select public.admin_save_venue(%L, null, '{"name": "Fake Hall", "city": null}', 'r')$q$, v_editor), 'FORBIDDEN', 'an editor saving a venue');
    ve := (public.admin_save_venue(v_actor, null, '{"name": " Fake Hall ", "city": "Fake City"}', 'test') ->> 'id')::uuid;
    perform public.admin_save_venue(v_actor, ve, '{"name": "Fake Hall Two", "city": null}', 'test');
    perform pg_temp.expect_code(format($q$select public.admin_save_venue(%L, %L, '{"name": "Fake Hall", "city": null}', 'r')$q$, v_actor, gen_random_uuid()), 'NOT_FOUND', 'an unknown venue');
    co := (public.admin_save_court(v_actor, null, jsonb_build_object('tournamentId', t1, 'venueId', ve, 'label', 'Court 1', 'sort', 1), 'test') ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, null, %L::jsonb, 'r')$q$, v_actor, jsonb_build_object('tournamentId', t1, 'venueId', null, 'label', 'Court 1', 'sort', 2)), 'INVALID', 'a duplicate court name');
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, null, %L::jsonb, 'r')$q$, v_actor, jsonb_build_object('tournamentId', gen_random_uuid(), 'venueId', null, 'label', 'Court 9', 'sort', 2)), 'NOT_FOUND', 'an unknown tournament');
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, %L, %L::jsonb, 'r')$q$, v_actor, co, jsonb_build_object('tournamentId', t2, 'venueId', null, 'label', 'Court 1', 'sort', 1)), 'INVALID', 'moving a court to another tournament');
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, null, %L::jsonb, 'r')$q$, v_actor, jsonb_build_object('tournamentId', t1, 'venueId', null, 'label', '', 'sort', 2)), 'INVALID', 'an empty court name');
    perform public.admin_save_court(v_actor, co, jsonb_build_object('tournamentId', t1, 'venueId', null, 'label', 'Court A', 'sort', 3), 'test');
    execute 'reset role';
    if (select label from public.courts where id = co) <> 'Court A' then raise exception 'ASSERT FAIL: the court was not renamed'; end if;

    -- ---------------------------------------------------------------- the ranking points table
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_set_ranking_points(%L, '{"label": "Fake table", "levels": {"galaxy": {"W": 5}}, "windowDays": 364, "bestN": 4}', 'r')$q$, v_actor), 'INVALID', 'an unknown level');
    perform pg_temp.expect_code(format($q$select public.admin_set_ranking_points(%L, '{"label": "Fake table", "levels": {"district": {"W": 5}}, "windowDays": 364, "bestN": 4}', 'r')$q$, v_editor), 'FORBIDDEN', 'an editor approving points');
    j := public.admin_set_ranking_points(v_actor, '{"label": " Fake table ", "levels": {"district": {"W": 100, "F": 60}}, "windowDays": 364, "bestN": 4}', 'test');
    if j ->> 'approvedAt' is null then raise exception 'ASSERT FAIL: the approval time is missing'; end if;
    execute 'reset role';
    if (select ranking_points_table ->> 'label' from public.competition_settings where id = 1) <> 'Fake table'
       or (select ranking_points_approved_by from public.competition_settings where id = 1) <> v_actor then
      raise exception 'ASSERT FAIL: the points table was not stored with its approval';
    end if;
    perform pg_temp.expect_fail($q$update public.competition_settings set ranking_points_table = '{"label": "x"}' where id = 1$q$, 'a malformed points table');
    perform pg_temp.expect_fail($q$update public.competition_settings set ranking_points_approved_at = null where id = 1$q$, 'a points table without its approval');
    if (select rankings_public from public.competition_settings where id = 1) then raise exception 'ASSERT FAIL: approving points switched rankings on'; end if;

    -- ---------------------------------------------------------------- admin_publish_draw: only a draw of today's confirmed entries
    execute 'set local role service_role';
    ev2 := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t2, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'open'), 'test') ->> 'id')::uuid;
    perform public.admin_add_entry(v_actor, ev2, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'confirmed'), 'test');
    perform public.admin_add_entry(v_actor, ev2, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed'), 'test');
    select array_agg(x.id order by x.id) into ids from public.event_entries x where x.event_id = ev2;
    dr2 := (public.admin_save_draw(v_actor, ev2, jsonb_build_object('seed', 3, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', ids[1], 'group', null), jsonb_build_object('position', 2, 'entryId', ids[2], 'group', null))), 'test') ->> 'id')::uuid;
    -- an entry added straight as confirmed after the draw was made: the draft is out of date
    en_x := (public.admin_add_entry(v_actor, ev2, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_publish_draw(%L, %L, 'r')$q$, v_actor, dr2), 'INVALID', 'publishing a draw that misses a confirmed entry');
    perform public.admin_withdraw_entry(v_actor, en_x, 'test');
    -- a placed entry withdrawn after the draw was made: also out of date
    perform public.admin_withdraw_entry(v_actor, ids[2], 'test');
    perform pg_temp.expect_code(format($q$select public.admin_publish_draw(%L, %L, 'r')$q$, v_actor, dr2), 'INVALID', 'publishing a draw that holds a withdrawn entry');
    perform public.admin_add_entry(v_actor, ev2, jsonb_build_object('players', jsonb_build_array(pd), 'seed', null, 'status', 'confirmed'), 'test');
    select array_agg(x.id order by x.id) into ids from public.event_entries x where x.event_id = ev2 and x.status = 'confirmed';
    dr2 := (public.admin_save_draw(v_actor, ev2, jsonb_build_object('seed', 3, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', ids[1], 'group', null), jsonb_build_object('position', 2, 'entryId', ids[2], 'group', null))), 'test') ->> 'id')::uuid;
    j := public.admin_publish_draw(v_actor, dr2, 'test');
    if j ->> 'status' <> 'published' then raise exception 'ASSERT FAIL: an up-to-date draw was not published: %', j; end if;

    -- ---------------------------------------------------------------- the competition naming rule (lead decision, wave 3)
    -- pf: an adult with NO archive video is named; pc unknown, pd private, pg minor, ph provisional, pi and pj suppressed are not
    execute 'reset role';
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility, is_minor_signal) values
      (t3, 'fake-adm-school-2026', 'Fake Adm School', 'fake adm school', 2026, 'tamil_nadu', 'published', 'public', true);
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility, is_minor_signal, level) values
      (t4, 'fake-adm-college-2026', 'Fake Adm College', 'fake adm college', 2026, 'tamil_nadu', 'published', 'public', false, 'school_college');
    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (pf, 'Fake Adm Foxtrot', 'fake adm foxtrot', 'multi_token'), (pg, 'Fake Adm Golf', 'fake adm golf', 'multi_token'),
      (ph, 'Fake Adm Hotel', 'fake adm hotel', 'multi_token'), (pi, 'Fake Adm India', 'fake adm india', 'multi_token'),
      (pj, 'Fake Adm Juliet', 'fake adm juliet', 'multi_token');
    update public.players set age_status = 'minor_suspected', age_signal = array['age_token:U13'] where id = pg;
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pf, ph, pi, pj], 'adult_confirmed', 'fake admin review', 'test');
    perform public.admin_update_player(v_actor, pf, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_update_player(v_actor, ph, '{"visibility": "public"}', 'test');
    perform public.admin_update_player(v_actor, pi, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_update_player(v_actor, pj, '{"is_provisional": false, "visibility": "public"}', 'test');
    execute 'reset role';
    insert into public.suppression (kind, value, reason, created_by) values ('player_id', pi::text, 'fake removal request', 'fake-admin'),
      ('name_normalized', 'fake adm juliet', 'fake removal request', 'fake-admin');
    if (select count(*) from app.competition_named_players where id in (pa, pb, pf)) <> 3
       or exists (select 1 from app.competition_named_players where id in (pc, pd, pg, ph, pi, pj)) then
      raise exception 'ASSERT FAIL: app.competition_named_players is wrong';
    end if;
    if exists (select 1 from app.eligible_players where id = pf) then raise exception 'ASSERT FAIL: setup: the adult with no video has an archive page'; end if;

    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_competition_rankable_players(%L, array[%L]::uuid[])$q$, v_editor, pa), 'FORBIDDEN', 'an editor asking who may be ranked');
    ids := public.admin_competition_rankable_players(v_actor, array[pa, pb, pc, pd, pf, pg, ph, pi, pj, gen_random_uuid()]);
    if ids is distinct from (select array_agg(x order by x) from unnest(array[pa, pb, pf]) x) then raise exception 'ASSERT FAIL: the rankable players are wrong: %', ids; end if;
    if cardinality(public.admin_competition_rankable_players(v_actor, array[]::uuid[])) <> 0 then raise exception 'ASSERT FAIL: an empty list gave players'; end if;

    -- an adult event of a public tournament: eight entries, one per player above, in a published draw
    e3 := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'MS', 'ageGroup', '35+', 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'open'), 'test') ->> 'id')::uuid;
    -- a junior event (Boys' singles) of the same tournament, and an adult category in the minor-signal tournament
    e4 := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'BS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'open'), 'test') ->> 'id')::uuid;
    e5 := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t3, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'open'), 'test') ->> 'id')::uuid;
    -- and an adult category in the school_college-level tournament whose minor-signal flag is false
    e6 := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t4, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'open'), 'test') ->> 'id')::uuid;
    foreach v in array array[e3::text, e4::text, e5::text, e6::text] loop
      ids := case when v = e3::text then array[pa, pf, pc, pd, pg, ph, pi, pj] else array[pa, pf] end;
      slots := '[]'::jsonb;
      k := 0;
      foreach ve in array ids loop
        k := k + 1;
        en_x := (public.admin_add_entry(v_actor, v::uuid, jsonb_build_object('players', jsonb_build_array(ve), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
        slots := slots || jsonb_build_array(jsonb_build_object('position', k, 'entryId', en_x, 'group', null));
      end loop;
      dr3 := (public.admin_save_draw(v_actor, v::uuid, jsonb_build_object('seed', 5, 'slots', slots), 'test') ->> 'id')::uuid;
      perform public.admin_publish_draw(v_actor, dr3, 'test');
    end loop;
    ve := null;
    execute 'reset role';

    -- the draw slots of the adult event: Alpha (archive page, so a slug) and Foxtrot (no video: a name, no slug) are named
    select count(*) into n from api.public_competition_draw_slots s join api.public_competition_draws dw on dw.id = s.draw_id
     where dw.event_id = e3 and not s.is_protected and s.player1_name is not null;
    if n <> 2 then raise exception 'ASSERT FAIL: % named slots in the adult event (expected Alpha and Foxtrot)', n; end if;
    if not exists (select 1 from api.public_competition_draw_slots s join api.public_competition_draws dw on dw.id = s.draw_id
                    where dw.event_id = e3 and s.player1_name = 'Fake Adm Foxtrot' and s.player1_slug is null and not s.is_protected) then
      raise exception 'ASSERT FAIL: an adult_confirmed public player with no video is not named in the draw (or has a slug)';
    end if;
    if not exists (select 1 from api.public_competition_draw_slots s join api.public_competition_draws dw on dw.id = s.draw_id
                    where dw.event_id = e3 and s.player1_name = 'Fake Adm Alpha' and s.player1_slug = 'fake-adm-alpha') then
      raise exception 'ASSERT FAIL: a player with an archive page lost the name or slug in the draw';
    end if;
    select count(*) into n from api.public_competition_draw_slots s join api.public_competition_draws dw on dw.id = s.draw_id
     where dw.event_id = e3 and s.is_protected and s.player1_name is null and s.player1_slug is null;
    if n <> 6 then raise exception 'ASSERT FAIL: % protected slots in the adult event (expected unknown, private, minor, provisional and both suppressed)', n; end if;
    -- the junior event, the minor-signal tournament and the school_college-level tournament name nobody, and say so with is_junior
    if exists (select 1 from api.public_competition_draw_slots s join api.public_competition_draws dw on dw.id = s.draw_id
                where dw.event_id in (e4, e5, e6) and (s.player1_name is not null or s.player1_slug is not null or not s.is_protected)) then
      raise exception 'ASSERT FAIL: a player is named in a junior event or a minor-signal tournament';
    end if;
    if (select count(*) from api.public_competition_draw_slots s join api.public_competition_draws dw on dw.id = s.draw_id where dw.event_id in (e4, e5, e6)) <> 6 then
      raise exception 'ASSERT FAIL: setup: the junior draws are not public';
    end if;
    if (select is_junior from api.public_competition_events where id = e4) is not true or (select is_junior from api.public_competition_events where id = e5) is not true
       or (select is_junior from api.public_competition_events where id = e6) is not true
       or (select is_junior from api.public_competition_events where id = e3) is not false or exists (select 1 from api.public_competition_events where is_junior is null) then
      raise exception 'ASSERT FAIL: api.public_competition_events.is_junior is wrong';
    end if;
    -- the generated matches name the same way (Foxtrot named, the protected players not)
    if exists (select 1 from api.public_competition_matches where event_id in (e4, e5, e6) and (side_a_player1_name is not null or side_b_player1_name is not null or not side_a_protected or not side_b_protected)) then
      raise exception 'ASSERT FAIL: a match of a junior event names a player';
    end if;

    -- ---------------------------------------------------------------- rankings: publish refuses a protected row; no gap afterwards
    execute 'set local role service_role';
    -- Alpha, Foxtrot (no video) and Beta: all named, so it publishes
    rs := (public.admin_save_ranking_snapshot(v_actor, jsonb_build_object('label', 'Fake named ranking', 'category', 'MS', 'ageGroup', null, 'asOf', '2026-10-01',
      'entries', jsonb_build_array(jsonb_build_object('playerId', pa, 'rank', 1, 'points', 100, 'eventsCounted', 1), jsonb_build_object('playerId', pf, 'rank', 2, 'points', 60, 'eventsCounted', 1),
        jsonb_build_object('playerId', pb, 'rank', 3, 'points', 30, 'eventsCounted', 1))), 'test') ->> 'id')::uuid;
    perform public.admin_publish_ranking_snapshot(v_actor, rs, 'test');
    execute 'reset role';
    update public.competition_settings set rankings_public = true where id = 1;
    if (select string_agg(player_name || '=' || rank || '/' || coalesce(player_slug, '-'), ',' order by rank, player_name) from api.public_competition_rankings where snapshot_id = rs)
       is distinct from 'Fake Adm Alpha=1/fake-adm-alpha,Fake Adm Foxtrot=2/-,Fake Adm Beta=3/fake-adm-beta' then
      raise exception 'ASSERT FAIL: the public ranking does not name the adult with no video: %', (select string_agg(coalesce(player_name, '?') || '=' || rank, ',') from api.public_competition_rankings where snapshot_id = rs);
    end if;

    -- a ranking whose row became protected after it was worked out: publishing it is refused, with the count, and nothing changes
    execute 'set local role service_role';
    rs := (public.admin_save_ranking_snapshot(v_actor, jsonb_build_object('label', 'Fake stale ranking', 'category', 'MS', 'ageGroup', null, 'asOf', '2026-10-01',
      'entries', jsonb_build_array(jsonb_build_object('playerId', pa, 'rank', 1, 'points', 100, 'eventsCounted', 1), jsonb_build_object('playerId', pf, 'rank', 2, 'points', 60, 'eventsCounted', 1))), 'test') ->> 'id')::uuid;
    perform public.admin_update_player(v_actor, pf, '{"visibility": "hidden"}', 'test');
    v_msg := null;
    begin
      perform public.admin_publish_ranking_snapshot(v_actor, rs, 'test');
    exception when others then
      v_msg := sqlerrm;
    end;
    if v_msg is distinct from 'INVALID: 1 player in this ranking is now protected (age not confirmed, hidden, provisional, merged or removed on request), so it cannot be published. Work the ranking out again.' then
      raise exception 'ASSERT FAIL: publishing a ranking with a newly protected row was not refused as planned: %', coalesce(v_msg, 'it was published');
    end if;
    -- several protected rows: the count is in the message
    j := public.admin_save_ranking_snapshot(v_actor, jsonb_build_object('label', 'Fake protected ranking', 'category', 'MS', 'ageGroup', null, 'asOf', '2026-10-01',
      'entries', jsonb_build_array(jsonb_build_object('playerId', pa, 'rank', 1, 'points', 100, 'eventsCounted', 1), jsonb_build_object('playerId', pc, 'rank', 2, 'points', 60, 'eventsCounted', 1),
        jsonb_build_object('playerId', pi, 'rank', 3, 'points', 30, 'eventsCounted', 1))), 'test');
    v_msg := null;
    begin
      perform public.admin_publish_ranking_snapshot(v_actor, (j ->> 'id')::uuid, 'test');
    exception when others then
      v_msg := sqlerrm;
    end;
    if v_msg is null or v_msg not like 'INVALID: 2 players in this ranking are now protected%' then raise exception 'ASSERT FAIL: two protected rows were not counted: %', coalesce(v_msg, 'it was published'); end if;
    -- a junior snapshot: every row is protected
    j := public.admin_save_ranking_snapshot(v_actor, jsonb_build_object('label', 'Fake junior ranking', 'category', 'BS', 'ageGroup', null, 'asOf', '2026-10-01',
      'entries', jsonb_build_array(jsonb_build_object('playerId', pa, 'rank', 1, 'points', 100, 'eventsCounted', 1))), 'test');
    perform pg_temp.expect_code(format($q$select public.admin_publish_ranking_snapshot(%L, %L, 'r')$q$, v_actor, j ->> 'id'), 'INVALID', 'publishing a junior ranking');
    execute 'reset role';
    if (select published from public.ranking_snapshots where id = rs) or (select published from public.ranking_snapshots where id = (j ->> 'id')::uuid) then
      raise exception 'ASSERT FAIL: a refused ranking was published';
    end if;
    -- the published ranking whose player was hidden AFTER publishing: the view drops the row and closes the gap
    if (select string_agg(player_name || '=' || rank, ',' order by rank, player_name) from api.public_competition_rankings where label = 'Fake named ranking') is distinct from 'Fake Adm Alpha=1,Fake Adm Beta=2' then
      raise exception 'ASSERT FAIL: the public ranking has a gap or names a hidden player: %', (select string_agg(coalesce(player_name, '?') || '=' || rank, ',') from api.public_competition_rankings where label = 'Fake named ranking');
    end if;
    -- no protected name in ANY competition view: every player in a competition entry or ranking row who is NOT in
    -- app.competition_named_players (whatever the name), and every player of a junior event, must not appear in any public row
    if (select count(*) from public.players p where p.id in (pc, pd, pg, ph, pi, pj, pf) and not exists (select 1 from app.competition_named_players np where np.id = p.id)) <> 7 then
      raise exception 'ASSERT FAIL: setup: the protected players are not as planned';
    end if;
    foreach v in array array['public_competition_events', 'public_competition_draws', 'public_competition_draw_slots', 'public_competition_matches',
                             'public_competition_match_games', 'public_competition_rankings'] loop
      execute format($q$select count(*) from api.%I x where exists (
          select 1 from public.players p
           where (p.id in (select en.player1_id from public.event_entries en union select en.player2_id from public.event_entries en where en.player2_id is not null
                           union select r.player_id from public.ranking_entries r)
                  and not exists (select 1 from app.competition_named_players np where np.id = p.id))
             and position(lower(p.display_name) in lower(row_to_json(x)::text)) > 0)$q$, v) into n;
      if n > 0 then raise exception 'ASSERT FAIL: api.% names a protected player', v; end if;
    end loop;
    -- the junior events (e4, e5, e6) hold Alpha and Foxtrot, who are named elsewhere: no row of those events names them
    if exists (select 1 from api.public_competition_draw_slots s join api.public_competition_draws dw on dw.id = s.draw_id
                where dw.event_id in (e4, e5, e6) and (s.player1_name is not null or s.player2_name is not null)) then
      raise exception 'ASSERT FAIL: a junior event names a player';
    end if;
    update public.competition_settings set rankings_public = false where id = 1;

    -- ---------------------------------------------------------------- audit: ids, counts and codes only; anon: nothing
    if exists (select 1 from public.audit_log where action in ('set_entry', 'create_venue', 'update_venue', 'create_court', 'update_court', 'approve_ranking_points') and diff::text ~* 'fake adm|fake hall|fake city') then
      raise exception 'ASSERT FAIL: a 0018 audit row holds a name';
    end if;
    if (select count(*) from public.audit_log where action in ('set_entry', 'create_venue', 'create_court', 'approve_ranking_points') and actor = v_actor) < 4 then
      raise exception 'ASSERT FAIL: the 0018 actions were not audited';
    end if;
    execute 'set local role anon';
    perform pg_temp.expect_fail(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', 'r')$q$, v_actor, en_a), 'anon running admin_set_entry');
    perform pg_temp.expect_fail(format($q$select public.admin_set_ranking_points(%L, '{}', 'r')$q$, v_actor), 'anon running admin_set_ranking_points');
    perform pg_temp.expect_fail(format($q$select public.admin_competition_rankable_players(%L, array[%L]::uuid[])$q$, v_actor, pa), 'anon asking who may be ranked');
    perform pg_temp.expect_fail($q$select ranking_points_table from public.competition_settings$q$, 'anon reading the points table');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0018_competition_admin assertions passed' as result;
