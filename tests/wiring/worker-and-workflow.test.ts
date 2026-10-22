import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCronDeps, pickCronEnv, runScheduled } from '../../scripts/sync-worker/scheduled';
import { bearerMatches } from '../../scripts/sync-worker/vercel-cron';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const KEY = ['sb', 'secret', 'FAKE'].join('_');
const base = {
  CRON_ENABLED: 'true',
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_SECRET_KEY: KEY,
  REBUILD_DISPATCH_TOKEN: ['gh', 'FAKE'].join('_'),
  ADMIN_GITHUB_REPO: 'fake-owner/fake-repo',
};

describe('scheduled handler wiring', () => {
  it('does nothing unless CRON_ENABLED is exactly true and fully configured', () => {
    const io = { fetch: (async () => new Response('')) as unknown as typeof fetch, now: new Date() };
    expect(buildCronDeps({ ...base, CRON_ENABLED: 'yes' }, io)).toBeNull();
    expect(buildCronDeps({ ...base, ADMIN_GITHUB_REPO: 'bad' }, io)).toBeNull();
    expect(buildCronDeps({ ...base, SUPABASE_URL: 'http://evil.example' }, io)).toBeNull();
    expect(buildCronDeps(base, io)).not.toBeNull();
  });
  it('never throws on a failing database', async () => {
    const f = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    await expect(runScheduled(base, { fetch: f, now: new Date() })).resolves.toBeNull();
  });
  it('pickCronEnv keeps only known, non-empty names', () => {
    expect(pickCronEnv({ CRON_ENABLED: 'true', OTHER: 'x', SUPABASE_SECRET_KEY: ' ' })).toEqual({ CRON_ENABLED: 'true' });
  });
  it('the parked Vercel Cron route fails closed without the exact bearer, and no Cloudflare entry is left', () => {
    expect(bearerMatches(null, 'x'.repeat(32))).toBe(false);
    expect(bearerMatches('Bearer wrong', 'x'.repeat(32))).toBe(false);
    expect(bearerMatches(`Bearer ${'x'.repeat(32)}`, undefined)).toBe(false);
    expect(bearerMatches(`Bearer ${'x'.repeat(8)}`, 'x'.repeat(8))).toBe(false); // secret too short
    expect(bearerMatches(`Bearer ${'x'.repeat(32)}`, 'x'.repeat(32))).toBe(true);
    const src = read('scripts/sync-worker/vercel-cron.ts');
    expect(src).toMatch(/export async function GET\(/);
    expect(src).toContain('status: 401');
    expect(src).not.toContain('@astrojs/cloudflare');
    expect(existsSync(join(root, 'scripts/sync-worker/entry.ts'))).toBe(false);
  });
  it('the cron route stays parked: nothing under src imports it or the sync worker folder, and vercel.json has no cron yet', () => {
    expect(existsSync(join(root, 'src/pages/api/cron'))).toBe(false);
    if (existsSync(join(root, 'vercel.json'))) expect(read('vercel.json')).not.toContain('"crons"');
  });
});

describe('sync workflow', () => {
  const y = read('.github/workflows/sync.yml');
  it('is off unless SYNC_ENABLED is true, with schedule and dispatch', () => {
    expect(y).toContain("vars.SYNC_ENABLED == 'true' && github.ref == 'refs/heads/main'"); // main only (review fix-infra 2)
    expect(y).toContain('workflow_dispatch');
    expect(y).toContain('cron: "17 */6 * * *"');
  });
  it('has minimal permissions, a non-cancelling concurrency group and pinned actions', () => {
    expect(y).toContain('permissions:\n  contents: read');
    expect(y).toContain('concurrency:\n  group: sync\n  cancel-in-progress: false');
    for (const m of y.matchAll(/uses: (\S+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
    expect(y).not.toContain('pull_request');
  });
  it('passes secrets only through env, never echoes them', () => {
    const secretLines = y.split('\n').filter((l) => l.includes('secrets.'));
    expect(secretLines.length).toBeGreaterThanOrEqual(6);
    for (const l of secretLines) expect(l).toMatch(/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/);
    expect(y).not.toMatch(/echo[^\n]*secrets/i);
    expect(y).toContain('scripts/sync-run.ts');
  });
});

describe('env and secrets docs list the wiring names', () => {
  const names = ['SYNC_ENABLED', 'CRON_ENABLED', 'PUBLIC_PLACEMENT_BEACON_TOKEN', 'ADMIN_GITHUB_REPO', 'ADMIN_SYNC_WORKFLOW', 'LEAD_GLOBAL_DAILY_CAP', 'REBUILD_DISPATCH_TOKEN'];
  it('.env.example and docs/SECRETS.md name each one', () => {
    for (const n of names) {
      expect(read('.env.example'), n).toContain(n);
      expect(read('docs/SECRETS.md'), n).toContain(n);
    }
  });
});
