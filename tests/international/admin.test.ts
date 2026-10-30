// The international events admin (D-112): the service over the memory backend (owner only, plain-English field errors, tracking
// removed, revisions, hide and show, the owner's hosts), the Supabase backend over mocked select/rpc (explicit columns, the 0022 RPC
// names and arguments, the verified actor id), and the zod schemas. Fictional data only.
import { describe, expect, it } from 'vitest';
import { createMemoryInternationalBackend, seedInternationalData, type MemoryInternationalAudit } from '../../src/lib/admin/international/memory-backend';
import { INTERNATIONAL_ACTION_KINDS, INTERNATIONAL_ACTION_NAMES, INTERNATIONAL_ACTION_SCHEMAS, INTERNATIONAL_RPCS } from '../../src/lib/admin/international/schemas';
import { createInternationalService } from '../../src/lib/admin/international/service';
import { INTERNATIONAL_ADMIN_COLUMNS, createSupabaseInternationalBackend } from '../../src/lib/admin/international/supabase-backend';
import type { InternationalSaveInput } from '../../src/lib/admin/international/types';
import type { StoreResult } from '../../src/lib/admin/types';

const OWNER = { userId: '9c000000-0000-4000-8000-000000000001', role: 'owner' as const };
const EDITOR = { userId: '9c000000-0000-4000-8000-000000000002', role: 'editor' as const };
const NOW = new Date('2026-10-31T04:00:00.000Z');

function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code} ${JSON.stringify(r.errors ?? {})}`);
  return r.data;
}

function setup() {
  const audit: MemoryInternationalAudit[] = [];
  const backend = createMemoryInternationalBackend({ data: seedInternationalData(), audit: (a) => audit.push(a), now: () => NOW });
  return { backend, audit, svc: createInternationalService(backend) };
}

const input = (over: Partial<InternationalSaveInput> = {}): InternationalSaveInput => ({
  id: null, expectedRevision: null, name: 'Sample Grand Prix 2027', levelText: 'Sample level 300', startDate: '2027-01-12', endDate: '2027-01-17', city: 'Sample City',
  country: 'Demo Country', officialUrl: 'https://bwfbadminton.com/x/?id=3&utm_source=newsletter#top', published: true, reason: 'adding a sample event', ...over,
});

describe('the service over the memory backend', () => {
  it('lists events newest first with the allow-list state and the settings', async () => {
    const { svc } = setup();
    const list = ok(await svc.internationalList());
    expect(list.events.map((e) => e.name)).toEqual(['Demo Masters 2026', 'Sample World Open 2026', 'Mock Team Cup 2026']);
    expect(list.events.every((e) => e.onAllowList)).toBe(true);
    expect(list.events[0]?.host).toBe('tournamentsoftware.com');
    expect(list.settings).toEqual({ defaultHosts: ['bwfbadminton.com', 'tournamentsoftware.com', 'bwf.tournamentsoftware.com'], extraHosts: [] });
  });

  it('adds an event: the link is cleaned and the audit holds field names only', async () => {
    const { svc, backend, audit } = setup();
    const r = ok(await svc.internationalSave(OWNER, input()));
    expect(r).toMatchObject({ created: true, revision: 1, removedTracking: true });
    const stored = backend.data.events.find((e) => e.id === r.id);
    expect(stored?.officialUrl).toBe('https://bwfbadminton.com/x/?id=3');
    expect(audit.at(-1)?.action).toBe('create_international_event');
    expect(JSON.stringify(audit)).not.toMatch(/Sample Grand Prix|bwfbadminton|Sample City/);
  });

  it('refuses a bad form with a sentence beside each field, before calling the database', async () => {
    const { svc, backend } = setup();
    const before = backend.data.events.length;
    const r = await svc.internationalSave(OWNER, input({ officialUrl: 'https://bwfbadminton.com.evil.test/', endDate: '2027-01-01', name: 'x' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('INVALID');
      expect(Object.keys(r.errors ?? {}).sort()).toEqual(['endDate', 'name', 'officialUrl']);
      expect(r.errors?.officialUrl).toMatch(/must be on bwfbadminton\.com/);
    }
    expect(backend.data.events.length).toBe(before);
    for (const bad of ['https://user@bwfbadminton.com/', 'https://bwfbadminton.com:8443/', 'https://xn--bwfbdminton-q9a.com/']) {
      const x = await svc.internationalSave(OWNER, input({ officialUrl: bad }));
      expect(x.ok, bad).toBe(false);
    }
  });

  it('owner only; a revision mismatch is STALE; a missing event NOT_FOUND; id and revision come together', async () => {
    const { svc } = setup();
    expect((await svc.internationalSave(EDITOR, input())).ok).toBe(false);
    const e = ok(await svc.internationalList()).events[0]!;
    const stale = await svc.internationalSave(OWNER, input({ id: e.id, expectedRevision: e.revision + 5 }));
    expect(!stale.ok && stale.code).toBe('STALE');
    const missing = await svc.internationalSave(OWNER, input({ id: '9f000000-0000-4000-8000-000000000999', expectedRevision: 1 }));
    expect(!missing.ok && missing.code).toBe('NOT_FOUND');
    const mixed = await svc.internationalSave(OWNER, input({ id: e.id, expectedRevision: null }));
    expect(!mixed.ok && mixed.code).toBe('INVALID');
  });

  it('edits only what changed and bumps the revision', async () => {
    const { svc } = setup();
    const e = ok(await svc.internationalList()).events.find((x) => x.name === 'Sample World Open 2026')!;
    const same = ok(await svc.internationalSave(OWNER, { ...input(), id: e.id, expectedRevision: e.revision, name: e.name, levelText: e.levelText ?? '', startDate: e.startDate, endDate: e.endDate, city: e.city ?? '', country: e.country, officialUrl: e.officialUrl, published: e.published }));
    expect(same).toMatchObject({ fields: [], revision: 1 });
    const changed = ok(await svc.internationalSave(OWNER, { ...input(), id: e.id, expectedRevision: e.revision, name: e.name, levelText: e.levelText ?? '', startDate: e.startDate, endDate: e.endDate, city: 'Sample Other City', country: e.country, officialUrl: e.officialUrl, published: e.published }));
    expect(changed).toMatchObject({ fields: ['city'], revision: 2 });
  });

  it('hides and shows; showing re-checks the link against today\'s list', async () => {
    const { svc } = setup();
    ok(await svc.internationalSaveHosts(OWNER, { hosts: ['example.org'], reason: 'an organiser site' }));
    const added = ok(await svc.internationalSave(OWNER, input({ officialUrl: 'https://www.example.org/event/', published: true })));
    const hosts = ok(await svc.internationalSaveHosts(OWNER, { hosts: [], reason: 'removing it again' }));
    expect(hosts).toEqual({ hosts: [], fields: ['extra_hosts'], eventsOffList: 1 });
    const listed = ok(await svc.internationalList()).events.find((e) => e.id === added.id)!;
    expect(listed.onAllowList).toBe(false);
    const hidden = ok(await svc.internationalSetPublished(OWNER, { id: added.id, published: false, expectedRevision: listed.revision, reason: 'hide it' }));
    expect(hidden).toMatchObject({ published: false, changed: true });
    const show = await svc.internationalSetPublished(OWNER, { id: added.id, published: true, expectedRevision: hidden.revision, reason: 'show it' });
    expect(show.ok).toBe(false);
    if (!show.ok) expect(show.errors?.form).toMatch(/not on an allowed website any more/);
    const again = ok(await svc.internationalSetPublished(OWNER, { id: added.id, published: false, expectedRevision: hidden.revision, reason: 'hide again' }));
    expect(again.changed).toBe(false);
  });

  it('the hosts box: cleaned, defaults dropped, shorteners refused in plain English', async () => {
    const { svc, audit } = setup();
    const r = ok(await svc.internationalSaveHosts(OWNER, { hosts: ['https://www.Example.org/x', 'bwfbadminton.com', 'example.net'], reason: 'two organiser sites' }));
    expect(r.hosts).toEqual(['example.net', 'example.org']);
    const bad = await svc.internationalSaveHosts(OWNER, { hosts: ['bit.ly'], reason: 'a shortener' });
    expect(!bad.ok && bad.errors?.hosts).toMatch(/shorteners/);
    const same = ok(await svc.internationalSaveHosts(OWNER, { hosts: ['example.org', 'example.net'], reason: 'no change' }));
    expect(same.fields).toEqual([]);
    expect(audit.filter((a) => a.action === 'set_international_hosts')).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/example\./);
    expect((await svc.internationalSaveHosts(EDITOR, { hosts: [], reason: 'not the owner' })).ok).toBe(false);
  });

  it('a database error never leaks: unknown errors become BACKEND_ERROR', async () => {
    const svc = createInternationalService({
      listEvents: async () => { throw new Error('connection details 910000000000'); },
      getExtraHosts: async () => [],
      saveEvent: async () => { throw Object.assign(new Error('x'), { code: 'INVALID', detail: 'The official link must not name a port' }); },
      setPublished: async () => { throw new Error('boom'); },
      setHosts: async () => { throw new Error('boom'); },
    });
    const l = await svc.internationalList();
    expect(l).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    const s = await svc.internationalSave(OWNER, input());
    expect(s).toEqual({ ok: false, code: 'INVALID', errors: { form: 'The official link must not name a port' } });
  });
});

describe('the Supabase backend (mocked)', () => {
  it('reads explicit columns, pages, and calls the 0022 RPCs with the verified actor id', async () => {
    const selects: Array<[string, string]> = [];
    const rpcs: Array<[string, Record<string, unknown>]> = [];
    const backend = createSupabaseInternationalBackend({
      select: async <T,>(table: string, query: string) => {
        selects.push([table, query]);
        if (table === 'international_settings') return [{ extra_hosts: ['example.org', 7] }] as T[];
        return [{ id: 'x', name: 'Sample', level_text: null, start_date: '2026-11-01', end_date: '2026-11-02', city: null, country: 'Demo Country', official_url: 'https://bwfbadminton.com/', published: true, revision: 2, created_at: 'a', updated_at: 'b' }] as T[];
      },
      rpc: async <T,>(name: string, args: Record<string, unknown>) => {
        rpcs.push([name, args]);
        return { id: 'x', created: false, revision: 3, fields: [] } as T;
      },
    });
    const rows = await backend.listEvents();
    expect(rows[0]).toMatchObject({ levelText: null, startDate: '2026-11-01', officialUrl: 'https://bwfbadminton.com/', published: true, revision: 2 });
    expect(await backend.getExtraHosts()).toEqual(['example.org']);
    expect(selects[0]).toEqual(['international_events', `select=${INTERNATIONAL_ADMIN_COLUMNS.international_events}&order=start_date.desc,id.asc&limit=1000&offset=0`]);
    expect(selects.every(([, q]) => !q.includes('*'))).toBe(true);
    const rec = { name: 'Sample', levelText: null, startDate: '2026-11-01', endDate: '2026-11-02', city: null, country: 'Demo Country', officialUrl: 'https://bwfbadminton.com/', published: true };
    await backend.saveEvent(OWNER, null, rec, null, 'r1');
    await backend.setPublished(OWNER, 'x', false, 2, 'r2');
    await backend.setHosts(OWNER, ['example.org'], 'r3');
    expect(rpcs).toEqual([
      ['admin_save_international_event', { p_actor: OWNER.userId, p_id: null, p_record: rec, p_expected_revision: null, p_reason: 'r1' }],
      ['admin_set_international_event_published', { p_actor: OWNER.userId, p_id: 'x', p_published: false, p_expected_revision: 2, p_reason: 'r2' }],
      ['admin_set_international_hosts', { p_actor: OWNER.userId, p_hosts: ['example.org'], p_reason: 'r3' }],
    ]);
    expect(rpcs.map(([n]) => n)).toEqual([...INTERNATIONAL_RPCS]);
  });
});

describe('the zod schemas', () => {
  it('names, kinds and strictness', () => {
    expect(INTERNATIONAL_ACTION_NAMES).toEqual(['international.list', 'international.save', 'international.setPublished', 'international.saveHosts']);
    expect(INTERNATIONAL_ACTION_KINDS['international.list']).toBe('read');
    expect(Object.values(INTERNATIONAL_ACTION_KINDS).filter((k) => k === 'write')).toHaveLength(3);
    const s = INTERNATIONAL_ACTION_SCHEMAS['international.save'];
    expect(s.safeParse(input()).success).toBe(true);
    expect(s.safeParse({ ...input(), phone: '910000000000' }).success).toBe(false);
    expect(s.safeParse({ ...input(), reason: 'x' }).success).toBe(false);
    expect(s.safeParse({ ...input(), id: 'not-a-uuid' }).success).toBe(false);
    expect(INTERNATIONAL_ACTION_SCHEMAS['international.saveHosts'].safeParse({ hosts: Array.from({ length: 41 }, () => 'a.org'), reason: 'too many' }).success).toBe(false);
    expect(INTERNATIONAL_ACTION_SCHEMAS['international.setPublished'].safeParse({ id: OWNER.userId, published: true, expectedRevision: 0, reason: 'zero' }).success).toBe(false);
  });
});
