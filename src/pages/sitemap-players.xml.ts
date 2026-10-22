import type { APIRoute } from 'astro';
import { loadPublicArchive } from '../lib/archive/model';
import { playerSitemapUrls, urlsetXml } from '../lib/archive/sitemap';

// Adult_confirmed profiles only, with lastmod. No unknown-age or protected player is ever listed (D-012). Prerendered.
export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const archive = await loadPublicArchive();
  return new Response(urlsetXml(playerSitemapUrls(archive, site ?? 'http://localhost:4321')), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
