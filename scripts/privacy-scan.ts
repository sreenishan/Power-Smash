// Privacy scan of the built public output (D-029, D-027; BUILD_PLAN M1 item 4). Looks in the static output (.vercel/output/static) for phone numbers, email
// addresses, secret-shaped strings, private field names and localhost URLs.
//
//   node scripts/privacy-scan.ts [--dist <folder>] [--strict]
//
// Two severities (scripts/lib/privacy-rules.ts):
//   critical  secret-shaped strings and the exact VALUES of the private variables found in the environment: fail EVERY build.
//   strict    emails, phone numbers, private field names, localhost URLs: summary only in a normal build, fail the strict build.
// The only values allowed through are the owner's OFFICIAL contact details, read from the environment (PUBLIC_WHATSAPP_NUMBER) and
// from the string literals in src/content/site.ts (phone, publicEmail, grievanceEmail). The WhatsApp number is public by design.
//
// Every file is read several ways, not only as raw bytes (review S-2, D-029 "decoded output"): decoded (HTML entities, percent-encoding and
// JS or JSON escapes undone, digits of any script mapped to 0-9, zero-width characters removed), with the markup removed (HTML and SVG),
// and, for secret shapes, with base64-looking blobs decoded. See scripts/lib/text-normalise.ts and scripts/lib/privacy-rules.ts.
//
// Output never contains a full matched value: file, line, rule and a masked sample only.
// Node 24 type stripping: type-annotation-only.
import { STATIC_DIR } from './lib/output-paths.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { argValue, isMain, isStrict, lineStarts, listFiles, positionOf, readText } from './lib/files.ts';
import type { DistFile } from './lib/files.ts';
import { CODE_NUMBER_ALLOWLIST, RULES, SECRET_ENV_NAMES, TEXT_VIEWS, canonicalEmail, canonicalPhone, isAllowedCodeNumber, mask } from './lib/privacy-rules.ts';
import type { CodeNumberAllow, FileKind, Severity, ViewName } from './lib/privacy-rules.ts';
import { decodeBase64Blobs, joinStringConcatenation, normaliseText } from './lib/text-normalise.ts';

export interface OfficialContacts {
  /** Lower-case email addresses. */
  emails: Set<string>;
  /** Phone numbers in canonical form (see canonicalPhone). */
  phones: Set<string>;
}

export interface PrivacyFinding {
  rule: string;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  /** Masked sample. Never the full value. */
  sample: string;
}

export interface PrivacyReport {
  scannedFiles: number;
  skippedBinary: number;
  findings: PrivacyFinding[];
  /** Matches skipped because they are an official contact (counts per rule, for transparency). */
  allowedOfficial: Record<string, number>;
}

const MARKUP_EXTENSIONS = new Set(['.html', '.htm', '.json', '.txt', '.xml', '.ics', '.webmanifest', '.csv', '.md', '.rss', '.atom', '.vtt', '.yaml', '.yml', '.toml']);

const kindOf = (file: DistFile): FileKind => (MARKUP_EXTENSIONS.has(file.ext) || file.ext === '' ? 'markup' : 'code');

/** Official contact details from the environment and from the string literals in src/content/site.ts. */
export function loadOfficialContacts(env: Record<string, string | undefined>, siteTsSource: string | null): OfficialContacts {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const addPhone = (v: string | undefined | null): void => {
    const c = canonicalPhone(v ?? '');
    if (c.length >= 8) phones.add(c);
  };
  const addEmail = (v: string | undefined | null): void => {
    const e = (v ?? '').trim().toLowerCase();
    if (e.includes('@')) emails.add(e);
  };
  addPhone(env.PUBLIC_WHATSAPP_NUMBER);
  if (siteTsSource) {
    const re = /^\s*(phone|publicEmail|grievanceEmail|whatsappNumber)\s*:\s*(?:'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(siteTsSource)) !== null) {
      const value = m[2] ?? m[3] ?? m[4] ?? '';
      if (m[1] === 'phone' || m[1] === 'whatsappNumber') addPhone(value);
      else addEmail(value);
    }
  }
  return { emails, phones };
}

const isOfficial = (ruleId: string, match: string, official: OfficialContacts): boolean => {
  if (ruleId === 'email-address' || ruleId === 'email-address-obfuscated') return official.emails.has(canonicalEmail(match));
  if (ruleId.includes('phone') || ruleId.includes('mobile')) return official.phones.has(canonicalPhone(match));
  return false;
};

/** Files that contain markup, so a tag-free reading makes sense. */
const TAG_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml']);

/**
 * The readings of one file (see ViewName). Each is a string with the same line structure as the file (newlines are kept; a numeric entity
 * that decodes to a newline shifts later lines of that file by one, which only affects the reported line number).
 */
export function buildViews(text: string, ext: string, kind: FileKind): Partial<Record<ViewName, string>> {
  let decoded = normaliseText(text);
  if (kind === 'code') decoded = joinStringConcatenation(decoded);
  const views: Partial<Record<ViewName, string>> = { raw: text, decoded };
  if (TAG_EXTENSIONS.has(ext)) views.plain = normaliseText(text, { stripTags: true });
  const b64 = decodeBase64Blobs(text);
  if (b64 !== '') views.b64 = b64;
  return views;
}

interface Entry {
  finding: PrivacyFinding | null;
  /** Set when the match is an official contact detail or an allow-listed number: counted, not reported. */
  allowedAs: string | null;
}

/** What identifies "the same thing" found in two readings of the file: rule, line and the value with the formatting removed. */
const groupKey = (ruleId: string, line: number, match: string): string => {
  const value = ruleId.includes('phone') || ruleId.includes('mobile') ? canonicalPhone(match) : match.toLowerCase();
  return `${ruleId}|${line}|${value}`;
};

/**
 * Scan one folder. `secretValues` maps a private variable name to its value (read from the environment by the CLI).
 * Every file is read in several ways (buildViews). The same thing found in two readings is reported once: the reading that finds it
 * most often on that line wins, so a number written twice on one line is still two findings.
 */
export function scanPrivacy(
  root: string,
  official: OfficialContacts,
  secretValues: Record<string, string> = {},
  codeAllowlist: readonly CodeNumberAllow[] = CODE_NUMBER_ALLOWLIST,
): PrivacyReport {
  const report: PrivacyReport = { scannedFiles: 0, skippedBinary: 0, findings: [], allowedOfficial: {} };
  const knownValues = Object.entries(secretValues).filter(([, v]) => v.length >= 8);

  for (const file of listFiles(root)) {
    const text = readText(file);
    if (text === null) {
      report.skippedBinary++;
      continue;
    }
    report.scannedFiles++;
    const kind = kindOf(file);
    const views = buildViews(text, file.ext, kind);
    const startsOf = new Map<ViewName, number[]>();
    for (const [name, viewText] of Object.entries(views) as Array<[ViewName, string]>) startsOf.set(name, lineStarts(viewText));

    for (const rule of RULES) {
      if (!rule.kinds.includes(kind)) continue;
      // group key -> best list of entries (the reading with the most entries for that key)
      const best = new Map<string, Entry[]>();
      for (const viewName of rule.views ?? TEXT_VIEWS) {
        const viewText = views[viewName];
        if (viewText === undefined) continue;
        const starts = startsOf.get(viewName) as number[];
        const local = new Map<string, Entry[]>();
        rule.regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rule.regex.exec(viewText)) !== null) {
          if (m[0] === '') {
            rule.regex.lastIndex++;
            continue;
          }
          if (rule.accept && !rule.accept(m[0])) continue;
          const { line, column } = positionOf(starts, m.index);
          let allowedAs: string | null = null;
          if (isOfficial(rule.id, m[0], official)) allowedAs = rule.id;
          else if (rule.id === 'indian-mobile-number-code' && isAllowedCodeNumber(file.rel, m[0], codeAllowlist)) allowedAs = 'code-number-allowlist';
          const entry: Entry = {
            allowedAs,
            finding: allowedAs ? null : { rule: rule.id, severity: rule.severity, file: file.rel, line, column, sample: mask(m[0]) },
          };
          const key = groupKey(rule.id, line, m[0]);
          const list = local.get(key);
          if (list) list.push(entry);
          else local.set(key, [entry]);
        }
        for (const [key, list] of local) {
          const current = best.get(key);
          if (!current || list.length > current.length) best.set(key, list);
        }
      }
      for (const list of best.values()) {
        for (const entry of list) {
          if (entry.allowedAs) report.allowedOfficial[entry.allowedAs] = (report.allowedOfficial[entry.allowedAs] ?? 0) + 1;
          else if (entry.finding) report.findings.push(entry.finding);
        }
      }
    }

    // the exact VALUES of the private variables, in every reading
    for (const [name, value] of knownValues) {
      let bestCount = 0;
      let bestPositions: Array<{ line: number; column: number }> = [];
      for (const [viewName, viewText] of Object.entries(views) as Array<[ViewName, string]>) {
        const starts = startsOf.get(viewName) as number[];
        const found: Array<{ line: number; column: number }> = [];
        let from = 0;
        for (;;) {
          const at = viewText.indexOf(value, from);
          if (at === -1) break;
          from = at + value.length;
          found.push(positionOf(starts, at));
        }
        if (found.length > bestCount) {
          bestCount = found.length;
          bestPositions = found;
        }
      }
      for (const { line, column } of bestPositions) {
        report.findings.push({ rule: `known-secret-value:${name}`, severity: 'critical', file: file.rel, line, column, sample: '(value of the variable, not shown)' });
      }
    }
  }
  return report;
}

/** The private variables that are set in this environment and long enough to search for. */
export function secretValuesFrom(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SECRET_ENV_NAMES) {
    const v = (env[name] ?? '').trim();
    if (v.length >= 8) out[name] = v;
  }
  return out;
}

export function formatPrivacyReport(report: PrivacyReport, strict: boolean, distLabel: string): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  const critical = report.findings.filter((f) => f.severity === 'critical');
  const strictOnly = report.findings.filter((f) => f.severity === 'strict');
  lines.push(`privacy-scan (${strict ? 'strict' : 'non-strict'}): scanned ${report.scannedFiles} text files in ${distLabel} (${report.skippedBinary} binary files skipped).`);

  const official = Object.entries(report.allowedOfficial);
  if (official.length > 0) lines.push(`  Official contact details allowed: ${official.map(([r, n]) => `${r} x${n}`).join(', ')}`);

  if (critical.length > 0) {
    lines.push(`  FAIL: ${critical.length} secret-shaped value(s). A secret in the public output fails every build:`);
    for (const f of critical) lines.push(`    ${f.file}:${f.line}:${f.column}  ${f.rule}  ${f.sample}`);
  }
  if (strictOnly.length > 0) {
    if (strict) {
      lines.push(`  FAIL: ${strictOnly.length} personal-data or private-name hit(s). Remove them or, for an official contact, set it in site config:`);
      for (const f of strictOnly) lines.push(`    ${f.file}:${f.line}:${f.column}  ${f.rule}  ${f.sample}`);
    } else {
      const byRule = new Map<string, number>();
      for (const f of strictOnly) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
      lines.push(`  ${strictOnly.length} hit(s) that fail the strict release build (informational now): ${[...byRule.entries()].map(([r, n]) => `${r} x${n}`).join(', ')}`);
    }
  }
  if (critical.length === 0 && strictOnly.length === 0) lines.push('  OK: nothing private found in the public output.');

  const failed = critical.length > 0 || (strict && strictOnly.length > 0);
  if (strict && report.scannedFiles === 0) {
    lines.push('  FAIL: no text file found, so nothing was checked. A strict release never passes an empty build.');
    return { lines, exitCode: 1 };
  }
  return { lines, exitCode: failed ? 1 : 0 };
}

export function main(args: readonly string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): number {
  const strict = isStrict(args, env);
  const label = argValue(args, '--dist') ?? STATIC_DIR;
  const root = resolve(label);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`privacy-scan: folder not found: ${root}. Run the build first (npm run build).`);
    return 2;
  }
  const sitePath = resolve(argValue(args, '--site-config') ?? 'src/content/site.ts');
  const siteSource = existsSync(sitePath) ? readFileSync(sitePath, 'utf8') : null;
  const report = scanPrivacy(root, loadOfficialContacts(env, siteSource), secretValuesFrom(env));
  const { lines, exitCode } = formatPrivacyReport(report, strict, label);
  for (const line of lines) console.log(line);
  return exitCode;
}

if (isMain(import.meta.url)) process.exit(main());
