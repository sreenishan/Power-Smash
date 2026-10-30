-- 0019_assertions.sql - self-check for migration 0019_competition_accounts.sql (organizer and scorer accounts, D-108). Run it after
-- applying 0001..0019. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
-- tournaments, players and accounts. It raises an exception naming the first broken rule and ends with one row `ok`.
-- For every scoped RPC: an assigned organizer (or scorer, for recording a result) is allowed; an unassigned one is refused; a scorer
-- cannot confirm or run anything else; a revoked assignment or an ended account is refused at once; the switch off refuses everyone
-- but the owner; the owner is unchanged.

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
  scoped text[] := array['public.admin_save_event(text,uuid,jsonb,text)', 'public.admin_add_entry(text,uuid,jsonb,text)',
    'public.admin_withdraw_entry(text,uuid,text)', 'public.admin_set_entry(text,uuid,jsonb,text)', 'public.admin_save_draw(text,uuid,jsonb,text)',
    'public.admin_publish_draw(text,uuid,text)', 'public.admin_save_match(text,uuid,jsonb,integer,text)',
    'public.admin_record_result(text,uuid,jsonb,integer,text)', 'public.admin_confirm_result(text,uuid,integer,text)',
    'public.admin_save_court(text,uuid,jsonb,text)'];
  owner_only text[] := array['public.admin_save_venue(text,uuid,jsonb,text)', 'public.admin_set_ranking_points(text,jsonb,text)',
    'public.admin_save_ranking_snapshot(text,jsonb,text)', 'public.admin_publish_ranking_snapshot(text,uuid,text)',
    'public.admin_competition_rankable_players(text,uuid[])', 'public.admin_create_account(text,uuid,jsonb,text)',
    'public.admin_assign_tournament(text,uuid,uuid,text)', 'public.admin_revoke_assignment(text,uuid,text)',
    'public.admin_disable_account(text,uuid,text)', 'public.admin_set_organizer_access(text,boolean,text)'];
  helpers text[] := array['app.require_competition_access(text,uuid,text)', 'app.competition_tournament_of(text,uuid)',
    'app.competition_record_uuid(jsonb,text)', 'app.competition_assignment_guard()'];
  fn text;
  src text;
  c text;
begin
  foreach fn in array scoped || owner_only loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
  end loop;
  -- the scoped RPCs: the access check is the FIRST statement, and the owner-only check is gone
  foreach fn in array scoped loop
    src := (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure);
    if src !~ '\mbegin\s+perform app\.require_competition_access\(p_actor, ' then
      raise exception 'ASSERT FAIL: % does not call app.require_competition_access first', fn;
    end if;
    if position('app.require_owner(' in src) > 0 then raise exception 'ASSERT FAIL: % still calls app.require_owner', fn; end if;
    if fn = 'public.admin_record_result(text,uuid,jsonb,integer,text)' then
      if src !~ 'require_competition_access\(p_actor, [^;]*, ''score''\);' or src ~ '''run''\);' then raise exception 'ASSERT FAIL: recording a result is not at the score level'; end if;
    elsif src !~ 'require_competition_access\(p_actor, [^;]*, ''run''\);' or src ~ '''score''\);' then
      raise exception 'ASSERT FAIL: % is not at the run level', fn;
    end if;
  end loop;
  -- rankings, venues, the points table and the account RPCs stay owner only (the owner check first)
  foreach fn in array owner_only loop
    if (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure) !~ '\mbegin\s+perform app\.require_owner\(p_actor\);' then
      raise exception 'ASSERT FAIL: % does not call app.require_owner first', fn;
    end if;
  end loop;
  foreach fn in array helpers loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: an API role can run %', fn;
    end if;
  end loop;
  -- profiles: the four roles (no player role), still one owner; the account tables stay private
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check')) !~ 'organizer'
     or pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check')) !~ 'scorer'
     or pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check')) ~ 'player' then
    raise exception 'ASSERT FAIL: profiles does not accept exactly owner, editor, organizer and scorer';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_single_owner') then raise exception 'ASSERT FAIL: the one-owner index is gone'; end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.organizer_assignments'::regclass and conname = 'organizer_assignments_unique')
     or not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'organizer_assignments_active_unique' and indexdef ~ 'WHERE \(revoked_at IS NULL\)') then
    raise exception 'ASSERT FAIL: the assignment uniqueness is not limited to active rows';
  end if;
  foreach c in array array['profiles', 'organizer_assignments'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', c)::regclass) then raise exception 'ASSERT FAIL: RLS is off on %', c; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = c) then raise exception 'ASSERT FAIL: % has a policy', c; end if;
    if has_table_privilege('anon', format('public.%I', c), 'SELECT') or has_table_privilege('authenticated', format('public.%I', c), 'SELECT')
       or has_table_privilege('service_role', format('public.%I', c), 'INSERT') or has_table_privilege('service_role', format('public.%I', c), 'UPDATE')
       or has_table_privilege('service_role', format('public.%I', c), 'DELETE') or not has_table_privilege('service_role', format('public.%I', c), 'SELECT') then
      raise exception 'ASSERT FAIL: the privileges on % changed', c;
    end if;
  end loop;
  -- the safe defaults: the switch is off and no account or assignment was seeded
  if (select organizer_roles_enabled from public.competition_settings where id = 1) then raise exception 'ASSERT FAIL: organizer access is on by default'; end if;
  if exists (select 1 from public.organizer_assignments) or exists (select 1 from public.profiles where role in ('organizer', 'scorer')) then
    raise exception 'ASSERT FAIL: the migration seeded an account or an assignment';
  end if;
  -- no api view reads the account tables
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class vw on vw.oid = r.ev_class join pg_namespace n on n.oid = vw.relnamespace
             where n.nspname = 'api' and d.refobjid in ('public.profiles'::regclass, 'public.organizer_assignments'::regclass)) then
    raise exception 'ASSERT FAIL: an api view reads profiles or organizer_assignments';
  end if;
  -- the uuid reader never raises
  if app.competition_record_uuid('{"x": "not-a-uuid"}', 'x') is not null or app.competition_record_uuid('[1]', 'x') is not null
     or app.competition_record_uuid(null, 'x') is not null or app.competition_record_uuid('{"x": 5}', 'x') is not null
     or app.competition_record_uuid('{"x": "11111111-1111-4111-8111-111111111111"}', 'x') <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'ASSERT FAIL: app.competition_record_uuid';
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
  o1 text := 'c0190000-0000-4000-8000-0000000000e1';   -- organizer of t1
  s1 text := 'c0190000-0000-4000-8000-0000000000e2';   -- scorer of t1
  o2 text := 'c0190000-0000-4000-8000-0000000000e3';   -- organizer of t2 only
  s2 text := 'c0190000-0000-4000-8000-0000000000e4';   -- scorer of t2 only
  t1 uuid := 'c0190000-0000-4000-8000-000000000001';
  t2 uuid := 'c0190000-0000-4000-8000-000000000002';
  pa uuid := 'c0190000-0000-4000-8000-0000000000b1';
  pb uuid := 'c0190000-0000-4000-8000-0000000000b2';
  pc uuid := 'c0190000-0000-4000-8000-0000000000b3';
  d jsonb := app.competition_default_ruleset();
  ev jsonb;
  e1 uuid;
  e2 uuid;
  en_a uuid;
  en_b uuid;
  en_c uuid;
  en_z uuid;
  co1 uuid;
  dr1 uuid;
  m1 uuid;
  rev integer;
  a_o1 uuid;
  j jsonb;
  slots jsonb;
  court jsonb;
  r text := 'fake 0019 check';
begin
  begin
    -- a real owner may already exist (OT-51); set it aside for this rolled-back test only
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility) values
      (t1, 'fake-acc-open-2026', 'Fake Acc Open', 'fake acc open', 2026, 'tamil_nadu', 'published', 'public'),
      (t2, 'fake-acc-other-2026', 'Fake Acc Other', 'fake acc other', 2026, 'tamil_nadu', 'published', 'public');
    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (pa, 'Fake Acc Alpha', 'fake acc alpha', 'multi_token'), (pb, 'Fake Acc Beta', 'fake acc beta', 'multi_token'), (pc, 'Fake Acc Gamma', 'fake acc gamma', 'multi_token');

    -- ---------------------------------------------------------------- accounts (owner only, checked fields)
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake Org One", "tournamentIds": ["%s"]}', %L)$q$, v_editor, o1, t1, r), 'FORBIDDEN', 'an editor inviting');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake Org One", "tournamentIds": ["%s"]}', %L)$q$, o2, o1, t1, r), 'FORBIDDEN', 'a stranger inviting');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "fake@example.test", "tournamentIds": ["%s"]}', %L)$q$, v_actor, o1, t1, r), 'INVALID', 'an email as the name');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake 910000000000", "tournamentIds": ["%s"]}', %L)$q$, v_actor, o1, t1, r), 'INVALID', 'a phone in the name');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "owner", "displayName": "Fake Org One", "tournamentIds": ["%s"]}', %L)$q$, v_actor, o1, t1, r), 'INVALID', 'inviting an owner');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "editor", "displayName": "Fake Org One", "tournamentIds": ["%s"]}', %L)$q$, v_actor, o1, t1, r), 'INVALID', 'inviting an editor');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake Org One", "tournamentIds": []}', %L)$q$, v_actor, o1, r), 'INVALID', 'no tournament');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake Org One", "tournamentIds": ["%s", "%s"]}', %L)$q$, v_actor, o1, t1, t1, r), 'INVALID', 'a tournament twice');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake Org One", "tournamentIds": ["%s"]}', %L)$q$, v_actor, o1, gen_random_uuid(), r), 'NOT_FOUND', 'an unknown tournament');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake Org One", "tournamentIds": ["%s"], "email": "x"}', %L)$q$, v_actor, o1, t1, r), 'INVALID', 'an unknown field');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "organizer", "displayName": "Fake Org One", "tournamentIds": ["%s"]}', '')$q$, v_actor, o1, t1), 'INVALID', 'no reason');
    perform public.admin_create_account(v_actor, o1::uuid, jsonb_build_object('role', 'organizer', 'displayName', 'Fake Org One', 'tournamentIds', jsonb_build_array(t1)), r);
    perform public.admin_create_account(v_actor, s1::uuid, jsonb_build_object('role', 'scorer', 'displayName', 'Fake Scorer One', 'tournamentIds', jsonb_build_array(t1)), r);
    perform public.admin_create_account(v_actor, o2::uuid, jsonb_build_object('role', 'organizer', 'displayName', 'Fake Org Two', 'tournamentIds', jsonb_build_array(t2)), r);
    perform public.admin_create_account(v_actor, s2::uuid, jsonb_build_object('role', 'scorer', 'displayName', 'Fake Scorer Two', 'tournamentIds', jsonb_build_array(t2)), r);
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "scorer", "displayName": "Fake Org One", "tournamentIds": ["%s"]}', %L)$q$, v_actor, o1, t2, r), 'INVALID', 'a second account for one person');
    perform pg_temp.expect_code(format($q$select public.admin_create_account(%L, %L, '{"role": "scorer", "displayName": "Fake Owner", "tournamentIds": ["%s"]}', %L)$q$, v_actor, v_owner, t2, r), 'INVALID', 'turning the owner into a scorer');
    execute 'reset role';
    if (select count(*) from public.organizer_assignments where tournament_id in (t1, t2) and revoked_at is null) <> 4
       or (select role from public.organizer_assignments where profile_id = s1::uuid) <> 'scorer' then
      raise exception 'ASSERT FAIL: the invited accounts were not recorded with their role and tournament';
    end if;
    select id into a_o1 from public.organizer_assignments where profile_id = o1::uuid and tournament_id = t1;

    -- ---------------------------------------------------------------- the switch: off refuses everyone but the owner
    ev := jsonb_build_object('tournamentId', t1, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 4, 'status', 'open');
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, o1, ev, r), 'FORBIDDEN', 'an organizer while the switch is off');
    perform pg_temp.expect_code(format($q$select public.admin_set_organizer_access(%L, true, %L)$q$, o1, r), 'FORBIDDEN', 'an organizer switching access on');
    perform pg_temp.expect_code(format($q$select public.admin_set_organizer_access(%L, null, %L)$q$, v_actor, r), 'INVALID', 'a null switch');
    j := public.admin_set_organizer_access(v_actor, true, r);
    if not (j ->> 'changed')::boolean then raise exception 'ASSERT FAIL: the switch did not change'; end if;

    -- ---------------------------------------------------------------- events (run)
    e1 := (public.admin_save_event(o1, null, ev, r) ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, o1, ev || jsonb_build_object('tournamentId', t2, 'category', 'WS'), r), 'FORBIDDEN', 'an organizer adding an event to an unassigned tournament');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, s1, ev || '{"category": "WS"}', r), 'FORBIDDEN', 'a scorer adding an event');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, o2, ev || '{"category": "WS"}', r), 'FORBIDDEN', 'another tournament''s organizer adding an event');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, v_editor, ev || '{"category": "WS"}', r), 'FORBIDDEN', 'an editor adding an event');
    perform pg_temp.expect_code(format($q$select public.admin_save_event('fake-admin', null, %L::jsonb, %L)$q$, ev || '{"category": "WS"}', r), 'FORBIDDEN', 'a non-uuid actor');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, %L, %L::jsonb, %L)$q$, o2, e1, ev || jsonb_build_object('tournamentId', t2), r), 'FORBIDDEN', 'an organizer editing another tournament''s event through their own tournament');
    -- the owner is unchanged: any tournament, the same errors as before
    e2 := (public.admin_save_event(v_actor, null, ev || jsonb_build_object('tournamentId', t2), r) ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, v_actor, ev || jsonb_build_object('tournamentId', gen_random_uuid()), r), 'NOT_FOUND', 'the owner, an unknown tournament');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, v_actor, ev || '{"tournamentId": "nope"}', r), 'INVALID', 'the owner, a bad tournament id');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, %L, %L::jsonb, %L)$q$, o1, e2, ev, r), 'FORBIDDEN', 'an organizer editing an event of an unassigned tournament');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, %L)$q$, o1, ev || '{"tournamentId": "nope"}', r), 'FORBIDDEN', 'an organizer, a bad tournament id (no hint)');
    j := public.admin_save_event(o1, e1, ev || '{"capacity": 8}', r);

    -- ---------------------------------------------------------------- entries (run)
    en_a := (public.admin_add_entry(o1, e1, jsonb_build_object('players', jsonb_build_array(pa), 'seed', 1, 'status', 'confirmed'), r) ->> 'id')::uuid;
    en_b := (public.admin_add_entry(o1, e1, jsonb_build_object('players', jsonb_build_array(pb), 'seed', 2, 'status', 'confirmed'), r) ->> 'id')::uuid;
    en_c := (public.admin_add_entry(o1, e1, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'pending'), r) ->> 'id')::uuid;
    en_z := (public.admin_add_entry(v_actor, e2, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'pending'), r) ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, %L)$q$, s1, e1, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'pending'), r), 'FORBIDDEN', 'a scorer adding an entry');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, %L)$q$, o2, e1, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'pending'), r), 'FORBIDDEN', 'an unassigned organizer adding an entry');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, %L)$q$, o1, e2, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'pending'), r), 'FORBIDDEN', 'an organizer adding to an unassigned event');
    j := public.admin_set_entry(o1, en_c, '{"status": "waitlisted", "seed": null}', r);
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', %L)$q$, s1, en_c, r), 'FORBIDDEN', 'a scorer setting an entry');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', %L)$q$, o2, en_c, r), 'FORBIDDEN', 'an unassigned organizer setting an entry');
    perform pg_temp.expect_code(format($q$select public.admin_set_entry(%L, %L, '{"status": "confirmed", "seed": null}', %L)$q$, o1, en_z, r), 'FORBIDDEN', 'an organizer setting an entry of an unassigned tournament');
    j := public.admin_withdraw_entry(o1, en_c, r);
    perform pg_temp.expect_code(format($q$select public.admin_withdraw_entry(%L, %L, %L)$q$, s1, en_a, r), 'FORBIDDEN', 'a scorer withdrawing an entry');
    perform pg_temp.expect_code(format($q$select public.admin_withdraw_entry(%L, %L, %L)$q$, o2, en_a, r), 'FORBIDDEN', 'an unassigned organizer withdrawing an entry');
    perform pg_temp.expect_code(format($q$select public.admin_withdraw_entry(%L, %L, %L)$q$, o1, en_z, r), 'FORBIDDEN', 'an organizer withdrawing an entry of an unassigned tournament');
    perform pg_temp.expect_code(format($q$select public.admin_withdraw_entry(%L, %L, %L)$q$, o1, gen_random_uuid(), r), 'FORBIDDEN', 'an organizer, an unknown entry (no hint that it does not exist)');
    perform pg_temp.expect_code(format($q$select public.admin_withdraw_entry(%L, %L, %L)$q$, v_actor, gen_random_uuid(), r), 'NOT_FOUND', 'the owner, an unknown entry');

    -- ---------------------------------------------------------------- courts (run) and venues (owner only)
    court := jsonb_build_object('tournamentId', t1, 'venueId', null, 'label', 'Fake Court 9', 'sort', 1);
    co1 := (public.admin_save_court(o1, null, court, r) ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, null, %L::jsonb, %L)$q$, o1, court || jsonb_build_object('tournamentId', t2), r), 'FORBIDDEN', 'an organizer adding a court to an unassigned tournament');
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, %L, %L::jsonb, %L)$q$, o2, co1, court || jsonb_build_object('tournamentId', t2), r), 'FORBIDDEN', 'an organizer editing another tournament''s court');
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, null, %L::jsonb, %L)$q$, s1, court || '{"label": "Fake Court 8"}', r), 'FORBIDDEN', 'a scorer adding a court');
    perform pg_temp.expect_code(format($q$select public.admin_save_venue(%L, null, '{"name": "Fake Hall", "city": null}', %L)$q$, o1, r), 'FORBIDDEN', 'an organizer adding a venue');

    -- ---------------------------------------------------------------- draw (run)
    slots := jsonb_build_object('seed', 9, 'slots', jsonb_build_array(jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null)));
    perform pg_temp.expect_code(format($q$select public.admin_save_draw(%L, %L, %L::jsonb, %L)$q$, s1, e1, slots, r), 'FORBIDDEN', 'a scorer making a draw');
    perform pg_temp.expect_code(format($q$select public.admin_save_draw(%L, %L, %L::jsonb, %L)$q$, o2, e1, slots, r), 'FORBIDDEN', 'an unassigned organizer making a draw');
    dr1 := (public.admin_save_draw(o1, e1, slots, r) ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_publish_draw(%L, %L, %L)$q$, s1, dr1, r), 'FORBIDDEN', 'a scorer publishing a draw');
    perform pg_temp.expect_code(format($q$select public.admin_publish_draw(%L, %L, %L)$q$, o2, dr1, r), 'FORBIDDEN', 'an unassigned organizer publishing a draw');
    j := public.admin_publish_draw(o1, dr1, r);

    -- ---------------------------------------------------------------- matches (run)
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, null, %L::jsonb, null, %L)$q$, s1, jsonb_build_object('eventId', e1, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null, 'sideA', en_a, 'sideB', en_b, 'scheduledAt', null, 'courtId', co1), r), 'FORBIDDEN', 'a scorer making a match');
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, null, %L::jsonb, null, %L)$q$, o2, jsonb_build_object('eventId', e1, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null, 'sideA', en_a, 'sideB', en_b, 'scheduledAt', null, 'courtId', co1), r), 'FORBIDDEN', 'an unassigned organizer making a match');
    m1 := (public.admin_save_match(o1, null, jsonb_build_object('eventId', e1, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null, 'sideA', en_a, 'sideB', en_b, 'scheduledAt', '2026-11-02T04:30:00Z', 'courtId', co1), null, r) ->> 'id')::uuid;
    rev := (select revision from public.competition_matches where id = m1);
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, %L, %L::jsonb, %L, %L)$q$, o2, m1, jsonb_build_object('eventId', e2, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null, 'sideA', null, 'sideB', null, 'scheduledAt', null, 'courtId', null), rev, r), 'FORBIDDEN', 'an organizer moving another tournament''s match through their own event');
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, %L, %L::jsonb, %L, %L)$q$, s1, m1, jsonb_build_object('eventId', e1, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null, 'sideA', en_a, 'sideB', en_b, 'scheduledAt', null, 'courtId', co1), rev, r), 'FORBIDDEN', 'a scorer rescheduling a match');

    -- ---------------------------------------------------------------- results: a scorer records, only an organizer or the owner confirms
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, '{"status": "completed", "games": [{"a": 21, "b": 10}, {"a": 21, "b": 12}], "walkoverWinner": null, "retiringSide": null}', %L, %L)$q$, s2, m1, rev, r), 'FORBIDDEN', 'another tournament''s scorer recording');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, '{"status": "completed", "games": [{"a": 21, "b": 10}, {"a": 21, "b": 12}], "walkoverWinner": null, "retiringSide": null}', %L, %L)$q$, o2, m1, rev, r), 'FORBIDDEN', 'another tournament''s organizer recording');
    j := public.admin_record_result(s1, m1, '{"status": "completed", "games": [{"a": 21, "b": 10}, {"a": 21, "b": 12}], "walkoverWinner": null, "retiringSide": null}', rev, r);
    if j ->> 'winnerSide' <> 'A' or (j ->> 'confirmed')::boolean then raise exception 'ASSERT FAIL: the scorer''s result was not stored unconfirmed: %', j; end if;
    rev := (j ->> 'revision')::integer;
    perform pg_temp.expect_code(format($q$select public.admin_confirm_result(%L, %L, %L, %L)$q$, s1, m1, rev, r), 'FORBIDDEN', 'a scorer confirming');
    perform pg_temp.expect_code(format($q$select public.admin_confirm_result(%L, %L, %L, %L)$q$, o2, m1, rev, r), 'FORBIDDEN', 'an unassigned organizer confirming');
    j := public.admin_confirm_result(o1, m1, rev, r);
    rev := (j ->> 'revision')::integer;
    -- the scorer still reaches the match (the database then refuses the change for its own reason)
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, '{"status": "completed", "games": [{"a": 21, "b": 10}, {"a": 21, "b": 12}], "walkoverWinner": null, "retiringSide": null}', %L, %L)$q$, s1, m1, rev, r), 'INVALID', 'a scorer changing a confirmed result');

    -- ---------------------------------------------------------------- rankings and the points table stay owner only
    perform pg_temp.expect_code(format($q$select public.admin_set_ranking_points(%L, '{"label": "Fake table", "levels": {"district": {"W": 100}}, "windowDays": 364, "bestN": 4}', %L)$q$, o1, r), 'FORBIDDEN', 'an organizer approving points');
    perform pg_temp.expect_code(format($q$select public.admin_competition_rankable_players(%L, array[%L]::uuid[])$q$, o1, pa), 'FORBIDDEN', 'an organizer asking who may be ranked');
    perform pg_temp.expect_code(format($q$select public.admin_save_ranking_snapshot(%L, '{}', %L)$q$, s1, r), 'FORBIDDEN', 'a scorer saving a ranking');
    perform pg_temp.expect_code(format($q$select public.admin_publish_ranking_snapshot(%L, %L, %L)$q$, o1, gen_random_uuid(), r), 'FORBIDDEN', 'an organizer publishing a ranking');
    perform pg_temp.expect_code(format($q$select public.admin_assign_tournament(%L, %L, %L, %L)$q$, o1, o1, t2, r), 'FORBIDDEN', 'an organizer giving themselves a tournament');

    -- ---------------------------------------------------------------- revoking takes effect at once; a tournament can be given back
    j := public.admin_revoke_assignment(v_actor, a_o1, r);
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, %L, %L::jsonb, %L)$q$, o1, co1, court || '{"sort": 2}', r), 'FORBIDDEN', 'a revoked organizer editing a court');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, %L, %L::jsonb, %L)$q$, o1, e1, ev || '{"capacity": 8}', r), 'FORBIDDEN', 'a revoked organizer editing an event');
    perform pg_temp.expect_code(format($q$select public.admin_revoke_assignment(%L, %L, %L)$q$, v_actor, a_o1, r), 'INVALID', 'revoking twice');
    perform pg_temp.expect_code(format($q$select public.admin_revoke_assignment(%L, %L, %L)$q$, v_actor, gen_random_uuid(), r), 'NOT_FOUND', 'revoking an unknown assignment');
    perform pg_temp.expect_code(format($q$select public.admin_revoke_assignment(%L, %L, %L)$q$, o2, a_o1, r), 'FORBIDDEN', 'an organizer revoking');
    j := public.admin_assign_tournament(v_actor, o1::uuid, t1, r);
    if j ->> 'role' <> 'organizer' then raise exception 'ASSERT FAIL: a new assignment does not take the account''s role'; end if;
    perform pg_temp.expect_code(format($q$select public.admin_assign_tournament(%L, %L, %L, %L)$q$, v_actor, o1, t1, r), 'INVALID', 'the same tournament twice');
    perform pg_temp.expect_code(format($q$select public.admin_assign_tournament(%L, %L, %L, %L)$q$, v_actor, o1, gen_random_uuid(), r), 'NOT_FOUND', 'an unknown tournament');
    perform pg_temp.expect_code(format($q$select public.admin_assign_tournament(%L, %L, %L, %L)$q$, v_actor, v_owner, t1, r), 'NOT_FOUND', 'assigning the owner');
    j := public.admin_save_court(o1, co1, court || '{"sort": 2}', r);

    -- ---------------------------------------------------------------- ending an account takes effect at once
    j := public.admin_disable_account(v_actor, s1::uuid, r);
    if (j ->> 'assignmentsRevoked')::integer <> 1 then raise exception 'ASSERT FAIL: ending an account did not revoke its assignment'; end if;
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, '{"status": "completed", "games": [{"a": 21, "b": 10}, {"a": 21, "b": 12}], "walkoverWinner": null, "retiringSide": null}', %L, %L)$q$, s1, m1, rev, r), 'FORBIDDEN', 'an ended scorer recording');
    perform pg_temp.expect_code(format($q$select public.admin_disable_account(%L, %L, %L)$q$, v_actor, s1, r), 'INVALID', 'ending twice');
    perform pg_temp.expect_code(format($q$select public.admin_assign_tournament(%L, %L, %L, %L)$q$, v_actor, s1, t1, r), 'INVALID', 'a tournament for an ended account');
    perform pg_temp.expect_code(format($q$select public.admin_disable_account(%L, %L, %L)$q$, v_actor, v_owner, r), 'NOT_FOUND', 'ending the owner');
    perform pg_temp.expect_code(format($q$select public.admin_disable_account(%L, %L, %L)$q$, v_actor, v_editor, r), 'NOT_FOUND', 'ending an editor');
    perform pg_temp.expect_code(format($q$select public.admin_disable_account(%L, %L, %L)$q$, o1, o2, r), 'FORBIDDEN', 'an organizer ending an account');

    -- ---------------------------------------------------------------- the switch off again: organizers refused, the owner unchanged
    j := public.admin_set_organizer_access(v_actor, false, r);
    perform pg_temp.expect_code(format($q$select public.admin_save_court(%L, %L, %L::jsonb, %L)$q$, o1, co1, court || '{"sort": 3}', r), 'FORBIDDEN', 'an organizer after the switch went off');
    j := public.admin_save_court(v_actor, co1, court || '{"sort": 3}', r);
    j := public.admin_save_event(v_actor, e2, ev || jsonb_build_object('tournamentId', t2, 'capacity', 8), r);
    execute 'reset role';

    -- ---------------------------------------------------------------- guards and table rules hold whoever writes
    perform pg_temp.expect_fail(format($q$update public.organizer_assignments set revoked_at = null, revoked_by = null where id = %L$q$, a_o1), 'un-revoking an assignment');
    perform pg_temp.expect_fail(format($q$update public.organizer_assignments set tournament_id = %L where profile_id = %L and revoked_at is null$q$, t2, o1), 'moving an assignment');
    perform pg_temp.expect_fail(format($q$insert into public.organizer_assignments (profile_id, tournament_id, role, created_by) values (%L, %L, 'organizer', 'x')$q$, o1, t1), 'a second active assignment');
    perform pg_temp.expect_fail($q$insert into public.profiles (id, role, display_name) values (gen_random_uuid(), 'organizer', 'fake@example.test')$q$, 'an email as an organizer label');
    perform pg_temp.expect_fail($q$insert into public.profiles (id, role, display_name) values (gen_random_uuid(), 'player', 'Fake Player')$q$, 'a player role');
    perform pg_temp.expect_fail(format($q$update public.profiles set disabled_at = now(), disabled_by = 'x' where id = %L$q$, v_owner), 'disabling the owner');

    -- ---------------------------------------------------------------- audit: ids, roles and counts only; anon: nothing
    if exists (select 1 from public.audit_log where action in ('create_account', 'assign_tournament', 'revoke_assignment', 'disable_account', 'set_organizer_access')
               and diff::text ~* 'fake (org|scorer)|@') then
      raise exception 'ASSERT FAIL: an account audit row holds a name or an email';
    end if;
    if (select count(*) from public.audit_log where action in ('create_account', 'assign_tournament', 'revoke_assignment', 'disable_account', 'set_organizer_access') and actor = v_actor) < 9 then
      raise exception 'ASSERT FAIL: the account actions were not audited';
    end if;
    if (select count(*) from public.audit_log where actor = s1 and action = 'record_result') <> 1 or (select count(*) from public.audit_log where actor = o1 and action = 'confirm_result') <> 1 then
      raise exception 'ASSERT FAIL: the scoped writes are not audited under their own actor';
    end if;
    execute 'set local role anon';
    perform pg_temp.expect_fail(format($q$select public.admin_create_account(%L, gen_random_uuid(), '{}', 'r')$q$, v_actor), 'anon inviting');
    perform pg_temp.expect_fail(format($q$select public.admin_set_organizer_access(%L, true, 'r')$q$, v_actor), 'anon switching access');
    perform pg_temp.expect_fail($q$select count(*) from public.organizer_assignments$q$, 'anon reading assignments');
    execute 'reset role';
    execute 'set local role authenticated';
    perform pg_temp.expect_fail(format($q$select public.admin_record_result(%L, %L, '{}', 1, 'r')$q$, o1, m1), 'authenticated running a scoped RPC');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0019_competition_accounts assertions passed' as result;
