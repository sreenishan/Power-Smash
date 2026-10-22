import { describe, expect, it } from 'vitest';
import { createGoTrue } from '../../src/lib/admin/gotrue';
import { canEnrolTotp, createHttpAdminStore } from '../../src/lib/admin/http-store';
import { MemoryAdminStore } from '../../src/lib/admin/memory-store';
import type { AdminErrorCode } from '../../src/lib/admin/types';
import { AGE_LABEL, hashFor, messageFor, parseHash, ROUTES_ADMIN } from '../../src/admin/messages';

const ACTOR = { userId: 'preview-owner', role: 'owner' as const };

describe('owner-facing text', () => {
  it('every error code has a plain sentence without codes or jargon', () => {
    const codes: AdminErrorCode[] = ['NOT_FOUND', 'SAME_PLAYER', 'ALREADY_MERGED', 'SUPPRESSED', 'MINOR_ADULT_MERGE_BLOCKED', 'OVERRIDE_REASON_REQUIRED', 'EMPTY_NAME', 'ALIAS_NOT_OWNED', 'REDIRECT_LOOP', 'UNDO_UNAVAILABLE', 'INVALID', 'UNAUTHORIZED', 'FORBIDDEN', 'BACKEND_ERROR'];
    for (const c of codes) {
      const m = messageFor(c);
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/[A-Z]{4,}_[A-Z]/);
      expect(m).not.toMatch(/\b(RPC|JWT|aal2|SQL|500|RLS)\b/);
    }
  });
  it('every age status has a label', () => {
    expect(Object.keys(AGE_LABEL).sort()).toEqual(['adult_confirmed', 'minor_confirmed', 'minor_suspected', 'unknown']);
  });
  it('hash router falls back to the dashboard', () => {
    expect(parseHash('#/players')).toBe('players');
    expect(parseHash('#/settings?x=1')).toBe('settings');
    expect(parseHash('')).toBe('dashboard');
    expect(parseHash('#/nope')).toBe('dashboard');
    expect(parseHash('#/__proto__')).toBe('dashboard');
    for (const r of ROUTES_ADMIN) expect(parseHash(hashFor(r))).toBe(r);
  });
});

describe('http admin store', () => {
  const recorder = (status: number, body: unknown) => {
    const calls: { url: string; init: RequestInit }[] = [];
    return { calls, f: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch };
  };
  it('sends the bearer token, ignores the actor argument and returns data', async () => {
    const { calls, f } = recorder(200, { ok: true, data: { result: { keepId: 'a', dropId: 'b' } } });
    const s = createHttpAdminStore({ getToken: () => 'tok', fetch: f });
    const r = await s.mergePlayers({ userId: 'spoofed', role: 'owner' }, { keepId: 'a', dropId: 'b', reason: 'x' });
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('/api/admin/players.merge');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(String(calls[0]!.init.body)).not.toContain('spoofed');
  });
  it('no token makes no request; 401 and 403 are distinct codes; server error codes pass through', async () => {
    const none = recorder(200, {});
    expect(await createHttpAdminStore({ getToken: () => null, fetch: none.f }).getDashboard()).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(none.calls).toHaveLength(0);
    expect(await createHttpAdminStore({ getToken: () => 't', fetch: recorder(401, { ok: false, code: 'unauthorized' }).f }).getDashboard()).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(await createHttpAdminStore({ getToken: () => 't', fetch: recorder(403, { ok: false, code: 'forbidden' }).f }).getDashboard()).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await createHttpAdminStore({ getToken: () => 't', fetch: recorder(409, { ok: false, code: 'MINOR_ADULT_MERGE_BLOCKED' }).f }).getDashboard()).toEqual({ ok: false, code: 'MINOR_ADULT_MERGE_BLOCKED' });
    expect(await createHttpAdminStore({ getToken: () => 't', fetch: recorder(500, 'weird').f }).getDashboard()).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    expect(await createHttpAdminStore({ getToken: () => 't', fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch }).getDashboard()).toEqual({ ok: false, code: 'BACKEND_ERROR' });
  });
});

describe('gotrue client', () => {
  const session = (over: object = {}) => ({ access_token: 'a.b.c', refresh_token: 'r', expires_in: 3600, user: { id: '9a000000-0000-4000-8000-000000000001', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }, { id: 'f2', factor_type: 'totp', status: 'unverified' }] }, ...over });
  const mk = (handler: (path: string, init: RequestInit) => Response) => {
    const calls: { path: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { const path = url.replace('https://fakeref.supabase.co/auth/v1/', ''); calls.push({ path, init }); return handler(path, init); }) as unknown as typeof fetch;
    return { calls, gt: createGoTrue({ url: 'https://fakeref.supabase.co', publishableKey: 'sb_publishable_FAKE', fetch: f, now: () => 1_000 }) };
  };
  it('password sign-in returns a session with verified factors only listed as usable', async () => {
    const { gt, calls } = mk(() => new Response(JSON.stringify(session()), { status: 200 }));
    const r = await gt.signInWithPassword('o@example.test', 'pw');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ accessToken: 'a.b.c', userId: '9a000000-0000-4000-8000-000000000001', expiresAt: 1_000 + 3_600_000 });
    expect(gt.verifiedTotpFactors(r.value).map((f) => f.id)).toEqual(['f1']);
    expect(calls[0]!.path).toBe('token?grant_type=password');
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe('sb_publishable_FAKE');
  });
  it('wrong password and rate limit are distinguished; network failure too', async () => {
    expect(await mk(() => new Response('{}', { status: 400 })).gt.signInWithPassword('a', 'b')).toEqual({ ok: false, code: 'invalid_credentials' });
    expect(await mk(() => new Response('{}', { status: 429 })).gt.signInWithPassword('a', 'b')).toEqual({ ok: false, code: 'rate_limited' });
    const net = createGoTrue({ url: 'https://fakeref.supabase.co', publishableKey: 'k', fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch });
    expect(await net.signInWithPassword('a', 'b')).toEqual({ ok: false, code: 'network' });
  });
  it('TOTP verify challenges then verifies with the access token; a non-6-digit code never hits the network', async () => {
    const { gt, calls } = mk((path) => (path.endsWith('/challenge') ? new Response(JSON.stringify({ id: 'ch1' }), { status: 200 }) : new Response(JSON.stringify(session({ access_token: 'aal2.tok.en' })), { status: 200 })));
    const s0 = { accessToken: 'a.b.c', refreshToken: 'r', expiresAt: 0, userId: 'u', factors: [] };
    expect(await gt.verifyTotp(s0, 'f1', '12ab')).toEqual({ ok: false, code: 'invalid_code' });
    expect(calls).toHaveLength(0);
    const r = await gt.verifyTotp(s0, 'f1', '123456');
    expect(r.ok && r.value.accessToken).toBe('aal2.tok.en');
    expect(calls.map((c) => c.path)).toEqual(['factors/f1/challenge', 'factors/f1/verify']);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ challenge_id: 'ch1', code: '123456' });
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer a.b.c');
  });
  it('enrolment returns the secret and uri', async () => {
    const { gt } = mk(() => new Response(JSON.stringify({ id: 'f9', totp: { secret: 'ABCDEF', uri: 'otpauth://totp/x?secret=ABCDEF' } }), { status: 200 }));
    const r = await gt.enrollTotp({ accessToken: 'a.b.c', refreshToken: 'r', expiresAt: 0, userId: 'u', factors: [] }, 'Owner phone', true);
    expect(r).toEqual({ ok: true, value: { factorId: 'f9', secret: 'ABCDEF', uri: 'otpauth://totp/x?secret=ABCDEF' } });
  });
  it('S2-8: enrolment is refused without permission or when ANY factor already exists, with no network call', async () => {
    const { gt, calls } = mk(() => new Response('{}', { status: 200 }));
    const none = { accessToken: 'a.b.c', refreshToken: 'r', expiresAt: 0, userId: 'u', factors: [] };
    expect(await gt.enrollTotp(none, 'x', false)).toEqual({ ok: false, code: 'enrol_not_allowed' });
    for (const status of ['verified', 'unverified']) {
      expect(await gt.enrollTotp({ ...none, factors: [{ id: 'f1', type: 'totp', status }] }, 'x', true)).toEqual({ ok: false, code: 'enrol_not_allowed' });
    }
    expect(calls).toHaveLength(0);
  });
  it('S2-8: canEnrolTotp is an explicit yes only', async () => {
    const mkF = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await canEnrolTotp({ token: 't', fetch: mkF(200, { ok: true, data: { allowed: true } }) })).toBe(true);
    expect(await canEnrolTotp({ token: 't', fetch: mkF(200, { ok: true, data: { allowed: false } }) })).toBe(false);
    expect(await canEnrolTotp({ token: 't', fetch: mkF(403, { ok: false }) })).toBe(false);
    expect(await canEnrolTotp({ token: 't', fetch: mkF(200, 'garbage') })).toBe(false);
    expect(await canEnrolTotp({ token: 't', fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch })).toBe(false);
  });
  it('a malformed response is unexpected, never a half session', async () => {
    expect(await mk(() => new Response(JSON.stringify({ access_token: 1 }), { status: 200 })).gt.signInWithPassword('a', 'b')).toEqual({ ok: false, code: 'unexpected' });
  });
});

describe('memory store: every write is audited', () => {
  it('each privileged method adds an audit row; reads add none', async () => {
    const s = new MemoryAdminStore({ now: () => new Date('2026-10-22T10:00:00Z') });
    const P = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
    const before = () => s.state.audit.length;
    const ops: [string, () => Promise<unknown>][] = [
      ['resolveReview', () => s.resolveReview(ACTOR, { videoId: 'fake-vid-1', decision: 'ignore', reason: 'abc' })],
      ['setFieldLock', () => s.setFieldLock(ACTOR, { videoId: 'fake-vid-1', field: 'round', locked: true })],
      ['dismissDuplicate', () => s.dismissDuplicate(ACTOR, { aId: P(1), bId: P(2), reason: 'abc' })],
      ['mergePlayers', () => s.mergePlayers(ACTOR, { keepId: P(5), dropId: P(6), reason: 'abc' })],
      ['splitPlayer', () => s.splitPlayer(ACTOR, { playerId: P(3), newDisplayName: 'Demo New Person', participantIds: [], reason: 'abc' })],
      ['renamePlayer', () => s.renamePlayer(ACTOR, { playerId: P(3), newDisplayName: 'Demo Renamed', reason: 'abc' })],
      ['confirmAdultBulk', () => s.confirmAdultBulk(ACTOR, { playerIds: [P(3)], evidence: 'abc', reason: 'abc' })],
      ['resolveProfileRequest', () => s.resolveProfileRequest(ACTOR, { id: '30000000-0000-4000-8000-000000000001', decision: 'resolve', reason: 'abc' })],
      ['decideTournament', () => s.decideTournament(ACTOR, { id: '20000000-0000-4000-8000-000000000001', decision: 'hide', reason: 'abc' })],
      ['setProtectedMode', () => s.setProtectedMode(ACTOR, { key: 'unknown_match_mode', value: 'hidden', reason: 'abc' })],
      ['emergencyHide', () => s.emergencyHide(ACTOR, { kind: 'youtube_id', value: 'fake-vid-2', reason: 'abc' })],
      ['recordDispatch', () => s.recordDispatch(ACTOR, { kind: 'sync', ok: true })],
      ['updateLead', () => s.updateLead(ACTOR, { id: '60000000-0000-4000-8000-000000000001', to: 'contacted' })],
      ['createPlacement', () => s.createPlacement(ACTOR, { sponsorId: '70000000-0000-4000-8000-000000000001', slot: 'home_partner_strip', creativeDesktopPath: 'c/x.png', alt: 'Demo logo', targetUrl: 'https://sponsor.example.test/', goSlug: 'demo-audit', startDate: '2026-11-01', endDate: '2026-11-02', label: 'Partner' })],
      ['saveProduct', async () => { const p = s.state.products[0]!; return s.saveProduct(ACTOR, { slug: p.slug, name: p.record.name, summary: p.record.summary, priceType: 'fixed', priceRupees: '100', visible: false, sort: 0 }); }],
    ];
    for (const [name, op] of ops) {
      const n = before();
      const r = (await op()) as { ok: boolean };
      expect(r.ok, name).toBe(true);
      expect(s.state.audit.length, name).toBeGreaterThan(n);
      expect(s.state.audit[0]!.actor, name).toBe(ACTOR.userId);
    }
    const n = before();
    await s.getDashboard();
    await s.listReviewQueue({ limit: 5, offset: 0 });
    await s.searchPlayers({ query: 'demo', limit: 5, offset: 0 });
    await s.listDuplicates({ limit: 5 });
    await s.listAudit({ limit: 5 });
    expect(before()).toBe(n);
  });
  it('seed data is fictional and carries no real contact data', () => {
    const s = new MemoryAdminStore();
    const text = JSON.stringify(s.state).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'uuid').replace(/p-[0-9]{16}/g, 'slug');
    // the one allowed fake phone is the documented fictional value (CLAUDE.md); the preview seed ships in every admin bundle, so it
    // holds no email-shaped value at all (the strict privacy scan rejects any address that is not the owner's)
    const bare = text.replace(/910000000000/g, '');
    expect(bare).not.toMatch(/\d{10}/);
    expect(bare).not.toMatch(/@/);
    expect(s.state.videos.every((v) => v.youtubeId.startsWith('fake-'))).toBe(true);
  });
  it('search honours the query and hides merged players', async () => {
    const s = new MemoryAdminStore();
    const r = await s.searchPlayers({ query: 'meena', limit: 10, offset: 0 });
    expect(r.ok && r.data.items.map((p) => p.displayName)).toEqual(['Demo Meena Samplestone']);
  });
});
