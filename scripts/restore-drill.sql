-- restore-drill.sql - assertions on a RESTORED database (restore.yml and scripts/restore-drill.mjs run the same file).
-- Read-only. Raises an exception naming the first broken rule; ends with one row `ok: restore drill assertions passed`.
-- Row counts are compared separately (source list versus restored list); this file checks the structure that must survive a restore.

do $$
declare
  t record;
  r text;
  p text;
  n integer;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r';
  if n < 10 then raise exception 'ASSERT FAIL: only % tables in public after the restore (expected the full schema)', n; end if;

  -- row level security is ON for every table in public
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity loop
    raise exception 'ASSERT FAIL: row level security is OFF on public.% after the restore', t.relname;
  end loop;

  -- anon and authenticated hold no privilege on any table, view or sequence in public or app, and cannot use schema app
  for t in
    select c.oid, s.nspname, c.relname, c.relkind from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  loop
    foreach r in array array['anon', 'authenticated'] loop
      if t.relkind = 'S' then
        foreach p in array array['USAGE', 'SELECT', 'UPDATE'] loop
          if has_sequence_privilege(r, t.oid, p) then raise exception 'ASSERT FAIL: % has % on sequence %.%', r, p, t.nspname, t.relname; end if;
        end loop;
      else
        foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
          if has_table_privilege(r, t.oid, p) then raise exception 'ASSERT FAIL: % has % on %.%', r, p, t.nspname, t.relname; end if;
        end loop;
      end if;
    end loop;
  end loop;
  if has_schema_privilege('anon', 'app', 'USAGE') or has_schema_privilege('authenticated', 'app', 'USAGE') then raise exception 'ASSERT FAIL: an API role can use schema app'; end if;

  -- no function in public or app can be executed by anon or authenticated, except none at all (the public read surface is views in schema api)
  for t in
    select f.oid, s.nspname, f.proname from pg_proc f join pg_namespace s on s.oid = f.pronamespace where s.nspname in ('public', 'app')
  loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, t.oid, 'EXECUTE') then raise exception 'ASSERT FAIL: % can EXECUTE %.%', r, t.nspname, t.proname; end if;
    end loop;
  end loop;

  -- the privileged retention and purge functions survived with their grants
  if not has_function_privilege('service_role', 'public.admin_run_retention(text,boolean)', 'EXECUTE') then raise exception 'ASSERT FAIL: service_role lost EXECUTE on admin_run_retention'; end if;
end
$$;

select 'ok: restore drill assertions passed' as result;
