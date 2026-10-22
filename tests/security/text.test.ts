import { describe, expect, it } from 'vitest';
import {
  cleanText,
  csvSafeCell,
  longestDigitRun,
  normaliseEmail,
  normaliseHttpsUrl,
  normalisePhone,
  sanitisedFirstName,
  stripToOneLine,
  toAsciiDigits,
} from '../../src/lib/security/text';

describe('cleanText', () => {
  it('trims, collapses spaces, normalises to NFC and counts code points', () => {
    expect(cleanText('  Ravi    Kumar ', { max: 20 })).toEqual({ ok: true, value: 'Ravi Kumar' });
    expect(cleanText('é', { max: 1 })).toEqual({ ok: true, value: 'é' });
    expect(cleanText('😀😀😀', { max: 3 }).ok).toBe(true);
    expect(cleanText('😀😀😀😀', { max: 3 })).toEqual({ ok: false, issue: 'too_long' });
    expect(cleanText('', { max: 3 })).toEqual({ ok: false, issue: 'too_short' });
    expect(cleanText('ab', { min: 3, max: 9 })).toEqual({ ok: false, issue: 'too_short' });
  });

  it('allows ZWNJ/ZWJ (used in Indic scripts) but not other invisible characters', () => {
    expect(cleanText('a‌b‍c', { max: 9 }).ok).toBe(true);
    for (const ch of ['​', '‎', '‮', '⁦', '﻿', ' ']) {
      expect(cleanText(`a${ch}b`, { max: 9 })).toEqual({ ok: false, issue: 'control_chars' });
    }
  });

  it('multi-line keeps single line breaks and rejects stray CR', () => {
    expect(cleanText('a\r\nb', { max: 9, multiline: true })).toEqual({ ok: true, value: 'a\nb' });
    expect(cleanText('a\rb', { max: 9, multiline: true })).toEqual({ ok: false, issue: 'control_chars' });
    expect(cleanText('a\nb', { max: 9 })).toEqual({ ok: false, issue: 'control_chars' });
  });

  it('rules can allow links, formulas, markup and long digit runs when a field needs them', () => {
    expect(cleanText('see example.com', { max: 30 }).ok).toBe(false);
    expect(cleanText('see example.com', { max: 30, allowUrl: true }).ok).toBe(true);
    expect(cleanText('=1+1', { max: 30 }).ok).toBe(false);
    expect(cleanText('=1+1', { max: 30, allowFormula: true }).ok).toBe(true);
    expect(cleanText('a<b', { max: 30 }).ok).toBe(false);
    expect(cleanText('a<b', { max: 30, allowAngle: true }).ok).toBe(true);
    expect(cleanText('ref 12345678', { max: 30 }).ok).toBe(false);
    expect(cleanText('ref 12345678', { max: 30, allowManyDigits: true }).ok).toBe(true);
  });

  it('digit runs are counted per number, so years and ages are fine', () => {
    expect(longestDigitRun('Open 2026-27 U19')).toBe(6);
    expect(longestDigitRun('98765 43210')).toBe(10);
    expect(longestDigitRun('no digits')).toBe(0);
    expect(cleanText('Open 2026-27 U19', { max: 40 }).ok).toBe(true);
    expect(cleanText('call 98765 43210', { max: 40 })).toEqual({ ok: false, issue: 'too_many_digits' });
  });

  it('absurd input is refused quickly', () => {
    expect(cleanText('x'.repeat(1_000_000), { max: 10 })).toEqual({ ok: false, issue: 'too_long' });
  });
});

describe('normalisePhone', () => {
  it('turns Tamil and other digits into ASCII', () => {
    expect(toAsciiDigits('௧௨௩')).toBe('123');
    expect(toAsciiDigits('１２')).toBe('12');
    expect(toAsciiDigits('१२')).toBe('12');
  });

  it('accepts Indian mobiles in every common form and explicit international numbers', () => {
    for (const p of ['9876543210', '09876543210', '+919876543210', '91 98765 43210', '+91-98765-43210', '0091 9876543210', '(98765) 43210']) {
      expect(normalisePhone(p), p).toBe('919876543210');
    }
    expect(normalisePhone('+1 415 555 0132')).toBe('14155550132');
  });

  it('rejects letters, short numbers, wrong prefixes, injection', () => {
    for (const p of ['9876543210\r\n', '\t9876543210', '', ' ', 'phone', '12345', '5876543210', '98765432100', '+91 5876543210', '9876543210;ls', '98765\n43210', '9876543210x']) {
      expect(normalisePhone(p), JSON.stringify(p)).toBeNull();
    }
  });
});

describe('normaliseEmail', () => {
  it('lower-cases and trims valid ASCII addresses', () => {
    expect(normaliseEmail(' A.B+tag@Example.TEST ')).toBe('a.b+tag@example.test');
  });

  it('rejects the usual attacks and oddities', () => {
    const bad = [
      'a@example.test\r\n',
      '\ta@example.test',
      '',
      'plain',
      'a@b',
      'a@b.',
      '@example.test',
      'a@@example.test',
      'a b@example.test',
      'a@example.test\r\nBcc: x@example.test',
      'a@example.test,b@example.test',
      '"a"@example.test',
      'a@exämple.test',
      '.a@example.test',
      'a..b@example.test',
      `${'a'.repeat(65)}@example.test`,
      `a@${'b'.repeat(250)}.test`,
      '<a@example.test>',
      'a@example.t',
    ];
    for (const e of bad) expect(normaliseEmail(e), JSON.stringify(e)).toBeNull();
  });
});

describe('normaliseHttpsUrl', () => {
  it('accepts https links with a real host and drops the fragment', () => {
    expect(normaliseHttpsUrl('https://Example.com/a?b=1#frag')).toBe('https://example.com/a?b=1');
    expect(normaliseHttpsUrl('https://example.com:443/x')).toBe('https://example.com/x');
  });

  it('refuses everything else', () => {
    const bad = [
      'https://example.com/\r\n',
      'http://example.com',
      'https://127.0.0.1',
      'https://10.0.0.1/x',
      'https://[::1]/',
      'https://localhost',
      'https://x.internal/a',
      'https://a:b@example.com',
      'https://example.com:8080',
      'javascript:alert(1)',
      'data:text/html,x',
      '//example.com',
      'https://exa mple.com',
      'https://example.com/"onmouseover',
      `https://example.com/${'a'.repeat(400)}`,
      'https://example',
      '',
    ];
    for (const u of bad) expect(normaliseHttpsUrl(u), u).toBeNull();
  });
});

describe('output sanitisers', () => {
  it('stripToOneLine removes line breaks and control characters (header and message safety)', () => {
    expect(stripToOneLine('Ravi\r\nBcc: x\u0000\t y')).toBe('Ravi Bcc: x y');
    expect(stripToOneLine('x'.repeat(500), 10)).toHaveLength(10);
  });

  it('sanitisedFirstName gives a letters-only first name or "there"', () => {
    expect(sanitisedFirstName('Ravi Kumar')).toBe('Ravi');
    expect(sanitisedFirstName('ரவி குமார்')).toBe('ரவி');
    expect(sanitisedFirstName("D'Souza A")).toBe("D'Souza");
    expect(sanitisedFirstName('=cmd|x')).toBe('cmdx');
    expect(sanitisedFirstName('12345')).toBe('there');
    expect(sanitisedFirstName('')).toBe('there');
    expect(sanitisedFirstName('Ravi\r\nBcc: evil@example.test')).toBe('Ravi');
    expect(sanitisedFirstName('A'.repeat(100)).length).toBe(20);
  });

  it('csvSafeCell prefixes formula starters (D-029) and quotes when needed', () => {
    for (const f of ['=cmd', '+1', '-1', '@x', '\tx', '\rx']) expect(csvSafeCell(f).replace(/^"/, '')).toMatch(/^'/);
    expect(csvSafeCell('plain')).toBe('plain');
    expect(csvSafeCell('a,b')).toBe('"a,b"');
    expect(csvSafeCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvSafeCell(null)).toBe('');
    expect(csvSafeCell(42)).toBe('42');
  });
});
