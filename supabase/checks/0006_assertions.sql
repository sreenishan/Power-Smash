-- 0006_assertions.sql - self-check for migration 0006_archive_api.sql (schema api views and the admin RPCs).
-- Run it after applying 0004, 0005 and 0006. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
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
-- A. structure: the exposed surface is exactly seven views and nothing else
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v text;
  c record;
  p text;
  views text[] := array['public_videos', 'public_matches', 'public_match_participants', 'public_players', 'public_tournaments', 'public_slug_redirects', 'public_archive_modes'];
  rpcs text[] := array[
    'public.admin_mark_dirty(text,text,boolean)', 'public.admin_merge_players(text,uuid,uuid,text,boolean)',
    'public.admin_split_player(text,uuid,uuid[],text,text,text,text)', 'public.admin_rename_player(text,uuid,text,text,text,text)',
    'public.admin_set_age_status(text,uuid[],text,text,text,boolean)', 'public.admin_emergency_hide(text,text,text,text,timestamp with time zone,text)',
    'public.admin_release_suppression(text,uuid,text)', 'public.admin_update_video(text,text,jsonb,boolean,text)',
    'public.admin_update_match(text,uuid,jsonb,boolean,text)', 'public.admin_update_player(text,uuid,jsonb,text)'];
  r text;
  forbidden text[] := array['description', 'organizer_phone', 'organizer_email', 'phone', 'email', 'age_signal', 'age_confirmed_by', 'age_confirmed_evidence',
                            'age_status', 'name_normalized', 'name_key', 'latin_key', 'parse_result', 'hard_flags', 'review_reasons', 'manual_override',
                            'merged_into', 'is_provisional', 'consent_at', 'ip_hash', 'etag', 'minor_hold', 'identity_tier', 'link_policy', 'resolution'];
begin
  foreach v in array views loop
    if not exists (select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = v and cl.relkind = 'v') then
      raise exception 'ASSERT FAIL: view api.% does not exist', v;
    end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('anon', format('api.%I', v), p) or has_table_privilege('authenticated', format('api.%I', v), p) then
        raise exception 'ASSERT FAIL: anon or authenticated holds % on api.%', p, v;
      end if;
    end loop;
    if not (has_table_privilege('anon', format('api.%I', v), 'SELECT') and has_table_privilege('authenticated', format('api.%I', v), 'SELECT')) then
      raise exception 'ASSERT FAIL: anon or authenticated cannot SELECT api.%', v;
    end if;
    if not coalesce((select 'security_barrier=true' = any (cl.reloptions) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relname = v), false) then
      raise exception 'ASSERT FAIL: api.% is not a security_barrier view', v;
    end if;
    -- no private column ever appears in a public view
    for c in select column_name from information_schema.columns where table_schema = 'api' and table_name = v loop
      if c.column_name = any (forbidden) then raise exception 'ASSERT FAIL: api.% exposes the private column %', v, c.column_name; end if;
    end loop;
  end loop;
  -- nothing else lives in schema api, except the views later migrations add by name (0011 public_products, checked in 0011_assertions.sql)
  if exists (select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'api' and cl.relkind in ('r', 'v', 'm', 'f', 'p') and cl.relname <> all (views || array['public_products'])) then
    raise exception 'ASSERT FAIL: schema api holds an object that is not one of the seven archive views or a named later view';
  end if;
  if exists (select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace where n.nspname = 'api') then
    raise exception 'ASSERT FAIL: schema api must hold no function';
  end if;
  -- the internal views in schema app are closed to the API roles (they are read only through the owner's api views)
  for c in select cl.relname from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'app' and cl.relkind = 'v' loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', format('app.%I', c.relname), p) or has_table_privilege('authenticated', format('app.%I', c.relname), p) then
        raise exception 'ASSERT FAIL: anon or authenticated holds % on internal view app.%', p, c.relname;
      end if;
    end loop;
  end loop;
  if has_schema_privilege('anon', 'app', 'USAGE') or has_schema_privilege('authenticated', 'app', 'USAGE') then
    raise exception 'ASSERT FAIL: anon or authenticated can USE schema app';
  end if;
  -- the API roles hold nothing on the schema except usage
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'api', 'CREATE') then raise exception 'ASSERT FAIL: % can CREATE in schema api', r; end if;
  end loop;
  -- admin RPCs: service_role only, SECURITY DEFINER with a fixed search_path
  foreach r in array rpcs loop
    if has_function_privilege('anon', r, 'EXECUTE') or has_function_privilege('authenticated', r, 'EXECUTE') then
      raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE %', r;
    end if;
    if not has_function_privilege('service_role', r, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot EXECUTE %', r; end if;
    if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = r::regprocedure) then
      raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path = ''''', r;
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour of the views and the RPCs (rolled back; fictional data)
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  t_tn uuid := gen_random_uuid();
  t_ka uuid := gen_random_uuid();
  pa uuid := gen_random_uuid();   -- adult A
  pb uuid := gen_random_uuid();   -- adult B
  pc uuid := gen_random_uuid();   -- unknown-age C
  pd uuid := gen_random_uuid();   -- suspected minor D
  pe uuid := gen_random_uuid();   -- adult E (merge target)
  m1 uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  m3 uuid := gen_random_uuid();
  m4 uuid := gen_random_uuid();
  m5 uuid := gen_random_uuid();
  m6 uuid := gen_random_uuid();
  n integer;
  rec record;
  j jsonb;
  v_new uuid;
  vid text;
begin
  begin
    -- ------------------------------------------------------------------ data
    insert into public.tournaments (id, slug, name, series_key, edition_year, region, visibility, status)
      values (t_tn, 'fake-open-2026', 'Fake Open', 'fake open', 2026, 'tamil_nadu', 'public', 'published'),
             (t_ka, 'fake-ka-cup-2026', 'Fake KA Cup', 'fake ka cup', 2026, 'other_india', 'public', 'published');
    insert into public.tournament_private (tournament_id, organizer_name, organizer_phone, organizer_email) values (t_tn, 'Fake Organizer', '910000000000', 'fake@example.invalid');

    insert into public.players (id, display_name, name_normalized, identity_tier) values
      (pa, 'Fake Alpha', 'fake alpha', 'multi_token'), (pb, 'Fake Beta', 'fake beta', 'multi_token'), (pc, 'Fake Gamma', 'fake gamma', 'multi_token'),
      (pd, 'Fake Delta', 'fake delta', 'multi_token'), (pe, 'Fake Epsilon', 'fake epsilon', 'multi_token');
    update public.players set age_status = 'minor_suspected', age_signal = array['age_token:U13'] where id = pd;

    insert into public.videos (youtube_id, title_raw, visibility, type) values
      ('fake-v1', 'FAKE ALPHA vs FAKE BETA | Fake Open 2026', 'public', 'match'),
      ('fake-v2', 'FAKE GAMMA vs FAKE ZETA | Fake Open 2026', 'public', 'match'),
      ('fake-v3', 'FAKE DELTA vs FAKE ZETA | Fake Open 2026', 'public', 'match'),
      ('fake-v4', 'FAKE ALPHA vs FAKE BETA hidden', 'hidden', 'match'),
      ('fake-v5', 'FAKE ALPHA vs FAKE BETA listed only', 'listed_no_player_pages', 'match'),
      ('fake-v6', 'FAKE ALPHA vs FAKE BETA BS', 'public', 'match'),
      ('fake-v7', 'Fake Short #shorts', 'public', 'short');
    insert into public.matches (id, video_id, tournament_id, category, round, publish_state) values
      (m1, 'fake-v1', t_tn, 'MS', 'F', 'published'), (m2, 'fake-v2', t_tn, 'MS', 'SF', 'published'), (m3, 'fake-v3', t_tn, 'MS', 'QF', 'published'),
      (m4, 'fake-v4', t_tn, 'MS', 'R16', 'published'), (m5, 'fake-v5', t_ka, 'MS', 'R32', 'published'), (m6, 'fake-v6', t_tn, 'BS', 'R64', 'published');
    insert into public.match_participants (match_id, side, position, raw_name, player_id, resolution, link_policy, identity_tier, age_status)
      select x.m, x.s, 1, x.nm, x.pl, case when x.pl is null then 'plain_text' else 'provisional' end, case when x.pl is null then 'plain_text_only' else 'provisional_ok' end, 'multi_token', x.ag
      from (values
        (m1, 'A', 'FAKE ALPHA', pa, 'unknown'), (m1, 'B', 'FAKE BETA', pb, 'unknown'),
        (m2, 'A', 'FAKE GAMMA', pc, 'unknown'), (m2, 'B', 'FAKE ZETA', null::uuid, 'unknown'),
        (m3, 'A', 'FAKE DELTA', pd, 'minor_suspected'), (m3, 'B', 'FAKE ZETA', null::uuid, 'unknown'),
        (m4, 'A', 'FAKE ALPHA', pa, 'unknown'), (m4, 'B', 'FAKE BETA', pb, 'unknown'),
        (m5, 'A', 'FAKE ALPHA', pa, 'unknown'), (m5, 'B', 'FAKE BETA', pb, 'unknown'),
        (m6, 'A', 'FAKE ALPHA', pa, 'unknown'), (m6, 'B', 'FAKE BETA', pb, 'unknown')) as x(m, s, nm, pl, ag);

    -- ------------------------------------------------------------------ before any adult is confirmed: nobody is an adult
    select count(*) into n from api.public_players;
    if n <> 0 then raise exception 'ASSERT FAIL: api.public_players holds % rows before any adult is confirmed', n; end if;
    if (select page_mode from api.public_videos where youtube_id = 'fake-v1') <> 'minimal' then
      raise exception 'ASSERT FAIL: a match of unknown-age players must be minimal (unknown_match_mode = noindex_minimal)';
    end if;
    if exists (select 1 from api.public_match_participants) then raise exception 'ASSERT FAIL: participant names are exposed for a non-adult match'; end if;

    -- ------------------------------------------------------------------ admin RPCs as service_role
    execute 'set local role service_role';
    perform public.admin_set_age_status('fake-admin', array[pa, pb, pe], 'adult_confirmed', 'fake admin review', 'test');
    perform public.admin_update_player('fake-admin', pa, '{"is_provisional": false, "visibility": "public", "district": "Fake District"}', 'test');
    perform public.admin_update_player('fake-admin', pb, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_update_player('fake-admin', pe, '{"is_provisional": false, "visibility": "public"}', 'test');
    perform public.admin_rename_player('fake-admin', pa, 'Fake Alpha', 'fake alpha', 'give a named slug', 'fake-alpha');
    perform public.admin_rename_player('fake-admin', pb, 'Fake Beta', 'fake beta', 'give a named slug', 'fake-beta');
    perform public.admin_rename_player('fake-admin', pe, 'Fake Epsilon', 'fake epsilon', 'give a named slug', 'fake-epsilon');
    execute 'reset role';

    -- a fully adult match is full; names appear; the slug appears (confirmed alias via rename + public video)
    if (select page_mode from api.public_videos where youtube_id = 'fake-v1') <> 'full' then raise exception 'ASSERT FAIL: an all-adult match is not full'; end if;
    select count(*) into n from api.public_match_participants where match_id = m1;
    if n <> 2 then raise exception 'ASSERT FAIL: expected 2 participant rows for the full match, got %', n; end if;
    if (select player_slug from api.public_match_participants where match_id = m1 and side = 'A') is distinct from 'fake-alpha' then
      raise exception 'ASSERT FAIL: the adult player slug is not linked on a fully public video';
    end if;
    if (select count(*) from api.public_players where slug in ('fake-alpha', 'fake-beta')) <> 2 then raise exception 'ASSERT FAIL: adult players are not in api.public_players'; end if;
    if exists (select 1 from api.public_players where display_name in ('Fake Gamma', 'Fake Delta')) then raise exception 'ASSERT FAIL: a protected player is in api.public_players'; end if;

    -- minimal and hidden modes
    if (select noindex from api.public_videos where youtube_id = 'fake-v2') is not true then raise exception 'ASSERT FAIL: a minimal page is not noindex'; end if;
    if exists (select 1 from api.public_match_participants where match_id = m2) then raise exception 'ASSERT FAIL: names leaked on a minimal match'; end if;
    if (select age_group from api.public_matches where video_id = 'fake-v2') is not null then raise exception 'ASSERT FAIL: age_group not masked'; end if;
    if exists (select 1 from api.public_videos where youtube_id = 'fake-v3') or exists (select 1 from api.public_matches where video_id = 'fake-v3') then
      raise exception 'ASSERT FAIL: a match with a suspected minor is visible (minor_match_mode = hidden)';
    end if;
    if exists (select 1 from api.public_videos where youtube_id = 'fake-v6') then raise exception 'ASSERT FAIL: a junior-category match (BS) is visible with all-adult participants'; end if;
    if exists (select 1 from api.public_videos where youtube_id = 'fake-v4') then raise exception 'ASSERT FAIL: a hidden video is visible'; end if;
    if (select count(*) from api.public_videos where youtube_id = 'fake-v7') <> 1 then raise exception 'ASSERT FAIL: a public short is missing'; end if;
    -- listed_no_player_pages: visible, names shown, but no player link
    if (select player_slug from api.public_match_participants where match_id = m5 and side = 'A') is not null then
      raise exception 'ASSERT FAIL: a listed-only (non-Tamil-Nadu) video links a player page';
    end if;
    -- settings change the outcome without code
    update public.archive_settings set value = 'hidden' where key = 'unknown_match_mode';
    if exists (select 1 from api.public_videos where youtube_id = 'fake-v2') then raise exception 'ASSERT FAIL: unknown_match_mode = hidden still shows the match'; end if;
    update public.archive_settings set value = 'noindex_minimal' where key = 'unknown_match_mode';
    update public.archive_settings set value = 'noindex_minimal' where key = 'minor_match_mode';
    if (select page_mode from api.public_videos where youtube_id = 'fake-v3') <> 'minimal' then raise exception 'ASSERT FAIL: minor_match_mode = noindex_minimal does not produce a minimal page'; end if;
    update public.archive_settings set value = 'hidden' where key = 'minor_match_mode';

    -- tournaments: non-Tamil-Nadu is excluded until the setting is on; organizer contact never appears
    if exists (select 1 from api.public_tournaments where slug = 'fake-ka-cup-2026') then raise exception 'ASSERT FAIL: a non-Tamil-Nadu tournament is public while non_tn_tournament_pages = off'; end if;
    if (select match_count from api.public_tournaments where slug = 'fake-open-2026') <> 2 then raise exception 'ASSERT FAIL: tournament match_count wrong (expected the 2 visible matches)'; end if;
    if (select organizer_name from api.public_tournaments where slug = 'fake-open-2026') is not null then raise exception 'ASSERT FAIL: organizer name shown without consent'; end if;
    if (select page_eligible from api.public_tournaments where slug = 'fake-open-2026') then raise exception 'ASSERT FAIL: a tournament with fewer than 3 matches is page_eligible without promotion'; end if;
    update public.tournaments set is_promoted = true where id = t_tn;
    if not (select page_eligible from api.public_tournaments where slug = 'fake-open-2026') then raise exception 'ASSERT FAIL: promotion does not make a tournament page_eligible'; end if;
    update public.archive_settings set value = 'on' where key = 'non_tn_tournament_pages';
    if not exists (select 1 from api.public_tournaments where slug = 'fake-ka-cup-2026') then raise exception 'ASSERT FAIL: non_tn_tournament_pages = on does not show the tournament'; end if;
    update public.archive_settings set value = 'off' where key = 'non_tn_tournament_pages';
    if (select tournament_id from api.public_matches where video_id = 'fake-v5') is not null then raise exception 'ASSERT FAIL: a match links a tournament that is not public'; end if;

    -- ------------------------------------------------------------------ merge, split
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_merge_players('fake-admin', %L, %L, 'test', false)$q$, pd, pa), 'a minor_suspected into adult merge without the override');
    perform pg_temp.expect_fail(format($q$select public.admin_merge_players('', %L, %L, 'test', false)$q$, pb, pe), 'an RPC without an actor');
    perform pg_temp.expect_fail(format($q$select public.admin_merge_players('fake-admin', %L, %L, '', false)$q$, pb, pe), 'a merge without a reason');
    j := public.admin_merge_players('fake-admin', pe, pb, 'same person', false);
    execute 'reset role';
    if (select merged_into from public.players where id = pe) <> pb then raise exception 'ASSERT FAIL: merge did not set merged_into'; end if;
    if not exists (select 1 from public.slug_redirects where from_path = '/players/fake-epsilon/' and to_path = '/players/fake-beta/' and http_status = 301) then
      raise exception 'ASSERT FAIL: merge did not leave a 301 redirect';
    end if;
    if not exists (select 1 from api.public_slug_redirects where from_path = '/players/fake-epsilon/') then raise exception 'ASSERT FAIL: the redirect is not public'; end if;
    if exists (select 1 from api.public_players where slug = 'fake-epsilon') then raise exception 'ASSERT FAIL: a merged player is still public'; end if;
    -- the override path: merge a protected player into an adult needs the logged override and keeps the stricter status
    execute 'set local role service_role';
    j := public.admin_merge_players('fake-admin', pd, pa, 'parent confirmed same person, test', true);
    execute 'reset role';
    if (select age_status from public.players where id = pa) <> 'minor_suspected' then raise exception 'ASSERT FAIL: merging a minor into an adult did not make the survivor protected'; end if;
    if exists (select 1 from api.public_players where id = pa) then raise exception 'ASSERT FAIL: the survivor of a minor merge is still in api.public_players'; end if;
    if (select slug_kind from public.players where id = pa) <> 'opaque' then raise exception 'ASSERT FAIL: the survivor kept a named slug after becoming protected'; end if;
    if not exists (select 1 from public.slug_redirects where from_path = '/players/fake-alpha/' and http_status = 410) then raise exception 'ASSERT FAIL: the old adult path of the now-protected survivor is not 410'; end if;
    if exists (select 1 from api.public_slug_redirects where from_path = '/players/fake-alpha/') then raise exception 'ASSERT FAIL: a 410 path is public'; end if;

    -- split: the new player inherits the status, matches get locked
    execute 'set local role service_role';
    v_new := public.admin_split_player('fake-admin', pb, (select array_agg(id) from public.match_participants where match_id = m5 and player_id = pb), 'Fake Beta Two', 'fake beta two', 'two different people', null);
    execute 'reset role';
    if (select age_status from public.players where id = v_new) <> 'adult_confirmed' then raise exception 'ASSERT FAIL: a split did not inherit adult_confirmed'; end if;
    if (select is_provisional from public.players where id = v_new) is not true then raise exception 'ASSERT FAIL: the split-off player must start provisional'; end if;
    if (select manual_override ->> 'participants' from public.matches where id = m5) <> 'true' then raise exception 'ASSERT FAIL: a split did not lock the participants of the match'; end if;
    perform pg_temp.expect_fail(format($q$set local role service_role; select public.admin_split_player('fake-admin', %L, array[gen_random_uuid()], 'x', 'x', 'r', null)$q$, pb), 'splitting participants that are not the player''s');

    -- ------------------------------------------------------------------ emergency hide
    execute 'set local role service_role';
    j := public.admin_emergency_hide('fake-admin', 'youtube_id', 'fake-v1', 'takedown request, test', now() - interval '1 hour', 'fake requester');
    execute 'reset role';
    if (j ->> 'videos_hidden')::integer <> 1 or jsonb_array_length(j -> 'owner_checklist') <> 4 then raise exception 'ASSERT FAIL: emergency hide result is wrong: %', j; end if;
    if exists (select 1 from api.public_videos where youtube_id = 'fake-v1') then raise exception 'ASSERT FAIL: a hidden video is still public'; end if;
    if not (select urgent from public.site_state) then raise exception 'ASSERT FAIL: emergency hide did not mark the site urgent'; end if;
    -- a sync cannot bring it back
    update public.videos set visibility = 'public' where youtube_id = 'fake-v1';
    if exists (select 1 from api.public_videos where youtube_id = 'fake-v1') then raise exception 'ASSERT FAIL: a sync resurrected an emergency-hidden video'; end if;
    -- by player: videos, slug and redirects go
    execute 'set local role service_role';
    j := public.admin_emergency_hide('fake-admin', 'player_id', v_new::text, 'takedown, test');
    execute 'reset role';
    if (select visibility from public.players where id = v_new) <> 'hidden' then raise exception 'ASSERT FAIL: emergency hide left a player visible'; end if;
    if exists (select 1 from api.public_players where id = v_new) then raise exception 'ASSERT FAIL: a hidden player is public'; end if;
    -- by name: hides plain-text participants too (approximate match)
    execute 'set local role service_role';
    j := public.admin_emergency_hide('fake-admin', 'name_normalized', 'Fake Zeta', 'takedown by name, test');
    execute 'reset role';
    if exists (select 1 from public.suppression where kind = 'name_normalized' and value <> 'fake zeta') then raise exception 'ASSERT FAIL: the suppressed name was not lower-cased'; end if;
    if (select hidden_reason from public.videos where youtube_id = 'fake-v2') <> 'emergency_hide' then raise exception 'ASSERT FAIL: a video with the suppressed plain-text name was not hidden'; end if;
    -- tournament
    execute 'set local role service_role';
    j := public.admin_emergency_hide('fake-admin', 'tournament_id', t_tn::text, 'organizer asked, test');
    execute 'reset role';
    if exists (select 1 from api.public_tournaments where slug = 'fake-open-2026') then raise exception 'ASSERT FAIL: a hidden tournament is public'; end if;
    if not exists (select 1 from public.slug_redirects where from_path = '/tournaments/fake-open-2026/' and http_status = 410) then raise exception 'ASSERT FAIL: a hidden tournament path is not 410'; end if;
    -- audit rows exist for every RPC
    for rec in select distinct action from public.audit_log loop null; end loop;
    foreach vid in array array['merge_players', 'split_player', 'rename_player', 'set_age_status', 'emergency_hide', 'update_player'] loop
      if not exists (select 1 from public.audit_log where action = vid) then raise exception 'ASSERT FAIL: no audit row for %', vid; end if;
    end loop;
    -- release stamps only
    execute 'set local role service_role';
    perform public.admin_release_suppression('fake-admin', (select id from public.suppression where kind = 'youtube_id' and value = 'fake-v1'), 'test');
    perform pg_temp.expect_fail(format($q$select public.admin_release_suppression('fake-admin', %L, 'again')$q$, (select id from public.suppression where kind = 'youtube_id' and value = 'fake-v1')), 'releasing twice');
    perform public.admin_update_video('fake-admin', 'fake-v1', '{"visibility": "public"}', true, 'owner decided to show it again');
    execute 'reset role';
    if not exists (select 1 from api.public_videos where youtube_id = 'fake-v1') and (select visibility from public.videos where youtube_id = 'fake-v1') <> 'public' then
      raise exception 'ASSERT FAIL: after release and an explicit admin update the video should be public';
    end if;
    -- locks set by the admin hold against the sync
    update public.videos set visibility = 'hidden' where youtube_id = 'fake-v1';
    if (select visibility from public.videos where youtube_id = 'fake-v1') <> 'public' then raise exception 'ASSERT FAIL: an admin lock did not hold against a sync write'; end if;

    -- match approval: only the admin RPC clears a minor hold
    update public.matches set minor_hold = true, publish_state = 'held' where id = m6;
    execute 'set local role service_role';
    perform public.admin_update_match('fake-admin', m6, '{"minor_hold": false, "publish_state": "published"}', false, 'parent consent, test');
    perform pg_temp.expect_fail(format($q$select public.admin_update_match('fake-admin', %L, '{"video_id": "x"}', true, 'r')$q$, m6), 'editing a field outside the whitelist');
    execute 'reset role';
    if (select publish_state from public.matches where id = m6) <> 'published' then raise exception 'ASSERT FAIL: admin_update_match could not publish'; end if;

    -- S2-9: a confirmed minor cannot be lifted by an ordinary call; the override is audited
    insert into public.players (id, display_name, name_normalized, age_status) values ('c1000000-0000-4000-8000-0000000000c1', 'Fake Minor', 'fake minor', 'minor_confirmed');
    execute 'set local role service_role';
    perform pg_temp.expect_fail($q$select public.admin_set_age_status('fake-admin', array['c1000000-0000-4000-8000-0000000000c1'::uuid], 'adult_confirmed', 'evidence', 'reason')$q$, 'lifting minor_confirmed without the override');
    perform pg_temp.expect_fail($q$select public.admin_set_age_status('fake-admin', array['c1000000-0000-4000-8000-0000000000c1'::uuid], 'adult_confirmed', 'evidence', 'reason', false)$q$, 'lifting minor_confirmed with override=false');
    perform public.admin_set_age_status('fake-admin', array['c1000000-0000-4000-8000-0000000000c1'::uuid], 'adult_confirmed', 'parent and ID proof, test', 'verified, test', true);
    execute 'reset role';
    if (select age_status from public.players where id = 'c1000000-0000-4000-8000-0000000000c1') <> 'adult_confirmed' then raise exception 'ASSERT FAIL: the audited override did not lift'; end if;
    if not exists (select 1 from public.audit_log where action = 'age_override_minor') then raise exception 'ASSERT FAIL: the override left no audit row'; end if;

    -- the public match slug is masked unless the match is full
    update public.matches set slug = 'fake-alpha-vs-fake-beta-v1', slug_kind = 'named' where id = m1;
    update public.matches set slug = 'fake-gamma-vs-fake-zeta-v2', slug_kind = 'named' where id = m2;
    if (select slug from api.public_matches where id = m2) like 'fake-%' then raise exception 'ASSERT FAIL: a named slug leaked from a non-full match'; end if;
    if (select slug from api.public_matches where id = m2) !~ '^match-[0-9a-f]{16}$' then raise exception 'ASSERT FAIL: the masked slug is not opaque'; end if;

    -- unlinked participant with a suppressed name hides the match (view level)
    insert into public.suppression (kind, value, reason, created_by) values ('name_normalized', 'fake yotta', 'test', 'fake-admin');
    insert into public.videos (youtube_id, title_raw, visibility) values ('fake-v8', 'FAKE YOTTA vs FAKE ZETA', 'public');
    insert into public.matches (id, video_id, publish_state) values ('d1000000-0000-4000-8000-0000000000d1', 'fake-v8', 'published');
    insert into public.match_participants (match_id, side, position, raw_name) values ('d1000000-0000-4000-8000-0000000000d1', 'A', 1, 'Fake Yotta');
    if exists (select 1 from api.public_videos where youtube_id = 'fake-v8') then raise exception 'ASSERT FAIL: a video naming a suppressed (unlinked) person is public'; end if;

    -- the anon role can read the views, and nothing in public
    execute 'set local role anon';
    perform count(*) from api.public_videos;
    perform count(*) from api.public_players;
    perform pg_temp.expect_fail($q$select count(*) from public.videos$q$, 'anon reading public.videos');
    perform pg_temp.expect_fail($q$select count(*) from public.tournament_private$q$, 'anon reading tournament_private');
    perform pg_temp.expect_fail($q$select count(*) from public.suppression$q$, 'anon reading suppression');
    perform pg_temp.expect_fail($q$select public.admin_mark_dirty('x', 'y', false)$q$, 'anon calling an admin RPC');
    perform pg_temp.expect_fail($q$select app.setting('unknown_match_mode')$q$, 'anon calling an app function');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0006_archive_api assertions passed' as result;
