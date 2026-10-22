import type { APIRoute } from 'astro';
import { pageSitemapUrls, urlsetXml } from '../lib/archive/sitemap';

// The fixed pages (no lastmod: nothing real to say). Prerendered.
export const prerender = true;

export const GET: APIRoute = ({ site }) =>
  new Response(urlsetXml(pageSitemapUrls(site ?? 'http://localhost:4321')), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
