// Review finding S-12: .gitleaks.toml carries rules for the secrets the default ruleset misses, and its allowlists stay exact.
// gitleaks is not installed on the owner's PC, so this test reads the file as text (no TOML parser is a project dependency), turns each
// regex into a JavaScript RegExp and checks it with samples BUILT AT RUN TIME (no secret-looking literal is committed).
// The regexes must also be valid for Go's RE2 engine, which gitleaks uses: no lookaround and no back-references.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';
import { RULES } from '../../scripts/lib/privacy-rules.ts';

// a real git process is started in the .gitignore test: allow for a busy Windows PC
vi.setConfig({ testTimeout: 60_000 });

const toml = readFileSync(join(ROOT, '.gitleaks.toml'), 'utf8').replace(/\r\n/g, '\n');
const withoutComments = toml
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

interface Allow {
  description: string;
  regexTarget: string | null;
  regexes: string[];
  paths: string[];
  targetRules: string[];
}
interface ParsedRule {
  id: string;
  description: string;
  regex: string;
  keywords: string[];
  allowlists: Allow[];
}

const literal = (block: string, key: string): string | null => {
  const m = new RegExp(`^${key}\\s*=\\s*'''([\\s\\S]*?)'''`, 'm').exec(block) ?? new RegExp(`^${key}\\s*=\\s*"([^"\\n]*)"`, 'm').exec(block);
  return m ? (m[1] as string) : null;
};
const list = (block: string, key: string): string[] => {
  const m = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*$`, 'm').exec(block);
  if (!m) return [];
  const body = m[1] as string;
  const items: string[] = [];
  const re = /'''([\s\S]*?)'''|'([^'\n]*)'|"([^"\n]*)"/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(body)) !== null) items.push((x[1] ?? x[2] ?? x[3]) as string);
  return items;
};

function parseAllowlist(block: string): Allow {
  return {
    description: literal(block, 'description') ?? '',
    regexTarget: literal(block, 'regexTarget'),
    regexes: list(block, 'regexes'),
    paths: list(block, 'paths'),
    targetRules: list(block, 'targetRules'),
  };
}

// split the file at table headers
const tables: Array<{ header: string; body: string }> = [];
{
  const re = /^\[\[?([A-Za-z_.]+)\]\]?\s*$/gm;
  const marks: Array<{ header: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) marks.push({ header: m[1] as string, start: m.index, bodyStart: m.index + m[0].length });
  marks.forEach((mark, i) => tables.push({ header: mark.header, body: withoutComments.slice(mark.bodyStart, marks[i + 1]?.start ?? withoutComments.length) }));
}

const rules: ParsedRule[] = [];
for (const t of tables) {
  if (t.header === 'rules') {
    rules.push({
      id: literal(t.body, 'id') ?? '',
      description: literal(t.body, 'description') ?? '',
      regex: literal(t.body, 'regex') ?? '',
      keywords: list(t.body, 'keywords'),
      allowlists: [],
    });
  } else if (t.header === 'rules.allowlists') {
    rules[rules.length - 1]?.allowlists.push(parseAllowlist(t.body));
  }
}
const globalAllowlists = tables.filter((t) => t.header === 'allowlists').map((t) => parseAllowlist(t.body));

/** A Go (RE2) pattern as a JavaScript RegExp. `(?i)` at the start becomes the i flag. */
function js(pattern: string): RegExp {
  expect(pattern, `RE2 has no lookaround or back-reference: ${pattern}`).not.toMatch(/\(\?[=!<]|\\[1-9]/);
  return pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern);
}
const ruleById = (id: string): ParsedRule => {
  const r = rules.find((x) => x.id === id);
  if (!r) throw new Error(`rule not found: ${id}`);
  return r;
};
/** True when the rule would report this text: the regex matches and no allowlist of the rule excuses the match. */
function flags(id: string, text: string): boolean {
  const rule = ruleById(id);
  const m = js(rule.regex).exec(text);
  if (!m) return false;
  return !rule.allowlists.some((a) => a.regexes.some((r) => js(r).test(m[0])));
}

const rep = (c: string, n: number): string => c.repeat(n);
const dbUrl = (password: string): string => ['postgresql', '://', 'postgres.abcdefgh', ':', password, '@', 'aws-0-ap-south-1.pooler.supabase.com', ':5432/postgres'].join('');

describe('.gitleaks.toml: structure', () => {
  it('extends the default ruleset and has the five custom rules', () => {
    expect(withoutComments).toMatch(/\[extend\]\s*\nuseDefault = true/);
    expect(rules.map((r) => r.id)).toEqual(['supabase-secret-key', 'database-url-with-password', 'telegram-bot-token-bare', 'turnstile-secret-key', 'resend-api-key']);
  });

  it('every rule has a description and a regex that RE2 and JavaScript both accept', () => {
    for (const r of rules) {
      expect(r.description.length, r.id).toBeGreaterThan(20);
      expect(() => js(r.regex), r.id).not.toThrow();
    }
  });

  it('the triple-quoted strings are balanced (a TOML syntax slip would break the whole CI job)', () => {
    expect((toml.match(/'''/g) ?? []).length % 2).toBe(0);
    expect(toml.match(/^\[\[rules\]\]$/gm)).toHaveLength(rules.length);
  });

  it('policy: no allowlist looks at the whole line, and no allowlist covers a whole directory against every rule', () => {
    expect(withoutComments).not.toMatch(/regexTarget\s*=\s*"line"/);
    for (const a of [...globalAllowlists, ...rules.flatMap((r) => r.allowlists)]) {
      for (const p of a.paths) {
        expect(a.targetRules.length, `path allowlist ${p} must name its rules`).toBeGreaterThan(0);
        expect(p).toMatch(/^\^.*\$$/); // anchored at both ends: an exact path pattern
      }
      for (const r of a.regexes) expect(r, 'allowlist regexes are anchored at the start').toMatch(/^(\(\?i\))?\^/);
    }
  });
});

describe('.gitleaks.toml: the existing allowlists stay exact', () => {
  it('the Supabase placeholder allowlist excuses only the prefix followed by x, dot, star, dash or underscore', () => {
    const r = ruleById('supabase-secret-key');
    expect(r.allowlists).toHaveLength(1);
    expect(r.allowlists[0]?.regexes).toEqual(['(?i)^sb_secret_[x*._\\-]+$']);
    const placeholder = `sb_secret_${rep('x', 20)}`;
    const real = `sb_secret_${rep('x', 4)}${rep('Q', 20)}`;
    expect(flags('supabase-secret-key', placeholder)).toBe(false);
    expect(flags('supabase-secret-key', `sb_secret_${rep('*', 12)}`)).toBe(false);
    expect(flags('supabase-secret-key', real)).toBe(true);
    expect(flags('supabase-secret-key', `${placeholder}Q`)).toBe(true); // one real character is enough to report it
  });

  it('the public-values allowlist is exactly three anchored values', () => {
    expect(globalAllowlists).toHaveLength(2);
    const pub = globalAllowlists[0] as Allow;
    expect(pub.regexTarget).toBe('secret');
    expect(pub.regexes).toEqual(['^(?:\\+?91[ -]?)?73733[ -]?51087$', '^UCRhIwO47uhJIM5Iw4uybcFQ$', '^powersmash1102@gmail\\.com$']);
    const matches = (v: string): boolean => pub.regexes.some((r) => js(r).test(v));
    expect(matches('+91 73733 51087')).toBe(true);
    expect(matches('73733 51087')).toBe(true);
    expect(matches('73733 51088')).toBe(false);
    expect(matches('xpowersmash1102@gmail.com')).toBe(false);
    expect(matches('powersmash1102@gmail.com.evil')).toBe(false);
  });

  it('the parser-fixture allowlist suppresses only generic-api-key and only two exact files', () => {
    const fx = globalAllowlists[1] as Allow;
    expect(fx.targetRules).toEqual(['generic-api-key']);
    expect(fx.paths).toEqual(['^tests/fixtures/real-titles\\.[a-z]+\\.json$', '^tests/fixtures/titles\\.proposed\\.json$']);
    const inPaths = (p: string): boolean => fx.paths.some((r) => js(r).test(p));
    expect(inPaths('tests/fixtures/real-titles.proposed.json')).toBe(true);
    expect(inPaths('tests/fixtures/titles.proposed.json')).toBe(true);
    expect(inPaths('tests/fixtures/other.json')).toBe(false);
    expect(inPaths('tests/infra/real-titles.x.json')).toBe(false);
    expect(inPaths('x/tests/fixtures/real-titles.a.json')).toBe(false);
  });
});

describe('.gitleaks.toml: the new rules', () => {
  it('database-url-with-password: a URL with a password is reported, in several spellings', () => {
    for (const pw of ['Pa55w0rd', 'p%40ss%2Fw%3Ard', 'x7Kq9ZtLm2']) {
      expect(flags('database-url-with-password', dbUrl(pw)), pw).toBe(true);
      expect(flags('database-url-with-password', `SUPABASE_DB_URL="${dbUrl(pw)}"`), pw).toBe(true);
      expect(flags('database-url-with-password', dbUrl(pw).replace('postgresql', 'postgres')), pw).toBe(true);
    }
  });

  it('database-url-with-password: no password, no report; documentation placeholders are allowed, a real-looking password is not', () => {
    expect(flags('database-url-with-password', ['postgresql', '://', 'postgres@localhost:5432/postgres'].join(''))).toBe(false);
    expect(flags('database-url-with-password', ['postgresql', '://', 'localhost:5432/postgres'].join(''))).toBe(false);
    for (const pw of ['[YOUR-PASSWORD]', '<password>', '${DB_PASSWORD}', '$DB_PASSWORD', 'password', 'YOUR_PASSWORD', '********', 'xxxxxxxx']) {
      expect(flags('database-url-with-password', dbUrl(pw)), pw).toBe(false);
    }
    expect(flags('database-url-with-password', dbUrl('passwordX9'))).toBe(true);
    expect(flags('database-url-with-password', dbUrl('xxxxxxxxQ'))).toBe(true);
  });

  it('telegram-bot-token-bare: a bare token is reported, a short or malformed one is not', () => {
    expect(flags('telegram-bot-token-bare', `${rep('1', 9)}:${rep('A', 35)}`)).toBe(true);
    expect(flags('telegram-bot-token-bare', `see ${rep('7', 10)}:AAH${rep('b', 16)}_${rep('9', 15)} here`)).toBe(true);
    expect(flags('telegram-bot-token-bare', `${rep('1', 9)}:${rep('A', 20)}`)).toBe(false);
    expect(flags('telegram-bot-token-bare', `${rep('1', 3)}:${rep('A', 35)}`)).toBe(false);
  });

  it('turnstile-secret-key: a 0x4 secret is reported; the public site key and the published test secrets are not', () => {
    expect(flags('turnstile-secret-key', `0x4${rep('A', 8)}${rep('b9', 12)}`)).toBe(true);
    expect(flags('turnstile-secret-key', `TURNSTILE_SECRET_KEY=0x4${rep('Z', 32)}`)).toBe(true);
    expect(flags('turnstile-secret-key', '0x4AAAAAAAfixturekeyfixture')).toBe(false); // a site key is shorter
    for (const test of [`1x${rep('0', 31)}AA`, `2x${rep('0', 31)}AA`, `3x${rep('0', 31)}AA`, `1x${rep('0', 20)}AA`]) expect(flags('turnstile-secret-key', test), test).toBe(false);
  });

  it('resend-api-key: a mixed-case key is reported, a snake_case identifier is not', () => {
    expect(flags('resend-api-key', `re_${rep('Ab3', 4)}_${rep('Zq9', 9)}`)).toBe(true);
    expect(flags('resend-api-key', `RESEND_API_KEY=re_${rep('aB1', 12)}`)).toBe(true);
    expect(flags('resend-api-key', 're_render_the_whole_page_again_now')).toBe(false);
    expect(flags('resend-api-key', 'RE_RENDER_THE_WHOLE_PAGE_AGAIN_NOW')).toBe(false);
    expect(flags('resend-api-key', 're_short')).toBe(false);
    expect(flags('resend-api-key', 'pre_render_the_whole_page_again_now_x9')).toBe(false); // \b: not inside a longer word
  });

  it('the repository scan and the dist/ scan agree: every new gitleaks shape is also a critical rule in the privacy scan', () => {
    const critical = new Set(RULES.filter((r) => r.severity === 'critical').map((r) => r.id));
    for (const id of ['database-url-with-password', 'turnstile-secret-key', 'resend-api-key', 'telegram-bot-token']) expect(critical.has(id), id).toBe(true);
    // same shapes: the privacy-scan regex flags what the gitleaks regex flags, on the same samples
    const samples: Array<[string, string]> = [
      ['database-url-with-password', dbUrl('Pa55w0rd')],
      ['turnstile-secret-key', `0x4${rep('A', 8)}${rep('b9', 12)}`],
      ['resend-api-key', `re_${rep('Ab3', 4)}_${rep('Zq9', 9)}`],
    ];
    for (const [id, sample] of samples) {
      const privacy = RULES.find((r) => r.id === id) as (typeof RULES)[number];
      privacy.regex.lastIndex = 0;
      expect(privacy.regex.test(sample), id).toBe(true);
      expect(js(ruleById(id).regex).test(sample), id).toBe(true);
    }
  });
});

describe('.gitignore: secrets, local tooling folders and scratch tests (S-11, C-15)', () => {
  it('lists every variant of the secrets file, supabase/.temp and tests/zz_* (checked with real git)', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    if (spawnSync('git', ['--version']).status !== 0) return;
    const dir = mkdtempSync(join(tmpdir(), 'ps-ign-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      writeFileSync(join(dir, '.gitignore'), readFileSync(join(ROOT, '.gitignore')));
      // one git process for every path: `check-ignore --stdin` prints the paths that are ignored
      const mustBeIgnored = [
        '.secrets.local',
        '.secrets.local.bak',
        '.secrets.local.txt',
        '.secrets.local~',
        '.secrets.production',
        'prod.secrets',
        'sub/dir/backup.secrets',
        'supabase/.temp/project-ref',
        'supabase/.temp/pooler-url',
        '.env',
        '.env.production',
        'prod.key',
        'tests/zz_review_cor_parity.test.ts',
        'tests/zz_x/y.test.ts',
        'tests/infra/zz_scratch.test.ts',
      ];
      const mustNotBeIgnored = ['.env.example', 'docs/SECRETS.md', 'supabase/config.toml', 'supabase/migrations/0001_lead_funnel.sql', 'tests/infra/privacy-scan.test.ts', 'tests/zebra.test.ts', 'tests/lib/whatsapp.test.ts', 'scripts/load-secrets.mjs'];
      const r = spawnSync('git', ['check-ignore', '--stdin'], { cwd: dir, encoding: 'utf8', input: [...mustBeIgnored, ...mustNotBeIgnored].join('\n') });
      const ignored = new Set(r.stdout.split(/\r?\n/).filter(Boolean));
      for (const p of mustBeIgnored) expect(ignored.has(p), p).toBe(true);
      for (const p of mustNotBeIgnored) expect(ignored.has(p), p).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
