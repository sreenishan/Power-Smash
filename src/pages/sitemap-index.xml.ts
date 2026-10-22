import type { APIRoute } from 'astro';
import { tournaments as ownerTournaments } from '../content/tournaments';
import { loadPublicArchive } from '../lib/archive/model';
import { sitemapIndexEntries, sitemapIndexXml } from '../lib/archive/sitemap';

// /sitemap-index.xml: the index of the four sitemaps split by type (spec 9.1). Prerendered.
export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? 'http://localhost:4321';
  const archive = await loadPublicArchive();
  return new Response(sitemapIndexXml(sitemapIndexEntries(archive, ownerTournaments, origin)), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
