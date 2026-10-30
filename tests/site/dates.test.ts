import { describe, expect, it } from 'vitest';
import { daysBetween, formatDate, formatDateRange, formatMonthYear, isHhMm, isIsoDate, istInstant, isUpcoming, splitIst, todayIst } from '../../src/lib/dates';

describe('dates (Asia/Kolkata, en-IN)', () => {
  it('D-030: an upload at 2026-10-19T20:30:00Z is 20 October 2026 in IST while the ISO instant stays UTC', () => {
    const instant = '2026-10-19T20:30:00Z';
    expect(formatDate(instant)).toBe('20 October 2026');
    expect(new Date(instant).toISOString()).toBe('2026-10-19T20:30:00.000Z');
  });

  it('formats an IST calendar date without shifting it', () => {
    expect(formatDate('2026-10-20')).toBe('20 October 2026');
    expect(formatDate('2026-01-01')).toBe('1 January 2026');
    expect(formatDate('2026-12-31')).toBe('31 December 2026');
    expect(formatMonthYear('2026-12-05')).toBe('December 2026');
  });

  it('formats ranges compactly', () => {
    expect(formatDateRange('2026-12-05', null)).toBe('5 December 2026');
    expect(formatDateRange('2026-12-05', '2026-12-05')).toBe('5 December 2026');
    expect(formatDateRange('2026-12-05', '2026-12-07')).toBe('5–7 December 2026');
    expect(formatDateRange('2026-10-30', '2026-11-02')).toBe('30 October – 2 November 2026');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 December 2026 – 2 January 2027');
  });

  it('today in IST rolls over at 18:30 UTC, not at midnight UTC', () => {
    expect(todayIst(new Date('2026-10-19T18:29:59Z'))).toBe('2026-10-19');
    expect(todayIst(new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20');
    expect(todayIst(new Date('2026-10-19T20:30:00Z'))).toBe('2026-10-20');
  });

  it('a tournament is upcoming through its last day (IST) and past after it', () => {
    expect(isUpcoming('2026-12-05', '2026-12-07', '2026-12-07')).toBe(true);
    expect(isUpcoming('2026-12-05', '2026-12-07', '2026-12-08')).toBe(false);
    expect(isUpcoming('2026-12-05', null, '2026-12-05')).toBe(true);
    expect(isUpcoming('2026-12-05', null, '2026-12-06')).toBe(false);
    expect(isUpcoming('2026-12-05', undefined, '2026-11-01')).toBe(true);
  });

  it('validates calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('20-02-2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(20261005)).toBe(false);
    expect(() => formatDateRange('2026-02-30')).toThrow(RangeError);
  });

  it('counts whole calendar days between two IST dates, across month, year and leap-day edges (release check for dated figures)', () => {
    expect(daysBetween('2026-10-20', '2026-10-20')).toBe(0);
    expect(daysBetween('2026-10-20', '2026-10-21')).toBe(1);
    expect(daysBetween('2026-10-20', '2026-11-19')).toBe(30);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-21', '2026-10-20')).toBe(-1);
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => daysBetween('2026-03-01', 'soon')).toThrow(RangeError);
  });
});

describe('India time for forms (istInstant, splitIst, isHhMm)', () => {
  it('builds an instant from an India date and a 24-hour time, refusing bad input', () => {
    expect(istInstant('2026-11-14', '09:30')).toBe('2026-11-14T09:30:00+05:30');
    expect(new Date(istInstant('2026-11-14', '00:15')!).toISOString()).toBe('2026-11-13T18:45:00.000Z');
    expect(istInstant('2026-02-29', '09:30')).toBeNull();
    expect(istInstant('2026-11-14', '9:30')).toBeNull();
    expect(istInstant('2026-11-14', '24:00')).toBeNull();
    expect(istInstant('', '')).toBeNull();
  });

  it('splits an instant into its India date and time, crossing midnight correctly', () => {
    expect(splitIst('2026-11-14T04:00:00.000Z')).toEqual({ date: '2026-11-14', time: '09:30' });
    expect(splitIst('2026-11-13T20:00:00Z')).toEqual({ date: '2026-11-14', time: '01:30' });
    expect(splitIst('2026-11-14T09:30:00+05:30')).toEqual({ date: '2026-11-14', time: '09:30' });
    expect(splitIst(istInstant('2026-12-31', '23:59'))).toEqual({ date: '2026-12-31', time: '23:59' });
  });

  it('gives empty strings for anything that is not an instant with a zone', () => {
    expect(splitIst(null)).toEqual({ date: '', time: '' });
    expect(splitIst(undefined)).toEqual({ date: '', time: '' });
    expect(splitIst('2026-11-14')).toEqual({ date: '', time: '' });
    expect(splitIst('2026-11-14T09:30:00')).toEqual({ date: '', time: '' });
    expect(splitIst('2026-13-40T09:30:00Z')).toEqual({ date: '', time: '' });
  });

  it('isHhMm accepts only HH:MM on a 24-hour clock', () => {
    expect(isHhMm('00:00')).toBe(true);
    expect(isHhMm('23:59')).toBe(true);
    expect(isHhMm('24:00')).toBe(false);
    expect(isHhMm('9:30')).toBe(false);
    expect(isHhMm('09:60')).toBe(false);
  });
});
