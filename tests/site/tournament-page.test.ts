// The data path of /tournaments/[slug] (review C-22). The page builds ZERO pages while the owner's list is empty, so the first
// real tournament would be the first time the template ran. tournamentPageModel() holds everything the template shows
// (dates, place, description, contact block, SportsEvent JSON-LD, canonical url); these tests run it with FICTIONAL records that
// exist only in this file. src/content/tournaments.ts itself stays empty.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  publicContact,
  splitTournaments,
  tournamentPageModel,
  tournamentPlace,
  tournamentProblems,
  tournamentStatusLabel,
  tournaments,
  type TournamentRecord,
} from '../../src/content/tournaments';
import { safeJsonLd } from '../../src/lib/jsonld';
import { isUpcoming, todayIst } from '../../src/lib/dates';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const ORIGIN = 'https://example.test';

const sample: TournamentRecord = {
  slug: 'sample-open-2030-sample-city',
  name: 'Sample Open',
  startDate: '2030-03-09',
  endDate: '2030-03-10',
  venue: 'Sample Hall',
  city: 'Sample City',
  district: 'Sample District',
  level: 'Sample level',
  categories: ['Sample category'],
  organizerName: 'Sample Association',
  description: 'A fictional tournament used only in tests.',
  status: 'scheduled',
  coveredByPowerSmash: false,
  showContact: false,
  contact: { name: 'Sample Person', registrationUrl: 'https://example.test/register' },
};

describe('the content file stays empty', () => {
  it('lists no tournament until the owner supplies one', () => {
    expect(tournaments).toEqual([]);
  });
});

describe('tournamentPageModel: upcoming and past at the IST date boundary (D-030)', () => {
  const lastDay = '2030-03-10';

  it('is upcoming on its last day and past the next day, by the IST calendar date', () => {
    expect(tournamentPageModel(sample, { today: lastDay, origin: ORIGIN }).upcoming).toBe(true);
    expect(tournamentPageModel(sample, { today: '2030-03-11', origin: ORIGIN }).upcoming).toBe(false);
    expect(tournamentPageModel(sample, { today: '2030-03-01', origin: ORIGIN }).upcoming).toBe(true);
  });

  it('a single-day tournament with no end date is upcoming through its start date', () => {
    const oneDay = { ...sample, endDate: null };
    expect(tournamentPageModel(oneDay, { today: '2030-03-09', origin: ORIGIN }).upcoming).toBe(true);
    expect(tournamentPageModel(oneDay, { today: '2030-03-10', origin: ORIGIN }).upcoming).toBe(false);
  });

  it('flips at midnight IST, not at midnight UTC: 18:29:59 UTC is still the last day, 18:30:00 UTC is the next day in India', () => {
    const justBefore = todayIst(new Date('2030-03-10T18:29:59Z'));
    const justAfter = todayIst(new Date('2030-03-10T18:30:00Z'));
    expect(justBefore).toBe('2030-03-10');
    expect(justAfter).toBe('2030-03-11');
    expect(tournamentPageModel(sample, { today: justBefore, origin: ORIGIN }).upcoming).toBe(true);
    expect(tournamentPageModel(sample, { today: justAfter, origin: ORIGIN }).upcoming).toBe(false);
    // the model and the list page use the same rule
    expect(isUpcoming(sample.startDate, sample.endDate, justAfter)).toBe(false);
  });

  it('the list split uses the same boundary', () => {
    const today = todayIst(new Date('2030-03-10T18:30:00Z'));
    const { upcoming, past } = splitTournaments([sample], today);
    expect(upcoming).toEqual([]);
    expect(past).toHaveLength(1);
  });
});

describe('tournamentPageModel: SportsEvent JSON-LD', () => {
  it('builds a SportsEvent only for an upcoming tournament', () => {
    const upcoming = tournamentPageModel(sample, { today: '2030-03-01', origin: ORIGIN });
    expect(upcoming.jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: 'Sample Open',
      sport: 'Badminton',
      startDate: '2030-03-09',
      endDate: '2030-03-10',
      eventStatus: 'https://schema.org/EventScheduled',
      location: { '@type': 'Place', name: 'Sample Hall', address: { addressLocality: 'Sample City', addressCountry: 'IN' } },
      organizer: { '@type': 'Organization', name: 'Sample Association' },
    });
    expect(tournamentPageModel(sample, { today: '2030-03-11', origin: ORIGIN }).jsonLd).toBeUndefined();
  });

  it('puts the canonical slash URL in the JSON-LD (same form as the canonical link, R-LINKS)', () => {
    const model = tournamentPageModel(sample, { today: '2030-03-01', origin: ORIGIN });
    expect(model.url).toBe('https://example.test/tournaments/sample-open-2030-sample-city/');
    expect(model.jsonLd?.url).toBe(model.url);
  });

  it('works with the Astro site origin as a URL object', () => {
    const model = tournamentPageModel(sample, { today: '2030-03-01', origin: new URL('https://example.test/some/page') });
    expect(model.url).toBe('https://example.test/tournaments/sample-open-2030-sample-city/');
  });

  it('maps cancelled and postponed and shows the badge text', () => {
    const cancelled = tournamentPageModel({ ...sample, status: 'cancelled' }, { today: '2030-03-01', origin: ORIGIN });
    expect(cancelled.jsonLd?.eventStatus).toBe('https://schema.org/EventCancelled');
    expect(cancelled.statusLabel).toBe('Cancelled');
    const postponed = tournamentPageModel({ ...sample, status: 'postponed' }, { today: '2030-03-01', origin: ORIGIN });
    expect(postponed.jsonLd?.eventStatus).toBe('https://schema.org/EventPostponed');
    expect(postponed.statusLabel).toBe('Postponed');
    expect(tournamentStatusLabel(sample)).toBeNull();
  });

  it('never carries an organizer phone, email or contact person, and serialises safely', () => {
    const model = tournamentPageModel({ ...sample, showContact: true }, { today: '2030-03-01', origin: ORIGIN });
    const text = JSON.stringify(model.jsonLd);
    expect(text).not.toMatch(/telephone|email|phone|contactPoint|Sample Person|register/i);
    const hostile = tournamentPageModel({ ...sample, name: '</script><script>x()</script>' }, { today: '2030-03-01', origin: ORIGIN });
    expect(safeJsonLd(hostile.jsonLd)).not.toContain('<');
  });

  it('omits location and organizer when the record has none', () => {
    const bare = { ...sample, venue: null, city: null, district: null, organizerName: null, description: null, endDate: null };
    const model = tournamentPageModel(bare, { today: '2030-03-01', origin: ORIGIN });
    expect(model.jsonLd).not.toHaveProperty('location');
    expect(model.jsonLd).not.toHaveProperty('organizer');
    expect(model.jsonLd).not.toHaveProperty('endDate');
    expect(model.place).toBe('');
  });
});

describe('tournamentPageModel: the organizer contact block is shown only when showContact is true', () => {
  it('hides it when the organizer has not agreed', () => {
    expect(tournamentPageModel({ ...sample, showContact: false }, { today: '2030-03-01', origin: ORIGIN }).contact).toBeNull();
  });

  it('shows the contact person and the https registration link when the organizer agreed', () => {
    const model = tournamentPageModel({ ...sample, showContact: true }, { today: '2030-03-01', origin: ORIGIN });
    expect(model.contact).toEqual({ name: 'Sample Person', registrationUrl: 'https://example.test/register' });
    expect(model.contact).toEqual(publicContact({ ...sample, showContact: true }));
  });

  it('shows nothing when showContact is true but there is nothing to show', () => {
    expect(tournamentPageModel({ ...sample, showContact: true, contact: null }, { today: '2030-03-01', origin: ORIGIN }).contact).toBeNull();
    expect(
      tournamentPageModel({ ...sample, showContact: true, contact: { name: ' ', registrationUrl: '' } }, { today: '2030-03-01', origin: ORIGIN }).contact,
    ).toBeNull();
  });

  it('only the exact value true counts (a truthy string or number does not)', () => {
    for (const value of ['true', 1, 'yes']) {
      const record = { ...sample, showContact: value as unknown as boolean };
      expect(tournamentPageModel(record, { today: '2030-03-01', origin: ORIGIN }).contact).toBeNull();
    }
  });

  it('an organizer contact never reaches the description or the place line', () => {
    const model = tournamentPageModel({ ...sample, showContact: true }, { today: '2030-03-01', origin: ORIGIN });
    expect(model.description).not.toMatch(/Sample Person|register/);
  });
});

describe('tournamentPageModel: text', () => {
  it('writes the date range, the place and a description for the meta tag', () => {
    const model = tournamentPageModel(sample, { today: '2030-03-01', origin: ORIGIN });
    expect(model.when).toBe('9–10 March 2030');
    expect(model.place).toBe('Sample Hall, Sample City, Sample District');
    expect(model.description).toBe('Sample Open: 9–10 March 2030, Sample Hall, Sample City, Sample District. Badminton tournament listed by Power Smash.');
    expect(tournamentPlace({ venue: null, city: 'Sample City', district: ' ' })).toBe('Sample City');
  });

  it('a fictional record passes the owner-list validation', () => {
    expect(tournamentProblems([sample])).toEqual([]);
  });
});

describe('the page and the cards use the model (so the tests above cover what is rendered)', () => {
  // The header comment talks about phone numbers; only the code counts.
  const page = readFileSync(join(ROOT, 'src/pages/tournaments/[slug].astro'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  const card = readFileSync(join(ROOT, 'src/components/site/TournamentCard.astro'), 'utf8');

  it('[slug].astro takes every value from tournamentPageModel and writes no contact detail itself', () => {
    expect(page).toContain('tournamentPageModel(t, {');
    expect(page).toContain('todayIst()');
    expect(page).not.toMatch(/sportsEventJsonLd|new URL\(|publicContact\(/);
    expect(page).not.toMatch(/phone|email|mailto|tel:/i);
    expect(page).toContain('contact && (');
  });

  it('TournamentCard links to the slash form through path()', () => {
    expect(card).toMatch(/path\(`\/tournaments\/\$\{t\.slug\}`\)/);
  });
});
