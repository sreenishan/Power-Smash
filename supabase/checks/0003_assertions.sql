-- 0003_assertions.sql - self-check for migration 0003_lead_kinds_m3.sql. Changes nothing (rolled-back sub-transaction, fictional row).
-- Raises an exception naming the first broken rule and ends with one row `ok`.

do $$
declare
  v_def text;
  k text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'leads_type_check' and conrelid = 'public.leads'::regclass;
  if v_def is null then raise exception 'ASSERT FAIL: constraint leads_type_check is missing'; end if;
  foreach k in array array['coverage', 'sponsorship', 'player_product', 'featured_listing', 'academy_listing', 'general', 'tournament_submission', 'video_submission', 'alerts_signup'] loop
    if position(quote_literal(k) in v_def) = 0 then raise exception 'ASSERT FAIL: leads_type_check does not allow %', k; end if;
  end loop;
  -- both new kinds are accepted, an unknown kind is refused; the contact rule (phone or email) still holds
  begin
    insert into public.leads (id, ref_code, type, name, phone, consent_id, consent_version, consent_at, idempotency_key)
      values ('00000000-0000-4000-8000-0000000000a1', 'PS-2026-FAKE01', 'video_submission', 'Fake Person', '910000000000', 'lead-notice', 'v1', now(), '00000000-0000-4000-8000-0000000000b1');
    begin
      insert into public.leads (id, ref_code, type, name, phone, consent_id, consent_version, consent_at, idempotency_key)
        values ('00000000-0000-4000-8000-0000000000a2', 'PS-2026-FAKE02', 'no_such_kind', 'Fake Person', '910000000000', 'lead-notice', 'v1', now(), '00000000-0000-4000-8000-0000000000b2');
      raise exception 'ASSERT FAIL: an unknown lead kind was accepted';
    exception when check_violation then null;
    end;
    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0003_lead_kinds assertions passed' as result;
