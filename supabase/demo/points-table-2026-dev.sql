-- supabase/demo/points-table-2026-dev.sql: the APPROVED local ranking points table (D-129) on the DEVELOPMENT Supabase project ONLY,
-- plus one made-up demo ranking worked out with it, so the private preview shows the owner's real points rules on the made-up results.
--
-- What it does, in one transaction:
--   1. Installs the points table the owner approved on 2026-10-31 (D-129: "Power Smash local ranking 2026", the last 364 days, best 6
--      results) through the owner's own function public.admin_set_ranking_points, with the REAL owner (profiles.role = 'owner') as
--      the actor, so the check and the audit row run exactly as in the admin. It replaces the "Demo points table (made up, dev only)".
--      This dev copy is for the preview only: on the LIVE project the owner enters the table in the admin (Competitions -> Rankings),
--      and that save is the formal approval.
--   2. Works out a NEW men's singles local ranking from the CONFIRMED demo results with the same rules as the admin
--      (src/lib/admin/competition/ranking.ts and src/lib/competition/stats/ranking.ts):
--        * the finish of each entry in each event: knockout = the round of the decided, confirmed match it lost ('F' for the final),
--          'W' for the winner of the final (an entry still in the draw has no finish yet); a league or group event counts only when
--          every one of its matches is confirmed, and then everyone in its draw gets 'league' (round robin) or 'group';
--        * only events of a published (not draft) draw in an approved tournament (published or completed), men's singles with no age
--          group; junior events, minor-signal and School/college tournaments are left out, and so is everyone who is not
--          adult_confirmed or not in app.competition_named_players (so the ranks have no gap);
--        * points = the table's points for the tournament's level and the finish (a missing finish = 0; a level with no row, such as
--          school_college, is not counted); the result's date is the tournament's last day (or its first when no last day is set);
--        * only results from the last 364 days up to today's date in India; one result per tournament (the best); the best 6 count;
--        * ties: more points, then the better best result, then the second best and so on (a missing result = 0), then the more
--          recent latest result; still equal = the same rank, and the next rank skips (1, 1, 3).
--      It assumes the matches were made by the admin from the draw, as the demo's are: the admin reads finishes through the bracket
--      (match number = bracket position), this file reads them from the match rows. So it REFUSES when a confirmed knockout result in
--      scope does not fit its draw: a round code that is not the bracket round of its match number, or a side that is not in the draw.
--      It does not replay the whole bracket (a result between the wrong two entries of the right round is not caught).
--   3. Saves it with admin_save_ranking_snapshot as "Demo men's singles ranking with the 2026 points table" and publishes it with
--      admin_publish_ranking_snapshot (published rankings are immutable).
--
-- Before it: supabase/demo/competition-demo.sql (the made-up data) must already be in the development project.
-- To take it away: supabase/demo/competition-demo-remove.sql removes this demo ranking together with the rest of the demo data. It
-- keeps the approved points table (it only clears the made-up "Demo points table").
--
-- How to use (owner, phone or PC): Supabase dashboard, the DEVELOPMENT project, SQL Editor, New query, paste this whole file ONCE.
-- Then, BEFORE Run, change the one line below that says PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE: put the development project's
-- reference there (the short code in that project's web address; it is not a secret). Until that line is changed the script refuses
-- and changes nothing. Then Run. Running it a second time refuses with a plain message and changes nothing.
--
-- About the project-reference line: nothing in the database can tell the development project from the live one, so the line only
-- proves the reference was typed on purpose (the same pattern as competition-demo.sql). What actually keeps this file off the live
-- project is the next refusals: it stops when the made-up demo tournaments are not there, and when a points table other than the
-- made-up demo one (or this exact approved one) is already stored.
--
-- No psql commands (it pastes into the SQL editor as it is), no secrets, no role change. Every person in the ranking is made up.

begin;

do $points$
declare
  -- >>> CHANGE THIS ONE LINE before Run: the DEVELOPMENT project's reference (never the live project's). <<<
  c_development_project_ref constant text := 'PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE';
  c_reason constant text := 'Approved local ranking points table (D-129) on the dev project, for the private preview';
  c_prefix constant text := 'de000000-0000-4000-8000-';
  c_demo_points_label constant text := 'Demo points table (made up, dev only)';
  c_ranking_label constant text := 'Demo men''s singles ranking with the 2026 points table';
  c_category constant text := 'MS';
  c_finishes constant text[] := array['W', 'F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', 'group', 'league'];
  -- the owner's table (D-129), exactly; the same as APPROVED_POINTS_TABLE_2026 in src/lib/competition/points-table-2026.ts
  c_table constant jsonb := $table$
  {
    "label": "Power Smash local ranking 2026",
    "levels": {
      "national":  {"W": 1000, "F": 700, "SF": 500, "QF": 350, "R16": 250, "R32": 150, "R64": 100, "R128": 50, "group": 50, "league": 50},
      "zonal":     {"W": 700, "F": 490, "SF": 350, "QF": 245, "R16": 175, "R32": 105, "R64": 70, "R128": 35, "group": 35, "league": 35},
      "state":     {"W": 500, "F": 350, "SF": 250, "QF": 175, "R16": 125, "R32": 75, "R64": 50, "R128": 25, "group": 25, "league": 25},
      "open":      {"W": 300, "F": 210, "SF": 150, "QF": 105, "R16": 75, "R32": 45, "R64": 30, "R128": 15, "group": 15, "league": 15},
      "district":  {"W": 200, "F": 140, "SF": 100, "QF": 70, "R16": 50, "R32": 30, "R64": 20, "R128": 10, "group": 10, "league": 10},
      "corporate": {"W": 150, "F": 105, "SF": 75, "QF": 53, "R16": 38, "R32": 23, "R64": 15, "R128": 8, "group": 8, "league": 8},
      "veterans":  {"W": 150, "F": 105, "SF": 75, "QF": 53, "R16": 38, "R32": 23, "R64": 15, "R128": 8, "group": 8, "league": 8},
      "other":     {"W": 100, "F": 70, "SF": 50, "QF": 35, "R16": 25, "R32": 15, "R64": 10, "R128": 5, "group": 5, "league": 5}
    },
    "windowDays": 364,
    "bestN": 6
  }
  $table$::jsonb;
  v_owner text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_current jsonb;
  v_points jsonb;
  v_window integer;
  v_best integer;
  v_rows jsonb;
  v_res jsonb;
  v_snapshot uuid;
  v_n integer;
  v_list text;
begin
  -- ---------------------------------------------------------------------------------------------- refuse when it cannot run safely
  -- Fail closed: the owner must say on purpose which project this is (the development one), as in competition-demo.sql.
  if c_development_project_ref = 'PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE' or c_development_project_ref !~ '^[a-z0-9]{8,40}$' then
    raise exception 'DEMO: this does not look like the development project: the line c_development_project_ref at the top still holds the placeholder (or not a project reference). Put the DEVELOPMENT project''s reference there (the short code in its web address), then run it again. Never run this on the live project. Nothing was changed.';
  end if;
  select p.id::text into v_owner from public.profiles p where p.role = 'owner' limit 1;
  if v_owner is null then
    raise exception 'DEMO: no owner account found (public.profiles has no row with role owner). Finish the owner sign-in set-up first (OT-51), then run this again. Nothing was changed.';
  end if;
  if exists (select 1 from public.ranking_snapshots x where x.label = c_ranking_label) then
    raise exception 'DEMO: the demo ranking with the 2026 points table is already in this database, so this file has already run. Nothing was changed. To start again, run supabase/demo/competition-demo-remove.sql, then supabase/demo/competition-demo.sql, then this file.';
  end if;
  if not exists (select 1 from public.tournaments x where x.id::text like c_prefix || '%' and x.slug like 'demo-%') then
    raise exception 'DEMO: the made-up competition data is not in this database. Run supabase/demo/competition-demo.sql first, then this file. Nothing was changed.';
  end if;
  select s.ranking_points_table into v_current from public.competition_settings s where s.id = 1;
  if v_current is not null and v_current is distinct from c_table and v_current ->> 'label' is distinct from c_demo_points_label then
    raise exception 'DEMO: a different ranking points table (not the made-up demo one) is already approved in this database; this file would replace it. Nothing was changed.';
  end if;

  -- ---------------------------------------------------------------------------------------------- 1. the approved table
  if v_current is distinct from c_table then
    perform public.admin_set_ranking_points(v_owner, c_table, c_reason);
  end if;
  select s.ranking_points_table into v_points from public.competition_settings s where s.id = 1;
  if v_points is distinct from c_table then
    raise exception 'DEMO: the points table was not stored as approved. Nothing was changed.';
  end if;
  v_window := (v_points ->> 'windowDays')::integer;
  v_best := (v_points ->> 'bestN')::integer;

  -- every confirmed knockout result in scope must fit its draw: the round of its match number (positions 1..n/2 are the first round,
  -- then n/4 more, ..., the final last; a third-place match is ignored, as in the admin) and both sides placed in the draw
  select count(*) into v_n
    from public.competition_matches m
    join public.tournament_events e on e.id = m.event_id and e.format = 'knockout' and e.category = c_category and e.age_group is null
    join public.tournaments t on t.id = e.tournament_id and t.status in ('published', 'completed')
    join public.draws d on d.event_id = e.id and d.status <> 'draft'
    cross join lateral (select count(*)::integer as n from public.draw_slots s where s.draw_id = d.id) z
   where m.confirmed and m.status in ('completed', 'walkover', 'retired') and m.winner_side is not null and m.round_code <> '3P'
     and (m.round_code is distinct from (
            select q.code from (values (2, 'F'), (4, 'SF'), (8, 'QF'), (16, 'R16'), (32, 'R32'), (64, 'R64'), (128, 'R128')) as q(p, code)
             where q.p <= z.n and z.n - q.p < m.match_number and m.match_number <= z.n - q.p / 2)
          or exists (select 1 from (values (m.side_a_entry), (m.side_b_entry)) as x(entry_id)
                      where x.entry_id is not null
                        and not exists (select 1 from public.draw_slots s where s.draw_id = d.id and s.entry_id = x.entry_id)));
  if v_n > 0 then
    raise exception 'DEMO: % confirmed knockout result(s) do not fit their draw (the round does not match the match number, or a side is not in the draw). This file reads finishes from the matches, so its ranking would differ from the admin''s. Nothing was changed.', v_n;
  end if;

  -- ---------------------------------------------------------------------------------------------- 2. the ranking (same rules as the admin)
  with ev as (
    -- events in scope: men's singles, no age group, a published draw, an approved tournament; junior worked out as the admin does
    select e.id, e.format, t.id as tournament_id, t.level, coalesce(t.end_date, t.start_date) as result_date,
           (e.is_junior or t.is_minor_signal is not false or coalesce(t.level = 'school_college', false)) as junior,
           d.id as draw_id
    from public.tournament_events e
    join public.tournaments t on t.id = e.tournament_id
    join public.draws d on d.event_id = e.id and d.status <> 'draft'
    where e.category = c_category and e.age_group is null and t.status in ('published', 'completed')
  ), ko as (
    -- knockout: the loser of each decided, confirmed main-draw match finishes in that round; the winner of the final is 'W'
    select m.event_id, case m.winner_side when 'A' then m.side_b_entry else m.side_a_entry end as entry_id, m.round_code as finish
    from public.competition_matches m
    join ev on ev.id = m.event_id and ev.format = 'knockout'
    where m.confirmed and m.status in ('completed', 'walkover', 'retired') and m.winner_side is not null
      and m.round_code in ('F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128')
    union all
    select m.event_id, case m.winner_side when 'A' then m.side_a_entry else m.side_b_entry end, 'W'
    from public.competition_matches m
    join ev on ev.id = m.event_id and ev.format = 'knockout'
    where m.confirmed and m.status in ('completed', 'walkover', 'retired') and m.winner_side is not null and m.round_code = 'F'
  ), lg as (
    -- league or groups: only when every match is confirmed; then everyone in the draw takes part ('league' or 'group')
    select ev.id as event_id, s.entry_id, case ev.format when 'round_robin' then 'league' else 'group' end as finish
    from ev
    join public.draw_slots s on s.draw_id = ev.draw_id
    where ev.format <> 'knockout' and s.entry_id is not null
      and exists (select 1 from public.competition_matches m where m.event_id = ev.id)
      and not exists (select 1 from public.competition_matches m where m.event_id = ev.id and not m.confirmed)
  ), fin as (
    select ko.event_id, ko.entry_id, ko.finish from ko where ko.entry_id is not null
    union all
    select lg.event_id, lg.entry_id, lg.finish from lg
  ), res as (
    -- one result per player of a finished entry; only players the site may name, outside junior events, with a level and a date
    select pl.player_id, ev.tournament_id, ev.level, f.finish, ev.result_date
    from fin f
    join ev on ev.id = f.event_id
    join public.event_entries en on en.id = f.entry_id and en.event_id = f.event_id
    cross join lateral (values (en.player1_id), (en.player2_id)) as pl(player_id)
    join public.players p on p.id = pl.player_id
    where not ev.junior
      and p.age_status = 'adult_confirmed'
      and exists (select 1 from app.competition_named_players np where np.id = pl.player_id)
      and ev.level is not null and ev.result_date is not null
      and (v_points -> 'levels') ? ev.level
      and ev.result_date between v_today - (v_window - 1) and v_today
  ), scored as (
    select r.player_id, r.tournament_id, r.level, r.finish, r.result_date,
           coalesce((v_points -> 'levels' -> r.level ->> r.finish)::integer, 0) as pts,
           array_position(c_finishes, r.finish) as fidx
    from res r
  ), best_per_tournament as (
    -- one result per player per tournament: the best (points, then the later date, then the further finish)
    select distinct on (sc.player_id, sc.tournament_id) sc.*
    from scored sc
    order by sc.player_id, sc.tournament_id, sc.pts desc, sc.result_date desc, sc.fidx, sc.level collate "C"
  ), ordered as (
    select b.*, row_number() over (partition by b.player_id
             order by b.pts desc, b.result_date desc, b.tournament_id::text collate "C", b.fidx, b.level collate "C") as n
    from best_per_tournament b
  ), agg as (
    select o.player_id, sum(o.pts)::integer as total, count(*)::integer as counted,
           array_agg(o.pts order by o.n) || array_fill(0, array[v_best - count(*)::integer]) as tiebreak,
           max(o.result_date) as latest
    from ordered o
    where o.n <= v_best
    group by o.player_id
  )
  select jsonb_agg(jsonb_build_object('playerId', a.player_id, 'rank', a.rnk, 'points', a.total, 'eventsCounted', a.counted)
                   order by a.rnk, a.player_id::text collate "C")
    into v_rows
    from (select g.*, rank() over (order by g.total desc, g.tiebreak desc, g.latest desc) as rnk from agg g) a;
  if v_rows is null then
    raise exception 'DEMO: no confirmed men''s singles demo results in the last % days to rank. Nothing was changed.', v_window;
  end if;

  -- ---------------------------------------------------------------------------------------------- 3. save and publish
  v_res := public.admin_save_ranking_snapshot(v_owner, jsonb_build_object(
    'label', c_ranking_label, 'category', c_category, 'ageGroup', null, 'asOf', to_char(v_today, 'YYYY-MM-DD'), 'entries', v_rows), c_reason);
  v_snapshot := (v_res ->> 'id')::uuid;
  perform public.admin_publish_ranking_snapshot(v_owner, v_snapshot, c_reason);

  select count(*) into v_n from public.ranking_entries r where r.snapshot_id = v_snapshot;
  if v_n <> jsonb_array_length(v_rows) or not exists (select 1 from public.ranking_snapshots x where x.id = v_snapshot and x.published) then
    raise exception 'DEMO: the demo ranking was not saved and published as expected. Nothing was changed.';
  end if;
  select string_agg(r.rank || '. ' || p.display_name || ' ' || r.points, ', ' order by r.rank, p.display_name) into v_list
    from public.ranking_entries r join public.players p on p.id = r.player_id where r.snapshot_id = v_snapshot;
  raise notice 'DEMO: approved points table installed and the demo ranking "%" published (% rows): %. Remove it with supabase/demo/competition-demo-remove.sql (the approved table stays).',
    c_ranking_label, v_n, v_list;
end
$points$;

commit;
