// Release check (BUILD_PLAN M1 items 4 and 7, D-023, D-027, D-009). Refuses a release build that is not ready to be public.
//
//   node scripts/check-release.ts [--dist <folder>] [--config <config.json>] [--env-only] [--strict]
// Defaults come from scripts/lib/output-paths.mjs (.vercel/output/static and .vercel/output/config.json).
//
// Strict mode = `--strict` or PS_STRICT=1: any error exits 1. Normal mode prints the same findings as "would fail the strict
// build" and exits 0. `--env-only` checks the build variables only (fast, run BEFORE a long build); without it the built output is
// checked as well.
//
// Reads process.env only, the same way astro.config.mjs does, so what is checked is what was built.
//
// Environment rules:
//   PUBLIC_SITE_URL           present, https, an origin (no path), not localhost
//   PUBLIC_ALLOW_INDEXING     present and exactly "true" or "false" (explicit, never guessed)
//   required public variables PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...), PUBLIC_TURNSTILE_SITE_KEY,
//                             PUBLIC_WHATSAPP_NUMBER
//   indexing allowed          the site host is not a *.vercel.app (or PUBLIC_NOINDEX_HOST_SUFFIXES) address, and the Turnstile site key is not one of Cloudflare Turnstile's published test keys
//   no secret in PUBLIC_*     names that look secret (except the three documented public ones) and values that look like a secret
//   optional                  PUBLIC_CF_ANALYTICS_TOKEN (warning if missing), PUBLIC_HSTS_MAX_AGE (validated when set)
//   WhatsApp number           must pass normaliseWhatsAppNumber (src/lib/whatsapp.ts, the helper behind every wa.me link): a 10-digit number
//                             without 91, or one with a leading 0, is refused (review B-12)
// Site facts (src/content/site.ts, review C-17): the owner-stated channel figures carry an `asOfDate`. Older than 90 days is a WARNING in a
//   normal build and an ERROR in the strict release build; the dated audience figures get the same check once the owner supplies them.
// Output rules (when a folder is given):
//   every canonical link has the origin of PUBLIC_SITE_URL; every page is noindex unless indexing is allowed and the home page is
//   indexable when it is; robots.txt agrees; file count budget (D-009 page budget kept: warn above 10,000, fail above 14,000; Vercel has no
//   hard output-file cap, the limit is the 45-minute build); the routing config (config.json, written by scripts/finalize-headers.ts)
//   carries a CSP and a noindex rule, stays under Vercel's 2,048 routes and header size precaution; archive redirects stay under 1,800.
// Node 24 type stripping: type-annotation-only.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argValue, isMain, isStrict, listFiles, readText } from './lib/files.ts';
import { CONFIG_PATH, STATIC_DIR } from './lib/output-paths.mjs';
import { RULES } from './lib/privacy-rules.ts';
import { normaliseWhatsAppNumber } from '../src/lib/whatsapp.ts';
import { isNoindexHost } from '../src/lib/infra/headers.ts';
import { REDIRECT_RULES_MAX, ROUTE_SRC, checkRouteLimits, managedRoutesOf, parseHostSuffixes, routeHeader } from '../src/lib/infra/vercel-routes.ts';
import type { VercelConfig } from '../src/lib/infra/vercel-routes.ts';

export interface ReleaseResult {
  errors: string[];
  warnings: string[];
}

export const REQUIRED_PUBLIC_VARS: readonly string[] = [
  'PUBLIC_SITE_URL',
  'PUBLIC_ALLOW_INDEXING',
  'PUBLIC_SUPABASE_URL',
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'PUBLIC_TURNSTILE_SITE_KEY',
  'PUBLIC_WHATSAPP_NUMBER',
];

/** Public variables whose NAME contains a secret-looking word but whose value is public by design. */
export const PUBLIC_NAME_EXCEPTIONS: ReadonlySet<string> = new Set([
  'PUBLIC_CF_ANALYTICS_TOKEN',
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'PUBLIC_TURNSTILE_SITE_KEY',
]);

const SECRET_LOOKING_NAME = /(SECRET|PASSWORD|PASSWD|PRIVATE|SERVICE_ROLE|API_KEY|ACCESS_KEY|TOKEN)/;

/** Cloudflare's published always-pass and always-fail Turnstile TEST site keys (docs: turnstile/troubleshooting/testing, 2026-10-21). */
export const TURNSTILE_TEST_SITE_KEY = /^[123]x0{20}[A-Z]{2}$/;

export const FILE_BUDGET_WARN = 10_000;
export const FILE_BUDGET_FAIL = 14_000;

const clean = (v: string | undefined): string => (v ?? '').trim();

const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]' || host === '::1' || host.endsWith('.local');

export function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * Why a WhatsApp number is refused, in plain words. The pass/fail decision itself is normaliseWhatsAppNumber (src/lib/whatsapp.ts), the
 * helper every wa.me link goes through, so the release check and the buttons can never disagree (review B-12).
 */
export function whatsAppProblem(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) {
    return 'it starts with 0, so the country code is missing. Write digits with the country code and no plus sign: 91 followed by the 10-digit mobile number.';
  }
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return 'this is a 10-digit Indian mobile number without the country code, so every WhatsApp button would open a dead chat. Write 91 in front of it (91 followed by the 10 digits).';
  }
  return 'it must be digits with the country code (8 to 15 digits in all), for example 91 followed by the 10-digit mobile number.';
}

/** Checks of the build variables only. */
export function evaluateEnv(env: Record<string, string | undefined>): ReleaseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of REQUIRED_PUBLIC_VARS) {
    if (clean(env[name]) === '') errors.push(`${name} is not set. Set it as a repository variable for the release workflow (see .env.example).`);
  }

  // PUBLIC_SITE_URL
  const siteRaw = clean(env.PUBLIC_SITE_URL);
  let site: URL | null = null;
  if (siteRaw !== '') {
    site = parseHttpUrl(siteRaw);
    if (!site) errors.push('PUBLIC_SITE_URL is not a valid web address.');
    else {
      if (isLocalHost(site.hostname)) errors.push(`PUBLIC_SITE_URL points at a local address (${site.hostname}). A release needs the real site address.`);
      if (site.protocol !== 'https:') errors.push('PUBLIC_SITE_URL must start with https://.');
      if (site.username || site.password || site.search || site.hash || (site.pathname !== '/' && site.pathname !== '')) {
        errors.push('PUBLIC_SITE_URL must be the site origin only (for example https://example.com), with no path, query, fragment or login.');
      }
    }
  }

  // PUBLIC_ALLOW_INDEXING
  const allow = clean(env.PUBLIC_ALLOW_INDEXING);
  if (allow !== '' && allow !== 'true' && allow !== 'false') {
    errors.push('PUBLIC_ALLOW_INDEXING must be exactly "true" or "false" (explicit). Any other value is refused.');
  }
  if (allow === 'true') {
    if (site && isNoindexHost(site.hostname, null, parseHostSuffixes(env.PUBLIC_NOINDEX_HOST_SUFFIXES))) errors.push('PUBLIC_ALLOW_INDEXING is "true" but PUBLIC_SITE_URL is a vercel.app (or other never-indexed preview) address. The canonical address must be the final domain (D-023).');
    if (TURNSTILE_TEST_SITE_KEY.test(clean(env.PUBLIC_TURNSTILE_SITE_KEY))) errors.push('PUBLIC_ALLOW_INDEXING is "true" but PUBLIC_TURNSTILE_SITE_KEY is one of Cloudflare\'s published TEST keys. Use the production widget keys (OT-41).');
  } else if (allow === 'false' && TURNSTILE_TEST_SITE_KEY.test(clean(env.PUBLIC_TURNSTILE_SITE_KEY))) {
    warnings.push('PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key. Fine for a noindex preview; never for the live site (OT-41).');
  }

  // Supabase
  const supaUrl = clean(env.PUBLIC_SUPABASE_URL);
  if (supaUrl !== '') {
    const u = parseHttpUrl(supaUrl);
    if (!u) errors.push('PUBLIC_SUPABASE_URL is not a valid web address.');
    else {
      if (u.protocol !== 'https:') errors.push('PUBLIC_SUPABASE_URL must start with https://.');
      if (isLocalHost(u.hostname)) errors.push('PUBLIC_SUPABASE_URL points at a local address.');
    }
  }
  const pub = clean(env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (pub !== '' && !pub.startsWith('sb_publishable_')) {
    errors.push('PUBLIC_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_. Never put a secret key here.');
  }

  // WhatsApp number
  const wa = clean(env.PUBLIC_WHATSAPP_NUMBER);
  if (wa !== '' && normaliseWhatsAppNumber(wa) === null) errors.push(`PUBLIC_WHATSAPP_NUMBER: ${whatsAppProblem(wa)}`);

  // Analytics token and HSTS (optional)
  const cf = clean(env.PUBLIC_CF_ANALYTICS_TOKEN);
  if (cf === '') warnings.push('PUBLIC_CF_ANALYTICS_TOKEN is not set: the Cloudflare Web Analytics beacon will not be rendered (privacy-safe default).');
  else if (!/^[A-Za-z0-9]{16,64}$/.test(cf)) errors.push('PUBLIC_CF_ANALYTICS_TOKEN must be 16 to 64 letters or digits.');
  const hsts = clean(env.PUBLIC_HSTS_MAX_AGE);
  if (hsts !== '') {
    if (!/^\d{1,10}$/.test(hsts) || Number(hsts) > 63_072_000) errors.push('PUBLIC_HSTS_MAX_AGE must be a whole number of seconds, at most 63072000 (two years).');
    else if (Number(hsts) > 0 && site && isNoindexHost(site.hostname, null, parseHostSuffixes(env.PUBLIC_NOINDEX_HOST_SUFFIXES))) warnings.push('PUBLIC_HSTS_MAX_AGE is set for a vercel.app preview address. Set it only once the final domain is live (D-023).');
  }

  // Nothing secret in PUBLIC_*
  const criticalRules = RULES.filter((r) => r.severity === 'critical');
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith('PUBLIC_')) continue;
    if (!PUBLIC_NAME_EXCEPTIONS.has(name) && SECRET_LOOKING_NAME.test(name)) {
      errors.push(`${name}: the name looks like a secret. PUBLIC_ variables are copied into the browser bundle (D-027).`);
    }
    const value = clean(raw);
    if (value === '') continue;
    for (const rule of criticalRules) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(value)) errors.push(`${name}: the value looks like a secret (${rule.id}). PUBLIC_ variables are copied into the browser bundle (D-027).`);
    }
  }
  return { errors, warnings };
}

const metaRobotsNoindex = (html: string): boolean => /<meta\b[^>]*\bname=["']?robots["']?[^>]*\bcontent=["'][^"']*noindex/i.test(html) || /<meta\b[^>]*\bcontent=["'][^"']*noindex[^"']*["'][^>]*\bname=["']?robots/i.test(html);

const canonicalHref = (html: string): string | null => {
  const tag = /<link\b[^>]*\brel=["']?canonical["']?[^>]*>/i.exec(html);
  if (!tag) return null;
  const href = /\bhref=["']([^"']*)["']/i.exec(tag[0]);
  return href ? (href[1] as string) : null;
};

/** Checks of the built output. */
export function evaluateDist(root: string, env: Record<string, string | undefined>, configPath: string = join(dirname(root), 'config.json')): ReleaseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const files = listFiles(root);
  const allow = clean(env.PUBLIC_ALLOW_INDEXING);
  const site = parseHttpUrl(clean(env.PUBLIC_SITE_URL));
  const siteOrigin = site ? site.origin : null;

  // File budget (D-009): regular files in the static output. Vercel has no hard cap on output files; the budget is our page budget
  // (build time is the real limit: 45 minutes, and prebuilt upload limits are unverified, docs/m3/vercel-facts.md #8).
  if (files.length > FILE_BUDGET_FAIL) errors.push(`The static output has ${files.length} files, above the ${FILE_BUDGET_FAIL} budget (Vercel has no file cap but builds stop at 45 minutes). Trim pages (D-009, D-013).`);
  else if (files.length > FILE_BUDGET_WARN) warnings.push(`The static output has ${files.length} files (budget warning above ${FILE_BUDGET_WARN}, failure above ${FILE_BUDGET_FAIL}).`);

  const htmlFiles = files.filter((f) => f.ext === '.html' || f.ext === '.htm');
  const wrongCanonical: string[] = [];
  const missingNoindex: string[] = [];
  for (const f of htmlFiles) {
    const html = readText(f) ?? '';
    const canonical = canonicalHref(html);
    if (canonical && siteOrigin) {
      let origin: string | null = null;
      try {
        origin = new URL(canonical).origin;
      } catch {
        origin = null;
      }
      if (origin !== siteOrigin) wrongCanonical.push(f.rel);
    }
    if (allow !== 'true' && !metaRobotsNoindex(html)) missingNoindex.push(f.rel);
  }
  if (wrongCanonical.length > 0) errors.push(`${wrongCanonical.length} page(s) have a canonical link that is not on PUBLIC_SITE_URL (${siteOrigin}): ${wrongCanonical.slice(0, 5).join(', ')}${wrongCanonical.length > 5 ? ', ...' : ''}`);
  if (missingNoindex.length > 0) errors.push(`PUBLIC_ALLOW_INDEXING is not "true" but ${missingNoindex.length} page(s) lack <meta name="robots" content="noindex">: ${missingNoindex.slice(0, 5).join(', ')}${missingNoindex.length > 5 ? ', ...' : ''}`);
  if (allow === 'true') {
    const home = htmlFiles.find((f) => f.rel === 'index.html');
    if (home && metaRobotsNoindex(readText(home) ?? '')) errors.push('PUBLIC_ALLOW_INDEXING is "true" but the home page still says noindex.');
  }

  // robots.txt agrees with the flag.
  const robots = files.find((f) => f.rel === 'robots.txt');
  if (robots) {
    const text = readText(robots) ?? '';
    const blocksAll = /^\s*Disallow:\s*\/\s*$/im.test(text);
    if (allow !== 'true' && !blocksAll) errors.push('robots.txt does not disallow everything although PUBLIC_ALLOW_INDEXING is not "true".');
    if (allow === 'true' && blocksAll) errors.push('robots.txt disallows everything although PUBLIC_ALLOW_INDEXING is "true".');
  }

  // Routing config (Build Output API config.json): present, carries a CSP and a noindex rule, inside Vercel's limits.
  let config: VercelConfig | null = null;
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8')) as VercelConfig;
    } catch {
      errors.push(`${configPath} is not valid JSON.`);
    }
  } else {
    errors.push(`${configPath} is missing: no security headers would be sent. Run \`npm run build\` (its last steps write them) instead of calling astro build directly.`);
  }
  if (config) {
    const managed = managedRoutesOf(config);
    if (managed.length === 0) errors.push('config.json has no managed header block (finalize-headers did not run): no security headers would be sent. Run `npm run build` instead of calling astro build directly.');
    else {
      if (!routeHeader(managed, ROUTE_SRC.pages, 'Content-Security-Policy')) errors.push('config.json has no Content-Security-Policy rule for pages. Run `npm run build` (its last step writes it) instead of calling astro build directly.');
      if (allow !== 'true' && !/noindex/i.test(routeHeader(managed, ROUTE_SRC.everywhere, 'X-Robots-Tag') ?? '')) errors.push('config.json has no X-Robots-Tag: noindex rule although PUBLIC_ALLOW_INDEXING is not "true".');
      const redirects = managed.filter((r) => typeof r.status === 'number' && r.headers?.Location !== undefined).length;
      if (redirects > REDIRECT_RULES_MAX) errors.push(`config.json has ${redirects} archive redirect rules; the limit is ${REDIRECT_RULES_MAX} (D-009).`);
    }
    errors.push(...checkRouteLimits(config.routes ?? []));
  }
  return { errors, warnings };
}

// ---- stored figures (D-016 item 5, review C-17) -----------------------------------------------------------------------------------------

/** Owner-stated figures older than this many days are stale: a warning in a normal build, a failure in the strict release build. */
export const FIGURES_MAX_AGE_DAYS = 90;

/** TypeScript source with line comments and block comments replaced by spaces (strings are respected, so a URL inside quotes is safe). */
export function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      out += '\n';
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else out += c;
  }
  return out;
}

/** The `name: { ... }` block of an object literal in comment-free TypeScript (string-aware brace matching), or null. */
export function blockOf(cleanSource: string, name: string): string | null {
  const start = new RegExp(`^[ \\t]*${name}\\s*:\\s*\\{`, 'm').exec(cleanSource);
  if (!start) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start.index + start[0].length - 1; i < cleanSource.length; i++) {
    const c = cleanSource[i] as string;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return cleanSource.slice(start.index, i + 1);
  }
  return null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** `YYYY-MM-DD` (a real calendar date) as the start of that day in India, or null. */
export function parseIsoDateIst(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(`${value.trim()}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return null;
  const back = new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return back === value.trim() ? d : null;
}

/** "October 2026" as the first day of that month (the oldest reading, so a stale figure is never excused by vague wording). */
export function parseMonthYear(value: string): Date | null {
  const m = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(value);
  if (!m) return null;
  const month = MONTHS.indexOf((m[1] as string).toLowerCase());
  if (month === -1) return null;
  return parseIsoDateIst(`${m[2]}-${String(month + 1).padStart(2, '0')}-01`);
}

export interface FiguresCheck {
  /** Figures that cannot be dated or are dated in the future: always an error. */
  problems: string[];
  /** Figures older than FIGURES_MAX_AGE_DAYS: a warning, or an error in the strict build. */
  stale: string[];
}

/**
 * Dates of the owner-stated figures in src/content/site.ts (read as text, like scripts/privacy-scan.ts does). `channel` must carry an
 * `asOfDate` (ISO date; the wording `asOf` such as "October 2026" is the fallback); `audience` is checked once the owner has supplied it.
 */
export function evaluateSiteFigures(siteSource: string, now: Date): FiguresCheck {
  const result: FiguresCheck = { problems: [], stale: [] };
  const clean = stripComments(siteSource);
  const blocks: Array<{ name: 'channel' | 'audience'; label: string; required: boolean }> = [
    { name: 'channel', label: 'channel figures (subscribers and videos)', required: true },
    { name: 'audience', label: 'audience figures', required: false },
  ];
  for (const { name, label, required } of blocks) {
    const block = blockOf(clean, name);
    if (block === null) {
      if (required) result.problems.push(`src/content/site.ts has no "${name}" block, so the age of the ${label} cannot be checked.`);
      continue;
    }
    const iso = /\basOfDate\s*:\s*(?:null|'([^']*)'|"([^"]*)")/.exec(block);
    const isoValue = (iso?.[1] ?? iso?.[2] ?? '').trim();
    const wording = /\basOf\s*:\s*(?:null|'([^']*)'|"([^"]*)")/.exec(block);
    const wordingValue = (wording?.[1] ?? wording?.[2] ?? '').trim();
    if (!required && isoValue === '' && wordingValue === '') continue; // the owner has not supplied the audience figures yet: nothing is shown
    let asOf: Date | null = null;
    if (isoValue !== '') {
      asOf = parseIsoDateIst(isoValue);
      if (!asOf) {
        result.problems.push(`${name}.asOfDate in src/content/site.ts ("${isoValue.slice(0, 20)}") is not a real date in the form YYYY-MM-DD.`);
        continue;
      }
    } else if (wordingValue !== '') {
      asOf = parseMonthYear(wordingValue);
      if (!asOf) {
        result.problems.push(`${name}.asOf in src/content/site.ts ("${wordingValue.slice(0, 30)}") cannot be read as a month and year and there is no ${name}.asOfDate (YYYY-MM-DD). Add the date so the age of the ${label} can be checked.`);
        continue;
      }
    } else {
      result.problems.push(`${name}.asOfDate is missing in src/content/site.ts: the age of the ${label} cannot be checked. Add the date (YYYY-MM-DD) the owner gave them.`);
      continue;
    }
    const days = Math.floor((now.getTime() - asOf.getTime()) / 86_400_000);
    const shown = isoValue !== '' ? isoValue : wordingValue;
    if (days < -1) result.problems.push(`${name}.asOfDate (${shown}) is in the future. Fix the date in src/content/site.ts.`);
    else if (days > FIGURES_MAX_AGE_DAYS) {
      result.stale.push(
        `The owner-stated ${label} are dated ${shown}, which is ${days} days ago (limit ${FIGURES_MAX_AGE_DAYS}). Ask the owner for current numbers (OT-12), then update ${name}.asOf and ${name}.asOfDate in src/content/site.ts.`,
      );
    }
  }
  return result;
}

export function formatReleaseResult(result: ReleaseResult, strict: boolean, what: string): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  lines.push(`check-release (${strict ? 'strict' : 'non-strict'}): ${what}`);
  if (result.errors.length === 0) lines.push('  OK: nothing blocks a release.');
  else {
    lines.push(strict ? `  FAIL: ${result.errors.length} problem(s):` : `  ${result.errors.length} problem(s) that would fail the strict release build (informational now):`);
    for (const e of result.errors) lines.push(`    - ${e}`);
  }
  for (const w of result.warnings) lines.push(`  warning: ${w}`);
  return { lines, exitCode: strict && result.errors.length > 0 ? 1 : 0 };
}

export function main(args: readonly string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env, now: Date = new Date()): number {
  const strict = isStrict(args, env);
  const envOnly = args.includes('--env-only');
  const result = evaluateEnv(env);
  let what = 'build variables';

  // Dated owner-stated figures (C-17): stale = warning, or an error in the strict build.
  const sitePath = resolve(argValue(args, '--site-config') ?? 'src/content/site.ts');
  if (existsSync(sitePath)) {
    const figures = evaluateSiteFigures(readFileSync(sitePath, 'utf8'), now);
    result.errors.push(...figures.problems);
    if (strict) result.errors.push(...figures.stale);
    else result.warnings.push(...figures.stale.map((s) => `WARNING (the strict release build fails on this): ${s}`));
  } else {
    result.warnings.push(`${argValue(args, '--site-config') ?? 'src/content/site.ts'} not found: the dated owner-stated figures were not checked.`);
  }

  if (!envOnly) {
    const label = argValue(args, '--dist') ?? STATIC_DIR;
    const root = resolve(label);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      console.error(`check-release: folder not found: ${root}. Run the build first (npm run build), or pass --env-only.`);
      return 2;
    }
    const dist = evaluateDist(root, env, resolve(argValue(args, '--config') ?? (argValue(args, '--dist') ? join(dirname(root), 'config.json') : CONFIG_PATH)));
    result.errors.push(...dist.errors);
    result.warnings.push(...dist.warnings);
    what = `build variables and ${label}`;
  }
  const { lines, exitCode } = formatReleaseResult(result, strict, what);
  for (const line of lines) console.log(line);
  // The number every WhatsApp button will open, so the owner can confirm it in the build log (B-12). It is public by design.
  const wa = normaliseWhatsAppNumber(env.PUBLIC_WHATSAPP_NUMBER);
  if (wa) console.log(`  note: every WhatsApp button will open https://wa.me/${wa} (check that this is the right number).`);
  return exitCode;
}

if (isMain(import.meta.url)) process.exit(main());
