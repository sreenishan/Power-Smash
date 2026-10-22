// Minimal Supabase Auth (GoTrue) REST client for the admin sign-in: email + password, then TOTP (aal2), plus TOTP enrolment.
// Written against the documented endpoints (token?grant_type=password|refresh_token, factors, factors/:id/challenge, factors/:id/verify);
// the PUBLISHABLE key only, never a secret. Sign-ups stay disabled in the project (D-006); this client never creates users.
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
