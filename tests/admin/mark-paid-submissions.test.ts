// Mark paid and video-submission review (OWNER_GUIDE "not built" items). Memory store through the real handler, then the Supabase store
// with a fake PostgREST. Fictional data only.
import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/admin/memory-store';
import { createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { leadMove, nextSubmissionStatuses, safeHttpsHref, submissionFromLead, validateReview, YOUTUBE_ID } from '../../src/lib/admin/submissions';
import { makeHandler, makeKeys, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; errors?: Record<string, string>; data?: any };

async function setup() {
  const keys = await makeKeys();
  const h = makeHandler(keys);
  const token = await signToken(keys);
  return { ...h, call: (action: string, body: unknown = {}) => h.handle(req(action, token, body), action) };
}

const pay = (over: object = {}) => ({
  leadId: SEED.l1,
  provider: 'upi_manual',
  providerRef: 'UTR1234567890',
  paidOn: '2026-10-22',
  grossPaise: 500000,
  documentType: 'payment_receipt',
  gstRegistered: null,
  ...over,
});

describe('mark paid', () => {
  it('records a payment typed by the owner, moves the enquiry to won, audits first, keeps UTR out of the audit text', async () => {
    const s = await setup();
    const r = await s.call('payments.mark', pay());
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.data.record).toMatchObject({ grossPaise: 500000, provider: 'upi_manual', netSettledPaise: 500000, netReceivedPaise: 500000, documentType: 'payment_receipt', reference: 'PS-2026-DEMK01' });
    expect(body.data.leadStatus).toBe('won');
    expect(s.store.state.leads.find((l) => l.id === SEED.l1)!.status).toBe('won');
    expect(s.store.state.audit[0]).toMatchObject({ action: 'payment.mark_paid', entityId: SEED.l1 });
    expect(JSON.stringify(s.store.state.audit[0])).not.toContain('UTR1234567890');
    expect((await json(await s.call('payments.list', { leadId: SEED.l1 }))).data).toHaveLength(1);
  });
  it('a Razorpay payment with fee, GST on fee and TDS works out the net from the typed figures only', async () => {
    const s = await setup();
    const r = await json(await s.call('payments.mark', pay({ provider: 'razorpay', providerRef: 'pay_FAKE123456', grossPaise: 1000000, gatewayFeePaise: 23600, gstOnFeePaise: 4248, tdsPaise: 10000, gstRegistered: true, documentType: 'invoice' })));
    expect(r.data.record).toMatchObject({ netSettledPaise: 972152, netReceivedPaise: 962152, tdsCertificateReceived: false });
    expect(r.data.warnings.join(' ')).toMatch(/TDS certificate/);
  });
  it('a payment that settles a typed invoice total completes the enquiry; a part payment makes it won', async () => {
    const s = await setup();
    const part = await json(await s.call('payments.mark', pay({ grossPaise: 300000, invoiceTotalPaise: 500000 })));
    expect(part.data.settlement).toMatchObject({ status: 'part_paid', balancePaise: 200000 });
    expect(part.data.leadStatus).toBe('won');
    const rest = await json(await s.call('payments.mark', pay({ grossPaise: 200000, invoiceTotalPaise: 500000 })));
    expect(rest.data.settlement).toMatchObject({ status: 'settled', balancePaise: 0 });
    expect(rest.data.leadStatus).toBe('completed');
    expect(s.store.state.payments).toHaveLength(2);
  });
  it('nothing is defaulted: missing or wrong figures give plain-English errors and write nothing', async () => {
    const s = await setup();
    const bad = async (over: object) => json(await s.call('payments.mark', pay(over)));
    expect((await bad({ grossPaise: 0 })).errors!.gross).toMatch(/more than zero/);
    expect((await bad({ providerRef: '' })).errors!.providerRef).toMatch(/UTR/);
    expect((await bad({ paidOn: '2027-01-01' })).errors!.paidOn).toMatch(/future/);
    expect((await bad({ gatewayFeePaise: 100 })).errors!.gstOnFee).toBeTruthy(); // fee without the GST on it
    expect((await bad({ gatewayFeePaise: 400000, gstOnFeePaise: 90000, tdsPaise: 100000 })).errors!.gross).toMatch(/add up to more/);
    expect((await bad({ documentType: 'invoice' })).errors!.documentType).toMatch(/GST registration is not set/);
    expect((await bad({ gstRegistered: false, documentType: 'invoice' })).errors!.documentType).toMatch(/not GST registered/);
    expect((await bad({ provider: 'cheque' })).errors!.provider).toBeTruthy();
    expect((await bad({ tdsCertificateReceived: true })).errors!.tdsCertificate).toBeTruthy();
    expect((await s.call('payments.mark', pay({ grossPaise: 12.5 }))).status).toBe(400); // not integer paise
    expect((await s.call('payments.mark', pay({ gatewayFeePaise: -1 }))).status).toBe(400);
    expect((await s.call('payments.mark', { leadId: SEED.l1, provider: 'cash', paidOn: '2026-10-22', documentType: 'payment_receipt', gstRegistered: null })).status).toBe(400); // no gross at all
    expect(s.store.state.payments).toHaveLength(0);
    expect(s.store.state.audit).toHaveLength(0);
  });
  it('cash needs no reference; a lost enquiry must be reopened; an unknown enquiry is 404', async () => {
    const s = await setup();
    expect((await s.call('payments.mark', pay({ provider: 'cash', providerRef: null }))).status).toBe(200);
    await s.call('leads.update', { id: SEED.l2, to: 'lost', lostReason: 'No reply' });
    const lost = await json(await s.call('payments.mark', pay({ leadId: SEED.l2 })));
    expect(lost.errors!.form).toMatch(/Reopen/);
    expect((await s.call('payments.mark', pay({ leadId: '60000000-0000-4000-8000-0000000000ff' }))).status).toBe(404);
  });
});

describe('video submission review: pure rules', () => {
  it('status machine new > approved > uploaded | rejected', () => {
    expect(nextSubmissionStatuses('new')).toEqual(['approved', 'rejected']);
    expect(nextSubmissionStatuses('approved')).toEqual(['uploaded', 'rejected']);
    expect(nextSubmissionStatuses('uploaded')).toEqual([]);
    expect(nextSubmissionStatuses('rejected')).toEqual([]);
  });
  it('YouTube id is exactly 11 characters', () => {
    for (const ok of ['dQw4w9WgXcQ', 'abc_DEF-123']) expect(YOUTUBE_ID.test(ok)).toBe(true);
    for (const bad of ['short', 'dQw4w9WgXcQ1', 'dQw4w9WgXc!', 'https://youtu.be/dQw4w9WgXcQ', '', ' dQw4w9WgXcQ']) expect(YOUTUBE_ID.test(bad)).toBe(false);
  });
  it('validateReview: reject needs a reason, uploaded needs approval first and a good id, finished ones are final', () => {
    expect(validateReview('new', { action: 'reject' })).toMatchObject({ ok: false });
    expect(validateReview('new', { action: 'reject', reason: 'No rights' })).toMatchObject({ ok: true, to: 'rejected', reason: 'No rights' });
    expect(validateReview('new', { action: 'mark_uploaded', youtubeId: 'dQw4w9WgXcQ' })).toMatchObject({ ok: false, errors: { status: expect.stringMatching(/Approve it first/) } });
    expect(validateReview('approved', { action: 'mark_uploaded', youtubeId: 'bad' })).toMatchObject({ ok: false, errors: { youtubeId: expect.stringMatching(/11/) } });
    expect(validateReview('approved', { action: 'mark_uploaded', youtubeId: 'https://youtu.be/dQw4w9WgXcQ' })).toMatchObject({ ok: false, errors: { youtubeId: expect.stringMatching(/not the whole address/) } });
    expect(validateReview('approved', { action: 'mark_uploaded', youtubeId: 'dQw4w9WgXcQ' })).toMatchObject({ ok: true, to: 'uploaded', youtubeId: 'dQw4w9WgXcQ' });
    expect(validateReview('uploaded', { action: 'reject', reason: 'Changed my mind' })).toMatchObject({ ok: false });
    expect(validateReview('rejected', { action: 'approve' })).toMatchObject({ ok: false });
    expect(validateReview('approved', { action: 'approve' })).toMatchObject({ ok: false });
  });
  it('the lead status follows only when its own machine allows', () => {
    expect(leadMove('new', 'approved')).toBe('contacted');
    expect(leadMove('contacted', 'uploaded')).toBe('completed');
    expect(leadMove('new', 'rejected')).toBe('lost');
    expect(leadMove('lost', 'uploaded')).toBeNull();
    expect(leadMove('completed', 'uploaded')).toBeNull();
  });
  it('the link is clickable only when it is a plain https address', () => {
    expect(safeHttpsHref('https://video.example.test/a?b=1')).toBe('https://video.example.test/a?b=1');
    for (const bad of ['http://x.test', 'javascript:alert(1)', 'data:text/html,<b>', 'https://user:pw@x.test/', 'ftp://x.test', 'not a url']) expect(safeHttpsHref(bad)).toBeNull();
  });
  it('builds the view from a lead row and its consent events, showing the stored versions and the current ones', () => {
    const s = submissionFromLead(
      { id: SEED.l3, ref_code: 'PS-2026-DEMK03', type: 'video_submission', name: 'Demo Sender', created_at: '2026-10-19T06:00:00Z', payload: { videoUrl: 'https://video.example.test/x', role: 'coach', review: { status: 'approved' } } },
      [{ id: 'video-rights', version: 'old-version', given: true }],
    )!;
    expect(s.status).toBe('approved');
    expect(s.consents).toHaveLength(4);
    const rights = s.consents.find((c) => c.id === 'video-rights');
    expect(rights).toMatchObject({ version: 'old-version', given: true });
    expect(rights!.currentVersion).not.toBe('old-version');
    expect(s.consents.filter((c) => !c.given).length).toBe(3); // the three with no stored event read as NOT given
    expect(submissionFromLead({ id: SEED.l3, ref_code: 'x', type: 'general', created_at: 'x', payload: {} }, [])).toBeNull();
  });
});

describe('video submission review through the handler', () => {
  it('new > approved > uploaded, audited, the lead follows, the link is stored text', async () => {
    const s = await setup();
    const list = (await json(await s.call('submissions.list'))).data;
    expect(list).toHaveLength(1);
    expect(list[0].videoUrl).toBe('https://video.example.test/watch/demo-clip');
    expect(list[0].consents).toHaveLength(4);
    expect((await s.call('submissions.review', { id: SEED.l3, action: 'approve' })).status).toBe(200);
    expect(s.store.state.leads.find((l) => l.id === SEED.l3)!.status).toBe('contacted');
    const up = await s.call('submissions.review', { id: SEED.l3, action: 'mark_uploaded', youtubeId: 'dQw4w9WgXcQ' });
    expect(up.status).toBe(200);
    expect(s.store.state.submissions[0]).toMatchObject({ status: 'uploaded', youtubeId: 'dQw4w9WgXcQ' });
    expect(s.store.state.leads.find((l) => l.id === SEED.l3)!.status).toBe('completed');
    expect(s.store.state.audit.map((a) => a.action)).toEqual(['submission.mark_uploaded', 'submission.approve']);
    expect((await s.call('submissions.review', { id: SEED.l3, action: 'reject', reason: 'Too late' })).status).toBe(400);
  });
  it('reject needs a reason and marks the lead lost; a bad video id is refused with a plain message; unknown is 404', async () => {
    const s = await setup();
    const noReason = await json(await s.call('submissions.review', { id: SEED.l3, action: 'reject' }));
    expect(noReason.errors!.reason).toBeTruthy();
    expect((await json(await s.call('submissions.review', { id: SEED.l3, action: 'mark_uploaded', youtubeId: 'dQw4w9WgXcQ' }))).errors!.status).toMatch(/Approve it first/);
    await s.call('submissions.review', { id: SEED.l3, action: 'approve' });
    expect((await json(await s.call('submissions.review', { id: SEED.l3, action: 'mark_uploaded', youtubeId: 'nope' }))).errors!.youtubeId).toMatch(/11/);
    const rej = await s.call('submissions.review', { id: SEED.l3, action: 'reject', reason: 'Rights are unclear' });
    expect(rej.status).toBe(200);
    expect(s.store.state.submissions[0]).toMatchObject({ status: 'rejected', rejectReason: 'Rights are unclear' });
    expect(s.store.state.leads.find((l) => l.id === SEED.l3)!.lostReason).toBe('Rights are unclear');
    expect((await s.call('submissions.review', { id: '60000000-0000-4000-8000-0000000000ff', action: 'approve' })).status).toBe(404);
    expect((await s.call('submissions.review', { id: SEED.l3, action: 'delete' })).status).toBe(400);
  });
});

// ------------------------------------------------------------------------------------------------ Supabase store

type Call = { url: string; method: string; body: any };
function fake(tables: Record<string, unknown[]>, failOn?: (c: Call) => boolean) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(c);
    if (failOn?.(c)) return new Response('{}', { status: 500 });
    if (c.method === 'GET') return new Response(JSON.stringify(tables[new URL(url).pathname.split('/').pop()!] ?? []), { status: 200 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, f };
}
const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
const sb = (f: typeof fetch) => createSupabaseAdminStore({ url: 'https://fakeref.supabase.co', secretKey: ['sb', 'secret', 'FAKE'].join('_'), fetch: f, now: () => new Date('2026-10-22T10:00:00Z') });
const leadRow = { id: SEED.l1, ref_code: 'PS-2026-DEMK01', type: 'coverage', status: 'new', name: 'Demo Organizer', organization: null, phone: '910000000000', email: null, whatsapp_ok: true, value_paise: null, source_path: '/book/', follow_up_on: null, notes: null, lost_reason: null, created_at: '2026-10-20T06:00:00Z' };
const names = (calls: Call[]) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${new URL(c.url).pathname.split('/').pop()}`);

describe('supabase store: mark paid and submissions', () => {
  it('mark paid: audit row first, then the payment event (no personal data), then the status move', async () => {
    const { calls, f } = fake({ leads: [leadRow], lead_events: [] });
    const r = await sb(f).markPaid(ACTOR, pay() as never);
    expect(r.ok && r.data.leadStatus).toBe('won');
    expect(names(calls)).toEqual(['POST audit_log', 'POST lead_events', 'PATCH leads', 'POST lead_events']);
    const w = calls.filter((c) => c.method !== 'GET');
    expect(w[1]!.body).toMatchObject({ lead_id: SEED.l1, event: 'payment_recorded', meta: { grossPaise: 500000, provider: 'upi_manual', reference: 'PS-2026-DEMK01' } });
    expect(JSON.stringify(w[1]!.body)).not.toContain('910000000000');
    expect(JSON.stringify(w[0]!.body)).not.toContain('UTR1234567890');
    expect(w[2]!.body).toEqual({ status: 'won', lost_reason: null });
    expect(w[3]!.body.event).toBe('status_changed');
  });
  it('mark paid uses earlier payments for the settlement and fails closed when the audit row cannot be written', async () => {
    const { f, calls } = fake({ leads: [{ ...leadRow, status: 'won' }], lead_events: [{ meta: { grossPaise: 300000 } }] });
    const r = await sb(f).markPaid(ACTOR, pay({ grossPaise: 200000, invoiceTotalPaise: 500000 }) as never);
    expect(r.ok && r.data.settlement).toMatchObject({ status: 'settled' });
    expect(r.ok && r.data.leadStatus).toBe('completed');
    const bad = fake({ leads: [leadRow], lead_events: [] }, (c) => c.url.endsWith('/audit_log'));
    expect(await sb(bad.f).markPaid(ACTOR, pay() as never)).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    expect(bad.calls.some((c) => c.method === 'PATCH' || c.url.endsWith('/lead_events') && c.method === 'POST')).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });
  it('mark paid with invalid figures writes nothing', async () => {
    const { calls, f } = fake({ leads: [leadRow], lead_events: [] });
    const r = await sb(f).markPaid(ACTOR, pay({ grossPaise: 0 }) as never);
    expect(r.ok).toBe(false);
    expect(names(calls)).toEqual([]);
  });
  const subRow = { id: SEED.l3, ref_code: 'PS-2026-DEMK03', type: 'video_submission', name: 'Demo Sender', created_at: '2026-10-19T06:00:00Z', status: 'new', payload: { videoUrl: 'https://video.example.test/x', role: 'coach' } };
  it('lists submissions with their consent events and the link as text', async () => {
    const { f } = fake({ leads: [subRow], consent_events: [{ lead_id: SEED.l3, notice_id: 'video-rights', notice_version: 'v1', given: true }] });
    const r = await sb(f).listSubmissions({ limit: 10 });
    expect(r.ok && r.data[0]).toMatchObject({ videoUrl: 'https://video.example.test/x', status: 'new' });
    expect(r.ok && r.data[0]!.consents.find((c) => c.id === 'video-rights')).toMatchObject({ version: 'v1', given: true });
  });
  it('review: audit first, then payload.review and the lead status together, then the timeline event', async () => {
    const { calls, f } = fake({ leads: [subRow] });
    const r = await sb(f).reviewSubmission(ACTOR, { id: SEED.l3, action: 'approve' });
    expect(r.ok && r.data.submission.status).toBe('approved');
    expect(names(calls)).toEqual(['POST audit_log', 'PATCH leads', 'POST lead_events']);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body.status).toBe('contacted');
    expect(patch.body.payload.review).toMatchObject({ status: 'approved' });
    expect(patch.body.payload.videoUrl).toBe('https://video.example.test/x'); // the rest of the payload is kept
  });
  it('review: a bad id, a missing reason or a wrong step writes nothing and the link is never fetched', async () => {
    const { calls, f } = fake({ leads: [subRow] });
    expect((await sb(f).reviewSubmission(ACTOR, { id: SEED.l3, action: 'mark_uploaded', youtubeId: 'dQw4w9WgXcQ' })).ok).toBe(false);
    expect((await sb(f).reviewSubmission(ACTOR, { id: SEED.l3, action: 'reject' })).ok).toBe(false);
    expect(names(calls)).toEqual([]);
    expect(calls.every((c) => c.url.startsWith('https://fakeref.supabase.co/'))).toBe(true);
    const audit = fake({ leads: [subRow] }, (c) => c.url.endsWith('/audit_log'));
    expect(await sb(audit.f).reviewSubmission(ACTOR, { id: SEED.l3, action: 'approve' })).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    expect(audit.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
  it('uploaded stores the 11-character id and completes the lead', async () => {
    const approved = { ...subRow, status: 'contacted', payload: { ...subRow.payload, review: { status: 'approved' } } };
    const { calls, f } = fake({ leads: [approved] });
    const r = await sb(f).reviewSubmission(ACTOR, { id: SEED.l3, action: 'mark_uploaded', youtubeId: 'dQw4w9WgXcQ' });
    expect(r.ok && r.data.submission).toMatchObject({ status: 'uploaded', youtubeId: 'dQw4w9WgXcQ' });
    expect(calls.find((c) => c.method === 'PATCH')!.body.status).toBe('completed');
  });
});
