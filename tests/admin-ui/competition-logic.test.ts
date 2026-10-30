// The competition admin screens' pure logic (src/admin/screens/competition/logic.ts): the sub-route, plain-English words, live result
// checks, India-time helpers, the points-table form, and the draw preview, where the PUBLIC view never names a protected player (D-012,
// D-109). Runs on the memory store's fictional seed. Fictional data only.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryAdminStore, SEED } from '../../src/lib/admin/memory-store';
import { COMP_SEED } from '../../src/lib/admin/competition/memory-backend';
import type { CompetitionEventDetail } from '../../src/lib/admin/competition/types';
import type { StoreResult } from '../../src/lib/admin/types';
import { DEFAULT_RULESET } from '../../src/lib/competition/scoring';
import { slotText } from '../../src/components/competition/helpers';
import {
  COMP_LIMITS,
  compHash,
  draftFromMatch,
  emptyResultDraft,
  eventTitle,
  failureText,
  fieldErrors,
  groupPreview,
  isJuniorEvent,
  knockoutPreview,
  liveResultCheck,
  matchSides,
  outcomeSentence,
  includedIds,
  parseCompHash,
  parseDrawNumber,
  parseInRange,
  parseWhole,
  pointsDraftFrom,
  pointsDraftToRecord,
  presetKeyFor,
  PROTECTED_LABEL,
  protectedRankingRows,
  confirmResultNotice,
  syncOutcomeLines,
  syncOutcomeNotice,
  UPDATE_MATCHES_LABEL,
  rankingRowProtected,
  publicEntryName,
  reasonProblem,
  RULESET_PRESETS,
  rulesetWords,
  toggleLeftOut,
  whenText,
  windowsProblems,
  type CompView,
  type ResultDraft,
} from '../../src/admin/screens/competition/logic';
import { istInstant, splitIst } from '../../src/lib/dates';
import { rulesetProblems } from '../../src/lib/admin/competition/validate';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
const R = 'demo reason';

function store() {
  let n = 0;
  return new MemoryAdminStore({ now: () => NOW, newId: () => `90000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, randomSeed: () => 12345 });
}
function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code} ${JSON.stringify(r.errors ?? {})}`);
  return r.data;
}
const eventOf = async (s: MemoryAdminStore, eventId: string): Promise<CompetitionEventDetail> => ok(await s.competitionEvent({ eventId }, ACTOR));
const draft = (status: ResultDraft['status'], games: [string, string][], extra: Partial<ResultDraft> = {}): ResultDraft => ({ ...emptyResultDraft(), status, games: games.map(([a, b]) => ({ a, b })), ...extra });

describe('sub-routes inside #/competitions', () => {
  it('round-trips every view and falls back to the home view for anything unreadable', () => {
    const views: CompView[] = [
      { view: 'home' },
      { view: 'rankings' },
      { view: 'event', eventId: COMP_SEED.eventMs, tab: 'draw' },
      { view: 'event', eventId: COMP_SEED.eventWs, tab: 'matches' },
      { view: 'newEvent', tournamentId: SEED.t1 },
      { view: 'editEvent', eventId: COMP_SEED.eventMs },
      { view: 'tournament', tournamentId: SEED.t1 },
    ];
    for (const v of views) expect(parseCompHash(compHash(v))).toEqual(v);
    expect(parseCompHash('#/competitions/event/abc')).toEqual({ view: 'event', eventId: 'abc', tab: 'entries' });
    expect(parseCompHash('#/competitions/event/abc/nope')).toEqual({ view: 'event', eventId: 'abc', tab: 'entries' });
    expect(parseCompHash('#/competitions/event/<script>')).toEqual({ view: 'home' });
    expect(parseCompHash('#/competitions/event/')).toEqual({ view: 'home' });
    expect(parseCompHash('#/players')).toEqual({ view: 'home' });
    expect(parseCompHash('')).toEqual({ view: 'home' });
    expect(parseCompHash('#/competitions/rankings?x=1')).toEqual({ view: 'rankings' });
  });
});

describe('words for the owner', () => {
  it('names events and says the scoring rules in plain English', () => {
    expect(eventTitle({ category: 'MS', ageGroup: null })).toBe("Men's singles");
    expect(eventTitle({ category: 'WD', ageGroup: '35+' })).toMatch(/35\+$/);
    expect(rulesetWords(DEFAULT_RULESET)).toBe('Best of 3 games (the first to win 2 wins the match), each to 21 points; at 20-all a side needs a 2-point lead, and the first to 30 wins outright. A short break when the leader reaches 11.');
    expect(rulesetWords({ ...DEFAULT_RULESET, gamesToWin: 1 })).toMatch(/^One game, each to 21 points/);
    for (const p of RULESET_PRESETS) {
      expect(rulesetProblems(p.ruleset), p.key).toEqual([]);
      expect(presetKeyFor(p.ruleset)).toBe(p.key);
    }
    expect(presetKeyFor({ ...DEFAULT_RULESET, pointsToWin: 11, intervalAt: 6, changeEndsInDecidingGameAt: 6, pointCap: 15 })).toBe('custom');
  });
  it('treats junior categories, junior age groups and unreadable age groups as junior (fail closed)', () => {
    expect(isJuniorEvent('MS', null)).toBe(false);
    expect(isJuniorEvent('MS', 'senior')).toBe(false);
    expect(isJuniorEvent('BS', null)).toBe(true);
    expect(isJuniorEvent('MS', 'U15')).toBe(true);
    expect(isJuniorEvent('MS', 'something')).toBe(true);
  });
  it('checks reasons and whole numbers', () => {
    expect(reasonProblem('  ')).toMatch(/at least 3/);
    expect(reasonProblem('Injured')).toBeNull();
    expect(reasonProblem('x'.repeat(501))).toMatch(/500/);
    expect(parseWhole('')).toBeNull();
    expect(parseWhole(' 12 ')).toBe(12);
    for (const bad of ['1.5', '-1', '1e3', 'abc']) expect(parseWhole(bad)).toBeNaN();
  });
  it('shows the server sentence when there is one, else a plain sentence (STALE included)', () => {
    expect(failureText({ ok: false, code: 'INVALID', errors: { form: 'The draw is already published.' } })).toBe('The draw is already published.');
    expect(failureText({ ok: false, code: 'INVALID', errors: { capacity: 'Too few places.' } })).toBe('Too few places.');
    expect(failureText({ ok: false, code: 'STALE' })).toMatch(/changed this since you opened it/);
    expect(failureText({ ok: false, code: 'BACKEND_ERROR' })).toMatch(/Nothing was changed/);
    expect(fieldErrors({ ok: false, code: 'INVALID', errors: { form: 'x', seed: 'y' } })).toEqual({ seed: 'y' });
  });
});

describe('live result check (the scoring engine, as the server runs it)', () => {
  const r = DEFAULT_RULESET;
  it('accepts a real result and names the winner', () => {
    const c = liveResultCheck(draft('completed', [['21', '15'], ['18', '21'], ['22', '20']]), r);
    expect(c).toMatchObject({ ok: true, winner: 'A', messages: [] });
    expect(outcomeSentence(c, { a: 'Demo One', b: 'Demo Two' }, 'completed')).toBe('Demo One wins.');
  });
  it('explains an impossible score and a match that is not over', () => {
    const c = liveResultCheck(draft('completed', [['21', '20']]), r);
    expect(c.ok).toBe(false);
    expect(c.messages.join(' ')).toMatch(/21-20/);
    expect(liveResultCheck(draft('completed', [['21', '10']]), r).ok).toBe(false);
  });
  it('asks for both scores and refuses non-numbers before the engine runs', () => {
    expect(liveResultCheck(draft('completed', [['21', '']]), r).messages).toEqual(['Game 1: type both scores, or remove the game.']);
    // an untouched game box is a game not played: the engine's message about the typed game shows instead
    const partial = liveResultCheck(draft('completed', [['21', '20'], ['', '']]), r);
    expect(partial.ok).toBe(false);
    expect(partial.messages.join(' ')).toMatch(/21-20/);
    expect(partial.messages.join(' ')).not.toMatch(/type both scores/);
    expect(liveResultCheck(draft('completed', [['2.5', '21']]), r).messages[0]).toMatch(/whole numbers/);
  });
  it('a walkover needs the side that goes through and ignores typed games', () => {
    expect(liveResultCheck(draft('walkover', [['21', '0']]), r).messages.join(' ')).toMatch(/Say which side received the walkover/);
    const c = liveResultCheck(draft('walkover', [['21', '0']], { walkoverWinner: 'B' }), r);
    expect(c).toMatchObject({ ok: true, winner: 'B' });
    expect(c.record?.games).toEqual([]);
  });
  it('a retirement names the side that stopped; the other side wins', () => {
    const c = liveResultCheck(draft('retired', [['21', '10'], ['5', '3']], { retiringSide: 'B' }), r);
    expect(c).toMatchObject({ ok: true, winner: 'A' });
    expect(c.record).toMatchObject({ retiringSide: 'B', walkoverWinner: null });
  });
  it('an abandoned match has no winner', () => {
    const c = liveResultCheck(draft('abandoned', [['10', '8']]), r);
    expect(c).toMatchObject({ ok: true, winner: null });
    expect(outcomeSentence(c, { a: 'x', b: 'y' }, 'abandoned')).toMatch(/Nobody wins/);
  });
});

describe('India time', () => {
  it('builds an instant at +05:30 and splits it back', () => {
    expect(istInstant('2026-11-14', '09:30')).toBe('2026-11-14T09:30:00+05:30');
    expect(istInstant('2026-11-31', '09:30')).toBeNull();
    expect(istInstant('2026-11-14', '9:30')).toBeNull();
    expect(istInstant('2026-11-14', '24:00')).toBeNull();
    expect(splitIst('2026-11-14T04:00:00.000Z')).toEqual({ date: '2026-11-14', time: '09:30' });
    expect(splitIst('2026-11-13T20:00:00Z')).toEqual({ date: '2026-11-14', time: '01:30' });
    expect(splitIst(null)).toEqual({ date: '', time: '' });
    expect(splitIst('2026-11-14')).toEqual({ date: '', time: '' });
    expect(whenText('2026-11-14T04:00:00.000Z')).toBe('14 November 2026, 9:30 am IST');
    expect(whenText(null)).toBe('Time not set');
  });
  it('checks the playing days of a schedule', () => {
    expect(windowsProblems([])).toEqual(['Add at least one playing day.']);
    expect(windowsProblems([{ date: '2026-11-14', start: '09:00', end: '18:00' }])).toEqual([]);
    expect(windowsProblems([{ date: '14/11/2026', start: '18:00', end: '09:00' }])).toEqual(['Day 1: type the date like 2026-11-14.', 'Day 1: the end time must be after the start time.']);
  });
});

describe('form limits match the server', () => {
  it('a draw number shown on screen (up to 10 digits, 0 to 4294967295) can be typed back in', () => {
    expect(parseDrawNumber('')).toBeNull();
    expect(parseDrawNumber(' 0 ')).toBe(0);
    expect(parseDrawNumber('42')).toBe(42);
    expect(parseDrawNumber('3141592653')).toBe(3141592653);
    expect(parseDrawNumber('4294967295')).toBe(4294967295);
    for (const bad of ['4294967296', '9999999999', '12345678901', '-1', '1.5', '1e9', 'abc']) expect(parseDrawNumber(bad), bad).toBeNaN();
  });
  it('typing back a 10-digit draw number makes exactly the same draw', async () => {
    const s = store();
    const first = ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 3141592653, separateClubs: false, seeds: 2, reason: R }));
    expect(first.seed).toBe(3141592653);
    const slots1 = (await eventOf(s, COMP_SEED.eventMs)).draw!.slots;
    const typed = parseDrawNumber(String(first.seed));
    expect(typed).toBe(3141592653);
    const again = ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: typed, separateClubs: false, seeds: 2, reason: R }));
    expect(again.seed).toBe(first.seed);
    expect((await eventOf(s, COMP_SEED.eventMs)).draw!.slots).toEqual(slots1);
  });
  it('ranges: in range is a number, outside is refused before it reaches the server', () => {
    expect(parseInRange('256', COMP_LIMITS.seed)).toBe(256);
    expect(parseInRange('257', COMP_LIMITS.seed)).toBeNaN();
    expect(parseInRange('300', COMP_LIMITS.seed)).toBeNaN();
    expect(parseInRange('0', COMP_LIMITS.seed)).toBeNaN();
    expect(parseInRange('64', COMP_LIMITS.seeds)).toBe(64);
    expect(parseInRange('65', COMP_LIMITS.seeds)).toBeNaN();
    expect(parseInRange('1', COMP_LIMITS.capacity)).toBeNaN();
    expect(parseInRange('1024', COMP_LIMITS.capacity)).toBe(1024);
    expect(parseInRange('1025', COMP_LIMITS.capacity)).toBeNaN();
    expect(parseInRange('600', COMP_LIMITS.restMinutes)).toBe(600);
    expect(parseInRange('601', COMP_LIMITS.restMinutes)).toBeNaN();
    expect(parseInRange('4', COMP_LIMITS.durationMinutes)).toBeNaN();
    expect(parseInRange('', COMP_LIMITS.seed)).toBeNull();
    const day = { date: '2026-11-14', start: '09:00', end: '18:00' };
    expect(windowsProblems(Array.from({ length: 14 }, () => day))).toEqual([]);
    expect(windowsProblems(Array.from({ length: 15 }, () => day))).toEqual(['Plan at most 14 playing days at a time.']);
  });
  it('the limits are the ones the server checks (handler schemas and validate.ts)', () => {
    const handler = readFileSync(join(process.cwd(), 'src/lib/admin/handler.ts'), 'utf8');
    const L = COMP_LIMITS;
    const expected = [
      `seed: smallInt(${L.seed.min}, ${L.seed.max}).nullable(), status: z.enum(['pending', 'confirmed', 'waitlisted']), reason`,
      `seed: smallInt(${L.seed.min}, ${L.seed.max}).nullable(), reason`,
      `seed: smallInt(${L.drawNumber.min}, ${L.drawNumber.max}).nullable().optional()`,
      `seeds: smallInt(${L.seeds.min}, ${L.seeds.max})`,
      `groupCount: smallInt(${L.groupCount.min}, ${L.groupCount.max})`,
      `advancePerGroup: smallInt(${L.advancePerGroup.min}, ${L.advancePerGroup.max})`,
      `durationMinutes: smallInt(${L.durationMinutes.min}, ${L.durationMinutes.max})`,
      `restMinutes: smallInt(${L.restMinutes.min}, ${L.restMinutes.max})`,
      `.min(${L.playingDays.min}).max(${L.playingDays.max}),`,
    ];
    for (const e of expected) expect(handler, e).toContain(e);
    const validate = readFileSync(join(process.cwd(), 'src/lib/admin/competition/validate.ts'), 'utf8');
    expect(validate).toContain(`e.capacity < ${L.capacity.min} || e.capacity > ${L.capacity.max}`);
  });
});

describe('changing a saved result starts from what was saved', () => {
  const m = (status: string, winnerSide: 'A' | 'B' | null, games: { a: number; b: number }[]) =>
    ({ status, winnerSide, games: games.map((g) => ({ ...g, finished: true })) }) as Parameters<typeof draftFromMatch>[0];
  it('a walkover keeps its status and who went through, with no games', () => {
    expect(draftFromMatch(m('walkover', 'B', []), 2)).toEqual({ status: 'walkover', games: [], walkoverWinner: 'B', retiringSide: null });
  });
  it('a retirement fills in the side that stopped (the one opposite the winner) and the games', () => {
    const d = draftFromMatch(m('retired', 'A', [{ a: 21, b: 15 }, { a: 5, b: 3 }]), 2);
    expect(d).toEqual({ status: 'retired', games: [{ a: '21', b: '15' }, { a: '5', b: '3' }], walkoverWinner: null, retiringSide: 'B' });
    expect(liveResultCheck(d, DEFAULT_RULESET).ok).toBe(true);
  });
  it('a completed result keeps its games; a match with no result gets empty boxes', () => {
    expect(draftFromMatch(m('completed', 'A', [{ a: 21, b: 10 }, { a: 21, b: 12 }]), 2)).toEqual({ status: 'completed', games: [{ a: '21', b: '10' }, { a: '21', b: '12' }], walkoverWinner: null, retiringSide: null });
    expect(draftFromMatch(m('scheduled', null, []), 2)).toEqual(emptyResultDraft(2));
  });
});

describe('schedule boxes: courts and events added later are ticked', () => {
  it('keeps a left-out list, so a new court is included by default', () => {
    let out: string[] = [];
    out = toggleLeftOut(out, 'c2', false);
    expect(includedIds(['c1', 'c2'], out)).toEqual(['c1']);
    expect(includedIds(['c1', 'c2', 'c3'], out)).toEqual(['c1', 'c3']);
    out = toggleLeftOut(out, 'c2', true);
    expect(includedIds(['c1', 'c2', 'c3'], out)).toEqual(['c1', 'c2', 'c3']);
    expect(toggleLeftOut(['c1'], 'c1', false)).toEqual(['c1']);
  });
  it('the entry seed box follows the saved seed after a reload', () => {
    const src = readFileSync(join(process.cwd(), 'src/admin/screens/competition/Entries.tsx'), 'utf8');
    expect(src).toContain('useEffect(() => setSeed(e.seed === null ? \'\' : String(e.seed)), [e.seed]);');
  });
});

describe('rankings: a player who became protected blocks publishing (fail closed)', () => {
  it('counts rows flagged as protected now; a row without an explicit false counts as protected', () => {
    expect(rankingRowProtected({ isProtected: false })).toBe(false);
    expect(rankingRowProtected({ isProtected: true })).toBe(true);
    // a payload that lost the flag (an old server, a garbled reply) fails closed
    expect(rankingRowProtected({} as { isProtected: boolean })).toBe(true);
    expect(rankingRowProtected({ isProtected: 'false' } as unknown as { isProtected: boolean })).toBe(true);
    expect(protectedRankingRows([{ isProtected: true }, { isProtected: false }, {} as { isProtected: boolean }, { isProtected: false }])).toBe(2);
    expect(protectedRankingRows([{ isProtected: false }, { isProtected: false }])).toBe(0);
  });
  it('the ranking screen hides the publish button and refuses while a protected row is listed', () => {
    const src = readFileSync(join(process.cwd(), 'src/admin/screens/competition/Rankings.tsx'), 'utf8');
    expect(src).toContain('if (protectedRows > 0) return act.fail(PROTECTED_BLOCK);');
    expect(src).toContain('!q.data.snapshot.published && protectedRows === 0 ?');
    expect(src).toContain('Protected player: will be left out');
  });
});

describe('the points-table form', () => {
  it('an empty form is refused in words; blank boxes are left out; the record passes the server checks', () => {
    expect(Object.keys(pointsDraftToRecord(pointsDraftFrom(null)).errors).sort()).toEqual(['bestN', 'label', 'levels', 'windowDays']);
    const d = pointsDraftFrom(null);
    d.label = 'Demo points';
    d.windowDays = '364';
    d.bestN = '4';
    d.levels = { district: { W: '100', F: '60', SF: '' } };
    const { record, errors } = pointsDraftToRecord(d);
    expect(errors).toEqual({});
    expect(record).toEqual({ label: 'Demo points', windowDays: 364, bestN: 4, levels: { district: { W: 100, F: 60 } } });
    d.levels = { district: { W: 'ten' } };
    expect(pointsDraftToRecord(d).errors['levels']).toMatch(/whole numbers/);
  });
  it('round-trips an approved table', () => {
    const t = { label: 'Demo', levels: { state: { W: 10, QF: 2 } }, windowDays: 30, bestN: 2, approvedAt: '2026-10-01T00:00:00Z' };
    expect(pointsDraftToRecord(pointsDraftFrom(t)).record).toEqual({ label: 'Demo', levels: { state: { W: 10, QF: 2 } }, windowDays: 30, bestN: 2 });
  });
});

describe('draw preview: the owner sees names, the public view never names a protected player', () => {
  it('knockout: names for the owner; the same bracket with seeds and a confirmed winner moving on', async () => {
    const s = store();
    const made = ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    expect(made.seed).toBe(42);
    let d = await eventOf(s, COMP_SEED.eventMs);
    const owner = knockoutPreview(d.draw!.slots, d.entries, d.matches, 'owner');
    expect(owner.problems).toEqual([]);
    expect(owner.columns.map((c) => c.code)).toEqual(['SF', 'F']);
    const names = JSON.stringify(owner.columns);
    expect(names).toContain('Demo Comp Anand Mockwell');
    expect(names).toContain('Demo Arvind Testwell');

    ok(await s.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventMs, drawId: made.drawId, reason: R }));
    d = await eventOf(s, COMP_SEED.eventMs);
    const first = d.matches.find((m) => m.roundCode === 'SF')!;
    const rec = ok(await s.competitionRecordResult(ACTOR, { matchId: first.id, expectedRevision: first.revision, status: 'completed', games: [{ a: 21, b: 10 }, { a: 21, b: 12 }], walkoverWinner: null, retiringSide: null, reason: R }));
    d = await eventOf(s, COMP_SEED.eventMs);
    // recorded but not confirmed: the owner view marks it "not confirmed yet"; the public view shows no winner or score yet
    const ownerPending = knockoutPreview(d.draw!.slots, d.entries, d.matches, 'owner');
    expect(ownerPending.unconfirmed).toHaveLength(1);
    expect(ownerPending.columns[0]!.matches.find((m) => m.id === ownerPending.unconfirmed[0])!.winner).not.toBeNull();
    expect(knockoutPreview(d.draw!.slots, d.entries, d.matches, 'public').unconfirmed).toEqual([]);
    const pub1 = knockoutPreview(d.draw!.slots, d.entries, d.matches, 'public').columns[0]!.matches;
    expect(pub1.every((m) => m.winner === null && (m.games ?? []).length === 0)).toBe(true);
    ok(await s.competitionConfirmResult(ACTOR, { matchId: first.id, expectedRevision: rec.revision, reason: R }));
    d = await eventOf(s, COMP_SEED.eventMs);
    const after = knockoutPreview(d.draw!.slots, d.entries, d.matches, 'public');
    expect(knockoutPreview(d.draw!.slots, d.entries, d.matches, 'owner').unconfirmed).toEqual([]);
    const final = after.columns.find((c) => c.code === 'F')!.matches[0]!;
    expect([final.a.kind, final.b.kind].filter((k) => k === 'entry')).toHaveLength(1);
    expect(matchSides(d.matches.find((m) => m.roundCode === 'F')!, d.entries).b).toBe('To be decided');
  });

  it('league: the unknown-age player is named for the owner and "Protected player" in the public view', async () => {
    const s = store();
    ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventWs, seed: 7, separateClubs: false, seeds: 0, reason: R }));
    const d = await eventOf(s, COMP_SEED.eventWs);
    const owner = groupPreview(d.draw!.slots, d.entries, 'owner');
    expect(owner).toHaveLength(1);
    expect(owner[0]!.names).toContain('Demo Meena Samplestone');
    const pub = groupPreview(d.draw!.slots, d.entries, 'public');
    expect(pub[0]!.names).toContain(PROTECTED_LABEL);
    expect(JSON.stringify(pub)).not.toMatch(/Meena|Samplestone/);
    expect(pub[0]!.names.filter((n) => n !== PROTECTED_LABEL)).toHaveLength(2);
  });

  it('junior event: every entry is "Protected player" in the public view, adults included', async () => {
    const s = store();
    const ev = ok(await s.competitionSaveEvent(ACTOR, { id: null, tournamentId: SEED.t1, category: 'MS', ageGroup: 'U15', format: 'knockout', ruleset: { ...DEFAULT_RULESET }, capacity: null, status: 'open', reason: R }));
    for (const p of [COMP_SEED.anand, COMP_SEED.bala]) ok(await s.competitionAddEntry(ACTOR, { eventId: ev.id, players: [p], seed: null, status: 'confirmed', reason: R }));
    ok(await s.competitionGenerateDraw(ACTOR, { eventId: ev.id, seed: 1, separateClubs: false, seeds: 0, reason: R }));
    const d = await eventOf(s, ev.id);
    expect(d.event.isJunior).toBe(true);
    for (const e of d.entries) expect(publicEntryName(e)).toBe(PROTECTED_LABEL);
    const pub = JSON.stringify(knockoutPreview(d.draw!.slots, d.entries, d.matches, 'public'));
    expect(pub).not.toMatch(/Anand|Bala/);
    const sides = knockoutPreview(d.draw!.slots, d.entries, d.matches, 'public').columns.flatMap((c) => c.matches.flatMap((m) => [slotText(m.a), slotText(m.b)]));
    expect(sides).toEqual([PROTECTED_LABEL, PROTECTED_LABEL]);
    // the owner still sees the names
    expect(JSON.stringify(knockoutPreview(d.draw!.slots, d.entries, d.matches, 'owner'))).toContain('Demo Comp Anand Mockwell');
  });

  it('fails closed: an entry the preview does not know is "Protected player"', () => {
    const pub = groupPreview([{ position: 1, entryId: 'missing', group: null }], [], 'public');
    expect(pub[0]!.names).toEqual([PROTECTED_LABEL]);
  });
});

describe('screen sources', () => {
  const dir = join(process.cwd(), 'src/admin/screens/competition');
  const files = readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
  it('no typed owner placeholder, no raw HTML, no hand-written site links, no line or paragraph separators', () => {
    const sep = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`);
    for (const [f, t] of files) {
      expect(t, f).not.toMatch(/TODO\(owner\)/);
      expect(t, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
      expect(t, f).not.toMatch(/href=["'{`]+\/(?!\/)/);
      expect(sep.test(t), f).toBe(false);
    }
  });
  it('every competition action a screen calls exists on the store', () => {
    const s = store() as unknown as Record<string, unknown>;
    const called = new Set(files.flatMap(([, t]) => [...t.matchAll(/client\.(competition\w+)\(/g)].map((m) => m[1]!)));
    expect(called.size).toBeGreaterThan(15);
    for (const name of called) expect(typeof s[name], name).toBe('function');
  });
});

describe('update matches: the outcome in plain English', () => {
  const none = { created: 0, updated: 0, advanced: [], problems: [] };
  const adv = { matchId: 'm1', side: 'A' as const, entryId: 'e1' };
  it('says what was made, updated and moved on', () => {
    expect(syncOutcomeLines({ ...none, created: 3, updated: 1, advanced: [adv] })).toEqual(['3 matches made.', '1 match updated.', '1 winner moved on in the draw.']);
    expect(syncOutcomeLines({ ...none, updated: 2, advanced: [adv, adv] })).toEqual(['2 matches updated.', '2 winners moved on in the draw.']);
    expect(syncOutcomeLines(none)).toEqual(['Nothing needed changing: the matches already follow the draw.']);
    expect(syncOutcomeNotice(none)).toBe('Nothing needed changing: the matches already follow the draw.');
  });
  it('announces the problems (the screen lists them)', () => {
    expect(syncOutcomeLines({ ...none, problems: ['MS SF match 1: the slot is empty.'] })).toEqual(['Nothing was changed.', 'One thing needs your attention:']);
    expect(syncOutcomeLines({ ...none, created: 1, problems: ['a', 'b'] })).toEqual(['1 match made.', '2 things need your attention:']);
    expect(syncOutcomeNotice({ ...none, created: 1, problems: ['a', 'b'] })).toBe('1 match made. See the list on the screen.');
  });
  it('the confirm-result notice points at the Update matches button only when something needs attention', () => {
    expect(UPDATE_MATCHES_LABEL).toBe('Update matches');
    expect(confirmResultNotice(none)).toBe('Result confirmed.');
    expect(confirmResultNotice({ ...none, advanced: [adv] })).toBe('Result confirmed. The winner has moved on in the draw.');
    expect(confirmResultNotice({ ...none, problems: ['The final could not be filled in.'] })).toBe('Result confirmed. Check: The final could not be filled in. Then press "Update matches" at the top of this event.');
  });
});
