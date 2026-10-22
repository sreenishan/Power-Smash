import type { APIRoute } from 'astro';
import { tournaments as ownerTournaments } from '../content/tournaments';
import { loadPublicArchive } from '../lib/archive/model';
import { tournamentSitemapUrls, urlsetXml } from '../lib/archive/sitemap';

// Owner-entered tournaments (their pages exist) plus archive tournaments once TOURNAMENT_PAGES_BUILT is true. Prerendered.
export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const archive = await loadPublicArchive();
  return new Response(urlsetXml(tournamentSitemapUrls(archive, ownerTournaments, site ?? 'http://localhost:4321')), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
