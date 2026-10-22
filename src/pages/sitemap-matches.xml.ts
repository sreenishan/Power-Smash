import type { APIRoute } from 'astro';
import { loadPublicArchive } from '../lib/archive/model';
import { matchSitemapUrls, urlsetXml } from '../lib/archive/sitemap';

// Full and listed matches only, with lastmod. A protected (minimal) match is never listed (D-012). Prerendered.
export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const archive = await loadPublicArchive();
  return new Response(urlsetXml(matchSitemapUrls(archive, site ?? 'http://localhost:4321')), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
