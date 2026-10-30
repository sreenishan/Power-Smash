-- 0013_live_pin.sql: the /live page's pinned stream and past-streams list, set by the owner from the admin (spec 7.13, D-101).
--
-- Until now the pin lived in src/content/live.ts, so pinning a stream meant editing code; the owner works from a phone. This adds:
--   public.live_settings          ONE row (id = 1): the pinned YouTube video id, or null. Seeded empty (nothing is pinned).
--   public.live_past_streams      the owner's list of older streams: video id, the title exactly as on YouTube, the date, the order.
--   api.public_live_settings      the pinned id, for the build (publishable key).
--   api.public_live_past_streams  the list, for the build, explicit columns.
--   public.admin_save_live        the one write path: owner only (app.require_owner), every value checked, audited, marks the site dirty.
--
-- What is stored is only what the page shows: YouTube video ids, the titles as YouTube shows them (D-016) and dates. No player data, no
-- live status from the YouTube API (that is the parked sync, youtubeApiData). Whether the player is shown stays with features.youtubeEmbeds.
-- House rules (0001-0012): RLS on with NO policies, everything revoked, then explicit grants; writes only through the SECURITY DEFINER RPC.

create table public.live_settings (
  id               smallint primary key default 1 check (id = 1),
  pinned_video_id  text check (pinned_video_id is null or pinned_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  updated_at       timestamptz not null default now(),
  updated_by       text not null
);
comment on table public.live_settings is 'The /live pin (D-101): one row, the pinned YouTube video id or null.';
insert into public.live_settings (id, pinned_video_id, updated_by) values (1, null, 'migration 0013');

create table public.live_past_streams (
  video_id     text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title        text not null check (title = btrim(title) and length(title) between 1 and 100 and title !~ '[[:cntrl:]]'),
  streamed_on  date,
  position     smallint not null unique check (position between 0 and 19),
  updated_at   timestamptz not null default now(),
  updated_by   text not null
);
comment on table public.live_past_streams is 'Older streams listed on /live (D-101): the title exactly as on YouTube (D-016), at most 20 rows.';

alter table public.live_settings enable row level security;
alter table public.live_past_streams enable row level security;
-- Deliberately NO policies: only the service role reads them, and writes go through admin_save_live.
revoke all on table public.live_settings from public, anon, authenticated, service_role;
revoke all on table public.live_past_streams from public, anon, authenticated, service_role;
grant select on public.live_settings to service_role;
grant select on public.live_past_streams to service_role;

-- The build reads these with explicit columns (no select *).
create view api.public_live_settings with (security_barrier = true) as
  select s.pinned_video_id
  from public.live_settings s
  where s.id = 1;
grant select on api.public_live_settings to anon, authenticated;

create view api.public_live_past_streams with (security_barrier = true) as
  select l.video_id, l.title, l.streamed_on, l.position
  from public.live_past_streams l;
grant select on api.public_live_past_streams to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_live: the owner saves the pin and the whole past-streams list at once (the admin sends both)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_live(p_actor text, p_pinned text, p_past jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_pinned text;
  v_old_past jsonb;
  v_new_past jsonb := '[]'::jsonb;
  v_fields text[] := '{}';
  v_e jsonb;
  v_key text;
  v_id text;
  v_title text;
  v_date date;
  v_seen text[] := '{}';
  v_i integer := 0;
begin
  perform app.require_owner(p_actor);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a live change needs a reason' using errcode = '22023'; end if;
  if p_pinned is not null and p_pinned !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'INVALID: the pinned stream must be an 11-character YouTube video id, or empty' using errcode = '22023';
  end if;
  if p_past is null or jsonb_typeof(p_past) <> 'array' then raise exception 'INVALID: the past streams must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_past) > 20 then raise exception 'INVALID: at most 20 past streams' using errcode = '22023'; end if;

  -- every entry: exactly videoId, title, date; never coerced
  for v_e in select e from jsonb_array_elements(p_past) e loop
    if jsonb_typeof(v_e) <> 'object' then raise exception 'INVALID: each past stream must be an object' using errcode = '22023'; end if;
    for v_key in select jsonb_object_keys(v_e) loop
      if v_key not in ('videoId', 'title', 'date') then raise exception 'INVALID: unknown past-stream field %', v_key using errcode = '22023'; end if;
    end loop;
    if not (v_e ? 'videoId' and v_e ? 'title' and v_e ? 'date') then raise exception 'INVALID: a past-stream field is missing' using errcode = '22023'; end if;
    if jsonb_typeof(v_e -> 'videoId') <> 'string' or jsonb_typeof(v_e -> 'title') <> 'string' or jsonb_typeof(v_e -> 'date') not in ('string', 'null') then
      raise exception 'INVALID: a past-stream field has the wrong type' using errcode = '22023';
    end if;
    v_id := v_e ->> 'videoId';
    if v_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'INVALID: a past stream needs an 11-character YouTube video id' using errcode = '22023'; end if;
    if v_id = any (v_seen) then raise exception 'INVALID: a past stream is listed twice' using errcode = '22023'; end if;
    v_seen := array_append(v_seen, v_id);
    v_title := btrim(v_e ->> 'title');
    if length(v_title) not between 1 and 100 or v_title ~ '[[:cntrl:]]' then
      raise exception 'INVALID: a past-stream title must be 1 to 100 characters with no control characters' using errcode = '22023';
    end if;
    v_date := null;
    if jsonb_typeof(v_e -> 'date') = 'string' then
      if (v_e ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID: a past-stream date must be YYYY-MM-DD' using errcode = '22023'; end if;
      begin
        v_date := (v_e ->> 'date')::date;
      exception when others then
        raise exception 'INVALID: a past-stream date is not a real date' using errcode = '22023';
      end;
      if to_char(v_date, 'YYYY-MM-DD') <> (v_e ->> 'date') then raise exception 'INVALID: a past-stream date is not a real date' using errcode = '22023'; end if;
    end if;
    v_new_past := v_new_past || jsonb_build_array(jsonb_build_object('videoId', v_id, 'title', v_title, 'date', to_char(v_date, 'YYYY-MM-DD')));
  end loop;

  select pinned_video_id into v_old_pinned from public.live_settings where id = 1 for update;
  select coalesce(jsonb_agg(jsonb_build_object('videoId', video_id, 'title', title, 'date', to_char(streamed_on, 'YYYY-MM-DD')) order by position), '[]'::jsonb)
    into v_old_past from public.live_past_streams;
  if v_old_pinned is distinct from p_pinned then v_fields := array_append(v_fields, 'pinned'); end if;
  if v_old_past is distinct from v_new_past then v_fields := array_append(v_fields, 'past'); end if;
  if cardinality(v_fields) = 0 then
    return jsonb_build_object('pinned', v_old_pinned, 'pastCount', jsonb_array_length(v_old_past), 'fields', '[]'::jsonb);
  end if;

  update public.live_settings set pinned_video_id = p_pinned, updated_at = now(), updated_by = p_actor where id = 1;
  if 'past' = any (v_fields) then
    -- the list is the owner's own display list (no history to keep): replace it whole, in the order given
    delete from public.live_past_streams;
    for v_e in select e from jsonb_array_elements(v_new_past) e loop
      insert into public.live_past_streams (video_id, title, streamed_on, position, updated_at, updated_by)
        values (v_e ->> 'videoId', v_e ->> 'title', (v_e ->> 'date')::date, v_i, now(), p_actor);
      v_i := v_i + 1;
    end loop;
  end if;

  -- the audit holds the video ids (public), the number of past streams and the NAMES of the changed fields; never the titles
  perform app.audit(p_actor, 'save_live', 'live_settings', '1',
    jsonb_build_object('old_pinned', v_old_pinned, 'new_pinned', p_pinned, 'old_past_count', jsonb_array_length(v_old_past),
      'new_past_count', jsonb_array_length(v_new_past), 'fields', to_jsonb(v_fields)), p_reason);
  perform app.mark_dirty('live pin', false);
  return jsonb_build_object('pinned', p_pinned, 'pastCount', jsonb_array_length(v_new_past), 'fields', to_jsonb(v_fields));
end;
$$;

revoke all on function public.admin_save_live(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_save_live(text, text, jsonb, text) to service_role;
