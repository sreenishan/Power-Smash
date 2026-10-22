// Structured data for archive pages (spec 7.3, 7.5, 9.1). Builders only: the page writes them through <JsonLd> and safeJsonLd()
// (src/lib/jsonld.ts), which escapes <, >, &, U+2028 and U+2029, so a title can never close the script tag.
// Only fields that are really known are emitted (compact()). Protected people never reach these builders: they take ArchiveMatch and
// ArchivePlayer, which only ever hold adult profile data (model.ts), and a minimal match gets NO structured data at all.
import { compact } from '../jsonld';
import { YOUTUBE_EMBED_ORIGIN } from '../../content/live';
import { isoDuration } from './labels';
import { ytThumb } from './youtube';
import type { ArchiveMatch, ArchivePlayer } from './model';
import { absoluteUrl } from '../urls';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

export const YT_NOCOOKIE_EMBED = `${YOUTUBE_EMBED_ORIGIN}/embed/`;

/** The meta description of a match page. Built from facts only; the title is never rewritten. */
export function matchDescription(m: ArchiveMatch): string {
  if (m.kind === 'minimal') return 'A badminton match video from Power Smash on YouTube.';
  const where = m.tournament ? ` from ${m.tournament.name}` : '';
  return `Badminton match video${where}. Title shown exactly as published on YouTube.`;
}

export function videoObjectJsonLd(m: ArchiveMatch, origin: string | URL): Record<string, Json | undefined> {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: m.rawTitle,
    description: matchDescription(m),
    thumbnailUrl: [ytThumb(m.videoId, 'hqdefault')],
    uploadDate: m.publishedAt,
    duration: isoDuration(m.durationSeconds) ?? undefined,
    embedUrl: `${YT_NOCOOKIE_EMBED}${m.videoId}`,
    url: absoluteUrl(`/matches/${m.slug}/`, origin),
  });
}

/** ProfilePage with an adult Person and a list of their videos (spec 7.5). Never called for a minimal player. */
export function profilePageJsonLd(p: ArchivePlayer, origin: string | URL, videoLimit = 20): Record<string, Json | undefined> {
  const url = absoluteUrl(`/players/${p.slug}/`, origin);
  return compact({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    mainEntity: {
      '@type': 'Person',
      name: p.name,
      url,
      homeLocation: p.district
        ? { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: p.district, addressCountry: 'IN' } }
        : undefined,
    },
    hasPart: {
      '@type': 'ItemList',
      itemListElement: p.matches.slice(0, videoLimit).map((m, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absoluteUrl(`/matches/${m.slug}/`, origin),
        name: m.rawTitle,
      })),
    },
  });
}
