import { generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { authorizeAdmin, bearerToken, createJwksKeySource, verifyAdminJwt } from '../../src/lib/admin/auth';
import { AUDIENCE, authDeps, EDITOR_ID, ISSUER, makeKeys, NOW, OWNER_ID, signToken, STRANGER_ID } from './_helpers';

const withToken = (t: string | null) => new Request('https://x.test/api/admin/dashboard', { method: 'POST', headers: t ? { authorization: `Bearer ${t}` } : {} });

describe('bearerToken', () => {
  it('accepts a bearer token and rejects other shapes', () => {
    expect(bearerToken(withToken('abc.def.ghi'))).toBe('abc.def.ghi');
    expect(bearerToken(new Request('https://x.test', { headers: { authorization: 'Basic abc' } }))).toBeNull();
    expect(bearerToken(new Request('https://x.test', { headers: { authorization: 'Bearer a b' } }))).toBeNull();
    expect(bearerToken(withToken(null))).toBeNull();
    expect(bearerToken(withToken('a'.repeat(9000)))).toBeNull();
  });
});

describe('verifyAdminJwt', () => {
  it('accepts a good aal2 token', async () => {
    const k = await makeKeys();
    const v = await verifyAdminJwt(await signToken(k), authDeps(k).jwt);
    expect(v).toEqual({ ok: true, userId: OWNER_ID, aal: 'aal2' });
  });
  it('rejects expired, wrong issuer, wrong audience, wrong signature, anon role, bad subject, alg none and HS256', async () => {
    const k = await makeKeys();
    const other = await makeKeys();
    const cfg = authDeps(k).jwt;
    expect(await verifyAdminJwt(await signToken(k, { expiresInSec: -3600 }), cfg)).toEqual({ ok: false, reason: 'expired' });
    expect(await verifyAdminJwt(await signToken(k, { iss: 'https://evil.test/auth/v1' }), cfg)).toEqual({ ok: false, reason: 'wrong_issuer' });
    expect(await verifyAdminJwt(await signToken(k, { aud: 'anon' }), cfg)).toEqual({ ok: false, reason: 'wrong_audience' });
    expect(await verifyAdminJwt(await signToken(other), cfg)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifyAdminJwt(await signToken(k, { role: 'anon' }), cfg)).toEqual({ ok: false, reason: 'bad_claims' });
    expect(await verifyAdminJwt(await signToken(k, { sub: 'not-a-uuid' }), cfg)).toEqual({ ok: false, reason: 'bad_claims' });
    expect(await verifyAdminJwt(null, cfg)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyAdminJwt('garbage', cfg)).toEqual({ ok: false, reason: 'invalid' });
    const none = `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify({ sub: OWNER_ID, iss: ISSUER, aud: AUDIENCE, role: 'authenticated', aal: 'aal2', exp: 9999999999 }))}.`;
    expect((await verifyAdminJwt(none, cfg)).ok).toBe(false);
    const hs = await new SignJWT({ role: 'authenticated', aal: 'aal2' }).setProtectedHeader({ alg: 'HS256' }).setSubject(OWNER_ID).setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('1h').sign(new TextEncoder().encode('0'.repeat(32)));
    expect((await verifyAdminJwt(hs, cfg)).ok).toBe(false);
  });
  it('a missing aal claim reads as aal1', async () => {
    const k = await makeKeys();
    expect(await verifyAdminJwt(await signToken(k, { aal: null }), authDeps(k).jwt)).toMatchObject({ ok: true, aal: 'aal1' });
  });
  it('uses the injected clock for expiry', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { expiresInSec: 60 });
    const later = { ...authDeps(k).jwt, now: () => new Date(NOW.getTime() + 120_000) };
    expect(await verifyAdminJwt(t, later)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('authorizeAdmin', () => {
  it('owner with aal2 passes', async () => {
    const k = await makeKeys();
    const d = await authorizeAdmin(withToken(await signToken(k)), 'players.merge', authDeps(k));
    expect(d).toEqual({ ok: true, actor: { userId: OWNER_ID, role: 'owner' } });
  });
  it('no token or bad token: 401 generic', async () => {
    const k = await makeKeys();
    expect(await authorizeAdmin(withToken(null), 'dashboard', authDeps(k))).toEqual({ ok: false, status: 401, code: 'unauthorized' });
    expect(await authorizeAdmin(withToken('x.y.z'), 'dashboard', authDeps(k))).toEqual({ ok: false, status: 401, code: 'unauthorized' });
  });
  it('aal1 is refused on every action, reads included', async () => {
    const k = await makeKeys();
    for (const action of ['dashboard', 'players.merge', 'settings.setProtectedMode', 'emergency.hide', 'site.publishNow'] as const) {
      expect(await authorizeAdmin(withToken(await signToken(k, { aal: 'aal1' })), action, authDeps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    }
  });
  it('role comes only from the profiles lookup: metadata claims and unknown users get 403', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: STRANGER_ID, extra: { app_metadata: { role: 'owner' }, user_metadata: { role: 'owner' }, user_role: 'owner' } });
    expect(await authorizeAdmin(withToken(t), 'dashboard', authDeps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
  });
  it('editors are disabled at launch (D-007) and still cannot do owner-only actions when enabled', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: EDITOR_ID });
    expect(await authorizeAdmin(withToken(t), 'dashboard', authDeps(k))).toMatchObject({ ok: false, status: 403 });
    expect(await authorizeAdmin(withToken(t), 'dashboard', authDeps(k, { editorsEnabled: true }))).toMatchObject({ ok: false, status: 403 });
  });
  it('a failing profiles lookup fails closed with 503', async () => {
    const k = await makeKeys();
    const d = await authorizeAdmin(withToken(await signToken(k)), 'dashboard', authDeps(k, { roles: async () => { throw new Error('db down'); } }));
    expect(d).toEqual({ ok: false, status: 503, code: 'unavailable' });
  });
  it('401 bodies carry no reason: expired and invalid are identical', async () => {
    const k = await makeKeys();
    const a = await authorizeAdmin(withToken(await signToken(k, { expiresInSec: -3600 })), 'dashboard', authDeps(k));
    const b = await authorizeAdmin(withToken('bad'), 'dashboard', authDeps(k));
    expect(a).toEqual(b);
  });
});

describe('createJwksKeySource', () => {
  it('fetches the JWKS through the injected fetch, caches it and verifies a token', async () => {
    const k = await makeKeys('kid-a');
    let calls = 0;
    let t = 1_000_000;
    const fetchFn = (async (url: string) => {
      calls += 1;
      expect(url).toBe('https://fakeref.supabase.co/auth/v1/.well-known/jwks.json');
      return new Response(JSON.stringify({ keys: [k.jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const keys = createJwksKeySource({ url: 'https://fakeref.supabase.co/auth/v1/.well-known/jwks.json', fetch: fetchFn, now: () => t });
    const cfg = { ...authDeps(k).jwt, keys };
    const token = await signToken(k, { kid: 'kid-a' });
    expect((await verifyAdminJwt(token, cfg)).ok).toBe(true);
    expect((await verifyAdminJwt(token, cfg)).ok).toBe(true);
    expect(calls).toBe(1);
    t += 700_000; // past the ttl
    expect((await verifyAdminJwt(token, cfg)).ok).toBe(true);
    expect(calls).toBe(2);
  });
  it('an unknown key id triggers one rate-limited refresh and then fails', async () => {
    const k = await makeKeys('kid-a');
    const other = await generateKeyPair('ES256');
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ keys: [k.jwk] }), { status: 200 });
    }) as unknown as typeof fetch;
    let t = 0;
    const keys = createJwksKeySource({ url: 'https://x.test/jwks', fetch: fetchFn, now: () => t });
    const cfg = { ...authDeps(k).jwt, keys };
    const forged = await signToken({ privateKey: other.privateKey }, { kid: 'kid-zzz' });
    expect((await verifyAdminJwt(forged, cfg)).ok).toBe(false);
    expect(calls).toBe(1);
    expect((await verifyAdminJwt(forged, cfg)).ok).toBe(false);
    expect(calls).toBe(1); // within the minimum refresh gap
    t += 60_000;
    expect((await verifyAdminJwt(forged, cfg)).ok).toBe(false);
    expect(calls).toBe(2);
  });
  it('a JWKS outage fails verification (closed)', async () => {
    const k = await makeKeys();
    const keys = createJwksKeySource({ url: 'https://x.test/jwks', fetch: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch, now: () => 0 });
    expect((await verifyAdminJwt(await signToken(k), { ...authDeps(k).jwt, keys })).ok).toBe(false);
  });
});
