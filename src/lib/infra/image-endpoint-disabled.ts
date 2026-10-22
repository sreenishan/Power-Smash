// Astro's image endpoint (`/_image`, sharp) switched off. The site does not use `astro:assets` (no <Image>, no getImage; images are
// static files in /public or external YouTube thumbnails), so there is nothing for the endpoint to serve, and left alone it would be a
// public, CPU-bound function route whose answers the CDN caches for a year. astro.config.mjs points `image.endpoint.entrypoint` here,
// so the route stays in the build but answers 404 for every method and runs no image code.
//
// If the site ever starts using `astro:assets`, remove `image.endpoint` from astro.config.mjs and delete this file (tests/infra/image-endpoint.test.ts guards both).
import type { APIRoute } from 'astro';

export const prerender = false;

export const ALL: APIRoute = () =>
  new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
