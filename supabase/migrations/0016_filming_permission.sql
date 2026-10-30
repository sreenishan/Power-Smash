-- 0016_filming_permission.sql: the filming-permission record of a tournament (D-019, built as the safe default in D-105).
--
-- D-019 asks for a permission record per event: status, who granted it and when, the scope (filming; YouTube publishing and monetisation;
-- live stream; sponsor overlays; an exclusive media partner present) and a reference to the proof. Monetised coverage, a live stream or a
-- "Covered by Power Smash" badge needs `granted`; the admin warns and shows the gap. This adds:
--   public.tournament_permissions        one row per tournament the owner has recorded. NO row = unknown (fail closed). PRIVATE.
--   public.admin_set_filming_permission  the one write path: owner only (app.require_owner), every field checked, audited.
-- PRIVATE: the granting person's name is personal data (D-029). No api view exposes this table, and the audit holds the status and the
-- scope, never the name, the role or the proof reference. Nothing is backfilled: every existing tournament stays unknown (D-019).
-- D-019 itself is still "proposed" (owner approval, lawyer review of the templates): this only stores what the owner states.
-- House rules (0001-0015): RLS on with NO policies, everything revoked, explicit grants; SECURITY DEFINER, fixed search_path.

create table public.tournament_permissions (
  tournament_id           uuid primary key references public.tournaments (id) on delete cascade,
  status                  text not null check (status in ('unknown', 'requested', 'granted', 'refused', 'not_required')),
  granted_by_name         text check (granted_by_name is null or (granted_by_name = btrim(granted_by_name) and length(granted_by_name) between 1 and 120 and granted_by_name !~ '[[:cntrl:]]')),
  granted_by_role         text check (granted_by_role is null or (granted_by_role = btrim(granted_by_role) and length(granted_by_role) between 1 and 80 and granted_by_role !~ '[[:cntrl:]]')),
  granted_on              date,
  scope_filming           boolean not null default false,
  scope_youtube           boolean not null default false,
  scope_live_stream       boolean not null default false,
  scope_sponsor_overlays  boolean not null default false,
  exclusive_partner       text not null default 'unknown' check (exclusive_partner in ('unknown', 'yes', 'no')),
  document_ref            text check (document_ref is null or (document_ref = btrim(document_ref) and length(document_ref) between 1 and 300 and document_ref !~ '[[:cntrl:]]')),
  updated_at              timestamptz not null default now(),
  updated_by              text not null,
  -- granted means: who, their role, when, and at least filming
  constraint tournament_permissions_granted_complete check (
    status <> 'granted' or (granted_by_name is not null and granted_by_role is not null and granted_on is not null and scope_filming)
  )
);
comment on table public.tournament_permissions is 'Private. Filming permission per tournament (D-019, D-105). No row = unknown. Holds a person''s name: owner only.';

alter table public.tournament_permissions enable row level security;
-- Deliberately NO policies: only the service role reads it, and writes go through admin_set_filming_permission.
revoke all on table public.tournament_permissions from public, anon, authenticated, service_role;
grant select on public.tournament_permissions to service_role;

create or replace function public.admin_set_filming_permission(p_actor text, p_tournament uuid, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['status', 'grantedByName', 'grantedByRole', 'grantedOn', 'scopeFilming', 'scopeYoutube', 'scopeLiveStream',
    'scopeSponsorOverlays', 'exclusivePartner', 'documentRef'];
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_key text;
  v_old public.tournament_permissions%rowtype;
  v_old_rec jsonb;
  v_new_rec jsonb;
  v_fields text[];
  v_name text;
  v_role text;
  v_ref text;
  v_on date;
begin
  perform app.require_owner(p_actor);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a permission change needs a reason' using errcode = '22023'; end if;
  if not exists (select 1 from public.tournaments where id = p_tournament) then raise exception 'NOT_FOUND: tournament not found' using errcode = 'P0002'; end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object' then raise exception 'INVALID: the permission must be an object' using errcode = '22023'; end if;
  for v_key in select jsonb_object_keys(p_record) loop
    if not v_key = any (v_allowed) then raise exception 'INVALID: unknown permission field %', v_key using errcode = '22023'; end if;
  end loop;
  foreach v_key in array v_allowed loop
    if not p_record ? v_key then raise exception 'INVALID: the permission field % is missing', v_key using errcode = '22023'; end if;
  end loop;
  -- types: never coerced
  if jsonb_typeof(p_record -> 'status') <> 'string' or jsonb_typeof(p_record -> 'exclusivePartner') <> 'string'
     or jsonb_typeof(p_record -> 'scopeFilming') <> 'boolean' or jsonb_typeof(p_record -> 'scopeYoutube') <> 'boolean'
     or jsonb_typeof(p_record -> 'scopeLiveStream') <> 'boolean' or jsonb_typeof(p_record -> 'scopeSponsorOverlays') <> 'boolean' then
    raise exception 'INVALID: a permission field has the wrong type' using errcode = '22023';
  end if;
  foreach v_key in array array['grantedByName', 'grantedByRole', 'grantedOn', 'documentRef'] loop
    if jsonb_typeof(p_record -> v_key) not in ('string', 'null') then raise exception 'INVALID: the permission field % has the wrong type', v_key using errcode = '22023'; end if;
  end loop;
  if (p_record ->> 'status') not in ('unknown', 'requested', 'granted', 'refused', 'not_required') then raise exception 'INVALID: unknown status' using errcode = '22023'; end if;
  if (p_record ->> 'exclusivePartner') not in ('unknown', 'yes', 'no') then raise exception 'INVALID: exclusive partner must be unknown, yes or no' using errcode = '22023'; end if;

  -- text: trimmed, empty = not stated, length in characters, no control characters (the table checks hold the same rules)
  v_name := nullif(btrim(coalesce(p_record ->> 'grantedByName', '')), '');
  v_role := nullif(btrim(coalesce(p_record ->> 'grantedByRole', '')), '');
  v_ref := nullif(btrim(coalesce(p_record ->> 'documentRef', '')), '');
  if (v_name is not null and (length(v_name) > 120 or v_name ~ '[[:cntrl:]]')) or (v_role is not null and (length(v_role) > 80 or v_role ~ '[[:cntrl:]]'))
     or (v_ref is not null and (length(v_ref) > 300 or v_ref ~ '[[:cntrl:]]')) then
    raise exception 'INVALID: name up to 120, role up to 80, proof reference up to 300 characters, with no control characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record -> 'grantedOn') = 'string' then
    if (p_record ->> 'grantedOn') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID: the date must be YYYY-MM-DD' using errcode = '22023'; end if;
    begin
      v_on := (p_record ->> 'grantedOn')::date;
    exception when others then
      raise exception 'INVALID: the date is not a real date' using errcode = '22023';
    end;
    if to_char(v_on, 'YYYY-MM-DD') <> (p_record ->> 'grantedOn') then raise exception 'INVALID: the date is not a real date' using errcode = '22023'; end if;
    if v_on > v_today then raise exception 'INVALID: the date is in the future' using errcode = '22023'; end if;
  end if;
  if (p_record ->> 'status') = 'granted' and (v_name is null or v_role is null or v_on is null or not (p_record ->> 'scopeFilming')::boolean) then
    raise exception 'INVALID: granted permission needs who, their role, the date and filming in its scope' using errcode = '22023';
  end if;

  select * into v_old from public.tournament_permissions where tournament_id = p_tournament for update;
  v_old_rec := jsonb_build_object('status', coalesce(v_old.status, 'unknown'), 'grantedByName', v_old.granted_by_name, 'grantedByRole', v_old.granted_by_role,
    'grantedOn', to_char(v_old.granted_on, 'YYYY-MM-DD'), 'scopeFilming', coalesce(v_old.scope_filming, false), 'scopeYoutube', coalesce(v_old.scope_youtube, false),
    'scopeLiveStream', coalesce(v_old.scope_live_stream, false), 'scopeSponsorOverlays', coalesce(v_old.scope_sponsor_overlays, false),
    'exclusivePartner', coalesce(v_old.exclusive_partner, 'unknown'), 'documentRef', v_old.document_ref);
  v_new_rec := jsonb_build_object('status', p_record ->> 'status', 'grantedByName', v_name, 'grantedByRole', v_role, 'grantedOn', to_char(v_on, 'YYYY-MM-DD'),
    'scopeFilming', (p_record ->> 'scopeFilming')::boolean, 'scopeYoutube', (p_record ->> 'scopeYoutube')::boolean,
    'scopeLiveStream', (p_record ->> 'scopeLiveStream')::boolean, 'scopeSponsorOverlays', (p_record ->> 'scopeSponsorOverlays')::boolean,
    'exclusivePartner', p_record ->> 'exclusivePartner', 'documentRef', v_ref);
  select coalesce(array_agg(k order by array_position(v_allowed, k)), '{}') into v_fields from unnest(v_allowed) k where (v_old_rec -> k) is distinct from (v_new_rec -> k);
  if cardinality(v_fields) = 0 then return jsonb_build_object('tournamentId', p_tournament, 'fields', '[]'::jsonb); end if;

  insert into public.tournament_permissions as tp (tournament_id, status, granted_by_name, granted_by_role, granted_on, scope_filming, scope_youtube,
      scope_live_stream, scope_sponsor_overlays, exclusive_partner, document_ref, updated_at, updated_by)
    values (p_tournament, p_record ->> 'status', v_name, v_role, v_on, (p_record ->> 'scopeFilming')::boolean, (p_record ->> 'scopeYoutube')::boolean,
      (p_record ->> 'scopeLiveStream')::boolean, (p_record ->> 'scopeSponsorOverlays')::boolean, p_record ->> 'exclusivePartner', v_ref, now(), p_actor)
    on conflict (tournament_id) do update set status = excluded.status, granted_by_name = excluded.granted_by_name, granted_by_role = excluded.granted_by_role,
      granted_on = excluded.granted_on, scope_filming = excluded.scope_filming, scope_youtube = excluded.scope_youtube, scope_live_stream = excluded.scope_live_stream,
      scope_sponsor_overlays = excluded.scope_sponsor_overlays, exclusive_partner = excluded.exclusive_partner, document_ref = excluded.document_ref,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  -- the audit holds the status, the scope and the NAMES of the changed fields; never the person's name, role or the proof reference
  perform app.audit(p_actor, 'set_filming_permission', 'tournaments', p_tournament::text,
    jsonb_build_object('old_status', v_old_rec ->> 'status', 'new_status', v_new_rec ->> 'status', 'fields', to_jsonb(v_fields),
      'scope', jsonb_build_object('filming', v_new_rec -> 'scopeFilming', 'youtube', v_new_rec -> 'scopeYoutube', 'live_stream', v_new_rec -> 'scopeLiveStream',
        'sponsor_overlays', v_new_rec -> 'scopeSponsorOverlays')), p_reason);
  return jsonb_build_object('tournamentId', p_tournament, 'fields', to_jsonb(v_fields));
end;
$$;

revoke all on function public.admin_set_filming_permission(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_set_filming_permission(text, uuid, jsonb, text) to service_role;
