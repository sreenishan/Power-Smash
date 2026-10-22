import { describe, expect, it } from 'vitest';
import {
  decodeBase64Blobs,
  decodeHtmlEntities,
  decodeJsEscapes,
  decodePercent,
  joinStringConcatenation,
  mapDigitsToAscii,
  normaliseText,
  stripInvisible,
  stripTags,
} from '../../scripts/lib/text-normalise.ts';

const digits = (zero: number, text = '0123456789'): string => [...text].map((c) => String.fromCodePoint(zero + Number(c))).join('');

describe('text normalisation: entities, escapes, percent-encoding', () => {
  it('decodes numeric entities (decimal, hex, with and without the semicolon) and the punctuation names', () => {
    expect(decodeHtmlEntities('a&#64;b &#x40;c &#64d &commat; &period; &lpar;x&rpar; &nbsp;|&NonBreakingSpace;')).toBe('a@b @c @d @ . (x)  | ');
  });

  it('decodes a double-encoded entity (&amp;#64;) and leaves unknown or out-of-range ones alone', () => {
    expect(decodeHtmlEntities('x&amp;#64;y')).toBe('x@y');
    expect(decodeHtmlEntities('&notanentity; &#99999999; &#xD800; &ampx')).toBe('&notanentity; &#99999999; &#xD800; &ampx');
  });

  it('decodes JavaScript and JSON escapes', () => {
    expect(decodeJsEscapes('a\\u0040b \\u{40} \\x40 c\\/d e\\.f')).toBe('a@b @ @ c/d e.f');
  });

  it('decodes percent-encoding of ASCII only', () => {
    expect(decodePercent('owner%40gmail.com %2B91 %28x%29 %E0%AE%A4 100%')).toBe('owner@gmail.com +91 (x) %E0%AE%A4 100%');
  });

  it('removes zero-width and bidi characters', () => {
    expect(stripInvisible('TO\u200bDO\u2060(ow\u00adner)\ufeff\u202a')).toBe('TODO(owner)');
  });
});

describe('text normalisation: digits of other scripts', () => {
  it('maps Tamil, Devanagari, Arabic-Indic, extended Arabic-Indic, Bengali and full-width digits to ASCII', () => {
    for (const zero of [0x0be6, 0x0966, 0x0660, 0x06f0, 0x09e6, 0xff10, 0x1d7ce, 0x1d7d8, 0x0d66]) {
      expect(mapDigitsToAscii(digits(zero))).toBe('0123456789');
    }
  });

  it('leaves ASCII digits and letters alone and maps each digit to its own value', () => {
    expect(mapDigitsToAscii('ab 12 ௯௮')).toBe('ab 12 98');
  });

  it('the full normaliser handles a phone number written in Tamil digits with a no-break space', () => {
    const tamil = `${digits(0x0be6, '98765')}\u00a0${digits(0x0be6, '43210')}`;
    expect(normaliseText(tamil)).toBe('98765 43210');
  });

  it('folds full-width letters, brackets and the no-break and narrow spaces', () => {
    expect(normaliseText('ＴＯＤＯ（ｏｗｎｅｒ）')).toBe('TODO(owner)');
    expect(normaliseText('9\u202f8')).toBe('9 8');
    expect(normaliseText('98‐76')).toBe('98-76');
  });
});

describe('text normalisation: markup', () => {
  it('removes inline tags and comments without a gap, other tags with a space', () => {
    expect(stripTags('9876<b>5</b>43210')).toBe('9876543210');
    expect(stripTags('98765<!-- x -->43210')).toBe('9876543210');
    expect(stripTags('<td>98765</td><td>43210</td>')).toBe(' 98765  43210 ');
  });

  it('keeps the newlines inside a tag or a comment, so line numbers survive', () => {
    expect(stripTags('a<span\nclass="x">b</span>\n<!--\n-->c').split('\n')).toHaveLength(4);
  });

  it('leaves the content of script and style elements alone (a<b&&c>d is code, not a tag)', () => {
    expect(stripTags('<script>if(a<b&&c>d){x()}</script>')).toContain('if(a<b&&c>d){x()}');
    expect(stripTags('<style>a>b{color:red}</style>')).toContain('a>b{color:red}');
  });

  it('tags with > inside a quoted attribute are removed whole', () => {
    expect(stripTags('x<a title="a>b" href=\'c>d\'>y</a>z')).toBe('xyz');
  });

  it('normaliseText with stripTags reads a marker split by markup', () => {
    expect(normaliseText('TODO(<b>owner</b>)', { stripTags: true })).toBe('TODO(owner)');
  });
});

describe('text normalisation: string concatenation and base64', () => {
  it('joins adjacent string literals written as "a"+"b"', () => {
    expect(joinStringConcatenation('x="sb_"+"secret_"+"tail"')).toBe('x="sb_secret_tail"');
    expect(joinStringConcatenation("y='ab' + 'cd'")).toBe("y='abcd'");
    expect(joinStringConcatenation('z="a"+\'b\'')).toBe('z="a"+\'b\''); // different quotes: not a join
  });

  it('decodes printable base64 blobs and ignores binary-looking ones', () => {
    const printable = Buffer.from('this is a hidden sb_secret_ style token for the test').toString('base64');
    const binary = Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 37) % 256)).toString('base64');
    const out = decodeBase64Blobs(`a="${printable}";b="${binary}"`);
    expect(out).toContain('hidden sb_secret_ style token');
    expect(out).not.toContain(binary);
  });
});
