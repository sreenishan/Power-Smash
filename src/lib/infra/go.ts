// Pure logic of the tracked redirect `/go/[slug]` (spec 8.3, D-031, D-029). No imports, no I/O: the route and the tests share it.
//
//  * A slug is looked up in the typed map in src/content/go-links.ts (M3 moves the map to the database, D-031).
//  * The target must be https and on an allowed host (exact match or a subdomain of an allowed entry): no open redirect.
//    An `internal` link points at a path on this site instead.
//  * UTM parameters are appended without touching the target's own query or fragment, and never override a parameter the target
//    already carries.
//  * Bots and prefetchers are redirected but never counted.
//  * Expired links answer 404. A date-only expiry means "valid through the end of that day in India" (D-030).

export type GoLabel = 'sponsored' | 'partner' | 'affiliate' | 'internal';

export interface GoLink {
  /** `https://...` on an allowed host, or a path on this site for an `internal` link (for example `/partner`). */
  target: string;
  label: GoLabel;
  /** `YYYY-MM-DD` (valid through the end of that day in Asia/Kolkata) or a full ISO instant. Missing = no expiry. */
  expires?: string | null;
  /** Optional id (a uuid) of what the link points at (a sponsor, a tournament); stored in `outbound_clicks.target_id`. Anything that is not a uuid is dropped. */
  targetId?: string | null;
}

export type GoLinks = Readonly<Record<string, GoLink>>;

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

/** Keep only plausible bare hostnames (lower case, with a dot, no scheme, port, path, wildcard or IP address). */
export function normalizeAllowedHosts(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const h = raw.trim().toLowerCase();
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(h)) continue;
    if (/^\d+(?:\.\d+){3}$/.test(h)) continue; // IPv4 literal
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/** Exact match or subdomain of an allowed host. `evilexample.com` does not match `example.com`. */
export function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  return normalizeAllowedHosts(allowedHosts).some((a) => h === a || h.endsWith(`.${a}`));
}

export type ResolvedTarget = { kind: 'external'; url: URL } | { kind: 'internal'; path: string };

const INTERNAL_BASE = 'https://internal.invalid';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `outbound_clicks.target_id` is a uuid column: anything else would make every insert fail (review B-16). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** The destination for a link, or null when it is not safe (not https, a login in the URL, a host that is not allowed). */
export function resolveTarget(link: GoLink, allowedHosts: readonly string[]): ResolvedTarget | null {
  if (link.label === 'internal') {
    if (!link.target.startsWith('/') || link.target.startsWith('//') || link.target.startsWith('/\\')) return null;
    try {
      const probe = new URL(link.target, INTERNAL_BASE);
      if (probe.origin !== INTERNAL_BASE) return null;
      // Dot-segment removal can CREATE a protocol-relative path: '/..//evil.com' and '/x/..//evil.com' both normalise to '//evil.com'
      // (a redirect to another site), and a tab or newline inside '/\t/evil.com' is stripped by the URL parser. So the check is made
      // again on the normalised path (review B-7), and the finished path must still resolve on this origin.
      const path = `${probe.pathname}${probe.search}${probe.hash}`;
      if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
      if (new URL(path, INTERNAL_BASE).origin !== INTERNAL_BASE) return null;
      return { kind: 'internal', path };
    } catch {
      return null;
    }
  }
  let url: URL;
  try {
    url = new URL(link.target);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  if (!hostAllowed(url.hostname, allowedHosts)) return null;
  return { kind: 'external', url };
}

/** True when the link has expired (fail closed: an expiry that cannot be read counts as expired). */
export function isExpired(link: GoLink, now: Date): boolean {
  const e = (link.expires ?? '').trim();
  if (e === '') return false;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(e);
  const at = new Date(dateOnly ? `${e}T23:59:59.999+05:30` : e);
  if (Number.isNaN(at.getTime())) return true;
  return now.getTime() > at.getTime();
}

export const UTM_SOURCE = 'powersmash';

export interface Utm {
  utm_source: string;
  utm_medium: 'sponsor' | 'affiliate';
  utm_campaign: string;
}

/** The UTM set for a link, or null for an internal link (no tracking parameters on the site's own links). */
export function utmFor(label: GoLabel, slug: string): Utm | null {
  if (label === 'internal') return null;
  return { utm_source: UTM_SOURCE, utm_medium: label === 'affiliate' ? 'affiliate' : 'sponsor', utm_campaign: slug };
}

export function utmQueryString(utm: Utm): string {
  return `utm_source=${encodeURIComponent(utm.utm_source)}&utm_medium=${encodeURIComponent(utm.utm_medium)}&utm_campaign=${encodeURIComponent(utm.utm_campaign)}`;
}

/** Append the UTM parameters the target does not have yet. The existing query string and the fragment are kept byte for byte. */
export function withUtm(url: URL, utm: Utm): URL {
  const out = new URL(url.toString());
  const existing = out.search.startsWith('?') ? out.search.slice(1) : '';
  const have = new Set(
    existing
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const key = pair.split('=')[0] ?? '';
        try {
          return decodeURIComponent(key.replace(/\+/g, ' ')).toLowerCase();
        } catch {
          return key.toLowerCase();
        }
      }),
  );
  const extra = Object.entries(utm)
    .filter(([k]) => !have.has(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  if (extra.length === 0) return out;
  out.search = existing === '' ? extra.join('&') : `${existing}&${extra.join('&')}`;
  return out;
}

const BOT_PATTERN =
  /bot\b|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|linkedinbot|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|python-requests|python-urllib|aiohttp|curl\/|wget\/|httpclient|go-http-client|libwww|java\/|node-fetch|undici|axios|postman|scrapy|bingpreview|duckduck|baidu|yandex|semrush|ahrefs|mj12|gptbot|claudebot|petalbot/i;

/** True for crawlers, link previews, prefetchers and anything that sends no usable user agent. Such requests are redirected, never counted. */
export function isBot(userAgent: string | null | undefined, headers?: { get(name: string): string | null }): boolean {
  const ua = (userAgent ?? '').trim();
  if (ua.length < 12) return true;
  if (BOT_PATTERN.test(ua)) return true;
  if (headers) {
    const purpose = `${headers.get('purpose') ?? ''} ${headers.get('sec-purpose') ?? ''} ${headers.get('x-moz') ?? ''} ${headers.get('x-purpose') ?? ''}`.toLowerCase();
    if (/prefetch|prerender|preview/.test(purpose)) return true;
  }
  return false;
}

/** The path (no query, no fragment) of a same-site Referer, or null. Cross-site referrers are dropped: they could carry anything. */
export function pageFromReferer(referer: string | null | undefined, allowedOrigins: readonly string[]): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (!allowedOrigins.includes(u.origin)) return null;
    const path = u.pathname;
    if (!path.startsWith('/') || path.length > 200 || /[\u0000-\u001f\u007f]/.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}
