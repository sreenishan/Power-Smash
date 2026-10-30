-- 0023_notifications.sql: notifications (platform wave 5, D-114): the outbox gets the columns its dispatcher needs, email subscriptions
-- with double opt-in, owner-entered notices inside the site, and the owner's switch for the email sign-up.
--
-- What it adds:
--   notification_outbox (0017)  + channel, subject, body, not_before, expires_at, lease_until, skip_reason, recipient_subscriber_id and
--                               the status 'sending' (a claimed record with a lease), so src/lib/notify/outbox/supabase-store.ts can hold
--                               exactly what the TS dispatcher holds. The idempotency key now takes the TS key form (src/lib/notify/
--                               outbox/keys.ts: letters, digits, ':', '%', '_', '-', at most 200).
--                               RECONCILED RULES (one rule, tested on both sides):
--                                 * payload: app.competition_outbox_payload_ok (0017, unchanged); its one TS copy is outboxPayloadProblem
--                                   in src/lib/competition/db.ts, re-exported by src/lib/notify/outbox/payload.ts. The TS store puts
--                                   only {event, revision} there (references and codes).
--                                 * message text: the rendered subject and body ARE stored (0017's comment said "never"; that stays
--                                   true for the payload). They must pass app.notify_text_ok: no email address, no run of 9 or more
--                                   digits (a phone number, separators allowed), no wa.me or tel: link, no control characters. The TS
--                                   twin is outboxTextProblem (src/lib/notify/outbox/payload.ts). Addresses are still never stored here:
--                                   the email adapter looks the address up by the recipient reference at send time.
--                               0017's app.enqueue_notification keeps working (in_app channel, no text: such rows are never sent).
--   notify_subscribers          PRIVATE. One row per email address: status pending | active | unsubscribed, the consent notice id and
--                               version, confirmed_at, unsubscribed_at, and only the SHA-256 HASH of the confirmation token (the token
--                               itself is only in the email). Unsubscribe links carry an HMAC of the subscriber id made by the server
--                               (src/lib/notices/tokens.ts): nothing about them is stored.
--   notify_settings             one row: email_subscribe_open (false). The owner's switch for the email sign-up (admin_set_notify_settings).
--   site_notices                owner-entered notices: title, body, a link (an internal page path, or an allow-listed external https
--                               link), its label, audience public | staff, starts_at, ends_at, published (false). No contact data
--                               (app.notify_text_ok on every text).
--   api.public_site_notices     published public notices whose window is open now. No author, no audience, no revision.
--   api.public_notify_settings  the one boolean email_subscribe_open.
--   RPCs for the endpoints and the dispatcher (service_role only): notify_subscribe, notify_confirm, notify_unsubscribe,
--                               notify_outbox_enqueue, notify_outbox_cas.
--   Owner RPCs (app.require_owner FIRST, audited with field names and counts only): admin_save_site_notice, admin_publish_site_notice,
--                               admin_set_notify_settings, admin_queue_subscriber_announcement, admin_notify_summary (read).
--
-- Safety rules of this wave:
--   * Nothing is switched on: email_subscribe_open is false, every notice starts unpublished, nothing sends. The endpoints also need
--     NOTIFY_SUBSCRIBE_ENABLED exactly 'true'; email needs EMAIL_ENABLED exactly 'true' and the Resend key; the pages need
--     features.emailNotifications / features.siteNotices.
--   * Responses never reveal whether an address is on the list: notify_subscribe's outcome goes to the server only.
--   * An unsubscribe is never refused (no switch is checked) and skips every queued email to that subscriber at once.
--   * No contact data in any public view, alert or audit row. Subscribers are reached only with email and only for announcements.
--
-- House rules (0001-0022): RLS on with NO policies, everything revoked, service_role SELECT only on base tables; writes only through
-- SECURITY DEFINER RPCs with search_path = '' that check access FIRST; errors start 'INVALID:', 'NOT_FOUND:' or 'STALE:';
-- explicit-column security_barrier api views. Apply after 0022, then run supabase/checks/0023_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- Text rule for stored message text and notices (mirrors outboxTextProblem in src/lib/notify/outbox/payload.ts). true = fine.
-- No control character (a line break only when p_multiline), at most p_max characters, no email address, no run of 9 or more digits
-- (one space, dot, dash or bracket allowed between digits, an optional leading +), no wa.me or tel: link.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.notify_text_ok(p_text text, p_max integer, p_multiline boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null
    and length(p_text) <= p_max
    and p_text !~ (case when p_multiline then '[\x01-\x09\x0b-\x1f\x7f]' else '[\x01-\x1f\x7f]' end)
    and p_text !~ '[^\s@]+@[^\s@]+\.[^\s@]+'
    and p_text !~ '(\+?\d[\s().-]?){9,}'
    and p_text !~* '(wa\.me/|tel:|api\.whatsapp\.com)';
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- External notice links: https only, to the brand's own public accounts (mirrors SITE_NOTICE_LINK_PATTERNS in
-- src/lib/notices/site-notices.ts). A WhatsApp link may only be a Channel link (never a chat link that carries a number).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.site_notice_link_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null and length(p_url) <= 300 and app.notify_text_ok(p_url, 300, false) and (
    -- YouTube: a handle (or one of its tabs), a video, a playlist, a channel id, a short or a live page only; never /redirect or
    -- /attribution_link, which can bounce a visitor to any site
    p_url ~ '^https://(www\.)?youtube\.com/(@[A-Za-z0-9._-]{3,30}(/(videos|shorts|streams|playlists|featured))?/?|watch\?v=[A-Za-z0-9_-]{11}|playlist\?list=[A-Za-z0-9_-]{10,64}|channel/UC[A-Za-z0-9_-]{22}|(shorts|live)/[A-Za-z0-9_-]{11})$'
    or p_url ~ '^https://youtu\.be/[A-Za-z0-9_-]{6,20}$'
    or p_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9/._-]{0,200}$'
    or p_url ~ '^https://(www\.)?facebook\.com/[A-Za-z0-9/._-]{0,200}$'
    or p_url ~ '^https://(www\.)?whatsapp\.com/channel/[A-Za-z0-9]{16,40}$');
$$;

-- An internal page path as src/lib/urls.ts path() writes it: root-relative, lower case, ending with a slash, never an endpoint.
create or replace function app.site_notice_path_ok(p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is not null and (p_path = '/' or (p_path ~ '^/[a-z0-9][a-z0-9/_-]{0,150}/$' and p_path !~ '//' and p_path !~ '^/(api|go|cdn-cgi)/'));
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_subscribers: email sign-ups with double opt-in. PRIVATE.
-- ------------------------------------------------------------------------------------------------------------------
create table public.notify_subscribers (
  id                    uuid        primary key default gen_random_uuid(),
  email                 text        not null check (length(email) between 6 and 254 and email = lower(email)
                                      and email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$'),
  status                text        not null default 'pending' check (status in ('pending', 'active', 'unsubscribed')),
  consent_id            text        not null check (consent_id ~ '^[a-z][a-z0-9-]{2,60}$'),
  consent_version       text        not null check (consent_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  consent_at            timestamptz not null default now(),
  confirm_token_hash    text        check (confirm_token_hash ~ '^[0-9a-f]{64}$'),
  confirm_expires_at    timestamptz,
  confirmations_sent    integer     not null default 1 check (confirmations_sent between 0 and 100000),
  last_confirmation_at  timestamptz,
  confirmed_at          timestamptz,
  unsubscribed_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint notify_subscribers_email_unique unique (email),
  constraint notify_subscribers_token_unique unique (confirm_token_hash),
  constraint notify_subscribers_pending_token check ((status = 'pending') = (confirm_token_hash is not null)),
  constraint notify_subscribers_token_expiry check ((confirm_token_hash is null) = (confirm_expires_at is null)),
  constraint notify_subscribers_active_confirmed check (status <> 'active' or confirmed_at is not null),
  constraint notify_subscribers_unsubscribed_at check (status <> 'unsubscribed' or unsubscribed_at is not null)
);
comment on table public.notify_subscribers is 'Private. Email sign-ups (double opt-in, D-114). Only the hash of the confirmation token is stored. Written only by notify_subscribe, notify_confirm and notify_unsubscribe.';
create trigger notify_subscribers_touch_updated_at before update on public.notify_subscribers for each row execute function app.touch_updated_at();
create index notify_subscribers_active_idx on public.notify_subscribers (created_at) where status = 'active';

alter table public.notify_subscribers enable row level security;
revoke all on table public.notify_subscribers from public, anon, authenticated, service_role;
grant select on public.notify_subscribers to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_settings: one row of switches, OFF.
-- ------------------------------------------------------------------------------------------------------------------
create table public.notify_settings (
  id                    smallint    primary key check (id = 1),
  email_subscribe_open  boolean     not null default false,
  updated_at            timestamptz not null default now(),
  updated_by            text
);
insert into public.notify_settings (id) values (1);
comment on table public.notify_settings is 'Notification switches (all off). Written only by admin_set_notify_settings.';
create trigger notify_settings_touch_updated_at before update on public.notify_settings for each row execute function app.touch_updated_at();

alter table public.notify_settings enable row level security;
revoke all on table public.notify_settings from public, anon, authenticated, service_role;
grant select on public.notify_settings to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- site_notices: owner-entered notices shown inside the site (public) or to signed-in organizers and scorers (staff).
-- ------------------------------------------------------------------------------------------------------------------
create table public.site_notices (
  id            uuid        primary key default gen_random_uuid(),
  title         text        not null check (length(btrim(title)) between 2 and 120 and app.notify_text_ok(title, 120, false)),
  body          text        check (body is null or (length(btrim(body)) between 1 and 600 and app.notify_text_ok(body, 600, true))),
  link_path     text        check (link_path is null or app.site_notice_path_ok(link_path)),
  link_url      text        check (link_url is null or app.site_notice_link_ok(link_url)),
  link_label    text        check (link_label is null or (length(btrim(link_label)) between 2 and 60 and app.notify_text_ok(link_label, 60, false))),
  audience      text        not null default 'public' check (audience in ('public', 'staff')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  published     boolean     not null default false,
  published_at  timestamptz,
  revision      integer     not null default 1 check (revision between 1 and 1000000000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint site_notices_one_link check (num_nonnulls(link_path, link_url) <= 1),
  constraint site_notices_link_label check ((link_label is null) = (link_path is null and link_url is null)),
  constraint site_notices_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint site_notices_published_at check (published = (published_at is not null))
);
comment on table public.site_notices is 'Owner-entered notices (D-114). No contact data. Public ones reach visitors only through api.public_site_notices. Written only by admin_save_site_notice and admin_publish_site_notice.';
create trigger site_notices_touch_updated_at before update on public.site_notices for each row execute function app.touch_updated_at();

alter table public.site_notices enable row level security;
revoke all on table public.site_notices from public, anon, authenticated, service_role;
grant select on public.site_notices to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- notification_outbox (0017): the dispatcher's columns
-- ------------------------------------------------------------------------------------------------------------------
alter table public.notification_outbox drop constraint notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check check (status in ('queued', 'sending', 'sent', 'failed', 'skipped'));
alter table public.notification_outbox drop constraint notification_outbox_idempotency_key_check;
alter table public.notification_outbox add constraint notification_outbox_idempotency_key_check check (idempotency_key ~ '^[A-Za-z0-9:%_-]{8,200}$');
alter table public.notification_outbox drop constraint notification_outbox_one_recipient;

alter table public.notification_outbox
  add column channel text not null default 'in_app' check (channel in ('in_app', 'email', 'push', 'whatsapp')),
  add column recipient_subscriber_id uuid references public.notify_subscribers (id) on delete cascade,
  add column subject text,
  add column body text,
  add column not_before timestamptz not null default now(),
  add column expires_at timestamptz,
  add column lease_until timestamptz,
  add column skip_reason text check (skip_reason is null or skip_reason in ('no_consent', 'consent_withdrawn', 'muted_kind', 'protected_recipient',
    'channel_not_configured', 'no_address', 'expired', 'consent_changed'));

alter table public.notification_outbox
  add constraint notification_outbox_one_recipient check (num_nonnulls(recipient_lead_id, recipient_profile_id, recipient_subscriber_id) = 1),
  -- a subscriber is reached only by email (D-114: the list is an email list)
  add constraint notification_outbox_subscriber_email check (recipient_subscriber_id is null or channel = 'email'),
  add constraint notification_outbox_text_pair check ((subject is null) = (body is null)),
  add constraint notification_outbox_text check (subject is null or (app.notify_text_ok(subject, 200, false) and app.notify_text_ok(body, 3000, true))),
  add constraint notification_outbox_lease check ((status = 'sending') = (lease_until is not null)),
  add constraint notification_outbox_skip check ((status = 'skipped') = (skip_reason is not null));

create index notification_outbox_due_idx on public.notification_outbox (not_before) where status in ('queued', 'sending');
create index notification_outbox_subscriber_idx on public.notification_outbox (recipient_subscriber_id) where recipient_subscriber_id is not null;

-- ------------------------------------------------------------------------------------------------------------------
-- api views
-- ------------------------------------------------------------------------------------------------------------------
create view api.public_site_notices with (security_barrier = true) as
select
  n.id,
  n.title,
  n.body,
  n.link_path,
  n.link_url,
  n.link_label,
  n.starts_at,
  n.ends_at,
  n.updated_at
from public.site_notices n
where n.published
  and n.audience = 'public'
  and (n.starts_at is null or n.starts_at <= now())
  and (n.ends_at is null or n.ends_at > now());
grant select on api.public_site_notices to anon, authenticated;

create view api.public_notify_settings with (security_barrier = true) as
select s.email_subscribe_open
from public.notify_settings s
where s.id = 1;
grant select on api.public_notify_settings to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_subscribe: the /api/notify/subscribe endpoint's one call. Record {email, consentId, consentVersion, tokenHash}. The outcome
-- goes to the SERVER only (the visitor always gets the same answer): closed, send (with id: send the confirmation email),
-- already_active (send nothing), too_soon (a confirmation went out less than 5 minutes ago: send nothing).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.notify_subscribe(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.notify_subscribers%rowtype;
  v_email text;
  v_hash text;
  v_id uuid;
begin
  -- access check FIRST: the owner's switch (off by default)
  if not coalesce((select s.email_subscribe_open from public.notify_settings s where s.id = 1), false) then
    return jsonb_build_object('outcome', 'closed');
  end if;
  perform app.competition_keys(p_record, array['email', 'consentId', 'consentVersion', 'tokenHash'], 'subscription');
  if jsonb_typeof(p_record -> 'email') <> 'string' or jsonb_typeof(p_record -> 'consentId') <> 'string'
     or jsonb_typeof(p_record -> 'consentVersion') <> 'string' or jsonb_typeof(p_record -> 'tokenHash') <> 'string' then
    raise exception 'INVALID: a subscription field has the wrong type' using errcode = '22023';
  end if;
  v_email := lower(btrim(p_record ->> 'email'));
  v_hash := p_record ->> 'tokenHash';
  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID: bad token hash' using errcode = '22023'; end if;
  if length(v_email) not between 6 and 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[a-z]{2,24}$' then
    raise exception 'INVALID: bad email address' using errcode = '22023';
  end if;
  if (p_record ->> 'consentId') !~ '^[a-z][a-z0-9-]{2,60}$' or (p_record ->> 'consentVersion') !~ '^[A-Za-z0-9._-]{1,40}$' then
    raise exception 'INVALID: bad consent notice' using errcode = '22023';
  end if;

  select * into r from public.notify_subscribers s where s.email = v_email for update;
  if not found then
    insert into public.notify_subscribers (email, consent_id, consent_version, confirm_token_hash, confirm_expires_at, last_confirmation_at)
      values (v_email, p_record ->> 'consentId', p_record ->> 'consentVersion', v_hash, now() + interval '48 hours', now())
      on conflict (email) do nothing
      returning id into v_id;
    if v_id is null then return jsonb_build_object('outcome', 'too_soon'); end if; -- a parallel sign-up of the same address
    return jsonb_build_object('outcome', 'send', 'id', v_id);
  end if;
  if r.status = 'active' then return jsonb_build_object('outcome', 'already_active'); end if;
  if r.last_confirmation_at is not null and r.last_confirmation_at > now() - interval '5 minutes' then
    return jsonb_build_object('outcome', 'too_soon');
  end if;
  update public.notify_subscribers s
     set status = 'pending', consent_id = p_record ->> 'consentId', consent_version = p_record ->> 'consentVersion', consent_at = now(),
         confirm_token_hash = v_hash, confirm_expires_at = now() + interval '48 hours',
         confirmations_sent = least(s.confirmations_sent + 1, 100000), last_confirmation_at = now()
   where s.id = r.id;
  return jsonb_build_object('outcome', 'send', 'id', r.id);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_confirm: the confirmation link. confirmed (with id) or invalid (unknown, used or expired: one answer for all three).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.notify_confirm(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- access check FIRST: the owner's switch (a closed sign-up confirms nobody)
  if not coalesce((select s.email_subscribe_open from public.notify_settings s where s.id = 1), false) then
    return jsonb_build_object('outcome', 'closed');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('outcome', 'invalid'); end if;
  update public.notify_subscribers s
     set status = 'active', confirmed_at = now(), confirm_token_hash = null, confirm_expires_at = null
   where s.confirm_token_hash = p_token_hash and s.status = 'pending' and s.confirm_expires_at > now()
   returning s.id into v_id;
  if v_id is null then return jsonb_build_object('outcome', 'invalid'); end if;
  return jsonb_build_object('outcome', 'confirmed', 'id', v_id);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_unsubscribe: the one-click unsubscribe (the server checked the link's HMAC first). NEVER refused by a switch: an unsubscribe
-- always works. Every queued email to that subscriber is skipped at once (consent_withdrawn).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.notify_unsubscribe(p_subscriber uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_skipped integer;
begin
  -- access check FIRST: a subscriber id is required (the HMAC of the link was checked by the server; no switch can block this)
  if p_subscriber is null then return jsonb_build_object('outcome', 'unchanged'); end if;
  update public.notify_subscribers s
     set status = 'unsubscribed', unsubscribed_at = now(), confirm_token_hash = null, confirm_expires_at = null
   where s.id = p_subscriber and s.status <> 'unsubscribed'
   returning s.id into v_id;
  update public.notification_outbox o
     set status = 'skipped', skip_reason = 'consent_withdrawn', lease_until = null
   where o.recipient_subscriber_id = p_subscriber and o.status = 'queued';
  get diagnostics v_skipped = row_count;
  return jsonb_build_object('outcome', case when v_id is null then 'unchanged' else 'unsubscribed' end, 'skipped', v_skipped);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_outbox_enqueue: inserts outbox records (src/lib/notify/outbox/supabase-store.ts). Idempotent on the key: an existing key is left
-- untouched and counted as a duplicate. Each row: {key, kind, channel, recipient ('lead:<uuid>' | 'profile:<uuid>' |
-- 'subscriber:<uuid>'), payload, status ('queued' | 'skipped'), skipReason, subject, body, createdAt, notBefore, expiresAt}.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.notify_outbox_enqueue(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_recipient text;
  v_type text;
  v_ref uuid;
  v_id uuid;
  v_inserted integer := 0;
  v_dupes integer := 0;
begin
  -- access check FIRST: EXECUTE is granted to service_role only; then the batch shape
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'INVALID: the outbox batch must be a list of at most 500 records' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    perform app.competition_keys(r, array['key', 'kind', 'channel', 'recipient', 'payload', 'status', 'skipReason', 'subject', 'body', 'createdAt',
      'notBefore', 'expiresAt'], 'outbox record');
    if jsonb_typeof(r -> 'recipient') <> 'string' or (r ->> 'recipient') !~ '^(lead|profile|subscriber):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'INVALID: an outbox recipient must be lead:, profile: or subscriber: and an id' using errcode = '22023';
    end if;
    v_recipient := r ->> 'recipient';
    v_type := split_part(v_recipient, ':', 1);
    v_ref := split_part(v_recipient, ':', 2)::uuid;
    if (r ->> 'status') is null or (r ->> 'status') not in ('queued', 'skipped') then
      raise exception 'INVALID: a new outbox record is queued or skipped' using errcode = '22023';
    end if;
    if jsonb_typeof(r -> 'subject') <> 'string' or jsonb_typeof(r -> 'body') <> 'string' then
      raise exception 'INVALID: an outbox record needs its subject and body' using errcode = '22023';
    end if;
    insert into public.notification_outbox (kind, channel, recipient_lead_id, recipient_profile_id, recipient_subscriber_id, payload,
        idempotency_key, status, skip_reason, subject, body, created_at, not_before, expires_at)
      values (r ->> 'kind', r ->> 'channel',
        case when v_type = 'lead' then v_ref end, case when v_type = 'profile' then v_ref end, case when v_type = 'subscriber' then v_ref end,
        coalesce(r -> 'payload', '{}'::jsonb), r ->> 'key', r ->> 'status', r ->> 'skipReason', r ->> 'subject', r ->> 'body',
        coalesce((r ->> 'createdAt')::timestamptz, now()), coalesce((r ->> 'notBefore')::timestamptz, now()), (r ->> 'expiresAt')::timestamptz)
      on conflict (idempotency_key) do nothing
      returning id into v_id;
    if v_id is null then v_dupes := v_dupes + 1; else v_inserted := v_inserted + 1; end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_dupes);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- notify_outbox_cas: compare and set (the dispatcher's only write). Changes ONLY the delivery state (status, attempts, not_before,
-- lease_until, last_error_code, skip_reason, sent_at) and ONLY when the row still has the expected status and attempts. A final
-- state (sent, failed, skipped) never changes again. Returns true when this call changed the row.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.notify_outbox_cas(p_key text, p_expect_status text, p_expect_attempts integer, p_next jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- access check FIRST: EXECUTE is granted to service_role only; a final state is never reopened
  if p_expect_status is null or p_expect_status not in ('queued', 'sending') then return false; end if;
  perform app.competition_keys(p_next, array['status', 'attempts', 'notBefore', 'leaseUntil', 'lastError', 'skipReason', 'sentAt'], 'outbox state');
  if jsonb_typeof(p_next -> 'attempts') <> 'number' then raise exception 'INVALID: attempts must be a number' using errcode = '22023'; end if;
  update public.notification_outbox o
     set status = p_next ->> 'status',
         attempts = (p_next ->> 'attempts')::integer,
         not_before = coalesce((p_next ->> 'notBefore')::timestamptz, o.not_before),
         lease_until = (p_next ->> 'leaseUntil')::timestamptz,
         last_error_code = p_next ->> 'lastError',
         skip_reason = p_next ->> 'skipReason',
         sent_at = (p_next ->> 'sentAt')::timestamptz
   where o.idempotency_key = p_key and o.status = p_expect_status and o.attempts = p_expect_attempts;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_site_notice: create (p_id null, p_expected_revision null) or edit. Record {title, body, linkPath, linkUrl, linkLabel,
-- audience, startsAt, endsAt}. A change to a published public notice marks the site for a rebuild.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_site_notice(p_actor text, p_id uuid, p_record jsonb, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.site_notices%rowtype;
  v_title text;
  v_body text;
  v_path text;
  v_url text;
  v_label text;
  v_audience text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_fields text[] := array[]::text[];
  v_id uuid;
  v_rev integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['title', 'body', 'linkPath', 'linkUrl', 'linkLabel', 'audience', 'startsAt', 'endsAt'], 'notice');
  if jsonb_typeof(p_record -> 'title') <> 'string' then raise exception 'INVALID: the notice needs a title' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'body') not in ('string', 'null') or jsonb_typeof(p_record -> 'linkPath') not in ('string', 'null')
     or jsonb_typeof(p_record -> 'linkUrl') not in ('string', 'null') or jsonb_typeof(p_record -> 'linkLabel') not in ('string', 'null')
     or jsonb_typeof(p_record -> 'startsAt') not in ('string', 'null') or jsonb_typeof(p_record -> 'endsAt') not in ('string', 'null')
     or jsonb_typeof(p_record -> 'audience') <> 'string' then
    raise exception 'INVALID: a notice field has the wrong type' using errcode = '22023';
  end if;
  v_title := btrim(p_record ->> 'title');
  v_body := nullif(btrim(coalesce(p_record ->> 'body', '')), '');
  v_path := nullif(btrim(coalesce(p_record ->> 'linkPath', '')), '');
  v_url := nullif(btrim(coalesce(p_record ->> 'linkUrl', '')), '');
  v_label := nullif(btrim(coalesce(p_record ->> 'linkLabel', '')), '');
  v_audience := p_record ->> 'audience';
  if length(v_title) not between 2 and 120 or not app.notify_text_ok(v_title, 120, false) then
    raise exception 'INVALID: the title must be 2 to 120 characters, without an email address or a phone number' using errcode = '22023';
  end if;
  if v_body is not null and not app.notify_text_ok(v_body, 600, true) then
    raise exception 'INVALID: the text must be at most 600 characters, without an email address or a phone number' using errcode = '22023';
  end if;
  if v_path is not null and v_url is not null then raise exception 'INVALID: give one link only: a page of this site or an outside link' using errcode = '22023'; end if;
  if v_path is not null and not app.site_notice_path_ok(v_path) then raise exception 'INVALID: the page link must be a page of this site, like /competitions/' using errcode = '22023'; end if;
  if v_url is not null and not app.site_notice_link_ok(v_url) then
    raise exception 'INVALID: an outside link can only go to Power Smash on YouTube, Instagram, Facebook or the WhatsApp Channel' using errcode = '22023';
  end if;
  if (v_label is null) <> (v_path is null and v_url is null) then raise exception 'INVALID: a link needs its words, and words need a link' using errcode = '22023'; end if;
  if v_label is not null and (length(v_label) not between 2 and 60 or not app.notify_text_ok(v_label, 60, false)) then
    raise exception 'INVALID: the link words must be 2 to 60 characters' using errcode = '22023';
  end if;
  if v_audience not in ('public', 'staff') then raise exception 'INVALID: the notice is for visitors (public) or organizers and scorers (staff)' using errcode = '22023'; end if;
  begin
    v_starts := (p_record ->> 'startsAt')::timestamptz;
    v_ends := (p_record ->> 'endsAt')::timestamptz;
  exception when others then
    raise exception 'INVALID: the start and end must be dates and times' using errcode = '22023';
  end;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then raise exception 'INVALID: the end must be after the start' using errcode = '22023'; end if;

  if p_id is null then
    insert into public.site_notices (title, body, link_path, link_url, link_label, audience, starts_at, ends_at)
      values (v_title, v_body, v_path, v_url, v_label, v_audience, v_starts, v_ends)
      returning id, revision into v_id, v_rev;
    perform app.audit(p_actor, 'create_site_notice', 'site_notices', v_id::text,
      jsonb_build_object('audience', v_audience, 'has_body', v_body is not null, 'has_link', v_label is not null), p_reason);
    return jsonb_build_object('id', v_id, 'revision', v_rev, 'created', true);
  end if;

  select * into n from public.site_notices s where s.id = p_id for update;
  if not found then raise exception 'NOT_FOUND: notice not found' using errcode = 'P0002'; end if;
  if p_expected_revision is null or n.revision <> p_expected_revision then raise exception 'STALE: the notice changed; reload it' using errcode = '40001'; end if;
  if n.title is distinct from v_title then v_fields := array_append(v_fields, 'title'); end if;
  if n.body is distinct from v_body then v_fields := array_append(v_fields, 'body'); end if;
  if n.link_path is distinct from v_path or n.link_url is distinct from v_url or n.link_label is distinct from v_label then v_fields := array_append(v_fields, 'link'); end if;
  if n.audience is distinct from v_audience then v_fields := array_append(v_fields, 'audience'); end if;
  if n.starts_at is distinct from v_starts or n.ends_at is distinct from v_ends then v_fields := array_append(v_fields, 'window'); end if;
  if cardinality(v_fields) = 0 then return jsonb_build_object('id', n.id, 'revision', n.revision, 'created', false); end if;
  update public.site_notices s
     set title = v_title, body = v_body, link_path = v_path, link_url = v_url, link_label = v_label, audience = v_audience,
         starts_at = v_starts, ends_at = v_ends, revision = s.revision + 1
   where s.id = n.id
   returning s.revision into v_rev;
  perform app.audit(p_actor, 'update_site_notice', 'site_notices', n.id::text, jsonb_build_object('fields', to_jsonb(v_fields)), p_reason);
  if n.published and (n.audience = 'public' or v_audience = 'public') then perform app.mark_dirty('site notice changed', false); end if;
  return jsonb_build_object('id', n.id, 'revision', v_rev, 'created', false);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_publish_site_notice: publish or unpublish. A public notice marks the site for a rebuild.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_publish_site_notice(p_actor text, p_id uuid, p_published boolean, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.site_notices%rowtype;
  v_rev integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  if p_published is null then raise exception 'INVALID: say whether to publish' using errcode = '22023'; end if;
  select * into n from public.site_notices s where s.id = p_id for update;
  if not found then raise exception 'NOT_FOUND: notice not found' using errcode = 'P0002'; end if;
  if p_expected_revision is null or n.revision <> p_expected_revision then raise exception 'STALE: the notice changed; reload it' using errcode = '40001'; end if;
  if n.published = p_published then return jsonb_build_object('id', n.id, 'published', n.published, 'revision', n.revision); end if;
  update public.site_notices s
     set published = p_published, published_at = case when p_published then now() end, revision = s.revision + 1
   where s.id = n.id
   returning s.revision into v_rev;
  perform app.audit(p_actor, case when p_published then 'publish_site_notice' else 'unpublish_site_notice' end, 'site_notices', n.id::text,
    jsonb_build_object('audience', n.audience), p_reason);
  if n.audience = 'public' then perform app.mark_dirty('site notice ' || case when p_published then 'published' else 'unpublished' end, false); end if;
  return jsonb_build_object('id', n.id, 'published', p_published, 'revision', v_rev);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_notify_settings: the owner's switch for the email sign-up. Record {emailSubscribeOpen}.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_notify_settings(p_actor text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
  v_new boolean;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['emailSubscribeOpen'], 'notification settings');
  if jsonb_typeof(p_record -> 'emailSubscribeOpen') <> 'boolean' then raise exception 'INVALID: the email sign-up switch is on or off' using errcode = '22023'; end if;
  v_new := (p_record ->> 'emailSubscribeOpen')::boolean;
  select s.email_subscribe_open into v_old from public.notify_settings s where s.id = 1 for update;
  if v_old is not distinct from v_new then return jsonb_build_object('emailSubscribeOpen', v_new, 'fields', '[]'::jsonb); end if;
  update public.notify_settings s set email_subscribe_open = v_new, updated_by = p_actor where s.id = 1;
  perform app.audit(p_actor, 'set_notify_settings', 'notify_settings', '1', jsonb_build_object('fields', jsonb_build_array('emailSubscribeOpen'), 'new', v_new), p_reason);
  perform app.mark_dirty('email sign-up switched ' || case when v_new then 'on' else 'off' end, false);
  return jsonb_build_object('emailSubscribeOpen', v_new, 'fields', jsonb_build_array('emailSubscribeOpen'));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_queue_subscriber_announcement: one announcement email to every ACTIVE subscriber. Record {announcementId, subject, body}: the
-- text is rendered by src/lib/notify/outbox/templates.ts on the server. Keys are the TS idempotency keys (keys.ts) for kind
-- 'announcement', event = the announcement id, revision 0, recipient 'subscriber:<id>', channel email, so a second press with the same
-- announcement id queues nothing new. Audit: the id and counts only.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_queue_subscriber_announcement(p_actor text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ann uuid;
  v_subject text;
  v_body text;
  v_active integer;
  v_inserted integer;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['announcementId', 'subject', 'body'], 'announcement');
  v_ann := app.competition_uuid(p_record -> 'announcementId', 'announcementId');
  if v_ann is null then raise exception 'INVALID: the announcement needs its id' using errcode = '22023'; end if;
  if jsonb_typeof(p_record -> 'subject') <> 'string' or jsonb_typeof(p_record -> 'body') <> 'string' then
    raise exception 'INVALID: the announcement needs a subject and a text' using errcode = '22023';
  end if;
  v_subject := p_record ->> 'subject';
  v_body := p_record ->> 'body';
  if length(btrim(v_subject)) < 2 or not app.notify_text_ok(v_subject, 200, false) or length(btrim(v_body)) < 2 or not app.notify_text_ok(v_body, 3000, true) then
    raise exception 'INVALID: the subject and text must not hold an email address or a phone number' using errcode = '22023';
  end if;
  select count(*) into v_active from public.notify_subscribers s where s.status = 'active';
  insert into public.notification_outbox (kind, channel, recipient_subscriber_id, payload, idempotency_key, status, subject, body)
    select 'announcement', 'email', s.id, jsonb_build_object('event', v_ann::text, 'revision', 0),
           'ntf1:announcement:' || v_ann::text || ':0:subscriber%3A' || s.id::text || ':email', 'queued', v_subject, v_body
      from public.notify_subscribers s
     where s.status = 'active'
    on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  perform app.audit(p_actor, 'queue_announcement', 'notification_outbox', v_ann::text,
    jsonb_build_object('queued', v_inserted, 'duplicates', v_active - v_inserted), p_reason);
  return jsonb_build_object('announcementId', v_ann, 'queued', v_inserted, 'duplicates', v_active - v_inserted);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_notify_summary (read): counts only, never an address.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_notify_summary(p_actor text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_actor);
  return jsonb_build_object(
    'emailSubscribeOpen', coalesce((select s.email_subscribe_open from public.notify_settings s where s.id = 1), false),
    'subscribers', jsonb_build_object(
      'pending', (select count(*) from public.notify_subscribers s where s.status = 'pending'),
      'active', (select count(*) from public.notify_subscribers s where s.status = 'active'),
      'unsubscribed', (select count(*) from public.notify_subscribers s where s.status = 'unsubscribed')),
    'outbox', jsonb_build_object(
      'queued', (select count(*) from public.notification_outbox o where o.status = 'queued'),
      'sending', (select count(*) from public.notification_outbox o where o.status = 'sending'),
      'sent', (select count(*) from public.notification_outbox o where o.status = 'sent'),
      'failed', (select count(*) from public.notification_outbox o where o.status = 'failed'),
      'skipped', (select count(*) from public.notification_outbox o where o.status = 'skipped')));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges on the functions: helpers for nobody; RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.notify_text_ok(text, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function app.site_notice_link_ok(text) from public, anon, authenticated, service_role;
revoke all on function app.site_notice_path_ok(text) from public, anon, authenticated, service_role;

revoke all on function public.notify_subscribe(jsonb) from public, anon, authenticated;
revoke all on function public.notify_confirm(text) from public, anon, authenticated;
revoke all on function public.notify_unsubscribe(uuid) from public, anon, authenticated;
revoke all on function public.notify_outbox_enqueue(jsonb) from public, anon, authenticated;
revoke all on function public.notify_outbox_cas(text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.admin_save_site_notice(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_publish_site_notice(text, uuid, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.admin_set_notify_settings(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_queue_subscriber_announcement(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_notify_summary(text) from public, anon, authenticated;

grant execute on function public.notify_subscribe(jsonb) to service_role;
grant execute on function public.notify_confirm(text) to service_role;
grant execute on function public.notify_unsubscribe(uuid) to service_role;
grant execute on function public.notify_outbox_enqueue(jsonb) to service_role;
grant execute on function public.notify_outbox_cas(text, text, integer, jsonb) to service_role;
grant execute on function public.admin_save_site_notice(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_publish_site_notice(text, uuid, boolean, integer, text) to service_role;
grant execute on function public.admin_set_notify_settings(text, jsonb, text) to service_role;
grant execute on function public.admin_queue_subscriber_announcement(text, jsonb, text) to service_role;
grant execute on function public.admin_notify_summary(text) to service_role;
