// Screenshots for docs/OWNER_GUIDE.md (M4 docs). Fictional data ONLY: it serves the ALREADY BUILT site (.vercel/output/static, built from the
// fictional seed and the admin preview store) on localhost, takes phone-size pictures with Chromium and writes docs/guide/*.png.
//
// Run (the project path has a space: quote it; heavy commands share one lock):
//   node scripts/with-lock.mjs heavy -- npm run build        (once, or whenever the pages changed)
//   node scripts/with-lock.mjs heavy -- node scripts/guide-shots.mjs
//
// Safety rules kept by this script:
//  - only http://localhost:<port> is ever requested (anything else is aborted and reported),
//  - it refuses to run when the build was made with real values (a Supabase address or a WhatsApp number inside .vercel/output/static),
//  - no trace, video or HAR is recorded, nothing is typed into any form (forms are only photographed empty),
//  - the preview server is started here and always stopped here (never left running).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
import { STATIC_DIR } from './lib/output-paths.mjs';
const DIST = join(ROOT, STATIC_DIR);
const OUT = join(ROOT, 'docs', 'guide');
const PORT = 4398;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

/** Each shot: file name (no extension), path or admin hash, what it shows, and whether to capture the whole page. */
const SHOTS = [
  { file: 'admin-dashboard', url: '/admin/#/dashboard', admin: true },
  { file: 'admin-enquiries', url: '/admin/#/inbox', admin: true },
  { file: 'admin-videos', url: '/admin/#/videos', admin: true },
  { file: 'admin-players', url: '/admin/#/players', admin: true },
  { file: 'admin-tournaments', url: '/admin/#/tournaments', admin: true },
  { file: 'admin-sponsors', url: '/admin/#/sponsors', admin: true },
  { file: 'admin-prices', url: '/admin/#/prices', admin: true },
  { file: 'admin-posters', url: '/admin/#/posters', admin: true },
  { file: 'admin-settings', url: '/admin/#/settings', admin: true },
  { file: 'admin-more', url: '/admin/#/more', admin: true },
  { file: 'admin-submissions', url: '/admin/#/submissions', admin: true },
  {
    file: 'admin-record-payment',
    url: '/admin/#/inbox',
    admin: true,
    // opens the form only; nothing is typed, so the empty fields show that the site fills in no amount
    act: async (page) => {
      const card = page.getByRole('article', { name: 'Enquiry PS-2026-DEMK01' });
      await card.getByRole('button', { name: 'Record payment' }).click();
      await page.getByRole('form', { name: /Record a payment/ }).scrollIntoViewIfNeeded();
    },
  },
  {
    file: 'admin-title-check',
    url: '/admin/#/videos',
    admin: true,
    // an invented title with a bracketed age, to show the under-18 warning
    act: async (page) => {
      await page.getByRole('tab', { name: 'Title check' }).click();
      await page.getByLabel('Planned YouTube title').fill('Demo Arul vs Sample Bala (U15) || MS Final || Demo Cup 2026');
      await page.getByRole('alert').filter({ hasText: /under 18/ }).waitFor();
    },
  },
  { file: 'poster-channel', url: '/posters/channel/', full: true },
  { file: 'form-book', url: '/book/' },
  { file: 'form-contact', url: '/contact/' },
  { file: 'form-request', url: '/request/' },
  { file: 'form-submit-video', url: '/submit-video/' },
  { file: 'form-tournament-submit', url: '/tournaments/submit/' },
  { file: 'page-content-removal', url: '/content-removal/' },
  { file: 'archive-matches', url: '/matches/' },
  { file: 'archive-players', url: '/players/' },
];

// 910000000000 (91 followed by zeros) is the project's fictional test number (CLAUDE.md); any other long number is treated as real.
function realWaNumber(text) {
  for (const m of text.matchAll(/wa\.me\/(\d{10,})/g)) if (!/^910+$/.test(m[1])) return true;
  return false;
}

function assertFictionalBuild() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('.vercel/output/static is missing: run `node scripts/with-lock.mjs heavy -- npm run build` first.');
  }
  // A real build holds a Supabase project address or a wa.me number. Refuse rather than photograph real data.
  const stack = [DIST];
  const bad = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (/\.(html|js|json|css)$/.test(name)) {
        const text = readFileSync(p, 'utf8');
        if (/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text) || realWaNumber(text)) bad.push(p);
      }
    }
  }
  if (bad.length) throw new Error(`The build in .vercel/output/static looks like a REAL build (Supabase address or WhatsApp number found in ${bad[0]}). Rebuild with \`npm run build\` and no real PUBLIC_* values.`);
}

async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview server did not start');
}

function stopServer(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function main() {
  assertFictionalBuild();
  mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, ['scripts/serve-output.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  const foreign = [];
  try {
    await waitForServer(`${BASE}/`, 120_000);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      foreign.push(u);
      return route.abort();
    });
    const page = await ctx.newPage();
    const done = [];
    const skipped = [];
    for (const shot of SHOTS) {
      // a hash-only change is not a navigation (no response object): load the admin once, then switch screens through the hash
      const sameAdminPage = shot.admin && page.url().startsWith(`${BASE}/admin/`);
      let res = null;
      if (sameAdminPage) {
        await page.evaluate((h) => { location.hash = h; }, shot.url.slice(shot.url.indexOf('#')));
      } else {
        res = await page.goto(BASE + shot.url, { waitUntil: 'load' });
        if (!res || res.status() >= 400) {
          skipped.push(`${shot.file} (HTTP ${res ? res.status() : 'none'})`);
          continue;
        }
      }
      if (shot.admin) {
        // the admin is a lazy React app: wait for the preview banner and the screen heading, then for the lazy chunk to settle
        await page.getByRole('status').filter({ hasText: 'Preview with made-up data' }).waitFor({ timeout: 20_000 });
        await page.waitForLoadState('networkidle');
      } else {
        await page.waitForLoadState('networkidle');
      }
      if (shot.act) await shot.act(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${shot.file}.png`), fullPage: shot.full === true, animations: 'disabled' });
      done.push(shot.file);
    }
    console.log(`guide-shots: wrote ${done.length} pictures to docs/guide/`);
    if (skipped.length) console.log(`guide-shots: skipped (page not in this build): ${skipped.join(', ')}`);
    if (foreign.length) {
      console.error(`guide-shots: a page asked for a non-local address (blocked): ${[...new Set(foreign)].join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    stopServer(server);
  }
}

main().catch((e) => {
  console.error(`guide-shots: ${e.message}`);
  process.exit(1);
});
