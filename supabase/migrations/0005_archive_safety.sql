-- 0005_archive_safety.sql - M2: the safety machinery around the archive tables of 0004.
--
-- Tables: archive_settings, site_state, audit_log, suppression.
-- Functions (schema app, not exposed): is_suppressed, setting, age_rank, effective_age_status, mark_dirty, and the trigger functions
-- that make the rules hold whatever code writes the rows:
--   * suppression (D-014): a tombstone table keyed by youtube_id, player_id, name_normalized or tournament_id. Triggers on videos,
--     players and tournaments force `hidden` for a suppressed key, so a sync, reparse, merge or backfill can never resurrect it.
--     Rows are never deleted; a release only stamps released_at/by/reason.
--   * field-level locks (PC-20): a BEFORE UPDATE trigger puts a locked field back to its old value unless the change comes from an
--     admin RPC (which sets app.override_bypass for its own transaction only).
--   * protected players (D-012): a BEFORE trigger on players removes profile data, forces noindex + hidden + opaque slug for every
--     status except adult_confirmed, turns the old named slug into a 410 row and never lets the sync lower a status or lift to
--     adult_confirmed (only admin_set_age_status sets app.age_lift_ok).
--   * audit_log is APPEND-ONLY like consent_events (trigger refuses update, delete, truncate; service_role has select + insert).
--   * site_state: the single dirty-flag row (D-008). Content triggers call app.mark_dirty; no-op churn (views, likes, sync stamps)
--     does not.
--   * archive_settings: protected-mode switches. The owner's decisions are the seeded defaults (D-012, D-018):
--     unknown_match_mode = noindex_minimal, minor_match_mode = hidden, non_tn_tournament_pages = off.
-- Paths: player pages are /players/<slug>/ and tournament pages /tournaments/<slug>/ (spec 6.3, links end with a slash).
-- Apply after 0004, then run supabase/checks/0005_assertions.sql.

-- The trigger functions below call other app.* functions; service_role needs to resolve the schema (EXECUTE is still revoked from the
-- API roles, and these functions are only ever reached through triggers or the definer RPCs of 0006).
grant usage on schema app to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- archive_settings (protected-mode settings)
-- ------------------------------------------------------------------------------------------------------------------
create table public.archive_settings (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint archive_settings_valid check (
    (key = 'unknown_match_mode' and value in ('noindex_minimal', 'hidden'))
    or (key = 'minor_match_mode' and value in ('noindex_minimal', 'hidden'))
    or (key = 'non_tn_tournament_pages' and value in ('off', 'on'))
    or (key = 'auto_publish_clean_parses' and value in ('true', 'false'))
  )
);
comment on table public.archive_settings is 'Private. Archive switches with a fixed key list and allowed values (a check constraint). unknown_match_mode and minor_match_mode: noindex_minimal | hidden (D-012). Read by the api views; change through the admin.';
comment on column public.archive_settings.key is 'unknown_match_mode | minor_match_mode | non_tn_tournament_pages | auto_publish_clean_parses';

insert into public.archive_settings (key, value) values
  ('unknown_match_mode', 'noindex_minimal'),   -- owner decision, D-012: unknown-age players get a minimal noindex match page
  ('minor_match_mode', 'hidden'),              -- owner decision, D-012: suspected or confirmed minors are hidden
  ('non_tn_tournament_pages', 'off'),          -- owner decision, D-018: non-Tamil-Nadu videos are listed, no tournament pages
  ('auto_publish_clean_parses', 'true');       -- D-013 default

create trigger archive_settings_touch_updated_at before update on public.archive_settings for each row execute function app.touch_updated_at();

create or replace function app.setting(p_key text)
returns text
language sql
stable
set search_path = ''
as $$
  select s.value from public.archive_settings s where s.key = p_key;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- site_state (D-008): one row, the dirty flag
-- ------------------------------------------------------------------------------------------------------------------
create table public.site_state (
  id                       smallint    primary key default 1,
  dirty                    boolean     not null default false,
  dirty_since              timestamptz,
  dirty_reason             text,
  urgent                   boolean     not null default false,
  last_deploy_requested_at timestamptz,
  last_deploy_at           timestamptz,
  last_deploy_status       text,
  updated_at               timestamptz not null default now(),
  constraint site_state_single_row check (id = 1)
);
comment on table public.site_state is 'Private. Exactly one row. dirty = public content changed since the last deploy (D-008); urgent = an emergency hide is waiting (deploy now, D-014). Set by app.mark_dirty, cleared by the deploy job.';
insert into public.site_state (id) values (1);
create trigger site_state_touch_updated_at before update on public.site_state for each row execute function app.touch_updated_at();

-- the single row can never be removed or duplicated
create trigger site_state_no_delete before delete on public.site_state for each row execute function app.forbid_row_change();
create trigger site_state_no_truncate before truncate on public.site_state for each statement execute function app.forbid_row_change();

create or replace function app.mark_dirty(p_reason text, p_urgent boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.site_state
     set dirty = true,
         dirty_since = coalesce(dirty_since, now()),
         dirty_reason = left(coalesce(p_reason, 'content changed'), 200),
         urgent = urgent or coalesce(p_urgent, false)
   where id = 1;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- audit_log (append-only, like consent_events)
-- ------------------------------------------------------------------------------------------------------------------
create table public.audit_log (
  id        bigint      generated by default as identity primary key,
  ts        timestamptz not null default now(),
  actor     text        not null,
  action    text        not null,
  entity    text        not null,
  entity_id text,
  diff      jsonb,
  reason    text,
  constraint audit_log_action_format check (action ~ '^[a-z_]{1,60}$'),
  constraint audit_log_entity_format check (entity ~ '^[a-z_]{1,60}$'),
  constraint audit_log_actor_not_empty check (length(actor) > 0)
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, ts desc);
create index audit_log_ts_idx on public.audit_log (ts desc);
comment on table public.audit_log is 'Private. Append-only record of every privileged admin action (merge, split, rename, emergency hide, age confirmation). No update, no delete, no truncate. No contact data in diff.';
comment on column public.audit_log.actor is 'The verified admin user id (the Worker verifies the JWT and aal2, D-006) or a system name such as sync.';

create trigger audit_log_append_only before update or delete on public.audit_log for each row execute function app.forbid_row_change();
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function app.forbid_row_change();

-- ------------------------------------------------------------------------------------------------------------------
-- suppression (D-014): tombstones; the sync, reparse, merge and backfill check it before any insert
-- ------------------------------------------------------------------------------------------------------------------
create table public.suppression (
  id             uuid        primary key default gen_random_uuid(),
  kind           text        not null,
  value          text        not null,
  action         text        not null default 'hide',
  reason         text        not null,
  requested_by   text,
  received_at    timestamptz not null default now(),
  created_by     text        not null,
  created_at     timestamptz not null default now(),
  released_at    timestamptz,
  released_by    text,
  release_reason text,
  constraint suppression_kind_check check (kind in ('youtube_id', 'player_id', 'name_normalized', 'tournament_id')),
  constraint suppression_action_check check (action in ('hide', 'erase')),
  constraint suppression_value_check check (
    (kind = 'youtube_id' and value ~ '^[A-Za-z0-9_-]{4,40}$')
    or (kind in ('player_id', 'tournament_id') and value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (kind = 'name_normalized' and length(value) > 0 and value = lower(value))
  ),
  constraint suppression_reason_not_empty check (length(btrim(reason)) > 0),
  constraint suppression_release_complete check ((released_at is null) = (released_by is null)),
  constraint suppression_kind_value_unique unique (kind, value)
);
create index suppression_active_idx on public.suppression (kind, value) where released_at is null;
comment on table public.suppression is 'Private tombstones (D-014). A suppressed key can never be shown again by a sync, reparse, merge or backfill (triggers force hidden). Never deleted; a release stamps released_at/by/reason. erase = the owner also removes stored personal data.';
comment on column public.suppression.received_at is 'When the request arrived: proves the response time (D-014).';

create or replace function app.suppression_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DELETE on suppression is not allowed: tombstones are kept (D-014)' using errcode = '42501';
  end if;
  if new.id <> old.id or new.kind <> old.kind or new.value <> old.value or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'suppression rows are tombstones: only action, reason, received_at, requested_by and the released_* columns may change (D-014)' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger suppression_immutable before update or delete on public.suppression for each row execute function app.suppression_immutable();
create trigger suppression_no_truncate before truncate on public.suppression for each statement execute function app.forbid_row_change();

create or replace function app.is_suppressed(p_kind text, p_value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.suppression s
    where s.kind = p_kind and s.value = p_value and s.released_at is null
  );
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Age helpers (D-012). Rank: adult_confirmed 0, unknown 1, minor_suspected 2, minor_confirmed 3.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.age_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'adult_confirmed' then 0
    when 'unknown' then 1
    when 'minor_suspected' then 2
    when 'minor_confirmed' then 3
    else 3  -- anything unrecognised fails closed
  end;
$$;

-- The most restrictive of the participation and the linked player. A parser "unknown" participation does not override an
-- adult_confirmed player (the parser never says adult); a minor signal on either side always wins.
create or replace function app.effective_age_status(p_participation text, p_player text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_player is null then p_participation
    when p_player = 'adult_confirmed' and p_participation = 'unknown' then 'adult_confirmed'
    when app.age_rank(p_participation) >= app.age_rank(p_player) then p_participation
    else p_player
  end;
$$;

create or replace function app.player_path(p_slug text)
returns text
language sql
immutable
set search_path = ''
as $$ select '/players/' || p_slug || '/'; $$;

-- ------------------------------------------------------------------------------------------------------------------
-- Triggers: videos
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.videos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bypass boolean := coalesce(current_setting('app.override_bypass', true), '') = 'on';
begin
  if tg_op = 'UPDATE' and not bypass then
    -- field-level locks (PC-20): put a locked field back
    if coalesce((old.manual_override ->> 'type')::boolean, false) then new.type := old.type; end if;
    if coalesce((old.manual_override ->> 'parse_status')::boolean, false) then new.parse_status := old.parse_status; end if;
    if coalesce((old.manual_override ->> 'is_international')::boolean, false) then new.is_international := old.is_international; end if;
    if coalesce((old.manual_override ->> 'visibility')::boolean, false) then new.visibility := old.visibility; end if;
    -- the sync can never change the locks themselves
    new.manual_override := old.manual_override;
    -- a retitled video with locks needs the owner's eye (PC-20)
    if new.title_raw is distinct from old.title_raw and old.manual_override <> '{}'::jsonb then
      new.override_stale := true;
    end if;
  end if;
  -- D-014: a suppressed video can never be anything but hidden, whoever writes it and whatever lock exists
  if app.is_suppressed('youtube_id', new.youtube_id) then
    new.visibility := 'hidden';
    new.hidden_reason := coalesce(new.hidden_reason, 'suppressed');
  end if;
  -- an international video is never listed unless an admin unhides it with a visibility lock (D-018)
  if tg_op = 'INSERT' and new.is_international and new.visibility <> 'hidden' then
    new.visibility := 'hidden';
    new.hidden_reason := coalesce(new.hidden_reason, 'international');
  end if;
  if new.visibility = 'hidden' then
    if new.hidden_reason is not null and new.hidden_at is null then new.hidden_at := now(); end if;
  else
    new.hidden_reason := null;
    new.hidden_at := null;
  end if;
  return new;
end;
$$;
create trigger videos_guard before insert or update on public.videos for each row execute function app.videos_guard();

create or replace function app.videos_title_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.title_raw is distinct from old.title_raw then
    insert into public.video_title_history (youtube_id, title_raw) values (new.youtube_id, new.title_raw);
  end if;
  return null;
end;
$$;
create trigger videos_title_history after insert or update on public.videos for each row execute function app.videos_title_history();

-- ------------------------------------------------------------------------------------------------------------------
-- Triggers: tournaments
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.tournaments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bypass boolean := coalesce(current_setting('app.override_bypass', true), '') = 'on';
begin
  if tg_op = 'UPDATE' and not bypass then
    if coalesce((old.manual_override ->> 'name')::boolean, false) then new.name := old.name; end if;
    if coalesce((old.manual_override ->> 'edition_year')::boolean, false) then new.edition_year := old.edition_year; end if;
    if coalesce((old.manual_override ->> 'level')::boolean, false) then new.level := old.level; end if;
    if coalesce((old.manual_override ->> 'region')::boolean, false) then new.region := old.region; end if;
    if coalesce((old.manual_override ->> 'visibility')::boolean, false) then new.visibility := old.visibility; end if;
    if coalesce((old.manual_override ->> 'city')::boolean, false) then new.city := old.city; end if;
    if coalesce((old.manual_override ->> 'district')::boolean, false) then new.district := old.district; end if;
    new.manual_override := old.manual_override;
  end if;
  if app.is_suppressed('tournament_id', new.id::text) or new.region = 'international' then
    new.visibility := 'hidden';
  end if;
  -- the organizer's name is shown only after a recorded consent (C-10, D-029)
  if new.show_contact_public and not exists (
    select 1 from public.tournament_private p where p.tournament_id = new.id and p.consent_at is not null
  ) then
    new.show_contact_public := false;
  end if;
  return new;
end;
$$;
create trigger tournaments_guard before insert or update on public.tournaments for each row execute function app.tournaments_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- Triggers: players (D-012 protected treatment, D-014 suppression, PC-20 locks, PC-14 slugs)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.players_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bypass boolean := coalesce(current_setting('app.override_bypass', true), '') = 'on';
  lift_ok boolean := coalesce(current_setting('app.age_lift_ok', true), '') = 'on';
  old_path text;
begin
  -- D-012: a row can only be CREATED as adult_confirmed through an admin RPC (which sets the switch for its own transaction)
  if tg_op = 'INSERT' and new.age_status = 'adult_confirmed' and not lift_ok then
    raise exception 'a player cannot be created as adult_confirmed outside an admin action (D-012)' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if not bypass then
      if coalesce((old.manual_override ->> 'display_name')::boolean, false) then new.display_name := old.display_name; end if;
      if coalesce((old.manual_override ->> 'district')::boolean, false) then new.district := old.district; end if;
      if coalesce((old.manual_override ->> 'disambiguator')::boolean, false) then new.disambiguator := old.disambiguator; end if;
      if coalesce((old.manual_override ->> 'slug')::boolean, false) then new.slug := old.slug; new.slug_kind := old.slug_kind; end if;
      new.manual_override := old.manual_override;
    end if;
    -- D-012: the sync never lowers a status and never lifts to adult_confirmed; signals only accumulate.
    if not lift_ok then
      if app.age_rank(new.age_status) < app.age_rank(old.age_status) then
        new.age_status := old.age_status;
        new.age_confirmed_by := old.age_confirmed_by;
        new.age_confirmed_at := old.age_confirmed_at;
        new.age_confirmed_evidence := old.age_confirmed_evidence;
      end if;
      new.age_signal := (select coalesce(array_agg(distinct s order by s), '{}'::text[]) from unnest(old.age_signal || new.age_signal) as s);
    end if;
  end if;

  -- D-014: a suppressed player (by id or by normalised name) is hidden and cannot be lifted
  if app.is_suppressed('player_id', new.id::text) or app.is_suppressed('name_normalized', new.name_normalized) then
    new.visibility := 'hidden';
    new.noindex := true;
    if new.age_status = 'adult_confirmed' and (tg_op = 'INSERT' or old.age_status <> 'adult_confirmed') then
      raise exception 'player % is suppressed (D-014): it cannot be confirmed as an adult or shown', new.id using errcode = '42501';
    end if;
  end if;

  if new.merged_into is not null then
    new.visibility := 'hidden';
  end if;
  if new.is_provisional then
    new.visibility := 'hidden';
  end if;

  if new.age_status <> 'adult_confirmed' then
    -- PROTECTED (every status except adult_confirmed): no profile data, noindex, hidden, opaque slug
    new.district := null;
    new.photo_path := null;
    new.bio := null;
    new.instagram_handle := null;
    new.noindex := true;
    new.visibility := 'hidden';
    new.age_confirmed_by := null;
    new.age_confirmed_at := null;
    new.age_confirmed_evidence := null;
    if new.slug_kind = 'named' then
      if tg_op = 'UPDATE' then
        old_path := app.player_path(old.slug);
        -- the old public path is gone (410), and nothing may redirect to it any more
        update public.slug_redirects set http_status = 410, to_path = null where to_path = old_path;
        insert into public.slug_redirects (from_path, to_path, http_status, entity_type, entity_id)
          values (old_path, null, 410, 'player', new.id::text)
          on conflict (from_path) do update set to_path = null, http_status = 410, entity_type = 'player', entity_id = new.id::text;
      end if;
      new.slug := 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      new.slug_kind := 'opaque';
    end if;
    -- stored match slugs may carry this player's name: re-slug them (opaque) and make the old paths 410
    if tg_op = 'UPDATE' and old.age_status = 'adult_confirmed' then
      perform app.retire_match_slugs(new.id);
    end if;
  end if;
  return new;
end;
$$;
create trigger players_guard before insert or update on public.players for each row execute function app.players_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- Triggers: matches, participants, redirects
-- ------------------------------------------------------------------------------------------------------------------
-- Match slugs that name a player stop being used: opaque slug, old path 410 (nothing public leads to it). Used by the players guard and the hide helper.
create or replace function app.retire_match_slugs(p_player uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  rec record;
begin
  for rec in
    select m.id, m.slug from public.matches m
     where m.slug_kind = 'named' and m.id in (select mp.match_id from public.match_participants mp where mp.player_id = p_player)
  loop
    insert into public.slug_redirects (from_path, to_path, http_status, entity_type, entity_id)
      values ('/matches/' || rec.slug || '/', null, 410, 'match', rec.id::text)
      on conflict (from_path) do update set to_path = null, http_status = 410, entity_type = 'match', entity_id = rec.id::text;
    update public.matches set slug = 'match-' || substr(replace(rec.id::text, '-', ''), 1, 16), slug_kind = 'opaque' where id = rec.id;
  end loop;
end;
$$;

create or replace function app.matches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bypass boolean := coalesce(current_setting('app.override_bypass', true), '') = 'on';
begin
  if tg_op = 'UPDATE' and not bypass then
    if coalesce((old.manual_override ->> 'tournament_id')::boolean, false) then new.tournament_id := old.tournament_id; end if;
    if coalesce((old.manual_override ->> 'category')::boolean, false) then new.category := old.category; end if;
    if coalesce((old.manual_override ->> 'age_group')::boolean, false) then new.age_group := old.age_group; end if;
    if coalesce((old.manual_override ->> 'round')::boolean, false) then new.round := old.round; end if;
    if coalesce((old.manual_override ->> 'format')::boolean, false) then new.format := old.format; end if;
    if coalesce((old.manual_override ->> 'played_on')::boolean, false) then new.played_on := old.played_on; end if;
    new.manual_override := old.manual_override;
    -- the sync cannot publish a held minor-signal match (D-012): it keeps the old state
    if old.minor_hold and not new.minor_hold then
      new.minor_hold := true;
    end if;
    if new.minor_hold then new.publish_state := 'held'; end if;
  end if;
  if tg_op = 'INSERT' and new.minor_hold then new.publish_state := 'held'; end if;
  if new.slug = '' then
    new.slug := 'match-' || substr(replace(new.id::text, '-', ''), 1, 16);
    new.slug_kind := 'opaque';
  end if;
  return new;
end;
$$;
create trigger matches_guard before insert or update on public.matches for each row execute function app.matches_guard();

create or replace function app.participants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- a suppressed player is never linked again (D-014)
  if new.player_id is not null and app.is_suppressed('player_id', new.player_id::text) then
    new.player_id := null;
    new.resolution := 'suppressed';
  end if;
  -- D-014 / S2-7: an UNLINKED participant whose name equals a suppressed name is suppressed too (raw name normalised like name_normalized)
  if app.is_suppressed('name_normalized', btrim(regexp_replace(regexp_replace(lower(new.raw_name), '[!-/:-@[-`{-~]', ' ', 'g'), '[[:space:]]+', ' ', 'g'))) then
    new.player_id := null;
    new.resolution := 'suppressed';
  end if;
  -- a locked participant list is not rewritten by the sync (PC-20); the sync checks matches.manual_override first, this is the backstop
  return new;
end;
$$;
create trigger participants_guard before insert or update on public.match_participants for each row execute function app.participants_guard();

-- an alias that equals a suppressed name can never resolve (S2-7)
create or replace function app.aliases_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_suppressed('name_normalized', new.alias_normalized) then
    new.status := 'rejected';
  end if;
  return new;
end;
$$;
create trigger aliases_guard before insert or update on public.player_aliases for each row execute function app.aliases_guard();

-- a new (or re-activated) name tombstone also suppresses the participants and aliases that already exist (S2-7)
create or replace function app.suppression_apply()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'name_normalized' and new.released_at is null then
    update public.match_participants set player_id = null, resolution = 'suppressed'
     where resolution <> 'suppressed' and btrim(regexp_replace(regexp_replace(lower(raw_name), '[!-/:-@[-`{-~]', ' ', 'g'), '[[:space:]]+', ' ', 'g')) = new.value;
    update public.player_aliases set status = 'rejected' where alias_normalized = new.value and status <> 'rejected';
  end if;
  return null;
end;
$$;
create trigger suppression_apply after insert or update on public.suppression for each row execute function app.suppression_apply();

create or replace function app.redirects_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- no redirect may lead to a page that is not public: for a player, the target must be a public adult profile (D-012, D-014)
  if new.http_status = 301 and new.entity_type = 'player' then
    if not exists (
      select 1 from public.players p
      where app.player_path(p.slug) = new.to_path and p.visibility = 'public' and p.age_status = 'adult_confirmed'
    ) then
      raise exception 'redirect target % is not a public adult player page (D-012)', new.to_path using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger redirects_guard before insert or update on public.slug_redirects for each row execute function app.redirects_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- Dirty flag triggers (D-008): only changes that can alter public pages
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.dirty_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.mark_dirty(tg_table_name || ' ' || lower(tg_op), false);
  return null;
end;
$$;

-- videos: not on stats, sync stamps or etags (they change on every run)
create trigger videos_dirty_insert after insert on public.videos
  for each row when (new.visibility <> 'hidden') execute function app.dirty_trigger();
create trigger videos_dirty_update after update on public.videos
  for each row when (
    old.title_raw is distinct from new.title_raw or old.visibility is distinct from new.visibility or old.type is distinct from new.type
    or old.live_status is distinct from new.live_status or old.thumbnail_url is distinct from new.thumbnail_url
    or old.embeddable is distinct from new.embeddable or old.published_at is distinct from new.published_at
    or old.duration_s is distinct from new.duration_s or old.is_international is distinct from new.is_international
  ) execute function app.dirty_trigger();

create trigger tournaments_dirty after insert or update or delete on public.tournaments for each statement execute function app.dirty_trigger();
create trigger players_dirty after insert or update or delete on public.players for each statement execute function app.dirty_trigger();
create trigger matches_dirty after insert or update or delete on public.matches for each statement execute function app.dirty_trigger();
create trigger match_participants_dirty after insert or update or delete on public.match_participants for each statement execute function app.dirty_trigger();
create trigger slug_redirects_dirty after insert or update or delete on public.slug_redirects for each statement execute function app.dirty_trigger();
create trigger suppression_dirty after insert or update on public.suppression for each statement execute function app.dirty_trigger();
create trigger archive_settings_dirty after insert or update on public.archive_settings for each statement execute function app.dirty_trigger();
create trigger tournament_private_dirty after update on public.tournament_private for each statement execute function app.dirty_trigger();

-- ------------------------------------------------------------------------------------------------------------------
-- Row level security, privileges
-- ------------------------------------------------------------------------------------------------------------------
alter table public.archive_settings enable row level security;
alter table public.site_state       enable row level security;
alter table public.audit_log        enable row level security;
alter table public.suppression      enable row level security;

revoke all on table public.archive_settings, public.site_state, public.audit_log, public.suppression
  from public, anon, authenticated, service_role;

grant select, insert, update on public.archive_settings to service_role;
grant select, update         on public.site_state       to service_role;   -- the one row exists; no insert, no delete
grant select, insert         on public.audit_log        to service_role;   -- append-only
grant select, insert, update on public.suppression      to service_role;   -- no delete: tombstones

revoke all on function app.setting(text)                       from public, anon, authenticated;
revoke all on function app.mark_dirty(text, boolean)           from public, anon, authenticated;
revoke all on function app.suppression_immutable()             from public, anon, authenticated;
revoke all on function app.is_suppressed(text, text)           from public, anon, authenticated;
revoke all on function app.age_rank(text)                      from public, anon, authenticated;
revoke all on function app.effective_age_status(text, text)    from public, anon, authenticated;
revoke all on function app.player_path(text)                   from public, anon, authenticated;
revoke all on function app.videos_guard()                      from public, anon, authenticated;
revoke all on function app.videos_title_history()              from public, anon, authenticated;
revoke all on function app.tournaments_guard()                 from public, anon, authenticated;
revoke all on function app.players_guard()                     from public, anon, authenticated;
revoke all on function app.matches_guard()                     from public, anon, authenticated;
revoke all on function app.participants_guard()                from public, anon, authenticated;
revoke all on function app.redirects_guard()                   from public, anon, authenticated;
revoke all on function app.retire_match_slugs(uuid)            from public, anon, authenticated;
revoke all on function app.aliases_guard()                     from public, anon, authenticated;
revoke all on function app.suppression_apply()                 from public, anon, authenticated;
revoke all on function app.dirty_trigger()                     from public, anon, authenticated;
