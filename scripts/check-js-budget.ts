// First-party JavaScript budget (spec 12.5, review finding C-1): no built page may load more than 80 KB (81,920 bytes) of first-party
// JavaScript, gzip level 9, counted the way a visitor loads the page.
//
//   node scripts/check-js-budget.ts [--dist <folder>] [--budget <bytes>] [--top <n>]
//
// What is counted for one page (the static output (.vercel/output/static)/**/*.html):
//   - every <script src> and <link rel="modulepreload"> file that lives in the folder,
//   - the files named by every <astro-island> (component-url, renderer-url, before-hydration-url),
//   - every file those reach through STATIC imports (import ... from "./x.js", export ... from, import "./x.js"), repeated to the end,
//   - every inline executable <script> (the hydration scripts), gzipped on its own (JSON-LD and other data blocks are not code).
// Each file is gzipped separately (level 9) and counted once per page. Not counted in the budget, but reported as "lazy": files reached
// only through a dynamic import() from a chunk (loaded after an interaction, for example the form engine). Scripts on other origins
// (Cloudflare Turnstile, Web Analytics) are listed and not counted: they are not first-party.
//
// Exit codes: 0 every page is inside the budget, 1 a page is over (or there is no page to check), 2 usage error.
// Node 24 type stripping: type-annotation-only.
import { STATIC_DIR } from './lib/output-paths.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, posix, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { argValue, isMain, listFiles, readText } from './lib/files.ts';
import { attributesOf } from './lib/headers-file.ts';

/** 80 KiB of gzip: the budget of spec 12.5. */
export const JS_BUDGET_BYTES = 81_920;

const EXECUTABLE_SCRIPT_TYPES: ReadonlySet<string> = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

export interface ChunkInfo {
  /** Path inside the folder, forward slashes, for example `_astro/client.abc.js`. */
  file: string;
  gzip: number;
  raw: number;
  /** Static imports (resolved to folder paths). */
  statics: string[];
  /** Dynamic imports (resolved to folder paths). */
  dynamics: string[];
}

export interface PageJs {
  /** Page path relative to the folder, for example `book/index.html`. */
  page: string;
  /** Gzip bytes of everything loaded on view: static closure plus inline scripts. This is the number the budget applies to. */
  onViewBytes: number;
  inlineBytes: number;
  inlineScripts: number;
  /** Extra gzip bytes reachable only through dynamic import (not in the budget). */
  lazyBytes: number;
  /** The files counted, biggest first. */
  files: Array<{ file: string; gzip: number }>;
  /** Referenced files that do not exist in the folder (the output is inconsistent). */
  missing: string[];
  /** Scripts on other origins (not counted). */
  external: string[];
}

export interface JsBudgetReport {
  budget: number;
  pages: PageJs[];
  over: PageJs[];
}

const gz = (buf: Buffer): number => gzipSync(buf, { level: 9 }).length;

/** Resolve a URL found in a page or a script to a path inside `root`, or null for an external URL or one that leaves the folder. */
export function resolveAsset(root: string, fromFile: string, url: string): string | null {
  const clean = url.trim().split('#')[0]?.split('?')[0] ?? '';
  if (clean === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) return null;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // keep the raw text
  }
  const joined = decoded.startsWith('/') ? posix.normalize(decoded.slice(1)) : posix.normalize(posix.join(dirname(fromFile) === '.' ? '' : dirname(fromFile), decoded));
  if (joined.startsWith('..') || joined === '' || posix.isAbsolute(joined)) return null;
  const abs = resolve(root, ...joined.split('/'));
  if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) return null;
  return joined;
}

const STATIC_IMPORT = /(?:^|[;{}\s])(?:import|export)\s*(?:[^'"()]*?from\s*)?["']([^"']+?\.m?js(?:\?[^"']*)?)["']/g;
const DYNAMIC_IMPORT = /import\(\s*["'`]([^"'`]+?\.m?js(?:\?[^"'`]*)?)["'`]\s*\)/g;

/** Static and dynamic import specifiers of a piece of JavaScript (resolved against `fromFile`; bare package names are not files and are skipped). */
export function importsOf(root: string, fromFile: string, source: string): { statics: string[]; dynamics: string[] } {
  const pick = (re: RegExp): string[] => {
    const out = new Set<string>();
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1] as string;
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      const r = resolveAsset(root, fromFile, spec);
      if (r) out.add(r);
    }
    return [...out];
  };
  return { statics: pick(STATIC_IMPORT), dynamics: pick(DYNAMIC_IMPORT) };
}

/** Everything one page references, before following imports. */
export interface PageRefs {
  /** Files loaded when the page loads or an island hydrates (folder paths). */
  entries: Set<string>;
  inline: string[];
  external: string[];
  missingLocal: string[];
}

const ASTRO_ISLAND = /<astro-island\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const LINK = /<link\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const SCRIPT = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;

export function referencesOf(root: string, pageFile: string, html: string): PageRefs {
  const refs: PageRefs = { entries: new Set(), inline: [], external: [], missingLocal: [] };
  const add = (url: string | undefined): void => {
    if (!url) return;
    const r = resolveAsset(root, pageFile, url);
    if (r) refs.entries.add(r);
    else if (/^(?:https?:)?\/\//i.test(url.trim())) refs.external.push(url.trim());
  };
  let m: RegExpExecArray | null;
  SCRIPT.lastIndex = 0;
  while ((m = SCRIPT.exec(html)) !== null) {
    const attrs = attributesOf(m[1] as string);
    if (attrs.has('src')) {
      add(attrs.get('src'));
      continue;
    }
    const type = (attrs.get('type') ?? '').trim().toLowerCase();
    if (!EXECUTABLE_SCRIPT_TYPES.has(type)) continue; // JSON-LD, speculation rules, import maps: data, not code
    const body = m[2] as string;
    if (body.trim() === '') continue;
    refs.inline.push(body);
    // an inline script may itself import files: they load with the page
    const { statics, dynamics } = importsOf(root, pageFile, body);
    for (const f of [...statics, ...dynamics]) refs.entries.add(f);
  }
  LINK.lastIndex = 0;
  while ((m = LINK.exec(html)) !== null) {
    const attrs = attributesOf(m[1] as string);
    const rel = (attrs.get('rel') ?? '').toLowerCase();
    if (rel.split(/\s+/).includes('modulepreload') || (rel.split(/\s+/).includes('preload') && (attrs.get('as') ?? '').toLowerCase() === 'script')) add(attrs.get('href'));
  }
  ASTRO_ISLAND.lastIndex = 0;
  while ((m = ASTRO_ISLAND.exec(html)) !== null) {
    const attrs = attributesOf(m[1] as string);
    add(attrs.get('component-url'));
    add(attrs.get('renderer-url'));
    add(attrs.get('before-hydration-url'));
  }
  return refs;
}

/** Measure every page in `root` against `budget` (gzip bytes). */
export function measureJsBudget(root: string, budget: number = JS_BUDGET_BYTES): JsBudgetReport {
  const cache = new Map<string, ChunkInfo | null>();
  const chunk = (file: string): ChunkInfo | null => {
    if (cache.has(file)) return cache.get(file) as ChunkInfo | null;
    const abs = resolve(root, ...file.split('/'));
    let info: ChunkInfo | null = null;
    if (existsSync(abs) && statSync(abs).isFile()) {
      const buf = readFileSync(abs);
      const { statics, dynamics } = importsOf(root, file, buf.toString('utf8'));
      info = { file, gzip: gz(buf), raw: buf.length, statics, dynamics };
    }
    cache.set(file, info);
    return info;
  };

  const closure = (entries: Iterable<string>, withDynamic: boolean, missing: Set<string>): Set<string> => {
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length > 0) {
      const f = stack.pop() as string;
      if (seen.has(f)) continue;
      const info = chunk(f);
      if (!info) {
        missing.add(f);
        continue;
      }
      seen.add(f);
      stack.push(...info.statics);
      if (withDynamic) stack.push(...info.dynamics);
    }
    return seen;
  };

  const pages: PageJs[] = [];
  for (const file of listFiles(root)) {
    if (file.ext !== '.html' && file.ext !== '.htm') continue;
    const html = readText(file) ?? '';
    const refs = referencesOf(root, file.rel, html);
    const missing = new Set<string>();
    const onView = closure(refs.entries, false, missing);
    const everything = closure(refs.entries, true, new Set<string>());
    const inlineBytes = refs.inline.reduce((n, body) => n + gz(Buffer.from(body, 'utf8')), 0);
    const files = [...onView].map((f) => ({ file: f, gzip: (chunk(f) as ChunkInfo).gzip })).sort((a, b) => b.gzip - a.gzip);
    const onViewBytes = files.reduce((n, f) => n + f.gzip, 0) + inlineBytes;
    const lazyBytes = [...everything].filter((f) => !onView.has(f)).reduce((n, f) => n + (chunk(f) as ChunkInfo).gzip, 0);
    pages.push({
      page: file.rel,
      onViewBytes,
      inlineBytes,
      inlineScripts: refs.inline.length,
      lazyBytes,
      files,
      missing: [...missing].sort(),
      external: [...new Set(refs.external)].sort(),
    });
  }
  pages.sort((a, b) => b.onViewBytes - a.onViewBytes || (a.page < b.page ? -1 : 1));
  return { budget, pages, over: pages.filter((p) => p.onViewBytes > budget) };
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;

export function formatJsBudgetReport(report: JsBudgetReport, distLabel: string, top = 10): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  lines.push(`check-js-budget: ${report.pages.length} page(s) in ${distLabel}, budget ${report.budget.toLocaleString('en-US')} bytes gzip (${kb(report.budget)}) of first-party JavaScript per page.`);
  if (report.pages.length === 0) {
    lines.push('  FAIL: no HTML page found, so nothing was measured. Run the build first (npm run build).');
    return { lines, exitCode: 1 };
  }
  lines.push(`  Heaviest ${Math.min(top, report.pages.length)} page(s): on view = static scripts + inline scripts, gzip level 9; lazy = loaded only after an interaction (not in the budget)`);
  for (const p of report.pages.slice(0, top)) {
    const flag = p.onViewBytes > report.budget ? `  OVER by ${(p.onViewBytes - report.budget).toLocaleString('en-US')}` : '';
    lines.push(`    ${String(p.onViewBytes).padStart(7)} B (${kb(p.onViewBytes).padStart(9)})  inline ${String(p.inlineBytes).padStart(5)}  lazy ${String(p.lazyBytes).padStart(6)}  ${p.page}${flag}`);
  }
  for (const p of report.pages) {
    if (p.missing.length > 0) lines.push(`  warning: ${p.page} refers to ${p.missing.length} script file(s) that are not in the folder (${p.missing.slice(0, 3).join(', ')}). The output is inconsistent.`);
  }
  if (report.over.length > 0) {
    lines.push(`  FAIL: ${report.over.length} page(s) over the budget: ${report.over.map((p) => p.page).slice(0, 8).join(', ')}${report.over.length > 8 ? ', ...' : ''}`);
    const worst = report.over[0] as PageJs;
    lines.push(`  Biggest files on ${worst.page}:`);
    for (const f of worst.files.slice(0, 6)) lines.push(`    ${String(f.gzip).padStart(7)} B  ${f.file}`);
    if (worst.inlineBytes > 0) lines.push(`    ${String(worst.inlineBytes).padStart(7)} B  ${worst.inlineScripts} inline script(s)`);
    return { lines, exitCode: 1 };
  }
  lines.push('  OK: every page is inside the budget.');
  return { lines, exitCode: 0 };
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const label = argValue(args, '--dist') ?? STATIC_DIR;
  const root = resolve(label);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`check-js-budget: folder not found: ${root}. Run the build first (npm run build).`);
    return 2;
  }
  const budgetArg = argValue(args, '--budget');
  const budget = budgetArg === null ? JS_BUDGET_BYTES : Number(budgetArg);
  if (!Number.isInteger(budget) || budget <= 0) {
    console.error('check-js-budget: --budget must be a whole number of bytes.');
    return 2;
  }
  const topArg = argValue(args, '--top');
  const top = topArg === null ? 10 : Number(topArg);
  const { lines, exitCode } = formatJsBudgetReport(measureJsBudget(root, budget), label, Number.isInteger(top) && top > 0 ? top : 10);
  for (const line of lines) console.log(line);
  return exitCode;
}

if (isMain(import.meta.url)) process.exit(main());
