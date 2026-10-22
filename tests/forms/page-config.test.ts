import { describe, expect, it } from 'vitest';
import { products } from '../../src/content/products';
import { sponsorPackages } from '../../src/content/sponsor-packages';
import { formPageConfig, optionalSiteText, packageOptions, plainForm, telHref, topicOptions } from '../../src/lib/forms/page-config';
import { generalForm, TOPIC_MESSAGE_PREFIX } from '../../src/lib/forms/defs/general';
import { coverageForm } from '../../src/lib/forms/defs/coverage';
import { sponsorshipForm } from '../../src/lib/forms/defs/sponsorship';
import { tournamentSubmissionForm } from '../../src/lib/forms/defs/tournament';
import { ROUTES } from '../../src/lib/urls';
import { validateLeadRequest } from '../../src/lib/contracts/lead';
import { buildPayload } from '../../src/lib/forms/payload';
import { META, fullValues, pinClock } from './helpers';

pinClock();
import { LEAD_KINDS } from '../../src/lib/contracts/lead-constants';
import { nextSteps, replyLine } from '../../src/lib/forms/confirmation-text';
import { presetValue } from '../../src/lib/forms/flow-base';

describe('page config helpers', () => {
  it('reads an optional owner text only when it is a non-blank string', () => {
    expect(optionalSiteText({ replyTimePromise: ' 24 hours ' }, 'replyTimePromise')).toBe('24 hours');
    expect(optionalSiteText({ replyTimePromise: '  ' }, 'replyTimePromise')).toBeNull();
    expect(optionalSiteText({ replyTimePromise: null }, 'replyTimePromise')).toBeNull();
    expect(optionalSiteText({}, 'replyTimePromise')).toBeNull();
    expect(optionalSiteText(null, 'x')).toBeNull();
    expect(optionalSiteText({ x: 5 }, 'x')).toBeNull();
  });

  it('builds select options from products by slug and name', () => {
    expect(packageOptions([{ slug: 'essential', name: 'Essential' }])).toEqual([{ value: 'essential', label: 'Essential' }]);
  });

  it('builds a tel: link from any written phone format, or null', () => {
    expect(telHref('+91 98765 43210')).toBe('tel:+919876543210');
    expect(telHref('098765 43210')).toBe('tel:09876543210');
    expect(telHref(null)).toBeNull();
    expect(telHref('n/a')).toBeNull();
  });

  it('the pages get package choices from the content files, with no price anywhere in them', () => {
    const cfg = formPageConfig();
    expect(cfg.coveragePackages.map((o) => o.value)).toEqual(products.filter((p) => p.group === 'organizers').map((p) => p.slug));
    expect(cfg.coverageAddOns.length).toBeGreaterThan(0);
    expect(cfg.sponsorPackages.map((o) => o.value)).toEqual(sponsorPackages.map((p) => p.slug));
    for (const option of [...cfg.coveragePackages, ...cfg.coverageAddOns, ...cfg.sponsorPackages]) {
      expect(Object.keys(option).sort()).toEqual(['label', 'value']);
      expect(option.label).not.toMatch(/[0-9₹]|Rs/);
    }
  });

  it('?package= preselects a package only when it is one the form offers (Services and Partner buttons)', () => {
    const cfg = formPageConfig();
    const preset = { param: 'package', field: 'packageKey' };
    const first = cfg.coveragePackages[0]!.value;
    expect(presetValue(`?package=${first}`, preset, cfg.coveragePackages)).toBe(first);
    expect(presetValue('?package=made-up', preset, cfg.coveragePackages)).toBeNull();
    expect(presetValue('', preset, cfg.coveragePackages)).toBeNull();
    expect(presetValue(`?package=${first}`, preset, [])).toBeNull();
    expect(presetValue(`?package=${first}`, preset, undefined)).toBeNull();
    // the sponsor buttons on /partner use the sponsor package slugs
    const sponsor = cfg.sponsorPackages[0]!.value;
    // (location.search never includes the #enquiry fragment of the button link)
    expect(presetValue(`?package=${sponsor}`, preset, cfg.sponsorPackages)).toBe(sponsor);
    // and a coverage slug is not accepted on the sponsor form
    expect(presetValue(`?package=${first}`, preset, cfg.sponsorPackages)).toBeNull();
  });

  it('with no reply-time promise from the owner the confirmation promises nothing', () => {
    expect(replyLine(null)).toBe('We will get back to you as soon as we can.');
    expect(replyLine('  ')).not.toMatch(/within/);
    expect(replyLine('24 hours')).toBe('We reply within 24 hours.');
    expect(formPageConfig().replyPromise).toBeNull();
  });

  it('"what happens next" never claims an email was sent, a price, or a deadline', () => {
    for (const kind of LEAD_KINDS) {
      const text = nextSteps(kind).join(' ');
      expect(nextSteps(kind).length).toBeGreaterThanOrEqual(2);
      expect(text).not.toMatch(/e-?mail(ed)? (you|was)|₹|Rs\b|within \d|hours|days/i);
    }
  });
});

describe('R-TOPIC: /contact?topic=<key> pre-fills the message from an allow-list', () => {
  const keys = () => [...products.map((p) => p.slug), ...sponsorPackages.map((p) => p.slug)];
  const nameOf = (key: string) => [...products, ...sponsorPackages].find((p) => p.slug === key)!.name;

  it('the allow-list is every product key and every sponsor package key, with the name from the content file', () => {
    const topics = topicOptions();
    expect(topics.map((t) => t.value)).toEqual(keys());
    for (const t of topics) expect(t.label).toBe(nameOf(t.value));
    expect(topics.length).toBeGreaterThan(products.length);
  });

  it('a product key pre-fills "I would like to know more about: <product name>"', () => {
    const form = generalForm({ topics: topicOptions() });
    expect(form.preset).toMatchObject({ param: 'topic', field: 'message', prefix: TOPIC_MESSAGE_PREFIX });
    expect(TOPIC_MESSAGE_PREFIX).toBe('I would like to know more about: ');
    for (const key of keys()) {
      expect(presetValue(`?topic=${key}`, form.preset, undefined), key).toBe(`I would like to know more about: ${nameOf(key)}`);
    }
    // the message field exists, is the free-text box, and the pre-filled text passes its own rules
    expect(form.steps[0]!.fields.find((f) => f.name === form.preset!.field)?.type).toBe('textarea');
  });

  it('a key that is not on the list pre-fills nothing, and text from the address bar is never copied', () => {
    const form = generalForm({ topics: topicOptions() });
    for (const search of ['?topic=unknown', '?topic=Essential', '?topic=essential%20', '?topic=Call%20me%20on%209876543210', '?topic=%3Cb%3Ex%3C%2Fb%3E', '?topic=https://x.example', '?topic=__proto__']) {
      expect(presetValue(search, form.preset, undefined), search).toBeNull();
    }
  });

  it('every product key pre-fills a message that the contract accepts', () => {
    const form = generalForm({ topics: topicOptions() });
    for (const key of keys()) {
      const message = presetValue(`?topic=${key}`, form.preset, undefined)!;
      const result = validateLeadRequest(buildPayload(form, { ...fullValues.general!, message }, META));
      expect(result.ok, `${key}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('the contact form has no preset without an allow-list, and the package forms preset the package', () => {
    expect(generalForm().preset).toBeUndefined();
    const cfg = formPageConfig();
    expect(coverageForm({ packages: cfg.coveragePackages, addOns: cfg.coverageAddOns }).preset).toEqual({ param: 'package', field: 'packageKey' });
    expect(coverageForm({ packages: [], addOns: [] }).preset).toBeUndefined();
    expect(sponsorshipForm({ packages: cfg.sponsorPackages }).preset).toEqual({ param: 'package', field: 'packageKey' });
    expect(tournamentSubmissionForm({ publicContactText: 'x' }).preset).toBeUndefined();
  });
});

describe('what the page hands to the island', () => {
  it('a form definition survives JSON exactly (plain data: Astro writes island props as JSON)', () => {
    const cfg = formPageConfig();
    for (const form of [
      coverageForm({ packages: cfg.coveragePackages, addOns: cfg.coverageAddOns }),
      sponsorshipForm({ packages: cfg.sponsorPackages }),
      generalForm({ topics: topicOptions() }),
      tournamentSubmissionForm({ publicContactText: cfg.publicContactText }),
    ]) {
      const plain = plainForm(form);
      expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);
      // `undefined` values are gone (they would arrive as null), and nothing else changed
      expect(JSON.stringify(plain)).not.toContain('null');
      expect(plain.kind).toBe(form.kind);
      expect(plain.steps.map((s) => s.fields.map((f) => f.name))).toEqual(form.steps.map((s) => s.fields.map((f) => f.name)));
    }
  });

  it('the privacy link comes from the one URL helper (trailing slash)', () => {
    expect(formPageConfig().privacyHref).toBe(ROUTES.privacy);
    expect(formPageConfig().privacyHref).toBe('/privacy/');
  });
});
