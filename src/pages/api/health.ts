import type { APIRoute } from 'astro';
import { handleHealth } from '../../lib/leads/health';
import { getLeadConfig } from '../../lib/runtime-env';

// D-039: the uptime monitor calls this. On-demand (runs in the Worker), NO database access of any kind, no secrets in
// the response. It only reports whether the lead endpoint has its secrets. Logic and tests: src/lib/leads/health.ts.
export const prerender = false;

export const GET: APIRoute = async ({ request }) => handleHealth(request, await getLeadConfig().catch(() => null));
export const HEAD: APIRoute = GET;
