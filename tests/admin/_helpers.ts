// Shared test helpers: locally generated signing keys (no network), tokens, and a handler wired to the in-memory store.
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import type { AuthDeps } from '../../src/lib/admin/auth';
import { createAdminHandler, type AdminHandlerDeps } from '../../src/lib/admin/handler';
import { MemoryAdminStore } from '../../src/lib/admin/memory-store';
import type { AdminRole } from '../../src/lib/admin/types';

export const ISSUER = 'https://fakeref.supabase.co/auth/v1';
export const AUDIENCE = 'authenticated';
export const OWNER_ID = '9a000000-0000-4000-8000-000000000001';
export const EDITOR_ID = '9a000000-0000-4000-8000-000000000002';
export const STRANGER_ID = '9a000000-0000-4000-8000-000000000003';
export const NOW = new Date('2026-10-22T10:00:00.000Z');

export interface Keys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  jwk: JWK;
}

export async function makeKeys(kid = 'k1'): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { privateKey, publicKey, jwk };
}

export interface TokenOptions {
  sub?: string;
  aal?: string | null;
  role?: string;
  iss?: string;
  aud?: string;
  expiresInSec?: number;
  kid?: string;
  extra?: Record<string, unknown>;
}

export async function signToken(keys: Pick<Keys, 'privateKey'>, o: TokenOptions = {}): Promise<string> {
  const iat = Math.floor(NOW.getTime() / 1000);
  const claims: Record<string, unknown> = { role: o.role ?? 'authenticated', ...(o.aal === null ? {} : { aal: o.aal ?? 'aal2' }), ...o.extra };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: o.kid ?? 'k1' })
    .setSubject(o.sub ?? OWNER_ID)
    .setIssuer(o.iss ?? ISSUER)
    .setAudience(o.aud ?? AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (o.expiresInSec ?? 3600))
    .sign(keys.privateKey);
}

export const roleTable: Record<string, AdminRole> = { [OWNER_ID]: 'owner', [EDITOR_ID]: 'editor' };

export function authDeps(keys: Keys, over: Partial<AuthDeps> = {}): AuthDeps {
  return {
    jwt: { keys: keys.publicKey, issuer: ISSUER, audience: AUDIENCE, now: () => NOW },
    roles: async (id) => roleTable[id] ?? null,
    editorsEnabled: false,
    ...over,
  };
}

export function makeHandler(keys: Keys, over: Partial<AdminHandlerDeps> = {}, store = new MemoryAdminStore({ now: () => NOW })) {
  const deps: AdminHandlerDeps = { auth: authDeps(keys), store, dispatch: null, allowedOrigins: ['https://admin.example.test'], ...over };
  return { handle: createAdminHandler(deps), store, deps };
}

export function req(action: string, token: string | null, body: unknown = {}, init: { method?: string; origin?: string } = {}): Request {
  return new Request(`https://admin.example.test/api/admin/${action}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.origin ? { origin: init.origin } : {}) },
    body: init.method === 'GET' ? undefined : JSON.stringify(body),
  });
}
