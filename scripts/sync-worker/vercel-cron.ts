// PARKED Vercel Cron route (replaces the Cloudflare scheduled Worker; Vercel port 2026-10-22, docs/m3/vercel-facts.md rows 4-5).
// NOT ACTIVE: it lives under scripts/sync-* on purpose, because tests/legal/reality.test.ts keeps sync code out of shipped paths until
// features.youtubeApiData is true. To activate (needs the owner's yes, Vercel PRO because it runs every 5 minutes; Hobby cron is daily at best):
//   1. copy this file to src/pages/api/cron/sync.ts, change the import paths, add `export const prerender = false;`
//   2. add to vercel.json: "crons": [{ "path": "/api/cron/sync", "schedule": "*/5 * * * *" }]
//   3. set CRON_SECRET (Production only, a long random string) and CRON_ENABLED=true in the Vercel project settings.
// Vercel calls the path with GET and, when CRON_SECRET exists, sends `Authorization: Bearer <CRON_SECRET>`. No retries, may duplicate,
// redirects are not followed. Without the matching bearer this route answers 401 and does nothing (fail closed).
import { pickCronEnv, runScheduled } from './scheduled';

/** Constant-time string compare (the bearer is a secret). */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET({ request }: { request: Request }): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return new Response('unauthorised', { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  const outcome = await runScheduled(pickCronEnv(process.env as Record<string, unknown>), { fetch: (input, init) => fetch(input, init), now: new Date() });
  return new Response(JSON.stringify({ ran: outcome !== null }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
