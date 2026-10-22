import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// G0 trivial test: proves Vitest runs (plain Node, no adapter plugin) on this machine.
describe('G0 smoke', () => {
  it('runs in plain Node', () => {
    expect(1 + 1).toBe(2);
    expect(Number.parseInt(process.versions.node.split('.')[0], 10)).toBeGreaterThanOrEqual(22);
  });

  it('pins TypeScript 6.0.3 (D-002)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.devDependencies.typescript).toBe('6.0.3');
  });

  it('uses the Vercel adapter and has no Cloudflare config left (Vercel port)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies['@astrojs/vercel']).toBeTruthy();
    expect(existsSync(new URL('../wrangler.jsonc', import.meta.url))).toBe(false);
  });
});
