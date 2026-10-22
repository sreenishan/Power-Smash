// Helpers for the build-output tests in tests/build. Not a test file.
//
// These tests read the BUILT site in .vercel/output/static. They are skipped when that folder does not exist, so a plain `npm test` on a
// fresh checkout stays green. The CI job runs the unit tests BEFORE the build, so on a clean runner this folder is absent and these
// tests are skipped in that step. To make them count, run them after the build with the folder required:
//   PS_REQUIRE_DIST=1 npx vitest run tests/build        (see docs/m1/fix-shell-notes.md, request to the lead for ci.yml)
// With PS_REQUIRE_DIST=1 a missing folder FAILS (the ".vercel/output/static must exist" test) instead of skipping.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles } from '../../scripts/lib/files.ts';
import { STATIC_DIR } from '../../scripts/lib/output-paths.mjs';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const DIST = join(ROOT, STATIC_DIR);
export const hasDist: boolean = existsSync(join(DIST, 'index.html'));
export const requireDist: boolean = process.env.PS_REQUIRE_DIST === '1';

export interface BuiltPage {
  /** Path relative to .vercel/output/static, forward slashes: "index.html", "about/index.html", "404.html". */
  rel: string;
  /** The URL the server serves it at: "/", "/about/". The two error pages have no stable URL (null). */
  url: string | null;
  text: string;
}

/** Every built HTML page (read once per test file). Empty when there is no dist folder. */
export function builtPages(): BuiltPage[] {
  if (!hasDist) return [];
  return listFiles(DIST)
    .filter((f) => f.ext === '.html')
    .map((f) => {
      const text = readFileSync(f.abs, 'utf8');
      let url: string | null = null;
      if (f.rel === 'index.html') url = '/';
      else if (f.rel.endsWith('/index.html')) url = `/${f.rel.slice(0, -'index.html'.length)}`;
      return { rel: f.rel, url, text };
    });
}

/** Every file in .vercel/output/static, as a set of relative paths. */
export function builtFiles(): Set<string> {
  return new Set(hasDist ? listFiles(DIST).map((f) => f.rel) : []);
}

/** The href of every <a> element in a page. */
export function anchorHrefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\shref=(?:"([^"]*)"|'([^']*)')/gi)) out.push((m[1] ?? m[2] ?? '').replaceAll('&amp;', '&'));
  return out;
}
