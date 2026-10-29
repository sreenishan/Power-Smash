// Spec 7.6 and 7.7 extras for the owner-entered tournaments: Happening now, the owner's free Featured pin, the four filters, the map
// link, the WhatsApp share text and the add-to-calendar (.ics) file. FICTIONAL records that exist only in this file; the content file
// itself stays empty (tests/site/tournament-page.test.ts checks that). Dates are injected, never read from the clock.
import { describe, expect, it } from 'vitest';
import {
  hasCalendarFile,
  isFeatured,
  matchesTournamentFilters,
  tournamentFilterKeys,
  tournamentFilterOptions,
  tournamentIcs,
  tournamentMapUrl,
  tournamentPhase,
  tournamentProblems,
  tournamentShareText,
  upcomingSections,
  type TournamentRecord,
} from '../../src/content/tournaments';
import { addDays, isOngoing } from '../../src/lib/dates';

const TODAY = '2030-03-10';

function record(over: Partial<TournamentRecord> & Pick<TournamentRecord, 'slug' | 'startDate'>): TournamentRecord {
  return {
    name: `Sample ${over.slug}`,
    endDate: null,
    venue: 'Sample Hall',
    city: 'Sample City',
    district: 'Sample District',
    level: 'District',
    categories: ['MS'],
    organizerName: 'Sample Association',
    description: null,
    status: 'scheduled',
    coveredByPowerSmash: false,
    showContact: false,
    contact: { name: 'Sample Person', registrationUrl: 'https://example.test/register' },
    ...over,
  };
}

describe('dates: isOngoing and addDays', () => {
  it('a tournament is ongoing from its first to its last day, inclusive', () => {
    expect(isOngoing('2030-03-09', '2030-03-11', '2030-03-09')).toBe(true);
    expect(isOngoing('2030-03-09', '2030-03-11', '2030-03-11')).toBe(true);
    expect(isOngoing('2030-03-09', '2030-03-11', '2030-03-12')).toBe(false);
    expect(isOngoing('2030-03-09', '2030-03-11', '2030-03-08')).toBe(false);
    expect(isOngoing('2030-03-10', null, '2030-03-10')).toBe(true);
  });

  it('adds calendar days across month and year ends, and refuses bad input', () => {
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01');
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01');
    expect(addDays('2032-02-28', 1)).toBe('2032-02-29');
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28');
    expect(() => addDays('2030-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('2030-03-01', 0.5)).toThrow(RangeError);
  });
});

describe('phase and featured', () => {
  it('says ongoing, upcoming or past', () => {
    expect(tournamentPhase(record({ slug: 'a', startDate: '2030-03-09', endDate: '2030-03-10' }), TODAY)).toBe('ongoing');
    expect(tournamentPhase(record({ slug: 'b', startDate: '2030-03-11' }), TODAY)).toBe('upcoming');
    expect(tournamentPhase(record({ slug: 'c', startDate: '2030-03-01', endDate: '2030-03-09' }), TODAY)).toBe('past');
  });

  it('pins only what the owner featured, until featuredUntil and never after the tournament is over', () => {
    expect(isFeatured(record({ slug: 'a', startDate: '2030-04-01' }), TODAY)).toBe(false);
    expect(isFeatured(record({ slug: 'b', startDate: '2030-04-01', featured: true }), TODAY)).toBe(true);
    expect(isFeatured(record({ slug: 'c', startDate: '2030-04-01', featured: true, featuredUntil: '2030-03-10' }), TODAY)).toBe(true);
    expect(isFeatured(record({ slug: 'd', startDate: '2030-04-01', featured: true, featuredUntil: '2030-03-09' }), TODAY)).toBe(false);
    expect(isFeatured(record({ slug: 'e', startDate: '2030-03-01', featured: true }), TODAY)).toBe(false);
  });

  it('checks featuredUntil like the other dates', () => {
    expect(tournamentProblems([record({ slug: 'a', startDate: '2030-04-01', featured: true, featuredUntil: '2030-02-30' })])).toEqual([
      'Tournament "a": featuredUntil must be a real date written YYYY-MM-DD.',
    ]);
    expect(tournamentProblems([record({ slug: 'b', startDate: '2030-04-01', featuredUntil: '2030-03-20' })])).toEqual([
      'Tournament "b": featuredUntil is set but featured is not true.',
    ]);
    expect(tournamentProblems([record({ slug: 'c', startDate: '2030-04-01', featured: true, featuredUntil: null })])).toEqual([]);
  });
});

describe('upcomingSections', () => {
  const list = [
    record({ slug: 'now', startDate: '2030-03-09', endDate: '2030-03-11' }),
    record({ slug: 'now-featured', startDate: '2030-03-10', featured: true }),
    record({ slug: 'april-featured', startDate: '2030-04-20', featured: true }),
    record({ slug: 'march-later', startDate: '2030-03-20' }),
    record({ slug: 'april', startDate: '2030-04-02' }),
    record({ slug: 'past', startDate: '2030-02-01' }),
  ];

  it('puts running tournaments first, then featured, then the rest by month, each tournament exactly once', () => {
    const s = upcomingSections(list, TODAY);
    expect(s.now.map((t) => t.slug)).toEqual(['now', 'now-featured']);
    expect(s.featured.map((t) => t.slug)).toEqual(['april-featured']);
    expect(s.months).toEqual([
      { label: 'March 2030', items: [expect.objectContaining({ slug: 'march-later' })] },
      { label: 'April 2030', items: [expect.objectContaining({ slug: 'april' })] },
    ]);
    const all = [...s.now, ...s.featured, ...s.months.flatMap((m) => m.items)].map((t) => t.slug);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('past');
  });

  it('is empty for an empty list', () => {
    expect(upcomingSections([], TODAY)).toEqual({ now: [], featured: [], months: [] });
  });
});

describe('filters', () => {
  const a = record({ slug: 'a', startDate: '2030-03-20', district: ' Salem ', level: 'State', categories: ['MS', ' WD ', 'MS', ''] });
  const b = record({ slug: 'b', startDate: '2030-04-02', district: 'Erode', level: null, categories: [] });

  it('takes trimmed, de-duplicated keys from the public fields', () => {
    expect(tournamentFilterKeys(a)).toEqual({ district: 'Salem', level: 'State', month: '2030-03', categories: ['MS', 'WD'] });
    expect(tournamentFilterKeys(b)).toEqual({ district: 'Erode', level: '', month: '2030-04', categories: [] });
  });

  it('offers only values the listed tournaments have, sorted, months labelled', () => {
    expect(tournamentFilterOptions([b, a])).toEqual({
      district: ['Erode', 'Salem'],
      level: ['State'],
      month: [
        { value: '2030-03', label: 'March 2030' },
        { value: '2030-04', label: 'April 2030' },
      ],
      category: ['MS', 'WD'],
    });
  });

  it('matches every chosen filter; empty filters match everything', () => {
    const keys = tournamentFilterKeys(a);
    expect(matchesTournamentFilters(keys, {})).toBe(true);
    expect(matchesTournamentFilters(keys, { district: '', category: '' })).toBe(true);
    expect(matchesTournamentFilters(keys, { district: 'Salem', level: 'State', month: '2030-03', category: 'WD' })).toBe(true);
    expect(matchesTournamentFilters(keys, { district: 'Erode' })).toBe(false);
    expect(matchesTournamentFilters(keys, { category: 'XD' })).toBe(false);
    expect(matchesTournamentFilters(keys, { month: '2030-04' })).toBe(false);
  });
});

describe('page extras', () => {
  it('builds a map search from the venue text, or nothing without a place', () => {
    expect(tournamentMapUrl(record({ slug: 'a', startDate: '2030-04-01', venue: 'Sample Hall & Court', city: 'Sample City', district: null }))).toBe(
      'https://www.google.com/maps/search/?api=1&query=Sample%20Hall%20%26%20Court%2C%20Sample%20City%2C%20Tamil%20Nadu',
    );
    expect(tournamentMapUrl(record({ slug: 'b', startDate: '2030-04-01', venue: null, city: null, district: null }))).toBeNull();
  });

  it('shares public fields only: never the contact person or the registration link', () => {
    const t = record({ slug: 'sample-open', startDate: '2030-04-01', endDate: '2030-04-02', showContact: true });
    const text = tournamentShareText(t, 'https://example.test/tournaments/sample-open/');
    expect(text).toBe('Sample sample-open: 1–2 April 2030, Sample Hall, Sample City, Sample District. https://example.test/tournaments/sample-open/');
    expect(text).not.toContain('Sample Person');
    expect(text).not.toContain('register');
  });

  it('has a calendar file only while the tournament is to come and not cancelled', () => {
    expect(hasCalendarFile(record({ slug: 'a', startDate: '2030-04-01' }), TODAY)).toBe(true);
    expect(hasCalendarFile(record({ slug: 'b', startDate: '2030-03-10' }), TODAY)).toBe(true);
    expect(hasCalendarFile(record({ slug: 'c', startDate: '2030-03-01' }), TODAY)).toBe(false);
    expect(hasCalendarFile(record({ slug: 'd', startDate: '2030-04-01', status: 'cancelled' }), TODAY)).toBe(false);
  });
});

describe('tournamentIcs', () => {
  const now = new Date('2030-03-10T06:30:00.000Z');
  const t = record({
    slug: 'sample-open-2030-sample-city',
    name: 'Sample Open; Juniors, Seniors',
    startDate: '2030-03-30',
    endDate: '2030-03-31',
    venue: 'Sample Hall',
    showContact: true,
  });

  it('is one all-day event over the IST dates, with the end day exclusive and CRLF lines', () => {
    const ics = tournamentIcs(t, { origin: 'https://example.test', now });
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Power Smash//Tournaments//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:sample-open-2030-sample-city@example.test',
        'DTSTAMP:20300310T063000Z',
        'DTSTART;VALUE=DATE:20300330',
        'DTEND;VALUE=DATE:20300401',
        'SUMMARY:Sample Open\\; Juniors\\, Seniors',
        'LOCATION:Sample Hall\\, Sample City\\, Sample District',
        // folded at exactly 75 octets: 12 + 44 + 19
        'DESCRIPTION:Badminton tournament listed by Power Smash: https://example.tes',
        ' t/tournaments/sample-open-2030-sample-city/',
        'URL:https://example.test/tournaments/sample-open-2030-sample-city/',
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('never holds an organizer contact', () => {
    const ics = tournamentIcs(t, { origin: 'https://example.test', now });
    expect(ics).not.toContain('Sample Person');
    expect(ics).not.toContain('register');
    expect(ics).not.toContain('Sample Association');
  });

  it('marks a postponed tournament tentative and folds long lines at 75 octets', () => {
    const long = tournamentIcs(record({ slug: 'p', name: 'X'.repeat(200), startDate: '2030-04-01', status: 'postponed' }), {
      origin: 'https://example.test',
      now,
    });
    expect(long).toContain('STATUS:TENTATIVE');
    for (const line of long.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
