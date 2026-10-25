import { describe, expect, it } from 'vitest';
import { answeredFaq, faqItems } from '../../src/content/faq';
import { partners, showablePartners, type Partner } from '../../src/content/partners';
import { showableTestimonials, testimonials, type Testimonial } from '../../src/content/testimonials';
import {
  assertValidTournaments,
  publicContact,
  splitTournaments,
  tournamentProblems,
  tournaments,
  type TournamentRecord,
} from '../../src/content/tournaments';
import { site } from '../../src/content/site';
import { daysBetween, formatMonthYear, isIsoDate } from '../../src/lib/dates';

const base: TournamentRecord = {
  slug: 'sample-open-2026-sample-city',
  name: 'Sample Open',
  startDate: '2026-12-05',
  endDate: '2026-12-06',
  venue: 'Sample Hall',
  city: 'Sample City',
  district: null,
  level: null,
  categories: [],
  organizerName: 'Sample Association',
  description: null,
  status: 'scheduled',
  coveredByPowerSmash: false,
  showContact: false,
  contact: { name: 'Sample Person', registrationUrl: 'https://example.test/register' },
};

describe('owner-supplied content starts empty (never fabricated)', () => {
  it('has no partners, no testimonials and no tournaments yet', () => {
    expect(partners).toEqual([]);
    expect(testimonials).toEqual([]);
    expect(tournaments).toEqual([]);
    expect(() => assertValidTournaments()).not.toThrow();
  });

  it('carries exactly the contact details the owner supplied in chat on 2026-10-25 (OT-19), nothing more', () => {
    // These three are public by design (spec 13.2 publishes them). A different value here means someone changed them without
    // the owner: update this test only together with a new owner input.
    expect(site.legalName).toBe('Power Smash');
    expect(site.phone).toBe('+91 73733 51087');
    expect(site.publicEmail).toBe('powersmash1102@gmail.com');
  });

  it('keeps every owner-supplied site value the owner has NOT given yet null or empty (never fabricated)', () => {
    expect(site.tagline).toBeNull();
    expect(site.postalAddress).toBeNull(); // "Tamil Nadu" alone is not a postal address: stays hidden until a full one is supplied
    expect(site.grievanceOfficerName).toBeNull();
    expect(site.grievanceEmail).toBeNull();
    expect(site.whatsappChannelUrl).toBeNull();
    expect(site.gstNote).toBeNull();
    expect(site.paymentNote).toBeNull();
    expect(site.about.story).toBeNull();
    expect(site.about.mission).toBeNull();
    expect(site.about.team).toEqual([]);
    expect(site.about.districts).toEqual([]);
  });

  it('shows the channel figures as rounded, owner-stated and dated', () => {
    expect(site.channel).toEqual({ subscribers: '88K', videos: '1.9K', asOf: 'October 2026', asOfDate: '2026-10-20' });
  });

  it('carries the as-of date as an ISO date next to its wording, so the release check can read it (review C-17)', () => {
    expect(isIsoDate(site.channel.asOfDate)).toBe(true);
    // the wording and the ISO date are the same month
    expect(formatMonthYear(site.channel.asOfDate)).toBe(site.channel.asOf);
    // a pure age rule the release check can reuse (D-016 item 5: nothing stored for more than 30 days without a re-statement)
    expect(daysBetween(site.channel.asOfDate, '2026-10-21')).toBe(1);
    expect(daysBetween(site.channel.asOfDate, '2026-11-19')).toBe(30);
  });

  it('keeps the audience figures empty until the owner supplies them (OT-12)', () => {
    expect(site.audience).toEqual({
      asOf: null,
      asOfDate: null,
      monthlyViews: null,
      topLocations: [],
      ageGroups: [],
      genderSplit: [],
      avgViewDuration: null,
    });
  });

  it('carries no email address other than the business address (never the owner\'s personal Gmail)', () => {
    const text = JSON.stringify(site);
    const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])];
    expect(emails).toEqual(['powersmash1102@gmail.com']);
  });
});

describe('FAQ hiding', () => {
  it('has the four spec topics and hides every item while no answer is supplied', () => {
    expect(faqItems.map((i) => i.id)).toEqual(['travel', 'live-stream-needs', 'delivery-times', 'cancellations']);
    expect(answeredFaq()).toEqual([]);
  });

  it('shows only items with a non-blank answer', () => {
    const list = [
      { id: 'a', question: 'A?', answer: 'Yes.' },
      { id: 'b', question: 'B?', answer: null },
      { id: 'c', question: 'C?', answer: '   ' },
    ];
    expect(answeredFaq(list).map((i) => i.id)).toEqual(['a']);
  });
});

describe('partners and testimonials need recorded permission', () => {
  it('hides a partner without permission or without a logo', () => {
    const list: Partner[] = [
      { name: 'A', logoPath: '/p/a.svg', logoAlt: 'A', url: null, permissionRecorded: true },
      { name: 'B', logoPath: '/p/b.svg', logoAlt: 'B', url: null, permissionRecorded: false },
      { name: 'C', logoPath: '', logoAlt: 'C', url: null, permissionRecorded: true },
    ];
    expect(showablePartners(list).map((p) => p.name)).toEqual(['A']);
    expect(showablePartners([])).toEqual([]);
  });

  it('hides a testimonial without permission or text', () => {
    const list: Testimonial[] = [
      { quote: 'Great.', attribution: 'Someone', permissionRecorded: true },
      { quote: 'Fine.', attribution: 'Other', permissionRecorded: false },
      { quote: '', attribution: 'Blank', permissionRecorded: true },
    ];
    expect(showableTestimonials(list).map((t) => t.attribution)).toEqual(['Someone']);
  });
});

describe('tournaments', () => {
  it('splits upcoming (soonest first) and past (latest first) by the IST date', () => {
    const a = { ...base, slug: 'a', name: 'A', startDate: '2026-12-05', endDate: '2026-12-06' };
    const b = { ...base, slug: 'b', name: 'B', startDate: '2026-11-01', endDate: null };
    const c = { ...base, slug: 'c', name: 'C', startDate: '2026-09-01', endDate: '2026-09-02' };
    const d = { ...base, slug: 'd', name: 'D', startDate: '2026-10-01', endDate: null };
    const { upcoming, past } = splitTournaments([a, b, c, d], '2026-10-21');
    expect(upcoming.map((t) => t.slug)).toEqual(['b', 'a']);
    expect(past.map((t) => t.slug)).toEqual(['d', 'c']);
  });

  it('keeps a multi-day tournament upcoming through its last day', () => {
    const t = { ...base, startDate: '2026-12-05', endDate: '2026-12-07' };
    expect(splitTournaments([t], '2026-12-07').upcoming).toHaveLength(1);
    expect(splitTournaments([t], '2026-12-08').past).toHaveLength(1);
  });

  it('shows organizer contact ONLY when showContact is true', () => {
    expect(publicContact({ ...base, showContact: false })).toBeNull();
    expect(publicContact({ ...base, showContact: true })).toEqual({
      name: 'Sample Person',
      registrationUrl: 'https://example.test/register',
    });
    expect(publicContact({ ...base, showContact: true, contact: null })).toBeNull();
    expect(publicContact({ ...base, showContact: true, contact: { name: ' ', registrationUrl: null } })).toBeNull();
  });

  it('has no phone or email field in the record at all (D-029: organizer contacts never sit in static HTML)', () => {
    const keys = Object.keys(base).concat(Object.keys(base.contact ?? {}));
    for (const key of keys) expect(key).not.toMatch(/phone|email|whatsapp|mobile/i);
  });

  it('reports problems in an owner-edited list', () => {
    expect(tournamentProblems([base])).toEqual([]);
    expect(tournamentProblems([{ ...base, slug: 'Bad Slug' }]).join(' ')).toMatch(/slug/);
    expect(tournamentProblems([{ ...base, slug: 'submit' }]).join(' ')).toMatch(/reserved/);
    expect(tournamentProblems([base, base]).join(' ')).toMatch(/duplicate/);
    expect(tournamentProblems([{ ...base, startDate: '2026-02-30' }]).join(' ')).toMatch(/startDate/);
    expect(tournamentProblems([{ ...base, endDate: '2026-12-01' }]).join(' ')).toMatch(/before/);
    expect(
      tournamentProblems([{ ...base, contact: { name: null, registrationUrl: 'http://example.test/x' } }]).join(' '),
    ).toMatch(/https/);
    expect(() => assertValidTournaments([{ ...base, name: '' }])).toThrow(/name is empty/);
  });
});
