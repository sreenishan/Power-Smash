// An organizer's tournament submission added to the tournament list (0015, D-103): the shared rule, the memory store through the real
// handler, and the Supabase store with a fake PostgREST. Fictional organizers, places and tournaments only.
import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/admin/memory-store';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import { candidateFromSubmission, isTamilNaduDistrict, slugOptionsFor, SUBMISSION_MESSAGES, submissionPreview } from '../../src/lib/admin/submission-candidate';
import { createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { EDITOR_ID, makeHandler, makeKeys, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; errors?: Record<string, string>; data?: any };
const none = () => false;
const PAYLOAD = { tournamentName: 'Demo Shuttle Open 2026', startDate: '2026-12-05', endDate: '2026-12-06', venue: 'Demo Indoor Hall', city: 'Coimbatore', district: 'Coimbatore' };

async function setup() {
  const keys = await makeKeys();
  const h = makeHandler(keys);
  const token = await signToken(keys);
  return { ...h, keys, call: (action: string, body: unknown = {}, t = token) => h.handle(req(action, t, body), action) };
}

describe('the submission rule (shared by both stores)', () => {
  it('takes only the tournament fields; the year comes from the first day; a Tamil Nadu district makes the region tamil_nadu', () => {
    const r = candidateFromSubmission({ ...PAYLOAD, phone: '910000000000', email: 'organizer@example.test', name: 'Demo Secretary' } as never, none);
    expect(r).toEqual({
      ok: true,
      record: { slug: 'demo-shuttle-open-2026-coimbatore', name: 'Demo Shuttle Open 2026', seriesKey: expect.any(String), editionYear: 2026, region: 'tamil_nadu', city: 'Coimbatore', district: 'Coimbatore', venue: 'Demo Indoor Hall', startDate: '2026-12-05', endDate: '2026-12-06' },
      dropped: [],
    });
    if (r.ok) {
      expect(Object.keys(r.record).sort()).toEqual(['city', 'district', 'editionYear', 'endDate', 'name', 'region', 'seriesKey', 'slug', 'startDate', 'venue']);
      expect(JSON.stringify(r)).not.toMatch(/910000000000|example\.test|Secretary/);
      expect(r.record.seriesKey).not.toMatch(/2026/);
    }
  });
  it('the region is tamil_nadu only for a Tamil Nadu district (informal spellings count); otherwise unknown, never international', () => {
    expect(isTamilNaduDistrict('Kovai')).toBe(true);
    expect(isTamilNaduDistrict('Bengaluru')).toBe(false);
    expect(isTamilNaduDistrict(null)).toBe(false);
    const region = (p: object) => { const r = candidateFromSubmission({ ...PAYLOAD, ...p }, none); return r.ok ? r.record.region : null; };
    expect(region({ district: 'Bengaluru', city: 'Bengaluru' })).toBe('unknown');
    expect(region({ district: null, city: 'Madurai' })).toBe('tamil_nadu');
    expect(region({ district: 'Nowhere Fake', city: 'Madurai' })).toBe('unknown'); // a stated district that is not in Tamil Nadu wins
    expect(region({ district: 'London', city: 'London' })).toBe('unknown');
  });
  it('leaves a refused field empty and names it; only an unusable name stops the candidate', () => {
    const r = candidateFromSubmission({ ...PAYLOAD, venue: 'v'.repeat(161), startDate: '2026-12-09', endDate: '2026-12-01', city: 'Demo\ncity' }, none);
    expect(r.ok && r.dropped.sort()).toEqual(['city', 'endDate', 'venue']);
    expect(r.ok && r.record.endDate).toBeNull();
    expect(candidateFromSubmission({ ...PAYLOAD, startDate: '2026-02-30' }, none)).toMatchObject({ ok: true, record: { startDate: null, editionYear: null }, dropped: ['startDate'] });
    expect(candidateFromSubmission({ ...PAYLOAD, tournamentName: ' x ' }, none)).toEqual({ ok: false, reason: 'NO_NAME' });
    expect(candidateFromSubmission({ ...PAYLOAD, tournamentName: 42 }, none)).toEqual({ ok: false, reason: 'NO_NAME' });
    expect(candidateFromSubmission({ ...PAYLOAD, tournamentName: 'பூப்பந்து போட்டி' }, none)).toEqual({ ok: false, reason: 'NO_SLUG' });
  });
  it('takes the first free address and never a reserved one', () => {
    const taken = new Set(['demo-shuttle-open-2026-coimbatore', 'demo-shuttle-open-2026-coimbatore-2']);
    const r = candidateFromSubmission(PAYLOAD, (s) => taken.has(s));
    expect(r.ok && r.record.slug).toBe('demo-shuttle-open-2026-coimbatore-3');
    expect(candidateFromSubmission({ tournamentName: 'Submit' }, none)).toMatchObject({ ok: true, record: { slug: 'submit-2' } });
  });
  it('a long name still gets an address (clipped like the sync); the store asks about exactly the addresses the rule tries', () => {
    const long = { ...PAYLOAD, tournamentName: `Demo ${'Shuttle '.repeat(13)}Open` };
    expect(long.tournamentName.length).toBeGreaterThan(100);
    const r = candidateFromSubmission(long, none);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.slug.length).toBeLessThanOrEqual(96);
    expect(r.record.slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    const options = slugOptionsFor(long);
    expect(options[0]).toBe(r.record.slug);
    // every address the rule tries is in the list the store reads, so a taken one is never missed
    const taken = new Set(options.slice(0, 4));
    const r2 = candidateFromSubmission(long, (s) => taken.has(s));
    expect(r2.ok && r2.record.slug).toBe(options[4]);
    expect(slugOptionsFor({ tournamentName: 'Submit' })).toEqual(['submit-2', 'submit-3', 'submit-4', 'submit-5', 'submit-6', 'submit-7', 'submit-8', 'submit-9']);
  });
  it('when every address is taken, the message says so (not "needs Latin letters")', () => {
    expect(candidateFromSubmission(PAYLOAD, () => true)).toEqual({ ok: false, reason: 'NO_FREE_SLUG' });
    expect(SUBMISSION_MESSAGES.NO_FREE_SLUG).not.toMatch(/Latin/);
  });
  it('the preview says why the button is off', () => {
    const lead = { id: 'x', refCode: 'PS-2026-DEMO99', payload: PAYLOAD };
    expect(submissionPreview(lead, { addedAs: { tournamentId: 't' }, slugTaken: none, isDuplicate: none }).problem).toBe(SUBMISSION_MESSAGES.added);
    expect(submissionPreview(lead, { addedAs: null, slugTaken: none, isDuplicate: () => true }).problem).toBe(SUBMISSION_MESSAGES.duplicate);
    expect(submissionPreview({ ...lead, payload: {} }, { addedAs: null, slugTaken: none, isDuplicate: none }).problem).toBe(SUBMISSION_MESSAGES.NO_NAME);
    expect(submissionPreview(lead, { addedAs: null, slugTaken: none, isDuplicate: none }).problem).toBeNull();
  });
});

describe('memory store through the handler', () => {
  it('both actions are owner-only, and adding is audited', () => {
    expect(ADMIN_ACTIONS['tournaments.previewSubmission']).toMatchObject({ kind: 'read', roles: ['owner'], requiresAal2: true });
    expect(ADMIN_ACTIONS['tournaments.addSubmission']).toMatchObject({ kind: 'write', roles: ['owner'], requiresAal2: true, audited: true });
  });

  it('adds the organizer submission as a pending, hidden "submitted" candidate, once, with no contact data in the audit', async () => {
    const s = await setup();
    const p = (await json(await s.call('tournaments.previewSubmission', { leadId: SEED.l4 }))).data;
    expect(p).toMatchObject({ leadId: SEED.l4, refCode: 'PS-2026-DEMK04', problem: null, addedAs: null, record: { name: 'Demo Shuttle Open 2026', region: 'tamil_nadu' } });
    const r = await s.call('tournaments.addSubmission', { leadId: SEED.l4, reason: 'Organizer submission added by owner' });
    expect(r.status).toBe(200);
    const { tournamentId, slug } = (await json(r)).data;
    expect(slug).toBe('demo-shuttle-open-2026-coimbatore');
    const cand = (await json(await s.call('tournaments.candidates'))).data.find((t: { id: string }) => t.id === tournamentId);
    expect(cand).toMatchObject({ source: 'submitted', status: 'pending', visibility: 'hidden', region: 'tamil_nadu', isPromoted: false });
    expect((await json(await s.call('tournaments.details', { id: tournamentId }))).data).toMatchObject({ venue: 'Demo Indoor Hall', startDate: '2026-12-05', categories: [] });
    expect(JSON.stringify(s.store.state.audit)).not.toMatch(/910000000000|Demo Club Secretary/);
    expect(s.store.state.audit[0]).toMatchObject({ action: 'tournament.add_submission', entityId: tournamentId });

    // once only: the preview now points at it and a second add is refused in words
    expect((await json(await s.call('tournaments.previewSubmission', { leadId: SEED.l4 }))).data).toMatchObject({ addedAs: { tournamentId }, problem: SUBMISSION_MESSAGES.added });
    const again = await s.call('tournaments.addSubmission', { leadId: SEED.l4, reason: 'Organizer submission added by owner' });
    expect(again.status).toBe(400);
    expect((await json(again)).errors).toEqual({ form: SUBMISSION_MESSAGES.added });
    expect(s.store.state.tournaments.filter((t) => t.source === 'submitted' && t.name === 'Demo Shuttle Open 2026')).toHaveLength(1);
  });

  it('another kind of enquiry or an unknown one is refused; an editor is refused', async () => {
    const s = await setup();
    expect((await s.call('tournaments.addSubmission', { leadId: SEED.l1, reason: 'Organizer submission added by owner' })).status).toBe(400);
    expect((await json(await s.call('tournaments.previewSubmission', { leadId: '60000000-0000-4000-8000-0000000000ff' }))).code).toBe('NOT_FOUND');
    expect((await s.call('tournaments.addSubmission', { leadId: SEED.l4 })).status).toBe(400); // no reason
    const editor = await signToken(s.keys, { sub: EDITOR_ID });
    expect((await s.call('tournaments.previewSubmission', { leadId: SEED.l4 }, editor)).status).toBe(403);
    expect((await s.call('tournaments.addSubmission', { leadId: SEED.l4, reason: 'Organizer submission added by owner' }, editor)).status).toBe(403);
    expect(s.store.state.audit).toHaveLength(0);
  });
});

describe('supabase store with a fake PostgREST', () => {
  const URL_OK = 'https://fakeref.supabase.co';
  const SECRET = ['sb', 'secret', 'FAKE'].join('_');
  const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
  const L4 = '60000000-0000-4000-8000-000000000004';
  type Call = { url: string; method: string; body: any };

  function fake(opts: { linked?: boolean; taken?: string[]; duplicate?: boolean; type?: string } = {}) {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url: decodeURIComponent(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined });
      const u = decodeURIComponent(url);
      let rows: unknown[] = [];
      if (u.includes('/rpc/')) return new Response(JSON.stringify({ id: 'b0000000-0000-4000-8000-000000000001', slug: 'demo-shuttle-open-2026-coimbatore' }), { status: 200 });
      if (u.includes('/leads?')) rows = [{ id: L4, ref_code: 'PS-2026-DEMK04', type: opts.type ?? 'tournament_submission', ...PAYLOAD }];
      else if (u.includes('/tournament_submissions?')) rows = opts.linked ? [{ tournament_id: 'b0000000-0000-4000-8000-000000000009' }] : [];
      else if (u.includes('/tournaments?select=slug')) rows = (opts.taken ?? []).map((slug) => ({ slug }));
      else if (u.includes('/tournaments?select=id&series_key')) rows = opts.duplicate ? [{ id: 'b0000000-0000-4000-8000-000000000008' }] : [];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-range': `0-0/${rows.length}` } });
    }) as unknown as typeof fetch;
    return { calls, store: createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f }) };
  }
  const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/rpc/'));

  it('reads only the tournament fields of the lead, never a contact column', async () => {
    const { calls, store } = fake();
    const r = await store.previewSubmission({ leadId: L4 });
    expect(r).toMatchObject({ ok: true, data: { problem: null, record: { slug: 'demo-shuttle-open-2026-coimbatore' } } });
    const leadRead = calls.find((c) => c.url.includes('/leads?'))!;
    expect(leadRead.url).toContain('tournamentName:payload->>tournamentName');
    expect(leadRead.url).not.toMatch(/phone|email|organization|[?,]name[,&]|payload[,&]/);
  });

  it('adds through admin_add_submitted_tournament with the record computed on the server', async () => {
    const { calls, store } = fake({ taken: ['demo-shuttle-open-2026-coimbatore'] });
    const r = await store.addSubmission(ACTOR, { leadId: L4, reason: 'Organizer submission added by owner' });
    expect(r).toEqual({ ok: true, data: { tournamentId: 'b0000000-0000-4000-8000-000000000001', slug: 'demo-shuttle-open-2026-coimbatore' } });
    const rpc = rpcCalls(calls);
    expect(rpc).toHaveLength(1);
    expect(rpc[0]!.url).toBe(`${URL_OK}/rest/v1/rpc/admin_add_submitted_tournament`);
    expect(rpc[0]!.body).toMatchObject({ p_actor: ACTOR.userId, p_lead: L4, p_reason: 'Organizer submission added by owner', p_record: { slug: 'demo-shuttle-open-2026-coimbatore-2', region: 'tamil_nadu', editionYear: 2026 } });
  });

  it('never calls the RPC for an added submission, a duplicate or another kind of enquiry', async () => {
    for (const opts of [{ linked: true }, { duplicate: true }, { type: 'coverage' }]) {
      const { calls, store } = fake(opts);
      const r = await store.addSubmission(ACTOR, { leadId: L4, reason: 'Organizer submission added by owner' });
      expect(r.ok, JSON.stringify(opts)).toBe(false);
      expect(rpcCalls(calls), JSON.stringify(opts)).toHaveLength(0);
    }
  });
});
