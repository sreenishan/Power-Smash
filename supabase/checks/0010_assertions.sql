-- 0010_assertions.sql - self-check for migration 0010_retention.sql (public.admin_run_retention).
-- It changes nothing: the behaviour test runs in a sub-transaction that is rolled back, with FICTIONAL rows. Ends with one row `ok`.

do $$
declare
  r text := 'public.admin_run_retention(text,boolean)';
  j jsonb;
  j2 jsonb;
  b0 jsonb;
  audit0 integer;
begin
  if has_function_privilege('anon', r, 'EXECUTE') or has_function_privilege('authenticated', r, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE %', r; end if;
  if not has_function_privilege('service_role', r, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot EXECUTE %', r; end if;
  if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = r::regprocedure) then raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path empty', r; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'anonymised_at') then raise exception 'ASSERT FAIL: leads.anonymised_at is missing'; end if;

  -- relative to what is already in the database (the restore drill runs this file on a populated copy)
  select count(*) into audit0 from public.audit_log where action = 'retention_run';

  begin
    execute 'set local role service_role';
    b0 := public.admin_run_retention('fake-retention', true);
    execute 'reset role';
    insert into public.leads (id, ref_code, type, status, name, organization, phone, email, notes, payload, lost_reason, ip_hash, value_paise, source_path, consent_id, consent_version, consent_at)
    values
      ('f1000000-0000-4000-8000-000000000001', 'PS-2020-AAAAAA', 'general', 'lost', 'Fake Old Lost', 'Fake Org', '910000000001', 'a@example.invalid', 'fake note', '{"message":"fake"}', 'fake reason', 'k.0000', 500, '/contact/', 'lead-notice', 'v1', now() - interval '30 months'),
      ('f1000000-0000-4000-8000-000000000002', 'PS-2020-BBBBBB', 'coverage', 'completed', 'Fake Old Done', null, '910000000002', null, null, '{}', null, null, 700, '/book/', 'lead-notice', 'v1', now() - interval '30 months'),
      ('f1000000-0000-4000-8000-000000000003', 'PS-2020-CCCCCC', 'general', 'new', 'Fake Old Open', null, '910000000003', null, null, '{}', null, null, null, null, 'lead-notice', 'v1', now() - interval '30 months'),
      ('f1000000-0000-4000-8000-000000000004', 'PS-2026-DDDDDD', 'general', 'lost', 'Fake New Lost', null, '910000000004', null, null, '{}', null, null, null, null, 'lead-notice', 'v1', now());
    insert into public.rate_limit_hits (bucket, key_hash, hit_at) values ('ip', 'k.old', now() - interval '3 days'), ('ip', 'k.new', now());
    insert into public.daily_salts (day, salt) values (date '2001-01-01', 'fakeold'), (date '2999-12-31', 'fakenew');
    insert into public.suppression (kind, value, reason, created_by) values ('youtube_id', 'fake-ret-1', 'test', 'fake-admin');
    -- the 24 months run from the last change: age the old rows (updated_at is touched by the trigger on every update)
    execute 'alter table public.leads disable trigger leads_touch_updated_at';
    update public.leads set updated_at = now() - interval '30 months' where id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000003');
    execute 'alter table public.leads enable trigger leads_touch_updated_at';

    execute 'set local role service_role';
    begin
      perform public.admin_run_retention('', false);
      raise exception 'ASSERT FAIL: an empty actor was accepted';
    exception when sqlstate '22023' then null;
    end;
    j := public.admin_run_retention('fake-retention', true);
    execute 'reset role';
    if (j ->> 'leads_anonymised')::integer <> (b0 ->> 'leads_anonymised')::integer + 2 or (j ->> 'rate_limit_hits_deleted')::integer <> (b0 ->> 'rate_limit_hits_deleted')::integer + 1 or (j ->> 'daily_salts_deleted')::integer <> (b0 ->> 'daily_salts_deleted')::integer + 1 then raise exception 'ASSERT FAIL: dry run counts wrong: %', j; end if;
    if exists (select 1 from public.leads where anonymised_at is not null and id::text like 'f1000000%') or (select count(*) from public.rate_limit_hits where key_hash in ('k.old', 'k.new')) <> 2 then raise exception 'ASSERT FAIL: a dry run changed data'; end if;
    if (select count(*) from public.audit_log where action = 'retention_run') <> audit0 then raise exception 'ASSERT FAIL: a dry run wrote an audit row'; end if;

    execute 'set local role service_role';
    j := public.admin_run_retention('fake-retention', false);
    j2 := public.admin_run_retention('fake-retention', false);
    execute 'reset role';
    if (j ->> 'leads_anonymised')::integer <> (b0 ->> 'leads_anonymised')::integer + 2 or (j ->> 'rate_limit_hits_deleted')::integer <> (b0 ->> 'rate_limit_hits_deleted')::integer + 1 or (j ->> 'daily_salts_deleted')::integer <> (b0 ->> 'daily_salts_deleted')::integer + 1 then raise exception 'ASSERT FAIL: real run counts wrong: %', j; end if;
    if (j2 ->> 'leads_anonymised')::integer + (j2 ->> 'rate_limit_hits_deleted')::integer + (j2 ->> 'daily_salts_deleted')::integer <> 0 then raise exception 'ASSERT FAIL: the second run was not a no-op: %', j2; end if;
    if exists (select 1 from public.leads where id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002') and (name <> 'Anonymised' or phone is not null or email is not null or organization is not null or notes is not null or lost_reason is not null or ip_hash is not null or payload <> '{}'::jsonb or anonymised_at is null)) then raise exception 'ASSERT FAIL: a closed old lead still holds personal data'; end if;
    if not exists (select 1 from public.leads where id = 'f1000000-0000-4000-8000-000000000001' and ref_code = 'PS-2020-AAAAAA' and type = 'general' and status = 'lost' and value_paise = 500 and source_path = '/contact/') then raise exception 'ASSERT FAIL: counters were not kept'; end if;
    if exists (select 1 from public.leads where id in ('f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000004') and (phone is null or anonymised_at is not null)) then raise exception 'ASSERT FAIL: an open or recent lead was touched'; end if;
    if (select count(*) from public.suppression where value = 'fake-ret-1' and released_at is null) <> 1 then raise exception 'ASSERT FAIL: the tombstone was touched'; end if;
    if (select count(*) from public.audit_log where action = 'retention_run') <> audit0 + 1 then raise exception 'ASSERT FAIL: expected exactly one new audit row'; end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0010_retention assertions passed' as result;
