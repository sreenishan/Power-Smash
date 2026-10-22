// Text normalisation shared by the privacy scan and the placeholder gate (review findings S-2, B-17, C-5).
//
// A scanner that reads raw bytes can be dodged by writing the same text another way: HTML entities (`&#64;`, `&commat;`, `&nbsp;`),
// percent-encoding (`%40`), JavaScript or JSON escapes (`@`), digits from other scripts (Tamil, Arabic-Indic, full-width),
// zero-width characters, or markup in the middle of a number (`9876<b>5</b>43210`). `normaliseText` turns all of these into the plain
// ASCII text a reader or a crawler would see, so the patterns only have to describe the plain form.
//
// The result is a SCANNING VIEW, never written anywhere. It keeps every newline, so line numbers stay (almost) right.
// Pure functions, no I/O. Node 24 type stripping: type-annotation-only (no enums, no parameter properties).

/** Named HTML entities whose expansion is one ASCII character, a space or a dash (the ones that matter when hiding a contact detail). */
const NAMED: Readonly<Record<string, string>> = {
  Tab: '\t', NewLine: '\n', excl: '!', quot: '"', QUOT: '"', num: '#', dollar: '$', percnt: '%', amp: '&', AMP: '&', apos: "'",
  lpar: '(', rpar: ')', ast: '*', midast: '*', plus: '+', comma: ',', period: '.', sol: '/', colon: ':', semi: ';', lt: '<', LT: '<',
  equals: '=', gt: '>', GT: '>', quest: '?', commat: '@', lsqb: '[', lbrack: '[', bsol: '\\', rsqb: ']', rbrack: ']', Hat: '^',
  lowbar: '_', UnderBar: '_', grave: '`', DiacriticalGrave: '`', lcub: '{', lbrace: '{', verbar: '|', vert: '|', VerticalLine: '|',
  rcub: '}', rbrace: '}',
  nbsp: ' ', NonBreakingSpace: ' ', ensp: ' ', emsp: ' ', emsp13: ' ', emsp14: ' ', numsp: ' ', puncsp: ' ', thinsp: ' ', ThinSpace: ' ',
  hairsp: ' ', VeryThinSpace: ' ', MediumSpace: ' ',
  ZeroWidthSpace: '', NoBreak: '', zwnj: '', zwj: '', shy: '', lrm: '', rlm: '',
  hyphen: '-', dash: '-', minus: '-', ndash: '-', mdash: '-', horbar: '-',
};

/** Entities a browser also decodes without the closing semicolon. */
const LEGACY_NO_SEMICOLON: ReadonlySet<string> = new Set(['amp', 'AMP', 'lt', 'LT', 'gt', 'GT', 'quot', 'QUOT', 'nbsp']);

const fromCodePoint = (cp: number): string | null => {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  return String.fromCodePoint(cp);
};

/** Decode numeric (decimal and hex, with or without the semicolon) and the named entities above. Two passes: `&amp;#64;` is caught too. */
export function decodeHtmlEntities(text: string): string {
  const once = (s: string): string =>
    s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}))(;?)/g, (whole: string, dec?: string, hex?: string, name?: string, semi?: string) => {
      if (dec !== undefined) return fromCodePoint(Number.parseInt(dec, 10)) ?? whole;
      if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16)) ?? whole;
      if (name !== undefined && Object.prototype.hasOwnProperty.call(NAMED, name) && (semi === ';' || LEGACY_NO_SEMICOLON.has(name))) {
        return NAMED[name] as string;
      }
      return whole;
    });
  return once(once(text));
}

/** Decode `\uXXXX`, `\u{X...}`, `\xXX` and the identity escapes of punctuation that matters (`\/`, `\.`, `\@` ...), as JavaScript and JSON write them. */
export function decodeJsEscapes(text: string): string {
  return text
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (whole: string, h: string) => fromCodePoint(Number.parseInt(h, 16)) ?? whole)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_w: string, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_w: string, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\([/.()+@:_-])/g, '$1');
}

/** Decode `%XX` for ASCII characters only (multi-byte sequences are left alone: they cannot spell an address or a marker). */
export function decodePercent(text: string): string {
  return text.replace(/%([0-9a-fA-F]{2})/g, (whole: string, h: string) => {
    const code = Number.parseInt(h, 16);
    return code < 0x80 ? String.fromCharCode(code) : whole;
  });
}

const digitCache = new Map<number, string>();

/**
 * Map every Unicode decimal digit (Tamil, Devanagari, Arabic-Indic, full-width, ...) to 0-9. Decimal digits come in runs of ten starting
 * at a zero, so the value is the distance from the start of the contiguous run, modulo ten.
 */
export function mapDigitsToAscii(text: string): string {
  return text.replace(/\p{Nd}/gu, (ch: string) => {
    const cp = ch.codePointAt(0) as number;
    if (cp < 128) return ch;
    const cached = digitCache.get(cp);
    if (cached !== undefined) return cached;
    let start = cp;
    while (cp - start < 100 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    const value = String((cp - start) % 10);
    digitCache.set(cp, value);
    return value;
  });
}

/** Zero-width, bidirectional-control, soft-hyphen and variation-selector characters: invisible to a reader, so they must not break a match. */
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

const INLINE_TAGS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

const newlinesOf = (s: string): string => s.replace(/[^\n]/g, '');

const TAG = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?\/?>/g;

/**
 * Remove markup the way a reader would see the text. Comments and INLINE tags (`<b>`, `<span>`, `<a>` ...) are removed without a gap, so
 * `9876<b>5</b>43210` reads as one number; every other tag becomes a space, so `<td>98765</td><td>43210</td>` stays two cells.
 * The CONTENT of `<script>` and `<style>` elements is left alone (code such as `a<b&&c>d` is not a tag). Newlines are kept.
 */
export function stripTags(text: string): string {
  const outside = (s: string): string =>
    s
      .replace(/<!--[\s\S]*?-->/g, (c) => newlinesOf(c))
      .replace(TAG, (whole: string, _slash: string, name: string) => `${INLINE_TAGS.has(name.toLowerCase()) ? '' : ' '}${newlinesOf(whole)}`);
  let out = '';
  let last = 0;
  const raw = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;
  let m: RegExpExecArray | null;
  while ((m = raw.exec(text)) !== null) {
    out += outside(text.slice(last, m.index));
    out += ` ${newlinesOf(m[1] as string)}${m[3] as string} ${newlinesOf(m[4] as string)}`;
    last = m.index + m[0].length;
  }
  out += outside(text.slice(last));
  return out;
}

/** Exotic spaces and dashes to plain ones (NFKC does most of the spaces; the dashes are not touched by it). */
const normaliseSpacesAndDashes = (s: string): string =>
  s.replace(/[  - \u202f 　]/g, ' ').replace(/[‐-―−﹘﹣－]/g, '-');

export interface NormaliseOptions {
  /** Remove markup first (see stripTags). Default false. */
  stripTags?: boolean;
}

/**
 * The scanning view of a text: markup optionally removed, then entities, percent-encoding and JavaScript escapes decoded, invisible
 * characters removed, compatibility forms folded (full-width letters and digits, no-break spaces), every decimal digit mapped to 0-9.
 */
export function normaliseText(text: string, options: NormaliseOptions = {}): string {
  let s = options.stripTags ? stripTags(text) : text;
  s = decodeHtmlEntities(s);
  s = decodePercent(s);
  s = decodeJsEscapes(s);
  s = stripInvisible(s);
  s = normaliseSpacesAndDashes(s);
  s = s.normalize('NFKC');
  s = mapDigitsToAscii(s);
  return s;
}

/** Join adjacent string literals written as `"a"+"b"` (a way to hide a token from a literal search). Only quote-to-same-quote joins. */
export function joinStringConcatenation(text: string): string {
  return text.replace(/(["'`])\s*\+\s*\1/g, '');
}

/** Candidate base64 blobs (24 or more characters of the base64 alphabet) decoded to text, one per line, printable results only. */
export function decodeBase64Blobs(text: string, maxTotal = 400_000): string {
  const out: string[] = [];
  let total = 0;
  const re = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{24,}={0,2}(?![A-Za-z0-9+/_-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let decoded: string;
    try {
      decoded = Buffer.from(m[0], 'base64').toString('latin1');
    } catch {
      continue;
    }
    if (decoded.length < 12) continue;
    // keep only blobs that decode to mostly printable ASCII
    let printable = 0;
    for (let i = 0; i < decoded.length; i++) {
      const c = decoded.charCodeAt(i);
      if (c >= 32 && c < 127) printable++;
    }
    if (printable / decoded.length < 0.9) continue;
    total += decoded.length;
    if (total > maxTotal) break;
    out.push(decoded);
  }
  return out.join('\n');
}
