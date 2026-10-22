import type { APIRoute } from 'astro';
import { loadPublicArchive } from '../lib/archive/model';
import { buildSearchIndex } from '../lib/archive/search';

// /search-index.json: ONE prebuilt index of adult_confirmed players (with a profile page) and tournaments (D-010).
// Protected and unknown-age players never enter it (tests/archive). Prerendered.
export const prerender = true;

export const GET: APIRoute = async () => {
  const archive = await loadPublicArchive();
  return new Response(JSON.stringify(buildSearchIndex(archive)), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
