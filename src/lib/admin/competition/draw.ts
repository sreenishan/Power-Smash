// Server-side draw making and match planning for the admin (PURE: no I/O). The engines in src/lib/competition decide the draw and the
// bracket; this file only turns database rows into engine input and engine output into the rows the RPCs take.
//
// Conventions (also what makes a draw reproducible from its stored seed and slots):
// - knockout: slot position = draw line (1..N, a power of two); a null entry is a bye. Match numbers follow the bracket's match order
//   (round by round, top to bottom), so bracket match k is competition match number k. Bye and empty matches get no row.
// - round robin: slot order is the circle order (seeded entries by seed, then the others in seeded-random order); matches are the
//   circle-method rounds numbered 1, 2, 3 ... in order.
// - groups + knockout: slots in group order (A first) with the group letter; each group's round robin numbered on from the last group.
//   The knockout stage after the groups needs the group standings (not built yet): it is added by hand for now.
import { BYE, applyResult, createBracket, type Bracket } from '../../competition/brackets';
import { bracketSizeFor, groupsThenKnockout, MAX_BRACKET_SIZE, roundRobin, singleElimination } from '../../competition/draws';
import { shuffle } from '../../competition/draws/bracket';
import { seededRandom, type Entry, type MatchResult, type RoundCode, type Side } from '../../competition/types';
import type { CompEntryRow, CompEventRow, CompMatchRow, CompPlayerRef, CompSlotRow, SaveMatchRecord } from './types';

export const DECIDED_OR_ABANDONED = new Set(['completed', 'walkover', 'retired', 'abandoned']);
const EDITABLE = new Set(['scheduled', 'ready', 'postponed']);

export interface DrawOptions {
  seed: number;
  separateClubs: boolean;
  seeds: number;
  groupCount?: number | null;
  advancePerGroup?: number | null;
}

export type DrawPlan = { ok: true; slots: CompSlotRow[]; notes: string[] } | { ok: false; reasons: string[] };

/** The club of an entry for draw separation: the academy of a singles player, or of a pair whose two players share one. */
function clubOf(entry: CompEntryRow, players: ReadonlyMap<string, CompPlayerRef>): string | null {
  const clubs = entry.players.map((id) => players.get(id)?.academy?.trim().toLowerCase() || null);
  const first = clubs[0] ?? null;
  return first !== null && clubs.every((c) => c === first) ? first : null;
}

function toEngineEntries(entries: readonly CompEntryRow[], players: ReadonlyMap<string, CompPlayerRef>, seeds: number): Entry[] {
  return entries.map((e) => ({
    id: e.id,
    players: [...e.players],
    ...(e.seed !== null && e.seed <= seeds ? { seed: e.seed } : {}),
    club: clubOf(e, players),
  }));
}

/** The draw of an event from its CONFIRMED entries, or every reason it cannot be made (plain English). */
export function planDraw(event: CompEventRow, confirmed: readonly CompEntryRow[], players: ReadonlyMap<string, CompPlayerRef>, opts: DrawOptions): DrawPlan {
  if (confirmed.length < 2) return { ok: false, reasons: [`A draw needs at least 2 confirmed entries; this event has ${confirmed.length}. Confirm the entries first.`] };
  if (!Number.isInteger(opts.seeds) || opts.seeds < 0) return { ok: false, reasons: ['The number of seeds must be a whole number, 0 or more.'] };
  const entries = toEngineEntries(confirmed, players, opts.seeds);

  if (event.format === 'knockout') {
    if (confirmed.length > MAX_BRACKET_SIZE) return { ok: false, reasons: [`A knockout draw holds at most ${MAX_BRACKET_SIZE} entries.`] };
    const size = bracketSizeFor(confirmed.length);
    if (opts.seeds > size / 2) return { ok: false, reasons: [`A draw of ${size} lines can have at most ${size / 2} seeds.`] };
    const out = singleElimination(entries, { seed: opts.seed, separateClubs: opts.separateClubs, maxSeeds: opts.seeds });
    if (!out.ok) return { ok: false, reasons: out.refusals.map((r) => r.message) };
    const d = out.draw;
    const notes: string[] = [`A knockout draw of ${d.bracketSize} lines for ${d.entryCount} entries.`];
    if (d.byes.length > 0) notes.push(`${d.byes.length} ${d.byes.length === 1 ? 'entry goes' : 'entries go'} straight to the next round (a bye).`);
    if (opts.separateClubs && d.separation.unresolved.length > 0) {
      notes.push(`${d.separation.unresolved.length} first-round ${d.separation.unresolved.length === 1 ? 'match pairs' : 'matches pair'} two players of one club; they could not be kept apart.`);
    }
    return { ok: true, slots: d.lines.map((l) => ({ position: l.line, entryId: l.entryId, group: null })), notes };
  }

  if (event.format === 'round_robin') {
    // circle order: seeds by seed, then everyone else sorted by id and shuffled with the recorded seed (so the seed reproduces it)
    const seeded = entries.filter((e) => e.seed !== undefined).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
    const rest = shuffle(entries.filter((e) => e.seed === undefined).sort((a, b) => (a.id < b.id ? -1 : 1)), seededRandom(opts.seed));
    const order = [...seeded, ...rest];
    const rr = roundRobin(order, { roundCode: 'league' });
    if (!rr.ok) return { ok: false, reasons: rr.refusals.map((r) => r.message) };
    return { ok: true, slots: order.map((e, i) => ({ position: i + 1, entryId: e.id, group: null })), notes: [`Everyone plays everyone: ${rr.draw.matchCount} matches in ${rr.draw.rounds.length} rounds.`] };
  }

  // groups + knockout
  const groupCount = opts.groupCount ?? 0;
  const advance = opts.advancePerGroup ?? 0;
  const g = groupsThenKnockout(entries, groupCount, advance, { seed: opts.seed });
  if (!g.ok) return { ok: false, reasons: g.refusals.map((r) => r.message) };
  const slots: CompSlotRow[] = [];
  for (const group of g.draw.groups) for (const id of group.entryIds) slots.push({ position: slots.length + 1, entryId: id, group: group.name });
  const notes = [
    `${g.draw.groups.length} groups: ${g.draw.groups.map((x) => `group ${x.name} has ${x.entryIds.length}`).join(', ')}.`,
    `The top ${advance} of each group go to the knockout. Add the knockout matches once the groups are finished.`,
  ];
  return { ok: true, slots, notes };
}

// ----------------------------------------------------------------------------- matches from a draw

export interface PlannedMatch {
  matchNumber: number;
  roundCode: RoundCode;
  groupLabel: string | null;
  sideA: string | null;
  sideB: string | null;
}

export interface MatchSyncPlan {
  creates: SaveMatchRecord[];
  updates: { id: string; record: SaveMatchRecord; expectedRevision: number; advanced: { side: Side; entryId: string }[] }[];
  problems: string[];
}

/** The knockout bracket of a draw with every CONFIRMED result applied (winners advance only on a confirmed result). */
export function bracketFor(slots: readonly CompSlotRow[], matches: readonly CompMatchRow[]): { bracket: Bracket | null; problems: string[] } {
  const lines = [...slots].sort((a, b) => a.position - b.position).map((s) => s.entryId ?? BYE);
  const made = createBracket(lines);
  if (!made.ok) return { bracket: null, problems: [made.message] };
  let bracket = made.bracket;
  const problems: string[] = [];
  const byNumber = new Map(matches.map((m) => [m.matchNumber, m]));
  const ids = bracket.matches.map((m) => m.id);
  ids.forEach((id, i) => {
    const row = byNumber.get(i + 1);
    if (!row || !row.confirmed || !DECIDED_OR_ABANDONED.has(row.status)) return;
    const result: MatchResult = { status: row.status as MatchResult['status'], winner: row.winnerSide, games: [], confirmed: true };
    const current = bracket.matches[i];
    const winnerEntry = row.winnerSide === 'A' ? row.sideA : row.winnerSide === 'B' ? row.sideB : null;
    const applied = applyResult(bracket, id, result, winnerEntry ? { winnerEntryId: winnerEntry } : {});
    if (applied.ok) bracket = applied.bracket;
    else if (current?.state !== 'bye' && current?.state !== 'void') problems.push(`Match ${i + 1}: ${applied.message}`);
  });
  return { bracket, problems };
}

/** The matches the draw needs, in match-number order. */
export function plannedMatches(event: CompEventRow, slots: readonly CompSlotRow[], entries: readonly CompEntryRow[], matches: readonly CompMatchRow[]): { planned: PlannedMatch[]; problems: string[] } {
  const ordered = [...slots].sort((a, b) => a.position - b.position);
  if (event.format === 'knockout') {
    const { bracket, problems } = bracketFor(ordered, matches);
    if (!bracket) return { planned: [], problems };
    const planned: PlannedMatch[] = [];
    bracket.matches.forEach((m, i) => {
      if (m.state === 'bye' || m.state === 'void') return;
      planned.push({ matchNumber: i + 1, roundCode: m.round, groupLabel: null, sideA: m.a.kind === 'entry' ? m.a.entryId : null, sideB: m.b.kind === 'entry' ? m.b.entryId : null });
    });
    return { planned, problems };
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  const engine = (ids: readonly string[]): Entry[] => ids.map((id) => ({ id, players: [...(byId.get(id)?.players ?? [id])] }));
  const planned: PlannedMatch[] = [];
  const problems: string[] = [];
  const groups: { label: string | null; ids: string[] }[] = [];
  for (const s of ordered) {
    if (s.entryId === null) continue;
    const label = event.format === 'groups_knockout' ? s.group : null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.ids.push(s.entryId);
    else groups.push({ label, ids: [s.entryId] });
  }
  for (const g of groups) {
    const rr = roundRobin(engine(g.ids), { roundCode: g.label === null ? 'league' : 'group' });
    if (!rr.ok) {
      problems.push(...rr.refusals.map((r) => (g.label ? `Group ${g.label}: ${r.message}` : r.message)));
      continue;
    }
    for (const round of rr.draw.rounds) {
      for (const m of round.matches) {
        planned.push({ matchNumber: planned.length + 1, roundCode: g.label === null ? 'league' : 'group', groupLabel: g.label, sideA: m.a, sideB: m.b });
      }
    }
  }
  return { planned, problems };
}

/** What to create or change so the stored matches follow the draw (and, for a knockout, every confirmed result). Idempotent. */
export function planMatchSync(event: CompEventRow, slots: readonly CompSlotRow[], entries: readonly CompEntryRow[], matches: readonly CompMatchRow[], label: (m: { roundCode: RoundCode; matchNumber: number; groupLabel: string | null }) => string): MatchSyncPlan {
  const { planned, problems } = plannedMatches(event, slots, entries, matches);
  const byNumber = new Map(matches.map((m) => [m.matchNumber, m]));
  const plan: MatchSyncPlan = { creates: [], updates: [], problems: [...problems] };
  for (const p of planned) {
    const row = byNumber.get(p.matchNumber);
    if (!row) {
      plan.creates.push({ eventId: event.id, roundCode: p.roundCode, matchNumber: p.matchNumber, groupLabel: p.groupLabel, sideA: p.sideA, sideB: p.sideB, scheduledAt: null, courtId: null });
      continue;
    }
    if (row.sideA === p.sideA && row.sideB === p.sideB) continue;
    if (row.roundCode !== p.roundCode || row.groupLabel !== p.groupLabel) {
      plan.problems.push(`${label(row)} does not match the draw (it was entered by hand). Check it.`);
      continue;
    }
    if (row.confirmed || !EDITABLE.has(row.status)) {
      plan.problems.push(`${label(row)} already has a result or has started, so its players were not changed. Check it.`);
      continue;
    }
    const advanced: { side: Side; entryId: string }[] = [];
    if (p.sideA !== null && row.sideA !== p.sideA) advanced.push({ side: 'A', entryId: p.sideA });
    if (p.sideB !== null && row.sideB !== p.sideB) advanced.push({ side: 'B', entryId: p.sideB });
    plan.updates.push({
      id: row.id,
      expectedRevision: row.revision,
      record: { eventId: event.id, roundCode: row.roundCode, matchNumber: row.matchNumber, groupLabel: row.groupLabel, sideA: p.sideA, sideB: p.sideB, scheduledAt: row.scheduledAt, courtId: row.courtId },
      advanced,
    });
  }
  return plan;
}

/** Knockout only: for each match number, the match numbers that feed it (a final waits for both semi-finals). */
export function knockoutFeeders(slots: readonly CompSlotRow[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const lines = [...slots].sort((a, b) => a.position - b.position).map((s) => s.entryId ?? BYE);
  const made = createBracket(lines);
  if (!made.ok) return out;
  const index = new Map(made.bracket.matches.map((m, i) => [m.id, i + 1]));
  made.bracket.matches.forEach((m, i) => {
    if (m.state === 'bye' || m.state === 'void' || !m.next) return;
    const target = index.get(m.next.matchId);
    if (target === undefined) return;
    out.set(target, [...(out.get(target) ?? []), i + 1]);
  });
  return out;
}
