-- 0023_assertions.sql - self-check for migration 0023_notifications.sql (the outbox's dispatcher columns, email subscriptions with
-- double opt-in, site notices, the email sign-up switch). Run it after applying 0001..0023. It changes nothing: the behaviour tests run
-- in a sub-transaction that is rolled back, with FICTIONAL people, addresses and texts. It raises an exception naming the first broken
-- rule and ends with one row `ok`.
-- The rule cases between the "payload-cases" and "text-cases" markers are read by tests/notify-outbox/payload-parity.test.ts and run
-- through the TS copies of the same rules: change them in one place only.

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
  t text;
  p text;
  fn text;
  v text;
  cols text[];
  owner_rpcs text[] := array['public.admin_save_site_notice(text,uuid,jsonb,integer,text)', 'public.admin_publish_site_notice(text,uuid,boolean,integer,text)',
    'public.admin_set_notify_settings(text,jsonb,text)', 'public.admin_queue_subscriber_announcement(text,jsonb,text)', 'public.admin_notify_summary(text)'];
  system_rpcs text[] := array['public.notify_subscribe(jsonb)', 'public.notify_confirm(text)', 'public.notify_unsubscribe(uuid)',
    'public.notify_outbox_enqueue(jsonb)', 'public.notify_outbox_cas(text,text,integer,jsonb)'];
  helpers text[] := array['app.notify_text_ok(text,integer,boolean)', 'app.site_notice_link_ok(text)', 'app.site_notice_path_ok(text)'];
begin
  foreach t in array array['notify_subscribers', 'notify_settings', 'site_notices', 'notification_outbox'] loop
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

  -- the api views: security_barrier, explicit columns, readable by anon, nothing else
  foreach v in array array['public_site_notices', 'public_notify_settings'] loop
    if not coalesce((select 'security_barrier=true' = any (cl.reloptions) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = v), false) then
      raise exception 'ASSERT FAIL: api.% is not a security_barrier view', v;
    end if;
    if not (has_table_privilege('anon', format('api.%I', v), 'SELECT') and has_table_privilege('authenticated', format('api.%I', v), 'SELECT')) then
      raise exception 'ASSERT FAIL: api.% is not readable by anon', v;
    end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', format('api.%I', v), p) then raise exception 'ASSERT FAIL: anon holds % on api.%', p, v; end if;
    end loop;
  end loop;
  select array_agg(a.attname::text order by a.attnum) into cols from pg_attribute a where a.attrelid = 'api.public_site_notices'::regclass and a.attnum > 0 and not a.attisdropped;
  if cols is distinct from array['id', 'title', 'body', 'link_path', 'link_url', 'link_label', 'starts_at', 'ends_at', 'updated_at'] then
    raise exception 'ASSERT FAIL: api.public_site_notices columns changed: %', cols;
  end if;
  select array_agg(a.attname::text order by a.attnum) into cols from pg_attribute a where a.attrelid = 'api.public_notify_settings'::regclass and a.attnum > 0 and not a.attisdropped;
  if cols is distinct from array['email_subscribe_open'] then raise exception 'ASSERT FAIL: api.public_notify_settings columns changed: %', cols; end if;
  -- no view in api reads the subscribers or the outbox
  if exists (select 1 from pg_views where schemaname = 'api' and (definition ~ 'notify_subscribers' or definition ~ 'notification_outbox')) then
    raise exception 'ASSERT FAIL: an api view reads the subscribers or the outbox';
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
  foreach fn in array helpers loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: a role can run the helper %', fn;
    end if;
  end loop;
  -- every switch starts off
  if (select s.email_subscribe_open from public.notify_settings s where s.id = 1) is distinct from false then raise exception 'ASSERT FAIL: the email sign-up does not start closed'; end if;
  if exists (select 1 from public.site_notices where published) then raise exception 'ASSERT FAIL: a notice starts published'; end if;
  if exists (select 1 from public.notify_subscribers) then raise exception 'ASSERT FAIL: the migration created subscribers'; end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. the shared rules (the same cases run in TS: tests/notify-outbox/payload-parity.test.ts)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in select * from (values
    -- payload-cases:begin
    ('{"event": "c0230000-0000-4000-8000-000000000001", "revision": 0}', true),
    ('{"event": "reg-approved", "revision": 3}', true),
    ('{"event": "ann:sample-1", "revision": 999999}', true),
    ('{"event": "x", "revision": 1000000}', false),
    ('{"event": "910000000000", "revision": 0}', false),
    ('{"event": "fake@example.test", "revision": 0}', false),
    ('{"event": "Fake Person", "revision": 0}', false),
    ('{"phone": "x"}', false),
    ('{"recipient": "x"}', false),
    ('{"event": {"nested": 1}}', false),
    ('{"event": ["a"]}', false),
    ('[]', false)
    -- payload-cases:end
  ) as t(p, ok) loop
    if app.competition_outbox_payload_ok(c.p::jsonb) is distinct from c.ok then raise exception 'ASSERT FAIL: payload rule on % should be %', c.p, c.ok; end if;
  end loop;

  for c in select * from (values
    -- text-cases:begin
    ('Hi there, the draw for MS U19 is out.', 200, false, true),
    ('Your match is on Saturday, 7 November 2026 at 9:30 am (India time).', 200, false, true),
    ('Reference PSR-2026-ABC123', 200, false, true),
    ('Line one\nLine two', 3000, true, true),
    ('Line one\nLine two', 200, false, false),
    ('Call 910000000000 now', 3000, true, false),
    ('Call +91 00000 00000 now', 3000, true, false),
    ('Call 91-0000-00000', 3000, true, false),
    ('Write to fake.person@example.test', 3000, true, false),
    ('Chat https://wa.me/910000000000', 3000, true, false),
    ('Chat at wa.me/abc', 3000, true, false),
    ('Dial tel:12345', 3000, true, false),
    ('Year 2026-10-31 is fine', 200, false, true),
    ('abcdefghij', 5, false, false)
    -- text-cases:end
  ) as t(txt, mx, ml, ok) loop
    if app.notify_text_ok(replace(c.txt, '\n', chr(10)), c.mx, c.ml) is distinct from c.ok then raise exception 'ASSERT FAIL: text rule on % should be %', c.txt, c.ok; end if;
  end loop;

  -- notice links: an allow-listed https account link or a site page; never a chat link, an endpoint or another site
  if not app.site_notice_link_ok('https://www.youtube.com/@PowerSmash') or not app.site_notice_link_ok('https://whatsapp.com/channel/0029SampleChannel0000')
     or not app.site_notice_link_ok('https://www.instagram.com/sample_account/') then
    raise exception 'ASSERT FAIL: an allowed notice link was refused';
  end if;
  if app.site_notice_link_ok('https://example.com/') or app.site_notice_link_ok('http://www.youtube.com/x') or app.site_notice_link_ok('https://wa.me/910000000000')
     or app.site_notice_link_ok('https://whatsapp.com/send?phone=910000000000') or app.site_notice_link_ok('https://www.youtube.com.evil.test/')
     or app.site_notice_link_ok('https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.test')
     or app.site_notice_link_ok('https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3DAAAAAAAAAAA') then
    raise exception 'ASSERT FAIL: a notice link outside the allow-list was accepted';
  end if;
  if not app.site_notice_path_ok('/') or not app.site_notice_path_ok('/competitions/') or app.site_notice_path_ok('/api/notify/') or app.site_notice_path_ok('//evil.test/')
     or app.site_notice_path_ok('/competitions') or app.site_notice_path_ok('https://example.com/') then
    raise exception 'ASSERT FAIL: the notice page rule is wrong';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- C. behaviour (rolled back)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  v_ed text := '22222222-2222-4222-8222-222222222222';
  h1 text := repeat('a', 64);
  h2 text := repeat('b', 64);
  h3 text := repeat('c', 64);
  ann1 uuid := 'c0230000-0000-4000-8000-0000000000a1';
  ann2 uuid := 'c0230000-0000-4000-8000-0000000000a2';
  s1 uuid;
  s2 uuid;
  j jsonb;
  k text;
  n1 uuid;
  n2 uuid;
  n3 uuid;
  o1 uuid;
  rev integer;
  ok boolean;
  rec jsonb;
begin
  begin
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    update public.site_state set dirty = false, dirty_since = null where id = 1;

    -- ---------------------------------------------------------------- the switch: closed by default, owner only
    j := public.notify_subscribe(('{"email": "fake.subscriber@example.test", "consentId": "email-updates-notice", "consentVersion": "2026-10-31-draft1", "tokenHash": "' || h1 || '"}')::jsonb);
    if j ->> 'outcome' <> 'closed' or exists (select 1 from public.notify_subscribers) then raise exception 'ASSERT FAIL: a closed sign-up stored an address'; end if;
    if public.notify_confirm(h1) ->> 'outcome' <> 'closed' then raise exception 'ASSERT FAIL: a closed sign-up confirmed'; end if;
    perform pg_temp.expect_code(format($q$select public.admin_set_notify_settings(%L, '{"emailSubscribeOpen": true}', 'r')$q$, v_ed), 'FORBIDDEN', 'an editor opening the sign-up');
    perform pg_temp.expect_code(format($q$select public.admin_set_notify_settings(%L, '{"emailSubscribeOpen": true}', '')$q$, v_actor), 'INVALID', 'a switch change without a reason');
    j := public.admin_set_notify_settings(v_actor, '{"emailSubscribeOpen": true}', 'fake test');
    if (j ->> 'emailSubscribeOpen')::boolean is not true or not (select s.email_subscribe_open from public.notify_settings s where s.id = 1) then raise exception 'ASSERT FAIL: the owner could not open the sign-up'; end if;
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: the sign-up switch did not mark the site for a rebuild'; end if;
    if (select email_subscribe_open from api.public_notify_settings) is not true then raise exception 'ASSERT FAIL: the public switch view is wrong'; end if;

    -- ---------------------------------------------------------------- sign-up, confirm, repeat answers
    perform pg_temp.expect_code($q$select public.notify_subscribe('{"email": "not-an-address", "consentId": "email-updates-notice", "consentVersion": "v1", "tokenHash": "$q$ || h2 || $q$"}')$q$, 'INVALID', 'a bad address');
    perform pg_temp.expect_code($q$select public.notify_subscribe('{"email": "fake.b@example.test", "consentId": "email-updates-notice", "consentVersion": "v1", "tokenHash": "short"}')$q$, 'INVALID', 'a bad token hash');
    perform pg_temp.expect_code($q$select public.notify_subscribe('{"email": "fake.b@example.test", "consentId": "email-updates-notice", "consentVersion": "v1"}')$q$, 'INVALID', 'a missing token hash');
    j := public.notify_subscribe(('{"email": "Fake.Subscriber@Example.TEST", "consentId": "email-updates-notice", "consentVersion": "2026-10-31-draft1", "tokenHash": "' || h1 || '"}')::jsonb);
    if j ->> 'outcome' <> 'send' then raise exception 'ASSERT FAIL: a new sign-up did not ask for a confirmation email: %', j; end if;
    s1 := (j ->> 'id')::uuid;
    if not exists (select 1 from public.notify_subscribers s where s.id = s1 and s.email = 'fake.subscriber@example.test' and s.status = 'pending' and s.confirm_token_hash = h1 and s.confirm_expires_at > now() + interval '47 hours') then
      raise exception 'ASSERT FAIL: the sign-up row is wrong';
    end if;
    if public.notify_subscribe(('{"email": "fake.subscriber@example.test", "consentId": "email-updates-notice", "consentVersion": "2026-10-31-draft1", "tokenHash": "' || h2 || '"}')::jsonb) ->> 'outcome' <> 'too_soon' then
      raise exception 'ASSERT FAIL: a repeat within 5 minutes sent a second confirmation';
    end if;
    if public.notify_confirm(h2) ->> 'outcome' <> 'invalid' then raise exception 'ASSERT FAIL: an unknown token confirmed'; end if;
    if public.notify_confirm('not-a-hash') ->> 'outcome' <> 'invalid' then raise exception 'ASSERT FAIL: a malformed token was not refused'; end if;
    j := public.notify_confirm(h1);
    if j ->> 'outcome' <> 'confirmed' or (j ->> 'id')::uuid <> s1 then raise exception 'ASSERT FAIL: the right token did not confirm'; end if;
    if not exists (select 1 from public.notify_subscribers s where s.id = s1 and s.status = 'active' and s.confirmed_at is not null and s.confirm_token_hash is null) then
      raise exception 'ASSERT FAIL: the confirmed row is wrong (the token must be gone)';
    end if;
    if public.notify_confirm(h1) ->> 'outcome' <> 'invalid' then raise exception 'ASSERT FAIL: a confirmation link worked twice'; end if;
    if public.notify_subscribe(('{"email": "fake.subscriber@example.test", "consentId": "email-updates-notice", "consentVersion": "2026-10-31-draft1", "tokenHash": "' || h2 || '"}')::jsonb) ->> 'outcome' <> 'already_active' then
      raise exception 'ASSERT FAIL: an active address was asked to confirm again';
    end if;
    -- an expired link does not confirm
    j := public.notify_subscribe(('{"email": "fake.second@example.test", "consentId": "email-updates-notice", "consentVersion": "2026-10-31-draft1", "tokenHash": "' || h3 || '"}')::jsonb);
    s2 := (j ->> 'id')::uuid;
    update public.notify_subscribers set confirm_expires_at = now() - interval '1 second' where id = s2;
    if public.notify_confirm(h3) ->> 'outcome' <> 'invalid' then raise exception 'ASSERT FAIL: an expired link confirmed'; end if;

    -- ---------------------------------------------------------------- announcements to subscribers: TS keys, idempotent, no address
    perform pg_temp.expect_code(format($q$select public.admin_queue_subscriber_announcement(%L, '{"announcementId": "%s", "subject": "Hello", "body": "Text"}', 'r')$q$, v_ed, ann1), 'FORBIDDEN', 'an editor queueing an email');
    perform pg_temp.expect_code(format($q$select public.admin_queue_subscriber_announcement(%L, '{"announcementId": "%s", "subject": "Hello", "body": "Call 910000000000"}', 'r')$q$, v_actor, ann1), 'INVALID', 'a phone number in an announcement');
    j := public.admin_queue_subscriber_announcement(v_actor, jsonb_build_object('announcementId', ann1, 'subject', 'Sample news', 'body', 'Hi there,' || chr(10) || chr(10) || 'Sample text.' || chr(10) || chr(10) || '- Power Smash'), 'fake test');
    if (j ->> 'queued')::integer <> 1 then raise exception 'ASSERT FAIL: the announcement was not queued for exactly the one active subscriber: %', j; end if;
    k := 'ntf1:announcement:' || ann1::text || ':0:subscriber%3A' || s1::text || ':email';
    if not exists (select 1 from public.notification_outbox o where o.idempotency_key = k and o.channel = 'email' and o.status = 'queued' and o.recipient_subscriber_id = s1
                   and o.payload = jsonb_build_object('event', ann1::text, 'revision', 0) and o.subject = 'Sample news') then
      raise exception 'ASSERT FAIL: the queued announcement row is wrong';
    end if;
    if exists (select 1 from public.notification_outbox o where o.recipient_subscriber_id = s2) then raise exception 'ASSERT FAIL: an unconfirmed address got an announcement'; end if;
    j := public.admin_queue_subscriber_announcement(v_actor, jsonb_build_object('announcementId', ann1, 'subject', 'Sample news', 'body', 'Sample text.'), 'fake test');
    if (j ->> 'queued')::integer <> 0 or (j ->> 'duplicates')::integer <> 1 then raise exception 'ASSERT FAIL: a second press queued the announcement twice'; end if;
    if exists (select 1 from public.notification_outbox o where o.subject ~ '@' or o.body ~ '@' or o.payload::text ~ '@') then raise exception 'ASSERT FAIL: an address reached the outbox'; end if;

    -- ---------------------------------------------------------------- enqueue (TS store) and compare and set (dispatcher)
    rec := jsonb_build_object('key', 'ntf1:announcement:c0230000-0000-4000-8000-0000000000a3:0:subscriber%3A' || s1::text || ':email', 'kind', 'announcement',
      'channel', 'email', 'recipient', 'subscriber:' || s1::text, 'payload', jsonb_build_object('event', 'c0230000-0000-4000-8000-0000000000a3', 'revision', 0),
      'status', 'queued', 'skipReason', null, 'subject', 'Sample', 'body', 'Sample body', 'createdAt', '2026-10-31T00:00:00Z', 'notBefore', '2026-10-31T00:00:00Z', 'expiresAt', null);
    j := public.notify_outbox_enqueue(jsonb_build_array(rec, rec));
    if (j ->> 'inserted')::integer <> 1 or (j ->> 'duplicates')::integer <> 1 then raise exception 'ASSERT FAIL: enqueue is not idempotent on the key: %', j; end if;
    perform pg_temp.expect_fail(format('select public.notify_outbox_enqueue(%L)', jsonb_build_array(rec || jsonb_build_object('key', 'fake-key-phone-1', 'body', 'Call 910000000000'))), 'a phone number in a message');
    perform pg_temp.expect_fail(format('select public.notify_outbox_enqueue(%L)', jsonb_build_array(rec || jsonb_build_object('key', 'fake-key-mail-1', 'subject', 'fake@example.test'))), 'an email address in a subject');
    perform pg_temp.expect_fail(format('select public.notify_outbox_enqueue(%L)', jsonb_build_array(rec || jsonb_build_object('key', 'fake-key-inapp-1', 'channel', 'in_app'))), 'a subscriber on another channel');
    perform pg_temp.expect_code(format('select public.notify_outbox_enqueue(%L)', jsonb_build_array(rec || jsonb_build_object('key', 'fake-key-sent-1', 'status', 'sent'))), 'INVALID', 'a new record already sent');
    perform pg_temp.expect_code(format('select public.notify_outbox_enqueue(%L)', jsonb_build_array(rec || jsonb_build_object('key', 'fake-key-rcpt-1', 'recipient', 'fake@example.test'))), 'INVALID', 'an address as the recipient');
    perform pg_temp.expect_fail(format('select public.notify_outbox_enqueue(%L)', jsonb_build_array(rec || jsonb_build_object('key', 'fake-key-pay-1', 'payload', '{"phone": "x"}'::jsonb))), 'a contact key in the payload');
    perform pg_temp.expect_fail(format('select public.notify_outbox_enqueue(%L)', jsonb_build_array(rec || jsonb_build_object('key', 'bad key with spaces'))), 'a key outside the key form');

    k := 'ntf1:announcement:c0230000-0000-4000-8000-0000000000a3:0:subscriber%3A' || s1::text || ':email';
    ok := public.notify_outbox_cas(k, 'queued', 0, '{"status": "sending", "attempts": 1, "notBefore": "2026-10-31T00:00:00Z", "leaseUntil": "2026-10-31T00:05:00Z", "lastError": null, "skipReason": null, "sentAt": null}');
    if not ok then raise exception 'ASSERT FAIL: the claim failed'; end if;
    if public.notify_outbox_cas(k, 'queued', 0, '{"status": "sending", "attempts": 1, "notBefore": "2026-10-31T00:00:00Z", "leaseUntil": "2026-10-31T00:05:00Z", "lastError": null, "skipReason": null, "sentAt": null}') then
      raise exception 'ASSERT FAIL: a second dispatcher claimed the same record';
    end if;
    perform pg_temp.expect_fail(format($q$select public.notify_outbox_cas(%L, 'sending', 1, '{"status": "sending", "attempts": 1, "notBefore": null, "leaseUntil": null, "lastError": null, "skipReason": null, "sentAt": null}')$q$, k), 'sending without a lease');
    ok := public.notify_outbox_cas(k, 'sending', 1, '{"status": "sent", "attempts": 1, "notBefore": "2026-10-31T00:00:00Z", "leaseUntil": null, "lastError": null, "skipReason": null, "sentAt": "2026-10-31T00:01:00Z"}');
    if not ok or not exists (select 1 from public.notification_outbox o where o.idempotency_key = k and o.status = 'sent' and o.sent_at is not null) then raise exception 'ASSERT FAIL: sent was not recorded'; end if;
    if public.notify_outbox_cas(k, 'sent', 1, '{"status": "queued", "attempts": 1, "notBefore": null, "leaseUntil": null, "lastError": null, "skipReason": null, "sentAt": null}') then
      raise exception 'ASSERT FAIL: a sent record was reopened';
    end if;

    -- 0017's reference-only enqueue still works (in-app, no text: never picked up by the dispatcher)
    o1 := app.enqueue_notification('draw_published', null, v_owner, 'fake-outbox-key-0023', '{"draw": "ref"}');
    if not exists (select 1 from public.notification_outbox o where o.id = o1 and o.channel = 'in_app' and o.subject is null and o.body is null) then
      raise exception 'ASSERT FAIL: the 0017 enqueue path changed';
    end if;

    -- ---------------------------------------------------------------- unsubscribe: always works, skips queued email at once
    j := public.admin_queue_subscriber_announcement(v_actor, jsonb_build_object('announcementId', ann2, 'subject', 'Second sample', 'body', 'Sample text.'), 'fake test');
    update public.notify_settings set email_subscribe_open = false where id = 1;  -- a closed sign-up never blocks an unsubscribe
    j := public.notify_unsubscribe(s1);
    if j ->> 'outcome' <> 'unsubscribed' or (j ->> 'skipped')::integer < 1 then raise exception 'ASSERT FAIL: the unsubscribe did not work: %', j; end if;
    if exists (select 1 from public.notification_outbox o where o.recipient_subscriber_id = s1 and o.status = 'queued') then raise exception 'ASSERT FAIL: queued email survived an unsubscribe'; end if;
    if not exists (select 1 from public.notification_outbox o where o.recipient_subscriber_id = s1 and o.status = 'skipped' and o.skip_reason = 'consent_withdrawn') then
      raise exception 'ASSERT FAIL: the skipped email does not say why';
    end if;
    if public.notify_unsubscribe(s1) ->> 'outcome' <> 'unchanged' then raise exception 'ASSERT FAIL: a second unsubscribe changed something'; end if;
    if public.notify_unsubscribe('c0230000-0000-4000-8000-0000000000ff') ->> 'outcome' <> 'unchanged' then raise exception 'ASSERT FAIL: an unknown id was not answered calmly'; end if;
    -- signing up again needs a new confirmation
    update public.notify_settings set email_subscribe_open = true where id = 1;
    update public.notify_subscribers set last_confirmation_at = now() - interval '1 hour' where id = s1;
    j := public.notify_subscribe(('{"email": "fake.subscriber@example.test", "consentId": "email-updates-notice", "consentVersion": "2026-10-31-draft1", "tokenHash": "' || h2 || '"}')::jsonb);
    if j ->> 'outcome' <> 'send' or (select status from public.notify_subscribers where id = s1) <> 'pending' then raise exception 'ASSERT FAIL: a returning address was not asked to confirm again'; end if;

    -- ---------------------------------------------------------------- site notices
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_ed), 'FORBIDDEN', 'an editor writing a notice');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Call 910000000000", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'a phone number in a notice title');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": "Write to fake@example.test", "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'an email address in a notice');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": "/competitions/", "linkUrl": "https://www.youtube.com/x", "linkLabel": "See", "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'two links');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": null, "linkUrl": "https://example.com/", "linkLabel": "See", "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'an outside link not on the allow-list');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": null, "linkUrl": "https://wa.me/910000000000", "linkLabel": "Chat", "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'a WhatsApp chat link');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": "/api/notify/", "linkUrl": null, "linkLabel": "See", "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'an endpoint as the page');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": "See", "audience": "public", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'link words without a link');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "public", "startsAt": "2026-11-02T00:00:00Z", "endsAt": "2026-11-01T00:00:00Z"}', null, 'r')$q$, v_actor), 'INVALID', 'an end before the start');
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, null, '{"title": "Fake notice", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "everyone", "startsAt": null, "endsAt": null}', null, 'r')$q$, v_actor), 'INVALID', 'an unknown audience');

    j := public.admin_save_site_notice(v_actor, null, '{"title": "Fake notice one", "body": "Fake text.", "linkPath": "/competitions/", "linkUrl": null, "linkLabel": "See the competitions", "audience": "public", "startsAt": null, "endsAt": null}', null, 'fake test');
    n1 := (j ->> 'id')::uuid;
    if (j ->> 'revision')::integer <> 1 or (j ->> 'created')::boolean is not true then raise exception 'ASSERT FAIL: creating a notice answered %', j; end if;
    if exists (select 1 from api.public_site_notices) then raise exception 'ASSERT FAIL: an unpublished notice is public'; end if;
    update public.site_state set dirty = false where id = 1;
    perform pg_temp.expect_code(format($q$select public.admin_publish_site_notice(%L, %L, true, 7, 'r')$q$, v_actor, n1), 'STALE', 'publishing an old revision');
    j := public.admin_publish_site_notice(v_actor, n1, true, 1, 'fake test');
    if (j ->> 'published')::boolean is not true or (j ->> 'revision')::integer <> 2 then raise exception 'ASSERT FAIL: publishing answered %', j; end if;
    if not exists (select 1 from api.public_site_notices v where v.id = n1 and v.title = 'Fake notice one' and v.link_path = '/competitions/') then raise exception 'ASSERT FAIL: a published notice is not public'; end if;
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: publishing a notice did not mark the site for a rebuild'; end if;
    perform pg_temp.expect_code(format($q$select public.admin_save_site_notice(%L, %L, '{"title": "Fake notice one changed", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "public", "startsAt": null, "endsAt": null}', 1, 'r')$q$, v_actor, n1), 'STALE', 'an edit of an old revision');
    j := public.admin_save_site_notice(v_actor, n1, '{"title": "Fake notice one changed", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "public", "startsAt": null, "endsAt": null}', 2, 'fake test');
    if (j ->> 'revision')::integer <> 3 then raise exception 'ASSERT FAIL: an edit did not bump the revision'; end if;
    -- staff, future and ended notices stay out of the public view
    j := public.admin_save_site_notice(v_actor, null, '{"title": "Fake staff notice", "body": null, "linkPath": null, "linkUrl": null, "linkLabel": null, "audience": "staff", "startsAt": null, "endsAt": null}', null, 'fake test');
    n2 := (j ->> 'id')::uuid;
    perform public.admin_publish_site_notice(v_actor, n2, true, 1, 'fake test');
    j := public.admin_save_site_notice(v_actor, null, jsonb_build_object('title', 'Fake future notice', 'body', null, 'linkPath', null, 'linkUrl', null, 'linkLabel', null, 'audience', 'public',
      'startsAt', (now() + interval '1 day')::text, 'endsAt', null), null, 'fake test');
    n3 := (j ->> 'id')::uuid;
    perform public.admin_publish_site_notice(v_actor, n3, true, 1, 'fake test');
    if exists (select 1 from api.public_site_notices v where v.id in (n2, n3)) then raise exception 'ASSERT FAIL: a staff or not-yet-started notice is public'; end if;
    update public.site_notices set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = n3;
    if exists (select 1 from api.public_site_notices v where v.id = n3) then raise exception 'ASSERT FAIL: an ended notice is public'; end if;
    j := public.admin_publish_site_notice(v_actor, n1, false, 3, 'fake test');
    if exists (select 1 from api.public_site_notices v where v.id = n1) then raise exception 'ASSERT FAIL: an unpublished notice stayed public'; end if;

    -- ---------------------------------------------------------------- summary: counts only
    perform pg_temp.expect_code(format($q$select public.admin_notify_summary(%L)$q$, v_ed), 'FORBIDDEN', 'an editor reading the summary');
    j := public.admin_notify_summary(v_actor);
    if j::text ~ '@' or (j #>> '{subscribers,pending}')::integer <> 2 then raise exception 'ASSERT FAIL: the summary is wrong or holds an address: %', j; end if;

    -- ---------------------------------------------------------------- audit: field names and counts only; anon: nothing
    if exists (select 1 from public.audit_log where action in ('set_notify_settings', 'queue_announcement', 'create_site_notice', 'update_site_notice', 'publish_site_notice', 'unpublish_site_notice')
               and (diff::text ~* '@|fake notice|sample news|sample text' )) then
      raise exception 'ASSERT FAIL: a 0023 audit row holds text or an address';
    end if;
    if (select count(*) from public.audit_log where actor = v_actor and action in ('set_notify_settings', 'queue_announcement', 'create_site_notice', 'update_site_notice', 'publish_site_notice', 'unpublish_site_notice')) < 8 then
      raise exception 'ASSERT FAIL: the 0023 actions were not audited';
    end if;
    execute 'set local role anon';
    perform pg_temp.expect_fail($q$select email from public.notify_subscribers$q$, 'anon reading the subscribers');
    perform pg_temp.expect_fail($q$select title from public.site_notices$q$, 'anon reading the notices table');
    perform pg_temp.expect_fail($q$select subject from public.notification_outbox$q$, 'anon reading the outbox');
    perform pg_temp.expect_fail($q$select public.notify_unsubscribe('c0230000-0000-4000-8000-0000000000ff')$q$, 'anon running notify_unsubscribe');
    perform pg_temp.expect_fail(format($q$select public.notify_subscribe('{"email": "fake.c@example.test", "consentId": "email-updates-notice", "consentVersion": "v1", "tokenHash": "%s"}')$q$, h3), 'anon running notify_subscribe');
    perform pg_temp.expect_fail($q$select public.notify_outbox_enqueue('[]')$q$, 'anon running notify_outbox_enqueue');
    perform count(*) from api.public_site_notices;
    perform count(*) from api.public_notify_settings;
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0023_notifications assertions passed' as result;
