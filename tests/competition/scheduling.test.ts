// Match scheduling engine (Module 4): greedy scheduler, conflict report, checked reschedule. Fictional players and venues only.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REST_MINUTES,
  findConflicts,
  formatLocal,
  localToUtc,
  reschedule,
  scheduleMatches,
  type Schedule,
  type SchedulableMatch,
  type ScheduleSettings,
} from '../../src/lib/competition/scheduling';

const DAY = '2026-11-07';
const base: ScheduleSettings = {
  courts: ['C1', 'C2'],
  windows: [{ date: DAY, start: '09:00', end: '18:00' }],
};

const singles = (id: string, a: string, b: string, extra: Partial<SchedulableMatch> = {}): SchedulableMatch => ({
  id,
  sideA: [a],
  sideB: [b],
  durationMinutes: 40,
  ...extra,
});

const byId = (s: Schedule, id: string) => {
  const m = s.matches.find((x) => x.matchId === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
};

describe('time zone conversion', () => {
  it('converts Asia/Kolkata wall clock to UTC and back', () => {
    expect(localToUtc(DAY, '09:00')).toBe('2026-11-07T03:30:00.000Z');
    expect(localToUtc(DAY, '00:15')).toBe('2026-11-06T18:45:00.000Z');
    expect(formatLocal('2026-11-07T03:30:00.000Z')).toBe('2026-11-07 09:00');
  });

  it('handles other zones in summer and winter time', () => {
    expect(localToUtc('2026-07-01', '10:00', 'Europe/London')).toBe('2026-07-01T09:00:00.000Z');
    expect(localToUtc('2026-12-01', '10:00', 'Europe/London')).toBe('2026-12-01T10:00:00.000Z');
    expect(localToUtc('2026-07-01', '10:00', 'America/New_York')).toBe('2026-07-01T14:00:00.000Z');
  });

  it("uses the 'compatible' rule on daylight-saving change dates: a missing time moves forward", () => {
    // London springs forward 2026-03-29 01:00 GMT -> 02:00 BST: 01:30 does not exist, it becomes 02:30 BST (01:30Z).
    expect(localToUtc('2026-03-29', '01:30', 'Europe/London')).toBe('2026-03-29T01:30:00.000Z');
    expect(formatLocal('2026-03-29T01:30:00.000Z', 'Europe/London')).toBe('2026-03-29 02:30');
    // New York springs forward 2026-03-08 02:00 EST -> 03:00 EDT: 02:30 becomes 03:30 EDT (07:30Z), never an hour earlier.
    expect(localToUtc('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    expect(formatLocal('2026-03-08T07:30:00.000Z', 'America/New_York')).toBe('2026-03-08 03:30');
    // Times either side of the gap are ordinary.
    expect(localToUtc('2026-03-29', '00:30', 'Europe/London')).toBe('2026-03-29T00:30:00.000Z');
    expect(localToUtc('2026-03-29', '02:30', 'Europe/London')).toBe('2026-03-29T01:30:00.000Z');
    expect(localToUtc('2026-03-08', '01:30', 'America/New_York')).toBe('2026-03-08T06:30:00.000Z');
    expect(localToUtc('2026-03-08', '03:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
  });

  it("uses the 'compatible' rule on daylight-saving change dates: a repeated time takes the earlier occurrence", () => {
    // London falls back 2026-10-25 02:00 BST -> 01:00 GMT: 01:30 happens twice; the earlier is 01:30 BST (00:30Z).
    expect(localToUtc('2026-10-25', '01:30', 'Europe/London')).toBe('2026-10-25T00:30:00.000Z');
    // New York falls back 2026-11-01 02:00 EDT -> 01:00 EST: the earlier 01:30 is EDT (05:30Z).
    expect(localToUtc('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    // Either side of the repeat.
    expect(localToUtc('2026-10-25', '00:30', 'Europe/London')).toBe('2026-10-24T23:30:00.000Z');
    expect(localToUtc('2026-10-25', '02:30', 'Europe/London')).toBe('2026-10-25T02:30:00.000Z');
    expect(localToUtc('2026-11-01', '03:00', 'America/New_York')).toBe('2026-11-01T08:00:00.000Z');
  });

  it('a window starting in a daylight-saving gap never moves earlier', () => {
    const { schedule } = scheduleMatches([singles('m1', 'p1', 'p2')], {
      courts: ['C1'],
      windows: [{ date: '2026-03-08', start: '02:30', end: '06:00' }],
      timeZone: 'America/New_York',
    });
    expect(byId(schedule, 'm1').start).toBe('2026-03-08T07:30:00.000Z');
  });

  it('refuses impossible instants instead of rolling them over', () => {
    for (const bad of ['2026-02-30T10:00:00Z', '2026-11-07T25:00:00Z', '2026-11-07T10:60:00Z', '2026-11-07T10:00:61Z', '2026-13-01T10:00:00Z', '2026-11-07T10:00:00+05:61']) {
      expect(() => formatLocal(bad)).toThrow(RangeError);
    }
    expect(() => scheduleMatches([singles('m1', 'p1', 'p2', { earliestStart: '2026-02-30T10:00:00Z' })], base)).toThrow(/not a real instant/);
    expect(() => scheduleMatches([singles('m1', 'p1', 'p2', { earliestStart: '2026-11-07T25:00:00Z' })], base)).toThrow(/not a real instant/);
    expect(formatLocal('2026-02-28T23:59:59.999+05:30')).toBe('2026-02-28 23:59');
  });

  it('refuses bad dates, times and zones', () => {
    expect(() => localToUtc('2026-02-30', '10:00')).toThrow(RangeError);
    expect(() => localToUtc(DAY, '24:00')).toThrow(RangeError);
    expect(() => localToUtc(DAY, '9:00')).toThrow(RangeError);
    expect(() => localToUtc(DAY, '10:00', 'Mars/Olympus')).toThrow(/Unknown time zone/);
    expect(() => formatLocal('2026-11-07T10:00:00')).toThrow(RangeError);
  });
});

describe('scheduleMatches', () => {
  it('fills courts from the window start, earliest first, in court order', () => {
    const { schedule, unplaced } = scheduleMatches([singles('m1', 'p1', 'p2'), singles('m2', 'p3', 'p4'), singles('m3', 'p5', 'p6')], base);
    expect(unplaced).toEqual([]);
    expect(byId(schedule, 'm1')).toMatchObject({ court: 'C1', start: '2026-11-07T03:30:00.000Z', end: '2026-11-07T04:10:00.000Z' });
    expect(byId(schedule, 'm2')).toMatchObject({ court: 'C2', start: '2026-11-07T03:30:00.000Z' });
    expect(byId(schedule, 'm3')).toMatchObject({ court: 'C1', start: '2026-11-07T04:10:00.000Z' });
    expect(schedule.settings.restMinutes).toBe(DEFAULT_REST_MINUTES);
    expect(schedule.settings.timeZone).toBe('Asia/Kolkata');
    expect(findConflicts(schedule)).toEqual([]);
  });

  it('is deterministic', () => {
    const ms = [singles('m1', 'p1', 'p2'), singles('m2', 'p1', 'p3'), singles('m3', 'p2', 'p3')];
    expect(scheduleMatches(ms, base)).toEqual(scheduleMatches(ms, base));
  });

  it('gives a player the minimum rest, leaving a free court idle if needed', () => {
    const { schedule } = scheduleMatches([singles('m1', 'p1', 'p2'), singles('m2', 'p1', 'p3')], { ...base, restMinutes: 20 });
    // m1 09:00-09:40, then p1 rests 20 minutes: m2 at 10:00 even though C2 is free.
    expect(byId(schedule, 'm2').start).toBe(localToUtc(DAY, '10:00'));
    expect(findConflicts(schedule)).toEqual([]);
  });

  it('treats doubles partners as players across events (mixed doubles and men\'s doubles sharing a player)', () => {
    const md: SchedulableMatch = { id: 'MD1', sideA: ['p1', 'p2'], sideB: ['p3', 'p4'], durationMinutes: 45 };
    const xd: SchedulableMatch = { id: 'XD1', sideA: ['p5', 'p6'], sideB: ['p2', 'p7'], durationMinutes: 45 };
    const free: SchedulableMatch = { id: 'XD2', sideA: ['p8', 'p9'], sideB: ['p10', 'p11'], durationMinutes: 45 };
    const { schedule } = scheduleMatches([md, xd, free], { ...base, restMinutes: 15 });
    expect(byId(schedule, 'MD1').start).toBe(localToUtc(DAY, '09:00'));
    expect(byId(schedule, 'XD1').start).toBe(localToUtc(DAY, '10:00')); // 09:45 end + 15 rest (p2)
    expect(byId(schedule, 'XD2')).toMatchObject({ court: 'C2', start: localToUtc(DAY, '09:00') });
    expect(findConflicts(schedule)).toEqual([]);
  });

  it('fills a gap left earlier when it fits (greedy earliest start, not append-only)', () => {
    const ms = [
      singles('m1', 'p1', 'p2', { court: 'C1' }),
      singles('m2', 'p1', 'p3', { court: 'C1' }), // waits for p1's rest: 10:10
      singles('m3', 'p4', 'p5', { court: 'C1', durationMinutes: 30 }), // fits 09:40-10:10
    ];
    const { schedule } = scheduleMatches(ms, base);
    expect(byId(schedule, 'm2').start).toBe(localToUtc(DAY, '10:10'));
    expect(byId(schedule, 'm3').start).toBe(localToUtc(DAY, '09:40'));
    expect(findConflicts(schedule)).toEqual([]);
  });

  it('honours dependencies (final after both semi-finals, plus rest for the winners)', () => {
    const ms: SchedulableMatch[] = [
      { id: 'F', sideA: [], sideB: [], durationMinutes: 50, dependsOn: ['SF1', 'SF2'], label: 'MS Final' },
      singles('SF1', 'p1', 'p2'),
      singles('SF2', 'p3', 'p4', { durationMinutes: 60 }),
    ];
    const { schedule, unplaced } = scheduleMatches(ms, base);
    expect(unplaced).toEqual([]);
    expect(byId(schedule, 'F').start).toBe(localToUtc(DAY, '10:30')); // SF2 ends 10:00 + 30 rest
    expect(byId(schedule, 'F').label).toBe('MS Final');
    expect(schedule.matches.map((m) => m.matchId)).toEqual(['SF1', 'SF2', 'F']);
  });

  it('can drop the feeder rest when configured', () => {
    const ms: SchedulableMatch[] = [singles('SF1', 'p1', 'p2'), { id: 'F', sideA: [], sideB: [], durationMinutes: 50, dependsOn: ['SF1'] }];
    const { schedule } = scheduleMatches(ms, { ...base, restAfterFeeders: false });
    expect(byId(schedule, 'F').start).toBe(localToUtc(DAY, '09:40'));
  });

  it('respects earliest start and fixed court', () => {
    const ms = [singles('m1', 'p1', 'p2', { court: 'C2', earliestStart: '2026-11-07T06:00:00+05:30' })];
    const { schedule } = scheduleMatches(ms, { ...base, windows: [{ date: DAY, start: '05:00', end: '18:00' }] });
    expect(byId(schedule, 'm1')).toMatchObject({ court: 'C2', start: '2026-11-07T00:30:00.000Z' });
  });

  it('moves to the next day window when the first is full and never crosses a window end', () => {
    const settings: ScheduleSettings = {
      courts: ['C1'],
      windows: [
        { date: '2026-11-08', start: '09:00', end: '12:00' },
        { date: DAY, start: '17:00', end: '18:00' },
      ],
    };
    const { schedule } = scheduleMatches([singles('m1', 'p1', 'p2'), singles('m2', 'p3', 'p4')], settings);
    expect(byId(schedule, 'm1').start).toBe(localToUtc(DAY, '17:00'));
    expect(byId(schedule, 'm2').start).toBe(localToUtc('2026-11-08', '09:00')); // 17:40 + 40 would pass 18:00
  });

  it('uses the given venue time zone', () => {
    const { schedule } = scheduleMatches([singles('m1', 'p1', 'p2')], { ...base, timeZone: 'Asia/Singapore' });
    expect(byId(schedule, 'm1').start).toBe('2026-11-07T01:00:00.000Z');
  });

  it('reports what it cannot place, with reasons, and the matches that depend on it', () => {
    const ms: SchedulableMatch[] = [
      singles('long', 'p1', 'p2', { durationMinutes: 600 }),
      { id: 'next', sideA: [], sideB: [], durationMinutes: 40, dependsOn: ['long'] },
      singles('badCourt', 'p3', 'p4', { court: 'C9' }),
      singles('ghostDep', 'p5', 'p6', { dependsOn: ['nope'] }),
      singles('self', 'p7', 'p8', { dependsOn: ['self'] }),
      singles('loopA', 'p9', 'p10', { dependsOn: ['loopB'] }),
      singles('loopB', 'p11', 'p12', { dependsOn: ['loopA'] }),
      { id: 'twice', sideA: ['p13'], sideB: ['p13'], durationMinutes: 40 },
      singles('ok', 'p14', 'p15'),
    ];
    const { schedule, unplaced } = scheduleMatches(ms, base);
    expect(schedule.matches.map((m) => m.matchId)).toEqual(['ok']);
    const reasons = Object.fromEntries(unplaced.map((u) => [u.matchId, u.reason]));
    expect(Object.keys(reasons).sort()).toEqual(['badCourt', 'ghostDep', 'long', 'loopA', 'loopB', 'next', 'self', 'twice']);
    expect(reasons.long).toMatch(/No court and time/);
    expect(reasons.next).toMatch(/depends on match long, which could not be placed/);
    expect(reasons.badCourt).toMatch(/Court C9 is not in the court list/);
    expect(reasons.ghostDep).toMatch(/match nope, which is not in the list/);
    expect(reasons.self).toMatch(/depends on itself/);
    expect(reasons.loopA).toMatch(/loop/);
    expect(reasons.twice).toMatch(/Player p13 appears twice/);
  });

  it('reports every match when there are no windows', () => {
    const { unplaced } = scheduleMatches([singles('m1', 'p1', 'p2')], { ...base, windows: [] });
    expect(unplaced).toEqual([{ matchId: 'm1', reason: 'There are no day windows.' }]);
  });

  it('refuses structurally invalid input', () => {
    expect(() => scheduleMatches([singles('m1', 'p1', 'p2'), singles('m1', 'p3', 'p4')], base)).toThrow(/Duplicate match id/);
    expect(() => scheduleMatches([singles('m1', 'p1', 'p2', { durationMinutes: 0 })], base)).toThrow(RangeError);
    expect(() => scheduleMatches([singles('m1', 'p1', 'p2', { durationMinutes: 12.5 })], base)).toThrow(RangeError);
    expect(() => scheduleMatches([singles('m1', 'p1', 'p2', { earliestStart: '2026-11-07 10:00' })], base)).toThrow(RangeError);
    expect(() => scheduleMatches([], { ...base, courts: [] })).toThrow(/court/);
    expect(() => scheduleMatches([], { ...base, courts: ['C1', 'C1'] })).toThrow(/unique/);
    expect(() => scheduleMatches([], { ...base, restMinutes: -5 })).toThrow(/restMinutes/);
    expect(() => scheduleMatches([], { ...base, windows: [{ date: DAY, start: '18:00', end: '09:00' }] })).toThrow(/end after/);
    expect(() => scheduleMatches([], { ...base, timeZone: 'Nowhere/Town' })).toThrow(/Unknown time zone/);
  });

  it('does not change its input', () => {
    const ms: SchedulableMatch[] = [singles('m1', 'p1', 'p2'), singles('m2', 'p1', 'p3', { dependsOn: ['m1'], court: 'C2' })];
    const settings: ScheduleSettings = { ...base, restMinutes: 10 };
    const msCopy = structuredClone(ms);
    const settingsCopy = structuredClone(settings);
    expect(() => scheduleMatches(Object.freeze(ms.map((m) => Object.freeze(m))), Object.freeze(settings))).not.toThrow();
    expect(ms).toEqual(msCopy);
    expect(settings).toEqual(settingsCopy);
  });
});

describe('findConflicts', () => {
  const settings = { courts: ['C1', 'C2'], windows: [{ date: DAY, start: '09:00', end: '18:00' }], timeZone: 'Asia/Kolkata', restMinutes: 30, restAfterFeeders: true };
  const at = (id: string, court: string, start: string, minutes: number, sideA: string[], sideB: string[], dependsOn: string[] = []) => {
    const s = Date.parse(localToUtc(DAY, start));
    return {
      matchId: id,
      label: id,
      court,
      start: new Date(s).toISOString(),
      end: new Date(s + minutes * 60_000).toISOString(),
      durationMinutes: minutes,
      sideA,
      sideB,
      dependsOn,
    };
  };

  it('finds a doubles partner playing two events at once, in plain English with local times', () => {
    const schedule: Schedule = {
      settings,
      matches: [at('MD1', 'C1', '10:00', 45, ['p1', 'p2'], ['p3', 'p4']), at('XD1', 'C2', '10:30', 45, ['p2', 'p5'], ['p6', 'p7'])],
    };
    const conflicts = findConflicts(schedule);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'player-overlap', matchIds: ['MD1', 'XD1'], playerIds: ['p2'], court: null });
    expect(conflicts[0]?.message).toBe(
      'Player p2 is in two matches at the same time: MD1 (court C1, 2026-11-07 10:00-10:45) and XD1 (court C2, 2026-11-07 10:30-11:15).',
    );
  });

  it('lists all shared players of a pair once per match pair', () => {
    const schedule: Schedule = {
      settings,
      matches: [at('MD1', 'C1', '10:00', 45, ['p1', 'p2'], ['p3', 'p4']), at('MD2', 'C2', '10:00', 45, ['p2', 'p1'], ['p8', 'p9'])],
    };
    const [c] = findConflicts(schedule);
    expect(c).toMatchObject({ kind: 'player-overlap', playerIds: ['p1', 'p2'] });
    expect(c?.message).toMatch(/^Players p1, p2 are in two matches/);
  });

  it('finds court double bookings, rest violations, windows, dependency order and unknown courts', () => {
    const schedule: Schedule = {
      settings,
      matches: [
        at('a', 'C1', '09:00', 40, ['p1'], ['p2']),
        at('b', 'C1', '09:20', 40, ['p3'], ['p4']), // court C1 overlaps a
        at('c', 'C2', '09:50', 40, ['p1'], ['p5']), // p1: 10 minutes after a
        at('d', 'C2', '17:40', 40, ['p6'], ['p7']), // runs past 18:00
        at('e', 'C2', '10:40', 30, [], [], ['b']), // starts 10:40 after b (ends 10:00): 40 min fine
        at('f', 'C2', '09:30', 20, [], [], ['a']), // starts before a ends? a ends 09:40: yes
        at('g', 'C9', '12:00', 30, ['p8'], ['p9']),
        at('h', 'C1', '12:00', 30, [], [], ['g']), // overlaps feeder g
      ],
    };
    const conflicts = findConflicts(schedule);
    const kinds = conflicts.map((c) => `${c.kind}:${c.matchIds.join('+')}`);
    expect(kinds).toEqual([
      'court-double-booking:a+b',
      'rest-violation:a+c',
      'dependency-order:a+f',
      'dependency-order:g+h',
      'outside-window:d',
      'unknown-court:g',
    ]);
    const rest = conflicts.find((c) => c.kind === 'rest-violation');
    expect(rest?.message).toBe('Player p1 is given 10 minutes of rest between a (court C1, 2026-11-07 09:00-09:40) and c (court C2, 2026-11-07 09:50-10:30); the minimum is 30.');
    expect(conflicts.find((c) => c.kind === 'outside-window')?.message).toMatch(/outside the playing hours/);
  });

  it('flags too little rest after a feeder for the still-unknown winner', () => {
    const schedule: Schedule = { settings, matches: [at('SF', 'C1', '09:00', 40, ['p1'], ['p2']), at('F', 'C1', '09:50', 40, [], [], ['SF'])] };
    const [c] = findConflicts(schedule);
    expect(c).toMatchObject({ kind: 'rest-violation', matchIds: ['F', 'SF'], playerIds: [] });
    expect(c?.message).toMatch(/winner of SF .* gets 10 minutes of rest/);
    expect(findConflicts({ settings: { ...settings, restAfterFeeders: false }, matches: schedule.matches })).toEqual([]);
  });

  it('back-to-back on one court is not a conflict; rest exactly at the minimum is fine', () => {
    const schedule: Schedule = {
      settings,
      matches: [at('a', 'C1', '09:00', 40, ['p1'], ['p2']), at('b', 'C1', '09:40', 40, ['p3'], ['p4']), at('c', 'C2', '10:10', 40, ['p1'], ['p5'])],
    };
    expect(findConflicts(schedule)).toEqual([]);
  });

  it('refuses a schedule with a duplicate match id', () => {
    const m = at('a', 'C1', '09:00', 40, ['p1'], ['p2']);
    expect(() => findConflicts({ settings, matches: [m, m] })).toThrow(/Duplicate/);
  });

  it('refuses a match that ends at or before its start, or whose length is not its duration', () => {
    // x 05:00-04:00Z would hide its overlap with y (04:30-05:10Z, also p1) if it were accepted.
    const x = { ...at('x', 'C1', '10:30', 60, ['p1'], ['p2']), start: '2026-11-07T05:00:00.000Z', end: '2026-11-07T04:00:00.000Z' };
    const y = { ...at('y', 'C2', '10:00', 40, ['p1'], ['p3']), start: '2026-11-07T04:30:00.000Z', end: '2026-11-07T05:10:00.000Z' };
    expect(() => findConflicts({ settings, matches: [x, y] })).toThrow(/end after it starts/);
    const zero = { ...at('z', 'C1', '10:00', 40, ['p1'], ['p2']), end: localToUtc(DAY, '10:00') };
    expect(() => findConflicts({ settings, matches: [zero] })).toThrow(/end after it starts/);
    const wrongLength = { ...at('w', 'C1', '10:00', 40, ['p1'], ['p2']), end: localToUtc(DAY, '11:00') };
    expect(() => findConflicts({ settings, matches: [wrongLength] })).toThrow(/start plus durationMinutes/);
    const impossible = { ...at('i', 'C1', '10:00', 40, ['p1'], ['p2']), start: '2026-02-30T10:00:00Z' };
    expect(() => findConflicts({ settings, matches: [impossible] })).toThrow(/not a real instant/);
  });

  it('checks the settings of a hand-built schedule', () => {
    const m = [at('a', 'C1', '09:00', 40, ['p1'], ['p2'])];
    expect(() => findConflicts({ settings: { ...settings, restMinutes: -1 }, matches: m })).toThrow(/restMinutes/);
    expect(() => findConflicts({ settings: { ...settings, courts: [] }, matches: m })).toThrow(/court/);
    expect(() => findConflicts({ settings: { ...settings, courts: ['C1', 'C1'] }, matches: m })).toThrow(/unique/);
    expect(() => findConflicts({ settings: { ...settings, timeZone: 'Nowhere/Town' }, matches: m })).toThrow(/Unknown time zone/);
    expect(() => findConflicts({ settings: { ...settings, windows: [{ date: '2026-02-30', start: '09:00', end: '18:00' }] }, matches: m })).toThrow(RangeError);
  });

  it('does not change a frozen schedule', () => {
    const schedule: Schedule = {
      settings: { ...settings, courts: [...settings.courts], windows: settings.windows.map((w) => ({ ...w })) },
      matches: [at('a', 'C1', '09:00', 40, ['p1'], ['p2']), at('b', 'C1', '09:20', 40, ['p1'], ['p4'])],
    };
    const copy = structuredClone(schedule);
    const frozen = Object.freeze({ settings: Object.freeze(schedule.settings), matches: Object.freeze(schedule.matches.map((m) => Object.freeze(m))) });
    expect(findConflicts(frozen).length).toBeGreaterThan(0);
    expect(schedule).toEqual(copy);
  });
});

describe('reschedule', () => {
  const ms = [
    { id: 'MD1', sideA: ['p1', 'p2'], sideB: ['p3', 'p4'], durationMinutes: 45 },
    { id: 'XD1', sideA: ['p2', 'p5'], sideB: ['p6', 'p7'], durationMinutes: 45 },
    singles('MS1', 'p8', 'p9'),
  ];
  const { schedule } = scheduleMatches(ms, base);

  it('applies a clean move and reports no conflicts', () => {
    const r = reschedule(schedule, 'MS1', localToUtc(DAY, '15:00'), 'C2');
    expect(r.applied).toBe(true);
    expect(r.created).toEqual([]);
    expect(byId(r.schedule, 'MS1')).toMatchObject({ court: 'C2', start: '2026-11-07T09:30:00.000Z', end: '2026-11-07T10:10:00.000Z' });
    expect(byId(schedule, 'MS1').start).toBe(localToUtc(DAY, '09:00')); // original untouched
  });

  it('never silently accepts a conflict: it reports what the move creates', () => {
    const start = byId(schedule, 'MD1').start;
    const r = reschedule(schedule, 'XD1', start, byId(schedule, 'MD1').court);
    expect(r.applied).toBe(true);
    expect(r.created.map((c) => c.kind).sort()).toEqual(['court-double-booking', 'player-overlap']);
    expect(r.created.find((c) => c.kind === 'player-overlap')?.playerIds).toEqual(['p2']);
    expect(r.all).toEqual(findConflicts(r.schedule));
  });

  it("'refuse' mode keeps the old schedule and still says why", () => {
    const r = reschedule(schedule, 'XD1', byId(schedule, 'MD1').start, undefined, { mode: 'refuse' });
    expect(r.applied).toBe(false);
    expect(r.schedule).toBe(schedule);
    expect(r.created.length).toBeGreaterThan(0);
    expect(r.all).toEqual(findConflicts(schedule));
  });

  it('only counts new conflicts as created', () => {
    const bad = reschedule(schedule, 'XD1', byId(schedule, 'MD1').start).schedule; // already conflicting
    const r = reschedule(bad, 'MS1', localToUtc(DAY, '16:00'));
    expect(r.created).toEqual([]);
    expect(r.all.length).toBeGreaterThan(0);
  });

  it('flags a move outside the playing hours and keeps the court when none is given', () => {
    const r = reschedule(schedule, 'MS1', localToUtc(DAY, '17:45'));
    expect(r.created.map((c) => c.kind)).toEqual(['outside-window']);
    expect(byId(r.schedule, 'MS1').court).toBe(byId(schedule, 'MS1').court);
  });

  it('refuses an unknown match or a bad instant', () => {
    expect(() => reschedule(schedule, 'nope', localToUtc(DAY, '10:00'))).toThrow(/not in the schedule/);
    expect(() => reschedule(schedule, 'MS1', '2026-11-07T10:00')).toThrow(RangeError);
    expect(() => reschedule(schedule, 'MS1', '2026-02-30T10:00:00Z')).toThrow(/not a real instant/);
    expect(() => reschedule(schedule, 'MS1', '2026-11-07T25:00:00Z')).toThrow(/not a real instant/);
    expect(() => reschedule(schedule, 'MS1', localToUtc(DAY, '10:00'), '')).toThrow(/newCourt/);
  });

  it('counts a conflict the move makes worse as created, and refuse mode keeps the old schedule', () => {
    // MS1 already runs 10 minutes past the end of play; moving it to 23:00 is worse, not "no new conflict".
    const late = reschedule(schedule, 'MS1', localToUtc(DAY, '17:30')).schedule;
    expect(findConflicts(late).map((c) => c.kind)).toEqual(['outside-window']);
    const r = reschedule(late, 'MS1', localToUtc(DAY, '23:00'), undefined, { mode: 'refuse' });
    expect(r.applied).toBe(false);
    expect(r.schedule).toBe(late);
    expect(r.created.map((c) => c.kind)).toEqual(['outside-window']);
    expect(r.created[0]?.message).toMatch(/23:00-23:40/);
  });

  it('counts a rest violation that shrinks as created', () => {
    const settings = { ...schedule.settings, restMinutes: 30 };
    const s0: Schedule = { settings, matches: schedule.matches };
    // MS1 (p8, p9) on C2 09:00-09:40; put a second p8 match 10 minutes after it, then move it to 0 minutes after.
    const extra = { ...byId(schedule, 'MS1'), matchId: 'MS2', label: 'MS2', sideA: ['p8'], sideB: ['p10'], court: 'C2', start: localToUtc(DAY, '15:00'), end: localToUtc(DAY, '15:40') };
    const withExtra: Schedule = { settings, matches: [...s0.matches, extra] };
    const ten = reschedule(withExtra, 'MS2', localToUtc(DAY, '09:50'));
    expect(ten.created.map((c) => c.kind)).toEqual(['rest-violation']);
    const zero = reschedule(ten.schedule, 'MS2', localToUtc(DAY, '09:40'), undefined, { mode: 'refuse' });
    expect(zero.applied).toBe(false);
    expect(zero.created.map((c) => c.kind)).toEqual(['rest-violation']);
    expect(zero.created[0]?.message).toMatch(/given 0 minutes of rest/);
  });

  it('does not change the schedule or its settings', () => {
    const copy = structuredClone(schedule);
    reschedule(schedule, 'XD1', byId(schedule, 'MD1').start, 'C1');
    reschedule(schedule, 'XD1', byId(schedule, 'MD1').start, undefined, { mode: 'refuse' });
    expect(schedule).toEqual(copy);
    const frozen: Schedule = Object.freeze({
      settings: Object.freeze({ ...schedule.settings, courts: Object.freeze([...schedule.settings.courts]), windows: Object.freeze(schedule.settings.windows.map((w) => Object.freeze({ ...w }))) }),
      matches: Object.freeze(schedule.matches.map((m) => Object.freeze({ ...m }))),
    });
    const frozenCopy = structuredClone(frozen);
    const r = reschedule(frozen, 'MS1', localToUtc(DAY, '15:00'), 'C2');
    expect(r.applied).toBe(true);
    expect(r.schedule.settings).toEqual(frozen.settings);
    expect(frozen).toEqual(frozenCopy);
  });
});
