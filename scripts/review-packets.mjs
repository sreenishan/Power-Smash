#!/usr/bin/env node
/**
 * Owner review packets.
 *
 *   node scripts/review-packets.mjs tamil [--check]      regenerate docs/review-packets/TAMIL_REVIEW.md
 *                                                        (--check: exit 1 if the file is stale, writes nothing)
 *   node scripts/review-packets.mjs spot-check [--out <dir>] [--input <gold-seed.json>]
 *                                                        write one offline HTML file into tmp/spot-check/ (git-ignored)
 *
 * The spot-check file holds REAL titles (private). The generator refuses to write anywhere inside the repo
 * except tmp/, so the file can never land in docs, tests or src. No network, no installs.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, relative, sep, join } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Tamil script without the Tamil digits (U+0BE6-U+0BEF).
const TAMIL_RUN = /[஀-௥௰-௿]+/gu;
const HAS_TAMIL = /[஀-௿]/u;

/* ------------------------------------------------------------------ Tamil packet */

/** Tamil words in the parser's age vocabulary (vocab.ts). Glosses are the developer's reading, unverified. */
const AGE_GLOSS = {
  'பள்ளி': 'school',
  'ஜூனியர்': 'junior',
  'ஜுனியர்': 'junior (second spelling)',
  'சப்ஜூனியர்': 'sub-junior',
  'சிறுவர்': 'boys / children',
  'சிறுவர்கள்': 'boys / children (plural)',
  'சிறுமியர்': 'girls',
  'சிறுமிகள்': 'girls (plural)',
  'மாணவர்': 'student',
  'மாணவர்கள்': 'students',
  'மாணவியர்': 'girl students',
  'இளையோர்': 'youth / younger ones',
  'கேடட்': 'cadet',
};

/** Non-comment source lines (comments are not product text). */
function codeLines(text) {
  return text.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|astro|mjs|js|json|css)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every Tamil word (script run) in non-comment lines under src/, with the files that use it. */
export function tamilStringsInSrc(root = ROOT) {
  const found = new Map();
  for (const file of walk(resolve(root, 'src'))) {
    for (const line of codeLines(readFileSync(file, 'utf8'))) {
      for (const m of line.matchAll(TAMIL_RUN)) {
        const files = found.get(m[0]) ?? new Set();
        files.add(relative(root, file).split(sep).join('/'));
        found.set(m[0], files);
      }
    }
  }
  return found;
}

function specCopyDeck(root) {
  const lines = readFileSync(resolve(root, 'power-smash-website-spec.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## Appendix B'));
  const rows = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith('## ')) break;
    if (!l.startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || cells[0] === 'Placement' || /^-+$/.test(cells[0])) continue;
    rows.push({ placement: cells[0], english: cells[1], tamil: cells[2] });
  }
  return rows;
}

const cell = (s) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const pad = (n) => String(n).padStart(2, '0');

export function buildTamilPacket(root = ROOT) {
  const deck = specCopyDeck(root);
  const withTamil = deck.filter((r) => HAS_TAMIL.test(r.tamil));
  const englishOnly = deck.filter((r) => !HAS_TAMIL.test(r.tamil));
  const src = tamilStringsInSrc(root);

  const out = [];
  out.push('# Tamil review packet (generated, do not edit by hand)');
  out.push('');
  out.push('Regenerate with `node scripts/review-packets.mjs tamil`. A test fails if Tamil text appears in `src/` that is missing here.');
  out.push('');
  out.push('## For the reviewer');
  out.push('');
  out.push('**Owner:** please forward this page to a native Tamil speaker (a friend, a teacher or a paid reviewer; OT-32). Every Tamil line here is a draft. Nothing new has been machine-translated for the site.');
  out.push('');
  out.push('**English.** Power Smash is a Tamil Nadu badminton website. For each row, read the English line and the draft Tamil line. In the last-but-one column write `OK`, or `change to` and the Tamil you prefer. Please also say if a line sounds too formal or too casual for a badminton fan on a phone. The Notes column says what each line is for.');
  out.push('');
  out.push('**தமிழ்.** இந்த வரிகளைப் படித்து, சரியா என்று சொல்லுங்கள்; மாற்ற வேண்டுமெனில் உங்கள் தமிழ் வரியை எழுதுங்கள். (Tamil instruction: suggestion, unverified.)');
  out.push('');
  out.push('Any wording marked "suggestion, unverified" has not been checked by a Tamil speaker.');
  out.push('');

  out.push('## A. Website lines (spec Appendix B)');
  out.push('');
  out.push('| id | where it is used | English | current draft Tamil | OK / change to ... | notes |');
  out.push('|---|---|---|---|---|---|');
  withTamil.forEach((r, i) => {
    let note = 'Draft, needs native review.';
    if (r.placement === 'Home H1') {
      note = 'MISMATCH found by the brand review: the Tamil means "Home of Tamil Nadu badminton", which matches tagline option C ("Where Tamil Nadu badminton lives."), not this English headline. Reviewer: translate the English line, or tell us which tagline this Tamil fits. The owner picks the tagline first (question 12). No replacement suggested.';
    } else if (r.placement === 'Booking CTA') {
      note = 'Uses English loan words. Is that natural for your audience, or would you prefer pure Tamil? Register: spoken, polite.';
    } else if (r.placement === 'Primary CTA' || r.placement === 'Search placeholder') {
      note = 'Polite command form. Check register: formal vs spoken.';
    } else if (r.placement === 'Player share text') {
      note = 'Sent by a player to friends on WhatsApp, so spoken and warm is fine. Keep {url} and the emoji exactly as they are.';
    } else if (r.placement === 'Tagline') {
      note = 'Three short sentences. Check the rhythm and that each one stands alone.';
    }
    const tamil = r.tamil.replace(/\s*\*\(.*?\)\*\s*$/u, '').trim();
    out.push(`| TB-${pad(i + 1)} | ${cell(r.placement)} | ${cell(r.english)} | ${cell(tamil)} | | ${cell(note)} |`);
  });
  out.push('');
  out.push('English lines with no Tamil yet (they show in English only; any Tamil offered for them is a "suggestion, unverified" until a second person checks it):');
  out.push('');
  out.push(englishOnly.map((r) => `- ${r.placement}: ${r.english}`).join('\n'));
  out.push('');
  out.push('Also not drafted yet: the Tamil summary of the privacy notice (OT-32). It will be added here when it exists.');
  out.push('');

  out.push('## B. Title-reader vocabulary (parser, PO-05)');
  out.push('');
  out.push('These words are never shown to visitors. The title reader (`src/lib/parser/vocab.ts`) uses them to notice that a YouTube title may be about under-age players. A title containing one of them is held back for the owner to check (the safe choice), because nobody has confirmed what each word means. The English column is the developer\'s reading and is **unverified**.');
  out.push('');
  out.push('Please say for each word: is it a real word used in Tamil badminton titles, what does it mean, and does it mean a young or under-age player (yes / no / depends)?');
  out.push('');
  out.push('| id | where it is used | English (unverified) | current draft Tamil | OK / change to ... | notes |');
  out.push('|---|---|---|---|---|---|');
  const vocabWords = [...src.entries()].filter(([, f]) => [...f].some((p) => p.endsWith('parser/vocab.ts'))).map(([w]) => w);
  vocabWords.forEach((w, i) => {
    out.push(`| TV-${pad(i + 1)} | Parser age words (fail-closed list, vocab.ts) | ${cell(AGE_GLOSS[w] ?? 'unknown, please explain')} | ${w} | | Is this an under-age signal? Please also tell us other spellings. |`);
  });
  out.push('');
  out.push('Still missing, and the reason test PF-041 stays skipped (PO-05): the Tamil words for **versus** (the "vs" between two sides), the rounds (**final**, **semi-final**, **quarter-final**) and the categories as real titles write them. No guess has been written. If you know how a Tamil title writes them, fill the last-but-one column (it counts as "suggestion, unverified" until a second person confirms):');
  out.push('');
  out.push('| id | where it would be used | English | current draft Tamil | OK / change to ... | notes |');
  out.push('|---|---|---|---|---|---|');
  [['versus', 'splits the two sides'], ['final', 'round'], ['semi-final', 'round'], ['quarter-final', 'round'], ['singles', 'category'], ['doubles', 'category'], ['mixed doubles', 'category'], ['men / women', 'category']].forEach(([e, use], i) => {
    out.push(`| TW-${pad(i + 1)} | Parser: ${use} | ${e} | (none yet) | | Reviewer to supply. |`);
  });
  out.push('');

  const known = new Set(vocabWords);
  for (const r of withTamil) for (const m of r.tamil.matchAll(TAMIL_RUN)) known.add(m[0]);
  const other = [...src.entries()].filter(([w]) => !known.has(w));
  out.push('## C. Other Tamil text found in the code (`src/`)');
  out.push('');
  if (other.length === 0) {
    out.push('None. The site code has no Tamil interface text yet (Tamil shows only after OT-32).');
  } else {
    out.push('| id | where it is used | English | current draft Tamil | OK / change to ... | notes |');
    out.push('|---|---|---|---|---|---|');
    other.forEach(([w, f], i) => out.push(`| TC-${pad(i + 1)} | ${[...f].join(', ')} | (explain) | ${w} | | |`));
  }
  out.push('');
  out.push('Tamil digits and comments in the code are logic, not visible text, and are not listed.');
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ Spot-check */

/** Throws unless dir is under <root>/tmp/ or entirely outside the repo. */
export function assertSafeOutputDir(dir, root = ROOT) {
  const abs = resolve(dir);
  const rel = relative(root, abs);
  const outside = rel.startsWith('..') || /^[a-zA-Z]:/.test(rel);
  if (outside) return abs;
  if (rel.split(sep)[0] === 'tmp') return abs;
  throw new Error(`Refusing to write real titles inside the repo (${rel || '.'}). Only tmp/ (git-ignored) or a folder outside the repo is allowed.`);
}

const PLAYER_NAME = (p) => [p.name, p.seed ? `(seed ${p.seed})` : '', p.country ? `[${p.country}]` : ''].filter(Boolean).join(' ');

function sideText(side) {
  if (!side) return 'none';
  if (side.players && side.players.length) return side.players.map(PLAYER_NAME).join(' and ');
  return `Not clear from the title (${side.raw ?? ''})`;
}

const KIND = { match: 'A normal match', non_match: 'Not a match (highlights, interview or similar)', team_tie: 'A team tie (teams, not players)' };
const CAT = { MS: "Men's singles", WS: "Women's singles", MD: "Men's doubles", WD: "Women's doubles", XD: 'Mixed doubles', BS: "Boys' singles", GS: "Girls' singles", BD: "Boys' doubles", GD: "Girls' doubles" };
const ROUND = { F: 'Final', SF: 'Semi-final', QF: 'Quarter-final', R16: 'Round of 16', R32: 'Round of 32', R64: 'Round of 64', GROUP: 'Group stage' };

export function proposedFields(entry) {
  const l = entry.label ?? {};
  const a = l.side_a;
  const b = l.side_b;
  const fields = [];
  const add = (key, name, value, help) => fields.push({ key, name, value: value == null || value === '' ? 'none' : String(value), help: help ?? '' });
  add('kind', 'Type of video', KIND[l.kind] ?? l.kind, l.non_match_reason ? `Reason noted: ${l.non_match_reason}` : '');
  if (l.kind !== 'non_match') {
    add('side_a', 'Side A', sideText(a), a && a.split === 'ambiguous' ? 'The title does not make the split clear.' : '');
    add('side_b', 'Side B', sideText(b), b && b.split === 'ambiguous' ? 'The title does not make the split clear.' : '');
    const na = a && a.players ? a.players.length : null;
    const nb = b && b.players ? b.players.length : null;
    add('players_per_side', 'Players per side', na != null && nb != null ? `${na} vs ${nb} (${l.format ?? 'unknown'})` : `unclear (${l.format ?? 'unknown'})`);
  }
  add('category', 'Category', l.category ? (CAT[l.category] ?? l.category) : 'none written in the title');
  add('age', 'Age signal', l.age_group ? `Age group: ${l.age_group}` : (l.minor_signal_in_title ? 'Looks like a young player' : 'none in the title'));
  add('round', 'Round', l.round ? (ROUND[l.round] ?? l.round) : 'none');
  add('tournament', 'Tournament', l.tournament);
  add('year', 'Year', l.year);
  add('international', 'International?', l.is_international ? 'Yes, international' : 'No');
  return fields;
}

export function buildSpotCheckHtml(seed) {
  const entries = [...seed.entries].sort((x, y) => Number(!!y.unsure) - Number(!!x.unsure) || x.index - y.index);
  const data = entries.map((e) => ({
    index: e.index,
    title: e.title,
    unsure: !!e.unsure,
    unsureWhy: (e.unsure_reasons ?? []).join(' '),
    fields: proposedFields(e),
  }));
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
  return HTML_TEMPLATE.replace('/*DATA*/[]', () => json);
}

const HTML_TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Power Smash title check (private)</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#555;--card:#f2f4f7;--line:#c8ccd2;--ok:#0a7a3d;--bad:#c0262d;--un:#9a6700}
@media(prefers-color-scheme:dark){:root{--bg:#101214;--fg:#f1f1f1;--mut:#aaa;--card:#1c1f23;--line:#3a3f46;--ok:#2fa862;--bad:#d9494f;--un:#b9791a}}
*{box-sizing:border-box}body{margin:0 auto;background:var(--bg);color:var(--fg);font:18px/1.45 system-ui,sans-serif;padding:12px 16px 90px;max-width:640px}
h1{font-size:1.1rem;margin:.3rem 0}.priv{background:var(--card);border:1px solid var(--line);padding:8px 10px;border-radius:10px;font-size:.85rem;color:var(--mut)}
.title{font-size:1.15rem;font-weight:700;word-break:break-word;background:var(--card);padding:12px;border-radius:12px;margin:10px 0}
.f{border:1px solid var(--line);border-radius:12px;padding:10px;margin:10px 0}.f b{display:block;font-size:.8rem;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
.v{font-size:1.1rem;margin:2px 0 8px}.h{font-size:.85rem;color:var(--mut);margin-bottom:6px}
.row{display:flex;gap:8px}.row button{flex:1;min-height:52px;font-size:1rem;border-radius:10px;border:2px solid var(--line);background:var(--bg);color:var(--fg)}
.row button.on[data-v=correct]{border-color:var(--ok);background:var(--ok);color:#fff}.row button.on[data-v=wrong]{border-color:var(--bad);background:var(--bad);color:#fff}.row button.on[data-v=unsure]{border-color:var(--un);background:var(--un);color:#fff}
input.n{width:100%;min-height:44px;margin-top:8px;font-size:1rem;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
nav{position:fixed;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line);display:flex;gap:8px;padding:10px 16px}
nav button{flex:1;min-height:52px;font-size:1rem;border-radius:10px;border:2px solid var(--line);background:var(--card);color:var(--fg)}
.warn{color:var(--un);font-size:.9rem}
</style></head><body>
<h1>Power Smash title check</h1>
<div class="priv">Private. These are real video titles and some may show young players. Keep this file on your phone or PC. Do not post it or upload it anywhere. Your answers stay on this device until you tap Export.</div>
<div id="app"></div>
<nav><button id="prev">Back</button><button id="next">Next</button><button id="exp">Export</button></nav>
<script>
var DATA=/*DATA*/[];
var KEY='ps-spotcheck-v1',st={pos:0,ans:{}};
try{var s=localStorage.getItem(KEY);if(s)st=JSON.parse(s)}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function a(i,k){var o=st.ans[DATA[i].index]=st.ans[DATA[i].index]||{};return o[k]=o[k]||{v:'',n:''}}
function render(){
 var d=DATA[st.pos],app=document.getElementById('app');app.textContent='';
 if(!d){app.appendChild(el('p','','No titles in this file.'));return}
 var done=0;DATA.forEach(function(x){var o=st.ans[x.index];if(o&&x.fields.every(function(f){return o[f.key]&&o[f.key].v}))done++});
 app.appendChild(el('p','h','Title '+(st.pos+1)+' of '+DATA.length+'. Finished: '+done+'.'));
 app.appendChild(el('div','title',d.title));
 if(d.unsure)app.appendChild(el('p','warn','The first guess was unsure here. '+d.unsureWhy));
 d.fields.forEach(function(f){
  var box=el('div','f');box.appendChild(el('b','',f.name));box.appendChild(el('div','v',f.value));
  if(f.help)box.appendChild(el('div','h',f.help));
  var row=el('div','row'),cur=a(st.pos,f.key);
  [['correct','Correct'],['wrong','Wrong'],['unsure','Unsure']].forEach(function(p){
   var b=el('button',cur.v===p[0]?'on':'',p[1]);b.setAttribute('data-v',p[0]);
   b.onclick=function(){cur.v=cur.v===p[0]?'':p[0];save();render()};row.appendChild(b)});
  box.appendChild(row);
  var n=el('input','n');n.type='text';n.placeholder=cur.v==='wrong'?'What is the right answer?':'Note (optional)';n.value=cur.n;
  n.oninput=function(){cur.n=n.value;save()};box.appendChild(n);app.appendChild(box)});
 window.scrollTo(0,0)}
document.getElementById('prev').onclick=function(){if(st.pos>0){st.pos--;save();render()}};
document.getElementById('next').onclick=function(){if(st.pos<DATA.length-1){st.pos++;save();render()}};
document.getElementById('exp').onclick=function(){
 var out={exported_at:new Date().toISOString(),note:'Answers only, by title index. No titles inside.',answers:[]};
 DATA.forEach(function(d){var o=st.ans[d.index];if(!o)return;var r={index:d.index,fields:{}};
  d.fields.forEach(function(f){if(o[f.key]&&(o[f.key].v||o[f.key].n))r.fields[f.key]={verdict:o[f.key].v||null,note:o[f.key].n||''}});
  if(Object.keys(r.fields).length)out.answers.push(r)});
 var b=new Blob([JSON.stringify(out,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),l=document.createElement('a');
 l.href=u;l.download='spot-check-answers.json';document.body.appendChild(l);l.click();l.remove();setTimeout(function(){URL.revokeObjectURL(u)},4000)};
render();
</script></body></html>
`;

/* ------------------------------------------------------------------ CLI */

function main(argv) {
  const [mode, ...rest] = argv;
  const flag = (n) => {
    const i = rest.indexOf(n);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (mode === 'tamil') {
    const target = resolve(ROOT, 'docs/review-packets/TAMIL_REVIEW.md');
    const text = buildTamilPacket();
    if (rest.includes('--check')) {
      const same = existsSync(target) && readFileSync(target, 'utf8') === text;
      console.log(same ? 'TAMIL_REVIEW.md is up to date.' : 'TAMIL_REVIEW.md is stale: run node scripts/review-packets.mjs tamil');
      process.exit(same ? 0 : 1);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    console.log(`Wrote ${relative(ROOT, target)}`);
  } else if (mode === 'spot-check') {
    const input = resolve(flag('--input') ?? resolve(ROOT, 'tests/fixtures/gold-seed.real70.json'));
    const dir = assertSafeOutputDir(flag('--out') ?? resolve(ROOT, 'tmp/spot-check'));
    const seed = JSON.parse(readFileSync(input, 'utf8'));
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, 'spot-check.html');
    writeFileSync(file, buildSpotCheckHtml(seed));
    console.log(`Wrote ${file}\nPRIVATE: real titles. Keep it out of the repo, docs and any upload. See docs/review-packets/SPOTCHECK_HOWTO.md`);
  } else {
    console.error('Usage: node scripts/review-packets.mjs tamil [--check] | spot-check [--out <dir>] [--input <file>]');
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
