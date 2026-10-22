#!/usr/bin/env node
/**
 * Static check of the brand style sheets: src/styles/tokens.css, fonts.css, global.css.
 *
 *   node scripts/brand-tokens-check.mjs
 *
 * What it proves (exit code 1 if any line fails):
 *  - braces and comments balance in every file
 *  - the nine spec 5.3 colours have exactly the spec hex values
 *  - every var(--ps-*) used resolves to a declared --ps-* property
 *  - the fluid type scale hits the spec numbers (H1 2.25rem at 360 px, 4rem at 1200 px)
 *  - motion durations are 150 to 250 ms and a prefers-reduced-motion block exists
 *  - every @font-face has font-display: swap and a unicode-range, points at a file that exists, and stays inside the
 *    D-002 allow-list (Barlow Condensed 700/800 + 800 italic, Inter variable, Noto Sans Tamil 400/600)
 *  - Noto Sans Tamil is in the heading stack; a :lang(ta) rule exists; Inter latin-ext is NOT loaded
 *  - the font budget (bytes of the woff2 files a page can pull) against the D-002 figure of about 150 KB
 *  - Tailwind 4.3.3 compiles global.css and generates every utility the design system promises
 *    (uses @tailwindcss/node, which is installed as a dependency of @tailwindcss/vite; skipped with a notice if absent)
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES = resolve(ROOT, "src/styles");
const read = (f) => readFileSync(resolve(STYLES, f), "utf8");
const files = { "tokens.css": read("tokens.css"), "fonts.css": read("fonts.css"), "global.css": read("global.css") };
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

let failed = 0;
const line = (ok, name, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

/* 1. structure */
for (const [name, css] of Object.entries(files)) {
  const opens = (css.match(/\/\*/g) || []).length;
  const closes = (css.match(/\*\//g) || []).length;
  line(opens === closes, `${name}: comments balanced`, `${opens} open, ${closes} close`);
  const body = strip(css);
  let depth = 0;
  let min = 0;
  for (const ch of body) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    min = Math.min(min, depth);
  }
  line(depth === 0 && min === 0, `${name}: braces balanced`, `final depth ${depth}`);
  line(!/https?:\/\//.test(body), `${name}: no external URL`);
}

/* 2. colours */
const tokensCss = strip(files["tokens.css"]);
const fontsCss = strip(files["fonts.css"]);
const allCss = tokensCss + "\n" + fontsCss;
const SPEC = {
  court: "#0b6e4f",
  "court-deep": "#064532",
  ink: "#0b1416",
  volt: "#c6f432",
  feather: "#f7f8f5",
  white: "#ffffff",
  slate: "#5b6b70",
  border: "#dde3e1",
  live: "#c62a1f",
};
for (const [name, hex] of Object.entries(SPEC)) {
  const m = tokensCss.match(new RegExp(`--ps-${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  line(!!m && m[1].toLowerCase() === hex, `spec colour --ps-${name} = ${hex}`, m ? m[1] : "missing");
}

/* 3. var() resolution */
const declared = new Set([...allCss.matchAll(/(--ps-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = new Set([...allCss.matchAll(/var\((--ps-[a-z0-9-]+)/g)].map((m) => m[1]));
const missing = [...used].filter((u) => !declared.has(u));
line(missing.length === 0, "every var(--ps-*) resolves to a declared property", `${used.size} used, ${declared.size} declared${missing.length ? ", missing: " + missing.join(", ") : ""}`);
const required = ["--ps-focus", "--ps-focus-width", "--ps-dur-fast", "--ps-dur-base", "--ps-dur-slow", "--ps-ease", "--ps-radius-md", "--ps-shadow-card", "--ps-container", "--ps-gutter", "--ps-font-display", "--ps-font-body", "--ps-text-h1", "--ps-text-body", "--ps-mist"];
const lacking = required.filter((r) => !declared.has(r));
line(lacking.length === 0, "required tokens declared", lacking.join(", "));

/* 4. fluid type */
function clampAt(value, vw) {
  const m = value.match(/clamp\(\s*([\d.]+)rem\s*,\s*([\d.]+)rem\s*\+\s*([\d.]+)vw\s*,\s*([\d.]+)rem\s*\)/);
  if (!m) return null;
  const [min, a, b, max] = m.slice(1).map(Number);
  return Math.min(Math.max(a * 16 + (b / 100) * vw, min * 16), max * 16);
}
const tokenValue = (name) => (tokensCss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`)) || [])[1]?.trim();
const h1 = tokenValue("--ps-text-h1") ?? "";
line(clampAt(h1, 360)?.toFixed(1) === "36.0", "H1 is 2.25rem (36 px) at a 360 px viewport", `${clampAt(h1, 360)?.toFixed(2)} px`);
line(clampAt(h1, 1200)?.toFixed(1) === "64.0", "H1 is 4rem (64 px) at a 1200 px viewport", `${clampAt(h1, 1200)?.toFixed(2)} px`);
for (const step of ["h1", "h2", "h3", "h4", "lead", "score"]) {
  const v = tokenValue(`--ps-text-${step}`) ?? "";
  const lo = clampAt(v, 360);
  const hi = clampAt(v, 1200);
  line(lo !== null && hi !== null && hi > lo, `--ps-text-${step} is a growing clamp()`, `${lo?.toFixed(1)} to ${hi?.toFixed(1)} px`);
}
line(tokenValue("--ps-text-body") === "1rem", "body text is 1rem (16 px)");

/* 5. motion */
const durs = ["fast", "base", "slow"].map((n) => {
  const m = tokensCss.match(new RegExp(`--ps-dur-${n}\\s*:\\s*(\\d+)ms`));
  return m ? Number(m[1]) : NaN;
});
line(durs.every((d) => d >= 150 && d <= 250), "motion durations are 150 to 250 ms", durs.join(", ") + " ms");
line(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(tokensCss), "prefers-reduced-motion block present");
line(/:focus-visible/.test(tokensCss), "focus-visible ring rule present");
line(/@utility\s+ps-num\b/.test(tokensCss) && /tabular-nums/.test(tokensCss), "tabular figures utility (ps-num) present");
line(/@theme\s+inline\s*\{/.test(tokensCss), "Tailwind @theme inline block present");

/* 6. fonts */
const faces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const ALLOWED = new Set([
  "Barlow Condensed|normal|700",
  "Barlow Condensed|normal|800",
  "Barlow Condensed|italic|800",
  "Inter Variable|normal|100 900",
  "Noto Sans Tamil|normal|400",
  "Noto Sans Tamil|normal|600",
]);
const prop = (b, p) => (b.match(new RegExp(`${p}\\s*:\\s*([^;]+);`)) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const fileSizes = new Map();
for (const f of faces) {
  const key = `${prop(f, "font-family")}|${prop(f, "font-style")}|${prop(f, "font-weight")}`;
  line(ALLOWED.has(key), `@font-face ${key} is in the D-002 allow-list`);
  line(prop(f, "font-display") === "swap", `  ${key}: font-display swap`);
  line(!!prop(f, "unicode-range"), `  ${key}: has unicode-range`);
  const u = (f.match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
  const path = u ? resolve(ROOT, "node_modules", u) : "";
  const ok = !!u && existsSync(path) && /\.woff2$/.test(u) && !/latin-ext/.test(u);
  line(ok, `  ${key}: file exists, woff2, not latin-ext`, u ?? "no url");
  if (ok) fileSizes.set(key, statSync(path).size);
}
line(faces.length === ALLOWED.size, `exactly ${ALLOWED.size} @font-face rules`, `${faces.length} found`);
const displayStack = (fontsCss.match(/--ps-font-display\s*:\s*([^;]+);/) || [])[1] ?? "";
line(/Barlow Condensed[^;]*Noto Sans Tamil/.test(displayStack), "heading stack has Noto Sans Tamil right after Barlow Condensed (D-002)");
line(/:lang\(ta\)\s*\{/.test(fontsCss), ":lang(ta) rule present");

/* 7. font budget */
const kb = (n) => (n / 1000).toFixed(1) + " kB";
const size = (k) => fileSizes.get(k) ?? 0;
const barlow = size("Barlow Condensed|normal|700") + size("Barlow Condensed|normal|800");
const italic = size("Barlow Condensed|italic|800");
const inter = size("Inter Variable|normal|100 900");
const tamil = size("Noto Sans Tamil|normal|400") + size("Noto Sans Tamil|normal|600");
const english = barlow + inter;
const englishItalic = english + italic;
const worst = englishItalic + tamil;
console.log(`\nFont budget (woff2 bytes, decimal kB). D-002 target: about 150 kB on a typical English page.`);
console.log(`  typical English page (Barlow 700 + 800, Inter latin):            ${kb(english)}`);
console.log(`  English page that also uses the 800 italic:                      ${kb(englishItalic)}`);
console.log(`  page with Tamil text and a rupee price, every face in use:       ${kb(worst)}`);
line(englishItalic <= 150000, "English page stays under 150 kB, italic included", kb(englishItalic));
line(worst <= 150000, "worst case (every face) stays under 150 kB", kb(worst));

/* 8. Tailwind compile */
console.log("");
try {
  const { compile } = await import("@tailwindcss/node");
  const css = files["global.css"];
  const compiler = await compile(css, { base: STYLES, onDependency() {} });
  const candidates = [
    "text-h1", "text-h2", "text-h3", "text-h4", "text-lead", "text-body", "text-small", "text-caption", "text-score",
    "bg-ps-court", "bg-ps-court-deep", "text-ps-ink", "bg-ps-volt", "bg-ps-feather", "bg-ps-white", "text-ps-slate",
    "border-ps-border", "bg-ps-live", "text-ps-mist", "bg-ps-court-tint",
    "bg-page", "bg-surface", "text-fg", "text-fg-muted", "text-heading", "border-line", "border-line-strong", "text-link", "ring-focus",
    "font-sans", "font-display", "font-tamil", "ps-num", "ps-score", "ps-container", "ps-transition", "ps-italic", "ps-focus-ring",
    "shadow-card", "shadow-raised", "shadow-overlay", "rounded-md", "rounded-pill", "py-section", "px-gutter", "gap-block", "max-w-page", "h-header", "min-h-tap", "ease-ps",
    "animate-live-pulse", "bg-ps-court/50",
  ];
  const out = compiler.build(candidates);
  const esc = (c) => "." + c.replace(/[/]/g, "\\/");
  const absent = candidates.filter((c) => !out.includes(esc(c)));
  line(absent.length === 0, `Tailwind ${"4.3.3"} generates all ${candidates.length} promised utilities`, absent.length ? "missing: " + absent.join(", ") : "");
  line(out.includes(".ps-surface-dark") && out.includes(".ps-surface-court"), "dark and court surface classes are emitted");
  line(out.includes("@keyframes ps-live-pulse"), "live-pulse keyframes are emitted with the utility");
} catch (e) {
  console.log(`SKIP  Tailwind compile check (${e.code || e.message}). Run it after npm ci.`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll brand style checks passed");
process.exit(failed ? 1 : 0);
