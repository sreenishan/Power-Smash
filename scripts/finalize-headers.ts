// Finalise the Vercel header and redirect rules after a build (D-029; Vercel port). `npm run build` (scripts/build.mjs) and
// `npm run build:strict` run it as a build step; it is NOT an npm `postbuild` hook, because .npmrc has ignore-scripts=true.
//
//   node scripts/finalize-headers.ts [--static <folder>] [--config <file>] [--redirects <file>]
//     defaults: --static .vercel/output/static   --config .vercel/output/config.json   --redirects tmp/archive-redirects.json (optional)
//
// What it does to .vercel/output/config.json (written by the Astro Vercel adapter), as a managed block of `routes` placed first:
//   1. finds every inline <script> and <style> in the built pages and puts their SHA-256 hashes into the Content-Security-Policy,
//      so the CSP needs no 'unsafe-inline' for scripts or styles;
//   2. adds `X-Robots-Tag: noindex, nofollow` to every response unless PUBLIC_ALLOW_INDEXING is exactly "true"; when indexing is on it
//      still adds noindex on /api, /go, /admin, on every *.vercel.app host (and PUBLIC_NOINDEX_HOST_SUFFIXES) and on any host that is
//      not the PUBLIC_SITE_URL host (D-023);
//   3. adds `Strict-Transport-Security: max-age=<PUBLIC_HSTS_MAX_AGE>` when that variable is set (final domain only);
//   4. allows the Web Analytics beacon hosts only when PUBLIC_CF_ANALYTICS_TOKEN is set, and the Supabase origin when
//      PUBLIC_SUPABASE_URL is set; Turnstile (a Cloudflare service that works on any host) and YouTube nocookie are always allowed;
//   5. long immutable cache for /_astro/*, no-store plus a locked-down CSP for /api, /go and /cdn-cgi;
//   6. adds the archive redirect routes from the JSON file written by scripts/write-archive-redirects.mjs.
// It fails (exit 1) when a header value is over the precaution size, the route count passes Vercel's 2,048, or a page has an inline
// event handler (blocked by `script-src-attr 'none'`). Running it twice gives the same file.
// Node 24 type stripping: type-annotation-only.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argValue, isMain, listFiles, readText } from './lib/files.ts';
import { cspHash, finalizeConfig, inlineCodeOf } from './lib/headers-file.ts';
import { buildPageCsp, parseMaxAge } from '../src/lib/infra/headers.ts';
import { checkRouteLimits, parseHostSuffixes } from '../src/lib/infra/vercel-routes.ts';
import type { RedirectLike, VercelConfig } from '../src/lib/infra/vercel-routes.ts';

export interface FinalizeResult {
  config: VercelConfig;
  scriptHashes: string[];
  styleHashes: string[];
  eventHandlerPages: string[];
  styleAttributePages: number;
  pages: number;
  cspLength: number;
  problems: string[];
}

const hostOf = (raw: string | undefined): string | null => {
  try {
    return (raw ?? '').trim() === '' ? null : new URL((raw as string).trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Compute the final config for a built static folder. Pure apart from reading the folder. */
export function finalizeFolder(
  root: string,
  existing: VercelConfig,
  env: Record<string, string | undefined>,
  redirects: readonly RedirectLike[] = [],
): FinalizeResult {
  const scripts = new Set<string>();
  const styles = new Set<string>();
  const eventHandlerPages: string[] = [];
  let styleAttributePages = 0;
  let pages = 0;
  for (const file of listFiles(root)) {
    if (file.ext !== '.html' && file.ext !== '.htm') continue;
    const html = readText(file);
    if (html === null) continue;
    pages++;
    const code = inlineCodeOf(html);
    for (const s of code.scripts) scripts.add(cspHash(s));
    for (const s of code.styles) styles.add(cspHash(s));
    if (code.eventHandlerAttributes > 0) eventHandlerPages.push(file.rel);
    if (code.styleAttributes > 0) styleAttributePages++;
  }
  const csp = buildPageCsp({
    scriptHashes: [...scripts],
    styleHashes: [...styles],
    supabaseOrigin: (env.PUBLIC_SUPABASE_URL ?? '').trim() || null,
    analytics: (env.PUBLIC_CF_ANALYTICS_TOKEN ?? '').trim() !== '',
    turnstile: true,
  });
  const config = finalizeConfig(existing, {
    csp,
    allowIndexing: (env.PUBLIC_ALLOW_INDEXING ?? '').trim() === 'true',
    hstsMaxAge: parseMaxAge(env.PUBLIC_HSTS_MAX_AGE),
    canonicalHost: hostOf(env.PUBLIC_SITE_URL),
    noindexHostSuffixes: parseHostSuffixes(env.PUBLIC_NOINDEX_HOST_SUFFIXES),
    redirects,
  });
  const problems = checkRouteLimits(config.routes ?? []);
  if (eventHandlerPages.length > 0) {
    problems.push(`inline event handler attributes (onclick and similar) in ${eventHandlerPages.slice(0, 5).join(', ')}: the CSP blocks them (script-src-attr 'none'). Use addEventListener in a script instead.`);
  }
  return {
    config,
    scriptHashes: [...scripts].sort(),
    styleHashes: [...styles].sort(),
    eventHandlerPages,
    styleAttributePages,
    pages,
    cspLength: csp.length,
    problems,
  };
}

export function main(args: readonly string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): number {
  const staticDir = resolve(argValue(args, '--static') ?? '.vercel/output/static');
  const configPath = resolve(argValue(args, '--config') ?? '.vercel/output/config.json');
  const redirectsPath = resolve(argValue(args, '--redirects') ?? 'tmp/archive-redirects.json');
  if (!existsSync(staticDir) || !statSync(staticDir).isDirectory()) {
    console.error(`finalize-headers: folder not found: ${staticDir}. Run the build first.`);
    return 2;
  }
  if (!existsSync(configPath)) {
    console.error(`finalize-headers: ${configPath} not found. Run the build first (the Astro Vercel adapter writes it).`);
    return 2;
  }
  let existing: VercelConfig;
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf8')) as VercelConfig;
  } catch {
    console.error(`finalize-headers: ${configPath} is not valid JSON.`);
    return 2;
  }
  let redirects: RedirectLike[] = [];
  if (existsSync(redirectsPath)) {
    try {
      redirects = JSON.parse(readFileSync(redirectsPath, 'utf8')) as RedirectLike[];
    } catch {
      console.error(`finalize-headers: ${redirectsPath} is not valid JSON.`);
      return 2;
    }
  }
  const result = finalizeFolder(staticDir, existing, env, redirects);
  if (result.problems.length > 0) {
    for (const p of result.problems) console.error(`finalize-headers: FAIL: ${p}`);
    return 1;
  }
  writeFileSync(configPath, `${JSON.stringify(result.config, null, 2)}\n`, 'utf8');
  console.log(
    `finalize-headers: ${result.pages} page(s), ${result.scriptHashes.length} inline script hash(es), ${result.styleHashes.length} inline style hash(es); CSP ${result.cspLength} characters; ${redirects.length} redirect route(s); ${result.styleAttributePages} page(s) use style attributes (allowed); indexing ${(env.PUBLIC_ALLOW_INDEXING ?? '').trim() === 'true' ? 'ON' : 'OFF (noindex on every response)'}.`,
  );
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
