-- 0001_lead_funnel.sql - M1: the private lead funnel tables.
--
-- Tables: leads, lead_events, events, outbound_clicks, rate_limit_hits, daily_salts.
-- Everything here is PRIVATE (D-005, D-029): the Cloudflare Worker reaches it only with the Supabase SECRET key
-- (role service_role) through the REST API. Rules applied to every table:
--   1. ROW LEVEL SECURITY is enabled and there are NO policies for anon or authenticated.
--   2. All default privileges are REVOKEd from PUBLIC, anon and authenticated (new Supabase projects stop auto-exposing
--      tables on 2026-05-30, existing ones on 2026-10-30, VF-B7; until then the defaults would grant everything).
--   3. service_role (which bypasses RLS but NOT grants) gets only the privileges the Worker needs, listed explicitly.
--   4. No public read is needed in M1, so there are no `api` views here.
-- Functions live in the unexposed schema `app` with a fixed search_path and EXECUTE revoked from everyone (D-005 item 4).
--
-- Money is integer paise (value_paise); no price, fee or tax rate is hardcoded or defaulted (D-020, D-021).
-- Instants are timestamptz (UTC); event dates are plain dates read as Asia/Kolkata (D-030).
-- Retention (D-028): closed leads anonymised after 24 months; raw events and outbound_clicks kept 90 days then aggregated;
-- rate_limit_hits are useful for 24 hours (the Worker purges rows older than 2 days); daily_salts kept 48 hours.
--
-- Apply with the dashboard SQL editor or `supabase db push` (supabase/README.md), then run supabase/checks/0001_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- Default privileges (S-16): on a project that predates the 2026-10-30 change, and for tables created from the dashboard,
-- every FUTURE table, sequence and function that role `postgres` creates in schema public would be granted to anon and
-- authenticated. Turn that off first, so a table added later without its own REVOKE is closed by default instead of open.
-- service_role keeps its defaults (the Worker's key). supabase/checks/0001_assertions.sql asserts all of this on every table
-- in public and in pg_default_acl. Role: `postgres` is the role the dashboard SQL editor and `supabase db push` run as.
-- ------------------------------------------------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

create schema if not exists app;
revoke all on schema app from public;

-- ------------------------------------------------------------------------------------------------------------------
-- Helper functions (security invoker, fixed search_path, not callable by API roles)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- leads (spec 11.2, D-025, D-028, D-032)
-- ------------------------------------------------------------------------------------------------------------------
create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  ref_code           text not null,
  type               text not null,
  status             text not null default 'new',
  name               text not null,
  organization       text,
  phone              text,
  email              text,
  whatsapp_ok        boolean not null default false,
  contact_preference text,
  lang               text not null default 'en',
  payload            jsonb not null default '{}'::jsonb,
  budget_range       text,
  value_paise        bigint,
  source_path        text,
  utm                jsonb,
  follow_up_on       date,
  notes              text,
  lost_reason        text,
  idempotency_key    uuid,
  parent_lead_id     uuid references public.leads (id) on delete set null,
  consent_id         text not null,
  consent_version    text not null,
  consent_at         timestamptz not null,
  ip_hash            text,
  alert_state        text not null default 'pending',
  alert_attempted_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint leads_ref_code_uq unique (ref_code),
  constraint leads_idempotency_key_uq unique (idempotency_key),
  constraint leads_ref_code_format check (ref_code ~ '^PS-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'),
  constraint leads_type_check check (type in ('coverage', 'sponsorship', 'player_product', 'featured_listing', 'academy_listing', 'general', 'tournament_submission')),
  constraint leads_status_check check (status in ('new', 'contacted', 'quoted', 'won', 'completed', 'lost')),
  constraint leads_alert_state_check check (alert_state in ('pending', 'sent', 'failed')),
  constraint leads_lang_check check (lang in ('en', 'ta')),
  constraint leads_contact_preference_check check (contact_preference is null or contact_preference in ('whatsapp', 'call', 'email')),
  constraint leads_phone_format check (phone is null or phone ~ '^[0-9]{8,15}$'),
  constraint leads_value_paise_nonneg check (value_paise is null or value_paise >= 0),
  constraint leads_has_contact check (phone is not null or email is not null)
);

create index leads_status_created_idx on public.leads (status, created_at desc);
create index leads_alert_state_idx on public.leads (created_at desc) where alert_state <> 'sent';
create index leads_follow_up_idx on public.leads (follow_up_on) where follow_up_on is not null;
create index leads_parent_idx on public.leads (parent_lead_id) where parent_lead_id is not null;

comment on table public.leads is 'Private. Enquiries from the website forms (coverage, sponsorship, general, player_product, tournament_submission). Written by the Worker with the secret key; read by the owner in Supabase Studio until the M3 admin.';
comment on column public.leads.ref_code is 'Customer-facing reference PS-YYYY-XXXXXX, IST year, random 6-character Crockford base32 suffix (no I L O U); never sequential.';
comment on column public.leads.type is 'Kind of lead; spec 11.2 name for the contract field "kind".';
comment on column public.leads.name is 'PRIVATE personal data: the contact person''s name.';
comment on column public.leads.organization is 'PRIVATE: organisation the contact belongs to.';
comment on column public.leads.phone is 'PRIVATE personal data: digits with country code, no plus (normalised).';
comment on column public.leads.email is 'PRIVATE personal data: lower-case ASCII address, optional.';
comment on column public.leads.payload is 'PRIVATE: kind-specific form fields (event details, notes, message...). May contain free text typed by the visitor.';
comment on column public.leads.notes is 'PRIVATE: the owner''s own notes.';
comment on column public.leads.utm is 'Validated UTM values from the page URL (source, medium, campaign, term, content).';
comment on column public.leads.source_path is 'Path of the page the form was on (no query string).';
comment on column public.leads.value_paise is 'Deal value in integer paise, set by the owner. No default.';
comment on column public.leads.idempotency_key is 'Client-generated uuid per form instance; UNIQUE so a retry never creates a second lead. NULL for derived (child) leads.';
comment on column public.leads.parent_lead_id is 'Set on the coverage lead created from a tournament listing with the coverage box ticked.';
comment on column public.leads.consent_id is 'Notice id shown with the form (src/content/consent.ts), D-028.';
comment on column public.leads.consent_version is 'Notice version shown with the form, D-028.';
comment on column public.leads.consent_at is 'When the submission (and so the consent) was received.';
comment on column public.leads.ip_hash is 'PSEUDONYMOUS: truncated HMAC-SHA-256 of the IP address with a key id (D-029). Not the IP.';
comment on column public.leads.alert_state is 'pending = not yet attempted, sent = the owner was alerted (Telegram or email), failed = every configured channel failed: re-send it.';

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------------------------------------------------------
-- lead_events: what happened to a lead (append-only in practice; no personal data in `meta`)
-- ------------------------------------------------------------------------------------------------------------------
create table public.lead_events (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  event      text not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint lead_events_event_format check (event ~ '^[a-z_]{1,40}$')
);
create index lead_events_lead_idx on public.lead_events (lead_id, created_at);

comment on table public.lead_events is 'Private. Timeline of a lead: created, alert_sent, alert_failed, later status changes. `meta` never holds names, phones, emails or free text.';

create or replace function app.lead_created_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.lead_events (lead_id, event, meta)
  values (new.id, 'created', jsonb_build_object('type', new.type));
  return new;
end;
$$;

create trigger leads_after_insert_event
  after insert on public.leads
  for each row execute function app.lead_created_event();

-- ------------------------------------------------------------------------------------------------------------------
-- events: first-party analytics (spec 16). No personal data, no raw IP (D-028, D-032).
-- ------------------------------------------------------------------------------------------------------------------
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  page_path    text,
  props        jsonb not null default '{}'::jsonb,
  session_hash text,
  is_bot       boolean not null default false,
  ts           timestamptz not null default now(),
  constraint events_name_format check (name ~ '^[a-z_]{1,40}$')
);
create index events_name_ts_idx on public.events (name, ts desc);
create index events_ts_idx on public.events (ts);

comment on table public.events is 'Private. Allow-listed first-party events (whatsapp_click, form_start...). Kept 90 days then aggregated (D-028).';
comment on column public.events.session_hash is 'PSEUDONYMOUS: HMAC of a random daily salt (kept 48 h), the IP and the user agent. Not linkable across days.';
comment on column public.events.props is 'Allow-listed slug-like values only (no free text).';

-- ------------------------------------------------------------------------------------------------------------------
-- outbound_clicks: /go/[slug] click log (M1 basic; spec 11.3, D-031). No raw IP.
-- ------------------------------------------------------------------------------------------------------------------
create table public.outbound_clicks (
  id          uuid primary key default gen_random_uuid(),
  go_slug     text not null,
  target_type text,
  target_id   uuid,
  page_path   text,
  utm         jsonb,
  ua_hash     text,
  is_bot      boolean not null default false,
  ts          timestamptz not null default now(),
  constraint outbound_clicks_slug_format check (go_slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);
create index outbound_clicks_slug_ts_idx on public.outbound_clicks (go_slug, ts desc);

comment on table public.outbound_clicks is 'Private. One row per /go/[slug] redirect. Kept 90 days then aggregated (D-028).';
comment on column public.outbound_clicks.ua_hash is 'PSEUDONYMOUS: truncated HMAC of the user agent. No raw IP is stored.';

-- ------------------------------------------------------------------------------------------------------------------
-- rate_limit_hits: database counter for the per-IP, per-phone and per-email limits (D-029)
-- ------------------------------------------------------------------------------------------------------------------
create table public.rate_limit_hits (
  id       uuid primary key default gen_random_uuid(),
  bucket   text not null,
  key_hash text not null,
  hit_at   timestamptz not null default now(),
  constraint rate_limit_hits_bucket_format check (bucket ~ '^[a-z_]{1,40}$')
);
create index rate_limit_hits_lookup_idx on public.rate_limit_hits (bucket, key_hash, hit_at desc);
create index rate_limit_hits_hit_at_idx on public.rate_limit_hits (hit_at);

comment on table public.rate_limit_hits is 'Private. One row per accepted attempt, keyed by a pseudonymous HMAC of the IP, phone or email (never the value). Rows older than 2 days are deleted by the Worker.';
comment on column public.rate_limit_hits.key_hash is 'PSEUDONYMOUS: kid.<32 hex> HMAC-SHA-256 of the IP /64, phone digits or email.';

-- ------------------------------------------------------------------------------------------------------------------
-- daily_salts: the random daily secret behind session hashes (D-029: 48-hour TTL)
-- ------------------------------------------------------------------------------------------------------------------
create table public.daily_salts (
  day        date primary key,
  salt       text not null,
  created_at timestamptz not null default now()
);

comment on table public.daily_salts is 'Private. Random per-day salt (IST date) for events.session_hash; the Worker deletes days older than 2 days so old sessions cannot be re-linked.';
comment on column public.daily_salts.salt is 'SECRET-ish: random hex. Never selected into any public view.';

-- ------------------------------------------------------------------------------------------------------------------
-- Row level security, privileges
-- ------------------------------------------------------------------------------------------------------------------
alter table public.leads            enable row level security;
alter table public.lead_events      enable row level security;
alter table public.events           enable row level security;
alter table public.outbound_clicks  enable row level security;
alter table public.rate_limit_hits  enable row level security;
alter table public.daily_salts      enable row level security;
-- Deliberately NO policies for anon or authenticated on any table above.

revoke all on table
  public.leads, public.lead_events, public.events, public.outbound_clicks, public.rate_limit_hits, public.daily_salts
  from public, anon, authenticated, service_role;
-- (service_role is revoked too: on a project that predates the 2026-10-30 change, and on any database where role postgres has the
-- Supabase default privileges, service_role already holds ALL on every new table, including delete and truncate. Found by the
-- first local run, 2026-10-22. The grants below then give back only what the Worker needs.)

-- service_role: only what the Worker needs (service_role bypasses RLS but not these grants, VF-B7).
grant select, insert, update on public.leads           to service_role;   -- no delete: retention anonymises (D-028)
grant select, insert         on public.lead_events     to service_role;
grant insert                 on public.events          to service_role;
grant insert                 on public.outbound_clicks to service_role;
grant select, insert, delete on public.rate_limit_hits to service_role;
grant select, insert, delete on public.daily_salts     to service_role;

-- Functions: nobody can call them through the API.
revoke all on function app.touch_updated_at()    from public, anon, authenticated;
revoke all on function app.lead_created_event()  from public, anon, authenticated;
