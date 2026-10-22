import type { APIRoute } from 'astro';
import { env } from '../config/env';
import { features } from '../content/legal/status';
import { robotsTxt } from '../lib/seo';
import { robotsSitemapUrl } from '../lib/wiring/robots';

// robots.txt (hard rule 9): Disallow everything unless PUBLIC_ALLOW_INDEXING is exactly "true" at build time.
// Prerendered, so the text is fixed at build. The sitemap line appears only when indexing is allowed AND features.archivePages is true.
export const prerender = true;

export const GET: APIRoute = ({ site }) =>
  new Response(
    robotsTxt({ allowIndexing: env.allowIndexing, sitemapUrl: robotsSitemapUrl({ allowIndexing: env.allowIndexing, archivePages: features.archivePages, site }) }),
    {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    },
  );
