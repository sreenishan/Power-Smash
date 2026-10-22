import { describe, expect, it } from 'vitest';
import { buildLegalDocs, legalDocs } from '../../src/content/legal';
import { ALLOWED_INTERNAL_PATHS, ALLOWED_LINK_HOSTS, LINKS } from '../../src/content/legal/meta';
import { docLinks, docWording, type LegalDoc } from '../../src/content/legal/model';
import type { LegalPageKey } from '../../src/content/legal/status';
import { ALL_OFF, ALL_ON, DOC_ENTRIES, entriesFor } from './helpers';

// Links are checked for the pages as rendered now, with every later feature off, and with every later feature on.
const VARIANTS: [string, [LegalPageKey, LegalDoc][]][] = [
  ['now', DOC_ENTRIES],
  ['later features off', entriesFor(ALL_OFF)],
  ['later features on', entriesFor(ALL_ON)],
];

describe.each(VARIANTS)('links on legal pages (%s) point only to the allowed host list', (_name, entries) => {
  it.each(entries)('%s: every link is internal and known, or https to an allowed host', (key, doc) => {
    for (const { href, text } of docLinks(doc)) {
      expect(text.trim(), `link ${href} has no text`).not.toBe('');
      expect(text, `link text "${text}" is not descriptive`).not.toMatch(/^(click here|here|link|read more)$/i);
      if (href.startsWith('/')) {
        const path = href.split('#')[0]!;
        expect(ALLOWED_INTERNAL_PATHS, `${key} links to unknown internal path ${href}`).toContain(path);
        expect(href.startsWith('//')).toBe(false);
      } else {
        const url = new URL(href); // throws on a malformed URL
        expect(url.protocol, `${href} must be https`).toBe('https:');
        expect(ALLOWED_LINK_HOSTS, `${key} links to ${url.host}, which is not on the allowed list`).toContain(url.host);
        expect(url.username + url.password).toBe('');
      }
    }
  });

  it('no page contains a WhatsApp, mailto, tel or script link: those come only from waLink() and site.ts at render time', () => {
    for (const [, doc] of entries) {
      for (const { href } of docLinks(doc)) {
        expect(href).not.toMatch(/^(mailto:|tel:|javascript:|data:)/i);
        expect(href).not.toMatch(/wa\.me|whatsapp\.com/i);
      }
    }
  });

  it('no bare URL, email address or long number is written into the wording (contact details come from site.ts)', () => {
    for (const [key, doc] of entries) {
      for (const text of docWording(doc)) {
        expect(text, `${key}: URL in wording`).not.toMatch(/https?:\/\//i);
        expect(text, `${key}: email in wording`).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        expect(text, `${key}: phone-like number in wording`).not.toMatch(/\b\d[\d ()-]{8,}\d\b/);
      }
    }
  });
});

describe('the allowed host list', () => {
  it('lists only official sources, each used by at least one page once every later feature is on', () => {
    const used = new Set(entriesFor(ALL_ON).flatMap(([, d]) => docLinks(d)).filter((l) => !l.href.startsWith('/')).map((l) => new URL(l.href).host));
    for (const host of ALLOWED_LINK_HOSTS) expect(used.has(host), `${host} is allowed but never linked`).toBe(true);
  });

  it('at G1 the pages link no YouTube or Google policy (nothing from YouTube is used yet, finding C-11)', () => {
    const hosts = new Set(entriesFor(ALL_OFF).flatMap(([, d]) => docLinks(d)).filter((l) => !l.href.startsWith('/')).map((l) => new URL(l.href).host));
    expect(hosts.has('www.youtube.com')).toBe(false);
    expect(hosts.has('policies.google.com')).toBe(false);
    // what a G1 page does link: Cloudflare (Turnstile), the National Consumer Helpline and the ASCI guidelines
    expect([...hosts].sort()).toEqual(['consumerhelpline.gov.in', 'www.ascionline.in', 'www.cloudflare.com']);
  });
});

describe('required links once the YouTube features are on (YouTube API Developer Policies III.A.1 and III.A.2)', () => {
  const wide = buildLegalDocs(ALL_ON);
  const hrefs = (key: keyof typeof legalDocs) => docLinks(wide[key]).map((l) => l.href);

  it('Privacy Policy links the YouTube Terms of Service and the Google Privacy Policy', () => {
    expect(hrefs('privacy')).toContain(LINKS.youtubeTerms);
    expect(hrefs('privacy')).toContain(LINKS.googlePrivacy);
    expect(LINKS.youtubeTerms).toBe('https://www.youtube.com/t/terms');
    expect(LINKS.googlePrivacy).toBe('https://policies.google.com/privacy');
  });

  it('Terms of Use links the YouTube Terms of Service', () => {
    expect(hrefs('terms')).toContain(LINKS.youtubeTerms);
  });
});

describe('links that hold at G1', () => {
  const hrefs = (key: keyof typeof legalDocs) => docLinks(legalDocs[key]).map((l) => l.href);

  it('Terms of Use links the National Consumer Helpline', () => {
    expect(hrefs('terms')).toContain(LINKS.consumerHelpline);
  });

  it('every legal page links to the others it relies on (Terms points at the five other policies)', () => {
    const terms = hrefs('terms');
    for (const p of ['/privacy', '/refunds', '/delivery', '/disclosures', '/content-removal']) expect(terms).toContain(p);
  });
});
