// ONE helper decides how an internal URL is written (R-LINKS; review findings B-15 and C-21).
//
// Policy: page URLs end with a slash ("/book/"). The build writes book/index.html, so the slash form is the address the server
// serves directly; the slashless form costs a redirect on Cloudflare's static assets. Canonical links, og:url, JSON-LD urls,
// breadcrumbs, navigation, buttons and in-page links all go through path() or absoluteUrl(), so the two forms never co-exist.
//
// What is left alone (returned unchanged):
//   - anything that is not an internal root-relative path: https:// and mailto: and tel: links, "#anchor", "?query" alone,
//     protocol-relative "//host" and "/\host" (never treated as internal);
//   - endpoint paths under /api/, /go/ and /cdn-cgi/: they are Worker routes, not files, and keep NO trailing slash
//     (never pass an API path through this helper; this guard is a second line of defence);
//   - a last segment with a file extension (/robots.txt, /favicon.svg, /media-kit.pdf);
//   - a path that already ends with a slash.
// The query string and the #fragment are kept after the inserted slash: "/book?package=pro" -> "/book/?package=pro".
// Pure functions: tests/site/urls.test.ts.

/** Prefixes of Worker routes (not static pages). Their paths never get a trailing slash. */
export const ENDPOINT_PREFIXES: readonly string[] = ['/api/', '/go/', '/cdn-cgi/'];

/** True for a root-relative path on this site ("/about", "/book?x=1"). "//host" and "/\host" are NOT internal. */
export function isInternalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
}

/** An internal page path in its one canonical form (with a trailing slash). See the file header for what is left alone. */
export function path(value: string): string {
  if (!isInternalPath(value)) return value;
  const cut = value.search(/[?#]/);
  const pathname = cut === -1 ? value : value.slice(0, cut);
  const rest = cut === -1 ? '' : value.slice(cut);
  if (pathname.endsWith('/')) return value;
  if (ENDPOINT_PREFIXES.some((prefix) => `${pathname}/`.startsWith(prefix))) return value;
  const last = pathname.split('/').pop() ?? '';
  if (/\.[a-z0-9]+$/i.test(last)) return value;
  return `${pathname}/${rest}`;
}

/** Absolute URL of an internal page against the site origin, in the same canonical form as path(). */
export function absoluteUrl(value: string, origin: string | URL): string {
  return new URL(path(value), origin).toString();
}

/**
 * Every internal page of the site, already in canonical slash form: pages and components write `href={ROUTES.book}` instead of a
 * string literal, so a typo or a missing slash cannot happen and a renamed page is changed in one place.
 * tests/site/urls.test.ts checks that each value equals path(value) and that a page file exists for it.
 * API and go-link endpoints are not pages and are not listed here.
 */
export const ROUTES = {
  home: '/',
  services: '/services/',
  pricing: '/pricing/',
  book: '/book/',
  partner: '/partner/',
  tournaments: '/tournaments/',
  submitTournament: '/tournaments/submit/',
  support: '/support/',
  about: '/about/',
  contact: '/contact/',
  privacy: '/privacy/',
  terms: '/terms/',
  refunds: '/refunds/',
  delivery: '/delivery/',
  disclosures: '/disclosures/',
  contentRemoval: '/content-removal/',
} as const;

/**
 * M3 pages (additive). Kept apart from ROUTES on purpose: nav.ts treats every ROUTES value as an M1 page that the footer must link,
 * and none of these is linked yet. The lead moves them into ROUTES when the footer and Support page link to them.
 * Posters are not listed: they are noindex and never linked from the site (see posterPath).
 */
export const M3_ROUTES = {
  submitVideo: '/submit-video/',
  /** Profile and content-removal requests (one form with a type selector). */
  request: '/request/',
  alerts: '/alerts/',
  live: '/live/',
} as const;

/**
 * Archive pages (M2c, additive). Kept apart from ROUTES for the same reason as M3_ROUTES: nav.ts treats every ROUTES value as an M1 page
 * that the footer must link. The lead moves these into ROUTES and the header when the archive is linked. Match, player and list-page
 * addresses are built by the helpers below, never by hand.
 */
export const ARCHIVE_ROUTES = {
  matches: '/matches/',
  players: '/players/',
} as const;

/** /matches/<slug>/ (canonical slash form). */
export const matchPath = (slug: string): string => `/matches/${slug}/`;
/** /players/<slug>/ */
export const playerPath = (slug: string): string => `/players/${slug}/`;
/** /matches/ for page 1, /matches/page/N/ after that. */
export const matchListPath = (page: number): string => (page <= 1 ? ARCHIVE_ROUTES.matches : `/matches/page/${Math.floor(page)}/`);

/** Slug of a printable poster page: lowercase letters, digits and hyphens (the tournament slug rule, spec 6.3), at most 80 characters. */
export const POSTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PosterSize = 'a4' | 'a3';

/** /posters/<slug>/ (A4) or /posters/<slug>/a3/ (A3), in canonical slash form, or null for a slug that is not allowed. */
export function posterPath(slug: string, size: PosterSize = 'a4'): string | null {
  if (slug.length > 80 || !POSTER_SLUG_PATTERN.test(slug)) return null;
  return size === 'a3' ? `/posters/${slug}/a3/` : `/posters/${slug}/`;
}

/** The player-products section of the Services page (header and footer "Players & parents" links). */
export const PLAYERS_SECTION = '/services/#players';
