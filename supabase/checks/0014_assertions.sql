-- 0014_assertions.sql - self-check for migration 0014_tournament_edit.sql (admin_update_tournament).
-- Run it after applying 0001..0014. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
-- tournaments. It raises an exception naming the first broken rule and ends with one row `ok`.

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

-- Like expect_fail, but the error message must start with the given code (so a different failure cannot pass the test).
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

-- The record as the admin form shows it (the function's p_expected): the same keys, categories in the fixed order.
create function pg_temp.expected_of(p_id uuid) returns jsonb language sql as $f$
  select jsonb_build_object('name', t.name, 'level', t.level, 'city', t.city, 'district', t.district, 'venue', t.venue,
    'startDate', to_char(t.start_date, 'YYYY-MM-DD'), 'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
    'categories', (select coalesce(jsonb_agg(c order by array_position(array['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD'], c)), '[]'::jsonb)
                   from (select distinct c from unnest(t.categories) c) s),
    'isFeatured', t.is_featured, 'featuredUntil', to_char(t.featured_until, 'YYYY-MM-DD'), 'coveredByPowerSmash', t.covered_by_power_smash)
  from public.tournaments t where t.id = p_id
$f$;

-- ------------------------------------------------------------------------------------------------------------------
-- A. structure: a locked-down SECURITY DEFINER function with a pinned search_path
-- ------------------------------------------------------------------------------------------------------------------
do $$
begin
  if not (select prosecdef from pg_proc where oid = 'public.admin_update_tournament(text,uuid,jsonb,jsonb,text)'::regprocedure) then
    raise exception 'ASSERT FAIL: admin_update_tournament is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.admin_update_tournament(text,uuid,jsonb,jsonb,text)'::regprocedure and proconfig @> array['search_path=""']) then
    raise exception 'ASSERT FAIL: admin_update_tournament does not pin search_path';
  end if;
  if has_function_privilege('anon', 'public.admin_update_tournament(text,uuid,jsonb,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_update_tournament(text,uuid,jsonb,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: anon or authenticated can run admin_update_tournament';
  end if;
  if not has_function_privilege('service_role', 'public.admin_update_tournament(text,uuid,jsonb,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: service_role cannot run admin_update_tournament';
  end if;
  -- (the service role keeps its 0006 table grants: the sync writes tournaments with it; the locks in manual_override protect owner edits)
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back): owner only, every field checked, nothing stored on a refusal, locks, audit without text, dirty flag, the view
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  v_t uuid := 'a0000000-0000-4000-8000-0000000000a1';
  v_s uuid := 'a0000000-0000-4000-8000-0000000000a2';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  rec jsonb;
  j jsonb;
  n integer;
  t public.tournaments%rowtype;
begin
  begin
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility, categories, district)
      values (v_t, 'fake-open-2026', 'Fake Open', 'fake open', 2026, 'tamil_nadu', 'published', 'public', array['MS'], 'Fakedistrict');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility)
      values (v_s, 'fake-hidden-cup-2026', 'Fake Hidden Cup', 'fake hidden cup', 2026, 'tamil_nadu', 'published', 'public');
    insert into public.suppression (kind, value, reason, created_by) values ('tournament_id', v_s::text, 'fake takedown', 'fake-admin');
    update public.site_state set dirty = false, dirty_since = null where id = 1;

    rec := jsonb_build_object('name', '  Fake Open Championship  ', 'level', 'state', 'city', 'Fakecity', 'district', 'Fakedistrict2',
      'venue', 'Fake Indoor Stadium, Court 1-4', 'startDate', '2026-11-14', 'endDate', '2026-11-16', 'categories', jsonb_build_array('XD', 'MS', 'MS', 'WS'),
      'isFeatured', true, 'featuredUntil', to_char(v_today + 10, 'YYYY-MM-DD'), 'coveredByPowerSmash', true);

    -- the owner check
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament('fake-admin', %1$L, %2$L::jsonb, pg_temp.expected_of(%1$L::uuid), 'r')$q$, v_t, rec), 'a non-uuid actor');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_editor, v_t, rec), 'an editor actor');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(null, %1$L, %2$L::jsonb, pg_temp.expected_of(%1$L::uuid), 'r')$q$, v_t, rec), 'a null actor');

    -- field checks: never coerced
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), '')$q$, v_actor, v_t, rec), 'no reason');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"region": "international"}'), 'an unknown field (region)');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec - 'venue'), 'a missing field');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"name": " F "}'), 'a 1-character name');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || jsonb_build_object('name', repeat('n', 121))), 'a 121-character name');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || jsonb_build_object('name', 'Fake' || chr(10) || 'Open')), 'a line break in the name');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"name": 42}'), 'a name given as a number');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"level": "galactic"}'), 'an unknown level');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || jsonb_build_object('venue', repeat('v', 161))), 'a 161-character venue');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"startDate": "2026-02-30"}'), 'an impossible date');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"startDate": "14 Nov 2026"}'), 'a date in another format');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"startDate": "2026-11-16", "endDate": "2026-11-14"}'), 'the last day before the first');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"categories": ["MS", "U15"]}'), 'an unknown category');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"categories": "MS"}'), 'categories that are not a list');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"featuredUntil": null}'), 'featured with no end date');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || jsonb_build_object('featuredUntil', to_char(v_today - 1, 'YYYY-MM-DD'))), 'featured until yesterday');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec || '{"isFeatured": "true"}'), 'featured given as text');
    perform pg_temp.expect_code(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, 'a0000000-0000-4000-8000-0000000000ff', rec), 'NOT_FOUND', 'an unknown tournament');
    perform pg_temp.expect_code(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_s, rec), 'SUPPRESSED', 'a suppressed tournament');
    execute 'reset role';
    if exists (select 1 from public.audit_log where action = 'update_tournament') then raise exception 'ASSERT FAIL: a refused call wrote an audit row'; end if;
    if (select name from public.tournaments where id = v_t) is distinct from 'Fake Open' then raise exception 'ASSERT FAIL: a refused save changed the tournament'; end if;

    -- the owner's edit: trimmed, categories once each in the fixed order, edited name/level/city/district locked, audited without text
    execute 'set local role service_role';
    j := public.admin_update_tournament(v_actor, v_t, rec, pg_temp.expected_of(v_t), 'tournament edit');
    execute 'reset role';
    select * into t from public.tournaments where id = v_t;
    if t.name is distinct from 'Fake Open Championship' or t.level is distinct from 'state' or t.city is distinct from 'Fakecity'
       or t.district is distinct from 'Fakedistrict2' or t.venue is distinct from 'Fake Indoor Stadium, Court 1-4'
       or t.start_date is distinct from '2026-11-14'::date or t.end_date is distinct from '2026-11-16'::date
       or t.categories is distinct from array['MS', 'WS', 'XD'] or t.is_featured is distinct from true
       or t.featured_until is distinct from v_today + 10 or t.covered_by_power_smash is distinct from true then
      raise exception 'ASSERT FAIL: the edit was not stored as cleaned: %', row_to_json(t);
    end if;
    if t.manual_override is distinct from '{"name": true, "level": true, "city": true, "district": true}'::jsonb then
      raise exception 'ASSERT FAIL: the edited name, level, city and district were not locked: %', t.manual_override;
    end if;
    -- unchanged by the edit: region, visibility, status, slug, year
    if t.region <> 'tamil_nadu' or t.visibility <> 'public' or t.status <> 'published' or t.slug <> 'fake-open-2026' or t.edition_year <> 2026 then
      raise exception 'ASSERT FAIL: the edit touched a field it must not';
    end if;
    if (j -> 'fields') is distinct from '["name", "level", "city", "district", "venue", "startDate", "endDate", "categories", "isFeatured", "featuredUntil", "coveredByPowerSmash"]'::jsonb then
      raise exception 'ASSERT FAIL: wrong changed fields: %', j;
    end if;
    if not exists (select 1 from public.audit_log where action = 'update_tournament' and actor = v_actor and entity_id = v_t::text
                   and diff -> 'fields' = j -> 'fields' and (diff ->> 'new_featured')::boolean) then
      raise exception 'ASSERT FAIL: the edit was not audited with the changed field names';
    end if;
    if exists (select 1 from public.audit_log where action = 'update_tournament' and (diff::text like '%Fakecity%' or diff::text like '%Stadium%' or diff::text like '%Championship%')) then
      raise exception 'ASSERT FAIL: the audit row holds text from the record';
    end if;
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: an edit did not mark the site dirty'; end if;

    -- the sync cannot overwrite a locked field (the guard keeps it), but may still append a category
    update public.tournaments set name = 'Sync Name', district = 'Sync District', categories = categories || array['MD'] where id = v_t;
    select * into t from public.tournaments where id = v_t;
    if t.name is distinct from 'Fake Open Championship' or t.district is distinct from 'Fakedistrict2' then raise exception 'ASSERT FAIL: a locked field was overwritten'; end if;
    if not ('MD' = any (t.categories)) then raise exception 'ASSERT FAIL: the sync could not append a category'; end if;

    -- a form opened BEFORE that sync write is refused (STALE) instead of silently dropping MD; nothing is audited
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, %4$L::jsonb, 'r')$q$, v_actor, v_t,
      rec || '{"venue": "Fake Hall"}', pg_temp.expected_of(v_t) || '{"categories": ["MS", "WS", "XD"]}'), 'STALE', 'a save from a form opened before the sync');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, %4$L::jsonb, 'r')$q$, v_actor, v_t, rec, pg_temp.expected_of(v_t) - 'venue'), 'a malformed expected record');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, null, 'r')$q$, v_actor, v_t, rec), 'no expected record');
    execute 'reset role';
    if not exists (select 1 from public.tournaments where id = v_t and 'MD' = any (categories)) then raise exception 'ASSERT FAIL: a stale save dropped the sync category'; end if;
    if (select count(*) from public.audit_log where action = 'update_tournament') <> 1 then raise exception 'ASSERT FAIL: a refused stale save was audited'; end if;

    -- the same values again: nothing changes and nothing is audited
    execute 'set local role service_role';
    j := public.admin_update_tournament(v_actor, v_t, rec || '{"categories": ["MS", "WS", "XD", "MD"]}', pg_temp.expected_of(v_t), 'again');
    execute 'reset role';
    if (j -> 'fields') is distinct from '[]'::jsonb then raise exception 'ASSERT FAIL: an unchanged save reported changes: %', j; end if;
    select count(*) into n from public.audit_log where action = 'update_tournament';
    if n <> 1 then raise exception 'ASSERT FAIL: an unchanged save was audited (% rows)', n; end if;

    -- not featured = no date, even if one is sent; empty text = not stated
    execute 'set local role service_role';
    j := public.admin_update_tournament(v_actor, v_t, rec || jsonb_build_object('isFeatured', false, 'featuredUntil', to_char(v_today - 5, 'YYYY-MM-DD'), 'venue', '   ', 'level', null), pg_temp.expected_of(v_t), 'unfeature');
    execute 'reset role';
    select * into t from public.tournaments where id = v_t;
    if t.is_featured or t.featured_until is not null or t.venue is not null or t.level is not null then
      raise exception 'ASSERT FAIL: unfeaturing or clearing did not store nulls';
    end if;

    -- featuring that has ended (stored in the past) does not block an unrelated edit
    update public.tournaments set is_featured = true, featured_until = v_today - 3 where id = v_t;
    execute 'set local role service_role';
    j := public.admin_update_tournament(v_actor, v_t, pg_temp.expected_of(v_t) || '{"venue": "Fake Hall 2"}', pg_temp.expected_of(v_t), 'venue fix');
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t,
      pg_temp.expected_of(v_t) || jsonb_build_object('featuredUntil', to_char(v_today - 1, 'YYYY-MM-DD'))), 'moving an ended featuring to another past date');
    execute 'reset role';
    if (j -> 'fields') is distinct from '["venue"]'::jsonb or (select venue from public.tournaments where id = v_t) is distinct from 'Fake Hall 2' then
      raise exception 'ASSERT FAIL: an ended, unchanged featuring blocked a venue fix: %', j;
    end if;

    -- the public view shows the edited details
    execute 'set local role anon';
    if (select name from api.public_tournaments where id = v_t) is distinct from 'Fake Open Championship' then
      raise exception 'ASSERT FAIL: api.public_tournaments does not show the edited name';
    end if;
    perform pg_temp.expect_fail(format($q$select public.admin_update_tournament(%1$L, %2$L, %3$L::jsonb, pg_temp.expected_of(%2$L::uuid), 'r')$q$, v_actor, v_t, rec), 'anon running admin_update_tournament');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0014_tournament_edit assertions passed' as result;
