import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST, SENSITIVE_SCOPES, VERCEL_CLI_VERSION, VERCEL_SCOPE, buildPlan, failureDetail, main, redact, vercelEnvAddArgs } from '../../scripts/load-secrets.mjs';
import { parseSecretsText, printableName, secretsFileProblem } from '../../scripts/lib/secrets-file.mjs';
import { VERCEL_INSTALL_COMMAND, resolveLockedVercel } from '../../scripts/lib/vercel-cli.mjs';
import { ROOT, cleanupTemp, fakeAgePrivateKey, fakeAgePublicKey, fakeSupabaseSecret, fakeTelegramToken, tempDir } from './helpers';

afterEach(cleanupTemp);

// ---- fake values, built at run time ------------------------------------------------------------------------------------
const SECRET_KEY = fakeSupabaseSecret();
const BOT_TOKEN = fakeTelegramToken();
const HMAC = `k1:${'m'.repeat(40)}`;
const DB_URL = ['postgresql', '://', 'backup', '.', 'abcdefgh', ':', 'p4ssw0rd-value', '@', 'aws-0-ap-south-1.pooler.supabase.com', ':5432/postgres'].join('');
const VALUES = [SECRET_KEY, BOT_TOKEN, HMAC, DB_URL, 'p4ssw0rd-value'];

const goodFile = [
  '# my secrets',
  `SUPABASE_SECRET_KEY=${SECRET_KEY}`,
  `TELEGRAM_BOT_TOKEN="${BOT_TOKEN}"`,
  'TELEGRAM_CHAT_ID=123456789',
  `HMAC_KEY=${HMAC}`,
  `SUPABASE_DB_URL=${DB_URL}`,
  `AGE_PUBLIC_KEY=${fakeAgePublicKey()}`,
  'PUBLIC_ALLOW_INDEXING=false',
  'RESEND_API_KEY=',
].join('\n');

const noGit = { top: () => null, tracked: () => false, ignored: () => true };
const okGit = { top: () => '/repo', tracked: () => false, ignored: () => true };

interface Call {
  cmd: string;
  args: string[];
  input: string;
}

/** Stands in for the locked Vercel CLI from ci/vercel-cli (the real resolver is tested separately below). */
const FAKE_LOCKED_CLI = { cmd: 'node', args: ['/fake/locked/vercel/vc.js'] };

function harness(fileText: string, extra: Partial<Parameters<typeof main>[1]> = {}) {
  const out: string[] = [];
  const errs: string[] = [];
  const calls: Call[] = [];
  const deps = {
    log: (s: string) => out.push(s),
    err: (s: string) => errs.push(s),
    exists: () => true,
    read: () => fileText,
    git: noGit,
    vercelCli: FAKE_LOCKED_CLI as { cmd: string; args: string[] } | null,
    run: (cmd: string, args: string[], input: string) => {
      calls.push({ cmd, args, input });
      return { status: 0, stdout: '', stderr: '', error: null };
    },
    ...extra,
  };
  return { deps, out, errs, calls, all: () => [...out, ...errs].join('\n') };
}

describe('secrets file parsing', () => {
  it('reads NAME=value lines, ignoring comments and blanks, with optional export and quotes', () => {
    const { entries, problems } = parseSecretsText("# c\n\nA=1\nexport B = 'two words'\nC=\"x\"\nD=a#b\n");
    expect(problems).toEqual([]);
    expect([...entries].map(([k, v]) => [k, v.value])).toEqual([['A', '1'], ['B', 'two words'], ['C', 'x'], ['D', 'a#b']]);
  });

  it('reports bad lines by number only, and duplicates by name', () => {
    const pasted = fakeSupabaseSecret(); // someone pastes a bare secret without NAME=
    const { problems } = parseSecretsText(`${pasted}\nA=1\nA=2\n`);
    expect(problems).toEqual([{ kind: 'bad_line', line: 1 }, { kind: 'duplicate', line: 3, name: 'A' }]);
    expect(JSON.stringify(problems)).not.toContain(pasted);
  });

  it('only shows a name that looks like a name and not like a pasted secret', () => {
    expect(printableName('YOUTUBE_API_KEY')).toBe(true);
    expect(printableName('sb_secret_abc')).toBe(false);
    expect(printableName('AIzaSyFAKE')).toBe(false);
    expect(printableName('lowercase')).toBe(false);
  });
});

describe('manifest and plan', () => {
  it('covers every name of the key matrix in docs/SECRETS.md and nothing else', () => {
    const expected = [
      'SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'OWNER_EMAIL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'HMAC_KEY',
      'YOUTUBE_API_KEY', 'REBUILD_DISPATCH_TOKEN', 'YOUTUBE_CHANNEL_ID', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'CRON_SECRET', 'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_PROJECT_REF', 'SUPABASE_DB_URL', 'AGE_DRILL_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'AGE_PUBLIC_KEY',
      'AGE_DRILL_PUBLIC_KEY', 'PUBLIC_SITE_URL', 'PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PUBLIC_TURNSTILE_SITE_KEY', 'PUBLIC_WHATSAPP_NUMBER',
      'PUBLIC_ALLOW_INDEXING', 'PUBLIC_CF_ANALYTICS_TOKEN', 'PUBLIC_HSTS_MAX_AGE', 'PREVIEW_PUBLIC_SUPABASE_URL',
      'PREVIEW_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PREVIEW_PUBLIC_TURNSTILE_SITE_KEY',
    ];
    expect(Object.keys(MANIFEST).sort()).toEqual(expected.sort());
  });

  it('sends each name where docs/SECRETS.md says', () => {
    expect(MANIFEST.REBUILD_DISPATCH_TOKEN.targets).toEqual(['vercel']); // Vercel project env, not a GitHub secret
    expect(MANIFEST.VERCEL_TOKEN.targets).toEqual(['github-secret']); // the deploy credential never goes to the Vercel project
    expect(MANIFEST.CRON_SECRET.targets).toEqual(['vercel']);
    expect(MANIFEST.SUPABASE_SECRET_KEY.targets).toEqual(['vercel', 'github-secret']);
    expect(MANIFEST.SUPABASE_DB_URL.targets).toEqual(['github-secret']);
    expect(MANIFEST.AGE_PUBLIC_KEY.targets).toEqual(['github-variable']); // public: a variable, not a secret
    expect(MANIFEST.AGE_DRILL_KEY.targets).toEqual(['github-secret']);
  });

  it('refuses unknown names, switch names and wrong shapes, naming the variable but never the value', () => {
    const text = [
      `SUPABSE_SECRET_KEY=${SECRET_KEY}`, // typo
      'DEPLOY_ENABLED=true',
      `PUBLIC_SUPABASE_PUBLISHABLE_KEY=${SECRET_KEY}`, // a secret in a public variable
      `AGE_PUBLIC_KEY=${fakeAgePrivateKey()}`, // private key where the public one belongs
      'TELEGRAM_CHAT_ID=not-a-number',
    ].join('\n');
    const { entries, problems: parse } = parseSecretsText(text);
    const { problems, plan } = buildPlan(entries, parse);
    expect(plan).toEqual([]);
    const joined = problems.join('\n');
    expect(joined).toContain('SUPABSE_SECRET_KEY: not a known name');
    expect(joined).toContain('DEPLOY_ENABLED: this is a switch');
    expect(joined).toContain('PUBLIC_SUPABASE_PUBLISHABLE_KEY: must start with sb_publishable_');
    expect(joined).toContain('AGE_PUBLIC_KEY: must be an age PUBLIC key');
    expect(joined).toContain('TELEGRAM_CHAT_ID');
    for (const v of [SECRET_KEY, fakeAgePrivateKey(), 'not-a-number']) expect(joined).not.toContain(v);
  });

  it('skips empty values and honours --only', () => {
    const { entries } = parseSecretsText(goodFile);
    const all = buildPlan(entries, []);
    expect(all.skippedEmpty).toEqual(['RESEND_API_KEY']);
    expect(all.plan.find((p) => p.name === 'SUPABASE_SECRET_KEY')?.targets).toEqual(['vercel', 'github-secret']);
    const vercel = buildPlan(entries, [], { only: 'vercel' });
    expect(vercel.plan.map((p) => p.name).sort()).toEqual(['HMAC_KEY', 'SUPABASE_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']);
    const github = buildPlan(entries, [], { only: 'github' });
    expect(github.plan.find((p) => p.name === 'SUPABASE_SECRET_KEY')?.targets).toEqual(['github-secret']);
    expect(github.plan.find((p) => p.name === 'HMAC_KEY')).toBeUndefined();
  });
});

describe('redact', () => {
  it('replaces every long value, ignores short ones', () => {
    expect(redact(`bad ${SECRET_KEY} and ${BOT_TOKEN} and true`, [SECRET_KEY, BOT_TOKEN, 'true'])).toBe('bad [hidden] and [hidden] and true');
  });
});

describe('load-secrets: dry run', () => {
  it('shows only names and destinations, sends nothing, prints no value', async () => {
    const h = harness(goodFile);
    const code = await main(['--dry-run'], h.deps);
    expect(code).toBe(0);
    expect(h.calls).toEqual([]);
    const text = h.all();
    expect(text).toContain('SUPABASE_SECRET_KEY  ->  Vercel env (Production, sensitive), GitHub secret');
    expect(text).toContain('can never show them again'); // the owner is told before anything is sent (review fix-infra 4)
    expect(text).toContain('AGE_PUBLIC_KEY  ->  GitHub variable');
    expect(text).toContain('RESEND_API_KEY  (empty, skipped)');
    expect(text).toContain('dry run');
    for (const v of VALUES) expect(text).not.toContain(v);
    expect(text).not.toContain('123456789');
  });
});

describe('load-secrets: sending', () => {
  it('passes every value through standard input only, never on a command line, and prints no value', async () => {
    const h = harness(goodFile);
    const code = await main(['--repo', 'owner/power-smash'], h.deps);
    expect(code).toBe(0);
    // 4 + 2 + ... : SUPABASE_SECRET_KEY x2, TELEGRAM_BOT_TOKEN x2, TELEGRAM_CHAT_ID x2, HMAC_KEY x1, SUPABASE_DB_URL x1, AGE_PUBLIC_KEY x1, PUBLIC_ALLOW_INDEXING x1
    expect(h.calls).toHaveLength(10);
    const byName = (n: string) => h.calls.filter((c) => c.args.includes(n));
    expect(byName('SUPABASE_SECRET_KEY').map((c) => c.input)).toEqual([`${SECRET_KEY}\n`, `${SECRET_KEY}\n`]);
    for (const call of h.calls) {
      const argLine = [call.cmd, ...call.args].join(' ');
      for (const v of VALUES) expect(argLine).not.toContain(v);
      expect(argLine).not.toContain('123456789');
    }
    const gh = h.calls.filter((c) => c.cmd === 'gh');
    expect(gh.every((c) => c.args.includes('--repo') && c.args.includes('owner/power-smash'))).toBe(true);
    expect(gh.some((c) => c.args[0] === 'variable' && c.args[2] === 'AGE_PUBLIC_KEY')).toBe(true);
    expect(gh.some((c) => c.args[0] === 'secret' && c.args[2] === 'SUPABASE_DB_URL')).toBe(true);
    const vercel = h.calls.filter((c) => c.cmd !== 'gh');
    expect(vercel.length).toBeGreaterThan(0);
    // the LOCKED Vercel CLI (never a live `vercel@x.y.z` npx fetch), `env add NAME production --sensitive`: the value only on standard input
    expect(vercel.every((c) => c.cmd === FAKE_LOCKED_CLI.cmd && c.args[0] === FAKE_LOCKED_CLI.args[0] && !c.args.some((a) => /^vercel@/.test(a)) && c.args.join(' ').includes('env add') && c.args.at(-2) === 'production' && c.args.at(-1) === '--sensitive')).toBe(true);
    expect(gh.every((c) => !c.args.includes('--sensitive'))).toBe(true); // the flag belongs to the Vercel CLI only
    expect(vercel.every((c) => !c.args.join(' ').includes('wrangler'))).toBe(true);
    const text = h.all();
    for (const v of VALUES) expect(text).not.toContain(v);
    expect(text).toContain('all sent');
    expect(text).toContain('DELETE the secrets file');
  });

  it('a failing vendor command is reported by name, with the value redacted from its message, and the exit code is 1', async () => {
    const h = harness(goodFile, {
      run: (_cmd: string, args: string[], input: string) => ({
        status: args.includes('HMAC_KEY') ? 1 : 0,
        stdout: '',
        stderr: `could not set it: ${input.trim()} was rejected`,
        error: null,
      }),
    });
    const code = await main([], h.deps);
    expect(code).toBe(1);
    const text = h.all();
    expect(text).toContain('FAIL  HMAC_KEY');
    expect(text).toContain('[hidden]');
    for (const v of VALUES) expect(text).not.toContain(v);
  });

  it('a failed send shows the real cause, not a deprecation warning printed before it (Vercel CLI 64.6+)', async () => {
    const h = harness(`HMAC_KEY=${HMAC}`, {
      run: () => ({
        status: 1,
        stdout: '',
        stderr: 'WARN! The "production" argument is deprecated. Use --environment production instead.\n\nError: The variable "HMAC_KEY" already exists in the production environment.',
        error: null,
      }),
    });
    expect(await main(['--only', 'vercel'], h.deps)).toBe(1);
    expect(h.all()).toMatch(/FAIL {2}HMAC_KEY {2}->.*: Error: The variable "HMAC_KEY" already exists/);
    expect(h.all()).not.toMatch(/FAIL[^\n]*deprecated/);
  });

  it('failureDetail: the first line that is not a warning, else the first line, else "no message"', () => {
    expect(failureDetail('Warning: --target is deprecated\nError: Not logged in')).toBe('Error: Not logged in');
    expect(failureDetail('DEPRECATED: use --environment\n  Error: no project linked  ')).toBe('Error: no project linked');
    expect(failureDetail('Note: the bare environment argument is deprecated\nfatal: denied')).toBe('fatal: denied');
    expect(failureDetail('WARN only a warning')).toBe('WARN only a warning');
    expect(failureDetail('\n\n')).toBe('no message');
    expect(failureDetail('could not set it: [hidden] was rejected')).toBe('could not set it: [hidden] was rejected');
  });

  it('one unknown name refuses the whole run before anything is sent', async () => {
    const h = harness(`${goodFile}\nSOME_NEW_THING=abc12345`);
    const code = await main([], h.deps);
    expect(code).toBe(2);
    expect(h.calls).toEqual([]);
    expect(h.all()).toContain('SOME_NEW_THING: not a known name');
  });

  it('a pasted bare secret line refuses the run without echoing it', async () => {
    const h = harness(`${SECRET_KEY}\nTELEGRAM_CHAT_ID=123456789`);
    expect(await main([], h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
    expect(h.all()).not.toContain(SECRET_KEY);
    expect(h.all()).toContain('line 1');
  });

  it('refuses bad options and a missing file', async () => {
    expect(await main(['--only', 'both'], harness(goodFile).deps)).toBe(2);
    expect(await main(['--repo', 'not a repo'], harness(goodFile).deps)).toBe(2);
    const h = harness(goodFile, { exists: () => false });
    expect(await main([], h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
  });
});

describe('load-secrets: the file must not be tracked by git', () => {
  it('refuses a TRACKED file before reading it or sending anything', async () => {
    let read = false;
    const h = harness(goodFile, {
      git: { top: () => '/repo', tracked: () => true, ignored: () => true },
      read: () => {
        read = true;
        return goodFile;
      },
    });
    const code = await main(['--file', '/repo/.secrets.local'], h.deps);
    expect(code).toBe(2);
    expect(h.errs.join('\n')).toMatch(/REFUSED.*TRACKED by git/);
    expect(read).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('refuses a file that git would not ignore', async () => {
    const h = harness(goodFile, { git: { top: () => '/repo', tracked: () => false, ignored: () => false } });
    expect(await main(['--file', '/repo/secrets-copy.txt'], h.deps)).toBe(2);
    expect(h.errs.join('\n')).toMatch(/not listed in \.gitignore/);
    expect(h.calls).toEqual([]);
  });

  it('allows an ignored, untracked file and a file outside any repository', () => {
    expect(secretsFileProblem('/repo/.secrets.local', okGit)).toBeNull();
    expect(secretsFileProblem('/elsewhere/s.txt', noGit)).toBeNull();
  });

  it('works against a real git repository (tracked, untracked-but-not-ignored, ignored)', () => {
    const git = spawnSync('git', ['--version']);
    if (git.status !== 0) return; // git missing: the injected tests above cover the logic
    const repo = tempDir('ps-secrets-repo-');
    const run = (...args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    expect(run('init').status).toBe(0);
    writeFileSync(join(repo, '.gitignore'), '.secrets.local\n');
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, '.secrets.local'), 'A=1\n');
    writeFileSync(join(repo, 'plain.txt'), 'A=1\n');
    writeFileSync(join(repo, 'staged.txt'), 'A=1\n');
    expect(run('add', 'staged.txt').status).toBe(0);
    expect(secretsFileProblem(join(repo, '.secrets.local'))).toBeNull();
    expect(secretsFileProblem(join(repo, 'plain.txt'))).toMatch(/not listed in \.gitignore/);
    expect(secretsFileProblem(join(repo, 'staged.txt'))).toMatch(/TRACKED by git/);
    // Force-adding an ignored file makes it tracked: refused again.
    expect(run('add', '-f', '.secrets.local').status).toBe(0);
    expect(secretsFileProblem(join(repo, '.secrets.local'))).toMatch(/TRACKED by git/);
  }, 60_000); // many short git processes: slow on a busy Windows PC
});

describe('TURNSTILE_SECRET_KEY value check (review S-1)', () => {
  const check = (v: string) => (MANIFEST as Record<string, { check?: (v: string) => string | null }>).TURNSTILE_SECRET_KEY.check?.(v);
  const testSecret = (digit: string) => `${digit}x${'0'.repeat(31)}AA`; // built at run time: Cloudflare's published TEST secrets have this shape
  it('refuses all three published test secrets, with a plain message', () => {
    for (const d of ['1', '2', '3']) expect(check(testSecret(d))).toMatch(/TEST secrets/);
  });
  it('accepts a real-looking production secret', () => {
    expect(check(`0x4${'Z'.repeat(32)}`)).toBeNull();
  });
});
// ---- review fix-infra 4: production values go to Vercel as SENSITIVE (write-only after saving) -----------------------------------
// Docs relied on: https://vercel.com/docs/environment-variables/sensitive-environment-variables and https://vercel.com/docs/cli/env
// (read 2026-10-22: `--sensitive` maps to type "secret"; Production and Preview support it; Development only in the newest docs).
describe('load-secrets: Vercel values are stored as sensitive', () => {
  const FAKE = (name: string): string => ['fake', 'value', name.toLowerCase(), 'x'.repeat(24)].join('-'); // built at run time, 16+ characters

  it('passes --sensitive to `vercel env add` for Production and Preview, and not for Development (unsupported in older docs)', () => {
    expect(VERCEL_SCOPE).toBe('production');
    expect([...SENSITIVE_SCOPES].sort()).toEqual(['preview', 'production']);
    expect(vercelEnvAddArgs('HMAC_KEY')).toEqual(['env', 'add', 'HMAC_KEY', 'production', '--sensitive']);
    expect(vercelEnvAddArgs('HMAC_KEY', 'preview')).toEqual(['env', 'add', 'HMAC_KEY', 'preview', '--sensitive']);
    expect(vercelEnvAddArgs('HMAC_KEY', 'development')).toEqual(['env', 'add', 'HMAC_KEY', 'development']);
  });

  it('EVERY name that goes to Vercel is sent with --sensitive and its value only on standard input', async () => {
    const vercelNames = Object.entries(MANIFEST)
      .filter(([, spec]) => (spec as { targets: string[] }).targets.includes('vercel'))
      .map(([name]) => name);
    expect(vercelNames).toEqual(expect.arrayContaining(['SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY', 'HMAC_KEY', 'CRON_SECRET', 'OWNER_EMAIL']));
    const lines = vercelNames.map((name) => {
      if (name === 'TURNSTILE_SECRET_KEY') return `${name}=0x4${'Z'.repeat(32)}`;
      if (name === 'SUPABASE_SECRET_KEY') return `${name}=${SECRET_KEY}`;
      if (name === 'TELEGRAM_BOT_TOKEN') return `${name}=${BOT_TOKEN}`;
      if (name === 'TELEGRAM_CHAT_ID') return `${name}=123456789`;
      if (name === 'HMAC_KEY') return `${name}=${HMAC}`;
      return `${name}=${FAKE(name)}`;
    });
    const h = harness(lines.join('\n'));
    expect(await main(['--only', 'vercel'], h.deps)).toBe(0);
    expect(h.calls).toHaveLength(vercelNames.length);
    for (const c of h.calls) {
      expect(c.cmd).not.toBe('gh');
      expect(c.args.at(-2), c.args.join(' ')).toBe('production');
      expect(c.args.at(-1)).toBe('--sensitive');
      expect(c.args.slice(c.args.indexOf('env')).join(' ')).not.toMatch(/--value|--force|--yes/); // no value on the command line (npx's own --yes is before `env`)
    }
    expect(h.calls.map((c) => c.args.at(-3)).sort()).toEqual([...vercelNames].sort());
    const text = h.all();
    expect(text).toContain('Vercel env (Production, sensitive)');
    for (const v of [SECRET_KEY, BOT_TOKEN, HMAC, '123456789', ...vercelNames.map(FAKE)]) expect(text).not.toContain(v);
  });

  it('runs the LOCKED Vercel CLI for every Vercel send and never fetches one with npx', async () => {
    const h = harness(`HMAC_KEY=${HMAC}\nCRON_SECRET=${FAKE('CRON_SECRET')}`);
    expect(await main(['--only', 'vercel'], h.deps)).toBe(0);
    expect(h.calls).toHaveLength(2);
    for (const c of h.calls) {
      expect(c.cmd).toBe(FAKE_LOCKED_CLI.cmd);
      expect(c.args.slice(0, FAKE_LOCKED_CLI.args.length)).toEqual(FAKE_LOCKED_CLI.args);
      expect([c.cmd, ...c.args].join(' ')).not.toMatch(/npx|vercel@|--yes/);
    }
  });

  it('REFUSES before the first send when the locked Vercel CLI is not installed (nothing goes to GitHub either)', async () => {
    const h = harness(`SUPABASE_SECRET_KEY=${SECRET_KEY}\nHMAC_KEY=${HMAC}`, { vercelCli: null });
    expect(await main(['--repo', 'owner/power-smash'], h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
    expect(h.all()).toContain('Nothing was sent');
    expect(h.all()).toContain(VERCEL_INSTALL_COMMAND);
    expect(h.all()).not.toContain(SECRET_KEY);
  });

  it('a GitHub-only run does not need the Vercel CLI, and a dry run says whether it is installed', async () => {
    const gh = harness(`SUPABASE_SECRET_KEY=${SECRET_KEY}`, { vercelCli: null });
    expect(await main(['--only', 'github', '--repo', 'owner/power-smash'], gh.deps)).toBe(0);
    expect(gh.calls.every((c) => c.cmd === 'gh')).toBe(true);
    const missing = harness(`HMAC_KEY=${HMAC}`, { vercelCli: null });
    expect(await main(['--dry-run'], missing.deps)).toBe(0);
    expect(missing.all()).toContain('NOT installed');
    expect(missing.all()).toContain(VERCEL_INSTALL_COMMAND);
    const present = harness(`HMAC_KEY=${HMAC}`);
    expect(await main(['--dry-run'], present.deps)).toBe(0);
    expect(present.all()).toContain('locked copy is installed');
    expect(present.calls).toEqual([]);
  });

  it('the failure message no longer claims that sending twice is harmless for Vercel', async () => {
    const h = harness(`HMAC_KEY=${HMAC}`, { run: () => ({ status: 1, stdout: '', stderr: 'already exists', error: null }) });
    expect(await main(['--only', 'vercel'], h.deps)).toBe(1);
    expect(h.all()).toMatch(/Vercel refuses a name that already exists/);
  });

  it('resolveLockedVercel reads the entry file from the installed package.json and returns null for anything missing', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { vercel: '64.5.0' } }));
    expect(resolveLockedVercel(dir)).toBeNull(); // not installed
    mkdirSync(join(dir, 'node_modules', 'vercel', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'vercel', 'package.json'), JSON.stringify({ name: 'vercel', version: '64.5.0', bin: { vc: 'dist/vc.js', vercel: 'dist/vc.js' } }));
    expect(resolveLockedVercel(dir)).toBeNull(); // package.json but no entry file
    writeFileSync(join(dir, 'node_modules', 'vercel', 'dist', 'vc.js'), '// fake');
    const cli = resolveLockedVercel(dir);
    expect(cli?.cmd).toBe(process.execPath);
    expect(cli?.args).toEqual([join(dir, 'node_modules', 'vercel', 'dist', 'vc.js')]);
    writeFileSync(join(dir, 'node_modules', 'vercel', 'package.json'), '{ not json');
    expect(resolveLockedVercel(dir)).toBeNull(); // unreadable package.json fails closed
  });

  it('an installed copy that is not exactly the pinned version counts as not installed (a stale copy after a bump is never used)', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'node_modules', 'vercel', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'vercel', 'dist', 'vc.js'), '// fake');
    const install = (v: string) => writeFileSync(join(dir, 'node_modules', 'vercel', 'package.json'), JSON.stringify({ name: 'vercel', version: v, bin: { vercel: 'dist/vc.js' } }));
    const pin = (v: string | null) => writeFileSync(join(dir, 'package.json'), JSON.stringify(v === null ? {} : { dependencies: { vercel: v } }));
    pin('64.5.0');
    install('64.2.0');
    expect(resolveLockedVercel(dir)).toBeNull(); // older copy left from before the bump
    install('64.6.0');
    expect(resolveLockedVercel(dir)).toBeNull(); // newer, unreviewed copy
    install('64.5.0');
    expect(resolveLockedVercel(dir)).not.toBeNull();
    pin(null);
    expect(resolveLockedVercel(dir)).toBeNull(); // no pin to compare with: fail closed
  });

  it('still refuses a Cloudflare Turnstile TEST secret before anything is sent', async () => {
    const testSecret = `1x${'0'.repeat(31)}AA`; // the published test-secret shape, built at run time
    const h = harness(`TURNSTILE_SECRET_KEY=${testSecret}\nHMAC_KEY=${HMAC}`);
    expect(await main([], h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
    expect(h.all()).toContain('TEST secrets');
    expect(h.all()).not.toContain(testSecret);
  });

  it('the CLI version the loader pins is the one in ci/vercel-cli (one number to bump) and the lockfile agrees', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'ci/vercel-cli/package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const lock = JSON.parse(readFileSync(join(ROOT, 'ci/vercel-cli/package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
    };
    expect(pkg.dependencies.vercel).toBe(VERCEL_CLI_VERSION);
    expect(lock.packages['node_modules/vercel']?.version).toBe(VERCEL_CLI_VERSION);
    expect(lock.packages['']?.dependencies?.vercel).toBe(VERCEL_CLI_VERSION);
  });
});
