-- 0020_registrations.sql: registration on the site with MANUAL payment verification (platform wave 5, D-111).
--
-- What it adds:
--   competition_settings  + registration_payment_instructions, registration_upi_id, registration_payee_name (owner settings, all null =
--                           nothing is shown; there is NO default text, UPI id or payee). The existing switch registration_enabled (0017,
--                           off) gets its first write path: admin_set_registration_settings (owner only, audited).
--   tournament_events     + registration_open (false) and entry_fee_paise (null = no fee is shown). Integer paise, set by the owner per
--                           event; nothing is ever defaulted (D-020, D-021). The site never charges anything: a fee is paid outside
--                           the site (UPI, cash) and the owner marks it verified.
--   event_registrations   PRIVATE. One row per registration: the event, the player name(s) AS TYPED, a contact phone and an optional
--                           email, the consent notice id and version, an optional payment reference (a UTR-like code, never a card or
--                           UPI credential), and the owner's verification, conversion or rejection. Never read by an api view.
--   app.registration_open_settings  internal view: the payment texts, only while registration_enabled is on.
--   api.public_registration_events   events that take registrations now (public, not draft, status open, registration_open, NOT
--                                     junior, registration switched on): the event id and its fee in paise. No name, no contact.
--   api.public_registration_payment  the payment instructions, UPI id and payee name, only while registration is switched on.
--   public.registration_lookup / public.registration_submit   the /api/register endpoint's two calls (service_role only).
--   public.admin_set_registration_settings, admin_set_event_registration, admin_verify_registration_payment,
--   admin_convert_registration, admin_reject_registration   owner RPCs (app.require_owner FIRST, audited).
--
-- Safety rules of this wave:
--   * Every switch stays OFF: registration_enabled false (0017), registration_open false on every event, payment_mode 'off'. The
--     endpoint also needs the runtime variable REGISTRATION_ENABLED exactly 'true', and the pages need features.registrations.
--   * Junior events take NO registration on the site (an event that is junior itself, or in a tournament with a minor signal or at
--     school/college level; an unknown signal counts as one). Collecting a child's details needs a parental-consent flow the lawyer
--     has not approved (D-109, DPDP). The view leaves them out and the RPCs refuse them.
--   * A self-claimed age is never stored: the registration has no age field. Conversion creates a player as provisional, hidden and
--     age 'unknown' (D-012), or uses an existing player record with ITS OWN age status; nothing here changes an age status, so the
--     competition naming rule (app.competition_named_players, 0018) keeps every new registrant "Protected player" until the owner
--     confirms them the usual way.
--   * Contact data (phone, email) and the payment reference stay in event_registrations, which only service_role can read and no
--     api view reads. Audit rows carry ids, counts, codes and amounts only, never a name, phone, email or payment reference.
--   * Capacity and duplicates are checked under the event's row lock (like admin_add_entry): active registrations plus pending and
--     confirmed entries never pass the capacity; the same phone cannot register the same player name twice while one is active.
--
-- House rules (0001-0018): RLS on with NO policies, everything revoked, service_role SELECT only on base tables; writes only through
-- SECURITY DEFINER RPCs with search_path = '' that check access FIRST; errors start 'INVALID:', 'NOT_FOUND:', 'STALE:' or
-- 'FORBIDDEN:'; explicit-column security_barrier api views. Apply after 0018 (and any 0019), then run supabase/checks/0020_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- Shape helpers (pure). A payment reference is 8 to 30 capital letters and digits with at least 6 digits (a UPI or bank transaction
-- reference, UTR).
-- app.registration_card_like: 13 to 19 digits that pass the Luhn check look like a card number and are refused, so a payer who types
-- a card number by mistake never has it stored (the site never asks for card or UPI credentials).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.registration_card_like(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_digit integer;
  v_double boolean := false;
  i integer;
begin
  if p is null or p !~ '^[0-9]{13,19}$' then return false; end if;
  for i in reverse length(p) .. 1 loop
    v_digit := substr(p, i, 1)::integer;
    if v_double then
      v_digit := v_digit * 2;
      if v_digit > 9 then v_digit := v_digit - 9; end if;
    end if;
    v_sum := v_sum + v_digit;
    v_double := not v_double;
  end loop;
  return v_sum % 10 = 0;
end;
$$;

-- A one-line text from a person (a player name, a payee name): trimmed, 2..p_max characters, no control characters, no < >.
create or replace function app.registration_line_ok(p text, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and p = btrim(p) and length(p) between 2 and p_max and p !~ '[[:cntrl:]<>]';
$$;

-- Contact details in an owner text: an email address, a phone-like run of 9+ digits, or a wa.me / tel: link. Same patterns as
-- app.notify_text_ok (0023) and src/lib/admin/registration/rules.ts (contactFree). Used for the PUBLIC payment instructions (the only
-- public number is PUBLIC_WHATSAPP_NUMBER, D-029) and for the reject reason (it lands in the audit log: no contact data).
create or replace function app.registration_contact_free(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
    and p !~ '[^\s@]+@[^\s@]+\.[^\s@]+'
    and p !~ '(\+?\d[\s().-]?){9,}'
    and p !~* '(wa\.me/|tel:|api\.whatsapp\.com)';
$$;

-- A UPI id whose name part (before @) holds 9 or more digits is a phone number: showing it would publish that number.
create or replace function app.registration_upi_is_phone(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and length(regexp_replace(split_part(p, '@', 1), '[^0-9]', '', 'g')) >= 9;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Owner settings (no defaults: null = not shown)
-- ------------------------------------------------------------------------------------------------------------------
alter table public.competition_settings
  add column registration_payment_instructions text,
  add column registration_upi_id text,
  add column registration_payee_name text;
alter table public.competition_settings add constraint competition_settings_registration_instructions check (
  registration_payment_instructions is null
  or (registration_payment_instructions = btrim(registration_payment_instructions)
      and length(registration_payment_instructions) between 10 and 1000
      and registration_payment_instructions !~ '[\x01-\x09\x0B-\x1F\x7F<>]'
      and app.registration_contact_free(registration_payment_instructions))
);
-- a UPI id is name@handle (lower case); it is the PAYEE's public address, never a credential
alter table public.competition_settings add constraint competition_settings_registration_upi check (
  registration_upi_id is null
  or (registration_upi_id ~ '^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9.-]{1,63}$' and not app.registration_upi_is_phone(registration_upi_id))
);
alter table public.competition_settings add constraint competition_settings_registration_payee check (
  registration_payee_name is null or app.registration_line_ok(registration_payee_name, 80)
);
-- the UPI id is shown only with the name it pays, so a payer can check it before paying
alter table public.competition_settings add constraint competition_settings_registration_upi_pair check (
  (registration_upi_id is null) = (registration_payee_name is null)
);
comment on column public.competition_settings.registration_payment_instructions is 'Owner text shown on registration pages of events with a fee, only while registration is on. Null = not shown.';
comment on column public.competition_settings.registration_upi_id is 'The payee UPI id shown on registration pages, only while registration is on. Null = not shown. Never a credential.';
comment on column public.competition_settings.registration_payee_name is 'The name the UPI id pays, shown with it. Null = not shown.';

alter table public.tournament_events
  add column registration_open boolean not null default false,
  add column entry_fee_paise integer check (entry_fee_paise is null or entry_fee_paise between 1 and 100000000);
comment on column public.tournament_events.registration_open is 'The owner takes registrations on the site for this event (D-111). Off by default; junior events are refused.';
comment on column public.tournament_events.entry_fee_paise is 'Entry fee in integer paise, set by the owner. Null = no fee is shown. Paid outside the site and verified by hand.';

-- ------------------------------------------------------------------------------------------------------------------
-- event_registrations (PRIVATE)
-- Statuses: submitted -> payment_verified -> converted (an event entry exists), or submitted / payment_verified -> rejected.
-- ------------------------------------------------------------------------------------------------------------------
create table public.event_registrations (
  id                             uuid        primary key default gen_random_uuid(),
  ref                            text        not null check (ref ~ '^PSR-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'),
  idempotency_key                uuid        not null,
  event_id                       uuid        not null references public.tournament_events (id) on delete restrict,
  player1_name                   text        not null check (app.registration_line_ok(player1_name, 80)),
  player2_name                   text        check (player2_name is null or app.registration_line_ok(player2_name, 80)),
  -- duplicate key: the first player's name, lower case with single spaces (display stays as typed)
  player_key                     text        not null generated always as (lower(regexp_replace(player1_name, '\s+', ' ', 'g'))) stored,
  contact_phone                  text        not null check (contact_phone ~ '^[0-9]{8,15}$'),
  contact_email                  text        check (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@[a-z0-9.-]+\.[a-z]{2,24}$')),
  whatsapp_ok                    boolean     not null default false,
  payment_reference              text        check (payment_reference is null or (payment_reference ~ '^[A-Z0-9]{8,30}$' and length(regexp_replace(payment_reference, '[^0-9]', '', 'g')) >= 6 and not app.registration_card_like(payment_reference))),
  -- the event's fee when the person registered (null = no fee was shown); the owner verifies against it
  fee_paise_at_submit            integer     check (fee_paise_at_submit is null or fee_paise_at_submit between 1 and 100000000),
  consent_id                     text        not null check (consent_id ~ '^[a-z0-9-]{1,60}$'),
  consent_version                text        not null check (consent_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  consent_at                     timestamptz not null,
  ip_hash                        text        check (ip_hash is null or ip_hash ~ '^[A-Za-z0-9_-]{8,64}$'),
  status                         text        not null default 'submitted' check (status in ('submitted', 'payment_verified', 'converted', 'rejected')),
  payment_verified_amount_paise  integer     check (payment_verified_amount_paise is null or payment_verified_amount_paise between 0 and 100000000),
  payment_verified_by            text,
  payment_verified_at            timestamptz,
  entry_id                       uuid        references public.event_entries (id) on delete restrict,
  converted_by                   text,
  converted_at                   timestamptz,
  rejected_reason                text        check (rejected_reason is null or length(rejected_reason) between 1 and 500),
  rejected_by                    text,
  rejected_at                    timestamptz,
  revision                       integer     not null default 1 check (revision >= 1),
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  constraint event_registrations_ref_unique unique (ref),
  constraint event_registrations_idempotency_unique unique (idempotency_key),
  constraint event_registrations_distinct_players check (player2_name is null or lower(player2_name) <> lower(player1_name)),
  -- verification is all or nothing; a verified amount exists only once verified
  constraint event_registrations_verified_fields check (
    (payment_verified_at is null) = (payment_verified_by is null) and (payment_verified_at is null) = (payment_verified_amount_paise is null)
  ),
  constraint event_registrations_status_fields check (
    case status
      when 'submitted' then payment_verified_at is null and entry_id is null and rejected_at is null
      when 'payment_verified' then payment_verified_at is not null and entry_id is null and rejected_at is null
      when 'converted' then entry_id is not null and converted_by is not null and converted_at is not null and rejected_at is null
      when 'rejected' then entry_id is null and rejected_by is not null and rejected_at is not null and rejected_reason is not null
    end
  )
);
comment on table public.event_registrations is 'Private (D-111). Registrations from the site: names as typed, contact phone and email, payment reference. Never in an api view; read by service_role (the admin function) only.';
comment on column public.event_registrations.player1_name is 'As typed by the registrant. Never shown publicly; a self-claimed age is never stored (D-012).';
comment on column public.event_registrations.payment_reference is 'A UPI or bank transaction reference (8-30 letters and digits). A card-number-like value is refused.';
create index event_registrations_event_idx on public.event_registrations (event_id, created_at);
-- one ACTIVE registration per event, phone and first player name (a second one is "already registered")
create unique index event_registrations_active_dup_idx on public.event_registrations (event_id, contact_phone, player_key)
  where status in ('submitted', 'payment_verified');
create trigger event_registrations_touch_updated_at before update on public.event_registrations for each row execute function app.touch_updated_at();

alter table public.event_registrations enable row level security;
revoke all on table public.event_registrations from public, anon, authenticated, service_role;
grant select on public.event_registrations to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- Internal: is an event junior for registration purposes (fail closed: an unknown tournament signal counts as junior)?
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.registration_event_is_junior(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select e.is_junior or coalesce(t.is_minor_signal, true) or coalesce(t.level = 'school_college', false)
    from public.tournament_events e join public.tournaments t on t.id = e.tournament_id
    where e.id = p_event), true);
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Public reads (explicit columns, security_barrier). The settings are read through an app view (0017 rule: no api view reads
-- public.competition_settings directly).
-- ------------------------------------------------------------------------------------------------------------------
create view app.registration_open_settings as
select s.registration_payment_instructions, s.registration_upi_id, s.registration_payee_name
from public.competition_settings s
where s.id = 1 and s.registration_enabled;
revoke all on app.registration_open_settings from public, anon, authenticated;

create view api.public_registration_events with (security_barrier = true) as
select
  e.id as event_id,
  e.entry_fee_paise
from public.tournament_events e
join app.competition_public_events pe on pe.id = e.id
where e.status = 'open'
  and e.registration_open
  and not coalesce(pe.is_junior, true)
  and exists (select 1 from app.registration_open_settings);
grant select on api.public_registration_events to anon, authenticated;

create view api.public_registration_payment with (security_barrier = true) as
select
  o.registration_payment_instructions as payment_instructions,
  o.registration_upi_id as upi_id,
  o.registration_payee_name as payee_name
from app.registration_open_settings o;
grant select on api.public_registration_payment to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- registration_lookup: the endpoint's idempotency check BEFORE Turnstile (a token works once, so a retry of the same submission must
-- get its reference back without a new check). 'none', 'same' (with the ref) or 'different' (the key was used for something else).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.registration_lookup(p_key uuid, p_event uuid, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.event_registrations%rowtype;
begin
  if p_key is null then raise exception 'INVALID: the request needs its key' using errcode = '22023'; end if;
  select * into r from public.event_registrations where idempotency_key = p_key;
  if not found then return jsonb_build_object('outcome', 'none'); end if;
  if r.event_id = p_event and r.contact_phone = p_phone then
    return jsonb_build_object('outcome', 'same', 'ref', r.ref);
  end if;
  return jsonb_build_object('outcome', 'different');
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- registration_submit: store one registration. Called only by the /api/register function (service_role) AFTER the shape checks, the
-- honeypot, the rate limits and Turnstile. Access check first: while the owner has registration switched off it stores nothing.
-- Record: ref, idempotencyKey, eventId, player1Name, player2Name, phone, email, whatsappOk, paymentReference, consentId, consentVersion,
-- consentText, ipHash. Expected outcomes are RETURNED (closed, full, already_registered, partner_required, partner_not_allowed,
-- ref_taken, replay, conflict, created); a malformed record RAISES INVALID.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.registration_submit(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['ref', 'idempotencyKey', 'eventId', 'player1Name', 'player2Name', 'phone', 'email', 'whatsappOk',
    'paymentReference', 'consentId', 'consentVersion', 'consentText', 'ipHash'];
  e public.tournament_events%rowtype;
  r public.event_registrations%rowtype;
  v_key uuid;
  v_event uuid;
  v_p1 text;
  v_p2 text;
  v_phone text;
  v_email text;
  v_payref text;
  v_need integer;
  v_taken integer;
  v_id uuid;
  v_sha text;
begin
  -- access check FIRST: the owner's switch (0017 competition_settings.registration_enabled, off by default)
  if not coalesce((select s.registration_enabled from public.competition_settings s where s.id = 1), false) then
    return jsonb_build_object('outcome', 'closed');
  end if;
  perform app.competition_keys(p_record, v_allowed, 'registration');
  v_key := app.competition_uuid(p_record -> 'idempotencyKey', 'idempotencyKey');
  v_event := app.competition_uuid(p_record -> 'eventId', 'eventId');
  if v_key is null or v_event is null then raise exception 'INVALID: the registration needs its key and event' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'ref') <> 'string' or (p_record ->> 'ref') !~ '^PSR-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$' then
    raise exception 'INVALID: bad reference' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record -> 'player1Name') <> 'string' or jsonb_typeof(p_record -> 'player2Name') not in ('string', 'null')
     or jsonb_typeof(p_record -> 'phone') <> 'string' or jsonb_typeof(p_record -> 'email') not in ('string', 'null')
     or jsonb_typeof(p_record -> 'paymentReference') not in ('string', 'null') or jsonb_typeof(p_record -> 'whatsappOk') <> 'boolean'
     or jsonb_typeof(p_record -> 'consentId') <> 'string' or jsonb_typeof(p_record -> 'consentVersion') <> 'string'
     or jsonb_typeof(p_record -> 'consentText') <> 'string' or jsonb_typeof(p_record -> 'ipHash') not in ('string', 'null') then
    raise exception 'INVALID: a registration field has the wrong type' using errcode = '22023';
  end if;
  v_p1 := p_record ->> 'player1Name';
  v_p2 := nullif(p_record ->> 'player2Name', '');
  v_phone := p_record ->> 'phone';
  v_email := nullif(p_record ->> 'email', '');
  v_payref := nullif(p_record ->> 'paymentReference', '');
  if not app.registration_line_ok(v_p1, 80) or (v_p2 is not null and not app.registration_line_ok(v_p2, 80)) then
    raise exception 'INVALID: a player name is not acceptable' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'INVALID: bad phone' using errcode = '22023'; end if;
  if v_payref is not null and (v_payref !~ '^[A-Z0-9]{8,30}$' or length(regexp_replace(v_payref, '[^0-9]', '', 'g')) < 6 or app.registration_card_like(v_payref)) then
    raise exception 'INVALID: bad payment reference' using errcode = '22023';
  end if;
  if length(p_record ->> 'consentText') not between 20 and 4000 then raise exception 'INVALID: bad consent text' using errcode = '22023'; end if;

  -- a retry of the same submission (the endpoint looked before Turnstile; this closes the race between two identical requests)
  select * into r from public.event_registrations where idempotency_key = v_key;
  if found then
    if r.event_id = v_event and r.contact_phone = v_phone then return jsonb_build_object('outcome', 'replay', 'ref', r.ref); end if;
    return jsonb_build_object('outcome', 'conflict');
  end if;

  -- under the event's row lock: open, not junior, the right number of players, no duplicate, room left
  select * into e from public.tournament_events where id = v_event for update;
  if not found or e.status <> 'open' or not e.registration_open
     or not exists (select 1 from app.competition_public_events pe where pe.id = e.id)
     or app.registration_event_is_junior(e.id) then
    return jsonb_build_object('outcome', 'closed');
  end if;
  v_need := case when e.category in ('MS', 'WS', 'BS', 'GS') then 1 else 2 end;
  if v_need = 2 and v_p2 is null then return jsonb_build_object('outcome', 'partner_required'); end if;
  if v_need = 1 and v_p2 is not null then return jsonb_build_object('outcome', 'partner_not_allowed'); end if;
  if v_p2 is not null and lower(v_p2) = lower(v_p1) then return jsonb_build_object('outcome', 'partner_required'); end if;
  if exists (select 1 from public.event_registrations x
              where x.event_id = e.id and x.contact_phone = v_phone and x.status in ('submitted', 'payment_verified')
                and x.player_key = lower(regexp_replace(v_p1, '\s+', ' ', 'g'))) then
    return jsonb_build_object('outcome', 'already_registered');
  end if;
  if e.capacity is not null then
    v_taken := (select count(*) from public.event_registrations x where x.event_id = e.id and x.status in ('submitted', 'payment_verified'))
             + (select count(*) from public.event_entries en where en.event_id = e.id and en.status in ('pending', 'confirmed'));
    if v_taken >= e.capacity then return jsonb_build_object('outcome', 'full'); end if;
  end if;

  -- the notice text as shown, kept once per id and version (0002 evidence table); a different text under the same version is refused
  v_sha := encode(sha256(convert_to(p_record ->> 'consentText', 'UTF8')), 'hex');
  insert into public.notice_versions (id, version, sha256, "text")
    values (p_record ->> 'consentId', p_record ->> 'consentVersion', v_sha, p_record ->> 'consentText')
    on conflict (id, version) do nothing;
  if (select nv.sha256 from public.notice_versions nv where nv.id = p_record ->> 'consentId' and nv.version = p_record ->> 'consentVersion') <> v_sha then
    raise exception 'INVALID: the consent text does not match its version' using errcode = '22023';
  end if;

  begin
    insert into public.event_registrations (ref, idempotency_key, event_id, player1_name, player2_name, contact_phone, contact_email, whatsapp_ok,
                                            payment_reference, fee_paise_at_submit, consent_id, consent_version, consent_at, ip_hash)
      values (p_record ->> 'ref', v_key, e.id, v_p1, v_p2, v_phone, v_email, (p_record ->> 'whatsappOk')::boolean,
              v_payref, e.entry_fee_paise, p_record ->> 'consentId', p_record ->> 'consentVersion', now(), nullif(p_record ->> 'ipHash', ''))
      returning id into v_id;
  exception when unique_violation then
    -- which unique rule? the reference (the endpoint retries with a new one), the key (a parallel twin won), or the duplicate rule
    if exists (select 1 from public.event_registrations x where x.idempotency_key = v_key) then
      select * into r from public.event_registrations where idempotency_key = v_key;
      if r.event_id = v_event and r.contact_phone = v_phone then return jsonb_build_object('outcome', 'replay', 'ref', r.ref); end if;
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if exists (select 1 from public.event_registrations x where x.ref = p_record ->> 'ref') then return jsonb_build_object('outcome', 'ref_taken'); end if;
    return jsonb_build_object('outcome', 'already_registered');
  end;
  perform app.audit('public:registration', 'submit_registration', 'event_registrations', v_id::text,
    jsonb_build_object('event_id', e.id, 'players', case when v_p2 is null then 1 else 2 end, 'has_email', v_email is not null,
      'has_payment_reference', v_payref is not null, 'fee_paise', e.entry_fee_paise), 'registration from the site');
  -- the event's category and age group (public facts) for the owner alert; never a name or contact
  return jsonb_build_object('outcome', 'created', 'id', v_id, 'ref', p_record ->> 'ref', 'feePaise', e.entry_fee_paise, 'category', e.category, 'ageGroup', e.age_group);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_registration_settings: record {enabled, paymentInstructions, upiId, payeeName}. The owner's switch for the whole feature
-- (payment_mode follows it: manual_verification when on, off when off) and the texts shown to payers. No defaults.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_registration_settings(p_actor text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.competition_settings%rowtype;
  v_on boolean;
  v_text text;
  v_upi text;
  v_payee text;
  v_fields text[] := '{}';
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['enabled', 'paymentInstructions', 'upiId', 'payeeName'], 'registration settings');
  if jsonb_typeof(p_record -> 'enabled') <> 'boolean' then raise exception 'INVALID: enabled must be true or false' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'paymentInstructions') not in ('string', 'null') or jsonb_typeof(p_record -> 'upiId') not in ('string', 'null')
     or jsonb_typeof(p_record -> 'payeeName') not in ('string', 'null') then
    raise exception 'INVALID: the payment texts must be text or empty' using errcode = '22023';
  end if;
  v_on := (p_record ->> 'enabled')::boolean;
  v_text := nullif(btrim(coalesce(p_record ->> 'paymentInstructions', '')), '');
  v_upi := nullif(lower(btrim(coalesce(p_record ->> 'upiId', ''))), '');
  v_payee := nullif(btrim(coalesce(p_record ->> 'payeeName', '')), '');
  if v_text is not null and (length(v_text) not between 10 and 1000 or v_text ~ '[\x01-\x09\x0B-\x1F\x7F<>]') then
    raise exception 'INVALID: the payment instructions must be 10 to 1000 characters without < or >' using errcode = '22023';
  end if;
  if v_text is not null and not app.registration_contact_free(v_text) then
    raise exception 'INVALID: the payment instructions are public: leave out phone numbers, email addresses and WhatsApp links' using errcode = '22023';
  end if;
  if v_upi is not null and v_upi !~ '^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9.-]{1,63}$' then
    raise exception 'INVALID: the UPI id must look like name@bank' using errcode = '22023';
  end if;
  if v_upi is not null and app.registration_upi_is_phone(v_upi) then
    raise exception 'INVALID: this UPI id is a phone number; showing it would publish the number' using errcode = '22023';
  end if;
  if v_payee is not null and not app.registration_line_ok(v_payee, 80) then
    raise exception 'INVALID: the payee name must be 2 to 80 characters' using errcode = '22023';
  end if;
  if (v_upi is null) <> (v_payee is null) then
    raise exception 'INVALID: give the UPI id together with the name it pays, or neither' using errcode = '22023';
  end if;

  select * into s from public.competition_settings where id = 1 for update;
  if s.registration_enabled is distinct from v_on then v_fields := array_append(v_fields, 'enabled'); end if;
  if s.registration_payment_instructions is distinct from v_text then v_fields := array_append(v_fields, 'paymentInstructions'); end if;
  if s.registration_upi_id is distinct from v_upi then v_fields := array_append(v_fields, 'upiId'); end if;
  if s.registration_payee_name is distinct from v_payee then v_fields := array_append(v_fields, 'payeeName'); end if;
  if cardinality(v_fields) = 0 then return jsonb_build_object('enabled', v_on, 'fields', '[]'::jsonb); end if;
  update public.competition_settings
     set registration_enabled = v_on,
         payment_mode = case when v_on then 'manual_verification' else 'off' end,
         registration_payment_instructions = v_text,
         registration_upi_id = v_upi,
         registration_payee_name = v_payee
   where id = 1;
  perform app.audit(p_actor, 'set_registration_settings', 'competition_settings', '1',
    jsonb_build_object('fields', to_jsonb(v_fields), 'enabled', v_on), p_reason);
  perform app.mark_dirty('registration settings', false);
  return jsonb_build_object('enabled', v_on, 'fields', to_jsonb(v_fields));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_event_registration: record {open, entryFeePaise}. Opening needs an event that is open (not draft or closed) and not junior.
-- The fee is integer paise (1 .. 100000000) or null for "no fee shown". A registration keeps the fee it was made under.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_event_registration(p_actor text, p_event uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.tournament_events%rowtype;
  v_open boolean;
  v_fee integer;
  v_fields text[] := '{}';
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['open', 'entryFeePaise'], 'event registration');
  if jsonb_typeof(p_record -> 'open') <> 'boolean' then raise exception 'INVALID: open must be true or false' using errcode = '22023'; end if;
  v_open := (p_record ->> 'open')::boolean;
  v_fee := app.competition_int(p_record -> 'entryFeePaise', 'the entry fee in paise', 1, 100000000);
  select * into e from public.tournament_events where id = p_event for update;
  if not found then raise exception 'NOT_FOUND: event not found' using errcode = 'P0002'; end if;
  if v_open and e.status <> 'open' then raise exception 'INVALID: open the event itself first (its status must be open)' using errcode = '22023'; end if;
  if v_open and app.registration_event_is_junior(e.id) then
    raise exception 'INVALID: registration on the site is not offered for junior events yet' using errcode = '22023';
  end if;
  if e.registration_open is distinct from v_open then v_fields := array_append(v_fields, 'open'); end if;
  if e.entry_fee_paise is distinct from v_fee then v_fields := array_append(v_fields, 'entryFeePaise'); end if;
  if cardinality(v_fields) = 0 then return jsonb_build_object('id', e.id, 'fields', '[]'::jsonb); end if;
  update public.tournament_events set registration_open = v_open, entry_fee_paise = v_fee where id = e.id;
  perform app.audit(p_actor, 'set_event_registration', 'tournament_events', e.id::text,
    jsonb_build_object('fields', to_jsonb(v_fields), 'open', v_open, 'fee_paise', v_fee), p_reason);
  perform app.mark_dirty('event registration', false);
  return jsonb_build_object('id', e.id, 'fields', to_jsonb(v_fields));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_verify_registration_payment: record {amountPaise} (0 .. 100000000; 0 = the owner waived the fee). Records who and when.
-- A submitted or already verified registration (to correct the amount); never a converted or rejected one.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_verify_registration_payment(p_actor text, p_registration uuid, p_record jsonb, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.event_registrations%rowtype;
  v_amount integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['amountPaise'], 'payment');
  v_amount := app.competition_int(p_record -> 'amountPaise', 'the amount in paise', 0, 100000000);
  if v_amount is null then raise exception 'INVALID: enter the amount received' using errcode = '22023'; end if;
  select * into r from public.event_registrations where id = p_registration for update;
  if not found then raise exception 'NOT_FOUND: registration not found' using errcode = 'P0002'; end if;
  if p_expected_revision is null or r.revision <> p_expected_revision then raise exception 'STALE: the registration changed; reload it' using errcode = '40001'; end if;
  if r.status not in ('submitted', 'payment_verified') then raise exception 'INVALID: the registration is already %', r.status using errcode = '22023'; end if;
  update public.event_registrations
     set status = 'payment_verified', payment_verified_amount_paise = v_amount, payment_verified_by = p_actor, payment_verified_at = now(),
         revision = r.revision + 1
   where id = r.id;
  perform app.audit(p_actor, 'verify_registration_payment', 'event_registrations', r.id::text,
    jsonb_build_object('event_id', r.event_id, 'amount_paise', v_amount, 'fee_paise', r.fee_paise_at_submit, 'old_status', r.status), p_reason);
  return jsonb_build_object('id', r.id, 'status', 'payment_verified', 'revision', r.revision + 1);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_convert_registration: record {players: [{playerId} | {name, nameNormalized}] (one per typed name, in order),
-- status: pending | confirmed | waitlisted}. Makes the event entry through admin_add_entry (same capacity, category and duplicate
-- rules, same audit). A NEW player is provisional, hidden and of UNKNOWN age (D-012); an existing player keeps its own age status.
-- A registration made under a fee must have its payment verified first.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_convert_registration(p_actor text, p_registration uuid, p_record jsonb, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.event_registrations%rowtype;
  e public.tournament_events%rowtype;
  v_item jsonb;
  v_players uuid[] := '{}';
  v_new uuid[] := '{}';
  v_pid uuid;
  v_name text;
  v_norm text;
  v_count integer;
  v_status text;
  v_entry jsonb;
  i integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['players', 'status'], 'conversion');
  if jsonb_typeof(p_record -> 'status') <> 'string' or (p_record ->> 'status') not in ('pending', 'confirmed', 'waitlisted') then
    raise exception 'INVALID: the entry is pending, confirmed or waitlisted' using errcode = '22023';
  end if;
  v_status := p_record ->> 'status';
  select * into r from public.event_registrations where id = p_registration;
  if not found then raise exception 'NOT_FOUND: registration not found' using errcode = 'P0002'; end if;
  -- the event first, then the registration (the same lock order as the entry RPCs)
  select * into e from public.tournament_events where id = r.event_id for update;
  select * into r from public.event_registrations where id = p_registration for update;
  if p_expected_revision is null or r.revision <> p_expected_revision then raise exception 'STALE: the registration changed; reload it' using errcode = '40001'; end if;
  if r.status not in ('submitted', 'payment_verified') then raise exception 'INVALID: the registration is already %', r.status using errcode = '22023'; end if;
  if r.fee_paise_at_submit is not null and r.status <> 'payment_verified' then
    raise exception 'INVALID: verify the payment first (enter 0 if you waive the fee)' using errcode = '22023';
  end if;
  v_count := case when r.player2_name is null then 1 else 2 end;
  if jsonb_typeof(p_record -> 'players') <> 'array' or jsonb_array_length(p_record -> 'players') <> v_count then
    raise exception 'INVALID: give one player record for each name in the registration' using errcode = '22023';
  end if;
  for i in 0 .. v_count - 1 loop
    v_item := p_record -> 'players' -> i;
    if jsonb_typeof(v_item) <> 'object' then raise exception 'INVALID: each player is an object' using errcode = '22023'; end if;
    if v_item ? 'playerId' then
      perform app.competition_keys(v_item, array['playerId'], 'player');
      v_pid := app.competition_uuid(v_item -> 'playerId', 'playerId');
      if v_pid is null then raise exception 'INVALID: each player must be an id' using errcode = '22023'; end if;
      if not exists (select 1 from public.players p where p.id = v_pid and p.merged_into is null) then
        raise exception 'NOT_FOUND: player not found (or merged into another)' using errcode = 'P0002';
      end if;
    else
      perform app.competition_keys(v_item, array['name', 'nameNormalized'], 'new player');
      v_name := btrim(coalesce(v_item ->> 'name', ''));
      v_norm := btrim(coalesce(v_item ->> 'nameNormalized', ''));
      if not app.registration_line_ok(v_name, 80) or length(v_norm) = 0 or length(v_norm) > 120 then
        raise exception 'INVALID: a new player needs a name of 2 to 80 characters' using errcode = '22023';
      end if;
      if app.is_suppressed('name_normalized', v_norm) then
        raise exception 'INVALID: this name is on the removal list; pick the existing record or reject the registration' using errcode = '22023';
      end if;
      -- D-012: provisional, hidden, noindex, opaque slug and age 'unknown' (the column defaults); never a self-claimed age
      insert into public.players (display_name, name_normalized, identity_tier, created_source, provisional_tournament_id)
        values (v_name, v_norm, case when v_norm ~ ' ' then 'multi_token' else 'single_token' end, 'admin', e.tournament_id)
        returning id into v_pid;
      v_new := v_new || v_pid;
    end if;
    v_players := v_players || v_pid;
  end loop;

  v_entry := public.admin_add_entry(p_actor, e.id, jsonb_build_object('players', to_jsonb(v_players), 'seed', null, 'status', v_status), p_reason);
  update public.event_registrations
     set status = 'converted', entry_id = (v_entry ->> 'id')::uuid, converted_by = p_actor, converted_at = now(), revision = r.revision + 1
   where id = r.id;
  perform app.audit(p_actor, 'convert_registration', 'event_registrations', r.id::text,
    jsonb_build_object('event_id', e.id, 'entry_id', v_entry ->> 'id', 'new_players', cardinality(v_new), 'existing_players', cardinality(v_players) - cardinality(v_new),
      'entry_status', v_status), p_reason);
  return jsonb_build_object('id', r.id, 'status', 'converted', 'entryId', v_entry ->> 'id', 'newPlayerIds', to_jsonb(v_new), 'revision', r.revision + 1);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_reject_registration: the reason (owner-only, never public) is stored with the row and in the audit log.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_reject_registration(p_actor text, p_registration uuid, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.event_registrations%rowtype;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  if length(btrim(p_reason)) > 500 then raise exception 'INVALID: keep the reason under 500 characters' using errcode = '22023'; end if;
  -- the reason is kept with the row and in the audit log: never contact details
  if not app.registration_contact_free(p_reason) then
    raise exception 'INVALID: leave phone numbers, email addresses and links out of the reason' using errcode = '22023';
  end if;
  select * into r from public.event_registrations where id = p_registration for update;
  if not found then raise exception 'NOT_FOUND: registration not found' using errcode = 'P0002'; end if;
  if p_expected_revision is null or r.revision <> p_expected_revision then raise exception 'STALE: the registration changed; reload it' using errcode = '40001'; end if;
  if r.status not in ('submitted', 'payment_verified') then raise exception 'INVALID: the registration is already %', r.status using errcode = '22023'; end if;
  update public.event_registrations
     set status = 'rejected', rejected_reason = btrim(p_reason), rejected_by = p_actor, rejected_at = now(), revision = r.revision + 1
   where id = r.id;
  perform app.audit(p_actor, 'reject_registration', 'event_registrations', r.id::text,
    jsonb_build_object('event_id', r.event_id, 'old_status', r.status), p_reason);
  return jsonb_build_object('id', r.id, 'status', 'rejected', 'revision', r.revision + 1);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges: helpers for nobody; the endpoint and owner RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.registration_card_like(text) from public, anon, authenticated, service_role;
revoke all on function app.registration_line_ok(text, integer) from public, anon, authenticated, service_role;
revoke all on function app.registration_contact_free(text) from public, anon, authenticated, service_role;
revoke all on function app.registration_upi_is_phone(text) from public, anon, authenticated, service_role;
revoke all on function app.registration_event_is_junior(uuid) from public, anon, authenticated, service_role;
revoke all on function public.registration_lookup(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.registration_submit(jsonb) from public, anon, authenticated;
revoke all on function public.admin_set_registration_settings(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_set_event_registration(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_verify_registration_payment(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_convert_registration(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_reject_registration(text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.registration_lookup(uuid, uuid, text) to service_role;
grant execute on function public.registration_submit(jsonb) to service_role;
grant execute on function public.admin_set_registration_settings(text, jsonb, text) to service_role;
grant execute on function public.admin_set_event_registration(text, uuid, jsonb, text) to service_role;
grant execute on function public.admin_verify_registration_payment(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_convert_registration(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_reject_registration(text, uuid, integer, text) to service_role;
