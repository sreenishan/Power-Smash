-- 0014_tournament_edit.sql: the owner edits a tournament's details from the admin (D-102).
--
-- Until now the admin could only Approve, Hide or Reject a tournament (admin_decide_tournament, 0008). The owner could not correct a name,
-- a venue or the dates, or mark a tournament featured or covered, without the SQL editor. This adds one function:
--   public.admin_update_tournament  owner only (app.require_owner), every field checked, audited, marks the site dirty.
-- No table changes: every column already exists (0004) and api.public_tournaments (0006) already shows them.
--
-- Editable: name, level, city, district, venue, start_date, end_date, categories, is_featured, featured_until, covered_by_power_smash.
-- NOT editable here, on purpose: region and visibility (Approve / Hide / Reject, D-018), edition_year and series_key (the identity key,
-- PC-11), the slug (addresses stay stable), organizer contact and registration link (consent rules, D-028, D-029), age groups and the minor
-- signal (set from the videos, D-012).
-- The sync never overwrites the owner: it only appends categories seen in new videos and fills an EMPTY district, and the edited name,
-- level, city and district are locked in manual_override (the existing tournaments_guard honours those locks, 0005).
-- Featuring is free and owner-set (paid featuring is Phase 2, D-020): a featured tournament needs a featured_until date; turning featuring
-- on or changing the date needs today or later (India time). An unchanged featuring that has ended does not block other edits.
-- p_expected is the record as the admin form showed it: if the row changed since (the sync appended a category or filled the district,
-- or another tab saved), the save is refused with STALE instead of silently undoing that change. Checked under the row lock.

create or replace function public.admin_update_tournament(p_actor text, p_id uuid, p_record jsonb, p_expected jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['name', 'level', 'city', 'district', 'venue', 'startDate', 'endDate', 'categories', 'isFeatured',
    'featuredUntil', 'coveredByPowerSmash'];
  v_lockable constant text[] := array['name', 'level', 'city', 'district'];
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_key text;
  t public.tournaments%rowtype;
  v_old jsonb;
  v_new jsonb;
  v_fields text[];
  v_locks jsonb := '{}'::jsonb;
  v_name text;
  v_level text;
  v_city text;
  v_district text;
  v_venue text;
  v_start date;
  v_end date;
  v_cats text[];
  v_featured boolean;
  v_until date;
  v_covered boolean;
begin
  perform app.require_owner(p_actor);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a tournament change needs a reason' using errcode = '22023'; end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object' then raise exception 'INVALID: the tournament must be an object' using errcode = '22023'; end if;
  -- every key known, every key present (the admin sends the whole record)
  for v_key in select jsonb_object_keys(p_record) loop
    if not v_key = any (v_allowed) then raise exception 'INVALID: unknown tournament field %', v_key using errcode = '22023'; end if;
  end loop;
  foreach v_key in array v_allowed loop
    if not p_record ? v_key then raise exception 'INVALID: the tournament field % is missing', v_key using errcode = '22023'; end if;
  end loop;
  -- types: never coerced
  if jsonb_typeof(p_record -> 'name') <> 'string' or jsonb_typeof(p_record -> 'categories') <> 'array'
     or jsonb_typeof(p_record -> 'isFeatured') <> 'boolean' or jsonb_typeof(p_record -> 'coveredByPowerSmash') <> 'boolean' then
    raise exception 'INVALID: a tournament field has the wrong type' using errcode = '22023';
  end if;
  foreach v_key in array array['level', 'city', 'district', 'venue', 'startDate', 'endDate', 'featuredUntil'] loop
    if jsonb_typeof(p_record -> v_key) not in ('string', 'null') then raise exception 'INVALID: the tournament field % has the wrong type', v_key using errcode = '22023'; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_record -> 'categories') e where jsonb_typeof(e) <> 'string') then
    raise exception 'INVALID: each category must be text' using errcode = '22023';
  end if;

  -- text: trimmed, empty = not stated, length in characters, no control characters
  v_name := btrim(p_record ->> 'name');
  if length(v_name) not between 2 and 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'INVALID: the name must be 2 to 120 characters with no control characters' using errcode = '22023';
  end if;
  v_level := nullif(btrim(coalesce(p_record ->> 'level', '')), '');
  if v_level is not null and v_level not in ('district', 'state', 'zonal', 'national', 'open', 'corporate', 'veterans', 'school_college', 'other') then
    raise exception 'INVALID: unknown level' using errcode = '22023';
  end if;
  v_city := nullif(btrim(coalesce(p_record ->> 'city', '')), '');
  v_district := nullif(btrim(coalesce(p_record ->> 'district', '')), '');
  v_venue := nullif(btrim(coalesce(p_record ->> 'venue', '')), '');
  if (v_city is not null and (length(v_city) > 60 or v_city ~ '[[:cntrl:]]'))
     or (v_district is not null and (length(v_district) > 60 or v_district ~ '[[:cntrl:]]'))
     or (v_venue is not null and (length(v_venue) > 160 or v_venue ~ '[[:cntrl:]]')) then
    raise exception 'INVALID: city and district up to 60, venue up to 160 characters, with no control characters' using errcode = '22023';
  end if;

  -- dates: real YYYY-MM-DD dates, last day not before the first
  foreach v_key in array array['startDate', 'endDate', 'featuredUntil'] loop
    if jsonb_typeof(p_record -> v_key) = 'string' then
      if (p_record ->> v_key) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID: % must be YYYY-MM-DD', v_key using errcode = '22023'; end if;
      begin
        perform (p_record ->> v_key)::date;
      exception when others then
        raise exception 'INVALID: % is not a real date', v_key using errcode = '22023';
      end;
      if to_char((p_record ->> v_key)::date, 'YYYY-MM-DD') <> (p_record ->> v_key) then raise exception 'INVALID: % is not a real date', v_key using errcode = '22023'; end if;
    end if;
  end loop;
  v_start := (p_record ->> 'startDate')::date;
  v_end := (p_record ->> 'endDate')::date;
  if v_start is not null and v_end is not null and v_end < v_start then raise exception 'INVALID: the last day is before the first day' using errcode = '22023'; end if;

  -- categories: the nine codes only, once each, in the fixed order
  if exists (select 1 from jsonb_array_elements_text(p_record -> 'categories') c where c not in ('MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD')) then
    raise exception 'INVALID: unknown category' using errcode = '22023';
  end if;
  select coalesce(array_agg(c order by array_position(array['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD'], c)), '{}')
    into v_cats from (select distinct c from jsonb_array_elements_text(p_record -> 'categories') c) s;

  -- featured: free and owner-set; not featured = no date (the date rule needs the stored row, below)
  v_featured := (p_record ->> 'isFeatured')::boolean;
  v_until := case when v_featured then (p_record ->> 'featuredUntil')::date else null end;
  v_covered := (p_record ->> 'coveredByPowerSmash')::boolean;

  select * into t from public.tournaments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002'; end if;
  if app.is_suppressed('tournament_id', t.id::text) then raise exception 'SUPPRESSED: a suppressed tournament cannot be edited (D-014)' using errcode = '42501'; end if;
  -- a featured tournament needs a date; turning featuring on or changing the date needs today or later
  if v_featured and (v_until is null or (v_until < v_today and (t.is_featured is distinct from true or v_until is distinct from t.featured_until))) then
    raise exception 'INVALID: a featured tournament needs a featured-until date, today or later' using errcode = '22023';
  end if;

  -- the stored categories in the fixed order too (the sync appends new ones at the end), so the same set is never a "change"
  v_old := jsonb_build_object('name', t.name, 'level', t.level, 'city', t.city, 'district', t.district, 'venue', t.venue,
    'startDate', to_char(t.start_date, 'YYYY-MM-DD'), 'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
    'categories', (select coalesce(jsonb_agg(c order by array_position(array['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD'], c)), '[]'::jsonb)
                   from (select distinct c from unnest(t.categories) c) s),
    'isFeatured', t.is_featured, 'featuredUntil', to_char(t.featured_until, 'YYYY-MM-DD'), 'coveredByPowerSmash', t.covered_by_power_smash);
  v_new := jsonb_build_object('name', v_name, 'level', v_level, 'city', v_city, 'district', v_district, 'venue', v_venue,
    'startDate', to_char(v_start, 'YYYY-MM-DD'), 'endDate', to_char(v_end, 'YYYY-MM-DD'), 'categories', to_jsonb(v_cats),
    'isFeatured', v_featured, 'featuredUntil', to_char(v_until, 'YYYY-MM-DD'), 'coveredByPowerSmash', v_covered);
  -- the form edited what it showed: refuse if the row changed since (compared like v_old: the same keys, categories in the fixed order)
  if p_expected is null or jsonb_typeof(p_expected) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_expected) k) is distinct from (select array_agg(k order by k) from unnest(v_allowed) k)
     or jsonb_typeof(p_expected -> 'categories') <> 'array' then
    raise exception 'INVALID: the expected tournament record is missing or malformed' using errcode = '22023';
  end if;
  if v_old is distinct from (p_expected || jsonb_build_object('categories',
      (select coalesce(jsonb_agg(c order by array_position(array['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD'], c)), '[]'::jsonb)
       from (select distinct c from jsonb_array_elements_text(p_expected -> 'categories') c) s))) then
    raise exception 'STALE: the tournament changed since the form was opened' using errcode = '40001';
  end if;
  select coalesce(array_agg(k order by array_position(v_allowed, k)), '{}') into v_fields
    from unnest(v_allowed) k where (v_old -> k) is distinct from (v_new -> k);
  if cardinality(v_fields) = 0 then
    return jsonb_build_object('id', t.id, 'fields', '[]'::jsonb);
  end if;

  -- lock the edited name, level, city and district against the sync (the guard would otherwise keep a locked old value: bypass for this call)
  foreach v_key in array v_lockable loop
    if v_key = any (v_fields) then v_locks := v_locks || jsonb_build_object(v_key, true); end if;
  end loop;
  perform set_config('app.override_bypass', 'on', true);
  update public.tournaments
     set name = v_name, level = v_level, city = v_city, district = v_district, venue = v_venue, start_date = v_start, end_date = v_end,
         categories = v_cats, is_featured = v_featured, featured_until = v_until, covered_by_power_smash = v_covered,
         manual_override = manual_override || v_locks, updated_at = now()
   where id = t.id;
  perform set_config('app.override_bypass', 'off', true);

  -- the audit holds the NAMES of the changed fields and the featured switch only; never the name, place or venue text
  perform app.audit(p_actor, 'update_tournament', 'tournaments', t.id::text,
    jsonb_build_object('fields', to_jsonb(v_fields), 'old_featured', t.is_featured, 'new_featured', v_featured,
      'new_featured_until', to_char(v_until, 'YYYY-MM-DD')), p_reason);
  perform app.mark_dirty('tournament edit', false);
  return jsonb_build_object('id', t.id, 'fields', to_jsonb(v_fields));
end;
$$;

revoke all on function public.admin_update_tournament(text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_tournament(text, uuid, jsonb, jsonb, text) to service_role;
