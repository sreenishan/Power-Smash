// Shared helpers for the build-output gates (check-placeholders, privacy-scan, check-release, finalize-headers).
// Plain Node, no dependencies. Run by Node 24 type stripping (`node scripts/x.ts`), so this file must stay
// type-annotation-only: no enums, no namespaces, no parameter properties, and `import type` for types.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DistFile {
  /** Absolute path. */
  abs: string;
  /** Path relative to the scanned folder, always with forward slashes (for example `brand/og-default.svg`). */
  rel: string;
  /** Lower-case extension with the dot, or an empty string (`_headers`, `_redirects`). */
  ext: string;
  size: number;
}

/** Extensions that are never text. A planted marker inside one of these is intentionally not scanned. */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.heic',
  '.pdf', '.zip', '.gz', '.br', '.tgz', '.7z',
  '.mp3', '.mp4', '.webm', '.mov', '.ogg', '.wav',
  '.wasm', '.bin', '.dat',
]);

/** Extensions read as text without the NUL-byte sniff. Everything else is sniffed. */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json', '.txt', '.xml', '.svg',
  '.webmanifest', '.ics', '.md', '.map', '.csv', '.rss', '.atom', '.vtt', '.yaml', '.yml', '.toml',
]);

/** Every regular file below `root`, sorted by relative path. Symbolic links are not followed. */
export function listFiles(root: string): DistFile[] {
  const out: DistFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        out.push({ abs, rel, ext: extname(entry.name).toLowerCase(), size: lstatSync(abs).size });
      }
    }
  };
  walk(root, '');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** The file as text, or `null` for a binary file (known binary extension, or a NUL byte in the first 8 KB). */
export function readText(file: DistFile): string | null {
  if (BINARY_EXTENSIONS.has(file.ext)) return null;
  const buf = readFileSync(file.abs);
  if (!TEXT_EXTENSIONS.has(file.ext)) {
    const head = buf.subarray(0, 8000);
    if (head.includes(0)) return null;
  }
  return buf.toString('utf8');
}

/** Line start offsets of a text, for turning a match index into a line and column. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 1-based line and column of `index`. `starts` comes from `lineStarts(text)`. */
export function positionOf(starts: number[], index: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - (starts[lo] as number) + 1 };
}

/** Shortened single-line excerpt around a match, for log output (never longer than `max` characters). */
export function excerptAt(text: string, index: number, length: number, max = 100): string {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  let lineEnd = text.indexOf('\n', index + length);
  if (lineEnd === -1) lineEnd = text.length;
  let from = lineStart;
  let to = lineEnd;
  if (to - from > max) {
    from = Math.max(lineStart, index - Math.floor((max - length) / 2));
    to = Math.min(lineEnd, from + max);
  }
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

/** True when this script file was started directly by Node (`node scripts/x.ts`), false when imported by a test. */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const norm = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
    return norm(fileURLToPath(metaUrl)) === norm(entry);
  } catch {
    return false;
  }
}

/** The value of `--name value` or `--name=value` in an argument list, or null. */
export function argValue(args: readonly string[], name: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === name) return args[i + 1] ?? null;
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

/** Strict mode: `--strict` flag or PS_STRICT=1 (the release workflow sets it). `--no-strict` forces it off. */
export function isStrict(args: readonly string[], env: Record<string, string | undefined>): boolean {
  if (args.includes('--no-strict')) return false;
  return args.includes('--strict') || env.PS_STRICT === '1';
}
