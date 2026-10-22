import type { APIRoute } from 'astro';
import { loadPublicArchive } from '../../lib/archive/model';
import { buildMatchIndex } from '../../lib/archive/search';

// /matches/index.json: the one prebuilt list the /matches filters read (D-010). Full and listed matches only: a protected (minimal)
// match is not in it, so no protected name can be in this file. Prerendered.
export const prerender = true;

export const GET: APIRoute = async () => {
  const archive = await loadPublicArchive();
  return new Response(JSON.stringify(buildMatchIndex(archive)), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
