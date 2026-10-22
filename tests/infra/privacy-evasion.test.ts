// Review finding S-2 / B-17: the privacy scan must see through the usual ways of writing a contact detail or a secret differently.
// Every input here was MISSED by the raw-text scan. Secret-shaped strings are built at run time (no secret-looking literal is committed).
import { afterEach, describe, expect, it } from 'vitest';
import { loadOfficialContacts, scanPrivacy } from '../../scripts/privacy-scan.ts';
import { CODE_NUMBER_ALLOWLIST, isAllowedCodeNumber } from '../../scripts/lib/privacy-rules.ts';
import { cleanupTemp, fakeSupabaseSecret, makeDist, page } from './helpers';

afterEach(cleanupTemp);

const none = loadOfficialContacts({}, null);
const NUMBER = '9876543210';
const digitsIn = (zero: number, text = NUMBER): string => [...text].map((c) => String.fromCodePoint(zero + Number(c))).join('');

const rulesOf = (files: Record<string, string>, official = none, secrets: Record<string, string> = {}): string[] =>
  scanPrivacy(makeDist(files), official, secrets).findings.map((f) => f.rule);
const phoneHit = (rules: string[]): boolean => rules.some((r) => r.includes('mobile') || r.includes('phone'));

describe('privacy scan sees through phone-number disguises in a page', () => {
  const disguised: Array<[string, string]> = [
    ['plain 5-5 (control)', '98765 43210'],
    ['Tamil digits', digitsIn(0x0be6)],
    ['Arabic-Indic digits', digitsIn(0x0660)],
    ['Devanagari digits', digitsIn(0x0966)],
    ['full-width digits', digitsIn(0xff10)],
    ['Tamil digits in two groups with a no-break space', `${digitsIn(0x0be6, '98765')}\u00a043210`],
    ['named no-break space', '98765&nbsp;43210'],
    ['decimal-entity no-break space', '98765&#160;43210'],
    ['hex-entity no-break space', '98765&#xA0;43210'],
    ['raw no-break space', '98765\u00a043210'],
    ['narrow no-break space', '98765\u202f43210'],
    ['dot between groups', '98765.43210'],
    ['brackets around the first group', '(98765) 43210'],
    ['markup in the middle', '9876<b>5</b>43210'],
    ['a comment in the middle', '98765<!-- x -->43210'],
    ['zero-width space in the middle', '98765\u200b43210'],
    ['decimal-entity digits', '&#57;&#56;&#55;&#54;&#53;&#52;&#51;&#50;&#49;&#48;'],
    ['4-3-3 grouping', '9876 543 210'],
    ['3-3-4 with dashes', '999-990-0000'],
    ['2-2-2-2-2 grouping', '98-76-54-32-10'],
    ['+91 with dashes', '+91-98765-43210'],
    ['percent-encoded plus in a tel: link', '<a href="tel:%2B919876543210">x</a>'],
    ['a tel: link with entity digits', '<a href="tel:&#43;91&#57;876543210">x</a>'],
  ];

  for (const [name, body] of disguised) {
    it(`finds: ${name}`, () => {
      const html = body.startsWith('<') ? page(body) : page(`<p>Call ${body} today</p>`);
      expect(phoneHit(rulesOf({ 'index.html': html })), body).toBe(true);
    });
  }

  it('finds Indian landline numbers', () => {
    for (const body of ['044 2345 6789', '(044) 2345 6789', '044-23456789', '+91 44 2345 6789', '0484 2345678']) {
      expect(rulesOf({ 'index.html': page(`<p>${body}</p>`) }), body).toContain('indian-landline-phone');
    }
  });

  it('finds the number inside a JSON file written with unicode escapes and inside JSON-LD', () => {
    expect(phoneHit(rulesOf({ 'data/x.json': '{"tel":"\\u0039876543210"}' }))).toBe(true);
    expect(phoneHit(rulesOf({ 'index.html': page('<script type="application/ld+json">{"telephone":"+91\\u00a09876543210"}</script>') }))).toBe(true);
    expect(phoneHit(rulesOf({ 'data/y.json': '{"tel":"9876543210"}' }))).toBe(true); // control: plain
  });

  it('finds a bare 10-digit number in a script and in an SVG (they were skipped before)', () => {
    expect(rulesOf({ '_astro/a.js': `var p=${NUMBER};` })).toContain('indian-mobile-number-code');
    expect(rulesOf({ '_astro/a.js': `var p="${NUMBER}";` })).toContain('indian-mobile-number-code');
    expect(rulesOf({ 'brand/x.svg': `<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="2">${NUMBER}</text></svg>` })).toContain('indian-mobile-number-code');
    expect(rulesOf({ '_astro/a.js': 'var p=919876543210;' })).toContain('indian-mobile-number-code');
  });

  it('finds a script number written with a unicode escape or in Tamil digits', () => {
    expect(phoneHit(rulesOf({ '_astro/a.js': 'var p="\\u0039876543210";' }))).toBe(true);
    expect(phoneHit(rulesOf({ '_astro/a.js': `var p="${digitsIn(0x0be6)}";` }))).toBe(true);
  });

  it('finds the number in a page even when it is split over table cells with markup and entities', () => {
    expect(phoneHit(rulesOf({ 'index.html': page('<p>98<i>76</i>5&nbsp;&#52;3210</p>') }))).toBe(true);
  });
});

describe('privacy scan sees through email disguises', () => {
  const disguised: Array<[string, string, string]> = [
    ['decimal entity at-sign', 'index.html', page('<p>owner&#64;example.com</p>')],
    ['named entity at-sign', 'index.html', page('<p>owner&commat;example.com</p>')],
    ['percent-encoded at-sign in a mailto link', 'index.html', page('<a href="mailto:owner%40example.com">x</a>')],
    ['JSON unicode escape', 'data/x.json', '{"mail":"owner\\u0040example.com"}'],
    ['[at] and [dot]', 'index.html', page('<p>owner [at] example [dot] com</p>')],
    ['(at) and (dot)', 'index.html', page('<p>owner(at)example(dot)com</p>')],
    ['markup inside the address', 'index.html', page('<p>owner@<b>example</b>.com</p>')],
  ];
  for (const [name, file, content] of disguised) {
    it(`finds: ${name}`, () => {
      const rules = rulesOf({ [file]: content });
      expect(rules.some((r) => r.startsWith('email-address')), name).toBe(true);
    });
  }

  it('an official email in a disguise is allowed, another one is not', () => {
    const official = loadOfficialContacts({}, "publicEmail: 'hello@fixture.example',");
    expect(rulesOf({ 'index.html': page('<p>hello&#64;fixture.example and hello [at] fixture [dot] example</p>') }, official)).toEqual([]);
    expect(rulesOf({ 'index.html': page('<p>other&#64;fixture.example</p>') }, official)).toEqual(['email-address']);
  });
});

describe('privacy scan sees through secret disguises', () => {
  const secret = fakeSupabaseSecret();

  it('finds a secret written with entities, a unicode escape or a string concatenation', () => {
    expect(rulesOf({ 'index.html': page(`<p>${secret.replace(/_/g, '&#95;')}</p>`) })).toContain('supabase-secret-key');
    expect(rulesOf({ '_astro/a.js': `const k="${secret.replace('_', '\\u005f')}";` })).toContain('supabase-secret-key');
    expect(rulesOf({ '_astro/a.js': `const k="sb_"+"${secret.slice(3)}";` })).toContain('supabase-secret-key');
  });

  it('finds a secret hidden in a base64 string', () => {
    const encoded = Buffer.from(secret).toString('base64');
    expect(rulesOf({ '_astro/a.js': `const k=atob("${encoded}");` })).toContain('supabase-secret-key');
  });

  it('finds a Turnstile secret key shape and a Resend key, built at run time', () => {
    const turnstile = `0x4${'A'.repeat(8)}${'b9'.repeat(12)}`;
    const resend = `re_${'Ab3'.repeat(4)}_${'Zq9'.repeat(9)}`;
    const rules = rulesOf({ 'index.html': page(`<p>${turnstile}</p><p>${resend}</p>`) });
    expect(rules).toContain('turnstile-secret-key');
    expect(rules).toContain('resend-api-key');
  });

  it('does not take a snake_case identifier for a Resend key, nor the short public Turnstile site key for a secret', () => {
    const rules = rulesOf({ '_astro/a.js': 'function re_render_the_whole_page_again_now(){}const site="0x4AAAAAAAfixturekeyfixture";' });
    expect(rules).toEqual([]);
  });

  it('finds the exact value of a private variable written with entities', () => {
    const value = `${'pa55'}-${'word'}&-${'12345678'}`;
    const report = scanPrivacy(makeDist({ 'index.html': page(`<p>${value.replace('&', '&amp;')}</p>`) }), none, { RESEND_API_KEY: value });
    expect(report.findings.map((f) => f.rule)).toEqual(['known-secret-value:RESEND_API_KEY']);
  });
});

describe('privacy scan: official numbers stay allowed in every disguise, other numbers on the same page do not', () => {
  const official = loadOfficialContacts({ PUBLIC_WHATSAPP_NUMBER: '919876500001' }, null);

  it('allows the official number written with entities, dots, brackets or Tamil digits', () => {
    const forms = ['98765&nbsp;00001', '98765.00001', '(98765) 00001', digitsIn(0x0be6, '9876500001'), '+91 98765 00001', '9876<b>5</b>00001', '919876500001'];
    for (const f of forms) expect(rulesOf({ 'index.html': page(`<p>${f}</p>`) }, official), f).toEqual([]);
  });

  it('still reports another number on the same page', () => {
    const rules = rulesOf({ 'index.html': page('<p>98765&nbsp;00001</p><p>98765&nbsp;43210</p>') }, official);
    expect(rules.filter((r) => r === 'indian-mobile-number')).toHaveLength(1);
  });

  it('the official number in a script is allowed (a wa.me link built in code), another bare number is not', () => {
    expect(rulesOf({ '_astro/a.js': 'var u="https://wa.me/919876500001";var p="9876500001";' }, official)).toEqual([]);
    expect(rulesOf({ '_astro/a.js': 'var p="9876543210";' }, official)).toEqual(['indian-mobile-number-code']);
  });
});

describe('privacy scan: no false alarm on what a real build contains', () => {
  const buildOutput = [
    'const t=1760000000000;const u=1760000000;const m=9007199254740991;const a=4294967295,b=2147483647,c=1073741823;',
    'var f=0.9876543210,g=.9876543210,h=1e10,i=0xFF98765432,j=3.14159265358979;',
    'import{t as e}from"./react.DJY1zw8Z.js";const cid="data-astro-cid-abc9876543210";const k="a9876543210b";',
    'x="sha256-AbC9876543210dEf/GhIjKlMnOpQrStUvWxYz0123456789+aaaa=";',
    'const v="9.8.7";const w="2026-10-21";const y=[1,2,3,4,5,6,7,8,9,10,11,12];',
    'font-weight:600;transition:all 0.3s;width:98765px;margin:0 0 6000000000px;',
  ].join('\n');
  const html = page(
    '<img src="/_astro/hero.AbC12345.avif" width="1200" height="630" srcset="/_astro/a_1200.avif 1200w, /_astro/a_600.avif 600w">' +
      '<a href="https://www.facebook.com/Page-Name-1877488702345552/">fb</a>' +
      '<p>Price 5,000 - 12,500. Open 10 am - 6 pm. Slots 7 8 9 10 11 12 13. Year 2026-2027. Ref PS-2026-0001.</p>' +
      '<link rel="canonical" href="https://example.com/">',
  );

  it('a typical bundle and page produce no findings', () => {
    expect(rulesOf({ 'index.html': html, '_astro/app.AbC123.js': buildOutput, '_astro/site.css': 'a{margin:0 auto;font:600 1rem/1.5 x}' })).toEqual([]);
  });

  it('build-time sizes, hashes and timestamps in a JSON manifest do not trigger it', () => {
    const manifest = JSON.stringify({ built: 1760000000000, bytes: 123456789, files: { 'a.js': { size: 65682, gzip: 22222, hash: 'AbC12345' } } });
    expect(rulesOf({ 'manifest.json': manifest })).toEqual([]);
  });
});

describe('the code-number allowlist is exact', () => {
  const list = [{ file: '_astro/x.js', digits: NUMBER, reason: 'test entry' }];

  it('ships empty (nothing in the current build output needs an exception)', () => {
    expect(CODE_NUMBER_ALLOWLIST).toEqual([]);
  });

  it('excuses exactly that file and exactly that number', () => {
    expect(isAllowedCodeNumber('_astro/x.js', NUMBER, list)).toBe(true);
    expect(isAllowedCodeNumber('_astro/x.js', `"${NUMBER}"`, list)).toBe(true); // quotes around the match do not matter
    expect(isAllowedCodeNumber('_astro/y.js', NUMBER, list)).toBe(false);
    expect(isAllowedCodeNumber('_astro/x.js', '9876543211', list)).toBe(false);
    expect(isAllowedCodeNumber('_astro/x.js', `${NUMBER}0`, list)).toBe(false);
    expect(isAllowedCodeNumber('sub/_astro/x.js', NUMBER, list)).toBe(false);
  });

  it('scanPrivacy honours the list: the allowed number is counted, another number in the same file is reported', () => {
    const root = makeDist({ '_astro/x.js': `var a="${NUMBER}";var b="9876543211";` });
    const report = scanPrivacy(root, none, {}, list);
    expect(report.findings.map((f) => f.rule)).toEqual(['indian-mobile-number-code']);
    expect(report.allowedOfficial['code-number-allowlist']).toBe(1);
  });
});
