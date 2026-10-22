// Security headers for responses made by Vercel functions (D-029). Runs only for on-demand routes (`/api/*`, `/go/*`, error pages,
// anything with `prerender = false`): static, prerendered pages never reach a function, so THEIR headers come from the route rules
// that scripts/finalize-headers.ts writes into `.vercel/output/config.json` after each build. Both paths build from
// src/lib/infra/headers.ts; headers already on a response are never overwritten.
//
// Build variables read here (all PUBLIC_, none secret; inlined at build time, so each is read as a direct property access):
//   PUBLIC_SITE_URL          canonical origin; any other host gets X-Robots-Tag: noindex (D-023)
//   PUBLIC_ALLOW_INDEXING    exactly "true" turns indexing on; anything else = noindex on every response
//   PUBLIC_HSTS_MAX_AGE      seconds; unset = no HSTS. Set only once the final domain is live (D-023); no includeSubDomains, no preload
//   PUBLIC_SUPABASE_URL      origin allowed in connect-src and img-src
//   PUBLIC_NOINDEX_HOST_SUFFIXES  extra comma separated host suffixes that are always noindex (`.vercel.app` is always included)
//   PUBLIC_CF_ANALYTICS_TOKEN  decides whether the Web Analytics beacon hosts are allowed (Turnstile hosts are always allowed)
import { defineMiddleware } from 'astro:middleware';
import { applySecurityHeaders, buildPageCsp, parseMaxAge } from './lib/infra/headers';
import { parseHostSuffixes } from './lib/infra/vercel-routes.ts';

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const siteUrl = clean(import.meta.env.PUBLIC_SITE_URL);
const canonicalHost = ((): string | null => {
  try {
    return siteUrl === '' ? null : new URL(siteUrl).hostname;
  } catch {
    return null;
  }
})();
const allowIndexing = clean(import.meta.env.PUBLIC_ALLOW_INDEXING) === 'true';
const hstsMaxAge = parseMaxAge(import.meta.env.PUBLIC_HSTS_MAX_AGE);
const noindexHostSuffixes = parseHostSuffixes(import.meta.env.PUBLIC_NOINDEX_HOST_SUFFIXES);
const pageCsp = buildPageCsp({
  supabaseOrigin: clean(import.meta.env.PUBLIC_SUPABASE_URL) || null,
  analytics: clean(import.meta.env.PUBLIC_CF_ANALYTICS_TOKEN) !== '',
  turnstile: true,
});

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  return applySecurityHeaders(response, {
    allowIndexing,
    canonicalHost,
    noindexHostSuffixes,
    hostname: context.url.hostname,
    pathname: context.url.pathname,
    protocol: context.url.protocol,
    hstsMaxAge,
    pageCsp,
  });
});
