// Shared helpers for the infra tests. Not a test file. Fake values only: anything secret-shaped is BUILT AT RUN TIME so that no
// secret-looking literal is committed (gitleaks would flag it; see .gitleaks.toml).
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const FIXTURES = join(ROOT, 'tests', 'infra', 'fixtures');

const made: string[] = [];

/** A fresh temp folder. Call cleanupTemp() in afterEach. */
export function tempDir(prefix = 'ps-infra-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

export function cleanupTemp(): void {
  while (made.length > 0) rmSync(made.pop() as string, { recursive: true, force: true });
}

/** A temp folder holding the given files (relative path to content). */
export function makeDist(files: Record<string, string | Buffer>): string {
  const root = tempDir();
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/** A temp copy of a committed fixture site, so a test may add files to it. */
export function copyFixture(name: string): string {
  const root = tempDir();
  cpSync(join(FIXTURES, name), root, { recursive: true });
  return root;
}

export const page = (body: string, head = ''): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title><meta name="robots" content="noindex">${head}</head><body>${body}</body></html>`;

// ---- secret-shaped strings, assembled at run time ---------------------------------------------------------------------
const rep = (c: string, n: number): string => c.repeat(n);
export const fakeSupabaseSecret = (): string => ['sb', 'secret', rep('x', 4) + rep('Q', 20)].join('_');
export const fakeJwt = (): string => [`eyJ${rep('a', 24)}`, `eyJ${rep('b', 24)}`, rep('c', 30)].join('.');
export const fakeTelegramToken = (): string => `${rep('1', 9)}:${rep('A', 35)}`;
export const fakeGoogleKey = (): string => `AIza${rep('z', 35)}`;
export const fakeAgePrivateKey = (): string => `AGE-SECRET-KEY-1${rep('Q', 58)}`;
export const fakeAgePublicKey = (): string => `age1${rep('q', 58)}`;

/** Run a TypeScript script the way the npm scripts do (Node strips the types). */
export function runScript(script: string, args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
