// XML sitemaps split by type with lastmod (spec 9.1). Pure builders; the endpoints in src/pages/sitemap-*.xml.ts call them.
// Only INDEXABLE pages are listed: full and listed matches, adult profiles, public tournaments. A minimal (noindex) match or player,
// a protected player and a hidden record are never in any sitemap, and a minimal match's opaque slug is not listed either (D-012).
import { ARCHIVE_ROUTES, M3_ROUTES, ROUTES, absoluteUrl, tournamentPath } from '../urls';
import type { PublicArchive } from './model';
import { TOURNAMENT_PAGES_BUILT } from './provider';

export const SITEMAP_URL_LIMIT = 50_000;

export interface SitemapUrl {
  loc: string;
  /** YYYY-MM-DD, or omitted when nothing real is known (never invented). */
  lastmod?: string | null;
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const entry = (tag: 'url' | 'sitemap', u: SitemapUrl): string =>
  `  <${tag}><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${xmlEscape(u.lastmod)}</lastmod>` : ''}</${tag}>`;

export function urlsetXml(urls: readonly SitemapUrl[]): string {
  if (urls.length > SITEMAP_URL_LIMIT) throw new Error(`A sitemap may hold at most ${SITEMAP_URL_LIMIT} URLs (got ${urls.length}); split it.`);
  const body = urls.map((u) => entry('url', u)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</urlset>\n`;
}

export function sitemapIndexXml(entries: readonly SitemapUrl[]): string {
  const body = entries.map((u) => entry('sitemap', u)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</sitemapindex>\n`;
}

const latest = (dates: readonly string[]): string | null => [...dates].sort().at(-1) ?? null;

export function matchSitemapUrls(archive: Pick<PublicArchive, 'grid'>, origin: string | URL): SitemapUrl[] {
  return archive.grid
    .filter((m) => m.kind === 'full' || m.kind === 'listed')
    .map((m) => ({ loc: absoluteUrl(`/matches/${m.slug}/`, origin), lastmod: m.lastmod }));
}

export function playerSitemapUrls(archive: Pick<PublicArchive, 'players'>, origin: string | URL): SitemapUrl[] {
  return archive.players.map((p) => ({ loc: absoluteUrl(`/players/${p.slug}/`, origin), lastmod: p.lastmod }));
}

export interface OwnerTournamentLike {
  slug: string;
  startDate: string;
  endDate: string | null;
}

/** Owner-entered tournaments (the M1 pages exist) plus archive tournaments once their pages are built. */
export function tournamentSitemapUrls(
  archive: Pick<PublicArchive, 'tournaments'>,
  ownerTournaments: readonly OwnerTournamentLike[],
  origin: string | URL,
  archivePagesBuilt: boolean = TOURNAMENT_PAGES_BUILT,
): SitemapUrl[] {
  const owner = ownerTournaments.map((t) => ({ loc: absoluteUrl(tournamentPath(t.slug), origin), lastmod: t.endDate ?? t.startDate }));
  const arch = archivePagesBuilt ? archive.tournaments.map((t) => ({ loc: absoluteUrl(tournamentPath(t.slug), origin), lastmod: t.lastmod })) : [];
  // The archive model gives archive tournaments addresses the owner list does not use (model.ts tournamentSlugs), so a duplicate
  // here is a bug: fail the build rather than silently dropping one of two pages.
  const seen = new Set<string>();
  for (const u of [...owner, ...arch]) {
    if (seen.has(u.loc)) throw new Error(`sitemap-tournaments: duplicate address ${u.loc}`);
    seen.add(u.loc);
  }
  return [...owner, ...arch];
}

/** The fixed pages. No lastmod: nothing real to say about them. */
export function pageSitemapUrls(origin: string | URL, withArchive: boolean = true): SitemapUrl[] {
  const paths = [...Object.values(ROUTES), ...Object.values(M3_ROUTES), ...(withArchive ? Object.values(ARCHIVE_ROUTES) : [])];
  return [...new Set(paths)].map((p) => ({ loc: absoluteUrl(p, origin) }));
}

export const SITEMAP_FILES = {
  matches: '/sitemap-matches.xml',
  players: '/sitemap-players.xml',
  tournaments: '/sitemap-tournaments.xml',
  pages: '/sitemap-pages.xml',
} as const;

export function sitemapIndexEntries(
  archive: Pick<PublicArchive, 'grid' | 'players' | 'tournaments'>,
  ownerTournaments: readonly OwnerTournamentLike[],
  origin: string | URL,
  withArchive: boolean = true,
): SitemapUrl[] {
  const abs = (p: string) => new URL(p, origin).toString();
  return [
    { loc: abs(SITEMAP_FILES.pages) },
    ...(withArchive
      ? [
          { loc: abs(SITEMAP_FILES.matches), lastmod: latest(archive.grid.map((m) => m.lastmod)) },
          { loc: abs(SITEMAP_FILES.players), lastmod: latest(archive.players.map((p) => p.lastmod)) },
        ]
      : []),
    {
      loc: abs(SITEMAP_FILES.tournaments),
      lastmod: latest(tournamentSitemapUrls(archive, ownerTournaments, origin).flatMap((u) => (u.lastmod ? [u.lastmod] : []))),
    },
  ];
}
