// Static checks of migration 0020 (no database needed; supabase/checks/0020_assertions.sql runs the behaviour against PostgreSQL via
// node scripts/pg-local.mjs). House rules: RLS on, no policies, everything revoked, service_role SELECT only, SECURITY DEFINER with
// search_path = '', the access check first, explicit-column security_barrier api views, no contact column in any api view, audit
// with ids/counts/codes only, no default fee or payment text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGISTRATION_EVENT_COLUMNS, REGISTRATION_PAYMENT_COLUMNS } from '../../src/lib/registration/public/provider';

const SQL = readFileSync(new URL('../../supabase/migrations/0020_registrations.sql', import.meta.url), 'utf8');
const CHECKS = readFileSync(new URL('../../supabase/checks/0020_assertions.sql', import.meta.url), 'utf8');

const functions = [...SQL.matchAll(/create or replace function ([a-z_.]+)\(([^)]*)\)[\s\S]*?\n\$\$;/g)].map((m) => ({ name: m[1] as string, body: m[0] }));
const viewBody = (name: string): string => {
  const m = new RegExp(`create view ${name.replace('.', '\\.')}[\\s\\S]*?;\\n`).exec(SQL);
  return m ? m[0] : '';
};

describe('0020 house rules', () => {
  it('the private table: RLS on, no policy, revoked, service_role SELECT only', () => {
    expect(SQL).toContain('alter table public.event_registrations enable row level security;');
    expect(SQL).toContain('revoke all on table public.event_registrations from public, anon, authenticated, service_role;');
    expect(SQL).toContain('grant select on public.event_registrations to service_role;');
    expect(SQL).not.toMatch(/create policy/i);
    expect(SQL).not.toMatch(/grant (insert|update|delete)/i);
  });

  it('every function is SECURITY DEFINER or pure, with search_path = \'\'', () => {
    expect(functions.length).toBeGreaterThanOrEqual(10);
    for (const f of functions) expect(f.body, f.name).toContain("set search_path = ''");
    for (const f of functions.filter((x) => x.name.startsWith('public.'))) expect(f.body, f.name).toContain('security definer');
  });

  it('owner RPCs call app.require_owner first; the endpoint RPC checks the owner switch first', () => {
    for (const f of functions.filter((x) => x.name.startsWith('public.admin_'))) {
      expect(f.body, f.name).toMatch(/\nbegin\n\s+perform app\.require_owner\(p_actor\);/);
    }
    const submit = functions.find((f) => f.name === 'public.registration_submit')?.body ?? '';
    expect(submit).toMatch(/\nbegin\n\s+--[^\n]*\n\s+if not coalesce\(\(select s\.registration_enabled from public\.competition_settings/);
  });

  it('errors use the house prefixes', () => {
    const raised = [...SQL.matchAll(/raise exception '([^']*)'/g)].map((m) => m[1] as string);
    expect(raised.length).toBeGreaterThan(20);
    for (const r of raised) expect(r).toMatch(/^(INVALID|NOT_FOUND|STALE|FORBIDDEN): /);
  });

  it('privileges: helpers for nobody, RPCs for service_role only', () => {
    for (const f of functions) {
      const sig = f.name;
      expect(SQL, sig).toMatch(new RegExp(`revoke all on function ${sig.replace('.', '\\.')}\\(`));
    }
    expect(SQL).not.toMatch(/grant execute on function app\./);
    expect(SQL).not.toMatch(/grant execute[^;]*to (anon|authenticated)/);
  });

  it('the api views: explicit columns, security_barrier, no contact field, mirrored by the provider', () => {
    const ev = viewBody('api.public_registration_events');
    const pay = viewBody('api.public_registration_payment');
    for (const v of [ev, pay]) {
      expect(v).toContain('with (security_barrier = true)');
      expect(v).not.toMatch(/select \*|\.\*/);
      expect(v).not.toMatch(/phone|email|payment_reference|player1_name|ip_hash|event_registrations/);
    }
    expect(ev).toMatch(/e\.id as event_id,\s+e\.entry_fee_paise/);
    expect(ev).toContain('not coalesce(pe.is_junior, true)');
    expect(ev).toContain('e.registration_open');
    expect(REGISTRATION_EVENT_COLUMNS).toEqual(['event_id', 'entry_fee_paise']);
    expect(REGISTRATION_PAYMENT_COLUMNS).toEqual(['payment_instructions', 'upi_id', 'payee_name']);
    // the settings reach the api only through the app view (0017 rule)
    expect(pay).toContain('from app.registration_open_settings');
    expect(ev).not.toContain('public.competition_settings');
  });

  it('no fee, payment text or UPI id is defaulted; switches stay off', () => {
    expect(SQL).toContain('add column registration_open boolean not null default false');
    expect(SQL).toMatch(/add column entry_fee_paise integer check/);
    expect(SQL).not.toMatch(/entry_fee_paise integer default|registration_upi_id text default|registration_payment_instructions text default/);
    expect(SQL).not.toMatch(/update public\.competition_settings set registration_enabled = true/);
    expect(SQL).not.toMatch(/insert into public\.event_registrations[\s\S]{0,200}values \('PSR/);
  });

  it('a self-claimed age is never stored, and a new player is created with the column defaults (unknown age, provisional, hidden)', () => {
    expect(SQL).not.toMatch(/age_group\s+text|age_claim|date_of_birth/);
    const convert = functions.find((f) => f.name === 'public.admin_convert_registration')?.body ?? '';
    expect(convert).toMatch(/insert into public\.players \(display_name, name_normalized, identity_tier, created_source, provisional_tournament_id\)/);
    expect(convert).not.toMatch(/age_status|age_lift_ok|is_provisional = false|visibility/);
    expect(convert).toContain("app.is_suppressed('name_normalized', v_norm)");
    expect(convert).toContain('public.admin_add_entry(p_actor, e.id');
  });

  it('audit rows carry ids, counts, codes and amounts: never the names, phone, email or reference', () => {
    const audits = [...SQL.matchAll(/perform app\.audit\(([\s\S]*?)\);\n/g)].map((m) => m[1] as string);
    expect(audits.length).toBe(6);
    // only yes/no facts ("v_email is not null") may mention a private value
    for (const a of audits) expect(a.replace(/v_[a-z0-9]+ is (?:not )?null/g, '')).not.toMatch(/v_p1|v_p2|v_phone|v_email|v_payref|player1_name|contact_|bpayment_reference|v_name|v_text|v_upi|v_payee/);
  });

  it('the checks file covers anon, contact data and the protected-player rule', () => {
    expect(CHECKS).toContain("execute 'set local role anon'");
    expect(CHECKS).toContain('anon reading registrations');
    expect(CHECKS).toContain('an api view row holds registration data');
    expect(CHECKS).toContain('the converted player can be named');
    expect(CHECKS).toContain('a junior event took a registration');
    expect(CHECKS).toMatch(/select 'ok: 0020_registrations assertions passed'/);
  });
});
