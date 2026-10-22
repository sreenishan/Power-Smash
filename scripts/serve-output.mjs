// Tiny static server for the BUILT site (Vercel port, area D): `node scripts/serve-output.mjs [--port 4399] [--dir <static folder>]`.
// Why: `astro preview` is not supported by the Vercel adapter (it prints a warning and cannot serve .vercel/output), and there is no
// static-server dependency. This serves .vercel/output/static the way Vercel does for prerendered pages: `/x/` -> `x/index.html`,
// `/x` -> `x/index.html`, a missing path -> `404.html` with status 404 (what the 404 page would be), and it applies the HEADER and
// REDIRECT routes finalize-headers wrote into config.json (so the real CSP is enforced in the browser tests). Routes with a host
// condition are skipped (localhost is never a preview host). On-demand routes (/api/*, /go/*) are NOT served: the browser tests stub
// them, and an unstubbed call returns 404. Never left running: Playwright starts and stops it.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { CONFIG_PATH, STATIC_DIR } from './lib/output-paths.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const port = Number(arg('--port', '4399'));
const root = resolve(arg('--dir', STATIC_DIR));
const configPath = resolve(arg('--config', CONFIG_PATH));

if (!existsSync(join(root, 'index.html'))) {
  console.error(`serve-output: ${root} has no index.html. Run \`npm run build\` first.`);
  process.exit(2);
}

const routes = [];
if (existsSync(configPath)) {
  try {
    for (const r of JSON.parse(readFileSync(configPath, 'utf8')).routes ?? []) {
      if (!r.src || r.has || r.missing) continue;
      routes.push({ re: new RegExp(r.src), headers: r.headers ?? {}, cont: r.continue === true, status: r.status });
    }
  } catch {
    console.error('serve-output: config.json is not valid JSON; serving without header rules.');
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ics': 'text/calendar; charset=utf-8',
};

const fileFor = (pathname) => {
  let rel = normalize(decodeURIComponent(pathname)).split(String.fromCharCode(92)).join('/');
  while (rel.startsWith('/')) rel = rel.slice(1);
  const abs = join(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  const tries = extname(rel) ? [abs] : [join(abs, 'index.html'), `${abs}.html`];
  for (const t of tries) if (existsSync(t) && statSync(t).isFile()) return t;
  return null;
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const extra = {};
  for (const r of routes) {
    if (!r.re.test(url.pathname)) continue;
    Object.assign(extra, r.headers);
    if (!r.cont && r.status && r.headers.Location) {
      res.writeHead(r.status, extra);
      res.end();
      return;
    }
  }
  let file;
  try {
    file = fileFor(url.pathname);
  } catch {
    file = null;
  }
  let status = 200;
  if (!file) {
    status = 404;
    file = join(root, '404.html');
    if (!existsSync(file)) {
      res.writeHead(404, extra);
      res.end('Not found');
      return;
    }
  }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', ...extra });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serve-output: ${root} on http://localhost:${port}/`));
