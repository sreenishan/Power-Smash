# Vercel facts for Power Smash (research, 2026-10-22)

All facts fetched live 2026-10-22 from official sources. "unknown" = not verified.

| # | Topic | Fact | Source |
|---|-------|------|--------|
| 1 | Adapter version | @astrojs/vercel latest = 11.0.16 (published 2026-10-19). peerDependencies: astro ^7.0.0 (Astro 7.3.x OK). | npm registry, 2026-10-22 |
| 1 | 7-day rule | Cutoff 2026-10-15. 11.0.16 (10-19) too new. 11.0.15 (2026-10-15 14:46 UTC) becomes eligible after 14:46 UTC on 2026-10-22. Safe now: 11.0.14 (2026-10-12), 11.0.13 (10-08), 11.0.12 (10-06). | npm registry |
| 1 | Output modes | Static by default; on-demand per route via `prerender = false` (or output server for all). Options: `isr`, `middlewareMode` (edge optional, default serverless), `imageService`, `maxDuration`, `includeFiles/excludeFiles`, `skewProtection` (Pro+), `staticHeaders`. | docs.astro.build/en/guides/integrations-guide/vercel/ |
| 1 | Node | Vercel supports Node 24.x (default) and 22.x; set via package.json engines.node or project setting. Node 20 deprecated 2026-10-01. | vercel.com/docs/functions/runtimes/node-js/node-js-versions |
| 1 | Env vars | Non-Cloudflare adapters read `process.env` at runtime (Astro also reads .env). `astro:env/server` works with compatible adapters; not usable in astro.config.mjs. No cloudflare:workers. | docs.astro.build/en/guides/environment-variables/ |
| 1 | Image service | `imageService: true` uses Vercel Image Optimization (Hobby 5K transformations/mo; Pro $0.05 per 1K after credit). Optional. | astro docs; vercel.com/docs/limits/fair-use-guidelines |
| 1 | Size | Function bundle max 250 MB uncompressed. Build output files: no upper limit, 100k+ files slow builds; 45 min build cap. | vercel.com/docs/functions/limitations; /docs/limits |
| 2 | Hobby commercial | ToS: "You shall only use the Services under a Hobby plan for your personal or non-commercial use." Commercial = any deployment used for financial gain of anyone involved in production; includes requesting/processing payment, advertising sale of a product or service, receiving payment to create/host the site, ads. Donations are not commercial. | vercel.com/legal/terms; /docs/limits/fair-use-guidelines |
| 2 | Implication | Power Smash advertises paid services and sponsor slots, so it is commercial and needs Pro. | derived |
| 2 | Pro | $20/mo (seat-based; viewer seats exist). Monthly usage credit; 10M CDN requests then $2/1M; 1 TB transfer then $0.15/GB; cron per-minute; Password Protection +$20/mo per project. Exact credit amount: unknown. | vercel.com/pricing; /docs/deployment-protection |
| 2 | Function limits | Default 300s on Hobby and Pro; Pro max 800s (1800s beta); memory Hobby 2 GB, Pro up to 4 GB. | vercel.com/docs/functions/limitations |
| 2 | Preview protection | Vercel Authentication on all plans (incl. Hobby). Standard Protection (all plans) protects all deployments except production domains; "All Deployments" also all plans. Password Protection: Pro only, $20/mo per project. Trusted IPs, Passport: Enterprise. Whether new projects default to protected: unknown, check Settings. | vercel.com/docs/deployment-protection |
| 2 | Noindex | Preview (non-production-branch) deployments get `X-Robots-Tag: noindex` automatically, as do outdated production deployments. Exception: custom domains on non-production branches. | vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines |
| 3 | headers | vercel.json `headers` supports CSP, HSTS, Cache-Control etc. Every header/redirect/rewrite counts as a Route: 2048 per deployment (Hobby and Pro). Adapter also has `staticHeaders`. | vercel.com/docs/project-configuration/vercel-json; /docs/limits |
| 3 | redirects | `permanent` true=308 / false=307; `statusCode` allowed 301, 302, 303, 307, 308 only. No 410 via redirects; return 410 from an on-demand Astro route (via rewrite) instead. | vercel-json docs |
| 3 | trailingSlash / cleanUrls | `trailingSlash: true` redirects /about to /about/ (308); paths with a file extension are not redirected. `cleanUrls: true` strips .html (308). With build.format directory, use trailingSlash true and no cleanUrls. Exact default behaviour (undefined): not stated, test on a preview. | vercel-json docs |
| 3 | Static output | Adapter writes `.vercel/output` (Build Output API) with static/ and functions/. /_astro/* long-cache: verify on preview or set a headers rule with immutable. | astro docs; vercel-json docs |
| 4 | Cron limits | 100 cron jobs per project on all plans. Hobby: once per day max, +-59 min precision, faster expressions fail deploy. Pro: once per minute, minute precision. | vercel.com/docs/cron-jobs/usage-and-pricing |
| 4 | Cron call | HTTP GET to the path on production; if env CRON_SECRET is set, sent as `Authorization: Bearer <secret>`; header `x-vercel-cron-schedule`. No retries, best effort, may duplicate; no redirects followed; duration = function limits. `crons: [{path, schedule}]` in vercel.json. | vercel.com/docs/cron-jobs/manage-cron-jobs |
| 4 | Alternative | GitHub Actions `schedule:` workflow hitting the sync endpoint: free of Vercel plan limits. Details not fetched: unknown. | not verified |
| 5 | Git integration | Deploys every push; production branch to production; preview URL per branch/PR. Hobby cannot connect GitHub-organisation repos. | vercel.com/docs/git/vercel-for-github; /docs/limits |
| 5 | Prebuilt via Actions | `vercel pull --yes --environment=production --token=$VERCEL_TOKEN`, `vercel build --prod`, `vercel deploy --prebuilt --prod`. Needs VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID. | vercel.com/docs/git/vercel-for-github |
| 5 | Env scoping | Production, Preview (per-branch optional), Development, custom environments; types Config (readable) and Secret (write-only after save); 64 KB total per deployment; changes apply to new deployments only. | vercel.com/docs/environment-variables |
| 5 | Domains / .in | Not fetched: unknown. | unknown |
| 5 | Other limits | Deployments/day Hobby 100, Pro 6000; deploy hooks 5 per project. | vercel.com/docs/limits |
| 6 | Region | bom1 = Mumbai (ap-south-1) is a function region. Default for new projects is iad1. Set `"regions": ["bom1"]` in vercel.json, dashboard Settings > Functions, or `--regions`. Hobby single region, Pro up to 5. Supabase Mumbai is also ap-south-1, so bom1 keeps DB calls in-region. | vercel.com/docs/regions; /docs/functions/configuring-functions/region |
| 7 | Windows / spaces / ignore-scripts | Unknown (not verified). Builds run on Linux in Vercel or Actions, so only local `vercel build` is affected. sharp may need `npm rebuild sharp` under ignore-scripts=true (consistent with D-002). | unknown |
| 8 | Body size | Function request/response body max 4.5 MB (413). Lead form is small. | vercel.com/docs/functions/limitations |
| 8 | Files | CLI upload limit 15,000 SOURCE files; source upload 100 MB Hobby / 1 GB Pro; no upper limit on build OUTPUT files (about 15,010 files for 15,000 pages is allowed, build time is the constraint). Prebuilt upload limits: unknown. Build machine memory: unknown. | vercel.com/docs/limits |

## What changes vs Cloudflare
- Adapter swap: @astrojs/cloudflare to @astrojs/vercel (astro ^7); drop wrangler.jsonc, cloudflare:workers, custom Worker entry and Worker cron.
- Env: `process.env` (or astro:env/server); values set in the Vercel dashboard.
- The `_headers` file (CSP, noindex, HSTS from finalize-headers) is not used on Vercel: move to vercel.json `headers`. Redirects likewise.
- Cron: Vercel Cron (Pro for every 6 h) or GitHub Actions schedule; GET with CRON_SECRET bearer.
- Cost: Cloudflare Free vs Vercel Pro ($20/mo+) required because the site sells services and sponsor slots. Spend needs owner approval.
- Node functions, 4.5 MB body cap, default region iad1 (set bom1).
- File budget: no hard output-file cap; build time (45 min) instead.
- Deploy via Git integration or `vercel deploy --prebuilt` in deploy.yml; strict build must still gate it.

## Recommended configuration
- Pro plan, region bom1, Node 24.x via engines, adapter pinned exactly (11.0.14 now; 11.0.15 after 14:46 UTC today).
- Prerender everything; `prerender = false` only for lead, events, admin API, go.
- vercel.json: regions bom1, trailingSlash true, headers (CSP, HSTS, /_astro immutable cache, noindex on non-production hosts), redirects, crons for the 6-hourly sync.
- Deployment Protection: Standard Protection with Vercel Authentication (free). Production public.
- CRON_SECRET as Secret in Production only; the cron route rejects any request without the matching bearer.
- Ask owner first: Pro spend, account creation, DNS changes for the .in domain.
