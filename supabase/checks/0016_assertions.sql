-- 0016_assertions.sql - self-check for migration 0016_filming_permission.sql (public.tournament_permissions, admin_set_filming_permission).
-- Run it after applying 0001..0016. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
-- tournaments and people. It raises an exception naming the first broken rule and ends with one row `ok`.

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
-- A. structure: RLS on, no policies, no rights for anon/authenticated, service_role reads only, not in any api view, a locked-down RPC
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  p text;
begin
  if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'tournament_permissions') then
    raise exception 'ASSERT FAIL: row level security is OFF on public.tournament_permissions';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_permissions') then raise exception 'ASSERT FAIL: a policy exists on public.tournament_permissions'; end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.tournament_permissions', p) or has_table_privilege('authenticated', 'public.tournament_permissions', p) then
      raise exception 'ASSERT FAIL: anon or authenticated holds % on public.tournament_permissions', p;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.tournament_permissions', 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read public.tournament_permissions'; end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('service_role', 'public.tournament_permissions', p) then raise exception 'ASSERT FAIL: service_role holds % on public.tournament_permissions', p; end if;
  end loop;
  -- private: no view in the api schema reads it
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class join pg_namespace n on n.oid = v.relnamespace
             where n.nspname = 'api' and d.refobjid = 'public.tournament_permissions'::regclass) then
    raise exception 'ASSERT FAIL: an api view reads public.tournament_permissions';
  end if;
  -- nothing backfilled: every tournament starts unknown (no row)
  if exists (select 1 from public.tournament_permissions) then raise exception 'ASSERT FAIL: the migration backfilled permission rows'; end if;
  if not (select prosecdef from pg_proc where oid = 'public.admin_set_filming_permission(text,uuid,jsonb,text)'::regprocedure) then
    raise exception 'ASSERT FAIL: admin_set_filming_permission is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.admin_set_filming_permission(text,uuid,jsonb,text)'::regprocedure and proconfig @> array['search_path=""']) then
    raise exception 'ASSERT FAIL: admin_set_filming_permission does not pin search_path';
  end if;
  if has_function_privilege('anon', 'public.admin_set_filming_permission(text,uuid,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_set_filming_permission(text,uuid,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: anon or authenticated can run admin_set_filming_permission';
  end if;
  if not has_function_privilege('service_role', 'public.admin_set_filming_permission(text,uuid,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: service_role cannot run admin_set_filming_permission';
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
  v_t uuid := 'a0000000-0000-4000-8000-0000000000b1';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  granted jsonb;
  j jsonb;
  n integer;
  r public.tournament_permissions%rowtype;
begin
  begin
    -- a real owner may already exist (OT-51); set it aside for this rolled-back test only
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility) values (v_t, 'fake-permit-open-2026', 'Fake Permit Open', 'fake permit open', 2026, 'tamil_nadu', 'published', 'public');
    granted := jsonb_build_object('status', 'granted', 'grantedByName', '  Fake Secretary Person  ', 'grantedByRole', 'Secretary, Fake District Association',
      'grantedOn', to_char(v_today - 3, 'YYYY-MM-DD'), 'scopeFilming', true, 'scopeYoutube', true, 'scopeLiveStream', false, 'scopeSponsorOverlays', false,
      'exclusivePartner', 'no', 'documentRef', 'WhatsApp message of the fictional secretary, saved in the owner''s Drive');

    -- the owner check
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_set_filming_permission('fake-admin', %L, %L::jsonb, 'r')$q$, v_t, granted), 'a non-uuid actor');
    perform pg_temp.expect_fail(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_editor, v_t, granted), 'an editor actor');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, 'a0000000-0000-4000-8000-0000000000ff', granted), 'NOT_FOUND', 'an unknown tournament');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, '')$q$, v_actor, v_t, granted), 'INVALID', 'no reason');

    -- field checks: never coerced; granted is complete
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"status": "maybe"}'), 'INVALID', 'an unknown status');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"exclusivePartner": "perhaps"}'), 'INVALID', 'an unknown exclusive-partner answer');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"phone": "910000000000"}'), 'INVALID', 'an unknown field');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted - 'documentRef'), 'INVALID', 'a missing field');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"scopeFilming": "true"}'), 'INVALID', 'a scope given as text');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"grantedByName": null}'), 'INVALID', 'granted without who');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"grantedByRole": "  "}'), 'INVALID', 'granted without a role');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"grantedOn": null}'), 'INVALID', 'granted without a date');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"scopeFilming": false}'), 'INVALID', 'granted without filming');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || jsonb_build_object('grantedOn', to_char(v_today + 1, 'YYYY-MM-DD'))), 'INVALID', 'a date in the future');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || '{"grantedOn": "2026-02-30"}'), 'INVALID', 'an impossible date');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || jsonb_build_object('grantedByName', repeat('n', 121))), 'INVALID', 'a 121-character name');
    perform pg_temp.expect_code(format($q$select public.admin_set_filming_permission(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_t, granted || jsonb_build_object('documentRef', 'line one' || chr(10) || 'line two')), 'INVALID', 'a line break in the proof reference');
    execute 'reset role';
    if exists (select 1 from public.tournament_permissions) then raise exception 'ASSERT FAIL: a refused call stored a row'; end if;
    if exists (select 1 from public.audit_log where action = 'set_filming_permission') then raise exception 'ASSERT FAIL: a refused call wrote an audit row'; end if;
    -- the table check holds even without the function
    perform pg_temp.expect_fail(format($q$insert into public.tournament_permissions (tournament_id, status, updated_by) values (%L, 'granted', 'x')$q$, v_t), 'a granted row with nothing in it');

    -- requested first: no name needed
    execute 'set local role service_role';
    j := public.admin_set_filming_permission(v_actor, v_t, jsonb_build_object('status', 'requested', 'grantedByName', null, 'grantedByRole', null, 'grantedOn', null,
      'scopeFilming', false, 'scopeYoutube', false, 'scopeLiveStream', false, 'scopeSponsorOverlays', false, 'exclusivePartner', 'unknown', 'documentRef', null), 'asked the organizer');
    j := public.admin_set_filming_permission(v_actor, v_t, granted, 'permission recorded');
    execute 'reset role';
    select * into r from public.tournament_permissions where tournament_id = v_t;
    if r.status is distinct from 'granted' or r.granted_by_name is distinct from 'Fake Secretary Person' or r.granted_on is distinct from v_today - 3
       or r.scope_filming is distinct from true or r.scope_youtube is distinct from true or r.scope_live_stream is distinct from false or r.exclusive_partner is distinct from 'no'
       or r.updated_by is distinct from v_actor then
      raise exception 'ASSERT FAIL: the permission was not stored as cleaned: %', row_to_json(r);
    end if;
    select count(*) into n from public.audit_log where action = 'set_filming_permission' and entity_id = v_t::text;
    if n <> 2 then raise exception 'ASSERT FAIL: expected 2 audit rows, got %', n; end if;
    if not exists (select 1 from public.audit_log where action = 'set_filming_permission' and actor = v_actor and diff ->> 'old_status' = 'requested'
                   and diff ->> 'new_status' = 'granted' and (diff -> 'scope' ->> 'youtube')::boolean) then
      raise exception 'ASSERT FAIL: the grant was not audited with its status and scope';
    end if;
    if exists (select 1 from public.audit_log where action = 'set_filming_permission' and (diff::text like '%Secretary%' or diff::text like '%WhatsApp%' or coalesce(reason, '') like '%Secretary%')) then
      raise exception 'ASSERT FAIL: the audit holds the person''s name, role or the proof reference';
    end if;

    -- the same values again: nothing changes and nothing is audited
    execute 'set local role service_role';
    j := public.admin_set_filming_permission(v_actor, v_t, granted, 'again');
    execute 'reset role';
    if (j -> 'fields') is distinct from '[]'::jsonb then raise exception 'ASSERT FAIL: an unchanged save reported changes: %', j; end if;
    if (select count(*) from public.audit_log where action = 'set_filming_permission') <> 2 then raise exception 'ASSERT FAIL: an unchanged save was audited'; end if;

    -- anon can read neither the table nor any of it through the api
    execute 'set local role anon';
    perform pg_temp.expect_fail($q$select * from public.tournament_permissions$q$, 'anon reading public.tournament_permissions');
    perform pg_temp.expect_fail(format($q$select public.admin_set_filming_permission(%L, %L, '{}'::jsonb, 'r')$q$, v_actor, v_t), 'anon running admin_set_filming_permission');
    execute 'reset role';

    -- deleting the tournament removes its permission row (no orphan with a person's name)
    delete from public.tournaments where id = v_t;
    if exists (select 1 from public.tournament_permissions where tournament_id = v_t) then raise exception 'ASSERT FAIL: an orphan permission row was left'; end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0016_filming_permission assertions passed' as result;
