-- 0001_assertions.sql - self-check for migration 0001_lead_funnel.sql.
-- Run it after applying the migration: paste it into the Supabase dashboard SQL editor (no tools needed).
-- It changes nothing. It raises an exception naming the first rule that is broken, and ends with one row `ok`.
-- Sections 8 and 9 look at EVERY table in schema public and at the default privileges, so a table added by any later migration
-- is checked without editing this file (S-16).
-- Complements the API-level test: `node scripts/anon-harness.mjs` (publishable key, no secrets).

do $$
declare
  t text;
  r text;
  p text;
  fn record;
  col record;
  tbl record;
  acl record;
  private_tables text[] := array['leads', 'lead_events', 'events', 'outbound_clicks', 'rate_limit_hits', 'daily_salts'];
begin
  foreach t in array private_tables loop
    -- 1. the table exists and row level security is on (and forced off for nobody: owner bypass is Postgres default)
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      raise exception 'ASSERT FAIL: table public.% does not exist', t;
    end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t) then
      raise exception 'ASSERT FAIL: row level security is OFF on public.%', t;
    end if;

    -- 2. anon and authenticated have no table privilege at all
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, format('public.%I', t), p) then
          raise exception 'ASSERT FAIL: role % has % on public.%', r, p, t;
        end if;
      end loop;
      -- column-level grants too
      for col in
        select a.attname from pg_attribute a
        where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
          and (has_column_privilege(r, format('public.%I', t), a.attname, 'SELECT')
            or has_column_privilege(r, format('public.%I', t), a.attname, 'INSERT')
            or has_column_privilege(r, format('public.%I', t), a.attname, 'UPDATE')
            or has_column_privilege(r, format('public.%I', t), a.attname, 'REFERENCES'))
      loop
        raise exception 'ASSERT FAIL: role % has a column privilege on public.%.%', r, t, col.attname;
      end loop;
    end loop;

    -- 3. no policy exists that applies to anon, authenticated or public
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and (roles && array['anon', 'authenticated', 'public']::name[])
    ) then
      raise exception 'ASSERT FAIL: a row level security policy for anon/authenticated/public exists on public.%', t;
    end if;
  end loop;

  -- 4. service_role has exactly the privileges the Worker needs
  if not (has_table_privilege('service_role', 'public.leads', 'SELECT') and has_table_privilege('service_role', 'public.leads', 'INSERT') and has_table_privilege('service_role', 'public.leads', 'UPDATE')) then
    raise exception 'ASSERT FAIL: service_role lacks select/insert/update on public.leads';
  end if;
  if has_table_privilege('service_role', 'public.leads', 'DELETE') or has_table_privilege('service_role', 'public.leads', 'TRUNCATE') then
    raise exception 'ASSERT FAIL: service_role can delete from public.leads (retention anonymises, it does not delete)';
  end if;
  if not (has_table_privilege('service_role', 'public.lead_events', 'SELECT') and has_table_privilege('service_role', 'public.lead_events', 'INSERT')) then
    raise exception 'ASSERT FAIL: service_role lacks select/insert on public.lead_events';
  end if;
  if not has_table_privilege('service_role', 'public.events', 'INSERT') or not has_table_privilege('service_role', 'public.outbound_clicks', 'INSERT') then
    raise exception 'ASSERT FAIL: service_role lacks insert on public.events or public.outbound_clicks';
  end if;
  if not (has_table_privilege('service_role', 'public.rate_limit_hits', 'SELECT') and has_table_privilege('service_role', 'public.rate_limit_hits', 'INSERT') and has_table_privilege('service_role', 'public.rate_limit_hits', 'DELETE')) then
    raise exception 'ASSERT FAIL: service_role lacks select/insert/delete on public.rate_limit_hits';
  end if;
  if not (has_table_privilege('service_role', 'public.daily_salts', 'SELECT') and has_table_privilege('service_role', 'public.daily_salts', 'INSERT') and has_table_privilege('service_role', 'public.daily_salts', 'DELETE')) then
    raise exception 'ASSERT FAIL: service_role lacks select/insert/delete on public.daily_salts';
  end if;

  -- 5. schema app and its functions are closed to the API roles
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'app', 'USAGE') then
      raise exception 'ASSERT FAIL: role % has USAGE on schema app', r;
    end if;
  end loop;
  for fn in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'
  loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, fn.oid, 'EXECUTE') then
        raise exception 'ASSERT FAIL: role % can EXECUTE app.%', r, fn.proname;
      end if;
    end loop;
    if exists (select 1 from pg_proc p where p.oid = fn.oid and p.proacl is null) then
      raise exception 'ASSERT FAIL: app.% has default (PUBLIC) EXECUTE', fn.proname;
    end if;
  end loop;

  -- 6. the uniqueness the endpoint relies on
  if not exists (select 1 from pg_constraint where conname = 'leads_idempotency_key_uq' and conrelid = 'public.leads'::regclass) then
    raise exception 'ASSERT FAIL: constraint leads_idempotency_key_uq is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_ref_code_uq' and conrelid = 'public.leads'::regclass) then
    raise exception 'ASSERT FAIL: constraint leads_ref_code_uq is missing';
  end if;

  -- 7. no view in public selects from the private tables (public data leaves only through api views, D-005)
  if exists (
    select 1 from pg_depend d
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class v on v.oid = rw.ev_class and v.relkind in ('v', 'm')
    join pg_namespace vn on vn.oid = v.relnamespace
    where d.refobjid in (select format('public.%I', x)::regclass::oid from unnest(private_tables) x)
      and vn.nspname not in ('pg_catalog', 'information_schema')
  ) then
    raise exception 'ASSERT FAIL: a view depends on a private lead table (expose only through explicit-column api views)';
  end if;

  -- 8. EVERY table, view and foreign table in schema public, not just the ones named above (S-16): a table added later and
  --    forgotten in the lists at the top is still caught here. RLS must be on, and anon and authenticated hold nothing.
  for tbl in
    select c.oid, c.relname, c.relkind, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if tbl.relkind in ('r', 'p') and not tbl.relrowsecurity then
      raise exception 'ASSERT FAIL: row level security is OFF on public.%', tbl.relname;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, tbl.oid, p) then
          raise exception 'ASSERT FAIL: role % has % on public.% (every object in public is private; public data leaves only through api views)', r, p, tbl.relname;
        end if;
      end loop;
      if has_any_column_privilege(r, tbl.oid, 'SELECT') or has_any_column_privilege(r, tbl.oid, 'INSERT')
         or has_any_column_privilege(r, tbl.oid, 'UPDATE') or has_any_column_privilege(r, tbl.oid, 'REFERENCES') then
        raise exception 'ASSERT FAIL: role % has a column privilege on public.%', r, tbl.relname;
      end if;
    end loop;
    if tbl.relkind in ('r', 'p') and exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl.relname
        and (roles && array['anon', 'authenticated', 'public']::name[])
    ) then
      raise exception 'ASSERT FAIL: a row level security policy for anon/authenticated/public exists on public.%', tbl.relname;
    end if;
  end loop;

  -- 9. default privileges: what the role `postgres` creates in public from now on is NOT granted to anon or authenticated
  --    (nor, for functions, to PUBLIC). Other creator roles are only reported (supabase_admin may carry Supabase's own defaults).
  for acl in
    select d.defaclobjtype as objtype, d.defaclrole::regrole::text as creator, a.privilege_type as privilege,
           coalesce(g.rolname, 'PUBLIC') as grantee
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    left join pg_roles g on g.oid = a.grantee
    where n.nspname = 'public'
  loop
    if acl.grantee in ('anon', 'authenticated') or (acl.objtype = 'f' and acl.grantee = 'PUBLIC') then
      if acl.creator = 'postgres' then
        raise exception 'ASSERT FAIL: default privileges let % grant % on new objects (type %) in public to %', acl.creator, acl.privilege, acl.objtype, acl.grantee;
      else
        raise notice 'NOTE: default privileges of role % in public grant % (object type %) to %: check who creates objects with that role', acl.creator, acl.privilege, acl.objtype, acl.grantee;
      end if;
    end if;
  end loop;
end
$$;

select 'ok: 0001_lead_funnel assertions passed' as result;
