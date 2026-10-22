import { describe, expect, it } from 'vitest';
import {
  hostAllowed,
  isBot,
  isExpired,
  isUuid,
  isValidSlug,
  normalizeAllowedHosts,
  pageFromReferer,
  resolveTarget,
  utmFor,
  utmQueryString,
  withUtm,
} from '../../src/lib/infra/go';
import type { GoLink } from '../../src/lib/infra/go';

const HOSTS = ['sponsor.example', 'shop.partner.example'];
const link = (over: Partial<GoLink> = {}): GoLink => ({ target: 'https://sponsor.example/landing', label: 'sponsored', ...over });

describe('slug', () => {
  it('accepts lower-case letters, digits and hyphens only', () => {
    for (const ok of ['a', 'example-sponsor', 'x1', 'a-b-c', 'a'.repeat(63)]) expect(isValidSlug(ok), ok).toBe(true);
    for (const bad of ['', '-a', 'A', 'a_b', 'a/b', 'a.b', 'a b', '../x', 'a'.repeat(64), undefined, null, 5]) expect(isValidSlug(bad), String(bad)).toBe(false);
  });
});

describe('allowed hosts: no open redirect', () => {
  it('matches exactly or as a subdomain, never as a look-alike', () => {
    expect(hostAllowed('sponsor.example', HOSTS)).toBe(true);
    expect(hostAllowed('www.sponsor.example', HOSTS)).toBe(true);
    expect(hostAllowed('SPONSOR.example', HOSTS)).toBe(true);
    expect(hostAllowed('evilsponsor.example', HOSTS)).toBe(false);
    expect(hostAllowed('sponsor.example.evil.com', HOSTS)).toBe(false);
    expect(hostAllowed('example', HOSTS)).toBe(false);
    expect(hostAllowed('partner.example', HOSTS)).toBe(false); // only shop.partner.example was listed
  });

  it('an empty list allows nothing', () => {
    expect(hostAllowed('sponsor.example', [])).toBe(false);
    expect(resolveTarget(link(), [])).toBeNull();
  });

  it('ignores unusable list entries (wildcards, schemes, ports, IP addresses, bare words)', () => {
    expect(normalizeAllowedHosts(['*.example.com', 'https://a.example', 'a.example:8080', '10.0.0.1', 'com', ' OK.example ', 'ok.example', 'a/b.example'])).toEqual(['ok.example']);
  });
});

describe('resolveTarget', () => {
  it('accepts https on an allowed host', () => {
    const t = resolveTarget(link(), HOSTS);
    expect(t?.kind).toBe('external');
  });

  it.each([
    ['http (not https)', 'http://sponsor.example/x'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hi'],
    ['a host that is not allowed', 'https://other.example/x'],
    ['a login in the URL', 'https://user:pass@sponsor.example/x'],
    ['a user name trick', 'https://sponsor.example@evil.example/x'],
    ['a port', 'https://sponsor.example:8443/x'],
    ['a protocol-relative URL', '//sponsor.example/x'],
    ['a relative path on an external link', '/book'],
    ['not a URL at all', 'sponsor'],
  ])('refuses %s', (_name, target) => {
    expect(resolveTarget(link({ target }), HOSTS)).toBeNull();
  });

  it('internal links take a path on this site only', () => {
    expect(resolveTarget(link({ label: 'internal', target: '/partner' }), [])).toEqual({ kind: 'internal', path: '/partner' });
    expect(resolveTarget(link({ label: 'internal', target: '/book?x=1#a' }), [])).toEqual({ kind: 'internal', path: '/book?x=1#a' });
    for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'partner', 'javascript:1']) {
      expect(resolveTarget(link({ label: 'internal', target: bad }), []), bad).toBeNull();
    }
  });

  it('B-7: dot segments that normalise to a protocol-relative path are refused', () => {
    const bad = [
      '/..//evil.example',
      '/.//evil.example',
      '/x/..//evil.example/path',
      '/a/b/../..//evil.example',
      '/..\\/evil.example',
      '/x/..\\\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/%2e%2e//evil.example',
      '/.%2e//evil.example',
    ];
    for (const target of bad) expect(resolveTarget(link({ label: 'internal', target }), []), JSON.stringify(target)).toBeNull();
  });

  it('B-7: ordinary dot segments and encoded slashes stay on this site', () => {
    expect(resolveTarget(link({ label: 'internal', target: '/a/../partner' }), [])).toEqual({ kind: 'internal', path: '/partner' });
    expect(resolveTarget(link({ label: 'internal', target: '/x/./y?q=//z#//w' }), [])).toEqual({ kind: 'internal', path: '/x/y?q=//z#//w' });
    expect(resolveTarget(link({ label: 'internal', target: '/%2F/evil.example' }), [])).toEqual({ kind: 'internal', path: '/%2F/evil.example' });
  });

  it('B-7 fuzz: every resolved internal path starts with a single slash and stays on this origin', () => {
    const parts = ['/', '..', '.', '%2e', '%2f', '\\', '\t', 'a', '/..', '//', 'evil.example', '?', '#'];
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    let resolved = 0;
    for (let i = 0; i < 3000; i++) {
      let target = '/';
      for (let j = 0, n = 1 + rand(6); j < n; j++) target += parts[rand(parts.length)];
      const r = resolveTarget(link({ label: 'internal', target }), []);
      if (r === null) continue;
      resolved++;
      expect(r.kind).toBe('internal');
      const path = (r as { path: string }).path;
      expect(path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\'), JSON.stringify(target)).toBe(true);
      expect(new URL(path, 'https://internal.invalid').origin, JSON.stringify(target)).toBe('https://internal.invalid');
    }
    expect(resolved).toBeGreaterThan(100); // the fuzz really reached the success path
  });

  it('isUuid accepts a uuid in any case and nothing else (B-16)', () => {
    expect(isUuid('0b6f4c2e-3d1a-4f5b-8a9c-1d2e3f4a5b6c')).toBe(true);
    expect(isUuid('0B6F4C2E-3D1A-4F5B-8A9C-1D2E3F4A5B6C')).toBe(true);
    const bad = ['sp-1', '', '0b6f4c2e3d1a4f5b8a9c1d2e3f4a5b6c', '0b6f4c2e-3d1a-4f5b-8a9c-1d2e3f4a5b6', ' 0b6f4c2e-3d1a-4f5b-8a9c-1d2e3f4a5b6c', null, undefined, 42, {}];
    for (const value of bad) expect(isUuid(value as unknown), String(value)).toBe(false);
  });
});

describe('expiry', () => {
  const now = new Date('2026-12-31T10:00:00Z'); // 15:30 on 31 December in India
  it('no expiry never expires', () => {
    expect(isExpired(link(), now)).toBe(false);
    expect(isExpired(link({ expires: null }), now)).toBe(false);
    expect(isExpired(link({ expires: '' }), now)).toBe(false);
  });

  it('a date-only expiry lasts through the end of that day in India (UTC+5:30)', () => {
    expect(isExpired(link({ expires: '2026-12-31' }), now)).toBe(false);
    expect(isExpired(link({ expires: '2026-12-31' }), new Date('2026-12-31T18:29:59Z'))).toBe(false); // 23:59:59 IST
    expect(isExpired(link({ expires: '2026-12-31' }), new Date('2026-12-31T18:30:01Z'))).toBe(true); // 00:00:01 IST next day
    expect(isExpired(link({ expires: '2026-12-30' }), now)).toBe(true);
  });

  it('a full instant is compared exactly', () => {
    expect(isExpired(link({ expires: '2026-12-31T09:59:59Z' }), now)).toBe(true);
    expect(isExpired(link({ expires: '2026-12-31T10:00:01Z' }), now)).toBe(false);
  });

  it('an expiry that cannot be read counts as expired (fail closed)', () => {
    expect(isExpired(link({ expires: 'next tuesday' }), now)).toBe(true);
  });
});

describe('UTM parameters', () => {
  it('sponsored and partner links are medium=sponsor, affiliate links medium=affiliate, internal links carry none', () => {
    expect(utmFor('sponsored', 'abc')).toEqual({ utm_source: 'powersmash', utm_medium: 'sponsor', utm_campaign: 'abc' });
    expect(utmFor('partner', 'abc')?.utm_medium).toBe('sponsor');
    expect(utmFor('affiliate', 'abc')?.utm_medium).toBe('affiliate');
    expect(utmFor('internal', 'abc')).toBeNull();
    expect(utmQueryString(utmFor('sponsored', 'abc')!)).toBe('utm_source=powersmash&utm_medium=sponsor&utm_campaign=abc');
  });

  const utm = utmFor('sponsored', 'abc')!;

  it('appends to a URL without a query', () => {
    expect(withUtm(new URL('https://sponsor.example/landing'), utm).toString()).toBe('https://sponsor.example/landing?utm_source=powersmash&utm_medium=sponsor&utm_campaign=abc');
  });

  it('appends after an existing query, byte for byte, and keeps the fragment', () => {
    const out = withUtm(new URL('https://sponsor.example/a?x=1&name=a%20b%2Bc#section'), utm).toString();
    expect(out).toBe('https://sponsor.example/a?x=1&name=a%20b%2Bc&utm_source=powersmash&utm_medium=sponsor&utm_campaign=abc#section');
  });

  it('keeps a fragment when there is no query', () => {
    expect(withUtm(new URL('https://sponsor.example/#top'), utm).toString()).toBe('https://sponsor.example/?utm_source=powersmash&utm_medium=sponsor&utm_campaign=abc#top');
  });

  it('never overrides a UTM parameter the target already carries (any case)', () => {
    const out = new URL(withUtm(new URL('https://sponsor.example/a?utm_source=theirs&UTM_CAMPAIGN=theirs2'), utm).toString());
    expect(out.searchParams.get('utm_source')).toBe('theirs');
    expect(out.searchParams.get('UTM_CAMPAIGN')).toBe('theirs2');
    expect(out.searchParams.get('utm_medium')).toBe('sponsor');
    expect(out.searchParams.getAll('utm_source')).toHaveLength(1);
  });

  it('leaves the original URL object untouched', () => {
    const original = new URL('https://sponsor.example/a?x=1');
    withUtm(original, utm);
    expect(original.search).toBe('?x=1');
  });
});

describe('bot detection', () => {
  const chrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const instagram = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0';

  it('real browsers, including in-app browsers, are not bots', () => {
    for (const ua of [chrome, safari, instagram]) expect(isBot(ua), ua).toBe(false);
  });

  it('crawlers, link previews, tools and missing user agents are bots', () => {
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'TelegramBot (like TwitterBot)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'curl/8.4.0 and more text',
      'python-requests/2.31.0',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0)',
      'HeadlessChrome/120 something long',
      'UptimeRobot/2.0 monitoring',
    ];
    for (const ua of bots) expect(isBot(ua), ua).toBe(true);
    for (const ua of [null, undefined, '', '   ', 'x']) expect(isBot(ua), String(ua)).toBe(true);
  });

  it('prefetch and preview requests are not counted either', () => {
    const headers = (h: Record<string, string>) => new Headers(h);
    expect(isBot(chrome, headers({ 'sec-purpose': 'prefetch' }))).toBe(true);
    expect(isBot(chrome, headers({ purpose: 'prefetch' }))).toBe(true);
    expect(isBot(chrome, headers({ 'x-moz': 'prefetch' }))).toBe(true);
    expect(isBot(chrome, headers({ accept: '*/*' }))).toBe(false);
  });
});

describe('referer', () => {
  const origins = ['https://powersmash.in', 'https://power-smash.account.workers.dev'];
  it('keeps only the PATH of a same-site referer (no query, no fragment)', () => {
    expect(pageFromReferer('https://powersmash.in/pricing?utm_x=1#a', origins)).toBe('/pricing');
    expect(pageFromReferer('https://power-smash.account.workers.dev/', origins)).toBe('/');
  });
  it('drops other sites, junk and over-long paths', () => {
    expect(pageFromReferer('https://evil.example/pricing', origins)).toBeNull();
    expect(pageFromReferer('https://powersmash.in.evil.example/', origins)).toBeNull();
    expect(pageFromReferer(null, origins)).toBeNull();
    expect(pageFromReferer('', origins)).toBeNull();
    expect(pageFromReferer('not a url', origins)).toBeNull();
    expect(pageFromReferer(`https://powersmash.in/${'a'.repeat(300)}`, origins)).toBeNull();
  });
});
