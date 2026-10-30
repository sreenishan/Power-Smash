// Match scheduling (Module 4, Phase A): a greedy, deterministic court-and-time scheduler, the official's conflict report and a
// checked reschedule. PURE: no I/O, no clock, no randomness; the caller passes every instant. Nothing here is wired into a page,
// the admin or the database yet.
//
// Rules (what a schedule must honour):
// - Day windows: a match starts and ends inside ONE window (a date plus local 'HH:MM' start and end, read in the venue's IANA time
//   zone, default Asia/Kolkata). A match never runs across two windows or past the end of play.
// - Courts: one match per court at a time (back-to-back is fine: a match may start at the minute the previous one ends).
// - Players: a player (singles, or either partner of a doubles pair, across ALL events: ids are per player, not per entry) plays one
//   match at a time and gets at least `restMinutes` between the end of one match and the start of the next.
// - Dependencies: a match cannot start before every match feeding it has ended (a final waits for both semi-finals).
//
// Decisions:
// - The minimum rest is NOT a BWF Laws of Badminton rule; it varies by tournament regulations. Default 30 minutes is an ASSUMPTION,
//   configurable (`restMinutes`). With `restAfterFeeders` (default true, an assumption: the feeder's winner plays the next match even
//   while the player ids are still unknown) the same rest also applies between a feeder's end and the dependent's start.
// - Greedy order: dependencies first (topological), then input order; each match takes the EARLIEST feasible start and, at that
//   start, the first court in the court list (or its fixed court). The earliest feasible start is always one of a small set of
//   boundaries (window starts, earliest start, feeder ends, court-free times, player-free times), so we test only those: exact and
//   deterministic. Greedy is not optimal (a later match may have fitted better earlier); the official can reschedule.
// - Anything that cannot be placed is reported with a plain-English reason, never dropped silently. Structurally invalid input
//   (duplicate ids, impossible calendar dates or instants such as 2026-02-30 or 25:00, bad times, unknown time zone, a scheduled
//   match whose end is not start + duration, bad settings on a hand-built schedule) throws a RangeError instead.
// - Instants are stored as UTC ISO strings (toISOString). Local wall-clock times convert through Intl only (no library) with the
//   fixed 'compatible' rule (as in Temporal): a local time that does not exist at a daylight-saving change (spring forward) moves
//   FORWARD by the gap (London 2026-03-29 01:30 becomes 02:30 BST), and a local time that happens twice (fall back) takes the
//   EARLIER occurrence (New York 2026-11-01 01:30 is 01:30 EDT). India has no daylight saving, so Asia/Kolkata is never affected.
// - Reschedule counts a conflict as "created" when it is new OR its details changed (its message carries the times and the rest
//   minutes), so moving a match that is already in conflict to another conflicting time is never accepted silently.
// - Conflict messages show local times as 'YYYY-MM-DD HH:MM' in the schedule's time zone, built from Intl parts so they are the same
//   on every machine.
import { TIME_ZONE, isIsoDate } from '../../dates';
import type { IsoDate, IsoInstant } from '../types';

/** A match to schedule. Sides list player ids (1 for singles, 2 for doubles; empty while still to be decided, e.g. a final). */
export interface SchedulableMatch {
  id: string;
  sideA: readonly string[];
  sideB: readonly string[];
  /** Length to book, whole minutes, greater than 0. */
  durationMinutes: number;
  /** Not before this instant (ISO with Z or an offset). Absent = from the first window. */
  earliestStart?: IsoInstant;
  /** Must be played on this court. */
  court?: string;
  /** Ids of the matches feeding this one; it cannot start before they all end. */
  dependsOn?: readonly string[];
  /** Short name for the conflict report, e.g. 'MS QF1'. Defaults to the id. */
  label?: string;
}

/** A playing window on one local calendar date, e.g. { date: '2026-11-07', start: '08:00', end: '20:00' }. */
export interface DayWindow {
  date: IsoDate;
  start: string;
  end: string;
}

export interface ScheduleSettings {
  courts: readonly string[];
  windows: readonly DayWindow[];
  /** IANA time zone the windows are read in. Default Asia/Kolkata. */
  timeZone?: string;
  /** Minimum minutes between a player's matches. Default 30 (an ASSUMPTION; set by the tournament's regulations). */
  restMinutes?: number;
  /** Apply the rest between a feeder's end and its dependent's start. Default true (an ASSUMPTION). */
  restAfterFeeders?: boolean;
}

/** Settings with every default filled in, as stored on a schedule. */
export interface ResolvedSettings {
  courts: readonly string[];
  windows: readonly DayWindow[];
  timeZone: string;
  restMinutes: number;
  restAfterFeeders: boolean;
}

/** One placed match. */
export interface ScheduledMatch {
  matchId: string;
  label: string;
  court: string;
  start: IsoInstant;
  end: IsoInstant;
  durationMinutes: number;
  sideA: readonly string[];
  sideB: readonly string[];
  dependsOn: readonly string[];
}

/** A schedule: placed matches in start order (then court order) plus the settings they were checked against. */
export interface Schedule {
  matches: readonly ScheduledMatch[];
  settings: ResolvedSettings;
}

export interface UnplacedMatch {
  matchId: string;
  reason: string;
}

export interface ScheduleResult {
  schedule: Schedule;
  unplaced: readonly UnplacedMatch[];
}

export type ConflictKind = 'player-overlap' | 'court-double-booking' | 'rest-violation' | 'outside-window' | 'dependency-order' | 'unknown-court';

/** One problem in a schedule, with a plain-English message for the official. */
export interface Conflict {
  kind: ConflictKind;
  /** The match or matches involved, sorted. */
  matchIds: readonly string[];
  /** Players involved (overlap and rest), sorted; empty otherwise. */
  playerIds: readonly string[];
  /** The court involved (double booking, unknown court); null otherwise. */
  court: string | null;
  message: string;
}

export interface RescheduleOptions {
  /** 'report' (default): apply the move and report the conflicts it creates. 'refuse': keep the old schedule if it creates any. */
  mode?: 'report' | 'refuse';
}

export interface RescheduleResult {
  /** True when the move was applied. */
  applied: boolean;
  schedule: Schedule;
  /** Conflicts the move creates or changes (absent, or different, before it). Never empty when a conflicting move is refused. */
  created: readonly Conflict[];
  /** Every conflict in the returned schedule. */
  all: readonly Conflict[];
}

export const DEFAULT_REST_MINUTES = 30;

const MINUTE = 60_000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------------------------------------------------------
// Time zone helpers (Intl only)

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      throw new RangeError(`Unknown time zone: ${timeZone}`);
    }
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(ms: number, timeZone: string): WallClock {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Offset of the zone from UTC at an instant, in ms (IST = +19,800,000). */
function offsetMs(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const DAY_MS = 24 * 60 * MINUTE;

function showsWallClock(ms: number, timeZone: string, y: number, mo: number, d: number, h: number, mi: number): boolean {
  const w = wallClock(ms, timeZone);
  return w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi;
}

function localToMs(date: IsoDate, time: string, timeZone: string): number {
  if (!isIsoDate(date)) throw new RangeError(`Not an ISO calendar date: ${String(date)}`);
  const m = HHMM.exec(typeof time === 'string' ? time : '');
  if (!m) throw new RangeError(`Not a 24-hour time HH:MM: ${String(time)}`);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const h = Number(m[1]);
  const mi = Number(m[2]);
  // The wall clock read as if it were UTC; the real instant is guess minus the zone's offset.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Offsets a day either side: no zone changes offset twice within 48 hours, so these are the offsets before and after any change.
  const before = offsetMs(guess - DAY_MS, timeZone);
  const after = offsetMs(guess + DAY_MS, timeZone);
  const viaBefore = guess - before;
  const viaAfter = guess - after;
  if (before === after) return viaBefore;
  const okBefore = showsWallClock(viaBefore, timeZone, y, mo, d, h, mi);
  const okAfter = showsWallClock(viaAfter, timeZone, y, mo, d, h, mi);
  // Repeated time (both readings real): the earlier occurrence. Only one real: that one.
  if (okBefore && okAfter) return Math.min(viaBefore, viaAfter);
  if (okBefore) return viaBefore;
  if (okAfter) return viaAfter;
  // Missing time (a gap): read it with the offset before the change, which lands the gap's length later on the new clock.
  return viaBefore;
}

/** The UTC instant (ISO) of a local wall-clock date and 'HH:MM' in an IANA time zone (default Asia/Kolkata). */
export function localToUtc(date: IsoDate, time: string, timeZone: string = TIME_ZONE): IsoInstant {
  return new Date(localToMs(date, time, timeZone)).toISOString();
}

/** 'YYYY-MM-DD HH:MM' for an instant in a time zone (the conflict report's format). */
export function formatLocal(instant: IsoInstant, timeZone: string = TIME_ZONE): string {
  return formatLocalMs(parseInstant(instant, 'instant'), timeZone);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocalMs(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

function formatClockMs(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

function parseInstant(value: string, what: string): number {
  const m = typeof value === 'string' ? INSTANT.exec(value) : null;
  if (!m) throw new RangeError(`${what} must be an ISO instant with Z or an offset: ${String(value)}`);
  // Date.parse rolls impossible values over (2026-02-30 becomes 2 March), so check every field first.
  const [, date, hh, mm, ss, offset] = m as unknown as [string, string, string, string, string | undefined, string];
  const offsetOk = offset === 'Z' || (Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4, 6)) <= 59);
  if (!isIsoDate(date) || Number(hh) > 23 || Number(mm) > 59 || (ss !== undefined && Number(ss) > 59) || !offsetOk) {
    throw new RangeError(`${what} is not a real instant: ${value}`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new RangeError(`${what} is not a real instant: ${value}`);
  return ms;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Validation

function resolveSettings(settings: ScheduleSettings): ResolvedSettings {
  const timeZone = settings.timeZone ?? TIME_ZONE;
  partsFormatter(timeZone);
  const restMinutes = settings.restMinutes ?? DEFAULT_REST_MINUTES;
  if (!Number.isInteger(restMinutes) || restMinutes < 0) throw new RangeError('restMinutes must be a whole number of minutes, 0 or more');
  if (settings.restAfterFeeders !== undefined && typeof settings.restAfterFeeders !== 'boolean') throw new RangeError('restAfterFeeders must be true or false');
  if (!Array.isArray(settings.courts) || !Array.isArray(settings.windows)) throw new RangeError('courts and windows must be lists');
  if (settings.courts.length === 0) throw new RangeError('At least one court is needed');
  if (new Set(settings.courts).size !== settings.courts.length) throw new RangeError('Court ids must be unique');
  for (const c of settings.courts) if (typeof c !== 'string' || c === '') throw new RangeError('Court ids must be non-empty strings');
  for (const w of settings.windows) {
    if (localToMs(w.date, w.end, timeZone) <= localToMs(w.date, w.start, timeZone)) {
      throw new RangeError(`Window on ${w.date} must end after it starts (${w.start} to ${w.end})`);
    }
  }
  return {
    courts: [...settings.courts],
    windows: settings.windows.map((w) => ({ ...w })),
    timeZone,
    restMinutes,
    restAfterFeeders: settings.restAfterFeeders ?? true,
  };
}

interface Interval {
  start: number;
  end: number;
}

function windowIntervals(s: ResolvedSettings): Interval[] {
  return s.windows
    .map((w) => ({ start: localToMs(w.date, w.start, s.timeZone), end: localToMs(w.date, w.end, s.timeZone) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function playersOf(m: { sideA: readonly string[]; sideB: readonly string[] }): string[] {
  return [...m.sideA, ...m.sideB];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Scheduler

/**
 * Greedy, deterministic scheduler: places every match it can at its earliest feasible start, honouring day windows, courts,
 * player rest (doubles partners included, across events) and dependencies. Reports what it could not place, with a reason.
 */
export function scheduleMatches(matches: readonly SchedulableMatch[], settings: ScheduleSettings): ScheduleResult {
  const s = resolveSettings(settings);
  const windows = windowIntervals(s);
  const rest = s.restMinutes * MINUTE;

  const byId = new Map<string, SchedulableMatch>();
  for (const m of matches) {
    if (typeof m.id !== 'string' || m.id === '') throw new RangeError('Every match needs a non-empty id');
    if (byId.has(m.id)) throw new RangeError(`Duplicate match id: ${m.id}`);
    if (!Number.isInteger(m.durationMinutes) || m.durationMinutes <= 0) throw new RangeError(`Match ${m.id}: durationMinutes must be a whole number above 0`);
    if (m.earliestStart !== undefined) parseInstant(m.earliestStart, `Match ${m.id} earliestStart`);
    byId.set(m.id, m);
  }

  const placed = new Map<string, ScheduledMatch>();
  const placedMs = new Map<string, Interval>();
  const unplaced: UnplacedMatch[] = [];
  const failed = new Set<string>();
  const courtBusy = new Map<string, Interval[]>(s.courts.map((c) => [c, []]));
  const playerBusy = new Map<string, Interval[]>();

  const fail = (id: string, reason: string): void => {
    failed.add(id);
    unplaced.push({ matchId: id, reason });
  };

  // Matches whose own data rules them out, before any placing.
  const pending: SchedulableMatch[] = [];
  for (const m of matches) {
    const players = playersOf(m);
    const dupe = players.find((p, i) => players.indexOf(p) !== i);
    if (dupe !== undefined) fail(m.id, `Player ${dupe} appears twice in this match.`);
    else if (m.court !== undefined && !courtBusy.has(m.court)) fail(m.id, `Court ${m.court} is not in the court list.`);
    else if ((m.dependsOn ?? []).includes(m.id)) fail(m.id, 'The match depends on itself.');
    else {
      const missing = (m.dependsOn ?? []).find((d) => !byId.has(d));
      if (missing !== undefined) fail(m.id, `It depends on match ${missing}, which is not in the list.`);
      else pending.push(m);
    }
  }

  // Topological, input order among the ready ones.
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i += 1) {
      const m = pending[i] as SchedulableMatch;
      const deps = m.dependsOn ?? [];
      const failedDep = deps.find((d) => failed.has(d));
      if (failedDep !== undefined) {
        fail(m.id, `It depends on match ${failedDep}, which could not be placed.`);
      } else if (deps.every((d) => placed.has(d))) {
        place(m);
      } else {
        continue;
      }
      pending.splice(i, 1);
      progress = true;
      break;
    }
  }
  for (const m of pending) fail(m.id, 'Its dependencies form a loop, so it can never start.');

  function place(m: SchedulableMatch): void {
    const duration = m.durationMinutes * MINUTE;
    const players = playersOf(m);
    let lower = m.earliestStart === undefined ? -Infinity : Date.parse(m.earliestStart);
    for (const d of m.dependsOn ?? []) {
      const iv = placedMs.get(d) as Interval;
      lower = Math.max(lower, iv.end + (s.restAfterFeeders ? rest : 0));
    }
    const courts = m.court === undefined ? s.courts : [m.court];

    const candidates = new Set<number>();
    if (lower !== -Infinity) candidates.add(lower);
    for (const w of windows) candidates.add(w.start);
    for (const c of courts) for (const iv of courtBusy.get(c) ?? []) candidates.add(iv.end);
    for (const p of players) for (const iv of playerBusy.get(p) ?? []) candidates.add(iv.end + rest);
    const times = [...candidates].filter((t) => t >= lower).sort((a, b) => a - b);

    for (const t of times) {
      const end = t + duration;
      if (!windows.some((w) => t >= w.start && end <= w.end)) continue;
      const playersFree = players.every((p) => (playerBusy.get(p) ?? []).every((iv) => t >= iv.end + rest || end + rest <= iv.start));
      if (!playersFree) continue;
      const court = courts.find((c) => (courtBusy.get(c) ?? []).every((iv) => t >= iv.end || end <= iv.start));
      if (court === undefined) continue;

      const iv = { start: t, end };
      courtBusy.get(court)?.push(iv);
      for (const p of players) {
        const list = playerBusy.get(p) ?? [];
        list.push(iv);
        playerBusy.set(p, list);
      }
      placedMs.set(m.id, iv);
      placed.set(m.id, {
        matchId: m.id,
        label: m.label ?? m.id,
        court,
        start: new Date(t).toISOString(),
        end: new Date(end).toISOString(),
        durationMinutes: m.durationMinutes,
        sideA: [...m.sideA],
        sideB: [...m.sideB],
        dependsOn: [...(m.dependsOn ?? [])],
      });
      return;
    }
    const why = windows.length === 0 ? 'There are no day windows.' : 'No court and time inside the day windows fits its length, the rest rules and its dependencies.';
    fail(m.id, why);
  }

  return { schedule: { matches: sortMatches([...placed.values()], s.courts), settings: s }, unplaced };
}

function sortMatches(list: ScheduledMatch[], courts: readonly string[]): ScheduledMatch[] {
  const order = (c: string): number => {
    const i = courts.indexOf(c);
    return i === -1 ? courts.length : i;
  };
  return list.sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || order(a.court) - order(b.court) || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Conflict report

const KIND_ORDER: readonly ConflictKind[] = ['player-overlap', 'court-double-booking', 'rest-violation', 'dependency-order', 'outside-window', 'unknown-court'];

/**
 * The official's conflict report: every pair of overlapping matches sharing a player (doubles partners included), every court
 * double booking, every rest-period violation, every match starting before a feeder ends, every match outside the day windows and
 * every match on a court that is not in the list. Plain English, deterministic order.
 */
export function findConflicts(schedule: Schedule): Conflict[] {
  // A hand-built schedule gets the same checks as scheduleMatches' settings.
  const s = resolveSettings(schedule.settings);
  const tz = s.timeZone;
  const rest = s.restMinutes * MINUTE;
  const windows = windowIntervals(s);
  const seen = new Set<string>();
  const items = schedule.matches.map((m) => {
    if (typeof m.matchId !== 'string' || m.matchId === '') throw new RangeError('Every scheduled match needs a non-empty id');
    if (seen.has(m.matchId)) throw new RangeError(`Duplicate match id in schedule: ${m.matchId}`);
    seen.add(m.matchId);
    if (!Number.isInteger(m.durationMinutes) || m.durationMinutes <= 0) throw new RangeError(`Match ${m.matchId}: durationMinutes must be a whole number above 0`);
    const start = parseInstant(m.start, `Match ${m.matchId} start`);
    const end = parseInstant(m.end, `Match ${m.matchId} end`);
    if (end <= start) throw new RangeError(`Match ${m.matchId} must end after it starts`);
    if (end - start !== m.durationMinutes * MINUTE) throw new RangeError(`Match ${m.matchId}: end must be start plus durationMinutes (${m.durationMinutes})`);
    return { m, start, end };
  });
  const byId = new Map(items.map((x) => [x.m.matchId, x]));
  const desc = (x: (typeof items)[number]): string => `${x.m.label} (court ${x.m.court}, ${formatLocalMs(x.start, tz)}-${formatClockMs(x.end, tz)})`;
  const out: Conflict[] = [];

  const sorted = [...items].sort((a, b) => a.start - b.start || (a.m.matchId < b.m.matchId ? -1 : 1));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i] as (typeof items)[number];
      const b = sorted[j] as (typeof items)[number];
      const ids = [a.m.matchId, b.m.matchId].sort();
      const overlap = a.start < b.end && b.start < a.end;
      const aPlayers = new Set(playersOf(a.m));
      const shared = [...new Set(playersOf(b.m))].filter((p) => aPlayers.has(p)).sort();

      if (overlap && a.m.court === b.m.court) {
        out.push({
          kind: 'court-double-booking',
          matchIds: ids,
          playerIds: [],
          court: a.m.court,
          message: `Court ${a.m.court} is booked twice at once: ${desc(a)} and ${desc(b)}.`,
        });
      }
      if (shared.length > 0) {
        const who = shared.length === 1 ? `Player ${shared[0]} is` : `Players ${shared.join(', ')} are`;
        if (overlap) {
          out.push({ kind: 'player-overlap', matchIds: ids, playerIds: shared, court: null, message: `${who} in two matches at the same time: ${desc(a)} and ${desc(b)}.` });
        } else {
          const [first, second] = a.end <= b.start ? [a, b] : [b, a];
          const gap = second.start - first.end;
          if (gap < rest) {
            out.push({
              kind: 'rest-violation',
              matchIds: ids,
              playerIds: shared,
              court: null,
              message: `${who} given ${gap / MINUTE} minutes of rest between ${desc(first)} and ${desc(second)}; the minimum is ${s.restMinutes}.`,
            });
          }
        }
      }
    }
  }

  for (const x of items) {
    for (const d of x.m.dependsOn) {
      const f = byId.get(d);
      if (!f) continue;
      const ids = [x.m.matchId, d].sort();
      if (x.start < f.end) {
        out.push({ kind: 'dependency-order', matchIds: ids, playerIds: [], court: null, message: `${desc(x)} starts before ${desc(f)}, which feeds it, has ended.` });
      } else if (s.restAfterFeeders && x.start - f.end < rest) {
        const sharesPlayer = playersOf(x.m).some((p) => playersOf(f.m).includes(p));
        if (!sharesPlayer) {
          out.push({
            kind: 'rest-violation',
            matchIds: ids,
            playerIds: [],
            court: null,
            message: `The winner of ${desc(f)} gets ${(x.start - f.end) / MINUTE} minutes of rest before ${desc(x)}; the minimum is ${s.restMinutes}.`,
          });
        }
      }
    }
    if (!windows.some((w) => x.start >= w.start && x.end <= w.end)) {
      out.push({ kind: 'outside-window', matchIds: [x.m.matchId], playerIds: [], court: null, message: `${desc(x)} is outside the playing hours.` });
    }
    if (!s.courts.includes(x.m.court)) {
      out.push({ kind: 'unknown-court', matchIds: [x.m.matchId], playerIds: [], court: x.m.court, message: `${desc(x)} is on court ${x.m.court}, which is not in the court list.` });
    }
  }

  return out.sort((a, b) => {
    const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (k !== 0) return k;
    const ka = conflictKey(a);
    const kb = conflictKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function conflictKey(c: Conflict): string {
  return [c.kind, c.matchIds.join(','), c.playerIds.join(','), c.court ?? ''].join('|');
}

// ---------------------------------------------------------------------------------------------------------------------------
// Reschedule

/**
 * Move one match to a new start (ISO instant with Z or an offset; use localToUtc for a local time) and optionally a new court.
 * Returns the conflicts the move creates; never applies a conflicting move silently ('refuse' mode keeps the old schedule).
 */
export function reschedule(schedule: Schedule, matchId: string, newStart: IsoInstant, newCourt?: string, options: RescheduleOptions = {}): RescheduleResult {
  const target = schedule.matches.find((m) => m.matchId === matchId);
  if (!target) throw new RangeError(`Match ${matchId} is not in the schedule`);
  const startMs = parseInstant(newStart, 'newStart');
  if (newCourt !== undefined && (typeof newCourt !== 'string' || newCourt === '')) throw new RangeError('newCourt must be a non-empty court id');
  const before = findConflicts(schedule);
  const moved: ScheduledMatch = {
    ...target,
    court: newCourt ?? target.court,
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + target.durationMinutes * MINUTE).toISOString(),
  };
  const next: Schedule = {
    settings: schedule.settings,
    matches: sortMatches(
      schedule.matches.map((m) => (m.matchId === matchId ? moved : m)),
      schedule.settings.courts,
    ),
  };
  const all = findConflicts(next);
  // The message carries the times and the rest minutes, so a conflict the move makes worse (or merely shifts) counts as created.
  const fullKey = (c: Conflict): string => `${conflictKey(c)}|${c.message}`;
  const beforeKeys = new Set(before.map(fullKey));
  const created = all.filter((c) => !beforeKeys.has(fullKey(c)));
  if (created.length > 0 && options.mode === 'refuse') {
    return { applied: false, schedule, created, all: before };
  }
  return { applied: true, schedule: next, created, all };
}
