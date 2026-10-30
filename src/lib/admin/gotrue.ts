// Minimal Supabase Auth (GoTrue) REST client for the admin sign-in: email + password, then TOTP (aal2), plus TOTP enrolment.
// Written against the documented endpoints (token?grant_type=password|refresh_token, factors, factors/:id/challenge, factors/:id/verify);
// the PUBLISHABLE key only, never a secret. Sign-ups stay disabled in the project (D-006); this client never creates users.
// The one exception is createGoTrueAdmin at the end (wave 4, D-108): the owner's invitation, run ONLY in the Vercel admin function with
// the secret key handed in by the caller; the browser never calls it and this file never reads a key itself.
// Not yet exercised against a live project (none exists): see docs/m2/admin-notes.md. Tokens are kept in memory by the caller.
export interface GoTrueConfig {
  /** `https://<ref>.supabase.co` */
  url: string;
  publishableKey: string;
  fetch: typeof fetch;
  now?: () => number;
}

export interface Factor {
  id: string;
  type: string;
  status: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
  userId: string;
  factors: Factor[];
}

export type AuthFailure = 'enrol_not_allowed' | 'invalid_credentials' | 'invalid_code' | 'network' | 'unexpected' | 'rate_limited';
export type AuthResult<T> = { ok: true; value: T } | { ok: false; code: AuthFailure };

export interface Enrolment {
  factorId: string;
  /** The shared secret, for manual entry. */
  secret: string;
  /** otpauth:// URI the QR code encodes. */
  uri: string;
}

export function createGoTrue(cfg: GoTrueConfig) {
  const base = `${cfg.url.replace(/\/+$/, '')}/auth/v1`;
  const now = cfg.now ?? (() => Date.now());

  async function call(path: string, init: { body?: object; token?: string }): Promise<AuthResult<Record<string, unknown>>> {
    let res: Response;
    try {
      res = await cfg.fetch(`${base}/${path}`, {
        method: 'POST',
        headers: { apikey: cfg.publishableKey, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
        body: JSON.stringify(init.body ?? {}),
      });
    } catch {
      return { ok: false, code: 'network' };
    }
    if (res.status === 429) return { ok: false, code: 'rate_limited' };
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      // not JSON
    }
    if (res.ok) return { ok: true, value: json };
    return { ok: false, code: res.status === 400 || res.status === 401 || res.status === 422 ? (path.includes('verify') ? 'invalid_code' : 'invalid_credentials') : 'unexpected' };
  }

  function toSession(json: Record<string, unknown>, fallbackFactors: Factor[] = []): AuthSession | null {
    const accessToken = json['access_token'];
    const refreshToken = json['refresh_token'];
    const expiresIn = json['expires_in'];
    const user = json['user'] as { id?: unknown; factors?: unknown } | undefined;
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || typeof expiresIn !== 'number') return null;
    const factorsRaw = Array.isArray(user?.factors) ? (user!.factors as { id?: unknown; factor_type?: unknown; status?: unknown }[]) : null;
    const factors = factorsRaw
      ? factorsRaw.filter((f) => typeof f.id === 'string').map((f) => ({ id: f.id as string, type: String(f.factor_type ?? ''), status: String(f.status ?? '') }))
      : fallbackFactors;
    const userId = typeof user?.id === 'string' ? user.id : userIdFromJwt(accessToken);
    if (!userId) return null;
    return { accessToken, refreshToken, expiresAt: now() + expiresIn * 1000, userId, factors };
  }

  return {
    async signInWithPassword(email: string, password: string): Promise<AuthResult<AuthSession>> {
      const r = await call('token?grant_type=password', { body: { email, password } });
      if (!r.ok) return r;
      const s = toSession(r.value);
      return s ? { ok: true, value: s } : { ok: false, code: 'unexpected' };
    },

    async refresh(session: AuthSession): Promise<AuthResult<AuthSession>> {
      const r = await call('token?grant_type=refresh_token', { body: { refresh_token: session.refreshToken } });
      if (!r.ok) return r;
      const s = toSession(r.value, session.factors);
      return s ? { ok: true, value: s } : { ok: false, code: 'unexpected' };
    },

    verifiedTotpFactors(session: AuthSession): Factor[] {
      return session.factors.filter((f) => f.type === 'totp' && f.status === 'verified');
    },

    /** Challenge + verify in one go. On success the returned session carries aal2. */
    async verifyTotp(session: AuthSession, factorId: string, code: string): Promise<AuthResult<AuthSession>> {
      if (!/^\d{6}$/.test(code)) return { ok: false, code: 'invalid_code' };
      const ch = await call(`factors/${encodeURIComponent(factorId)}/challenge`, { token: session.accessToken });
      if (!ch.ok) return ch;
      const challengeId = ch.value['id'];
      if (typeof challengeId !== 'string') return { ok: false, code: 'unexpected' };
      const v = await call(`factors/${encodeURIComponent(factorId)}/verify`, { token: session.accessToken, body: { challenge_id: challengeId, code } });
      if (!v.ok) return v;
      const s = toSession(v.value, session.factors);
      return s ? { ok: true, value: s } : { ok: false, code: 'unexpected' };
    },

    /**
     * S2-8: refuses to start an enrolment when the session already has ANY factor (a second factor is never added from a password-only
     * session). The Worker check (`session.enrolCheck`) must also have said yes: the caller passes `permitted`. This is a client-side
     * guard; the real lock is the Supabase Auth MFA setting (docs/m2/admin-notes.md, owner step).
     */
    async enrollTotp(session: AuthSession, friendlyName: string, permitted: boolean): Promise<AuthResult<Enrolment>> {
      if (!permitted || session.factors.length > 0) return { ok: false, code: 'enrol_not_allowed' };
      const r = await call('factors', { token: session.accessToken, body: { factor_type: 'totp', friendly_name: friendlyName } });
      if (!r.ok) return r;
      const totp = r.value['totp'] as { secret?: unknown; uri?: unknown } | undefined;
      if (typeof r.value['id'] !== 'string' || typeof totp?.secret !== 'string' || typeof totp?.uri !== 'string') return { ok: false, code: 'unexpected' };
      return { ok: true, value: { factorId: r.value['id'], secret: totp.secret, uri: totp.uri } };
    },
  };
}

function userIdFromJwt(token: string): string | null {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------- invited accounts (D-108, wave 4)
//
// Accepting an invitation in the admin app. Supabase's invitation link (its own email, its own words) opens the redirect address
// with the session in the address fragment (#access_token=...&type=invite) when the project uses the implicit flow; the app then asks
// for a new password (PUT /user), signs in again with it, and the person must enrol a TOTP factor (aal2) before anything works.
// UNVERIFIED against a live project (none exists yet): the fragment shape, PKCE instead of the fragment, and whether PUT /user
// needs a re-authentication on this project's settings. See docs/m5/integration/accounts.md.

export interface InviteRedirect {
  accessToken: string;
  refreshToken: string;
  /** seconds */
  expiresIn: number;
}

/** The session an invitation link carries in the address fragment, or null for anything else (a normal visit, an error, a recovery). */
export function parseInviteRedirect(hash: string): InviteRedirect | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '' || raw.length > 8192) return null;
  const p = new URLSearchParams(raw);
  if (p.get('type') !== 'invite') return null;
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  const expiresIn = Number(p.get('expires_in'));
  if (!accessToken || !refreshToken || !/^[A-Za-z0-9._~+/-]+=*$/.test(accessToken) || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return { accessToken, refreshToken, expiresIn };
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;

/** Plain-English problem with a new password, or null. Supabase may ask for more (its own password settings). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (pw.trim() !== pw) return 'Do not start or end the password with a space.';
  return null;
}

/** Sets the invited person's password with the invitation's session (PUT /auth/v1/user, publishable key). */
export async function setInvitedPassword(cfg: GoTrueConfig, accessToken: string, password: string): Promise<AuthResult<true>> {
  if (passwordProblem(password) !== null) return { ok: false, code: 'invalid_credentials' };
  let res: Response;
  try {
    res = await cfg.fetch(`${cfg.url.replace(/\/+$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: cfg.publishableKey, 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, code: 'network' };
  }
  if (res.ok) return { ok: true, value: true };
  if (res.status === 429) return { ok: false, code: 'rate_limited' };
  return { ok: false, code: res.status === 401 || res.status === 403 || res.status === 422 ? 'invalid_credentials' : 'unexpected' };
}

// ----------------------------------------------------------------------------- the admin side (SERVER ONLY, secret key)
//
// The owner's invitation goes through the Supabase Auth admin API with the SECRET key, from the Vercel admin function only (never the
// browser; this factory takes the key from the caller, which reads it through runtime-env). Documented endpoints, UNVERIFIED against a
// live project: POST /auth/v1/invite {email} (?redirect_to=...) answers the new user (id); PUT /auth/v1/admin/users/<id>
// {ban_duration} blocks sign-in. Sign-ups stay disabled in the project; an admin invitation is expected to work regardless (unverified).

export interface GoTrueAdminConfig {
  /** `https://<ref>.supabase.co` */
  url: string;
  secretKey: string;
  fetch: typeof fetch;
}

export type AdminInviteFailure = 'already_registered' | 'invalid_email' | 'rate_limited' | 'network' | 'unexpected';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** About 100 years: Supabase Auth's way to block a user without deleting them (nothing is deleted). */
export const BAN_DURATION = '876000h';

export function createGoTrueAdmin(cfg: GoTrueAdminConfig) {
  const base = `${cfg.url.replace(/\/+$/, '')}/auth/v1`;
  const headers = { apikey: cfg.secretKey, authorization: `Bearer ${cfg.secretKey}`, 'content-type': 'application/json', accept: 'application/json' };
  return {
    /** Sends Supabase's invitation email. The address is passed on and never kept; the answer is the new user's id only. */
    async invite(email: string, opts: { redirectTo?: string } = {}): Promise<{ ok: true; userId: string } | { ok: false; code: AdminInviteFailure }> {
      const q = opts.redirectTo ? `?redirect_to=${encodeURIComponent(opts.redirectTo)}` : '';
      let res: Response;
      try {
        res = await cfg.fetch(`${base}/invite${q}`, { method: 'POST', headers, body: JSON.stringify({ email }) });
      } catch {
        return { ok: false, code: 'network' };
      }
      if (res.status === 429) return { ok: false, code: 'rate_limited' };
      let json: Record<string, unknown> = {};
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // not JSON
      }
      if (res.ok) {
        const id = json['id'];
        return typeof id === 'string' && UUID_RE.test(id) ? { ok: true, userId: id.toLowerCase() } : { ok: false, code: 'unexpected' };
      }
      // the error text is never passed on: only which of our codes it is
      const errCode = typeof json['error_code'] === 'string' ? (json['error_code'] as string) : '';
      const msg = `${typeof json['msg'] === 'string' ? json['msg'] : ''} ${typeof json['message'] === 'string' ? json['message'] : ''}`.toLowerCase();
      if (errCode === 'email_exists' || errCode === 'user_already_exists' || msg.includes('already been registered') || msg.includes('already registered')) return { ok: false, code: 'already_registered' };
      if (res.status === 400 || res.status === 422 || errCode === 'validation_failed' || errCode === 'email_address_invalid') return { ok: false, code: 'invalid_email' };
      return { ok: false, code: 'unexpected' };
    },

    /** Blocks the user's sign-in (best effort; the database refusal does not wait for it). Never deletes the user. */
    async ban(userId: string): Promise<boolean> {
      if (!UUID_RE.test(userId)) return false;
      try {
        const res = await cfg.fetch(`${base}/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT', headers, body: JSON.stringify({ ban_duration: BAN_DURATION }) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
