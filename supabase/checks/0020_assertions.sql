-- 0020_assertions.sql - self-check for migration 0020_registrations.sql (registration with manual payment verification, D-111).
-- Run it after applying 0001..0020. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with a
-- FICTIONAL tournament, players, phone numbers (910000000000 style) and example.test emails. It raises an exception naming the first
-- broken rule and ends with one row `ok`.

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
-- A. structure
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  owner_rpcs text[] := array['public.admin_set_registration_settings(text,jsonb,text)', 'public.admin_set_event_registration(text,uuid,jsonb,text)',
    'public.admin_verify_registration_payment(text,uuid,jsonb,integer,text)', 'public.admin_convert_registration(text,uuid,jsonb,integer,text)',
    'public.admin_reject_registration(text,uuid,integer,text)'];
  endpoint_rpcs text[] := array['public.registration_lookup(uuid,uuid,text)', 'public.registration_submit(jsonb)'];
  helpers text[] := array['app.registration_card_like(text)', 'app.registration_line_ok(text,integer)', 'app.registration_event_is_junior(uuid)',
    'app.registration_contact_free(text)', 'app.registration_upi_is_phone(text)'];
  views jsonb := jsonb_build_object(
    'public_registration_events', jsonb_build_array('event_id', 'entry_fee_paise'),
    'public_registration_payment', jsonb_build_array('payment_instructions', 'upi_id', 'payee_name'));
  fn text;
  v text;
  p text;
  c record;
  src text;
begin
  -- the private table: RLS on, no policies, nothing for the API roles, SELECT only for service_role
  if not coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'public' and cl.relname = 'event_registrations' and cl.relkind = 'r'), false) then
    raise exception 'ASSERT FAIL: public.event_registrations is missing or row level security is OFF';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_registrations') then raise exception 'ASSERT FAIL: a policy exists on event_registrations'; end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.event_registrations', p) or has_table_privilege('authenticated', 'public.event_registrations', p) then
      raise exception 'ASSERT FAIL: anon or authenticated holds % on event_registrations', p;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.event_registrations', 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read event_registrations'; end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('service_role', 'public.event_registrations', p) then raise exception 'ASSERT FAIL: service_role holds % on event_registrations (writes go through the RPCs)', p; end if;
  end loop;
  -- contact data never reaches an api view: no api view reads event_registrations, and no api column is a contact field
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class vw on vw.oid = r.ev_class join pg_namespace n on n.oid = vw.relnamespace
             where n.nspname = 'api' and d.refobjid = 'public.event_registrations'::regclass) then
    raise exception 'ASSERT FAIL: an api view reads event_registrations';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'api' and (table_name like 'public_registration%' or table_name like 'public_competition%')
             and (column_name ~ '(phone|email|contact|payment_reference|ip_hash|rejected_reason|registrant)')) then
    raise exception 'ASSERT FAIL: an api view exposes a registration contact or private column';
  end if;
  -- the 0017 rule still holds: no api view reads competition_settings directly (the settings go through app.registration_open_settings)
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class vw on vw.oid = r.ev_class join pg_namespace n on n.oid = vw.relnamespace
             where n.nspname = 'api' and d.refobjid = 'public.competition_settings'::regclass) then
    raise exception 'ASSERT FAIL: an api view reads competition_settings directly';
  end if;
  foreach p in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(p, 'app.registration_open_settings', 'SELECT') then raise exception 'ASSERT FAIL: % can read app.registration_open_settings', p; end if;
  end loop;

  -- the api views: security_barrier, read-only for the API roles, exactly the declared columns, no function calls
  for v in select jsonb_object_keys(views) loop
    if not exists (select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = v and cl.relkind = 'v') then
      raise exception 'ASSERT FAIL: view api.% does not exist', v;
    end if;
    if not coalesce((select 'security_barrier=true' = any (cl.reloptions) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = v), false) then
      raise exception 'ASSERT FAIL: api.% is not a security_barrier view', v;
    end if;
    if not (has_table_privilege('anon', format('api.%I', v), 'SELECT') and has_table_privilege('authenticated', format('api.%I', v), 'SELECT')) then
      raise exception 'ASSERT FAIL: anon or authenticated cannot SELECT api.%', v;
    end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('anon', format('api.%I', v), p) or has_table_privilege('authenticated', format('api.%I', v), p) then
        raise exception 'ASSERT FAIL: anon or authenticated holds % on api.%', p, v;
      end if;
    end loop;
    if (select jsonb_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = v) is distinct from views -> v then
      raise exception 'ASSERT FAIL: api.% does not have exactly its declared columns', v;
    end if;
    if pg_get_viewdef(format('api.%I', v)::regclass) ~ 'app\.registration_(card_like|line_ok|event_is_junior)' then
      raise exception 'ASSERT FAIL: api.% calls an app function (the API roles cannot run them)', v;
    end if;
  end loop;
  if position('is_junior' in pg_get_viewdef('api.public_registration_events'::regclass)) = 0
     or position('registration_open' in pg_get_viewdef('api.public_registration_events'::regclass)) = 0 then
    raise exception 'ASSERT FAIL: api.public_registration_events does not leave out junior or closed events';
  end if;

  -- the RPCs: SECURITY DEFINER, pinned search_path, service_role only; owner RPCs check the owner first; the endpoint RPC checks the switch first
  foreach fn in array owner_rpcs || endpoint_rpcs loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
  end loop;
  foreach fn in array owner_rpcs loop
    src := (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure);
    if src !~ '\mbegin\s+perform app\.require_owner\(p_actor\);' then raise exception 'ASSERT FAIL: % does not call app.require_owner first', fn; end if;
  end loop;
  src := (select pr.prosrc from pg_proc pr where pr.oid = 'public.registration_submit(jsonb)'::regprocedure);
  if src !~ '\mbegin\s+--[^\n]*\n\s+if not coalesce\(\(select s\.registration_enabled from public\.competition_settings' then
    raise exception 'ASSERT FAIL: registration_submit does not check the owner''s switch first';
  end if;
  foreach fn in array helpers loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: an API role can run %', fn;
    end if;
  end loop;

  -- safe defaults: nothing open, nothing shown, no seeded registration
  if exists (select 1 from public.tournament_events where registration_open) then raise exception 'ASSERT FAIL: an event takes registrations by default'; end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tournament_events' and column_name = 'registration_open') <> 'false'
     or (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tournament_events' and column_name = 'entry_fee_paise') is not null then
    raise exception 'ASSERT FAIL: an event registration default changed (open must be false, the fee must have no default)';
  end if;
  for c in select column_name, column_default from information_schema.columns where table_schema = 'public' and table_name = 'competition_settings' and column_name like 'registration_%' and column_name <> 'registration_enabled' loop
    if c.column_default is not null then raise exception 'ASSERT FAIL: competition_settings.% has a default (no payment text is ever defaulted)', c.column_name; end if;
  end loop;
  if exists (select 1 from public.event_registrations) then raise exception 'ASSERT FAIL: the migration seeded registrations'; end if;

  -- the shape helpers (pure)
  -- contact details (mirrors src/lib/admin/registration/rules.ts)
  if not app.registration_contact_free('Pay by UPI and type the reference in the note.') or app.registration_contact_free('Call 90000 00000 after paying')
     or app.registration_contact_free('Mail fake@example.test') or app.registration_contact_free('Message wa.me/910000000000') then
    raise exception 'ASSERT FAIL: app.registration_contact_free does not follow the contact-data rule';
  end if;
  if not app.registration_upi_is_phone('9000000000@okfake') or not app.registration_upi_is_phone('90000-00000@okfake')
     or app.registration_upi_is_phone('fakepayee@okfake') or app.registration_upi_is_phone('fakepayee2026@okfake') then
    raise exception 'ASSERT FAIL: app.registration_upi_is_phone does not recognise a phone-number UPI id';
  end if;
  if not app.registration_card_like('4111111111111111') or not app.registration_card_like('5555555555554444') then raise exception 'ASSERT FAIL: a test card number is not recognised'; end if;
  if app.registration_card_like('412345678901') or app.registration_card_like('4111111111111112') or app.registration_card_like('UTR4111111111111111') then
    raise exception 'ASSERT FAIL: a payment reference is mistaken for a card number';
  end if;
  if not app.registration_line_ok('Fake Reg Player', 80) or app.registration_line_ok(' Fake', 80) or app.registration_line_ok('A', 80)
     or app.registration_line_ok('Fake <b>', 80) or app.registration_line_ok(E'Fake\nPlayer', 80) then
    raise exception 'ASSERT FAIL: the name line rule is wrong';
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
  t1 uuid := 'c0200000-0000-4000-8000-000000000001';
  t2 uuid := 'c0200000-0000-4000-8000-000000000002';  -- a public tournament with a minor signal
  pf uuid := 'c0200000-0000-4000-8000-0000000000b6';  -- adult_confirmed, public, not provisional: named in competitions
  d jsonb := app.competition_default_ruleset();
  ems uuid;
  emd uuid;
  ejr uuid;
  edraft uuid;
  consent text := 'Fake registration notice for this rolled-back test only, version one.';
  base jsonb;
  j jsonb;
  r1 uuid;
  r2 uuid;
  r3 uuid;
  r4 uuid;
  v_entry uuid;
  v_new uuid;
  n integer;
begin
  begin
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility) values
      (t1, 'fake-reg-open-2026', 'Fake Reg Open', 'fake reg open', 2026, 'tamil_nadu', 'published', 'public');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility, is_minor_signal) values
      (t2, 'fake-reg-school-2026', 'Fake Reg School', 'fake reg school', 2026, 'tamil_nadu', 'published', 'public', true);
    insert into public.players (id, display_name, name_normalized, identity_tier) values (pf, 'Fake Reg Foxtrot', 'fake reg foxtrot', 'multi_token');
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pf], 'adult_confirmed', 'fake admin review', 'test');
    perform public.admin_update_player(v_actor, pf, '{"is_provisional": false, "visibility": "public"}', 'test');
    ems := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 3, 'status', 'open'), 'test') ->> 'id')::uuid;
    emd := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'MD', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'open'), 'test') ->> 'id')::uuid;
    edraft := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'WS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'draft'), 'test') ->> 'id')::uuid;
    ejr := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'MS', 'ageGroup', 'U15', 'format', 'knockout', 'ruleset', d, 'capacity', null, 'status', 'open'), 'test') ->> 'id')::uuid;

    base := jsonb_build_object('ref', 'PSR-2026-AAAAAA', 'idempotencyKey', gen_random_uuid(), 'eventId', ems, 'player1Name', 'Fake Reg Alpha', 'player2Name', null,
      'phone', '910000000001', 'email', 'alpha@example.test', 'whatsappOk', true, 'paymentReference', 'UTR0000111122', 'consentId', 'registration-notice',
      'consentVersion', 'fake-v1', 'consentText', consent, 'ipHash', 'fakeiphash0001');

    -- ---------------------------------------------------------------- switched off: nothing is stored, nothing is public
    j := public.registration_submit(base);
    if j ->> 'outcome' <> 'closed' then raise exception 'ASSERT FAIL: a registration was taken while switched off: %', j; end if;
    execute 'reset role';
    if exists (select 1 from public.event_registrations) or exists (select 1 from api.public_registration_events) or exists (select 1 from api.public_registration_payment) then
      raise exception 'ASSERT FAIL: something registration-related is stored or public while switched off';
    end if;
    execute 'set local role service_role';

    -- ---------------------------------------------------------------- the owner settings
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": null, "upiId": null, "payeeName": null}', 'r')$q$, v_editor), 'FORBIDDEN', 'an editor switching registration on');
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": null, "upiId": null, "payeeName": null}', '')$q$, v_actor), 'INVALID', 'no reason');
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": null, "upiId": "fakepayee@okfake", "payeeName": null}', 'r')$q$, v_actor), 'INVALID', 'a UPI id without its payee');
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": null, "upiId": "not a upi", "payeeName": "Fake Payee"}', 'r')$q$, v_actor), 'INVALID', 'a bad UPI id');
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": "<script>bad</script>", "upiId": null, "payeeName": null}', 'r')$q$, v_actor), 'INVALID', 'markup in the instructions');
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": null, "upiId": null, "payeeName": null, "pin": "1234"}', 'r')$q$, v_actor), 'INVALID', 'an unknown field');
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": null, "upiId": "9000000000@okfake", "payeeName": "Fake Payee"}', 'r')$q$, v_actor), 'INVALID', 'a phone-number UPI id');
    perform pg_temp.expect_code(format($q$select public.admin_set_registration_settings(%L, '{"enabled": true, "paymentInstructions": "Pay, then call 90000 00000 with the reference.", "upiId": null, "payeeName": null}', 'r')$q$, v_actor), 'INVALID', 'a phone number in the public payment instructions');
    perform pg_temp.expect_fail($q$update public.competition_settings set registration_upi_id = '9000000000@okfake', registration_payee_name = 'Fake Payee' where id = 1$q$, 'a phone-number UPI id past the RPC');
    j := public.admin_set_registration_settings(v_actor, '{"enabled": true, "paymentInstructions": "Pay the fake fee by UPI and type the reference.", "upiId": "FakePayee@okfake", "payeeName": "Fake Payee"}', 'test');
    if not (j ->> 'enabled')::boolean then raise exception 'ASSERT FAIL: registration was not switched on: %', j; end if;
    execute 'reset role';
    if (select payment_mode from public.competition_settings where id = 1) <> 'manual_verification' or (select registration_upi_id from public.competition_settings where id = 1) <> 'fakepayee@okfake' then
      raise exception 'ASSERT FAIL: the payment mode or the lower-cased UPI id is wrong';
    end if;
    -- no event open yet: the event list is empty, the payment texts are public
    if exists (select 1 from api.public_registration_events) or (select count(*) from api.public_registration_payment) <> 1 then
      raise exception 'ASSERT FAIL: the public registration views are wrong before any event opens';
    end if;
    execute 'set local role service_role';

    -- ---------------------------------------------------------------- per event: open, fee, refusals
    j := public.registration_submit(base);
    if j ->> 'outcome' <> 'closed' then raise exception 'ASSERT FAIL: an event not open for registration took one: %', j; end if;
    perform pg_temp.expect_code(format($q$select public.admin_set_event_registration(%L, %L, '{"open": true, "entryFeePaise": null}', 'r')$q$, v_editor, ems), 'FORBIDDEN', 'an editor opening registration');
    perform pg_temp.expect_code(format($q$select public.admin_set_event_registration(%L, %L, '{"open": true, "entryFeePaise": null}', 'r')$q$, v_actor, ejr), 'INVALID', 'opening a junior event');
    perform pg_temp.expect_code(format($q$select public.admin_set_event_registration(%L, %L, '{"open": true, "entryFeePaise": null}', 'r')$q$, v_actor, edraft), 'INVALID', 'opening a draft event');
    perform pg_temp.expect_code(format($q$select public.admin_set_event_registration(%L, %L, '{"open": true, "entryFeePaise": 0}', 'r')$q$, v_actor, ems), 'INVALID', 'a fee of 0 paise (leave it empty for none)');
    perform pg_temp.expect_code(format($q$select public.admin_set_event_registration(%L, %L, '{"open": true, "entryFeePaise": 12.5}', 'r')$q$, v_actor, ems), 'INVALID', 'a fee that is not whole paise');
    perform pg_temp.expect_code(format($q$select public.admin_set_event_registration(%L, %L, '{"open": true, "entryFeePaise": null}', 'r')$q$, v_actor, gen_random_uuid()), 'NOT_FOUND', 'an unknown event');
    perform public.admin_set_event_registration(v_actor, ems, '{"open": true, "entryFeePaise": 50000}', 'test');
    perform public.admin_set_event_registration(v_actor, emd, '{"open": true, "entryFeePaise": null}', 'test');
    execute 'reset role';
    -- a junior event never takes registrations, even if the flag is set behind the RPC's back
    update public.tournament_events set registration_open = true where id = ejr;
    execute 'set local role anon';
    if (select count(*) from api.public_registration_events) <> 2 or (select entry_fee_paise from api.public_registration_events where event_id = ems) <> 50000
       or exists (select 1 from api.public_registration_events where event_id in (ejr, edraft)) then
      raise exception 'ASSERT FAIL: anon sees the wrong registration events';
    end if;
    if (select upi_id from api.public_registration_payment) <> 'fakepayee@okfake' then raise exception 'ASSERT FAIL: anon does not see the payee UPI id'; end if;
    perform pg_temp.expect_fail('select count(*) from public.event_registrations', 'anon reading registrations');
    perform pg_temp.expect_fail(format($q$select public.registration_submit(%L::jsonb)$q$, base), 'anon submitting directly');
    perform pg_temp.expect_fail(format($q$select public.registration_lookup(%L, %L, '910000000001')$q$, gen_random_uuid(), ems), 'anon looking up a key');
    execute 'reset role';
    execute 'set local role authenticated';
    perform pg_temp.expect_fail('select count(*) from public.event_registrations', 'authenticated reading registrations');
    perform pg_temp.expect_fail(format($q$select public.admin_verify_registration_payment(%L, %L, '{"amountPaise": 1}', 1, 'r')$q$, v_actor, gen_random_uuid()), 'authenticated verifying a payment');
    execute 'reset role';
    execute 'set local role service_role';
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'eventId', ejr, 'ref', 'PSR-2026-AAAAAJ'));
    if j ->> 'outcome' <> 'closed' then raise exception 'ASSERT FAIL: a junior event took a registration: %', j; end if;

    -- ---------------------------------------------------------------- submit: created, replay, conflict, duplicate, players, capacity
    perform pg_temp.expect_code(format($q$select public.registration_submit(%L::jsonb)$q$, base || '{"paymentReference": "4111111111111111"}'), 'INVALID', 'a card number as the payment reference');
    perform pg_temp.expect_code(format($q$select public.registration_submit(%L::jsonb)$q$, base || '{"paymentReference": "upi pin 1234"}'), 'INVALID', 'a free-text payment reference');
    perform pg_temp.expect_code(format($q$select public.registration_submit(%L::jsonb)$q$, base || '{"phone": "+91 9000000000"}'), 'INVALID', 'an unnormalised phone');
    perform pg_temp.expect_code(format($q$select public.registration_submit(%L::jsonb)$q$, base || '{"ageGroup": "U19"}'), 'INVALID', 'a self-claimed age group');
    perform pg_temp.expect_code(format($q$select public.registration_submit(%L::jsonb)$q$, base - 'ipHash'), 'INVALID', 'a missing field');
    j := public.registration_submit(base);
    if j ->> 'outcome' <> 'created' or j ->> 'ref' <> 'PSR-2026-AAAAAA' or (j ->> 'feePaise')::integer <> 50000 then raise exception 'ASSERT FAIL: the first registration was not created: %', j; end if;
    r1 := (j ->> 'id')::uuid;
    j := public.registration_submit(base);
    if j ->> 'outcome' <> 'replay' or j ->> 'ref' <> 'PSR-2026-AAAAAA' then raise exception 'ASSERT FAIL: a retry did not replay: %', j; end if;
    j := public.registration_submit(base || '{"phone": "910000000009"}');
    if j ->> 'outcome' <> 'conflict' then raise exception 'ASSERT FAIL: a reused key with other details did not conflict: %', j; end if;
    j := public.registration_lookup((base ->> 'idempotencyKey')::uuid, ems, '910000000001');
    if j ->> 'outcome' <> 'same' or j ->> 'ref' <> 'PSR-2026-AAAAAA' then raise exception 'ASSERT FAIL: lookup same: %', j; end if;
    if public.registration_lookup((base ->> 'idempotencyKey')::uuid, ems, '910000000009') ->> 'outcome' <> 'different'
       or public.registration_lookup(gen_random_uuid(), ems, '910000000001') ->> 'outcome' <> 'none' then
      raise exception 'ASSERT FAIL: lookup different or none';
    end if;
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAB', 'player1Name', 'fake  reg ALPHA'));
    if j ->> 'outcome' <> 'already_registered' then raise exception 'ASSERT FAIL: the same player and phone registered twice: %', j; end if;
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAA', 'player1Name', 'Fake Reg Bravo'));
    if j ->> 'outcome' <> 'ref_taken' then raise exception 'ASSERT FAIL: a taken reference was not reported: %', j; end if;
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAC', 'player1Name', 'Fake Reg Bravo', 'player2Name', 'Fake Reg Charlie'));
    if j ->> 'outcome' <> 'partner_not_allowed' then raise exception 'ASSERT FAIL: singles took a partner: %', j; end if;
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAD', 'eventId', emd, 'player1Name', 'Fake Reg Bravo'));
    if j ->> 'outcome' <> 'partner_required' then raise exception 'ASSERT FAIL: doubles took no partner: %', j; end if;
    perform pg_temp.expect_code(format($q$select public.registration_submit(%L::jsonb)$q$,
      base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAE', 'player1Name', 'Fake Reg Bravo', 'consentText', 'A different fake notice text under the same version.')),
      'INVALID', 'another text under the same consent version');
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAF', 'eventId', emd, 'player1Name', 'Fake Reg Bravo',
      'player2Name', 'Fake Reg Charlie', 'phone', '910000000002', 'email', null, 'paymentReference', null, 'ipHash', null));
    if j ->> 'outcome' <> 'created' or (j -> 'feePaise') <> 'null'::jsonb then raise exception 'ASSERT FAIL: the doubles registration was not created: %', j; end if;
    r2 := (j ->> 'id')::uuid;
    -- capacity 3 on MS: one registration plus one owner entry plus one more registration fill it
    perform public.admin_add_entry(v_actor, ems, jsonb_build_object('players', jsonb_build_array(pf), 'seed', null, 'status', 'pending'), 'test');
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAG', 'player1Name', 'Fake Reg Delta', 'phone', '910000000003'));
    if j ->> 'outcome' <> 'created' then raise exception 'ASSERT FAIL: the third place was refused: %', j; end if;
    r3 := (j ->> 'id')::uuid;
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAH', 'player1Name', 'Fake Reg Echo', 'phone', '910000000004'));
    if j ->> 'outcome' <> 'full' then raise exception 'ASSERT FAIL: a full event took a registration: %', j; end if;
    execute 'reset role';
    if (select count(*) from public.event_registrations) <> 3 then raise exception 'ASSERT FAIL: expected 3 stored registrations'; end if;
    if (select fee_paise_at_submit from public.event_registrations where id = r1) <> 50000 or (select fee_paise_at_submit from public.event_registrations where id = r2) is not null then
      raise exception 'ASSERT FAIL: the fee was not kept with the registration';
    end if;
    -- the notice text is kept once as evidence, with its hash checked by 0002
    if (select count(*) from public.notice_versions where id = 'registration-notice' and version = 'fake-v1') <> 1 then raise exception 'ASSERT FAIL: the notice text was not kept'; end if;
    -- contact data never reaches any api view: scan every row of every api view as text
    for j in select to_jsonb(x) from (select * from api.public_registration_events) x union all select to_jsonb(x) from (select * from api.public_registration_payment) x
             union all select to_jsonb(x) from (select * from api.public_competition_events) x union all select to_jsonb(x) from (select * from api.public_competition_draw_slots) x loop
      if j::text ~* '91000000000|example\.test|UTR0000111122|fake reg (alpha|bravo|charlie|delta)|fakeiphash' then
        raise exception 'ASSERT FAIL: an api view row holds registration data: %', j;
      end if;
    end loop;
    execute 'set local role service_role';

    -- ---------------------------------------------------------------- owner: verify, convert, reject
    perform pg_temp.expect_code(format($q$select public.admin_convert_registration(%L, %L, %L::jsonb, 1, 'r')$q$, v_actor, r1,
      jsonb_build_object('players', jsonb_build_array(jsonb_build_object('name', 'Fake Reg Alpha', 'nameNormalized', 'fake reg alpha')), 'status', 'confirmed')), 'INVALID', 'converting before the fee is verified');
    perform pg_temp.expect_code(format($q$select public.admin_verify_registration_payment(%L, %L, '{"amountPaise": 50000}', 1, 'r')$q$, v_editor, r1), 'FORBIDDEN', 'an editor verifying a payment');
    perform pg_temp.expect_code(format($q$select public.admin_verify_registration_payment(%L, %L, '{"amountPaise": 50000}', 7, 'r')$q$, v_actor, r1), 'STALE', 'verifying an old revision');
    perform pg_temp.expect_code(format($q$select public.admin_verify_registration_payment(%L, %L, '{"amountPaise": -1}', 1, 'r')$q$, v_actor, r1), 'INVALID', 'a negative amount');
    perform pg_temp.expect_code(format($q$select public.admin_verify_registration_payment(%L, %L, '{"amountPaise": null}', 1, 'r')$q$, v_actor, r1), 'INVALID', 'no amount');
    perform pg_temp.expect_code(format($q$select public.admin_verify_registration_payment(%L, %L, '{"amountPaise": 1}', 1, 'r')$q$, v_actor, gen_random_uuid()), 'NOT_FOUND', 'an unknown registration');
    j := public.admin_verify_registration_payment(v_actor, r1, '{"amountPaise": 50000}', 1, 'test');
    if j ->> 'status' <> 'payment_verified' or (j ->> 'revision')::integer <> 2 then raise exception 'ASSERT FAIL: verify: %', j; end if;
    perform pg_temp.expect_code(format($q$select public.admin_convert_registration(%L, %L, %L::jsonb, 2, 'r')$q$, v_actor, r1,
      jsonb_build_object('players', jsonb_build_array(jsonb_build_object('name', 'Fake Reg Alpha', 'nameNormalized', 'fake reg alpha'), jsonb_build_object('playerId', pf)), 'status', 'confirmed')), 'INVALID', 'two players for one name');
    perform pg_temp.expect_code(format($q$select public.admin_convert_registration(%L, %L, %L::jsonb, 2, 'r')$q$, v_actor, r1,
      jsonb_build_object('players', jsonb_build_array(jsonb_build_object('name', 'Fake Reg Alpha', 'nameNormalized', 'fake reg alpha', 'ageStatus', 'adult_confirmed')), 'status', 'confirmed')), 'INVALID', 'a new player with an age status');
    j := public.admin_convert_registration(v_actor, r1, jsonb_build_object('players', jsonb_build_array(jsonb_build_object('name', 'Fake Reg Alpha', 'nameNormalized', 'fake reg alpha')), 'status', 'confirmed'), 2, 'test');
    if j ->> 'status' <> 'converted' or jsonb_array_length(j -> 'newPlayerIds') <> 1 then raise exception 'ASSERT FAIL: convert: %', j; end if;
    v_entry := (j ->> 'entryId')::uuid;
    v_new := (j -> 'newPlayerIds' ->> 0)::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_reject_registration(%L, %L, 3, 'r')$q$, v_actor, r1), 'INVALID', 'rejecting a converted registration');
    execute 'reset role';
    -- the new player is provisional, hidden, noindex, of UNKNOWN age, opaque slug: protected, never named (D-012, D-109, D-116)
    if not exists (select 1 from public.players p where p.id = v_new and p.age_status = 'unknown' and p.is_provisional and p.visibility = 'hidden' and p.noindex and p.slug_kind = 'opaque' and p.created_source = 'admin') then
      raise exception 'ASSERT FAIL: the converted player is not provisional, hidden and of unknown age';
    end if;
    if exists (select 1 from app.competition_named_players where id = v_new) then raise exception 'ASSERT FAIL: the converted player can be named'; end if;
    if not exists (select 1 from app.competition_entry_faces f where f.entry_id = v_entry and f.is_protected and f.player1_name is null and f.player1_slug is null) then
      raise exception 'ASSERT FAIL: the converted entry is not shown as a protected player';
    end if;
    if (select status from public.event_entries where id = v_entry) <> 'confirmed' or (select entry_id from public.event_registrations where id = r1) <> v_entry then
      raise exception 'ASSERT FAIL: the entry is not linked to the registration';
    end if;
    execute 'set local role service_role';

    -- a free doubles registration converts without verification; one existing adult (keeps their own status: named) and one new player
    j := public.admin_convert_registration(v_actor, r2, jsonb_build_object('players', jsonb_build_array(jsonb_build_object('playerId', pf), jsonb_build_object('name', 'Fake Reg Charlie', 'nameNormalized', 'fake reg charlie')), 'status', 'pending'), 1, 'test');
    v_entry := (j ->> 'entryId')::uuid;
    execute 'reset role';
    if (select age_status from public.players where id = pf) <> 'adult_confirmed' then raise exception 'ASSERT FAIL: conversion changed an age status'; end if;
    -- the pair is hidden as a whole: one protected member makes the entry protected (D-115)
    if not exists (select 1 from app.competition_entry_faces f where f.entry_id = v_entry and f.is_protected and f.player2_name is null) then
      raise exception 'ASSERT FAIL: a pair with a new, unknown-age player is not protected';
    end if;
    -- a suppressed name is refused (pick the existing record or reject)
    insert into public.suppression (kind, value, reason, created_by) values ('name_normalized', 'fake reg delta', 'fake removal request', 'fake-admin');
    execute 'set local role service_role';
    perform public.admin_verify_registration_payment(v_actor, r3, '{"amountPaise": 0}', 1, 'fee waived (test)');
    perform pg_temp.expect_code(format($q$select public.admin_convert_registration(%L, %L, %L::jsonb, 2, 'r')$q$, v_actor, r3,
      jsonb_build_object('players', jsonb_build_array(jsonb_build_object('name', 'Fake Reg Delta', 'nameNormalized', 'fake reg delta')), 'status', 'confirmed')), 'INVALID', 'a suppressed name');
    perform pg_temp.expect_code(format($q$select public.admin_reject_registration(%L, %L, 2, '')$q$, v_actor, r3), 'INVALID', 'rejecting without a reason');
    perform pg_temp.expect_code(format($q$select public.admin_reject_registration(%L, %L, 2, 'called 90000 00000, duplicate')$q$, v_actor, r3), 'INVALID', 'a phone number in the reject reason');
    j := public.admin_reject_registration(v_actor, r3, 2, 'Fake reason: duplicate of another entry');
    if j ->> 'status' <> 'rejected' then raise exception 'ASSERT FAIL: reject: %', j; end if;
    perform pg_temp.expect_code(format($q$select public.admin_verify_registration_payment(%L, %L, '{"amountPaise": 1}', 3, 'r')$q$, v_actor, r3), 'INVALID', 'verifying a rejected registration');
    -- the rejected one frees the place: a new registration fits again
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAK', 'player1Name', 'Fake Reg Echo', 'phone', '910000000004'));
    -- MS (capacity 3) now holds two entries (the owner's for Foxtrot, Alpha's converted one) and no active registration
    if j ->> 'outcome' <> 'created' then raise exception 'ASSERT FAIL: after a rejection the place was not freed: %', j; end if;
    r4 := (j ->> 'id')::uuid;
    execute 'reset role';

    -- ---------------------------------------------------------------- switched off again: nothing public, nothing taken
    update public.competition_settings set registration_enabled = false, payment_mode = 'off' where id = 1;
    if exists (select 1 from api.public_registration_events) or exists (select 1 from api.public_registration_payment) then
      raise exception 'ASSERT FAIL: the registration views show data while switched off';
    end if;
    execute 'set local role service_role';
    j := public.registration_submit(base || jsonb_build_object('idempotencyKey', gen_random_uuid(), 'ref', 'PSR-2026-AAAAAM', 'player1Name', 'Fake Reg Golf', 'phone', '910000000005'));
    if j ->> 'outcome' <> 'closed' then raise exception 'ASSERT FAIL: a registration was taken after switching off: %', j; end if;
    execute 'reset role';

    -- ---------------------------------------------------------------- audit: ids, counts, codes and amounts only
    if exists (select 1 from public.audit_log where action in ('submit_registration', 'set_registration_settings', 'set_event_registration', 'verify_registration_payment',
                 'convert_registration', 'reject_registration') and diff::text ~* '91000000000|example\.test|UTR0000111122|fake reg|fakepayee|fakeiphash') then
      raise exception 'ASSERT FAIL: a 0020 audit row holds contact data, a name or a payment reference';
    end if;
    select count(*) into n from public.audit_log where action in ('set_registration_settings', 'set_event_registration', 'verify_registration_payment', 'convert_registration', 'reject_registration') and actor = v_actor;
    if n < 6 then raise exception 'ASSERT FAIL: the 0020 owner actions were not audited (% rows)', n; end if;
    if (select count(*) from public.audit_log where action = 'submit_registration' and actor = 'public:registration') < 3 then
      raise exception 'ASSERT FAIL: the public registrations were not audited';
    end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0020_registrations assertions passed' as result;
