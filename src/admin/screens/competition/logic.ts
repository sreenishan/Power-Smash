// Pure helpers for the competition admin screens (D-108 to D-114). No React, no I/O, no clock (callers pass `today`): every decision the
// screens make (the sub-route, plain-English labels, the ruleset in words, live result checks, the draw preview with "Protected player",
// schedule windows, the points-table form) lives here so Vitest can test it in Node (tests/admin-ui/competition-logic.test.ts).
//
// Two kinds of preview:
//   owner  - what the owner sees in the admin: real names, protected players included (the admin is owner-only, D-012 allows it).
//   public - what a visitor would see: anyone protected (not adult_confirmed, or any entry of a junior event, D-109) is "Protected
//            player", through the same fail-closed helpers the public components use (src/components/competition/helpers.ts).
import { checkResult } from '../../../lib/admin/competition/result';
import { bracketFor } from '../../../lib/admin/competition/draw';
import { playersPerEntry, pointsTableProblems } from '../../../lib/admin/competition/validate';
import type {
  ApprovedPointsTable,
  CompSlotRow,
  CompetitionEntryDto,
  CompetitionMatchDto,
  CompetitionRankingRowDto,
  EventFormat,
  EventStatus,
  EntryStatus,
  DrawStatus,
  Finish,
  MatchSyncOutcome,
  PointsTableRecord,
  RecordResultRecord,
  ResultStatus,
} from '../../../lib/admin/competition/types';
import type { StoreResult } from '../../../lib/admin/types';
import { CATEGORY_LABELS } from '../../../lib/archive/labels';
import { TOURNAMENT_LEVELS } from '../../../lib/archive/types';
import { isCompetitionAgeGroup, isJuniorAgeGroup } from '../../../lib/competition/db';
import { DEFAULT_RULESET, maxGames, type Ruleset } from '../../../lib/competition/scoring';
import { FINISHES } from '../../../lib/competition/stats/ranking';
import type { Side } from '../../../lib/competition/types';
import { isHhMm, isIsoDate } from '../../../lib/dates';
import { JUNIOR_CATEGORIES, type Category } from '../../../lib/parser/types';
import {
  bracketColumns,
  bracketMatchSummary,
  formatDateIst,
  formatTimeIst,
  PROTECTED_LABEL,
  sideName,
  type BracketColumn,
  type BracketMatchView,
  type PlayerRef,
  type SlotView,
} from '../../../components/competition/helpers';
import { messageFor } from '../../messages';

export { PROTECTED_LABEL };

// ----------------------------------------------------------------------------- sub-routes inside #/competitions

export const EVENT_TABS = ['entries', 'draw', 'matches'] as const;
export type EventTab = (typeof EVENT_TABS)[number];
export const EVENT_TAB_LABEL: Record<EventTab, string> = { entries: 'Entries', draw: 'Draw', matches: 'Matches and results' };

export type CompView =
  | { view: 'home' }
  | { view: 'event'; eventId: string; tab: EventTab }
  | { view: 'newEvent'; tournamentId: string }
  | { view: 'editEvent'; eventId: string }
  | { view: 'tournament'; tournamentId: string }
  | { view: 'rankings' };

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** `#/competitions/event/<id>/draw` -> the view. Anything unreadable falls back to the competitions home (never throws). */
export function parseCompHash(hash: string): CompView {
  const parts = hash.replace(/^#\/?/, '').split('?')[0]!.split('/').filter((p) => p !== '');
  if (parts[0] !== 'competitions') return { view: 'home' };
  const [, kind, id, tab] = parts;
  const okId = typeof id === 'string' && ID_RE.test(id);
  if (kind === 'rankings') return { view: 'rankings' };
  if (kind === 'event' && okId) return { view: 'event', eventId: id, tab: (EVENT_TABS as readonly string[]).includes(tab ?? '') ? (tab as EventTab) : 'entries' };
  if (kind === 'new' && okId) return { view: 'newEvent', tournamentId: id };
  if (kind === 'edit' && okId) return { view: 'editEvent', eventId: id };
  if (kind === 'tournament' && okId) return { view: 'tournament', tournamentId: id };
  return { view: 'home' };
}

export function compHash(v: CompView): string {
  switch (v.view) {
    case 'home':
      return '#/competitions';
    case 'event':
      return `#/competitions/event/${v.eventId}/${v.tab}`;
    case 'newEvent':
      return `#/competitions/new/${v.tournamentId}`;
    case 'editEvent':
      return `#/competitions/edit/${v.eventId}`;
    case 'tournament':
      return `#/competitions/tournament/${v.tournamentId}`;
    case 'rankings':
      return '#/competitions/rankings';
  }
}

// ----------------------------------------------------------------------------- words

export const FORMAT_LABEL: Record<EventFormat, string> = {
  knockout: 'Knockout',
  round_robin: 'League (everyone plays everyone)',
  groups_knockout: 'Groups, then knockout',
};
export const FORMAT_HELP: Record<EventFormat, string> = {
  knockout: 'Lose once and you are out. Byes are added when the number of players is not 4, 8, 16 and so on.',
  round_robin: 'Every player or pair plays every other one. Good for small events.',
  groups_knockout: 'Players are split into groups that play a league; the best of each group go into a knockout. You add the knockout matches yourself once the groups are finished.',
};
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = { draft: 'Being set up', open: 'Open', closed: 'Closed' };
export const EVENT_STATUS_HELP: Record<EventStatus, string> = {
  draft: 'Still being set up. A draw cannot be published yet.',
  open: 'Entries are being taken and the draw can be published.',
  closed: 'Finished or no longer taking changes.',
};
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = { pending: 'Waiting for your check', confirmed: 'Confirmed', waitlisted: 'Waiting list', withdrawn: 'Withdrawn', rejected: 'Rejected' };
export const DRAW_STATUS_LABEL: Record<DrawStatus, string> = { draft: 'Draft (not published)', published: 'Published', locked: 'Locked' };

export const RESULT_STATUS_LABEL: Record<ResultStatus, string> = { completed: 'Played to the end', walkover: 'Walkover', retired: 'Retired during the match', abandoned: 'Abandoned (nobody won)' };
export const RESULT_STATUS_HELP: Record<ResultStatus, string> = {
  completed: 'The match was played to the end. Type the score of every game.',
  walkover: 'One side did not play at all (did not turn up, or withdrew before the match). Type no games; choose the side that goes through.',
  retired: 'A player stopped during the match, for example through injury. Type every finished game and the game that was being played when they stopped, then choose the side that stopped. The other side wins.',
  abandoned: 'The match was stopped and nobody won, for example the hall had to close. Type any games played so far. Nobody goes through.',
};

export const FINISH_LABEL: Record<Finish, string> = {
  W: 'Winner',
  F: 'Runner-up (lost the final)',
  SF: 'Lost in the semi-final',
  QF: 'Lost in the quarter-final',
  R16: 'Lost in the last 16',
  R32: 'Lost in the last 32',
  R64: 'Lost in the last 64',
  R128: 'Lost in the last 128',
  group: 'Out in the group stage',
  league: 'Played in a league',
};

export const LEVEL_LABEL: Record<(typeof TOURNAMENT_LEVELS)[number], string> = {
  district: 'District', state: 'State', zonal: 'Zonal', national: 'National', open: 'Open', corporate: 'Corporate', veterans: 'Veterans', school_college: 'School or college', other: 'Other',
};

export const categoryWords = (c: Category | string): string => CATEGORY_LABELS[c] ?? c;

/** "Men's singles U19" or "Women's doubles". */
export function eventTitle(e: { category: Category | string; ageGroup: string | null }): string {
  return `${categoryWords(e.category)}${e.ageGroup ? ` ${e.ageGroup}` : ''}`;
}

/** A junior event names nobody on the public site (D-109). Fail closed: an unreadable age group counts as junior. */
export function isJuniorEvent(category: Category, ageGroup: string | null): boolean {
  return (JUNIOR_CATEGORIES as readonly string[]).includes(category) || isJuniorAgeGroup(ageGroup);
}

/** Age groups offered in the form (all accepted by the database pattern). Empty = no age group (open to everyone). */
export const AGE_GROUP_OPTIONS = ['', 'U9', 'U11', 'U13', 'U15', 'U17', 'U19', 'senior', 'open', '35+', '40+', '45+', '50+', '55+', '60+', 'veterans', 'masters'] as const;
export const ageGroupWords = (g: string): string => (g === '' ? 'None (open to all ages)' : /^U\d+$/.test(g) ? `Under ${g.slice(1)} (${g})` : /^\d+\+$/.test(g) ? `${g.slice(0, -1)} and over (${g})` : g.charAt(0).toUpperCase() + g.slice(1));
export const ageGroupOk = (g: string | null): boolean => isCompetitionAgeGroup(g);

export const playersNeeded = (c: Category): 1 | 2 => playersPerEntry(c);

// ----------------------------------------------------------------------------- rulesets

export interface RulesetPreset {
  key: string;
  label: string;
  ruleset: Ruleset;
}

/** Ready-made scoring rules. "Standard" is the Laws of Badminton default; the others are common local variations, chosen by the owner. */
export const RULESET_PRESETS: readonly RulesetPreset[] = [
  { key: 'standard', label: 'Standard: best of 3 games to 21', ruleset: { ...DEFAULT_RULESET } },
  { key: 'one21', label: 'One game to 21', ruleset: { gamesToWin: 1, pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11, changeEndsInDecidingGameAt: 11 } },
  { key: 'best3to15', label: 'Best of 3 games to 15', ruleset: { gamesToWin: 2, pointsToWin: 15, winBy: 2, pointCap: 21, intervalAt: 8, changeEndsInDecidingGameAt: 8 } },
];

const sameRuleset = (a: Ruleset, b: Ruleset): boolean =>
  a.gamesToWin === b.gamesToWin && a.pointsToWin === b.pointsToWin && a.winBy === b.winBy && a.pointCap === b.pointCap && a.intervalAt === b.intervalAt && a.changeEndsInDecidingGameAt === b.changeEndsInDecidingGameAt;

/** The preset key of a ruleset, or 'custom'. */
export function presetKeyFor(r: Ruleset): string {
  return RULESET_PRESETS.find((p) => sameRuleset(p.ruleset, r))?.key ?? 'custom';
}

/** The scoring rules in one or two plain sentences. */
export function rulesetWords(r: Ruleset): string {
  const games = r.gamesToWin === 1 ? 'One game' : `Best of ${maxGames(r)} games (the first to win ${r.gamesToWin} wins the match)`;
  const lead = r.winBy > 1 ? `; at ${r.pointsToWin - 1}-all a side needs a ${r.winBy}-point lead` : '';
  const cap = r.pointCap === null ? ', with no top score' : r.pointCap > r.pointsToWin && r.winBy > 1 ? `, and the first to ${r.pointCap} wins outright` : '';
  const interval = r.intervalAt !== null ? ` A short break when the leader reaches ${r.intervalAt}.` : '';
  return `${games}, each to ${r.pointsToWin} points${lead}${cap}.${interval}`;
}

// ----------------------------------------------------------------------------- reasons and refusals

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** A typed reason: null when fine, else a sentence. */
export function reasonProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < REASON_MIN) return `Write a short reason (at least ${REASON_MIN} letters).`;
  if (t.length > REASON_MAX) return `Keep the reason to ${REASON_MAX} characters or fewer.`;
  return null;
}

const COMP_STALE = 'Someone or something changed this since you opened it. The screen has been loaded again: check it and make your change once more.';

/** The sentence to show for a refused competition action: the server's own plain sentence when it sent one, else the generic text. */
export function failureText(r: StoreResult<unknown>): string {
  if (r.ok) return '';
  const errors = r.errors ?? {};
  if (typeof errors['form'] === 'string' && errors['form'] !== '') return errors['form'];
  const first = Object.values(errors).find((v) => typeof v === 'string' && v !== '');
  if (first) return first;
  return r.code === 'STALE' ? COMP_STALE : messageFor(r.code);
}

/** Field errors of a refused action (the `form` sentence is shown separately). */
export function fieldErrors(r: StoreResult<unknown>): Record<string, string> {
  if (r.ok || !r.errors) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.errors)) if (k !== 'form' && typeof v === 'string') out[k] = v;
  return out;
}

// ----------------------------------------------------------------------------- whole numbers typed in a form

/** '' -> null; ' 12 ' -> 12; anything else (12.5, -1, 1e3, abc) -> NaN. */
export function parseWhole(text: string, maxDigits = 7): number | null {
  const t = text.trim();
  if (t === '') return null;
  return t.length <= maxDigits && /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/**
 * The limits the server checks (handler zod schemas and validate.ts), repeated here so the form says the exact range before sending.
 * tests/admin-ui/competition-logic.test.ts checks them against the server's handler.
 */
export const COMP_LIMITS = {
  /** The draw number: the server's random draw seed is a full 32-bit number (0 to 4,294,967,295, often 10 digits). */
  drawNumber: { min: 0, max: 4_294_967_295 },
  seed: { min: 1, max: 256 },
  seeds: { min: 0, max: 64 },
  groupCount: { min: 1, max: 26 },
  advancePerGroup: { min: 1, max: 64 },
  capacity: { min: 2, max: 1024 },
  durationMinutes: { min: 5, max: 300 },
  restMinutes: { min: 0, max: 600 },
  playingDays: { min: 1, max: 14 },
} as const;

/** A whole number in [min, max]: '' -> null; a bad or out-of-range value -> NaN. */
export function parseInRange(text: string, range: { readonly min: number; readonly max: number }): number | null {
  const n = parseWhole(text, String(range.max).length);
  if (n === null) return null;
  return Number.isNaN(n) || n < range.min || n > range.max ? Number.NaN : n;
}

/** A draw number typed by the owner: '' -> null (a new random draw); 0 to 4294967295 -> that number; anything else -> NaN. */
export const parseDrawNumber = (text: string): number | null => parseInRange(text, COMP_LIMITS.drawNumber);

// ----------------------------------------------------------------------------- players and entries

export interface PlayerLike {
  displayName: string;
  isProtected: boolean;
}

/** The owner's view of an entry: names joined with " / " (protected players included, the owner may see them). */
export function ownerEntryName(e: Pick<CompetitionEntryDto, 'players'>): string {
  return e.players.map((p) => p.displayName).join(' / ') || 'No players';
}

/** The public view of an entry: "Protected player" for anyone protected, or for every player of a protected entry (fail closed). */
export function publicEntryName(e: Pick<CompetitionEntryDto, 'players' | 'isProtected'>): string {
  return sideName(publicRefs(e));
}

function publicRefs(e: Pick<CompetitionEntryDto, 'players' | 'isProtected'>): PlayerRef[] {
  return e.players.map((p) => (e.isProtected || p.isProtected ? { name: null, protected: true } : { name: p.displayName, protected: false }));
}

export type PreviewMode = 'owner' | 'public';

function slotFor(entryId: string | null | undefined, entries: ReadonlyMap<string, CompetitionEntryDto>, mode: PreviewMode): SlotView {
  if (!entryId) return { kind: 'tbd' };
  const e = entries.get(entryId);
  if (!e) return { kind: 'entry', players: [{ name: null, protected: true }] };
  const players = mode === 'owner' ? e.players.map((p) => ({ name: p.displayName, protected: false })) : publicRefs(e);
  return { kind: 'entry', players, seed: e.seed };
}

/**
 * The knockout bracket of a draw (slots by line, byes as null), round by round, earliest round first. Results are applied only when
 * confirmed (the server does the same). In the public view only a confirmed result shows a winner or a score.
 */
export function knockoutPreview(
  slots: readonly CompSlotRow[],
  entries: readonly CompetitionEntryDto[],
  matches: readonly CompetitionMatchDto[],
  mode: PreviewMode,
): { columns: BracketColumn[]; problems: string[]; unconfirmed: string[] } {
  const rows = matches.map((m) => ({ ...m, eventId: '' }));
  const { bracket, problems } = bracketFor(slots, rows);
  if (!bracket) return { columns: [], problems, unconfirmed: [] };
  /** Owner view only: the bracket ids whose result is shown although it is not confirmed yet (the screen marks them). */
  const unconfirmed: string[] = [];
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  const byNumber = new Map(matches.map((m) => [m.matchNumber, m]));
  const view = (i: number): BracketMatchView | null => {
    const m = bracket.matches[i]!;
    if (m.state === 'void') return null;
    const dto = byNumber.get(i + 1);
    const show = dto && (mode === 'owner' || dto.confirmed);
    if (show && !dto.confirmed && (dto.winnerSide !== null || dto.games.length > 0)) unconfirmed.push(`${m.id}`);
    const toSlot = (s: (typeof m)['a']): SlotView => (s.kind === 'bye' ? { kind: 'bye' } : s.kind === 'tbd' ? { kind: 'tbd' } : slotFor(s.entryId, byEntry, mode));
    return { id: `${m.id}`, a: toSlot(m.a), b: toSlot(m.b), status: show ? dto.status : 'scheduled', winner: show ? dto.winnerSide : null, games: show ? dto.games : [] };
  };
  const rounds = bracket.rounds.map((code) => ({
    code,
    matches: bracket.matches.map((m, i) => (m.round === code ? view(i) : null)).filter((x): x is BracketMatchView => x !== null),
  }));
  return { columns: bracketColumns(rounds), problems, unconfirmed };
}

export { bracketMatchSummary };

/** League and group draws: the groups in slot order ("Group A" ... or one "Everyone plays everyone" list). */
export function groupPreview(slots: readonly CompSlotRow[], entries: readonly CompetitionEntryDto[], mode: PreviewMode): { label: string; names: string[] }[] {
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  const out: { label: string; names: string[] }[] = [];
  for (const s of [...slots].sort((a, b) => a.position - b.position)) {
    if (s.entryId === null) continue;
    const label = s.group ? `Group ${s.group}` : 'Everyone plays everyone';
    let g = out[out.length - 1];
    if (!g || g.label !== label) {
      g = { label, names: [] };
      out.push(g);
    }
    const e = byEntry.get(s.entryId);
    g.names.push(e ? (mode === 'owner' ? ownerEntryName(e) : publicEntryName(e)) : PROTECTED_LABEL);
  }
  return out;
}

/** The two sides of a match for the owner: entry names, or "To be decided". */
export function matchSides(m: Pick<CompetitionMatchDto, 'sideA' | 'sideB'>, entries: readonly CompetitionEntryDto[]): { a: string; b: string } {
  const by = new Map(entries.map((e) => [e.id, e]));
  const name = (id: string | null) => (id ? (by.get(id) ? ownerEntryName(by.get(id)!) : 'Unknown entry') : 'To be decided');
  return { a: name(m.sideA), b: name(m.sideB) };
}

// ----------------------------------------------------------------------------- results

export interface ResultDraft {
  status: ResultStatus;
  games: { a: string; b: string }[];
  walkoverWinner: Side | null;
  retiringSide: Side | null;
}

export const emptyResultDraft = (games = 0): ResultDraft => ({ status: 'completed', games: Array.from({ length: games }, () => ({ a: '', b: '' })), walkoverWinner: null, retiringSide: null });

/**
 * The result form filled in from what is saved on a match, so "Change the result" starts from the saved result: the games, the ending,
 * who went through on a walkover (the winner) and who stopped playing on a retirement (the side opposite the winner).
 * A match with no result yet gets an empty form with `games` boxes.
 */
export function draftFromMatch(m: Pick<CompetitionMatchDto, 'status' | 'winnerSide' | 'games'>, games: number): ResultDraft {
  const status = m.status as string;
  if (status !== 'completed' && status !== 'walkover' && status !== 'retired' && status !== 'abandoned') return emptyResultDraft(games);
  const other = (s: Side | null): Side | null => (s === 'A' ? 'B' : s === 'B' ? 'A' : null);
  return {
    status,
    games: status === 'walkover' ? [] : m.games.length > 0 ? m.games.map((g) => ({ a: String(g.a), b: String(g.b) })) : emptyResultDraft(games).games,
    walkoverWinner: status === 'walkover' ? m.winnerSide : null,
    retiringSide: status === 'retired' ? other(m.winnerSide) : null,
  };
}

/** The draft as the record the server takes, or the typing problems (empty or non-number scores). */
export function draftToRecord(d: ResultDraft): { record: RecordResultRecord | null; problems: string[] } {
  const problems: string[] = [];
  const games: { a: number; b: number }[] = [];
  const typed = d.status === 'walkover' ? [] : d.games;
  typed.forEach((g, i) => {
    const a = parseWhole(g.a);
    const b = parseWhole(g.b);
    // a game left completely empty was not played (the form shows the boxes of a full match); half-typed is a problem
    if (a === null && b === null) return;
    if (a === null || b === null) problems.push(`Game ${i + 1}: type both scores, or remove the game.`);
    else if (Number.isNaN(a) || Number.isNaN(b) || a > 99 || b > 99) problems.push(`Game ${i + 1}: scores are whole numbers from 0 to 99.`);
    else games.push({ a, b });
  });
  if (problems.length > 0) return { record: null, problems };
  return {
    record: {
      status: d.status,
      games,
      walkoverWinner: d.status === 'walkover' ? d.walkoverWinner : null,
      retiringSide: d.status === 'retired' ? d.retiringSide : null,
    },
    problems: [],
  };
}

export interface LiveCheck {
  ok: boolean;
  /** Plain sentences from the scoring engine (or the typing check). */
  messages: string[];
  winner: Side | null;
  record: RecordResultRecord | null;
}

/** Checks the draft against the event's scoring rules on every key press (the same engine the server runs before saving). */
export function liveResultCheck(d: ResultDraft, ruleset: Ruleset): LiveCheck {
  const { record, problems } = draftToRecord(d);
  if (!record) return { ok: false, messages: problems, winner: null, record: null };
  const c = checkResult(record, ruleset);
  return c.ok ? { ok: true, messages: [], winner: c.winner, record } : { ok: false, messages: c.reasons, winner: null, record };
}

// ----------------------------------------------------------------------------- updating the matches from the draw

/** The button on the event screen that runs competition.syncMatches (the confirm-result notice points at it by this name). */
export const UPDATE_MATCHES_LABEL = 'Update matches';
/** The reason kept in the record of changes when the owner presses the button. */
export const UPDATE_MATCHES_REASON = 'Matches updated from the published draw by owner';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What an update of the matches did, in plain sentences (problems are listed separately by the screen). */
export function syncOutcomeLines(o: MatchSyncOutcome): string[] {
  const lines: string[] = [];
  if (o.created > 0) lines.push(`${plural(o.created, 'match', 'matches')} made.`);
  if (o.updated > 0) lines.push(`${plural(o.updated, 'match', 'matches')} updated.`);
  if (o.advanced.length > 0) lines.push(`${plural(o.advanced.length, 'winner', 'winners')} moved on in the draw.`);
  if (lines.length === 0) lines.push(o.problems.length > 0 ? 'Nothing was changed.' : 'Nothing needed changing: the matches already follow the draw.');
  if (o.problems.length > 0) lines.push(o.problems.length === 1 ? 'One thing needs your attention:' : `${o.problems.length} things need your attention:`);
  return lines;
}

/** The short notice after an update of the matches. */
export function syncOutcomeNotice(o: MatchSyncOutcome): string {
  return syncOutcomeLines(o).filter((l) => !l.endsWith(':')).join(' ') + (o.problems.length > 0 ? ' See the list on the screen.' : '');
}

/** The notice after a result is confirmed; any problem points the owner at the Update matches button. */
export function confirmResultNotice(o: MatchSyncOutcome): string {
  const moved = o.advanced.length > 0 ? ' The winner has moved on in the draw.' : '';
  const check = o.problems.length > 0 ? ` Check: ${o.problems.join(' ')} Then press "${UPDATE_MATCHES_LABEL}" at the top of this event.` : '';
  return `Result confirmed.${moved}${check}`;
}

/** "Side A wins" style sentence for a valid result (or the abandoned note). */
export function outcomeSentence(check: LiveCheck, sides: { a: string; b: string }, status: ResultStatus): string {
  if (!check.ok) return '';
  if (status === 'abandoned') return 'Nobody wins. The match can be played again later.';
  if (check.winner === null) return '';
  return `${check.winner === 'A' ? sides.a : sides.b} wins.`;
}

// ----------------------------------------------------------------------------- times (India time, UTC+05:30 all year: India has no daylight saving)

// istInstant, splitIst and isHhMm live in src/lib/dates.ts (D-030: one date module).

/** "14 November 2026, 9:30 am IST", or "Time not set". */
export function whenText(instant: string | null): string {
  if (!instant) return 'Time not set';
  const date = formatDateIst(instant);
  const time = formatTimeIst(instant);
  return date && time ? `${date}, ${time}` : 'Time not set';
}

export interface WindowDraft {
  date: string;
  start: string;
  end: string;
}

/** Checks the playing days of a schedule; returns the windows or a sentence per bad row. */
export function windowsProblems(ws: readonly WindowDraft[]): string[] {
  if (ws.length === 0) return ['Add at least one playing day.'];
  const out: string[] = [];
  if (ws.length > COMP_LIMITS.playingDays.max) out.push(`Plan at most ${COMP_LIMITS.playingDays.max} playing days at a time.`);
  ws.forEach((w, i) => {
    const n = `Day ${i + 1}`;
    if (!isIsoDate(w.date)) out.push(`${n}: type the date like 2026-11-14.`);
    if (!isHhMm(w.start) || !isHhMm(w.end)) out.push(`${n}: type the times like 09:00 and 18:30 (24-hour clock).`);
    else if (w.start >= w.end) out.push(`${n}: the end time must be after the start time.`);
  });
  return out;
}

// ----------------------------------------------------------------------------- the ranking points table form

export type PointsDraft = {
  label: string;
  windowDays: string;
  bestN: string;
  levels: Record<string, Partial<Record<Finish, string>>>;
};

export function pointsDraftFrom(t: ApprovedPointsTable | null): PointsDraft {
  if (!t) return { label: '', windowDays: '', bestN: '', levels: {} };
  const levels: PointsDraft['levels'] = {};
  for (const [level, row] of Object.entries(t.levels)) {
    levels[level] = {};
    for (const f of FINISHES) if (row[f] !== undefined) levels[level]![f] = String(row[f]);
  }
  return { label: t.label, windowDays: String(t.windowDays), bestN: String(t.bestN), levels };
}

/** The draft as a record (blank boxes left out, a level with no typed box left out) plus the same checks the server makes. */
export function pointsDraftToRecord(d: PointsDraft): { record: PointsTableRecord | null; errors: Record<string, string> } {
  const levels: PointsTableRecord['levels'] = {};
  let bad = false;
  for (const level of TOURNAMENT_LEVELS) {
    const row = d.levels[level] ?? {};
    const out: Partial<Record<Finish, number>> = {};
    for (const f of FINISHES) {
      const v = parseWhole(row[f] ?? '');
      if (v === null) continue;
      if (Number.isNaN(v)) bad = true;
      else out[f] = v;
    }
    if (Object.keys(out).length > 0) levels[level] = out;
  }
  const windowDays = parseWhole(d.windowDays);
  const bestN = parseWhole(d.bestN);
  const record: PointsTableRecord = { label: d.label, levels, windowDays: windowDays === null ? Number.NaN : windowDays, bestN: bestN === null ? Number.NaN : bestN };
  const errors = pointsTableProblems(record);
  if (bad) errors['levels'] = 'Points must be whole numbers from 0 to 100000.';
  return Object.keys(errors).length > 0 ? { record: null, errors } : { record, errors: {} };
}

// ----------------------------------------------------------------------------- rankings: players who became protected later

/**
 * True when the row is a protected player now (a reset age, a minor found after the ranking was worked out). The server sends
 * `isProtected` on every ranking row; anything but an explicit `false` (a missing or garbled flag) counts as protected (fail closed,
 * D-012). The screen marks such rows and will not publish the ranking while any is there.
 */
export function rankingRowProtected(r: Pick<CompetitionRankingRowDto, 'isProtected'>): boolean {
  return r.isProtected !== false;
}

/** How many rows of a ranking are protected players now. */
export const protectedRankingRows = (rows: readonly Pick<CompetitionRankingRowDto, 'isProtected'>[]): number => rows.filter(rankingRowProtected).length;

// ----------------------------------------------------------------------------- the schedule's event and court boxes

/**
 * The ticked ids: everything except what the owner unticked. Kept as a "left out" list so a court or event added later is ticked by
 * default (an "only these" list would silently leave a new court out of the plan).
 */
export function includedIds(all: readonly string[], leftOut: readonly string[]): string[] {
  const out = new Set(leftOut);
  return all.filter((id) => !out.has(id));
}

/** The "left out" list after ticking (on) or unticking (off) one box. */
export function toggleLeftOut(leftOut: readonly string[], id: string, on: boolean): string[] {
  return on ? leftOut.filter((x) => x !== id) : leftOut.includes(id) ? [...leftOut] : [...leftOut, id];
}
