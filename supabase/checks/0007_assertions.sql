-- 0007_assertions.sql - self-check for migration 0007_placements.sql.
-- Run it after applying the migration (dashboard SQL editor). It changes nothing: it raises an exception naming the first broken
-- rule and ends with one row `ok`. The generic checks in 0001_assertions.sql (sections 8 and 9) already cover every table in public;
-- this file adds what is specific to the placement tables and functions.

do $$
declare
  t text;
  r text;
  fn text;
  placement_tables text[] := array['sponsors', 'placements', 'placement_stats_daily', 'placement_page_stats_daily', 'placement_impression_seen'];
  functions text[] := array['public.bump_stat(uuid, date, integer, integer, text)', 'public.record_placement_impressions(date, text, jsonb)', 'public.rollup_placement_clicks(date)'];
begin
  foreach t in array placement_tables loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      raise exception 'ASSERT FAIL: table public.% does not exist', t;
    end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t) then
      raise exception 'ASSERT FAIL: row level security is OFF on public.%', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_any_column_privilege(r, format('public.%I', t), 'SELECT') or has_any_column_privilege(r, format('public.%I', t), 'INSERT')
         or has_any_column_privilege(r, format('public.%I', t), 'UPDATE') or has_table_privilege(r, format('public.%I', t), 'DELETE')
         or has_table_privilege(r, format('public.%I', t), 'TRUNCATE') then
        raise exception 'ASSERT FAIL: role % holds a privilege on public.%', r, t;
      end if;
    end loop;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and (roles && array['anon', 'authenticated', 'public']::name[])) then
      raise exception 'ASSERT FAIL: a policy for anon/authenticated/public exists on public.%', t;
    end if;
    if has_table_privilege('service_role', format('public.%I', t), 'TRUNCATE') then
      raise exception 'ASSERT FAIL: service_role can truncate public.%', t;
    end if;
  end loop;

  -- no hard delete of sponsors, placements or counters (a placement is ended, its counters are the partner report)
  foreach t in array array['sponsors', 'placements', 'placement_stats_daily', 'placement_page_stats_daily'] loop
    if has_table_privilege('service_role', format('public.%I', t), 'DELETE') then
      raise exception 'ASSERT FAIL: service_role can delete from public.% (end a placement, never remove it)', t;
    end if;
    if not (has_table_privilege('service_role', format('public.%I', t), 'SELECT') and has_table_privilege('service_role', format('public.%I', t), 'INSERT') and has_table_privilege('service_role', format('public.%I', t), 'UPDATE')) then
      raise exception 'ASSERT FAIL: service_role lacks select/insert/update on public.%', t;
    end if;
  end loop;
  if not (has_table_privilege('service_role', 'public.placement_impression_seen', 'SELECT') and has_table_privilege('service_role', 'public.placement_impression_seen', 'INSERT') and has_table_privilege('service_role', 'public.placement_impression_seen', 'DELETE')) then
    raise exception 'ASSERT FAIL: service_role lacks select/insert/delete on public.placement_impression_seen';
  end if;

  -- functions: executable by service_role only
  foreach fn in array functions loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE %', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: service_role cannot EXECUTE %', fn;
    end if;
    if exists (select 1 from pg_proc p where p.oid = fn::regprocedure and p.proacl is null) then
      raise exception 'ASSERT FAIL: % has default (PUBLIC) EXECUTE', fn;
    end if;
    if exists (select 1 from pg_proc p where p.oid = fn::regprocedure and p.proconfig is null) then
      raise exception 'ASSERT FAIL: % has no fixed search_path', fn;
    end if;
  end loop;

  -- structural rules the Worker and the admin rely on
  if not exists (select 1 from pg_constraint where conname = 'placements_go_slug_uq' and conrelid = 'public.placements'::regclass) then
    raise exception 'ASSERT FAIL: constraint placements_go_slug_uq is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'placement_impression_seen_pk' and conrelid = 'public.placement_impression_seen'::regclass) then
    raise exception 'ASSERT FAIL: the impression dedupe key is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'placements_active_has_creative' and conrelid = 'public.placements'::regclass) then
    raise exception 'ASSERT FAIL: constraint placements_active_has_creative is missing';
  end if;
  if exists (
    select 1 from pg_depend d
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class v on v.oid = rw.ev_class and v.relkind in ('v', 'm')
    where d.refobjid in (select format('public.%I', x)::regclass::oid from unnest(placement_tables) x)
  ) then
    raise exception 'ASSERT FAIL: a view depends on a placement table (the Worker publishes an explicit-field JSON, not a view)';
  end if;
end
$$;

select 'ok: 0007_placements assertions passed' as result;
