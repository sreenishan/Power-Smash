#!/usr/bin/env node
/**
 * Builds the Power Smash logo kit as SVG files with real PATHS (no live text, no external fonts).
 *
 *   node scripts/brand-logo.mjs
 *
 * Output (public/brand and public/favicon.svg):
 *   logo-full-light.svg   wordmark + symbol for light backgrounds (ink + court)
 *   logo-full-dark.svg    wordmark + symbol for dark backgrounds (white + volt)
 *   logo-symbol.svg       symbol alone, for light backgrounds
 *   logo-symbol-dark.svg  symbol alone, for dark backgrounds
 *   social-avatar.svg     512 x 512 square avatar (keep important art inside the central circle)
 *   og-default.svg        1200 x 630 Open Graph image, tagline zone left EMPTY (TODO owner, OT-23)
 *   ../favicon.svg        simplified symbol on an ink tile
 *
 * How the wordmark is made: the heavy condensed italic is Barlow Condensed Black Italic (SIL OFL-1.1, from the
 * installed @fontsource package). opentype.js 2.0 reads the .woff file and returns each glyph outline, which is
 * written out as SVG path data. Only outlines are embedded, so the SVGs need no font and render the same everywhere.
 * The shuttle-trail symbol is drawn from plain polygons in this file. Both are original work: no photograph, no
 * broadcast or federation imagery, no third-party mark.
 *
 * Colours come from src/styles/tokens.css. PNG and ICO rasters are NOT produced (no rasteriser installed).
 * Re-running the script rewrites the same bytes (deterministic: no dates, no random numbers).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as opentype from "opentype.js/dist/opentype.mjs"; // ESM build; the package "main" is a UMD bundle
import { parseTokens } from "./brand-contrast.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/brand");
const FAVICON = resolve(ROOT, "public/favicon.svg");
const FONT_FILE = resolve(
  ROOT,
  "node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-900-italic.woff",
);

/**
 * The tagline the owner picks under OT-23. Spec 5.1 options: "Tamil Nadu badminton, on record." /
 * "Every player. Every match. Every smash." / "Where Tamil Nadu badminton lives."
 * Leave EMPTY until they choose: the Open Graph image then ships with no tagline (the brief for this milestone).
 * A one-off trial without editing this file:  node scripts/brand-logo.mjs --tagline="Some text"
 */
const TAGLINE_DEFAULT = "";
const TAGLINE_FONT = resolve(ROOT, "node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff");
const TAGLINE = (process.argv.find((a) => a.startsWith("--tagline="))?.slice("--tagline=".length) ?? TAGLINE_DEFAULT).trim();

const T = parseTokens();
const C = {
  ink: T.ink,
  court: T.court,
  courtDeep: T["court-deep"],
  volt: T.volt,
  white: T.white,
  feather: T.feather,
};

/* ------------------------------------------------------------------ helpers */
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => String(r2(n));

/* A shape is a list of commands: ["M",[x,y]] ["L",[x,y]] ["Q",[cx,cy],[x,y]] ["Z"]. */
const polyCmds = (pts) => [["M", pts[0]], ...pts.slice(1).map((p) => ["L", p]), ["Z"]];
const mapCmds = (cmds, f) => cmds.map(([op, ...pts]) => [op, ...pts.map(f)]);
const cmdsToD = (cmds) =>
  cmds.map(([op, ...pts]) => op + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" ")).join("");

function rotatePoint([x, y], deg) {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

/** circle -> path data using two arcs (a real path, no <circle>) */
function circle(cx, cy, r) {
  return `M${fmt(cx - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;
}

/** Extent of a command list; quadratic curves are sampled so a bulge counts. */
function extent(cmds, grow) {
  let cur = [0, 0];
  for (const [op, ...pts] of cmds) {
    if (op === "M" || op === "L") {
      grow(...pts[0]);
      cur = pts[0];
    } else if (op === "Q") {
      const [c, p] = pts;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        grow(
          (1 - t) * (1 - t) * cur[0] + 2 * (1 - t) * t * c[0] + t * t * p[0],
          (1 - t) * (1 - t) * cur[1] + 2 * (1 - t) * t * c[1] + t * t * p[1],
        );
      }
      cur = p;
    }
  }
}

/* ------------------------------------------------------------------ the shuttle-trail symbol */
/**
 * Local coordinates: the shuttle flies along +x, cork first. The assembly is then rotated so it dives to the
 * lower right (a smash), and the speed streaks sit behind it to the upper left.
 *   simple = true  -> one solid skirt and two heavy streaks, for the favicon (must survive 16 px)
 */
function buildSymbol({ simple = false, angle = 32 } = {}) {
  const frontX = 34;
  const rimX = -36;
  const frontW = simple ? 17 : 15;
  const rimW = simple ? 48 : 44;
  const parts = []; // { role, cmds?, circ?:{cx,cy,r} }

  // Feather skirt. Each feather ends in a rounded tip (quadratic bulge at the rim).
  const at = (t) => ({ x: frontX + (rimX - frontX) * t, w: frontW + (rimW - frontW) * t, g: 1.4 + 2.2 * t });
  const feather = (s0, s1, gapLo, gapHi, bulge) => {
    const f0 = at(0);
    const r0 = at(1);
    const yf0 = s0 * f0.w + (gapLo ? f0.g : 0);
    const yr0 = s0 * r0.w + (gapLo ? r0.g : 0);
    const yr1 = s1 * r0.w - (gapHi ? r0.g : 0);
    const yf1 = s1 * f0.w - (gapHi ? f0.g : 0);
    return [
      ["M", [f0.x, yf0]],
      ["L", [r0.x, yr0]],
      ["Q", [r0.x - bulge, (yr0 + yr1) / 2], [r0.x, yr1]],
      ["L", [f0.x, yf1]],
      ["Z"],
    ];
  };
  if (simple) {
    parts.push({ role: "skirt", cmds: feather(-1, 1, false, false, 16) });
  } else {
    parts.push({ role: "skirt", cmds: feather(-1, -1 / 3, false, true, 9) });
    parts.push({ role: "skirt", cmds: feather(-1 / 3, 1 / 3, true, true, 9) });
    parts.push({ role: "skirt", cmds: feather(1 / 3, 1, true, false, 9) });
  }

  // Cork (drawn after the skirt so it caps the apex)
  parts.push({ role: "cork", circ: { cx: 47, cy: 0, r: simple ? 22 : 19 } });

  // Speed streaks: wedges that taper away from the shuttle
  const streak = (y, len, h) =>
    polyCmds([
      [-52, y - h / 2],
      [-52, y + h / 2],
      [-52 - len, y + h * 0.1],
    ]);
  if (simple) {
    parts.push({ role: "trail", cmds: streak(-26, 40, 15) });
    parts.push({ role: "trail", cmds: streak(26, 40, 15) });
  } else {
    parts.push({ role: "trail", cmds: streak(-30, 74, 9) });
    parts.push({ role: "trail", cmds: streak(0, 110, 12) });
    parts.push({ role: "trail", cmds: streak(30, 56, 9) });
  }

  // rotate everything, collect bounds
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of parts) {
    if (p.cmds) {
      p.cmds = mapCmds(p.cmds, (pt) => rotatePoint(pt, angle));
      extent(p.cmds, grow);
    } else {
      const [cx, cy] = rotatePoint([p.circ.cx, p.circ.cy], angle);
      p.circ = { cx, cy, r: p.circ.r };
      grow(cx - p.circ.r, cy - p.circ.r);
      grow(cx + p.circ.r, cy + p.circ.r);
    }
  }
  return { parts, bbox: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } };
}

/** Render symbol parts into path elements, fitted into a target box (x, y, size = height). */
function symbolPaths(sym, { x, y, height, colors }) {
  const k = height / sym.bbox.h;
  const tx = (px) => x + (px - sym.bbox.minX) * k;
  const ty = (py) => y + (py - sym.bbox.minY) * k;
  const width = sym.bbox.w * k;
  const out = [];
  // Draw order: trail, skirt, cork
  for (const role of ["trail", "skirt", "cork"]) {
    const ds = [];
    for (const p of sym.parts.filter((q) => q.role === role)) {
      if (p.cmds) ds.push(cmdsToD(mapCmds(p.cmds, ([px, py]) => [tx(px), ty(py)])));
      else ds.push(circle(tx(p.circ.cx), ty(p.circ.cy), p.circ.r * k));
    }
    out.push(`<path id="${role}" fill="${colors[role]}" d="${ds.join("")}"/>`);
  }
  return { svg: out.join("\n    "), width, height };
}

/* ------------------------------------------------------------------ the wordmark */
function loadFont(file) {
  const buf = readFileSync(file);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const font = loadFont(FONT_FILE);

const CAP_UNITS = font.tables.os2.sCapHeight; // 700 for Barlow Condensed
const TRACKING = 0.012; // em

/** Outline a word; returns path data positioned with its left ink edge at x and baseline at y. */
function wordPath(text, capHeight, x, y, f = font, tracking = TRACKING) {
  const size = (capHeight / f.tables.os2.sCapHeight) * f.unitsPerEm;
  const probe = f.getPath(text, 0, 0, size, { kerning: true, letterSpacing: tracking });
  const bb = probe.getBoundingBox();
  const path = f.getPath(text, x - bb.x1, y, size, { kerning: true, letterSpacing: tracking });
  return { d: path.toPathData(2), width: bb.x2 - bb.x1, size };
}

/**
 * The lockup: [symbol] [POWER SMASH]. Returns the inner SVG and its natural size.
 * mode: "light" -> POWER in ink, SMASH in court; "dark" -> POWER in white, SMASH in volt.
 */
function lockup(mode) {
  const cap = 120;
  const symH = 170;
  const gap = 36;
  const wordGap = 34;
  const col =
    mode === "dark"
      ? { power: C.white, smash: C.volt, trail: C.volt, skirt: C.white, cork: C.volt, bar: C.volt }
      : { power: C.ink, smash: C.court, trail: C.court, skirt: C.ink, cork: C.court, bar: C.court };

  const sym = buildSymbol();
  const symbolK = symH / sym.bbox.h;
  const symW = sym.bbox.w * symbolK;
  const wordX = symW + gap;
  const baseline = symH / 2 + cap / 2 + 4;

  const power = wordPath("POWER", cap, wordX, baseline);
  const smash = wordPath("SMASH", cap, wordX + power.width + wordGap, baseline);
  const totalW = wordX + power.width + wordGap + smash.width;

  const symbol = symbolPaths(sym, { x: 0, y: 0, height: symH, colors: col });

  // Speed bar under the words: a long wedge that tapers to the left, echoing the shuttle streaks.
  const barY = baseline + 16;
  const barH = 9;
  const barX0 = wordX + 40;
  const barX1 = totalW;
  const bar = cmdsToD(polyCmds([
    [barX0, barY + barH],
    [barX0 + 26, barY],
    [barX1, barY],
    [barX1 - 26, barY + barH],
  ]));

  const h = Math.max(symH, barY + barH);
  const svg = `<g id="symbol">
    ${symbol.svg}
  </g>
  <g id="wordmark">
    <path id="power" fill="${col.power}" d="${power.d}"/>
    <path id="smash" fill="${col.smash}" d="${smash.d}"/>
    <path id="speed-bar" fill="${col.bar}" d="${bar}"/>
  </g>`;
  return { svg, width: totalW, height: h, symbolWidth: symW };
}

/* ------------------------------------------------------------------ badminton court line motif */
/** Doubles court lines (13.4 m x 6.1 m) as stroked paths; scale in px per metre. */
function courtLines(x0, y0, scale, stroke, opacity, color) {
  const L = 13.4;
  const W = 6.1;
  const X = (m) => fmt(x0 + m * scale);
  const Y = (m) => fmt(y0 + m * scale);
  const seg = (ax, ay, bx, by) => `M${X(ax)} ${Y(ay)}L${X(bx)} ${Y(by)}`;
  const d = [
    `M${X(0)} ${Y(0)}L${X(L)} ${Y(0)}L${X(L)} ${Y(W)}L${X(0)} ${Y(W)}Z`, // outer
    seg(0, 0.46, L, 0.46), // singles sidelines
    seg(0, W - 0.46, L, W - 0.46),
    seg(L / 2, -0.3, L / 2, W + 0.3), // net line
    seg(L / 2 - 1.98, 0, L / 2 - 1.98, W), // short service lines
    seg(L / 2 + 1.98, 0, L / 2 + 1.98, W),
    seg(0.76, 0, 0.76, W), // doubles long service lines
    seg(L - 0.76, 0, L - 0.76, W),
    seg(0, W / 2, L / 2 - 1.98, W / 2), // centre lines
    seg(L / 2 + 1.98, W / 2, L, W / 2),
  ].join("");
  return `<path id="court-lines" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${stroke}" stroke-linejoin="miter" d="${d}"/>`;
}

/* ------------------------------------------------------------------ file writers */
const HEADER = (name) =>
  `<!-- ${name}. Generated by scripts/brand-logo.mjs. DRAFT for owner approval (OT-23). Original work: wordmark outlined from Barlow Condensed (SIL OFL-1.1), symbol drawn in code. Colours are the spec 5.3 tokens. -->`;

function svgFile({ name, title, width, height, body, viewBox }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
${HEADER(name)}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox ?? `0 0 ${fmt(width)} ${fmt(height)}`}" width="${fmt(width)}" height="${fmt(height)}" role="img" aria-labelledby="t">
  <title id="t">${title}</title>
  ${body}
</svg>
`;
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n/g, "\n"), "utf8");
  return path;
}

const written = [];

// 1 and 2. Full logos (transparent background; the pad keeps ink clear of the edge)
for (const mode of ["light", "dark"]) {
  const l = lockup(mode);
  const pad = 8;
  written.push(
    write(
      resolve(OUT, `logo-full-${mode}.svg`),
      svgFile({
        name: `logo-full-${mode}.svg`,
        title: "Power Smash",
        width: l.width + pad * 2,
        height: l.height + pad * 2,
        body: `<g transform="translate(${pad} ${pad})">\n  ${l.svg}\n  </g>`,
      }),
    ),
  );
}

// 3 and 4. Symbol alone
for (const mode of ["light", "dark"]) {
  const sym = buildSymbol();
  const col =
    mode === "dark"
      ? { trail: C.volt, skirt: C.white, cork: C.volt }
      : { trail: C.court, skirt: C.ink, cork: C.court };
  const size = 256;
  const pad = 12;
  const p = symbolPaths(sym, { x: pad, y: pad, height: size - pad * 2, colors: col });
  const width = p.width + pad * 2;
  written.push(
    write(
      resolve(OUT, mode === "light" ? "logo-symbol.svg" : "logo-symbol-dark.svg"),
      svgFile({
        name: mode === "light" ? "logo-symbol.svg" : "logo-symbol-dark.svg",
        title: "Power Smash shuttle trail symbol",
        width,
        height: size,
        body: `<g id="symbol">\n    ${p.svg}\n  </g>`,
      }),
    ),
  );
}

// 5. Social avatar: ink square, court lines as texture, symbol inside the central circle
{
  const S = 512;
  const sym = buildSymbol();
  const target = S * 0.58;
  const k = target / sym.bbox.h;
  const x = (S - sym.bbox.w * k) / 2;
  const y = (S - target) / 2;
  const p = symbolPaths(sym, { x, y, height: target, colors: { trail: C.volt, skirt: C.white, cork: C.volt } });
  written.push(
    write(
      resolve(OUT, "social-avatar.svg"),
      svgFile({
        name: "social-avatar.svg",
        title: "Power Smash",
        width: S,
        height: S,
        body: `<rect id="background" width="${S}" height="${S}" fill="${C.ink}"/>
  ${courtLines(-110, 96, 52, 3, 0.1, C.white)}
  <g id="symbol">
    ${p.svg}
  </g>`,
      }),
    ),
  );
}

// 6. Default Open Graph image: 1200 x 630. The tagline zone is intentionally empty.
{
  const W = 1200;
  const H = 630;
  const l = lockup("dark");
  const scale = 900 / l.width; // lockup is 900 px wide on the 1200 px canvas
  const lw = l.width * scale;
  const lh = l.height * scale;
  const x = (W - lw) / 2;
  const y = 130;
  const zone = { x: 150, y: 405, w: 900, h: 90 };

  // Tagline: EMPTY until the owner chooses (OT-23). Once chosen, set TAGLINE_DEFAULT above (or pass --tagline="...") and
  // re-run; the text is outlined from Barlow Condensed 700, uppercase, white, centred in the zone.
  let taglineSvg = `<!-- TODO(owner): tagline (OT-23). Reserved zone x=${zone.x} y=${zone.y} width=${zone.w} height=${zone.h}, centred under the lockup.
       Intentionally EMPTY: no tagline text is shipped until the owner picks one. To add it: set TAGLINE_DEFAULT in scripts/brand-logo.mjs and re-run. -->
  <g id="tagline-zone"/>`;
  if (TAGLINE) {
    const tf = loadFont(TAGLINE_FONT);
    const cap = 40;
    let w = wordPath(TAGLINE.toUpperCase(), cap, 0, 0, tf, 0.02).width;
    const fit = Math.min(1, zone.w / w);
    const capFit = cap * fit;
    w = wordPath(TAGLINE.toUpperCase(), capFit, 0, 0, tf, 0.02).width;
    const tp = wordPath(TAGLINE.toUpperCase(), capFit, zone.x + (zone.w - w) / 2, zone.y + zone.h / 2 + capFit / 2, tf, 0.02);
    taglineSvg = `<path id="tagline" fill="${C.white}" d="${tp.d}"/>`;
  }
  written.push(
    write(
      resolve(OUT, "og-default.svg"),
      svgFile({
        name: "og-default.svg",
        title: "Power Smash",
        width: W,
        height: H,
        body: `<rect id="background" width="${W}" height="${H}" fill="${C.ink}"/>
  ${courtLines(64, 71, 80, 3, 0.09, C.white)}
  <rect id="top-band" width="${W}" height="10" fill="${C.court}"/>
  <g id="lockup" transform="translate(${fmt(x)} ${fmt(y)}) scale(${scale})">
  ${l.svg}
  </g>
  ${taglineSvg}`,
      }),
    ),
  );
  void lh;
}

// 7. Favicon: ink tile, simplified symbol (must read at 16 px)
{
  const S = 64;
  const sym = buildSymbol({ simple: true, angle: 34 });
  const target = S * 0.88;
  const k = target / Math.max(sym.bbox.h, sym.bbox.w);
  const h = sym.bbox.h * k;
  const w = sym.bbox.w * k;
  const x = (S - w) / 2;
  const y = (S - h) / 2;
  const p = symbolPaths(sym, { x, y, height: h, colors: { trail: C.volt, skirt: C.white, cork: C.volt } });
  written.push(
    write(
      FAVICON,
      `<?xml version="1.0" encoding="UTF-8"?>
${HEADER("favicon.svg")}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-labelledby="t">
  <title id="t">Power Smash</title>
  <rect width="${S}" height="${S}" rx="14" fill="${C.ink}"/>
  <g id="symbol">
    ${p.svg}
  </g>
</svg>
`,
    ),
  );
}

/* ------------------------------------------------------------------ self-checks */
let ok = true;
for (const f of written) {
  const text = readFileSync(f, "utf8");
  const checks = [
    ["no <text> element (outlined paths only)", !/<text[\s>]/.test(text)],
    ["no external reference", !/(https?:\/\/(?!www\.w3\.org\/2000\/svg))|xlink:href|url\(/.test(text)],
    ["has a <title>", /<title[\s>]/.test(text)],
    ["balanced svg tags", (text.match(/<svg[\s>]/g) || []).length === 1 && /<\/svg>\s*$/.test(text)],
    ["no NaN", !/NaN|undefined/.test(text)],
  ];
  for (const [label, pass] of checks) {
    if (!pass) {
      ok = false;
      console.error(`FAIL ${f}: ${label}`);
    }
  }
  console.log(`${f.replace(ROOT + "\\", "").replace(ROOT + "/", "")}  ${text.length} bytes`);
}
if (!ok) process.exit(1);
console.log("logo kit written: all self-checks passed");
