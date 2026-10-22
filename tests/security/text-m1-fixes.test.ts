// Regression tests for the M1 review-fix wave in src/lib/security/text.ts: B-1 (R-PHONE), B-2 (R-TEXT), S-4 (link detector
// speed) and S-6 (email alias key).
import { describe, expect, it } from 'vitest';
import { LABEL_CHARS_RE, NAME_CHARS_RE, stripPhoneIgnorables } from '../../src/lib/contracts/lead-constants';
import { cleanText, countUrlLike, emailRateKey, normalisePhone } from '../../src/lib/security/text';

describe('B-1 / R-PHONE: a number pasted from WhatsApp or Contacts is accepted', () => {
  const NBSP = ' ';
  const THIN = ' ';
  const NNBSP = ' ';
  const FIGURE = ' ';
  it('removes no-break and thin spaces, zero-width and direction marks before checking', () => {
    const accepted = [
      `+91${NBSP}98765 43210`,
      `+91${NNBSP}98765${NNBSP}43210`,
      `98765${THIN}43210`,
      `98765${FIGURE}43210`,
      '‪+91 98765 43210‬',
      '‎+91 98765 43210',
      '‏+91 98765 43210‎',
      '​9876543210​',
      '﻿9876543210',
      '⁦+91 98765 43210⁩',
      '‭98765 43210‮',
      `‪+91${NBSP}98765${NBSP}43210‬`,
    ];
    for (const p of accepted) expect(normalisePhone(p), JSON.stringify(p)).toBe('919876543210');
    expect(normalisePhone('98765 43210')).toBe('919876543210'); // plain forms are unchanged
  });

  it('removing them does not loosen anything else: letters, CR/LF, other separators and a bare invisible string stay refused', () => {
    for (const bad of ['‎', NBSP, '98765–43210', '98765‌43210', '9876543210\r\n', '98765\n43210', 'abc‎9876543210', '‎12345']) {
      expect(normalisePhone(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('exports the helper the browser copy can use, with exactly the agreed set', () => {
    expect(stripPhoneIgnorables('a    ​‎‏‪‫‬‭‮⁦⁧⁨⁩﻿b')).toBe('ab');
    expect(stripPhoneIgnorables('a b-c')).toBe('a b-c'); // ordinary space and hyphen stay
    expect(stripPhoneIgnorables('a‌b')).toBe('a‌b'); // ZWNJ is not in the agreed set
  });
});

describe('B-2 / R-TEXT: single-line free text accepts the characters people paste from posters', () => {
  const label = (s: string) => cleanText(s, { max: 120, pattern: LABEL_CHARS_RE });
  it('accepts the rupee sign, en and em dash, curly quotes, % ! ? and the middle dot', () => {
    const ok = [
      '₹25,000',
      '₹ 500 per player',
      '20% advance',
      'Chennai Open – Men’s Doubles',
      'Cup — 2026',
      'Cup “26”',
      'Cup ‘26’ Open',
      'Cup 2026!',
      'Open 2026?',
      'Smash · Chennai',
      'Rs 25,000',
      'Madurai (East) & West / Day 1',
    ];
    for (const s of ok) expect(label(s), s).toEqual({ ok: true, value: s });
  });

  it('still rejects control characters, markup, brackets, backslash, pipe, backtick and a leading = + - @', () => {
    const bad = ['Cup\u0007', 'Cup\nDay', 'Cup <b>', 'Cup {x}', 'Cup [x]', 'Cup \\ x', 'Cup | Day', 'Cup `x`', 'a;b', 'a*b', 'a_b', 'a$b', 'a~b', 'a^b', 'say "hi"', '=SUM(A1)', '+91 98765', '-5', '@name'];
    for (const s of bad) expect(label(s).ok, JSON.stringify(s)).toBe(false);
    expect(label('=2+3')).toEqual({ ok: false, issue: 'formula_not_allowed' });
  });

  it('a person name keeps the narrow set (no currency sign, quotes or marks)', () => {
    const name = (s: string) => cleanText(s, { min: 2, max: 80, pattern: NAME_CHARS_RE });
    expect(name('Ravi O’Brien-Kumar Jr.').ok).toBe(true);
    for (const bad of ['Ravi!', 'Ravi ₹', 'Ravi “K”', 'Ravi%']) expect(name(bad).ok, bad).toBe(false);
  });
});

describe('S-4: no quadratic scan in the link detector', () => {
  const ms = (fn: () => unknown) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  // The FASTEST of a few runs: the whole suite runs on many busy workers, and one slow run (a pause, a cold start) says nothing
  // about the algorithm. The old code needed more than 100 ms for the 1,500-character input on an idle machine, every run.
  const best = (fn: () => unknown, runs = 7) => Math.min(...Array.from({ length: runs }, () => ms(fn)));

  it('a 1,500-character run of hyphens then Tamil letters is checked in well under 5 ms (the old code: 139 ms; bounded but still slow: 10 ms)', () => {
    const input = '-'.repeat(750) + 'ஆ'.repeat(750);
    expect(best(() => countUrlLike(input))).toBeLessThan(5);
    expect(best(() => cleanText(input, { max: 1500, multiline: true }))).toBeLessThan(5);
  });

  it('cost grows with the length, not its square: 8 times the text takes about 8 times as long (not 64)', () => {
    for (const unit of ['-', 'ஆ-', 'a', 'a.', 'a-b.', 'http']) {
      const small = unit.repeat(Math.ceil(5000 / unit.length));
      const large = unit.repeat(Math.ceil(40_000 / unit.length));
      const ratio = best(() => countUrlLike(large)) / Math.max(best(() => countUrlLike(small)), 0.05);
      expect(ratio, JSON.stringify(unit)).toBeLessThan(30);
    }
  });

  it('40,000 hostile characters of any shape finish well within a second', () => {
    const shapes = [
      '-'.repeat(20_000) + 'ஆ'.repeat(20_000),
      'ஆ-'.repeat(20_000),
      'a'.repeat(40_000),
      '1'.repeat(40_000),
      'a.'.repeat(20_000),
      'a-b.'.repeat(10_000),
      'http'.repeat(10_000),
      '+'.repeat(40_000),
    ];
    for (const input of shapes) expect(ms(() => countUrlLike(input)), input.slice(0, 8)).toBeLessThan(1000);
  });

  it('two hostile 1,500-character fields validate quickly', () => {
    const field = 'ஆ-'.repeat(750);
    const both = () => {
      for (let i = 0; i < 2; i += 1) cleanText(field, { max: 1500, multiline: true });
    };
    expect(best(both)).toBeLessThan(80);
  });

  it('still catches the links and handles it was written to catch', () => {
    for (const text of ['visit http://evil.example/x', 'ftp://x.test', 'see www.example.test', 'wa.me/919876543210', 'my-site.example.com', 'a-b-c.co.in', '--x.io', 'xy.in', 'HTTPS://EVIL.EXAMPLE', 'bit.ly/abc']) {
      expect(countUrlLike(text), text).toBeGreaterThan(0);
    }
    for (const text of ['Chennai Open 2026', 'a-b-c d-e-f', 'five.five', 'v1.2 notes', 'hello world']) expect(countUrlLike(text), text).toBe(0);
    expect(countUrlLike(`${'a'.repeat(70)}.com`)).toBe(0); // longer than any DNS label: not a host name
  });
});

describe('S-6: emailRateKey folds aliases of one mailbox', () => {
  it('removes +tags everywhere and dots for Gmail only (googlemail.com is gmail.com)', () => {
    expect(emailRateKey('victim@gmail.com')).toBe('victim@gmail.com');
    expect(emailRateKey('victim+1@gmail.com')).toBe('victim@gmail.com');
    expect(emailRateKey('v.i.c.t.i.m+news@gmail.com')).toBe('victim@gmail.com');
    expect(emailRateKey('v.ictim@googlemail.com')).toBe('victim@gmail.com');
    expect(emailRateKey('first.last+tag@example.test')).toBe('first.last@example.test');
    expect(emailRateKey('first.last@example.test')).toBe('first.last@example.test');
    expect(emailRateKey('firstlast@example.test')).toBe('firstlast@example.test');
    expect(emailRateKey('a+b+c@example.test')).toBe('a@example.test');
    expect(emailRateKey('+tag@example.test')).toBe('+tag@example.test'); // nothing before the plus: keep it, never an empty key
    expect(emailRateKey('x.y@notgmail.com')).toBe('x.y@notgmail.com');
    expect(emailRateKey('not-an-email')).toBe('not-an-email');
  });
});
