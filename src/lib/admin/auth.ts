// Admin auth guard (D-006, D-007), pure and injectable: no Worker globals, no network of its own.
//   1. Bearer JWT verified with `jose` against an injected key source (the project's JWKS in production, a local key in tests):
//      signature, `iss`, `aud`, `exp` (and `nbf`), asymmetric algorithms only (no HS256: the project secret is never a verifier).
//   2. `aal` claim must be exactly `aal2` for EVERY privileged route (D-006).
//   3. Role comes ONLY from the `profiles` lookup (injected), never from JWT metadata. Editors are disabled by D-007.
//   4. Failures return generic bodies: 401 `unauthorized`, 403 `forbidden`; the reason is never revealed to the caller.
import { importJWK, jwtVerify, type JWK, type JWTVerifyGetKey, type CryptoKey, type KeyObject } from 'jose';
import { isActionAllowed, isAdminAction, type AdminActionName } from './policy';
import { ACCOUNT_ACTIONS, isAccountAction, isStaffWideAction, scopedNeed } from './accounts/access';
import { isScopedRole, type PlatformActor, type PlatformRole } from './accounts/types';
import type { Actor, AdminRole } from './types';

export type KeySource = JWTVerifyGetKey | CryptoKey | KeyObject;

export interface JwtConfig {
  keys: KeySource;
  /** `https://<ref>.supabase.co/auth/v1` */
  issuer: string;
  /** Supabase user tokens carry `authenticated`. */
  audience: string;
  now: () => Date;
  clockToleranceSec?: number;
}

/** Profiles lookup (interface; the real one reads `profiles.role` with the service role). null = no profile. */
export type RoleLookup = (userId: string) => Promise<AdminRole | null>;

export interface AuthDeps {
  jwt: JwtConfig;
  roles: RoleLookup;
  editorsEnabled: boolean;
}

export type JwtFailure = 'missing' | 'invalid' | 'expired' | 'wrong_issuer' | 'wrong_audience' | 'bad_claims' | 'not_aal2';

export type VerifiedToken = { ok: true; userId: string; aal: string } | { ok: false; reason: JwtFailure };

const ALGORITHMS = ['ES256', 'RS256'];
const MAX_TOKEN_CHARS = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header.trim());
  if (!m || m[1]!.length > MAX_TOKEN_CHARS) return null;
  return m[1]!;
}

/** Verifies signature, issuer, audience, expiry; returns the user id and the `aal` claim. Does NOT check aal2 or the role. */
export async function verifyAdminJwt(token: string | null, cfg: JwtConfig): Promise<VerifiedToken> {
  if (!token) return { ok: false, reason: 'missing' };
  try {
    const verify = jwtVerify as (jwt: string, key: KeySource, opts: object) => ReturnType<typeof jwtVerify>;
    const { payload } = await verify(token, cfg.keys, {
      issuer: cfg.issuer,
      audience: cfg.audience,
      algorithms: ALGORITHMS,
      currentDate: cfg.now(),
      clockTolerance: cfg.clockToleranceSec ?? 5,
      requiredClaims: ['sub', 'exp', 'iss', 'aud'],
    });
    const sub = payload.sub;
    if (typeof sub !== 'string' || !UUID.test(sub)) return { ok: false, reason: 'bad_claims' };
    // Supabase: role claim is `authenticated` for signed-in users (`anon` for the publishable key, which must never pass).
    if (payload['role'] !== 'authenticated') return { ok: false, reason: 'bad_claims' };
    const aal = typeof payload['aal'] === 'string' ? (payload['aal'] as string) : 'aal1';
    return { ok: true, userId: sub.toLowerCase(), aal };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') return { ok: false, reason: 'expired' };
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      const claim = (e as { claim?: string }).claim;
      return { ok: false, reason: claim === 'iss' ? 'wrong_issuer' : claim === 'aud' ? 'wrong_audience' : 'bad_claims' };
    }
    return { ok: false, reason: 'invalid' };
  }
}

export type AuthDecision = { ok: true; actor: Actor } | { ok: false; status: 401 | 403 | 503; code: 'unauthorized' | 'forbidden' | 'unavailable' };

/** The whole guard for one privileged action. Order: token, aal2, role lookup, policy. Fails closed. */
export async function authorizeAdmin(request: Request, action: AdminActionName, deps: AuthDeps): Promise<AuthDecision> {
  const verified = await verifyAdminJwt(bearerToken(request), deps.jwt);
  if (!verified.ok) return { ok: false, status: 401, code: 'unauthorized' };
  if (verified.aal !== 'aal2') return { ok: false, status: 403, code: 'forbidden' };
  let role: AdminRole | null;
  try {
    role = await deps.roles(verified.userId);
  } catch {
    return { ok: false, status: 503, code: 'unavailable' };
  }
  if (role !== 'owner' && role !== 'editor') return { ok: false, status: 403, code: 'forbidden' };
  if (!isActionAllowed(role, action, { editorsEnabled: deps.editorsEnabled })) return { ok: false, status: 403, code: 'forbidden' };
  return { ok: true, actor: { userId: verified.userId, role } };
}

/**
 * S2-8: the ONE route that accepts an aal1 (password-only) session: "may this user enrol a TOTP factor now?". The caller must still
 * hold a valid token AND an owner row in `profiles`; nothing else is reachable at aal1. Answering `allowed` is separate (handler).
 */
export async function authorizeEnrolCheck(request: Request, deps: AuthDeps): Promise<AuthDecision> {
  const verified = await verifyAdminJwt(bearerToken(request), deps.jwt);
  if (!verified.ok) return { ok: false, status: 401, code: 'unauthorized' };
  let role: AdminRole | null;
  try {
    role = await deps.roles(verified.userId);
  } catch {
    return { ok: false, status: 503, code: 'unavailable' };
  }
  if (role !== 'owner') return { ok: false, status: 403, code: 'forbidden' };
  return { ok: true, actor: { userId: verified.userId, role } };
}

// ----------------------------------------------------------------------------- JWKS key source (injected fetch, cached)

export interface JwksOptions {
  /** `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` */
  url: string;
  fetch: typeof fetch;
  now: () => number;
  /** Cache lifetime. Default 10 minutes. A key id that is not in the cache forces ONE refresh (rotation), rate limited. */
  ttlMs?: number;
  minRefreshMs?: number;
}

export function createJwksKeySource(opts: JwksOptions): JWTVerifyGetKey {
  const ttl = opts.ttlMs ?? 600_000;
  const minRefresh = opts.minRefreshMs ?? 30_000;
  let keys: JWK[] = [];
  let fetchedAt = -Infinity;
  const refresh = async (): Promise<void> => {
    const res = await opts.fetch(opts.url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('jwks_unavailable');
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error('jwks_malformed');
    keys = body.keys.filter((k): k is JWK => typeof k === 'object' && k !== null);
    fetchedAt = opts.now();
  };
  return async (header) => {
    const age = opts.now() - fetchedAt;
    if (age > ttl) await refresh();
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk && opts.now() - fetchedAt > minRefresh) {
      await refresh();
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk || !header.kid) throw new Error('jwks_no_matching_key');
    const key = await importJWK({ ...jwk, alg: header.alg ?? jwk.alg }, header.alg);
    return key as CryptoKey;
  };
}

// ----------------------------------------------------------------------------- organizer and scorer accounts (D-108, wave 4)
//
// The same guard, widened to the four roles of migration 0019. The owner and editors are decided exactly as by authorizeAdmin; an
// organizer or scorer passes ONLY when ORGANIZER_ACCOUNTS_ENABLED is exactly 'true' AND the action is in their role-to-action map
// (accounts/access.ts). Which tournament they may touch is the next step (accounts/scoped-store.ts, before the store), and the database
// checks it a third time (app.require_competition_access). aal2 stays required for every role. Until the integrator switches the
// handler to this function, only the owner can sign in, as today.

export type PlatformRoleLookup = (userId: string) => Promise<PlatformRole | null>;

export interface PlatformAuthDeps {
  jwt: JwtConfig;
  /** profiles.role, null for no row, an unknown role or an ended account (accounts/access.ts roleFromProfileRow). */
  roles: PlatformRoleLookup;
  editorsEnabled: boolean;
  /** ORGANIZER_ACCOUNTS_ENABLED exactly 'true' (runtime-env). false = organizers and scorers are refused everywhere, at aal1 too. */
  organizerAccountsEnabled: boolean;
}

export type PlatformAuthDecision = { ok: true; actor: PlatformActor } | { ok: false; status: 401 | 403 | 503; code: 'unauthorized' | 'forbidden' | 'unavailable' };

/** May this role call this action at all (before any tournament check)? Pure; the account actions are owner only. */
export function isPlatformActionAllowed(role: PlatformRole | null, action: string, opts: { editorsEnabled: boolean; organizerAccountsEnabled: boolean }): boolean {
  if (role === null) return false;
  if (isScopedRole(role)) return opts.organizerAccountsEnabled && (scopedNeed(role, action) !== null || isStaffWideAction(action));
  if (isAccountAction(action)) return (ACCOUNT_ACTIONS[action].roles as readonly string[]).includes(role) && (role !== 'editor' || opts.editorsEnabled);
  return isAdminAction(action) && isActionAllowed(role, action, { editorsEnabled: opts.editorsEnabled });
}

/** The whole guard for one privileged action, any role. Order: token, aal2, role lookup, policy. Fails closed with generic bodies. */
export async function authorizePlatform(request: Request, action: string, deps: PlatformAuthDeps): Promise<PlatformAuthDecision> {
  const verified = await verifyAdminJwt(bearerToken(request), deps.jwt);
  if (!verified.ok) return { ok: false, status: 401, code: 'unauthorized' };
  if (verified.aal !== 'aal2') return { ok: false, status: 403, code: 'forbidden' };
  let role: PlatformRole | null;
  try {
    role = await deps.roles(verified.userId);
  } catch {
    return { ok: false, status: 503, code: 'unavailable' };
  }
  if (!isPlatformActionAllowed(role, action, { editorsEnabled: deps.editorsEnabled, organizerAccountsEnabled: deps.organizerAccountsEnabled })) {
    return { ok: false, status: 403, code: 'forbidden' };
  }
  return { ok: true, actor: { userId: verified.userId, role: role as PlatformRole } };
}

/**
 * S2-8 for the wider roles: "may this aal1 session enrol a first TOTP factor?". The owner as before; an organizer or scorer only while
 * ORGANIZER_ACCOUNTS_ENABLED is exactly 'true' (an invited person must set up two-step sign-in before anything else). Editors never.
 */
export async function authorizeEnrolCheckPlatform(request: Request, deps: PlatformAuthDeps): Promise<PlatformAuthDecision> {
  const verified = await verifyAdminJwt(bearerToken(request), deps.jwt);
  if (!verified.ok) return { ok: false, status: 401, code: 'unauthorized' };
  let role: PlatformRole | null;
  try {
    role = await deps.roles(verified.userId);
  } catch {
    return { ok: false, status: 503, code: 'unavailable' };
  }
  if (role === 'owner' || (isScopedRole(role) && deps.organizerAccountsEnabled)) return { ok: true, actor: { userId: verified.userId, role } };
  return { ok: false, status: 403, code: 'forbidden' };
}

/**
 * "Which role does this aal2 session have?" (the admin app asks once after sign-in, to show the right areas). Answers only for a role
 * that may use the admin at all: the owner, an editor while editors are on, or an organizer or scorer while ORGANIZER_ACCOUNTS_ENABLED
 * is exactly 'true'. Reveals nothing else; the server decides every action again on its own.
 */
export async function authorizeSessionRole(request: Request, deps: PlatformAuthDeps): Promise<PlatformAuthDecision> {
  const verified = await verifyAdminJwt(bearerToken(request), deps.jwt);
  if (!verified.ok) return { ok: false, status: 401, code: 'unauthorized' };
  if (verified.aal !== 'aal2') return { ok: false, status: 403, code: 'forbidden' };
  let role: PlatformRole | null;
  try {
    role = await deps.roles(verified.userId);
  } catch {
    return { ok: false, status: 503, code: 'unavailable' };
  }
  const usable = role === 'owner' || (role === 'editor' && deps.editorsEnabled) || (isScopedRole(role) && deps.organizerAccountsEnabled);
  if (!usable || role === null) return { ok: false, status: 403, code: 'forbidden' };
  return { ok: true, actor: { userId: verified.userId, role } };
}
