// The notices and email-update admin actions (src/lib/admin/notices/*) over the memory backend and the Supabase backend's RPC calls,
// the zod schemas, and the screen's pure helpers. Fictional data only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMemoryNoticesBackend } from '../../src/lib/admin/notices/memory-backend';
import { NOTICES_ACTION_KINDS, NOTICES_ACTION_NAMES, NOTICES_ACTION_SCHEMAS } from '../../src/lib/admin/notices/schemas';
import { createNoticesService, EMAIL_NOT_READY } from '../../src/lib/admin/notices/service';
import { createSupabaseNoticesBackend, NOTICES_COLUMNS, NOTICES_DETAIL_RPCS } from '../../src/lib/admin/notices/supabase-backend';
import type { Actor } from '../../src/lib/admin/types';
import { EMPTY_NOTICE_FORM, NOTICE_TEXT_HINT, NOTICE_TIMING_HINTS, formOf, noticeInputOf, noticeStatus, summaryLines } from '../../src/admin/screens/notices/logic';

const owner: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
const NOW = new Date('2026-10-31T06:00:00.000Z');
const notice = { title: 'Sample notice', body: null, linkPath: null, linkUrl: null, linkLabel: null, audience: 'public' as const, startsAt: null, endsAt: null };

describe('service over the memory backend', () => {
  it('creates a draft, edits it with the revision, publishes it; a stale revision is refused', async () => {
    const b = createMemoryNoticesBackend({ now: () => NOW });
    const s = createNoticesService(b, { now: () => NOW });
    const c = await s.noticesSave(owner, { ...notice, id: null, expectedRevision: null, reason: 'fake test' });
    expect(c.ok && c.data.created && c.data.revision === 1).toBe(true);
    if (!c.ok) return;
    const e = await s.noticesSave(owner, { ...notice, title: 'Sample notice changed', id: c.data.id, expectedRevision: 1, reason: 'fake test' });
    expect(e.ok && e.data.revision === 2).toBe(true);
    expect(await s.noticesPublish(owner, { id: c.data.id, published: true, expectedRevision: 1, reason: 'fake test' })).toMatchObject({ ok: false, code: 'STALE' });
    expect(await s.noticesPublish(owner, { id: c.data.id, published: true, expectedRevision: 2, reason: 'fake test' })).toMatchObject({ ok: true, data: { published: true, revision: 3 } });
    expect(await s.noticesSave(owner, { ...notice, id: c.data.id, expectedRevision: null, reason: 'fake test' })).toMatchObject({ ok: false, code: 'STALE' });
    expect(b.audit.map((a) => a.action)).toEqual(['create_site_notice', 'update_site_notice', 'publish_site_notice']);
    expect(JSON.stringify(b.audit)).not.toContain('Sample notice');
  });

  it('refuses contact data and bad links with field sentences before the backend is called', async () => {
    const b = createMemoryNoticesBackend();
    const s = createNoticesService(b);
    const r = await s.noticesSave(owner, { ...notice, title: 'Call 910000000000', linkUrl: 'https://wa.me/910000000000', linkLabel: 'Chat', id: null, expectedRevision: null, reason: 'fake test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors ?? {}).sort()).toEqual(['linkUrl', 'title']);
    expect(b.audit).toHaveLength(0);
  });

  it('staff see only published staff notices in their window', async () => {
    const s = createNoticesService(createMemoryNoticesBackend(), { now: () => NOW });
    const r = await s.noticesStaff();
    expect(r.ok && r.data.map((n) => n.title)).toEqual(['Sample staff notice: bring the score sheets to the desk after each match']);
    if (r.ok) expect(Object.keys(r.data[0] ?? {})).not.toContain('audience');
  });

  it('queues an announcement once per id; the text is checked and rendered first', async () => {
    const b = createMemoryNoticesBackend({ activeSubscribers: 4 });
    const s = createNoticesService(b);
    const id = 'c0230000-0000-4000-8000-0000000000a1';
    expect(await s.notifyQueueAnnouncement(owner, { announcementId: id, title: 'Sample news', body: 'Sample text.', reason: 'fake test' })).toEqual({ ok: true, data: { announcementId: id, queued: 4, duplicates: 0 } });
    expect(await s.notifyQueueAnnouncement(owner, { announcementId: id, title: 'Sample news', body: 'Sample text.', reason: 'fake test' })).toEqual({ ok: true, data: { announcementId: id, queued: 0, duplicates: 4 } });
    const bad = await s.notifyQueueAnnouncement(owner, { announcementId: 'c0230000-0000-4000-8000-0000000000a2', title: 'Sample', body: 'Write to fake@example.test', reason: 'fake test' });
    expect(bad).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('Send now explains plainly when email is not set up, and runs the dispatcher when it is', async () => {
    const off = createNoticesService(createMemoryNoticesBackend());
    expect(await off.notifyDispatch(owner)).toEqual({ ok: false, code: 'INVALID', errors: { form: EMAIL_NOT_READY } });
    const summary = { enabled: true, considered: 1, sent: 1, failed: 0, skipped: 0, retrying: 0, raced: 0 };
    const on = createNoticesService(createMemoryNoticesBackend({ emailReady: true, dispatch: async () => summary }));
    expect(await on.notifyDispatch(owner)).toEqual({ ok: true, data: summary });
    const sum = await on.notifySummary(owner);
    expect(sum.ok && sum.data.emailReady).toBe(true);
    expect(JSON.stringify(sum)).not.toMatch(/@/);
  });

  it('switches the sign-up; a repeat changes nothing', async () => {
    const b = createMemoryNoticesBackend();
    const s = createNoticesService(b);
    expect(await s.notifySaveSettings(owner, { emailSubscribeOpen: true, reason: 'fake test' })).toEqual({ ok: true, data: { emailSubscribeOpen: true, fields: ['emailSubscribeOpen'] } });
    expect(await s.notifySaveSettings(owner, { emailSubscribeOpen: true, reason: 'fake test' })).toEqual({ ok: true, data: { emailSubscribeOpen: true, fields: [] } });
  });

  it('a thrown backend error becomes a plain failure', async () => {
    const b = createMemoryNoticesBackend();
    const s = createNoticesService({ ...b, listNotices: async () => Promise.reject(new Error('down')) });
    expect(await s.noticesList()).toEqual({ ok: false, code: 'BACKEND_ERROR' });
  });
});

describe('Supabase backend', () => {
  it('calls only the 0023 owner RPCs with the verified actor, and reads explicit columns', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown>; query?: string }> = [];
    const b = createSupabaseNoticesBackend({
      select: async <T,>(table: string, query: string) => {
        calls.push({ name: table, query });
        return [] as T[];
      },
      rpc: async <T,>(name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {} as T;
      },
    });
    await b.listNotices();
    await b.saveNotice(owner, null, notice, null, 'r1');
    await b.publishNotice(owner, 'n1', true, 2, 'r2');
    await b.summary(owner);
    await b.setSettings(owner, { emailSubscribeOpen: true }, 'r3');
    await b.queueAnnouncement(owner, { announcementId: 'a1', subject: 'S', body: 'B' }, 'r4');
    expect(calls.map((c) => c.name)).toEqual(['site_notices', 'admin_save_site_notice', 'admin_publish_site_notice', 'admin_notify_summary', 'admin_set_notify_settings', 'admin_queue_subscriber_announcement']);
    expect(calls[0]?.query).toBe(`select=${NOTICES_COLUMNS}&order=updated_at.desc,id.asc&limit=1000&offset=0`);
    for (const c of calls.slice(1)) expect(c.args?.p_actor).toBe(owner.userId);
    expect(calls[1]?.args).toMatchObject({ p_id: null, p_expected_revision: null, p_record: { title: 'Sample notice', audience: 'public' } });
    expect(b.emailReady()).toBe(false);
    expect(await b.dispatch()).toBeNull();
    expect([...NOTICES_DETAIL_RPCS]).toEqual(['admin_save_site_notice', 'admin_publish_site_notice', 'admin_set_notify_settings', 'admin_queue_subscriber_announcement']);
  });
});

describe('schemas', () => {
  it('every action has a strict schema and a policy entry; only notices.staff is open to organizers and scorers', () => {
    expect(NOTICES_ACTION_NAMES.sort()).toEqual(Object.keys(NOTICES_ACTION_KINDS).sort());
    for (const n of NOTICES_ACTION_NAMES) {
      expect(NOTICES_ACTION_SCHEMAS[n].safeParse({ unexpected: 1 }).success).toBe(false);
      expect(NOTICES_ACTION_KINDS[n].roles.includes('owner')).toBe(true);
      if (n !== 'notices.staff') expect(NOTICES_ACTION_KINDS[n].roles).toEqual(['owner']);
    }
    expect(NOTICES_ACTION_KINDS['notices.staff']).toEqual({ kind: 'read', roles: ['owner', 'organizer', 'scorer'] });
    expect(NOTICES_ACTION_SCHEMAS['notices.save'].safeParse({ ...notice, id: null, expectedRevision: null, reason: 'fake test' }).success).toBe(true);
    expect(NOTICES_ACTION_SCHEMAS['notify.queueAnnouncement'].safeParse({ announcementId: 'not-a-uuid', title: 'x', body: 'y', reason: 'fake test' }).success).toBe(false);
  });
});

describe('screen helpers', () => {
  it('turns India dates and times into instants, and back', () => {
    const r = noticeInputOf({ ...EMPTY_NOTICE_FORM, title: 'Sample', startDate: '2026-11-14', startTime: '09:30', endDate: '2026-11-15', endTime: '' });
    expect(r).toMatchObject({ ok: true, input: { startsAt: '2026-11-14T09:30:00+05:30', endsAt: '2026-11-15T00:00:00+05:30', linkPath: null, linkUrl: null, linkLabel: null } });
    expect(noticeInputOf({ ...EMPTY_NOTICE_FORM, startTime: '09:30' })).toMatchObject({ ok: false, errors: { startsAt: 'Pick a date.' } });
    const f = formOf({ id: 'x', title: 'T', body: null, linkPath: '/competitions/', linkUrl: null, linkLabel: 'See', audience: 'public', startsAt: '2026-11-14T04:00:00Z', endsAt: null, published: false, publishedAt: null, revision: 1, updatedAt: '' });
    expect(f).toMatchObject({ linkKind: 'page', startDate: '2026-11-14', startTime: '09:30', endDate: '' });
  });

  it('says plainly where a notice stands and what the counts are', () => {
    expect(noticeStatus({ published: false, startsAt: null, endsAt: null, audience: 'public' }, NOW)).toBe('Not published (only you can see it).');
    expect(noticeStatus({ published: true, startsAt: null, endsAt: null, audience: 'public' }, NOW)).toContain('next site update');
    expect(noticeStatus({ published: true, startsAt: null, endsAt: '2026-10-30T00:00:00Z', audience: 'staff' }, NOW)).toMatch(/^Ended /);
    const lines = summaryLines({ emailSubscribeOpen: false, subscribers: { pending: 1, active: 2, unsubscribed: 3 }, outbox: { queued: 4, sending: 1, sent: 6, failed: 0, skipped: 2 }, emailReady: false });
    expect(lines.join(' ')).toContain('Confirmed subscribers: 2');
    expect(lines.join(' ')).toContain('Emails waiting to go: 5');
    expect(lines[3]).toContain('not set up');
  });
});

describe('the notice form tells the owner how the times really work (static pages, D-125)', () => {
  it('never promises a notice starts or ends by itself; says to press Publish now; asks not to name players', () => {
    const all = Object.values(NOTICE_TIMING_HINTS).join(' ');
    expect(all).not.toMatch(/as soon as it is published/);
    expect(all).toMatch(/Publish now/);
    expect(NOTICE_TIMING_HINTS.end).toMatch(/first site update after this time/);
    expect(NOTICE_TEXT_HINT).toMatch(/do not name players/);
    const src = readFileSync(new URL('../../src/admin/screens/notices/Notices.tsx', import.meta.url), 'utf8');
    expect(src).toContain('NOTICE_TIMING_HINTS.note');
    expect(src).not.toContain('Empty = as soon as it is published');
  });
});
