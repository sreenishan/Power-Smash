// The owner's phone tasks (DoD 5): tournament submissions, leads, sponsor placements, prices, QR poster links. Memory store through the real
// handler, and the Supabase store with a fake PostgREST. Fictional data only.
import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/admin/memory-store';
import { createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { makeHandler, makeKeys, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; errors?: Record<string, string>; data?: any };

async function setup() {
  const keys = await makeKeys();
  const h = makeHandler(keys);
  const token = await signToken(keys);
  return { ...h, call: (action: string, body: unknown = {}) => h.handle(req(action, token, body), action) };
}

const placementBody = (over: object = {}) => ({
  sponsorId: SEED.s1,
  slot: 'home_partner_strip',
  creativeDesktopPath: 'creatives/demo.png',
  alt: 'Demo Sports Shop logo',
  targetUrl: 'https://sponsor.example.test/offer',
  goSlug: 'demo-shop',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  priority: 5,
  label: 'Sponsored',
  ...over,
});

describe('leads: move through statuses with notes and a follow-up date', () => {
  it('moves new -> contacted with notes and a follow-up, audited without the notes text', async () => {
    const s = await setup();
    const r = await s.call('leads.update', { id: SEED.l1, to: 'contacted', notes: 'Private note about the caller', followUpOn: '2026-10-30', valuePaise: 500000 });
    expect(r.status).toBe(200);
    const lead = s.store.state.leads.find((l) => l.id === SEED.l1)!;
    expect(lead).toMatchObject({ status: 'contacted', followUpOn: '2026-10-30', valuePaise: 500000, notes: 'Private note about the caller' });
    const row = s.store.state.audit[0]!;
    expect(row.action).toBe('lead.update');
    expect(JSON.stringify(row)).not.toContain('Private note');
    expect(JSON.stringify(row)).not.toContain('910000000000');
    expect(row.reason).toContain('status');
  });
  it('lost needs a reason; illegal jumps, past follow-ups and bad amounts are refused with plain messages', async () => {
    const s = await setup();
    const lost = await s.call('leads.update', { id: SEED.l1, to: 'lost' });
    expect(lost.status).toBe(400);
    expect((await json(lost)).errors!.status).toMatch(/why/i);
    expect((await s.call('leads.update', { id: SEED.l1, to: 'new' })).status).toBe(400); // already at that stage
    expect((await json(await s.call('leads.update', { id: SEED.l1, followUpOn: '2026-01-01' }))).errors!.followUpOn).toBeTruthy();
    expect((await s.call('leads.update', { id: SEED.l1, valuePaise: -5 })).status).toBe(400); // schema
    expect((await s.call('leads.update', { id: SEED.l1, valuePaise: 1.5 })).status).toBe(400);
    expect((await json(await s.call('leads.update', { id: SEED.l1 }))).errors!.form).toBe('Nothing to change.');
    expect(s.store.state.audit).toHaveLength(0);
    const ok = await s.call('leads.update', { id: SEED.l1, to: 'lost', lostReason: 'No reply' });
    expect(ok.status).toBe(200);
    expect(s.store.state.leads.find((l) => l.id === SEED.l1)!.lostReason).toBe('No reply');
    // reopening clears the old reason
    await s.call('leads.update', { id: SEED.l1, to: 'new' });
    expect(s.store.state.leads.find((l) => l.id === SEED.l1)!.lostReason).toBeNull();
  });
  it('lists leads and 404s an unknown one', async () => {
    const s = await setup();
    expect((await json(await s.call('leads.list'))).data).toHaveLength(3);
    expect((await s.call('leads.update', { id: '60000000-0000-4000-8000-0000000000ff', to: 'contacted' })).status).toBe(404);
  });
});

describe('placements', () => {
  it('creates a draft, audited, and refuses a link outside the sponsor website, a repeated link name and a missing image', async () => {
    const s = await setup();
    const ok = await s.call('placements.create', placementBody());
    expect(ok.status).toBe(200);
    expect(s.store.state.placements[0]).toMatchObject({ status: 'draft', slot: 'home_partner_strip', goSlug: 'demo-shop' });
    expect(s.store.state.audit[0]!.action).toBe('placement.create');
    const other = await s.call('placements.create', placementBody({ targetUrl: 'https://evil.example/x', goSlug: 'demo-two' }));
    expect((await json(other)).errors!.targetUrl).toMatch(/sponsor/i);
    const dupe = await s.call('placements.create', placementBody());
    expect((await json(dupe)).errors!.goSlug).toBeTruthy();
    const noImage = await s.call('placements.create', placementBody({ goSlug: 'demo-three', creativeDesktopPath: null }));
    expect((await json(noImage)).errors!.creative).toBeTruthy();
    expect((await s.call('placements.create', placementBody({ sponsorId: '70000000-0000-4000-8000-0000000000ff', goSlug: 'x-1' }))).status).toBe(400);
    expect(s.store.state.placements).toHaveLength(1);
  });
  it('switches on, pauses and ends; ended is final; every change is audited', async () => {
    const s = await setup();
    const id = (await json(await s.call('placements.create', placementBody()))).data.id as string;
    expect((await s.call('placements.setStatus', { id, status: 'active' })).status).toBe(200);
    expect((await s.call('placements.setStatus', { id, status: 'paused' })).status).toBe(200);
    expect((await s.call('placements.setStatus', { id, status: 'ended' })).status).toBe(200);
    expect((await s.call('placements.setStatus', { id, status: 'active' })).status).toBe(400);
    expect(s.store.state.audit.filter((a) => a.action === 'placement.status')).toHaveLength(3);
    expect((await s.call('placements.setStatus', { id: '80000000-0000-4000-8000-000000000001', status: 'active' })).status).toBe(404);
  });
  it('lists sponsors with their websites', async () => {
    const s = await setup();
    const body = await json(await s.call('placements.list'));
    expect(body.data.sponsors[0]).toMatchObject({ name: 'Demo Sports Shop', website: 'https://sponsor.example.test' });
  });
});

describe('prices: integer paise, no default price', () => {
  it('the seed has no price anywhere', async () => {
    const s = await setup();
    const items = (await json(await s.call('products.list'))).data as { record: { pricePaise: number | null } }[];
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.record.pricePaise).toBeNull();
  });
  it('saves a typed price as integer paise, audits old and new, and marks the site dirty', async () => {
    const s = await setup();
    const slug = s.store.state.products[0]!.slug;
    const rec = s.store.state.products[0]!.record;
    const base = { slug, name: rec.name, summary: rec.summary, priceType: 'fixed', visible: false, sort: 0, inclusions: rec.inclusions };
    const r = await s.call('products.save', { ...base, priceRupees: '5,000' });
    expect(r.status).toBe(200);
    expect(s.store.state.products[0]!.record.pricePaise).toBe(500000);
    expect(s.store.state.audit[0]).toMatchObject({ action: 'product.price_change' });
    expect(s.store.state.audit[0]!.reason).toContain('none -> 500000 paise');
    expect(s.store.state.siteDirty).toBe(true);
    const again = await s.call('products.save', { ...base, priceRupees: '5000' });
    expect((await json(again)).errors!.form).toBe('Nothing to change.');
  });
  it('refuses a visible fixed product without a price and bad amounts; never invents a price', async () => {
    const s = await setup();
    const slug = s.store.state.products[0]!.slug;
    const rec = s.store.state.products[0]!.record;
    const base = { slug, name: rec.name, summary: rec.summary, visible: true, sort: 0, inclusions: rec.inclusions };
    expect((await json(await s.call('products.save', { ...base, priceType: 'fixed' }))).errors!.price).toBeTruthy();
    expect((await json(await s.call('products.save', { ...base, priceType: 'fixed', priceRupees: 'abc' }))).errors!.price).toBeTruthy();
    expect((await s.call('products.save', { ...base, priceType: 'fixed', pricePaise: 12.5 })).status).toBe(400);
    expect((await s.call('products.save', { ...base, slug: 'no-such-product', priceType: 'quote' })).status).toBe(404);
    expect(s.store.state.products[0]!.record.pricePaise).toBeNull();
    expect(s.store.state.audit).toHaveLength(0);
  });
});

describe('tournament submissions and QR poster targets', () => {
  it('candidates say where they came from so a submission shows its checklist', async () => {
    const s = await setup();
    const items = (await json(await s.call('tournaments.candidates'))).data as { id: string; source: string }[];
    expect(items.find((t) => t.id === SEED.t1)!.source).toBe('submitted');
    expect(items.find((t) => t.id === SEED.t2)!.source).toBe('parsed');
  });
  it('approving a submitted Tamil Nadu event publishes it, rejecting hides it, both audited', async () => {
    const s = await setup();
    await s.call('tournaments.decide', { id: SEED.t1, decision: 'promote', reason: 'Checked the organizer' });
    expect(s.store.state.tournaments.find((t) => t.id === SEED.t1)).toMatchObject({ status: 'published', visibility: 'public' });
    await s.call('tournaments.decide', { id: SEED.t2, decision: 'reject', reason: 'Not a real event' });
    expect(s.store.state.tournaments.find((t) => t.id === SEED.t2)).toMatchObject({ status: 'rejected', visibility: 'hidden' });
    expect(s.store.state.audit.map((a) => a.action)).toEqual(['tournament.reject', 'tournament.promote']);
  });
  it('poster targets: the channel always, public tournaments after approval', async () => {
    const s = await setup();
    expect(((await json(await s.call('posters.list'))).data as { slug: string }[]).map((t) => t.slug)).toEqual(['channel']);
    await s.call('tournaments.decide', { id: SEED.t1, decision: 'promote', reason: 'Checked the organizer' });
    const list = (await json(await s.call('posters.list'))).data as { slug: string; kind: string }[];
    expect(list.map((t) => t.slug)).toEqual(['channel', 'demo-open-cup']);
    expect(list[1]!.kind).toBe('tournament');
  });
});

// ------------------------------------------------------------------------------------------------ Supabase store with a fake PostgREST

type Call = { url: string; method: string; body: any };
function fake(tables: Record<string, unknown[]>, failOn?: (c: Call) => boolean) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(c);
    if (failOn?.(c)) return new Response('{}', { status: 500 });
    if (c.url.includes('/rpc/')) return new Response(null, { status: 204 });
    if (c.method === 'GET') return new Response(JSON.stringify(tables[new URL(url).pathname.split('/').pop()!] ?? []), { status: 200 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, f };
}
const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
const sb = (f: typeof fetch) => createSupabaseAdminStore({ url: 'https://fakeref.supabase.co', secretKey: ['sb', 'secret', 'FAKE'].join('_'), fetch: f, now: () => new Date('2026-10-22T10:00:00Z') });
const leadRow = { id: SEED.l1, ref_code: 'PS-2026-DEMK01', type: 'coverage', status: 'new', name: 'Demo Organizer', organization: null, phone: '910000000000', email: null, whatsapp_ok: true, value_paise: null, source_path: '/book/', follow_up_on: null, notes: null, lost_reason: null, created_at: '2026-10-20T06:00:00Z' };

describe('supabase store: owner tasks', () => {
  it('lead update writes the audit row FIRST, then the lead, then a timeline event without personal data', async () => {
    const { calls, f } = fake({ leads: [leadRow] });
    const r = await sb(f).updateLead(ACTOR, { id: SEED.l1, to: 'contacted', notes: 'private words', followUpOn: '2026-10-30' });
    expect(r.ok).toBe(true);
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${new URL(c.url).pathname.split('/').pop()}`)).toEqual(['POST audit_log', 'PATCH leads', 'POST lead_events']);
    expect(writes[1]!.body).toEqual({ status: 'contacted', notes: 'private words', follow_up_on: '2026-10-30' });
    expect(JSON.stringify(writes[0]!.body)).not.toContain('private words');
    expect(JSON.stringify(writes[0]!.body)).not.toContain('910000000000');
    expect(writes[2]!.body).toEqual({ lead_id: SEED.l1, event: 'status_changed', meta: { from: 'new', to: 'contacted' } });
  });
  it('an audit failure stops the change (fail closed); an invalid move writes nothing', async () => {
    const a = fake({ leads: [leadRow] }, (c) => c.url.endsWith('/audit_log'));
    expect(await sb(a.f).updateLead(ACTOR, { id: SEED.l1, to: 'contacted' })).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    expect(a.calls.some((c) => c.method === 'PATCH')).toBe(false);
    const b = fake({ leads: [leadRow] });
    const r = await sb(b.f).updateLead(ACTOR, { id: SEED.l1, to: 'new' });
    expect(r.ok).toBe(false);
    expect(b.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
  it('placement create inserts a draft with the normalised link; a link off the sponsor site is refused before any write', async () => {
    const tables = { sponsors: [{ id: SEED.s1, name: 'Demo Sports Shop', website: 'https://sponsor.example.test', active: true }], placements: [] };
    const a = fake(tables);
    const ok = await sb(a.f).createPlacement(ACTOR, placementBody() as never);
    expect(ok.ok).toBe(true);
    const writes = a.calls.filter((c) => c.method === 'POST');
    expect(writes.map((c) => new URL(c.url).pathname.split('/').pop())).toEqual(['audit_log', 'placements']);
    expect(writes[1]!.body).toMatchObject({ sponsor_id: SEED.s1, status: 'draft', go_slug: 'demo-shop', target_url: 'https://sponsor.example.test/offer', slot: 'home_partner_strip' });
    const b = fake(tables);
    const bad = await sb(b.f).createPlacement(ACTOR, placementBody({ targetUrl: 'https://evil.example/' }) as never);
    expect(bad.ok).toBe(false);
    expect(b.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
  it('placement status change audits then patches', async () => {
    const row = { id: '80000000-0000-4000-8000-000000000001', sponsor_id: SEED.s1, slot: 'home_partner_strip', scope_key: null, creative_desktop_path: 'c/x.png', creative_mobile_path: null, alt: 'Demo logo', headline: null, go_slug: 'demo-shop', start_date: '2026-11-01', end_date: '2026-11-30', priority: 5, label: 'Sponsored', status: 'draft' };
    const { calls, f } = fake({ placements: [row] });
    expect((await sb(f).setPlacementStatus(ACTOR, { id: row.id, status: 'active' })).ok).toBe(true);
    const w = calls.filter((c) => c.method !== 'GET');
    expect(w.map((c) => c.method)).toEqual(['POST', 'PATCH']);
    expect(w[1]!.body).toEqual({ status: 'active' });
  });
  it('price save validates integer paise and calls the proposed RPC admin_save_product; nothing is defaulted', async () => {
    const s = sb(fake({}).f);
    const items = await s.listProducts();
    expect(items.ok && items.data.every((i) => i.record.pricePaise === null)).toBe(true);
    const first = items.ok ? items.data[0]! : (undefined as never);
    const { calls, f } = fake({});
    const r = await sb(f).saveProduct(ACTOR, { slug: first.slug, name: first.record.name, summary: first.record.summary, priceType: 'fixed', priceRupees: '2,500', visible: false, sort: 0, inclusions: first.record.inclusions });
    expect(r.ok && r.data.record.pricePaise).toBe(250000);
    const rpc = calls.find((c) => c.url.includes('/rpc/'))!;
    expect(rpc.url).toMatch(/rpc\/admin_save_product$/);
    expect(rpc.body).toMatchObject({ p_actor: ACTOR.userId, p_slug: first.slug, p_reason: 'price change' });
    expect(rpc.body.p_record.pricePaise).toBe(250000);
    const bad = fake({});
    expect((await sb(bad.f).saveProduct(ACTOR, { slug: first.slug, name: first.record.name, summary: '', priceType: 'fixed', visible: true, sort: 0 })).ok).toBe(false);
    expect(bad.calls).toHaveLength(0);
  });
  it('the missing products RPC fails closed', async () => {
    const { f } = fake({}, (c) => c.url.includes('/rpc/admin_save_product'));
    const first = (await sb(fake({}).f).listProducts());
    const p = first.ok ? first.data[0]! : (undefined as never);
    expect(await sb(f).saveProduct(ACTOR, { slug: p.slug, name: p.record.name, summary: p.record.summary, priceType: 'fixed', priceRupees: '100', visible: false, sort: 0 })).toEqual({ ok: false, code: 'BACKEND_ERROR' });
  });
  it('poster targets: the channel plus public tournaments with a safe slug', async () => {
    const { f } = fake({ tournaments: [{ slug: 'demo-open-cup', name: 'Demo Open Cup' }, { slug: '../bad', name: 'Bad' }] });
    const r = await sb(f).listPosterTargets();
    expect(r.ok && r.data.map((t) => t.slug)).toEqual(['channel', 'demo-open-cup']);
  });
});
