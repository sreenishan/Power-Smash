/// <reference types="astro/client" />

// Public build variables (D-027). Only PUBLIC_* values may reach the browser. Names only; no values in the repo.
interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_WHATSAPP_NUMBER?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Exactly "true" turns indexing on (G1 only). Anything else: noindex everywhere and a disallow-all robots.txt. */
  readonly PUBLIC_ALLOW_INDEXING?: string;
  /** Cloudflare Web Analytics token (public identifier). Used by Analytics.astro and the middleware (Infra worker). */
  readonly PUBLIC_CF_ANALYTICS_TOKEN?: string;
  /** Optional HSTS max-age in seconds (Infra worker, src/middleware.ts). */
  readonly PUBLIC_HSTS_MAX_AGE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
