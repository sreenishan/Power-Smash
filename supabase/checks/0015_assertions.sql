-- 0015_assertions.sql - self-check for migration 0015_submitted_tournaments.sql (public.tournament_submissions,
-- admin_add_submitted_tournament). Run it after applying 0001..0015. It changes nothing: the behaviour tests run in a sub-transaction
-- that is rolled back, with FICTIONAL leads and tournaments. It raises an exception naming the first broken rule and ends with one row `ok`.

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
-- A. structure: RLS on, no policies, no rights for anon/authenticated, service_role reads only, a locked-down RPC
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  p text;
begin
  if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'tournament_submissions') then
    raise exception 'ASSERT FAIL: row level security is OFF on public.tournament_submissions';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_submissions') then raise exception 'ASSERT FAIL: a policy exists on public.tournament_submissions'; end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.tournament_submissions', p) or has_table_privilege('authenticated', 'public.tournament_submissions', p) then
      raise exception 'ASSERT FAIL: anon or authenticated holds % on public.tournament_submissions', p;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.tournament_submissions', 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read public.tournament_submissions'; end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('service_role', 'public.tournament_submissions', p) then raise exception 'ASSERT FAIL: service_role holds % on public.tournament_submissions', p; end if;
  end loop;
  -- no contact column: the link table holds ids only
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tournament_submissions'
             and column_name not in ('tournament_id', 'lead_id', 'added_at', 'added_by')) then
    raise exception 'ASSERT FAIL: public.tournament_submissions holds a column beyond the ids';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.admin_add_submitted_tournament(text,uuid,jsonb,text)'::regprocedure) then
    raise exception 'ASSERT FAIL: admin_add_submitted_tournament is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.admin_add_submitted_tournament(text,uuid,jsonb,text)'::regprocedure and proconfig @> array['search_path=""']) then
    raise exception 'ASSERT FAIL: admin_add_submitted_tournament does not pin search_path';
  end if;
  if has_function_privilege('anon', 'public.admin_add_submitted_tournament(text,uuid,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_add_submitted_tournament(text,uuid,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: anon or authenticated can run admin_add_submitted_tournament';
  end if;
  if not has_function_privilege('service_role', 'public.admin_add_submitted_tournament(text,uuid,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: service_role cannot run admin_add_submitted_tournament';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back): owner only, tournament_submission leads only, once each, every field checked, pending + hidden, no contact
-- data copied, audited, not public until approved
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  v_lead uuid := '00000000-0000-4000-8000-0000000000c1';
  v_other uuid := '00000000-0000-4000-8000-0000000000c2';
  v_lead2 uuid := '00000000-0000-4000-8000-0000000000c3';
  rec jsonb := '{"slug": "fake-district-open-2026-fakecity", "name": "Fake District Open 2026", "seriesKey": "fake district open", "editionYear": 2026,
                 "region": "tamil_nadu", "city": "Fakecity", "district": "Fakedistrict", "venue": "Fake Indoor Hall", "startDate": "2026-12-05", "endDate": "2026-12-06"}';
  j jsonb;
  t public.tournaments%rowtype;
begin
  begin
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.leads (id, ref_code, type, name, phone, email, payload, consent_id, consent_version, consent_at, idempotency_key) values
      (v_lead, 'PS-2026-FAKE11', 'tournament_submission', 'Fake Organizer', '910000000000', 'organizer@example.test', '{"tournamentName": "Fake District Open 2026"}', 'lead-notice', 'v1', now(), '00000000-0000-4000-8000-0000000000d1'),
      (v_other, 'PS-2026-FAKE12', 'coverage', 'Fake Person', '910000000000', null, '{}', 'lead-notice', 'v1', now(), '00000000-0000-4000-8000-0000000000d2'),
      (v_lead2, 'PS-2026-FAKE13', 'tournament_submission', 'Fake Organizer Two', '910000000000', null, '{}', 'lead-notice', 'v1', now(), '00000000-0000-4000-8000-0000000000d3');

    -- the owner check
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_add_submitted_tournament('fake-admin', %L, %L::jsonb, 'r')$q$, v_lead, rec), 'a non-uuid actor');
    perform pg_temp.expect_fail(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_editor, v_lead, rec), 'an editor actor');

    -- the lead must exist and be a tournament submission
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, '00000000-0000-4000-8000-0000000000ff', rec), 'NOT_FOUND', 'an unknown lead');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_other, rec), 'INVALID', 'a coverage lead');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, '')$q$, v_actor, v_lead, rec), 'INVALID', 'no reason');

    -- field checks
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"organizerPhone": "910000000000"}'), 'INVALID', 'a contact field');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec - 'venue'), 'INVALID', 'a missing field');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"slug": "Fake Open"}'), 'INVALID', 'a malformed address');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"slug": "submit"}'), 'INVALID', 'a reserved address');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"region": "international"}'), 'INVALID', 'region international');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"region": "other_india"}'), 'INVALID', 'region other_india');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"name": "F"}'), 'INVALID', 'a 1-character name');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || jsonb_build_object('venue', repeat('v', 161))), 'INVALID', 'a 161-character venue');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"startDate": "2026-02-30"}'), 'INVALID', 'an impossible date');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"endDate": "2026-12-01"}'), 'INVALID', 'the last day before the first');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"editionYear": 2027}'), 'INVALID', 'a year that is not the first day''s');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"editionYear": "2026"}'), 'INVALID', 'a year given as text');
    execute 'reset role';
    if exists (select 1 from public.tournaments where slug like 'fake-district-open%') or exists (select 1 from public.tournament_submissions) then
      raise exception 'ASSERT FAIL: a refused call stored something';
    end if;
    if exists (select 1 from public.audit_log where action = 'add_submitted_tournament') then raise exception 'ASSERT FAIL: a refused call wrote an audit row'; end if;

    -- the owner adds it: pending, hidden, source submitted, linked, no contact data copied
    execute 'set local role service_role';
    j := public.admin_add_submitted_tournament(v_actor, v_lead, rec, 'add submission');
    execute 'reset role';
    select * into t from public.tournaments where id = (j ->> 'id')::uuid;
    if t.slug is distinct from 'fake-district-open-2026-fakecity' or t.source is distinct from 'submitted' or t.status is distinct from 'pending'
       or t.visibility is distinct from 'hidden' or t.region is distinct from 'tamil_nadu' or t.edition_year is distinct from 2026::smallint
       or t.start_date is distinct from '2026-12-05'::date or t.venue is distinct from 'Fake Indoor Hall' or t.show_contact_public then
      raise exception 'ASSERT FAIL: the submitted tournament was not stored as expected: %', row_to_json(t);
    end if;
    if (select lead_id from public.tournament_submissions where tournament_id = t.id) is distinct from v_lead then raise exception 'ASSERT FAIL: the lead was not linked'; end if;
    if exists (select 1 from public.tournament_private where tournament_id = t.id) then raise exception 'ASSERT FAIL: contact data was copied to tournament_private'; end if;
    if row_to_json(t)::text like '%910000000000%' or row_to_json(t)::text like '%organizer@example.test%' or row_to_json(t)::text like '%Fake Organizer%' then
      raise exception 'ASSERT FAIL: the tournament row holds contact data';
    end if;
    if not exists (select 1 from public.audit_log where action = 'add_submitted_tournament' and actor = v_actor and entity_id = t.id::text
                   and diff ->> 'lead_id' = v_lead::text and diff ->> 'slug' = t.slug) then
      raise exception 'ASSERT FAIL: adding was not audited with the ids and the address';
    end if;
    if exists (select 1 from public.audit_log where action = 'add_submitted_tournament' and (diff::text like '%910000000000%' or diff::text like '%Fake Organizer%')) then
      raise exception 'ASSERT FAIL: the audit row holds contact data';
    end if;

    -- not public while pending and hidden
    execute 'set local role anon';
    if exists (select 1 from api.public_tournaments where id = t.id) then raise exception 'ASSERT FAIL: a pending submitted tournament is public'; end if;
    execute 'reset role';

    -- once each: the same lead again, the same address, or the same name and year from another submission
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead, rec || '{"slug": "fake-district-open-2026-other"}'), 'INVALID', 'the same lead twice');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead2, rec), 'INVALID', 'an address that is taken');
    perform pg_temp.expect_code(format($q$select public.admin_add_submitted_tournament(%L, %L, %L::jsonb, 'r')$q$, v_actor, v_lead2, rec || '{"slug": "fake-district-open-2026-b"}'), 'INVALID', 'the same name and year again');
    -- a second submission without a first day: no year, region unknown, empty place fields
    j := public.admin_add_submitted_tournament(v_actor, v_lead2, '{"slug": "fake-cup", "name": "Fake Cup", "seriesKey": "fake cup", "editionYear": null, "region": "unknown",
      "city": null, "district": "  ", "venue": null, "startDate": null, "endDate": null}', 'add submission');
    execute 'reset role';
    select * into t from public.tournaments where id = (j ->> 'id')::uuid;
    if t.edition_year is not null or t.region is distinct from 'unknown' or t.district is not null or t.status is distinct from 'pending' then
      raise exception 'ASSERT FAIL: the second submission was not stored as expected: %', row_to_json(t);
    end if;

    -- retention may remove the lead later: the link stays, without the lead
    delete from public.leads where id = v_lead2;
    if not exists (select 1 from public.tournament_submissions where tournament_id = t.id and lead_id is null) then
      raise exception 'ASSERT FAIL: removing the lead did not keep the link with lead_id null';
    end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0015_submitted_tournaments assertions passed' as result;
