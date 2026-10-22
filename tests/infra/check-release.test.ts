import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateDist,
  evaluateEnv,
  evaluateSiteFigures,
  formatReleaseResult,
  main as releaseMain,
  parseIsoDateIst,
  parseMonthYear,
  stripComments,
  FIGURES_MAX_AGE_DAYS,
  FILE_BUDGET_FAIL,
  FILE_BUDGET_WARN,
  TURNSTILE_TEST_SITE_KEY,
} from '../../scripts/check-release.ts';
import { normaliseWhatsAppNumber } from '../../src/lib/whatsapp.ts';
import { cleanupTemp, fakeJwt, fakeSupabaseSecret, makeDist, page, runScript } from './helpers';
import { join } from 'node:path';
import { HEADER_VALUE_SOFT_MAX, ROUTE_SRC, VERCEL_MAX_ROUTES, applyManagedRoutes, managedBlock } from '../../src/lib/infra/vercel-routes.ts';
import type { VercelRoute } from '../../src/lib/infra/vercel-routes.ts';

afterEach(cleanupTemp);
// Some tests start Node child processes (the way npm runs the scripts): allow for a busy PC.
vi.setConfig({ testTimeout: 30_000 });

/** A complete, valid production environment. Fake values only. */
const good = (): Record<string, string> => ({
  PUBLIC_SITE_URL: 'https://fixture.example',
  PUBLIC_ALLOW_INDEXING: 'false',
  PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(20),
  PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAfixturekeyfixture',
  PUBLIC_WHATSAPP_NUMBER: '919876500001',
  PUBLIC_CF_ANALYTICS_TOKEN: 'a'.repeat(32),
});

const errorsOf = (env: Record<string, string | undefined>): string[] => evaluateEnv(env).errors;

describe('release check: build variables', () => {
  it('accepts a complete production environment', () => {
    const r = evaluateEnv(good());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it.each(['PUBLIC_SITE_URL', 'PUBLIC_ALLOW_INDEXING', 'PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PUBLIC_TURNSTILE_SITE_KEY', 'PUBLIC_WHATSAPP_NUMBER'])(
    'fails when %s is missing',
    (name) => {
      const env: Record<string, string | undefined> = good();
      delete env[name];
      expect(errorsOf(env).join(' ')).toContain(name);
      expect(errorsOf({ ...env, [name]: '   ' }).join(' ')).toContain(name); // blank counts as missing
    },
  );

  it('refuses a localhost or non-https site URL, or one with a path', () => {
    expect(errorsOf({ ...good(), PUBLIC_SITE_URL: 'http://localhost:4321' }).join(' ')).toMatch(/local address/);
    expect(errorsOf({ ...good(), PUBLIC_SITE_URL: 'http://127.0.0.1:4321' }).join(' ')).toMatch(/local address/);
    expect(errorsOf({ ...good(), PUBLIC_SITE_URL: 'http://fixture.example' }).join(' ')).toMatch(/https/);
    expect(errorsOf({ ...good(), PUBLIC_SITE_URL: 'https://fixture.example/shop' }).join(' ')).toMatch(/origin only/);
    expect(errorsOf({ ...good(), PUBLIC_SITE_URL: 'not a url' }).join(' ')).toMatch(/not a valid/);
  });

  it('the indexing flag must be explicit: exactly true or false', () => {
    expect(errorsOf({ ...good(), PUBLIC_ALLOW_INDEXING: 'TRUE' }).join(' ')).toMatch(/exactly "true" or "false"/);
    expect(errorsOf({ ...good(), PUBLIC_ALLOW_INDEXING: '1' }).join(' ')).toMatch(/exactly "true" or "false"/);
    expect(errorsOf({ ...good(), PUBLIC_ALLOW_INDEXING: 'true' })).toEqual([]);
  });

  it('indexing allowed: a vercel.app canonical address is refused', () => {
    const env = { ...good(), PUBLIC_ALLOW_INDEXING: 'true', PUBLIC_SITE_URL: 'https://power-smash-abc.vercel.app' };
    expect(errorsOf(env).join(' ')).toMatch(/vercel\.app/);
    // Indexing off: a vercel.app preview is exactly what is expected.
    expect(errorsOf({ ...env, PUBLIC_ALLOW_INDEXING: 'false' })).toEqual([]);
  });

  it('indexing allowed: Cloudflare Turnstile test keys are refused, in a preview they only warn', () => {
    for (const key of ['1x00000000000000000000AA', '2x00000000000000000000AB', '1x00000000000000000000BB', '2x00000000000000000000BB', '3x00000000000000000000FF']) {
      expect(TURNSTILE_TEST_SITE_KEY.test(key)).toBe(true);
      expect(errorsOf({ ...good(), PUBLIC_ALLOW_INDEXING: 'true', PUBLIC_TURNSTILE_SITE_KEY: key }).join(' ')).toMatch(/TEST keys/);
    }
    const preview = evaluateEnv({ ...good(), PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' });
    expect(preview.errors).toEqual([]);
    expect(preview.warnings.join(' ')).toMatch(/test key/);
    expect(TURNSTILE_TEST_SITE_KEY.test('0x4AAAAAAAfixturekeyfixture')).toBe(false);
  });

  it('checks the Supabase and WhatsApp values', () => {
    expect(errorsOf({ ...good(), PUBLIC_SUPABASE_PUBLISHABLE_KEY: fakeSupabaseSecret() }).join(' ')).toMatch(/sb_publishable_/);
    expect(errorsOf({ ...good(), PUBLIC_SUPABASE_URL: 'http://localhost:54321' }).join(' ')).toMatch(/PUBLIC_SUPABASE_URL/);
    expect(errorsOf({ ...good(), PUBLIC_WHATSAPP_NUMBER: 'call me' }).join(' ')).toMatch(/digits with the country code/);
  });

  it('refuses a WhatsApp number that would give a dead wa.me link: 10 digits without 91, a leading 0 or 00 (B-12)', () => {
    for (const number of ['9876543210', '09876543210', '0 98765 43210']) {
      expect(normaliseWhatsAppNumber(number), number).toBeNull();
      expect(errorsOf({ ...good(), PUBLIC_WHATSAPP_NUMBER: number }).length, number).toBeGreaterThan(0);
    }
    const noCountryCode = errorsOf({ ...good(), PUBLIC_WHATSAPP_NUMBER: '9876543210' }).join(' ');
    expect(noCountryCode).toMatch(/PUBLIC_WHATSAPP_NUMBER/);
    expect(noCountryCode).toMatch(/without the country code/);
    expect(errorsOf({ ...good(), PUBLIC_WHATSAPP_NUMBER: '09876543210' }).join(' ')).toMatch(/starts with 0/);
    expect(errorsOf({ ...good(), PUBLIC_WHATSAPP_NUMBER: '12345' }).join(' ')).toMatch(/8 to 15 digits/);
  });

  it('accepts what normaliseWhatsAppNumber accepts: 91 plus ten digits, a +, spaces, brackets, a 00 prefix', () => {
    for (const number of ['919876543210', '+91 98765 43210', '+91 (98765) 43210', '00919876543210', '91-9876543210', '447911123456']) {
      expect(normaliseWhatsAppNumber(number), number).not.toBeNull();
      expect(errorsOf({ ...good(), PUBLIC_WHATSAPP_NUMBER: number }), number).toEqual([]);
    }
  });

  it('no secret may travel in a PUBLIC_ variable: by name or by value', () => {
    expect(errorsOf({ ...good(), PUBLIC_SUPABASE_SECRET_KEY: 'x' }).join(' ')).toMatch(/PUBLIC_SUPABASE_SECRET_KEY: the name looks like a secret/);
    expect(errorsOf({ ...good(), PUBLIC_API_TOKEN: 'x' }).join(' ')).toMatch(/PUBLIC_API_TOKEN/);
    expect(errorsOf({ ...good(), PUBLIC_NOTE: fakeJwt() }).join(' ')).toMatch(/PUBLIC_NOTE: the value looks like a secret/);
    expect(errorsOf({ ...good(), PUBLIC_NOTE: fakeSupabaseSecret() }).join(' ')).toMatch(/supabase-secret-key/);
  });

  it('the three documented public variables with a secret-sounding name are allowed', () => {
    // PUBLIC_CF_ANALYTICS_TOKEN, PUBLIC_SUPABASE_PUBLISHABLE_KEY and PUBLIC_TURNSTILE_SITE_KEY are in good(); none is reported.
    expect(errorsOf(good()).filter((e) => /name looks like a secret/.test(e))).toEqual([]);
  });

  it('analytics token: a missing one is only a warning, a malformed one is an error; HSTS is validated', () => {
    const { PUBLIC_CF_ANALYTICS_TOKEN: _drop, ...rest } = good();
    const r = evaluateEnv(rest);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/PUBLIC_CF_ANALYTICS_TOKEN/);
    expect(errorsOf({ ...good(), PUBLIC_CF_ANALYTICS_TOKEN: 'bad token"' }).join(' ')).toMatch(/16 to 64/);
    expect(errorsOf({ ...good(), PUBLIC_HSTS_MAX_AGE: '31536000' })).toEqual([]);
    expect(errorsOf({ ...good(), PUBLIC_HSTS_MAX_AGE: '99999999999' }).join(' ')).toMatch(/PUBLIC_HSTS_MAX_AGE/);
    expect(errorsOf({ ...good(), PUBLIC_HSTS_MAX_AGE: 'forever' }).join(' ')).toMatch(/PUBLIC_HSTS_MAX_AGE/);
  });
});

describe('release check: built output', () => {
  const CSP_ROUTE = { src: ROUTE_SRC.pages, headers: { 'Content-Security-Policy': "default-src 'self'" }, continue: true };
  const NOINDEX_ROUTE = { src: ROUTE_SRC.everywhere, headers: { 'X-Robots-Tag': 'noindex, nofollow' }, continue: true };
  const configOf = (routes: VercelRoute[]): string => JSON.stringify({ version: 3, routes: applyManagedRoutes({ routes: [] }, managedBlock(routes, [])).routes });
  const configOk = configOf([CSP_ROUTE, NOINDEX_ROUTE]);
  const env = good();
  /** A Build Output folder: `static/<files>` plus `config.json`. Returns the static folder (what the checks scan). */
  const out = (files: Record<string, string>, config: string | null = configOk): string => {
    const all: Record<string, string> = {};
    for (const [k, v] of Object.entries(files)) all[`static/${k}`] = v;
    if (config !== null) all['config.json'] = config;
    return join(makeDist(all), 'static');
  };
  const home = page('', '<link rel="canonical" href="https://fixture.example/">');

  it('accepts a consistent noindex preview', () => {
    const root = out({ 'index.html': page('<p>x</p>', '<link rel="canonical" href="https://fixture.example/">'), 'robots.txt': 'User-agent: *\nDisallow: /\n' });
    expect(evaluateDist(root, env).errors).toEqual([]);
  });

  it('fails a canonical link on another origin (localhost, vercel.app)', () => {
    const root = out({
      'index.html': page('', '<link rel="canonical" href="http://localhost:4321/">'),
      'a/index.html': page('', '<link rel="canonical" href="https://x-abc.vercel.app/a/">'),
    });
    expect(evaluateDist(root, env).errors.join(' ')).toMatch(/2 page\(s\) have a canonical link/);
  });

  it('indexing off: every page must say noindex, and robots.txt must disallow everything', () => {
    const root = out({
      'index.html': '<!doctype html><html><head><link rel="canonical" href="https://fixture.example/"></head><body></body></html>',
      'robots.txt': 'User-agent: *\nAllow: /\n',
    });
    const errors = evaluateDist(root, env).errors.join(' ');
    expect(errors).toMatch(/lack <meta name="robots" content="noindex">/);
    expect(errors).toMatch(/robots\.txt does not disallow everything/);
  });

  it('indexing on: the home page must be indexable, and robots.txt must not block everything', () => {
    const on = { ...env, PUBLIC_ALLOW_INDEXING: 'true' };
    const blocked = out({ 'index.html': home, 'robots.txt': 'User-agent: *\nDisallow: /\n' }, configOf([CSP_ROUTE]));
    const errors = evaluateDist(blocked, on).errors.join(' ');
    expect(errors).toMatch(/home page still says noindex/);
    expect(errors).toMatch(/robots\.txt disallows everything/);
    const open = out(
      {
        'index.html': '<!doctype html><html><head><link rel="canonical" href="https://fixture.example/"></head><body></body></html>',
        'robots.txt': 'User-agent: *\nAllow: /\n',
      },
      configOf([CSP_ROUTE]),
    );
    expect(evaluateDist(open, on).errors).toEqual([]);
  });

  it('config.json must exist, carry the managed block, a CSP and a noindex rule (indexing off)', () => {
    const base = { 'index.html': home };
    expect(evaluateDist(out(base, null), env).errors.join(' ')).toMatch(/config\.json is missing/);
    expect(evaluateDist(out(base, '{not json'), env).errors.join(' ')).toMatch(/not valid JSON/);
    expect(evaluateDist(out(base, JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }] })), env).errors.join(' ')).toMatch(/no managed header block/);
    expect(evaluateDist(out(base, configOf([NOINDEX_ROUTE])), env).errors.join(' ')).toMatch(/no Content-Security-Policy/);
    expect(evaluateDist(out(base, configOf([CSP_ROUTE])), env).errors.join(' ')).toMatch(/no X-Robots-Tag: noindex/);
  });

  it('config.json inside Vercel limits: more than 2,048 routes or an oversized header value fails', () => {
    const base = { 'index.html': home };
    const many = Array.from({ length: VERCEL_MAX_ROUTES }, (_, i) => ({ src: `^/p${i}$`, headers: { 'X-A': 'b' }, continue: true }));
    expect(evaluateDist(out(base, configOf([CSP_ROUTE, NOINDEX_ROUTE, ...many])), env).errors.join(' ')).toMatch(/routes; Vercel allows 2048/);
    const long = { src: ROUTE_SRC.pages, headers: { 'Content-Security-Policy': 'a'.repeat(HEADER_VALUE_SOFT_MAX + 1) }, continue: true };
    expect(evaluateDist(out(base, configOf([long, NOINDEX_ROUTE])), env).errors.join(' ')).toMatch(/Header Content-Security-Policy is/);
  });

  it('file budget: warns above 10,000 files and fails above 14,000 (D-009 page budget, kept on Vercel)', () => {
    // The thresholds are exercised through the constants; building 14,000 files in a test would be slow.
    expect(FILE_BUDGET_WARN).toBe(10_000);
    expect(FILE_BUDGET_FAIL).toBe(14_000);
    expect(evaluateDist(out({ 'index.html': home }), env).warnings).toEqual([]);
  });

  it('archive redirects over 1,800 rules fail', () => {
    const redirects = Array.from({ length: 1801 }, (_, i) => ({ src: `^/a${i}/?$`, status: 301, headers: { Location: `/b${i}/` } }));
    const config = JSON.stringify({ version: 3, routes: applyManagedRoutes({ routes: [] }, managedBlock([CSP_ROUTE, NOINDEX_ROUTE], redirects)).routes });
    expect(evaluateDist(out({ 'index.html': home }, config), env).errors.join(' ')).toMatch(/1801 archive redirect rules/);
  });
});

/** A minimal src/content/site.ts text with the two dated blocks. */
const siteText = (channelDate: string | null, audienceDate: string | null = null, channelWording = 'October 2026'): string =>
  [
    "export const site = {",
    "  name: 'Power Smash', // the owner's brand: an apostrophe in a comment must not confuse the reader",
    '  channel: {',
    "    subscribers: '88K', /* block comment with } and { inside */",
    `    asOf: '${channelWording}',`,
    channelDate === null ? '    asOfDate: null,' : `    asOfDate: '${channelDate}',`,
    '  },',
    '  audience: {',
    audienceDate === null ? '    asOf: null as string | null,' : "    asOf: 'last month',",
    audienceDate === null ? '    asOfDate: null as string | null,' : `    asOfDate: '${audienceDate}',`,
    '    topLocations: [] as readonly string[],',
    '  },',
    '};',
  ].join('\n');

const IST_NOON = (iso: string): Date => new Date(`${iso}T12:00:00+05:30`);
const isoDaysBefore = (now: Date, days: number): string => new Date(now.getTime() - days * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);

describe('release check: dated owner-stated figures (C-17)', () => {
  const now = IST_NOON('2026-10-21');

  it('figures dated today, yesterday and exactly 90 days ago pass', () => {
    for (const days of [0, 1, 30, FIGURES_MAX_AGE_DAYS]) {
      const r = evaluateSiteFigures(siteText(isoDaysBefore(now, days)), now);
      expect(r, `${days} days`).toEqual({ problems: [], stale: [] });
    }
  });

  it('figures older than 90 days are stale, and the message says how old, where to fix it, and shows no figure', () => {
    const r = evaluateSiteFigures(siteText(isoDaysBefore(now, FIGURES_MAX_AGE_DAYS + 1)), now);
    expect(r.problems).toEqual([]);
    expect(r.stale).toHaveLength(1);
    expect(r.stale[0]).toMatch(/channel figures.*91 days ago \(limit 90\)/);
    expect(r.stale[0]).toContain('channel.asOfDate in src/content/site.ts');
    expect(r.stale[0]).not.toContain('88K');
  });

  it('the real source line of the current site config is understood (a date, not null, no problems)', () => {
    const real = evaluateSiteFigures(siteText('2026-10-20'), IST_NOON('2026-10-21'));
    expect(real).toEqual({ problems: [], stale: [] });
  });

  it('a missing or unreadable asOfDate: the month-year wording is the fallback (the first of the month), otherwise a problem', () => {
    expect(evaluateSiteFigures(siteText(null, null, 'October 2026'), IST_NOON('2026-12-20')).stale).toEqual([]);
    expect(evaluateSiteFigures(siteText(null, null, 'October 2026'), IST_NOON('2027-01-30')).stale).toHaveLength(1);
    expect(evaluateSiteFigures(siteText(null, null, 'recently'), now).problems.join(' ')).toMatch(/cannot be read as a month and year/);
    expect(evaluateSiteFigures(siteText('2026-13-45'), now).problems.join(' ')).toMatch(/not a real date/);
    expect(evaluateSiteFigures(siteText('21/10/2026'), now).problems.join(' ')).toMatch(/not a real date/);
  });

  it('a date in the future is a problem, not a pass', () => {
    expect(evaluateSiteFigures(siteText('2027-05-01'), now).problems.join(' ')).toMatch(/in the future/);
  });

  it('the audience block is checked once it is dated, and ignored while the owner has not supplied it', () => {
    const fresh = isoDaysBefore(now, 5);
    expect(evaluateSiteFigures(siteText(fresh, null), now)).toEqual({ problems: [], stale: [] });
    expect(evaluateSiteFigures(siteText(fresh, fresh), now)).toEqual({ problems: [], stale: [] });
    const old = evaluateSiteFigures(siteText(fresh, '2026-01-01'), now);
    expect(old.stale).toHaveLength(1);
    expect(old.stale[0]).toContain('audience figures');
  });

  it('a site config without a channel block is a problem', () => {
    expect(evaluateSiteFigures('export const site = { name: "x" };', now).problems.join(' ')).toMatch(/no "channel" block/);
  });

  it('the date parsers and the comment stripper', () => {
    expect(parseIsoDateIst('2026-02-29')).toBeNull();
    expect(parseIsoDateIst('2028-02-29')).not.toBeNull();
    expect(parseMonthYear('march 2027')?.toISOString()).toBe(new Date('2027-03-01T00:00:00+05:30').toISOString());
    expect(parseMonthYear('Smarch 2027')).toBeNull();
    expect(stripComments("a // it's\nb /* } */ c 'http://x//y'")).toBe("a        \nb         c 'http://x//y'");
  });

  it('strict main() fails on stale figures, the normal build only warns (the clock is injected)', () => {
    const dir = makeDist({ 'site.ts': siteText('2026-01-01') });
    const file = join(dir, 'site.ts');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s: unknown) => void logs.push(String(s)));
    try {
      expect(releaseMain(['--env-only', '--strict', '--site-config', file], good(), now)).toBe(1);
      expect(logs.join('\n')).toMatch(/FAIL.*\n.*channel figures/);
      logs.length = 0;
      expect(releaseMain(['--env-only', '--site-config', file], good(), now)).toBe(0);
      expect(logs.join('\n')).toMatch(/warning: WARNING.*channel figures/);
      logs.length = 0;
      const fresh = join(makeDist({ 'site.ts': siteText(isoDaysBefore(now, 3)) }), 'site.ts');
      expect(releaseMain(['--env-only', '--strict', '--site-config', fresh], good(), now)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('release check: output and command line', () => {
  it('strict fails on any error; normal mode lists them as informational and passes', () => {
    const r = { errors: ['PUBLIC_SITE_URL is not set.'], warnings: ['w'] };
    expect(formatReleaseResult(r, true, 'x').exitCode).toBe(1);
    const normal = formatReleaseResult(r, false, 'x');
    expect(normal.exitCode).toBe(0);
    expect(normal.lines.join('\n')).toContain('would fail the strict release build');
    expect(formatReleaseResult({ errors: [], warnings: [] }, true, 'x').exitCode).toBe(0);
  });

  it('the command line: strict --env-only fails on an empty environment and passes on a good one; the output never shows values', () => {
    const script = 'scripts/check-release.ts';
    const bad = runScript(script, ['--env-only', '--strict'], {});
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('PUBLIC_SITE_URL is not set');
    expect(runScript(script, ['--env-only'], {}).status).toBe(0); // normal mode never fails
    const env = good();
    // A fresh, dated site config built from the REAL clock: the tests must not start failing when the real figures age.
    const site = join(makeDist({ 'site.ts': siteText(isoDaysBefore(new Date(), 2)) }), 'site.ts');
    expect(runScript(script, ['--env-only', '--strict', '--site-config', site], env).status).toBe(0);
    const out = runScript(script, ['--env-only', '--strict', '--site-config', site], { ...env, PUBLIC_SUPABASE_PUBLISHABLE_KEY: fakeSupabaseSecret() });
    expect(out.status).toBe(1);
    expect(out.stdout).not.toContain(fakeSupabaseSecret());
  });

  it('the log shows which WhatsApp number the buttons will open (B-12), and nothing when the number is unusable', () => {
    const site = join(makeDist({ 'site.ts': siteText(isoDaysBefore(new Date(), 2)) }), 'site.ts');
    const ok = runScript('scripts/check-release.ts', ['--env-only', '--site-config', site], { ...good(), PUBLIC_WHATSAPP_NUMBER: '+91 98765 00001' });
    expect(ok.stdout).toContain('https://wa.me/919876500001');
    const bad = runScript('scripts/check-release.ts', ['--env-only', '--site-config', site], { ...good(), PUBLIC_WHATSAPP_NUMBER: '9876500001' });
    expect(bad.stdout).not.toContain('wa.me/');
    expect(bad.stdout).toContain('without the country code');
  });

  it('the command line fails strict on a stale site config and passes the same build when the figures are fresh', () => {
    const script = 'scripts/check-release.ts';
    const stale = join(makeDist({ 'site.ts': siteText(isoDaysBefore(new Date(), 200)) }), 'site.ts');
    const r = runScript(script, ['--env-only', '--strict', '--site-config', stale], good());
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('channel figures');
    expect(runScript(script, ['--env-only', '--site-config', stale], good()).status).toBe(0);
  });

  it('a build with PS_STRICT=1 in the environment is strict', () => {
    expect(runScript('scripts/check-release.ts', ['--env-only'], { PS_STRICT: '1' }).status).toBe(1);
  });
});
