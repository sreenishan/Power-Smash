// Tests for the competition UI helpers (Module 15). Fictional players only (invented names). The clock is injected.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BYE_LABEL,
  LIVE_FRESHNESS_MS_DEFAULT,
  PROTECTED_LABEL,
  RANKING_LABEL,
  TBD_LABEL,
  bracketColumns,
  bracketMatchSummary,
  bracketRoundRank,
  courtText,
  displayGames,
  entryRows,
  eventLabel,
  formatDateIst,
  formatTimeIst,
  freshnessWindowText,
  gameAriaLabel,
  gamesText,
  gamesWon,
  isByeMatch,
  isLiveFresh,
  isProtectedPlayer,
  isRankingPublished,
  isWinner,
  isZonedInstant,
  istDateOf,
  outcomeNote,
  playerName,
  rankingRows,
  roundCodeForLines,
  roundLabel,
  scheduleRows,
  seedText,
  sideHasProtected,
  sideName,
  slotText,
  snapshotText,
  statusBadge,
  statusText,
  type BracketMatchView,
  type PlayerRef,
} from '../../src/components/competition/helpers';

const adult = (name: string): PlayerRef => ({ name, protected: false });
const junior = (name: string): PlayerRef => ({ name, protected: true });
const NOW = new Date('2026-10-30T10:00:00Z');
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();

describe('protected players (D-012, fail closed)', () => {
  it('shows a name only when protected is exactly false and the name is not blank', () => {
    expect(playerName(adult('Arun Vel'))).toBe('Arun Vel');
    expect(playerName({ name: '  Arun   Vel ', protected: false })).toBe('Arun Vel');
  });
  it('never shows the name of a protected, unflagged or nameless player', () => {
    expect(playerName(junior('Kavi Test'))).toBe(PROTECTED_LABEL);
    expect(playerName({ name: 'Kavi Test' })).toBe(PROTECTED_LABEL);
    expect(playerName({ name: 'Kavi Test', protected: null })).toBe(PROTECTED_LABEL);
    expect(playerName({ name: 'Kavi Test', protected: 'false' as unknown as boolean })).toBe(PROTECTED_LABEL);
    expect(playerName({ name: 'Kavi Test', protected: 0 as unknown as boolean })).toBe(PROTECTED_LABEL);
    expect(playerName({ name: '', protected: false })).toBe(PROTECTED_LABEL);
    expect(playerName({ name: null, protected: false })).toBe(PROTECTED_LABEL);
    expect(playerName(null)).toBe(PROTECTED_LABEL);
    expect(playerName(undefined)).toBe(PROTECTED_LABEL);
    expect(isProtectedPlayer(adult('Arun Vel'))).toBe(false);
  });
  it('a doubles pair hides only the protected partner, and flags the side', () => {
    const pair = [adult('Arun Vel'), junior('Kavi Test')];
    expect(sideName(pair)).toBe(`Arun Vel / ${PROTECTED_LABEL}`);
    expect(sideHasProtected(pair)).toBe(true);
    expect(sideHasProtected([adult('Arun Vel'), adult('Bala Fict')])).toBe(false);
    expect(sideName([])).toBe(TBD_LABEL);
    expect(sideHasProtected([])).toBe(true);
  });
  it('no helper output ever contains a protected name', () => {
    const secret = 'Zzprotected Name';
    const p = junior(secret);
    const outputs: unknown[] = [
      slotText({ kind: 'entry', players: [p], seed: 2 }),
      bracketMatchSummary({ id: 'F-1', a: { kind: 'entry', players: [p] }, b: { kind: 'entry', players: [adult('Arun Vel')] }, status: 'completed', winner: 'A', games: [{ a: 21, b: 10 }] }),
      scheduleRows([{ id: 's1', startsAt: '2026-11-02T04:00:00Z', court: 1, event: 'BS', round: 'QF', a: [p], b: [adult('Arun Vel')] }]),
      rankingRows([{ rank: 1, player: p, points: 100 }]),
      entryRows([{ id: 'e1', players: [p], club: 'Fictional Juniors Club', seed: 1 }]),
    ];
    const text = JSON.stringify(outputs);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('Zzprotected');
    expect(text).not.toContain('Fictional Juniors Club');
    expect(text).toContain(PROTECTED_LABEL);
  });
});

describe('slots and seeds', () => {
  it('bye, to-be-decided and entries', () => {
    expect(slotText({ kind: 'bye' })).toBe(BYE_LABEL);
    expect(slotText({ kind: 'tbd' })).toBe(TBD_LABEL);
    expect(slotText(null)).toBe(TBD_LABEL);
    expect(slotText({ kind: 'entry', players: [adult('Arun Vel')] })).toBe('Arun Vel');
  });
  it('seed text only for positive whole numbers', () => {
    expect(seedText(1)).toBe('[1]');
    expect(seedText(0)).toBe('');
    expect(seedText(-2)).toBe('');
    expect(seedText(1.5)).toBe('');
    expect(seedText(null)).toBe('');
    expect(seedText(undefined)).toBe('');
  });
});

describe('rounds', () => {
  it('maps the number of lines to a round code', () => {
    expect(roundCodeForLines(2)).toBe('F');
    expect(roundCodeForLines(4)).toBe('SF');
    expect(roundCodeForLines(8)).toBe('QF');
    expect(roundCodeForLines(16)).toBe('R16');
    expect(roundCodeForLines(128)).toBe('R128');
    expect(roundCodeForLines(3)).toBeNull();
    expect(roundCodeForLines(256)).toBeNull();
  });
  it('labels known rounds, keeps unknown codes, never invents', () => {
    expect(roundLabel('QF')).toBe('Quarter-final');
    expect(roundLabel('F')).toBe('Final');
    expect(roundLabel('3P')).toBe('Third place');
    expect(roundLabel('R16')).toBe('Round of 16');
    expect(roundLabel('X9')).toBe('X9');
    expect(roundLabel(null)).toBe('');
    expect(roundLabel(undefined)).toBe('');
  });
  it('labels events by category code, keeps free text', () => {
    expect(eventLabel('MS')).toBe("Men's singles");
    expect(eventLabel('XD')).toBe('Mixed doubles');
    expect(eventLabel('Open veterans')).toBe('Open veterans');
    expect(eventLabel(null)).toBe('');
  });
  it('orders bracket columns earliest first, third place after the final', () => {
    const order = ['F', '3P', 'SF', 'R32', 'QF', 'R16', 'R128', 'R64'].sort((x, y) => bracketRoundRank(x) - bracketRoundRank(y));
    expect(order).toEqual(['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', '3P']);
    expect(bracketRoundRank('group')).toBeGreaterThan(bracketRoundRank('3P'));
  });
});

describe('India time', () => {
  it('formats an instant in IST whatever the input zone', () => {
    expect(formatTimeIst('2026-11-02T04:00:00Z')).toBe('9:30 am IST');
    expect(formatTimeIst('2026-11-02T12:45:00Z')).toBe('6:15 pm IST');
    expect(formatTimeIst('2026-11-02T18:30:00Z')).toBe('12:00 am IST');
    expect(formatTimeIst('2026-11-02T09:30:00+05:30')).toBe('9:30 am IST');
    expect(formatTimeIst(new Date('2026-11-02T06:30:00Z'))).toBe('12:00 pm IST');
  });
  it('refuses bare dates, zone-less times and junk', () => {
    expect(formatTimeIst('2026-11-02')).toBeNull();
    expect(formatTimeIst('2026-11-02T09:30:00')).toBeNull();
    expect(formatTimeIst('soon')).toBeNull();
    expect(formatTimeIst(null)).toBeNull();
    expect(formatTimeIst(new Date('nope'))).toBeNull();
    expect(isZonedInstant('2026-11-02T09:30Z')).toBe(true);
    expect(isZonedInstant('2026-13-02T09:30:00Z')).toBe(false);
    expect(isZonedInstant(42)).toBe(false);
  });
  it('gives the India calendar date of an instant (UTC evening is the next IST day)', () => {
    expect(istDateOf('2026-11-02T19:00:00Z')).toBe('2026-11-03');
    expect(istDateOf('2026-11-02T18:29:00Z')).toBe('2026-11-02');
    expect(istDateOf('bad')).toBeNull();
    expect(formatDateIst('2026-11-02T19:00:00Z')).toBe('3 November 2026');
    expect(formatDateIst('2026-11-02')).toBe('2 November 2026');
    expect(formatDateIst('2026-02-30')).toBeNull();
    expect(formatDateIst(null)).toBeNull();
  });
});

describe('live freshness', () => {
  it('is live only with live=true, status live and a fresh update', () => {
    expect(isLiveFresh({ live: true, status: 'live', lastUpdate: minutesAgo(1), now: NOW })).toBe(true);
    expect(isLiveFresh({ live: true, lastUpdate: minutesAgo(4), now: NOW })).toBe(true);
  });
  it('edges of the window: exactly the window is live, one millisecond more is not', () => {
    const at = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
    expect(isLiveFresh({ live: true, lastUpdate: at(LIVE_FRESHNESS_MS_DEFAULT), now: NOW })).toBe(true);
    expect(isLiveFresh({ live: true, lastUpdate: at(LIVE_FRESHNESS_MS_DEFAULT + 1), now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, lastUpdate: at(90_000), now: NOW, freshnessMs: 60_000 })).toBe(false);
  });
  it('never live without the caller flag, a fresh instant, or with another status', () => {
    expect(isLiveFresh({ live: false, status: 'live', lastUpdate: minutesAgo(1), now: NOW })).toBe(false);
    expect(isLiveFresh({ status: 'live', lastUpdate: minutesAgo(1), now: NOW })).toBe(false);
    expect(isLiveFresh({ live: 'true' as unknown as boolean, lastUpdate: minutesAgo(1), now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, status: 'live', lastUpdate: null, now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, status: 'live', lastUpdate: '2026-10-30', now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, status: 'live', lastUpdate: '2026-10-30T09:59:00', now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, status: 'completed', lastUpdate: minutesAgo(1), now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, status: 'paused', lastUpdate: minutesAgo(1), now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, status: 'live', lastUpdate: minutesAgo(30), now: NOW })).toBe(false);
  });
  it('a future update beyond the clock-skew allowance, a bad clock or a bad window is not live', () => {
    expect(isLiveFresh({ live: true, lastUpdate: minutesAgo(-0.5), now: NOW })).toBe(true);
    expect(isLiveFresh({ live: true, lastUpdate: minutesAgo(-5), now: NOW })).toBe(false);
    expect(isLiveFresh({ live: true, lastUpdate: minutesAgo(1), now: new Date('x') })).toBe(false);
    expect(isLiveFresh({ live: true, lastUpdate: minutesAgo(1), now: NOW, freshnessMs: 0 })).toBe(false);
    expect(isLiveFresh({ live: true, lastUpdate: minutesAgo(1), now: NOW, freshnessMs: Number.NaN })).toBe(false);
  });
  it('states the window in words', () => {
    expect(freshnessWindowText()).toBe('5 minutes');
    expect(freshnessWindowText(60_000)).toBe('1 minute');
    expect(freshnessWindowText(30_000)).toBe('30 seconds');
    expect(freshnessWindowText(1_000)).toBe('1 second');
  });
});

describe('status badge (text, never colour alone)', () => {
  it('"Live" only when fresh', () => {
    expect(statusBadge({ live: true, status: 'live', lastUpdate: minutesAgo(1), now: NOW })).toEqual({ text: 'Live', tone: 'live', isLive: true, stale: false });
  });
  it('a stale live match reads "In progress" and is flagged stale', () => {
    const b = statusBadge({ live: true, status: 'live', lastUpdate: minutesAgo(20), now: NOW });
    expect(b.text).toBe('In progress');
    expect(b.isLive).toBe(false);
    expect(b.stale).toBe(true);
    expect(b.tone).toBe('neutral');
  });
  it('other statuses have words and no live label', () => {
    expect(statusBadge({ status: 'completed', now: NOW })).toMatchObject({ text: 'Completed', tone: 'court', isLive: false, stale: false });
    expect(statusBadge({ status: 'walkover', now: NOW })).toMatchObject({ text: 'Walkover', tone: 'ink' });
    expect(statusBadge({ status: 'retired', now: NOW })).toMatchObject({ text: 'Retired', tone: 'ink' });
    expect(statusBadge({ status: 'scheduled', live: true, lastUpdate: minutesAgo(1), now: NOW })).toMatchObject({ text: 'Scheduled', isLive: false, stale: false });
    expect(statusBadge({ status: 'postponed', now: NOW }).text).toBe('Postponed');
  });
  it('status words cover every status and an unknown one', () => {
    expect(statusText('ready')).toBe('Ready to start');
    expect(statusText('cancelled')).toBe('Cancelled');
    expect(statusText('toString')).toBe('Status unknown');
    expect(statusText('weird')).toBe('Status unknown');
    expect(statusText(null)).toBe('Status unknown');
  });
  it('outcome notes', () => {
    expect(outcomeNote('walkover')).toBe('Walkover');
    expect(outcomeNote('retired')).toBe('Retired');
    expect(outcomeNote('abandoned')).toBe('Abandoned');
    expect(outcomeNote('completed')).toBe('');
    expect(outcomeNote(null)).toBe('');
  });
});

describe('scores', () => {
  const games = [{ a: 21, b: 15 }, { a: 18, b: 21 }, { a: 21, b: 19 }];
  it('writes games side A first and counts games won', () => {
    expect(gamesText(games)).toBe('21-15, 18-21, 21-19');
    expect(gamesWon(games)).toEqual({ a: 2, b: 1 });
    expect(gameAriaLabel(1, games[1]!)).toBe('Game 2: 18 to 21');
  });
  it('drops unreadable games', () => {
    const bad = [{ a: -1, b: 21 }, { a: 21.5, b: 3 }, { a: 100, b: 2 }, { a: 30, b: 29 }, null as unknown as { a: number; b: number }];
    expect(displayGames(bad)).toEqual([{ a: 30, b: 29 }]);
    expect(gamesText(null)).toBe('');
    expect(gamesWon([{ a: 10, b: 10 }])).toEqual({ a: 0, b: 0 });
  });
  it('a winner is highlighted only for a decided status', () => {
    expect(isWinner('A', 'A', 'completed')).toBe(true);
    expect(isWinner('B', 'A', 'completed')).toBe(false);
    expect(isWinner('B', 'B', 'walkover')).toBe(true);
    expect(isWinner('A', 'A', 'retired')).toBe(true);
    expect(isWinner('A', 'A', 'live')).toBe(false);
    expect(isWinner('A', 'A', 'abandoned')).toBe(false);
    expect(isWinner('A', null, 'completed')).toBe(false);
  });
});

describe('bracket', () => {
  const e = (name: string, seed?: number) => ({ kind: 'entry' as const, players: [adult(name)], seed });
  it('orders columns left to right, labels them and drops empty rounds', () => {
    const cols = bracketColumns([
      { code: 'F', matches: [{ id: 'F-1', a: { kind: 'tbd' }, b: { kind: 'tbd' } }] },
      { code: '3P', matches: [{ id: '3P-1', a: { kind: 'tbd' }, b: { kind: 'tbd' } }] },
      { code: 'QF', matches: [] },
      { code: 'SF', matches: [{ id: 'SF-1', a: e('Arun Vel', 1), b: e('Bala Fict') }] },
    ]);
    expect(cols.map((c) => c.code)).toEqual(['SF', 'F', '3P']);
    expect(cols.map((c) => c.label)).toEqual(['Semi-final', 'Final', 'Third place']);
    expect(bracketColumns(null)).toEqual([]);
  });
  it('a bye advances without a match', () => {
    const m: BracketMatchView = { id: 'R16-1', a: e('Arun Vel', 1), b: { kind: 'bye' } };
    expect(isByeMatch(m)).toBe(true);
    expect(bracketMatchSummary(m)).toBe('[1] Arun Vel advances without a match (bye)');
    expect(bracketMatchSummary({ id: 'R16-2', a: { kind: 'bye' }, b: e('Bala Fict') })).toBe('Bala Fict advances without a match (bye)');
    expect(bracketMatchSummary({ id: 'R16-3', a: { kind: 'bye' }, b: { kind: 'bye' } })).toBe('No match (both lines empty)');
  });
  it('summaries name the winner in words, with walkover or retired written out', () => {
    expect(bracketMatchSummary({ id: 'F-1', a: e('Arun Vel', 1), b: e('Bala Fict', 2), status: 'completed', winner: 'B', games: [{ a: 19, b: 21 }, { a: 17, b: 21 }] })).toBe(
      '[1] Arun Vel versus [2] Bala Fict, winner [2] Bala Fict, score 19-21, 17-21',
    );
    expect(bracketMatchSummary({ id: 'SF-1', a: e('Arun Vel'), b: e('Bala Fict'), status: 'walkover', winner: 'A' })).toBe('Arun Vel versus Bala Fict, winner Arun Vel, walkover');
    expect(bracketMatchSummary({ id: 'SF-2', a: e('Arun Vel'), b: e('Bala Fict'), status: 'retired', winner: 'B', games: [{ a: 11, b: 6 }] })).toBe(
      'Arun Vel versus Bala Fict, winner Bala Fict, retired, score 11-6',
    );
    expect(bracketMatchSummary({ id: 'QF-1', a: e('Arun Vel'), b: { kind: 'tbd' } })).toBe(`Arun Vel versus ${TBD_LABEL}, scheduled`);
    expect(bracketMatchSummary({ id: 'QF-2', a: e('Arun Vel'), b: e('Bala Fict'), status: 'live', winner: 'A' })).toBe('Arun Vel versus Bala Fict, in progress');
  });
});

describe('schedule', () => {
  const p = [adult('Arun Vel')];
  const q = [adult('Bala Fict')];
  it('formats court numbers and keeps court names', () => {
    expect(courtText(3)).toBe('Court 3');
    expect(courtText('4')).toBe('Court 4');
    expect(courtText('Centre court')).toBe('Centre court');
    expect(courtText('')).toBe('Court to be confirmed');
    expect(courtText(null)).toBe('Court to be confirmed');
  });
  it('sorts by India date, then time, unknown times last in their day, then court', () => {
    const rows = scheduleRows([
      { id: 'late-utc', startsAt: '2026-11-02T19:00:00Z', court: 1, a: p, b: q }, // 3 Nov 00:30 IST
      { id: 'no-time', date: '2026-11-02', court: 2, a: p, b: q },
      { id: 'c2', startsAt: '2026-11-02T04:00:00Z', court: 2, event: 'MS', round: 'QF', a: p, b: q, status: 'scheduled' },
      { id: 'c10', startsAt: '2026-11-02T04:00:00Z', court: 10, a: p, b: q },
      { id: 'early', startsAt: '2026-11-02T03:00:00Z', court: 5, a: p, b: q },
      { id: 'nothing', a: p, b: q },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['early', 'c2', 'c10', 'no-time', 'late-utc', 'nothing']);
    const c2 = rows[1]!;
    expect(c2).toMatchObject({ dateText: '2 November 2026', timeText: '9:30 am IST', courtText: 'Court 2', eventText: "Men's singles", roundText: 'Quarter-final', sideA: 'Arun Vel', sideB: 'Bala Fict', statusText: 'Scheduled' });
    expect(rows[3]!.timeText).toBe('Time to be confirmed');
    expect(rows[4]!).toMatchObject({ dateIso: '2026-11-03', timeText: '12:30 am IST' });
    expect(rows[5]!).toMatchObject({ dateText: 'Date to be confirmed', timeText: 'Time to be confirmed', courtText: 'Court to be confirmed', eventText: '', roundText: '', statusText: '' });
  });
  it('a zone-less start time is not guessed', () => {
    const [r] = scheduleRows([{ id: 'x', startsAt: '2026-11-02T09:30:00', date: '2026-11-02', a: p, b: q }]);
    expect(r).toMatchObject({ dateText: '2 November 2026', timeText: 'Time to be confirmed' });
  });
  it('empty input gives no rows', () => {
    expect(scheduleRows([])).toEqual([]);
    expect(scheduleRows(undefined)).toEqual([]);
  });
});

describe('ranking (local, unofficial, owner approval)', () => {
  it('the label says local and not an official BWF ranking', () => {
    expect(RANKING_LABEL).toBe('Local Power Smash ranking, not an official BWF ranking');
  });
  it('needs a real snapshot date', () => {
    expect(snapshotText('2026-10-30')).toBe('Snapshot: 30 October 2026');
    expect(() => snapshotText('')).toThrow(RangeError);
    expect(() => snapshotText('2026-02-30')).toThrow(RangeError);
    expect(() => snapshotText('30/10/2026')).toThrow(RangeError);
  });
  it('only exactly true publishes', () => {
    expect(isRankingPublished(true)).toBe(true);
    expect(isRankingPublished(undefined)).toBe(false);
    expect(isRankingPublished('true')).toBe(false);
    expect(isRankingPublished(1)).toBe(false);
  });
  it('orders by rank, marks ties, drops bad ranks, hides protected names', () => {
    const rows = rankingRows([
      { rank: 3, player: adult('Chitra Fict'), points: 40, played: 4 },
      { rank: 1, player: adult('Arun Vel'), points: 90 },
      { rank: 2, player: junior('Kavi Test'), points: 60 },
      { rank: 2, player: adult('Bala Fict'), points: 60 },
      { rank: 0, player: adult('Dev Fict'), points: 1 },
      { rank: 1.5, player: adult('Eli Fict'), points: 1 },
    ]);
    expect(rows.map((r) => [r.rankText, r.name])).toEqual([
      ['1', 'Arun Vel'],
      ['=2', PROTECTED_LABEL],
      ['=2', 'Bala Fict'],
      ['3', 'Chitra Fict'],
    ]);
    expect(rows[1]!.tied).toBe(true);
    expect(rows[0]!.played).toBe('–');
    expect(rows[3]!.played).toBe('4');
    expect(rankingRows(null)).toEqual([]);
  });
});

describe('entry list', () => {
  it('seeds first, then caller order (not by name), withdrawn last; protected clubs hidden', () => {
    const rows = entryRows([
      { id: 'z', players: [adult('Zara Fict')], club: 'Fictional Club A' },
      { id: 'a', players: [adult('Anu Fict')], club: '  ' },
      { id: 's2', players: [adult('Mani Fict')], seed: 2, status: 'confirmed' },
      { id: 'w', players: [adult('Wil Fict')], seed: 1, status: 'withdrawn' },
      { id: 's1', players: [adult('Raja Fict'), junior('Kavi Test')], seed: 1, club: 'Fictional Club B' },
      { id: 'bad-seed', players: [adult('Bad Seed')], seed: 0, status: 'waitlist' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2', 'z', 'a', 'bad-seed', 'w']);
    expect(rows[0]).toMatchObject({ seedText: '[1]', name: `Raja Fict / ${PROTECTED_LABEL}`, club: '' });
    expect(rows[2]).toMatchObject({ club: 'Fictional Club A', statusText: '' });
    expect(rows[3]!.club).toBe('');
    expect(rows[4]).toMatchObject({ seedText: '', statusText: 'Waiting list' });
    expect(rows[5]).toMatchObject({ statusText: 'Withdrawn', withdrawn: true });
    expect(entryRows(undefined)).toEqual([]);
  });
});

describe('component sources (markup only, safe)', () => {
  const dir = join(__dirname, '../../src/components/competition');
  const astro = readdirSync(dir).filter((f) => f.endsWith('.astro'));
  it('has the five building blocks', () => {
    for (const name of ['BracketView', 'ScheduleTable', 'MatchScoreboard', 'RankingTable', 'EntryList']) expect(astro).toContain(`${name}.astro`);
  });
  it.each(astro)('%s has no client script, no raw HTML, no clock or randomness, no owner placeholder', (file) => {
    const src = readFileSync(join(dir, file), 'utf8');
    expect(src).not.toMatch(/<script/);
    expect(src).not.toMatch(/set:html|dangerouslySetInnerHTML/);
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)/);
    expect(src).not.toContain('TODO(owner)');
  });
  it('tables have captions and header cells', () => {
    for (const file of ['ScheduleTable.astro', 'MatchScoreboard.astro', 'RankingTable.astro', 'EntryList.astro']) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).toMatch(/<caption/);
      expect(src, file).toMatch(/<th scope="col"/);
    }
  });
  it('the ranking table always renders the unofficial label and the snapshot', () => {
    const src = readFileSync(join(dir, 'RankingTable.astro'), 'utf8');
    expect(src).toMatch(/data-ranking-label>\{RANKING_LABEL\}/);
    expect(src).toMatch(/\{snapshot\}/);
  });
  it('helpers.ts has no clock or randomness', () => {
    const src = readFileSync(join(dir, 'helpers.ts'), 'utf8');
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)/);
  });
});
