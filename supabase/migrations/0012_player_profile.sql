-- 0012_player_profile.sql: district, academy and bio on ADULT player profiles, edited by the owner (D-100).
--
-- D-012: only adult_confirmed players may carry profile data. The table check players_protected_rules and the guard app.players_guard
-- already empty district and bio for every protected player; this migration adds the new academy column to BOTH, under the same names
-- (the 0004 check asserts the constraint by name). The guard below is the 0005 body copied byte for byte with one added line
-- (new.academy := null). Without that line, protecting an adult who has an academy would violate the table check and fail.
-- public.admin_update_player_profile is the owner's narrow write path: it REFUSES any player who is not adult_confirmed (it never
-- silently empties fields), audits the NAMES of the changed fields only (never the bio text), locks district against the sync, and
-- marks the site dirty. api.public_players gains academy as its LAST column (create or replace view can only append).

alter table public.players add column academy text check (academy is null or length(academy) <= 120);
comment on column public.players.academy is 'Adult players only (D-012, D-100): the academy or club as the owner types it. Emptied for every protected player by the table check and app.players_guard.';

alter table public.players drop constraint players_protected_rules;
alter table public.players add constraint players_protected_rules check (
  age_status = 'adult_confirmed'
  or (district is null and photo_path is null and bio is null and instagram_handle is null and academy is null
      and noindex and visibility = 'hidden' and slug_kind = 'opaque')
);

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
    new.academy := null;
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

revoke all on function app.players_guard() from public, anon, authenticated;

create or replace view api.public_players with (security_barrier = true) as
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
  p.noindex,
  p.academy
from public.players p
join app.eligible_players ep on ep.id = p.id
where p.age_status = 'adult_confirmed'
  and p.visibility = 'public';
grant select on api.public_players to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_update_player_profile: the owner edits an ADULT player's district, academy and bio
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_update_player_profile(p_actor text, p_player uuid, p_district text, p_academy text, p_bio text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.players;
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_academy text := nullif(btrim(coalesce(p_academy, '')), '');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_fields text[] := '{}';
begin
  perform app.require_owner(p_actor);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a profile edit needs a reason' using errcode = '22023'; end if;
  select * into v from public.players where id = p_player for update;
  if not found then raise exception 'NOT_FOUND: player not found' using errcode = 'P0002'; end if;
  -- D-012: never on a protected player, and never by emptying silently: the owner is told
  if v.age_status <> 'adult_confirmed' then
    raise exception 'INVALID: only an adult player''s profile can be edited' using errcode = '22023';
  end if;
  if length(v_district) > 60 or length(v_academy) > 120 or length(v_bio) > 600 then
    raise exception 'INVALID: district up to 60, academy up to 120, bio up to 600 characters' using errcode = '22023';
  end if;
  -- no control characters (a line break is allowed in the bio only)
  if v_district ~ '[[:cntrl:]]' or v_academy ~ '[[:cntrl:]]' or v_bio ~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'INVALID: remove the hidden control characters' using errcode = '22023';
  end if;
  if v_district is distinct from v.district then v_fields := array_append(v_fields, 'district'); end if;
  if v_academy is distinct from v.academy then v_fields := array_append(v_fields, 'academy'); end if;
  if v_bio is distinct from v.bio then v_fields := array_append(v_fields, 'bio'); end if;
  if cardinality(v_fields) = 0 then return jsonb_build_object('id', p_player, 'fields', '[]'::jsonb); end if;
  perform set_config('app.override_bypass', 'on', true);
  update public.players
     set district = v_district,
         academy = v_academy,
         bio = v_bio,
         manual_override = case when 'district' = any (v_fields) then manual_override || '{"district": true}'::jsonb else manual_override end
   where id = p_player;
  perform set_config('app.override_bypass', 'off', true);
  -- the audit holds the NAMES of the changed fields only, never the bio text
  perform app.audit(p_actor, 'update_player_profile', 'players', p_player::text, jsonb_build_object('fields', to_jsonb(v_fields)), p_reason);
  perform app.mark_dirty('player profile', false);
  return jsonb_build_object('id', p_player, 'fields', to_jsonb(v_fields));
end;
$$;

revoke all on function public.admin_update_player_profile(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_player_profile(text, uuid, text, text, text, text) to service_role;
