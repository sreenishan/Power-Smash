// Security headers and CSP for Power Smash (D-029, D-010, D-023). PURE: no imports, no I/O, so the Worker middleware, the
// post-build script (scripts/finalize-headers.ts) and the Vitest tests all use the same code.
//
// Two delivery paths, one policy (Vercel port):
//   * Static pages and assets get headers from route rules that scripts/finalize-headers.ts writes into `.vercel/output/config.json`
//     after the build (src/lib/infra/vercel-routes.ts), with script and style hashes in the CSP. Astro middleware does NOT run for them.
//   * Responses made by functions (`/api/*`, `/go/*`, error pages, anything with `prerender = false`) also get headers from
//     `src/middleware.ts` through `applySecurityHeaders()`; existing headers are never overwritten, so the two paths never fight.
//
// Referrer policy: `strict-origin-when-cross-origin`. NEVER `no-referrer`: the YouTube embed needs a Referer (Error 153) and the
// Cloudflare Web Analytics beacon needs one too.

export const SCRIPT_HOSTS = {
  turnstile: 'https://challenges.cloudflare.com',
  /** Cloudflare lists this exact file for the manual beacon snippet (docs: web-analytics/faq, checked 2026-10-21). */
  analyticsScript: 'https://static.cloudflareinsights.com/beacon.min.js',
  analyticsConnect: 'https://cloudflareinsights.com',
  youtube: 'https://www.youtube-nocookie.com',
  youtubeThumbnails: 'https://i.ytimg.com',
} as const;

/** A CSP hash source as written in a policy: `'sha256-<base64>'`. Validated so nothing else can be smuggled into a policy. */
export const CSP_HASH_PATTERN = /^'sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}'$/;

export interface CspOptions {
  /** Hash sources of the inline scripts that are allowed (computed from the built pages). */
  scriptHashes?: readonly string[];
  /** Hash sources of the inline style blocks that are allowed. */
  styleHashes?: readonly string[];
  /** Origin of the Supabase project (for connect-src and public Storage images), or null. */
  supabaseOrigin?: string | null;
  /** Allow the Cloudflare Web Analytics beacon (only when a token is configured). */
  analytics?: boolean;
  /** Allow Cloudflare Turnstile (script and frame). */
  turnstile?: boolean;
}

/** Options of the static fallback policy in `public/_headers`: everything the site can ever load, no hashes. */
export const DEFAULT_CSP_OPTIONS: CspOptions = {
  analytics: true,
  turnstile: true,
};

const originOf = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
};

function checkedHashes(list: readonly string[] | undefined, what: string): string[] {
  const out: string[] = [];
  for (const h of list ?? []) {
    if (!CSP_HASH_PATTERN.test(h)) throw new Error(`Invalid ${what} hash source in CSP options`);
    if (!out.includes(h)) out.push(h);
  }
  return out.sort();
}

/**
 * Content-Security-Policy for HTML pages.
 *  - Scripts: own files plus listed hashes plus Turnstile and the Web Analytics beacon file. No `unsafe-inline`, no `unsafe-eval`,
 *    no inline event handlers (`script-src-attr 'none'`).
 *  - Styles: own files plus listed hashes. `style-src-attr 'unsafe-inline'` allows `style="..."` attributes (React islands and
 *    some components set them); a style attribute cannot run script. See docs/m1/infra-notes.md.
 *  - Embeds: only YouTube (privacy-enhanced domain) and Turnstile. Nothing may frame this site.
 */
export function buildPageCsp(options: CspOptions = {}): string {
  const scriptHashes = checkedHashes(options.scriptHashes, 'script');
  const styleHashes = checkedHashes(options.styleHashes, 'style');
  const supabase = originOf(options.supabaseOrigin);

  const script = ["'self'", ...scriptHashes];
  const frame: string[] = [SCRIPT_HOSTS.youtube];
  const connect = ["'self'"];
  const img = ["'self'", 'data:', SCRIPT_HOSTS.youtubeThumbnails];
  if (options.turnstile) {
    script.push(SCRIPT_HOSTS.turnstile);
    frame.push(SCRIPT_HOSTS.turnstile);
  }
  if (options.analytics) {
    script.push(SCRIPT_HOSTS.analyticsScript);
    connect.push(SCRIPT_HOSTS.analyticsConnect);
  }
  if (supabase) {
    connect.push(supabase);
    img.push(supabase); // public Storage bucket: sponsor creatives and posters (D-009)
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `script-src ${script.join(' ')}`,
    "script-src-attr 'none'",
    `style-src ${["'self'", ...styleHashes].join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    `img-src ${img.join(' ')}`,
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    `frame-src ${frame.join(' ')}`,
    "manifest-src 'self'",
  ].join('; ');
}

/** Policy for responses that are not HTML pages (JSON, redirects, plain text): nothing may load or frame. */
export const API_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Features the site never uses are switched off. `payment` is off until Phase 2 adds Razorpay Checkout. */
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
].join(', ');

export const REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** Headers every response gets, static or dynamic (the CSP differs, see above). */
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': REFERRER_POLICY,
  'Permissions-Policy': PERMISSIONS_POLICY,
  'X-Frame-Options': 'DENY',
};

export const NOINDEX_VALUE = 'noindex, nofollow';

/** Host suffixes that are never indexed, whatever the canonical host is (preview and production *.vercel.app addresses, D-023). */
export const NOINDEX_HOST_SUFFIXES: readonly string[] = ['.vercel.app'];

/** Function paths that are never meant to be indexed (D-029): the admin, the API and the click redirects. */
export const NOINDEX_PATH_PREFIXES: readonly string[] = ['/api/', '/go/', '/admin', '/cdn-cgi/'];

/** `PUBLIC_HSTS_MAX_AGE` as whole seconds (0 to two years), or null when unset or invalid. HSTS is only for the final domain (D-023). */
export function parseMaxAge(raw: unknown): number | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n <= 63_072_000 ? n : null;
}

/** `Strict-Transport-Security` value. No includeSubDomains and no preload: those are deliberate, separate decisions. */
export function hstsValue(maxAge: number | null): string | null {
  return maxAge === null ? null : `max-age=${maxAge}`;
}

/** True for a *.vercel.app address (or another configured suffix) and for any host other than the canonical one (D-023: noindex on every non-canonical host). */
export function isNoindexHost(hostname: string, canonicalHost: string | null, suffixes: readonly string[] = NOINDEX_HOST_SUFFIXES): boolean {
  const h = hostname.toLowerCase();
  if (suffixes.some((s) => h.endsWith(s.toLowerCase()))) return true;
  return canonicalHost !== null && h !== canonicalHost.toLowerCase();
}

export interface RobotsInput {
  allowIndexing: boolean;
  hostname: string;
  canonicalHost: string | null;
  pathname: string;
  /** Extra noindex host suffixes (PUBLIC_NOINDEX_HOST_SUFFIXES); defaults to NOINDEX_HOST_SUFFIXES. */
  noindexHostSuffixes?: readonly string[];
}

/** Whether a function response gets `X-Robots-Tag: noindex`. */
export function shouldNoindex(input: RobotsInput): boolean {
  if (!input.allowIndexing) return true;
  if (isNoindexHost(input.hostname, input.canonicalHost, input.noindexHostSuffixes)) return true;
  return NOINDEX_PATH_PREFIXES.some((p) => {
    const base = p.replace(/\/$/, '');
    return input.pathname === base || input.pathname.startsWith(`${base}/`);
  });
}

export interface SecurityContext extends RobotsInput {
  protocol: string;
  hstsMaxAge: number | null;
  /** The CSP used for HTML responses made by a function (no hashes: such pages must not need inline scripts). */
  pageCsp: string;
}

/** Add the security headers to a function response. Existing headers are never overwritten. */
export function applySecurityHeaders(response: Response, ctx: SecurityContext): Response {
  const wanted: Array<[string, string]> = Object.entries(BASE_SECURITY_HEADERS);
  const contentType = response.headers.get('content-type') ?? '';
  wanted.push(['Content-Security-Policy', /\btext\/html\b/i.test(contentType) ? ctx.pageCsp : API_CSP]);
  if (shouldNoindex(ctx)) wanted.push(['X-Robots-Tag', NOINDEX_VALUE]);
  const hsts = ctx.protocol === 'https:' ? hstsValue(ctx.hstsMaxAge) : null;
  if (hsts) wanted.push(['Strict-Transport-Security', hsts]);

  const apply = (headers: Headers): void => {
    for (const [name, value] of wanted) if (!headers.has(name)) headers.set(name, value);
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    // Immutable headers (a Response that came straight from fetch): rebuild with a copy.
    const headers = new Headers(response.headers);
    apply(headers);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}
