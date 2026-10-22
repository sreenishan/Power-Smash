#!/usr/bin/env node
// G0: count files and bytes in a build output directory and compare with the Workers Free limit
// of 20,000 static assets per version (D-009 warns at 10,000 and fails above 14,000).
// Usage: node scripts/g0-count.mjs [dir ...]   (default: .vercel/output/static and .vercel/output/functions)
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 20_000;

// Wrangler's asset manifest skips these (they configure the asset server; they are not uploaded as assets).
const NOT_UPLOADED = new Set([]);

function walk(dir, acc = { files: 0, dirs: 0, uploaded: 0, bytes: 0, byExt: {} }, top = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      acc.dirs += 1;
      walk(p, acc, top);
    } else {
      acc.files += 1;
      if (!(dir === top && NOT_UPLOADED.has(entry.name))) acc.uploaded += 1;
      acc.bytes += statSync(p).size;
      const ext = path.extname(entry.name).toLowerCase() || '(none)';
      acc.byExt[ext] = (acc.byExt[ext] ?? 0) + 1;
    }
  }
  return acc;
}

const dirs = process.argv.slice(2);
if (!dirs.length) dirs.push('.vercel/output/static', '.vercel/output/functions');
const out = [];
for (const d of dirs) {
  const abs = path.resolve(root, d);
  try {
    const r = walk(abs);
    out.push({
      dir: d,
      files: r.files,
      directories: r.dirs,
      // wrangler prints "Read N files" with N = files + directories (readdir recursive); the asset
      // manifest that counts against the 20,000 limit holds files only, minus the config files.
      wranglerReadN: r.files + r.dirs,
      assetsUploadedEstimate: r.uploaded,
      totalMB: Number((r.bytes / 1048576).toFixed(2)),
      shareOfFreeLimit: `${((r.uploaded / LIMIT) * 100).toFixed(1)}% of ${LIMIT} (uploaded assets)`,
      byExt: r.byExt,
    });
  } catch (e) {
    out.push({ dir: d, error: e.code ?? String(e) });
  }
}
console.log(JSON.stringify(out, null, 2));
