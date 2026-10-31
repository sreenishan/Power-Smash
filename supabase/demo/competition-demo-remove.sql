-- supabase/demo/competition-demo-remove.sql: takes away the MADE-UP competition data that supabase/demo/competition-demo.sql added to
-- the DEVELOPMENT Supabase project, and nothing else.
--
-- How to use (owner, phone or PC): Supabase dashboard, the DEVELOPMENT project, SQL Editor, New query, paste this whole file ONCE, Run.
-- It is one transaction: either all the demo data goes or nothing changes. When there is no demo data (a second run, or a paste into
-- the wrong project) it changes NOTHING at all: no setting, no audit row, no rebuild flag; it only says so.
--
-- What it removes: the demo tournaments and players (fixed ids starting de000000-0000-4000-8000-, names starting "Demo "), every
-- event, entry, draw, match, game and court of a demo tournament, the "Demo ..." halls in Sampleville or Fakenagar that only demo
-- courts use, the ranking labelled exactly "Demo men's singles ranking (made up)", and the "Demo points table (made up, dev only)".
-- Only when it removed demo tournaments or the demo ranking does it put competition_settings.rankings_public back to the value the
-- seed found, read from the newest seed audit row that is newer than the last removal; with no such row it leaves the switch alone.
--
-- It REFUSES, with a message and without changing anything, when removing the demo data would touch or break something that is
-- not demo data: a real player entered in a demo event, a demo player in a real event or ranking, a real court in a demo hall, a demo
-- row with a name that is not "Demo ...", or ANY other row that points at a demo row (for example a registration, an organizer
-- assignment, organizer contact details, a live-scoring log, an archive match or alias). Those are the owner's to sort out first.
--
-- Published draws, confirmed results and published rankings are immutable by design (their guard triggers refuse every change). To
-- delete the demo ones, this script switches off exactly those six guard triggers INSIDE this transaction, deletes only the demo
-- rows, and switches them back on before it ends (it checks that they are on again). If anything fails, the whole transaction is
-- rolled back, the triggers included. No constraint is changed and no other trigger is touched.
-- Audit rows stay: the audit log is append-only by design (one more row records this removal, with counts only).
--
-- No psql commands, no secrets, no role change.

begin;

do $remove$
declare
  c_prefix constant text := 'de000000-0000-4000-8000-';
  c_points_label constant text := 'Demo points table (made up, dev only)';
  c_ranking_label constant text := 'Demo men''s singles ranking (made up)';
  c_demo_cities constant text[] := array['Sampleville', 'Fakenagar'];
  c_guards constant text[][] := array[
    ['public.draws', 'draws_guard'],
    ['public.draw_slots', 'draw_slots_guard'],
    ['public.competition_matches', 'competition_matches_guard'],
    ['public.match_games', 'match_games_guard'],
    ['public.ranking_snapshots', 'ranking_snapshots_guard'],
    ['public.ranking_entries', 'ranking_entries_guard']];
  -- tables whose demo rows this script deletes itself (every other table that points at a demo row makes it refuse)
  c_handled constant regclass[] := array[
    'public.players', 'public.tournament_events', 'public.event_entries', 'public.event_entry_players', 'public.draws', 'public.draw_slots',
    'public.competition_matches', 'public.match_games', 'public.courts', 'public.ranking_entries']::regclass[];
  v_t uuid[];
  v_p uuid[];
  v_e uuid[];
  v_en uuid[];
  v_d uuid[];
  v_m uuid[];
  v_c uuid[];
  v_v uuid[];
  v_s uuid[];
  v_target uuid[];
  v_problems text[] := '{}';
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_owner text;
  v_before boolean;
  v_last_remove bigint;
  v_points_demo boolean;
  fk record;
  i integer;
begin
  -- ---------------------------------------------------------------------------------------------- what the demo rows are
  select coalesce(array_agg(x.id), '{}') into v_t from public.tournaments x where x.id::text like c_prefix || '%';
  select coalesce(array_agg(x.id), '{}') into v_p from public.players x where x.id::text like c_prefix || '%';
  select coalesce(array_agg(x.id), '{}') into v_e from public.tournament_events x where x.tournament_id = any (v_t);
  select coalesce(array_agg(x.id), '{}') into v_en from public.event_entries x where x.event_id = any (v_e);
  select coalesce(array_agg(x.id), '{}') into v_d from public.draws x where x.event_id = any (v_e);
  select coalesce(array_agg(x.id), '{}') into v_m from public.competition_matches x where x.event_id = any (v_e);
  select coalesce(array_agg(x.id), '{}') into v_c from public.courts x where x.tournament_id = any (v_t);
  select coalesce(array_agg(x.id), '{}') into v_v from public.venues x where x.name like 'Demo %' and x.city = any (c_demo_cities);
  select coalesce(array_agg(x.id), '{}') into v_s from public.ranking_snapshots x where x.label = c_ranking_label;
  v_points_demo := exists (select 1 from public.competition_settings s where s.id = 1 and s.ranking_points_table ->> 'label' = c_points_label);

  -- nothing demo-shaped here (a second run, or the wrong project): change nothing at all
  if cardinality(v_t) = 0 and cardinality(v_p) = 0 and cardinality(v_v) = 0 and cardinality(v_s) = 0 and not v_points_demo then
    raise notice 'DEMO: no made-up competition data found in this database; nothing was changed.';
    return;
  end if;

  -- ---------------------------------------------------------------------------------------------- refuse anything that is not demo data
  if exists (select 1 from public.tournaments x where x.id = any (v_t) and (x.slug not like 'demo-%' or x.name not like 'Demo %')) then
    v_problems := v_problems || 'a tournament with a demo id has a name or address that does not start with Demo';
  end if;
  if exists (select 1 from public.players x where x.id = any (v_p) and x.display_name not like 'Demo %') then
    v_problems := v_problems || 'a player with a demo id has a name that does not start with Demo';
  end if;
  if exists (select 1 from public.event_entries x where x.id = any (v_en)
              and (not x.player1_id = any (v_p) or (x.player2_id is not null and not x.player2_id = any (v_p)))) then
    v_problems := v_problems || 'a real (non-demo) player is entered in a demo event';
  end if;
  if exists (select 1 from public.event_entries x where not x.event_id = any (v_e)
              and (x.player1_id = any (v_p) or x.player2_id = any (v_p))) then
    v_problems := v_problems || 'a demo player is entered in a real (non-demo) event';
  end if;
  if exists (select 1 from public.ranking_entries x where x.snapshot_id = any (v_s) and not x.player_id = any (v_p)) then
    v_problems := v_problems || 'a "Demo" ranking holds a real (non-demo) player';
  end if;
  if exists (select 1 from public.ranking_entries x where not x.snapshot_id = any (v_s) and x.player_id = any (v_p)) then
    v_problems := v_problems || 'a demo player is in a real (non-demo) ranking';
  end if;
  if exists (select 1 from public.courts x where x.venue_id = any (v_v) and not x.id = any (v_c)) then
    v_problems := v_problems || 'a court of a real (non-demo) tournament uses a "Demo" hall';
  end if;
  if exists (select 1 from public.players x where not x.id = any (v_p) and (x.merged_into = any (v_p) or x.provisional_tournament_id = any (v_t))) then
    v_problems := v_problems || 'a real (non-demo) player points at a demo player or tournament';
  end if;
  -- every other table that points at a demo row (found from the database's own foreign keys, so a later table is covered too)
  for fk in
    select c.conrelid::regclass as src, a.attname as col, c.confrelid::regclass as dst
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and cardinality(c.conkey) = 1
      and c.confrelid = any (array['public.tournaments', 'public.players', 'public.tournament_events', 'public.event_entries', 'public.draws',
                                   'public.competition_matches', 'public.courts', 'public.venues', 'public.ranking_snapshots']::regclass[])
      and not c.conrelid = any (c_handled)
    order by 1, 2
  loop
    v_target := case fk.dst
      when 'public.tournaments'::regclass then v_t
      when 'public.players'::regclass then v_p
      when 'public.tournament_events'::regclass then v_e
      when 'public.event_entries'::regclass then v_en
      when 'public.draws'::regclass then v_d
      when 'public.competition_matches'::regclass then v_m
      when 'public.courts'::regclass then v_c
      when 'public.venues'::regclass then v_v
      when 'public.ranking_snapshots'::regclass then v_s
    end;
    if cardinality(v_target) > 0 then
      execute format('select count(*) from %s where %I = any ($1)', fk.src, fk.col) into v_n using v_target;
      if v_n > 0 then
        v_problems := v_problems || format('%s row(s) of %s point at demo rows (%s)', v_n, fk.src, fk.col);
      end if;
    end if;
  end loop;
  if cardinality(v_problems) > 0 then
    raise exception 'DEMO: nothing was removed, because removing the demo data would touch something that is not demo data: %. Sort that out first (or ask for help), then run this again.',
      array_to_string(v_problems, '; ');
  end if;

  -- ---------------------------------------------------------------------------------------------- delete (guards off for this transaction only)
  for i in 1 .. array_length(c_guards, 1) loop
    execute format('alter table %s disable trigger %I', c_guards[i][1], c_guards[i][2]);
  end loop;

  delete from public.match_games x where x.match_id = any (v_m);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('match_games', v_n);
  delete from public.competition_matches x where x.id = any (v_m);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('matches', v_n);
  delete from public.draw_slots x where x.draw_id = any (v_d);
  delete from public.draws x where x.id = any (v_d);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('draws', v_n);
  delete from public.event_entry_players x where x.event_id = any (v_e);
  delete from public.event_entries x where x.id = any (v_en);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('entries', v_n);
  delete from public.tournament_events x where x.id = any (v_e);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('events', v_n);
  delete from public.courts x where x.id = any (v_c);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('courts', v_n);
  delete from public.venues x where x.id = any (v_v);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('venues', v_n);
  delete from public.ranking_entries x where x.snapshot_id = any (v_s);
  delete from public.ranking_snapshots x where x.id = any (v_s);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('rankings', v_n);
  delete from public.players x where x.id = any (v_p);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('players', v_n);
  delete from public.tournaments x where x.id = any (v_t);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tournaments', v_n);

  for i in 1 .. array_length(c_guards, 1) loop
    execute format('alter table %s enable trigger %I', c_guards[i][1], c_guards[i][2]);
  end loop;
  if exists (
    select 1 from unnest(c_guards[1:6][2:2]) as g(name)
    where not exists (select 1 from pg_trigger tr where tr.tgname = g.name and tr.tgenabled = 'O')) then
    raise exception 'DEMO: a guard trigger is not back on; nothing was removed.';
  end if;

  -- ---------------------------------------------------------------------------------------------- settings back as they were
  -- Only when this run removed the demo tournaments or the demo ranking (the seed switched rankings on for those), and only from a
  -- seed audit row newer than the last removal (an older one belongs to a seed that was already undone). No such row: left alone.
  if cardinality(v_t) > 0 or cardinality(v_s) > 0 then
    select max(a.id) into v_last_remove from public.audit_log a where a.action = 'demo_competition_remove';
    select (a.diff ->> 'rankings_public_before')::boolean into v_before
      from public.audit_log a
     where a.action = 'demo_competition_seed' and a.id > coalesce(v_last_remove, 0)
     order by a.id desc limit 1;
    if v_before is not null then
      update public.competition_settings set rankings_public = v_before where id = 1 and rankings_public is distinct from v_before;
    end if;
  end if;
  update public.competition_settings set ranking_points_table = null, ranking_points_approved_at = null, ranking_points_approved_by = null
   where id = 1 and ranking_points_table ->> 'label' = c_points_label;

  select p.id::text into v_owner from public.profiles p where p.role = 'owner' limit 1;
  perform app.audit(coalesce(v_owner, 'demo_removal'), 'demo_competition_remove', 'competition_settings', '1', v_counts,
    'Removed the made-up demo competition data');
  if (v_counts ->> 'tournaments')::integer > 0 or (v_counts ->> 'players')::integer > 0 then
    perform app.mark_dirty('demo competition data removed', false);
  end if;
  raise notice 'DEMO: removed %', v_counts;
end
$remove$;

commit;
