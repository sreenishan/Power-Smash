// True when the module was started directly (`node scripts/x.mjs`), false when a test imports it.
// Plain JavaScript on purpose: the owner-run helper scripts must not depend on TypeScript stripping.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
    return norm(fileURLToPath(metaUrl)) === norm(entry);
  } catch {
    return false;
  }
}
