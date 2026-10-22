// FIX 4 (security review): Astro's `/_image` endpoint (sharp) is a public, CPU-bound route the CDN caches for a year, and the site does
// not use image optimisation. astro.config.mjs replaces it with an endpoint that answers 404. This guards the three facts that make
// that safe: the replacement answers 404, the config points at a file that exists, and nothing in src/ uses `astro:assets`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as endpoint from '../../src/lib/infra/image-endpoint-disabled';

const ROOT = process.cwd();

describe('the disabled image endpoint', () => {
  const call = (method: string) => endpoint.ALL({ request: new Request(`https://powersmash.example/_image?href=%2Fx.png&w=100&f=webp`, { method }) } as never) as Response;

  it('answers 404, uncached and noindex, for every method', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']) {
      const res = call(method);
      expect(res.status, method).toBe(404);
      expect(res.headers.get('cache-control'), method).toBe('no-store');
      expect(res.headers.get('x-robots-tag'), method).toContain('noindex');
    }
  });

  it('is on-demand and runs no image code', () => {
    expect(endpoint.prerender).toBe(false);
    const code = readFileSync(join(ROOT, 'src/lib/infra/image-endpoint-disabled.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/sharp|astro:assets|loadImage|transform/);
  });
});

describe('astro.config.mjs wires it in', () => {
  const config = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');

  it('sets image.endpoint.entrypoint to the disabled endpoint, a file that exists', () => {
    const block = /image:\s*\{[^}]*?endpoint:\s*\{([^}]*)\}/.exec(config);
    expect(block, 'image.endpoint block').not.toBeNull();
    const entry = /entrypoint:\s*'([^']+)'/.exec(block?.[1] ?? '');
    expect(entry?.[1]).toBe('./src/lib/infra/image-endpoint-disabled.ts');
    expect(existsSync(join(ROOT, entry?.[1] ?? 'missing'))).toBe(true);
    expect(/route:\s*'([^']+)'/.exec(block?.[1] ?? '')?.[1]).toBe('/_image'); // Astro's default route, written out for the config type
  });

  it('keeps the Vercel adapter image service off', () => {
    expect(config).toMatch(/imageService:\s*false/);
  });
});

describe('nothing in src/ uses Astro image optimisation (so a 404 on /_image breaks nothing)', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }
  const files = walk(join(ROOT, 'src')).filter((p) => /\.(ts|tsx|astro|mdx?|css|js|mjs)$/.test(p));

  it('no file imports astro:assets, uses <Image>, <Picture>, getImage or links /_image', () => {
    const offenders = files
      .filter((f) => !f.endsWith('image-endpoint-disabled.ts'))
      .filter((f) => /astro:assets|<Image[\s/>]|<Picture[\s/>]|\bgetImage\s*\(|\/_image\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split('\\').join('/'));
    expect(offenders).toEqual([]);
  });
});
