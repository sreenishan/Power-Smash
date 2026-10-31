-- 0025_assertions.sql - self-check for migration 0025_platform_retention.sql (the owner's keep-for periods for registrations and email
-- sign-ups, and the job that removes what is past them). Run it after applying 0001..0025. It changes nothing: the behaviour tests run
-- in a sub-transaction that is rolled back, with FICTIONAL people, addresses and dates in 2001 (older than any real record, so the
-- restore drill can run this file on a populated copy). It raises an exception naming the first broken rule and ends with one row `ok`.

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

-- the answer of a run: the expected counts, in one line
create function pg_temp.expect_counts(p_answer jsonb, p_expected jsonb, p_label text) returns void language plpgsql as $f$
declare
  k text;
begin
  for k in select jsonb_object_keys(p_expected) loop
    if (p_answer -> k) is distinct from (p_expected -> k) then
      raise exception 'ASSERT FAIL: %: % is % (expected %) in %', p_label, k, p_answer -> k, p_expected -> k, p_answer;
    end if;
  end loop;
end
$f$;

-- ------------------------------------------------------------------------------------------------------------------
-- A. structure
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
  fn text;
  owner_rpcs text[] := array['public.admin_set_platform_retention(text,jsonb,text)', 'public.admin_platform_retention_summary(text)'];
  system_rpcs text[] := array['public.admin_run_platform_retention(text,boolean)'];
  internal text[] := array['app.event_registration_frozen()', 'app.notify_email_hash(text)', 'app.notify_email_unsubscribed(text)', 'app.platform_retention_candidates(timestamptz)',
    'app.platform_retention(text,boolean,timestamptz)'];
begin
  foreach t in array array['retention_settings', 'notify_unsubscribe_hashes', 'event_registrations'] loop
    if not coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'public' and cl.relname = t and cl.relkind = 'r'), false) then
      raise exception 'ASSERT FAIL: RLS is off on %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then raise exception 'ASSERT FAIL: % has a policy (house rule: none)', t; end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('anon', format('public.%I', t), p) or has_table_privilege('authenticated', format('public.%I', t), p) then
        raise exception 'ASSERT FAIL: anon or authenticated holds % on %', p, t;
      end if;
    end loop;
    if not has_table_privilege('service_role', format('public.%I', t), 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read %', t; end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege('service_role', format('public.%I', t), p) then raise exception 'ASSERT FAIL: service_role holds % on % (writes go through the RPCs)', p, t; end if;
    end loop;
  end loop;
  -- nothing here is public
  if exists (select 1 from pg_views where schemaname = 'api' and (definition ~ 'retention_settings' or definition ~ 'notify_unsubscribe_hashes')) then
    raise exception 'ASSERT FAIL: an api view reads the retention tables';
  end if;

  foreach fn in array owner_rpcs || system_rpcs loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
  end loop;
  foreach fn in array owner_rpcs loop
    if (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure) !~ '\mbegin\s+perform app\.require_owner\(p_actor\);' then
      raise exception 'ASSERT FAIL: % does not call app.require_owner first', fn;
    end if;
  end loop;
  foreach fn in array internal loop
    if not (select 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then raise exception 'ASSERT FAIL: % has no fixed search_path', fn; end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: a role can run the internal function %', fn;
    end if;
  end loop;

  -- the periods start EMPTY (= never remove): no legal period is defaulted
  if (select count(*) from public.retention_settings) <> 1 then raise exception 'ASSERT FAIL: retention_settings must hold exactly one row'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'retention_settings'
              and column_name in ('registration_keep_days', 'subscriber_keep_days') and column_default is not null) then
    raise exception 'ASSERT FAIL: a keep-for period has a default';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'event_registrations' and column_name = 'anonymised_at') then
    raise exception 'ASSERT FAIL: event_registrations.anonymised_at is missing';
  end if;
  -- keeping a hash of a deleted unsubscribed address is its own switch, OFF by default (the lawyer decides, D-127)
  if (select keep_unsubscribe_hash from public.retention_settings where id = 1) is distinct from false
     or (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'retention_settings' and column_name = 'keep_unsubscribe_hash') is distinct from 'false' then
    raise exception 'ASSERT FAIL: keeping unsubscribe hashes is not off by default';
  end if;
  -- an anonymised registration is frozen by a trigger
  if not exists (select 1 from pg_trigger where tgrelid = 'public.event_registrations'::regclass and tgname = 'event_registrations_anonymised_frozen' and not tgisinternal) then
    raise exception 'ASSERT FAIL: the trigger that freezes anonymised registrations is missing';
  end if;
  -- the hash table holds a hash and a day: nothing that points back at a person's row
  if (select array_agg(c.column_name::text order by c.ordinal_position) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'notify_unsubscribe_hashes')
     is distinct from array['email_sha256', 'kept_on'] then
    raise exception 'ASSERT FAIL: notify_unsubscribe_hashes holds more than the hash and the day';
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
  v_ed text := '22222222-2222-4222-8222-222222222222';
  t1 uuid := 'c0250000-0000-4000-8000-000000000001';
  t2 uuid := 'c0250000-0000-4000-8000-000000000002';
  e1 uuid := 'c0250000-0000-4000-8000-000000000011';
  e2 uuid := 'c0250000-0000-4000-8000-000000000012';
  e3 uuid := 'c0250000-0000-4000-8000-000000000013';
  p1 uuid := 'c0250000-0000-4000-8000-000000000021';
  p2 uuid := 'c0250000-0000-4000-8000-000000000022';
  p3 uuid := 'c0250000-0000-4000-8000-000000000023';
  en1 uuid := 'c0250000-0000-4000-8000-000000000031';
  en2 uuid := 'c0250000-0000-4000-8000-000000000032';
  r1 uuid := 'c0250000-0000-4000-8000-000000000041';
  r2 uuid := 'c0250000-0000-4000-8000-000000000042';
  r3 uuid := 'c0250000-0000-4000-8000-000000000043';
  r4 uuid := 'c0250000-0000-4000-8000-000000000044';
  r5 uuid := 'c0250000-0000-4000-8000-000000000045';
  r6 uuid := 'c0250000-0000-4000-8000-000000000046';
  r7 uuid := 'c0250000-0000-4000-8000-000000000047';
  r8 uuid := 'c0250000-0000-4000-8000-000000000048';
  s1 uuid := 'c0250000-0000-4000-8000-000000000051';
  s2 uuid := 'c0250000-0000-4000-8000-000000000052';
  s3 uuid := 'c0250000-0000-4000-8000-000000000053';
  s4 uuid := 'c0250000-0000-4000-8000-000000000054';
  s5 uuid := 'c0250000-0000-4000-8000-000000000055';
  s6 uuid := 'c0250000-0000-4000-8000-000000000056';
  s7 uuid := 'c0250000-0000-4000-8000-000000000057';
  s8 uuid := 'c0250000-0000-4000-8000-000000000058';
  -- the boundaries: the event's last day is 2001-01-10, so it is over at 2001-01-11 00:00 India time; + 30 days
  b_reg constant timestamptz := '2001-02-10 00:00:00+05:30';
  -- r6 was rejected after the event (2001-01-20 00:00 India time): its own 30 days end later
  b_late constant timestamptz := '2001-02-19 00:00:00+05:30';
  -- sign-ups: the last confirmation email / the unsubscribe on 2001-03-01 00:00 UTC; + 10 days
  b_sub constant timestamptz := '2001-03-11 00:00:00+00';
  consent constant text := 'Fictional registration notice text for the retention check.';
  j jsonb;
  audit0 integer;
  rev0 integer;
  n integer;
begin
  begin
    select count(*) into audit0 from public.audit_log where action = 'platform_retention_run';
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    -- the test sets the periods itself (a populated copy may hold the owner's own)
    update public.retention_settings set registration_keep_days = null, subscriber_keep_days = null, keep_unsubscribe_hash = false where id = 1;

    -- ---------------------------------------------------------------- the workflow's wrapper: service_role only, dry by default
    execute 'set local role service_role';
    j := public.admin_run_platform_retention('fake-retention');
    execute 'reset role';
    if (j ->> 'dry_run')::boolean is not true then raise exception 'ASSERT FAIL: the wrapper is not a dry run by default: %', j; end if;
    perform pg_temp.expect_code($q$select app.platform_retention('', true, now())$q$, 'INVALID', 'an empty actor');
    perform pg_temp.expect_code($q$select app.platform_retention('fake-retention', null, now())$q$, 'INVALID', 'a null dry-run flag');
    perform pg_temp.expect_code($q$select app.platform_retention('fake-retention', true, null)$q$, 'INVALID', 'a null time');

    -- ---------------------------------------------------------------- fictional data
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility, start_date, end_date) values
      (t1, 'fake-retention-open-2001', 'Fake Retention Open', 'fake retention open', 2001, 'tamil_nadu', 'completed', 'public', date '2001-01-08', date '2001-01-10'),
      (t2, 'fake-retention-undated', 'Fake Retention Undated', 'fake retention undated', 2001, 'tamil_nadu', 'completed', 'public', null, null);
    insert into public.tournament_events (id, tournament_id, category, format, status) values
      (e1, t1, 'MS', 'knockout', 'closed'), (e2, t1, 'MD', 'knockout', 'closed'), (e3, t2, 'MS', 'knockout', 'closed');
    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (p1, 'Fake Ret Alpha', 'fake ret alpha', 'multi_token'), (p2, 'Fake Ret Bravo', 'fake ret bravo', 'multi_token'), (p3, 'Fake Ret Charlie', 'fake ret charlie', 'multi_token');
    insert into public.event_entries (id, event_id, player1_id, player2_id, status) values (en1, e1, p1, null, 'confirmed'), (en2, e2, p2, p3, 'confirmed');
    insert into public.event_registrations (id, ref, idempotency_key, event_id, player1_name, player2_name, contact_phone, contact_email, whatsapp_ok,
        payment_reference, fee_paise_at_submit, consent_id, consent_version, consent_at, ip_hash, status,
        payment_verified_amount_paise, payment_verified_by, payment_verified_at, entry_id, converted_by, converted_at, rejected_reason, rejected_by, rejected_at, created_at)
    values
      -- converted, paid: anonymised, the entry stays
      (r1, 'PSR-2001-AAAAA1', gen_random_uuid(), e1, 'Fake Ret Alpha', null, '910000000001', 'alpha@example.test', true, 'UTR0000111122', 50000,
        'registration-notice', 'fake-v1', '2001-01-01 10:00+05:30', 'fakeiphash0001', 'converted', 50000, 'fake-owner', '2001-01-03 10:00+05:30', en1, 'fake-owner', '2001-01-05 10:00+05:30', null, null, null, '2001-01-01 10:00+05:30'),
      -- rejected, nothing paid: deleted
      (r2, 'PSR-2001-AAAAA2', gen_random_uuid(), e1, 'Fake Ret Delta', null, '910000000002', null, false, null, null,
        'registration-notice', 'fake-v1', '2001-01-01 10:00+05:30', null, 'rejected', null, null, null, null, null, null, 'Fake reason', 'fake-owner', '2001-01-02 10:00+05:30', '2001-01-01 10:00+05:30'),
      -- rejected after a verified payment: anonymised (the money record stays)
      (r3, 'PSR-2001-AAAAA3', gen_random_uuid(), e1, 'Fake Ret Echo', null, '910000000003', 'echo@example.test', true, 'UTR0000333344', 50000,
        'registration-notice', 'fake-v1', '2001-01-01 10:00+05:30', null, 'rejected', 50000, 'fake-owner', '2001-01-02 09:00+05:30', null, null, null, 'Fake reason two', 'fake-owner', '2001-01-02 10:00+05:30', '2001-01-01 10:00+05:30'),
      -- never processed, nothing paid, the event is over: deleted
      (r4, 'PSR-2001-AAAAA4', gen_random_uuid(), e1, 'Fake Ret Golf', null, '910000000004', null, false, null, null,
        'registration-notice', 'fake-v1', '2001-01-01 10:00+05:30', null, 'submitted', null, null, null, null, null, null, null, null, null, '2001-01-01 10:00+05:30'),
      -- payment verified but never converted, the event is over: anonymised
      (r5, 'PSR-2001-AAAAA5', gen_random_uuid(), e1, 'Fake Ret Hotel', null, '910000000005', null, false, 'UTR0000555566', 50000,
        'registration-notice', 'fake-v1', '2001-01-01 10:00+05:30', null, 'payment_verified', 50000, 'fake-owner', '2001-01-03 10:00+05:30', null, null, null, null, null, null, '2001-01-01 10:00+05:30'),
      -- rejected AFTER the event: its clock starts at the rejection
      (r6, 'PSR-2001-AAAAA6', gen_random_uuid(), e1, 'Fake Ret India', null, '910000000006', null, false, null, null,
        'registration-notice', 'fake-v1', '2001-01-01 10:00+05:30', null, 'rejected', null, null, null, null, null, null, 'Fake reason three', 'fake-owner', '2001-01-20 00:00+05:30', '2001-01-01 10:00+05:30'),
      -- the tournament has no date: never removed, only counted
      (r7, 'PSR-2001-AAAAA7', gen_random_uuid(), e3, 'Fake Ret Juliet', null, '910000000007', null, false, null, null,
        'registration-notice', 'fake-v1', '2000-05-01 10:00+05:30', null, 'rejected', null, null, null, null, null, null, 'Fake reason four', 'fake-owner', '2000-06-01 10:00+05:30', '2000-05-01 10:00+05:30'),
      -- a pair, converted, no fee: anonymised, still two players
      (r8, 'PSR-2001-AAAAA8', gen_random_uuid(), e2, 'Fake Ret Bravo', 'Fake Ret Charlie', '910000000008', 'bravo@example.test', true, null, null,
        'registration-notice', 'fake-v1', '2001-01-01 10:00+05:30', 'fakeiphash0008', 'converted', null, null, null, en2, 'fake-owner', '2001-01-06 10:00+05:30', null, null, null, '2001-01-01 10:00+05:30');

    -- ---------------------------------------------------------------- periods empty (the default) = nothing is removed, ever
    j := app.platform_retention('fake-retention', false, timestamptz '2099-12-31 00:00:00+00');
    perform pg_temp.expect_counts(j, '{"registration_keep_days": null, "subscriber_keep_days": null, "registrations_anonymised": 0, "registrations_deleted": 0,
      "registrations_without_event_date": 0, "subscribers_unconfirmed_deleted": 0, "subscribers_unsubscribed_deleted": 0, "unsubscribe_hashes_kept": 0, "outbox_rows_removed": 0}', 'empty periods');
    if (select count(*) from public.event_registrations where id in (r1, r2, r3, r4, r5, r6, r7, r8) and anonymised_at is null and contact_phone is not null) <> 8 then
      raise exception 'ASSERT FAIL: an empty period removed something';
    end if;
    if (select count(*) from public.audit_log where action = 'platform_retention_run') <> audit0 then raise exception 'ASSERT FAIL: a run that changed nothing wrote an audit row'; end if;

    -- ---------------------------------------------------------------- the owner's setting: owner only, a reason, whole days in range, null allowed
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'r')$q$, v_ed), 'FORBIDDEN', 'an editor setting a period');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'r')$q$, 'fake-not-a-uuid'), 'FORBIDDEN', 'a non-owner actor');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', ' ')$q$, v_actor), 'INVALID', 'no reason');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 6, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'r')$q$, v_actor), 'INVALID', 'registrations below 7 days');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 3651, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'r')$q$, v_actor), 'INVALID', 'registrations above 3650 days');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": null, "subscriberKeepDays": 0, "keepUnsubscribeHash": false}', 'r')$q$, v_actor), 'INVALID', 'sign-ups below 1 day');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30.5, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'r')$q$, v_actor), 'INVALID', 'a fraction of a day');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": "30", "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'r')$q$, v_actor), 'INVALID', 'days as text');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30}', 'r')$q$, v_actor), 'INVALID', 'a missing period');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30, "subscriberKeepDays": null}', 'r')$q$, v_actor), 'INVALID', 'no answer about keeping the hash');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30, "subscriberKeepDays": null, "keepUnsubscribeHash": "yes"}', 'r')$q$, v_actor), 'INVALID', 'the hash answer as text');
    perform pg_temp.expect_code(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30, "subscriberKeepDays": null, "leadKeepDays": 1}', 'r')$q$, v_actor), 'INVALID', 'an unknown field');
    j := public.admin_set_platform_retention(v_actor, '{"registrationKeepDays": 30, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'fake lawyer advice');
    if j -> 'fields' <> '["registrationKeepDays"]'::jsonb or (select registration_keep_days from public.retention_settings where id = 1) <> 30 then
      raise exception 'ASSERT FAIL: setting the registration period answered %', j;
    end if;
    if not exists (select 1 from public.audit_log where actor = v_actor and action = 'set_platform_retention' and diff -> 'fields' = '["registrationKeepDays"]'::jsonb and (diff ->> 'registration_keep_days')::integer = 30) then
      raise exception 'ASSERT FAIL: the period change was not audited with its field name';
    end if;
    j := public.admin_set_platform_retention(v_actor, '{"registrationKeepDays": 30, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'fake again');
    if j -> 'fields' <> '[]'::jsonb then raise exception 'ASSERT FAIL: an unchanged setting reported a change'; end if;

    -- ---------------------------------------------------------------- registrations: the exact boundary
    j := app.platform_retention('fake-retention', true, b_reg - interval '1 second');
    perform pg_temp.expect_counts(j, '{"dry_run": true, "registration_keep_days": 30, "registrations_anonymised": 0, "registrations_deleted": 0, "registrations_without_event_date": 1}', 'one second before the boundary');
    j := app.platform_retention('fake-retention', true, b_reg);
    perform pg_temp.expect_counts(j, '{"dry_run": true, "registrations_anonymised": 4, "registrations_deleted": 2, "registrations_without_event_date": 1}', 'dry run at the boundary');
    -- the dry run changed nothing and wrote nothing
    if (select count(*) from public.event_registrations where id in (r1, r2, r3, r4, r5, r6, r7, r8) and anonymised_at is null and contact_phone is not null) <> 8 then
      raise exception 'ASSERT FAIL: a dry run changed a registration';
    end if;
    if (select count(*) from public.audit_log where action = 'platform_retention_run') <> audit0 then raise exception 'ASSERT FAIL: a dry run wrote an audit row'; end if;
    -- the answer holds numbers only
    if j::text ~ '@|9100000|Fake|PSR-|c0250000' then raise exception 'ASSERT FAIL: the answer holds personal data or ids: %', j; end if;

    select revision into rev0 from public.event_registrations where id = r1;
    j := app.platform_retention('fake-retention', false, b_reg);
    perform pg_temp.expect_counts(j, '{"dry_run": false, "registrations_anonymised": 4, "registrations_deleted": 2, "registrations_without_event_date": 1}', 'real run at the boundary');
    -- contact data gone; the entry, the money and the consent evidence kept
    if not exists (select 1 from public.event_registrations r where r.id = r1 and r.player1_name = 'Anonymised' and r.player2_name is null and r.contact_phone is null and r.contact_email is null
                     and r.payment_reference is null and r.ip_hash is null and r.whatsapp_ok = false and r.anonymised_at = b_reg and r.status = 'converted' and r.entry_id = en1
                     and r.payment_verified_amount_paise = 50000 and r.fee_paise_at_submit = 50000 and r.ref = 'PSR-2001-AAAAA1' and r.consent_id = 'registration-notice'
                     and r.consent_version = 'fake-v1' and r.revision = rev0 + 1) then
      raise exception 'ASSERT FAIL: the converted registration was not anonymised correctly';
    end if;
    if not exists (select 1 from public.event_registrations r where r.id = r8 and r.player1_name = 'Anonymised' and r.player2_name = 'Anonymised partner' and r.contact_phone is null and r.entry_id = en2) then
      raise exception 'ASSERT FAIL: the converted pair was not anonymised correctly';
    end if;
    if not exists (select 1 from public.event_registrations r where r.id = r3 and r.status = 'rejected' and r.rejected_reason = 'Removed after the keep-for period' and r.contact_phone is null and r.payment_verified_amount_paise = 50000) then
      raise exception 'ASSERT FAIL: the paid rejected registration was not anonymised correctly';
    end if;
    if not exists (select 1 from public.event_registrations r where r.id = r5 and r.status = 'payment_verified' and r.contact_phone is null and r.payment_reference is null) then
      raise exception 'ASSERT FAIL: the paid lapsed registration was not anonymised';
    end if;
    if exists (select 1 from public.event_registrations where id in (r2, r4)) then raise exception 'ASSERT FAIL: an unpaid closed registration was not deleted'; end if;
    if (select count(*) from public.event_registrations where id in (r6, r7) and anonymised_at is null and contact_phone is not null) <> 2 then
      raise exception 'ASSERT FAIL: a registration that is not due yet (or has no event date) was touched';
    end if;
    if (select count(*) from public.event_entries where id in (en1, en2)) <> 2 or (select count(*) from public.players where id in (p1, p2, p3)) <> 3 then
      raise exception 'ASSERT FAIL: an entry or a player was removed';
    end if;
    if exists (select 1 from public.event_registrations where id in (r1, r3, r5, r8) and (player1_name ~ 'Fake' or coalesce(player2_name, '') ~ 'Fake')) then
      raise exception 'ASSERT FAIL: a typed name survived anonymisation';
    end if;
    -- one audit row, counts only
    if (select count(*) from public.audit_log where action = 'platform_retention_run') <> audit0 + 1 then raise exception 'ASSERT FAIL: expected exactly one new audit row'; end if;
    if exists (select 1 from public.audit_log where action = 'platform_retention_run' and (diff::text ~ '@|9100000|Fake|PSR-|c0250000|UTR' or coalesce(entity_id, '') <> '')) then
      raise exception 'ASSERT FAIL: the retention audit row holds personal data or ids';
    end if;
    -- idempotent
    j := app.platform_retention('fake-retention', false, b_reg);
    perform pg_temp.expect_counts(j, '{"registrations_anonymised": 0, "registrations_deleted": 0}', 'a second run');
    if (select count(*) from public.audit_log where action = 'platform_retention_run') <> audit0 + 1 then raise exception 'ASSERT FAIL: a second run wrote an audit row'; end if;
    -- a registration closed after the event: its own boundary
    j := app.platform_retention('fake-retention', true, b_late - interval '1 second');
    perform pg_temp.expect_counts(j, '{"registrations_deleted": 0}', 'before the late boundary');
    j := app.platform_retention('fake-retention', false, b_late);
    perform pg_temp.expect_counts(j, '{"registrations_deleted": 1, "registrations_anonymised": 0}', 'at the late boundary');
    if exists (select 1 from public.event_registrations where id = r6) then raise exception 'ASSERT FAIL: the late rejected registration was not deleted'; end if;
    if not exists (select 1 from public.event_registrations where id = r7 and contact_phone = '910000000007') then raise exception 'ASSERT FAIL: an undated registration was removed'; end if;
    -- an anonymised row is frozen: the owner's RPCs cannot reject, verify or convert it (no player called 'Anonymised')
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_reject_registration(%L, %L, %s, 'fake late reject')$q$, v_actor, r5,
      (select revision from public.event_registrations where id = r5)), 'INVALID', 'rejecting an anonymised registration');
    execute 'reset role';
    perform pg_temp.expect_code(format($q$update public.event_registrations set status = 'converted', entry_id = %L where id = %L$q$, en1, r5), 'INVALID', 'converting an anonymised registration');
    begin
      update public.event_registrations set status = 'rejected' where id = r5;
      raise exception 'ASSERT FAIL: an anonymised registration was changed';
    exception when others then
      if sqlerrm !~ 'keep-for period' then raise exception 'ASSERT FAIL: the frozen refusal is not plain: %', sqlerrm; end if;
    end;
    if not exists (select 1 from public.event_registrations where id = r5 and status = 'payment_verified' and anonymised_at is not null) then
      raise exception 'ASSERT FAIL: the anonymised registration changed';
    end if;
    -- the check covers the partner name too
    perform pg_temp.expect_fail(format($q$alter table public.event_registrations disable trigger event_registrations_anonymised_frozen; update public.event_registrations set player2_name = 'Fake Ret Bravo' where id = %L$q$, r8), 'a typed partner name on an anonymised row');
    -- an anonymised row cannot get its contact data back, and an ordinary row cannot lose it
    perform pg_temp.expect_fail(format($q$update public.event_registrations set contact_phone = '910000000009' where id = %L$q$, r1), 'a phone on an anonymised row');
    perform pg_temp.expect_fail(format($q$update public.event_registrations set contact_phone = null where id = %L$q$, r7), 'an ordinary row without a phone');

    -- ---------------------------------------------------------------- email sign-ups
    insert into public.notify_subscribers (id, email, status, consent_id, consent_version, consent_at, confirm_token_hash, confirm_expires_at, last_confirmation_at, confirmed_at, unsubscribed_at, created_at) values
      -- never confirmed, the link expired 2001-03-03: deleted at 2001-03-11
      (s1, 'fake.pending@example.test', 'pending', 'email-updates-notice', 'fake-v1', '2001-03-01 00:00+00', repeat('d', 64), '2001-03-03 00:00+00', '2001-03-01 00:00+00', null, null, '2001-03-01 00:00+00'),
      -- unsubscribed 2001-03-01: deleted at 2001-03-11, hash kept, its old outbox rows go with it
      (s2, 'fake.gone@example.test', 'unsubscribed', 'email-updates-notice', 'fake-v1', '2001-01-01 00:00+00', null, null, '2001-01-01 00:00+00', '2001-01-01 01:00+00', '2001-03-01 00:00+00', '2001-01-01 00:00+00'),
      -- active: never touched
      (s3, 'fake.active@example.test', 'active', 'email-updates-notice', 'fake-v1', '2000-01-01 00:00+00', null, null, '2000-01-01 00:00+00', '2000-01-01 01:00+00', null, '2000-01-01 00:00+00'),
      -- unsubscribed but an email to it is being sent right now: left for the next run
      (s4, 'fake.sending@example.test', 'unsubscribed', 'email-updates-notice', 'fake-v1', '2001-01-01 00:00+00', null, null, '2001-01-01 00:00+00', '2001-01-01 01:00+00', '2001-03-01 00:00+00', '2001-01-01 00:00+00'),
      -- never confirmed, but its link is still valid (token lifetime first)
      (s5, 'fake.fresh@example.test', 'pending', 'email-updates-notice', 'fake-v1', '2001-03-01 00:00+00', repeat('e', 64), '2001-04-01 00:00+00', '2001-03-01 00:00+00', null, null, '2001-03-01 00:00+00');
    insert into public.notification_outbox (kind, channel, recipient_subscriber_id, payload, idempotency_key, status, attempts, subject, body, sent_at, skip_reason, lease_until) values
      ('announcement', 'email', s2, '{"event": "c0250000-0000-4000-8000-0000000000a1", "revision": 0}', 'ntf1:fake-0025-sent-s2', 'sent', 1, 'Sample', 'Sample body', '2001-02-01 00:00+00', null, null),
      ('announcement', 'email', s2, '{"event": "c0250000-0000-4000-8000-0000000000a2", "revision": 0}', 'ntf1:fake-0025-skip-s2', 'skipped', 0, 'Sample', 'Sample body', null, 'consent_withdrawn', null),
      ('announcement', 'email', s3, '{"event": "c0250000-0000-4000-8000-0000000000a2", "revision": 0}', 'ntf1:fake-0025-sent-s3', 'sent', 1, 'Sample', 'Sample body', '2001-02-01 00:00+00', null, null),
      ('announcement', 'email', s4, '{"event": "c0250000-0000-4000-8000-0000000000a2", "revision": 0}', 'ntf1:fake-0025-sending-s4', 'sending', 1, 'Sample', 'Sample body', null, null, '2001-03-11 00:05+00');

    -- the sign-up period is still empty: nothing about sign-ups is due, even far in the future
    j := app.platform_retention('fake-retention', true, timestamptz '2099-12-31 00:00:00+00');
    perform pg_temp.expect_counts(j, '{"subscriber_keep_days": null, "subscribers_unconfirmed_deleted": 0, "subscribers_unsubscribed_deleted": 0, "unsubscribe_hashes_kept": 0}', 'empty sign-up period');
    j := public.admin_set_platform_retention(v_actor, '{"registrationKeepDays": 30, "subscriberKeepDays": 10, "keepUnsubscribeHash": false}', 'fake lawyer advice');
    if j -> 'fields' <> '["subscriberKeepDays"]'::jsonb then raise exception 'ASSERT FAIL: setting the sign-up period answered %', j; end if;
    -- the hash switch off (the default): the unsubscribed address would be deleted with nothing kept
    j := app.platform_retention('fake-retention', true, b_sub);
    perform pg_temp.expect_counts(j, '{"subscribers_unconfirmed_deleted": 1, "subscribers_unsubscribed_deleted": 1, "unsubscribe_hashes_kept": 0}', 'dry run with the hash switch off');
    j := public.admin_set_platform_retention(v_actor, '{"registrationKeepDays": 30, "subscriberKeepDays": 10, "keepUnsubscribeHash": true}', 'fake lawyer yes');
    if j -> 'fields' <> '["keepUnsubscribeHash"]'::jsonb or (j ->> 'keepUnsubscribeHash')::boolean is not true then raise exception 'ASSERT FAIL: switching the hash on answered %', j; end if;
    if not exists (select 1 from public.audit_log where actor = v_actor and action = 'set_platform_retention' and diff -> 'fields' = '["keepUnsubscribeHash"]'::jsonb and (diff ->> 'keep_unsubscribe_hash')::boolean) then
      raise exception 'ASSERT FAIL: the hash switch was not audited';
    end if;

    j := app.platform_retention('fake-retention', true, b_sub - interval '1 second');
    perform pg_temp.expect_counts(j, '{"subscribers_unconfirmed_deleted": 0, "subscribers_unsubscribed_deleted": 0, "unsubscribe_hashes_kept": 0, "outbox_rows_removed": 0}', 'one second before the sign-up boundary');
    j := app.platform_retention('fake-retention', true, b_sub);
    perform pg_temp.expect_counts(j, '{"subscribers_unconfirmed_deleted": 1, "subscribers_unsubscribed_deleted": 1, "unsubscribe_hashes_kept": 1, "outbox_rows_removed": 2}', 'dry run at the sign-up boundary');
    if (select count(*) from public.notify_subscribers where id in (s1, s2, s3, s4, s5)) <> 5 or exists (select 1 from public.notify_unsubscribe_hashes where kept_on = date '2001-03-11') then
      raise exception 'ASSERT FAIL: a dry run changed a sign-up';
    end if;
    if j::text ~ '@|fake\.|[0-9a-f]{64}' then raise exception 'ASSERT FAIL: the answer holds an address or a hash: %', j; end if;

    j := app.platform_retention('fake-retention', false, b_sub);
    perform pg_temp.expect_counts(j, '{"subscribers_unconfirmed_deleted": 1, "subscribers_unsubscribed_deleted": 1, "unsubscribe_hashes_kept": 1, "outbox_rows_removed": 2, "registrations_anonymised": 0, "registrations_deleted": 0}', 'real run at the sign-up boundary');
    if exists (select 1 from public.notify_subscribers where id in (s1, s2)) then raise exception 'ASSERT FAIL: a due sign-up was not deleted'; end if;
    if (select count(*) from public.notify_subscribers where id in (s3, s4, s5)) <> 3 then raise exception 'ASSERT FAIL: an active, busy or still-valid sign-up was deleted'; end if;
    if exists (select 1 from public.notification_outbox where recipient_subscriber_id = s2) or (select count(*) from public.notification_outbox where recipient_subscriber_id in (s3, s4)) <> 2 then
      raise exception 'ASSERT FAIL: the outbox rows were not removed with (only) the deleted sign-up';
    end if;
    if not exists (select 1 from public.notify_unsubscribe_hashes h where h.email_sha256 = encode(sha256(convert_to('fake.gone@example.test', 'UTF8')), 'hex') and h.kept_on = date '2001-03-11') then
      raise exception 'ASSERT FAIL: the unsubscribed address hash was not kept';
    end if;
    if exists (select 1 from public.notify_unsubscribe_hashes h where h.email_sha256 = encode(sha256(convert_to('fake.pending@example.test', 'UTF8')), 'hex')) then
      raise exception 'ASSERT FAIL: a never-confirmed address left a hash (only an unsubscribe does)';
    end if;
    if not app.notify_email_unsubscribed(' Fake.Gone@Example.TEST ') or app.notify_email_unsubscribed('fake.active@example.test') or app.notify_email_unsubscribed(null) then
      raise exception 'ASSERT FAIL: the import check is wrong';
    end if;
    if exists (select 1 from public.audit_log where action = 'platform_retention_run' and diff::text ~ '@|fake\.|[0-9a-f]{64}') then
      raise exception 'ASSERT FAIL: the retention audit row holds an address or a hash';
    end if;
    -- the address unsubscribes again later: deleted again, the hash is not doubled
    insert into public.notify_subscribers (id, email, status, consent_id, consent_version, consent_at, last_confirmation_at, confirmed_at, unsubscribed_at, created_at) values
      (s6, 'fake.gone@example.test', 'unsubscribed', 'email-updates-notice', 'fake-v1', '2001-01-01 00:00+00', '2001-01-01 00:00+00', '2001-01-01 01:00+00', '2001-03-01 00:00+00', '2001-01-01 00:00+00');
    j := app.platform_retention('fake-retention', false, b_sub);
    perform pg_temp.expect_counts(j, '{"subscribers_unsubscribed_deleted": 1, "unsubscribe_hashes_kept": 0}', 'a second unsubscribe of the same address');
    select count(*) into n from public.notify_unsubscribe_hashes h where h.email_sha256 = encode(sha256(convert_to('fake.gone@example.test', 'UTF8')), 'hex');
    if n <> 1 then raise exception 'ASSERT FAIL: the hash was doubled'; end if;
    -- unsubscribed, then signed up again and never confirmed: the CURRENT status (pending) decides; no hash is kept
    insert into public.notify_subscribers (id, email, status, consent_id, consent_version, consent_at, confirm_token_hash, confirm_expires_at, last_confirmation_at, confirmed_at, unsubscribed_at, created_at) values
      (s7, 'fake.again@example.test', 'pending', 'email-updates-notice', 'fake-v1', '2001-03-01 00:00+00', repeat('f', 64), '2001-03-03 00:00+00', '2001-03-01 00:00+00', '2001-01-01 01:00+00', '2001-02-01 00:00+00', '2001-01-01 00:00+00');
    j := app.platform_retention('fake-retention', false, b_sub);
    perform pg_temp.expect_counts(j, '{"subscribers_unconfirmed_deleted": 1, "subscribers_unsubscribed_deleted": 0, "unsubscribe_hashes_kept": 0}', 'unsubscribed, then pending again');
    if exists (select 1 from public.notify_unsubscribe_hashes h where h.email_sha256 = encode(sha256(convert_to('fake.again@example.test', 'UTF8')), 'hex')) then
      raise exception 'ASSERT FAIL: a hash was kept for someone whose last step was signing up again';
    end if;
    -- the hash switch off again: an unsubscribed address is deleted and nothing is kept
    j := public.admin_set_platform_retention(v_actor, '{"registrationKeepDays": 30, "subscriberKeepDays": 10, "keepUnsubscribeHash": false}', 'fake lawyer no');
    insert into public.notify_subscribers (id, email, status, consent_id, consent_version, consent_at, last_confirmation_at, confirmed_at, unsubscribed_at, created_at) values
      (s8, 'fake.nohash@example.test', 'unsubscribed', 'email-updates-notice', 'fake-v1', '2001-01-01 00:00+00', '2001-01-01 00:00+00', '2001-01-01 01:00+00', '2001-03-01 00:00+00', '2001-01-01 00:00+00');
    j := app.platform_retention('fake-retention', false, b_sub);
    perform pg_temp.expect_counts(j, '{"subscribers_unsubscribed_deleted": 1, "unsubscribe_hashes_kept": 0}', 'an unsubscribe with the hash switch off');
    if exists (select 1 from public.notify_subscribers where id = s8) then raise exception 'ASSERT FAIL: the unsubscribed address was not deleted with the hash switch off'; end if;
    if exists (select 1 from public.notify_unsubscribe_hashes h where h.email_sha256 = encode(sha256(convert_to('fake.nohash@example.test', 'UTF8')), 'hex')) then
      raise exception 'ASSERT FAIL: a hash was kept while the hash switch was off';
    end if;

    -- ---------------------------------------------------------------- the owner's summary: counts only, owner only
    perform pg_temp.expect_code(format($q$select public.admin_platform_retention_summary(%L)$q$, v_ed), 'FORBIDDEN', 'an editor reading the summary');
    j := public.admin_platform_retention_summary(v_actor);
    if (j ->> 'registrationKeepDays')::integer <> 30 or (j ->> 'subscriberKeepDays')::integer <> 10 or (j #>> '{dueNow,dry_run}')::boolean is not true
       or (j ->> 'keepUnsubscribeHash')::boolean is distinct from false
       or (j ->> 'unsubscribeHashesKept')::integer < 1 or j::text ~ '@|[0-9a-f]{64}' then
      raise exception 'ASSERT FAIL: the summary is wrong or holds personal data: %', j;
    end if;
    -- clearing a period (back to "never remove") is allowed
    j := public.admin_set_platform_retention(v_actor, '{"registrationKeepDays": null, "subscriberKeepDays": null, "keepUnsubscribeHash": false}', 'fake rollback');
    if (select num_nonnulls(registration_keep_days, subscriber_keep_days) from public.retention_settings where id = 1) <> 0 then raise exception 'ASSERT FAIL: a period could not be cleared'; end if;

    -- ---------------------------------------------------------------- anon: nothing
    execute 'set local role anon';
    perform pg_temp.expect_fail($q$select registration_keep_days from public.retention_settings$q$, 'anon reading the periods');
    perform pg_temp.expect_fail($q$select email_sha256 from public.notify_unsubscribe_hashes$q$, 'anon reading the hashes');
    perform pg_temp.expect_fail($q$select public.admin_run_platform_retention('fake', true)$q$, 'anon running the job');
    perform pg_temp.expect_fail(format($q$select public.admin_set_platform_retention(%L, '{"registrationKeepDays": 30, "subscriberKeepDays": 10, "keepUnsubscribeHash": false}', 'r')$q$, v_actor), 'anon setting a period');
    execute 'reset role';
    execute 'set local role authenticated';
    perform pg_temp.expect_fail($q$select public.admin_run_platform_retention('fake', true)$q$, 'authenticated running the job');
    perform pg_temp.expect_fail($q$select app.platform_retention('fake', false, now())$q$, 'authenticated running the inner job');
    execute 'reset role';
    execute 'set local role service_role';
    perform pg_temp.expect_fail($q$select app.platform_retention('fake', false, now())$q$, 'service_role running the inner job with its own time');
    perform pg_temp.expect_fail($q$delete from public.notify_unsubscribe_hashes$q$, 'service_role deleting the hashes');
    perform pg_temp.expect_fail($q$update public.retention_settings set registration_keep_days = 7$q$, 'service_role writing the periods directly');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0025_platform_retention assertions passed' as result;
