-- 0002_assertions.sql - self-check for migration 0002_consent_records.sql (notice_versions, consent_events).
-- Run it after applying 0002 (and after 0001_assertions.sql, whose sections 8 and 9 already check anon and authenticated on
-- every table in public): paste it into the Supabase dashboard SQL editor. It changes nothing. It raises an exception naming
-- the first rule that is broken, and ends with one row `ok`.

do $$
declare
  t text;
  trg text;
  has_trigger boolean;
  tables text[] := array['notice_versions', 'consent_events'];
begin
  foreach t in array tables loop
    -- 1. exists, row level security on, no policy for the API roles
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      raise exception 'ASSERT FAIL: table public.% does not exist', t;
    end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t) then
      raise exception 'ASSERT FAIL: row level security is OFF on public.%', t;
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and (roles && array['anon', 'authenticated', 'public']::name[])
    ) then
      raise exception 'ASSERT FAIL: a row level security policy for anon/authenticated/public exists on public.%', t;
    end if;

    -- 2. anon and authenticated hold nothing
    if has_table_privilege('anon', format('public.%I', t), 'SELECT') or has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('anon', format('public.%I', t), 'INSERT') or has_table_privilege('authenticated', format('public.%I', t), 'INSERT') then
      raise exception 'ASSERT FAIL: anon or authenticated can read or write public.%', t;
    end if;

    -- 3. service_role can read and append, and nothing else: no update, no delete, no truncate (append-only, D-028)
    if not (has_table_privilege('service_role', format('public.%I', t), 'SELECT') and has_table_privilege('service_role', format('public.%I', t), 'INSERT')) then
      raise exception 'ASSERT FAIL: service_role lacks select/insert on public.%', t;
    end if;
    if has_table_privilege('service_role', format('public.%I', t), 'UPDATE')
       or has_table_privilege('service_role', format('public.%I', t), 'DELETE')
       or has_table_privilege('service_role', format('public.%I', t), 'TRUNCATE') then
      raise exception 'ASSERT FAIL: service_role can update, delete or truncate public.% (it must be append-only)', t;
    end if;

    -- 4. the triggers that refuse history changes even for the table owner exist: one for update/delete, one for truncate
    for trg in select unnest(array[t || '_append_only', t || '_no_truncate']) loop
      select exists (
        select 1 from pg_trigger g
        where g.tgrelid = format('public.%I', t)::regclass and g.tgname = trg and not g.tgisinternal
      ) into has_trigger;
      if not has_trigger then
        raise exception 'ASSERT FAIL: trigger % is missing on public.%', trg, t;
      end if;
    end loop;
  end loop;

  -- 5. the database re-computes the notice hash
  if not exists (select 1 from pg_constraint where conname = 'notice_versions_sha256_matches' and conrelid = 'public.notice_versions'::regclass) then
    raise exception 'ASSERT FAIL: constraint notice_versions_sha256_matches is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notice_versions_pk' and conrelid = 'public.notice_versions'::regclass) then
    raise exception 'ASSERT FAIL: primary key notice_versions_pk (id, version) is missing';
  end if;

  -- 6. N-4: the append-only evidence table carries NO IP hash (the leads row holds it and can be anonymised)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consent_events' and column_name = 'ip_hash'
  ) then
    raise exception 'ASSERT FAIL: public.consent_events has an ip_hash column; it must not (append-only evidence cannot be anonymised)';
  end if;

  -- 7. the trigger function is closed to the API roles
  if has_function_privilege('anon', 'app.forbid_row_change()', 'EXECUTE') or has_function_privilege('authenticated', 'app.forbid_row_change()', 'EXECUTE') then
    raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE app.forbid_row_change()';
  end if;
end
$$;

select 'ok: 0002_consent_records assertions passed' as result;
