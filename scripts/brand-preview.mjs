#!/usr/bin/env node
/**
 * Builds docs/brand-preview.html: ONE self-contained file for the owner to open on a phone or from disk.
 *
 *   node scripts/brand-preview.mjs
 *
 * Self-contained means: inline CSS, inline SVG, fonts embedded as base64 woff2, no script, no external request.
 * Everything is generated from the real sources so the preview cannot drift from the kit:
 *   colours and contrast  src/styles/tokens.css + scripts/brand-contrast.mjs
 *   type, stacks, Tamil   src/styles/fonts.css (the same @font-face rules, files inlined)
 *   logos                 public/brand/*.svg and public/favicon.svg (run scripts/brand-logo.mjs first)
 *   taglines              the three options in spec 5.1, none pre-selected (the owner chooses, OT-23)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { evaluate, parseTokens, SPEC_TOKENS } from "./brand-contrast.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const tokensCss = read("src/styles/tokens.css");
const fontsCss = read("src/styles/fonts.css");
// The real component recipes, with the two court-line SVG files inlined as data URIs (the preview makes no network request).
const dataSvg = (f) => "url(data:image/svg+xml;base64," + readFileSync(resolve(ROOT, "public/brand", f)).toString("base64") + ")";
const componentsCss = read("src/styles/components.css")
  .replace('url("/brand/court-lines.svg")', dataSvg("court-lines.svg"))
  .replace('url("/brand/court-lines-ink.svg")', dataSvg("court-lines-ink.svg"))
  .replaceAll('url("/brand/court-lines.svg")', dataSvg("court-lines.svg"))
  .replaceAll('url("/brand/court-lines-ink.svg")', dataSvg("court-lines-ink.svg"));
const T = parseTokens();
const { rows, refs } = evaluate(T);

/* ------------------------------------------------------------------ pieces lifted from the real CSS */
const rootBlock = tokensCss.match(/:root\s*\{[^}]*\}/)[0];
const gutterBlocks = [...tokensCss.matchAll(/@media \(min-width: (?:48|80)rem\)\s*\{\s*:root\s*\{[^}]*\}\s*\}/g)].map((m) => m[0]);
const surfaceBlocks = [...tokensCss.matchAll(/\.ps-surface-(?:dark|court)\s*\{[^}]*\}/g)].map((m) => m[0]);
const fontStacks = fontsCss.match(/:root\s*\{[^}]*\}/)[0];
const langTa = fontsCss.match(/:lang\(ta\)\s*\{[^}]*\}/)[0];
const faces = [...fontsCss.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) =>
  m[0].replace(/url\("(@fontsource[^"]+)"\)/g, (_, p) => {
    const b64 = readFileSync(resolve(ROOT, "node_modules", p)).toString("base64");
    return `url(data:font/woff2;base64,${b64})`;
  }),
);

/* ------------------------------------------------------------------ inline SVG helper */
let svgCount = 0;
function inlineSvg(file, { width, label = "", className = "" } = {}) {
  const prefix = `s${++svgCount}`;
  let t = read(file)
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sxmlns="[^"]*"/, "")
    .replace(/\sid="([^"]+)"/g, (_, id) => ` id="${prefix}-${id}"`)
    .replace(/aria-labelledby="t"/, `aria-labelledby="${prefix}-t"`)
    .replace(/<svg([^>]*?)\swidth="[\d.]+"\sheight="[\d.]+"/, `<svg$1${width ? ` width="${width}"` : ""}`);
  if (className) t = t.replace("<svg ", `<svg class="${className}" `);
  if (label) t = t.replace(/<title id="[^"]+">[^<]*<\/title>/, (m) => m.replace(/>[^<]*</, `>${esc(label)}<`));
  return t.trim();
}

/* ------------------------------------------------------------------ data blocks */
const swatches = [
  ...SPEC_TOKENS.map((n) => ({ name: n, hex: T[n], spec: true })),
  ...["mist", "ink-soft", "court-tint", "live-tint", "border-on-dark"].map((n) => ({ name: n, hex: T[n], spec: false })),
];
const roles = {
  court: "Primary: buttons, links, key headings",
  "court-deep": "Hover states, dark sections",
  ink: "Body text, broadcast dark backgrounds",
  volt: "Accent on DARK only. CTA fill with ink text",
  feather: "Page background",
  white: "Cards, court lines, text on dark",
  slate: "Secondary text (light surfaces only)",
  border: "Decorative borders and dividers",
  live: "LIVE badges, critical alerts",
  mist: "Secondary text on dark (derived)",
  "ink-soft": "Card surface inside a dark section (derived)",
  "court-tint": "Selected chip, soft background (derived)",
  "live-tint": "Soft alert background (derived)",
  "border-on-dark": "Divider on dark sections (derived)",
};
const lightText = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  return l < 0.55 ? T.white : T.ink;
};

const groups = [
  ["Text on light surfaces", (r) => /^L/.test(r.id)],
  ["Filled buttons, badges and chips", (r) => /^F/.test(r.id)],
  ["Text on dark surfaces", (r) => /^D/.test(r.id)],
  ["Focus rings and control edges (3:1)", (r) => /^U/.test(r.id)],
];
const chip = (r, banned = false) => {
  const bd = r.bg === "white" || r.bg === "feather" || r.bgHex === T.feather ? `box-shadow: inset 0 0 0 1px ${T.border};` : "";
  const sample = r.kind === "ui" ? `<span class="pv-ui" style="border-color:${r.fgHex}"></span>` : "Aa";
  return `<li class="pv-chip${banned ? " pv-banned" : ""}" style="background:${r.bgHex};color:${r.fgHex};${bd}">
      <span class="pv-chip-sample">${sample}</span>
      <span class="pv-chip-meta"><b>${r.ratioShown.toFixed(2)}:1</b> ${banned ? "do not use" : r.verdict}<br>${esc(r.fg)} on ${esc(r.bg)}</span>
    </li>`;
};

const pass = rows.filter((r) => r.verdict === "PASS").length;
const fail = rows.filter((r) => r.verdict === "FAIL").length;
const banned = rows.filter((r) => r.verdict === "BANNED");
const refOk = refs.filter((r) => r.matches).length;

const taglines = [
  ["A", "Tamil Nadu badminton, on record."],
  ["B", "Every player. Every match. Every smash."],
  ["C", "Where Tamil Nadu badminton lives."],
];

const scale = [
  ["H1", "text-h1", "2.25rem to 4rem", "36 to 64 px", "1.0", "Barlow Condensed 800, uppercase"],
  ["H2", "text-h2", "1.75rem to 2.75rem", "28 to 44 px", "1.05", "Barlow Condensed 800, uppercase"],
  ["H3", "text-h3", "1.375rem to 1.875rem", "22 to 30 px", "1.15", "Barlow Condensed 700"],
  ["H4", "text-h4", "1.125rem to 1.375rem", "18 to 22 px", "1.25", "Barlow Condensed 700"],
  ["Lead", "text-lead", "1.0625rem to 1.25rem", "17 to 20 px", "1.55", "Inter 400"],
  ["Body", "text-body", "1rem", "16 px", "1.6", "Inter 400"],
  ["Small", "text-small", "0.875rem", "14 px", "1.5", "Inter 400 to 600"],
  ["Caption", "text-caption", "0.75rem", "12 px", "1.4", "Inter 500"],
];

/* ------------------------------------------------------------------ page */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Power Smash brand preview (draft)</title>
<style>
${faces.join("\n")}
${rootBlock}
${gutterBlocks.join("\n")}
${fontStacks}
${surfaceBlocks.join("\n")}
${langTa}
${componentsCss}
@media (prefers-reduced-motion: reduce) { :root { --ps-dur-fast: 0.01ms; --ps-dur-base: 0.01ms; --ps-dur-slow: 0.01ms; } *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0; background: var(--ps-bg); color: var(--ps-fg); font-family: var(--ps-font-body); font-size: var(--ps-text-body); line-height: var(--ps-lh-body); overflow-wrap: break-word; }
h1, h2, h3, h4 { font-family: var(--ps-font-display); color: var(--ps-heading); margin: 0; text-wrap: balance; }
h1 { font-size: var(--ps-text-h1); line-height: var(--ps-lh-h1); font-weight: 800; text-transform: uppercase; letter-spacing: .005em; }
h2 { font-size: var(--ps-text-h2); line-height: var(--ps-lh-h2); font-weight: 800; text-transform: uppercase; letter-spacing: .005em; }
h3 { font-size: var(--ps-text-h3); line-height: var(--ps-lh-h3); font-weight: 700; }
h4 { font-size: var(--ps-text-h4); line-height: var(--ps-lh-h4); font-weight: 700; }
p { margin: 0 0 var(--ps-space-2); }
a:not([class]) { color: var(--ps-link); text-underline-offset: .2em; }
a:not([class]):hover { color: var(--ps-link-hover); }
:where(a, button, input, [tabindex]):focus-visible { outline: var(--ps-focus-width) solid var(--ps-focus); outline-offset: var(--ps-focus-offset); }
svg { display: block; max-width: 100%; height: auto; }
ul { margin: 0; padding: 0; list-style: none; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875em; background: var(--ps-court-tint); color: var(--ps-ink); padding: .1em .35em; border-radius: var(--ps-radius-sm); }
table { border-collapse: collapse; width: 100%; font-size: var(--ps-text-small); }
th, td { text-align: left; padding: var(--ps-space-1) var(--ps-space-2) var(--ps-space-1) 0; border-bottom: 1px solid var(--ps-line); vertical-align: top; }
th { font-weight: 600; color: var(--ps-fg-muted); }
.wrap { width: 100%; max-width: calc(var(--ps-container) + 2 * var(--ps-gutter)); margin-inline: auto; padding-inline: var(--ps-gutter); }
.pv-hero { padding-block: var(--ps-space-6) var(--ps-space-8); background-image: none; }
.pv-hero .logo { width: min(100%, 22rem); margin-bottom: var(--ps-space-4); }
.pv-draft { display: inline-block; background: var(--ps-volt); color: var(--ps-ink); font-weight: 700; font-size: var(--ps-text-small); letter-spacing: .06em; text-transform: uppercase; padding: .15rem .6rem; border-radius: var(--ps-radius-pill); margin-bottom: var(--ps-space-2); }
.pv-nav { display: flex; flex-wrap: wrap; gap: var(--ps-space-1) var(--ps-space-3); margin-top: var(--ps-space-3); font-size: var(--ps-text-small); }
.pv-nav a { color: var(--ps-volt); }
section.pv { padding-block: var(--ps-section); }
section.pv + section.pv { border-top: 1px solid var(--ps-line); }
.pv-lead { font-size: var(--ps-text-lead); line-height: var(--ps-lh-lead); color: var(--ps-fg-muted); max-width: 46rem; margin-top: var(--ps-space-2); }
.pv-grid { display: grid; gap: var(--ps-space-3); margin-top: var(--ps-block); }
@media (min-width: 40rem) { .pv-grid.cols-2 { grid-template-columns: 1fr 1fr; } .pv-grid.cols-3 { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 64rem) { .pv-grid.cols-4 { grid-template-columns: repeat(4, 1fr); } }
.pv-card { background: var(--ps-surface); border: 1px solid var(--ps-line); border-radius: var(--ps-radius-lg); padding: var(--ps-space-3); box-shadow: var(--ps-shadow-card); }
.pv-card h3 { margin-bottom: var(--ps-space-1); }
.pv-cap { font-size: var(--ps-text-caption); line-height: var(--ps-lh-caption); color: var(--ps-fg-muted); margin: var(--ps-space-1) 0 0; }
.pv-stage { border-radius: var(--ps-radius-md); padding: var(--ps-space-3); display: flex; align-items: center; justify-content: center; min-height: 7rem; }
.pv-stage.light { background: var(--ps-feather); box-shadow: inset 0 0 0 1px var(--ps-border); }
.pv-stage.white { background: var(--ps-white); box-shadow: inset 0 0 0 1px var(--ps-border); }
.pv-stage.dark { background: var(--ps-ink); }
.pv-row { display: flex; flex-wrap: wrap; gap: var(--ps-space-2); align-items: center; }
.pv-todo { position: relative; }
.pv-todo-zone { position: absolute; left: 12.5%; width: 75%; top: 64.3%; height: 14.3%; border: 2px dashed var(--ps-volt); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--ps-volt); font-size: var(--ps-text-caption); font-weight: 600; text-align: center; line-height: 1.1; background: rgba(11, 20, 22, .55); }
.pv-tag { display: block; width: 100%; text-align: left; }
.pv-tag-opt { font-size: var(--ps-text-small); font-weight: 700; letter-spacing: .08em; color: var(--ps-mist); text-transform: uppercase; }
.pv-tag-text { font-family: var(--ps-font-display); font-weight: 800; text-transform: uppercase; font-size: clamp(1.75rem, 1.2rem + 2vw, 2.5rem); line-height: 1.05; color: var(--ps-white); margin-top: var(--ps-space-1); }
.pv-tag-card { background: var(--ps-ink); border-radius: var(--ps-radius-lg); padding: var(--ps-space-4) var(--ps-space-3); position: relative; overflow: hidden; }
.pv-tag-card::after { content: ""; position: absolute; left: 0; top: 0; right: 0; height: 6px; background: var(--ps-court); }
.pv-sw { border-radius: var(--ps-radius-md); padding: var(--ps-space-2); min-height: 8.5rem; display: flex; flex-direction: column; justify-content: flex-end; box-shadow: inset 0 0 0 1px rgba(11, 20, 22, .12); }
.pv-sw b { font-family: var(--ps-font-display); font-size: var(--ps-text-h4); text-transform: uppercase; }
.pv-sw span { font-size: var(--ps-text-caption); line-height: 1.35; }
.pv-sw .tag { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; opacity: .9; }
.pv-chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); gap: var(--ps-space-1); margin-top: var(--ps-space-2); }
.pv-chip { border-radius: var(--ps-radius-md); padding: var(--ps-space-1) var(--ps-space-2); display: flex; align-items: center; gap: var(--ps-space-2); font-size: var(--ps-text-caption); line-height: 1.3; }
.pv-chip-sample { font-family: var(--ps-font-display); font-weight: 800; font-size: 1.75rem; line-height: 1; min-width: 2.25rem; display: inline-flex; align-items: center; justify-content: center; }
.pv-ui { display: inline-block; width: 2rem; height: 1.25rem; border: 3px solid; border-radius: 6px; }
.pv-banned { outline: 2px dashed var(--ps-live); outline-offset: -3px; }
.pv-banned .pv-chip-sample { text-decoration: line-through; }
.pv-scale { display: grid; gap: var(--ps-space-3); margin-top: var(--ps-block); }
.pv-scale-row { border-bottom: 1px solid var(--ps-line); padding-bottom: var(--ps-space-2); }
.pv-scale-meta { font-size: var(--ps-text-caption); color: var(--ps-fg-muted); margin-top: 4px; }
.pv-sample-h1 { font-size: var(--ps-text-h1); line-height: var(--ps-lh-h1); }
.pv-num { font-variant-numeric: tabular-nums lining-nums; }
.pv-num-prop { font-variant-numeric: proportional-nums; }
.pv-score { font-family: var(--ps-font-display); font-weight: 800; font-size: var(--ps-text-score); line-height: var(--ps-lh-score); font-variant-numeric: tabular-nums lining-nums; }
.pv-btn { font: inherit; font-weight: 600; min-height: var(--ps-tap); padding: 0 var(--ps-space-3); border-radius: var(--ps-radius-md); border: 2px solid transparent; cursor: pointer; transition: background-color var(--ps-dur-base) var(--ps-ease), color var(--ps-dur-base) var(--ps-ease), box-shadow var(--ps-dur-base) var(--ps-ease), transform var(--ps-dur-fast) var(--ps-ease); display: inline-flex; align-items: center; justify-content: center; }
.pv-btn:active { transform: translateY(1px); }
.pv-btn.primary { background: var(--ps-court); color: var(--ps-white); }
.pv-btn.primary:hover, .pv-btn.primary.is-hover { background: var(--ps-court-deep); }
.pv-btn.cta { background: var(--ps-volt); color: var(--ps-ink); }
.pv-btn.cta:hover, .pv-btn.cta.is-hover { background: var(--ps-white); }
.pv-btn.outline { background: transparent; color: var(--ps-court); border-color: var(--ps-line-strong); }
.pv-btn.outline:hover { background: var(--ps-court-tint); }
.pv-btn.focus-demo { outline: var(--ps-focus-width) solid var(--ps-focus); outline-offset: var(--ps-focus-offset); }
.ps-surface-dark .pv-btn.outline { color: var(--ps-white); }
.ps-surface-dark .pv-btn.outline:hover { background: var(--ps-ink-soft); }
.pv-badge { display: inline-flex; align-items: center; gap: 6px; font-size: var(--ps-text-caption); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 3px 10px; border-radius: var(--ps-radius-pill); line-height: 1.4; }
.pv-badge.live { background: var(--ps-live); color: var(--ps-white); }
.pv-badge.live i { width: 8px; height: 8px; border-radius: 50%; background: var(--ps-white); animation: pv-pulse 1.6s ease-in-out infinite; }
@keyframes pv-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .55; transform: scale(.8); } }
.pv-badge.cat { background: var(--ps-court-tint); color: var(--ps-court); }
.pv-badge.level { background: var(--ps-ink); color: var(--ps-volt); }
.pv-badge.alert { background: var(--ps-live-tint); color: var(--ps-live); }
.pv-ribbon { background: var(--ps-volt); color: var(--ps-ink); font-weight: 700; font-size: var(--ps-text-caption); letter-spacing: .06em; text-transform: uppercase; padding: 3px 12px 3px 10px; clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%); }
.pv-mcard { background: var(--ps-white); border: 1px solid var(--ps-line); border-radius: var(--ps-radius-lg); overflow: hidden; box-shadow: var(--ps-shadow-card); transition: box-shadow var(--ps-dur-base) var(--ps-ease), transform var(--ps-dur-base) var(--ps-ease); max-width: 22rem; }
.pv-mcard:hover { box-shadow: var(--ps-shadow-raised); transform: translateY(-2px); }
.pv-thumb { aspect-ratio: 16 / 9; background: var(--ps-ink); position: relative; display: flex; align-items: flex-end; padding: var(--ps-space-1); }
.pv-thumb .court { position: absolute; inset: 0; opacity: .5; }
.pv-thumb .dur { position: relative; margin-left: auto; background: var(--ps-ink); color: var(--ps-white); font-size: var(--ps-text-caption); font-weight: 600; padding: 1px 6px; border-radius: 4px; }
.pv-thumb .badges { position: absolute; left: var(--ps-space-1); top: var(--ps-space-1); display: flex; gap: 6px; }
.pv-vs { display: flex; align-items: stretch; font-family: var(--ps-font-display); font-weight: 800; text-transform: uppercase; font-size: var(--ps-text-h4); line-height: 1.1; margin: var(--ps-space-2) calc(-1 * var(--ps-space-2)) 0 0; }
.pv-vs .a, .pv-vs .b { background: var(--ps-ink); color: var(--ps-white); padding: 6px 12px; clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }
.pv-vs .b { clip-path: polygon(10px 0, 100% 0, 100% 100%, 0 100%); margin-left: -10px; padding-left: 20px; }
.pv-vs .x { background: var(--ps-volt); color: var(--ps-ink); padding: 6px 10px; z-index: 1; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
.pv-mbody { padding: var(--ps-space-2); }
.pv-mmeta { color: var(--ps-fg-muted); font-size: var(--ps-text-small); margin: 6px 0 0; }
.pv-field { width: 100%; font: inherit; min-height: var(--ps-tap); padding: 0 var(--ps-space-2); border-radius: var(--ps-radius-md); border: 2px solid var(--ps-line-strong); background: var(--ps-white); color: var(--ps-ink); }
.pv-field::placeholder { color: var(--ps-slate); opacity: 1; }
.pv-rad { width: 4.5rem; height: 4.5rem; background: var(--ps-court); }
.pv-shadow { width: 100%; height: 4.5rem; background: var(--ps-white); border-radius: var(--ps-radius-md); display: flex; align-items: center; justify-content: center; font-size: var(--ps-text-caption); color: var(--ps-fg-muted); }
.pv-bar { height: 12px; background: var(--ps-court); border-radius: 2px; }
.pv-motion { background: var(--ps-court); color: var(--ps-white); border-radius: var(--ps-radius-md); padding: var(--ps-space-1) var(--ps-space-2); font-size: var(--ps-text-small); transition: transform var(--d) var(--ps-ease), background-color var(--d) var(--ps-ease); }
.pv-motion:hover, .pv-motion:focus-visible { transform: translateX(8px); background: var(--ps-court-deep); }
footer { padding-block: var(--ps-space-6); }
footer li { margin-bottom: 6px; }
.note { background: var(--ps-live-tint); border-left: 6px solid var(--ps-live); border-radius: var(--ps-radius-md); padding: var(--ps-space-2) var(--ps-space-3); margin-top: var(--ps-block); color: var(--ps-ink); }
.note.ok { background: var(--ps-court-tint); border-color: var(--ps-court); }
</style>
</head>
<body>

<header class="ps-surface-dark pv-hero">
  <div class="wrap">
    <span class="pv-draft">Draft for your approval</span>
    ${inlineSvg("public/brand/logo-full-dark.svg", { className: "logo", label: "Power Smash logo, dark version" })}
    <h1>Brand preview</h1>
    <p class="pv-lead" style="color: var(--ps-mist)">Milestone M0 (OT-23). Original draft: nothing here is a photo of a player or a copy of a federation or broadcast mark. Please look at the logo, pick one tagline, and tell me yes or what to change.</p>
    <nav class="pv-nav" aria-label="Sections"><a href="#logo">Logo</a><a href="#tagline">Tagline</a><a href="#colour">Colour</a><a href="#type">Type and Tamil</a><a href="#components">Components</a><a href="#tokens">Tokens</a><a href="#files">Files</a></nav>
  </div>
</header>

<main>

<section class="pv" id="decide">
  <div class="wrap">
    <h2>Three things I need from you</h2>
    <ul class="pv-grid cols-3">
      <li class="pv-card"><h3>1. The logo</h3><p>Reply <b>yes</b>, or tell me what to change (colour, slant, the speed bar, the shuttle). If a designer has files, send them: they can replace these without any code change.</p></li>
      <li class="pv-card"><h3>2. One tagline</h3><p>Pick <b>A</b>, <b>B</b> or <b>C</b> in section 2. I have not pre-selected one, and the tagline is not in the social image yet.</p></li>
      <li class="pv-card"><h3>3. Tamil lines</h3><p>The Tamil here is a <b>draft</b> from the copy deck. A native Tamil speaker must check wording and how it looks on a phone before launch.</p></li>
    </ul>
  </div>
</section>

<section class="pv" id="logo">
  <div class="wrap">
    <h2>1. Logo</h2>
    <p class="pv-lead">POWER SMASH in a heavy condensed italic, with a shuttle diving to the lower right and speed streaks behind it. The letters are drawn as outlines, so they look the same on every phone and need no font.</p>

    <div class="pv-grid cols-2">
      <div class="pv-card"><h3>Full logo, light</h3>
        <div class="pv-stage light">${inlineSvg("public/brand/logo-full-light.svg", { label: "Power Smash logo, light version" })}</div>
        <p class="pv-cap">For light pages. POWER in ink, SMASH and the shuttle trail in court green. Volt never appears on light.</p></div>
      <div class="pv-card"><h3>Full logo, dark</h3>
        <div class="pv-stage dark">${inlineSvg("public/brand/logo-full-dark.svg", { label: "Power Smash logo, dark version" })}</div>
        <p class="pv-cap">For the dark broadcast sections. White and volt on ink.</p></div>
      <div class="pv-card"><h3>Symbol</h3>
        <div class="pv-row">
          <div class="pv-stage light" style="flex:1">${inlineSvg("public/brand/logo-symbol.svg", { width: 120, label: "Shuttle trail symbol, light version" })}</div>
          <div class="pv-stage dark" style="flex:1">${inlineSvg("public/brand/logo-symbol-dark.svg", { width: 120, label: "Shuttle trail symbol, dark version" })}</div>
        </div>
        <p class="pv-cap">The shuttle-trail symbol alone, light and dark.</p></div>
      <div class="pv-card"><h3>Social avatar and favicon</h3>
        <div class="pv-row">
          ${inlineSvg("public/brand/social-avatar.svg", { width: 128, label: "Social avatar, square" })}
          <div style="border-radius:50%;overflow:hidden;width:96px;height:96px">${inlineSvg("public/brand/social-avatar.svg", { width: 96, label: "Social avatar as a circle crop" })}</div>
          ${inlineSvg("public/favicon.svg", { width: 64, label: "Favicon 64 px" })}
          ${inlineSvg("public/favicon.svg", { width: 32, label: "Favicon 32 px" })}
          ${inlineSvg("public/favicon.svg", { width: 16, label: "Favicon 16 px" })}
        </div>
        <p class="pv-cap">Avatar square and as a circle (YouTube, WhatsApp and Instagram crop to a circle); favicon at 64, 32 and 16 px. It replaces the photograph on the channel.</p></div>
    </div>

    <div class="pv-card" style="margin-top: var(--ps-space-3)"><h3>Default social-share image (1200 x 630)</h3>
      <div class="pv-todo" style="max-width: 40rem">
        ${inlineSvg("public/brand/og-default.svg", { label: "Default social share image" })}
        <div class="pv-todo-zone">Tagline zone: empty until you choose</div>
      </div>
      <p class="pv-cap">The dashed box marks where the tagline will go. The real file has no tagline and no placeholder text in it. Note: WhatsApp and Facebook need a PNG or JPEG for link previews, so a raster copy is made when a tool is approved (see Files).</p></div>

    <div class="pv-card" style="margin-top: var(--ps-space-3)"><h3>Small-size check</h3>
      <div class="pv-row">
        <div class="pv-stage light">${inlineSvg("public/brand/logo-full-light.svg", { width: 160, label: "Light logo at 160 px" })}</div>
        <div class="pv-stage dark">${inlineSvg("public/brand/logo-full-dark.svg", { width: 160, label: "Dark logo at 160 px" })}</div>
        <div class="pv-stage light">${inlineSvg("public/brand/logo-symbol.svg", { width: 32, label: "Symbol at 32 px" })}</div>
        <div class="pv-stage dark">${inlineSvg("public/brand/logo-symbol-dark.svg", { width: 32, label: "Symbol at 32 px, dark" })}</div>
      </div>
      <p class="pv-cap">Header size (160 px wide) and icon size (32 px). On a 360 px phone the header logo is this size.</p></div>
  </div>
</section>

<section class="pv" id="tagline">
  <div class="wrap">
    <h2>2. Tagline: you choose</h2>
    <p class="pv-lead">The three options from the brief, shown the same way. None is selected. Reply with the letter you want.</p>
    <ul class="pv-grid cols-3">
      ${taglines
        .map(
          ([k, t]) => `<li class="pv-tag-card"><span class="pv-tag-opt">Option ${k}</span><div class="pv-tag-text">${esc(t)}</div></li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>

<section class="pv" id="colour">
  <div class="wrap">
    <h2>3. Colour</h2>
    <p class="pv-lead">Nine colours from the brief, and five more I derived to close gaps the contrast check found (marked "derived": they need your or a designer's approval).</p>
    <ul class="pv-grid cols-3" style="grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr))">
      ${swatches
        .map(
          (s) => `<li class="pv-sw" style="background:${s.hex};color:${lightText(s.hex)}"><span class="tag">${s.spec ? "From the brief" : "Derived"}</span><b>${esc(s.name)}</b><span>${s.hex}</span><span>${esc(roles[s.name])}</span></li>`,
        )
        .join("\n      ")}
    </ul>

    <h3 style="margin-top: var(--ps-section)">Contrast results (WCAG 2.2)</h3>
    <div class="note ok"><b>${pass} pairs pass, ${fail} fail.</b> Another ${banned.length} are listed as "do not use" on purpose, to show why the rule exists. Of the 4 reference ratios printed in the brief, ${refOk} match.${refs
      .filter((r) => !r.matches)
      .map((r) => ` ${esc(r.fg)} on ${esc(r.bg)} is ${r.shown.toFixed(2)}:1, not ${r.claimed}:1 (better than the brief says).`)
      .join("")}</div>
    ${groups
      .map(
        ([title, fn]) => `<h4 style="margin-top: var(--ps-block)">${title}</h4>
    <ul class="pv-chips">${rows.filter(fn).map((r) => chip(r)).join("\n")}</ul>`,
      )
      .join("\n    ")}
    <h4 style="margin-top: var(--ps-block)">Do not use (these fail on purpose)</h4>
    <ul class="pv-chips">${banned.map((r) => chip(r, true)).join("\n")}</ul>
    <p class="pv-cap" style="margin-top: var(--ps-space-2)">Text needs 4.5:1, large text (24 px, or 19 px bold) and controls need 3:1. The key rules: volt is never text on a light background (about 1.2:1); the brief's border colour is for dividers only, never the only edge of a field or button; secondary text on dark uses the derived mist colour, not slate; red on dark is never text (use a red fill with white text).</p>
  </div>
</section>

<section class="pv" id="type">
  <div class="wrap">
    <h2>4. Type and Tamil</h2>
    <p class="pv-lead">Barlow Condensed for headings, Inter for body and numbers, Noto Sans Tamil for Tamil. All self-hosted. The sizes below are live: resize the window and they move between the phone size and the desktop size.</p>

    <div class="pv-scale">
      ${scale
        .map(([name, , range, px, lh, face]) => {
          const cls = { H1: "h1", H2: "h2", H3: "h3", H4: "h4" }[name];
          const sample = cls
            ? `<${cls}>Every player. Every match.</${cls}>`
            : `<div style="font-size: var(--ps-text-${name.toLowerCase()}); line-height: var(--ps-lh-${name.toLowerCase()}); font-weight: ${name === "Caption" ? 500 : 400}">${name === "Lead" ? "Find your match, share it, and book Power Smash for your next tournament." : name === "Body" ? "Watch all your badminton matches in one place and share them on WhatsApp." : name === "Small" ? "Match date, tournament, round and category." : "Views, duration, date"}</div>`;
          return `<div class="pv-scale-row">${sample}<div class="pv-scale-meta">${name}: ${range} (${px}) on the 360 to 1200 px range, line height ${lh}, ${face}</div></div>`;
        })
        .join("\n      ")}
      <div class="pv-scale-row"><div class="pv-score">21 : 19</div><div class="pv-scale-meta">Scoreboard numerals: 2.5rem to 4.5rem (40 to 72 px), Barlow Condensed 800, tabular figures. Sample layout, not a real score.</div></div>
    </div>

    <div class="pv-grid cols-2">
      <div class="pv-card"><h3>Italic for energy</h3>
        <p style="font-family: var(--ps-font-display); font-style: italic; font-weight: 800; font-size: var(--ps-text-h2); line-height: 1.05; text-transform: uppercase; color: var(--ps-court); margin: 0">Smash it</p>
        <p class="pv-cap">Barlow Condensed 800 italic is the only italic loaded. Use the <code>ps-italic</code> class (a 700 italic would be a faux slant).</p></div>
      <div class="pv-card"><h3>Tabular figures</h3>
        <p class="pv-num" style="margin:0"><b>With tabular figures</b> (stats, prices):<br>1,11,111<br>8,88,888<br>12,345</p>
        <p class="pv-num-prop" style="margin:var(--ps-space-2) 0 0">Without (digits jump):<br>1,11,111<br>8,88,888<br>12,345</p>
        <p class="pv-cap">Price sample: <span class="pv-num">&#8377;1,25,000</span>. The rupee sign is not in the Latin font subsets; it comes from Noto Sans Tamil (about 15 KB, loaded only when a price is on the page).</p></div>
    </div>

    <div class="pv-card" style="margin-top: var(--ps-space-3)">
      <span class="pv-draft" style="background: var(--ps-live-tint); color: var(--ps-live)">Draft Tamil: needs native review</span>
      <h3>Tamil sample, from the copy deck</h3>
      <p lang="ta" class="pv-sample-h1" style="font-family: var(--ps-font-display); font-weight: 800; color: var(--ps-court); margin: var(--ps-space-1) 0">கவரேஜ் புக் செய்யுங்கள்</p>
      <p class="pv-cap">Heading size (Tamil is set smaller than the Latin heading, with taller line height, no capitals, no slant). English: "Book coverage".</p>
      <p lang="ta" style="font-size: var(--ps-text-lead); line-height: var(--ps-lh-lead); margin: var(--ps-space-3) 0 0">வீரர் அல்லது போட்டியைத் தேடுங்கள்…</p>
      <p lang="ta" style="font-weight: 600; margin: 6px 0 0">வீரர் அல்லது போட்டியைத் தேடுங்கள்…</p>
      <p class="pv-cap">Body at weight 400 and 600. English: "Search a player or tournament...". Check on your phone: do the letters join correctly, and is the line height comfortable?</p>
      <div class="pv-row" style="margin-top: var(--ps-space-2)"><button class="pv-btn primary" type="button" lang="ta">கவரேஜ் புக் செய்யுங்கள்</button><button class="pv-btn primary" type="button">Book coverage</button></div>
    </div>
  </div>
</section>

<section class="pv" id="components">
  <div class="wrap">
    <h2>5. Components (samples)</h2>
    <p class="pv-lead">Layout samples with the tokens, not real data. They show the colour rules in use.</p>
    <div class="pv-grid cols-2">
      <div class="pv-card"><h3>Buttons on light</h3>
        <div class="pv-row"><button class="pv-btn primary" type="button">Find your match</button><button class="pv-btn primary is-hover" type="button">Hover</button><button class="pv-btn outline" type="button">Outline</button></div>
        <p class="pv-cap">Court fill with white text (6.25:1); hover goes to court-deep; outline uses a 3:1 edge.</p>
        <div class="pv-row" style="margin-top: var(--ps-space-2)"><button class="pv-btn primary focus-demo" type="button">Keyboard focus</button></div>
        <p class="pv-cap">Focus ring: 3 px court outline, 2 px gap. Tab through this page to see it live.</p></div>
      <div class="pv-card ps-surface-dark" style="border-color: var(--ps-line)"><h3>Buttons on dark</h3>
        <div class="pv-row"><button class="pv-btn cta" type="button">Book coverage</button><button class="pv-btn cta is-hover" type="button">Hover</button><button class="pv-btn outline" type="button">Outline</button></div>
        <p class="pv-cap" style="color: var(--ps-mist)">Volt fill with ink text (14.55:1). The focus ring turns volt on dark.</p>
        <div class="pv-row" style="margin-top: var(--ps-space-2)"><button class="pv-btn cta focus-demo" type="button" style="--ps-focus: var(--ps-volt)">Keyboard focus</button></div>
        <p style="margin: var(--ps-space-2) 0 0">Secondary text uses <b style="color: var(--ps-mist)">mist</b>, links use <a href="#components">volt</a>.</p></div>
      <div class="pv-card"><h3>Badges</h3>
        <div class="pv-row"><span class="pv-badge live"><i></i>Live</span><span class="pv-badge cat">U-15 Boys</span><span class="pv-badge level">District</span><span class="pv-badge alert">Alert</span><span class="pv-ribbon">Featured</span></div>
        <p class="pv-cap">LIVE is a red fill with white text (5.59:1). The dot pulses and stops under reduced-motion. Category, level and alert badges use the tints.</p>
        <label for="pv-f" style="display:block; font-weight:600; margin-top: var(--ps-space-2)">Search</label>
        <input id="pv-f" class="pv-field" placeholder="Search a player or tournament..." type="text">
        <p class="pv-cap">Field edge uses the strong border (slate, 5.20:1), never the pale divider colour.</p></div>
      <div class="pv-card"><h3>Match card</h3>
        <article class="pv-mcard">
          <div class="pv-thumb">
            <svg class="court" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="${T.white}" stroke-opacity=".35" stroke-width=".8"><rect x="14" y="10" width="132" height="70"/><path d="M14 17H146M14 73H146M80 5V85M54 10V80M106 10V80M14 45H54M106 45H146"/></g></svg>
            <div class="badges"><span class="pv-badge cat">U-15 Boys</span></div>
            <span class="dur">12:40</span>
          </div>
          <div class="pv-mbody">
            <div class="pv-vs"><span class="a">Player A</span><span class="x">vs</span><span class="b">Player B</span></div>
            <p class="pv-mmeta">Sample Open &middot; Semi-final &middot; date &middot; views</p>
          </div>
        </article>
        <p class="pv-cap">Layout sample. The "A vs B" lockup follows the broadcast lower-third idea. No real player names are used in this file.</p></div>
    </div>
  </div>
</section>

<section class="pv" id="premium">
  <div class="wrap">
    <p class="ps-eyebrow">Premium upgrade</p>
    <h2>5b. The upgraded recipes</h2>
    <span class="ps-rule" aria-hidden="true"></span>
    <p class="pv-lead" style="margin-top: var(--ps-space-2)">The real classes from <code>src/styles/components.css</code>, shown as the site uses them. Rules: <code>docs/DESIGN_DIRECTION.md</code>.</p>
    <div class="pv-grid cols-2">
      <div class="pv-card ps-surface-dark ps-hero" style="border-color: var(--ps-line)"><h3>Dark hero</h3>
        <p style="color: var(--ps-mist)">Ink to court-deep gradient with faint court lines.</p>
        <div class="pv-row"><a class="ps-btn ps-btn-volt ps-btn-lg" href="#premium">Book coverage</a><a class="ps-btn ps-btn-quiet ps-btn-lg" href="#premium">Chat on WhatsApp</a></div>
        <p style="margin-top: var(--ps-space-3)"><span class="ps-lowerthird">Lower-third tag</span></p></div>
      <div class="pv-card"><h3>Buttons on light</h3>
        <div class="pv-row"><a class="ps-btn ps-btn-primary" href="#premium">Primary</a><a class="ps-btn ps-btn-secondary" href="#premium">Secondary</a><a class="ps-btn ps-btn-quiet" href="#premium">Quiet</a><a class="ps-btn ps-btn-primary ps-btn-sm" href="#premium">Small</a></div>
        <p class="pv-cap">Barlow Condensed uppercase labels, 44 px minimum, lift on hover, press on active.</p>
        <div class="pv-row" style="margin-top: var(--ps-space-2)"><span class="ps-chip ps-chip-court">District</span><span class="ps-chip ps-chip-ink">Covered by Power Smash</span><span class="ps-chip ps-chip-live">Live</span></div></div>
      <article class="ps-card ps-card-hover ps-card-accent" style="padding: 1.75rem 1.25rem 1.25rem"><p class="ps-eyebrow">Package</p><h3 style="margin-top:.5rem">Sample package card</h3><p style="color: var(--ps-fg-muted)">One line summary of the package.</p><p style="border-top:1px solid var(--ps-line);padding-top:1rem;margin-top:1rem;font-family:var(--ps-font-display);font-weight:800;font-size:var(--ps-text-h3)">Price on quote</p><a class="ps-btn ps-btn-primary" href="#premium">Enquire</a></article>
      <div class="ps-surface-dark" style="padding: 1.5rem; border-radius: var(--ps-radius-lg)"><div class="pv-grid cols-2" style="margin:0"><div class="ps-scoreboard"><p style="font-family:var(--ps-font-display);font-weight:800;font-size:var(--ps-text-score);line-height:1;color:var(--ps-volt);margin:0" class="ps-score">88K</p><p class="ps-scoreboard-label">Subscribers</p></div><div class="ps-scoreboard"><p style="font-family:var(--ps-font-display);font-weight:800;font-size:var(--ps-text-score);line-height:1;color:var(--ps-volt);margin:0" class="ps-score">1.2K</p><p class="ps-scoreboard-label">Videos</p></div></div><p class="pv-cap" style="color:var(--ps-mist);margin-top:1rem">Scoreboard counters (sample figures) on a dark band.</p></div>
    </div>
  </div>
</section>

<section class="pv" id="tokens">
  <div class="wrap">
    <h2>6. Other tokens</h2>
    <div class="pv-grid cols-4">
      <div class="pv-card"><h4>Radii</h4><div class="pv-row" style="margin-top: var(--ps-space-1)">${["sm 4", "md 8", "lg 12", "xl 16", "pill"]
        .map((n) => `<div style="text-align:center"><div class="pv-rad" style="border-radius: var(--ps-radius-${n.split(" ")[0]}); width:3.25rem; height:3.25rem"></div><span class="pv-cap">${n}</span></div>`)
        .join("")}</div></div>
      <div class="pv-card"><h4>Shadows</h4>${["card", "raised", "overlay"]
        .map((n) => `<div class="pv-shadow" style="box-shadow: var(--ps-shadow-${n}); margin-top: var(--ps-space-1)">${n}</div>`)
        .join("")}</div>
      <div class="pv-card"><h4>Spacing, 8 px grid</h4>${[1, 2, 3, 4, 6, 8]
        .map((n) => `<div class="pv-row" style="gap: var(--ps-space-1); margin-top: 6px"><div class="pv-bar" style="width: var(--ps-space-${n})"></div><span class="pv-cap" style="margin:0">${n * 8} px</span></div>`)
        .join("")}</div>
      <div class="pv-card"><h4>Motion</h4>${[["fast", "150 ms"], ["base", "200 ms"], ["slow", "250 ms"]]
        .map(([n, ms]) => `<div class="pv-motion" tabindex="0" style="--d: var(--ps-dur-${n}); margin-top: var(--ps-space-1)">${n}, ${ms}</div>`)
        .join("")}<p class="pv-cap">Hover or focus a bar. With reduced-motion on, they do not move.</p></div>
    </div>
  </div>
</section>

</main>

<footer class="ps-surface-dark" id="files">
  <div class="wrap">
    <h2 style="font-size: var(--ps-text-h3)">Files in this kit</h2>
    <ul style="margin-top: var(--ps-space-2)">
      <li><code>public/brand/logo-full-light.svg</code>, <code>logo-full-dark.svg</code>, <code>logo-symbol.svg</code>, <code>logo-symbol-dark.svg</code>, <code>social-avatar.svg</code>, <code>og-default.svg</code>, and <code>public/favicon.svg</code></li>
      <li><code>src/styles/tokens.css</code>, <code>fonts.css</code>, <code>components.css</code>, <code>global.css</code>, <code>public/brand/court-lines*.svg</code> (the colours, type, spacing and motion shown above)</li>
      <li><code>docs/BRAND.md</code> (contrast table, decisions, open questions) and <code>docs/licenses/</code></li>
    </ul>
    <div class="note" style="color: var(--ps-ink)"><b>Not generated yet:</b> PNG and ICO versions (the favicon set, the social image for WhatsApp and Facebook, an avatar upload for YouTube). The machine has no image tool, and I do not install one without asking. They are produced from these SVGs once a tool is approved.</div>
    <p class="pv-cap" style="margin-top: var(--ps-space-3); color: var(--ps-mist)">Generated by <code>scripts/brand-preview.mjs</code> from the real files. This page makes no network request.</p>
  </div>
</footer>

</body>
</html>
`;

if (/https?:\/\//.test(html)) {
  const hit = html.match(/.{0,60}https?:\/\/.{0,60}/)[0];
  console.error(`FAIL: the preview must not contain external URLs. Found: ${hit}`);
  process.exit(1);
}
if (/<script[\s>]/i.test(html) || /src="http|href="http/.test(html)) {
  console.error("FAIL: the preview must have no script and no external src/href");
  process.exit(1);
}
const out = resolve(ROOT, "docs/brand-preview.html");
writeFileSync(out, html.replace(/\r\n/g, "\n"), "utf8");
console.log(`wrote docs/brand-preview.html  ${(html.length / 1024).toFixed(0)} KiB, ${svgCount} inline SVGs, ${faces.length} embedded font faces`);
