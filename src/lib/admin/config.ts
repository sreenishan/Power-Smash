// Builds the admin handler's dependencies from the Worker environment (names only; values live in the Worker). PURE apart from the
// injected fetch and clock, so it is testable. Returns null when the backend is not configured: the route then answers 503 and
// nothing is ever served from a guess.
import { createJwksKeySource } from './auth';
import { organizerAccountsEnabled } from './accounts/access';
import { createSupabaseRoleLookup, createSupabaseScopeDeps } from './accounts/supabase-backend';
import { createGoTrueAdmin } from './gotrue';
import type { DispatchSummary } from '../notify/outbox/dispatcher';
import { createGithubDispatch } from './dispatch';
import type { AdminHandlerDeps } from './handler';
import { createSupabaseAdminStore } from './supabase-store';
import { isAcceptableSupabaseUrl } from '../supabase/rest';
import { features } from '../../content/legal/status';

/**
 * Organizer and scorer access on the server: ORGANIZER_ACCOUNTS_ENABLED exactly 'true' AND the legal flag features.organizerAccounts
 * (the privacy page then says that invited organizers enter results). Either one off = owner only, whatever the database switch says.
 */
export function organizerAccessServerOn(value: unknown, flags: unknown = features): boolean {
  const f = flags && typeof flags === 'object' ? (flags as Record<string, unknown>) : {};
  return organizerAccountsEnabled(value) && f.organizerAccounts === true;
}

export interface AdminEnv {
  SUPABASE_URL?: string;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_ALLOW_LOCAL_URL?: string;
  REBUILD_DISPATCH_TOKEN?: string;
  /** Comma-separated origins of the admin hostname(s) allowed to call the API. */
  ADMIN_ALLOWED_ORIGINS?: string;
  /** `owner/name` of the repository that holds the workflows. */
  ADMIN_GITHUB_REPO?: string;
  /** Workflow file names. Publish defaults to the one deploy workflow in this repo; sync has no default (the file does not exist yet). */
  ADMIN_DEPLOY_WORKFLOW?: string;
  ADMIN_SYNC_WORKFLOW?: string;
  ADMIN_DISPATCH_REF?: string;
  /** Exactly `true` enables editors (D-007: not before the RLS matrix tests pass). Absent = owner only. */
  ADMIN_EDITORS_ENABLED?: string;
  /**
   * Exactly `true` lets invited organizers and scorers sign in and work on their tournaments (D-108). Anything else = owner only.
   * The owner's database switch (Accounts screen) must be on as well.
   */
  ORGANIZER_ACCOUNTS_ENABLED?: string;
  /** Optional: the admin address an invitation link opens (also in Supabase Auth's allowed redirect URLs). Absent = the project's Site URL. */
  ADMIN_INVITE_REDIRECT_URL?: string;
}

export const ADMIN_ENV_NAMES = [
  'SUPABASE_URL',
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ALLOW_LOCAL_URL',
  'REBUILD_DISPATCH_TOKEN',
  'ADMIN_ALLOWED_ORIGINS',
  'ADMIN_GITHUB_REPO',
  'ADMIN_DEPLOY_WORKFLOW',
  'ADMIN_SYNC_WORKFLOW',
  'ADMIN_DISPATCH_REF',
  'ADMIN_EDITORS_ENABLED',
  'ORGANIZER_ACCOUNTS_ENABLED',
  'ADMIN_INVITE_REDIRECT_URL',
] as const;

export function pickAdminEnv(source: Record<string, unknown>): AdminEnv {
  const out: Record<string, string> = {};
  for (const n of ADMIN_ENV_NAMES) {
    const v = source[n];
    if (typeof v === 'string' && v.trim() !== '') out[n] = v.trim();
  }
  return out as AdminEnv;
}

/** An https invitation address, or undefined (anything else is ignored: Supabase then uses the project's Site URL). */
function inviteRedirect(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function buildAdminDeps(
  env: AdminEnv,
  io: { fetch: typeof fetch; now: () => Date; notices?: { emailReady: () => boolean; dispatch: () => Promise<DispatchSummary | null> }; flags?: unknown },
): AdminHandlerDeps | null {
  const url = env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  const allowLocal = env.SUPABASE_ALLOW_LOCAL_URL === 'true';
  if (!url || !secret || !isAcceptableSupabaseUrl(url, allowLocal)) return null;
  const origin = url.replace(/\/+$/, '');
  const organizersOn = organizerAccessServerOn(env.ORGANIZER_ACCOUNTS_ENABLED, io.flags ?? features);
  const redirectTo = inviteRedirect(env.ADMIN_INVITE_REDIRECT_URL);
  const store = createSupabaseAdminStore({
    url,
    secretKey: secret,
    fetch: io.fetch,
    allowLocalUrl: allowLocal,
    now: io.now,
    accounts: { invites: createGoTrueAdmin({ url, secretKey: secret, fetch: io.fetch }), organizerAccountsEnabled: organizersOn, ...(redirectTo ? { redirectTo } : {}) },
    ...(io.notices ? { notices: io.notices } : {}),
  });

  // service-role reads for the guard: the role (profiles.role, an ended account = none) and the per-tournament scope (D-108)
  const select = async <T>(table: string, query: string): Promise<T[]> => {
    const res = await io.fetch(`${origin}/rest/v1/${table}?${query}`, { headers: { apikey: secret, accept: 'application/json' } });
    if (!res.ok) throw new Error('profiles_unavailable');
    return (await res.json()) as T[];
  };
  const roles = createSupabaseRoleLookup({ select });

  const dispatch =
    env.REBUILD_DISPATCH_TOKEN && env.ADMIN_GITHUB_REPO && env.ADMIN_SYNC_WORKFLOW
      ? createGithubDispatch({
          token: env.REBUILD_DISPATCH_TOKEN,
          repo: env.ADMIN_GITHUB_REPO,
          workflows: { sync: env.ADMIN_SYNC_WORKFLOW, publish: env.ADMIN_DEPLOY_WORKFLOW ?? 'deploy.yml' },
          ref: env.ADMIN_DISPATCH_REF ?? 'main',
          fetch: io.fetch,
        })
      : null;

  // GoTrue admin API: the user's factors. Service key only, never returned to the browser.
  const factorCount = async (userId: string): Promise<number> => {
    const res = await io.fetch(`${origin}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: { apikey: secret, authorization: `Bearer ${secret}`, accept: 'application/json' } });
    if (!res.ok) throw new Error('auth_admin_unavailable');
    const body = (await res.json()) as { factors?: unknown };
    return Array.isArray(body.factors) ? body.factors.length : 0;
  };

  return {
    factorCount,
    auth: {
      jwt: {
        keys: createJwksKeySource({ url: `${origin}/auth/v1/.well-known/jwks.json`, fetch: io.fetch, now: () => io.now().getTime() }),
        issuer: `${origin}/auth/v1`,
        audience: 'authenticated',
        now: io.now,
      },
      roles,
      editorsEnabled: env.ADMIN_EDITORS_ENABLED === 'true',
      organizerAccountsEnabled: organizersOn,
    },
    scope: organizersOn ? createSupabaseScopeDeps({ select }) : null,
    store,
    dispatch,
    allowedOrigins: (env.ADMIN_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''),
  };
}

/**
 * The warm-instance cache key of the admin dependencies: the admin settings AND the lead settings the notices dispatcher uses
 * (finding: a changed EMAIL_ENABLED must never keep an old dispatcher). In memory only; never logged or returned.
 */
export function adminDepsCacheKey(env: AdminEnv, leadConfig: unknown): string {
  return JSON.stringify([env, leadConfig ?? null]);
}
