-- 0012_assertions.sql - self-check for migration 0012_player_profile.sql (players.academy, the re-created players_protected_rules and
-- app.players_guard, api.public_players with academy, admin_update_player_profile). Run it after applying 0001..0012. It changes nothing:
-- the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL rows. It raises an exception naming the first broken
-- rule and ends with one row `ok`.

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
  last_col text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'academy') then
    raise exception 'ASSERT FAIL: public.players.academy is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'players_protected_rules' and conrelid = 'public.players'::regclass
                 and pg_get_constraintdef(oid) like '%academy IS NULL%') then
    raise exception 'ASSERT FAIL: players_protected_rules is missing or does not empty academy for protected players';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'players_guard' and tgrelid = 'public.players'::regclass and not tgisinternal) then
    raise exception 'ASSERT FAIL: the players_guard trigger is gone';
  end if;
  if position('new.academy := null;' in (select prosrc from pg_proc where oid = 'app.players_guard()'::regprocedure)) = 0 then
    raise exception 'ASSERT FAIL: app.players_guard does not empty academy for protected players';
  end if;
  select column_name into last_col from information_schema.columns where table_schema = 'api' and table_name = 'public_players' order by ordinal_position desc limit 1;
  if last_col is distinct from 'academy' then raise exception 'ASSERT FAIL: academy is not the last column of api.public_players (got %)', last_col; end if;
  if not has_table_privilege('anon', 'api.public_players', 'SELECT') then raise exception 'ASSERT FAIL: anon lost select on api.public_players'; end if;
  if not (select prosecdef from pg_proc where oid = 'public.admin_update_player_profile(text,uuid,text,text,text,text)'::regprocedure) then
    raise exception 'ASSERT FAIL: admin_update_player_profile is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.admin_update_player_profile(text,uuid,text,text,text,text)'::regprocedure and proconfig @> array['search_path=""']) then
    raise exception 'ASSERT FAIL: admin_update_player_profile does not pin search_path';
  end if;
  if has_function_privilege('anon', 'public.admin_update_player_profile(text,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_update_player_profile(text,uuid,text,text,text,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: anon or authenticated can run admin_update_player_profile';
  end if;
  if not has_function_privilege('service_role', 'public.admin_update_player_profile(text,uuid,text,text,text,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: service_role cannot run admin_update_player_profile';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back): adults only, refusals are loud, the guard empties academy, audit holds field names only
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  pa uuid := gen_random_uuid();  -- adult
  pu uuid := gen_random_uuid();  -- unknown age
  pm uuid := gen_random_uuid();  -- confirmed minor
  j jsonb;
begin
  begin
    -- a real owner may already exist (the owner's own login, OT-51), and only one owner is allowed (profiles_single_owner): set it aside
    -- for this test only. The whole block ends in ps_rollback, so the real profile is never changed.
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.players (id, display_name, name_normalized) values
      (pa, 'Fake Adult', 'fake adult'), (pu, 'Fake Unknown', 'fake unknown'), (pm, 'Fake Minor', 'fake minor');
    update public.players set age_status = 'minor_confirmed' where id = pm;
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pa], 'adult_confirmed', 'fake admin review', 'test');
    execute 'reset role';
    update public.site_state set dirty = false, dirty_since = null where id = 1;

    -- owner only
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, 'Fakedistrict', null, null, 'r')$q$, v_editor, pa), 'an editor actor');
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile('fake-admin', %L, 'Fakedistrict', null, null, 'r')$q$, pa), 'a non-uuid actor');
    -- protected players are refused loudly, and their row is unchanged
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, 'Fakedistrict', 'Fake Academy', 'Fake bio', 'r')$q$, v_actor, pu), 'an unknown-age player');
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, 'Fakedistrict', 'Fake Academy', 'Fake bio', 'r')$q$, v_actor, pm), 'a minor');
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, gen_random_uuid(), 'Fakedistrict', null, null, 'r')$q$, v_actor), 'an unknown player');
    -- field checks
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, 'Fakedistrict', null, null, '')$q$, v_actor, pa), 'no reason');
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, repeat('d', 61), null, null, 'r')$q$, v_actor, pa), 'a district over 60 characters');
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, null, repeat('a', 121), null, 'r')$q$, v_actor, pa), 'an academy over 120 characters');
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, null, null, repeat('b', 601), 'r')$q$, v_actor, pa), 'a bio over 600 characters');
    perform pg_temp.expect_fail(format($q$select public.admin_update_player_profile(%L, %L, null, %L, null, 'r')$q$, v_actor, pa, 'Fake' || chr(7) || 'Academy'), 'a control character');
    execute 'reset role';
    if exists (select 1 from public.players where id in (pu, pm) and (district is not null or academy is not null or bio is not null)) then
      raise exception 'ASSERT FAIL: a refused edit changed a protected player';
    end if;
    if exists (select 1 from public.audit_log where action = 'update_player_profile') then raise exception 'ASSERT FAIL: a refused call wrote an audit row'; end if;
    -- outside the RPC, the guard empties an academy written on a protected player before the table check sees it
    update public.players set academy = 'Fake Academy', district = 'Fakedistrict' where id = pu;
    if exists (select 1 from public.players where id = pu and (academy is not null or district is not null)) then
      raise exception 'ASSERT FAIL: the guard let a protected player keep an academy or district';
    end if;

    -- an adult edit: fields written, district locked, field NAMES audited (never the bio text), site dirty
    execute 'set local role service_role';
    j := public.admin_update_player_profile(v_actor, pa, ' Fakedistrict ', 'Fake Academy', 'Fake bio line one' || chr(10) || 'line two', 'profile edit, test');
    execute 'reset role';
    if (select district from public.players where id = pa) <> 'Fakedistrict' or (select academy from public.players where id = pa) <> 'Fake Academy' then
      raise exception 'ASSERT FAIL: the adult profile was not written (or not trimmed)';
    end if;
    if not coalesce(((select manual_override from public.players where id = pa) ->> 'district')::boolean, false) then raise exception 'ASSERT FAIL: district was not locked against the sync'; end if;
    if j -> 'fields' <> '["district", "academy", "bio"]'::jsonb then raise exception 'ASSERT FAIL: wrong changed fields: %', j; end if;
    if not exists (select 1 from public.audit_log where action = 'update_player_profile' and entity_id = pa::text and diff -> 'fields' = '["district", "academy", "bio"]'::jsonb) then
      raise exception 'ASSERT FAIL: the edit was not audited with the field names';
    end if;
    if exists (select 1 from public.audit_log where action = 'update_player_profile' and diff::text like '%Fake bio%') then raise exception 'ASSERT FAIL: the bio text reached the audit log'; end if;
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: a profile edit did not mark the site dirty'; end if;
    -- the same values again: nothing changes, no second audit row
    execute 'set local role service_role';
    j := public.admin_update_player_profile(v_actor, pa, 'Fakedistrict', 'Fake Academy', 'Fake bio line one' || chr(10) || 'line two', 'again');
    execute 'reset role';
    if j -> 'fields' <> '[]'::jsonb or (select count(*) from public.audit_log where action = 'update_player_profile') <> 1 then raise exception 'ASSERT FAIL: an unchanged edit was audited'; end if;

    -- D-012: protecting the adult again empties academy with the other profile fields (the added guard line), and does not fail
    update public.players set age_status = 'minor_suspected' where id = pa;
    if (select age_status from public.players where id = pa) <> 'minor_suspected' then raise exception 'ASSERT FAIL: the player could not be protected'; end if;
    if exists (select 1 from public.players where id = pa and (academy is not null or district is not null or bio is not null)) then
      raise exception 'ASSERT FAIL: the guard kept profile data on a player who became protected';
    end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0012_player_profile assertions passed' as result;
