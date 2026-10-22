import { describe, expect, it } from 'vitest';
import {
  M1_ROUTES,
  bookCoverageLink,
  footerGroups,
  headerNav,
  isCurrent,
  legalLinks,
  pathOf,
} from '../../src/components/site/nav';
import {
  DEFAULT_WHATSAPP_TEXT,
  whatsappTextForPackage,
  whatsappTextForPath,
} from '../../src/components/site/whatsappText';
import { waLink } from '../../src/lib/whatsapp';

// A clearly fictional number (D-004: the owner's real number is never used in tests or dev data; review C-16).
const FICTIONAL_NUMBER = '910000000000';

const allLinks = [
  ...headerNav,
  bookCoverageLink,
  ...footerGroups.flatMap((g) => g.links),
  ...legalLinks,
];

describe('navigation', () => {
  it('links only to pages that exist in M1 (no Matches, Players, search, live, alerts or submit-video yet), in the slash form', () => {
    const known = new Set<string>(M1_ROUTES);
    for (const link of allLinks) {
      expect(known.has(pathOf(link.href)), `${link.label} -> ${link.href}`).toBe(true);
    }
    for (const link of allLinks) {
      expect(link.href).not.toMatch(/^\/(matches|players|search|live|alerts|submit-video|gear|admin|order)/);
    }
  });

  it('gives the header the three audience entry points (D-024, D-025)', () => {
    const labels = headerNav.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Organizers', 'Sponsors', 'Players & parents']));
    expect(headerNav.find((l) => l.label === 'Sponsors')?.href).toBe('/partner/');
  });

  it('the footer reaches every M1 page, including the six legal pages', () => {
    const hrefs = new Set(allLinks.map((l) => pathOf(l.href)));
    for (const route of M1_ROUTES) {
      if (route === '/') continue; // Home is the logo link in the header and the footer
      expect(hrefs.has(route), route).toBe(true);
    }
    expect(legalLinks.map((l) => l.href)).toEqual(['/privacy/', '/terms/', '/refunds/', '/delivery/', '/disclosures/', '/content-removal/']);
  });

  it('has no duplicate links inside one footer group', () => {
    for (const group of footerGroups) {
      const hrefs = group.links.map((l) => l.href);
      expect(new Set(hrefs).size, group.title).toBe(hrefs.length);
    }
  });

  it('marks the current page, its sections, and never an anchor link', () => {
    // the nav hrefs carry the slash; the current pathname may or may not (dev server and build differ)
    expect(isCurrent('/services/', '/services')).toBe(true);
    expect(isCurrent('/services/', '/services/')).toBe(true);
    expect(isCurrent('/services', '/services/')).toBe(true);
    expect(isCurrent('/tournaments/', '/tournaments/some-event-2026-city/')).toBe(true);
    expect(isCurrent('/tournaments/', '/tournaments/some-event-2026-city')).toBe(true);
    expect(isCurrent('/tournaments/', '/tournaments-and-more/')).toBe(false);
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/', '/services/')).toBe(false);
    expect(isCurrent('/services/#players', '/services/')).toBe(false);
    expect(pathOf('/services/#players')).toBe('/services/');
    expect(pathOf('/book/?package=pro')).toBe('/book/');
  });
});

describe('WhatsApp prefilled text (D-025, D-029)', () => {
  it('has a message for every page type and a generic fallback', () => {
    expect(whatsappTextForPath('/')).toBe(DEFAULT_WHATSAPP_TEXT);
    expect(whatsappTextForPath('/services')).toMatch(/coverage/);
    expect(whatsappTextForPath('/partner')).toMatch(/partner/);
    expect(whatsappTextForPath('/tournaments/some-event-2026-city')).toMatch(/tournament/);
    expect(whatsappTextForPath('/privacy')).toBe(DEFAULT_WHATSAPP_TEXT);
    expect(whatsappTextForPath('/services/')).toBe(whatsappTextForPath('/services'));
  });

  it('carries only a topic: no digits, no email, no personal data', () => {
    for (const route of [...M1_ROUTES, '/404', '/tournaments/x']) {
      const text = whatsappTextForPath(route);
      expect(text, route).not.toMatch(/\d|@/);
      expect(text.trim().length).toBeGreaterThan(0);
    }
    expect(whatsappTextForPackage('Essential')).toBe('Hi Power Smash, I would like to ask about Essential.');
  });

  it('works through waLink and cannot build a link without a number', () => {
    expect(waLink(FICTIONAL_NUMBER, whatsappTextForPath('/book'))).toMatch(/^https:\/\/wa\.me\/910000000000\?text=/);
    expect(waLink(null, whatsappTextForPath('/book'))).toBeNull();
  });
});
