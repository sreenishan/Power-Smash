/**
 * Anonymised title "shapes" (privacy by default). Letters become class tokens: Aaaa (Capitalised word), AAA (ALL CAPS),
 * aaa (lower case), T (Tamil-script word), 9 (digits, one 9 per digit up to 4). A small list of structural words that
 * are never names (vs, final, semi, MS, MD, U15, cup, trophy ...) stays readable, because the shape is useless without
 * them. Consecutive equal tokens collapse to `Aaaa*2`. No player name can be rebuilt from a shape.
 */
import { CATEGORY_CODES, ROUND_WORDS, TOURNAMENT_NOUNS } from '../parser/vocab';

const STRUCTURAL = new Set([
  'vs', 'v', 'versus', 'final', 'finals', 'semi', 'semis', 'quarter', 'quarters', 'round', 'of', 'the', 'and', 'in', 'at',
  'singles', 'doubles', 'mens', 'womens', 'men', 'women', 'boys', 'girls', 'mixed', 'highlights', 'highlight', 'live',
  'match', 'full', 'shorts', 'short', 'replay', 'day', 'pre', 'qf', 'sf', 'f', 'ms', 'ws', 'md', 'wd', 'xd', 'bs', 'gs', 'bd', 'gd',
  'senior', 'junior', 'veterans', 'masters', 'open', 'sub',
]);
for (const k of Object.keys(CATEGORY_CODES)) STRUCTURAL.add(k);
for (const k of Object.keys(ROUND_WORDS)) if (/^[a-z]+$/u.test(k)) STRUCTURAL.add(k);
for (const k of TOURNAMENT_NOUNS) STRUCTURAL.add(k);

const AGE_RE = /^(u-?\d{1,2}|\d{1,2}\+|\d{1,2}u|under|\d{1,2}(st|nd|rd|th))$/iu;

function wordShape(word: string): string {
  const lower = word.toLowerCase();
  if (STRUCTURAL.has(lower) || AGE_RE.test(word)) return lower === 'vs' || lower === 'v' ? 'vs' : word.length <= 3 && /^[A-Z]+$/u.test(word) ? word : lower;
  if (/^\d+$/u.test(word)) return '9'.repeat(Math.min(word.length, 4));
  if (/\p{Script=Tamil}/u.test(word)) return 'T';
  if (/^\p{Lu}{2,}$/u.test(word)) return 'AAA';
  if (/^\p{Lu}$/u.test(word)) return 'A';
  if (/^\p{Lu}\p{Ll}+$/u.test(word)) return 'Aaaa';
  if (/^\p{Ll}+$/u.test(word)) return 'aaa';
  // mixed: map each character class, collapsing runs
  return word.replace(/\p{Lu}+/gu, 'A').replace(/\p{Ll}+/gu, 'a').replace(/\p{Nd}+/gu, '9').replace(/\p{L}+/gu, 'x');
}

/** Break into words and everything else (punctuation and spaces stay as written, so separators remain visible). */
export function titleShape(title: string): string {
  const parts = title.normalize('NFKC').split(/([\p{L}\p{M}\p{Nd}]+(?:['’.-][\p{L}\p{M}\p{Nd}]+)*)/u);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '') continue;
    if (/^[\p{L}\p{M}\p{Nd}]/u.test(part)) {
      // dotted or hyphenated words: shape each piece
      const pieces = part.split(/(['’.-])/u).filter((p) => p !== '');
      out.push(pieces.map((p) => (/^['’.-]$/u.test(p) ? p : wordShape(p))).join(''));
    } else {
      out.push(part.replace(/\s+/gu, ' '));
    }
  }
  // collapse runs of identical class tokens separated by a single space
  const tokens = out.join('').trim().split(' ');
  const collapsed: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    while (j + 1 < tokens.length && tokens[j + 1] === tokens[i]) j++;
    const n = j - i + 1;
    const t = tokens[i] as string;
    collapsed.push(n > 1 && /^(Aaaa|AAA|aaa|T|A)$/u.test(t) ? `${t}*${n}` : Array(n).fill(t).join(' '));
    i = j + 1;
  }
  return collapsed.join(' ').slice(0, 160);
}
