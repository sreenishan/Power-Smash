// Placeholder gate (BUILD_PLAN M1 item 7, D-034). Scans the built public output (the static output (.vercel/output/static) by default) for the owner-input
// marker and fails the strict release build on any hit.
//
// What counts as the marker (review findings B-17, C-5): `TODO(owner)` in any letter case, with spaces allowed around the word and the
// brackets, written plainly OR hidden by HTML entities (`TODO&#40;owner&#41;`), percent-encoding, JavaScript or JSON escapes
// (a backslash-u escape for each bracket), full-width letters and brackets, zero-width characters or markup inside it (`TODO(<b>owner</b>)`).
// Each file is read three ways (raw, decoded, decoded with the markup removed); a line counts as many times as the most revealing reading
// finds the marker on it (scripts/lib/text-normalise.ts).
//
//   node scripts/check-placeholders.ts [--dist <folder>] [--strict]
//
// Strict mode = `--strict` or PS_STRICT=1 (the release workflow sets it; see scripts/build-strict.mjs). Strict lists every hit as
// file:line and exits 1. Normal mode prints a summary only and exits 0. A missing folder is a usage error (exit 2). In strict mode an
// output with no HTML page at all also fails: the gate is fail-closed, it never passes an empty build.
//
// Skipped on purpose (tested in tests/infra/check-placeholders.test.ts):
//   - binary files (known binary extension, or a NUL byte in the first 8 KB), because a marker cannot be read there;
//   - the explicit ALLOWLIST below, each entry with a reason and a narrow scope.
//
// Owner-dependent sections hidden by the hide-section rule can announce themselves with a `data-owner-hidden="<name>"` attribute
// (contract in docs/m1/infra-notes.md); the gate lists them so the owner sees what is waiting for an input. Informational only.
//
// Node 24 runs this file directly by stripping types, so keep it type-annotation-only.
import { STATIC_DIR } from './lib/output-paths.mjs';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { argValue, excerptAt, isMain, isStrict, lineStarts, listFiles, positionOf, readText } from './lib/files.ts';
import type { DistFile } from './lib/files.ts';
import { normaliseText } from './lib/text-normalise.ts';

export const PLACEHOLDER = 'TODO(owner)';

/** The marker as the gate reads it: case-insensitive, whitespace tolerated around the word and the brackets. */
export const PLACEHOLDER_PATTERN = /TODO\s*\(\s*owner\s*\)/gi;

const TAG_FILES = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml']);

export interface PlaceholderAllowEntry {
  /** Path relative to the scanned folder, forward slashes. */
  file: string;
  /** `xml-comment`: only a hit inside an XML/HTML comment is excused. `file`: every hit in the file is excused. */
  scope: 'xml-comment' | 'file';
  reason: string;
}

/**
 * The only places a marker may stay in the public output. Keep it short; each line is a promise that the text is invisible to
 * visitors. Remove an entry as soon as its reason is gone.
 */
export const ALLOWLIST: readonly PlaceholderAllowEntry[] = [
  {
    file: 'brand/og-default.svg',
    scope: 'xml-comment',
    reason:
      'Reserved-tagline note in an XML comment (OT-23). Invisible in the rendered image. Remove this entry when the owner picks a tagline and scripts/brand-logo.mjs is re-run.',
  },
];

export interface PlaceholderHit {
  file: string;
  line: number;
  column: number;
  excerpt: string;
}

export interface HiddenSection {
  name: string;
  pages: string[];
}

export interface PlaceholderReport {
  scannedFiles: number;
  skippedBinary: number;
  htmlPages: number;
  hits: PlaceholderHit[];
  /** Hits excused by the allowlist (reported so nothing is silent). */
  allowed: PlaceholderHit[];
  hiddenSections: HiddenSection[];
}

const COMMENT = /<!--[\s\S]*?-->/g;

const blankKeepingNewlines = (text: string): string => text.replace(/[^\n]/g, ' ');

/** The text with every comment blanked out (spaces, newlines kept) and, separately, only the comments. Offsets and lines stay the same. */
function splitComments(text: string): { body: string; comments: string } {
  let body = '';
  let comments = '';
  let last = 0;
  COMMENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    body += before + blankKeepingNewlines(m[0]);
    comments += blankKeepingNewlines(before) + m[0];
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  body += rest;
  comments += blankKeepingNewlines(rest);
  return { body, comments };
}

/** Every marker in a text, read three ways. A line counts as many times as the most revealing reading finds it on that line. */
export function markersIn(file: string, text: string, hasMarkup: boolean): PlaceholderHit[] {
  const views = [text, normaliseText(text)];
  if (hasMarkup) views.push(normaliseText(text, { stripTags: true }));
  const best = new Map<number, PlaceholderHit[]>();
  for (const view of views) {
    const starts = lineStarts(view);
    const local = new Map<number, PlaceholderHit[]>();
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_PATTERN.exec(view)) !== null) {
      const { line, column } = positionOf(starts, m.index);
      const hit: PlaceholderHit = { file, line, column, excerpt: excerptAt(view, m.index, m[0].length) };
      const list = local.get(line);
      if (list) list.push(hit);
      else local.set(line, [hit]);
    }
    for (const [line, list] of local) {
      const current = best.get(line);
      if (!current || list.length > current.length) best.set(line, list);
    }
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, list]) => list);
}

const OWNER_HIDDEN_RE = /data-owner-hidden(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

/** Scan one folder. Pure apart from reading files. */
export function scanPlaceholders(root: string, allowlist: readonly PlaceholderAllowEntry[] = ALLOWLIST): PlaceholderReport {
  const files: DistFile[] = listFiles(root);
  const report: PlaceholderReport = { scannedFiles: 0, skippedBinary: 0, htmlPages: 0, hits: [], allowed: [], hiddenSections: [] };
  const hidden = new Map<string, Set<string>>();

  for (const file of files) {
    const text = readText(file);
    if (text === null) {
      report.skippedBinary++;
      continue;
    }
    report.scannedFiles++;
    const isHtml = file.ext === '.html' || file.ext === '.htm';
    if (isHtml) report.htmlPages++;

    const allow = allowlist.find((a) => a.file === file.rel);
    const hasMarkup = TAG_FILES.has(file.ext);
    if (allow?.scope === 'xml-comment') {
      // only a marker inside an XML or HTML comment is excused; one anywhere else in the file still fails
      const { body, comments } = splitComments(text);
      report.hits.push(...markersIn(file.rel, body, hasMarkup));
      report.allowed.push(...markersIn(file.rel, comments, hasMarkup));
    } else if (allow?.scope === 'file') {
      report.allowed.push(...markersIn(file.rel, text, hasMarkup));
    } else {
      report.hits.push(...markersIn(file.rel, text, hasMarkup));
    }

    if (isHtml) {
      OWNER_HIDDEN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = OWNER_HIDDEN_RE.exec(text)) !== null) {
        const name = (m[1] ?? m[2] ?? m[3] ?? '').trim() || '(unnamed)';
        if (!hidden.has(name)) hidden.set(name, new Set());
        (hidden.get(name) as Set<string>).add(file.rel);
      }
    }
  }
  report.hiddenSections = [...hidden.entries()]
    .map(([name, pages]) => ({ name, pages: [...pages].sort() }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  return report;
}

/** Text of the result and the exit code. Pure, so tests can assert both. */
export function formatPlaceholderReport(report: PlaceholderReport, strict: boolean, distLabel: string): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  const mode = strict ? 'strict' : 'non-strict';
  lines.push(`check-placeholders (${mode}): scanned ${report.scannedFiles} text files in ${distLabel} (${report.skippedBinary} binary files skipped).`);

  const byFile = new Map<string, number>();
  for (const h of report.hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);

  if (report.hits.length === 0) {
    lines.push(`  OK: no ${PLACEHOLDER} text in the public output.`);
  } else if (strict) {
    lines.push(`  FAIL: ${report.hits.length} ${PLACEHOLDER} marker(s) in ${byFile.size} file(s). Supply the owner input or hide the section (D-034), then rebuild:`);
    for (const h of report.hits) lines.push(`    ${h.file}:${h.line}:${h.column}  ${h.excerpt}`);
  } else {
    lines.push(`  ${report.hits.length} ${PLACEHOLDER} marker(s) in ${byFile.size} file(s). Informational: the strict release build (PS_STRICT=1) fails on these.`);
    for (const [file, n] of [...byFile.entries()].sort()) lines.push(`    ${file}: ${n}`);
  }
  if (report.allowed.length > 0) {
    lines.push(`  ${report.allowed.length} marker(s) excused by the allowlist: ${[...new Set(report.allowed.map((h) => h.file))].join(', ')}`);
  }
  if (report.hiddenSections.length > 0) {
    lines.push(`  Owner-dependent sections currently hidden (waiting for an owner input): ${report.hiddenSections.length}`);
    for (const s of report.hiddenSections) lines.push(`    ${s.name} (${s.pages.length} page${s.pages.length === 1 ? '' : 's'})`);
  }

  let exitCode = 0;
  if (strict && report.hits.length > 0) exitCode = 1;
  if (report.htmlPages === 0) {
    lines.push(strict ? '  FAIL: no HTML page found, so nothing was checked. A strict release never passes an empty build.' : '  Note: no HTML page found in the folder.');
    if (strict) exitCode = 1;
  }
  return { lines, exitCode };
}

export function main(args: readonly string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): number {
  const strict = isStrict(args, env);
  const root = resolve(argValue(args, '--dist') ?? STATIC_DIR);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`check-placeholders: folder not found: ${root}. Run the build first (npm run build).`);
    return 2;
  }
  const report = scanPlaceholders(root);
  const { lines, exitCode } = formatPlaceholderReport(report, strict, argValue(args, '--dist') ?? STATIC_DIR);
  for (const line of lines) console.log(line);
  return exitCode;
}

if (isMain(import.meta.url)) process.exit(main());
