-- 0009_archive_purge.sql - M2 fix wave: the 30-day rule for stored YouTube API data (D-016, policy III.E.4.d).
--
-- service_role cannot delete videos (tombstones, D-014), so the sync RETIRES a video (title_raw = '', statistics, description, thumbnail,
-- etag and parse data blanked, hidden). That still leaves (a) old titles in video_title_history and (b) the match and its participant names,
-- which are derived from the title. This RPC removes them, audited and idempotent:
--   public.admin_purge_stale_api_data(p_actor text, p_older_than_days integer default 29) returns jsonb
--   * history: every video_title_history row older than the interval that is not the newest row of a live video, and every row of a retired video
--     older than the interval, is deleted;
--   * retired videos (title_raw = '') retired longer ago than the interval: any API-derived column still set is blanked (belt and braces), the
--     match and its participants are deleted (a duplicate_of pointing at it is cleared, match redirect rows are removed);
--   * the video ROW stays, hidden, and every suppression row is untouched, so a sync can never resurrect a tombstoned item;
--   * one audit_log row with the counts (no titles, no names); the site is marked dirty only when a match was deleted;
--   * running it again changes nothing (counts are all zero).
-- p_older_than_days must be 1..30 (a stored API value must be refreshed or deleted before day 30). service_role only, fixed search_path.
-- Apply after 0008, then run supabase/checks/0009_assertions.sql.

create or replace function public.admin_purge_stale_api_data(p_actor text, p_older_than_days integer default 29)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_hist integer := 0;
  v_blanked integer := 0;
  v_matches integer := 0;
  v_participants integer := 0;
  v_redirects integer := 0;
  v_ids text[];
  v_match_ids uuid[];
begin
  if p_older_than_days is null or p_older_than_days < 1 or p_older_than_days > 30 then
    raise exception 'p_older_than_days must be between 1 and 30 (D-016)' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_older_than_days);
  perform set_config('app.override_bypass', 'on', true);

  -- 1. title history: old rows of live videos (the newest row is the current title) and all old rows of retired videos
  with doomed as (
    delete from public.video_title_history h
     where h.seen_at < v_cutoff
       and (
         h.id <> (select max(h2.id) from public.video_title_history h2 where h2.youtube_id = h.youtube_id)
         or exists (select 1 from public.videos v where v.youtube_id = h.youtube_id and v.title_raw = '')
       )
    returning 1
  )
  select count(*) into v_hist from doomed;

  -- 2. retired videos older than the interval
  select coalesce(array_agg(v.youtube_id), '{}') into v_ids
    from public.videos v
   where v.title_raw = '' and coalesce(v.hidden_at, v.updated_at) < v_cutoff;

  if cardinality(v_ids) > 0 then
    with b as (
      update public.videos v
         set title_normalized = '', description = null, views = null, likes = null, stats_fetched_at = null, thumbnail_url = null,
             embeddable = null, etag = null, parse_result = null, hard_flags = '{}', review_reasons = '{}', parser_version = null,
             parse_confidence = null, visibility = 'hidden', hidden_reason = coalesce(v.hidden_reason, 'removed_from_youtube')
       where v.youtube_id = any (v_ids)
         and (v.title_normalized <> '' or v.description is not null or v.views is not null or v.likes is not null or v.stats_fetched_at is not null
              or v.thumbnail_url is not null or v.embeddable is not null or v.etag is not null or v.parse_result is not null
              or v.hard_flags <> '{}' or v.review_reasons <> '{}' or v.parser_version is not null or v.parse_confidence is not null
              or v.visibility <> 'hidden')
      returning 1
    )
    select count(*) into v_blanked from b;

    select coalesce(array_agg(m.id), '{}') into v_match_ids from public.matches m where m.video_id = any (v_ids);
    if cardinality(v_match_ids) > 0 then
      update public.matches set duplicate_of = null where duplicate_of = any (v_match_ids);
      with dp as (delete from public.match_participants where match_id = any (v_match_ids) returning 1)
      select count(*) into v_participants from dp;
      with dm as (delete from public.matches where id = any (v_match_ids) returning 1)
      select count(*) into v_matches from dm;
      with dr as (delete from public.slug_redirects where entity_type = 'match' and entity_id = any (select x::text from unnest(v_match_ids) x) returning 1)
      select count(*) into v_redirects from dr;
    end if;
  end if;

  perform set_config('app.override_bypass', 'off', true);
  -- nothing changed: no audit noise (idempotent re-run)
  if v_hist + v_blanked + v_matches + v_participants + v_redirects > 0 then
    perform app.audit(p_actor, 'purge_stale_api_data', 'videos', null,
      jsonb_build_object('older_than_days', p_older_than_days, 'history_rows', v_hist, 'videos_blanked', v_blanked, 'matches', v_matches,
                         'participants', v_participants, 'redirects', v_redirects),
      'D-016 30-day rule');
    if v_matches > 0 then perform app.mark_dirty('purged stale api data', false); end if;
  end if;
  return jsonb_build_object('history_rows', v_hist, 'videos_blanked', v_blanked, 'matches', v_matches, 'participants', v_participants, 'redirects', v_redirects);
end;
$$;

revoke all on function public.admin_purge_stale_api_data(text, integer) from public, anon, authenticated;
grant execute on function public.admin_purge_stale_api_data(text, integer) to service_role;
