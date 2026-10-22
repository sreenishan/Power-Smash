-- 0005_assertions.sql - self-check for migration 0005_archive_safety.sql (settings, site_state, audit_log, suppression and the guard triggers).
-- Run it after applying 0004 and 0005. It changes nothing: every behaviour test runs in a sub-transaction that is rolled back, with FICTIONAL
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
-- A. structure
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  r text;
  p text;
  i integer;
  fn text;
  matrix text[][] := array[
    ['archive_settings', 'SELECT,INSERT,UPDATE', 'DELETE,TRUNCATE'],
    ['site_state',       'SELECT,UPDATE',        'INSERT,DELETE,TRUNCATE'],
    ['audit_log',        'SELECT,INSERT',        'UPDATE,DELETE,TRUNCATE'],
    ['suppression',      'SELECT,INSERT,UPDATE', 'DELETE,TRUNCATE']
  ];
  trg text;
begin
  for i in 1 .. array_length(matrix, 1) loop
    t := matrix[i][1];
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t) then
      raise exception 'ASSERT FAIL: row level security is OFF on public.% (or the table is missing)', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and (roles && array['anon', 'authenticated', 'public']::name[])) then
      raise exception 'ASSERT FAIL: a policy for anon/authenticated/public exists on public.%', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, format('public.%I', t), p) then raise exception 'ASSERT FAIL: % holds % on public.%', r, p, t; end if;
      end loop;
    end loop;
    foreach p in array string_to_array(matrix[i][2], ',') loop
      if not has_table_privilege('service_role', format('public.%I', t), p) then raise exception 'ASSERT FAIL: service_role lacks % on public.%', p, t; end if;
    end loop;
    foreach p in array string_to_array(matrix[i][3], ',') loop
      if has_table_privilege('service_role', format('public.%I', t), p) then raise exception 'ASSERT FAIL: service_role holds % on public.% (it must not)', p, t; end if;
    end loop;
  end loop;

  -- append-only triggers (history cannot change even for the table owner)
  foreach trg in array array['audit_log_append_only', 'audit_log_no_truncate', 'suppression_immutable', 'suppression_no_truncate', 'site_state_no_delete'] loop
    if not exists (select 1 from pg_trigger g where g.tgname = trg and not g.tgisinternal) then
      raise exception 'ASSERT FAIL: trigger % is missing', trg;
    end if;
  end loop;
  -- the guard triggers that enforce D-012, D-014 and PC-20 for every writer
  foreach trg in array array['videos_guard', 'tournaments_guard', 'players_guard', 'matches_guard', 'participants_guard', 'redirects_guard', 'videos_title_history'] loop
    if not exists (select 1 from pg_trigger g where g.tgname = trg and not g.tgisinternal) then
      raise exception 'ASSERT FAIL: trigger % is missing', trg;
    end if;
  end loop;

  -- the owner's defaults (D-012, D-018) are in place
  if app.setting('unknown_match_mode') is null or app.setting('minor_match_mode') is null then
    raise exception 'ASSERT FAIL: archive_settings has no match-mode rows';
  end if;
  if (select count(*) from public.site_state) <> 1 then raise exception 'ASSERT FAIL: site_state must hold exactly one row'; end if;

  -- every function in schema app is closed to the API roles
  for fn in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE app function %', fn;
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_p uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_t uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  v_sid uuid;
  n integer;
  rec record;
begin
  begin
    -- settings: only known keys and allowed values
    perform pg_temp.expect_fail($q$insert into public.archive_settings (key, value) values ('unknown_match_mode', 'full')$q$, 'a match mode of full');
    perform pg_temp.expect_fail($q$insert into public.archive_settings (key, value) values ('made_up_key', 'x')$q$, 'an unknown setting key');
    perform pg_temp.expect_fail($q$update public.archive_settings set value = 'maybe' where key = 'non_tn_tournament_pages'$q$, 'non_tn_tournament_pages = maybe');

    -- site_state: one row, deletable by nobody, duplicated by nobody
    perform pg_temp.expect_fail($q$delete from public.site_state$q$, 'deleting the site_state row');
    perform pg_temp.expect_fail($q$insert into public.site_state (id) values (2)$q$, 'a second site_state row');
    update public.site_state set dirty = false, urgent = false, dirty_since = null;

    -- audit_log is append-only even for the owner role
    insert into public.audit_log (actor, action, entity, entity_id) values ('fake-admin', 'test_action', 'players', 'x');
    perform pg_temp.expect_fail($q$update public.audit_log set actor = 'someone else'$q$, 'updating audit_log');
    perform pg_temp.expect_fail($q$delete from public.audit_log$q$, 'deleting from audit_log');
    perform pg_temp.expect_fail($q$truncate public.audit_log$q$, 'truncating audit_log');
    perform pg_temp.expect_fail($q$insert into public.audit_log (actor, action, entity) values ('', 'a', 'b')$q$, 'an audit row without an actor');

    -- dirty flag: stats and sync stamps do not mark dirty, a title or visibility change does
    insert into public.videos (youtube_id, title_raw) values ('fake-vid-0001', 'Fake Alpha vs Fake Beta | Fake Open 2026');
    if (select dirty from public.site_state) then raise exception 'ASSERT FAIL: inserting a HIDDEN video marked the site dirty'; end if;
    update public.videos set views = 10, likes = 1, last_synced_at = now(), etag = 'e', stats_fetched_at = now() where youtube_id = 'fake-vid-0001';
    if (select dirty from public.site_state) then raise exception 'ASSERT FAIL: a stats refresh marked the site dirty'; end if;
    update public.videos set title_raw = 'Fake Alpha vs Fake Beta | Fake Open 2026 Final' where youtube_id = 'fake-vid-0001';
    if not (select dirty from public.site_state) then raise exception 'ASSERT FAIL: a retitle did not mark the site dirty'; end if;
    if (select count(*) from public.video_title_history where youtube_id = 'fake-vid-0001') <> 2 then
      raise exception 'ASSERT FAIL: title history should hold the first and the changed title';
    end if;

    -- field-level locks (PC-20): the sync cannot change a locked field or the lock list
    update public.videos set visibility = 'public', manual_override = '{"visibility": true}' where youtube_id = 'fake-vid-0001';
    -- (the lock list itself cannot be set by a plain update: it was ignored above)
    if (select manual_override from public.videos where youtube_id = 'fake-vid-0001') <> '{}'::jsonb then
      raise exception 'ASSERT FAIL: a plain update changed manual_override';
    end if;
    perform set_config('app.override_bypass', 'on', true);
    update public.videos set manual_override = '{"visibility": true}' where youtube_id = 'fake-vid-0001';
    perform set_config('app.override_bypass', 'off', true);
    update public.videos set visibility = 'hidden', title_raw = 'Fake Alpha vs Fake Beta | Fake Open 2026 Final v2' where youtube_id = 'fake-vid-0001';
    select visibility, override_stale into rec from public.videos where youtube_id = 'fake-vid-0001';
    if rec.visibility <> 'public' then raise exception 'ASSERT FAIL: a locked visibility was changed by the sync'; end if;
    if not rec.override_stale then raise exception 'ASSERT FAIL: a retitled locked video was not flagged override_stale'; end if;

    -- suppression: a suppressed video can never be public, a tombstone can never be edited away
    insert into public.suppression (kind, value, reason, created_by) values ('youtube_id', 'fake-vid-0009', 'test takedown', 'fake-admin') returning id into v_sid;
    insert into public.videos (youtube_id, title_raw, visibility) values ('fake-vid-0009', 'Fake Gamma vs Fake Delta', 'public');
    if (select visibility from public.videos where youtube_id = 'fake-vid-0009') <> 'hidden' then raise exception 'ASSERT FAIL: a suppressed video was inserted as public'; end if;
    update public.videos set visibility = 'public' where youtube_id = 'fake-vid-0009';
    if (select visibility from public.videos where youtube_id = 'fake-vid-0009') <> 'hidden' then raise exception 'ASSERT FAIL: a sync resurrected a suppressed video'; end if;
    perform set_config('app.override_bypass', 'on', true);
    update public.videos set visibility = 'public', manual_override = '{"visibility": true}' where youtube_id = 'fake-vid-0009';
    perform set_config('app.override_bypass', 'off', true);
    if (select visibility from public.videos where youtube_id = 'fake-vid-0009') <> 'hidden' then raise exception 'ASSERT FAIL: even an admin lock cannot show a suppressed video'; end if;
    perform pg_temp.expect_fail(format($q$delete from public.suppression where id = %L$q$, v_sid), 'deleting a tombstone');
    perform pg_temp.expect_fail(format($q$update public.suppression set value = 'fake-vid-0010' where id = %L$q$, v_sid), 'changing a tombstone key');
    perform pg_temp.expect_fail($q$insert into public.suppression (kind, value, reason, created_by) values ('youtube_id', 'fake-vid-0009', 'again', 'x')$q$, 'a second tombstone for one key');
    perform pg_temp.expect_fail($q$insert into public.suppression (kind, value, reason, created_by) values ('player_id', 'not-a-uuid', 'r', 'x')$q$, 'a malformed player id');
    update public.suppression set released_at = now(), released_by = 'fake-admin', release_reason = 'test' where id = v_sid;  -- a release is allowed (and only stamps)
    perform pg_temp.expect_fail(format($q$update public.suppression set released_by = null where id = %L$q$, v_sid), 'released_at without released_by');

    -- players: only an admin action creates or lifts to adult_confirmed
    perform pg_temp.expect_fail($q$insert into public.players (display_name, name_normalized, age_status, age_confirmed_by, age_confirmed_at) values ('x', 'x', 'adult_confirmed', 'a', now())$q$,
      'creating an adult_confirmed player outside an admin action');
    perform set_config('app.age_lift_ok', 'on', true);
    insert into public.players (id, display_name, name_normalized, age_status, age_confirmed_by, age_confirmed_at, slug, slug_kind, district, bio, noindex, is_provisional, visibility)
      values (v_adult, 'Fake Adult', 'fake adult', 'adult_confirmed', 'fake-admin', now(), 'fake-adult', 'named', 'Fake District', 'Fake bio', false, false, 'public');
    perform set_config('app.age_lift_ok', 'off', true);
    if (select district || bio from public.players where id = v_adult) <> 'Fake DistrictFake bio' then raise exception 'ASSERT FAIL: an adult lost its profile'; end if;
    -- a plain update cannot lift a protected player
    insert into public.players (id, display_name, name_normalized, age_status, age_signal) values (v_p, 'Fake Junior', 'fake junior', 'minor_suspected', array['age_token:U13']);
    update public.players set age_status = 'adult_confirmed', age_confirmed_by = 'self', age_confirmed_at = now() where id = v_p;
    if (select age_status from public.players where id = v_p) <> 'minor_suspected' then raise exception 'ASSERT FAIL: a plain update lifted a protected player to adult_confirmed'; end if;
    -- the sync cannot lower a status (unknown after minor_suspected) and signals only accumulate
    update public.players set age_status = 'unknown', age_signal = array['junior_category:BS'] where id = v_p;
    select age_status, age_signal into rec from public.players where id = v_p;
    if rec.age_status <> 'minor_suspected' then raise exception 'ASSERT FAIL: the sync lowered minor_suspected to %', rec.age_status; end if;
    if not (rec.age_signal @> array['age_token:U13', 'junior_category:BS']) then raise exception 'ASSERT FAIL: age signals did not accumulate: %', rec.age_signal; end if;
    -- protected treatment is applied by the trigger: profile cleared, noindex, hidden, opaque
    update public.players set district = 'Fake District', bio = 'x', photo_path = 'a.jpg', instagram_handle = 'h', visibility = 'public', noindex = false where id = v_p;
    select district, bio, photo_path, instagram_handle, visibility, noindex, slug_kind into rec from public.players where id = v_p;
    if rec.district is not null or rec.bio is not null or rec.photo_path is not null or rec.instagram_handle is not null or rec.visibility <> 'hidden' or not rec.noindex or rec.slug_kind <> 'opaque' then
      raise exception 'ASSERT FAIL: protected treatment was not applied to a minor_suspected player';
    end if;
    -- an adult turned protected loses the profile, gets an opaque slug, and the old public path becomes 410
    perform set_config('app.age_lift_ok', 'on', true);
    update public.players set age_status = 'minor_confirmed' where id = v_adult;
    perform set_config('app.age_lift_ok', 'off', true);
    select district, bio, slug, slug_kind, visibility into rec from public.players where id = v_adult;
    if rec.district is not null or rec.bio is not null or rec.slug_kind <> 'opaque' or rec.slug = 'fake-adult' or rec.visibility <> 'hidden' then
      raise exception 'ASSERT FAIL: an adult turned minor kept profile data or the named slug';
    end if;
    if not exists (select 1 from public.slug_redirects where from_path = '/players/fake-adult/' and http_status = 410) then
      raise exception 'ASSERT FAIL: the old public path of a player turned protected is not 410';
    end if;
    -- redirects may only lead to a public adult profile
    perform pg_temp.expect_fail($q$insert into public.slug_redirects (from_path, to_path, entity_type) values ('/players/old-fake/', '/players/fake-adult/', 'player')$q$, 'a redirect to a protected player');
    perform pg_temp.expect_fail(format($q$insert into public.slug_redirects (from_path, to_path, entity_type) values ('/players/old-fake/', %L, 'player')$q$, '/players/' || (select slug from public.players where id = v_p) || '/'), 'a redirect to an opaque page');

    -- S2-7: a name tombstone also suppresses UNLINKED participants and aliases, existing and new
    insert into public.videos (youtube_id, title_raw) values ('fake-vid-0020', 'Fake Omega vs Fake Sigma');
    insert into public.matches (id, video_id) values ('a1000000-0000-4000-8000-0000000000a1', 'fake-vid-0020');
    insert into public.match_participants (match_id, side, position, raw_name) values ('a1000000-0000-4000-8000-0000000000a1', 'A', 1, 'Fake  OMEGA.');
    insert into public.players (id, display_name, name_normalized) values ('b1000000-0000-4000-8000-0000000000b1', 'Fake Omega', 'fake omega');
    insert into public.player_aliases (alias_normalized, player_id, status) values ('fake omega', 'b1000000-0000-4000-8000-0000000000b1', 'confirmed');
    insert into public.suppression (kind, value, reason, created_by) values ('name_normalized', 'fake omega', 'test', 'fake-admin');
    if (select resolution from public.match_participants where raw_name = 'Fake  OMEGA.') <> 'suppressed' then raise exception 'ASSERT FAIL: an existing unlinked participant was not suppressed by a name tombstone'; end if;
    if (select status from public.player_aliases where alias_normalized = 'fake omega') <> 'rejected' then raise exception 'ASSERT FAIL: an existing alias of a suppressed name still resolves'; end if;
    insert into public.match_participants (match_id, side, position, raw_name) values ('a1000000-0000-4000-8000-0000000000a1', 'B', 1, 'fake OMEGA');
    if (select resolution from public.match_participants where raw_name = 'fake OMEGA') <> 'suppressed' then raise exception 'ASSERT FAIL: a NEW unlinked participant with a suppressed name was not suppressed'; end if;
    insert into public.player_aliases (alias_normalized, player_id, status) values ('fake omega', v_p, 'confirmed');
    if (select status from public.player_aliases where alias_normalized = 'fake omega' and player_id = v_p) <> 'rejected' then raise exception 'ASSERT FAIL: a new alias of a suppressed name was accepted'; end if;

    -- a stored named match slug is replaced (opaque) and its old path becomes 410 when a participant stops being an adult
    perform set_config('app.age_lift_ok', 'on', true);
    insert into public.players (id, display_name, name_normalized, age_status, age_confirmed_by, age_confirmed_at) values ('b2000000-0000-4000-8000-0000000000b2', 'Fake Sigma', 'fake sigma', 'adult_confirmed', 'fake-admin', now());
    perform set_config('app.age_lift_ok', 'off', true);
    insert into public.videos (youtube_id, title_raw) values ('fake-vid-0021', 'Fake Sigma vs Fake Tau');
    insert into public.matches (id, video_id, slug, slug_kind) values ('a2000000-0000-4000-8000-0000000000a2', 'fake-vid-0021', 'fake-sigma-vs-fake-tau-0021', 'named');
    perform pg_temp.expect_fail($q$insert into public.matches (video_id, slug, slug_kind) values ('fake-vid-0020', 'match-0123456789abcdef', 'named')$q$, 'a named slug that looks opaque (or a second match for a video)');
    if (select slug_kind || slug from public.matches where id = 'a1000000-0000-4000-8000-0000000000a1') !~ '^opaquematch-[0-9a-f]{16}$' then raise exception 'ASSERT FAIL: a new match did not get an opaque slug'; end if;
    insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution, link_policy, identity_tier)
      values ('a2000000-0000-4000-8000-0000000000a2', 'A', 1, 'Fake Sigma', 'b2000000-0000-4000-8000-0000000000b2', 'provisional', 'provisional_ok', 'multi_token');
    update public.players set age_status = 'minor_suspected' where id = 'b2000000-0000-4000-8000-0000000000b2';
    if (select slug_kind from public.matches where id = 'a2000000-0000-4000-8000-0000000000a2') <> 'opaque' then raise exception 'ASSERT FAIL: a match slug naming a now-protected player was kept'; end if;
    if not exists (select 1 from public.slug_redirects where from_path = '/matches/fake-sigma-vs-fake-tau-0021/' and http_status = 410) then raise exception 'ASSERT FAIL: the old match path is not 410'; end if;

    -- name suppression hides and blocks
    insert into public.suppression (kind, value, reason, created_by) values ('name_normalized', 'fake blocked', 'test', 'fake-admin');
    insert into public.players (display_name, name_normalized) values ('Fake Blocked', 'fake blocked');
    if (select visibility from public.players where name_normalized = 'fake blocked') <> 'hidden' then raise exception 'ASSERT FAIL: a suppressed name was inserted visible'; end if;

    -- matches: the minor hold cannot be cleared by the sync, and a minor-hold match is never published
    insert into public.tournaments (id, slug, name, series_key, edition_year) values (v_t, 'fake-open-2026', 'Fake Open', 'fake open', 2026);
    insert into public.matches (id, video_id, tournament_id, category, minor_hold, publish_state) values (v_m, 'fake-vid-0001', v_t, 'BS', true, 'published');
    if (select publish_state from public.matches where id = v_m) <> 'held' then raise exception 'ASSERT FAIL: a minor_hold match was inserted published'; end if;
    update public.matches set minor_hold = false, publish_state = 'published' where id = v_m;
    select minor_hold, publish_state into rec from public.matches where id = v_m;
    if not rec.minor_hold or rec.publish_state <> 'held' then raise exception 'ASSERT FAIL: the sync cleared a minor hold'; end if;

    -- tournament organizer name needs recorded consent
    insert into public.tournament_private (tournament_id, organizer_name) values (v_t, 'Fake Organizer');
    update public.tournaments set show_contact_public = true where id = v_t;
    if (select show_contact_public from public.tournaments where id = v_t) then raise exception 'ASSERT FAIL: show_contact_public turned on without a recorded consent'; end if;
    update public.tournament_private set consent_at = now(), consent_notice_id = 'tournament-public-contact', consent_notice_version = 'v1' where tournament_id = v_t;
    update public.tournaments set show_contact_public = true where id = v_t;
    if not (select show_contact_public from public.tournaments where id = v_t) then raise exception 'ASSERT FAIL: show_contact_public refused after consent'; end if;
    update public.tournaments set region = 'international', visibility = 'public' where id = v_t;
    if (select visibility from public.tournaments where id = v_t) <> 'hidden' then raise exception 'ASSERT FAIL: an international tournament became visible'; end if;

    -- a suppressed player is never linked again
    insert into public.suppression (kind, value, reason, created_by) values ('player_id', v_p::text, 'test', 'fake-admin');
    insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution, link_policy, identity_tier)
      values (v_m, 'A', 1, 'Fake Junior', v_p, 'provisional', 'provisional_ok', 'multi_token');
    select player_id, resolution into rec from public.match_participants where match_id = v_m and side = 'A' and position = 1;
    if rec.player_id is not null or rec.resolution <> 'suppressed' then raise exception 'ASSERT FAIL: a suppressed player was linked to a participant'; end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0005_archive_safety assertions passed' as result;
