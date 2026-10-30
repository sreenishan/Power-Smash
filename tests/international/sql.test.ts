// Static checks of migration 0022 (no database needed; supabase/checks/0022_assertions.sql runs the behaviour against PostgreSQL via
// node scripts/pg-local.mjs) and the parity between the SQL rules and src/lib/international/link-rules.ts (the shared rule module).
// House rules: RLS on, no policies, everything revoked, service_role SELECT only, SECURITY DEFINER with search_path = '', the owner
// check first, an explicit-column security_barrier api view, audit with field names and counts only, the house error prefixes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOCKED_HOSTS, DEFAULT_ALLOWED_HOSTS, FIELD_LIMITS, MAX_EVENT_DAYS, MAX_EXTRA_HOSTS, MAX_LINK_LENGTH, TRACKING_PARAMS, storedLinkProblem } from '../../src/lib/international/link-rules';
import { INTERNATIONAL_COLUMNS } from '../../src/lib/international/public/provider';
import { INTERNATIONAL_ADMIN_COLUMNS } from '../../src/lib/admin/international/supabase-backend';
import { INTERNATIONAL_RPCS } from '../../src/lib/admin/international/schemas';

const SQL = readFileSync(new URL('../../supabase/migrations/0022_international_links.sql', import.meta.url), 'utf8');
const CHECKS = readFileSync(new URL('../../supabase/checks/0022_assertions.sql', import.meta.url), 'utf8');
const code = SQL.replace(/--[^\n]*/g, '');

const functions = [...SQL.matchAll(/create or replace function ([a-z_.]+)\(([^)]*)\)[\s\S]*?\n\$\$;/g)].map((m) => ({ name: m[1] as string, body: m[0] }));
const view = /create view api\.public_international_events[\s\S]*?;\n/.exec(SQL)?.[0] ?? '';

describe('0022 house rules', () => {
  it('both tables: RLS on, no policy, revoked, service_role SELECT only', () => {
    for (const t of ['international_events', 'international_settings']) {
      expect(SQL).toContain(`alter table public.${t} enable row level security;`);
      expect(SQL).toContain(`revoke all on table public.${t} from public, anon, authenticated, service_role;`);
      expect(SQL).toContain(`grant select on public.${t} to service_role;`);
    }
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/grant (insert|update|delete|all)/i);
  });

  it('every function has search_path = \'\'; the three RPCs are SECURITY DEFINER and call app.require_owner first; helpers are not definers', () => {
    expect(functions.map((f) => f.name).sort()).toEqual([
      'app.international_allowed_hosts', 'app.international_date', 'app.international_default_hosts', 'app.international_host_problem', 'app.international_hosts_problem',
      'app.international_link_problem', 'app.international_text', 'public.admin_save_international_event', 'public.admin_set_international_event_published', 'public.admin_set_international_hosts',
    ]);
    for (const f of functions) expect(f.body, f.name).toContain("set search_path = ''");
    for (const f of functions.filter((x) => x.name.startsWith('public.'))) {
      expect(f.body, f.name).toContain('security definer');
      expect(f.body, f.name).toMatch(/\nbegin\n\s+perform app\.require_owner\(p_actor\);\n\s+perform app\.competition_reason\(p_reason\);/);
    }
    for (const f of functions.filter((x) => x.name.startsWith('app.'))) expect(f.body, f.name).not.toContain('security definer');
    expect(functions.filter((x) => x.name.startsWith('public.')).map((f) => f.name.slice('public.'.length)).sort()).toEqual([...INTERNATIONAL_RPCS].sort());
  });

  it('privileges: every function revoked; only the RPCs granted, to service_role', () => {
    for (const f of functions) expect(SQL, f.name).toMatch(new RegExp(`revoke all on function ${f.name.replace('.', '\\.')}\\(`));
    expect(code).not.toMatch(/grant execute on function app\./);
    expect(code).not.toMatch(/grant execute[^;]*to (anon|authenticated|public)/);
    for (const r of INTERNATIONAL_RPCS) expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${r}\\([^)]*\\) to service_role;`));
  });

  it('errors use the house prefixes', () => {
    const raised = [...code.matchAll(/raise exception '([^']*)'/g)].map((m) => m[1] as string);
    expect(raised.length).toBeGreaterThan(15);
    for (const r of raised) expect(r).toMatch(/^(INVALID|NOT_FOUND|STALE): /);
  });

  it('audit rows hold field names, counts and flags only (never the name, text or link)', () => {
    const audits = [...code.matchAll(/app\.audit\(([\s\S]*?), p_reason\);/g)].map((m) => m[1] as string);
    expect(audits).toHaveLength(4);
    for (const a of audits) expect(a).not.toMatch(/v_name|v_url|v_city|v_country|v_level|official_url|to_jsonb\(v_hosts|array_to_string\(v_hosts|'hosts'/);
  });

  it('the api view: explicit columns, security_barrier, published rows on the allow-list, mirrored by the provider', () => {
    expect(view).toContain('with (security_barrier = true)');
    expect(view).not.toMatch(/\*/);
    expect(view).toMatch(/where e\.published/);
    const cols = /select ([\s\S]*?)\n\s+from/.exec(view)?.[1]?.split(',').map((c) => c.trim().replace(/^e\./, ''));
    expect(cols).toEqual([...INTERNATIONAL_COLUMNS]);
    for (const h of DEFAULT_ALLOWED_HOSTS) expect(view).toContain(`'${h}'`);
    expect(view).toContain('s.extra_hosts');
    expect(SQL).toContain('grant select on api.public_international_events to anon, authenticated;');
    // no function in the view: anon needs nothing but SELECT on it
    expect(view).not.toMatch(/app\./);
  });

  it('the admin reads explicit base-table columns that exist', () => {
    for (const c of INTERNATIONAL_ADMIN_COLUMNS.international_events.split(',')) expect(SQL, c).toMatch(new RegExp(`\\n  ${c}\\s`));
    expect(SQL).toMatch(/\n  extra_hosts\s/);
  });

  it('no player, phone, email or contact column; no delete path', () => {
    const tables = [...SQL.matchAll(/create table public\.international_[a-z]+ \(([\s\S]*?)\n\);/g)].map((m) => m[1] as string).join('\n');
    expect(tables).not.toMatch(/player|phone|email|contact|whatsapp/i);
    expect(code).not.toMatch(/delete from public\.international_events/);
  });
});

describe('parity with src/lib/international/link-rules.ts', () => {
  it('the default hosts are the same list', () => {
    const m = /function app\.international_default_hosts\(\)[\s\S]*?array\[([^\]]*)\]/.exec(SQL);
    expect(m?.[1]?.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...DEFAULT_ALLOWED_HOSTS]);
  });
  it('the tracking parameters, the shorteners and the limits are the same', () => {
    const tracking = /\(utm_\[\^=&\]\*\|([a-z_|]+)\)/.exec(SQL)?.[1]?.split('|');
    expect(tracking).toEqual([...TRACKING_PARAMS]);
    const blocked = /if p_host = any \(array\[([^\]]*)\]\)/.exec(SQL)?.[1]?.split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(blocked).toEqual([...BLOCKED_HOSTS]);
    expect(SQL).toContain(`length(p_url) > ${MAX_LINK_LENGTH}`);
    expect(SQL).toContain(`cardinality(p_hosts) > ${MAX_EXTRA_HOSTS}`);
    expect(SQL).toContain(`v_end - v_start > ${MAX_EVENT_DAYS}`);
    expect(SQL).toContain(`app.international_text(p_record -> 'name', 'name', ${FIELD_LIMITS.name.min}, ${FIELD_LIMITS.name.max}, true)`);
    expect(SQL).toContain(`app.international_text(p_record -> 'levelText', 'level', ${FIELD_LIMITS.levelText.min}, ${FIELD_LIMITS.levelText.max}, false)`);
    expect(SQL).toContain(`app.international_text(p_record -> 'city', 'city', ${FIELD_LIMITS.city.min}, ${FIELD_LIMITS.city.max}, false)`);
    expect(SQL).toContain(`app.international_text(p_record -> 'country', 'country', ${FIELD_LIMITS.country.min}, ${FIELD_LIMITS.country.max}, true)`);
  });
  it('every sentence of storedLinkProblem is a sentence of app.international_link_problem', () => {
    const fn = functions.find((f) => f.name === 'app.international_link_problem')?.body ?? '';
    const samples = ['', 'x'.repeat(501), 'https://a b', 'ftp://x/', 'https://u@bwfbadminton.com/', 'https://bwfbadminton.com:1/', 'https://BWFbadminton.com/', 'https://bwf_badminton.com/', 'https://bwfbadminton.com/?utm_a=1'];
    for (const s of samples) {
      const p = storedLinkProblem(s, null);
      expect(p, s).not.toBeNull();
      expect(fn, s).toContain(`'${p}'`);
    }
    expect(fn).toContain("'the official link must be on an allowed website (' || array_to_string(p_hosts, ', ') || ')'");
  });
  it('the checks file tests the refusals the brief names (lookalikes, user info, ports, punycode)', () => {
    for (const s of ['bwfbadminton.com.evil.test', 'evilbwfbadminton.com', 'user@bwfbadminton.com', 'bwfbadminton.com@evil.test', 'bwfbadminton.com:443', 'xn--bwfbdminton-q9a.com']) {
      expect(CHECKS).toContain(s);
    }
    expect(CHECKS).toContain("select 'ok: 0022_international_links assertions passed' as result;");
  });
});
