// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Canonical origin for absolute URLs (canonical links, Open Graph, sitemaps). Set PUBLIC_SITE_URL in the deploy
// workflow (D-027). The localhost fallback is for local builds only; the strict release gate refuses it.
const site = process.env.PUBLIC_SITE_URL || 'http://localhost:4321';

// Only `astro dev` uses Vite's default package cache (node_modules/.vite). `astro build` and `astro check` start their own Vite
// instance; sharing the folder let a build re-bundle the dev server's packages in production mode while `npm run dev` was running,
// and the admin and the forms then broke on the dev server (`_jsxDEV is not a function`) until it restarted (2026-10-28).
const astroCommand = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const viteCacheDir = astroCommand === 'dev' ? undefined : 'node_modules/.vite-build';

// Vercel port (owner decision 2026-10-22). Output stays static: every page is prerendered, and only routes that export
// `prerender = false` (/api/*, /go/*) become Node serverless functions (default runtime). The function region (bom1,
// Mumbai) is not an adapter option: it is `"regions": ["bom1"]` in vercel.json (docs/m3/vercel-facts.md, row 6).
// https://docs.astro.build/en/guides/integrations-guide/vercel/
export default defineConfig({
  site,
  adapter: vercel({
    // Images are external (YouTube thumbnails); no image optimisation (keeps the Hobby/Pro transformation quota unused).
    imageService: false,
    // The legacy Vercel Web Analytics script is not used (Cloudflare Web Analytics beacon stays, see Analytics.astro).
    webAnalytics: { enabled: false },
  }),
  // No Astro sessions.
  session: false,
  // The site does not use `astro:assets`, so Astro's `/_image` endpoint (sharp, a public CPU-bound route whose answers the CDN
  // caches for a year) is replaced by one that answers 404. `imageService: false` above only skips Vercel's own image service.
  // Guarded by tests/infra/image-endpoint.test.ts; undo both together if images are ever optimised.
  image: {
    // `route` is Astro's default; the type of this block requires it next to `entrypoint`.
    endpoint: { route: '/_image', entrypoint: './src/lib/infra/image-endpoint-disabled.ts' },
  },
  integrations: [react()],
  vite: {
    cacheDir: viteCacheDir,
    plugins: [tailwindcss()],
  },
});
