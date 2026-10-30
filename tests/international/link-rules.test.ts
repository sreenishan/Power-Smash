// The official-link rules of international events (D-112): the host allow-list (lookalike hosts, user info, ports, punycode, IP
// addresses and link shorteners refused), tracking parameters removed, and the stored form the SQL accepts. Fictional data only.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_HOSTS,
  allowedHosts,
  checkInternationalEvent,
  cleanExtraHosts,
  cleanHost,
  hostProblem,
  isTrackingParam,
  linkHost,
  normaliseOfficialLink,
  storedLinkProblem,
} from '../../src/lib/international/link-rules';

const ok = (input: string, extra: string[] = []) => {
  const r = normaliseOfficialLink(input, extra);
  if (!r.ok) throw new Error(`expected ok for ${input}: ${r.problem}`);
  return r;
};
const refused = (input: string, extra: string[] = []) => {
  const r = normaliseOfficialLink(input, extra);
  if (r.ok) throw new Error(`expected a refusal for ${input}, got ${r.url}`);
  return r.problem;
};

describe('the default allow-list', () => {
  it('is exactly the three official sites of D-112', () => {
    expect([...DEFAULT_ALLOWED_HOSTS]).toEqual(['bwfbadminton.com', 'tournamentsoftware.com', 'bwf.tournamentsoftware.com']);
  });

  it('accepts the allowed sites, with or without www., http or https', () => {
    expect(ok('https://bwfbadminton.com/calendar/').url).toBe('https://bwfbadminton.com/calendar/');
    expect(ok('https://www.bwfbadminton.com').url).toBe('https://www.bwfbadminton.com/');
    expect(ok('http://bwf.tournamentsoftware.com/tournament/x?id=ABC-123').url).toBe('http://bwf.tournamentsoftware.com/tournament/x?id=ABC-123');
    expect(ok('  HTTPS://WWW.TournamentSoftware.com/sport/  ').url).toBe('https://www.tournamentsoftware.com/sport/');
    expect(ok('https://bwfbadminton.com/').host).toBe('bwfbadminton.com');
  });
});

describe('refused links', () => {
  it.each([
    ['a lookalike suffix', 'https://bwfbadminton.com.evil.test/'],
    ['a lookalike prefix', 'https://evilbwfbadminton.com/'],
    ['a hyphenated lookalike', 'https://bwf-badminton.com/'],
    ['another top-level domain', 'https://bwfbadminton.co/'],
    ['a typo', 'https://bwfbadmintom.com/'],
    ['another sub-domain', 'https://corporate.bwfbadminton.com/'],
    ['www twice', 'https://www.www.bwfbadminton.com/'],
    ['a chain of allowed names', 'https://tournamentsoftware.com.bwfbadminton.com.evil.test/'],
    ['a sub-domain of an allowed sub-domain', 'https://x.bwf.tournamentsoftware.com/'],
  ])('%s', (_label, url) => {
    expect(refused(url)).toMatch(/must be on bwfbadminton\.com, tournamentsoftware\.com or bwf\.tournamentsoftware\.com/);
  });

  it.each([
    ['user info', 'https://user@bwfbadminton.com/'],
    ['user and password', 'https://user:secret@bwfbadminton.com/'],
    ['an allowed name used as user info', 'https://bwfbadminton.com@evil.test/'],
    ['an allowed name used as user info with a path', 'https://bwfbadminton.com@evil.test/bwfbadminton.com/'],
  ])('%s', (_label, url) => {
    expect(refused(url)).toMatch(/user name or password/);
  });

  it.each([
    ['a default port', 'https://bwfbadminton.com:443/'],
    ['another port', 'https://bwfbadminton.com:8443/x'],
    ['an empty port', 'https://bwfbadminton.com:/x'],
  ])('%s', (_label, url) => {
    expect(refused(url)).toMatch(/port/);
  });

  it.each([
    ['punycode', 'https://xn--bwfbdminton-q9a.com/'],
    ['a Cyrillic a (typed as Unicode)', 'https://bwfbаdminton.com/'],
    ['a punycode top-level part', 'https://bwfbadminton.xn--p1ai/'],
    ['punycode in upper case', 'https://XN--bwfbdminton-q9a.com/'],
  ])('%s', (_label, url) => {
    expect(refused(url)).toMatch(/other alphabets/);
  });

  it('other schemes and incomplete addresses', () => {
    expect(refused('ftp://bwfbadminton.com/')).toMatch(/https:\/\//);
    expect(refused('javascript:alert(1)')).toMatch(/https:\/\//);
    expect(refused('data:text/html,x')).toMatch(/https:\/\//);
    expect(refused('bwfbadminton.com/x')).toMatch(/https:\/\//);
    expect(refused('//bwfbadminton.com/')).toMatch(/https:\/\//);
    expect(refused('https:///bwfbadminton.com')).toMatch(/website name/);
    expect(refused('')).toMatch(/Paste the link/);
  });

  it('spaces, backslashes, control characters and very long links', () => {
    expect(refused('https://bwfbadminton.com/a b')).toMatch(/spaces/);
    expect(refused('https://bwfbadminton.com\\@evil.test/')).toMatch(/backslash/);
    expect(refused('https://bwfbadminton.com/\u0000')).toMatch(/spaces/);
    expect(refused(`https://bwfbadminton.com/${'a'.repeat(600)}`)).toMatch(/too long/);
  });

  it('IP addresses and other hosts (unless the owner adds them)', () => {
    expect(refused('https://192.168.0.1/')).toMatch(/not on the list/);
    expect(refused('https://example.org/x')).toMatch(/"example\.org" is not on the list/);
    expect(ok('https://www.example.org/x', ['example.org']).url).toBe('https://www.example.org/x');
  });
});

describe('tracking parameters and the # part', () => {
  it('are removed; everything else stays', () => {
    const r = ok('https://bwfbadminton.com/x/?id=7&utm_source=a&UTM_Medium=b&fbclid=c&gclid=d&tab=2#results');
    expect(r.url).toBe('https://bwfbadminton.com/x/?id=7&tab=2');
    expect(r.removedTracking).toBe(true);
    expect(ok('https://bwfbadminton.com/?utm_campaign=x').url).toBe('https://bwfbadminton.com/');
    expect(ok('https://bwfbadminton.com/?id=1').removedTracking).toBe(false);
    expect(ok('https://bwfbadminton.com/#top').url).toBe('https://bwfbadminton.com/');
  });

  it('isTrackingParam knows the list and the utm_ prefix', () => {
    for (const p of ['utm_source', 'utm_anything', 'fbclid', 'GCLID', 'msclkid', '_ga', '_gl']) expect(isTrackingParam(p), p).toBe(true);
    for (const p of ['id', 'tab', 'utm', 'ref']) expect(isTrackingParam(p), p).toBe(false);
  });
});

describe('storedLinkProblem (the SQL mirror)', () => {
  const hosts = allowedHosts();
  it('accepts every link normaliseOfficialLink produces', () => {
    for (const u of ['https://bwfbadminton.com/', 'https://www.tournamentsoftware.com/a?b=c', 'http://bwf.tournamentsoftware.com/x']) {
      expect(storedLinkProblem(ok(u).url, hosts), u).toBeNull();
    }
  });
  it('refuses what is not in the stored form', () => {
    for (const u of ['https://bwfbadminton.com', 'https://bwfbadminton.com/#x', 'https://BWFbadminton.com/', 'https://u@bwfbadminton.com/', 'https://bwfbadminton.com:1/',
      'https://bwfbadminton.com/?utm_x=1', 'https://bwfbadminton.com/<x>', 'https://example.org/']) {
      expect(storedLinkProblem(u, hosts), u).not.toBeNull();
    }
    expect(storedLinkProblem('https://example.org/', null)).toBeNull();
  });
  it('linkHost drops www.', () => {
    expect(linkHost('https://www.bwfbadminton.com/x')).toBe('bwfbadminton.com');
    expect(linkHost('not a link')).toBeNull();
  });
});

describe('the owner\'s extra hosts', () => {
  it('cleanHost takes a pasted address down to the website name', () => {
    expect(cleanHost(' HTTPS://www.Example.org/path?x#y ')).toBe('example.org');
    expect(cleanHost('example.org.')).toBe('example.org');
  });
  it('hostProblem refuses www, punycode, shorteners, IPs and odd shapes', () => {
    expect(hostProblem('example.org')).toBeNull();
    expect(hostProblem('www.example.org')).toMatch(/www/);
    expect(hostProblem('xn--exmple-cua.org')).toMatch(/punycode/);
    expect(hostProblem('bit.ly')).toMatch(/shorteners/);
    expect(hostProblem('127.0.0.1')).toMatch(/IP address/);
    expect(hostProblem('example')).not.toBeNull();
    expect(hostProblem('ex_ample.org')).not.toBeNull();
    expect(hostProblem('-example.org')).not.toBeNull();
  });
  it('cleanExtraHosts drops defaults and repeats, sorts, refuses a bad one in plain English', () => {
    expect(cleanExtraHosts(['www.Example.org', 'example.org', 'bwfbadminton.com', ' ', 'example.net'])).toEqual({ ok: true, hosts: ['example.net', 'example.org'] });
    const bad = cleanExtraHosts(['example.org', 'https://bit.ly/x']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problem).toMatch(/^https:\/\/bit\.ly\/x: Link shorteners/);
    expect(cleanExtraHosts(Array.from({ length: 21 }, (_, i) => `site${i}.example.org`)).ok).toBe(false);
  });
});

describe('checkInternationalEvent', () => {
  const base = { name: 'Sample World Open 2026', levelText: '', startDate: '2026-11-17', endDate: '2026-11-22', city: '', country: 'Demo Country', officialUrl: 'https://bwfbadminton.com/?utm_source=x', published: true };
  it('cleans a good form', () => {
    const r = checkInternationalEvent({ ...base, name: '  Sample   World Open 2026 ' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ name: 'Sample World Open 2026', levelText: null, startDate: '2026-11-17', endDate: '2026-11-22', city: null, country: 'Demo Country', officialUrl: 'https://bwfbadminton.com/', published: true });
      expect(r.removedTracking).toBe(true);
    }
  });
  it('gives a plain sentence per field', () => {
    const r = checkInternationalEvent({ ...base, name: 'x', country: '', startDate: '2026-02-30', officialUrl: 'https://evil.test/' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['country', 'name', 'officialUrl', 'startDate']);
    const order = checkInternationalEvent({ ...base, endDate: '2026-11-16' });
    if (!order.ok) expect(order.errors.endDate).toMatch(/cannot be before/);
    const long = checkInternationalEvent({ ...base, endDate: '2027-01-30' });
    if (!long.ok) expect(long.errors.endDate).toMatch(/at most 60 days/);
    const tags = checkInternationalEvent({ ...base, name: '<b>Sample</b>' });
    if (!tags.ok) expect(tags.errors.name).toMatch(/< or >/);
  });
});
