import type { APIRoute } from 'astro';
import { adminDepsCacheKey, buildAdminDeps, pickAdminEnv } from '../../../lib/admin/config';
import { createAdminHandler, type AdminHandlerDeps } from '../../../lib/admin/handler';
import { withBakedSupabaseUrl } from '../../../lib/runtime-env';
import { getLeadConfig } from '../../../lib/runtime-env';
import { createSubscriberDispatch } from '../../../lib/notices/dispatch';

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

// Cached for the function instance so the JWKS cache survives between requests; rebuilt if the environment changes. The key holds
// the admin settings AND the lead endpoint's email settings the notices dispatcher closes over (EMAIL_ENABLED, keys, sender), so a
// changed email switch is never served from an old instance. The key lives in memory only and is never logged.
let cached: { key: string; deps: AdminHandlerDeps | null } | null = null;

const handle: APIRoute = async ({ request, params }) => {
  const env = pickAdminEnv(await readEnv());
  const leadConfig = await getLeadConfig();
  const key = adminDepsCacheKey(env, leadConfig);
  if (!cached || cached.key !== key) {
    const fetchFn = globalThis.fetch.bind(globalThis);
    const now = () => new Date();
    // the email updates list (D-114): sending uses the lead endpoint's email settings (EMAIL_ENABLED, RESEND_API_KEY, EMAIL_FROM, PUBLIC_SITE_URL, HMAC_KEY)
    const notices = createSubscriberDispatch({ config: leadConfig, fetch: fetchFn, now });
    cached = { key, deps: buildAdminDeps(env, { fetch: fetchFn, now, notices }) };
  }
  const deps = cached.deps;
  if (!deps) return new Response(JSON.stringify({ ok: false, code: 'unavailable' }), { status: 503, headers: HEADERS });
  return createAdminHandler(deps)(request, params.action ?? '');
};

export const ALL = handle;
