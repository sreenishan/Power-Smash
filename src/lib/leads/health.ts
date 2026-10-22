// GET /api/health (D-039): for the external uptime monitor. It makes NO outbound call and NO database access of any
// kind (no write, no read): it only reports whether this Worker is up and whether the lead endpoint has its secrets.
// The response carries no secret, no version and no detail beyond one word, is not cached and is noindex.
//
// Body: { ok, service, lead, ready, reason?, testMode? }
//  - lead: "ready" or "unconfigured" (kept for the keyword monitor: it alerts on the word "unconfigured").
//  - ready: true/false. When false, `reason` is one word: "missing_secrets", "supabase_url" (not https and *.supabase.co) or
//    "turnstile_test_key" (a Cloudflare TEST secret without TURNSTILE_ALLOW_TEST_KEYS=true: the spam check would accept any
//    token, so the endpoint refuses leads, S-1).
//  - testMode: true only while test Turnstile keys are deliberately allowed (dev and preview). Production must never show it.
import { leadEndpointStatus, type LeadHandlerConfig } from './config';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
} as const;

export function handleHealth(request: Request, config: LeadHandlerConfig | null): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: { ...HEADERS, allow: 'GET, HEAD' } });
  }
  const status = config ? leadEndpointStatus(config) : ({ ready: false, reason: 'missing_secrets' } as const);
  const payload: Record<string, unknown> = {
    ok: true,
    service: 'power-smash',
    lead: status.ready ? 'ready' : 'unconfigured',
    ready: status.ready,
  };
  if (!status.ready) payload.reason = status.reason;
  if (config?.turnstileTestMode) payload.testMode = true;
  const body = JSON.stringify(payload);
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: HEADERS });
}
