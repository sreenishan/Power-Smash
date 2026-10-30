-- 0021_assertions.sql - self-check for migration 0021_live_scores.sql (near-live scores, D-113). Run it after applying 0001..0021.
-- It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with a FICTIONAL tournament and players. It
-- raises an exception naming the first broken rule and ends with one row `ok`.

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

-- one tap with a fresh key at the current sequence (the way the console sends it)
create function pg_temp.tap(p_actor text, p_match uuid, p_kind text, p_side text) returns jsonb language plpgsql as $f$
declare
  v_seq integer;
begin
  select coalesce(max(e.seq), 0) into v_seq from public.match_score_events e where e.match_id = p_match;
  return public.admin_live_score(p_actor, p_match, jsonb_build_object('kind', p_kind, 'side', p_side, 'key', 'k' || md5(random()::text), 'expectedSeq', v_seq));
end
$f$;

-- ------------------------------------------------------------------------------------------------------------------
-- A. structure
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  fn text;
  c text;
  p text;
  rpcs text[] := array['public.admin_live_score(text,uuid,jsonb)', 'public.admin_live_match_status(text,uuid,jsonb,integer,text)',
    'public.admin_set_live_scores(text,jsonb,text)'];
  s record;
begin
  foreach fn in array rpcs loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
    -- the access check is the first statement: the per-tournament check may open the two scoring RPCs; the switch stays owner only
    if (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure) !~ (case when fn = 'public.admin_set_live_scores(text,jsonb,text)'
         then '\mbegin\s+perform app\.require_owner\(p_actor\);'
         else '\mbegin\s+perform app\.require_(owner\(p_actor\);|competition_access\(p_actor, )' end) then
      raise exception 'ASSERT FAIL: % does not call the access check first', fn;
    end if;
  end loop;
  foreach fn in array array['app.competition_live_replay(uuid,jsonb)', 'app.competition_live_store(uuid,jsonb)'] loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: an API role can run %', fn;
    end if;
    if not coalesce((select 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure), false) then
      raise exception 'ASSERT FAIL: % has no fixed search_path', fn;
    end if;
  end loop;

  -- the live state table: RLS on, no policy, service_role reads only, the API roles nothing
  if not coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'public' and cl.relname = 'match_live_state' and cl.relkind = 'r'), false) then
    raise exception 'ASSERT FAIL: public.match_live_state is missing or row level security is OFF';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'match_live_state') then raise exception 'ASSERT FAIL: a policy exists on match_live_state'; end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.match_live_state', p) or has_table_privilege('authenticated', 'public.match_live_state', p) then
      raise exception 'ASSERT FAIL: anon or authenticated holds % on match_live_state', p;
    end if;
    if p <> 'SELECT' and has_table_privilege('service_role', 'public.match_live_state', p) then
      raise exception 'ASSERT FAIL: service_role holds % on match_live_state (writes go through the RPCs)', p;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.match_live_state', 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read match_live_state'; end if;

  -- the switches: off, and a 5-minute window
  select cs.live_scores_public, cs.live_window_seconds into s from public.competition_settings cs where cs.id = 1;
  if s.live_scores_public or s.live_window_seconds <> 300 then raise exception 'ASSERT FAIL: the live scores switch is not off with a 300 second window by default'; end if;

  -- the api view: exists, barrier, read-only for the API roles, exactly the declared columns in order
  if not coalesce((select 'security_barrier=true' = any (cl.reloptions) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = 'public_competition_live' and cl.relkind = 'v'), false) then
    raise exception 'ASSERT FAIL: api.public_competition_live is missing or not a security_barrier view';
  end if;
  if (select jsonb_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'api' and table_name = 'public_competition_live')
     is distinct from '["match_id", "event_id", "category", "age_group", "is_junior", "round_code", "match_number", "group_label", "court_label", "status", "is_live", "live_window_seconds", "game_number", "points_a", "points_b", "games_a", "games_b", "finished_games", "server_side", "last_update", "side_a_player1_name", "side_a_player2_name", "side_a_protected", "side_b_player1_name", "side_b_player2_name", "side_b_protected"]'::jsonb then
    raise exception 'ASSERT FAIL: api.public_competition_live does not have the declared columns (mirror LIVE_VIEW_COLUMNS in src/lib/live-scores/public.ts)';
  end if;
  foreach c in array array['anon', 'authenticated'] loop
    if not has_table_privilege(c, 'api.public_competition_live', 'SELECT') then raise exception 'ASSERT FAIL: % cannot read api.public_competition_live', c; end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(c, 'api.public_competition_live', p) then raise exception 'ASSERT FAIL: % holds % on api.public_competition_live', c, p; end if;
    end loop;
    if has_table_privilege(c, 'app.competition_live_settings', 'SELECT') then raise exception 'ASSERT FAIL: % can read app.competition_live_settings', c; end if;
  end loop;
  -- no player slug, id, entry id or private column in the view
  if exists (select 1 from information_schema.columns where table_schema = 'api' and table_name = 'public_competition_live'
             and (column_name like '%slug%' or column_name like '%entry%' or column_name ~ '(phone|email|recorded_by|idempotency|actor)')) then
    raise exception 'ASSERT FAIL: api.public_competition_live exposes a slug, an entry id or a private column';
  end if;
  -- the view reads neither the rally log nor the settings table directly, and names only through the faces view
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class vw on vw.oid = r.ev_class join pg_namespace n on n.oid = vw.relnamespace
             where n.nspname = 'api' and vw.relname = 'public_competition_live' and d.refobjid in ('public.match_score_events'::regclass, 'public.competition_settings'::regclass, 'public.players'::regclass)) then
    raise exception 'ASSERT FAIL: api.public_competition_live reads the rally log, the settings table or the players table directly';
  end if;
  if position('competition_entry_faces' in pg_get_viewdef('api.public_competition_live'::regclass)) = 0 then
    raise exception 'ASSERT FAIL: api.public_competition_live does not name players through app.competition_entry_faces';
  end if;

  -- the pure replay agrees with the engine on an empty log
  if app.competition_live_replay('00000000-0000-4000-8000-000000000000', app.competition_default_ruleset())
     is distinct from '{"lastSeq": 0, "firstServer": null, "rallySides": "", "rallies": 0, "gameNumber": 1, "pointsA": 0, "pointsB": 0, "gamesA": 0, "gamesB": 0, "games": [], "server": null, "matchOver": false, "winnerSide": null, "lastPointAt": null}'::jsonb then
    raise exception 'ASSERT FAIL: the replay of an empty log is not 0-0 in game 1';
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
  t1 uuid := 'c0210000-0000-4000-8000-000000000001';
  t9 uuid := 'c0210000-0000-4000-8000-000000000009';  -- a second tournament (a scorer of t9 may not score t1)
  v_sco text := 'c0210000-0000-4000-8000-0000000000e1';  -- scorer assigned to t1
  v_sco9 text := 'c0210000-0000-4000-8000-0000000000e9'; -- scorer assigned to t9
  v_org text := 'c0210000-0000-4000-8000-0000000000f1';  -- organizer assigned to t1 (may score, never switch)
  pa uuid := 'c0210000-0000-4000-8000-0000000000b1';  -- adult_confirmed, public: named
  pb uuid := 'c0210000-0000-4000-8000-0000000000b2';  -- adult_confirmed, public: named
  pc uuid := 'c0210000-0000-4000-8000-0000000000b3';  -- unknown age: protected
  pf uuid := 'c0210000-0000-4000-8000-0000000000b4';  -- adult_confirmed, public: named
  d jsonb := app.competition_default_ruleset();
  ev uuid;
  ev2 uuid;
  en_a uuid;
  en_b uuid;
  en_c uuid;
  en_f uuid;
  dr uuid;
  m1 uuid;
  m2 uuid;
  rev integer;
  j jsonb;
  st jsonb;
  k integer;
  n integer;
  r record;
begin
  begin
    -- a real owner may already exist (OT-51); set it aside for this rolled-back test only
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility) values
      (t1, 'fake-live-open-2026', 'Fake Live Open', 'fake live open', 2026, 'tamil_nadu', 'published', 'public'),
      (t9, 'fake-live-other-2026', 'Fake Live Other', 'fake live other', 2026, 'tamil_nadu', 'published', 'public');
    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (pa, 'Fake Live Alpha', 'fake live alpha', 'multi_token'), (pb, 'Fake Live Beta', 'fake live beta', 'multi_token'),
      (pc, 'Fake Live Gamma', 'fake live gamma', 'multi_token'), (pf, 'Fake Live Foxtrot', 'fake live foxtrot', 'multi_token');
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pa, pb, pf], 'adult_confirmed', 'fake admin review', 'test');
    perform public.admin_update_player(v_actor, pa, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_update_player(v_actor, pb, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_update_player(v_actor, pf, '{"is_provisional": false, "visibility": "public"}', 'test');
    execute 'reset role';
    if (select count(*) from app.competition_named_players where id in (pa, pb, pf)) <> 3 or exists (select 1 from app.competition_named_players where id = pc) then
      raise exception 'ASSERT FAIL: setup: the fictional players are not as planned';
    end if;

    execute 'set local role service_role';
    -- Men's singles: Alpha v Beta (both named). Women's singles: Gamma (protected) v Foxtrot (named).
    ev := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 2, 'status', 'open'), 'test') ->> 'id')::uuid;
    en_a := (public.admin_add_entry(v_actor, ev, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    en_b := (public.admin_add_entry(v_actor, ev, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    m1 := (public.admin_save_match(v_actor, null, jsonb_build_object('eventId', ev, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null, 'sideA', en_a, 'sideB', en_b, 'scheduledAt', null, 'courtId', null), null, 'test') ->> 'id')::uuid;
    ev2 := (public.admin_save_event(v_actor, null, jsonb_build_object('tournamentId', t1, 'category', 'WS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 2, 'status', 'open'), 'test') ->> 'id')::uuid;
    en_c := (public.admin_add_entry(v_actor, ev2, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    en_f := (public.admin_add_entry(v_actor, ev2, jsonb_build_object('players', jsonb_build_array(pf), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    m2 := (public.admin_save_match(v_actor, null, jsonb_build_object('eventId', ev2, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null, 'sideA', en_c, 'sideB', en_f, 'scheduledAt', null, 'courtId', null), null, 'test') ->> 'id')::uuid;

    -- ---------------------------------------------------------------- refusals before the start
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_editor, m1), 'FORBIDDEN', 'an editor scoring');
    -- scorers (0019, D-108): the per-tournament check is the first statement of both scoring RPCs
    perform public.admin_create_account(v_actor, v_sco::uuid, jsonb_build_object('role', 'scorer', 'displayName', 'Fake Live Scorer', 'tournamentIds', jsonb_build_array(t1)), 'test');
    perform public.admin_create_account(v_actor, v_sco9::uuid, jsonb_build_object('role', 'scorer', 'displayName', 'Fake Other Scorer', 'tournamentIds', jsonb_build_array(t9)), 'test');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_sco, m1), 'FORBIDDEN', 'an assigned scorer while organizer access is off');
    perform public.admin_set_organizer_access(v_actor, true, 'test');
    -- past the access check: refused only because the match has not started
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_sco, m1), 'INVALID', 'an assigned scorer before the start');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_sco9, m1), 'FORBIDDEN', 'a scorer of another tournament');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "pause", "endStatus": null, "retiringSide": null}', 1, 'r')$q$, v_sco9, m1), 'FORBIDDEN', 'a scorer of another tournament changing the status');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_sco, gen_random_uuid()), 'FORBIDDEN', 'a scorer and an unknown match');
    perform pg_temp.expect_code($q$select public.admin_set_live_scores('c0210000-0000-4000-8000-0000000000e1', '{"public": true, "windowSeconds": 300}', 'r')$q$, 'FORBIDDEN', 'a scorer switching live scores on');
    -- an organizer of the same tournament may score but never switch live scores (the settings RPC stays owner only)
    perform public.admin_create_account(v_actor, v_org::uuid, jsonb_build_object('role', 'organizer', 'displayName', 'Fake Live Organizer', 'tournamentIds', jsonb_build_array(t1)), 'test');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_org, m1), 'INVALID', 'an assigned organizer before the start');
    perform pg_temp.expect_code(format($q$select public.admin_set_live_scores(%L, '{"public": true, "windowSeconds": 300}', 'r')$q$, v_org), 'FORBIDDEN', 'an organizer switching live scores on');
    perform public.admin_set_organizer_access(v_actor, false, 'test');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_actor, m1), 'INVALID', 'a rally before the start');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_actor, gen_random_uuid()), 'NOT_FOUND', 'an unknown match');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "short", "expectedSeq": 0}')$q$, v_actor, m1), 'INVALID', 'a short key');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "C", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_actor, m1), 'INVALID', 'a side C');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "undo", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_actor, m1), 'INVALID', 'an undo with a side');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001"}')$q$, v_actor, m1), 'INVALID', 'a missing field');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0, "phone": "910000000000"}')$q$, v_actor, m1), 'INVALID', 'an unknown field');
    -- the draw is not published yet: no start
    rev := (select revision from public.competition_matches where id = m1);
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "start", "endStatus": null, "retiringSide": null}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'a start before the draw is published');
    dr := (public.admin_save_draw(v_actor, ev, jsonb_build_object('seed', 7, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null))), 'test') ->> 'id')::uuid;
    perform public.admin_publish_draw(v_actor, dr, 'test');
    dr := (public.admin_save_draw(v_actor, ev2, jsonb_build_object('seed', 8, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_c, 'group', null), jsonb_build_object('position', 2, 'entryId', en_f, 'group', null))), 'test') ->> 'id')::uuid;
    perform public.admin_publish_draw(v_actor, dr, 'test');

    -- the first server may be chosen before the start
    j := public.admin_live_score(v_actor, m1, '{"kind": "first_server", "side": "B", "key": "fake-key-fs01", "expectedSeq": 0}');
    if (j ->> 'seq')::integer <> 1 or j #>> '{state,firstServer}' <> 'B' or j #>> '{state,server}' <> 'B' then raise exception 'ASSERT FAIL: the first server was not recorded: %', j; end if;

    -- ---------------------------------------------------------------- start (revision check), pause/resume/end refusals
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "start", "endStatus": null, "retiringSide": null}', %s, 'r')$q$, v_actor, m1, rev + 5), 'STALE', 'a start with an old revision');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "start", "endStatus": null, "retiringSide": null}', %s, '')$q$, v_actor, m1, rev), 'INVALID', 'a start without a reason');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "pause", "endStatus": null, "retiringSide": null}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'a pause before the start');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "start", "endStatus": "completed", "retiringSide": null}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'a start naming an end');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "start", "endStatus": null, "retiringSide": null}', %s, 'r')$q$, v_editor, m1, rev), 'FORBIDDEN', 'an editor starting');
    j := public.admin_live_match_status(v_actor, m1, '{"action": "start", "endStatus": null, "retiringSide": null}', rev, 'test');
    rev := (j ->> 'revision')::integer;
    if j ->> 'status' <> 'live' then raise exception 'ASSERT FAIL: the match did not go live: %', j; end if;
    execute 'reset role';
    if not exists (select 1 from public.match_live_state where match_id = m1 and last_seq = 1 and first_server = 'B' and points_a = 0 and last_point_at is null) then
      raise exception 'ASSERT FAIL: the start did not store a 0-0 live row';
    end if;
    execute 'set local role service_role';

    -- ---------------------------------------------------------------- rallies: sequence, idempotency, undo
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 0}')$q$, v_actor, m1), 'STALE', 'an old expected sequence');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 2}')$q$, v_actor, m1), 'STALE', 'a future expected sequence');
    j := public.admin_live_score(v_actor, m1, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 1}');
    if (j ->> 'seq')::integer <> 2 or (j #>> '{state,pointsA}')::integer <> 1 or j #>> '{state,server}' <> 'A' or (j ->> 'duplicate')::boolean then
      raise exception 'ASSERT FAIL: the first rally is wrong: %', j;
    end if;
    -- the same tap again (lost answer): stored once, same answer, even with the old expected sequence
    j := public.admin_live_score(v_actor, m1, '{"kind": "rally", "side": "A", "key": "fake-key-0001", "expectedSeq": 1}');
    if not (j ->> 'duplicate')::boolean or (j ->> 'seq')::integer <> 2 or (j #>> '{state,pointsA}')::integer <> 1 then raise exception 'ASSERT FAIL: a repeated tap was not idempotent: %', j; end if;
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "B", "key": "fake-key-0001", "expectedSeq": 2}')$q$, v_actor, m1), 'INVALID', 'a key reused for another tap');
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "first_server", "side": "A", "key": "fake-key-fs02", "expectedSeq": 2}')$q$, v_actor, m1), 'INVALID', 'the first server after a rally');
    execute 'reset role';
    if (select count(*) from public.match_score_events where match_id = m1) <> 2 then raise exception 'ASSERT FAIL: the rally log holds the wrong number of taps'; end if;
    execute 'set local role service_role';
    -- undo is a compensating event: the log grows, the point goes
    j := pg_temp.tap(v_actor, m1, 'undo', null);
    if (j #>> '{state,pointsA}')::integer <> 0 or (j #>> '{state,rallies}')::integer <> 0 or j #>> '{state,server}' <> 'B' or (j ->> 'seq')::integer <> 3 then
      raise exception 'ASSERT FAIL: undo did not take the point back: %', j;
    end if;
    perform pg_temp.expect_code(format($q$select public.admin_live_score(%L, %L, '{"kind": "undo", "side": null, "key": "fake-key-0003", "expectedSeq": 3}')$q$, v_actor, m1), 'INVALID', 'an undo with nothing to undo');

    -- game 1 to A at 21-19 (19-19, then A twice); interval and the change of ends are the engine's (tested in TS)
    for k in 1 .. 19 loop
      perform pg_temp.tap(v_actor, m1, 'rally', 'A');
      perform pg_temp.tap(v_actor, m1, 'rally', 'B');
    end loop;
    perform pg_temp.tap(v_actor, m1, 'rally', 'A');
    j := pg_temp.tap(v_actor, m1, 'rally', 'A');
    st := j -> 'state';
    if st -> 'games' <> '[{"a": 21, "b": 19}]'::jsonb or (st ->> 'gamesA')::integer <> 1 or (st ->> 'gameNumber')::integer <> 2
       or (st ->> 'pointsA')::integer <> 0 or (st ->> 'pointsB')::integer <> 0 or st ->> 'server' <> 'A' then
      raise exception 'ASSERT FAIL: game 1 did not end at 21-19: %', st;
    end if;
    -- undo across the end of a game reopens it
    j := pg_temp.tap(v_actor, m1, 'undo', null);
    if (j #>> '{state,gameNumber}')::integer <> 1 or (j #>> '{state,pointsA}')::integer <> 20 or (j #>> '{state,pointsB}')::integer <> 19 or j #> '{state,games}' <> '[]'::jsonb then
      raise exception 'ASSERT FAIL: undo did not reopen game 1: %', j;
    end if;
    perform pg_temp.tap(v_actor, m1, 'rally', 'A');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "end", "endStatus": "completed", "retiringSide": null}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'ending as completed before the match is won');

    -- ---------------------------------------------------------------- the public view
    execute 'reset role';
    execute 'set local role anon';
    if exists (select 1 from api.public_competition_live) then raise exception 'ASSERT FAIL: the live view shows rows while the switch is off'; end if;
    execute 'reset role';
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_set_live_scores(%L, '{"public": true, "windowSeconds": 30}', 'r')$q$, v_actor), 'INVALID', 'a 30-second window');
    perform pg_temp.expect_code(format($q$select public.admin_set_live_scores(%L, '{"public": "yes", "windowSeconds": 300}', 'r')$q$, v_actor), 'INVALID', 'a switch that is not a boolean');
    perform pg_temp.expect_code(format($q$select public.admin_set_live_scores(%L, '{"public": true, "windowSeconds": 300}', 'r')$q$, v_editor), 'FORBIDDEN', 'an editor switching live scores on');
    j := public.admin_set_live_scores(v_actor, '{"public": true, "windowSeconds": 300}', 'test');
    -- match 2 is started and scored too: Gamma (protected) v Foxtrot
    rev := (select revision from public.competition_matches where id = m2);
    rev := (public.admin_live_match_status(v_actor, m2, '{"action": "start", "endStatus": null, "retiringSide": null}', rev, 'test') ->> 'revision')::integer;
    perform pg_temp.tap(v_actor, m2, 'rally', 'B');
    execute 'reset role';
    execute 'set local role anon';
    select * into r from api.public_competition_live where match_id = m1;
    if not found or r.status <> 'live' or not r.is_live or r.points_a <> 0 or r.points_b <> 0 or r.games_a <> 1 or r.game_number <> 2
       or r.finished_games <> '[{"a": 21, "b": 19}]'::jsonb or r.server_side <> 'A' or r.live_window_seconds <> 300 or r.last_update is null
       or r.side_a_player1_name <> 'Fake Live Alpha' or r.side_b_player1_name <> 'Fake Live Beta' or r.side_a_protected or r.side_b_protected or r.is_junior then
      raise exception 'ASSERT FAIL: the live view row of match 1 is wrong';
    end if;
    select * into r from api.public_competition_live where match_id = m2;
    if not found or r.side_a_player1_name is not null or not r.side_a_protected or r.side_b_player1_name <> 'Fake Live Foxtrot' or r.points_b <> 1 then
      raise exception 'ASSERT FAIL: the live view names the protected player of match 2 or lost its score';
    end if;
    select count(*) into n from api.public_competition_live x where position('fake live gamma' in lower(row_to_json(x)::text)) > 0;
    if n > 0 then raise exception 'ASSERT FAIL: the live view names a protected player'; end if;
    perform pg_temp.expect_fail('select * from public.match_live_state', 'anon reading the live state table');
    perform pg_temp.expect_fail('select * from public.match_score_events', 'anon reading the rally log');
    perform pg_temp.expect_fail(format($q$select public.admin_live_score(%L, %L, '{"kind": "rally", "side": "A", "key": "fake-key-anon", "expectedSeq": 0}')$q$, v_actor, m1), 'anon scoring');
    perform pg_temp.expect_fail(format($q$select public.admin_set_live_scores(%L, '{"public": true, "windowSeconds": 300}', 'r')$q$, v_actor), 'anon switching live scores');
    execute 'reset role';

    -- a scorer who stopped sending: listed, but not "Live"
    update public.match_live_state set last_point_at = now() - interval '6 minutes' where match_id = m1;
    execute 'set local role anon';
    if (select is_live from api.public_competition_live where match_id = m1) then raise exception 'ASSERT FAIL: a stale score shows as live'; end if;
    execute 'reset role';
    update public.match_live_state set last_point_at = now() + interval '10 minutes' where match_id = m1;
    execute 'set local role anon';
    if (select is_live from api.public_competition_live where match_id = m1) then raise exception 'ASSERT FAIL: a score from the future shows as live'; end if;
    execute 'reset role';

    -- ---------------------------------------------------------------- pause, resume
    execute 'set local role service_role';
    rev := (select revision from public.competition_matches where id = m1);
    rev := (public.admin_live_match_status(v_actor, m1, '{"action": "pause", "endStatus": null, "retiringSide": null}', rev, 'test') ->> 'revision')::integer;
    perform pg_temp.expect_code(format($q$select pg_temp.tap(%L, %L, 'rally', 'A')$q$, v_actor, m1), 'INVALID', 'a rally while paused');
    execute 'reset role';
    execute 'set local role anon';
    if (select status from api.public_competition_live where match_id = m1) <> 'paused' or (select is_live from api.public_competition_live where match_id = m1) then
      raise exception 'ASSERT FAIL: a paused match shows as live';
    end if;
    execute 'reset role';
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "pause", "endStatus": null, "retiringSide": null}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'pausing a paused match');
    rev := (public.admin_live_match_status(v_actor, m1, '{"action": "resume", "endStatus": null, "retiringSide": null}', rev, 'test') ->> 'revision')::integer;

    -- ---------------------------------------------------------------- game 2 to A at 21-0: the match is won, then ended
    for k in 1 .. 21 loop perform pg_temp.tap(v_actor, m1, 'rally', 'A'); end loop;
    perform pg_temp.expect_code(format($q$select pg_temp.tap(%L, %L, 'rally', 'B')$q$, v_actor, m1), 'INVALID', 'a rally after the match is won');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "end", "endStatus": "retired", "retiringSide": "B"}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'a retirement after the match is won');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "end", "endStatus": "walkover", "retiringSide": null}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'a walkover from the console');
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "end", "endStatus": "completed", "retiringSide": "A"}', %s, 'r')$q$, v_actor, m1, rev), 'INVALID', 'a completed end naming a retiring side');
    j := public.admin_live_match_status(v_actor, m1, '{"action": "end", "endStatus": "completed", "retiringSide": null}', rev, 'test');
    if j ->> 'status' <> 'completed' or j ->> 'winnerSide' <> 'A' or (j ->> 'confirmed')::boolean then raise exception 'ASSERT FAIL: the end did not record an unconfirmed win: %', j; end if;
    execute 'reset role';
    if (select jsonb_agg(jsonb_build_object('n', game_number, 'a', points_a, 'b', points_b, 'f', finished) order by game_number) from public.match_games where match_id = m1)
       <> '[{"n": 1, "a": 21, "b": 19, "f": true}, {"n": 2, "a": 21, "b": 0, "f": true}]'::jsonb then
      raise exception 'ASSERT FAIL: the games written at the end are wrong';
    end if;
    if not exists (select 1 from public.competition_matches where id = m1 and status = 'completed' and winner_side = 'A' and result_source = 'scorer' and not confirmed) then
      raise exception 'ASSERT FAIL: the match row after the end is wrong';
    end if;
    if not exists (select 1 from public.draws where event_id = ev and status = 'locked') then raise exception 'ASSERT FAIL: the first result did not lock the draw'; end if;
    execute 'set local role anon';
    if exists (select 1 from api.public_competition_live where match_id = m1) then raise exception 'ASSERT FAIL: an ended match is still in the live view'; end if;
    -- the unconfirmed result is not public (0017 view)
    if (select status from api.public_competition_matches where id = m1) <> 'awaiting_result' then raise exception 'ASSERT FAIL: an unconfirmed live result is public'; end if;
    execute 'reset role';
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select pg_temp.tap(%L, %L, 'undo', null)$q$, v_actor, m1), 'INVALID', 'an undo after the end');

    -- ---------------------------------------------------------------- match 2: Gamma retires mid-game; Foxtrot wins
    for k in 1 .. 4 loop perform pg_temp.tap(v_actor, m2, 'rally', 'A'); end loop;
    perform pg_temp.expect_code(format($q$select public.admin_live_match_status(%L, %L, '{"action": "end", "endStatus": "retired", "retiringSide": null}', %s, 'r')$q$, v_actor, m2, rev), 'INVALID', 'a retirement without a side');
    rev := (select revision from public.competition_matches where id = m2);
    j := public.admin_live_match_status(v_actor, m2, '{"action": "end", "endStatus": "retired", "retiringSide": "A"}', rev, 'test');
    if j ->> 'status' <> 'retired' or j ->> 'winnerSide' <> 'B' then raise exception 'ASSERT FAIL: the retirement is wrong: %', j; end if;
    execute 'reset role';
    if (select jsonb_agg(jsonb_build_object('a', points_a, 'b', points_b, 'f', finished) order by game_number) from public.match_games where match_id = m2)
       <> '[{"a": 4, "b": 1, "f": false}]'::jsonb then
      raise exception 'ASSERT FAIL: the unfinished game of the retirement is wrong';
    end if;

    -- ---------------------------------------------------------------- audit: ids and codes only
    if (select count(*) from public.audit_log where actor = v_actor and action in ('live_start', 'live_pause', 'live_resume', 'live_end', 'live_undo', 'live_first_server', 'set_live_scores')) < 9 then
      raise exception 'ASSERT FAIL: the live actions were not audited';
    end if;
    if exists (select 1 from public.audit_log where action in ('live_start', 'live_pause', 'live_resume', 'live_end', 'live_undo', 'live_first_server', 'set_live_scores') and diff::text ~* 'fake live') then
      raise exception 'ASSERT FAIL: a live audit row holds a name';
    end if;
    if exists (select 1 from public.audit_log where action = 'live_rally') then raise exception 'ASSERT FAIL: rallies are audited one by one (the rally log is the audit)'; end if;
    if exists (select 1 from public.match_score_events where match_id in (m1, m2) and recorded_by <> v_actor) then raise exception 'ASSERT FAIL: a tap does not record the actor'; end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0021_live_scores assertions passed' as result;
