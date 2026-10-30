-- 0015_submitted_tournaments.sql: the owner adds an organizer's tournament submission to the tournament list (D-103).
--
-- An organizer's form on /tournaments/submit/ is stored as a lead of kind tournament_submission (0001/0003). Until now nothing turned it
-- into a tournament, so the admin's "Submitted by organizers" tab never had a real entry. This adds:
--   public.tournament_submissions        which lead became which tournament (one each way). Private: owner reads only.
--   public.admin_add_submitted_tournament the one write path: owner only (app.require_owner), every field checked, audited.
--
-- It is the OWNER who adds a submission (from the enquiry in the admin), never the public form: an anonymous visitor cannot create
-- tournament rows, and spam stays an enquiry. The new tournament is source 'submitted', status 'pending', visibility 'hidden' until the
-- owner approves it (admin_decide_tournament, 0008). NO contact detail is copied: the organizer's name, phone and email stay on the lead,
-- under its retention rules (0010); tournament_private is not written here (showing an organizer needs the D-015/D-029 consent steps).
-- Only the tournament's own details are stored: name, dates, city, district, venue. The admin computes the address (slug), the series
-- key and the region (tamil_nadu only for a Tamil Nadu district, else unknown; never international) and this function checks them again.
-- House rules (0001-0014): RLS on with NO policies, everything revoked, explicit grants; SECURITY DEFINER, fixed search_path.

create table public.tournament_submissions (
  tournament_id  uuid primary key references public.tournaments (id) on delete cascade,
  -- the lead may be removed by retention (0010): the link then stays, without the lead
  lead_id        uuid unique references public.leads (id) on delete set null,
  added_at       timestamptz not null default now(),
  added_by       text not null
);
comment on table public.tournament_submissions is 'Private. Which tournament_submission lead the owner turned into which tournament (D-103). No contact data.';

alter table public.tournament_submissions enable row level security;
-- Deliberately NO policies: only the service role reads it, and writes go through admin_add_submitted_tournament.
revoke all on table public.tournament_submissions from public, anon, authenticated, service_role;
grant select on public.tournament_submissions to service_role;

create or replace function public.admin_add_submitted_tournament(p_actor text, p_lead uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['slug', 'name', 'seriesKey', 'editionYear', 'region', 'city', 'district', 'venue', 'startDate', 'endDate'];
  v_key text;
  v_type text;
  v_id uuid := gen_random_uuid();
  v_name text;
  v_series text;
  v_year smallint;
  v_city text;
  v_district text;
  v_venue text;
  v_start date;
  v_end date;
begin
  perform app.require_owner(p_actor);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: adding a submission needs a reason' using errcode = '22023'; end if;
  select type into v_type from public.leads where id = p_lead;
  if not found then raise exception 'NOT_FOUND: lead not found' using errcode = 'P0002'; end if;
  if v_type <> 'tournament_submission' then raise exception 'INVALID: only a tournament submission can be added to the tournament list' using errcode = '22023'; end if;
  if exists (select 1 from public.tournament_submissions where lead_id = p_lead) then
    raise exception 'INVALID: this submission is already in the tournament list' using errcode = '22023';
  end if;

  if p_record is null or jsonb_typeof(p_record) <> 'object' then raise exception 'INVALID: the tournament must be an object' using errcode = '22023'; end if;
  for v_key in select jsonb_object_keys(p_record) loop
    if not v_key = any (v_allowed) then raise exception 'INVALID: unknown tournament field %', v_key using errcode = '22023'; end if;
  end loop;
  foreach v_key in array v_allowed loop
    if not p_record ? v_key then raise exception 'INVALID: the tournament field % is missing', v_key using errcode = '22023'; end if;
  end loop;
  if jsonb_typeof(p_record -> 'slug') <> 'string' or jsonb_typeof(p_record -> 'name') <> 'string' or jsonb_typeof(p_record -> 'seriesKey') <> 'string'
     or jsonb_typeof(p_record -> 'region') <> 'string' or jsonb_typeof(p_record -> 'editionYear') not in ('number', 'null') then
    raise exception 'INVALID: a tournament field has the wrong type' using errcode = '22023';
  end if;
  foreach v_key in array array['city', 'district', 'venue', 'startDate', 'endDate'] loop
    if jsonb_typeof(p_record -> v_key) not in ('string', 'null') then raise exception 'INVALID: the tournament field % has the wrong type', v_key using errcode = '22023'; end if;
  end loop;

  -- the address: the table's format, not reserved, not taken
  if (p_record ->> 'slug') !~ '^[a-z0-9][a-z0-9-]{0,100}$' or (p_record ->> 'slug') in ('submit', 'page', 'index') then
    raise exception 'INVALID: the tournament address is not valid' using errcode = '22023';
  end if;
  if exists (select 1 from public.tournaments where slug = p_record ->> 'slug') then raise exception 'INVALID: the tournament address is taken' using errcode = '22023'; end if;
  -- text: as the tournament edit (0014) checks it
  v_name := btrim(p_record ->> 'name');
  if length(v_name) not between 2 and 120 or v_name ~ '[[:cntrl:]]' then raise exception 'INVALID: the name must be 2 to 120 characters with no control characters' using errcode = '22023'; end if;
  v_series := btrim(p_record ->> 'seriesKey');
  if length(v_series) not between 1 and 200 or v_series ~ '[[:cntrl:]]' then raise exception 'INVALID: the series key is not valid' using errcode = '22023'; end if;
  if (p_record ->> 'region') not in ('tamil_nadu', 'unknown') then raise exception 'INVALID: a submitted tournament is placed in Tamil Nadu or not known' using errcode = '22023'; end if;
  v_city := nullif(btrim(coalesce(p_record ->> 'city', '')), '');
  v_district := nullif(btrim(coalesce(p_record ->> 'district', '')), '');
  v_venue := nullif(btrim(coalesce(p_record ->> 'venue', '')), '');
  if (v_city is not null and (length(v_city) > 60 or v_city ~ '[[:cntrl:]]'))
     or (v_district is not null and (length(v_district) > 60 or v_district ~ '[[:cntrl:]]'))
     or (v_venue is not null and (length(v_venue) > 160 or v_venue ~ '[[:cntrl:]]')) then
    raise exception 'INVALID: city and district up to 60, venue up to 160 characters, with no control characters' using errcode = '22023';
  end if;
  foreach v_key in array array['startDate', 'endDate'] loop
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
  -- the edition year is the first day's year (or none): never typed separately, so the identity key (PC-11) stays consistent
  if jsonb_typeof(p_record -> 'editionYear') = 'number' then
    if (p_record ->> 'editionYear')::numeric <> trunc((p_record ->> 'editionYear')::numeric) then raise exception 'INVALID: the year must be a whole number' using errcode = '22023'; end if;
    v_year := (p_record ->> 'editionYear')::smallint;
  end if;
  if v_year is distinct from extract(year from v_start)::smallint then raise exception 'INVALID: the year must be the first day''s year, or empty without a first day' using errcode = '22023'; end if;
  if exists (select 1 from public.tournaments where series_key = v_series and edition_year is not distinct from v_year) then
    raise exception 'INVALID: a tournament with the same name and year is already in the list' using errcode = '22023';
  end if;

  insert into public.tournaments (id, slug, name, series_key, edition_year, region, city, district, venue, start_date, end_date, source, status, visibility)
    values (v_id, p_record ->> 'slug', v_name, v_series, v_year, p_record ->> 'region', v_city, v_district, v_venue, v_start, v_end, 'submitted', 'pending', 'hidden');
  insert into public.tournament_submissions (tournament_id, lead_id, added_by) values (v_id, p_lead, p_actor);

  -- the audit holds the ids and the address only (the address is what the public would see after approval); never contact data
  perform app.audit(p_actor, 'add_submitted_tournament', 'tournaments', v_id::text,
    jsonb_build_object('lead_id', p_lead, 'slug', p_record ->> 'slug', 'region', p_record ->> 'region'), p_reason);
  return jsonb_build_object('id', v_id, 'slug', p_record ->> 'slug');
end;
$$;

revoke all on function public.admin_add_submitted_tournament(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_add_submitted_tournament(text, uuid, jsonb, text) to service_role;
