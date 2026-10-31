-- supabase/demo/competition-demo.sql: MADE-UP competition data for the DEVELOPMENT Supabase project ONLY (OT-03).
--
-- What it is: three invented tournaments with events, players, draws, an order of play, results and one local ranking, so the private
-- preview (PS_COMPETITION_SOURCE=supabase, .github/workflows/preview.yml) shows every /competitions/ page with something on it.
-- Every person, club, hall, city and tournament below is invented and obviously so: people are "Demo <first name> <made-up surname>",
-- places are "Sampleville" and "Fakenagar", tournaments are "Demo ...". No phone number, no email, no contact row of any kind.
--
-- NEVER run this on the production project. It switches competition_settings.rankings_public ON (dev only) so the demo ranking shows;
-- the value it found is written to the audit log and the removal script puts it back.
--
-- How to use (owner, phone or PC): Supabase dashboard, the DEVELOPMENT project, SQL Editor, New query, paste this whole file ONCE.
-- Then, BEFORE Run, change the one line below that says PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE: put the development project's
-- reference there (the short code in that project's web address; it is not a secret). Until that line is changed the script refuses
-- and adds nothing, so a blind paste into the live project does nothing. Then Run. It is one transaction: either everything is added or nothing is. Running it a second time refuses with a plain message and
-- changes nothing. To take it all away again: paste supabase/demo/competition-demo-remove.sql the same way.
--
-- How it writes: the owner's own admin functions (admin_save_event, admin_add_entry, admin_save_draw, admin_publish_draw,
-- admin_save_match, admin_record_result, admin_confirm_result, admin_save_venue, admin_save_court, admin_set_ranking_points,
-- admin_save_ranking_snapshot, admin_publish_ranking_snapshot, admin_set_age_status, admin_update_player) with the REAL owner
-- (profiles.role = 'owner') as the actor, so every rule, check and audit row runs exactly as in the admin. Only the tournaments and
-- the players are plain inserts (no admin function creates them), within every constraint and trigger, and the rankings_public switch
-- (no admin function exists for it yet).
--
-- How the demo rows are marked (the removal script deletes these and nothing else):
--   * tournaments and players have fixed ids starting de000000-0000-4000-8000- (a reserved prefix no generated id uses: a random
--     version-4 uuid would need its own random first digits), names starting "Demo " and tournament slugs starting "demo-";
--   * everything else hangs off a demo tournament (events, entries, draws, matches, games, courts), or is named "Demo ..." in
--     Sampleville or Fakenagar (halls), or is labelled exactly "Demo men's singles ranking (made up)" (the ranking);
--   * the points table is labelled "Demo points table (made up, dev only)".
-- Audit rows written by the admin functions stay: the audit log is append-only by design.
--
-- Dates are worked out from today's date in India when it runs: one tournament ended two weeks ago (every result in and confirmed,
-- the ranking comes from it), one starts in ten days (draws out, order of play set, nothing played yet), and one School/college
-- tournament in three weeks (draw out; everyone in it is shown as "Protected player").
--
-- No psql commands (it pastes into the SQL editor as it is), no secrets, no role change.

begin;

do $demo$
declare
  -- >>> CHANGE THIS ONE LINE before Run: the DEVELOPMENT project's reference (never the live project's). <<<
  c_development_project_ref constant text := 'PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE';
  c_reason constant text := 'Demo data (made up) for the private preview';
  c_ranking_label constant text := 'Demo men''s singles ranking (made up)';
  c_demo_cities constant text[] := array['Sampleville', 'Fakenagar'];
  c_prefix constant text := 'de000000-0000-4000-8000-';
  c_points_label constant text := 'Demo points table (made up, dev only)';
  v_owner text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_spec jsonb;
  v_ids jsonb := '{}'::jsonb;
  v_rankings_before boolean;
  v_points jsonb;
  t jsonb;
  pl jsonb;
  ev jsonb;
  en jsonb;
  mt jsonb;
  rs jsonb;
  v_tid uuid;
  v_start date;
  v_event uuid;
  v_draw uuid;
  v_match uuid;
  v_rev integer;
  v_res jsonb;
  v_record jsonb;
  v_players jsonb;
  v_slots jsonb;
  v_games jsonb;
  v_adults uuid[];
  v_pid uuid;
  v_rows jsonb;
  v_snapshot uuid;
  v_n integer;
begin
  -- ---------------------------------------------------------------------------------------------- refuse when it cannot run safely
  -- Fail closed: the owner must say on purpose which project this is (the development one). Nothing in the database can tell the
  -- development project from the live one today, so the reference typed above is the deliberate step; it goes into the audit row.
  if c_development_project_ref = 'PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE' or c_development_project_ref !~ '^[a-z0-9]{8,40}$' then
    raise exception 'DEMO: this does not look like the development project: the line c_development_project_ref at the top still holds the placeholder (or not a project reference). Put the DEVELOPMENT project''s reference there (the short code in its web address), then run it again. Never run this on the live project. Nothing was added.';
  end if;
  select p.id::text into v_owner from public.profiles p where p.role = 'owner' limit 1;
  if v_owner is null then
    raise exception 'DEMO: no owner account found (public.profiles has no row with role owner). Finish the owner sign-in set-up first (OT-51), then run this again. Nothing was added.';
  end if;
  if exists (select 1 from public.tournaments x where x.id::text like c_prefix || '%' or x.slug like 'demo-%')
     or exists (select 1 from public.players x where x.id::text like c_prefix || '%')
     or exists (select 1 from public.venues x where x.name like 'Demo %' and x.city = any (c_demo_cities))
     or exists (select 1 from public.ranking_snapshots x where x.label = c_ranking_label) then
    raise exception 'DEMO: the made-up competition data (or part of it) is already in this database. Nothing was added. To start again, run supabase/demo/competition-demo-remove.sql first, then this file.';
  end if;
  if exists (select 1 from public.competition_settings s where s.id = 1 and s.ranking_points_table is not null
              and s.ranking_points_table ->> 'label' is distinct from c_points_label) then
    raise exception 'DEMO: a ranking points table is already approved in this database; the demo would replace it. Nothing was added.';
  end if;
  select s.rankings_public into v_rankings_before from public.competition_settings s where s.id = 1;

  -- ---------------------------------------------------------------------------------------------- the made-up data, in one place
  -- Tournament and player ids: c_prefix || lpad(suffix, 12, '0'). Day offsets are from today (India). Match "day" counts from the
  -- tournament's first day; "at" is India time. A result: s = status, g = games [side A points, side B points], w = the side that
  -- received a walkover, r = the side that retired.
  v_spec := $spec$
  {
    "tournaments": [
      {"suffix": "101", "slug": "demo-lakeside-open", "name": "Demo Lakeside Open", "series": "demo lakeside open", "level": "district",
       "minor": false, "city": "Sampleville", "venue": "Demo Lakeside Indoor Hall", "startOffset": -15, "days": 2, "status": "completed",
       "categories": ["MS", "XD", "BS"], "ageGroups": ["U15"]},
      {"suffix": "102", "slug": "demo-riverside-championship", "name": "Demo Riverside Championship", "series": "demo riverside championship",
       "level": "district", "minor": false, "city": "Fakenagar", "venue": "Demo Riverside Sports Centre", "startOffset": 10, "days": 2,
       "status": "published", "categories": ["MS", "WS"], "ageGroups": []},
      {"suffix": "103", "slug": "demo-schools-cup", "name": "Demo Schools Cup", "series": "demo schools cup", "level": "school_college",
       "minor": true, "city": "Sampleville", "venue": "Demo Sample School Gym", "startOffset": 20, "days": 1, "status": "published",
       "categories": ["MS"], "ageGroups": []}
    ],
    "players": [
      {"suffix": "201", "name": "Demo Arun Fakeson", "age": "adult"},
      {"suffix": "202", "name": "Demo Bala Samplekumar", "age": "adult"},
      {"suffix": "203", "name": "Demo Charan Mockraj", "age": "adult"},
      {"suffix": "204", "name": "Demo Dinesh Placeholder", "age": "adult"},
      {"suffix": "205", "name": "Demo Ezhil Testmani", "age": "adult"},
      {"suffix": "206", "name": "Demo Farhan Dummyvel", "age": "adult"},
      {"suffix": "207", "name": "Demo Gokul Notreal", "age": "adult"},
      {"suffix": "208", "name": "Demo Hari Pretendan", "age": "unknown"},
      {"suffix": "211", "name": "Demo Indu Fakeson", "age": "adult"},
      {"suffix": "212", "name": "Demo Janani Samplerani", "age": "adult"},
      {"suffix": "213", "name": "Demo Kavya Mockdevi", "age": "adult"},
      {"suffix": "214", "name": "Demo Latha Invented", "age": "adult"},
      {"suffix": "215", "name": "Demo Meena Makebelieve", "age": "minor_suspected"},
      {"suffix": "216", "name": "Demo Nila Fictional", "age": "unknown"},
      {"suffix": "221", "name": "Demo Pranav Kidsample", "age": "unknown"},
      {"suffix": "222", "name": "Demo Rahul Kidmock", "age": "unknown"},
      {"suffix": "223", "name": "Demo Surya Kidfake", "age": "unknown"},
      {"suffix": "224", "name": "Demo Tarun Kidtest", "age": "unknown"}
    ],
    "venues": [
      {"key": "v1", "name": "Demo Lakeside Indoor Hall", "city": "Sampleville"},
      {"key": "v2", "name": "Demo Riverside Sports Centre", "city": "Fakenagar"},
      {"key": "v3", "name": "Demo Sample School Gym", "city": "Sampleville"}
    ],
    "courts": [
      {"key": "t1c1", "t": "101", "v": "v1", "label": "Court 1", "sort": 1},
      {"key": "t1c2", "t": "101", "v": "v1", "label": "Court 2", "sort": 2},
      {"key": "t2c1", "t": "102", "v": "v2", "label": "Court 1", "sort": 1},
      {"key": "t2c2", "t": "102", "v": "v2", "label": "Court 2", "sort": 2},
      {"key": "t2c3", "t": "102", "v": "v2", "label": "Court 3", "sort": 3},
      {"key": "t3c1", "t": "103", "v": "v3", "label": "Court 1", "sort": 1}
    ],
    "events": [
      {"key": "e1", "t": "101", "category": "MS", "ageGroup": null, "format": "knockout", "capacity": 8, "drawSeed": 4021, "close": true,
       "entries": [
         {"key": "a", "players": ["201"], "seed": 1}, {"key": "b", "players": ["202"], "seed": 2},
         {"key": "c", "players": ["203"], "seed": 3}, {"key": "d", "players": ["204"], "seed": 4},
         {"key": "e", "players": ["205"]}, {"key": "f", "players": ["206"]}, {"key": "g", "players": ["207"]}, {"key": "h", "players": ["208"]}],
       "slots": ["a", "h", "e", "d", "c", "f", "g", "b"],
       "matches": [
         {"n": 1, "round": "QF", "a": "a", "b": "h", "day": 0, "at": "09:00", "court": "t1c1", "result": {"s": "completed", "g": [[21, 15], [21, 12]]}},
         {"n": 2, "round": "QF", "a": "e", "b": "d", "day": 0, "at": "09:00", "court": "t1c2", "result": {"s": "completed", "g": [[18, 21], [21, 17], [19, 21]]}},
         {"n": 3, "round": "QF", "a": "c", "b": "f", "day": 0, "at": "09:45", "court": "t1c1", "result": {"s": "walkover", "w": "A"}},
         {"n": 4, "round": "QF", "a": "g", "b": "b", "day": 0, "at": "09:45", "court": "t1c2", "result": {"s": "completed", "g": [[9, 21], [14, 21]]}},
         {"n": 5, "round": "SF", "a": "a", "b": "d", "day": 1, "at": "10:00", "court": "t1c1", "result": {"s": "retired", "g": [[21, 18], [11, 6]], "r": "B"}},
         {"n": 6, "round": "SF", "a": "c", "b": "b", "day": 1, "at": "10:00", "court": "t1c2", "result": {"s": "completed", "g": [[19, 21], [21, 16], [22, 24]]}},
         {"n": 7, "round": "F", "a": "a", "b": "b", "day": 1, "at": "16:00", "court": "t1c1", "result": {"s": "completed", "g": [[21, 17], [21, 19]]}}]},
      {"key": "e2", "t": "101", "category": "XD", "ageGroup": null, "format": "knockout", "capacity": 4, "drawSeed": 4022, "close": true,
       "entries": [
         {"key": "a", "players": ["201", "211"], "seed": 1}, {"key": "b", "players": ["202", "212"], "seed": 2},
         {"key": "c", "players": ["203", "213"]}, {"key": "d", "players": ["204", "215"]}],
       "slots": ["a", "d", "c", "b"],
       "matches": [
         {"n": 1, "round": "SF", "a": "a", "b": "d", "day": 0, "at": "11:00", "court": "t1c1", "result": {"s": "completed", "g": [[21, 11], [21, 13]]}},
         {"n": 2, "round": "SF", "a": "c", "b": "b", "day": 0, "at": "11:00", "court": "t1c2", "result": {"s": "completed", "g": [[19, 21], [21, 17], [15, 21]]}},
         {"n": 3, "round": "F", "a": "a", "b": "b", "day": 1, "at": "14:00", "court": "t1c1", "result": {"s": "completed", "g": [[21, 16], [21, 18]]}}]},
      {"key": "e3", "t": "101", "category": "BS", "ageGroup": "U15", "format": "knockout", "capacity": 4, "drawSeed": 4023, "close": true,
       "entries": [
         {"key": "a", "players": ["221"], "seed": 1}, {"key": "b", "players": ["222"], "seed": 2},
         {"key": "c", "players": ["223"]}, {"key": "d", "players": ["224"]}],
       "slots": ["a", "d", "c", "b"],
       "matches": [
         {"n": 1, "round": "SF", "a": "a", "b": "d", "day": 0, "at": "12:00", "court": "t1c1", "result": {"s": "completed", "g": [[21, 10], [21, 14]]}},
         {"n": 2, "round": "SF", "a": "c", "b": "b", "day": 0, "at": "12:00", "court": "t1c2", "result": {"s": "completed", "g": [[21, 19], [21, 18]]}},
         {"n": 3, "round": "F", "a": "a", "b": "c", "day": 1, "at": "12:00", "court": "t1c1", "result": {"s": "completed", "g": [[21, 15], [18, 21], [21, 16]]}}]},
      {"key": "e4", "t": "102", "category": "MS", "ageGroup": null, "format": "knockout", "capacity": 8, "drawSeed": 5101, "close": false,
       "entries": [
         {"key": "a", "players": ["201"], "seed": 1}, {"key": "b", "players": ["202"], "seed": 2},
         {"key": "c", "players": ["203"], "seed": 3}, {"key": "d", "players": ["204"], "seed": 4},
         {"key": "e", "players": ["205"]}, {"key": "f", "players": ["206"]}],
       "slots": ["a", null, "e", "d", "c", "f", null, "b"],
       "matches": [
         {"n": 1, "round": "QF", "a": "e", "b": "d", "day": 0, "at": "09:00", "court": "t2c1"},
         {"n": 2, "round": "QF", "a": "c", "b": "f", "day": 0, "at": "09:00", "court": "t2c2"},
         {"n": 3, "round": "SF", "a": "a", "b": null, "day": 0, "at": "15:00", "court": "t2c1"},
         {"n": 4, "round": "SF", "a": null, "b": "b", "day": 0, "at": "15:00", "court": "t2c2"},
         {"n": 5, "round": "F", "a": null, "b": null, "day": 1, "at": "17:00", "court": "t2c1"}]},
      {"key": "e5", "t": "102", "category": "WS", "ageGroup": null, "format": "round_robin", "capacity": 4, "drawSeed": 5102, "close": false,
       "entries": [
         {"key": "a", "players": ["212"]}, {"key": "b", "players": ["213"]}, {"key": "c", "players": ["214"]}, {"key": "d", "players": ["216"]}],
       "slots": ["a", "b", "c", "d"],
       "matches": [
         {"n": 1, "round": "league", "a": "a", "b": "b", "day": 0, "at": "10:00", "court": "t2c3"},
         {"n": 2, "round": "league", "a": "c", "b": "d", "day": 0, "at": "10:00", "court": "t2c2"},
         {"n": 3, "round": "league", "a": "a", "b": "c", "day": 0, "at": "12:00", "court": "t2c3"},
         {"n": 4, "round": "league", "a": "b", "b": "d", "day": 0, "at": "12:00", "court": "t2c2"},
         {"n": 5, "round": "league", "a": "a", "b": "d", "day": 1, "at": "10:00", "court": "t2c3"},
         {"n": 6, "round": "league", "a": "b", "b": "c", "day": 1, "at": "10:00", "court": "t2c2"}]},
      {"key": "e6", "t": "103", "category": "MS", "ageGroup": null, "format": "knockout", "capacity": 4, "drawSeed": 5103, "close": false,
       "entries": [
         {"key": "a", "players": ["205"], "seed": 1}, {"key": "b", "players": ["206"], "seed": 2},
         {"key": "c", "players": ["207"]}, {"key": "d", "players": ["221"]}],
       "slots": ["a", "d", "c", "b"],
       "matches": [
         {"n": 1, "round": "SF", "a": "a", "b": "d", "day": 0, "at": "10:00", "court": "t3c1"},
         {"n": 2, "round": "SF", "a": "c", "b": "b", "day": 0, "at": "11:00", "court": "t3c1"},
         {"n": 3, "round": "F", "a": null, "b": null, "day": 0, "at": "15:00", "court": "t3c1"}]}
    ],
    "points": {"label": "Demo points table (made up, dev only)", "levels": {"district": {"W": 200, "F": 140, "SF": 100, "QF": 60, "R16": 30}},
               "windowDays": 364, "bestN": 4},
    "ranking": {"event": "e1", "label": "Demo men's singles ranking (made up)", "category": "MS"}
  }
  $spec$::jsonb;

  -- ---------------------------------------------------------------------------------------------- tournaments (plain inserts)
  for t in select value from jsonb_array_elements(v_spec -> 'tournaments') loop
    v_start := v_today + (t ->> 'startOffset')::integer;
    insert into public.tournaments (id, slug, name, series_key, edition_year, level, region, city, venue, start_date, end_date,
                                    categories, age_groups, status, source, visibility, is_minor_signal)
      values ((c_prefix || lpad(t ->> 'suffix', 12, '0'))::uuid, t ->> 'slug', t ->> 'name', t ->> 'series',
              extract(year from v_start)::smallint, t ->> 'level', 'tamil_nadu', t ->> 'city', t ->> 'venue',
              v_start, v_start + (t ->> 'days')::integer - 1,
              array(select jsonb_array_elements_text(t -> 'categories')), array(select jsonb_array_elements_text(t -> 'ageGroups')),
              t ->> 'status', 'admin', 'public', (t ->> 'minor')::boolean);
  end loop;

  -- ---------------------------------------------------------------------------------------------- players
  -- Inserted unconfirmed (a player can never be created as adult_confirmed outside an admin action, D-012); the adults are then
  -- confirmed and made public through the owner's own admin functions, exactly as the Players screen does it.
  v_adults := '{}';
  for pl in select value from jsonb_array_elements(v_spec -> 'players') loop
    v_pid := (c_prefix || lpad(pl ->> 'suffix', 12, '0'))::uuid;
    insert into public.players (id, display_name, name_normalized, identity_tier, age_status, is_provisional, created_source)
      values (v_pid, pl ->> 'name', lower(pl ->> 'name'), 'multi_token',
              case pl ->> 'age' when 'minor_suspected' then 'minor_suspected' else 'unknown' end, false, 'admin');
    if pl ->> 'age' = 'adult' then v_adults := v_adults || v_pid; end if;
  end loop;
  perform public.admin_set_age_status(v_owner, v_adults, 'adult_confirmed', 'Made-up demo player for the dev preview (fictional, not a real person)', c_reason);
  foreach v_pid in array v_adults loop
    perform public.admin_update_player(v_owner, v_pid, '{"visibility": "public"}'::jsonb, c_reason);
  end loop;

  -- ---------------------------------------------------------------------------------------------- halls and courts
  for t in select value from jsonb_array_elements(v_spec -> 'venues') loop
    v_res := public.admin_save_venue(v_owner, null, jsonb_build_object('name', t ->> 'name', 'city', t ->> 'city'), c_reason);
    v_ids := v_ids || jsonb_build_object(t ->> 'key', v_res ->> 'id');
  end loop;
  for t in select value from jsonb_array_elements(v_spec -> 'courts') loop
    v_res := public.admin_save_court(v_owner, null, jsonb_build_object(
      'tournamentId', c_prefix || lpad(t ->> 't', 12, '0'), 'venueId', v_ids ->> (t ->> 'v'), 'label', t ->> 'label', 'sort', t -> 'sort'), c_reason);
    v_ids := v_ids || jsonb_build_object(t ->> 'key', v_res ->> 'id');
  end loop;

  -- ---------------------------------------------------------------------------------------------- events, entries, draws, matches
  for ev in select value from jsonb_array_elements(v_spec -> 'events') loop
    v_tid := (c_prefix || lpad(ev ->> 't', 12, '0'))::uuid;
    select x.start_date into v_start from public.tournaments x where x.id = v_tid;
    v_record := jsonb_build_object('tournamentId', v_tid, 'category', ev ->> 'category', 'ageGroup', ev -> 'ageGroup', 'format', ev ->> 'format',
      'ruleset', app.competition_default_ruleset(), 'capacity', ev -> 'capacity', 'status', 'open');
    v_event := (public.admin_save_event(v_owner, null, v_record, c_reason) ->> 'id')::uuid;
    v_ids := v_ids || jsonb_build_object(ev ->> 'key', v_event);

    -- entries (confirmed, with their seeds)
    for en in select value from jsonb_array_elements(ev -> 'entries') loop
      select jsonb_agg(c_prefix || lpad(p.s, 12, '0') order by p.o) into v_players
        from jsonb_array_elements_text(en -> 'players') with ordinality as p(s, o);
      v_res := public.admin_add_entry(v_owner, v_event, jsonb_build_object('players', v_players, 'seed', en -> 'seed', 'status', 'confirmed'), c_reason);
      v_ids := v_ids || jsonb_build_object((ev ->> 'key') || ':' || (en ->> 'key'), v_res ->> 'id');
    end loop;

    -- the draw with its recorded random seed number, then published (immutable from now on)
    select jsonb_agg(jsonb_build_object('position', s.o,
             'entryId', case when jsonb_typeof(s.v) = 'null' then null else v_ids -> ((ev ->> 'key') || ':' || (s.v #>> '{}')) end,
             'group', null) order by s.o)
      into v_slots
      from jsonb_array_elements(ev -> 'slots') with ordinality as s(v, o);
    v_draw := (public.admin_save_draw(v_owner, v_event, jsonb_build_object('seed', ev -> 'drawSeed', 'slots', v_slots), c_reason) ->> 'id')::uuid;
    perform public.admin_publish_draw(v_owner, v_draw, c_reason);

    -- the order of play; a match with a result is recorded and confirmed before the next round is made (winners advance)
    for mt in select value from jsonb_array_elements(ev -> 'matches') loop
      v_res := public.admin_save_match(v_owner, null, jsonb_build_object(
        'eventId', v_event,
        'roundCode', mt ->> 'round',
        'matchNumber', mt -> 'n',
        'groupLabel', null,
        'sideA', case when mt ->> 'a' is null then null else v_ids -> ((ev ->> 'key') || ':' || (mt ->> 'a')) end,
        'sideB', case when mt ->> 'b' is null then null else v_ids -> ((ev ->> 'key') || ':' || (mt ->> 'b')) end,
        'scheduledAt', to_char(v_start + (mt ->> 'day')::integer, 'YYYY-MM-DD') || 'T' || (mt ->> 'at') || ':00+05:30',
        'courtId', v_ids -> (mt ->> 'court')), null, c_reason);
      v_match := (v_res ->> 'id')::uuid;
      v_rev := (v_res ->> 'revision')::integer;
      if mt ? 'result' then
        rs := mt -> 'result';
        select coalesce(jsonb_agg(jsonb_build_object('a', g.v -> 0, 'b', g.v -> 1) order by g.o), '[]'::jsonb) into v_games
          from jsonb_array_elements(coalesce(rs -> 'g', '[]'::jsonb)) with ordinality as g(v, o);
        v_res := public.admin_record_result(v_owner, v_match, jsonb_build_object(
          'status', rs ->> 's', 'games', v_games, 'walkoverWinner', rs -> 'w', 'retiringSide', rs -> 'r'), v_rev, c_reason);
        perform public.admin_confirm_result(v_owner, v_match, (v_res ->> 'revision')::integer, c_reason);
      end if;
    end loop;

    -- a finished event is closed to new entries
    if (ev ->> 'close')::boolean then
      perform public.admin_save_event(v_owner, v_event, v_record || jsonb_build_object('status', 'closed'), c_reason);
    end if;
  end loop;

  -- ---------------------------------------------------------------------------------------------- local ranking (unofficial)
  -- The owner approves the made-up points table, then the ranking is worked out from the CONFIRMED results of the finished men's
  -- singles: the winner of the final 'W', everyone else the round they lost in. Only players the site may name are ranked (the admin
  -- does the same, D-109), so the protected player of that draw is left out and the ranks have no gap; equal points share a rank.
  perform public.admin_set_ranking_points(v_owner, v_spec -> 'points', c_reason);
  select s.ranking_points_table into v_points from public.competition_settings s where s.id = 1;
  v_event := (v_ids ->> (v_spec -> 'ranking' ->> 'event'))::uuid;
  with res as (
    select m.round_code, m.winner_side, m.side_a_entry, m.side_b_entry
    from public.competition_matches m
    where m.event_id = v_event and m.confirmed and m.winner_side is not null
  ), fin as (
    select case r.winner_side when 'A' then r.side_b_entry else r.side_a_entry end as entry_id, r.round_code as finish from res r
    union all
    select case r.winner_side when 'A' then r.side_a_entry else r.side_b_entry end, 'W' from res r where r.round_code = 'F'
  ), pts as (
    select en.player1_id as player_id, coalesce((v_points -> 'levels' -> tt.level ->> f.finish)::integer, 0) as points
    from fin f
    join public.event_entries en on en.id = f.entry_id
    join public.tournament_events e on e.id = en.event_id
    join public.tournaments tt on tt.id = e.tournament_id
    where exists (select 1 from app.competition_named_players np where np.id = en.player1_id)
  )
  select jsonb_agg(jsonb_build_object('playerId', x.player_id, 'rank', x.rnk, 'points', x.points, 'eventsCounted', 1) order by x.rnk, x.player_id)
    into v_rows
    from (select p.player_id, p.points, rank() over (order by p.points desc) as rnk from pts p) x;
  v_res := public.admin_save_ranking_snapshot(v_owner, jsonb_build_object(
    'label', c_ranking_label, 'category', v_spec -> 'ranking' ->> 'category', 'ageGroup', null,
    'asOf', to_char((select x.end_date from public.tournaments x join public.tournament_events e on e.tournament_id = x.id where e.id = v_event), 'YYYY-MM-DD'),
    'entries', v_rows), c_reason);
  v_snapshot := (v_res ->> 'id')::uuid;
  perform public.admin_publish_ranking_snapshot(v_owner, v_snapshot, c_reason);

  -- DEV ONLY: show published rankings. The value found before is kept in the audit log for the removal script.
  perform app.audit(v_owner, 'demo_competition_seed', 'competition_settings', '1',
    jsonb_build_object('rankings_public_before', coalesce(v_rankings_before, false), 'project_ref', c_development_project_ref, 'tournaments', 3, 'players', jsonb_array_length(v_spec -> 'players')),
    c_reason);
  update public.competition_settings set rankings_public = true where id = 1 and not rankings_public;
  perform app.mark_dirty('demo competition data', false);

  -- ---------------------------------------------------------------------------------------------- the public views now show it
  select count(*) into v_n from api.public_tournaments x where x.id::text like c_prefix || '%';
  if v_n <> 3 then raise exception 'DEMO: expected 3 public demo tournaments, found %. Nothing was added.', v_n; end if;
  select count(*) into v_n from api.public_competition_events x where x.tournament_id::text like c_prefix || '%';
  if v_n <> 6 then raise exception 'DEMO: expected 6 public demo events, found %. Nothing was added.', v_n; end if;
  select count(*) into v_n from api.public_competition_matches x join api.public_competition_events e on e.id = x.event_id where e.tournament_id::text like c_prefix || '%';
  if v_n <> 27 then raise exception 'DEMO: expected 27 public demo matches, found %. Nothing was added.', v_n; end if;
  select count(*) into v_n from api.public_competition_rankings x where x.snapshot_id = v_snapshot;
  if v_n <> 7 then raise exception 'DEMO: expected 7 public ranking rows, found %. Nothing was added.', v_n; end if;

  raise notice 'DEMO: added 3 made-up tournaments, 18 made-up players, 6 events, 27 matches and 1 ranking. Remove them with supabase/demo/competition-demo-remove.sql.';
end
$demo$;

commit;
