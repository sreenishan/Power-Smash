// QR posters (spec 9.4): URL and UTM building, slug validation, the SVG, the poster model. Pure functions, no network.
import { describe, expect, it } from 'vitest';
import type { TournamentRecord } from '../../src/content/tournaments';
import { CHANNEL_POSTER_SLUG, QR_QUIET_ZONE, buildQrTarget, checkSiteOrigin, isPosterSlug, matrixFromSvg, qrMatrix, qrSvg, svgFromMatrix } from '../../src/lib/qr';
import { buildPoster, posterSlugs } from '../../src/lib/qr/poster';
import { M3_ROUTES, ROUTES, posterPath } from '../../src/lib/urls';

const ORIGIN = 'https://example.test';

const sample = (over: Partial<TournamentRecord> = {}): TournamentRecord => ({
  slug: 'sample-open-2027-sampletown',
  name: 'Sample Open 2027',
  startDate: '2027-02-10',
  endDate: '2027-02-12',
  venue: 'Sample Indoor Stadium',
  city: 'Sampletown',
  district: null,
  level: null,
  categories: [],
  organizerName: null,
  description: null,
  status: 'scheduled',
  coveredByPowerSmash: false,
  showContact: false,
  contact: null,
  ...over,
});

describe('poster slugs', () => {
  it('accepts lowercase letters, digits and single hyphens', () => {
    for (const ok of ['a', 'channel', 'sample-open-2027-sampletown', '2027', 'a1-b2', 'x'.repeat(80)]) expect(isPosterSlug(ok), ok).toBe(true);
  });
  it('refuses everything else', () => {
    const bad = ['', 'Upper', 'two words', 'a_b', '-a', 'a-', 'a--b', 'a/b', '../x', 'a?b=1', 'a&b', 'a#b', 'a%20b', 'a.b', 'x'.repeat(81), '<script>', 'a\nb', 'நிகழ்வு'];
    for (const value of bad) expect(isPosterSlug(value), JSON.stringify(value)).toBe(false);
    for (const value of [null, undefined, 5, {}, []]) expect(isPosterSlug(value as never)).toBe(false);
  });
  it('posterPath gives the A4 and A3 addresses, or null', () => {
    expect(posterPath('channel')).toBe('/posters/channel/');
    expect(posterPath('channel', 'a3')).toBe('/posters/channel/a3/');
    expect(posterPath('Bad Slug')).toBeNull();
    expect(posterPath('a/b', 'a3')).toBeNull();
  });
});

describe('the site address for a QR code', () => {
  it('needs an https origin with nothing after it', () => {
    expect(checkSiteOrigin('https://example.test')).toEqual({ ok: true, origin: ORIGIN, local: false });
    expect(checkSiteOrigin('https://example.test/')).toEqual({ ok: true, origin: ORIGIN, local: false });
    expect(checkSiteOrigin(null)).toEqual({ ok: false, reason: 'missing' });
    expect(checkSiteOrigin('  ')).toEqual({ ok: false, reason: 'missing' });
    expect(checkSiteOrigin('not a url')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkSiteOrigin('http://example.test')).toEqual({ ok: false, reason: 'not-https' });
    expect(checkSiteOrigin('https://example.test/path')).toEqual({ ok: false, reason: 'has-path' });
    expect(checkSiteOrigin('https://example.test/?a=1')).toEqual({ ok: false, reason: 'has-path' });
    expect(checkSiteOrigin('https://user:pw@example.test')).toEqual({ ok: false, reason: 'has-path' });
  });
  it('flags a local address; plain http only for it and only when asked', () => {
    expect(checkSiteOrigin('https://localhost')).toMatchObject({ ok: true, local: true });
    expect(checkSiteOrigin('http://localhost:4321')).toEqual({ ok: false, reason: 'not-https' });
    expect(checkSiteOrigin('http://localhost:4321', { allowLocalHttp: true })).toMatchObject({ ok: true, local: true, origin: 'http://localhost:4321' });
    expect(checkSiteOrigin('http://example.test', { allowLocalHttp: true })).toEqual({ ok: false, reason: 'not-https' });
    expect(checkSiteOrigin('https://127.0.0.1')).toMatchObject({ local: true });
  });
});

describe('the QR target address and its UTM tags', () => {
  it('tournament: utm_source=qr&utm_medium=venue&utm_campaign=<slug>', () => {
    const url = buildQrTarget(ORIGIN, { kind: 'tournament', slug: 'sample-open-2027-sampletown' });
    expect(url).toBe('https://example.test/tournaments/sample-open-2027-sampletown/?utm_source=qr&utm_medium=venue&utm_campaign=sample-open-2027-sampletown');
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('utm_source')).toBe('qr');
    expect(parsed.searchParams.get('utm_medium')).toBe('venue');
    expect(parsed.hash).toBe('');
  });
  it('channel poster: home page, campaign "channel"', () => {
    expect(buildQrTarget(ORIGIN, { kind: 'channel' })).toBe('https://example.test/?utm_source=qr&utm_medium=venue&utm_campaign=channel');
  });
  it('a slug off the allow-list gives null', () => {
    for (const slug of ['a&utm_source=evil', 'a/../b', 'a#frag', 'A', '', 'a b', 'x'.repeat(81)]) {
      expect(buildQrTarget(ORIGIN, { kind: 'tournament', slug }), JSON.stringify(slug)).toBeNull();
    }
  });
  it('a bad origin gives null', () => {
    for (const origin of ['', 'nope', 'http://example.test', 'https://example.test/x', 'javascript:alert(1)']) expect(buildQrTarget(origin, { kind: 'channel' }), origin).toBeNull();
  });
});

describe('the QR matrix and the SVG', () => {
  const text = 'https://example.test/tournaments/sample-open-2027-sampletown/?utm_source=qr&utm_medium=venue&utm_campaign=sample-open-2027-sampletown';

  it('uses error correction level M', () => {
    const m = qrMatrix(text);
    expect(m.ecLevel).toBe('M');
    expect(m.size).toBe(m.version * 4 + 17);
  });

  it('has the three finder squares and the timing patterns', () => {
    const { rows, size } = qrMatrix(text);
    const finder = (x0: number, y0: number) => {
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 7; x += 1) {
          const edge = x === 0 || x === 6 || y === 0 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          expect(rows[y0 + y]![x0 + x]).toBe(edge || core);
        }
      }
    };
    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);
    for (let i = 8; i < size - 8; i += 1) {
      expect(rows[6]![i]).toBe(i % 2 === 0);
      expect(rows[i]![6]).toBe(i % 2 === 0);
    }
  });

  it('is a self-contained SVG: starts with <svg, no script, link, style or handler', () => {
    const svg = qrSvg(text, { label: 'QR code for Sample Open' });
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/<script|<style|<a[\s>]|<image|<foreignObject|href=|javascript:|\son[a-z]+=/i);
    expect(svg.match(/<[a-z]+/gi)!.map((t) => t.toLowerCase())).toEqual(['<svg', '<title', '<rect', '<path']);
    const total = qrMatrix(text).size + QR_QUIET_ZONE * 2;
    expect(svg).toContain(`viewBox="0 0 ${total} ${total}"`);
  });

  it('keeps the quiet zone and black on white', () => {
    const svg = qrSvg(text);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    const size = qrMatrix(text).size;
    const coords = [...svg.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((x) => ({ x: Number(x[1]), y: Number(x[2]), w: Number(x[3]) }));
    expect(Math.min(...coords.map((c) => c.x))).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
    expect(Math.max(...coords.map((c) => c.x + c.w))).toBeLessThanOrEqual(QR_QUIET_ZONE + size);
  });

  it('round trip: the SVG read back equals the matrix, for several inputs', () => {
    for (const input of [text, 'https://example.test/?utm_source=qr&utm_medium=venue&utm_campaign=channel', 'A']) {
      const m = qrMatrix(input);
      expect(matrixFromSvg(svgFromMatrix(m), m.size)).toEqual(m.rows.map((r) => [...r]));
    }
  });

  it('is deterministic', () => {
    expect(qrSvg(text)).toBe(qrSvg(text));
    expect(qrSvg(text)).not.toBe(qrSvg(`${text}x`));
  });

  it('the label cannot break out of the markup', () => {
    const svg = qrSvg('x', { label: '"><script>alert(1)</script><svg onload=1>' });
    expect(svg).not.toContain('<script');
    expect(svg).not.toMatch(/onload=/);
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
  });
});

describe('the poster model', () => {
  it('lists the channel first, then each tournament that is not cancelled', () => {
    expect(posterSlugs([])).toEqual([CHANNEL_POSTER_SLUG]);
    expect(posterSlugs([sample(), sample({ slug: 'gone', status: 'cancelled' }), sample({ slug: 'other-cup' })])).toEqual([CHANNEL_POSTER_SLUG, 'sample-open-2027-sampletown', 'other-cup']);
  });
  it('refuses a bad slug and the reserved channel slug', () => {
    expect(() => posterSlugs([sample({ slug: 'Bad Slug' })])).toThrow(/cannot have a poster/);
    expect(() => posterSlugs([sample({ slug: 'channel' })])).toThrow(/reserved/);
  });
  it('tournament poster: text and a QR for the tagged page', () => {
    const p = buildPoster({ slug: 'sample-open-2027-sampletown', tournaments: [sample()], siteUrl: ORIGIN, strict: true })!;
    expect(p.headline).toBe('Find your match videos');
    expect(p.title).toBe('Sample Open 2027');
    expect(p.placeLine).toBe('Sample Indoor Stadium, Sampletown');
    expect(p.qr.status).toBe('ok');
    if (p.qr.status === 'ok') {
      expect(p.qr.target).toContain('utm_campaign=sample-open-2027-sampletown');
      expect(p.qr.displayUrl).toBe('example.test/tournaments/sample-open-2027-sampletown/');
      expect(p.qr.preview).toBe(false);
    }
  });
  it('channel poster needs no tournament', () => {
    const p = buildPoster({ slug: 'channel', tournaments: [], siteUrl: ORIGIN, strict: true })!;
    expect(p.kind).toBe('channel');
    expect(p.qr.status).toBe('ok');
  });
  it('no poster for an unknown or cancelled slug', () => {
    expect(buildPoster({ slug: 'nope', tournaments: [], siteUrl: ORIGIN, strict: false })).toBeNull();
    expect(buildPoster({ slug: 'gone', tournaments: [sample({ slug: 'gone', status: 'cancelled' })], siteUrl: ORIGIN, strict: false })).toBeNull();
  });
  it('PUBLIC_SITE_URL missing: no QR, a Todo text', () => {
    for (const siteUrl of [null, '', 'garbage', 'http://example.test']) {
      for (const strict of [false, true]) {
        const p = buildPoster({ slug: 'channel', tournaments: [], siteUrl, strict })!;
        expect(p.qr.status).toBe('missing');
        if (p.qr.status === 'missing') expect(p.qr.todo).toMatch(/PUBLIC_SITE_URL/);
      }
    }
  });
  it('localhost: flagged preview in the developer build, missing in the strict build', () => {
    const dev = buildPoster({ slug: 'channel', tournaments: [], siteUrl: 'http://localhost:4321', strict: false })!;
    expect(dev.qr.status).toBe('ok');
    if (dev.qr.status === 'ok') expect(dev.qr.preview).toBe(true);
    for (const siteUrl of ['http://localhost:4321', 'https://localhost', 'https://127.0.0.1']) {
      expect(buildPoster({ slug: 'channel', tournaments: [], siteUrl, strict: true })!.qr.status, siteUrl).toBe('missing');
    }
  });
});

describe('addresses', () => {
  it('M3 pages are in slash form and not in ROUTES (the footer must link everything in ROUTES)', () => {
    const known = new Set<string>(Object.values(ROUTES));
    for (const value of Object.values(M3_ROUTES)) {
      expect(value).toMatch(/^\/[a-z-]+\/$/);
      expect(known.has(value)).toBe(false);
    }
  });
});
