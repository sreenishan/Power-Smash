// Static guards for the admin: no admin code or link in public pages, no raw HTML injection, noindex shell, no secrets or real data.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');
const read = (p: string) => readFileSync(p, 'utf8');
const src = walk(join(ROOT, 'src')).filter((p) => /\.(ts|tsx|astro)$/.test(p));

const isAdminFile = (r: string) => r.startsWith('src/admin/') || r.startsWith('src/lib/admin/') || r.startsWith('src/lib/identity/') || r.startsWith('src/pages/admin/') || r.startsWith('src/pages/api/admin/');

describe('admin isolation', () => {
  it('no public file imports admin or identity code (keeps admin JS out of public pages)', () => {
    const offenders = src
      // src/lib/sync is the server-side sync (Worker/CI only, never in a page) and uses the pure identity rules and its own ./identity module
      .filter((p) => !isAdminFile(rel(p)) && !rel(p).startsWith('src/lib/sync/'))
      .filter((p) => /from\s+['"][^'"]*\/(admin|identity)(\/|['"])/.test(read(p)) || /import\(['"][^'"]*\/admin\//.test(read(p)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
  it('no public page, component or layout links to /admin', () => {
    const offenders = src.filter((p) => !isAdminFile(rel(p)) && /['"`(]\/admin\b/.test(read(p)) && !rel(p).startsWith('src/lib/infra/') && !rel(p).includes('.test.')).map(rel);
    expect(offenders).toEqual([]);
  });
  it('the admin shell is noindex, uses no public layout or analytics and links nowhere public', () => {
    const page = read(join(ROOT, 'src/pages/admin/index.astro'));
    expect(page).toMatch(/name="robots" content="noindex, nofollow/);
    expect(page).not.toMatch(/^import .*(BaseLayout|Analytics|SiteHeader|SiteFooter|JsonLd)/m);
    expect(page).not.toMatch(/href="\//);
    expect(page).toMatch(/client:only="react"/);
  });
  it('the admin API route is on-demand', () => {
    expect(read(join(ROOT, 'src/pages/api/admin/[action].ts'))).toMatch(/export const prerender = false/);
  });
  it('no raw HTML injection and no browser storage of tokens in admin code', () => {
    for (const p of src.filter((x) => isAdminFile(rel(x)))) {
      const t = read(p);
      expect(t, rel(p)).not.toMatch(/dangerouslySetInnerHTML|set:html|innerHTML\s*=/);
      expect(t, rel(p)).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
  });
  it('the admin app is loaded lazily from the island', () => {
    expect(read(join(ROOT, 'src/admin/AdminLoader.tsx'))).toMatch(/lazy\(\(\) => import\('\.\/AdminApp'\)\)/);
  });
  it('no secret-shaped values, real-looking phone numbers or emails in admin sources', () => {
    for (const p of src.filter((x) => isAdminFile(rel(x)))) {
      const t = read(p);
      expect(t, rel(p)).not.toMatch(/sb_secret_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}\./);
      expect(t, rel(p)).not.toMatch(/(?<![\w-])[6-9]\d{9}(?![\w-])/);
      expect(t, rel(p)).not.toMatch(/[\w.+-]+@(?!example)[\w-]+\.(com|in|org)/);
    }
  });
  it('the service key is only read from server modules', () => {
    for (const p of src.filter((x) => rel(x).startsWith('src/admin/'))) expect(read(p), rel(p)).not.toMatch(/SECRET_KEY|REBUILD_DISPATCH_TOKEN|secretKey/);
  });
  it('every admin area is its own lazy chunk (admin JS budget) and has a screen file', async () => {
    const { ROUTES_ADMIN } = await import('../../src/admin/messages');
    const app = read(join(ROOT, 'src/admin/AdminApp.tsx'));
    for (const r of ROUTES_ADMIN) {
      const m = new RegExp(`${r}: lazy\\(\\(\\) => import\\('\\./screens/(\\w+)'\\)`).exec(app);
      expect(m, `route ${r} is not lazy-loaded`).not.toBeNull();
      expect(statSync(join(ROOT, `src/admin/screens/${m![1]}.tsx`)).isFile()).toBe(true);
    }
    expect(app).not.toMatch(/^import .* from '\.\/screens\//m);
  });
  it('the owner phone tasks of DoD 5 each have an area: submissions, enquiries, placements, prices, posters', async () => {
    const { ROUTES_ADMIN } = await import('../../src/admin/messages');
    for (const r of ['tournaments', 'inbox', 'sponsors', 'prices', 'posters']) expect(ROUTES_ADMIN).toContain(r);
  });
});
