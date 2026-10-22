import { describe, expect, it } from 'vitest';
import {
  breadcrumbJsonLd,
  compact,
  organizationJsonLd,
  safeJsonLd,
  sportsEventJsonLd,
} from '../../src/lib/jsonld';

describe('safeJsonLd', () => {
  it('can never close the script tag: a </script> payload is escaped and still round-trips', () => {
    const payload = { name: '</script><script>alert(1)</script>', other: '<!-- x -->' };
    const out = safeJsonLd(payload);
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(JSON.parse(out)).toEqual(payload);
  });

  it('escapes ampersands', () => {
    const out = safeJsonLd({ name: 'Tom & Jerry &amp; co' });
    expect(out).not.toContain('&');
    expect(out).toContain('\\u0026');
    expect(JSON.parse(out)).toEqual({ name: 'Tom & Jerry &amp; co' });
  });

  it('escapes U+2028 and U+2029 (they break JavaScript string literals)', () => {
    const payload = { a: 'line break', b: 'para break' };
    const out = safeJsonLd(payload);
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out)).toEqual(payload);
  });

  it('leaves ordinary JSON untouched', () => {
    expect(safeJsonLd({ '@context': 'https://schema.org', n: 1, ok: true, list: ['a'] })).toBe(
      '{"@context":"https://schema.org","n":1,"ok":true,"list":["a"]}',
    );
  });
});

describe('compact', () => {
  it('drops undefined, null, empty strings and empty arrays recursively', () => {
    expect(compact({ a: 1, b: undefined, c: null, d: '', e: [], f: { g: undefined, h: 'x' }, i: [null, 'y', ''] })).toEqual({
      a: 1,
      f: { h: 'x' },
      i: ['y'],
    });
  });
});

describe('organizationJsonLd', () => {
  it('lists sameAs profiles and skips the ones that are missing (null WhatsApp Channel)', () => {
    const ld = organizationJsonLd({
      name: 'Power Smash',
      url: 'https://example.test/',
      sameAs: ['https://www.youtube.com/@PowerSmash', 'https://www.instagram.com/x/', null, undefined, ''],
    });
    expect(ld['@type']).toBe('Organization');
    expect(ld.sameAs).toEqual(['https://www.youtube.com/@PowerSmash', 'https://www.instagram.com/x/']);
    expect(ld).not.toHaveProperty('legalName');
    expect(ld).not.toHaveProperty('logo');
  });

  it('adds the legal name only when it is supplied', () => {
    const ld = organizationJsonLd({ name: 'Power Smash', url: 'https://example.test/', legalName: 'Example Legal Name', sameAs: [] });
    expect(ld.legalName).toBe('Example Legal Name');
    expect(ld).not.toHaveProperty('sameAs'); // empty array is dropped
  });
});

describe('breadcrumbJsonLd', () => {
  it('numbers the items from 1', () => {
    const ld = breadcrumbJsonLd([
      { name: 'Home', url: 'https://example.test/' },
      { name: 'Services', url: 'https://example.test/services' },
    ]);
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.test/' },
      { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://example.test/services' },
    ]);
  });
});

describe('sportsEventJsonLd', () => {
  it('emits only supplied fields and never any organizer contact', () => {
    const ld = sportsEventJsonLd({
      name: 'Sample Open',
      startDate: '2026-12-05',
      endDate: '2026-12-06',
      url: 'https://example.test/tournaments/sample-open-2026-city',
      venue: 'Sample Hall',
      city: 'Sample City',
      organizerName: 'Sample Association',
      status: 'scheduled',
    });
    expect(ld).toMatchObject({
      '@type': 'SportsEvent',
      name: 'Sample Open',
      startDate: '2026-12-05',
      endDate: '2026-12-06',
      eventStatus: 'https://schema.org/EventScheduled',
      location: { '@type': 'Place', name: 'Sample Hall', address: { addressLocality: 'Sample City' } },
      organizer: { '@type': 'Organization', name: 'Sample Association' },
    });
    const text = JSON.stringify(ld);
    expect(text).not.toMatch(/telephone|email|phone/i);
  });

  it('omits location and organizer when they are not supplied and maps cancelled/postponed', () => {
    const ld = sportsEventJsonLd({ name: 'N', startDate: '2026-12-05', url: 'https://example.test/t', status: 'cancelled' });
    expect(ld).not.toHaveProperty('location');
    expect(ld).not.toHaveProperty('organizer');
    expect(ld).not.toHaveProperty('endDate');
    expect(ld.eventStatus).toBe('https://schema.org/EventCancelled');
    expect(sportsEventJsonLd({ name: 'N', startDate: '2026-12-05', url: 'u', status: 'postponed' }).eventStatus).toBe(
      'https://schema.org/EventPostponed',
    );
  });
});
