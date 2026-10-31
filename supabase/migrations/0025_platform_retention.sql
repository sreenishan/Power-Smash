-- 0025_platform_retention.sql: removing old registrations and old email sign-ups after a keep-for period the OWNER sets (D-028
-- retention schedule; the period itself is an open lawyer decision, so there is NO default: an empty period means nothing is removed).
--
-- What it adds:
--   retention_settings            one row: registration_keep_days and subscriber_keep_days, both NULL (= never remove), and
--                                 keep_unsubscribe_hash, FALSE (= an unsubscribed address is deleted WITHOUT keeping anything). Written
--                                 only by admin_set_platform_retention (owner only, audited). Ranges: registrations 7..3650 days,
--                                 sign-ups 1..3650 days. These are limits on what the owner may type, not suggested values. Keeping the
--                                 hash is a separate yes (the lawyer's, D-127): it is off until the owner switches it on.
--   notify_unsubscribe_hashes     PRIVATE. The SHA-256 of an unsubscribed address that was deleted, and the day it was kept (no time,
--                                 no id, no link to anything else). Written only while keep_unsubscribe_hash is on. Pseudonymous, not
--                                 anonymous: anyone holding a list of addresses can test it against these hashes. Its only use: a
--                                 future import of addresses (none exists today) must skip it, so a deleted unsubscribe can never turn
--                                 back into a subscription without the person signing up again themselves (double opt-in). Helper:
--                                 app.notify_email_unsubscribed(email). A hash stays even if the person later signs up again.
--   event_registrations           + anonymised_at; contact_phone may be empty once anonymised (the rule moves into a check). An
--                                 anonymised row is FROZEN (trigger): no RPC can verify, convert or reject it any more, so a cleared
--                                 registration never becomes a player called 'Anonymised'.
--   app.platform_retention_candidates(now)   which rows are due, and what happens to each (internal, nobody can run it directly).
--   app.platform_retention(actor, dry_run, now)   the job with an explicit "now", so the checks can test the exact boundary.
--   public.admin_run_platform_retention(actor, dry_run default true)   the job at now(); service_role only (the retention workflow).
--   public.admin_set_platform_retention, public.admin_platform_retention_summary   owner RPCs (app.require_owner FIRST).
--
-- What the job does when the period is set (all of it idempotent: a second run changes nothing and writes no audit row):
--   Registrations (event_registrations). The clock starts at the LATER of: the end of the event's last day (India time; the
--     tournament's end_date, else its start_date) and the moment the registration was closed (converted_at, rejected_at; a registration
--     still "submitted" or "payment verified" when the event is over counts as closed when the event ended). A registration whose
--     tournament has no date is never removed (counted as registrations_without_event_date, so the owner can add the date).
--     * converted (an event entry exists) -> ANONYMISED: the entry, its players, the fee and the verified amount stay; the names as
--       typed become 'Anonymised' (and 'Anonymised partner' for a pair, so the count of players stays), the phone, email, payment
--       reference and ip hash are cleared, whatsapp_ok becomes false, a reject reason becomes 'Removed after the keep-for period'.
--     * any registration with a verified payment -> ANONYMISED the same way (the owner's money record stays consistent).
--     * everything else (rejected or never processed, no money recorded) -> DELETED (nothing else points at a registration).
--     The consent evidence (consent_id, consent_version, consent_at) and the reference stay on an anonymised row.
--   Email sign-ups (notify_subscribers). Active subscribers are NEVER touched. What happens is decided by the CURRENT status (someone
--     who unsubscribed and then signed up again without confirming is pending, not unsubscribed):
--     * pending (never confirmed, or signed up again and not confirmed): deleted once the confirmation link has expired AND the last
--       confirmation email is older than the period. No hash.
--     * unsubscribed: deleted once unsubscribed_at is older than the period. Its address hash is kept (notify_unsubscribe_hashes)
--       only while keep_unsubscribe_hash is on.
--     Deleting a subscriber also deletes its old outbox rows (0023 cascade: subject, body and delivery state, never an address). A
--     subscriber with an outbox row being sent right now is left for the next run.
-- NEVER touched: leads (0010 does those), audit_log, consent_events, notice_versions, suppression, event_entries, players, active
-- subscribers.
-- A dry run counts only and writes nothing, not even an audit row. A real run that changed something writes ONE audit row with the
-- counts. The answer and the audit hold numbers only: never a name, phone, email, address hash or row id.
--
-- House rules (0001-0023): RLS on with NO policies, everything revoked, service_role SELECT only on base tables; writes only through
-- SECURITY DEFINER RPCs with search_path = '' that check access FIRST; errors start 'INVALID:', 'NOT_FOUND:', 'STALE:' or
-- 'FORBIDDEN:'. No api view: nothing here is public. Apply after 0023 (and any 0024), then run supabase/checks/0025_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- retention_settings: the owner's keep-for periods. NULL = never remove (the default, until the lawyer decides).
-- ------------------------------------------------------------------------------------------------------------------
create table public.retention_settings (
  id                      smallint    primary key check (id = 1),
  registration_keep_days  integer     check (registration_keep_days is null or registration_keep_days between 7 and 3650),
  subscriber_keep_days    integer     check (subscriber_keep_days is null or subscriber_keep_days between 1 and 3650),
  keep_unsubscribe_hash   boolean     not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              text
);
insert into public.retention_settings (id) values (1);
comment on table public.retention_settings is 'Owner keep-for periods (D-028). NULL = never remove; no default, the lawyer decides. Written only by admin_set_platform_retention.';
comment on column public.retention_settings.registration_keep_days is 'Days a closed registration is kept after the event ended (and after it was closed). NULL = never removed.';
comment on column public.retention_settings.subscriber_keep_days is 'Days an unconfirmed or unsubscribed email sign-up is kept. NULL = never removed.';
comment on column public.retention_settings.keep_unsubscribe_hash is 'true = keep a SHA-256 of a deleted unsubscribed address so an import skips it. Off until the lawyer says yes (D-127).';
create trigger retention_settings_touch_updated_at before update on public.retention_settings for each row execute function app.touch_updated_at();

alter table public.retention_settings enable row level security;
revoke all on table public.retention_settings from public, anon, authenticated, service_role;
grant select on public.retention_settings to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_unsubscribe_hashes: what is left of a deleted unsubscribed address (PRIVATE).
-- ------------------------------------------------------------------------------------------------------------------
create table public.notify_unsubscribe_hashes (
  email_sha256  text  primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  kept_on       date  not null
);
comment on table public.notify_unsubscribe_hashes is 'Private (D-028 suppression list). SHA-256 of a deleted unsubscribed address (lower case, trimmed) and the India date it was kept. Pseudonymous, not anonymous: a known address can be checked against it. Only use: an import must skip these addresses. Written only by the retention job, and only while retention_settings.keep_unsubscribe_hash is on.';

alter table public.notify_unsubscribe_hashes enable row level security;
revoke all on table public.notify_unsubscribe_hashes from public, anon, authenticated, service_role;
grant select on public.notify_unsubscribe_hashes to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- event_registrations: an anonymised registration has no phone
-- ------------------------------------------------------------------------------------------------------------------
alter table public.event_registrations add column anonymised_at timestamptz;
comment on column public.event_registrations.anonymised_at is 'Set by the retention job (0025) when the names as typed, phone, email and payment reference were removed. Such a row has no phone.';
alter table public.event_registrations alter column contact_phone drop not null;
alter table public.event_registrations add constraint event_registrations_has_contact check (anonymised_at is not null or contact_phone is not null);
alter table public.event_registrations add constraint event_registrations_anonymised_clean check (
  anonymised_at is null or (contact_phone is null and contact_email is null and payment_reference is null and ip_hash is null and player1_name = 'Anonymised'
    and (player2_name is null or player2_name = 'Anonymised partner'))
);

-- An anonymised registration is frozen: the typed names are gone, so verifying, converting (a player called 'Anonymised') or rejecting
-- it again would be wrong. Every 0020 write RPC updates the row, so this one trigger refuses all of them (the whole call rolls back).
create or replace function app.event_registration_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymised_at is not null then
    raise exception 'INVALID: this registration''s details were removed after the keep-for period, so it cannot be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger event_registrations_anonymised_frozen before update on public.event_registrations
  for each row execute function app.event_registration_frozen();

-- ------------------------------------------------------------------------------------------------------------------
-- Helpers (pure / internal)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.notify_email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_email is null then null else encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex') end;
$$;

-- For a future import of addresses: true = this address unsubscribed and was deleted; do not add it.
create or replace function app.notify_email_unsubscribed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_email is not null and exists (select 1 from public.notify_unsubscribe_hashes h where h.email_sha256 = app.notify_email_hash(p_email));
$$;

-- Which rows are due at p_now, and what happens to each:
--   kind 'registration': action 'anonymise' | 'delete' | 'no_event_date' (due by its closing time, but the tournament has no date: kept)
--   kind 'subscriber':   action 'delete' (pending now) | 'delete_unsubscribed' (unsubscribed now; a hash is kept only while
--                        keep_unsubscribe_hash is on)
-- A NULL period returns no row of that kind.
create or replace function app.platform_retention_candidates(p_now timestamptz)
returns table (kind text, id uuid, action text)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select rs.registration_keep_days as rdays, rs.subscriber_keep_days as sdays from public.retention_settings rs where rs.id = 1
  ),
  reg as (
    select r.id, r.status, r.payment_verified_at,
      ((coalesce(t.end_date, t.start_date) + 1)::timestamp at time zone 'Asia/Kolkata') as event_over,
      case r.status
        when 'converted' then r.converted_at
        when 'rejected' then r.rejected_at
        when 'submitted' then null
        when 'payment_verified' then null
        else r.updated_at
      end as closed_at
    from public.event_registrations r
    join public.tournament_events e on e.id = r.event_id
    join public.tournaments t on t.id = e.tournament_id
    where r.anonymised_at is null
  )
  select 'registration'::text, reg.id,
    case
      when reg.event_over is null then 'no_event_date'
      when reg.status = 'converted' or reg.payment_verified_at is not null then 'anonymise'
      else 'delete'
    end
  from reg cross join s
  where s.rdays is not null
    and case
      when reg.event_over is null then reg.closed_at is not null and reg.closed_at + make_interval(days => s.rdays) <= p_now
      else greatest(reg.event_over, reg.closed_at) + make_interval(days => s.rdays) <= p_now
    end
  union all
  select 'subscriber'::text, n.id, case when n.status = 'unsubscribed' then 'delete_unsubscribed' else 'delete' end
  from public.notify_subscribers n cross join s
  where s.sdays is not null
    and (
      (n.status = 'pending' and n.confirm_expires_at <= p_now
        and coalesce(n.last_confirmation_at, n.consent_at) + make_interval(days => s.sdays) <= p_now)
      or (n.status = 'unsubscribed' and n.unsubscribed_at + make_interval(days => s.sdays) <= p_now)
    )
    and not exists (select 1 from public.notification_outbox o where o.recipient_subscriber_id = n.id and o.status = 'sending');
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- app.platform_retention: the job, with an explicit "now". Answer: counts only.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.platform_retention(p_actor text, p_dry_run boolean, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rdays integer;
  v_sdays integer;
  v_keep_hash boolean;
  v_anon uuid[];
  v_del uuid[];
  v_pending uuid[];
  v_unsub uuid[];
  v_reg_anon integer := 0;
  v_reg_del integer := 0;
  v_reg_nodate integer := 0;
  v_sub_pending integer := 0;
  v_sub_unsub integer := 0;
  v_hashes integer := 0;
  v_outbox integer := 0;
begin
  -- access check FIRST: EXECUTE on this function is granted to nobody; the public wrapper is service_role only. Then the inputs.
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'INVALID: a retention run needs an actor name' using errcode = '22023';
  end if;
  if p_dry_run is null then raise exception 'INVALID: dry run must be true or false' using errcode = '22023'; end if;
  if p_now is null then raise exception 'INVALID: a retention run needs the time it runs at' using errcode = '22023'; end if;
  select rs.registration_keep_days, rs.subscriber_keep_days, rs.keep_unsubscribe_hash into v_rdays, v_sdays, v_keep_hash
    from public.retention_settings rs where rs.id = 1;

  select count(*) filter (where c.kind = 'registration' and c.action = 'no_event_date')
    into v_reg_nodate
    from app.platform_retention_candidates(p_now) c;

  if p_dry_run then
    select count(*) filter (where c.kind = 'registration' and c.action = 'anonymise'),
           count(*) filter (where c.kind = 'registration' and c.action = 'delete'),
           count(*) filter (where c.kind = 'subscriber' and c.action = 'delete'),
           count(*) filter (where c.kind = 'subscriber' and c.action = 'delete_unsubscribed')
      into v_reg_anon, v_reg_del, v_sub_pending, v_sub_unsub
      from app.platform_retention_candidates(p_now) c;
    if v_keep_hash then
      select count(distinct app.notify_email_hash(n.email)) into v_hashes
        from public.notify_subscribers n
        join app.platform_retention_candidates(p_now) c on c.kind = 'subscriber' and c.action = 'delete_unsubscribed' and c.id = n.id
       where not exists (select 1 from public.notify_unsubscribe_hashes h where h.email_sha256 = app.notify_email_hash(n.email));
    end if;
    select count(*) into v_outbox
      from public.notification_outbox o
      join app.platform_retention_candidates(p_now) c on c.kind = 'subscriber' and c.id = o.recipient_subscriber_id;
  else
    -- lock the due rows (and the outbox rows of due sign-ups, so the sender cannot start one meanwhile), then take ONE fresh list and
    -- use it for every statement below: the hash, the counts and the deletes always agree
    perform 1 from public.event_registrations r
      where r.id in (select c.id from app.platform_retention_candidates(p_now) c where c.kind = 'registration' and c.action in ('anonymise', 'delete'))
      for update;
    perform 1 from public.notify_subscribers n
      where n.id in (select c.id from app.platform_retention_candidates(p_now) c where c.kind = 'subscriber')
      for update;
    perform 1 from public.notification_outbox o
      where o.recipient_subscriber_id in (select c.id from app.platform_retention_candidates(p_now) c where c.kind = 'subscriber')
      for update;
    select coalesce(array_agg(c.id) filter (where c.kind = 'registration' and c.action = 'anonymise'), '{}'),
           coalesce(array_agg(c.id) filter (where c.kind = 'registration' and c.action = 'delete'), '{}'),
           coalesce(array_agg(c.id) filter (where c.kind = 'subscriber' and c.action = 'delete'), '{}'),
           coalesce(array_agg(c.id) filter (where c.kind = 'subscriber' and c.action = 'delete_unsubscribed'), '{}')
      into v_anon, v_del, v_pending, v_unsub
      from app.platform_retention_candidates(p_now) c;

    with a as (
      update public.event_registrations r
         set player1_name = 'Anonymised',
             player2_name = case when r.player2_name is null then null else 'Anonymised partner' end,
             contact_phone = null, contact_email = null, payment_reference = null, ip_hash = null, whatsapp_ok = false,
             rejected_reason = case when r.rejected_reason is null then null else 'Removed after the keep-for period' end,
             anonymised_at = p_now, revision = r.revision + 1
       where r.id = any (v_anon) and r.anonymised_at is null
      returning 1
    )
    select count(*) into v_reg_anon from a;

    with d as (delete from public.event_registrations r where r.id = any (v_del) returning 1)
    select count(*) into v_reg_del from d;

    if v_keep_hash then
      insert into public.notify_unsubscribe_hashes (email_sha256, kept_on)
        select distinct app.notify_email_hash(n.email), (p_now at time zone 'Asia/Kolkata')::date
          from public.notify_subscribers n
         where n.id = any (v_unsub)
        on conflict (email_sha256) do nothing;
      get diagnostics v_hashes = row_count;
    end if;

    select count(*) into v_outbox
      from public.notification_outbox o
     where o.recipient_subscriber_id = any (v_pending || v_unsub);

    with d as (delete from public.notify_subscribers n where n.id = any (v_pending) returning 1)
    select count(*) into v_sub_pending from d;
    with d as (delete from public.notify_subscribers n where n.id = any (v_unsub) returning 1)
    select count(*) into v_sub_unsub from d;

    if v_reg_anon + v_reg_del + v_sub_pending + v_sub_unsub + v_hashes > 0 then
      perform app.audit(p_actor, 'platform_retention_run', 'retention', null,
        jsonb_build_object('registrations_anonymised', v_reg_anon, 'registrations_deleted', v_reg_del,
          'subscribers_unconfirmed_deleted', v_sub_pending, 'subscribers_unsubscribed_deleted', v_sub_unsub,
          'unsubscribe_hashes_kept', v_hashes, 'outbox_rows_removed', v_outbox,
          'registration_keep_days', v_rdays, 'subscriber_keep_days', v_sdays),
        'D-028 retention schedule: owner keep-for periods');
    end if;
  end if;

  return jsonb_build_object('dry_run', p_dry_run,
    'registration_keep_days', v_rdays, 'subscriber_keep_days', v_sdays,
    'registrations_anonymised', v_reg_anon, 'registrations_deleted', v_reg_del, 'registrations_without_event_date', v_reg_nodate,
    'subscribers_unconfirmed_deleted', v_sub_pending, 'subscribers_unsubscribed_deleted', v_sub_unsub,
    'unsubscribe_hashes_kept', v_hashes, 'outbox_rows_removed', v_outbox);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_run_platform_retention: the retention workflow's call (service_role only), at the database's now().
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_run_platform_retention(p_actor text, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- access check FIRST: EXECUTE is granted to service_role only; the inner function checks the actor and the flag
  return app.platform_retention(p_actor, p_dry_run, now());
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_platform_retention: record {registrationKeepDays, subscriberKeepDays, keepUnsubscribeHash}; each period a whole number of days
-- or null (= never remove); keepUnsubscribeHash true or false (no default in the record: the owner answers it each time).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_platform_retention(p_actor text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.retention_settings%rowtype;
  v_reg integer;
  v_sub integer;
  v_hash boolean;
  v_fields text[] := '{}';
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['registrationKeepDays', 'subscriberKeepDays', 'keepUnsubscribeHash'], 'keep-for periods');
  if jsonb_typeof(p_record -> 'keepUnsubscribeHash') is distinct from 'boolean' then
    raise exception 'INVALID: say yes or no to keeping a code of removed unsubscribed addresses' using errcode = '22023';
  end if;
  v_hash := (p_record ->> 'keepUnsubscribeHash')::boolean;
  v_reg := app.competition_int(p_record -> 'registrationKeepDays', 'the days to keep closed registrations', 7, 3650);
  v_sub := app.competition_int(p_record -> 'subscriberKeepDays', 'the days to keep unconfirmed or unsubscribed email sign-ups', 1, 3650);
  select * into s from public.retention_settings rs where rs.id = 1 for update;
  if s.registration_keep_days is distinct from v_reg then v_fields := array_append(v_fields, 'registrationKeepDays'); end if;
  if s.subscriber_keep_days is distinct from v_sub then v_fields := array_append(v_fields, 'subscriberKeepDays'); end if;
  if s.keep_unsubscribe_hash is distinct from v_hash then v_fields := array_append(v_fields, 'keepUnsubscribeHash'); end if;
  if cardinality(v_fields) = 0 then
    return jsonb_build_object('registrationKeepDays', v_reg, 'subscriberKeepDays', v_sub, 'keepUnsubscribeHash', v_hash, 'fields', '[]'::jsonb);
  end if;
  update public.retention_settings rs
     set registration_keep_days = v_reg, subscriber_keep_days = v_sub, keep_unsubscribe_hash = v_hash, updated_by = p_actor
   where rs.id = 1;
  perform app.audit(p_actor, 'set_platform_retention', 'retention_settings', '1',
    jsonb_build_object('fields', to_jsonb(v_fields), 'registration_keep_days', v_reg, 'subscriber_keep_days', v_sub, 'keep_unsubscribe_hash', v_hash), p_reason);
  return jsonb_build_object('registrationKeepDays', v_reg, 'subscriberKeepDays', v_sub, 'keepUnsubscribeHash', v_hash, 'fields', to_jsonb(v_fields));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_platform_retention_summary (read): the periods and what a run now would remove (a dry run: counts only).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_platform_retention_summary(p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.retention_settings%rowtype;
begin
  perform app.require_owner(p_actor);
  select * into s from public.retention_settings rs where rs.id = 1;
  return jsonb_build_object('registrationKeepDays', s.registration_keep_days, 'subscriberKeepDays', s.subscriber_keep_days,
    'keepUnsubscribeHash', s.keep_unsubscribe_hash, 'updatedAt', s.updated_at, 'dueNow', app.platform_retention(p_actor, true, now()),
    'unsubscribeHashesKept', (select count(*) from public.notify_unsubscribe_hashes));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges: helpers and the inner job for nobody; the wrapper and the owner RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.event_registration_frozen() from public, anon, authenticated, service_role;
revoke all on function app.notify_email_hash(text) from public, anon, authenticated, service_role;
revoke all on function app.notify_email_unsubscribed(text) from public, anon, authenticated, service_role;
revoke all on function app.platform_retention_candidates(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.platform_retention(text, boolean, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.admin_run_platform_retention(text, boolean) from public, anon, authenticated;
revoke all on function public.admin_set_platform_retention(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_platform_retention_summary(text) from public, anon, authenticated;
grant execute on function public.admin_run_platform_retention(text, boolean) to service_role;
grant execute on function public.admin_set_platform_retention(text, jsonb, text) to service_role;
grant execute on function public.admin_platform_retention_summary(text) to service_role;
