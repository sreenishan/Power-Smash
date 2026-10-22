import type { APIRoute } from 'astro';
import { buildAdminDeps, pickAdminEnv } from '../../../lib/admin/config';
import { createAdminHandler, type AdminHandlerDeps } from '../../../lib/admin/handler';
import { withBakedSupabaseUrl } from '../../../lib/runtime-env';

// Owner-only admin API (D-006, D-007). On-demand serverless endpoint; the logic and its tests live in src/lib/admin/*.
// POST /api/admin/<action>, bearer JWT (aal2) in the Authorization header, no cookies, JSON in and out.
export const prerender = false;

// `process.env` plus the build-time PUBLIC_SUPABASE_URL as a fallback (it is a GitHub build variable, not in Vercel's runtime
// environment; without this the admin answered 503 although the lead endpoint was ready). A runtime SUPABASE_URL always wins.
async function readEnv(): Promise<Record<string, unknown>> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return withBakedSupabaseUrl(env);
}

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };

// Cached for the function instance so the JWKS cache survives between requests; rebuilt if the environment changes.
let cached: { key: string; deps: AdminHandlerDeps | null } | null = null;

const handle: APIRoute = async ({ request, params }) => {
  const env = pickAdminEnv(await readEnv());
  const key = JSON.stringify(env);
  if (!cached || cached.key !== key) cached = { key, deps: buildAdminDeps(env, { fetch: globalThis.fetch.bind(globalThis), now: () => new Date() }) };
  const deps = cached.deps;
  if (!deps) return new Response(JSON.stringify({ ok: false, code: 'unavailable' }), { status: 503, headers: HEADERS });
  return createAdminHandler(deps)(request, params.action ?? '');
};

export const ALL = handle;
