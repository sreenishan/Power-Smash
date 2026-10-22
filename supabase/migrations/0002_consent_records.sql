-- 0002_consent_records.sql - M1: consent evidence (D-028, D-032; review finding C-10).
--
-- Tables: notice_versions, consent_events.
--   notice_versions  the exact text of every notice or consent the website showed, with its SHA-256, keyed by the notice id and
--                    version from src/content/consent.ts. One row per version; it can never change afterwards.
--   consent_events   APPEND-ONLY: one row per notice or consent per stored lead (who: the lead, what: notice id + version +
--                    hash of the text, given or not, when, channel). It holds NO IP hash (N-4): the leads row already has one and can be
--                    anonymised, while this table can never be edited. Written by the Worker after the
--                    lead row is stored (src/lib/leads/store.ts recordConsent).
-- D-028 also lists a suppression list, an erasure log and withdrawals: they arrive with the M3 admin and Phase 2 (a withdrawal is a
-- NEW consent_events row with given = false, never an edit). Same rules as 0001: RLS on, no policies, nothing for anon or
-- authenticated, explicit grants to service_role only.
-- Apply after 0001, then run supabase/checks/0001_assertions.sql and supabase/checks/0002_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- A trigger function that refuses to change history (security invoker, fixed search_path, not callable by API roles)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.forbid_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on % is not allowed: this table is append-only (D-028)', tg_op, tg_table_name using errcode = '42501';
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- notice_versions
-- ------------------------------------------------------------------------------------------------------------------
create table public.notice_versions (
  id         text        not null,
  version    text        not null,
  sha256     text        not null,
  "text"     text        not null,
  created_at timestamptz not null default now(),
  constraint notice_versions_pk primary key (id, version),
  constraint notice_versions_id_format check (id ~ '^[a-z0-9-]{1,60}$'),
  constraint notice_versions_version_format check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  constraint notice_versions_sha256_format check (sha256 ~ '^[0-9a-f]{64}$'),
  -- the database re-computes the hash: a wrong hash from the Worker is refused, never stored as "evidence"
  constraint notice_versions_sha256_matches check (sha256 = encode(sha256(convert_to("text", 'UTF8')), 'hex'))
);

comment on table public.notice_versions is 'Private. The exact text of each notice or consent shown on a form (id and version from src/content/consent.ts) with its SHA-256. Insert-only: a version never changes (D-028).';
comment on column public.notice_versions.id is 'Notice id, for example lead-notice or tournament-public-contact.';
comment on column public.notice_versions.version is 'Notice version string from src/content/consent.ts (bumped whenever the text changes).';
comment on column public.notice_versions.sha256 is 'Lower-case hex SHA-256 of the UTF-8 text. Checked by the database.';
comment on column public.notice_versions."text" is 'The full notice text exactly as shown (public wording, no personal data).';

create trigger notice_versions_append_only
  before update or delete on public.notice_versions
  for each row execute function app.forbid_row_change();
create trigger notice_versions_no_truncate
  before truncate on public.notice_versions
  for each statement execute function app.forbid_row_change();

-- ------------------------------------------------------------------------------------------------------------------
-- consent_events (append-only)
-- ------------------------------------------------------------------------------------------------------------------
create table public.consent_events (
  id             uuid        primary key default gen_random_uuid(),
  lead_id        uuid,
  notice_id      text        not null,
  notice_version text        not null,
  notice_sha256  text,
  given          boolean     not null,
  channel        text        not null default 'web_form',
  created_at     timestamptz not null default now(),
  constraint consent_events_notice_id_format check (notice_id ~ '^[a-z0-9-]{1,60}$'),
  constraint consent_events_notice_version_format check (notice_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  constraint consent_events_sha256_format check (notice_sha256 is null or notice_sha256 ~ '^[0-9a-f]{64}$'),
  constraint consent_events_channel_format check (channel ~ '^[a-z_]{1,30}$')
);
create index consent_events_lead_idx on public.consent_events (lead_id, created_at);
create index consent_events_notice_idx on public.consent_events (notice_id, notice_version);

comment on table public.consent_events is 'Private. Append-only evidence of the notice or consent shown with each stored lead (D-028). A withdrawal is a new row with given = false. No update, no delete, no truncate.';
comment on column public.consent_events.lead_id is 'The lead this evidence belongs to. No foreign key on purpose: the evidence outlives the lead if the lead is anonymised or removed.';
comment on column public.consent_events.notice_id is 'Notice id from src/content/consent.ts, for example lead-notice or tournament-public-contact.';
comment on column public.consent_events.notice_version is 'The version the form says it showed, stored as supplied (an old open tab keeps its version).';
comment on column public.consent_events.notice_sha256 is 'SHA-256 of that notice text when this server build knows the version, otherwise NULL (an unknown old version).';
comment on column public.consent_events.given is 'true = the notice was shown and the form submitted, or the box was ticked; false = an optional box was left unticked, or consent was withdrawn.';
comment on column public.consent_events.channel is 'Where it happened: web_form for the website forms.';

create trigger consent_events_append_only
  before update or delete on public.consent_events
  for each row execute function app.forbid_row_change();
create trigger consent_events_no_truncate
  before truncate on public.consent_events
  for each statement execute function app.forbid_row_change();

-- ------------------------------------------------------------------------------------------------------------------
-- Row level security, privileges
-- ------------------------------------------------------------------------------------------------------------------
alter table public.notice_versions enable row level security;
alter table public.consent_events  enable row level security;
-- Deliberately NO policies for anon or authenticated on either table.

revoke all on table public.notice_versions, public.consent_events from public, anon, authenticated, service_role;  -- service_role too: see 0001

-- service_role: read and append only. No update, no delete, no truncate.
grant select, insert on public.notice_versions to service_role;
grant select, insert on public.consent_events  to service_role;

revoke all on function app.forbid_row_change() from public, anon, authenticated;
