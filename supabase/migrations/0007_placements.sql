-- 0007_placements.sql - M3: sponsors, sponsor placements and their counters (spec 8.3, 11.2, D-031, D-029, D-005).
--
-- Tables: sponsors, placements, placement_stats_daily, placement_page_stats_daily, placement_impression_seen.
-- Functions (schema public, callable ONLY by service_role through the REST rpc route; the Worker holds that key):
--   bump_stat(placement_id, date, impressions, clicks, page_path)  atomic upsert of the daily counters (D-031)
--   record_placement_impressions(day, session_hash, items)         dedupe per placement, per IST day, per session, then bump_stat
--   rollup_placement_clicks(day)                                    recomputes the day's click counts from outbound_clicks (idempotent)
--
-- Rules applied exactly as in 0001 and 0002:
--   1. ROW LEVEL SECURITY is enabled and there are NO policies for anon or authenticated.
--   2. All privileges are REVOKEd from PUBLIC, anon, authenticated and service_role, then service_role gets back only what the Worker needs.
--   3. No public read: `/api/placements` reads these tables in the Worker with the secret key and publishes only the explicit-field
--      JSON (src/lib/placements/public.ts); sponsor contact fields never leave the database.
-- The admin (owner, aal2) reaches these tables through SECURITY DEFINER admin RPCs that audit (D-007): those arrive with the ADMIN
-- worker's migration, not here.
--
-- Counting rules (D-031): an impression is a slot at least 50% visible for 1 second, sent in one batched beacon; one per placement per
-- IST day per session (a daily-salted pseudonym, no IP). A click is a non-bot row of `outbound_clicks` whose go_slug is the placement's.
-- No personal data is stored in any table here except the sponsor's own contact fields (private, owner entered).
-- Retention: placement_impression_seen rows are only useful for the day they were written (the Worker deletes rows older than 2 days);
-- the daily counters are kept (they are the partner report).
--
-- Apply after 0001 and 0002 (it uses app.touch_updated_at and outbound_clicks from 0001), then run supabase/checks/0007_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- sponsors (spec 11.2). Contact fields are PRIVATE personal data.
-- ------------------------------------------------------------------------------------------------------------------
create table public.sponsors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  website       text,
  logo_path     text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sponsors_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint sponsors_website_https check (website is null or (website ~ '^https://[^[:space:]/?#@]+\.[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' and char_length(website) <= 300)),
  constraint sponsors_logo_path_format check (logo_path is null or (logo_path ~ '^[A-Za-z0-9/_.-]{1,200}$' and logo_path !~ '\.\.' and logo_path !~ '//' and logo_path !~ '^/')),
  constraint sponsors_phone_format check (contact_phone is null or contact_phone ~ '^[0-9]{8,15}$')
);

comment on table public.sponsors is 'Private. Sponsors and partners (spec 11.2). Written by the owner through the admin; read by the Worker with the secret key.';
comment on column public.sponsors.website is 'The sponsor''s registered website (https). Its host and subdomains are the only hosts a /go redirect for this sponsor may reach (D-031).';
comment on column public.sponsors.contact_name is 'PRIVATE personal data.';
comment on column public.sponsors.contact_phone is 'PRIVATE personal data: digits with country code, no plus.';
comment on column public.sponsors.contact_email is 'PRIVATE personal data.';
comment on column public.sponsors.notes is 'PRIVATE: the owner''s own notes.';

create trigger sponsors_touch_updated_at
  before update on public.sponsors
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------------------------------------------------------
-- placements (spec 8.3, 11.2). No hard delete: a placement is ended, never removed (its counters are the report).
-- ------------------------------------------------------------------------------------------------------------------
create table public.placements (
  id                    uuid primary key default gen_random_uuid(),
  sponsor_id            uuid not null references public.sponsors (id) on delete restrict,
  slot                  text not null,
  scope_key             text,
  creative_desktop_path text,
  creative_mobile_path  text,
  alt                   text not null,
  headline              text,
  target_url            text not null,
  go_slug               text not null,
  start_date            date not null,
  end_date              date not null,
  priority              integer not null default 0,
  label                 text not null,
  status                text not null default 'draft',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint placements_go_slug_uq unique (go_slug),
  constraint placements_slot_check check (slot in ('home_partner_strip', 'footer_partner_strip', 'player_page_banner', 'match_page_banner', 'tournament_page_banner', 'tournament_coverage_title', 'gear_page_banner')),
  constraint placements_label_check check (label in ('Sponsored', 'Partner')),
  constraint placements_status_check check (status in ('draft', 'active', 'paused', 'ended')),
  constraint placements_priority_range check (priority between 0 and 100),
  constraint placements_dates_order check (end_date >= start_date),
  constraint placements_go_slug_format check (go_slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  constraint placements_target_https check (target_url ~ '^https://[^[:space:]/?#@]+\.[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' and char_length(target_url) <= 500),
  constraint placements_scope_format check (scope_key is null or scope_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- a per-tournament slot needs its tournament; the slots that are never per tournament must not carry one
  constraint placements_scope_rule check (
    case
      when slot = 'tournament_coverage_title' then scope_key is not null
      when slot = 'tournament_page_banner' then true
      else scope_key is null
    end
  ),
  constraint placements_creative_desktop_format check (creative_desktop_path is null or (creative_desktop_path ~ '^[A-Za-z0-9/_.-]{1,200}$' and creative_desktop_path !~ '\.\.' and creative_desktop_path !~ '//' and creative_desktop_path !~ '^/')),
  constraint placements_creative_mobile_format check (creative_mobile_path is null or (creative_mobile_path ~ '^[A-Za-z0-9/_.-]{1,200}$' and creative_mobile_path !~ '\.\.' and creative_mobile_path !~ '//' and creative_mobile_path !~ '^/')),
  constraint placements_alt_length check (char_length(btrim(alt)) between 3 and 200),
  constraint placements_headline_length check (headline is null or char_length(headline) <= 80),
  -- an active placement must have an image (the browser would otherwise show an empty box)
  constraint placements_active_has_creative check (status <> 'active' or creative_desktop_path is not null or creative_mobile_path is not null)
);

create index placements_status_end_idx on public.placements (status, end_date);
create index placements_slot_idx on public.placements (slot, start_date, end_date);
create index placements_sponsor_idx on public.placements (sponsor_id);

comment on table public.placements is 'Private. One sponsor placement in one slot for a date range (IST calendar dates, end date inclusive). The Worker publishes only an explicit-field JSON of the active ones (D-031). Never hard-deleted: set status ended.';
comment on column public.placements.scope_key is 'Tournament slug for a per-tournament placement (tournament_coverage_title always, tournament_page_banner optionally); null otherwise.';
comment on column public.placements.target_url is 'The sponsor''s landing page. https only; /go/<go_slug> redirects to it, and only to the sponsor''s registered host (D-031).';
comment on column public.placements.go_slug is 'The tracked-redirect slug (/go/<slug>). Unique. Also the join key from outbound_clicks.go_slug.';
comment on column public.placements.creative_desktop_path is 'Storage key in the public creatives bucket (no leading slash, no ..).';
comment on column public.placements.priority is 'Higher wins when placements overlap in a one-item slot (0 to 100).';

create trigger placements_touch_updated_at
  before update on public.placements
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------------------------------------------------------
-- counters
-- ------------------------------------------------------------------------------------------------------------------
create table public.placement_stats_daily (
  placement_id uuid not null references public.placements (id) on delete cascade,
  date         date not null,
  impressions  integer not null default 0,
  clicks       integer not null default 0,
  constraint placement_stats_daily_pk primary key (placement_id, date),
  constraint placement_stats_daily_nonneg check (impressions >= 0 and clicks >= 0)
);
comment on table public.placement_stats_daily is 'Private. Daily impressions and clicks per placement (IST date). Written only through bump_stat and rollup_placement_clicks. Ad blockers cause under-counting: say so in every partner report.';

create table public.placement_page_stats_daily (
  placement_id uuid not null references public.placements (id) on delete cascade,
  date         date not null,
  page_path    text not null,
  impressions  integer not null default 0,
  clicks       integer not null default 0,
  constraint placement_page_stats_daily_pk primary key (placement_id, date, page_path),
  constraint placement_page_stats_daily_nonneg check (impressions >= 0 and clicks >= 0),
  constraint placement_page_stats_daily_path check (page_path ~ '^/[A-Za-z0-9/_.~%-]{0,199}$')
);
comment on table public.placement_page_stats_daily is 'Private. Daily impressions and clicks per placement and page path, for the "top pages" of the partner report. Paths only, no query string, no visitor data.';

create table public.placement_impression_seen (
  placement_id uuid not null references public.placements (id) on delete cascade,
  day          date not null,
  session_hash text not null,
  seen_at      timestamptz not null default now(),
  constraint placement_impression_seen_pk primary key (placement_id, day, session_hash),
  constraint placement_impression_seen_hash_len check (char_length(session_hash) between 8 and 80)
);
create index placement_impression_seen_day_idx on public.placement_impression_seen (day);
comment on table public.placement_impression_seen is 'Private. Dedupe key: one impression per placement per IST day per session. session_hash is PSEUDONYMOUS (HMAC of a random daily salt, the IP and the user agent; the salt is deleted after 48 hours, so it cannot be re-linked). The Worker deletes rows older than 2 days.';

-- ------------------------------------------------------------------------------------------------------------------
-- functions (public schema so PostgREST can expose them as rpc; EXECUTE only for service_role)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.bump_stat(
  p_placement_id uuid,
  p_date date,
  p_impressions integer,
  p_clicks integer,
  p_page_path text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_impressions < 0 or p_clicks < 0 then
    raise exception 'bump_stat: counts must not be negative' using errcode = '22023';
  end if;
  insert into public.placement_stats_daily as s (placement_id, date, impressions, clicks)
  values (p_placement_id, p_date, p_impressions, p_clicks)
  on conflict (placement_id, date) do update
    set impressions = s.impressions + excluded.impressions,
        clicks      = s.clicks + excluded.clicks;
  if p_page_path is not null then
    insert into public.placement_page_stats_daily as s (placement_id, date, page_path, impressions, clicks)
    values (p_placement_id, p_date, p_page_path, p_impressions, p_clicks)
    on conflict (placement_id, date, page_path) do update
      set impressions = s.impressions + excluded.impressions,
          clicks      = s.clicks + excluded.clicks;
  end if;
end;
$$;

comment on function public.bump_stat(uuid, date, integer, integer, text) is 'Atomic upsert of the daily placement counters (D-031). service_role only.';

create or replace function public.record_placement_impressions(
  p_day date,
  p_session_hash text,
  p_items jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  pid uuid;
  ppath text;
  counted integer := 0;
  today_ist date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- a caller (the Worker) cannot write counts for a far-away day, a junk session or a huge batch
  if p_day is null or p_day < today_ist - 1 or p_day > today_ist + 1 then
    raise exception 'record_placement_impressions: day out of range' using errcode = '22023';
  end if;
  if p_session_hash is null or char_length(p_session_hash) not between 8 and 80 then
    raise exception 'record_placement_impressions: bad session hash' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 8 then
    raise exception 'record_placement_impressions: items must be an array of at most 8' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    begin
      pid := (item ->> 'placement_id')::uuid;
    exception when invalid_text_representation then
      continue;
    end;
    ppath := item ->> 'page_path';
    if ppath is null or ppath !~ '^/[A-Za-z0-9/_.~%-]{0,199}$' then
      ppath := null;
    end if;
    -- only a placement that is switched on counts
    if not exists (select 1 from public.placements p where p.id = pid and p.status = 'active') then
      continue;
    end if;
    insert into public.placement_impression_seen (placement_id, day, session_hash)
    values (pid, p_day, p_session_hash)
    on conflict do nothing;
    if found then
      perform public.bump_stat(pid, p_day, 1, 0, ppath);
      counted := counted + 1;
    end if;
  end loop;
  return counted;
end;
$$;

comment on function public.record_placement_impressions(date, text, jsonb) is 'Dedupe per placement, per IST day, per session, then bump_stat. Returns how many impressions were new. service_role only.';

-- Clicks: recomputed (not incremented) from the click log, so running it twice for a day changes nothing. SECURITY DEFINER because the
-- Worker role may only INSERT into outbound_clicks (0001); the function reads it and writes the counters, and nothing else.
create or replace function public.rollup_placement_clicks(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows_changed integer := 0;
  n integer;
begin
  if p_day is null then
    raise exception 'rollup_placement_clicks: day is required' using errcode = '22023';
  end if;

  insert into public.placement_stats_daily as s (placement_id, date, impressions, clicks)
  select p.id, p_day, 0, count(*)::integer
  from public.outbound_clicks oc
  join public.placements p on p.go_slug = oc.go_slug
  where not oc.is_bot
    and (oc.ts at time zone 'Asia/Kolkata')::date = p_day
  group by p.id
  on conflict (placement_id, date) do update set clicks = excluded.clicks;
  get diagnostics n = row_count;
  rows_changed := rows_changed + n;

  insert into public.placement_page_stats_daily as s (placement_id, date, page_path, impressions, clicks)
  select p.id, p_day, oc.page_path, 0, count(*)::integer
  from public.outbound_clicks oc
  join public.placements p on p.go_slug = oc.go_slug
  where not oc.is_bot
    and (oc.ts at time zone 'Asia/Kolkata')::date = p_day
    and oc.page_path ~ '^/[A-Za-z0-9/_.~%-]{0,199}$'
  group by p.id, oc.page_path
  on conflict (placement_id, date, page_path) do update set clicks = excluded.clicks;
  get diagnostics n = row_count;
  rows_changed := rows_changed + n;

  return rows_changed;
end;
$$;

comment on function public.rollup_placement_clicks(date) is 'Recompute the clicks of one IST day per placement (and per page) from outbound_clicks; idempotent. SECURITY DEFINER; service_role only.';

-- ------------------------------------------------------------------------------------------------------------------
-- Row level security, privileges
-- ------------------------------------------------------------------------------------------------------------------
alter table public.sponsors                    enable row level security;
alter table public.placements                  enable row level security;
alter table public.placement_stats_daily       enable row level security;
alter table public.placement_page_stats_daily  enable row level security;
alter table public.placement_impression_seen   enable row level security;
-- Deliberately NO policies for anon or authenticated on any table above.

revoke all on table
  public.sponsors, public.placements, public.placement_stats_daily, public.placement_page_stats_daily, public.placement_impression_seen
  from public, anon, authenticated, service_role;

-- service_role: only what the Worker needs (no delete on sponsors or placements: a placement is ended, never removed).
grant select, insert, update on public.sponsors                   to service_role;
grant select, insert, update on public.placements                 to service_role;
grant select, insert, update on public.placement_stats_daily      to service_role;
grant select, insert, update on public.placement_page_stats_daily to service_role;
grant select, insert, delete on public.placement_impression_seen  to service_role;

-- Functions: nobody but the Worker's role can call them through the API.
revoke all on function public.bump_stat(uuid, date, integer, integer, text)         from public, anon, authenticated;
revoke all on function public.record_placement_impressions(date, text, jsonb)      from public, anon, authenticated;
revoke all on function public.rollup_placement_clicks(date)                         from public, anon, authenticated;
grant execute on function public.bump_stat(uuid, date, integer, integer, text)     to service_role;
grant execute on function public.record_placement_impressions(date, text, jsonb)  to service_role;
grant execute on function public.rollup_placement_clicks(date)                      to service_role;
