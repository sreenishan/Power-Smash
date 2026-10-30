-- 0008_assertions.sql - self-check for migration 0008_admin_rpcs.sql (profiles, profile_requests, player_dup_dismissed and the admin RPCs).
-- Run it after applying 0001..0008. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
-- rows. It raises an exception naming the first broken rule and ends with one row `ok`.

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
-- A. structure: privileges of the new tables and functions, and of EVERY table (service_role never truncates, deletes only where listed)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  t record;
  r text;
  p text;
  fn text;
  rpcs text[] := array[
    'public.admin_set_setting(text,text,text,text)', 'public.admin_dismiss_duplicate(text,uuid,uuid,text)',
    'public.admin_decide_tournament(text,uuid,text,text)', 'public.admin_resolve_profile_request(text,uuid,text,text)',
    'public.admin_set_match_lock(text,uuid,text,boolean,text)'];
  -- the only tables service_role may delete from (erasure, chain flattening, a reparse, counters housekeeping)
  delete_ok text[] := array['rate_limit_hits', 'daily_salts', 'tournament_private', 'tournament_aliases', 'match_participants', 'slug_redirects', 'placement_impression_seen'];
begin
  foreach r in array array['profiles', 'profile_requests', 'player_dup_dismissed'] loop
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = r) then
      raise exception 'ASSERT FAIL: row level security is OFF on public.%', r;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('anon', format('public.%I', r), p) or has_table_privilege('authenticated', format('public.%I', r), p) then
        raise exception 'ASSERT FAIL: anon or authenticated holds % on public.%', p, r;
      end if;
    end loop;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = r) then raise exception 'ASSERT FAIL: a policy exists on public.%', r; end if;
  end loop;
  -- nobody can write a role or a dismissed pair through the API: service_role holds select only (profile_requests: select + insert)
  foreach r in array array['profiles', 'player_dup_dismissed'] loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege('service_role', format('public.%I', r), p) then raise exception 'ASSERT FAIL: service_role holds % on public.% (writes go through the audited RPCs)', p, r; end if;
    end loop;
  end loop;
  foreach p in array array['UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('service_role', 'public.profile_requests', p) then raise exception 'ASSERT FAIL: service_role holds % on public.profile_requests', p; end if;
  end loop;

  -- every table in public: service_role can never truncate, REFERENCES or TRIGGER; delete only from the short list
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    foreach p in array array['TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', format('public.%I', t.relname), p) then raise exception 'ASSERT FAIL: service_role holds % on public.%', p, t.relname; end if;
    end loop;
    if has_table_privilege('service_role', format('public.%I', t.relname), 'DELETE') and t.relname <> all (delete_ok) then
      raise exception 'ASSERT FAIL: service_role can delete from public.% (tombstones and records are never hard-deleted)', t.relname;
    end if;
  end loop;
  foreach p in array array['UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('service_role', 'public.audit_log', p) then raise exception 'ASSERT FAIL: service_role holds % on public.audit_log', p; end if;
  end loop;

  -- the functions: service_role only, SECURITY DEFINER, fixed search_path
  foreach fn in array rpcs || array['app.require_owner(text)'] loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE %', fn;
    end if;
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
  end loop;
  foreach fn in array rpcs loop
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot EXECUTE %', fn; end if;
  end loop;
  -- every admin RPC in public (0006 and 0008) is closed to the API roles
  for t in select pr.oid, pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace where n.nspname = 'public' and pr.proname like 'admin\_%' loop
    if has_function_privilege('anon', t.oid, 'EXECUTE') or has_function_privilege('authenticated', t.oid, 'EXECUTE') then
      raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE public.%', t.proname;
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back; fictional data)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  v_role text;
  t_tn uuid := gen_random_uuid();
  t_ka uuid := gen_random_uuid();
  t_int uuid := gen_random_uuid();
  pa uuid := gen_random_uuid();   -- adult A
  pb uuid := gen_random_uuid();   -- adult B
  pc uuid := gen_random_uuid();   -- unknown C
  pd uuid := gen_random_uuid();   -- suspected minor D
  pe uuid := gen_random_uuid();   -- confirmed minor E (its name is suppressed below)
  m1 uuid := gen_random_uuid();
  req uuid := gen_random_uuid();
  j jsonb;
  n integer;
  n_before integer;
begin
  begin
    -- a real owner may already exist (the owner's own login, OT-51), and only one owner is allowed (profiles_single_owner): set it aside
    -- for this test only. The whole block ends in ps_rollback, so the real profile is never changed.
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    perform pg_temp.expect_fail($q$insert into public.profiles (id, role) values (gen_random_uuid(), 'owner')$q$, 'a second owner');
    perform pg_temp.expect_fail($q$insert into public.profiles (id, role) values (gen_random_uuid(), 'admin')$q$, 'an unknown role');

    insert into public.tournaments (id, slug, name, series_key, edition_year, region, visibility, status) values
      (t_tn, 'fake-open-2026', 'Fake Open', 'fake open', 2026, 'tamil_nadu', 'hidden', 'pending'),
      (t_ka, 'fake-ka-cup-2026', 'Fake KA Cup', 'fake ka cup', 2026, 'other_india', 'hidden', 'pending'),
      (t_int, 'fake-world-2026', 'Fake World', 'fake world', 2026, 'international', 'hidden', 'pending');
    insert into public.players (id, display_name, name_normalized) values
      (pa, 'Fake Alpha', 'fake alpha'), (pb, 'Fake Beta', 'fake beta'), (pc, 'Fake Gamma', 'fake gamma'), (pd, 'Fake Delta', 'fake delta'), (pe, 'Fake Epsilon', 'fake epsilon');
    update public.players set age_status = 'minor_suspected' where id = pd;
    update public.players set age_status = 'minor_confirmed' where id = pe;
    insert into public.videos (youtube_id, title_raw, visibility, type) values ('fake-a1', 'FAKE ALPHA vs FAKE BETA | Fake Open 2026', 'public', 'match');
    insert into public.matches (id, video_id, tournament_id, category, publish_state) values (m1, 'fake-a1', t_tn, 'MS', 'published');

    -- ------------------------------------------------------------------ the owner check
    execute 'set local role service_role';
    perform pg_temp.expect_fail($q$select public.admin_set_setting('11111111-1111-4111-8111-999999999999', 'minor_match_mode', 'noindex_minimal', 'r')$q$, 'an actor with no profile');
    perform pg_temp.expect_fail($q$select public.admin_set_setting('22222222-2222-4222-8222-222222222222', 'minor_match_mode', 'noindex_minimal', 'r')$q$, 'an editor actor');
    perform pg_temp.expect_fail($q$select public.admin_set_setting('fake-admin', 'minor_match_mode', 'noindex_minimal', 'r')$q$, 'a non-uuid actor');
    perform pg_temp.expect_fail($q$select public.admin_set_setting(null, 'minor_match_mode', 'noindex_minimal', 'r')$q$, 'a null actor');
    execute 'reset role';
    if exists (select 1 from public.audit_log where action = 'set_setting') then raise exception 'ASSERT FAIL: a refused call wrote an audit row'; end if;

    -- ------------------------------------------------------------------ admin_set_setting
    execute 'set local role service_role';
    j := public.admin_set_setting(v_actor, 'minor_match_mode', 'noindex_minimal', 'owner decision, test');
    perform pg_temp.expect_fail(format($q$select public.admin_set_setting(%L, 'non_tn_tournament_pages', 'on', 'r')$q$, v_actor), 'a key outside the two protected modes');
    perform pg_temp.expect_fail(format($q$select public.admin_set_setting(%L, 'minor_match_mode', 'public', 'r')$q$, v_actor), 'a value outside the two modes');
    perform pg_temp.expect_fail(format($q$select public.admin_set_setting(%L, 'minor_match_mode', 'hidden', '')$q$, v_actor), 'no reason');
    execute 'reset role';
    if j ->> 'old' <> 'hidden' or j ->> 'value' <> 'noindex_minimal' then raise exception 'ASSERT FAIL: admin_set_setting result is wrong: %', j; end if;
    if app.setting('minor_match_mode') <> 'noindex_minimal' then raise exception 'ASSERT FAIL: the setting was not changed'; end if;
    if not exists (select 1 from public.audit_log where action = 'set_setting' and entity_id = 'minor_match_mode' and diff ->> 'old' = 'hidden' and diff ->> 'new' = 'noindex_minimal' and actor = v_actor) then
      raise exception 'ASSERT FAIL: set_setting did not audit the old and new value';
    end if;
    if not (select dirty from public.site_state) then raise exception 'ASSERT FAIL: a setting change did not mark the site dirty'; end if;

    -- ------------------------------------------------------------------ admin_dismiss_duplicate
    execute 'set local role service_role';
    perform public.admin_dismiss_duplicate(v_actor, greatest(pa, pb), least(pa, pb), 'different people, test');
    perform public.admin_dismiss_duplicate(v_actor, pa, pb, 'again, idempotent');
    perform pg_temp.expect_fail(format($q$select public.admin_dismiss_duplicate(%L, %L, %L, 'r')$q$, v_actor, pa, pa), 'the same player twice');
    perform pg_temp.expect_fail(format($q$select public.admin_dismiss_duplicate(%L, %L, gen_random_uuid(), 'r')$q$, v_actor, pa), 'an unknown player');
    execute 'reset role';
    select count(*) into n from public.player_dup_dismissed;
    if n <> 1 then raise exception 'ASSERT FAIL: expected one dismissed pair (stored once, idempotent), got %', n; end if;
    if not exists (select 1 from public.player_dup_dismissed where player_a = least(pa, pb) and player_b = greatest(pa, pb)) then raise exception 'ASSERT FAIL: the pair is not stored smaller id first'; end if;
    perform pg_temp.expect_fail(format($q$insert into public.player_dup_dismissed (player_a, player_b, dismissed_by) values (%L, %L, 'x')$q$, greatest(pa, pb), least(pa, pb)), 'a pair in the wrong order');

    -- ------------------------------------------------------------------ admin_decide_tournament
    execute 'set local role service_role';
    perform public.admin_decide_tournament(v_actor, t_tn, 'promote', 'real event, test');
    perform public.admin_decide_tournament(v_actor, t_ka, 'promote', 'real event outside TN, test');
    perform public.admin_decide_tournament(v_actor, t_int, 'promote', 'international, test');
    perform pg_temp.expect_fail(format($q$select public.admin_decide_tournament(%L, %L, 'delete', 'r')$q$, v_actor, t_tn), 'an unknown decision');
    perform pg_temp.expect_fail(format($q$select public.admin_decide_tournament(%L, gen_random_uuid(), 'hide', 'r')$q$, v_actor), 'an unknown tournament');
    execute 'reset role';
    if (select visibility || '/' || status || '/' || is_promoted::text from public.tournaments where id = t_tn) <> 'public/published/true' then raise exception 'ASSERT FAIL: promoting a Tamil Nadu event did not publish it'; end if;
    if (select visibility || '/' || status from public.tournaments where id = t_ka) <> 'listed_no_player_pages/published' then raise exception 'ASSERT FAIL: a non-Tamil-Nadu promotion must stay listed without pages (D-018)'; end if;
    if (select visibility from public.tournaments where id = t_int) <> 'hidden' then raise exception 'ASSERT FAIL: an international event became visible (D-018)'; end if;
    if exists (select 1 from api.public_tournaments where slug in ('fake-ka-cup-2026', 'fake-world-2026')) then raise exception 'ASSERT FAIL: a non-Tamil-Nadu or international tournament has a public page'; end if;
    execute 'set local role service_role';
    perform public.admin_decide_tournament(v_actor, t_tn, 'hide', 'organizer asked, test');
    perform public.admin_decide_tournament(v_actor, t_ka, 'reject', 'not a real event, test');
    execute 'reset role';
    if (select visibility from public.tournaments where id = t_tn) <> 'hidden' then raise exception 'ASSERT FAIL: hide left the tournament visible'; end if;
    if (select status || '/' || visibility from public.tournaments where id = t_ka) <> 'rejected/hidden' then raise exception 'ASSERT FAIL: reject did not reject and hide'; end if;
    -- a suppressed tournament cannot be promoted back
    insert into public.suppression (kind, value, reason, created_by) values ('tournament_id', t_tn::text, 'takedown, test', 'fake-admin');
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_decide_tournament(%L, %L, 'promote', 'r')$q$, v_actor, t_tn), 'promoting a suppressed tournament');
    execute 'reset role';
    if (select visibility from public.tournaments where id = t_tn) <> 'hidden' then raise exception 'ASSERT FAIL: a suppressed tournament became visible'; end if;
    if (select count(*) from public.audit_log where action = 'decide_tournament') <> 5 then raise exception 'ASSERT FAIL: expected 5 decide_tournament audit rows'; end if;

    -- ------------------------------------------------------------------ profile requests
    insert into public.profile_requests (id, player_id, kind, summary) values (req, pa, 'correction', 'A. says the district is wrong');
    perform pg_temp.expect_fail($q$insert into public.profile_requests (kind, summary) values ('claim', 'call me on 9100000000')$q$, 'a summary with a phone number');
    perform pg_temp.expect_fail($q$insert into public.profile_requests (kind, summary) values ('claim', 'mail fake@example.invalid')$q$, 'a summary with an email');
    perform pg_temp.expect_fail($q$insert into public.profile_requests (kind, summary) values ('sale', 'x')$q$, 'an unknown kind');
    perform pg_temp.expect_fail(format($q$update public.profile_requests set status = 'resolved' where id = %L$q$, req), 'resolving without decided_by and decided_at');
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$update public.profile_requests set status = 'resolved' where id = %L$q$, req), 'service_role updating a request directly');
    perform public.admin_resolve_profile_request(v_actor, req, 'resolve', 'fixed, test');
    perform pg_temp.expect_fail(format($q$select public.admin_resolve_profile_request(%L, %L, 'reject', 'again')$q$, v_actor, req), 'deciding twice');
    perform pg_temp.expect_fail(format($q$select public.admin_resolve_profile_request(%L, %L, 'maybe', 'r')$q$, v_actor, req), 'an unknown decision');
    execute 'reset role';
    if (select status from public.profile_requests where id = req) <> 'resolved' then raise exception 'ASSERT FAIL: the request was not resolved'; end if;
    if not exists (select 1 from public.audit_log where action = 'resolve_profile_request' and entity_id = req::text and diff::text not like '%@%') then raise exception 'ASSERT FAIL: no audit row for the request'; end if;

    -- ------------------------------------------------------------------ admin_set_match_lock (the guard trigger undoes a direct write)
    update public.matches set manual_override = '{"category": true}' where id = m1;
    if (select manual_override from public.matches where id = m1) <> '{}'::jsonb then raise exception 'ASSERT FAIL: a direct write changed the locks (the guard should have restored them)'; end if;
    execute 'set local role service_role';
    perform public.admin_set_match_lock(v_actor, m1, 'category', true, null);
    perform public.admin_set_match_lock(v_actor, m1, 'participants', true, 'checked by hand');
    perform pg_temp.expect_fail(format($q$select public.admin_set_match_lock(%L, %L, 'publish_state', true, null)$q$, v_actor, m1), 'locking a field outside the list');
    execute 'reset role';
    if (select manual_override from public.matches where id = m1) <> '{"category": true, "participants": true}'::jsonb then raise exception 'ASSERT FAIL: locks not set'; end if;
    update public.matches set category = 'WS' where id = m1;
    if (select category from public.matches where id = m1) <> 'MS' then raise exception 'ASSERT FAIL: a sync write changed a locked category'; end if;
    execute 'set local role service_role';
    perform public.admin_set_match_lock(v_actor, m1, 'category', false, null);
    execute 'reset role';
    if (select manual_override from public.matches where id = m1) <> '{"participants": true}'::jsonb then raise exception 'ASSERT FAIL: unlock did not clear only that field'; end if;

    -- ------------------------------------------------------------------ 0006 RPCs, protected-status rules (D-012) and suppression (D-014)
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pa, pb], 'adult_confirmed', 'fake admin review', 'test');
    perform pg_temp.expect_fail(format($q$select public.admin_set_age_status(%L, array[%L::uuid], 'adult_confirmed', '', 'test')$q$, v_actor, pc), 'adult_confirmed without evidence');
    perform pg_temp.expect_fail(format($q$select public.admin_merge_players(%L, %L, %L, 'test', false)$q$, v_actor, pe, pa), 'merging a confirmed minor into an adult without the override');
    perform pg_temp.expect_fail(format($q$select public.admin_merge_players(%L, %L, %L, 'test', false)$q$, v_actor, pa, pd), 'merging an adult into a suspected minor without the override');
    -- unknown into adult needs no override; the survivor gets the more restrictive status, so it is no longer public
    j := public.admin_merge_players(v_actor, pc, pa, 'same person, test', false);
    execute 'reset role';
    if (select age_status from public.players where id = pa) <> 'unknown' then raise exception 'ASSERT FAIL: unknown into adult did not give the more restrictive status'; end if;
    if exists (select 1 from api.public_players where id = pa) then raise exception 'ASSERT FAIL: a survivor of a restrictive merge is public'; end if;
    -- the override merge is audited
    execute 'set local role service_role';
    perform public.admin_merge_players(v_actor, pd, pb, 'parent confirmed, test', true);
    execute 'reset role';
    if not exists (select 1 from public.audit_log where action = 'merge_players' and (diff ->> 'override_age')::boolean) then raise exception 'ASSERT FAIL: the age override was not audited'; end if;
    if (select age_status from public.players where id = pb) <> 'minor_suspected' then raise exception 'ASSERT FAIL: the override merge did not keep the stricter status'; end if;
    -- suppression: a suppressed name cannot be confirmed as an adult or merged, and a new row with that name cannot be created as an adult
    insert into public.suppression (kind, value, reason, created_by) values ('name_normalized', 'fake epsilon', 'takedown, test', 'fake-admin');
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_set_age_status(%L, array[%L::uuid], 'adult_confirmed', 'evidence', 'test')$q$, v_actor, pe), 'confirming a suppressed player as an adult');
    perform pg_temp.expect_fail(format($q$select public.admin_merge_players(%L, %L, %L, 'test', true)$q$, v_actor, pe, pb), 'merging a suppressed player');
    execute 'reset role';
    if (select visibility from public.players where id = pe) <> 'hidden' then raise exception 'ASSERT FAIL: a suppressed player is visible'; end if;
    perform pg_temp.expect_fail($q$insert into public.players (display_name, name_normalized, age_status, age_confirmed_by, age_confirmed_at) values ('Fake Epsilon', 'fake epsilon', 'adult_confirmed', 'x', now())$q$, 'creating a suppressed name as an adult');

    -- ------------------------------------------------------------------ audit_log is tamper-proof, for the owner role and for service_role
    n_before := (select count(*) from public.audit_log);
    if n_before < 15 then raise exception 'ASSERT FAIL: expected audit rows from the calls above, got %', n_before; end if;
    perform pg_temp.expect_fail($q$update public.audit_log set reason = 'edited'$q$, 'update of the audit log');
    perform pg_temp.expect_fail($q$delete from public.audit_log$q$, 'delete from the audit log');
    perform pg_temp.expect_fail($q$truncate public.audit_log$q$, 'truncate of the audit log');
    execute 'set local role service_role';
    perform pg_temp.expect_fail($q$update public.audit_log set reason = 'edited'$q$, 'service_role update of the audit log');
    perform pg_temp.expect_fail($q$delete from public.audit_log$q$, 'service_role delete from the audit log');
    perform pg_temp.expect_fail($q$truncate public.audit_log$q$, 'service_role truncate of the audit log');
    perform pg_temp.expect_fail($q$truncate public.players$q$, 'service_role truncate of players');
    perform pg_temp.expect_fail($q$delete from public.players$q$, 'service_role delete from players');
    perform pg_temp.expect_fail($q$delete from public.suppression$q$, 'service_role delete from suppression');
    perform pg_temp.expect_fail($q$update public.profiles set role = 'owner'$q$, 'service_role writing a role');
    execute 'reset role';
    if (select count(*) from public.audit_log) <> n_before then raise exception 'ASSERT FAIL: the audit log changed'; end if;

    -- ------------------------------------------------------------------ anon and authenticated: nothing
    foreach v_role in array array['anon', 'authenticated'] loop
      execute format('set local role %I', v_role);
      perform pg_temp.expect_fail($q$select count(*) from public.profiles$q$, 'reading profiles');
      perform pg_temp.expect_fail($q$select count(*) from public.profile_requests$q$, 'reading profile_requests');
      perform pg_temp.expect_fail($q$select count(*) from public.player_dup_dismissed$q$, 'reading player_dup_dismissed');
      perform pg_temp.expect_fail($q$select count(*) from public.audit_log$q$, 'reading the audit log');
      perform pg_temp.expect_fail($q$select public.admin_set_setting('11111111-1111-4111-8111-111111111111', 'minor_match_mode', 'noindex_minimal', 'r')$q$, 'calling an admin RPC');
      perform pg_temp.expect_fail($q$select public.admin_decide_tournament('11111111-1111-4111-8111-111111111111', gen_random_uuid(), 'hide', 'r')$q$, 'calling admin_decide_tournament');
      perform pg_temp.expect_fail($q$select app.require_owner('11111111-1111-4111-8111-111111111111')$q$, 'calling app.require_owner');
      execute 'reset role';
    end loop;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0008_admin_rpcs assertions passed' as result;
