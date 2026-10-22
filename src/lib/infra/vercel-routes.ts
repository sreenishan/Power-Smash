// Vercel routing rules for headers and redirects (Vercel port, area B; replaces the Cloudflare `_headers` and `_redirects` files).
// PURE: no I/O. scripts/finalize-headers.ts writes the result into `.vercel/output/config.json` (the Build Output API v3 `routes`
// array, the same syntax as vercel.json `routes`). Why config.json and not vercel.json `headers`: the CSP holds SHA-256 hashes of the
// inline scripts and styles of the BUILT pages, so it can only be known after the build; `vercel build` reads vercel.json before it.
//
// Rules inserted here sit between two sentinel routes so a second run replaces them instead of stacking (idempotent) and so tests and
// check-release can find them. Header routes use `continue: true` (routing goes on, the headers are added to the final response, static
// files and functions alike). Redirect routes end the routing and answer 301 with a Location header.
// Limits (docs/m3/vercel-facts.md #3): every route counts towards 2,048 per deployment, so the redirect cap stays at the D-009 line.
import {
  API_CSP,
  BASE_SECURITY_HEADERS,
  NOINDEX_VALUE,
  hstsValue,
} from './headers.ts';

export interface VercelHasField {
  type: 'host';
  value: string | { eq?: string; neq?: string; suf?: string; re?: string };
}

export interface VercelRoute {
  src?: string;
  dest?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  status?: number;
  has?: VercelHasField[];
  missing?: VercelHasField[];
  handle?: string;
  [extra: string]: unknown;
}

export interface VercelConfig {
  version?: number;
  routes?: VercelRoute[];
  [extra: string]: unknown;
}

/** Sentinel routes around everything this module writes. Their `src` can never match a real address. */
export const MANAGED_BEGIN_SRC = '^/\\.ps-managed-begin$';
export const MANAGED_END_SRC = '^/\\.ps-managed-end$';
const sentinel = (src: string, which: 'begin' | 'end'): VercelRoute => ({ src, headers: { 'X-PS-Managed': which }, continue: true });

/** Vercel's documented route cap per deployment (Hobby and Pro). */
export const VERCEL_MAX_ROUTES = 2048;
/** Our own precaution: Vercel documents no header size limit, so keep every header value well under a typical 8 KB header block. */
export const HEADER_VALUE_SOFT_MAX = 6000;
/** Release line for archive redirect rules (D-009), unchanged on Vercel; the platform cap is VERCEL_MAX_ROUTES shared with header rules. */
export const REDIRECT_RULES_MAX = 1800;

export const LONG_CACHE = 'public, max-age=31536000, immutable';
export const NO_STORE = 'no-store';

/** Paths served by functions, never indexed, never cached (D-029). `admin` has no trailing slash: `/admin` and `/admin/...`. */
const API_PATHS = '^/(?:api|go|cdn-cgi)(?:/.*)?$';
/** Same, except /api/placements: its handler sets its own public `s-maxage` (src/lib/placements/api-handler.ts), so it must not be forced to no-store. */
const NO_STORE_PATHS = '^/(?:api(?!/placements/?$)|go|cdn-cgi)(?:/.*)?$';
const NOINDEX_PATHS = '^/(?:api|go|admin|cdn-cgi)(?:/.*)?$';
const PAGE_PATHS = '^/(?!(?:api|go|cdn-cgi)(?:/|$))(.*)$';

/** Host suffixes that are never indexable: `*.vercel.app` always, plus PUBLIC_NOINDEX_HOST_SUFFIXES (comma separated, leading dot). */
export const DEFAULT_NOINDEX_HOST_SUFFIXES: readonly string[] = ['.vercel.app'];

/** Parse a comma separated host-suffix list. Invalid entries are dropped; the default list is always included. */
export function parseHostSuffixes(raw: unknown): string[] {
  const out = [...DEFAULT_NOINDEX_HOST_SUFFIXES];
  if (typeof raw !== 'string') return out;
  for (const part of raw.split(',')) {
    const s = part.trim().toLowerCase();
    if (!/^\.?[a-z0-9][a-z0-9.-]*$/.test(s)) continue;
    const suffix = s.startsWith('.') ? s : `.${s}`;
    if (!out.includes(suffix)) out.push(suffix);
  }
  return out;
}

export interface HeaderRouteOptions {
  /** Final Content-Security-Policy for HTML pages (with the inline hashes). */
  csp: string;
  allowIndexing: boolean;
  hstsMaxAge: number | null;
  /** Canonical hostname (from PUBLIC_SITE_URL) or null. Any other host is noindex (D-023). */
  canonicalHost: string | null;
  noindexHostSuffixes: readonly string[];
}

/** The header routes, in order. Pure. */
export function buildHeaderRoutes(o: HeaderRouteOptions): VercelRoute[] {
  const routes: VercelRoute[] = [];
  const everywhere: Record<string, string> = { ...BASE_SECURITY_HEADERS };
  const hsts = hstsValue(o.hstsMaxAge);
  if (hsts) everywhere['Strict-Transport-Security'] = hsts;
  if (!o.allowIndexing) everywhere['X-Robots-Tag'] = NOINDEX_VALUE;
  routes.push({ src: '^/(.*)$', headers: everywhere, continue: true });
  routes.push({ src: PAGE_PATHS, headers: { 'Content-Security-Policy': o.csp }, continue: true });
  routes.push({ src: API_PATHS, headers: { 'Content-Security-Policy': API_CSP }, continue: true });
  routes.push({ src: NO_STORE_PATHS, headers: { 'Cache-Control': NO_STORE }, continue: true });
  routes.push({ src: '^/_astro/(.*)$', headers: { 'Cache-Control': LONG_CACHE }, continue: true });
  if (o.allowIndexing) {
    routes.push({ src: NOINDEX_PATHS, headers: { 'X-Robots-Tag': NOINDEX_VALUE }, continue: true });
    for (const suffix of o.noindexHostSuffixes) {
      routes.push({ src: '^/(.*)$', has: [{ type: 'host', value: { suf: suffix } }], headers: { 'X-Robots-Tag': NOINDEX_VALUE }, continue: true });
    }
    if (o.canonicalHost) {
      // Every host except the canonical one (previews, the www alias, a stray domain): duplicate content must not be indexed.
      routes.push({ src: '^/(.*)$', missing: [{ type: 'host', value: { eq: o.canonicalHost.toLowerCase() } }], headers: { 'X-Robots-Tag': NOINDEX_VALUE }, continue: true });
    }
  }
  return routes;
}

export interface RedirectLike {
  from: string;
  to: string;
  status: number;
}

const regexEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One redirect route per rule. `from` is a page path ending in a slash; the address without the slash redirects too. */
export function buildRedirectRoutes(rules: readonly RedirectLike[]): VercelRoute[] {
  return rules.map((r) => {
    const base = r.from.endsWith('/') ? r.from.slice(0, -1) : r.from;
    return { src: `^${regexEscape(base)}/?$`, status: r.status, headers: { Location: r.to } };
  });
}

/** The managed block: begin sentinel, header routes, redirect routes, end sentinel. */
export function managedBlock(headerRoutes: readonly VercelRoute[], redirectRoutes: readonly VercelRoute[]): VercelRoute[] {
  return [sentinel(MANAGED_BEGIN_SRC, 'begin'), ...headerRoutes, ...redirectRoutes, sentinel(MANAGED_END_SRC, 'end')];
}

/** Remove an earlier managed block (everything between the sentinels, inclusive). */
export function stripManaged(routes: readonly VercelRoute[]): VercelRoute[] {
  const begin = routes.findIndex((r) => r.src === MANAGED_BEGIN_SRC);
  if (begin === -1) return [...routes];
  const endRel = routes.slice(begin).findIndex((r) => r.src === MANAGED_END_SRC);
  const end = endRel === -1 ? begin : begin + endRel;
  return [...routes.slice(0, begin), ...routes.slice(end + 1)];
}

/** Put the managed block first in config.routes (before the adapter's own routes). Idempotent; never mutates the input. */
export function applyManagedRoutes(config: VercelConfig, block: readonly VercelRoute[]): VercelConfig {
  return { ...config, version: config.version ?? 3, routes: [...block, ...stripManaged(config.routes ?? [])] };
}

export function managedRoutesOf(config: VercelConfig): VercelRoute[] {
  const routes = config.routes ?? [];
  const begin = routes.findIndex((r) => r.src === MANAGED_BEGIN_SRC);
  if (begin === -1) return [];
  const endRel = routes.slice(begin).findIndex((r) => r.src === MANAGED_END_SRC);
  return routes.slice(begin, endRel === -1 ? undefined : begin + endRel + 1);
}

/** The value of one header on the first unconditional route with this `src` (tests and check-release). */
export function routeHeader(routes: readonly VercelRoute[], src: string, name: string): string | null {
  for (const r of routes) {
    if (r.src !== src || !r.headers || r.has || r.missing) continue;
    for (const [k, v] of Object.entries(r.headers)) if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return null;
}

export const ROUTE_SRC = { everywhere: '^/(.*)$', pages: PAGE_PATHS, api: API_PATHS, noStore: NO_STORE_PATHS, astro: '^/_astro/(.*)$', noindexPaths: NOINDEX_PATHS } as const;

/** Problems that must fail the build: too many routes in total, or an oversized header value. */
export function checkRouteLimits(routes: readonly VercelRoute[]): string[] {
  const problems: string[] = [];
  if (routes.length > VERCEL_MAX_ROUTES) problems.push(`config.json has ${routes.length} routes; Vercel allows ${VERCEL_MAX_ROUTES} per deployment.`);
  for (const r of routes) {
    for (const [k, v] of Object.entries(r.headers ?? {})) {
      if (v.length > HEADER_VALUE_SOFT_MAX) problems.push(`Header ${k} is ${v.length} characters (precaution limit ${HEADER_VALUE_SOFT_MAX}). Reduce inline scripts and styles, or switch to Astro's security.csp.`);
    }
  }
  return problems;
}
