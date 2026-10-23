// Text checks of the GitHub workflows and the npm scripts: the safety properties the plan promises (D-002, D-008, D-011, D-027).
// Textual on purpose: no YAML parser is a direct dependency of this project.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const ci = read('.github/workflows/ci.yml');
const deploy = read('.github/workflows/deploy.yml');
const backup = read('.github/workflows/backup.yml');
const preview = read('.github/workflows/preview.yml');
const sync = read('.github/workflows/sync.yml');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; dependencies: Record<string, string> };

const codeLines = (text: string): string[] => text.split('\n').filter((l) => !l.trim().startsWith('#'));

describe('every workflow', () => {
  for (const [name, text] of [['ci.yml', ci], ['deploy.yml', deploy], ['backup.yml', backup], ['preview.yml', preview], ['sync.yml', sync]] as const) {
    it(`${name}: third-party actions are pinned to a full commit SHA with the tag in a comment`, () => {
      const uses = codeLines(text).filter((l) => /^\s*-?\s*uses:/.test(l));
      expect(uses.length).toBeGreaterThan(0);
      for (const l of uses) expect(l, l).toMatch(/uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+# v\d+(\.\d+){0,2}\s*$/);
    });

    it(`${name}: never pull_request_target, no shell tracing, no write permissions`, () => {
      expect(codeLines(text).join('\n')).not.toContain('pull_request_target');
      expect(codeLines(text).join('\n')).not.toMatch(/set -[a-z]*x|bash -x/);
      expect(codeLines(text).join('\n')).not.toMatch(/^\s+[\w-]+:\s*write\s*(#.*)?$/m); // no write permission line
    });
  }
});

describe('backup.yml (D-011)', () => {
  const code = codeLines(backup).join('\n');

  it('is disabled unless the repository variable BACKUP_ENABLED is "true" AND the run is on main, at job level (review fix-infra 2)', () => {
    expect(code).toMatch(/^ {4}if: \$\{\{ vars\.BACKUP_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}$/m);
  });

  it('runs weekly and on demand, one at a time, never cancelled', () => {
    expect(code).toMatch(/schedule:\n\s+- cron: "\d+ \d+ \* \* \d"/);
    expect(code).toContain('workflow_dispatch:');
    expect(code).toMatch(/concurrency:\n\s+group: backup\n\s+cancel-in-progress: false/);
  });

  it('has the minimum permissions and does not even check out the code', () => {
    expect(code).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code).not.toContain('actions/checkout');
  });

  it('uses the PostgreSQL 17 client from the official repository, a pinned runner image and age from apt', () => {
    expect(code).toContain('postgresql-client-17');
    expect(code).toContain('/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y');
    expect(code).toContain('runs-on: ubuntu-24.04');
    expect(code).toMatch(/apt-get install -y --no-install-recommends postgresql-common age/);
  });

  it('pipes the dump straight into age: the dump is never written to disk unencrypted', () => {
    expect(code).toMatch(/pg_dump --format=custom --no-owner \| age -r "\$AGE_PUBLIC_KEY" -o "\$out"/);
    expect(code).toContain('set -euo pipefail');
    expect(code).not.toMatch(/pg_dump[^\n|]*(-f|--file)[ =]/); // never a plaintext output file
    expect(code).not.toMatch(/\.dump(?![.\\]+age)/); // no file name ending in a bare .dump
    expect(code).toContain('^age1[0-9a-z]{58}$'); // only a PUBLIC key is accepted
  });

  it('S-13: the password is never on a command line: no --dbname with the URL, PG* variables, the password masked in the log, the URL unset', () => {
    expect(code).not.toMatch(/--dbname/);
    expect(code).not.toMatch(/pg_dump[^\n|]*\$\{?(SUPABASE_DB_URL|PGPASSWORD)/);
    for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) expect(code, name).toContain(name);
    expect(code).toContain('::add-mask::');
    expect(code).toMatch(/unset SUPABASE_DB_URL/);
    expect(code).not.toMatch(/\bset -[a-z]*x/);
  });

  it('reads the connection string only from the secret, in one step, and the key only from the variable', () => {
    expect(code.match(/secrets\.SUPABASE_DB_URL/g)).toHaveLength(1);
    expect(code.match(/vars\.AGE_PUBLIC_KEY/g)).toHaveLength(1);
    expect(code).not.toMatch(/AGE_(DRILL_)?(PRIVATE|KEY)\b.*secrets/);
    expect(code).not.toMatch(/echo[^\n]*\$\{?SUPABASE_DB_URL/); // the value is never echoed (the name may be)
  });

  it('uploads the encrypted file with the retention of D-011 and fails when there is nothing to upload', () => {
    expect(code).toMatch(/actions\/upload-artifact@[0-9a-f]{40}/);
    expect(code).toContain('retention-days: 60');
    expect(code).toContain('if-no-files-found: error');
    expect(code).toContain('path: backup/');
  });

  it('the Telegram alert is optional, off by default, plain text, and the token stays off the command line', () => {
    expect(code).toMatch(/if: \$\{\{ failure\(\) && vars\.BACKUP_TELEGRAM_ALERTS == 'true' \}\}/);
    expect(code).toContain('--config -');
    expect(code).not.toMatch(/curl[^\n]*bot\$\{?TELEGRAM_BOT_TOKEN/); // the URL is inside the config read from stdin
    expect(code).not.toContain('parse_mode');
  });
});

describe('ci.yml', () => {
  const code = codeLines(ci).join('\n');
  it('runs check, tests, build and the NON-strict scans on every pull request', () => {
    for (const step of ['npm run check', 'npm test', 'npm run build', 'npm run check:placeholders', 'npm run check:privacy', 'npm run check:release', 'npm run check:js-budget']) {
      expect(code).toContain(`run: ${step}`);
    }
    expect(code).toMatch(/pull_request:/);
  });
  it('never runs the strict build or sets PS_STRICT, and holds no secrets in the verify job', () => {
    expect(code).not.toContain('build:strict');
    expect(code).not.toContain('PS_STRICT');
    const verify = code.slice(code.indexOf('  verify:'));
    expect(verify).not.toContain('secrets.');
  });
});

describe('deploy.yml', () => {
  const code = codeLines(deploy).join('\n');
  it('C-5: the ONLY build is the strict one, with PS_STRICT=1, and nothing in the workflow runs the plain build or a non-strict gate', () => {
    expect(code.match(/npm run build\b/g)).toHaveLength(1);
    expect(code).toContain('run: npm run build:strict');
    expect(code).toContain('PS_STRICT: "1"');
    expect(code).not.toContain('vars.PS_STRICT');
    expect(code).not.toMatch(/npm run check:(placeholders|privacy|release)/); // build:strict runs them strict; nothing runs them non-strict
    const strictStep = code.slice(code.indexOf('- name: Build (strict release gate)'), code.indexOf('- name: Deploy to Vercel production'));
    expect(strictStep.length).toBeGreaterThan(100);
    expect(strictStep).not.toMatch(/^\s+if:/m); // no condition: the strict build cannot be skipped
  });
  it('passes the public build variables, including the new ones, and keeps secrets out of the build steps', () => {
    for (const name of ['PUBLIC_SITE_URL', 'PUBLIC_ALLOW_INDEXING', 'PUBLIC_CF_ANALYTICS_TOKEN', 'PUBLIC_HSTS_MAX_AGE', 'PUBLIC_WHATSAPP_NUMBER']) {
      expect(code).toContain(`${name}: \${{ vars.${name} }}`);
    }
    const build = code.slice(code.indexOf('Build (strict release gate)'), code.indexOf('Deploy to Vercel production'));
    expect(build).not.toContain('secrets.');
    expect(build).not.toContain('VERCEL_TOKEN');
    expect(build).not.toMatch(/SUPABASE_SECRET_KEY|HMAC_KEY|TURNSTILE_SECRET_KEY/);
  });
  it('is still switched off by DEPLOY_ENABLED, and never runs off the main branch (S-10)', () => {
    expect(code).toContain("if: ${{ vars.DEPLOY_ENABLED == 'true' && github.ref == 'refs/heads/main' }}");
    expect(code.match(/github\.ref/g)).toHaveLength(1);
  });
});

describe('deploy.yml on Vercel', () => {
  const code = codeLines(deploy).join('\n');
  const all = deploy;
  it('uploads the prebuilt output to production with the LOCKED CLI (ci/vercel-cli), only after the strict build, with credentials in the last step only', () => {
    expect(code).toContain('./ci/vercel-cli/node_modules/.bin/vercel deploy --prebuilt --prod --yes');
    expect(code.indexOf('npm run build:strict')).toBeGreaterThan(-1);
    expect(code.indexOf('npm run build:strict')).toBeLessThan(code.indexOf('ci/vercel-cli/node_modules/.bin/vercel deploy'));
    expect(code).not.toMatch(/vercel pull|vercel build|vercel env|wrangler/); // no download of production env into the build job
    expect(code.match(/secrets\./g)).toHaveLength(3); // VERCEL_TOKEN, ORG, PROJECT: nothing else
    expect(code.indexOf('secrets.VERCEL_TOKEN')).toBeGreaterThan(code.indexOf('npm run build:strict'));
    expect(all).toContain('.vercel/output/config.json');
  });
  it('never forces indexing on and has no non-strict or non-main path', () => {
    expect(code).not.toMatch(/PUBLIC_ALLOW_INDEXING: ['"]?true/);
    expect(code).toContain('PUBLIC_ALLOW_INDEXING: ${{ vars.PUBLIC_ALLOW_INDEXING }}');
    expect(code).not.toMatch(/continue-on-error|\|\| true/);
    expect(code).toContain('concurrency:\n  group: deploy\n  cancel-in-progress: false');
  });
});

describe('preview.yml', () => {
  const code = codeLines(preview).join('\n');
  it('is off unless PREVIEW_ENABLED is true, and runs only for workflow_dispatch or same-repository pull requests', () => {
    expect(code).toContain("vars.PREVIEW_ENABLED == 'true'");
    expect(code).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(code).toContain('workflow_dispatch:');
    expect(code).not.toContain('pull_request_target');
  });
  it('never deploys to production, never uses the strict build, forces noindex and uses the dev values', () => {
    expect(code).not.toMatch(/--prod/);
    expect(code).toContain('./ci/vercel-cli/node_modules/.bin/vercel deploy --prebuilt --yes'); // the locked CLI, no live npx (review fix-infra 3)
    expect(code).not.toContain('build:strict');
    expect(code).not.toContain('PS_STRICT');
    expect(code).toContain('PUBLIC_ALLOW_INDEXING: "false"');
    expect(code).toContain('vars.PREVIEW_PUBLIC_SUPABASE_URL');
    expect(code).not.toMatch(/vars\.PUBLIC_(SUPABASE|SITE|WHATSAPP|TURNSTILE)/);
  });
  it('asks for a preview target explicitly and refuses to upload unless Vercel Authentication covers ALL deployments (VF-V11)', () => {
    // 2026-10-23: the first deployment of the project became PRODUCTION although no --prod was given, and Standard Protection left the
    // production address public. The deploy step must name the target and check the project's protection level first (fail closed).
    expect(code).toContain('vercel deploy --prebuilt --yes --target=preview');
    expect(code).toContain('/v9/projects/${VERCEL_PROJECT_ID}?teamId=${VERCEL_ORG_ID}');
    expect(code).toContain('ssoProtection');
    expect(code).toContain('"$level" != "all"');
    expect(code).toContain('Nothing was deployed');
    expect(code.indexOf('"$level" != "all"')).toBeLessThan(code.indexOf('vercel deploy --prebuilt'));
    expect(code).toContain('console.log("unreadable")'); // an answer that cannot be read is not "all", so the job stops
  });
  it('holds no production secret: only the three Vercel credentials, and only in the deploy step', () => {
    const refs = code.match(/secrets\.[A-Z_]+/g) ?? [];
    expect([...new Set(refs)].sort()).toEqual(['secrets.VERCEL_ORG_ID', 'secrets.VERCEL_PROJECT_ID', 'secrets.VERCEL_TOKEN']);
    expect(code.indexOf('secrets.VERCEL_TOKEN')).toBeGreaterThan(code.indexOf('npm run build'));
    expect(code).not.toMatch(/SUPABASE_SECRET_KEY|TURNSTILE_ALLOW_TEST_KEYS|vercel pull|vercel env/);
  });
});

describe('sync.yml on GitHub (works on any Vercel plan)', () => {
  it('stays off unless SYNC_ENABLED is true and never deploys or runs Cloudflare tooling', () => {
    const code = codeLines(sync).join('\n');
    expect(code).toContain("vars.SYNC_ENABLED == 'true'");
    expect(code).not.toMatch(/vercel|wrangler|--prod/i);
  });
});

describe('every DISABLED-by-default switch', () => {
  it('each production-affecting job is gated by its variable at job level', () => {
    for (const [text, v] of [[deploy, 'DEPLOY_ENABLED'], [preview, 'PREVIEW_ENABLED'], [sync, 'SYNC_ENABLED'], [backup, 'BACKUP_ENABLED']] as const) {
      expect(codeLines(text).join('\n')).toContain(`    if: \${{ vars.${v} == 'true'`);
    }
  });
});

describe('package.json scripts', () => {
  it('has the gates, the strict build, the owner helpers, and the header step INSIDE the build (not a postbuild hook)', () => {
    // .npmrc has ignore-scripts=true (D-002): npm then skips every pre/post hook, so a postbuild entry would never run.
    expect(read('.npmrc')).toMatch(/^ignore-scripts=true$/m);
    expect(pkg.scripts.postbuild).toBeUndefined();
    expect(pkg.scripts.build).toBe('node scripts/build.mjs');
    expect(read('scripts/build.mjs')).toContain("'scripts/finalize-headers.ts'");
    expect(pkg.scripts['finalize:headers']).toBe('node scripts/finalize-headers.ts');
    expect(pkg.scripts['build:strict']).toBe('node scripts/build-strict.mjs');
    expect(pkg.scripts['check:placeholders']).toBe('node scripts/check-placeholders.ts');
    expect(pkg.scripts['check:privacy']).toBe('node scripts/privacy-scan.ts');
    expect(pkg.scripts['check:release']).toBe('node scripts/check-release.ts');
    expect(pkg.scripts['check:js-budget']).toBe('node scripts/check-js-budget.ts');
    expect(pkg.scripts['secrets:load']).toBe('node scripts/load-secrets.mjs');
    expect(pkg.scripts['telegram:chat-id']).toBe('node scripts/telegram-chat-id.mjs');
    expect(pkg.scripts['age:keys']).toBe('node scripts/make-age-keys.mjs');
  });
  it('C-5: npm run build says loudly, first and last, that it is the non-strict developer build; build:strict sets PS_STRICT=1 for every step', () => {
    const build = read('scripts/build.mjs');
    expect(build).toContain('NON-STRICT developer build');
    expect(build).toContain('npm run build:strict');
    expect(build.match(/console\.log\(NOTICE\)/g)).toHaveLength(2);
    expect(build.indexOf('console.log(NOTICE)')).toBeLessThan(build.indexOf("'build'"));
    const strict = read('scripts/build-strict.mjs');
    expect(strict).toContain("PS_STRICT: '1'");
    // every gate runs in the strict build, the JavaScript budget included (C-1)
    for (const script of ['check-release.ts', 'finalize-headers.ts', 'check-placeholders.ts', 'privacy-scan.ts', 'check-js-budget.ts']) expect(strict, script).toContain(`scripts/${script}`);
    expect(strict.match(/\d\/7 /g)).toHaveLength(7);
    expect(strict).not.toMatch(/\d\/6 /);
  });
  it('is Windows-safe: no POSIX-only shell syntax in any script', () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, name).not.toMatch(/\b[A-Z_]+=\S|\$\(|`|\brm\b|\bexport\b/);
    }
  });
});
