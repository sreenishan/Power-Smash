// Static house rules of migration 0023 and its checks, the endpoint files, and the client/server rule parity of the sign-up.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIRM_TTL_HOURS, SUBSCRIBE_CONSENT, subscribeFieldProblems } from '../../src/lib/notices/constants';
import { normaliseEmail } from '../../src/lib/security/text';

const raw = readFileSync('supabase/migrations/0023_notifications.sql', 'utf8').replace(/\r\n/g, '\n');
const sql = raw.replace(/--[^\n]*/g, ''); // code only
const checks = readFileSync('supabase/checks/0023_assertions.sql', 'utf8').replace(/\r\n/g, '\n');

describe('migration 0023 house rules', () => {
  const tables = [...sql.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1] as string);
  it('creates the three tables', () => expect(tables).toEqual(['notify_subscribers', 'notify_settings', 'site_notices']));

  it('every new table: RLS on, everything revoked, service_role SELECT only, no policy', () => {
    for (const t of tables) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${t} from public, anon, authenticated, service_role;`);
      expect(sql).toContain(`grant select on public.${t} to service_role;`);
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*on (table )?public\./i);
    expect(sql).not.toMatch(/grant [^;]* on (table )?public\.[a-z_]+ to [^;]*anon/i);
  });

  it('api views are security_barrier, explicit-column, and never read subscribers or the outbox', () => {
    const views = [...sql.matchAll(/create view (api\.[a-z_]+) with \(security_barrier = true\) as([\s\S]*?);/g)];
    expect(views.map((v) => v[1])).toEqual(['api.public_site_notices', 'api.public_notify_settings']);
    for (const v of views) {
      expect(v[2]).not.toMatch(/select \*|\.\*/);
      expect(v[2]).not.toMatch(/notify_subscribers|notification_outbox|audience\s*,|revision/);
    }
  });

  it('every function: SECURITY DEFINER or a pure helper, search_path empty; RPCs for service_role only', () => {
    const fns = [...sql.matchAll(/create or replace function ([a-z_]+\.[a-z_]+)\(([^)]*)\)\s*returns[\s\S]*?\nas \$\$/g)];
    expect(fns.length).toBe(13);
    for (const f of fns) expect(f[0]).toContain("set search_path = ''");
    const rpcs = fns.filter((f) => (f[1] as string).startsWith('public.'));
    expect(rpcs.map((f) => f[1])).toEqual([
      'public.notify_subscribe',
      'public.notify_confirm',
      'public.notify_unsubscribe',
      'public.notify_outbox_enqueue',
      'public.notify_outbox_cas',
      'public.admin_save_site_notice',
      'public.admin_publish_site_notice',
      'public.admin_set_notify_settings',
      'public.admin_queue_subscriber_announcement',
      'public.admin_notify_summary',
    ]);
    for (const f of rpcs) {
      expect(f[0]).toContain('security definer');
      expect(sql).toMatch(new RegExp(`revoke all on function ${(f[1] as string).replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function ${(f[1] as string).replace('.', '\\.')}\\([^)]*\\) to service_role;`));
    }
    for (const h of ['app.notify_text_ok', 'app.site_notice_link_ok', 'app.site_notice_path_ok']) {
      expect(sql).toMatch(new RegExp(`revoke all on function ${h.replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated, service_role;`));
    }
  });

  it('owner RPCs check the owner FIRST and audit with field names and counts only', () => {
    for (const name of ['admin_save_site_notice', 'admin_publish_site_notice', 'admin_set_notify_settings', 'admin_queue_subscriber_announcement', 'admin_notify_summary']) {
      const body = new RegExp(`function public\\.${name}\\([\\s\\S]*?\\nend;\\n\\$\\$;`).exec(sql)?.[0] ?? '';
      expect(body, name).toMatch(/\nbegin\n  perform app\.require_owner\(p_actor\);/);
    }
    for (const a of [...sql.matchAll(/perform app\.audit\(([\s\S]*?)\);/g)]) expect(a[1]).not.toMatch(/v_title|v_body(?! is (not )?null)|v_email|v_subject|p_record|\.email\b/);
  });

  it('errors use the house prefixes; nothing is switched on; no owner markers', () => {
    for (const m of sql.matchAll(/raise exception '([A-Z_]+):/g)) expect(['INVALID', 'NOT_FOUND', 'STALE']).toContain(m[1]);
    expect(sql).toContain('email_subscribe_open  boolean     not null default false');
    expect(sql).toContain('published     boolean     not null default false');
    expect(raw).not.toContain(['TODO', '(owner)'].join(''));
  });

  it('the confirmation window and the consent notice fit the SQL', () => {
    expect(sql).toContain(`now() + interval '${CONFIRM_TTL_HOURS} hours'`);
    expect(SUBSCRIBE_CONSENT.id).toMatch(/^[a-z][a-z0-9-]{2,60}$/);
    expect(SUBSCRIBE_CONSENT.version).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
  });

  it('the checks run rolled back with fictional data and end with the ok row', () => {
    expect(checks).toContain("raise exception 'ps_rollback';");
    expect(checks.trim().endsWith("select 'ok: 0023_notifications assertions passed' as result;")).toBe(true);
    expect(checks).not.toMatch(/@gmail|powersmash1102/i);
  });
});

describe('endpoints', () => {
  for (const f of ['subscribe', 'confirm', 'unsubscribe']) {
    const src = readFileSync(`src/pages/api/notify/${f}.ts`, 'utf8');
    it(`${f}: on demand, settings only through runtime-env, no process.env`, () => {
      expect(src).toContain('export const prerender = false;');
      expect(src).toContain("from '../../../lib/runtime-env'");
      expect(src).not.toContain('process.env');
    });
  }
  it('the unsubscribe endpoint reads no switch', () => {
    expect(readFileSync('src/pages/api/notify/unsubscribe.ts', 'utf8')).not.toMatch(/SwitchOn|enabled:/);
  });
});

describe('client and server agree on the sign-up fields', () => {
  it('every address the form accepts in these cases is accepted by the server, and the obvious bad ones by neither', () => {
    for (const ok of ['fake.reader@example.test', 'Fake+tag@Example.TEST', 'a.b-c@sub.example.test']) {
      expect(subscribeFieldProblems({ email: ok, consent: true, adult: true })).toEqual({});
      expect(normaliseEmail(ok)).not.toBeNull();
    }
    for (const bad of ['nope', 'a@b', 'a b@example.test', '<a@example.test>', 'a@example.test,b@example.test']) {
      expect(subscribeFieldProblems({ email: bad, consent: true, adult: true }).email).toBeDefined();
      expect(normaliseEmail(bad)).toBeNull();
    }
  });
  it('the constants module stays client-safe (no server import)', () => {
    const src = readFileSync('src/lib/notices/constants.ts', 'utf8');
    expect(src).not.toMatch(/^import /m);
  });
});
