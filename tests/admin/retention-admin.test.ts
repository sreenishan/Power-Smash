// The keep-for periods in the admin (migration 0025, D-028, D-127): owner only through the handler, both periods empty at the start,
// the shared input check, counts only in the summary, and the Supabase backend calling the two owner RPCs with the verified actor.
import { describe, expect, it } from 'vitest';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import { createMemoryRetentionBackend, createRetentionService, createSupabaseRetentionBackend, parseRetentionSummary } from '../../src/lib/admin/retention/service';
import type { Actor } from '../../src/lib/admin/types';
import { CONTACT_REMOVED_TEXT, isWaiting, nextSteps } from '../../src/admin/screens/registrations/logic';
import { checkRetentionForm, currentPeriodText, dueNowLines, retentionFormChanged, retentionFormFrom, retentionSavedText } from '../../src/admin/screens/retention-logic';
import { RETENTION_RPCS } from '../../src/lib/retention/schemas';
import { authDeps, EDITOR_ID, makeHandler, makeKeys, OWNER_ID, req, signToken } from './_helpers';
import { readFileSync } from 'node:fs';

const OWNER: Actor = { userId: OWNER_ID, role: 'owner' };
const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; data?: any; errors?: Record<string, string> };

const dueNow = (over: Record<string, unknown> = {}) => ({
  dry_run: true,
  registration_keep_days: null,
  subscriber_keep_days: null,
  registrations_anonymised: 0,
  registrations_deleted: 0,
  registrations_without_event_date: 0,
  subscribers_unconfirmed_deleted: 0,
  subscribers_unsubscribed_deleted: 0,
  unsubscribe_hashes_kept: 0,
  outbox_rows_removed: 0,
  ...over,
});

describe('retention actions: policy and handler', () => {
  it('both actions are owner only at aal2', () => {
    for (const a of ['retention.summary', 'retention.save'] as const) {
      expect(ADMIN_ACTIONS[a].roles).toEqual(['owner']);
      expect(ADMIN_ACTIONS[a].requiresAal2).toBe(true);
    }
    expect(ADMIN_ACTIONS['retention.summary'].kind).toBe('read');
    expect(ADMIN_ACTIONS['retention.save'].kind).toBe('write');
  });

  it('the owner reads empty periods, saves, and reads them back; an editor is refused', async () => {
    const keys = await makeKeys();
    const h = makeHandler(keys, { auth: authDeps(keys, { editorsEnabled: true }) });
    const owner = await signToken(keys, { sub: OWNER_ID });
    const first = await json(await h.handle(req('retention.summary', owner), 'retention.summary'));
    expect(first.ok).toBe(true);
    expect(first.data.registrationKeepDays).toBeNull();
    expect(first.data.subscriberKeepDays).toBeNull();
    expect(first.data.keepUnsubscribeHash).toBe(false);
    expect(first.data.dueNow.dryRun).toBe(true);
    const saved = await json(await h.handle(req('retention.save', owner, { registrationKeepDays: 400, subscriberKeepDays: null, keepUnsubscribeHash: false, reason: 'fake lawyer advice' }), 'retention.save'));
    expect(saved.ok).toBe(true);
    expect(saved.data.fields).toEqual(['registrationKeepDays']);
    const again = await json(await h.handle(req('retention.summary', owner), 'retention.summary'));
    expect(again.data.registrationKeepDays).toBe(400);
    const editor = await signToken(keys, { sub: EDITOR_ID });
    const refused = await h.handle(req('retention.save', editor, { registrationKeepDays: 30, subscriberKeepDays: null, keepUnsubscribeHash: false, reason: 'fake reason' }), 'retention.save');
    expect(refused.status).toBe(403);
  });

  it('refuses a period outside the limits, a missing key or an extra key (strict schema)', async () => {
    const keys = await makeKeys();
    const h = makeHandler(keys);
    const owner = await signToken(keys, { sub: OWNER_ID });
    for (const body of [
      { registrationKeepDays: 6, subscriberKeepDays: null, reason: 'fake reason' },
      { registrationKeepDays: null, subscriberKeepDays: 3651, reason: 'fake reason' },
      { registrationKeepDays: 1.5, subscriberKeepDays: null, reason: 'fake reason' },
      { registrationKeepDays: null, reason: 'fake reason' },
      { registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false, reason: 'fake reason', runNow: true },
      { registrationKeepDays: null, subscriberKeepDays: null, reason: 'fake reason' },
    ]) {
      const r = await h.handle(req('retention.save', owner, body), 'retention.save');
      expect(r.status).toBe(400);
    }
  });
});

describe('retention service', () => {
  it('starts with both periods empty and every count 0 (memory)', async () => {
    const s = createRetentionService(createMemoryRetentionBackend());
    const r = await s.retentionSummary(OWNER);
    expect(r.ok && r.data.registrationKeepDays).toBeNull();
    expect(r.ok && r.data.subscriberKeepDays).toBeNull();
    expect(r.ok && r.data.keepUnsubscribeHash).toBe(false);
    expect(r.ok && Object.values(r.data.dueNow.counts).every((n) => n === 0)).toBe(true);
  });

  it('refuses a non-owner and a short reason; audits field names and numbers only', async () => {
    const audits: unknown[] = [];
    const s = createRetentionService(createMemoryRetentionBackend({ audit: (e) => audits.push(e) }));
    const org = await s.retentionSave({ userId: 'x', role: 'organizer' }, { registrationKeepDays: 30, subscriberKeepDays: 30, keepUnsubscribeHash: false, reason: 'fake reason' });
    expect(org.ok).toBe(false);
    expect(!org.ok && org.code).toBe('FORBIDDEN');
    const short = await s.retentionSave(OWNER, { registrationKeepDays: 30, subscriberKeepDays: 30, keepUnsubscribeHash: false, reason: 'x' });
    expect(!short.ok && short.code).toBe('INVALID');
    const ok = await s.retentionSave(OWNER, { registrationKeepDays: 30, subscriberKeepDays: 10, keepUnsubscribeHash: false, reason: 'fake reason' });
    expect(ok.ok && ok.data.fields).toEqual(['registrationKeepDays', 'subscriberKeepDays']);
    expect(audits).toEqual([{ actor: OWNER_ID, action: 'set_platform_retention', diff: { fields: ['registrationKeepDays', 'subscriberKeepDays'], registration_keep_days: 30, subscriber_keep_days: 10, keep_unsubscribe_hash: false }, reason: 'fake reason' }]);
    const same = await s.retentionSave(OWNER, { registrationKeepDays: 30, subscriberKeepDays: 10, keepUnsubscribeHash: false, reason: 'fake reason' });
    expect(same.ok && same.data.fields).toEqual([]);
    expect(audits).toHaveLength(1);
    const hash = await s.retentionSave(OWNER, { registrationKeepDays: 30, subscriberKeepDays: 10, keepUnsubscribeHash: true, reason: 'fake lawyer yes' });
    expect(hash.ok && hash.data.fields).toEqual(['keepUnsubscribeHash']);
    const notBool = await s.retentionSave(OWNER, { registrationKeepDays: 30, subscriberKeepDays: 10, keepUnsubscribeHash: 'yes' as unknown as boolean, reason: 'fake reason' });
    expect(!notBool.ok && notBool.code).toBe('INVALID');
    const cleared = await s.retentionSave(OWNER, { registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false, reason: 'fake reason' });
    expect(cleared.ok && cleared.data.registrationKeepDays).toBeNull();
  });

  it('refuses the shared limits before the database (one plain sentence)', async () => {
    const s = createRetentionService(createMemoryRetentionBackend());
    const r = await s.retentionSave(OWNER, { registrationKeepDays: 3, subscriberKeepDays: null, keepUnsubscribeHash: false, reason: 'fake reason' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors?.form).toMatch(/from 7 to 3650/);
  });

  it('reads only counts from the summary RPC: an unknown key or a text value is a backend error, never shown', () => {
    const good = { registrationKeepDays: 30, subscriberKeepDays: null, keepUnsubscribeHash: false, updatedAt: '2026-10-31T00:00:00Z', dueNow: dueNow({ registration_keep_days: 30, registrations_deleted: 2 }), unsubscribeHashesKept: 3 };
    expect(parseRetentionSummary(good).dueNow.counts.registrations_deleted).toBe(2);
    expect(() => parseRetentionSummary({ ...good, dueNow: dueNow({ email: 'someone@example.test' }) })).toThrow();
    expect(() => parseRetentionSummary({ ...good, unsubscribeHashesKept: 'abc' })).toThrow();
    expect(() => parseRetentionSummary({ ...good, registrationKeepDays: 0 })).toThrow();
    expect(() => parseRetentionSummary({ ...good, keepUnsubscribeHash: undefined })).toThrow();
    expect(() => parseRetentionSummary(null)).toThrow();
  });

  it('the Supabase backend calls the two owner RPCs with the verified actor and every key present', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
      calls.push({ name, args });
      if (name === 'admin_platform_retention_summary') return { registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false, updatedAt: null, dueNow: dueNow(), unsubscribeHashesKept: 0 } as T;
      return { registrationKeepDays: 365, subscriberKeepDays: null, keepUnsubscribeHash: false, fields: ['registrationKeepDays'] } as T;
    };
    const s = createRetentionService(createSupabaseRetentionBackend({ rpc }));
    expect((await s.retentionSummary(OWNER)).ok).toBe(true);
    const r = await s.retentionSave(OWNER, { registrationKeepDays: 365, subscriberKeepDays: null, keepUnsubscribeHash: false, reason: ' fake reason ' });
    expect(r.ok && r.data.fields).toEqual(['registrationKeepDays']);
    expect(calls).toEqual([
      { name: 'admin_platform_retention_summary', args: { p_actor: OWNER_ID } },
      { name: 'admin_set_platform_retention', args: { p_actor: OWNER_ID, p_record: { registrationKeepDays: 365, subscriberKeepDays: null, keepUnsubscribeHash: false }, p_reason: 'fake reason' } },
    ]);
    expect([...RETENTION_RPCS].sort()).toEqual(['admin_platform_retention_summary', 'admin_set_platform_retention']);
  });

  it('the Supabase store lets the 0025 sentences reach the owner', () => {
    const src = readFileSync('src/lib/admin/supabase-store.ts', 'utf8');
    expect(src).toMatch(/\.\.\.RETENTION_RPCS/);
    expect(src).toMatch(/createRetentionService\(createSupabaseRetentionBackend/);
  });
});

describe('retention settings card (pure helpers)', () => {
  it('starts the boxes from the saved value and never from a suggested number', () => {
    expect(retentionFormFrom({ registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false })).toEqual({ registrationKeepDays: '', subscriberKeepDays: '', keepUnsubscribeHash: false });
    expect(retentionFormFrom({ registrationKeepDays: 90, subscriberKeepDays: 1, keepUnsubscribeHash: true })).toEqual({ registrationKeepDays: '90', subscriberKeepDays: '1', keepUnsubscribeHash: true });
    const src = readFileSync('src/admin/screens/Settings.tsx', 'utf8');
    expect(src).not.toMatch(/placeholder=/);
  });

  it('checks the boxes with the shared rule and notices a change', () => {
    expect(checkRetentionForm({ registrationKeepDays: '', subscriberKeepDays: ' ', keepUnsubscribeHash: false })).toEqual({ ok: true, value: { registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false } });
    expect(checkRetentionForm({ registrationKeepDays: 'abc', subscriberKeepDays: '', keepUnsubscribeHash: false }).ok).toBe(false);
    const saved = { registrationKeepDays: 30, subscriberKeepDays: null, keepUnsubscribeHash: false };
    expect(retentionFormChanged({ registrationKeepDays: '30', subscriberKeepDays: '', keepUnsubscribeHash: false }, saved)).toBe(false);
    expect(retentionFormChanged({ registrationKeepDays: '31', subscriberKeepDays: '', keepUnsubscribeHash: false }, saved)).toBe(true);
    expect(retentionFormChanged({ registrationKeepDays: '30', subscriberKeepDays: '', keepUnsubscribeHash: true }, saved)).toBe(true);
  });

  it('says plainly what is set and what the next clean-up would do', () => {
    expect(currentPeriodText(null)).toBe('Now: not set, so nothing is removed');
    expect(currentPeriodText(30)).toBe('Now: 30 days');
    const lines = dueNowLines(parseRetentionSummary({ registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false, updatedAt: null, dueNow: dueNow(), unsubscribeHashesKept: 2 }));
    expect(lines[0]).toBe('Preview only: nothing was changed.');
    expect(lines.at(-2)).toBe('Removed unsubscribed addresses are not remembered (the box below is unticked).');
    expect(lines.at(-1)).toBe('Removed unsubscribed addresses remembered as a code so far: 2.');
    // no double colons or jargon for the owner
    for (const l of [...lines, currentPeriodText(null)]) expect(l).not.toMatch(/:[^:]*:|[Ss]crambled|hash/);
    expect(lines.join(' ')).not.toMatch(/@|\d{7,}/);
    expect(retentionSavedText([])).toBe('Nothing changed.');
    expect(retentionSavedText(['subscriberKeepDays'])).toMatch(/^Saved\./);
  });

  it('a cleared registration is closed: out of the waiting list, with no verify, convert or reject buttons', () => {
    const cleared = { status: 'payment_verified' as const, needsVerification: false, anonymisedAt: '2026-10-01T00:00:00Z' };
    expect(isWaiting(cleared)).toBe(false);
    expect(nextSteps(cleared)).toEqual({ verify: false, convert: false, reject: false });
    expect(isWaiting({ status: 'payment_verified', anonymisedAt: null })).toBe(true);
    expect(nextSteps({ status: 'payment_verified', needsVerification: false })).toEqual({ verify: true, convert: true, reject: true });
    const src = readFileSync('src/admin/screens/registrations/Registrations.tsx', 'utf8');
    expect(src).toMatch(/filter\(\(r\) => isWaiting\(r\)\)/);
  });

  it('a registration cleared by the keep-for period shows a plain note instead of the phone', () => {
    expect(CONTACT_REMOVED_TEXT).toBe('Contact details removed after the keep-for period');
    const src = readFileSync('src/admin/screens/registrations/Registrations.tsx', 'utf8');
    expect(src).toMatch(/r\.phone === null \|\| r\.anonymisedAt/);
    const backend = readFileSync('src/lib/admin/registration/supabase-backend.ts', 'utf8');
    expect(backend).toMatch(/created_at,anonymised_at/);
    expect(backend).toMatch(/contact_phone: string \| null/);
  });
});
