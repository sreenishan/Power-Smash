# Adapter done (area A, 2026-10-22)

`npx astro build` works with `@astrojs/vercel` 11.0.14 (exact pin). `dist/` is NOT produced any more.

Output layout (Build Output API v3), all under `.vercel/output/`:
- `static/` : every prerendered page and asset (`about/index.html`, `_astro/*`, sitemaps, `404.html`). This replaces `dist/client`.
- `config.json` : routes (adapter writes `_astro` cache, filesystem handle, one `dest: "_render"` route per on-demand endpoint). Worker B's finalize step prepends its managed header/redirect block here.
- `functions/_render.func/` : the single Node function (`.vc-config.json` runtime `nodejs24.x`, handler `.vercel/output/server/entry.mjs`, `node_modules` symlink). Serves `/api/*`, `/go/*`.
- `server/` and `_functions/` : function source (entry.mjs, chunks, middleware). Not static.
No `_headers`, `_redirects` or `wrangler.jsonc`; `dist/client/_headers` checks must move to `config.json`.

Other facts:
- Region: `vercel.json` now holds `{"regions":["bom1"]}` only (the adapter has no region option). Headers and redirects stay out of vercel.json (port-B design).
- Windows: the adapter symlinks `node_modules` into the function folder. It worked in the project folder; it fails with EPERM when `node_modules` is itself a junction (do not build in a copy with a linked node_modules).
- `waitUntil`: `src/lib/after-response.ts` (`@vercel/functions` 3.10.1, direct dependency). Endpoints lead, placements, go use it. `astro:locals` `cfContext` is gone.
- Client address: `src/lib/security/client-ip.ts` (`x-vercel-forwarded-for`, then `x-real-ip`, `x-forwarded-for`; `cf-connecting-ip` ignored). Tests renamed their headers accordingly.
- Env: `process.env` only (`src/lib/runtime-env.ts`). Tests set values through `tests/mocks/runtime-env.ts`.
