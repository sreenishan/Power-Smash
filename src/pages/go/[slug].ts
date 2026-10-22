import type { APIRoute } from 'astro';
import { goAllowedHosts, goLinks } from '../../content/go-links';
import { createGoDeps, handleGo } from '../../lib/infra/go-handler';
import { resolveGoData } from '../../lib/infra/go-sponsor-links';
import { afterResponseIfAvailable } from '../../lib/after-response';
import { getRuntimeEnv } from '../../lib/runtime-env';

// Tracked redirect (spec 8.3, D-031). On-demand (runs in the Worker): the click is logged, then the visitor is sent on with a 302.
// Logic lives in src/lib/infra/go.ts and go-handler.ts (unit-tested); this file only wires the Worker environment to it.
export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const env = await getRuntimeEnv();
  const goData = await resolveGoData(env, { links: goLinks, allowedHosts: goAllowedHosts });
  const deps = createGoDeps(
    { ...env, PUBLIC_SITE_URL: env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL },
    {
      links: goData.links,
      allowedHosts: goData.allowedHosts,
      waitUntil: afterResponseIfAvailable(), // undefined = handleGo awaits the click log (a failure never breaks the redirect)
      requestOrigin: new URL(request.url).origin,
    },
  );
  return handleGo(params.slug, request, deps);
};
