import { describe, expect, it } from 'vitest';
import { basisPoints, csvCell, paiseToDecimal, percentFromBasisPoints, plainNumber, sanitizeText, toCsv } from '../../src/lib/reports/csv';

describe('formula injection protection', () => {
  it.each(['=1+1', '+91 98765', '-2+3', '@SUM(A1)', '=cmd|" /C calc"!A0', '\t=1', '\r=1', ' =1', ' =1', '​=1', '﻿=1', '  \t @x'])('defuses %j with a leading apostrophe', (text) => {
    expect(sanitizeText(text)).toBe(`'${text}`);
    expect(csvCell(text).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it.each(['plain text', 'a=b', 'x+y', 'name - suffix', 'email@example.com', '100%', ''])('leaves %j alone', (text) => {
    expect(sanitizeText(text)).toBe(text);
  });

  it('defuses a dangerous value inside a quoted cell', () => {
    expect(csvCell('=HYPERLINK("http://x.example","a"),b')).toBe(`"'=HYPERLINK(""http://x.example"",""a""),b"`);
  });

  it('never prefixes a real number, including a negative one', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12)).toBe('12');
  });

  it('a text cell that merely looks like a negative number is defused (it is text)', () => {
    expect(csvCell('-5')).toBe("'-5");
  });
});

describe('CSV structure', () => {
  it('quotes commas, quotes and line breaks and uses CRLF rows', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(toCsv([['a', 'b'], ['c', 'd']], { bom: false })).toBe('a,b\r\nc,d\r\n');
  });

  it('starts with a byte order mark by default so a spreadsheet reads Tamil text correctly', () => {
    const csv = toCsv([['தமிழ்']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('தமிழ்');
  });

  it('writes nothing for null and undefined and drops control characters', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('a\u0000b\u0007c')).toBe('abc');
  });

  it('an empty row is an empty line', () => {
    expect(toCsv([['a'], [], ['b']], { bom: false })).toBe('a\r\n\r\nb\r\n');
  });
});

describe('numbers are Indian-locale safe', () => {
  it('writes plain digits with no grouping and a dot decimal', () => {
    expect(plainNumber(100000)).toBe('100000');
    expect(plainNumber(1234567.5)).toBe('1234567.5');
    expect(plainNumber(0.000001)).toBe('0.000001');
    expect(csvCell(100000)).not.toMatch(/[, ]/);
  });
  it('writes nothing for NaN and infinity', () => {
    expect(plainNumber(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });
  it('converts integer paise to rupees by integer arithmetic', () => {
    expect(paiseToDecimal(12345600)).toBe('123456.00');
    expect(paiseToDecimal(5)).toBe('0.05');
    expect(paiseToDecimal(-250)).toBe('-2.50');
    expect(paiseToDecimal(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    expect(() => paiseToDecimal(1.5)).toThrow(RangeError);
    expect(() => paiseToDecimal(Number.NaN)).toThrow(RangeError);
  });
  it('computes click-through rate in basis points rounded half up, never dividing by zero', () => {
    expect(basisPoints(1, 3)).toBe(3333);
    expect(basisPoints(2, 3)).toBe(6667);
    expect(basisPoints(1, 8)).toBe(1250);
    expect(basisPoints(5, 0)).toBeNull();
    expect(basisPoints(-1, 10)).toBeNull();
    expect(basisPoints(0, 10)).toBe(0);
    expect(percentFromBasisPoints(1250)).toBe('12.50');
    expect(percentFromBasisPoints(5)).toBe('0.05');
  });
});

describe('injection corpus (S2-1, B2-12): no cell may start as a live formula after the writer has finished', () => {
  const HEADS = ['=', '+', '-', '@', '\uff1d', '\uff0b', '\uff0d', '\uff20', '\u2212', '\ufe62', '\ufe63', '\ufe66', '\ufe6b'];
  const HIDDEN = ['', '\u0000', '\u0001', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f', '\u007f', '\u0080', '\u009f', '\t', '\r', '\n', ' ', '\u00a0', '\u1680', '\u2000', '\u2003', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u202a', '\u202e', '\u2028', '\u2029', '\u2060', '\u2066', '\u2069', '\u3000', '\ufeff', '\u0001\u0002', ' \t\u200b\u202e'];
  const TAILS = ['1+1', 'cmd|" /C calc"!A0', 'HYPERLINK("http://x.example","y")', 'SUM(A1:A9)', ''];
  /** What a spreadsheet sees: the written cell, unquoted, NFKC-folded, leading blanks and controls removed. */
  const firstVisible = (written: string): string => {
    const unq = written.startsWith('"') ? written.slice(1, -1).replace(/""/g, '"') : written;
    return unq.normalize('NFKC').replace(/^[\p{White_Space}\p{Cc}\p{Cf}]+/u, '');
  };

  it('neutralises every combination of hidden prefix, formula head and tail', () => {
    let n = 0;
    for (const hidden of HIDDEN) for (const head of HEADS) for (const tail of TAILS) {
      const cell = `${hidden}${head}${tail}`;
      const written = csvCell(cell);
      const seen = firstVisible(written);
      expect(/^[=+\-@\u2212]/.test(seen), JSON.stringify(cell)).toBe(false);
      n += 1;
    }
    expect(n).toBeGreaterThan(1500);
  });

  it('the cases from the reviews', () => {
    for (const c of ['\u0001=HYPERLINK("http://x","y")', '\u0000+cmd|calc', '\u0000=1+1', '\u0001@SUM(A1)', '\u007f-2', '\u0008+1']) {
      expect(csvCell(c).replace(/^"/, '')).toMatch(/^'/);
    }
  });

  it('a value that starts with a control or bidi character is prefixed even when no formula follows (it could hide one)', () => {
    expect(csvCell('\u202ehello').replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell('\u200bhello').replace(/^"/, '')).toMatch(/^'/);
  });

  it('keeps Tamil text, commas, quotes and newlines intact and escaped', () => {
    expect(csvCell('தமிழ் பெயர்')).toBe('தமிழ் பெயர்');
    expect(csvCell('பெயர், "ஊர்"\nவரி 2')).toBe('"பெயர், ""ஊர்""\nவரி 2"');
    expect(csvCell('Asha, "Shuttle" Club')).toBe('"Asha, ""Shuttle"" Club"');
    expect(csvCell('a-b+c=d@e')).toBe('a-b+c=d@e');
  });
});
