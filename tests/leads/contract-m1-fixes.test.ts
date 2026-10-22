// Regression tests for the M1 review-fix wave in the lead contract: B-2 (R-TEXT), B-18 (R-DATE), S-14 (source path and UTM).
import { describe, expect, it } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import {
  FIELD_ERROR_CODES,
  FIELD_ERROR_MESSAGES,
  START_DATE_MAX_DAYS_AHEAD,
  START_DATE_OUT_OF_RANGE_MESSAGE,
  addDaysToDate,
  isStartDateInWindow,
  istToday,
  startDateWindow,
  validateLeadRequest,
  type CoverageLeadRequest,
} from '../../src/lib/contracts/lead';
import { cleanSitePath } from '../../src/lib/contracts/site-path';
import { cleanEventPath } from '../../src/lib/contracts/event';
import { coverageBody, NOW, validUuid } from './helpers';

const validate = (body: unknown, now: Date = NOW) => validateLeadRequest(body, { now });
const errorsOf = (body: unknown, now: Date = NOW) => {
  const r = validate(body, now);
  return r.ok ? null : r.fieldErrors;
};
const coverage = (over: Record<string, unknown> = {}) => coverageBody(over);
const tournament = (over: Record<string, unknown> = {}) => ({
  kind: 'tournament_submission',
  name: 'Anitha R',
  phone: '98765 43210',
  tournamentName: 'Salem Summer Cup',
  startDate: '2026-12-20',
  idempotencyKey: validUuid(9),
  token: 'XXXX.DUMMY.TOKEN.XXXX',
  consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version },
  ...over,
});

describe('B-2 / R-TEXT through the contract', () => {
  it('a tournament name, venue, budget and fee pasted from a poster are accepted', () => {
    const r = validate(
      coverage({
        eventName: 'Chennai Open – Men’s Doubles “2026”!',
        venue: 'Nehru Stadium · Court 3',
        budgetRange: '₹25,000 – ₹40,000',
        level: '20% advance?',
        district: 'Chennai',
        organization: 'Salem District Badminton Association — TN',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as CoverageLeadRequest;
      expect(d.eventName).toBe('Chennai Open – Men’s Doubles “2026”!');
      expect(d.budgetRange).toBe('₹25,000 – ₹40,000');
    }
    expect(validate(tournament({ tournamentName: 'Cup — 2026!', entryFee: '₹500 per player' })).ok).toBe(true);
  });

  it('the dangerous characters are still refused in those fields', () => {
    for (const bad of ['Cup <script>', 'Cup {x}', 'Cup [x]', 'Cup | Day', 'Cup `x`', 'Cup \\ x', '=SUM(A1)', '+91 98765', 'Cup\u0007', 'a;b']) {
      expect(errorsOf(coverage({ eventName: bad }))?.eventName, JSON.stringify(bad)).toMatch(/invalid|html_not_allowed|formula_not_allowed|control_chars/);
    }
  });
});

describe('B-18 / R-DATE: a start date is a real date from yesterday (IST) up to 1,095 days ahead', () => {
  it('the window edges, with the clock injected (today in IST is 2026-11-02 at the test clock)', () => {
    expect(istToday(NOW)).toBe('2026-11-02');
    expect(startDateWindow(NOW)).toEqual({ min: '2026-11-01', max: addDaysToDate('2026-11-02', START_DATE_MAX_DAYS_AHEAD) });
    expect(START_DATE_MAX_DAYS_AHEAD).toBe(1095);
    expect(addDaysToDate('2026-11-02', 1095)).toBe('2029-11-01');
    expect(isStartDateInWindow('2026-11-01', NOW)).toBe(true);
    expect(isStartDateInWindow('2026-10-31', NOW)).toBe(false);
    expect(isStartDateInWindow('2029-11-01', NOW)).toBe(true);
    expect(isStartDateInWindow('2029-11-02', NOW)).toBe(false);
    for (const kind of [coverage, tournament]) {
      expect(validate(kind({ startDate: '2026-11-01' })).ok).toBe(true);
      expect(errorsOf(kind({ startDate: '2026-10-31' }))).toEqual({ startDate: 'date_out_of_range' });
      expect(validate(kind({ startDate: '2029-11-01' })).ok).toBe(true);
      expect(errorsOf(kind({ startDate: '2029-11-02' }))).toEqual({ startDate: 'date_out_of_range' });
    }
  });

  it('a year typo and ancient dates are caught (2025 for 2026, 2000-01-01)', () => {
    expect(errorsOf(coverage({ startDate: '2025-12-05' }))).toEqual({ startDate: 'date_out_of_range' });
    expect(errorsOf(coverage({ startDate: '2000-01-01' }))).toEqual({ startDate: 'date_out_of_range' });
    expect(errorsOf(tournament({ startDate: '2001-05-05' }))).toEqual({ startDate: 'date_out_of_range' });
    expect(errorsOf(coverage({ startDate: '2100-12-31' }))).toEqual({ startDate: 'date_out_of_range' });
  });

  it('IST midnight: yesterday rolls over at 18:30 UTC, and the window follows the injected clock', () => {
    const justBefore = new Date('2026-12-31T18:29:59.999Z'); // 2026-12-31 23:59:59 IST
    const justAfter = new Date('2026-12-31T18:30:00.000Z'); // 2027-01-01 00:00:00 IST
    expect(istToday(justBefore)).toBe('2026-12-31');
    expect(istToday(justAfter)).toBe('2027-01-01');
    expect(validate(coverage({ startDate: '2026-12-30' }), justBefore).ok).toBe(true); // yesterday
    expect(errorsOf(coverage({ startDate: '2026-12-30' }), justAfter)).toEqual({ startDate: 'date_out_of_range' }); // two days ago now
    expect(validate(coverage({ startDate: '2026-12-31' }), justAfter).ok).toBe(true); // yesterday now
    // 1,095 days ahead moves by a day across the same instant
    expect(isStartDateInWindow('2029-12-30', justBefore)).toBe(true);
    expect(isStartDateInWindow('2029-12-31', justBefore)).toBe(false);
    expect(isStartDateInWindow('2029-12-31', justAfter)).toBe(true);
  });

  it('a leap day is counted (calendar arithmetic, not 365-day years)', () => {
    expect(addDaysToDate('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDaysToDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDate('2026-01-01', 1095)).toBe('2028-12-31'); // 365 + 365 + 366 - 1
  });

  it('not-a-date stays invalid_date; blank or absent coverage date is still allowed; other kinds are unaffected', () => {
    expect(errorsOf(coverage({ startDate: '2026-02-30' }))).toEqual({ startDate: 'invalid_date' });
    expect(errorsOf(coverage({ startDate: '05/12/2026' }))).toEqual({ startDate: 'invalid_date' });
    expect(validate(coverage({ startDate: undefined })).ok).toBe(true);
    expect(validate(coverage({ startDate: '  ' })).ok).toBe(true);
    expect(errorsOf(tournament({ startDate: undefined }))).toEqual({ startDate: 'required' });
    const sponsorship = { idempotencyKey: validUuid(3), token: 'XXXX.DUMMY.TOKEN.XXXX', consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version }, name: 'Ravi Kumar', phone: '9876543210', kind: 'sponsorship', company: 'Acme', startMonth: '2026-12' };
    expect(validate(sponsorship).ok).toBe(true);
  });

  it('it merges with other field errors in one answer and ignores a bad date when the value is not a real date', () => {
    expect(errorsOf(coverage({ startDate: '2025-12-05', name: '' }))).toEqual({ name: 'required', startDate: 'date_out_of_range' });
    expect(errorsOf(coverage({ startDate: '2026-12-05', endDate: '2026-12-01' }))).toEqual({ endDate: 'invalid_date' });
  });

  it('the new code and its plain-English message are shared constants (the browser uses the same words)', () => {
    expect(FIELD_ERROR_CODES).toContain('date_out_of_range');
    expect(START_DATE_OUT_OF_RANGE_MESSAGE).toBe('Please check the date: it should be from yesterday up to three years ahead.');
    expect(FIELD_ERROR_MESSAGES.date_out_of_range).toBe(START_DATE_OUT_OF_RANGE_MESSAGE);
  });

  it('without an injected clock it uses the real time (a date far in the past is refused)', () => {
    expect(validateLeadRequest(coverage({ startDate: '2001-05-05' })).ok).toBe(false);
  });
});

describe('S-14: the stored page path and UTM values are safe to show later', () => {
  const source = (r: ReturnType<typeof validate>) => (r.ok ? r.data.source : 'invalid');

  it('source.path must be ONE absolute path: a protocol-relative or backslash path is dropped', () => {
    for (const bad of ['//evil.example/x', '///x', '/\\evil.example', '\\\\evil.example', '/a//b', '/a/../b', 'evil.example/x', 'https://evil.example/x', '/a b', '/<x>', '', '/' + 'a'.repeat(250)]) {
      expect(source(validate(coverage({ source: { path: bad } }))), JSON.stringify(bad)).toBeUndefined();
    }
    for (const [given, stored] of [
      ['/book/', '/book/'],
      ['/book/?utm_source=x#top', '/book/'],
      ['/tournaments/salem-cup/', '/tournaments/salem-cup/'],
      ['/', '/'],
    ] as const) {
      expect(source(validate(coverage({ source: { path: given } })))).toEqual({ path: stored });
    }
  });

  it('the same single-slash rule applies to analytics event paths', () => {
    expect(cleanEventPath('//evil.example/x')).toBeNull();
    expect(cleanEventPath('/\\evil.example')).toBeNull();
    expect(cleanEventPath('/book/?x=1')).toBe('/book/');
    expect(cleanSitePath(undefined)).toBeNull();
  });

  it('UTM values keep letters, digits, space and _ . - only; formulas, URLs and odd characters are dropped', () => {
    const utm = (u: Record<string, string>) => {
      const s = source(validate(coverage({ source: { path: '/book/', utm: u } })));
      return typeof s === 'object' ? s?.utm : s;
    };
    expect(utm({ source: 'instagram', medium: 'social', campaign: 'diwali_sale-2026', term: 'badminton coverage', content: 'story.1' })).toEqual({
      source: 'instagram',
      medium: 'social',
      campaign: 'diwali_sale-2026',
      term: 'badminton coverage',
      content: 'story.1',
    });
    const dropped = utm({ source: '-2+3', medium: '=cmd', campaign: 'https://evil.example/phish', term: '+91 98765', content: '@x', foo: 'bar' } as Record<string, string>);
    expect(dropped).toBeUndefined();
    expect(utm({ source: 'a:b', medium: 'a/b', campaign: 'a,b', term: 'a%20b', content: 'a+b' })).toBeUndefined();
    expect(utm({ source: 'ok', medium: 'a:b' })).toEqual({ source: 'ok' });
  });

  it('a stored lead row carries only the cleaned values', () => {
    const r = validate(coverage({ source: { path: '//evil.example/x', utm: { source: 'ig', campaign: 'https://evil.example/phish' } } }));
    expect(r.ok && r.data.source).toEqual({ utm: { source: 'ig' } });
  });
});
