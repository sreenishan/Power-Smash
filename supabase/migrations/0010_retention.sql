-- 0010_retention.sql - M4 retention job (D-028 retention schedule, spec 15.4, BUILD_PLAN M4 "retention-and-cleanup job", R-31).
-- Apply after 0009, then run supabase/checks/0010_assertions.sql.
-- Adds public.leads.anonymised_at, relaxes leads_has_contact for an anonymised lead, and one function:
--   public.admin_run_retention(p_actor text, p_dry_run boolean default true) -> jsonb of COUNTS only (never contact data)
-- What it does when p_dry_run is false (every step is idempotent: a second run changes nothing and writes no audit row):
--   1. anonymises leads whose status is `completed` or `lost` and whose last change (updated_at) is more than 24 months old:
--      name -> 'Anonymised'; organization, phone, email, notes, lost_reason, ip_hash, payload (-> {}) are cleared; counters and
--      non-identifying fields stay (ref_code, type, status, lang, value_paise, budget_range, source_path, utm, consent_*, timestamps);
--   2. deletes rate_limit_hits older than 2 days and daily_salts older than 2 IST days (D-029, 48-hour TTL);
--   3. event documents (spec 15.4, 30 days after the event): no such table exists yet and the lawyer holds the rule back
--      (D-019/D-069 `eventDocuments`), so the result says `event_documents: "not_built"` and nothing is deleted.
-- NEVER touched: suppression (tombstones), audit_log, consent_events, notice_versions, lead_events, tournament_private.
-- Not in this job (needs daily aggregates first, D-028): the 90-day purge of events and outbound_clicks.
-- A dry run counts only and writes nothing, not even an audit row. A real run that changed something writes ONE audit row with the counts.
-- Only service_role can run it (the retention workflow calls it with the secret key).

alter table public.leads add column anonymised_at timestamptz;
comment on column public.leads.anonymised_at is 'Set by admin_run_retention when the personal data of a closed lead was removed (D-028, 24 months). A lead with this set may have no phone and no email.';

alter table public.leads drop constraint leads_has_contact;
alter table public.leads add constraint leads_has_contact check (anonymised_at is not null or phone is not null or email is not null);

create index leads_retention_idx on public.leads (updated_at) where anonymised_at is null and status in ('completed', 'lost');

create or replace function public.admin_run_retention(p_actor text, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_lead_cutoff constant timestamptz := now() - interval '24 months';
  c_hit_cutoff  constant timestamptz := now() - interval '2 days';
  c_salt_cutoff constant date := (now() at time zone 'Asia/Kolkata')::date - 2;
  v_leads integer;
  v_hits integer;
  v_salts integer;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'a retention run needs an actor name' using errcode = '22023';
  end if;
  if p_dry_run is null then
    raise exception 'p_dry_run must be true or false' using errcode = '22023';
  end if;

  if p_dry_run then
    select count(*) into v_leads from public.leads where anonymised_at is null and status in ('completed', 'lost') and updated_at < c_lead_cutoff;
    select count(*) into v_hits from public.rate_limit_hits where hit_at < c_hit_cutoff;
    select count(*) into v_salts from public.daily_salts where day < c_salt_cutoff;
  else
    with a as (
      update public.leads
         set name = 'Anonymised', organization = null, phone = null, email = null, notes = null, lost_reason = null,
             ip_hash = null, payload = '{}'::jsonb, anonymised_at = now()
       where anonymised_at is null and status in ('completed', 'lost') and updated_at < c_lead_cutoff
      returning 1
    )
    select count(*) into v_leads from a;
    with d as (delete from public.rate_limit_hits where hit_at < c_hit_cutoff returning 1)
    select count(*) into v_hits from d;
    with d as (delete from public.daily_salts where day < c_salt_cutoff returning 1)
    select count(*) into v_salts from d;

    if v_leads + v_hits + v_salts > 0 then
      perform app.audit(p_actor, 'retention_run', 'retention', null,
        jsonb_build_object('leads_anonymised', v_leads, 'rate_limit_hits_deleted', v_hits, 'daily_salts_deleted', v_salts),
        'D-028 retention schedule');
    end if;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'leads_anonymised', v_leads, 'rate_limit_hits_deleted', v_hits,
                            'daily_salts_deleted', v_salts, 'event_documents', 'not_built');
end;
$$;

revoke all on function public.admin_run_retention(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_run_retention(text, boolean) to service_role;
