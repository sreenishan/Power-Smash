-- 0022_assertions.sql - self-check for migration 0022_international_links.sql (international events listed with links only, D-112).
-- Run it after applying 0001..0022. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
-- events ("Fake Intl" names). It raises an exception naming the first broken rule and ends with one row `ok`.

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
  rpcs text[] := array['public.admin_save_international_event(text,uuid,jsonb,integer,text)',
    'public.admin_set_international_event_published(text,uuid,boolean,integer,text)', 'public.admin_set_international_hosts(text,jsonb,text)'];
  helpers text[] := array['app.international_default_hosts()', 'app.international_host_problem(text)', 'app.international_link_problem(text,text[])',
    'app.international_hosts_problem(text[])', 'app.international_text(jsonb,text,integer,integer,boolean)', 'app.international_date(jsonb,text)',
    'app.international_allowed_hosts()'];
  fn text;
  c text;
  t text;
  h text;
begin
  foreach fn in array rpcs loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
    if (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure) !~ '\mbegin\s+perform app\.require_owner\(p_actor\);' then
      raise exception 'ASSERT FAIL: % does not call app.require_owner first', fn;
    end if;
  end loop;
  foreach fn in array helpers loop
    if not coalesce((select 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure), false) then
      raise exception 'ASSERT FAIL: % has no fixed search_path', fn;
    end if;
    if (select pr.prosecdef from pg_proc pr where pr.oid = fn::regprocedure) then raise exception 'ASSERT FAIL: helper % is SECURITY DEFINER', fn; end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: an API role can run %', fn;
    end if;
  end loop;
  -- the two tables: RLS on, no policy, nothing for anon/authenticated, SELECT only for service_role
  foreach t in array array['public.international_events', 'public.international_settings'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = t::regclass) then raise exception 'ASSERT FAIL: % has no row level security', t; end if;
    if exists (select 1 from pg_policy p where p.polrelid = t::regclass) then raise exception 'ASSERT FAIL: % has a policy', t; end if;
    foreach c in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', t, c) or has_table_privilege('authenticated', t, c) then raise exception 'ASSERT FAIL: an API role has % on %', c, t; end if;
    end loop;
    if not has_table_privilege('service_role', t, 'SELECT') or has_table_privilege('service_role', t, 'INSERT')
       or has_table_privilege('service_role', t, 'UPDATE') or has_table_privilege('service_role', t, 'DELETE') then
      raise exception 'ASSERT FAIL: service_role privileges on % are not SELECT only', t;
    end if;
  end loop;
  -- no player, phone or email column anywhere (public facts only, nobody named: D-012, D-109, D-116)
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('international_events', 'international_settings')
             and column_name ~ '(player|phone|email|contact|whatsapp)') then
    raise exception 'ASSERT FAIL: an international table holds a player or contact column';
  end if;
  -- the api view: exact columns in order, security_barrier, SELECT only for anon and authenticated
  if (select jsonb_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = 'public_international_events')
     is distinct from '["id", "name", "level_text", "start_date", "end_date", "city", "country", "official_url"]'::jsonb then
    raise exception 'ASSERT FAIL: api.public_international_events does not have the planned columns';
  end if;
  if not coalesce((select 'security_barrier=true' = any (cl.reloptions) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = 'public_international_events'), false)
     or not has_table_privilege('anon', 'api.public_international_events', 'SELECT') or not has_table_privilege('authenticated', 'api.public_international_events', 'SELECT')
     or has_table_privilege('anon', 'api.public_international_events', 'INSERT') or has_table_privilege('anon', 'api.public_international_events', 'UPDATE')
     or has_table_privilege('anon', 'api.public_international_events', 'DELETE') then
    raise exception 'ASSERT FAIL: api.public_international_events lost its barrier or has the wrong grants';
  end if;
  -- the view writes the default hosts out; they must be the same list as app.international_default_hosts()
  foreach h in array app.international_default_hosts() loop
    if position(quote_literal(h) in pg_get_viewdef('api.public_international_events'::regclass)) = 0 then
      raise exception 'ASSERT FAIL: the view does not allow the default host %', h;
    end if;
  end loop;
  if position('published' in pg_get_viewdef('api.public_international_events'::regclass)) = 0 or position('extra_hosts' in pg_get_viewdef('api.public_international_events'::regclass)) = 0 then
    raise exception 'ASSERT FAIL: the view does not filter on published rows and the owner''s hosts';
  end if;
  if (select count(*) from public.international_settings) <> 1 or (select extra_hosts from public.international_settings where id = 1) is null then
    raise exception 'ASSERT FAIL: international_settings must hold exactly one row';
  end if;

  -- the link rule (pure): accepted
  foreach c in array array['https://bwfbadminton.com/', 'https://www.bwfbadminton.com/calendar/?id=1', 'http://bwf.tournamentsoftware.com/',
                           'https://www.tournamentsoftware.com/tournament/x?id=ABC&tab=1'] loop
    if app.international_link_problem(c, app.international_default_hosts()) is not null then
      raise exception 'ASSERT FAIL: a good link is refused: % (%)', c, app.international_link_problem(c, app.international_default_hosts());
    end if;
  end loop;
  -- refused: lookalike hosts, user info, ports, punycode, upper case, other schemes, a # part, tracking, no path, IP, a deeper www
  foreach c in array array['https://bwfbadminton.com.evil.test/', 'https://evilbwfbadminton.com/', 'https://bwfbadminton.co/', 'https://bwf-badminton.com/',
                           'https://user@bwfbadminton.com/', 'https://user:pw@bwfbadminton.com/', 'https://bwfbadminton.com@evil.test/', 'https://bwfbadminton.com:443/',
                           'https://bwfbadminton.com:8443/', 'https://xn--bwfbdminton-q9a.com/', 'https://bwfbadminton.xn--com-9o0a/', 'https://BWFbadminton.com/',
                           'ftp://bwfbadminton.com/', 'javascript:alert(1)//bwfbadminton.com/', 'https://bwfbadminton.com/#results', 'https://bwfbadminton.com/?utm_source=x',
                           'https://bwfbadminton.com/?a=1&fbclid=2', 'https://bwfbadminton.com/?GCLID=2', 'https://bwfbadminton.com', 'https://192.168.0.1/',
                           'https://www.www.bwfbadminton.com/', 'https://sub.bwfbadminton.com/', 'https://bwfbadminton.com/a b', 'https://bwfbadminton.com/\x',
                           '//bwfbadminton.com/', 'https://tournamentsoftware.com.bwfbadminton.com.evil.test/'] loop
    if app.international_link_problem(c, app.international_default_hosts()) is null then
      raise exception 'ASSERT FAIL: a bad link is accepted: %', c;
    end if;
  end loop;
  -- shape only (p_hosts null): any proper host passes, the shape rules still apply
  if app.international_link_problem('https://example.org/', null) is not null or app.international_link_problem('https://example.org:81/', null) is null then
    raise exception 'ASSERT FAIL: the shape-only link check is wrong';
  end if;
  -- the host rule
  if app.international_host_problem('example.org') is not null or app.international_host_problem('corporate.example.org') is not null then
    raise exception 'ASSERT FAIL: a good host is refused';
  end if;
  foreach c in array array['www.example.org', 'xn--exmple-cua.org', 'bit.ly', '127.0.0.1', 'example', 'Example.org', 'example.org/', 'https://example.org',
                           'ex ample.org', '-example.org', 'example.org:80', 'user@example.org'] loop
    if app.international_host_problem(c) is null then raise exception 'ASSERT FAIL: a bad host is accepted: %', c; end if;
  end loop;
  if app.international_hosts_problem(array['example.org', 'example.net']) is not null
     or app.international_hosts_problem(array['bwfbadminton.com']) is null
     or app.international_hosts_problem(array['example.org', 'example.org']) is null then
    raise exception 'ASSERT FAIL: the host list rule is wrong';
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
  j jsonb;
  e1 uuid;
  e2 uuid;
  rev integer;
  rec jsonb := jsonb_build_object('name', 'Fake Intl Open 2026', 'levelText', 'Fake level 500', 'startDate', '2026-11-17', 'endDate', '2026-11-22',
    'city', 'Fake City', 'country', 'Fake Country', 'officialUrl', 'https://bwfbadminton.com/', 'published', true);
  n integer;
  v_msg text;
begin
  begin
    -- a real owner may already exist (OT-51); set it aside for this rolled-back test only
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    update public.site_state set dirty = false, dirty_since = null, dirty_reason = null where id = 1;
    execute 'set local role service_role';

    -- add: a shown event appears in the view and marks the site dirty
    j := public.admin_save_international_event(v_actor, null, rec, null, 'test');
    e1 := (j ->> 'id')::uuid;
    if (j ->> 'created')::boolean is not true or (j ->> 'revision')::integer <> 1 or jsonb_array_length(j -> 'fields') <> 8 then raise exception 'ASSERT FAIL: add returned %', j; end if;
    execute 'reset role';
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: adding a shown event did not mark the site dirty'; end if;
    if (select count(*) from api.public_international_events where id = e1) <> 1 then raise exception 'ASSERT FAIL: the shown event is not in the view'; end if;
    -- texts are tidied (spaces squashed), empty optional texts become null
    execute 'set local role service_role';
    j := public.admin_save_international_event(v_actor, null, rec || jsonb_build_object('name', '  Fake   Intl Hidden  ', 'levelText', '', 'city', null, 'published', false), null, 'test');
    e2 := (j ->> 'id')::uuid;
    execute 'reset role';
    if (select name || '|' || coalesce(level_text, '-') || '|' || coalesce(city, '-') from public.international_events where id = e2) <> 'Fake Intl Hidden|-|-' then
      raise exception 'ASSERT FAIL: the texts were not tidied';
    end if;
    if exists (select 1 from api.public_international_events where id = e2) then raise exception 'ASSERT FAIL: a hidden event is in the view'; end if;

    -- refusals (each one INVALID, NOT_FOUND, STALE or FORBIDDEN)
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"officialUrl": "https://bwfbadminton.com.evil.test/"}'), 'INVALID', 'a lookalike host');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"officialUrl": "https://user@bwfbadminton.com/"}'), 'INVALID', 'a link with user info');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"officialUrl": "https://bwfbadminton.com:8443/"}'), 'INVALID', 'a link with a port');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"officialUrl": "https://xn--bwfbdminton-q9a.com/"}'), 'INVALID', 'a punycode host');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"officialUrl": "https://bwfbadminton.com/?utm_source=x"}'), 'INVALID', 'a tracking parameter');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"officialUrl": "https://example.org/"}'), 'INVALID', 'a host not on the list');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"endDate": "2026-11-16"}'), 'INVALID', 'an end before the start');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"endDate": "2027-02-17"}'), 'INVALID', 'an event longer than 60 days');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"startDate": "2026-02-30"}'), 'INVALID', 'a date that does not exist');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"name": "<b>x</b>"}'), 'INVALID', 'a name with < or >');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec || '{"phone": "910000000000"}'), 'INVALID', 'an unknown field');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec - 'country'), 'INVALID', 'a missing field');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, '  ')$q$, v_actor, rec), 'INVALID', 'no reason');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, 1, 'r')$q$, v_actor, rec), 'INVALID', 'a new event with a revision');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_ed, rec), 'FORBIDDEN', 'an editor adding an event');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, %L, %L, 1, 'r')$q$, v_actor, gen_random_uuid(), rec), 'NOT_FOUND', 'editing a missing event');
    perform pg_temp.expect_code(format($q$select public.admin_save_international_event(%L, %L, %L, 7, 'r')$q$, v_actor, e1, rec), 'STALE', 'editing with an old revision');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_event_published(%L, %L, false, 7, 'r')$q$, v_actor, e1), 'STALE', 'hiding with an old revision');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_event_published(%L, %L, false, 1, 'r')$q$, v_ed, e1), 'FORBIDDEN', 'an editor hiding an event');

    -- edit: nothing changed = no revision bump; a change bumps it and names the field
    j := public.admin_save_international_event(v_actor, e1, rec, 1, 'test');
    if jsonb_array_length(j -> 'fields') <> 0 or (j ->> 'revision')::integer <> 1 then raise exception 'ASSERT FAIL: an unchanged save returned %', j; end if;
    j := public.admin_save_international_event(v_actor, e1, rec || '{"city": "Fake Other City"}', 1, 'test');
    if j -> 'fields' <> '["city"]'::jsonb or (j ->> 'revision')::integer <> 2 then raise exception 'ASSERT FAIL: an edit returned %', j; end if;

    -- hide and show
    j := public.admin_set_international_event_published(v_actor, e1, false, 2, 'test');
    if (j ->> 'changed')::boolean is not true or (j ->> 'revision')::integer <> 3 then raise exception 'ASSERT FAIL: hide returned %', j; end if;
    execute 'reset role';
    if exists (select 1 from api.public_international_events where id = e1) then raise exception 'ASSERT FAIL: a hidden event is still in the view'; end if;
    execute 'set local role service_role';
    j := public.admin_set_international_event_published(v_actor, e1, false, 3, 'test');
    if (j ->> 'changed')::boolean is not false then raise exception 'ASSERT FAIL: hiding twice changed something'; end if;
    j := public.admin_set_international_event_published(v_actor, e1, true, 3, 'test');

    -- the owner's hosts: refusals, then a host added, an event on it shown, the host removed (the view drops the event, showing it is refused)
    perform pg_temp.expect_code(format($q$select public.admin_set_international_hosts(%L, '["bwfbadminton.com"]', 'r')$q$, v_actor), 'INVALID', 'a default host added again');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_hosts(%L, '["bit.ly"]', 'r')$q$, v_actor), 'INVALID', 'a link shortener');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_hosts(%L, '["xn--exmple-cua.org"]', 'r')$q$, v_actor), 'INVALID', 'a punycode host');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_hosts(%L, '["example.org", "example.org"]', 'r')$q$, v_actor), 'INVALID', 'a repeated host');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_hosts(%L, '["www.example.org"]', 'r')$q$, v_actor), 'INVALID', 'a www host');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_hosts(%L, '[1]', 'r')$q$, v_actor), 'INVALID', 'a host that is not text');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_hosts(%L, '["example.org"]', 'r')$q$, v_ed), 'FORBIDDEN', 'an editor changing the hosts');
    j := public.admin_set_international_hosts(v_actor, '["example.org"]', 'test');
    if j -> 'hosts' <> '["example.org"]'::jsonb or j -> 'fields' <> '["extra_hosts"]'::jsonb or (j ->> 'eventsOffList')::integer <> 0 then raise exception 'ASSERT FAIL: adding a host returned %', j; end if;
    j := public.admin_save_international_event(v_actor, e2, rec || '{"officialUrl": "https://www.example.org/fake-intl/?id=7", "published": true}', 1, 'test');
    rev := (j ->> 'revision')::integer;
    execute 'reset role';
    if (select count(*) from api.public_international_events where id = e2) <> 1 then raise exception 'ASSERT FAIL: an event on an added host is not in the view'; end if;
    execute 'set local role service_role';
    j := public.admin_set_international_hosts(v_actor, '[]', 'test');
    if (j ->> 'eventsOffList')::integer <> 1 then raise exception 'ASSERT FAIL: removing a host did not count the event off the list: %', j; end if;
    execute 'reset role';
    if exists (select 1 from api.public_international_events where id = e2) then raise exception 'ASSERT FAIL: an event whose host was removed is still in the view'; end if;
    execute 'set local role service_role';
    j := public.admin_set_international_event_published(v_actor, e2, false, rev, 'test');
    perform pg_temp.expect_code(format($q$select public.admin_set_international_event_published(%L, %L, true, %s, 'r')$q$, v_actor, e2, rev + 1), 'INVALID', 'showing an event whose host was removed');
    execute 'reset role';

    -- the table constraint holds even without the RPCs (shape only)
    perform pg_temp.expect_fail($q$insert into public.international_events (name, start_date, end_date, country, official_url) values ('Fake Intl Bad', '2026-01-01', '2026-01-02', 'Fake Country', 'https://u@bwfbadminton.com/')$q$, 'a stored link with user info');
    perform pg_temp.expect_fail($q$insert into public.international_events (name, start_date, end_date, country, official_url) values ('Fake Intl Bad', '2026-01-01', '2026-01-02', 'Fake Country', 'https://bwfbadminton.com/?utm_medium=x')$q$, 'a stored link with tracking');
    perform pg_temp.expect_fail($q$update public.international_settings set extra_hosts = array['bit.ly'] where id = 1$q$, 'a shortener in the settings');
    perform pg_temp.expect_fail($q$delete from public.international_settings$q$, 'deleting the settings row');

    -- audit: field names, counts and flags only; never the event's text or link
    if (select count(*) from public.audit_log where actor = v_actor and action in ('create_international_event', 'update_international_event', 'set_international_event_published', 'set_international_hosts')) < 7 then
      raise exception 'ASSERT FAIL: the 0022 actions were not audited';
    end if;
    if exists (select 1 from public.audit_log where action in ('create_international_event', 'update_international_event', 'set_international_event_published', 'set_international_hosts')
               and diff::text ~* 'fake intl|fake city|fake country|bwfbadminton|example\.org|https?:') then
      raise exception 'ASSERT FAIL: a 0022 audit row holds an event text, a host or a link';
    end if;

    -- anon: the view only
    execute 'set local role anon';
    select count(*) into n from api.public_international_events;
    perform pg_temp.expect_fail($q$select count(*) from public.international_events$q$, 'anon reading the events table');
    perform pg_temp.expect_fail($q$select extra_hosts from public.international_settings$q$, 'anon reading the settings');
    perform pg_temp.expect_fail(format($q$select public.admin_save_international_event(%L, null, %L, null, 'r')$q$, v_actor, rec), 'anon adding an event');
    perform pg_temp.expect_fail(format($q$select public.admin_set_international_hosts(%L, '[]', 'r')$q$, v_actor), 'anon changing the hosts');
    perform pg_temp.expect_fail($q$select app.international_link_problem('https://bwfbadminton.com/', null)$q$, 'anon running a helper');
    execute 'reset role';
    execute 'set local role authenticated';
    perform pg_temp.expect_fail($q$select count(*) from public.international_events$q$, 'authenticated reading the events table');
    perform pg_temp.expect_fail(format($q$select public.admin_set_international_event_published(%L, %L, false, 1, 'r')$q$, v_actor, e1), 'authenticated hiding an event');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0022_international_links assertions passed' as result;
