-- 0022_international_links.sql: international events listed with links only (D-112, platform wave 5).
--
--   public.international_events              the owner's list of major international events: name, level text, start and end date
--                                            (calendar dates read as India time, D-030), city, country and ONE official link. Public
--                                            facts only: no contact person, no phone, no player. Nothing is copied from the linked
--                                            sites (no results, draws, rankings, logos or player data) and nothing is fetched.
--   public.international_settings            one row: the websites the owner added to the allow-list (extra_hosts). The defaults
--                                            (app.international_default_hosts) are fixed and cannot be removed.
--   app.international_host_problem           why a website name is refused (null = fine); mirrors hostProblem in
--                                            src/lib/international/link-rules.ts
--   app.international_link_problem           why a stored link is refused (null = fine); mirrors storedLinkProblem (same order, same
--                                            sentences). p_hosts null = shape only (the table constraint); the RPCs pass the allow-list.
--   public.admin_save_international_event    add (p_id null) or edit an event (owner only, revision checked, audited)
--   public.admin_set_international_event_published  show or hide an event (showing re-checks the link against today's allow-list)
--   public.admin_set_international_hosts     replace the owner's extra websites; returns how many shown events dropped off the list
--   api.public_international_events          explicit columns, published rows whose link's website is allowed NOW (security_barrier)
--
-- The link rules (D-112): http or https, a full address in the canonical form new URL() writes, no user name or password, no port, no
-- # part, no tracking parameter (utm_ and the list below), a plain Latin host (no punycode, no IP address), on the allow-list (the
-- default hosts, the owner's hosts, or either with "www." in front). The admin cleans the link before it is sent (tracking removed).
--
-- House rules (0001-0018): RLS on with NO policies, everything revoked, explicit grants (service_role select only on the base tables);
-- writes only through SECURITY DEFINER RPCs with search_path = '' that call app.require_owner FIRST; audit through app.audit with field
-- names, counts and flags only (never the event's text or link); app.mark_dirty where public content changes; errors start 'INVALID:',
-- 'NOT_FOUND:' or 'STALE:'. Nobody is named: the table has no player column (D-012, D-109, D-116). No delete: hide only.
-- Apply after 0021, then run supabase/checks/0022_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- Rules (pure, immutable, no table access)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.international_default_hosts()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['bwfbadminton.com', 'tournamentsoftware.com', 'bwf.tournamentsoftware.com']::text[];
$$;

create or replace function app.international_host_problem(p_host text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_host is null or length(p_host) not between 4 and 253 then return 'write a website name such as example.org (4 to 253 characters)'; end if;
  if p_host like 'www.%' then return 'leave out "www." at the start: it is accepted automatically'; end if;
  if position('xn--' in p_host) > 0 then return 'website names in other alphabets (punycode, xn--) are not accepted'; end if;
  if p_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    return 'write only the website name, such as example.org';
  end if;
  if p_host !~ '\.[a-z]{2,63}$' then return 'a website name ends with letters, such as .com (an IP address is not accepted)'; end if;
  if p_host = any (array['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 's.id', 'lnkd.in']) then
    return 'link shorteners are not accepted';
  end if;
  return null;
end;
$$;

create or replace function app.international_link_problem(p_url text, p_hosts text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
  v_auth text;
  v_host text;
  v_query text;
begin
  if p_url is null or length(p_url) = 0 then return 'the official link is missing'; end if;
  if length(p_url) > 500 then return 'the official link must be 500 characters or fewer'; end if;
  if p_url ~ '[[:space:][:cntrl:]\\<>"`]' then return 'the official link holds a character that is not allowed (a space, a backslash, < > " or `)'; end if;
  m := regexp_match(p_url, '^(https?)://([^/?#]+)(/[^#]*)$');
  if m is null then return 'the official link must be a full address starting with https:// (or http://), without a # part'; end if;
  v_auth := m[2];
  if position('@' in v_auth) > 0 then return 'the official link must not hold a user name or password'; end if;
  if position(':' in v_auth) > 0 then return 'the official link must not name a port'; end if;
  if v_auth <> lower(v_auth) then return 'the website name of the official link must be in small letters'; end if;
  v_host := case when v_auth like 'www.%' then substr(v_auth, 5) else v_auth end;
  if position('xn--' in v_host) > 0 or length(v_host) not between 4 and 253
     or v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' or v_host !~ '\.[a-z]{2,63}$' then
    return 'the website name of the official link is not valid';
  end if;
  if p_hosts is not null and not v_host = any (p_hosts) then
    return 'the official link must be on an allowed website (' || array_to_string(p_hosts, ', ') || ')';
  end if;
  v_query := case when position('?' in m[3]) > 0 then substr(m[3], position('?' in m[3]) + 1) else '' end;
  if v_query ~* '(^|&)(utm_[^=&]*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|twclid|ttclid|li_fat_id|_ga|_gl)(=|&|$)' then
    return 'the official link must not hold tracking parts (utm_ and similar)';
  end if;
  return null;
end;
$$;

-- every element a canonical host, not a default, no repeat, at most 20 (null = fine)
create or replace function app.international_hosts_problem(p_hosts text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  h text;
  v_problem text;
begin
  if p_hosts is null then return 'the list of websites is missing'; end if;
  if cardinality(p_hosts) > 20 then return 'add at most 20 websites'; end if;
  foreach h in array p_hosts loop
    v_problem := app.international_host_problem(h);
    if v_problem is not null then return coalesce(h, '(empty)') || ': ' || v_problem; end if;
    if h = any (app.international_default_hosts()) then return h || ' is always allowed; leave it out'; end if;
  end loop;
  if (select count(distinct x) from unnest(p_hosts) x) <> cardinality(p_hosts) then return 'a website is listed twice'; end if;
  return null;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------------------------------------------------------
create table public.international_settings (
  id           smallint    primary key default 1 check (id = 1),
  extra_hosts  text[]      not null default '{}' check (app.international_hosts_problem(extra_hosts) is null),
  updated_at   timestamptz not null default now()
);
comment on table public.international_settings is 'One row: the websites the owner added to the official-link allow-list of international events (D-112). The defaults are fixed in app.international_default_hosts().';
insert into public.international_settings (id) values (1);
create trigger international_settings_touch_updated_at before update on public.international_settings for each row execute function app.touch_updated_at();
create trigger international_settings_no_delete before delete on public.international_settings for each row execute function app.forbid_row_change();

alter table public.international_settings enable row level security;
revoke all on table public.international_settings from public, anon, authenticated, service_role;
grant select on public.international_settings to service_role;

create table public.international_events (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null check (name = btrim(name) and length(name) between 3 and 160 and name !~ '[[:cntrl:]<>]'),
  level_text    text        check (level_text is null or (level_text = btrim(level_text) and length(level_text) between 2 and 80 and level_text !~ '[[:cntrl:]<>]')),
  start_date    date        not null,
  end_date      date        not null,
  city          text        check (city is null or (city = btrim(city) and length(city) between 1 and 60 and city !~ '[[:cntrl:]<>]')),
  country       text        not null check (country = btrim(country) and length(country) between 2 and 60 and country !~ '[[:cntrl:]<>]'),
  official_url  text        not null check (app.international_link_problem(official_url, null) is null),
  published     boolean     not null default false,
  revision      integer     not null default 1 check (revision >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint international_events_dates check (
    end_date >= start_date and end_date - start_date <= 60 and start_date >= date '2000-01-01' and end_date <= date '2100-12-31'
  )
);
comment on table public.international_events is 'Major international events the owner lists with ONE official link (D-112). Public facts only; nothing copied from the linked sites.';
create index international_events_start_idx on public.international_events (start_date, id);
create trigger international_events_touch_updated_at before update on public.international_events for each row execute function app.touch_updated_at();

alter table public.international_events enable row level security;
revoke all on table public.international_events from public, anon, authenticated, service_role;
grant select on public.international_events to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- Field readers for the RPCs (raise INVALID with a plain sentence)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.international_text(p_value jsonb, p_label text, p_min integer, p_max integer, p_required boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    if p_required then raise exception 'INVALID: the % is missing', p_label using errcode = '22023'; end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then raise exception 'INVALID: the % must be text', p_label using errcode = '22023'; end if;
  v := regexp_replace(btrim(p_value #>> '{}'), '\s+', ' ', 'g');
  if v = '' and not p_required then return null; end if;
  if length(v) not between p_min and p_max or v ~ '[[:cntrl:]<>]' then
    raise exception 'INVALID: the % must be % to % characters, without < or >', p_label, p_min, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function app.international_date(p_value jsonb, p_label text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v date;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID: the % must be a date written YYYY-MM-DD', p_label using errcode = '22023';
  end if;
  begin
    v := (p_value #>> '{}')::date;
  exception when others then
    raise exception 'INVALID: the % is not a real date', p_label using errcode = '22023';
  end;
  if to_char(v, 'YYYY-MM-DD') <> (p_value #>> '{}') then raise exception 'INVALID: the % is not a real date', p_label using errcode = '22023'; end if;
  return v;
end;
$$;

create or replace function app.international_allowed_hosts()
returns text[]
language sql
stable
set search_path = ''
as $$
  select app.international_default_hosts() || coalesce((select s.extra_hosts from public.international_settings s where s.id = 1), '{}'::text[]);
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_international_event: add (p_id null, p_expected_revision null) or edit. Record (every key present):
-- {name, levelText, startDate, endDate, city, country, officialUrl, published}. The link must be on today's allow-list.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_international_event(p_actor text, p_id uuid, p_record jsonb, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.international_events%rowtype;
  v_name text;
  v_level text;
  v_start date;
  v_end date;
  v_city text;
  v_country text;
  v_url text;
  v_pub boolean;
  v_problem text;
  v_fields text[] := array[]::text[];
  v_id uuid;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['name', 'levelText', 'startDate', 'endDate', 'city', 'country', 'officialUrl', 'published'], 'international event');
  v_name := app.international_text(p_record -> 'name', 'name', 3, 160, true);
  v_level := app.international_text(p_record -> 'levelText', 'level', 2, 80, false);
  v_city := app.international_text(p_record -> 'city', 'city', 1, 60, false);
  v_country := app.international_text(p_record -> 'country', 'country', 2, 60, true);
  v_start := app.international_date(p_record -> 'startDate', 'first day');
  v_end := app.international_date(p_record -> 'endDate', 'last day');
  if v_start < date '2000-01-01' or v_end > date '2100-12-31' then raise exception 'INVALID: the dates must be between the years 2000 and 2100' using errcode = '22023'; end if;
  if v_end < v_start then raise exception 'INVALID: the last day cannot be before the first day' using errcode = '22023'; end if;
  if v_end - v_start > 60 then raise exception 'INVALID: an event can last at most 60 days' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'officialUrl') <> 'string' then raise exception 'INVALID: the official link is missing' using errcode = '22023'; end if;
  v_url := p_record ->> 'officialUrl';
  v_problem := app.international_link_problem(v_url, app.international_allowed_hosts());
  if v_problem is not null then raise exception 'INVALID: %', v_problem using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'published') <> 'boolean' then raise exception 'INVALID: published must be true or false' using errcode = '22023'; end if;
  v_pub := (p_record ->> 'published')::boolean;

  if p_id is null then
    if p_expected_revision is not null then raise exception 'INVALID: a new event has no revision' using errcode = '22023'; end if;
    insert into public.international_events (name, level_text, start_date, end_date, city, country, official_url, published)
      values (v_name, v_level, v_start, v_end, v_city, v_country, v_url, v_pub)
      returning id into v_id;
    v_fields := array['name', 'level_text', 'start_date', 'end_date', 'city', 'country', 'official_url', 'published'];
    perform app.audit(p_actor, 'create_international_event', 'international_events', v_id::text, jsonb_build_object('fields', to_jsonb(v_fields), 'published', v_pub), p_reason);
    if v_pub then perform app.mark_dirty('international event added', false); end if;
    return jsonb_build_object('id', v_id, 'created', true, 'revision', 1, 'fields', to_jsonb(v_fields));
  end if;

  select * into ev from public.international_events where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: this event was not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from ev.revision then raise exception 'STALE: the event changed since the form was opened' using errcode = '40001'; end if;
  if ev.name is distinct from v_name then v_fields := array_append(v_fields, 'name'); end if;
  if ev.level_text is distinct from v_level then v_fields := array_append(v_fields, 'level_text'); end if;
  if ev.start_date is distinct from v_start then v_fields := array_append(v_fields, 'start_date'); end if;
  if ev.end_date is distinct from v_end then v_fields := array_append(v_fields, 'end_date'); end if;
  if ev.city is distinct from v_city then v_fields := array_append(v_fields, 'city'); end if;
  if ev.country is distinct from v_country then v_fields := array_append(v_fields, 'country'); end if;
  if ev.official_url is distinct from v_url then v_fields := array_append(v_fields, 'official_url'); end if;
  if ev.published is distinct from v_pub then v_fields := array_append(v_fields, 'published'); end if;
  if cardinality(v_fields) = 0 then
    return jsonb_build_object('id', ev.id, 'created', false, 'revision', ev.revision, 'fields', '[]'::jsonb);
  end if;
  update public.international_events
     set name = v_name, level_text = v_level, start_date = v_start, end_date = v_end, city = v_city, country = v_country,
         official_url = v_url, published = v_pub, revision = revision + 1
   where id = ev.id;
  perform app.audit(p_actor, 'update_international_event', 'international_events', ev.id::text, jsonb_build_object('fields', to_jsonb(v_fields), 'published', v_pub), p_reason);
  if ev.published or v_pub then perform app.mark_dirty('international event changed', false); end if;
  return jsonb_build_object('id', ev.id, 'created', false, 'revision', ev.revision + 1, 'fields', to_jsonb(v_fields));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_international_event_published: show or hide. Showing re-checks the link against today's allow-list.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_international_event_published(p_actor text, p_id uuid, p_published boolean, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.international_events%rowtype;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  if p_published is null then raise exception 'INVALID: choose show or hide' using errcode = '22023'; end if;
  select * into ev from public.international_events where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: this event was not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from ev.revision then raise exception 'STALE: the event changed since the list was opened' using errcode = '40001'; end if;
  if ev.published = p_published then
    return jsonb_build_object('id', ev.id, 'published', ev.published, 'revision', ev.revision, 'changed', false);
  end if;
  if p_published and app.international_link_problem(ev.official_url, app.international_allowed_hosts()) is not null then
    raise exception 'INVALID: the official link is not on an allowed website any more; edit the link first' using errcode = '22023';
  end if;
  update public.international_events set published = p_published, revision = revision + 1 where id = ev.id;
  perform app.audit(p_actor, 'set_international_event_published', 'international_events', ev.id::text, jsonb_build_object('fields', jsonb_build_array('published'), 'published', p_published), p_reason);
  perform app.mark_dirty('international event shown or hidden', false);
  return jsonb_build_object('id', ev.id, 'published', p_published, 'revision', ev.revision + 1, 'changed', true);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_international_hosts: replace the owner's extra websites (a JSON array of canonical host names, see
-- app.international_hosts_problem). Returns the sorted list and how many SHOWN events are now off the list (the api view drops them).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_international_hosts(p_actor text, p_hosts jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text[];
  v_old text[];
  v_problem text;
  v_changed boolean;
  v_off integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  if p_hosts is null or jsonb_typeof(p_hosts) <> 'array' then raise exception 'INVALID: the websites must be a list' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_hosts) x where jsonb_typeof(x) <> 'string') then
    raise exception 'INVALID: every website must be text' using errcode = '22023';
  end if;
  select coalesce(array_agg(x order by x), array[]::text[]) into v_hosts from jsonb_array_elements_text(p_hosts) x;
  v_problem := app.international_hosts_problem(v_hosts);
  if v_problem is not null then raise exception 'INVALID: %', v_problem using errcode = '22023'; end if;
  select s.extra_hosts into v_old from public.international_settings s where s.id = 1 for update;
  v_changed := (select coalesce(array_agg(x order by x), array[]::text[]) from unnest(v_old) x) is distinct from v_hosts;
  if v_changed then
    update public.international_settings set extra_hosts = v_hosts where id = 1;
    perform app.audit(p_actor, 'set_international_hosts', 'international_settings', '1',
      jsonb_build_object('fields', jsonb_build_array('extra_hosts'), 'count', cardinality(v_hosts),
        'added', (select count(*) from unnest(v_hosts) x where not x = any (v_old)),
        'removed', (select count(*) from unnest(v_old) x where not x = any (v_hosts))), p_reason);
    if exists (select 1 from public.international_events e where e.published) then perform app.mark_dirty('international websites changed', false); end if;
  end if;
  select count(*) into v_off from public.international_events e
   where e.published and app.international_link_problem(e.official_url, app.international_default_hosts() || v_hosts) is not null;
  return jsonb_build_object('hosts', to_jsonb(v_hosts), 'fields', case when v_changed then jsonb_build_array('extra_hosts') else '[]'::jsonb end, 'eventsOffList', v_off);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- api.public_international_events: explicit columns, published rows only, and only while the link's website is on the allow-list
-- (the defaults written out, plus the owner's hosts; "www." in front accepted). No app function is called, so anon needs nothing but
-- SELECT on the view. Mirrored by INTERNATIONAL_COLUMNS in src/lib/international/public/provider.ts.
-- ------------------------------------------------------------------------------------------------------------------
create view api.public_international_events with (security_barrier = true) as
select e.id, e.name, e.level_text, e.start_date, e.end_date, e.city, e.country, e.official_url
  from public.international_events e
  join public.international_settings s on s.id = 1
  cross join lateral (select regexp_replace(substring(e.official_url from '^https?://([^/?#]+)/'), '^www\.', '') as host) h
 where e.published
   and h.host = any (array['bwfbadminton.com', 'tournamentsoftware.com', 'bwf.tournamentsoftware.com']::text[] || s.extra_hosts);
comment on view api.public_international_events is 'International events the owner shows (D-112): name, level, dates, place and one official link on an allowed website. Nothing copied from the linked sites.';
grant select on api.public_international_events to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges: helpers for nobody, RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.international_default_hosts() from public, anon, authenticated;
revoke all on function app.international_host_problem(text) from public, anon, authenticated;
revoke all on function app.international_link_problem(text, text[]) from public, anon, authenticated;
revoke all on function app.international_hosts_problem(text[]) from public, anon, authenticated;
revoke all on function app.international_text(jsonb, text, integer, integer, boolean) from public, anon, authenticated;
revoke all on function app.international_date(jsonb, text) from public, anon, authenticated;
revoke all on function app.international_allowed_hosts() from public, anon, authenticated;
revoke all on function public.admin_save_international_event(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_set_international_event_published(text, uuid, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.admin_set_international_hosts(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_save_international_event(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_set_international_event_published(text, uuid, boolean, integer, text) to service_role;
grant execute on function public.admin_set_international_hosts(text, jsonb, text) to service_role;
