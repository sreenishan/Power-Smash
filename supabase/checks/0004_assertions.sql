-- 0004_assertions.sql - self-check for migration 0004_archive_core.sql (the archive tables).
-- Run it after applying 0004 (and 0005, whose triggers add more rules: see 0005_assertions.sql). Paste it into the Supabase
-- dashboard SQL editor. It changes nothing: the behaviour tests run inside a sub-transaction that is rolled back, with FICTIONAL rows
-- only. It raises an exception naming the first rule that is broken and ends with one row `ok`.

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
-- A. structure: every table exists, RLS on, no API-role policy, nothing for anon/authenticated, the exact service_role privileges
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  r text;
  p text;
  want record;
  -- table, privileges service_role must hold, privileges it must NOT hold
  matrix text[][] := array[
    ['videos',              'SELECT,INSERT,UPDATE',        'DELETE,TRUNCATE'],
    ['video_title_history', 'SELECT,INSERT',               'UPDATE,DELETE,TRUNCATE'],
    ['tournaments',         'SELECT,INSERT,UPDATE',        'DELETE,TRUNCATE'],
    ['tournament_private',  'SELECT,INSERT,UPDATE,DELETE', 'TRUNCATE'],
    ['tournament_aliases',  'SELECT,INSERT,UPDATE,DELETE', 'TRUNCATE'],
    ['players',             'SELECT,INSERT,UPDATE',        'DELETE,TRUNCATE'],
    ['player_aliases',      'SELECT,INSERT,UPDATE',        'DELETE,TRUNCATE'],
    ['matches',             'SELECT,INSERT,UPDATE',        'DELETE,TRUNCATE'],
    ['match_participants',  'SELECT,INSERT,UPDATE,DELETE', 'TRUNCATE'],
    ['slug_redirects',      'SELECT,INSERT,UPDATE,DELETE', 'TRUNCATE'],
    ['sync_runs',           'SELECT,INSERT,UPDATE',        'DELETE,TRUNCATE']
  ];
  i integer;
begin
  for i in 1 .. array_length(matrix, 1) loop
    t := matrix[i][1];
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      raise exception 'ASSERT FAIL: table public.% does not exist', t;
    end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t) then
      raise exception 'ASSERT FAIL: row level security is OFF on public.%', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and (roles && array['anon', 'authenticated', 'public']::name[])) then
      raise exception 'ASSERT FAIL: a policy for anon/authenticated/public exists on public.%', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, format('public.%I', t), p) then
          raise exception 'ASSERT FAIL: % holds % on public.%', r, p, t;
        end if;
      end loop;
    end loop;
    foreach p in array string_to_array(matrix[i][2], ',') loop
      if not has_table_privilege('service_role', format('public.%I', t), p) then
        raise exception 'ASSERT FAIL: service_role lacks % on public.%', p, t;
      end if;
    end loop;
    foreach p in array string_to_array(matrix[i][3], ',') loop
      if has_table_privilege('service_role', format('public.%I', t), p) then
        raise exception 'ASSERT FAIL: service_role holds % on public.% (it must not)', p, t;
      end if;
    end loop;
  end loop;

  -- no private contact column on the public tournament table (the split is the point)
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tournaments'
             and column_name in ('organizer_phone', 'organizer_email', 'organizer_name')) then
    raise exception 'ASSERT FAIL: public.tournaments carries an organizer contact column; it belongs in tournament_private';
  end if;
  -- the unique keys the sync upserts on
  if not exists (select 1 from pg_constraint where conrelid = 'public.tournaments'::regclass and contype = 'u' and conname = 'tournaments_series_edition_unique') then
    raise exception 'ASSERT FAIL: tournaments (series_key, edition_year) unique constraint is missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.matches'::regclass and contype = 'u' and conname = 'matches_video_unique') then
    raise exception 'ASSERT FAIL: matches.video_id unique constraint is missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.match_participants'::regclass and contype = 'u' and conname = 'match_participants_position_unique') then
    raise exception 'ASSERT FAIL: match_participants (match_id, side, position) unique constraint is missing';
  end if;
  -- the protected-player table rule exists
  if not exists (select 1 from pg_constraint where conrelid = 'public.players'::regclass and conname = 'players_protected_rules') then
    raise exception 'ASSERT FAIL: players_protected_rules constraint is missing';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour of the constraints (rolled back; fictional data)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_t uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
begin
  begin
    -- a plain video: defaults are hidden and held (SA-M31)
    insert into public.videos (youtube_id, title_raw) values ('fake-vid-0001', 'Fake Alpha vs Fake Beta | Fake Open 2026');
    if (select visibility from public.videos where youtube_id = 'fake-vid-0001') <> 'hidden' then
      raise exception 'ASSERT FAIL: a new video must start hidden';
    end if;
    perform pg_temp.expect_fail($q$insert into public.videos (youtube_id, title_raw) values ('fake-vid-0001', 'duplicate id')$q$, 'duplicate video id');
    perform pg_temp.expect_fail($q$insert into public.videos (youtube_id, title_raw) values ('a b', 'bad id')$q$, 'video id format');
    perform pg_temp.expect_fail($q$insert into public.videos (youtube_id, title_raw, type) values ('fake-vid-0002', 'x', 'concert')$q$, 'video type enum');
    perform pg_temp.expect_fail($q$insert into public.videos (youtube_id, title_raw, visibility) values ('fake-vid-0002', 'x', 'secret')$q$, 'video visibility enum');
    perform pg_temp.expect_fail($q$insert into public.videos (youtube_id, title_raw, parse_confidence) values ('fake-vid-0002', 'x', 101)$q$, 'confidence over 100');
    perform pg_temp.expect_fail($q$insert into public.videos (youtube_id, title_raw, manual_override) values ('fake-vid-0002', 'x', '{"title_raw": true}')$q$, 'lock on a field that cannot be locked');
    perform pg_temp.expect_fail($q$insert into public.videos (youtube_id, title_raw, manual_override) values ('fake-vid-0002', 'x', '{"visibility": false}')$q$, 'a lock must be true');

    -- tournaments: the (series_key, edition_year) key, NULLS NOT DISTINCT, and international is never public
    insert into public.tournaments (id, slug, name, series_key, edition_year) values (v_t, 'fake-open-2026', 'Fake Open', 'fake open', 2026);
    perform pg_temp.expect_fail($q$insert into public.tournaments (slug, name, series_key, edition_year) values ('fake-open-2026-b', 'Fake Open', 'fake open', 2026)$q$, 'same series and year twice');
    insert into public.tournaments (slug, name, series_key, edition_year) values ('fake-cup-nodate', 'Fake Cup', 'fake cup', null);
    perform pg_temp.expect_fail($q$insert into public.tournaments (slug, name, series_key, edition_year) values ('fake-cup-nodate-b', 'Fake Cup', 'fake cup', null)$q$, 'same series, no year, twice (NULLS NOT DISTINCT)');
    insert into public.tournaments (slug, name, series_key, region, visibility) values ('fake-intl', 'Fake Intl', 'fake intl', 'international', 'public');
    if (select visibility from public.tournaments where slug = 'fake-intl') <> 'hidden' then raise exception 'ASSERT FAIL: an international tournament must never be visible'; end if;
    perform pg_temp.expect_fail($q$insert into public.tournaments (slug, name, series_key, categories) values ('fake-bad-cat', 'x', 'x', array['ZZ'])$q$, 'category outside the vocabulary');
    insert into public.tournament_private (tournament_id, organizer_name, organizer_phone) values (v_t, 'Fake Organizer', '910000000000');

    -- players: the protected rule is a table rule
    insert into public.players (id, display_name, name_normalized) values (v_p, 'Fake Alpha', 'fake alpha');
    if (select age_status || slug_kind from public.players where id = v_p) <> 'unknownopaque' then
      raise exception 'ASSERT FAIL: a new player must be unknown with an opaque slug';
    end if;
    perform pg_temp.expect_fail($q$insert into public.players (display_name, name_normalized, age_status) values ('x', 'x', 'adult')$q$, 'age status outside the enum');
    perform pg_temp.expect_fail($q$insert into public.players (display_name, name_normalized) values ('x', '')$q$, 'empty normalised name');

    -- matches and participants
    insert into public.matches (id, video_id, tournament_id, category, round) values (v_m, 'fake-vid-0001', v_t, 'MS', 'QF');
    if (select publish_state from public.matches where id = v_m) <> 'held' then raise exception 'ASSERT FAIL: a new match must be held'; end if;
    perform pg_temp.expect_fail(format($q$insert into public.matches (video_id) values ('fake-vid-0001')$q$), 'a second match for one video');
    perform pg_temp.expect_fail($q$insert into public.matches (video_id, category) select 'fake-vid-0001', 'ZZ' where false union all select 'fake-vid-none', 'MS'$q$, 'a match for a video that does not exist');
    perform pg_temp.expect_fail(format($q$update public.matches set age_group = 'U-13' where id = %L$q$, v_m), 'age group outside the vocabulary');
    update public.matches set age_group = 'U13' where id = v_m;
    update public.matches set age_group = '35+' where id = v_m;

    insert into public.match_participants (match_id, side, position, raw_name) values (v_m, 'A', 1, 'FAKE ALPHA');
    perform pg_temp.expect_fail(format($q$insert into public.match_participants (match_id, side, position, raw_name) values (%L, 'A', 1, 'DUP')$q$, v_m), 'same side and position twice');
    perform pg_temp.expect_fail(format($q$insert into public.match_participants (match_id, side, position, raw_name, resolution) values (%L, 'B', 1, 'GANESH', 'provisional')$q$, v_m), 'a link resolution without a player');
    perform pg_temp.expect_fail(format($q$insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution) values (%L, 'B', 1, 'GANESH', %L, 'provisional')$q$, v_m, v_p),
      'a single-token (plain_text_only) name linked to a player (PC-01)');
    insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution, link_policy, identity_tier)
      values (v_m, 'B', 1, 'Fake Beta', v_p, 'provisional', 'provisional_ok', 'multi_token');
    perform pg_temp.expect_fail(format($q$insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution, link_policy, truncated) values (%L, 'B', 2, 'Fake Gam...', %L, 'provisional', 'provisional_ok', true)$q$, v_m, v_p),
      'a truncated name linked to a player');
    perform pg_temp.expect_fail(format($q$insert into public.match_participants (match_id, side, position, raw_name, country) values (%L, 'B', 3, 'x', 'india')$q$, v_m), 'country not a 3-letter code');

    -- redirects
    insert into public.slug_redirects (from_path, to_path) values ('/players/fake-old/', '/players/fake-alpha/');
    perform pg_temp.expect_fail($q$insert into public.slug_redirects (from_path, to_path, http_status) values ('/players/a/', null, 301)$q$, '301 without a target');
    perform pg_temp.expect_fail($q$insert into public.slug_redirects (from_path, to_path, http_status) values ('/players/a/', '/players/b/', 410)$q$, '410 with a target');
    perform pg_temp.expect_fail($q$insert into public.slug_redirects (from_path, to_path) values ('/players/a/', '/players/a/')$q$, 'a redirect to itself');
    perform pg_temp.expect_fail($q$insert into public.slug_redirects (from_path, to_path) values ('players/a', '/players/b/')$q$, 'a path without a leading or trailing slash');

    -- sync runs
    insert into public.sync_runs (mode) values ('incremental');
    perform pg_temp.expect_fail($q$insert into public.sync_runs (mode) values ('nightly')$q$, 'unknown sync mode');

    -- service_role cannot delete a video, a player or a match (tombstones, D-014)
    execute 'set local role service_role';
    perform pg_temp.expect_fail($q$delete from public.videos where youtube_id = 'fake-vid-0001'$q$, 'service_role deleting a video');
    perform pg_temp.expect_fail($q$delete from public.players$q$, 'service_role deleting players');
    perform pg_temp.expect_fail($q$delete from public.matches$q$, 'service_role deleting matches');
    execute 'reset role';
    execute 'set local role anon';
    perform pg_temp.expect_fail($q$select count(*) from public.videos$q$, 'anon reading videos');
    perform pg_temp.expect_fail($q$select count(*) from public.tournament_private$q$, 'anon reading organizer contacts');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0004_archive_core assertions passed' as result;
