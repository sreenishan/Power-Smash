// Runtime configuration for on-demand endpoints (secrets and settings).
//
// Vercel port (2026-10-22): functions run on Node and read `process.env`, which Vercel fills from the project's environment
// variables (docs/m3/vercel-facts.md). There is no `cloudflare:workers` module and no Worker bindings any more; the optional
// rate-limiter bindings stay in the type so the handlers keep one contract, and are simply undefined on Vercel (the database
// counter and the global caps remain). Pages must never import this file; it is for `prerender = false` endpoints and tests.
//
// Local dev: `.env` (git-ignored) holds DEV values only. Names, never values, live in `.env.example`.
import type { BuildTimeFallbacks, LeadHandlerConfig } from './leads/config';

/** Names the lead/event endpoints read. All optional: a missing value switches a feature off or degrades, never invents a default. */
export interface RuntimeEnv {
  SUPABASE_URL?: string;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Exactly `true` accepts Cloudflare's published Turnstile TEST secrets (dev and preview ONLY, S-1). Without it a test secret makes the endpoint not ready. */
  TURNSTILE_ALLOW_TEST_KEYS?: string;
  /** Comma-separated hostnames the Turnstile widget may be served from (hostname check). Empty = not checked. */
  TURNSTILE_EXPECTED_HOSTNAMES?: string;
  /** Turnstile action the widget is rendered with (`data-action`). Default `lead`. Set to `-` to skip the check. */
  TURNSTILE_EXPECTED_ACTION?: string;
  HMAC_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  /** Exactly `true` puts the customer's WhatsApp reply link (their phone number) and the district in the owner alert. Default: no phone (R-TELEGRAM-PHONE). */
  TELEGRAM_ALERT_PHONE_LINK?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  OWNER_EMAIL?: string;
  /** Exactly `true` switches email alerts and the customer acknowledgement on. Off until the sending domain is verified (D-022). */
  EMAIL_ENABLED?: string;
  PUBLIC_WHATSAPP_NUMBER?: string;
  PUBLIC_SITE_URL?: string;
  /** Exactly `true` lets SUPABASE_URL be a loopback address (local development ONLY, S-17). Never set it on a deployed site. */
  SUPABASE_ALLOW_LOCAL_URL?: string;
  /** Optional whole number: accepted enquiries per hour before the circuit breaker refuses new ones (S-6). Default in src/lib/security/ratelimit.ts. */
  LEAD_GLOBAL_HOURLY_CAP?: string;
  /** Optional whole number: stored enquiries per 24 hours across all visitors before the daily breaker refuses new ones (N-3). Default in src/lib/security/ratelimit.ts. */
  LEAD_GLOBAL_DAILY_CAP?: string;
  /** Optional rate-limiter binding. Not available on Vercel (always undefined); kept so tests and handlers share one contract. */
  LEAD_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  EVENT_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const NAMES = [
  'SUPABASE_URL',
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'TURNSTILE_SECRET_KEY',
  'TURNSTILE_ALLOW_TEST_KEYS',
  'TURNSTILE_EXPECTED_HOSTNAMES',
  'TURNSTILE_EXPECTED_ACTION',
  'HMAC_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_ALERT_PHONE_LINK',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'OWNER_EMAIL',
  'EMAIL_ENABLED',
  'PUBLIC_WHATSAPP_NUMBER',
  'PUBLIC_SITE_URL',
  'SUPABASE_ALLOW_LOCAL_URL',
  'LEAD_GLOBAL_HOURLY_CAP',
  'LEAD_GLOBAL_DAILY_CAP',
] as const;

const BINDINGS = ['LEAD_RATE_LIMITER', 'EVENT_RATE_LIMITER'] as const;

function pick(source: Record<string, unknown>): RuntimeEnv {
  const out: Record<string, unknown> = {};
  for (const name of NAMES) {
    const v = source[name];
    if (typeof v === 'string' && v.trim() !== '') out[name] = v.trim();
  }
  for (const name of BINDINGS) {
    const b = source[name] as { limit?: unknown } | undefined;
    if (b && typeof b.limit === 'function') out[name] = b;
  }
  return out as RuntimeEnv;
}

/**
 * The build-time `PUBLIC_SUPABASE_URL` (a GitHub BUILD variable, inlined by Vite into the function bundle), trimmed; blank or absent = undefined.
 * It is NOT in Vercel's runtime environment, so code that reads only `process.env` cannot see it. Written as the plain expression
 * `import.meta.env.PUBLIC_SUPABASE_URL` on purpose: Vite only inlines that exact form.
 */
export function bakedPublicSupabaseUrl(): string | undefined {
  const v = import.meta.env.PUBLIC_SUPABASE_URL;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

const isSet = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * Returns a COPY of `source` that also carries the baked public Supabase URL as `PUBLIC_SUPABASE_URL`, but only when neither
 * `SUPABASE_URL` nor `PUBLIC_SUPABASE_URL` is set at run time (a runtime value always wins; nothing is invented when no value exists).
 * `baked` is injectable for tests. `source` itself (usually `process.env`) is never written to.
 */
export function withBakedSupabaseUrl(source: Record<string, unknown>, baked: string | undefined = bakedPublicSupabaseUrl()): Record<string, unknown> {
  if (isSet(source.SUPABASE_URL) || isSet(source.PUBLIC_SUPABASE_URL)) return { ...source };
  if (baked === undefined || baked.trim() === '') return { ...source };
  return { ...source, PUBLIC_SUPABASE_URL: baked.trim() };
}

/** Reads the runtime environment: `process.env` (Vercel functions, Node tests and tooling), plus the baked public Supabase URL as a fallback. */
export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return pick(withBakedSupabaseUrl(proc?.env ?? {}));
}

/** Normalise the raw environment into the typed config the handlers use. See ./leads/config.ts. */
export async function getLeadConfig(callerValues: BuildTimeFallbacks = {}): Promise<LeadHandlerConfig> {
  const { buildLeadConfig } = await import('./leads/config');
  return buildLeadConfig(await getRuntimeEnv(), {
    ...callerValues, // for example { replyWindow: site.replyTimePromise } from the route (R-ACK-PROMISE)
    // Build-time public variables (inlined by Vite) as the fallback when no runtime variable of the same name is set.
    publicWhatsappNumber: import.meta.env.PUBLIC_WHATSAPP_NUMBER,
    publicSupabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL,
    publicSiteUrl: import.meta.env.PUBLIC_SITE_URL,
  });
}
