-- 0009_assertions.sql - self-check for migration 0009_archive_purge.sql (public.admin_purge_stale_api_data).
-- It changes nothing: the behaviour test runs in a sub-transaction that is rolled back, with FICTIONAL rows. Ends with one row `ok`.

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

do $$
declare
  r text := 'public.admin_purge_stale_api_data(text,integer)';
  j jsonb;
  j2 jsonb;
begin
  -- closed to the API roles, open to service_role, definer with a fixed search_path
  if has_function_privilege('anon', r, 'EXECUTE') or has_function_privilege('authenticated', r, 'EXECUTE') then raise exception 'ASSERT FAIL: anon or authenticated can EXECUTE %', r; end if;
  if not has_function_privilege('service_role', r, 'EXECUTE') then raise exception 'ASSERT FAIL: service_role cannot EXECUTE %', r; end if;
  if not (select pr.prosecdef and 'search_path=""' = any (pr.proconfig) from pg_proc pr where pr.oid = r::regprocedure) then raise exception 'ASSERT FAIL: % is not SECURITY DEFINER with search_path empty', r; end if;

  begin
    -- a live video with an old and a new title; a retired video (blank title) with history, a match and participants; a tombstone
    insert into public.videos (youtube_id, title_raw) values ('fake-live-1', 'Fake Old Title');
    update public.videos set title_raw = 'Fake New Title' where youtube_id = 'fake-live-1';
    insert into public.videos (youtube_id, title_raw, description, views) values ('fake-gone-1', 'Fake Gone Title', 'desc', 5);
    insert into public.matches (id, video_id) values ('e1000000-0000-4000-8000-0000000000e1', 'fake-gone-1');
    insert into public.match_participants (match_id, side, position, raw_name) values ('e1000000-0000-4000-8000-0000000000e1', 'A', 1, 'Fake Person');
    insert into public.suppression (kind, value, reason, created_by) values ('youtube_id', 'fake-gone-1', 'test', 'fake-admin');
    -- retire it (what the sync does), long ago
    perform set_config('app.override_bypass', 'on', true);
    update public.videos set title_raw = '', visibility = 'hidden', hidden_reason = 'removed_from_youtube', hidden_at = now() - interval '40 days' where youtube_id = 'fake-gone-1';
    perform set_config('app.override_bypass', 'off', true);
    update public.video_title_history set seen_at = now() - interval '40 days';

    perform pg_temp.expect_fail($q$select public.admin_purge_stale_api_data('fake-sync', 0)$q$, 'an interval of 0 days');
    perform pg_temp.expect_fail($q$select public.admin_purge_stale_api_data('fake-sync', 31)$q$, 'an interval over 30 days');
    perform pg_temp.expect_fail($q$select public.admin_purge_stale_api_data('', 29)$q$ , 'no actor') ;

    execute 'set local role service_role';
    j := public.admin_purge_stale_api_data('fake-sync', 29);
    j2 := public.admin_purge_stale_api_data('fake-sync', 29);
    execute 'reset role';

    if (j ->> 'matches')::integer <> 1 or (j ->> 'participants')::integer <> 1 then raise exception 'ASSERT FAIL: the retired match and participants were not deleted: %', j; end if;
    if exists (select 1 from public.video_title_history where youtube_id = 'fake-gone-1') then raise exception 'ASSERT FAIL: history of a retired video remains'; end if;
    if (select count(*) from public.video_title_history where youtube_id = 'fake-live-1') <> 1 then raise exception 'ASSERT FAIL: a live video must keep exactly its newest title row'; end if;
    if (select title_raw from public.video_title_history where youtube_id = 'fake-live-1') <> 'Fake New Title' then raise exception 'ASSERT FAIL: the wrong history row was kept'; end if;
    if not exists (select 1 from public.videos where youtube_id = 'fake-gone-1' and title_raw = '' and description is null and views is null and visibility = 'hidden') then raise exception 'ASSERT FAIL: the retired row is not blanked and hidden'; end if;
    if not exists (select 1 from public.suppression where kind = 'youtube_id' and value = 'fake-gone-1' and released_at is null) then raise exception 'ASSERT FAIL: the tombstone was touched'; end if;
    if (j2 ->> 'history_rows')::integer + (j2 ->> 'videos_blanked')::integer + (j2 ->> 'matches')::integer + (j2 ->> 'participants')::integer <> 0 then raise exception 'ASSERT FAIL: the second run was not a no-op: %', j2; end if;
    if (select count(*) from public.audit_log where action = 'purge_stale_api_data') <> 1 then raise exception 'ASSERT FAIL: expected exactly one audit row (the no-op run writes none)'; end if;
    -- a sync cannot resurrect the tombstoned id
    update public.videos set visibility = 'public' where youtube_id = 'fake-gone-1';
    if (select visibility from public.videos where youtube_id = 'fake-gone-1') <> 'hidden' then raise exception 'ASSERT FAIL: a tombstoned video was resurrected'; end if;

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0009_archive_purge assertions passed' as result;
