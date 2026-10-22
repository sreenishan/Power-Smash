// Request handling for `/go/[slug]` (D-031, D-009, D-029), separated from the route file so tests can drive it with plain objects.
//
// Flow: validate the slug, look it up, refuse an expired link (404), refuse an unsafe target (404 and one redacted log line), count the
// click when the visitor is not a bot (no raw IP and no raw user agent are stored: the user agent is hashed with the Worker-only HMAC
// key), then answer 302 with the UTM parameters appended. Logging runs through `waitUntil` when the runtime has one, so it does not delay
// the redirect (without one the log is awaited first), and a logging failure never blocks the redirect.
import { createSupabaseRest } from '../supabase/rest';
import { parseHmacKey, pseudonym } from '../security/hash';
import { createClickLimiter } from './click-limit';
import type { ClickLimiter } from './click-limit';
import { isBot, isExpired, isUuid, isValidSlug, pageFromReferer, resolveTarget, utmFor, utmQueryString, withUtm } from './go';
import type { GoLabel, GoLinks } from './go';

/** One row of `outbound_clicks` (spec 11: go_slug, target_type, target_id, page_path, utm, ua_hash, ts). `ts` is the column default. */
export interface OutboundClick {
  go_slug: string;
  /** The link label: sponsored, partner, affiliate or internal. */
  target_type: GoLabel;
  target_id: string | null;
  /** Path of the page the visitor came from (same site only, no query), or null. */
  page_path: string | null;
  /** The UTM parameters of the redirect as a query string. */
  utm: string;
  ua_hash: string;
}

export interface GoDeps {
  links: GoLinks;
  allowedHosts: readonly string[];
  now: () => Date;
  logClick: (click: OutboundClick) => Promise<void>;
  hashUserAgent: (userAgent: string) => Promise<string>;
  /**
   * Run a promise after the response is sent (Vercel `waitUntil`). Optional: when the runtime has no request context the route passes
   * nothing, and handleGo AWAITS the click log before redirecting (a logging failure still never blocks the redirect).
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Origins whose Referer path may be stored. */
  siteOrigins: readonly string[];
  /** Dedupe and flood cap for the click log (S-15). Missing = no limit (unit tests); createGoDeps always sets one. */
  limiter?: ClickLimiter;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } as const;

const notFound = (): Response => new Response(null, { status: 404, headers: { ...NO_STORE } });

/** Slugs whose targetId was dropped for not being a uuid: logged once each per isolate, never per click. */
const warnedTargetId = new Set<string>();

export async function handleGo(slug: unknown, request: Request, deps: GoDeps): Promise<Response> {
  if (!isValidSlug(slug)) return notFound();
  const link = Object.prototype.hasOwnProperty.call(deps.links, slug) ? deps.links[slug] : undefined;
  if (!link) return notFound();
  if (isExpired(link, deps.now())) return notFound();

  const target = resolveTarget(link, deps.allowedHosts);
  if (!target) {
    // A configuration mistake, not a visitor mistake. The slug is safe to log; the target is not logged.
    console.error(`go: link "${slug}" has a target that is not https on an allowed host`);
    return notFound();
  }

  // target_id is a uuid column: a slug-style id would make every insert fail and the counting would silently stop (B-16).
  let targetId: string | null = null;
  if (link.targetId !== undefined && link.targetId !== null && link.targetId !== '') {
    if (isUuid(link.targetId)) targetId = link.targetId.toLowerCase();
    else if (!warnedTargetId.has(slug)) {
      warnedTargetId.add(slug);
      console.error(`go: link "${slug}" has a targetId that is not a uuid; clicks are stored without it`);
    }
  }

  const utm = utmFor(link.label, slug);
  let location: string;
  if (target.kind === 'internal') location = target.path;
  else location = (utm ? withUtm(target.url, utm) : target.url).toString();

  const userAgent = request.headers.get('user-agent');
  let counted = request.method === 'GET' && !isBot(userAgent, request.headers);
  // A repeat from the same user agent, or a flood on one slug, is redirected but not written (S-15).
  if (counted && deps.limiter && !deps.limiter.allow(slug, userAgent ?? '', deps.now().getTime())) counted = false;
  if (counted) {
    const click = async (): Promise<void> => {
      try {
        const uaHash = await deps.hashUserAgent(userAgent ?? '');
        await deps.logClick({
          go_slug: slug,
          target_type: link.label,
          target_id: targetId,
          page_path: pageFromReferer(request.headers.get('referer'), deps.siteOrigins),
          utm: utm ? utmQueryString(utm) : '',
          ua_hash: uaHash,
        });
      } catch {
        // Counting is best effort: the visitor still gets the redirect. No error detail is logged (it could carry request data).
        console.error(`go: click log failed for "${slug}"`);
      }
    };
    // `click()` never rejects (it catches and logs without detail). With a waitUntil the redirect does not wait for it; without one
    // (no request context) the log is awaited here, so a function that is frozen right after the response cannot lose the click.
    const pending = click();
    let handedOver = false;
    if (deps.waitUntil) {
      try {
        deps.waitUntil(pending);
        handedOver = true;
      } catch {
        // a waitUntil that throws is treated as absent: wait for the log below
      }
    }
    if (!handedOver) await pending.catch(() => undefined);
  }
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE } });
}

// ---- default dependencies (Worker) -----------------------------------------------------------------------------------

export interface GoEnv {
  SUPABASE_URL?: string;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  HMAC_KEY?: string;
  PUBLIC_SITE_URL?: string;
}

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** One limiter per Worker isolate: every request that isolate serves shares it (the module is evaluated once). */
const sharedLimiter = createClickLimiter();

/**
 * Build the Worker dependencies from the runtime environment. With HMAC_KEY set the user agent hash is the keyed pseudonym used
 * everywhere else (D-029); without it (local dev) a plain truncated SHA-256 is used. When the Supabase URL or secret key is missing the
 * click is simply not stored (the redirect still works).
 */
export function createGoDeps(
  env: GoEnv,
  parts: { links: GoLinks; allowedHosts: readonly string[]; waitUntil?: (p: Promise<unknown>) => void; requestOrigin: string; fetchImpl?: typeof fetch; limiter?: ClickLimiter },
): GoDeps {
  const url = (env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL ?? '').trim();
  const secret = (env.SUPABASE_SECRET_KEY ?? '').trim();
  const fetchImpl = parts.fetchImpl ?? fetch;
  const hmac = parseHmacKey(env.HMAC_KEY);
  const siteOrigins = [parts.requestOrigin];
  try {
    if (env.PUBLIC_SITE_URL) siteOrigins.push(new URL(env.PUBLIC_SITE_URL).origin);
  } catch {
    // ignore a malformed site URL
  }
  return {
    links: parts.links,
    allowedHosts: parts.allowedHosts,
    now: () => new Date(),
    waitUntil: parts.waitUntil,
    siteOrigins,
    limiter: parts.limiter ?? sharedLimiter,
    hashUserAgent: async (ua) => {
      if (hmac) return pseudonym(hmac, 'go-ua', ua);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`go-ua|${ua}`));
      return `sha256.${hex(digest)}`;
    },
    logClick: async (click) => {
      if (url === '' || secret === '') return;
      const rest = createSupabaseRest({ url, secretKey: secret, fetch: fetchImpl });
      await rest.insert('outbound_clicks', click as unknown as Record<string, unknown>);
    },
  };
}
