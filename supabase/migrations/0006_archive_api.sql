-- 0006_archive_api.sql - M2: the PUBLIC read surface (schema api) and the admin RPCs.
--
-- Views (schema api, read with the PUBLISHABLE key; D-005): public_videos, public_matches, public_match_participants, public_players,
-- public_tournaments, public_slug_redirects, public_archive_modes.
--   * Explicit column lists, never `select *` (a test fails on `*`). Masking happens HERE, in SQL, so no page code can leak by mistake.
--   * The views are owned by the migration role (postgres) and are NOT security_invoker: anon holds NO privilege on any base table
--     (0001/0002/0004/0005 revoke everything), so a security_invoker view would return nothing. security_barrier = true stops a
--     caller's filter function from running before the masking predicates. Supabase's advisor lists definer views: accepted, see
--     docs/m2/schema-notes.md. The only privilege anon and authenticated hold in schema api is SELECT on these seven views.
--   * Protected rules (D-012), per match page, from app.video_page_mode: the worst effective age status of the participants decides
--     full | minimal | hidden. archive_settings.unknown_match_mode and minor_match_mode choose minimal or hidden. A minor signal in the
--     category, the age group, the tournament or the participants fails closed to the minor setting. Non-adult players never appear
--     with a name except as the raw YouTube title of a video the mode allows.
--   * Suppressed (tombstoned) videos, players, tournaments and hidden rows never appear.
--   * No private column appears: no description, organizer phone or email, age_signal, age evidence, leads, audit, settings other than modes.
--   * 410 (gone) paths are NOT public: they would name hidden entities. See docs/m2/schema-notes.md.
-- Admin RPCs (schema public, SECURITY DEFINER, EXECUTE only for service_role): merge, split, rename, age status, emergency hide,
-- release, update video, update match, mark dirty. Each writes an audit_log row and marks the site dirty. The Worker verifies the
-- admin's JWT (aal2, D-006) and passes the verified user id as p_actor; the database cannot verify the human itself.
-- Apply after 0005, then run supabase/checks/0006_assertions.sql.

create schema if not exists api;
revoke all on schema api from public;
grant usage on schema api to anon, authenticated;
alter default privileges for role postgres in schema api revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema api revoke all on functions from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- Internal views (schema app, owned by the migration role, NO privilege for anon or authenticated, schema not exposed)
-- Why views and not functions: PostgreSQL checks EXECUTE on a function called inside a view against the CALLING role, not the view owner,
-- so an anon query would need EXECUTE on every helper. Tables and views a view reads are checked against the owner. So the logic lives in
-- internal views, and the anon role can execute nothing (a check proves it). The api views join them.
-- ------------------------------------------------------------------------------------------------------------------
create view app.suppressed_keys as
select s.kind, s.value from public.suppression s where s.released_at is null;

-- How a video's match page may be built: none (no parsed match), full, minimal, hidden. Fail-closed (D-012):
--   the worst effective age status of the participants decides (a parser "unknown" does not override an adult_confirmed player; a minor
--   signal on either side wins; no participants = unknown), a minor signal in the category, age group (up to U19, U21 is not one) or
--   tournament forces at least minor_suspected, a suppressed participant or video hides, and a held, duplicate or minor_hold match hides.
create view app.video_mode as
select
  v.youtube_id,
  case
    when exists (select 1 from app.suppressed_keys k where k.kind = 'youtube_id' and k.value = v.youtube_id) then 'hidden'
    when m.id is null then 'none'
    when m.duplicate_of is not null or m.publish_state <> 'published' or m.minor_hold then 'hidden'
    when agg.suppressed then 'hidden'
    when agg.worst = 0 then 'full'
    when agg.worst = 1 then case (select s.value from public.archive_settings s where s.key = 'unknown_match_mode') when 'noindex_minimal' then 'minimal' else 'hidden' end
    else case (select s.value from public.archive_settings s where s.key = 'minor_match_mode') when 'noindex_minimal' then 'minimal' else 'hidden' end
  end as mode
from public.videos v
left join public.matches m on m.video_id = v.youtube_id
left join public.tournaments t on t.id = m.tournament_id
cross join lateral (
  select
    greatest(
      case when count(mp.id) = 0 then 1 else coalesce(max(
        case
          when pl.id is null then case mp.age_status when 'adult_confirmed' then 0 when 'unknown' then 1 when 'minor_suspected' then 2 else 3 end
          when pl.age_status = 'adult_confirmed' and mp.age_status = 'unknown' then 0
          else greatest(case mp.age_status when 'adult_confirmed' then 0 when 'unknown' then 1 when 'minor_suspected' then 2 else 3 end,
                        case pl.age_status when 'adult_confirmed' then 0 when 'unknown' then 1 when 'minor_suspected' then 2 else 3 end)
        end), 1) end,
      case
        when coalesce(t.is_minor_signal, false) or coalesce(m.category in ('BS', 'GS', 'BD', 'GD'), false)
          or coalesce(m.age_group ~ '^U([0-9]|1[0-9])$', false) or coalesce(m.age_group in ('sub_junior', 'junior', 'youth', 'cadet', 'mini'), false)
        then 2 else 0
      end
    ) as worst,
    coalesce(bool_or(
      mp.resolution = 'suppressed'
      or exists (select 1 from app.suppressed_keys k where k.kind = 'name_normalized' and k.value = btrim(regexp_replace(regexp_replace(lower(mp.raw_name), '[!-/:-@[-`{-~]', ' ', 'g'), '[[:space:]]+', ' ', 'g')))
      or exists (select 1 from app.suppressed_keys k where (k.kind = 'player_id' and k.value = pl.id::text) or (k.kind = 'name_normalized' and k.value = pl.name_normalized))
    ), false) as suppressed
  from public.match_participants mp
  left join public.players pl on pl.id = mp.player_id
  where mp.match_id = m.id
) agg;

-- A tournament the site may show (D-018: non-Tamil-Nadu events only when archive_settings.non_tn_tournament_pages = on).
create view app.public_tournament_ids as
select t.id
from public.tournaments t
where t.visibility in ('public', 'listed_no_player_pages')
  and t.region <> 'international'
  and (t.region = 'tamil_nadu' or (select s.value from public.archive_settings s where s.key = 'non_tn_tournament_pages') = 'on')
  and t.status not in ('cancelled', 'rejected')
  and (t.source <> 'submitted' or t.status in ('published', 'completed'))
  and not exists (select 1 from app.suppressed_keys k where k.kind = 'tournament_id' and k.value = t.id::text);

-- D-013: a player page exists only for an adult_confirmed, non-provisional, unmerged, unsuppressed player who has a confirmed alias or at
-- least 3 published matches, and who appears in at least one fully public video (D-018: listed-only videos give no player page).
create view app.eligible_players as
select p.id
from public.players p
where p.age_status = 'adult_confirmed'
  and p.visibility = 'public'
  and not p.is_provisional
  and p.merged_into is null
  and not exists (select 1 from app.suppressed_keys k where (k.kind = 'player_id' and k.value = p.id::text) or (k.kind = 'name_normalized' and k.value = p.name_normalized))
  and exists (
    select 1 from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    join public.videos v on v.youtube_id = m.video_id
    where mp.player_id = p.id and m.publish_state = 'published' and m.duplicate_of is null and v.visibility = 'public'
      and not exists (select 1 from app.suppressed_keys k where k.kind = 'youtube_id' and k.value = v.youtube_id)
  )
  and (
    exists (select 1 from public.player_aliases a where a.player_id = p.id and a.status = 'confirmed')
    or (
      select count(distinct m.id)
      from public.match_participants mp
      join public.matches m on m.id = mp.match_id
      join public.videos v on v.youtube_id = m.video_id
      where mp.player_id = p.id and m.publish_state = 'published' and m.duplicate_of is null and v.visibility = 'public'
    ) >= 3
  );

-- ------------------------------------------------------------------------------------------------------------------
-- Public views (schema api)
-- ------------------------------------------------------------------------------------------------------------------
create view api.public_videos with (security_barrier = true) as
select
  v.youtube_id,
  v.title_raw,
  v.published_at,
  v.duration_s,
  v.views,
  v.likes,
  v.stats_fetched_at,
  v.thumbnail_url,
  v.embeddable,
  v.type,
  v.live_status,
  v.was_live,
  v.visibility,
  case x.mode when 'full' then 'full' when 'minimal' then 'minimal' else 'none' end as page_mode,
  (x.mode = 'minimal') as noindex
from public.videos v
join app.video_mode x on x.youtube_id = v.youtube_id
where v.visibility in ('public', 'listed_no_player_pages')
  and x.mode <> 'hidden';

create view api.public_matches with (security_barrier = true) as
select
  m.id,
  m.video_id,
  case when x.mode = 'full' then m.slug else 'match-' || substr(replace(m.id::text, '-', ''), 1, 16) end as slug,
  case when m.tournament_id in (select pt.id from app.public_tournament_ids pt) then m.tournament_id else null end as tournament_id,
  m.category,
  case when x.mode = 'full' then m.age_group else null end as age_group,
  m.round,
  m.format,
  m.played_on,
  x.mode as page_mode,
  (x.mode = 'minimal') as noindex
from public.matches m
join public.videos v on v.youtube_id = m.video_id
join app.video_mode x on x.youtube_id = m.video_id
where v.visibility in ('public', 'listed_no_player_pages')
  and x.mode in ('full', 'minimal')
  and m.publish_state = 'published'
  and m.duplicate_of is null;

-- Names appear ONLY for fully adult matches. A player slug appears only when that player has a public page and the video is fully public.
create view api.public_match_participants with (security_barrier = true) as
select
  mp.match_id,
  mp.side,
  mp.position,
  mp.raw_name,
  case when v.visibility = 'public' and ep.id is not null then pl.slug else null end as player_slug
from public.match_participants mp
join public.matches m on m.id = mp.match_id
join public.videos v on v.youtube_id = m.video_id
join app.video_mode x on x.youtube_id = m.video_id
left join public.players pl on pl.id = mp.player_id
left join app.eligible_players ep on ep.id = mp.player_id
where v.visibility in ('public', 'listed_no_player_pages')
  and x.mode = 'full'
  and m.publish_state = 'published'
  and m.duplicate_of is null
  and mp.resolution <> 'suppressed';

create view api.public_players with (security_barrier = true) as
select
  p.id,
  p.slug,
  p.display_name,
  p.disambiguator,
  p.district,
  p.photo_path,
  p.bio,
  p.instagram_handle,
  p.claimed,
  p.noindex
from public.players p
join app.eligible_players ep on ep.id = p.id
where p.age_status = 'adult_confirmed'
  and p.visibility = 'public';

create view api.public_tournaments with (security_barrier = true) as
select
  t.id,
  t.slug,
  t.name,
  t.series_key,
  t.edition_year,
  t.edition_no,
  t.season_label,
  t.level,
  t.region,
  t.city,
  t.district,
  t.venue,
  t.start_date,
  t.end_date,
  t.categories,
  t.entry_info,
  t.registration_url,
  t.poster_path,
  t.status,
  t.is_featured,
  t.featured_until,
  t.covered_by_power_smash,
  t.visibility,
  case when t.show_contact_public then tp.organizer_name else null end as organizer_name,
  c.match_count,
  (c.match_count >= 3 or t.is_promoted) as page_eligible
from public.tournaments t
join app.public_tournament_ids pt on pt.id = t.id
left join public.tournament_private tp on tp.tournament_id = t.id
cross join lateral (
  select count(*)::integer as match_count
  from public.matches m
  join public.videos v on v.youtube_id = m.video_id
  join app.video_mode x on x.youtube_id = m.video_id
  where m.tournament_id = t.id and m.publish_state = 'published' and m.duplicate_of is null
    and v.visibility in ('public', 'listed_no_player_pages')
    and x.mode in ('full', 'minimal')
) c;

-- Only 301 rows whose target is a public page. The old path is exposed on purpose (a public redirect), the target must be public.
create view api.public_slug_redirects with (security_barrier = true) as
select r.from_path, r.to_path, r.entity_type
from public.slug_redirects r
where r.http_status = 301
  and r.to_path is not null
  and (
    (r.entity_type = 'player' and exists (
      select 1 from public.players p join app.eligible_players ep on ep.id = p.id where '/players/' || p.slug || '/' = r.to_path))
    or (r.entity_type = 'tournament' and exists (
      select 1 from public.tournaments t join app.public_tournament_ids pt on pt.id = t.id where '/tournaments/' || t.slug || '/' = r.to_path))
  );

create view api.public_archive_modes with (security_barrier = true) as
select s.key, s.value
from public.archive_settings s
where s.key in ('unknown_match_mode', 'minor_match_mode', 'non_tn_tournament_pages');


comment on view api.public_videos is 'Public. Videos the site may list; protected-match rules applied (a hidden match is absent). description, parse data, flags are not exposed.';
comment on view api.public_matches is 'Public. Matches in full or minimal mode only. age_group is masked outside full mode.';
comment on view api.public_match_participants is 'Public. Names of participants of FULL (all-adult) matches only.';
comment on view api.public_players is 'Public. adult_confirmed players with a page (D-013). Protected players are never here.';
comment on view api.public_tournaments is 'Public. No organizer phone or email; organizer name only with consent.';
comment on view api.public_slug_redirects is 'Public. 301 redirects to public pages only. 410 rows are private.';
comment on view api.public_archive_modes is 'Public. The protected-mode switches the layout flags read.';

revoke all on all tables in schema api from public, anon, authenticated;
revoke all on all tables in schema app from public, anon, authenticated;
grant select on api.public_videos to anon, authenticated;
grant select on api.public_matches to anon, authenticated;
grant select on api.public_match_participants to anon, authenticated;
grant select on api.public_players to anon, authenticated;
grant select on api.public_tournaments to anon, authenticated;
grant select on api.public_slug_redirects to anon, authenticated;
grant select on api.public_archive_modes to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- Audit helper and the hide helper (not callable by API roles)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.audit(p_actor text, p_action text, p_entity text, p_entity_id text, p_diff jsonb, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'an admin action needs the verified actor id' using errcode = '22023';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, diff, reason)
    values (p_actor, p_action, p_entity, p_entity_id, p_diff, p_reason)
    returning id into v_id;
  return v_id;
end;
$$;

-- Hide one player completely: hidden, noindex, opaque slug, the old public path gone (410) and every redirect that led to it.
create or replace function app.hide_player(p_player uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players%rowtype;
  old_path text;
  v_videos integer := 0;
  v_redirects integer := 0;
begin
  select * into p from public.players where id = p_player for update;
  if not found then
    return jsonb_build_object('videos', 0, 'redirects', 0, 'found', false);
  end if;
  perform set_config('app.override_bypass', 'on', true);
  if p.slug_kind = 'named' then
    old_path := app.player_path(p.slug);
    update public.slug_redirects set http_status = 410, to_path = null where to_path = old_path;
    get diagnostics v_redirects = row_count;
    insert into public.slug_redirects (from_path, to_path, http_status, entity_type, entity_id)
      values (old_path, null, 410, 'player', p.id::text)
      on conflict (from_path) do update set to_path = null, http_status = 410, entity_type = 'player', entity_id = p.id::text;
  end if;
  -- older paths of the same player (301 rows pointing at the current page) are now 410 as well
  update public.slug_redirects set http_status = 410, to_path = null where entity_type = 'player' and entity_id = p.id::text and http_status = 301;
  perform app.retire_match_slugs(p.id);
  update public.players
     set visibility = 'hidden', noindex = true,
         slug = case when slug_kind = 'named' then 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) else slug end,
         slug_kind = 'opaque'
   where id = p.id;
  -- their videos: hidden and locked, so a reparse cannot bring them back
  with hit as (
    update public.videos v
       set visibility = 'hidden', hidden_reason = 'emergency_hide', hidden_at = coalesce(v.hidden_at, now()),
           manual_override = v.manual_override || '{"visibility": true}'::jsonb
     where v.youtube_id in (
       select m.video_id from public.matches m join public.match_participants mp on mp.match_id = m.id where mp.player_id = p.id
     ) and v.visibility <> 'hidden'
    returning 1
  )
  select count(*) into v_videos from hit;
  return jsonb_build_object('videos', v_videos, 'redirects', v_redirects, 'found', true);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Admin RPCs
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_mark_dirty(p_actor text, p_reason text, p_urgent boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.audit(p_actor, 'mark_dirty', 'site_state', '1', jsonb_build_object('urgent', coalesce(p_urgent, false)), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty(coalesce(p_reason, 'admin'), coalesce(p_urgent, false));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_merge_players(p_actor text, p_from uuid, p_into uuid, p_reason text, p_override_age boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.players%rowtype;
  b public.players%rowtype;
  v_status text;
  v_moved integer;
  v_old_path text;
  v_new_path text;
  v_audit bigint;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'a merge needs a reason' using errcode = '22023'; end if;
  if p_from is null or p_into is null or p_from = p_into then raise exception 'SAME_PLAYER: merge needs two different players' using errcode = '22023'; end if;
  -- lock in id order (no deadlock between two merges)
  perform 1 from public.players where id in (p_from, p_into) order by id for update;
  select * into a from public.players where id = p_from;
  select * into b from public.players where id = p_into;
  if a.id is null or b.id is null then raise exception 'NOT_FOUND: player not found' using errcode = 'P0002'; end if;
  if a.merged_into is not null or b.merged_into is not null then raise exception 'ALREADY_MERGED: a merged player cannot be merged again' using errcode = '22023'; end if;
  if app.is_suppressed('player_id', a.id::text) or app.is_suppressed('player_id', b.id::text)
     or app.is_suppressed('name_normalized', a.name_normalized) or app.is_suppressed('name_normalized', b.name_normalized) then
    raise exception 'SUPPRESSED: a suppressed player cannot be merged (D-014)' using errcode = '42501';
  end if;
  -- D-012: a merge between a minor status and adult_confirmed needs an explicit, logged override
  if ((a.age_status = 'adult_confirmed' and b.age_status in ('minor_confirmed', 'minor_suspected'))
      or (b.age_status = 'adult_confirmed' and a.age_status in ('minor_confirmed', 'minor_suspected')))
     and not coalesce(p_override_age, false) then
    raise exception 'MINOR_ADULT_MERGE_BLOCKED: merge between a minor status and adult_confirmed needs p_override_age (D-012)' using errcode = '42501';
  end if;
  v_status := case when app.age_rank(a.age_status) >= app.age_rank(b.age_status) then a.age_status else b.age_status end;

  perform set_config('app.override_bypass', 'on', true);

  update public.match_participants set player_id = b.id where player_id = a.id;
  get diagnostics v_moved = row_count;

  -- aliases: the survivor gets every alias (and the merged name), the merged player's own aliases stop resolving (rejected)
  insert into public.player_aliases (alias_normalized, player_id, status, scope_tournament_id, scope_district, created_by)
    select x.alias_normalized, b.id, x.status, x.scope_tournament_id, x.scope_district, p_actor
      from public.player_aliases x where x.player_id = a.id and x.status <> 'rejected'
    on conflict (alias_normalized, player_id) do nothing;
  insert into public.player_aliases (alias_normalized, player_id, status, created_by)
    values (a.name_normalized, b.id, 'confirmed', p_actor)
    on conflict (alias_normalized, player_id) do nothing;
  update public.player_aliases set status = 'rejected' where player_id = a.id;

  -- both sides of one match now hold the same player: hold the match for review (DUP_ALIAS_IN_MATCH)
  update public.matches set publish_state = 'held'
   where id in (select match_id from public.match_participants where player_id = b.id group by match_id having count(distinct side) > 1);

  -- survivor: the more restrictive status; signals accumulate (the guard trigger keeps the rest consistent)
  update public.players
     set age_status = v_status,
         age_signal = (select coalesce(array_agg(distinct s order by s), '{}'::text[]) from unnest(a.age_signal || b.age_signal) as s)
   where id = b.id;
  update public.players set merged_into = b.id, visibility = 'hidden', noindex = true where id = a.id;

  -- redirects (no chains): the old path goes to the survivor's public page, or is gone (410) when the survivor has none
  if a.slug_kind = 'named' then
    v_old_path := app.player_path(a.slug);
    select app.player_path(slug) into v_new_path from public.players where id = b.id and visibility = 'public' and age_status = 'adult_confirmed';
    if v_new_path is not null then
      insert into public.slug_redirects (from_path, to_path, http_status, entity_type, entity_id)
        values (v_old_path, v_new_path, 301, 'player', b.id::text)
        on conflict (from_path) do update set to_path = excluded.to_path, http_status = 301, entity_type = 'player', entity_id = excluded.entity_id;
      update public.slug_redirects set to_path = v_new_path where to_path = v_old_path and from_path <> v_new_path;
    else
      insert into public.slug_redirects (from_path, to_path, http_status, entity_type, entity_id)
        values (v_old_path, null, 410, 'player', a.id::text)
        on conflict (from_path) do update set to_path = null, http_status = 410, entity_type = 'player', entity_id = excluded.entity_id;
      update public.slug_redirects set http_status = 410, to_path = null where to_path = v_old_path;
    end if;
  end if;

  v_audit := app.audit(p_actor, 'merge_players', 'players', b.id::text,
    jsonb_build_object('from', a.id, 'into', b.id, 'moved_participants', v_moved, 'age_from', a.age_status, 'age_into', b.age_status, 'age_result', v_status, 'override_age', coalesce(p_override_age, false)),
    p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('merge players', false);
  return jsonb_build_object('survivor', b.id, 'merged', a.id, 'moved_participants', v_moved, 'age_status', v_status, 'audit_id', v_audit);
end;
$$;

create or replace function public.admin_split_player(
  p_actor text, p_player uuid, p_participant_ids uuid[], p_new_display_name text, p_new_name_normalized text, p_reason text, p_new_slug text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.players%rowtype;
  v_new uuid := gen_random_uuid();
  v_count integer;
  v_scope uuid;
  v_slug text;
  v_kind text := 'opaque';
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'a split needs a reason' using errcode = '22023'; end if;
  if p_participant_ids is null or cardinality(p_participant_ids) = 0 then raise exception 'a split needs the participants to move' using errcode = '22023'; end if;
  if p_new_display_name is null or length(btrim(p_new_display_name)) = 0 or p_new_name_normalized is null or length(btrim(p_new_name_normalized)) = 0 then
    raise exception 'EMPTY_NAME: a split needs a display name and a normalised name for the new player' using errcode = '22023';
  end if;
  select * into a from public.players where id = p_player for update;
  if not found then raise exception 'NOT_FOUND: player not found' using errcode = 'P0002'; end if;
  if a.merged_into is not null then raise exception 'ALREADY_MERGED: a merged player cannot be split' using errcode = '22023'; end if;
  if app.is_suppressed('player_id', a.id::text) or app.is_suppressed('name_normalized', p_new_name_normalized) then
    raise exception 'SUPPRESSED: suppressed (D-014)' using errcode = '42501';
  end if;
  select count(*) into v_count from public.match_participants where id = any (p_participant_ids) and player_id = a.id;
  if v_count <> cardinality(p_participant_ids) then raise exception 'every participant to move must belong to the player' using errcode = '22023'; end if;

  perform set_config('app.override_bypass', 'on', true);
  -- the new player inherits the age status and signals (D-012); adult_confirmed needs the lift switch for this one insert
  if a.age_status = 'adult_confirmed' then
    perform set_config('app.age_lift_ok', 'on', true);
    if p_new_slug is not null and p_new_slug ~ '^[a-z0-9][a-z0-9-]{0,80}$' and p_new_slug !~ '^p-[0-9a-f]{16}$' then
      v_slug := p_new_slug;
      v_kind := 'named';
    end if;
  end if;
  insert into public.players (id, slug, slug_kind, display_name, name_normalized, identity_tier, age_status, age_signal,
                              age_confirmed_by, age_confirmed_at, age_confirmed_evidence, is_provisional, created_source)
  values (v_new,
          coalesce(v_slug, 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
          v_kind, p_new_display_name, p_new_name_normalized, a.identity_tier, a.age_status, a.age_signal,
          case when a.age_status = 'adult_confirmed' then p_actor end,
          case when a.age_status = 'adult_confirmed' then now() end,
          case when a.age_status = 'adult_confirmed' then 'inherited by split of player ' || a.id::text end,
          true, 'admin');
  perform set_config('app.age_lift_ok', 'off', true);

  update public.match_participants set player_id = v_new, resolution = 'manual' where id = any (p_participant_ids);
  -- a split survives a reparse: the participants of those matches are locked (PC-20)
  update public.matches set manual_override = manual_override || '{"participants": true}'::jsonb
   where id in (select match_id from public.match_participants where id = any (p_participant_ids));

  select m.tournament_id into v_scope from public.match_participants mp join public.matches m on m.id = mp.match_id
   where mp.id = any (p_participant_ids) and m.tournament_id is not null limit 1;
  insert into public.player_aliases (alias_normalized, player_id, status, scope_tournament_id, created_by)
    values (p_new_name_normalized, v_new, 'provisional', v_scope, p_actor)
    on conflict (alias_normalized, player_id) do nothing;

  perform app.audit(p_actor, 'split_player', 'players', a.id::text,
    jsonb_build_object('from', a.id, 'new_player', v_new, 'participants', to_jsonb(p_participant_ids), 'age_status', a.age_status), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('split player', false);
  return v_new;
end;
$$;

create or replace function public.admin_rename_player(
  p_actor text, p_player uuid, p_display_name text, p_name_normalized text, p_reason text, p_new_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.players%rowtype;
  v_old_path text;
  v_new_path text;
  v_slug_changed boolean := false;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'a rename needs a reason' using errcode = '22023'; end if;
  if p_display_name is null or length(btrim(p_display_name)) = 0 or p_name_normalized is null or length(btrim(p_name_normalized)) = 0 then
    raise exception 'EMPTY_NAME: a rename needs a display name and a normalised name' using errcode = '22023';
  end if;
  select * into a from public.players where id = p_player for update;
  if not found then raise exception 'NOT_FOUND: player not found' using errcode = 'P0002'; end if;
  if app.is_suppressed('player_id', a.id::text) or app.is_suppressed('name_normalized', p_name_normalized) then
    raise exception 'SUPPRESSED: suppressed (D-014)' using errcode = '42501';
  end if;
  perform set_config('app.override_bypass', 'on', true);
  update public.players set display_name = p_display_name, name_normalized = p_name_normalized,
         manual_override = manual_override || '{"display_name": true}'::jsonb
   where id = a.id;
  -- the old name keeps resolving to this player
  insert into public.player_aliases (alias_normalized, player_id, status, created_by)
    select distinct x.alias, a.id, 'confirmed', p_actor from (values (a.name_normalized), (p_name_normalized)) as x(alias)
    on conflict (alias_normalized, player_id) do update set status = 'confirmed';

  -- a named slug exists only for adults (the table check enforces it); the old path redirects to the new one
  if p_new_slug is not null and a.age_status = 'adult_confirmed' and p_new_slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'
     and p_new_slug !~ '^p-[0-9a-f]{16}$' and p_new_slug <> a.slug then
    update public.players set slug = p_new_slug, slug_kind = 'named', manual_override = manual_override || '{"slug": true}'::jsonb where id = a.id;
    v_slug_changed := true;
    v_old_path := app.player_path(a.slug);
    v_new_path := app.player_path(p_new_slug);
    if a.slug_kind = 'named' and (select visibility from public.players where id = a.id) = 'public' then
      insert into public.slug_redirects (from_path, to_path, http_status, entity_type, entity_id)
        values (v_old_path, v_new_path, 301, 'player', a.id::text)
        on conflict (from_path) do update set to_path = excluded.to_path, http_status = 301;
      update public.slug_redirects set to_path = v_new_path where to_path = v_old_path and from_path <> v_new_path;
    end if;
  end if;
  perform app.audit(p_actor, 'rename_player', 'players', a.id::text,
    jsonb_build_object('old_display_name', a.display_name, 'new_display_name', p_display_name, 'slug_changed', v_slug_changed), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('rename player', false);
  return jsonb_build_object('player', a.id, 'slug_changed', v_slug_changed);
end;
$$;

create or replace function public.admin_set_age_status(p_actor text, p_player_ids uuid[], p_status text, p_evidence text, p_reason text, p_override_minor boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.players%rowtype;
  v_id uuid;
  v_n integer := 0;
begin
  if p_status not in ('adult_confirmed', 'minor_confirmed', 'minor_suspected', 'unknown') then raise exception 'unknown age status' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'an age change needs a reason' using errcode = '22023'; end if;
  if p_status = 'adult_confirmed' and (p_evidence is null or length(btrim(p_evidence)) = 0) then
    raise exception 'adult_confirmed needs the evidence (an admin review or a verified claim, D-012)' using errcode = '22023';
  end if;
  perform set_config('app.override_bypass', 'on', true);
  perform set_config('app.age_lift_ok', 'on', true);
  foreach v_id in array coalesce(p_player_ids, '{}'::uuid[]) loop
    select * into r from public.players where id = v_id for update;
    if not found then raise exception 'NOT_FOUND: player % not found', v_id using errcode = 'P0002'; end if;
    if r.merged_into is not null then raise exception 'ALREADY_MERGED: player % was merged', v_id using errcode = '22023'; end if;
    if p_status = 'adult_confirmed' and (app.is_suppressed('player_id', r.id::text) or app.is_suppressed('name_normalized', r.name_normalized)) then
      raise exception 'SUPPRESSED: player % is suppressed (D-014)', v_id using errcode = '42501';
    end if;
    -- S2-9 / D-012 / D-015: a CONFIRMED minor is never lifted by an ordinary call; only an explicit, logged override (with evidence and a reason) may
    if r.age_status = 'minor_confirmed' and p_status = 'adult_confirmed' and not coalesce(p_override_minor, false) then
      raise exception 'player % is minor_confirmed: lifting to adult_confirmed needs p_override_minor (audited, D-012)', v_id using errcode = '42501';
    end if;
    update public.players
       set age_status = p_status,
           age_confirmed_by = case when p_status = 'adult_confirmed' then p_actor end,
           age_confirmed_at = case when p_status = 'adult_confirmed' then now() end,
           age_confirmed_evidence = case when p_status = 'adult_confirmed' then p_evidence end,
           noindex = case when p_status = 'adult_confirmed' then false else true end
     where id = v_id;
    perform app.audit(p_actor, case when r.age_status = 'minor_confirmed' and p_status = 'adult_confirmed' then 'age_override_minor' else 'set_age_status' end, 'players', v_id::text,
      jsonb_build_object('old', r.age_status, 'new', p_status, 'evidence_given', p_evidence is not null), p_reason);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.age_lift_ok', 'off', true);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('age status', false);
  return v_n;
end;
$$;

create or replace function public.admin_emergency_hide(
  p_actor text, p_kind text, p_value text, p_reason text, p_received_at timestamptz default null, p_requested_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid;
  v_now timestamptz := now();
  v_videos integer := 0;
  v_players integer := 0;
  v_tours integer := 0;
  v_redirects integer := 0;
  v_hit jsonb;
  v_pid uuid;
  v_old_path text;
  v_slug text;
begin
  if p_kind not in ('youtube_id', 'player_id', 'name_normalized', 'tournament_id') then raise exception 'unknown kind' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'an emergency hide needs a reason' using errcode = '22023'; end if;
  if p_kind = 'name_normalized' then p_value := lower(btrim(p_value)); end if;
  perform set_config('app.override_bypass', 'on', true);

  insert into public.suppression (kind, value, action, reason, requested_by, received_at, created_by)
    values (p_kind, p_value, 'hide', p_reason, p_requested_by, coalesce(p_received_at, v_now), p_actor)
    on conflict (kind, value) do update
      set released_at = null, released_by = null, release_reason = null, reason = excluded.reason,
          requested_by = excluded.requested_by, received_at = excluded.received_at
    returning id into v_sid;

  if p_kind = 'youtube_id' then
    update public.videos set visibility = 'hidden', hidden_reason = 'emergency_hide', hidden_at = coalesce(hidden_at, v_now),
           manual_override = manual_override || '{"visibility": true}'::jsonb
     where youtube_id = p_value;
    get diagnostics v_videos = row_count;
    update public.matches set publish_state = 'held' where video_id = p_value;
    delete from public.slug_redirects where entity_id = p_value and entity_type in ('video', 'match');
    get diagnostics v_redirects = row_count;
  elsif p_kind = 'player_id' then
    v_hit := app.hide_player(p_value::uuid, p_actor);
    v_players := case when (v_hit ->> 'found')::boolean then 1 else 0 end;
    v_videos := (v_hit ->> 'videos')::integer;
    v_redirects := (v_hit ->> 'redirects')::integer;
  elsif p_kind = 'name_normalized' then
    for v_pid in select id from public.players where name_normalized = p_value loop
      v_hit := app.hide_player(v_pid, p_actor);
      v_players := v_players + 1;
      v_videos := v_videos + (v_hit ->> 'videos')::integer;
      v_redirects := v_redirects + (v_hit ->> 'redirects')::integer;
    end loop;
    -- unlinked plain-text participants with the same name (approximate: lower-cased, punctuation removed): hide those videos too
    with hit as (
      update public.videos v
         set visibility = 'hidden', hidden_reason = 'emergency_hide', hidden_at = coalesce(v.hidden_at, v_now),
             manual_override = v.manual_override || '{"visibility": true}'::jsonb
       where v.visibility <> 'hidden' and v.youtube_id in (
         select m.video_id from public.matches m join public.match_participants mp on mp.match_id = m.id
          where btrim(regexp_replace(lower(regexp_replace(mp.raw_name, '[^[:alnum:][:space:]]', ' ', 'g')), '[[:space:]]+', ' ', 'g')) = p_value
       )
      returning 1
    )
    select v_videos + count(*) into v_videos from hit;
  else
    select slug into v_slug from public.tournaments where id = p_value::uuid;
    update public.tournaments set visibility = 'hidden', manual_override = manual_override || '{"visibility": true}'::jsonb where id = p_value::uuid;
    get diagnostics v_tours = row_count;
    if v_slug is not null then
      v_old_path := '/tournaments/' || v_slug || '/';
      update public.slug_redirects set http_status = 410, to_path = null where to_path = v_old_path or (entity_type = 'tournament' and entity_id = p_value);
      get diagnostics v_redirects = row_count;
      insert into public.slug_redirects (from_path, to_path, http_status, entity_type, entity_id)
        values (v_old_path, null, 410, 'tournament', p_value)
        on conflict (from_path) do update set to_path = null, http_status = 410;
    end if;
  end if;

  perform app.audit(p_actor, 'emergency_hide', 'suppression', v_sid::text,
    jsonb_build_object('kind', p_kind, 'videos', v_videos, 'players', v_players, 'tournaments', v_tours, 'redirects', v_redirects,
                       'received_at', coalesce(p_received_at, v_now), 'hidden_at', v_now), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('emergency hide', true);
  return jsonb_build_object(
    'suppression_id', v_sid, 'hidden_at', v_now, 'videos_hidden', v_videos, 'players_hidden', v_players,
    'tournaments_hidden', v_tours, 'redirects_removed', v_redirects,
    'owner_checklist', jsonb_build_array('deploy_now', 'purge_cache_for_urls', 'set_youtube_video_private', 'search_console_removals_request'));
end;
$$;

-- A release stamps the tombstone; it does NOT show anything again. Videos stay hidden and locked until an admin unhides them.
create or replace function public.admin_release_suppression(p_actor text, p_suppression_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.suppression%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'a release needs a reason' using errcode = '22023'; end if;
  select * into s from public.suppression where id = p_suppression_id for update;
  if not found then raise exception 'NOT_FOUND: suppression not found' using errcode = 'P0002'; end if;
  if s.released_at is not null then raise exception 'already released' using errcode = '22023'; end if;
  update public.suppression set released_at = now(), released_by = p_actor, release_reason = p_reason where id = s.id;
  perform app.audit(p_actor, 'release_suppression', 'suppression', s.id::text, jsonb_build_object('kind', s.kind), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('suppression released', false);
  return jsonb_build_object('released', s.id, 'note', 'nothing was unhidden; use the admin to show an item again');
end;
$$;

create or replace function public.admin_update_video(p_actor text, p_video_id text, p_changes jsonb, p_lock boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.videos%rowtype;
  v_keys text[];
  v_bad text[];
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'an edit needs a reason' using errcode = '22023'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'p_changes must be an object' using errcode = '22023'; end if;
  select array_agg(k) into v_keys from jsonb_object_keys(p_changes) k;
  select array_agg(k) into v_bad from jsonb_object_keys(p_changes) k where k not in ('type', 'parse_status', 'is_international', 'visibility');
  if v_bad is not null then raise exception 'fields that cannot be edited here: %', v_bad using errcode = '22023'; end if;
  select * into v from public.videos where youtube_id = p_video_id for update;
  if not found then raise exception 'NOT_FOUND: video not found' using errcode = 'P0002'; end if;
  perform set_config('app.override_bypass', 'on', true);
  update public.videos set
    type = case when p_changes ? 'type' then p_changes ->> 'type' else type end,
    parse_status = case when p_changes ? 'parse_status' then p_changes ->> 'parse_status' else parse_status end,
    is_international = case when p_changes ? 'is_international' then (p_changes ->> 'is_international')::boolean else is_international end,
    visibility = case when p_changes ? 'visibility' then p_changes ->> 'visibility' else visibility end,
    override_stale = false,
    manual_override = case
      when v_keys is null then manual_override
      when coalesce(p_lock, true) then manual_override || (select jsonb_object_agg(k, true) from unnest(v_keys) k)
      else manual_override - v_keys end
  where youtube_id = p_video_id;
  perform app.audit(p_actor, 'update_video', 'videos', p_video_id, jsonb_build_object('changes', p_changes, 'lock', coalesce(p_lock, true)), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('video edited', false);
  return (select jsonb_build_object('youtube_id', youtube_id, 'type', type, 'parse_status', parse_status, 'is_international', is_international, 'visibility', visibility)
            from public.videos where youtube_id = p_video_id);
end;
$$;

create or replace function public.admin_update_match(p_actor text, p_match_id uuid, p_changes jsonb, p_lock boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches%rowtype;
  v_bad text[];
  v_lockable text[];
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'an edit needs a reason' using errcode = '22023'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'p_changes must be an object' using errcode = '22023'; end if;
  select array_agg(k) into v_bad from jsonb_object_keys(p_changes) k
   where k not in ('tournament_id', 'category', 'age_group', 'round', 'format', 'played_on', 'publish_state', 'minor_hold');
  if v_bad is not null then raise exception 'fields that cannot be edited here: %', v_bad using errcode = '22023'; end if;
  select array_agg(k) into v_lockable from jsonb_object_keys(p_changes) k where k in ('tournament_id', 'category', 'age_group', 'round', 'format', 'played_on');
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'NOT_FOUND: match not found' using errcode = 'P0002'; end if;
  perform set_config('app.override_bypass', 'on', true);
  update public.matches set
    tournament_id = case when p_changes ? 'tournament_id' then (p_changes ->> 'tournament_id')::uuid else tournament_id end,
    category = case when p_changes ? 'category' then p_changes ->> 'category' else category end,
    age_group = case when p_changes ? 'age_group' then p_changes ->> 'age_group' else age_group end,
    round = case when p_changes ? 'round' then p_changes ->> 'round' else round end,
    format = case when p_changes ? 'format' then p_changes ->> 'format' else format end,
    played_on = case when p_changes ? 'played_on' then (p_changes ->> 'played_on')::date else played_on end,
    minor_hold = case when p_changes ? 'minor_hold' then (p_changes ->> 'minor_hold')::boolean else minor_hold end,
    publish_state = case when p_changes ? 'publish_state' then p_changes ->> 'publish_state' else publish_state end,
    manual_override = case
      when v_lockable is null then manual_override
      when coalesce(p_lock, true) then manual_override || (select jsonb_object_agg(k, true) from unnest(v_lockable) k)
      else manual_override - v_lockable end
  where id = p_match_id;
  perform app.audit(p_actor,
    case when p_changes ? 'minor_hold' and (p_changes ->> 'minor_hold')::boolean = false then 'approve_minor_hold' else 'update_match' end,
    'matches', p_match_id::text, jsonb_build_object('changes', p_changes, 'lock', coalesce(p_lock, true)), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('match edited', false);
  return (select jsonb_build_object('id', id, 'publish_state', publish_state, 'minor_hold', minor_hold) from public.matches where id = p_match_id);
end;
$$;

-- Edit the profile of a player (promote to public, set district or bio). Protected players cannot hold profile data: the table
-- rule and the guard trigger null those fields and keep them hidden, whatever is sent here.
create or replace function public.admin_update_player(p_actor text, p_player uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.players%rowtype;
  v_bad text[];
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'an edit needs a reason' using errcode = '22023'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'p_changes must be an object' using errcode = '22023'; end if;
  select array_agg(k) into v_bad from jsonb_object_keys(p_changes) k
   where k not in ('visibility', 'is_provisional', 'district', 'bio', 'photo_path', 'instagram_handle', 'disambiguator', 'claimed', 'noindex');
  if v_bad is not null then raise exception 'fields that cannot be edited here: %', v_bad using errcode = '22023'; end if;
  select * into a from public.players where id = p_player for update;
  if not found then raise exception 'NOT_FOUND: player not found' using errcode = 'P0002'; end if;
  perform set_config('app.override_bypass', 'on', true);
  update public.players set
    visibility = case when p_changes ? 'visibility' then p_changes ->> 'visibility' else visibility end,
    is_provisional = case when p_changes ? 'is_provisional' then (p_changes ->> 'is_provisional')::boolean else is_provisional end,
    district = case when p_changes ? 'district' then p_changes ->> 'district' else district end,
    bio = case when p_changes ? 'bio' then p_changes ->> 'bio' else bio end,
    photo_path = case when p_changes ? 'photo_path' then p_changes ->> 'photo_path' else photo_path end,
    instagram_handle = case when p_changes ? 'instagram_handle' then p_changes ->> 'instagram_handle' else instagram_handle end,
    disambiguator = case when p_changes ? 'disambiguator' then p_changes ->> 'disambiguator' else disambiguator end,
    claimed = case when p_changes ? 'claimed' then (p_changes ->> 'claimed')::boolean else claimed end,
    noindex = case when p_changes ? 'noindex' then (p_changes ->> 'noindex')::boolean else noindex end
  where id = p_player;
  perform app.audit(p_actor, 'update_player', 'players', p_player::text, jsonb_build_object('fields', (select array_agg(k) from jsonb_object_keys(p_changes) k)), p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('player edited', false);
  return (select jsonb_build_object('id', id, 'visibility', visibility, 'is_provisional', is_provisional, 'age_status', age_status) from public.players where id = p_player);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges for functions: nothing for the API roles; the admin RPCs only for service_role
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.audit(text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function app.hide_player(uuid, text)              from public, anon, authenticated;

revoke all on function public.admin_mark_dirty(text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_merge_players(text, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_split_player(text, uuid, uuid[], text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_rename_player(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_set_age_status(text, uuid[], text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_emergency_hide(text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.admin_release_suppression(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_update_video(text, text, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_update_match(text, uuid, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_update_player(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_player(text, uuid, jsonb, text) to service_role;

grant execute on function public.admin_mark_dirty(text, text, boolean) to service_role;
grant execute on function public.admin_merge_players(text, uuid, uuid, text, boolean) to service_role;
grant execute on function public.admin_split_player(text, uuid, uuid[], text, text, text, text) to service_role;
grant execute on function public.admin_rename_player(text, uuid, text, text, text, text) to service_role;
grant execute on function public.admin_set_age_status(text, uuid[], text, text, text, boolean) to service_role;
grant execute on function public.admin_emergency_hide(text, text, text, text, timestamptz, text) to service_role;
grant execute on function public.admin_release_suppression(text, uuid, text) to service_role;
grant execute on function public.admin_update_video(text, text, jsonb, boolean, text) to service_role;
grant execute on function public.admin_update_match(text, uuid, jsonb, boolean, text) to service_role;
