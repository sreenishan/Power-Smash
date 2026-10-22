#!/usr/bin/env node
/**
 * WCAG 2.2 contrast check for every text/background pairing the brand spec (5.3) states or implies.
 *
 *   node scripts/brand-contrast.mjs              table to the terminal (exit 1 on a required pair that fails)
 *   node scripts/brand-contrast.mjs --markdown   the same table as Markdown (pasted into docs/BRAND.md)
 *   node scripts/brand-contrast.mjs --json       machine-readable
 *
 * Colours are read from src/styles/tokens.css (the --ps-* custom properties), so the check follows the tokens.
 * Maths: WCAG 2.x relative luminance and contrast ratio, (L1 + 0.05) / (L2 + 0.05). Ratios are shown rounded DOWN
 * to two decimals (WCAG forbids rounding up: 4.499 does not meet 4.5).
 * Thresholds: normal text 4.5, large text 3 (24 px, or 18.66 px bold), UI components and graphics 3 (WCAG 1.4.11).
 *
 * Exported for scripts/brand-preview.mjs: parseTokens, contrastRatio, PAIRS, SPEC_REFERENCES, evaluate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TOKENS_CSS = resolve(ROOT, "src/styles/tokens.css");

/** The nine colours of spec 5.3. Everything else read from tokens.css is DERIVED. */
export const SPEC_TOKENS = ["court", "court-deep", "ink", "volt", "feather", "white", "slate", "border", "live"];

/** Read `--ps-name: #hex;` declarations from the first :root block of tokens.css. */
export function parseTokens(cssPath = TOKENS_CSS) {
  const css = readFileSync(cssPath, "utf8");
  const tokens = {};
  const re = /--ps-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\s*;/g;
  let m;
  while ((m = re.exec(css))) {
    if (!(m[1] in tokens)) tokens[m[1]] = normaliseHex(m[2]);
  }
  return tokens;
}

function normaliseHex(h) {
  h = h.toUpperCase();
  if (h.length === 4) h = "#" + [...h.slice(1)].map((c) => c + c).join("");
  return h;
}

function channel(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const floor2 = (x) => Math.floor(x * 100) / 100;

/**
 * kind:   text (4.5) | large (3) | ui (3) | decor (no requirement)
 * status: required  - must meet its threshold, a miss is an error
 *         banned    - must NOT be used for this purpose; it is listed to prove why (a miss is expected)
 *         info      - decorative, shown for the record
 */
export const PAIRS = [
  // Light surfaces
  { id: "L1", fg: "ink", bg: "feather", kind: "text", status: "required", use: "Body text on the page background" },
  { id: "L2", fg: "ink", bg: "white", kind: "text", status: "required", use: "Body text on cards" },
  { id: "L3", fg: "slate", bg: "feather", kind: "text", status: "required", use: "Secondary text on the page background" },
  { id: "L4", fg: "slate", bg: "white", kind: "text", status: "required", use: "Secondary text on cards" },
  { id: "L5", fg: "court", bg: "feather", kind: "text", status: "required", use: "Links and key headings on the page background" },
  { id: "L6", fg: "court", bg: "white", kind: "text", status: "required", use: "Links and key headings on cards" },
  { id: "L7", fg: "court-deep", bg: "feather", kind: "text", status: "required", use: "Link hover on the page background" },
  { id: "L8", fg: "live", bg: "feather", kind: "text", status: "required", use: "Critical alert text on the page background" },
  { id: "L9", fg: "live", bg: "white", kind: "text", status: "required", use: "Critical alert text on cards" },
  // Filled controls and badges
  { id: "F1", fg: "white", bg: "court", kind: "text", status: "required", use: "Primary button label (spec reference 6.3)" },
  { id: "F2", fg: "white", bg: "court-deep", kind: "text", status: "required", use: "Primary button label on hover" },
  { id: "F3", fg: "ink", bg: "volt", kind: "text", status: "required", use: "CTA fill with ink text (spec reference 14.6)" },
  { id: "F4", fg: "white", bg: "live", kind: "text", status: "required", use: "LIVE badge (spec reference 5.6)" },
  { id: "F5", fg: "court", bg: "court-tint", kind: "text", status: "required", use: "Selected chip, derived tint" },
  { id: "F6", fg: "ink", bg: "court-tint", kind: "text", status: "required", use: "Body text on the court tint" },
  { id: "F7", fg: "live", bg: "live-tint", kind: "text", status: "required", use: "Alert text on the soft alert background, derived tint" },
  { id: "F8", fg: "ink", bg: "live-tint", kind: "text", status: "required", use: "Body text on the soft alert background" },
  { id: "F9", fg: "ink", bg: "border", kind: "text", status: "required", use: "Text on a border-coloured chip or table header" },
  // Dark "broadcast" surfaces
  { id: "D1", fg: "white", bg: "ink", kind: "text", status: "required", use: "Text on dark sections" },
  { id: "D2", fg: "feather", bg: "ink", kind: "text", status: "required", use: "Text on dark sections (softer white)" },
  { id: "D3", fg: "volt", bg: "ink", kind: "text", status: "required", use: "Highlights, live scores, links on dark" },
  { id: "D4", fg: "mist", bg: "ink", kind: "text", status: "required", use: "Secondary text on dark, derived (slate fails here, see X3)" },
  { id: "D5", fg: "white", bg: "ink-soft", kind: "text", status: "required", use: "Text on a card inside a dark section" },
  { id: "D6", fg: "mist", bg: "ink-soft", kind: "text", status: "required", use: "Secondary text on a card inside a dark section" },
  { id: "D7", fg: "volt", bg: "ink-soft", kind: "text", status: "required", use: "Highlights on a card inside a dark section" },
  { id: "D8", fg: "white", bg: "court-deep", kind: "text", status: "required", use: "Text on the deep-green band" },
  { id: "D9", fg: "volt", bg: "court-deep", kind: "text", status: "required", use: "Highlights on the deep-green band" },
  { id: "D10", fg: "mist", bg: "court-deep", kind: "text", status: "required", use: "Secondary text on the deep-green band" },
  { id: "D11", fg: "white", bg: "court", kind: "text", status: "required", use: "Text on a court-green card" },
  { id: "D12", fg: "volt", bg: "court", kind: "text", status: "required", use: "Volt on court-green (allowed, still dark)" },
  // Premium upgrade: hover states, scoreboard, hero gradient, chips
  { id: "P1", fg: "ink", bg: "volt-hover", kind: "text", status: "required", use: "Volt button label on hover" },
  { id: "P2", fg: "white", bg: "ink-raised", kind: "text", status: "required", use: "Text on a hovered card inside a dark section" },
  { id: "P3", fg: "mist", bg: "ink-raised", kind: "text", status: "required", use: "Secondary text on a hovered card inside a dark section" },
  { id: "P4", fg: "volt", bg: "ink-raised", kind: "text", status: "required", use: "Volt highlights on a hovered dark card" },
  { id: "P5", fg: "volt", bg: "ink-soft", kind: "large", status: "required", use: "Scoreboard numerals (StatCounter) on the dark card" },
  { id: "P6", fg: "volt", bg: "ink", kind: "ui", status: "required", use: "Active-nav underline and rules on dark" },
  { id: "P7", fg: "court", bg: "court-tint", kind: "ui", status: "required", use: "Icon in the icon tile on light" },
  { id: "P8", fg: "volt", bg: "ink", kind: "text", status: "required", use: "Ink chip (Covered by Power Smash) volt on ink" },
  { id: "P9", fg: "court", bg: "white", kind: "text", status: "required", use: "Secondary button label on a card" },
  { id: "P10", fg: "court-deep", bg: "court-tint", kind: "text", status: "required", use: "Secondary button label on hover" },
  { id: "P12", fg: "border-on-dark", bg: "ink", kind: "decor", status: "info", use: "Header and card hairlines on dark" },
  // Non-text: focus rings, control edges (WCAG 1.4.11)
  { id: "U1", fg: "court", bg: "feather", kind: "ui", status: "required", use: "Focus ring on light surfaces" },
  { id: "U2", fg: "volt", bg: "ink", kind: "ui", status: "required", use: "Focus ring on dark sections" },
  { id: "U3", fg: "volt", bg: "court-deep", kind: "ui", status: "required", use: "Focus ring on the deep-green band" },
  { id: "U4", fg: "slate", bg: "feather", kind: "ui", status: "required", use: "Input and outline-button edge on the page (line-strong)" },
  { id: "U5", fg: "slate", bg: "white", kind: "ui", status: "required", use: "Input edge on a card (line-strong)" },
  { id: "U6", fg: "mist", bg: "ink", kind: "ui", status: "required", use: "Input edge on dark (line-strong)" },
  { id: "U7", fg: "court", bg: "white", kind: "ui", status: "required", use: "Secondary button outline and icons on cards" },
  // Banned by the spec or by this check: they exist to show why
  { id: "X1", fg: "volt", bg: "feather", kind: "text", status: "banned", use: "Volt as text on the light page (spec: never)" },
  { id: "X2", fg: "volt", bg: "white", kind: "text", status: "banned", use: "Volt as text on a white card (spec: never)" },
  { id: "X3", fg: "slate", bg: "ink", kind: "text", status: "banned", use: "Slate secondary text on a dark section (use mist)" },
  { id: "X4", fg: "live", bg: "ink", kind: "text", status: "banned", use: "Red text on a dark section (use a live FILL with white text)" },
  { id: "X5", fg: "court", bg: "ink", kind: "ui", status: "banned", use: "Court-green text, icon or ring on ink (use volt)" },
  { id: "X6", fg: "slate", bg: "court-deep", kind: "text", status: "banned", use: "Slate on the deep-green band (use mist)" },
  { id: "X7", fg: "slate", bg: "border", kind: "text", status: "banned", use: "Slate text on a border-coloured fill (use ink)" },
  { id: "X8", fg: "border", bg: "feather", kind: "ui", status: "banned", use: "--ps-border as the ONLY edge of an input or button (decorative dividers only)" },
  { id: "X9", fg: "border", bg: "white", kind: "ui", status: "banned", use: "--ps-border as the ONLY edge of a control on a card" },
  // Decorative: no requirement
  { id: "Z1", fg: "ink-soft", bg: "ink", kind: "decor", status: "info", use: "Dark card surface against the dark section (surface step only)" },
  { id: "Z2", fg: "border-on-dark", bg: "ink", kind: "decor", status: "info", use: "Divider on a dark section" },
];

/** Ratios printed in spec 5.3 ("Reference ratios"). */
export const SPEC_REFERENCES = [
  { fg: "white", bg: "court", claimed: 6.3 },
  { fg: "ink", bg: "volt", claimed: 14.6 },
  { fg: "slate", bg: "feather", claimed: 5.1 },
  { fg: "white", bg: "live", claimed: 5.6 },
];

export const THRESHOLD = { text: 4.5, large: 3, ui: 3, decor: 0 };

/** Compute every row. Missing token names throw so a typo cannot pass silently. */
export function evaluate(tokens = parseTokens()) {
  const need = (name) => {
    if (!(name in tokens)) throw new Error(`Token --ps-${name} is not defined in tokens.css`);
    return tokens[name];
  };
  const rows = PAIRS.map((p) => {
    const fgHex = need(p.fg);
    const bgHex = need(p.bg);
    const ratio = contrastRatio(fgHex, bgHex);
    const need_ = THRESHOLD[p.kind];
    const meetsAA = ratio >= need_;
    const meetsText = ratio >= 4.5;
    const meetsLarge = ratio >= 3;
    const meetsAAA = ratio >= 7;
    let verdict;
    if (p.status === "required") verdict = meetsAA ? "PASS" : "FAIL";
    else if (p.status === "banned") verdict = meetsAA ? "UNEXPECTED-PASS" : "BANNED";
    else verdict = "INFO";
    return { ...p, fgHex, bgHex, ratio, ratioShown: floor2(ratio), need: need_, meetsText, meetsLarge, meetsAAA, verdict };
  });
  const refs = SPEC_REFERENCES.map((r) => {
    const actual = contrastRatio(need(r.fg), need(r.bg));
    const shown = floor2(actual);
    // The spec writes one decimal with a tilde. Flag anything that does not round to the stated value.
    const matches = Math.abs(Math.round(actual * 10) / 10 - r.claimed) < 1e-9;
    return { ...r, actual, shown, matches };
  });
  return { rows, refs };
}

const mark = (b) => (b ? "yes" : "NO");

function printTable({ rows, refs }) {
  const head = ["ID", "Foreground", "Background", "Ratio", "AA text", "AA large/UI", "AAA", "Verdict", "Use"];
  const lines = rows.map((r) => [
    r.id,
    `${r.fg} ${r.fgHex}`,
    `${r.bg} ${r.bgHex}`,
    r.ratioShown.toFixed(2),
    r.kind === "decor" ? "-" : mark(r.meetsText),
    r.kind === "decor" ? "-" : mark(r.meetsLarge),
    r.kind === "decor" ? "-" : mark(r.meetsAAA),
    r.verdict,
    r.use,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (cols) => cols.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const l of lines) console.log(fmt(l));
  console.log("\nSpec 5.3 reference ratios:");
  for (const r of refs) {
    console.log(
      `  ${r.fg} on ${r.bg}: spec says ~${r.claimed}:1, computed ${r.shown.toFixed(2)}:1  ${r.matches ? "ok" : "MISMATCH (spec value is off)"}`,
    );
  }
}

function printMarkdown({ rows, refs }) {
  const out = [];
  out.push("| ID | Foreground | Background | Ratio | AA text (4.5) | AA large / UI (3) | AAA (7) | Verdict | Use |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const d = r.kind === "decor";
    out.push(
      `| ${r.id} | \`${r.fg}\` ${r.fgHex} | \`${r.bg}\` ${r.bgHex} | ${r.ratioShown.toFixed(2)} | ${d ? "-" : mark(r.meetsText)} | ${d ? "-" : mark(r.meetsLarge)} | ${d ? "-" : mark(r.meetsAAA)} | ${r.verdict} | ${r.use} |`,
    );
  }
  out.push("");
  out.push("| Spec 5.3 reference | Spec says | Computed | Result |");
  out.push("|---|---|---|---|");
  for (const r of refs) {
    out.push(`| ${r.fg} on ${r.bg} | about ${r.claimed}:1 | ${r.shown.toFixed(2)}:1 | ${r.matches ? "matches" : "spec value is off"} |`);
  }
  console.log(out.join("\n"));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = evaluate();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else if (process.argv.includes("--markdown")) printMarkdown(result);
  else printTable(result);

  const fails = result.rows.filter((r) => r.verdict === "FAIL" || r.verdict === "UNEXPECTED-PASS");
  const mism = result.refs.filter((r) => !r.matches);
  const banned = result.rows.filter((r) => r.verdict === "BANNED").length;
  console.error(
    `\n${result.rows.length} pairs: ${result.rows.filter((r) => r.verdict === "PASS").length} pass, ` +
      `${fails.length} FAIL, ${banned} banned-by-design (expected to fail), ` +
      `${result.refs.length - mism.length}/${result.refs.length} spec reference ratios match.`,
  );
  if (fails.length) {
    for (const f of fails) console.error(`  ${f.verdict}: ${f.id} ${f.fg} on ${f.bg} = ${f.ratioShown.toFixed(2)} (${f.use})`);
    process.exitCode = 1;
  }
}
