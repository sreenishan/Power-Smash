import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEnv, checkMigrations, checkSwitches, checkEnvIgnored, checkOnline, runPreflight } from '../../scripts/connect-preflight.mjs';

type R = { level: string; name: string; detail: string };
const REF = 'abcdefghijklmnopqrst';
const GOOD = {
  PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: ['sb', 'publishable', 'FAKEFAKE'].join('_'),
  YOUTUBE_API_KEY: 'AIza' + 'x'.repeat(35),
  YOUTUBE_CHANNEL_ID: 'UC' + 'a'.repeat(22),
};
const level = (r: R[], n: string) => r.find((x) => x.name === n)?.level;

function tree(opts: { migs: string[]; checks: string[]; ignore?: string; archive?: string }) {
  const root = mkdtempSync(join(tmpdir(), 'connect-'));
  mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
  mkdirSync(join(root, 'supabase', 'checks'), { recursive: true });
  mkdirSync(join(root, 'src', 'content', 'legal'), { recursive: true });
  for (const m of opts.migs) writeFileSync(join(root, 'supabase', 'migrations', m), '');
  for (const c of opts.checks) writeFileSync(join(root, 'supabase', 'checks', c), '');
  writeFileSync(join(root, '.gitignore'), opts.ignore ?? '.env\n.env.*\n');
  writeFileSync(join(root, 'src', 'content', 'legal', 'status.ts'), `x = {\n  archivePages: ${opts.archive ?? 'false'},\n}`);
  return root;
}

describe('env shape checks', () => {
  it('accepts good shapes and never echoes values', () => {
    const r: R[] = checkEnv(GOOD);
    expect(level(r, 'env PUBLIC_SUPABASE_URL')).toBe('OK');
    expect(level(r, 'env YOUTUBE_API_KEY')).toBe('OK');
    expect(JSON.stringify(r)).not.toContain('FAKEFAKE');
    expect(JSON.stringify(r)).not.toContain(REF);
  });
  it('flags bad shapes without echoing', () => {
    const r: R[] = checkEnv({ ...GOOD, PUBLIC_SUPABASE_URL: 'http://evil.example', PUBLIC_SUPABASE_PUBLISHABLE_KEY: ['sb', 'secret', 'FAKE'].join('_') });
    expect(level(r, 'env PUBLIC_SUPABASE_URL')).toBe('FAIL');
    expect(level(r, 'env PUBLIC_SUPABASE_PUBLISHABLE_KEY')).toBe('FAIL');
    expect(JSON.stringify(r)).not.toContain('evil.example');
  });
  it('warns when unset and flags a ref mismatch', () => {
    expect(level(checkEnv({}), 'env YOUTUBE_API_KEY')).toBe('WARN');
    expect(level(checkEnv({ ...GOOD, SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz' }), 'project ref matches URL')).toBe('FAIL');
  });
});

describe('migrations and checks', () => {
  it('passes a contiguous set with checks', () => {
    const r: R[] = checkMigrations(tree({ migs: ['0001_a.sql', '0002_b.sql'], checks: ['0001_assertions.sql', '0002_assertions.sql'] }));
    expect(r.every((x) => x.level === 'OK')).toBe(true);
  });
  it('fails on a gap and on a missing check', () => {
    const r: R[] = checkMigrations(tree({ migs: ['0001_a.sql', '0003_c.sql'], checks: ['0001_assertions.sql'] }));
    expect(level(r, 'migrations contiguous')).toBe('FAIL');
    expect(level(r, 'checks exist')).toBe('FAIL');
  });
  it('passes on the real repo', () => {
    const r: R[] = checkMigrations(process.cwd());
    expect(level(r, 'migrations contiguous')).toBe('OK');
    expect(level(r, 'checks exist')).toBe('OK');
  });
});

describe('switches and .env ignore', () => {
  it('flags archivePages on and true switches', () => {
    expect(level(checkSwitches(tree({ migs: [], checks: [], archive: 'true' }), {}), 'archivePages flag')).toBe('FAIL');
    expect(level(checkSwitches(tree({ migs: [], checks: [] }), { SYNC_ENABLED: 'true' }), 'switch SYNC_ENABLED')).toBe('FAIL');
    expect(level(checkSwitches(tree({ migs: [], checks: [] }), {}), 'archivePages flag')).toBe('OK');
  });
  it('real repo: archivePages off and .env ignored', () => {
    expect(level(checkSwitches(process.cwd(), {}), 'archivePages flag')).toBe('OK');
    expect(level(checkEnvIgnored(process.cwd()), '.env git-ignored')).toBe('OK');
  });
  it('detects a missing .env ignore', () => {
    expect(level(checkEnvIgnored(tree({ migs: [], checks: [], ignore: 'dist\n' })), '.env git-ignored')).toBe('FAIL');
  });
});

describe('online mode (mocked fetch)', () => {
  it('offline by default: fetch is never called', async () => {
    const f = vi.fn();
    await runPreflight({ root: tree({ migs: ['0001_a.sql'], checks: ['0001_assertions.sql'] }), env: GOOD, fetchFn: f });
    expect(f).not.toHaveBeenCalled();
  });
  it('uses GET only and never logs the key', async () => {
    const f = vi.fn(async (_u: string, _o: { method: string }) => ({ status: 200 }));
    const r: R[] = await checkOnline(GOOD, f);
    expect(f).toHaveBeenCalledTimes(2);
    for (const c of f.mock.calls) expect(c[1].method).toBe('GET');
    expect(level(r, 'online YouTube API')).toBe('OK');
    expect(JSON.stringify(r)).not.toContain(GOOD.YOUTUBE_API_KEY);
  });
  it('skips when unset, fails on 403 and on network error', async () => {
    const f = vi.fn();
    const s: R[] = await checkOnline({}, f);
    expect(f).not.toHaveBeenCalled();
    expect(s.every((x) => x.level === 'SKIP')).toBe(true);
    expect(level(await checkOnline(GOOD, vi.fn(async () => ({ status: 403 }))), 'online YouTube API')).toBe('FAIL');
    const net: R[] = await checkOnline(GOOD, vi.fn(async () => { throw new Error('boom ' + GOOD.YOUTUBE_API_KEY); }));
    expect(level(net, 'online YouTube API')).toBe('FAIL');
    expect(JSON.stringify(net)).not.toContain(GOOD.YOUTUBE_API_KEY);
  });
});
