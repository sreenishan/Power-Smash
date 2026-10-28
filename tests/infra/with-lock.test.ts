// scripts/with-lock.mjs passes every argument on exactly as given. It used Node's spawn(cmd, args, { shell: true }), which only joins
// the arguments with spaces, so `--grep-invert "on a phone a long message"` ran as `--grep-invert on` plus file filters and a Playwright
// run silently skipped about 70 tests (2026-10-28). The quoting lives in scripts/lib/shell-command.mjs.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commandLine } from '../../scripts/lib/shell-command.mjs';
import { ROOT } from './helpers';

describe('commandLine (sh)', () => {
  it('leaves plain arguments alone', () => {
    expect(commandLine(['npx', 'playwright', 'test', '--grep-invert=phone.a.long', 'tests/e2e/admin.spec.ts'], 'linux')).toBe(
      'npx playwright test --grep-invert=phone.a.long tests/e2e/admin.spec.ts',
    );
  });

  it('single-quotes arguments with spaces, quotes and shell characters', () => {
    expect(commandLine(['echo', 'on a phone', `it's`, '$HOME', 'a&b', ''], 'linux')).toBe(`echo 'on a phone' 'it'\\''s' '$HOME' 'a&b' ''`);
  });
});

describe('commandLine (cmd.exe)', () => {
  it('leaves plain arguments and Windows paths alone', () => {
    expect(commandLine(['npm', 'run', 'check:js-budget', 'tests\\e2e\\admin.spec.ts'], 'win32')).toBe('npm run check:js-budget tests\\e2e\\admin.spec.ts');
  });

  it('double-quotes arguments with spaces, escapes inner quotes and doubles backslashes only where the Windows rules need it', () => {
    expect(commandLine(['npx', '-g', 'on a phone', 'say "hi"', 'C:\\a b\\', 'a\\"b', ''], 'win32')).toBe(
      'npx -g "on a phone" "say \\"hi\\"" "C:\\a b\\\\" "a\\\\\\"b" ""',
    );
  });

  it('quotes cmd.exe operators so they stay text', () => {
    expect(commandLine(['echo', 'a&b|c<d>e^f'], 'win32')).toBe('echo "a&b|c<d>e^f"');
  });

  it('refuses what cmd.exe cannot pass through unchanged, instead of changing it silently', () => {
    expect(() => commandLine(['echo', '100%'], 'win32')).toThrow(/%/);
    expect(() => commandLine(['echo', 'say "a&b"'], 'win32')).toThrow(/double quote/);
  });
});

describe('commandLine (both)', () => {
  it('refuses line breaks and an empty command', () => {
    expect(() => commandLine(['echo', 'a\nb'], 'linux')).toThrow(/line break/);
    expect(() => commandLine(['echo', 'a\r\nb'], 'win32')).toThrow(/line break/);
    expect(() => commandLine([], 'linux')).toThrow(/no command/);
  });
});

describe('with-lock.mjs on this machine', () => {
  const LOCK = 'zz-test-with-lock';
  const run = (args: string[]) => spawnSync(process.execPath, ['scripts/with-lock.mjs', LOCK, '--', ...args], { cwd: ROOT, encoding: 'utf8' });

  it('hands every argument to the command exactly as given', () => {
    const args = ['on a phone a long message', 'say "hi"', 'C:\\a b\\', 'e\\f', '', 'x=1 2', 'a&b|c'];
    const r = run([process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args]);
    expect(r.stderr).not.toContain('DEP0190');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(args);
    expect(existsSync(join(ROOT, 'tmp', 'locks', `${LOCK}.lock`)), 'the lock is released').toBe(false);
  });

  it('passes the exit code through', () => {
    expect(run([process.execPath, '-e', 'process.exit(7)']).status).toBe(7);
  });

  it.runIf(process.platform === 'win32')('stops with exit code 2 before taking the lock when an argument cannot pass cmd.exe safely', () => {
    const r = run([process.execPath, '-e', '0', '100%']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('with-lock: cannot pass');
    expect(existsSync(join(ROOT, 'tmp', 'locks', `${LOCK}.lock`))).toBe(false);
  });
});
