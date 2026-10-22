// Hide-section rule on the BUILT pages (D-034; review findings B-8 and C-3; BUILD_PLAN DoD 6): every owner-dependent section
// is hidden while its input is missing, leaves an invisible <template data-owner-hidden="name"> marker, and the placeholder gate
// (scripts/check-placeholders.ts) lists it. Reads .vercel/output/static; skipped when the folder does not exist (see ./helpers.ts for how
// CI runs it after the build). The pure supplied/hidden decision is tested in tests/site/owner-section.test.ts.
import { describe, expect, it } from 'vitest';
import { formatPlaceholderReport, scanPlaceholders } from '../../scripts/check-placeholders.ts';
import { isSupplied } from '../../src/components/site/owner-section';
import { answeredFaq, faqItems } from '../../src/content/faq';
import { partners, showablePartners } from '../../src/content/partners';
import { site } from '../../src/content/site';
import { showableTestimonials, testimonials } from '../../src/content/testimonials';
import { DIST, builtPages, hasDist, requireDist } from './helpers';

it.runIf(requireDist && !hasDist)('.vercel/output/static must exist when PS_REQUIRE_DIST=1 (run the build first)', () => {
  expect(hasDist, `build the site first: ${DIST}`).toBe(true);
});

interface Expectation {
  /** The marker name (unique per call site). */
  name: string;
  /** Is the input supplied in the current site data? Then the marker must be ABSENT. */
  supplied: boolean;
  /** Built pages (relative to .vercel/output/static) that carry this call site. */
  pages: string[];
}

const EVERY_PAGE = ['index.html', 'about/index.html', 'services/index.html', 'pricing/index.html', 'support/index.html', 'tournaments/index.html', '404.html'];
const NOT_HOME = EVERY_PAGE.filter((p) => p !== 'index.html');

// The expectation is computed from the same site data the build used, so the test also holds on the day the owner supplies an input
// (the marker must then be absent and the content present).
const EXPECTED: Expectation[] = [
  { name: 'footer-tagline', supplied: isSupplied(site.tagline), pages: EVERY_PAGE },
  { name: 'footer-whatsapp-channel', supplied: isSupplied(site.whatsappChannelUrl), pages: EVERY_PAGE },
  { name: 'footer-legal-name', supplied: isSupplied(site.legalName), pages: EVERY_PAGE },
  { name: 'footer-address', supplied: isSupplied(site.postalAddress), pages: EVERY_PAGE },
  { name: 'footer-phone', supplied: isSupplied(site.phone), pages: EVERY_PAGE },
  { name: 'footer-email', supplied: isSupplied(site.publicEmail), pages: EVERY_PAGE },
  { name: 'footer-partners-strip', supplied: showablePartners(partners).length > 0, pages: NOT_HOME },
  { name: 'home-partners-strip', supplied: showablePartners(partners).length > 0, pages: ['index.html'] },
  { name: 'home-whatsapp-channel', supplied: isSupplied(site.whatsappChannelUrl), pages: ['index.html'] },
  { name: 'support-whatsapp-channel', supplied: isSupplied(site.whatsappChannelUrl), pages: ['support/index.html'] },
  { name: 'about-story', supplied: isSupplied(site.about.story), pages: ['about/index.html'] },
  { name: 'about-mission', supplied: isSupplied(site.about.mission), pages: ['about/index.html'] },
  { name: 'about-team', supplied: isSupplied(site.about.team), pages: ['about/index.html'] },
  { name: 'about-districts', supplied: isSupplied(site.about.districts), pages: ['about/index.html'] },
  { name: 'services-testimonials', supplied: showableTestimonials(testimonials).length > 0, pages: ['services/index.html'] },
  { name: 'services-faq', supplied: answeredFaq(faqItems).length > 0, pages: ['services/index.html'] },
  { name: 'pricing-payment-note', supplied: isSupplied(site.paymentNote), pages: ['pricing/index.html'] },
];

const markerOf = (name: string): string => `<template data-owner-hidden="${name}"></template>`;

describe.skipIf(!hasDist)('hidden sections in the built pages (.vercel/output/static)', () => {
  const pages = new Map(builtPages().map((p) => [p.rel, p.text]));

  it('has the pages this test looks at', () => {
    for (const rel of EVERY_PAGE) expect(pages.has(rel), rel).toBe(true);
  });

  it('every owner-dependent section leaves its named marker while its input is missing, and no marker once it is supplied', () => {
    const wrong: string[] = [];
    for (const e of EXPECTED) {
      for (const rel of e.pages) {
        const text = pages.get(rel) ?? '';
        const has = text.includes(markerOf(e.name));
        if (has === e.supplied) wrong.push(`${rel}: ${e.name} ${e.supplied ? 'is supplied but a marker is still there' : 'is missing but no marker was left'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the markers are invisible: data-owner-hidden appears only on <template> elements', () => {
    for (const [rel, text] of pages) {
      for (const m of text.matchAll(/data-owner-hidden/g)) {
        const start = text.lastIndexOf('<', m.index as number);
        expect(text.slice(start, start + 9), `${rel}: data-owner-hidden outside a <template>`).toBe('<template');
      }
    }
  });

  it('no hidden section is unnamed: a call site that forgot its name would be listed as "(unnamed)"', () => {
    const report = scanPlaceholders(DIST);
    const unnamed = report.hiddenSections.find((s) => s.name === '(unnamed)');
    expect(unnamed?.pages ?? []).toEqual([]);
    for (const [rel, text] of pages) {
      expect(text, rel).not.toMatch(/data-owner-hidden(?:=""|[\s>])/);
    }
  });

  it('the placeholder gate lists every hidden section, with the pages that carry it', () => {
    const report = scanPlaceholders(DIST);
    const listed = new Map(report.hiddenSections.map((s) => [s.name, s.pages]));
    const lines = formatPlaceholderReport(report, false, '.vercel/output/static').lines.join('\n');
    for (const e of EXPECTED.filter((x) => !x.supplied)) {
      expect(listed.has(e.name), `the gate does not list ${e.name}`).toBe(true);
      for (const rel of e.pages) expect(listed.get(e.name), `${e.name} on ${rel}`).toContain(rel);
      expect(lines, e.name).toContain(e.name);
    }
    for (const e of EXPECTED.filter((x) => x.supplied)) expect(listed.has(e.name), `${e.name} is supplied, so it must not be listed`).toBe(false);
    expect(lines).toMatch(/Owner-dependent sections currently hidden/);
  });

  it('a hidden section shows nothing the visitor can read (no placeholder text, no empty heading)', () => {
    const about = pages.get('about/index.html') ?? '';
    if (!isSupplied(site.about.mission)) expect(about).not.toContain('id="mission-title"');
    if (!isSupplied(site.about.team)) expect(about).not.toContain('id="team-title"');
    if (!isSupplied(site.about.districts)) expect(about).not.toContain('id="districts-title"');
    const services = pages.get('services/index.html') ?? '';
    if (answeredFaq(faqItems).length === 0) expect(services).not.toContain('id="faq-heading"');
    if (showableTestimonials(testimonials).length === 0) expect(services).not.toContain('id="testimonials-title"');
    const pricing = pages.get('pricing/index.html') ?? '';
    if (!isSupplied(site.paymentNote)) expect(pricing).not.toMatch(/send payment details/i);
  });

  it('the hidden-section names in the build are all kebab-case', () => {
    const report = scanPlaceholders(DIST);
    for (const s of report.hiddenSections.filter((x) => x.name !== '(unnamed)')) expect(s.name, s.name).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
  });
});
