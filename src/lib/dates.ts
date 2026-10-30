// The one date module (D-030, CLAUDE.md): event dates are plain calendar dates ("YYYY-MM-DD") read as Asia/Kolkata;
// instants stay UTC and are only formatted for display, always through Intl with timeZone Asia/Kolkata and locale en-IN.
// Created by the Site-shell worker because D-030 requires a single module and none existed at M1 start; the lead may
// move or extend it. Pure functions: tests/site/dates.test.ts.

export const TIME_ZONE = 'Asia/Kolkata';
const LOCALE = 'en-IN';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
}

/** The instant of noon on an IST calendar date (noon avoids any edge at midnight when formatting back to IST). */
function istNoon(isoDate: string): Date {
  if (!isIsoDate(isoDate)) throw new RangeError(`Not an ISO calendar date: ${String(isoDate)}`);
  return new Date(`${isoDate}T12:00:00+05:30`);
}

const longDate = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' });
const dayOnly = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric' });
const monthDay = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'long' });
const monthYear = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, month: 'long', year: 'numeric' });
const isoParts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "20 October 2026" from an IST calendar date or from an instant (a Date, or an ISO timestamp with a zone). */
export function formatDate(input: string | Date): string {
  if (typeof input === 'string' && ISO_DATE.test(input)) return longDate.format(istNoon(input));
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new RangeError('Not a date');
  return longDate.format(date);
}

/** "October 2026", used to group tournaments by month. */
export function formatMonthYear(isoDate: string): string {
  return monthYear.format(istNoon(isoDate));
}

/** "20-22 October 2026", "30 October - 2 November 2026", or one date when the end is missing or the same. */
export function formatDateRange(startIso: string, endIso?: string | null): string {
  if (!endIso || endIso === startIso) return formatDate(startIso);
  const start = istNoon(startIso);
  const end = istNoon(endIso);
  const sameYear = startIso.slice(0, 4) === endIso.slice(0, 4);
  const sameMonth = sameYear && startIso.slice(5, 7) === endIso.slice(5, 7);
  if (sameMonth) return `${dayOnly.format(start)}–${longDate.format(end)}`;
  if (sameYear) return `${monthDay.format(start)} – ${longDate.format(end)}`;
  return `${longDate.format(start)} – ${longDate.format(end)}`;
}

/** Today's calendar date in Asia/Kolkata as YYYY-MM-DD (the build runs on UTC; the audience does not). */
export function todayIst(now: Date = new Date()): string {
  return isoParts.format(now); // en-CA formats as YYYY-MM-DD
}

/**
 * Whole calendar days from one IST calendar date to another (negative when `toIso` is earlier). Used by the release check to
 * warn when an owner-stated, dated figure (site.channel.asOfDate, site.audience.asOfDate) gets old (D-016 item 5, review C-17).
 */
export function daysBetween(fromIso: string, toIso: string): number {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) throw new RangeError('daysBetween expects two ISO calendar dates (YYYY-MM-DD)');
  const utcDay = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return utcDay(toIso) - utcDay(fromIso);
}

/** A tournament is upcoming until its last day (inclusive) has passed in IST. Plain string comparison is safe for ISO dates. */
export function isUpcoming(startIso: string, endIso: string | null | undefined, today: string): boolean {
  return (endIso ?? startIso) >= today;
}

/** True while a tournament is running: its first day has come and its last day (inclusive) has not passed in IST. */
export function isOngoing(startIso: string, endIso: string | null | undefined, today: string): boolean {
  return startIso <= today && (endIso ?? startIso) >= today;
}

/** The IST calendar date `days` after `isoDate` (negative goes back), YYYY-MM-DD. Calendar dates have no time zone, so UTC arithmetic is exact. */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`Not an ISO calendar date: ${String(isoDate)}`);
  if (!Number.isInteger(days)) throw new RangeError('addDays expects a whole number of days');
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const instantFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "Saturday, 7 November 2026 at 9:30 am (India time)" style, for an instant (ISO string). Throws on an unreadable instant. */
export function formatInstantIst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError('Not an instant');
  return `${instantFormat.format(d)} (India time)`;
}

// ----------------------------------------------------------------------------- India time for forms (UTC+05:30 all year: India has no daylight saving)

const IST_OFFSET = '+05:30';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ZONED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** True for a 24-hour clock time written HH:MM ("09:30", "23:59"). */
export function isHhMm(time: string): boolean {
  return HHMM.test(time);
}

/** "2026-11-14" + "09:30" -> "2026-11-14T09:30:00+05:30" (that date and time in India), or null for a bad date or time. */
export function istInstant(date: string, time: string): string | null {
  if (!isIsoDate(date) || !isHhMm(time)) return null;
  return `${date}T${time}:00${IST_OFFSET}`;
}

const hhmmIst = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** An instant with a zone split into its India date and time, for a form ("2026-11-14", "09:30"); empty strings when unreadable. */
export function splitIst(instant: string | null | undefined): { date: string; time: string } {
  if (typeof instant !== 'string' || !ZONED_INSTANT.test(instant)) return { date: '', time: '' };
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return { date: isoParts.format(d), time: hhmmIst.format(d) };
}
