// Review fix-infra (docs/m3/review-fix-infra-notes.md): the guards around the deploy pipeline that the independent security review asked for.
//   1. vercel.json turns Vercel's own Git integration off, so it can never publish an un-gated build.
//   2. every job that reads a repository secret is switched by its variable AND runs on main only.
//   3. the Vercel CLI comes from a committed lockfile (ci/vercel-cli), installed without scripts in a step that holds no credential.
// Textual on purpose: no YAML parser is a direct dependency of this project. No secret value appears anywhere.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const codeLines = (text: string): string[] => text.split('\n').filter((l) => !l.trim().startsWith('#'));
const deploy = read('.github/workflows/deploy.yml');
const preview = read('.github/workflows/preview.yml');

// ---------------------------------------------------------------------------------------------------------------------------------
// FIX 1: vercel.json
// Doc relied on: https://vercel.com/docs/project-configuration/git-configuration (`git.deploymentEnabled: false` turns off automatic
// deployments for all branches; read 2026-10-22). The docs describe it as a rule for Git commits; they do not say in so many words that it
// never touches `vercel deploy --prebuilt`, so the first preview run is the check (docs/m3/review-fix-infra-notes.md).
// `ignoreCommand` is deliberately NOT used: it runs when a build starts and no page says it is skipped for a prebuilt upload, so it could
// block the real deploy path.
describe('vercel.json (review fix-infra 1)', () => {
  const cfg = JSON.parse(read('vercel.json')) as Record<string, unknown>;

  it('turns Git-triggered deployments off for every branch', () => {
    expect(cfg.git).toEqual({ deploymentEnabled: false });
  });

  it('keeps the Mumbai region and has no cron, no ignoreCommand and no deprecated github switch', () => {
    expect(cfg.regions).toEqual(['bom1']);
    expect(cfg).not.toHaveProperty('crons');
    expect(cfg).not.toHaveProperty('ignoreCommand');
    expect(cfg).not.toHaveProperty('github');
  });

  it('sets no build or output setting: the only build is the strict one in deploy.yml, uploaded prebuilt', () => {
    for (const key of ['buildCommand', 'installCommand', 'outputDirectory', 'framework', 'devCommand']) expect(cfg, key).not.toHaveProperty(key);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// FIX 2: main-only guard
// workflow_dispatch can start on ANY branch, and edited YAML on a branch can read repository secrets. So every job that references a
// repository secret (other than the automatic GITHUB_TOKEN) must be gated by its own switch AND by the main branch. A new workflow that
// reads a secret without that gate fails here. preview.yml is the one documented exception: it must run for pull requests, so it holds
// only the three Vercel deploy credentials and carries its own same-repository condition (tested in workflows.test.ts).
interface JobInfo {
  id: string;
  ifLine: string | null;
  secrets: string[];
  opaque: boolean;
}

function jobsOf(text: string): JobInfo[] {
  const lines = codeLines(text);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const jobs: { id: string; lines: string[] }[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break; // the next top-level key
    const m = /^ {2}([\w-]+):\s*$/.exec(l);
    if (m) jobs.push({ id: m[1] as string, lines: [] });
    else jobs.at(-1)?.lines.push(l);
  }
  return jobs.map((j) => {
    const body = j.lines.join('\n');
    const ifMatch = /^ {4}if:\s*(.*)$/m.exec(body);
    const secrets = [...new Set([...body.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1] as string))].filter((n) => n !== 'GITHUB_TOKEN');
    // forms that pass secrets without naming them cannot be checked by name: treat them as secret-reading
    const opaque = /secrets:\s*inherit|\bsecrets\[|toJSON\(\s*secrets\s*\)/.test(body);
    return { id: j.id, ifLine: ifMatch ? (ifMatch[1] as string).trim() : null, secrets, opaque };
  });
}

const MAIN_ONLY_IF = /^\$\{\{ vars\.[A-Z][A-Z_]*_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}$/;
const PREVIEW_ALLOWED = new Set(['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']);

/** Problems with one workflow file: a job that reads a repository secret without the switch-and-main gate. */
function mainOnlyProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  for (const j of jobsOf(text)) {
    if (j.secrets.length === 0 && !j.opaque) continue;
    if (file === 'preview.yml' && !j.opaque && j.secrets.every((n) => PREVIEW_ALLOWED.has(n))) continue;
    if (j.ifLine === null || !MAIN_ONLY_IF.test(j.ifLine)) {
      problems.push(`${file} job "${j.id}" reads ${j.opaque ? 'secrets (opaque)' : j.secrets.join(', ')} but its if is not "vars.X_ENABLED == 'true' && github.ref == 'refs/heads/main'" (found: ${j.ifLine ?? 'none'})`);
    }
  }
  return problems;
}

describe('every job that reads a repository secret is switched AND main-only (review fix-infra 2)', () => {
  const files = readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));

  it('finds the workflows it is supposed to guard', () => {
    for (const f of ['deploy.yml', 'sync.yml', 'backup.yml', 'retention.yml', 'restore.yml', 'preview.yml', 'ci.yml']) expect(files, f).toContain(f);
  });

  for (const f of files) {
    it(`${f}: no job reads a repository secret outside the switch-and-main gate`, () => {
      expect(mainOnlyProblems(f, read(`.github/workflows/${f}`))).toEqual([]);
    });
  }

  it('the guarded jobs are the ones that hold production credentials, and each is gated exactly as the pattern says', () => {
    const expected: Record<string, string[]> = {
      'deploy.yml': ['VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'VERCEL_TOKEN'],
      'sync.yml': ['SUPABASE_SECRET_KEY'],
      'backup.yml': ['SUPABASE_DB_URL'],
      'retention.yml': ['SUPABASE_SECRET_KEY'],
      'restore.yml': ['AGE_DRILL_KEY', 'DEV_SUPABASE_DB_URL'],
    };
    for (const [f, names] of Object.entries(expected)) {
      const jobs = jobsOf(read(`.github/workflows/${f}`));
      expect(jobs, f).toHaveLength(1);
      expect(jobs[0]?.secrets, f).toEqual(expect.arrayContaining(names));
      expect(jobs[0]?.ifLine, f).toMatch(MAIN_ONLY_IF);
    }
  });

  it('preview.yml is the only exception and holds nothing but the three Vercel deploy credentials', () => {
    const jobs = jobsOf(preview);
    expect(jobs.flatMap((j) => j.secrets).sort()).toEqual([...PREVIEW_ALLOWED].sort());
    expect(jobs.some((j) => j.opaque)).toBe(false);
  });

  it('ci.yml reads no repository secret at all (only the automatic GITHUB_TOKEN)', () => {
    expect(jobsOf(read('.github/workflows/ci.yml')).flatMap((j) => j.secrets)).toEqual([]);
  });

  describe('the checker itself, so a future workflow cannot slip through', () => {
    const wf = (ifLine: string | null, ref = 'secrets.SUPABASE_SECRET_KEY'): string =>
      ['name: X', 'on:', '  workflow_dispatch:', 'jobs:', '  job:', ...(ifLine === null ? [] : [`    if: ${ifLine}`]), '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi', '        env:', `          K: \${{ ${ref} }}`, ''].join('\n');

    it('accepts the switch-and-main pattern', () => {
      expect(mainOnlyProblems('new.yml', wf("${{ vars.NEW_ENABLED == 'true' && github.ref == 'refs/heads/main' }}"))).toEqual([]);
    });

    it('rejects a missing condition, a switch without main, an OR that lets other branches in, and a main check without the switch', () => {
      expect(mainOnlyProblems('new.yml', wf(null))).toHaveLength(1);
      expect(mainOnlyProblems('new.yml', wf("${{ vars.NEW_ENABLED == 'true' }}"))).toHaveLength(1);
      expect(mainOnlyProblems('new.yml', wf("${{ vars.NEW_ENABLED == 'true' || github.ref == 'refs/heads/main' }}"))).toHaveLength(1);
      expect(mainOnlyProblems('new.yml', wf("${{ github.ref == 'refs/heads/main' }}"))).toHaveLength(1);
    });

    it('rejects opaque secret passing and ignores the automatic GITHUB_TOKEN and jobs without secrets', () => {
      expect(mainOnlyProblems('new.yml', wf(null, 'toJSON(secrets)'))).toHaveLength(1);
      expect(mainOnlyProblems('new.yml', wf(null, 'secrets.GITHUB_TOKEN'))).toEqual([]);
      expect(mainOnlyProblems('new.yml', wf(null, 'vars.SOMETHING'))).toEqual([]);
    });

    it('gives the preview exemption to preview.yml only, and only for the Vercel credentials', () => {
      expect(mainOnlyProblems('new.yml', wf(null, 'secrets.VERCEL_TOKEN'))).toHaveLength(1);
      expect(mainOnlyProblems('preview.yml', wf(null, 'secrets.VERCEL_TOKEN'))).toEqual([]);
      expect(mainOnlyProblems('preview.yml', wf(null, 'secrets.SUPABASE_SECRET_KEY'))).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// FIX 3: the locked Vercel CLI
// The CLI is in no root lockfile, so it has its own tiny project with a committed lockfile. Both CLI workflows run `npm ci --ignore-scripts`
// there, in a step WITHOUT any credential, and only the LAST step of the job reads the Vercel secrets.
describe('ci/vercel-cli: the locked Vercel CLI project (review fix-infra 3)', () => {
  const dir = 'ci/vercel-cli';
  type LockEntry = { version?: string; resolved?: string; integrity?: string; link?: boolean; dependencies?: Record<string, string> };
  const cliPkg = JSON.parse(read(`${dir}/package.json`)) as { private?: boolean; dependencies?: Record<string, string>; devDependencies?: unknown; scripts?: unknown };
  const lock = JSON.parse(read(`${dir}/package-lock.json`)) as { lockfileVersion: number; packages: Record<string, LockEntry> };
  const stepsOf = (text: string): string[] => codeLines(text).join('\n').split(/\n {6}- name: /).slice(1);

  it('is private, has exactly one dependency (the CLI, an exact version) and no scripts', () => {
    expect(cliPkg.private).toBe(true);
    expect(Object.keys(cliPkg.dependencies ?? {})).toEqual(['vercel']);
    expect(cliPkg.dependencies?.vercel).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cliPkg.devDependencies).toBeUndefined();
    expect(cliPkg.scripts).toBeUndefined();
  });

  it('keeps the repository supply-chain policy: its .npmrc has the same policy lines as the root .npmrc', () => {
    const policy = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).sort();
    expect(policy(read(`${dir}/.npmrc`))).toEqual(policy(read('.npmrc')));
    expect(read(`${dir}/.npmrc`)).toMatch(/^ignore-scripts=true$/m);
    expect(read(`${dir}/.npmrc`)).toMatch(/^min-release-age=7$/m);
  });

  it('has a lockfile for exactly that version, with an integrity hash and an npm registry address for every package', () => {
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['']?.dependencies).toEqual(cliPkg.dependencies);
    expect(lock.packages['node_modules/vercel']?.version).toBe(cliPkg.dependencies?.vercel);
    const entries = Object.entries(lock.packages).filter(([k]) => k !== '');
    expect(entries.length).toBeGreaterThan(50);
    for (const [name, e] of entries) {
      expect(e.link, name).toBeUndefined();
      expect(e.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//); // no git, file or plain-http source
      expect(e.integrity, name).toMatch(/^sha512-/);
    }
  });

  it('is tracked, not ignored: .gitignore matches node_modules there and none of package.json, package-lock.json and .npmrc', () => {
    if (spawnSync('git', ['--version']).status !== 0) return; // git missing: nothing to check against
    const tmp = mkdtempSync(join(tmpdir(), 'ps-cli-ign-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: tmp });
      writeFileSync(join(tmp, '.gitignore'), readFileSync(join(ROOT, '.gitignore')));
      const paths = [`${dir}/package.json`, `${dir}/package-lock.json`, `${dir}/.npmrc`, `${dir}/node_modules/vercel/package.json`];
      const r = spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: paths.join('\n') });
      expect(r.stdout.split('\n').filter(Boolean)).toEqual([`${dir}/node_modules/vercel/package.json`]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  for (const [file, text] of [['deploy.yml', deploy], ['preview.yml', preview]] as const) {
    it(`${file}: installs it with npm ci --ignore-scripts in ci/vercel-cli, in a step with no credential, before the one (last) step that reads the Vercel secrets`, () => {
      const steps = stepsOf(text);
      const install = steps.find((s) => s.startsWith('Install the locked Vercel CLI'));
      expect(install, 'install step').toBeDefined();
      expect(install).toContain('working-directory: ci/vercel-cli');
      expect(install).toContain('npm ci --ignore-scripts');
      expect(install).toContain('node_modules/.bin/vercel --version'); // a CLI that cannot start fails here, before the token step
      expect(install).not.toMatch(/secrets\.|VERCEL_TOKEN|env:/);
      const withSecrets = steps.filter((s) => /secrets\./.test(s));
      expect(withSecrets).toHaveLength(1);
      expect(steps.at(-1)).toBe(withSecrets[0]); // the credentials are read in the LAST step only
      expect(steps.indexOf(install as string)).toBeLessThan(steps.indexOf(withSecrets[0] as string));
      expect(codeLines(text).join('\n')).toContain('ci/vercel-cli/package-lock.json'); // the npm cache key covers it
    });

    it(`${file}: calls the local binary and never downloads or resolves anything live`, () => {
      const code = codeLines(text).join('\n');
      expect(code).toMatch(/\.\/ci\/vercel-cli\/node_modules\/\.bin\/vercel deploy --prebuilt/);
      expect(code).not.toMatch(/\bnpx\b|vercel@\d|npm (install|i|exec|dlx)\b/);
    });
  }
});
