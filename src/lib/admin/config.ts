// Builds the admin handler's dependencies from the Worker environment (names only; values live in the Worker). PURE apart from the
// injected fetch and clock, so it is testable. Returns null when the backend is not configured: the route then answers 503 and
// nothing is ever served from a guess.
import { createJwksKeySource } from './auth';
import { createGithubDispatch } from './dispatch';
import type { AdminHandlerDeps } from './handler';
import { createSupabaseAdminStore } from './supabase-store';
import { isAcceptableSupabaseUrl } from '../supabase/rest';
import type { AdminRole } from './types';

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
] as const;

export function pickAdminEnv(source: Record<string, unknown>): AdminEnv {
  const out: Record<string, string> = {};
  for (const n of ADMIN_ENV_NAMES) {
    const v = source[n];
    if (typeof v === 'string' && v.trim() !== '') out[n] = v.trim();
  }
  return out as AdminEnv;
}

export function buildAdminDeps(env: AdminEnv, io: { fetch: typeof fetch; now: () => Date }): AdminHandlerDeps | null {
  const url = env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  const allowLocal = env.SUPABASE_ALLOW_LOCAL_URL === 'true';
  if (!url || !secret || !isAcceptableSupabaseUrl(url, allowLocal)) return null;
  const origin = url.replace(/\/+$/, '');
  const store = createSupabaseAdminStore({ url, secretKey: secret, fetch: io.fetch, allowLocalUrl: allowLocal, now: io.now });

  const roles = async (userId: string): Promise<AdminRole | null> => {
    const res = await io.fetch(`${origin}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: { apikey: secret, accept: 'application/json' } });
    if (!res.ok) throw new Error('profiles_unavailable');
    const rows = (await res.json()) as { role?: unknown }[];
    const role = rows[0]?.role;
    return role === 'owner' || role === 'editor' ? role : null;
  };

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
    },
    store,
    dispatch,
    allowedOrigins: (env.ADMIN_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''),
  };
}
