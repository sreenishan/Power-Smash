-- 0013_assertions.sql - self-check for migration 0013_live_pin.sql (public.live_settings, public.live_past_streams, the two api views,
-- admin_save_live). Run it after applying 0001..0013. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back,
-- with FICTIONAL video ids and titles. It raises an exception naming the first broken rule and ends with one row `ok`.

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
-- A. structure: RLS on, no policies, no rights for anon/authenticated, service_role reads only, explicit view columns, a locked-down RPC
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['live_settings', 'live_past_streams'] loop
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t) then
      raise exception 'ASSERT FAIL: row level security is OFF on public.%', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then raise exception 'ASSERT FAIL: a policy exists on public.%', t; end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception 'ASSERT FAIL: anon or authenticated holds % on public.%', p, t;
      end if;
    end loop;
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read public.%', t; end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception 'ASSERT FAIL: service_role holds % on public.% (writes go through the RPC)', p, t; end if;
    end loop;
  end loop;
  -- seeded empty: one settings row, nothing pinned, no past streams
  if (select count(*) from public.live_settings) <> 1 or (select pinned_video_id from public.live_settings where id = 1) is not null then
    raise exception 'ASSERT FAIL: public.live_settings must hold exactly one row with nothing pinned';
  end if;
  if exists (select 1 from public.live_past_streams) then raise exception 'ASSERT FAIL: public.live_past_streams must start empty'; end if;
  -- the public views: readable by anon, exactly their explicit columns, in order
  if not has_table_privilege('anon', 'api.public_live_settings', 'SELECT') then raise exception 'ASSERT FAIL: anon cannot read api.public_live_settings'; end if;
  if not has_table_privilege('anon', 'api.public_live_past_streams', 'SELECT') then raise exception 'ASSERT FAIL: anon cannot read api.public_live_past_streams'; end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = 'public_live_settings')
     is distinct from array['pinned_video_id'] then
    raise exception 'ASSERT FAIL: api.public_live_settings must have exactly pinned_video_id';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = 'public_live_past_streams')
     is distinct from array['video_id', 'title', 'streamed_on', 'position'] then
    raise exception 'ASSERT FAIL: api.public_live_past_streams must have exactly video_id, title, streamed_on, position';
  end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'api.public_live_settings', p) or has_table_privilege('anon', 'api.public_live_past_streams', p) then
      raise exception 'ASSERT FAIL: anon holds % on a live view', p;
    end if;
  end loop;
  if not (select prosecdef from pg_proc where oid = 'public.admin_save_live(text,text,jsonb,text)'::regprocedure) then
    raise exception 'ASSERT FAIL: admin_save_live is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.admin_save_live(text,text,jsonb,text)'::regprocedure and proconfig @> array['search_path=""']) then
    raise exception 'ASSERT FAIL: admin_save_live does not pin search_path';
  end if;
  if has_function_privilege('anon', 'public.admin_save_live(text,text,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_save_live(text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: anon or authenticated can run admin_save_live';
  end if;
  if not has_function_privilege('service_role', 'public.admin_save_live(text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: service_role cannot run admin_save_live';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back): owner only, every value checked, nothing stored on a refusal, audit without titles, dirty flag, the views
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  one_past jsonb := '[{"videoId":"FAKEvid0001","title":"Fake Open 2026 Final - a fictional stream","date":"2026-10-01"}]';
  j jsonb;
  n integer;
begin
  begin
    -- a real owner may already exist (the owner's own login, OT-51), and only one owner is allowed (profiles_single_owner): set it aside
    -- for this test only. The whole block ends in ps_rollback, so the real profile is never changed.
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    update public.site_state set dirty = false, dirty_since = null where id = 1;

    -- the owner check
    execute 'set local role service_role';
    perform pg_temp.expect_fail($q$select public.admin_save_live('fake-admin', 'FAKEvid0002', '[]'::jsonb, 'r')$q$, 'a non-uuid actor');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, 'FAKEvid0002', '[]'::jsonb, 'r')$q$, v_editor), 'an editor actor');
    perform pg_temp.expect_fail($q$select public.admin_save_live(null, 'FAKEvid0002', '[]'::jsonb, 'r')$q$, 'a null actor');

    -- value checks: never coerced
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, 'FAKEvid0002', '[]'::jsonb, '')$q$, v_actor), 'no reason');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, 'https://youtu.be/FAKEvid0002', '[]'::jsonb, 'r')$q$, v_actor), 'a link instead of an id');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, 'FAKEvid000', '[]'::jsonb, 'r')$q$, v_actor), 'a 10-character id');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, 'FAKEvid0"02', '[]'::jsonb, 'r')$q$, v_actor), 'a quote in the id');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, '{}'::jsonb, 'r')$q$, v_actor), 'past streams that are not a list');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor,
      (select jsonb_agg(jsonb_build_object('videoId', 'FAKEvid' || lpad(i::text, 4, '0'), 'title', 'Fake ' || i, 'date', null)) from generate_series(1, 21) i)), 'more than 20 past streams');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, one_past || one_past), 'the same stream twice');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, '[{"videoId":"FAKEvid0001","title":"Fake","date":null,"views":5}]'), 'an unknown field');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, '[{"videoId":"FAKEvid0001","title":"Fake"}]'), 'a missing field');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, '[{"videoId":"FAKEvid0001","title":"   ","date":null}]'), 'an empty title');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, jsonb_build_array(jsonb_build_object('videoId', 'FAKEvid0001', 'title', repeat('t', 101), 'date', null))), 'a 101-character title');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, jsonb_build_array(jsonb_build_object('videoId', 'FAKEvid0001', 'title', 'Fake' || chr(10) || 'line', 'date', null))), 'a line break in a title');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, '[{"videoId":"FAKEvid0001","title":"Fake","date":"2026-02-30"}]'), 'an impossible date');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, '[{"videoId":"FAKEvid0001","title":"Fake","date":"1 Oct 2026"}]'), 'a date in another format');
    perform pg_temp.expect_fail(format($q$select public.admin_save_live(%L, null, %L::jsonb, 'r')$q$, v_actor, '[{"videoId":"FAKEvid0001","title":"Fake","date":20261001}]'), 'a date given as a number');
    execute 'reset role';
    if exists (select 1 from public.audit_log where action = 'save_live') then raise exception 'ASSERT FAIL: a refused call wrote an audit row'; end if;
    if (select pinned_video_id from public.live_settings where id = 1) is not null or exists (select 1 from public.live_past_streams) then
      raise exception 'ASSERT FAIL: a refused save stored something';
    end if;
    if (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: a refused save marked the site dirty'; end if;

    -- the owner pins a fictional stream and lists one past stream (the title is trimmed)
    execute 'set local role service_role';
    j := public.admin_save_live(v_actor, 'FAKEvid0002', '[{"videoId":"FAKEvid0001","title":"  Fake Open 2026 Final - a fictional stream  ","date":"2026-10-01"}]', 'live pin');
    execute 'reset role';
    if (j -> 'fields') is distinct from '["pinned", "past"]'::jsonb or (j ->> 'pinned') is distinct from 'FAKEvid0002' or (j ->> 'pastCount')::int is distinct from 1 then raise exception 'ASSERT FAIL: wrong save result: %', j; end if;
    if (select pinned_video_id from public.live_settings where id = 1) is distinct from 'FAKEvid0002' then raise exception 'ASSERT FAIL: the pin was not stored'; end if;
    if (select title from public.live_past_streams where video_id = 'FAKEvid0001') is distinct from 'Fake Open 2026 Final - a fictional stream' then
      raise exception 'ASSERT FAIL: the past-stream title was not stored trimmed';
    end if;
    if not exists (select 1 from public.audit_log where action = 'save_live' and actor = v_actor and diff ->> 'new_pinned' = 'FAKEvid0002'
                   and (diff ->> 'old_pinned') is null and diff -> 'fields' = '["pinned", "past"]'::jsonb and (diff ->> 'new_past_count')::int = 1) then
      raise exception 'ASSERT FAIL: the live change was not audited with the ids, the count and the changed field names';
    end if;
    if exists (select 1 from public.audit_log where action = 'save_live' and (diff::text like '%fictional stream%' or coalesce(reason, '') like '%fictional stream%')) then
      raise exception 'ASSERT FAIL: the audit row holds a stream title';
    end if;
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: a live change did not mark the site dirty'; end if;

    -- the same values again: nothing changes and nothing is audited
    execute 'set local role service_role';
    j := public.admin_save_live(v_actor, 'FAKEvid0002', one_past, 'live pin');
    execute 'reset role';
    if (j -> 'fields') is distinct from '[]'::jsonb then raise exception 'ASSERT FAIL: an unchanged save reported changes: %', j; end if;
    select count(*) into n from public.audit_log where action = 'save_live';
    if n <> 1 then raise exception 'ASSERT FAIL: an unchanged save was audited (% rows)', n; end if;

    -- the public views show the pin and the list, in order; the tables stay closed to anon
    execute 'set local role service_role';
    j := public.admin_save_live(v_actor, 'FAKEvid0002',
      '[{"videoId":"FAKEvid0003","title":"Fake Cup 2026 Semi","date":null},{"videoId":"FAKEvid0001","title":"Fake Open 2026 Final - a fictional stream","date":"2026-10-01"}]', 'reorder');
    execute 'reset role';
    if (j -> 'fields') is distinct from '["past"]'::jsonb then raise exception 'ASSERT FAIL: a list-only change reported %', j; end if;
    execute 'set local role anon';
    if (select pinned_video_id from api.public_live_settings) is distinct from 'FAKEvid0002' then raise exception 'ASSERT FAIL: api.public_live_settings shows the wrong pin'; end if;
    if (select array_agg(video_id order by position) from api.public_live_past_streams) is distinct from array['FAKEvid0003', 'FAKEvid0001'] then
      raise exception 'ASSERT FAIL: api.public_live_past_streams is not in the owner''s order';
    end if;
    perform pg_temp.expect_fail($q$select * from public.live_settings$q$, 'anon reading public.live_settings');
    perform pg_temp.expect_fail($q$select * from public.live_past_streams$q$, 'anon reading public.live_past_streams');
    perform pg_temp.expect_fail($q$select public.admin_save_live('11111111-1111-4111-8111-111111111111', null, '[]'::jsonb, 'r')$q$, 'anon running admin_save_live');
    execute 'reset role';

    -- clearing: no pin, no list
    execute 'set local role service_role';
    j := public.admin_save_live(v_actor, null, '[]'::jsonb, 'stream over');
    execute 'reset role';
    if (select pinned_video_id from public.live_settings where id = 1) is not null or exists (select 1 from public.live_past_streams) then
      raise exception 'ASSERT FAIL: clearing left a pin or a past stream';
    end if;
    execute 'set local role anon';
    if (select count(*) from api.public_live_settings) <> 1 or (select pinned_video_id from api.public_live_settings) is not null then
      raise exception 'ASSERT FAIL: api.public_live_settings must show one empty row after clearing';
    end if;
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0013_live_pin assertions passed' as result;
