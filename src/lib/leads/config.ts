// Typed, validated configuration for the lead/event endpoints, built from the raw runtime environment.
// Pure: no I/O. A missing secret never gets a made-up default; it switches the feature off or marks the endpoint
// "unconfigured" (the handler then degrades to the WhatsApp fallback instead of failing silently).
import type { RuntimeEnv } from '../runtime-env';
import { parseHmacKey } from '../security/hash';
import { DEFAULT_GLOBAL_LEADS_PER_DAY, DEFAULT_GLOBAL_LEADS_PER_HOUR } from '../security/ratelimit';
import { isAcceptableSupabaseUrl } from '../supabase/rest';

/**
 * Cloudflare's published always-pass / always-fail / spent test secrets (checked 2026-10-21). They skip hostname and action
 * checks and the 1x secret accepts ANY token, so they must never be live in production (S-1, R-TURNSTILE-TEST): they are only
 * accepted when the Worker variable TURNSTILE_ALLOW_TEST_KEYS is exactly "true" (dev and preview). The test mode is NEVER
 * switched on from the shape of the key alone.
 */
export const TURNSTILE_TEST_SECRETS = [
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
] as const;

export interface LeadHandlerConfig {
  /** The Supabase project URL, only when it passed isAcceptableSupabaseUrl (S-17); otherwise null. */
  supabaseUrl: string | null;
  /** A SUPABASE_URL / PUBLIC_SUPABASE_URL value was given but refused (not https, not *.supabase.co): the endpoint is not ready. */
  supabaseUrlRefused: boolean;
  /** SUPABASE_ALLOW_LOCAL_URL is exactly "true": a loopback URL (local development) is acceptable. Never set it in production. */
  supabaseAllowLocalUrl: boolean;
  supabaseSecretKey: string | null;
  turnstileSecret: string | null;
  /** The configured secret is one of Cloudflare's published test secrets (whether or not they are allowed). */
  turnstileSecretIsTestValue: boolean;
  /** TURNSTILE_ALLOW_TEST_KEYS is exactly "true" (dev and preview only). */
  turnstileAllowTestKeys: boolean;
  /** Hostnames Turnstile must report. Empty = the hostname of the request itself (never unchecked outside test mode). */
  turnstileHostnames: string[];
  /** A test secret is in use AND allowed: hostname and action checks are skipped (the dummy response says localhost/test). */
  turnstileTestMode: boolean;
  /** Action the widget is rendered with; null = no action check. */
  turnstileAction: string | null;
  hmacKey: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  /** R-TELEGRAM-PHONE: TELEGRAM_ALERT_PHONE_LINK is exactly "true": the owner alert carries the customer's WhatsApp reply link (the phone). Default false. */
  telegramPhoneLink: boolean;
  emailEnabled: boolean;
  resendApiKey: string | null;
  emailFrom: string | null;
  ownerEmail: string | null;
  /** Digits with country code, for the confirmation WhatsApp link (the ONLY source: PUBLIC_WHATSAPP_NUMBER). */
  whatsappNumber: string | null;
  /** Site origin (https://host), used for the same-origin check in addition to the request's own origin. */
  siteOrigin: string | null;
  /** R-ACK-PROMISE: the owner-supplied reply time (site.replyTimePromise) for the acknowledgement email. null = promise nothing. */
  replyWindow: string | null;
  /** S-6: circuit breaker, accepted enquiries per hour across all visitors. Default DEFAULT_GLOBAL_LEADS_PER_HOUR; LEAD_GLOBAL_HOURLY_CAP overrides it. */
  globalHourlyCap: number;
  /** N-3: stored enquiries per 24 hours across all visitors. Default DEFAULT_GLOBAL_LEADS_PER_DAY; LEAD_GLOBAL_DAILY_CAP overrides it. */
  globalDailyCap: number;
}

const clean = (v: string | undefined | null): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export interface BuildTimeFallbacks {
  publicWhatsappNumber?: string;
  publicSupabaseUrl?: string;
  publicSiteUrl?: string;
  /** The owner-supplied reply time from src/content/site.ts (site.replyTimePromise), passed in by the route. */
  replyWindow?: string | null;
}

export function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.origin : null;
  } catch {
    return null;
  }
}

/** A positive whole number from a variable, within sane bounds; anything else gives the default. */
function wholeNumber(v: string | undefined, fallback: number, max: number): number {
  const t = clean(v);
  if (t === null || !/^\d{1,6}$/.test(t)) return fallback;
  const n = Number(t);
  return n >= 1 && n <= max ? n : fallback;
}

export function buildLeadConfig(env: RuntimeEnv, fallbacks: BuildTimeFallbacks = {}): LeadHandlerConfig {
  const secret = clean(env.TURNSTILE_SECRET_KEY);
  const secretIsTestValue = secret !== null && (TURNSTILE_TEST_SECRETS as readonly string[]).includes(secret);
  const allowTestKeys = (env.TURNSTILE_ALLOW_TEST_KEYS ?? '').trim() === 'true';
  const testMode = secretIsTestValue && allowTestKeys;
  const actionRaw = clean(env.TURNSTILE_EXPECTED_ACTION);
  const hostnames = (clean(env.TURNSTILE_EXPECTED_HOSTNAMES) ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  const allowLocalUrl = (env.SUPABASE_ALLOW_LOCAL_URL ?? '').trim() === 'true';
  const urlGiven = clean(env.SUPABASE_URL) ?? clean(env.PUBLIC_SUPABASE_URL) ?? clean(fallbacks.publicSupabaseUrl);
  const urlOk = urlGiven !== null && isAcceptableSupabaseUrl(urlGiven, allowLocalUrl);
  return {
    supabaseUrl: urlOk ? urlGiven : null,
    supabaseUrlRefused: urlGiven !== null && !urlOk,
    supabaseAllowLocalUrl: allowLocalUrl,
    supabaseSecretKey: clean(env.SUPABASE_SECRET_KEY),
    turnstileSecret: secret,
    turnstileSecretIsTestValue: secretIsTestValue,
    turnstileAllowTestKeys: allowTestKeys,
    turnstileHostnames: hostnames,
    turnstileTestMode: testMode,
    turnstileAction: testMode ? null : actionRaw === '-' ? null : (actionRaw ?? 'lead'),
    hmacKey: clean(env.HMAC_KEY),
    telegramBotToken: clean(env.TELEGRAM_BOT_TOKEN),
    telegramChatId: clean(env.TELEGRAM_CHAT_ID),
    telegramPhoneLink: (env.TELEGRAM_ALERT_PHONE_LINK ?? '').trim() === 'true',
    emailEnabled: (env.EMAIL_ENABLED ?? '').trim() === 'true',
    resendApiKey: clean(env.RESEND_API_KEY),
    emailFrom: clean(env.EMAIL_FROM),
    ownerEmail: clean(env.OWNER_EMAIL),
    whatsappNumber: clean(env.PUBLIC_WHATSAPP_NUMBER) ?? clean(fallbacks.publicWhatsappNumber),
    siteOrigin: originOf(clean(env.PUBLIC_SITE_URL) ?? clean(fallbacks.publicSiteUrl)),
    replyWindow: clean(fallbacks.replyWindow ?? null),
    globalHourlyCap: wholeNumber(env.LEAD_GLOBAL_HOURLY_CAP, DEFAULT_GLOBAL_LEADS_PER_HOUR, 10_000),
    globalDailyCap: wholeNumber(env.LEAD_GLOBAL_DAILY_CAP, DEFAULT_GLOBAL_LEADS_PER_DAY, 100_000),
  };
}

/** Why the lead endpoint cannot take a lead (one word, safe to show in /api/health). */
export type LeadNotReadyReason = 'turnstile_test_key' | 'supabase_url' | 'missing_secrets';

export type LeadEndpointStatus = { ready: true } | { ready: false; reason: LeadNotReadyReason };

/**
 * Whether the lead endpoint has everything it needs to store a lead and verify a visitor. A published Turnstile TEST secret
 * without TURNSTILE_ALLOW_TEST_KEYS=true counts as NOT ready (S-1): the spam check would accept any token.
 */
export function leadEndpointStatus(c: LeadHandlerConfig): LeadEndpointStatus {
  if (c.turnstileSecretIsTestValue && !c.turnstileAllowTestKeys) return { ready: false, reason: 'turnstile_test_key' };
  if (c.supabaseUrlRefused) return { ready: false, reason: 'supabase_url' };
  if (c.supabaseUrl === null || c.supabaseSecretKey === null || c.turnstileSecret === null || parseHmacKey(c.hmacKey) === null) {
    return { ready: false, reason: 'missing_secrets' };
  }
  return { ready: true };
}

/** True when the lead endpoint has everything it needs to store a lead and verify a visitor. */
export function leadEndpointConfigured(c: LeadHandlerConfig): boolean {
  return leadEndpointStatus(c).ready;
}
