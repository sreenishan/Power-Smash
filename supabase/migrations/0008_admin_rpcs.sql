-- 0008_admin_rpcs.sql - M2 (ADMIN2): what the admin console needs beyond 0006.
--
-- Tables: profiles (who may use the admin), profile_requests (claim, correction, removal and junior requests waiting for the owner),
--         player_dup_dismissed ("not the same person" decisions).
-- Functions:
--   app.require_owner(p_actor)          raises FORBIDDEN unless p_actor is the id of a profiles row with role 'owner'
--   public.admin_set_setting            the two protected-mode switches only (D-012), old and new value audited
--   public.admin_dismiss_duplicate      remember that two players are not the same person
--   public.admin_decide_tournament      promote | reject | hide a tournament candidate (D-013, D-018)
--   public.admin_resolve_profile_request resolve | reject a request
--   public.admin_set_match_lock         set or clear one field-level lock (PC-20) on a match; the direct PATCH of
--                                       matches.manual_override that the store used first is undone by the guard trigger of 0005
-- Rules, same as 0006: SECURITY DEFINER, fixed search_path, EXECUTE only for service_role, one audit_log row per call (append-only),
-- and the NEW functions also check that p_actor is the owner (defence in depth: the Worker has already verified the JWT, aal2 and the
-- profiles role, D-006; the database cannot verify the human, but it can refuse an actor that is not the owner).
-- Error messages start with a code the store maps (NOT_FOUND, INVALID, FORBIDDEN, SUPPRESSED).
-- Tables are private: RLS on, no policy, nothing for anon or authenticated. service_role may only read them; every write goes through
-- the audited functions above (the tables have no INSERT/UPDATE/DELETE grant, except profile_requests which the claim form inserts into).
-- profiles has NO foreign key to the GoTrue users table on purpose (migrations never touch the auth schema); the owner's row is
-- inserted once, by hand, with the id of the owner's user (supabase/README.md).
-- Apply after 0007, then run supabase/checks/0008_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- profiles (D-006, D-007): the role comes only from here, never from token metadata
-- ------------------------------------------------------------------------------------------------------------------
create table public.profiles (
  id           uuid        primary key,
  role         text        not null,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_role_check check (role in ('owner', 'editor'))
);
-- exactly one owner (D-007: editors are disabled at launch; handing over the site is a deliberate update by the project owner)
create unique index profiles_single_owner on public.profiles (role) where role = 'owner';
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function app.touch_updated_at();
comment on table public.profiles is 'Private. Admin users: id = the GoTrue user id, role owner | editor (editors are off at launch, D-007). Read by the Worker with the secret key to decide the role; no API role can write it; the owner row is inserted by hand in the SQL editor.';
comment on column public.profiles.role is 'The only source of a role. Never taken from user_metadata (spoofable).';

-- ------------------------------------------------------------------------------------------------------------------
-- profile_requests: claim, correction, removal, junior (D-015); only listed and resolved by the admin
-- ------------------------------------------------------------------------------------------------------------------
create table public.profile_requests (
  id              uuid        primary key default gen_random_uuid(),
  player_id       uuid        references public.players (id) on delete restrict,
  kind            text        not null,
  status          text        not null default 'new',
  received_at     timestamptz not null default now(),
  summary         text        not null,
  decided_at      timestamptz,
  decided_by      text,
  decision_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint profile_requests_kind_check check (kind in ('claim', 'correction', 'removal', 'junior')),
  constraint profile_requests_status_check check (status in ('new', 'in_review', 'resolved', 'rejected')),
  -- owner-facing text carries no contact data: no "@" and fewer than seven digits in total
  constraint profile_requests_summary_check check (
    length(btrim(summary)) between 1 and 280 and position('@' in summary) = 0 and length(regexp_replace(summary, '[^0-9]', '', 'g')) < 7
  ),
  constraint profile_requests_decided_check check ((status in ('resolved', 'rejected')) = (decided_at is not null and decided_by is not null))
);
create index profile_requests_open_idx on public.profile_requests (received_at) where status in ('new', 'in_review');
create trigger profile_requests_touch_updated_at before update on public.profile_requests for each row execute function app.touch_updated_at();
comment on table public.profile_requests is 'Private. Requests about a player profile. summary holds a first name or initial and one line, never a phone or an email (table check). Resolved or rejected only through admin_resolve_profile_request.';

-- ------------------------------------------------------------------------------------------------------------------
-- player_dup_dismissed: "not the same person"; the pair is stored once, smaller id first
-- ------------------------------------------------------------------------------------------------------------------
create table public.player_dup_dismissed (
  player_a     uuid        not null references public.players (id) on delete restrict,
  player_b     uuid        not null references public.players (id) on delete restrict,
  dismissed_by text        not null,
  reason       text,
  dismissed_at timestamptz not null default now(),
  primary key (player_a, player_b),
  constraint player_dup_dismissed_order check (player_a < player_b)
);
comment on table public.player_dup_dismissed is 'Private. Pairs the owner marked as different people, so the duplicate list does not show them again. Written only by admin_dismiss_duplicate.';

-- ------------------------------------------------------------------------------------------------------------------
-- Row level security and privileges
-- ------------------------------------------------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.profile_requests     enable row level security;
alter table public.player_dup_dismissed enable row level security;

revoke all on table public.profiles, public.profile_requests, public.player_dup_dismissed
  from public, anon, authenticated, service_role;  -- service_role too: its default grants are replaced by the explicit list below (see 0001)

grant select         on public.profiles             to service_role;   -- the Worker reads the role; nothing can write it through the API
grant select, insert on public.profile_requests     to service_role;   -- the claim form inserts; the admin resolves through the RPC
grant select         on public.player_dup_dismissed to service_role;   -- written only by admin_dismiss_duplicate

-- ------------------------------------------------------------------------------------------------------------------
-- app.require_owner
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.require_owner(p_actor text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or p_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not exists (select 1 from public.profiles p where p.id = p_actor::uuid and p.role = 'owner') then
    raise exception 'FORBIDDEN: the actor is not the owner' using errcode = '42501';
  end if;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_setting: the two protected-mode switches
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_setting(p_actor text, p_key text, p_value text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  perform app.require_owner(p_actor);
  if p_key is null or p_key not in ('unknown_match_mode', 'minor_match_mode') then
    raise exception 'INVALID: only unknown_match_mode and minor_match_mode can be changed here' using errcode = '22023';
  end if;
  if p_value is null or p_value not in ('noindex_minimal', 'hidden') then raise exception 'INVALID: the value must be noindex_minimal or hidden' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a setting change needs a reason' using errcode = '22023'; end if;
  select value into v_old from public.archive_settings where key = p_key for update;
  insert into public.archive_settings (key, value, updated_by) values (p_key, p_value, p_actor)
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform app.audit(p_actor, 'set_setting', 'archive_settings', p_key, jsonb_build_object('old', v_old, 'new', p_value), p_reason);
  perform app.mark_dirty('setting ' || p_key, false);
  return jsonb_build_object('key', p_key, 'old', v_old, 'value', p_value);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_dismiss_duplicate
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_dismiss_duplicate(p_actor text, p_a uuid, p_b uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lo uuid;
  v_hi uuid;
begin
  perform app.require_owner(p_actor);
  if p_a is null or p_b is null or p_a = p_b then raise exception 'INVALID: two different players are needed' using errcode = '22023'; end if;
  if (select count(*) from public.players where id in (p_a, p_b)) <> 2 then raise exception 'NOT_FOUND: player not found' using errcode = 'P0002'; end if;
  v_lo := least(p_a, p_b);
  v_hi := greatest(p_a, p_b);
  insert into public.player_dup_dismissed (player_a, player_b, dismissed_by, reason) values (v_lo, v_hi, p_actor, nullif(btrim(p_reason), ''))
    on conflict (player_a, player_b) do nothing;
  perform app.audit(p_actor, 'dismiss_duplicate', 'players', v_lo::text, jsonb_build_object('a', v_lo, 'b', v_hi), p_reason);
  return jsonb_build_object('dismissed', true);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_decide_tournament: promote | reject | hide
--   promote: published and promoted (a page exists with fewer than 3 matches, D-013); only a Tamil Nadu event becomes public, any other
--            region stays listed without a page (D-018); an international event stays hidden (table check); a suppressed one is refused.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_decide_tournament(p_actor text, p_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments%rowtype;
  v_vis text;
begin
  perform app.require_owner(p_actor);
  if p_decision is null or p_decision not in ('promote', 'reject', 'hide') then raise exception 'INVALID: decision must be promote, reject or hide' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a decision needs a reason' using errcode = '22023'; end if;
  select * into t from public.tournaments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002'; end if;
  perform set_config('app.override_bypass', 'on', true);
  if p_decision = 'promote' then
    if app.is_suppressed('tournament_id', t.id::text) then raise exception 'SUPPRESSED: a suppressed tournament cannot be promoted (D-014)' using errcode = '42501'; end if;
    v_vis := case t.region when 'tamil_nadu' then 'public' when 'international' then 'hidden' else 'listed_no_player_pages' end;
    update public.tournaments set status = 'published', is_promoted = true, visibility = v_vis where id = t.id;
  elsif p_decision = 'reject' then
    update public.tournaments set status = 'rejected', visibility = 'hidden' where id = t.id;
  else
    update public.tournaments set visibility = 'hidden' where id = t.id;
  end if;
  perform app.audit(p_actor, 'decide_tournament', 'tournaments', t.id::text,
    jsonb_build_object('decision', p_decision, 'old_status', t.status, 'old_visibility', t.visibility,
                       'new_status', (select status from public.tournaments where id = t.id), 'new_visibility', (select visibility from public.tournaments where id = t.id)),
    p_reason);
  perform set_config('app.override_bypass', 'off', true);
  perform app.mark_dirty('tournament decision', false);
  return (select jsonb_build_object('id', id, 'status', status, 'visibility', visibility, 'is_promoted', is_promoted) from public.tournaments where id = t.id);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_resolve_profile_request
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_resolve_profile_request(p_actor text, p_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.profile_requests%rowtype;
begin
  perform app.require_owner(p_actor);
  if p_decision is null or p_decision not in ('resolve', 'reject') then raise exception 'INVALID: decision must be resolve or reject' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a decision needs a reason' using errcode = '22023'; end if;
  select * into r from public.profile_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: request not found' using errcode = 'P0002'; end if;
  if r.status not in ('new', 'in_review') then raise exception 'INVALID: the request was already decided' using errcode = '22023'; end if;
  update public.profile_requests
     set status = case p_decision when 'resolve' then 'resolved' else 'rejected' end,
         decided_at = now(), decided_by = p_actor, decision_reason = p_reason
   where id = r.id;
  perform app.audit(p_actor, 'resolve_profile_request', 'profile_requests', r.id::text,
    jsonb_build_object('decision', p_decision, 'kind', r.kind, 'player_id', r.player_id), p_reason);
  return jsonb_build_object('id', r.id, 'status', case p_decision when 'resolve' then 'resolved' else 'rejected' end);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_match_lock: one field-level lock (PC-20) on a match, set or cleared
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_match_lock(p_actor text, p_match_id uuid, p_field text, p_locked boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches%rowtype;
begin
  perform app.require_owner(p_actor);
  if p_field is null or p_field not in ('tournament_id', 'category', 'age_group', 'round', 'format', 'played_on', 'participants') then
    raise exception 'INVALID: this field cannot be locked' using errcode = '22023';
  end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'NOT_FOUND: match not found' using errcode = 'P0002'; end if;
  perform set_config('app.override_bypass', 'on', true);
  update public.matches
     set manual_override = case when coalesce(p_locked, true) then manual_override || jsonb_build_object(p_field, true) else manual_override - p_field end
   where id = m.id;
  perform app.audit(p_actor, case when coalesce(p_locked, true) then 'lock_match_field' else 'unlock_match_field' end, 'matches', m.id::text,
    jsonb_build_object('field', p_field), coalesce(nullif(btrim(p_reason), ''), 'field lock'));
  perform set_config('app.override_bypass', 'off', true);
  return jsonb_build_object('id', m.id, 'field', p_field, 'locked', coalesce(p_locked, true));
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges for functions: nothing for the API roles; the RPCs only for service_role
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.require_owner(text) from public, anon, authenticated;
revoke all on function public.admin_set_setting(text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_dismiss_duplicate(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_decide_tournament(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_resolve_profile_request(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_set_match_lock(text, uuid, text, boolean, text) from public, anon, authenticated;

grant execute on function public.admin_set_setting(text, text, text, text) to service_role;
grant execute on function public.admin_dismiss_duplicate(text, uuid, uuid, text) to service_role;
grant execute on function public.admin_decide_tournament(text, uuid, text, text) to service_role;
grant execute on function public.admin_resolve_profile_request(text, uuid, text, text) to service_role;
grant execute on function public.admin_set_match_lock(text, uuid, text, boolean, text) to service_role;
