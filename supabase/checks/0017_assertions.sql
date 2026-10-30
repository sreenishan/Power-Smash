-- 0017_assertions.sql - self-check for migration 0017_competition.sql (events, entries, draws, matches, games, rally log, rankings,
-- organizer assignments, notification outbox, data providers, the competition api views and the owner RPCs).
-- Run it after applying 0001..0017. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
-- tournaments and players. It raises an exception naming the first broken rule and ends with one row `ok`.

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
  tables text[] := array['competition_settings', 'tournament_events', 'venues', 'courts', 'event_entries', 'event_entry_players', 'draws', 'draw_slots',
    'competition_matches', 'match_games', 'match_score_events', 'ranking_snapshots', 'ranking_entries', 'organizer_assignments', 'notification_outbox',
    'data_providers', 'data_import_runs', 'external_record_mappings'];
  private_tables text[] := array['event_entry_players', 'match_score_events', 'organizer_assignments', 'notification_outbox', 'data_providers',
    'data_import_runs', 'external_record_mappings', 'competition_settings'];
  views jsonb := jsonb_build_object(
    'public_competition_events', jsonb_build_array('id', 'tournament_id', 'category', 'age_group', 'format', 'status', 'capacity', 'ruleset'),
    'public_competition_draws', jsonb_build_array('id', 'event_id', 'status', 'seed', 'published_at'),
    'public_competition_draw_slots', jsonb_build_array('draw_id', 'position', 'group_label', 'entry_id', 'is_bye', 'seed', 'player1_slug', 'player1_name',
      'player2_slug', 'player2_name', 'is_protected'),
    'public_competition_matches', jsonb_build_array('id', 'event_id', 'round_code', 'match_number', 'group_label', 'scheduled_at', 'court_label', 'status',
      'side_a_entry', 'side_a_player1_slug', 'side_a_player1_name', 'side_a_player2_slug', 'side_a_player2_name', 'side_a_protected',
      'side_b_entry', 'side_b_player1_slug', 'side_b_player1_name', 'side_b_player2_slug', 'side_b_player2_name', 'side_b_protected',
      'winner_side', 'result_confirmed', 'updated_at'),
    'public_competition_match_games', jsonb_build_array('match_id', 'game_number', 'points_a', 'points_b', 'finished'),
    'public_competition_rankings', jsonb_build_array('snapshot_id', 'label', 'category', 'age_group', 'as_of', 'published_at', 'rank', 'points', 'events_counted',
      'player_slug', 'player_name', 'is_protected'));
  forbidden text[] := array['player1_id', 'player2_id', 'player_id', 'age_status', 'phone', 'email', 'confirmed_by', 'created_by', 'recipient_lead_id',
    'recipient_profile_id', 'profile_id', 'idempotency_key', 'revision', 'result_source', 'manual_override'];
  rpcs text[] := array['public.admin_save_event(text,uuid,jsonb,text)', 'public.admin_add_entry(text,uuid,jsonb,text)', 'public.admin_withdraw_entry(text,uuid,text)',
    'public.admin_save_draw(text,uuid,jsonb,text)', 'public.admin_publish_draw(text,uuid,text)', 'public.admin_save_match(text,uuid,jsonb,integer,text)',
    'public.admin_record_result(text,uuid,jsonb,integer,text)', 'public.admin_confirm_result(text,uuid,integer,text)',
    'public.admin_save_ranking_snapshot(text,jsonb,text)', 'public.admin_publish_ranking_snapshot(text,uuid,text)'];
  helpers text[] := array['app.competition_ruleset_problem(jsonb)', 'app.competition_game_over(integer,integer,jsonb)',
    'app.competition_game_problem(integer,integer,jsonb,boolean)', 'app.competition_result_winner(jsonb,jsonb,text,text,text)',
    'app.competition_default_ruleset()', 'app.enqueue_notification(text,uuid,uuid,text,jsonb)', 'app.competition_uuid(jsonb,text)',
    'app.competition_int(jsonb,text,bigint,bigint)', 'app.competition_keys(jsonb,text[],text)', 'app.competition_reason(text)',
    'app.competition_age_group_ok(text)', 'app.competition_age_is_junior(text)', 'app.competition_outbox_payload_ok(jsonb)'];
  t text;
  p text;
  v text;
  fn text;
  c record;
  s public.competition_settings%rowtype;
begin
  foreach t in array tables loop
    if not coalesce((select c2.relrowsecurity from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace where n.nspname = 'public' and c2.relname = t and c2.relkind = 'r'), false) then
      raise exception 'ASSERT FAIL: public.% is missing or row level security is OFF', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then raise exception 'ASSERT FAIL: a policy exists on public.%', t; end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('anon', format('public.%I', t), p) or has_table_privilege('authenticated', format('public.%I', t), p) then
        raise exception 'ASSERT FAIL: anon or authenticated holds % on public.%', p, t;
      end if;
    end loop;
    if not has_table_privilege('service_role', format('public.%I', t), 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read public.%', t; end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', format('public.%I', t), p) then raise exception 'ASSERT FAIL: service_role holds % on public.% (writes go through the RPCs)', p, t; end if;
    end loop;
  end loop;
  -- private tables: no api view reads them
  foreach t in array private_tables loop
    if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class vw on vw.oid = r.ev_class join pg_namespace n on n.oid = vw.relnamespace
               where n.nspname = 'api' and d.refobjid = format('public.%I', t)::regclass) then
      raise exception 'ASSERT FAIL: an api view reads public.%', t;
    end if;
  end loop;

  -- the api views: exist, security_barrier, read-only for the API roles, exactly the declared columns in order, no private column
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
    for c in select column_name from information_schema.columns where table_schema = 'api' and table_name = v loop
      if c.column_name = any (forbidden) then raise exception 'ASSERT FAIL: api.% exposes the private column %', v, c.column_name; end if;
    end loop;
  end loop;
  -- the internal views are closed to the API roles
  foreach v in array array['competition_public_events', 'competition_entry_faces', 'competition_public_match_ids'] loop
    if has_table_privilege('anon', format('app.%I', v), 'SELECT') or has_table_privilege('authenticated', format('app.%I', v), 'SELECT') then
      raise exception 'ASSERT FAIL: anon or authenticated can read app.%', v;
    end if;
  end loop;

  -- the RPCs: SECURITY DEFINER, pinned search_path, service_role only; the helpers: nobody
  foreach fn in array rpcs loop
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = fn::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot run %', fn; end if;
    -- the owner check comes first
    if position('perform app.require_owner(p_actor);' in (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure)) = 0
       or position('perform app.require_owner(p_actor);' in (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure))
          > position('perform app.competition_reason' in (select pr.prosrc from pg_proc pr where pr.oid = fn::regprocedure)) then
      raise exception 'ASSERT FAIL: % does not call app.require_owner first', fn;
    end if;
  end loop;
  foreach fn in array helpers loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: an API role can run %', fn;
    end if;
  end loop;

  -- the safe defaults: every switch off, nothing seeded
  select * into s from public.competition_settings where id = 1;
  if not found or s.organizer_roles_enabled or s.player_accounts_enabled or s.registration_enabled or s.payment_mode <> 'off' or s.rankings_public then
    raise exception 'ASSERT FAIL: a competition switch is not off by default';
  end if;
  if (select count(*) from public.competition_settings) <> 1 then raise exception 'ASSERT FAIL: competition_settings must hold exactly one row'; end if;
  if exists (select 1 from public.data_providers) or exists (select 1 from public.organizer_assignments) or exists (select 1 from public.notification_outbox) then
    raise exception 'ASSERT FAIL: the migration seeded providers, assignments or notifications';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check'
             and pg_get_constraintdef(oid) ~ 'organizer|scorer|player') then
    raise exception 'ASSERT FAIL: profiles accepts a new role: the roles must stay disabled in this wave';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. the scoring rules in SQL (pure; mirrors src/lib/competition/scoring)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  d jsonb := app.competition_default_ruleset();
  r15 jsonb := '{"gamesToWin": 2, "pointsToWin": 15, "winBy": 2, "pointCap": 21, "intervalAt": 8, "changeEndsInDecidingGameAt": 8}';
  x record;
  w text;
begin
  if app.competition_ruleset_problem(d) is not null then raise exception 'ASSERT FAIL: the default ruleset is refused'; end if;
  if d <> '{"gamesToWin": 2, "pointsToWin": 21, "winBy": 2, "pointCap": 30, "intervalAt": 11, "changeEndsInDecidingGameAt": 11}'::jsonb then
    raise exception 'ASSERT FAIL: the default ruleset differs from DEFAULT_RULESET';
  end if;
  if app.competition_ruleset_problem(r15) is not null then raise exception 'ASSERT FAIL: a 15-point ruleset is refused'; end if;
  for x in select * from (values
      (d - 'winBy'), (d || '{"pointCap": 31}'), (d || '{"pointCap": null}'), (d || '{"pointCap": 20}'), (d || '{"gamesToWin": 4}'),
      (d || '{"pointsToWin": 21.5}'), (d || '{"intervalAt": 21}'), (d || '{"extra": 1}'), (d || '{"winBy": "2"}'), ('[]'::jsonb)) as v(r) loop
    if app.competition_ruleset_problem(x.r) is null then raise exception 'ASSERT FAIL: a broken ruleset was accepted: %', x.r; end if;
  end loop;

  -- valid finished games (default): 21-19, 22-20, 30-29, 30-28, 0-21, 29-30
  for x in select * from (values (21, 19), (22, 20), (30, 29), (30, 28), (0, 21), (29, 30), (25, 23)) as v(a, b) loop
    if app.competition_game_problem(x.a, x.b, d, true) is not null then raise exception 'ASSERT FAIL: % - % was refused', x.a, x.b; end if;
  end loop;
  -- invalid finished games (default): 21-20, 31-29, 23-20, 30-27, 20-20, 20-18, 24-21, -1-21
  for x in select * from (values (21, 20), (31, 29), (23, 20), (30, 27), (20, 20), (20, 18), (24, 21), (-1, 21)) as v(a, b) loop
    if app.competition_game_problem(x.a, x.b, d, true) is null then raise exception 'ASSERT FAIL: % - % was accepted', x.a, x.b; end if;
  end loop;
  -- unfinished games: 21-20 and 11-5 are open; 21-19 is over, so it cannot be unfinished
  if app.competition_game_problem(21, 20, d, false) is not null or app.competition_game_problem(11, 5, d, false) is not null then raise exception 'ASSERT FAIL: an open score was refused'; end if;
  if app.competition_game_problem(21, 19, d, false) is null then raise exception 'ASSERT FAIL: a finished score was accepted as unfinished'; end if;
  -- a 15-point ruleset: 15-13 and 21-20 (cap) are fine, 15-14 is not
  if app.competition_game_problem(15, 13, r15, true) is not null or app.competition_game_problem(21, 20, r15, true) is not null then raise exception 'ASSERT FAIL: a 15-point game was refused'; end if;
  if app.competition_game_problem(15, 14, r15, true) is null or app.competition_game_problem(16, 13, r15, true) is null then raise exception 'ASSERT FAIL: a broken 15-point game was accepted'; end if;

  -- whole matches
  if app.competition_result_winner('[{"a": 21, "b": 19}, {"a": 21, "b": 17}]', d, 'completed', null, null) <> 'A' then raise exception 'ASSERT FAIL: straight games'; end if;
  if app.competition_result_winner('[{"a": 21, "b": 19}, {"a": 19, "b": 21}, {"a": 20, "b": 22}]', d, 'completed', null, null) <> 'B' then raise exception 'ASSERT FAIL: three games'; end if;
  if app.competition_result_winner('[]', d, 'walkover', 'B', null) <> 'B' then raise exception 'ASSERT FAIL: walkover'; end if;
  if app.competition_result_winner('[{"a": 21, "b": 19}, {"a": 11, "b": 5}]', d, 'retired', null, 'A') <> 'B' then raise exception 'ASSERT FAIL: retired'; end if;
  if app.competition_result_winner('[{"a": 21, "b": 19}, {"a": 3, "b": 5}]', d, 'abandoned', null, null) is not null then raise exception 'ASSERT FAIL: abandoned has a winner'; end if;
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": 21, "b": 19}, {"a": 21, "b": 17}, {"a": 21, "b": 0}]', app.competition_default_ruleset(), 'completed', null, null)$q$, 'INVALID', 'a game after the match was decided');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": 21, "b": 19}]', app.competition_default_ruleset(), 'completed', null, null)$q$, 'INVALID', 'an undecided completed match');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": 21, "b": 20}, {"a": 21, "b": 17}]', app.competition_default_ruleset(), 'completed', null, null)$q$, 'INVALID', '21-20');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": 31, "b": 29}, {"a": 21, "b": 17}]', app.competition_default_ruleset(), 'completed', null, null)$q$, 'INVALID', '31-29');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": 21, "b": 19}]', app.competition_default_ruleset(), 'walkover', 'A', null)$q$, 'INVALID', 'a walkover with games');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[]', app.competition_default_ruleset(), 'retired', null, null)$q$, 'INVALID', 'a retirement without the retiring side');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": 21, "b": 19}, {"a": 21, "b": 17}]', app.competition_default_ruleset(), 'retired', null, 'B')$q$, 'INVALID', 'a retirement after the match was decided');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": "21", "b": 19}]', app.competition_default_ruleset(), 'completed', null, null)$q$, 'INVALID', 'points as text');
  -- like validateMatch: a retirement before any rally is a walkover (no games, or only 0-0 games)
  perform pg_temp.expect_code($q$select app.competition_result_winner('[]', app.competition_default_ruleset(), 'retired', null, 'A')$q$, 'INVALID', 'a retirement with no games');
  perform pg_temp.expect_code($q$select app.competition_result_winner('[{"a": 0, "b": 0}]', app.competition_default_ruleset(), 'retired', null, 'B')$q$, 'INVALID', 'a retirement with only a 0-0 game');
  if app.competition_result_winner('[{"a": 0, "b": 1}]', d, 'retired', null, 'B') <> 'A' then raise exception 'ASSERT FAIL: a retirement after one rally'; end if;

  -- age groups: canonical vocabulary only; junior detection fails closed
  if not (app.competition_age_group_ok(null) and app.competition_age_group_ok('U17') and app.competition_age_group_ok('35+') and app.competition_age_group_ok('senior')
          and app.competition_age_group_ok('sub_junior')) then raise exception 'ASSERT FAIL: a canonical age group was refused'; end if;
  if app.competition_age_group_ok('U-17') or app.competition_age_group_ok('Under17') or app.competition_age_group_ok('U17B') or app.competition_age_group_ok('u17')
     or app.competition_age_group_ok('') then raise exception 'ASSERT FAIL: a non-canonical age group was accepted'; end if;
  if app.competition_age_is_junior(null) or app.competition_age_is_junior('senior') or app.competition_age_is_junior('open') or app.competition_age_is_junior('U21')
     or app.competition_age_is_junior('35+') then raise exception 'ASSERT FAIL: an adult age group counts as junior'; end if;
  if not (app.competition_age_is_junior('U19') and app.competition_age_is_junior('U9') and app.competition_age_is_junior('junior') and app.competition_age_is_junior('mini')
          and app.competition_age_is_junior('U-17') and app.competition_age_is_junior('Under17') and app.competition_age_is_junior('U17B') and app.competition_age_is_junior('15+'))
     then raise exception 'ASSERT FAIL: a junior or unrecognised age group does not count as junior (fail closed)'; end if;

  -- outbox payloads: flat references and codes only; no contact data at any depth, under any key
  if not app.competition_outbox_payload_ok('{"draw": "ref", "matchId": "c0170000-0000-4000-8000-0000000000a0", "round": "SF", "number": 3, "on": "2026-10-30", "final": true}')
     then raise exception 'ASSERT FAIL: a reference payload was refused'; end if;
  if app.competition_outbox_payload_ok('{"data": {"phone": "910000000000"}}') then raise exception 'ASSERT FAIL: a nested phone was accepted'; end if;
  if app.competition_outbox_payload_ok('{"list": ["910000000000"]}') then raise exception 'ASSERT FAIL: a list was accepted'; end if;
  if app.competition_outbox_payload_ok('{"phone_number": "x"}') or app.competition_outbox_payload_ok('{"Email": "x"}') or app.competition_outbox_payload_ok('{"contact": "x"}')
     or app.competition_outbox_payload_ok('{"wa": "x"}') or app.competition_outbox_payload_ok('{"to": "x"}') or app.competition_outbox_payload_ok('{"playerName": "x"}')
     then raise exception 'ASSERT FAIL: a contact-like key was accepted'; end if;
  if app.competition_outbox_payload_ok('{"ref": "910000000000"}') or app.competition_outbox_payload_ok('{"ref": "+910000000000"}') or app.competition_outbox_payload_ok('{"ref": 910000000000}')
     or app.competition_outbox_payload_ok('{"ref": "x910000000000"}') or app.competition_outbox_payload_ok('{"ref": "fake@example.com"}')
     or app.competition_outbox_payload_ok('{"ref": "Fake Person"}') then raise exception 'ASSERT FAIL: a phone, email or name under a harmless key was accepted'; end if;
  if app.competition_outbox_payload_ok('[]') or app.competition_outbox_payload_ok('"x"') then raise exception 'ASSERT FAIL: a non-object payload was accepted'; end if;
  w := app.competition_result_winner('[{"a": 30, "b": 29}, {"a": 22, "b": 20}]', d, 'completed', null, null);
  if w <> 'A' then raise exception 'ASSERT FAIL: 30-29, 22-20 was not a win for A'; end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- C. behaviour (rolled back; fictional data)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  t_pub uuid := 'c0170000-0000-4000-8000-000000000001';
  t_hid uuid := 'c0170000-0000-4000-8000-000000000002';
  t_lst uuid := 'c0170000-0000-4000-8000-000000000003';  -- listed_no_player_pages (D-018)
  m0 uuid := 'c0170000-0000-4000-8000-0000000000a0';
  pa uuid := 'c0170000-0000-4000-8000-0000000000b1';  -- adult, eligible
  pb uuid := 'c0170000-0000-4000-8000-0000000000b2';  -- adult, eligible
  pc uuid := 'c0170000-0000-4000-8000-0000000000b3';  -- unknown age
  pd uuid := 'c0170000-0000-4000-8000-0000000000b4';  -- minor suspected
  pe uuid := 'c0170000-0000-4000-8000-0000000000b5';  -- unknown age
  d jsonb := app.competition_default_ruleset();
  ev jsonb;
  j jsonb;
  e_ms uuid;
  e_xd uuid;
  e_bs uuid;
  e_h uuid;
  e_draft uuid;
  en_a uuid;
  en_b uuid;
  en_c uuid;
  en_d uuid;
  en_e uuid;
  en_x uuid;
  dr uuid;
  dr_bs uuid;
  dr_h uuid;
  m1 uuid;
  m2 uuid;
  m3 uuid;
  e_lst uuid;
  dr_lst uuid;
  mh1 uuid;
  mh2 uuid;
  en_hb uuid;
  rs uuid;
  n integer;
  rev integer;
  o1 uuid;
  o2 uuid;
  v text;
begin
  begin
    -- a real owner may already exist (OT-51); set it aside for this rolled-back test only
    update public.profiles set role = 'editor' where role = 'owner';
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility) values
      (t_pub, 'fake-comp-open-2026', 'Fake Comp Open', 'fake comp open', 2026, 'tamil_nadu', 'published', 'public'),
      (t_hid, 'fake-comp-hidden-2026', 'Fake Comp Hidden', 'fake comp hidden', 2026, 'tamil_nadu', 'published', 'hidden'),
      (t_lst, 'fake-comp-listed-2026', 'Fake Comp Listed', 'fake comp listed', 2026, 'tamil_nadu', 'published', 'listed_no_player_pages');
    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (pa, 'Fake Comp Alpha', 'fake comp alpha', 'multi_token'), (pb, 'Fake Comp Beta', 'fake comp beta', 'multi_token'),
      (pc, 'Fake Comp Gamma', 'fake comp gamma', 'multi_token'), (pd, 'Fake Comp Delta', 'fake comp delta', 'multi_token'),
      (pe, 'Fake Comp Epsilon', 'fake comp epsilon', 'multi_token');
    update public.players set age_status = 'minor_suspected', age_signal = array['age_token:U13'] where id = pd;
    -- pa and pb become eligible adults the usual way: a public archive match, adult_confirmed, public, a confirmed alias (rename)
    insert into public.videos (youtube_id, title_raw, visibility, type) values ('fake-c17', 'FAKE COMP ALPHA vs FAKE COMP BETA | Fake Comp Open 2026', 'public', 'match');
    insert into public.matches (id, video_id, tournament_id, category, round, publish_state) values (m0, 'fake-c17', t_pub, 'MS', 'F', 'published');
    insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution, link_policy, identity_tier, age_status) values
      (m0, 'A', 1, 'FAKE COMP ALPHA', pa, 'provisional', 'provisional_ok', 'multi_token', 'unknown'),
      (m0, 'B', 1, 'FAKE COMP BETA', pb, 'provisional', 'provisional_ok', 'multi_token', 'unknown');
    execute 'set local role service_role';
    perform public.admin_set_age_status(v_actor, array[pa, pb], 'adult_confirmed', 'fake admin review', 'test');
    perform public.admin_update_player(v_actor, pa, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_update_player(v_actor, pb, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_rename_player(v_actor, pa, 'Fake Comp Alpha', 'fake comp alpha', 'give a named slug', 'fake-comp-alpha');
    perform public.admin_rename_player(v_actor, pb, 'Fake Comp Beta', 'fake comp beta', 'give a named slug', 'fake-comp-beta');
    execute 'reset role';
    if (select count(*) from app.eligible_players where id in (pa, pb)) <> 2 then raise exception 'ASSERT FAIL: setup: the fictional adults are not eligible'; end if;
    if exists (select 1 from app.eligible_players where id in (pc, pd, pe)) then raise exception 'ASSERT FAIL: setup: a protected player is eligible'; end if;
    update public.site_state set dirty = false, dirty_since = null where id = 1;

    -- ---------------------------------------------------------------- events
    ev := jsonb_build_object('tournamentId', t_pub, 'category', 'MS', 'ageGroup', null, 'format', 'knockout', 'ruleset', d, 'capacity', 4, 'status', 'open');
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_editor, ev), 'FORBIDDEN', 'an editor creating an event');
    perform pg_temp.expect_code(format($q$select public.admin_save_event('fake-admin', null, %L::jsonb, 'r')$q$, ev), 'FORBIDDEN', 'a non-uuid actor');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, '')$q$, v_actor, ev), 'INVALID', 'no reason');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || jsonb_build_object('ruleset', d || '{"pointCap": 31}')), 'INVALID', 'a cap of 31');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || '{"category": "XX"}'), 'INVALID', 'an unknown category');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || '{"format": "swiss"}'), 'INVALID', 'an unknown format');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || '{"capacity": 1}'), 'INVALID', 'a capacity of 1');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || '{"phone": "910000000000"}'), 'INVALID', 'an unknown field');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev - 'capacity'), 'INVALID', 'a missing field');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || jsonb_build_object('tournamentId', gen_random_uuid())), 'NOT_FOUND', 'an unknown tournament');
    e_ms := (public.admin_save_event(v_actor, null, ev, 'test') ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev), 'INVALID', 'a second MS event in the same tournament');
    e_xd := (public.admin_save_event(v_actor, null, ev || '{"category": "XD", "format": "round_robin", "capacity": null}', 'test') ->> 'id')::uuid;
    e_bs := (public.admin_save_event(v_actor, null, ev || '{"category": "BS", "ageGroup": "U15"}', 'test') ->> 'id')::uuid;
    e_draft := (public.admin_save_event(v_actor, null, ev || '{"category": "WS", "status": "draft"}', 'test') ->> 'id')::uuid;
    e_h := (public.admin_save_event(v_actor, null, ev || jsonb_build_object('tournamentId', t_hid), 'test') ->> 'id')::uuid;
    j := public.admin_save_event(v_actor, e_ms, ev, 'unchanged');
    if j -> 'fields' <> '[]'::jsonb then raise exception 'ASSERT FAIL: an unchanged event reported changes: %', j; end if;
    execute 'reset role';
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: an open event did not mark the site dirty'; end if;
    -- only the canonical age-group vocabulary (PC-13): 'U-17', 'Under17', 'U17B' are refused by the RPC and by the table
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || '{"category": "WD", "ageGroup": "Under17"}'), 'INVALID', 'a non-canonical age group');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, null, %L::jsonb, 'r')$q$, v_actor, ev || '{"category": "WD", "ageGroup": "U17B"}'), 'INVALID', 'a non-canonical age group (U17B)');
    execute 'reset role';
    perform pg_temp.expect_fail(format($q$insert into public.tournament_events (tournament_id, category, age_group, format) values (%L, 'WD', 'U-17', 'knockout')$q$, t_pub), 'a table insert with age group U-17');
    -- the table check holds without the RPC too
    perform pg_temp.expect_fail(format($q$insert into public.tournament_events (tournament_id, category, format, ruleset) values (%L, 'GD', 'knockout', %L::jsonb)$q$, t_pub, d || '{"pointCap": 40}'), 'a table insert with a cap of 40');

    -- ---------------------------------------------------------------- entries: duplicates, pairs, capacity under the lock
    execute 'set local role service_role';
    en_a := (public.admin_add_entry(v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pa), 'seed', 1, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'confirmed')), 'INVALID', 'a duplicate entry');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pb, pc), 'seed', null, 'status', 'confirmed')), 'INVALID', 'a pair in singles');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pb), 'seed', 1, 'status', 'confirmed')), 'INVALID', 'a seed used twice');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(gen_random_uuid()), 'seed', null, 'status', 'confirmed')), 'NOT_FOUND', 'an unknown player');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_editor, e_ms, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed')), 'FORBIDDEN', 'an editor adding an entry');
    en_b := (public.admin_add_entry(v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pb), 'seed', 2, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    en_c := (public.admin_add_entry(v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pc), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    en_d := (public.admin_add_entry(v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pd), 'seed', null, 'status', 'pending'), 'test') ->> 'id')::uuid;
    -- capacity 4 is reached (pending counts): a fifth confirmed entry is refused, a waitlisted one is fine
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pe), 'seed', null, 'status', 'confirmed')), 'INVALID', 'an entry beyond the capacity');
    en_e := (public.admin_add_entry(v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pe), 'seed', null, 'status', 'waitlisted'), 'test') ->> 'id')::uuid;
    -- withdrawing frees the player to enter again
    j := public.admin_withdraw_entry(v_actor, en_e, 'test');
    perform pg_temp.expect_code(format($q$select public.admin_withdraw_entry(%L, %L, 'r')$q$, v_actor, en_e), 'INVALID', 'withdrawing twice');
    perform public.admin_add_entry(v_actor, e_ms, jsonb_build_object('players', jsonb_build_array(pe), 'seed', null, 'status', 'waitlisted'), 'test re-entry');
    -- doubles: a pair; a player in two pairs of one event is refused; a pair of one player is refused
    en_x := (public.admin_add_entry(v_actor, e_xd, jsonb_build_object('players', jsonb_build_array(pa, pc), 'seed', null, 'status', 'confirmed'), 'test') ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_xd, jsonb_build_object('players', jsonb_build_array(pb, pa), 'seed', null, 'status', 'confirmed')), 'INVALID', 'a player in two pairs');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_xd, jsonb_build_object('players', jsonb_build_array(pb, pb), 'seed', null, 'status', 'confirmed')), 'INVALID', 'a pair of one player');
    perform pg_temp.expect_code(format($q$select public.admin_add_entry(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_xd, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed')), 'INVALID', 'one player in doubles');
    perform public.admin_add_entry(v_actor, e_bs, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'confirmed'), 'test');
    perform public.admin_add_entry(v_actor, e_bs, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed'), 'test');
    perform public.admin_add_entry(v_actor, e_h, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'confirmed'), 'test');
    perform public.admin_add_entry(v_actor, e_h, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed'), 'test');
    -- the capacity cannot drop below the entries already accepted
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, ev || '{"capacity": 3}'), 'INVALID', 'a capacity below the entries');
    execute 'reset role';
    -- the uniqueness is a real constraint, not only the RPC
    perform pg_temp.expect_fail(format($q$insert into public.event_entry_players (event_id, player_id, entry_id) values (%L, %L, %L)$q$, e_ms, pa, en_b), 'a second row for one player in one event');
    if (select count(*) from public.event_entries where event_id = e_ms and status in ('pending', 'confirmed')) <> 4 then raise exception 'ASSERT FAIL: the capacity was not respected'; end if;

    -- ---------------------------------------------------------------- draws: draft, regenerate, publish, immutable
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_save_draw(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('seed', 42, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null),
      jsonb_build_object('position', 3, 'entryId', null, 'group', null), jsonb_build_object('position', 4, 'entryId', null, 'group', null)))), 'INVALID', 'a confirmed entry left out');
    perform pg_temp.expect_code(format($q$select public.admin_save_draw(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('seed', 42, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null),
      jsonb_build_object('position', 3, 'entryId', en_c, 'group', null)))), 'INVALID', 'a knockout of 3');
    perform pg_temp.expect_code(format($q$select public.admin_save_draw(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('seed', 42, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null),
      jsonb_build_object('position', 3, 'entryId', en_c, 'group', null), jsonb_build_object('position', 4, 'entryId', en_d, 'group', null)))), 'INVALID', 'a pending entry in the draw');
    perform pg_temp.expect_code(format($q$select public.admin_save_draw(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('seed', 42, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 1, 'entryId', en_b, 'group', null),
      jsonb_build_object('position', 3, 'entryId', en_c, 'group', null), jsonb_build_object('position', 4, 'entryId', null, 'group', null)))), 'INVALID', 'a repeated position');
    dr := (public.admin_save_draw(v_actor, e_ms, jsonb_build_object('seed', 41, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_c, 'group', null),
      jsonb_build_object('position', 3, 'entryId', en_b, 'group', null), jsonb_build_object('position', 4, 'entryId', null, 'group', null))), 'test') ->> 'id')::uuid;
    -- a draft can be regenerated (same draw row, new seed and slots)
    if (public.admin_save_draw(v_actor, e_ms, jsonb_build_object('seed', 42, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', null, 'group', null),
      jsonb_build_object('position', 3, 'entryId', en_c, 'group', null), jsonb_build_object('position', 4, 'entryId', en_b, 'group', null))), 'test regenerate') ->> 'id')::uuid <> dr then
      raise exception 'ASSERT FAIL: regenerating a draft made a new draw';
    end if;
    execute 'reset role';
    if exists (select 1 from api.public_competition_draws where id = dr) then raise exception 'ASSERT FAIL: a draft draw is public'; end if;
    update public.site_state set dirty = false, dirty_since = null where id = 1;
    execute 'set local role service_role';
    j := public.admin_publish_draw(v_actor, dr, 'test');
    perform pg_temp.expect_code(format($q$select public.admin_publish_draw(%L, %L, 'r')$q$, v_actor, dr), 'INVALID', 'publishing twice');
    perform pg_temp.expect_code(format($q$select public.admin_save_draw(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, jsonb_build_object('seed', 7, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', en_a, 'group', null), jsonb_build_object('position', 2, 'entryId', en_b, 'group', null),
      jsonb_build_object('position', 3, 'entryId', en_c, 'group', null), jsonb_build_object('position', 4, 'entryId', null, 'group', null)))), 'INVALID', 'regenerating a published draw');
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, ev || '{"format": "round_robin"}'), 'INVALID', 'a format change after the draw');
    execute 'reset role';
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: publishing a draw did not mark the site dirty'; end if;
    -- the guards hold whoever writes (even the migration role)
    perform pg_temp.expect_fail(format($q$update public.draws set seed = 7 where id = %L$q$, dr), 'changing the seed of a published draw');
    perform pg_temp.expect_fail(format($q$update public.draws set status = 'draft', published_at = null where id = %L$q$, dr), 'unpublishing a draw');
    perform pg_temp.expect_fail(format($q$delete from public.draws where id = %L$q$, dr), 'deleting a published draw');
    perform pg_temp.expect_fail(format($q$update public.draw_slots set entry_id = null where draw_id = %L and position = 1$q$, dr), 'changing a slot of a published draw');
    perform pg_temp.expect_fail(format($q$delete from public.draw_slots where draw_id = %L$q$, dr), 'deleting the slots of a published draw');

    -- the junior event and the hidden tournament's event, published too
    execute 'set local role service_role';
    dr_bs := (public.admin_save_draw(v_actor, e_bs, jsonb_build_object('seed', 5, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', (select id from public.event_entries where event_id = e_bs and player1_id = pa), 'group', null),
      jsonb_build_object('position', 2, 'entryId', (select id from public.event_entries where event_id = e_bs and player1_id = pb), 'group', null))), 'test') ->> 'id')::uuid;
    perform public.admin_publish_draw(v_actor, dr_bs, 'test');
    dr_h := (public.admin_save_draw(v_actor, e_h, jsonb_build_object('seed', 6, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', (select id from public.event_entries where event_id = e_h and player1_id = pa), 'group', null),
      jsonb_build_object('position', 2, 'entryId', (select id from public.event_entries where event_id = e_h and player1_id = pb), 'group', null))), 'test') ->> 'id')::uuid;
    perform public.admin_publish_draw(v_actor, dr_h, 'test');
    -- a listed_no_player_pages tournament (D-018): adults keep their names but get no player-page slug
    e_lst := (public.admin_save_event(v_actor, null, ev || jsonb_build_object('tournamentId', t_lst), 'test') ->> 'id')::uuid;
    perform public.admin_add_entry(v_actor, e_lst, jsonb_build_object('players', jsonb_build_array(pa), 'seed', null, 'status', 'confirmed'), 'test');
    perform public.admin_add_entry(v_actor, e_lst, jsonb_build_object('players', jsonb_build_array(pb), 'seed', null, 'status', 'confirmed'), 'test');
    dr_lst := (public.admin_save_draw(v_actor, e_lst, jsonb_build_object('seed', 8, 'slots', jsonb_build_array(
      jsonb_build_object('position', 1, 'entryId', (select id from public.event_entries where event_id = e_lst and player1_id = pa), 'group', null),
      jsonb_build_object('position', 2, 'entryId', (select id from public.event_entries where event_id = e_lst and player1_id = pb), 'group', null))), 'test') ->> 'id')::uuid;
    perform public.admin_publish_draw(v_actor, dr_lst, 'test');
    execute 'reset role';
    if (select count(*) from api.public_competition_draw_slots where draw_id = dr_lst) <> 2 then raise exception 'ASSERT FAIL: setup: the listed-only draw is not public'; end if;
    if exists (select 1 from api.public_competition_draw_slots where draw_id = dr_lst and (player1_slug is not null or player2_slug is not null)) then
      raise exception 'ASSERT FAIL: a listed_no_player_pages tournament links to a player page';
    end if;
    if (select player1_name from api.public_competition_draw_slots where draw_id = dr_lst and position = 1) is distinct from 'Fake Comp Alpha' then
      raise exception 'ASSERT FAIL: an eligible adult lost their name in a listed-only tournament';
    end if;

    -- ---------------------------------------------------------------- the public views: protected players are never named
    if (select player1_name from api.public_competition_draw_slots where draw_id = dr and entry_id = en_a) is distinct from 'Fake Comp Alpha'
       or (select player1_slug from api.public_competition_draw_slots where draw_id = dr and entry_id = en_a) is distinct from 'fake-comp-alpha' then
      raise exception 'ASSERT FAIL: an eligible adult is not named in the published draw';
    end if;
    if (select player1_name is null and player1_slug is null and is_protected from api.public_competition_draw_slots where draw_id = dr and entry_id = en_c) is not true then
      raise exception 'ASSERT FAIL: an unknown-age player is named (or not marked protected) in the draw';
    end if;
    if (select count(*) from api.public_competition_draw_slots where draw_id = dr and is_bye) <> 1 then raise exception 'ASSERT FAIL: the bye is not shown'; end if;
    if exists (select 1 from api.public_competition_draw_slots where draw_id = dr_bs and (player1_name is not null or player1_slug is not null or not is_protected)) then
      raise exception 'ASSERT FAIL: a player is named in a junior event';
    end if;
    if exists (select 1 from api.public_competition_events where id in (e_h, e_draft)) or exists (select 1 from api.public_competition_draws where id = dr_h)
       or exists (select 1 from api.public_competition_draw_slots where draw_id = dr_h) then
      raise exception 'ASSERT FAIL: an event of a hidden tournament, or a draft event, is public';
    end if;
    if (select count(*) from api.public_competition_events where id in (e_ms, e_xd, e_bs)) <> 3 then raise exception 'ASSERT FAIL: the open events are not public'; end if;

    -- ---------------------------------------------------------------- matches and results
    execute 'set local role service_role';
    m1 := (public.admin_save_match(v_actor, null, jsonb_build_object('eventId', e_ms, 'roundCode', 'SF', 'matchNumber', 1, 'groupLabel', null, 'sideA', en_a, 'sideB', en_c,
      'scheduledAt', '2026-11-02T04:30:00Z', 'courtId', null), null, 'test') ->> 'id')::uuid;
    m2 := (public.admin_save_match(v_actor, null, jsonb_build_object('eventId', e_ms, 'roundCode', 'SF', 'matchNumber', 2, 'groupLabel', null, 'sideA', en_b, 'sideB', null,
      'scheduledAt', null, 'courtId', null), null, 'test') ->> 'id')::uuid;
    m3 := (public.admin_save_match(v_actor, null, jsonb_build_object('eventId', e_ms, 'roundCode', 'F', 'matchNumber', 3, 'groupLabel', null, 'sideA', en_a, 'sideB', en_b,
      'scheduledAt', null, 'courtId', null), null, 'test') ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, null, %L::jsonb, null, 'r')$q$, v_actor, jsonb_build_object('eventId', e_ms, 'roundCode', 'F', 'matchNumber', 1,
      'groupLabel', null, 'sideA', null, 'sideB', null, 'scheduledAt', null, 'courtId', null)), 'INVALID', 'a match number used twice');
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, null, %L::jsonb, null, 'r')$q$, v_actor, jsonb_build_object('eventId', e_ms, 'roundCode', 'QF', 'matchNumber', 9,
      'groupLabel', null, 'sideA', en_x, 'sideB', null, 'scheduledAt', null, 'courtId', null)), 'INVALID', 'an entry of another event');
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, null, %L::jsonb, null, 'r')$q$, v_actor, jsonb_build_object('eventId', e_ms, 'roundCode', 'QF', 'matchNumber', 9,
      'groupLabel', null, 'sideA', en_d, 'sideB', null, 'scheduledAt', null, 'courtId', null)), 'INVALID', 'a pending entry as a side');
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, null, %L::jsonb, null, 'r')$q$, v_actor, jsonb_build_object('eventId', e_ms, 'roundCode', 'QF', 'matchNumber', 9,
      'groupLabel', null, 'sideA', (select id from public.event_entries where event_id = e_ms and player1_id = pe and status = 'waitlisted'), 'sideB', null,
      'scheduledAt', null, 'courtId', null)), 'INVALID', 'a waitlisted entry as a side');
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, null, %L::jsonb, null, 'r')$q$, v_actor, jsonb_build_object('eventId', e_ms, 'roundCode', 'QF', 'matchNumber', 9,
      'groupLabel', null, 'sideA', null, 'sideB', null, 'scheduledAt', '2026-11-02 10:00', 'courtId', null)), 'INVALID', 'an instant without a zone');
    perform pg_temp.expect_code(format($q$select public.admin_save_match(%L, %L, %L::jsonb, 5, 'r')$q$, v_actor, m2, jsonb_build_object('eventId', e_ms, 'roundCode', 'SF', 'matchNumber', 2,
      'groupLabel', null, 'sideA', en_b, 'sideB', null, 'scheduledAt', null, 'courtId', null)), 'STALE', 'a stale schedule edit');
    rev := (select revision from public.competition_matches where id = m1);
    -- invalid scores are refused: 21-20, 31-29, 23-20, a decided match with a third game
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, m1, '{"status": "completed", "games": [{"a": 21, "b": 20}, {"a": 21, "b": 15}], "walkoverWinner": null, "retiringSide": null}', rev), 'INVALID', '21-20');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, m1, '{"status": "completed", "games": [{"a": 31, "b": 29}, {"a": 21, "b": 15}], "walkoverWinner": null, "retiringSide": null}', rev), 'INVALID', '31-29');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, m1, '{"status": "completed", "games": [{"a": 23, "b": 20}, {"a": 21, "b": 15}], "walkoverWinner": null, "retiringSide": null}', rev), 'INVALID', '23-20');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, m1, '{"status": "completed", "games": [{"a": 21, "b": 10}, {"a": 21, "b": 15}, {"a": 21, "b": 0}], "walkoverWinner": null, "retiringSide": null}', rev), 'INVALID', 'a game after the match was decided');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, m1, '{"status": "walkover", "games": [{"a": 21, "b": 10}], "walkoverWinner": "A", "retiringSide": null}', rev), 'INVALID', 'a walkover with games');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, m1, '{"status": "completed", "games": [{"a": 30, "b": 29}, {"a": 22, "b": 20}], "walkoverWinner": null, "retiringSide": null}', rev + 1), 'STALE', 'a stale result');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_editor, m1, '{"status": "completed", "games": [{"a": 30, "b": 29}, {"a": 22, "b": 20}], "walkoverWinner": null, "retiringSide": null}', rev), 'FORBIDDEN', 'an editor recording a result');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, 1, 'r')$q$, v_actor, m2, '{"status": "walkover", "games": [], "walkoverWinner": "A", "retiringSide": null}'), 'INVALID', 'a result with an unknown side');
    execute 'reset role';
    if exists (select 1 from public.match_games where match_id = m1) or (select status from public.competition_matches where id = m1) <> 'scheduled' then
      raise exception 'ASSERT FAIL: a refused result stored something';
    end if;
    -- valid: 30-29 and 22-20
    execute 'set local role service_role';
    j := public.admin_record_result(v_actor, m1, '{"status": "completed", "games": [{"a": 30, "b": 29}, {"a": 22, "b": 20}], "walkoverWinner": null, "retiringSide": null}', rev, 'test');
    execute 'reset role';
    if j ->> 'winnerSide' <> 'A' or (j ->> 'confirmed')::boolean then raise exception 'ASSERT FAIL: the valid result was not stored unconfirmed for A: %', j; end if;
    if (select count(*) from public.match_games where match_id = m1 and finished) <> 2 then raise exception 'ASSERT FAIL: the games were not stored'; end if;
    if (select status from public.draws where id = dr) <> 'locked' then raise exception 'ASSERT FAIL: the first result did not lock the draw'; end if;
    -- unconfirmed: not public
    if (select status from api.public_competition_matches where id = m1) <> 'awaiting_result' or (select winner_side from api.public_competition_matches where id = m1) is not null
       or exists (select 1 from api.public_competition_match_games where match_id = m1) then
      raise exception 'ASSERT FAIL: an unconfirmed result is public';
    end if;
    if (select side_a_player1_name from api.public_competition_matches where id = m1) is distinct from 'Fake Comp Alpha'
       or (select side_b_player1_name is null and side_b_protected from api.public_competition_matches where id = m1) is not true then
      raise exception 'ASSERT FAIL: the match sides are not masked correctly (adult named, unknown-age protected)';
    end if;
    -- confirm: public now
    rev := (select revision from public.competition_matches where id = m1);
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_confirm_result(%L, %L, %s, 'r')$q$, v_actor, m1, rev - 1), 'STALE', 'a stale confirmation');
    perform pg_temp.expect_code(format($q$select public.admin_confirm_result(%L, %L, 1, 'r')$q$, v_actor, m3), 'INVALID', 'confirming a match with no result');
    j := public.admin_confirm_result(v_actor, m1, rev, 'test');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, m1, '{"status": "walkover", "games": [], "walkoverWinner": "B", "retiringSide": null}', rev + 1), 'INVALID', 'changing a confirmed result');
    execute 'reset role';
    if (select status from api.public_competition_matches where id = m1) <> 'completed' or (select winner_side from api.public_competition_matches where id = m1) <> 'A'
       or (select count(*) from api.public_competition_match_games where match_id = m1) <> 2 then
      raise exception 'ASSERT FAIL: a confirmed result is not public';
    end if;
    perform pg_temp.expect_fail(format($q$update public.competition_matches set winner_side = 'B' where id = %L$q$, m1), 'changing a confirmed match directly');
    perform pg_temp.expect_fail(format($q$update public.match_games set points_a = 21, points_b = 19 where match_id = %L and game_number = 1$q$, m1), 'changing a confirmed game directly');
    perform pg_temp.expect_fail(format($q$delete from public.competition_matches where id = %L$q$, m1), 'deleting a confirmed match');
    -- a retirement: the last game unfinished
    execute 'set local role service_role';
    perform public.admin_save_match(v_actor, m2, jsonb_build_object('eventId', e_ms, 'roundCode', 'SF', 'matchNumber', 2, 'groupLabel', null, 'sideA', en_b, 'sideB', en_c,
      'scheduledAt', null, 'courtId', null), (select revision from public.competition_matches where id = m2), 'test');
    j := public.admin_record_result(v_actor, m2, '{"status": "retired", "games": [{"a": 21, "b": 15}, {"a": 5, "b": 3}], "walkoverWinner": null, "retiringSide": "B"}',
      (select revision from public.competition_matches where id = m2), 'test');
    execute 'reset role';
    if j ->> 'winnerSide' <> 'A' or (select finished from public.match_games where match_id = m2 and game_number = 2) then raise exception 'ASSERT FAIL: the retirement was not stored with an unfinished last game'; end if;
    -- the games trigger checks every write against the event ruleset (default here): 21-20 refused, 22-20 accepted
    perform pg_temp.expect_fail(format($q$insert into public.match_games (match_id, game_number, points_a, points_b) values (%L, 1, 21, 20)$q$, m3), 'a direct 21-20');
    perform pg_temp.expect_fail(format($q$insert into public.match_games (match_id, game_number, points_a, points_b) values (%L, 1, 31, 29)$q$, m3), 'a direct 31-29');
    perform pg_temp.expect_fail(format($q$insert into public.match_games (match_id, game_number, points_a, points_b) values (%L, 4, 21, 0)$q$, m3), 'a fourth game in best of three');
    insert into public.match_games (match_id, game_number, points_a, points_b) values (m3, 1, 22, 20);
    -- the ruleset is fixed once a game exists
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_save_event(%L, %L, %L::jsonb, 'r')$q$, v_actor, e_ms, ev || jsonb_build_object('ruleset', d || '{"pointsToWin": 15, "pointCap": 21, "intervalAt": 8, "changeEndsInDecidingGameAt": 8}')), 'INVALID', 'a ruleset change after a game');
    execute 'reset role';

    -- ---------------------------------------------------------------- results need a match that is on, and confirmed sides
    execute 'set local role service_role';
    en_hb := (select id from public.event_entries where event_id = e_h and player1_id = pb);
    mh1 := (public.admin_save_match(v_actor, null, jsonb_build_object('eventId', e_h, 'roundCode', 'F', 'matchNumber', 1, 'groupLabel', null,
      'sideA', (select id from public.event_entries where event_id = e_h and player1_id = pa), 'sideB', en_hb, 'scheduledAt', null, 'courtId', null), null, 'test') ->> 'id')::uuid;
    mh2 := (public.admin_save_match(v_actor, null, jsonb_build_object('eventId', e_h, 'roundCode', '3P', 'matchNumber', 2, 'groupLabel', null,
      'sideA', (select id from public.event_entries where event_id = e_h and player1_id = pa), 'sideB', en_hb, 'scheduledAt', null, 'courtId', null), null, 'test') ->> 'id')::uuid;
    execute 'reset role';
    update public.competition_matches set status = 'cancelled', revision = revision + 1 where id = mh2;
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, mh2, '{"status": "walkover", "games": [], "walkoverWinner": "A", "retiringSide": null}',
      (select revision from public.competition_matches where id = mh2)), 'INVALID', 'a result on a cancelled match');
    execute 'reset role';
    update public.competition_matches set status = 'postponed', revision = revision + 1 where id = mh2;
    execute 'set local role service_role';
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, mh2, '{"status": "walkover", "games": [], "walkoverWinner": "A", "retiringSide": null}',
      (select revision from public.competition_matches where id = mh2)), 'INVALID', 'a result on a postponed match');
    -- side B withdraws after the draw: only a walkover to side A can be recorded
    perform public.admin_withdraw_entry(v_actor, en_hb, 'test');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, mh1, '{"status": "completed", "games": [{"a": 21, "b": 10}, {"a": 21, "b": 12}], "walkoverWinner": null, "retiringSide": null}',
      (select revision from public.competition_matches where id = mh1)), 'INVALID', 'a played result with a withdrawn side');
    perform pg_temp.expect_code(format($q$select public.admin_record_result(%L, %L, %L::jsonb, %s, 'r')$q$, v_actor, mh1, '{"status": "walkover", "games": [], "walkoverWinner": "B", "retiringSide": null}',
      (select revision from public.competition_matches where id = mh1)), 'INVALID', 'a walkover to the withdrawn side');
    j := public.admin_record_result(v_actor, mh1, '{"status": "walkover", "games": [], "walkoverWinner": "A", "retiringSide": null}', (select revision from public.competition_matches where id = mh1), 'test');
    execute 'reset role';
    if j ->> 'winnerSide' <> 'A' then raise exception 'ASSERT FAIL: the walkover over a withdrawn side was not recorded'; end if;

    -- ---------------------------------------------------------------- the rally log is append-only and idempotent
    insert into public.match_score_events (match_id, seq, kind, side, idempotency_key, recorded_by) values (m3, 1, 'rally', 'A', 'fake-tap-0001', v_actor);
    perform pg_temp.expect_fail(format($q$insert into public.match_score_events (match_id, seq, kind, side, idempotency_key, recorded_by) values (%L, 2, 'rally', 'A', 'fake-tap-0001', 'x')$q$, m3), 'a repeated idempotency key');
    perform pg_temp.expect_fail(format($q$insert into public.match_score_events (match_id, seq, kind, side, idempotency_key, recorded_by) values (%L, 2, 'undo', 'A', 'fake-tap-0002', 'x')$q$, m3), 'an undo with a side');
    perform pg_temp.expect_fail(format($q$update public.match_score_events set side = 'B' where match_id = %L$q$, m3), 'changing the rally log');
    perform pg_temp.expect_fail(format($q$delete from public.match_score_events where match_id = %L$q$, m3), 'deleting from the rally log');

    -- ---------------------------------------------------------------- rankings: unofficial, unpublished, then public only with the switch
    execute 'set local role service_role';
    rs := (public.admin_save_ranking_snapshot(v_actor, jsonb_build_object('label', 'Fake local ranking', 'category', 'MS', 'ageGroup', null, 'asOf', '2026-10-01',
      'entries', jsonb_build_array(jsonb_build_object('playerId', pa, 'rank', 1, 'points', 120, 'eventsCounted', 2), jsonb_build_object('playerId', pc, 'rank', 2, 'points', 80, 'eventsCounted', 1))), 'test') ->> 'id')::uuid;
    perform pg_temp.expect_code(format($q$select public.admin_save_ranking_snapshot(%L, %L::jsonb, 'r')$q$, v_actor, jsonb_build_object('label', 'Fake', 'category', null, 'ageGroup', null, 'asOf', '2026-10-01',
      'entries', jsonb_build_array(jsonb_build_object('playerId', pa, 'rank', 1, 'points', 1, 'eventsCounted', 0), jsonb_build_object('playerId', pa, 'rank', 2, 'points', 0, 'eventsCounted', 0)))), 'INVALID', 'a player twice in a ranking');
    execute 'reset role';
    if exists (select 1 from api.public_competition_rankings where snapshot_id = rs) then raise exception 'ASSERT FAIL: an unpublished ranking is public'; end if;
    execute 'set local role service_role';
    j := public.admin_publish_ranking_snapshot(v_actor, rs, 'test');
    execute 'reset role';
    if (j ->> 'publiclyVisible')::boolean or exists (select 1 from api.public_competition_rankings where snapshot_id = rs) then
      raise exception 'ASSERT FAIL: a published ranking is public while rankings_public is off';
    end if;
    update public.competition_settings set rankings_public = true where id = 1;
    if (select count(*) from api.public_competition_rankings where snapshot_id = rs) <> 1 then raise exception 'ASSERT FAIL: the published ranking is not public with the switch on (one named row; the unknown-age player is left out)'; end if;
    if (select player_name from api.public_competition_rankings where snapshot_id = rs and rank = 1) is distinct from 'Fake Comp Alpha'
       or exists (select 1 from api.public_competition_rankings where snapshot_id = rs and (rank = 2 or is_protected or player_name is null)) then
      raise exception 'ASSERT FAIL: the ranking does not leave out the unknown-age player';
    end if;
    perform pg_temp.expect_fail(format($q$update public.ranking_entries set points = 999 where snapshot_id = %L$q$, rs), 'changing a published ranking');
    perform pg_temp.expect_fail(format($q$update public.ranking_snapshots set label = 'x2' where id = %L$q$, rs), 'renaming a published ranking');
    perform pg_temp.expect_fail($q$insert into public.ranking_snapshots (label, as_of, is_official, created_by) values ('Fake', '2026-10-01', true, 'x')$q$, 'an official ranking');

    -- ---------------------------------------------------------------- no protected name in ANY competition view
    foreach v in array array['public_competition_events', 'public_competition_draws', 'public_competition_draw_slots', 'public_competition_matches',
                             'public_competition_match_games', 'public_competition_rankings'] loop
      execute format($q$select count(*) from api.%I x where row_to_json(x)::text ~ '(Gamma|Delta|Epsilon|gamma|delta|epsilon)'$q$, v) into n;
      if n > 0 then raise exception 'ASSERT FAIL: api.% names a protected player', v; end if;
    end loop;
    -- the audit holds ids, counts and codes, never a player's name
    if exists (select 1 from public.audit_log where entity in ('tournament_events', 'event_entries', 'draws', 'competition_matches', 'ranking_snapshots') and diff::text ~* 'fake comp') then
      raise exception 'ASSERT FAIL: a competition audit row holds a player name';
    end if;
    if (select count(*) from public.audit_log where action in ('add_entry', 'publish_draw', 'record_result', 'confirm_result', 'publish_ranking_snapshot') and actor = v_actor) < 5 then
      raise exception 'ASSERT FAIL: the competition actions were not audited';
    end if;

    -- ---------------------------------------------------------------- outbox: references only, idempotent
    o1 := app.enqueue_notification('draw_published', null, v_owner, 'fake-outbox-key-1', '{"draw": "ref"}');
    o2 := app.enqueue_notification('draw_published', null, v_owner, 'fake-outbox-key-1', '{"draw": "ref"}');
    if o1 is null or o1 <> o2 or (select count(*) from public.notification_outbox) <> 1 then raise exception 'ASSERT FAIL: the outbox is not idempotent'; end if;
    perform pg_temp.expect_fail(format($q$select app.enqueue_notification('x_kind', null, %L, 'fake-outbox-key-2', '{"phone": "910000000000"}')$q$, v_owner), 'a phone number in the outbox');
    perform pg_temp.expect_fail($q$select app.enqueue_notification('x_kind', null, null, 'fake-outbox-key-3', '{}')$q$, 'an outbox row with no recipient');
    perform pg_temp.expect_fail(format($q$select app.enqueue_notification('x_kind', null, %L, 'fake-outbox-key-4', '{"data": {"phone": "910000000000"}}')$q$, v_owner), 'a nested phone number in the outbox');
    perform pg_temp.expect_fail(format($q$select app.enqueue_notification('x_kind', null, %L, 'fake-outbox-key-5', '{"Phone_Number": "x"}')$q$, v_owner), 'a variant phone key in the outbox');
    perform pg_temp.expect_fail(format($q$select app.enqueue_notification('x_kind', null, %L, 'fake-outbox-key-6', '{"ref": "910000000000"}')$q$, v_owner), 'a phone number under a harmless key');
    perform pg_temp.expect_fail(format($q$select app.enqueue_notification('x_kind', null, %L, 'fake-outbox-key-7', '{"ref": "fake@example.com"}')$q$, v_owner), 'an email under a harmless key');
    perform pg_temp.expect_fail(format($q$update public.notification_outbox set status = 'sent' where id = %L$q$, o1), 'sent without a sent time');

    -- ---------------------------------------------------------------- providers: no licence, no import, no scraping
    perform pg_temp.expect_fail($q$insert into public.data_providers (id, name, kind, enabled) values ('fake-provider', 'Fake Provider', 'licensed_api', true)$q$, 'an enabled provider without a licence');
    insert into public.data_providers (id, name, kind) values ('fake-provider', 'Fake Provider', 'licensed_api');
    perform pg_temp.expect_fail($q$insert into public.data_import_runs (provider_id) values ('fake-provider')$q$, 'an import from a disabled provider');
    insert into public.external_record_mappings (provider_id, external_type, external_id, internal_table, internal_id) values ('fake-provider', 'player', 'FAKE-1', 'players', pa);
    perform pg_temp.expect_fail(format($q$insert into public.external_record_mappings (provider_id, external_type, external_id, internal_table, internal_id) values ('fake-provider', 'player', 'FAKE-1', 'players', %L)$q$, pb), 'a duplicate external id');

    -- ---------------------------------------------------------------- anon: no base table, no RPC; the views only
    execute 'set local role anon';
    perform pg_temp.expect_fail($q$select * from public.tournament_events$q$, 'anon reading public.tournament_events');
    perform pg_temp.expect_fail($q$select * from public.event_entries$q$, 'anon reading public.event_entries');
    perform pg_temp.expect_fail($q$select * from public.notification_outbox$q$, 'anon reading public.notification_outbox');
    perform pg_temp.expect_fail(format($q$select public.admin_save_event(%L, null, '{}'::jsonb, 'r')$q$, v_actor), 'anon running admin_save_event');
    perform pg_temp.expect_fail(format($q$select public.admin_confirm_result(%L, %L, 1, 'r')$q$, v_actor, m1), 'anon running admin_confirm_result');
    select count(*) into n from api.public_competition_matches where id = m1;
    if n <> 1 then raise exception 'ASSERT FAIL: anon cannot read the public match'; end if;
    perform count(*) from api.public_competition_rankings;
    perform count(*) from api.public_competition_draw_slots;
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0017_competition assertions passed' as result;
