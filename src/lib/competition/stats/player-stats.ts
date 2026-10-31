// Player statistics (Module 6, Phase A): per-player totals, head-to-head and partner history from match results. PURE: no I/O,
// no clock, no randomness; the input is never changed. Nothing here is published or wired into a page, the admin or the database.
//
// Rules and decisions:
// - Only DECIDED, CONFIRMED matches count (types.ts: DECIDED_STATUSES, MatchResult.confirmed). Matches with no result, an
//   `abandoned` result, an unconfirmed result, broken data (bad date, wrong side size for the category, a player twice, a decided
//   status without a winner) or a repeated match id are excluded and COUNTED by reason in `limitations`. A repeated id keeps ONE copy
//   for everybody: the first copy that is decided, confirmed and valid (so a corrected, confirmed copy wins over an earlier broken or
//   unconfirmed one); when no copy is usable, the first copy. The other copies count as `duplicate_id` for the players they name.
// - "Played" = `completed` + `retired` (a retirement is a match that was started; the side that did not retire wins it).
//   A `walkover` is NOT played: it is reported separately (walkovers won / lost) and is not in won, lost, win % or recent form.
// - Games and points come only from `completed` matches whose game scores are a full, valid record of the match (every game a
//   legal finished game under the GameRules, the winner reaching `gamesToWin` in the last game, the scores agreeing with the
//   recorded winner). Completed matches without such scores are counted in `matchesWithoutFullScores`; retired matches never
//   contribute games or points (their last game is unfinished). Default GameRules = BWF Laws of Badminton, Law 7 (best of three
//   games to 21, win by 2, capped at 30); local events often differ, so it is configurable.
// - Titles = won a match in round `F` (a walkover in the final still wins the title). Finals and semifinal appearances = any
//   counted match (walkovers included: the player reached that round) in round `F` / `SF`. A third-place play-off (`3P`) is
//   neither.
// - Disciplines: MS, WS, BS, GS = singles; MD, WD, BD, GD = doubles; XD = mixed. Doubles and mixed results credit BOTH partners.
// - Ordering (recent form, head-to-head list): by date, then the optional `order` number (a match's place in the day), then id.
// - The caller decides visibility: protected players (D-012) must be filtered out BEFORE any figure here is shown publicly.
import { isIsoDate } from '../../dates';
import { validateGame } from '../scoring';
import { DECIDED_STATUSES } from '../types';
import type { Category, DecidedStatus, GameScore, IsoDate, MatchResult, RoundCode, Side } from '../types';

export type Discipline = 'singles' | 'doubles' | 'mixed';
export const DISCIPLINES: readonly Discipline[] = ['singles', 'doubles', 'mixed'];

/** One match as the statistics need it: who played on each side, the event category, the round and the (maybe missing) result. */
export interface StatsMatch {
  id: string;
  /** The match date (IST calendar date). */
  date: IsoDate;
  /** Optional place in the day, for ordering matches on the same date. */
  order?: number;
  category: Category;
  round: RoundCode;
  tournamentId?: string;
  sideA: readonly string[];
  sideB: readonly string[];
  result: MatchResult | null;
}

/** Game rules used only to decide whether game scores are a full, valid record. Default: BWF Laws of Badminton, Law 7. */
export interface GameRules {
  gamesToWin: number;
  pointsToWin: number;
  winBy: number;
  /** Outright winning score whatever the lead; null = no cap. */
  pointCap: number | null;
}

export const DEFAULT_GAME_RULES: Readonly<GameRules> = Object.freeze({ gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 30 });

export type ExclusionReason = 'no_result' | 'not_decided' | 'unconfirmed' | 'invalid_match' | 'duplicate_id';
export const EXCLUSION_REASONS: readonly ExclusionReason[] = ['no_result', 'not_decided', 'unconfirmed', 'invalid_match', 'duplicate_id'];

/** Plain-English meaning of each exclusion reason (for the admin). */
export const EXCLUSION_LABELS: Readonly<Record<ExclusionReason, string>> = Object.freeze({
  no_result: 'No result recorded yet',
  not_decided: 'Abandoned, not decided',
  unconfirmed: 'Result not confirmed',
  invalid_match: 'Match data is incomplete or inconsistent',
  duplicate_id: 'The same match was listed twice',
});

export type FormMark = 'W' | 'L';

export interface StatsBlock {
  /** Completed + retired. */
  played: number;
  won: number;
  lost: number;
  /** won / played x 100, one decimal; null when nothing was played. */
  winPercent: number | null;
  /** Not counted as played, won or lost. */
  walkovers: { won: number; lost: number };
  /** Retired matches inside `played` (won = the opponent retired). */
  retirements: { won: number; lost: number };
  games: { won: number; lost: number };
  points: { won: number; lost: number };
  /** Completed matches whose games and points were counted. */
  matchesWithFullScores: number;
  /** Completed matches without a full, valid score (their games and points are missing from the totals). */
  matchesWithoutFullScores: number;
  titles: number;
  finals: number;
  semifinals: number;
  /** Most recent first, played matches only. */
  form: FormMark[];
}

export interface DataLimitations {
  /** Matches in the input that involve the player(s). */
  considered: number;
  /** Of those, the matches used. */
  counted: number;
  excluded: Record<ExclusionReason, number>;
  walkoversNotCountedAsPlayed: number;
  completedWithoutFullScores: number;
  retiredWithoutPoints: number;
  /** Plain-English notes for the admin; empty when nothing was left out. */
  notes: string[];
}

export interface PlayerStats {
  playerId: string;
  overall: StatsBlock;
  byDiscipline: Record<Discipline, StatsBlock>;
  limitations: DataLimitations;
}

export interface PlayerStatsOptions {
  /** Length of recent form (default 5). */
  formLength?: number;
  gameRules?: GameRules;
}

const SINGLES: ReadonlySet<Category> = new Set<Category>(['MS', 'WS', 'BS', 'GS']);

/** The discipline of an event category. */
export function disciplineOf(category: Category): Discipline {
  if (SINGLES.has(category)) return 'singles';
  return category === 'XD' ? 'mixed' : 'doubles';
}

// ---------------------------------------------------------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------------------------------------------------------

interface UsableMatch {
  match: StatsMatch;
  status: DecidedStatus;
  winner: Side;
  games: readonly GameScore[];
  discipline: Discipline;
}

interface Screened {
  usable: UsableMatch[];
  considered: number;
  excluded: Record<ExclusionReason, number>;
}

function emptyExclusions(): Record<ExclusionReason, number> {
  return { no_result: 0, not_decided: 0, unconfirmed: 0, invalid_match: 0, duplicate_id: 0 };
}

function isDecided(status: MatchResult['status']): status is DecidedStatus {
  return (DECIDED_STATUSES as readonly string[]).includes(status);
}

function structurallyValid(m: StatsMatch): boolean {
  if (!isIsoDate(m.date)) return false;
  if (m.order !== undefined && !Number.isFinite(m.order)) return false;
  const size = disciplineOf(m.category) === 'singles' ? 1 : 2;
  if (m.sideA.length !== size || m.sideB.length !== size) return false;
  const all = [...m.sideA, ...m.sideB];
  if (all.some((p) => typeof p !== 'string' || p.trim() === '')) return false;
  return new Set(all).size === all.length;
}

/** Why a match copy cannot be used, or null when it is decided, confirmed and valid. The same for every player. */
function unusableReason(match: StatsMatch): Exclude<ExclusionReason, 'duplicate_id'> | null {
  const r = match.result;
  if (r === null) return 'no_result';
  if (!isDecided(r.status)) return 'not_decided';
  if (!r.confirmed) return 'unconfirmed';
  if (r.winner === null || !structurallyValid(match)) return 'invalid_match';
  return null;
}

/** For each match id, the index of the copy that counts: the first usable copy, else the first copy (input order otherwise). */
function chosenCopies(matches: readonly StatsMatch[]): Map<string, number> {
  const chosen = new Map<string, number>();
  const usable = new Set<string>();
  matches.forEach((m, i) => {
    const ok = unusableReason(m) === null;
    if (!chosen.has(m.id) || (ok && !usable.has(m.id))) {
      chosen.set(m.id, i);
      if (ok) usable.add(m.id);
    }
  });
  return chosen;
}

function screen(matches: readonly StatsMatch[], involves: (m: StatsMatch) => boolean): Screened {
  const excluded = emptyExclusions();
  const usable: UsableMatch[] = [];
  const chosen = chosenCopies(matches);
  let considered = 0;
  matches.forEach((match, i) => {
    if (!involves(match)) return;
    considered += 1;
    if (chosen.get(match.id) !== i) {
      excluded.duplicate_id += 1;
      return;
    }
    const reason = unusableReason(match);
    const r = match.result;
    if (reason !== null || r === null || r.winner === null || !isDecided(r.status)) {
      excluded[reason ?? 'invalid_match'] += 1;
      return;
    }
    usable.push({ match, status: r.status, winner: r.winner, games: r.games, discipline: disciplineOf(match.category) });
  });
  usable.sort(compareUsable);
  return { usable, considered, excluded };
}

function compareUsable(x: UsableMatch, y: UsableMatch): number {
  if (x.match.date !== y.match.date) return x.match.date < y.match.date ? -1 : 1;
  const ox = x.match.order ?? 0;
  const oy = y.match.order ?? 0;
  if (ox !== oy) return ox - oy;
  return x.match.id < y.match.id ? -1 : x.match.id > y.match.id ? 1 : 0;
}

function sideOf(m: StatsMatch, playerId: string): Side | null {
  if (m.sideA.includes(playerId)) return 'A';
  if (m.sideB.includes(playerId)) return 'B';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Game-score validation
// ---------------------------------------------------------------------------------------------------------------------------

function validRules(r: GameRules): boolean {
  const posInt = (n: number): boolean => Number.isInteger(n) && n > 0;
  return (
    posInt(r.gamesToWin) && posInt(r.pointsToWin) && posInt(r.winBy) && (r.pointCap === null || (Number.isInteger(r.pointCap) && r.pointCap >= r.pointsToWin))
  );
}

/**
 * The side that won a legally finished game, or null when the score is not a finished game under the rules. One rule for the whole
 * platform: this asks the scoring engine (src/lib/competition/scoring validateGame), so a score is valid here exactly when it is valid
 * there (for example, with a winning lead of 1, 22-21 is refused because the game ended at 21-20).
 */
export function gameWinner(game: GameScore, rules: GameRules = DEFAULT_GAME_RULES): Side | null {
  if (!validRules(rules)) return null;
  return validateGame(game, { ...rules, intervalAt: null, changeEndsInDecidingGameAt: null }).winner;
}

/** True when the games are a full, valid record of a completed match won by `winner`. */
export function hasFullScores(games: readonly GameScore[], winner: Side, rules: GameRules = DEFAULT_GAME_RULES): boolean {
  if (games.length === 0) return false;
  let a = 0;
  let b = 0;
  for (let i = 0; i < games.length; i += 1) {
    if (a === rules.gamesToWin || b === rules.gamesToWin) return false; // a game after the match was already won
    const g = games[i];
    if (g === undefined) return false;
    const w = gameWinner(g, rules);
    if (w === null) return false;
    if (w === 'A') a += 1;
    else b += 1;
  }
  return winner === 'A' ? a === rules.gamesToWin && b < rules.gamesToWin : b === rules.gamesToWin && a < rules.gamesToWin;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Player statistics
// ---------------------------------------------------------------------------------------------------------------------------

function emptyBlock(): StatsBlock {
  return {
    played: 0,
    won: 0,
    lost: 0,
    winPercent: null,
    walkovers: { won: 0, lost: 0 },
    retirements: { won: 0, lost: 0 },
    games: { won: 0, lost: 0 },
    points: { won: 0, lost: 0 },
    matchesWithFullScores: 0,
    matchesWithoutFullScores: 0,
    titles: 0,
    finals: 0,
    semifinals: 0,
    form: [],
  };
}

function percent(won: number, played: number): number | null {
  return played === 0 ? null : Math.round((won / played) * 1000) / 10;
}

function checkPositiveInt(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`${name} must be a whole number of at least 1`);
}

/**
 * Statistics for one player from decided, confirmed matches, overall and by discipline, with an explicit list of what was left
 * out. Throws RangeError for an empty player id or bad options.
 */
export function playerStats(matches: readonly StatsMatch[], playerId: string, options: PlayerStatsOptions = {}): PlayerStats {
  if (typeof playerId !== 'string' || playerId.trim() === '') throw new RangeError('playerStats needs a player id');
  const formLength = options.formLength ?? 5;
  checkPositiveInt(formLength, 'formLength');
  const rules = options.gameRules ?? DEFAULT_GAME_RULES;
  if (!validRules(rules)) throw new RangeError('gameRules are not valid whole numbers');

  const { usable, considered, excluded } = screen(matches, (m) => sideOf(m, playerId) !== null);
  const overall = emptyBlock();
  const byDiscipline: Record<Discipline, StatsBlock> = { singles: emptyBlock(), doubles: emptyBlock(), mixed: emptyBlock() };
  const forms: Record<Discipline | 'overall', FormMark[]> = { overall: [], singles: [], doubles: [], mixed: [] };
  let walkovers = 0;
  let withoutScores = 0;
  let retired = 0;

  for (const u of usable) {
    const side = sideOf(u.match, playerId);
    if (side === null) continue;
    const won = u.winner === side;
    const blocks = [overall, byDiscipline[u.discipline]];
    for (const block of blocks) {
      if (u.match.round === 'F') block.finals += 1;
      if (u.match.round === 'SF') block.semifinals += 1;
      if (u.match.round === 'F' && won) block.titles += 1;
      if (u.status === 'walkover') {
        if (won) block.walkovers.won += 1;
        else block.walkovers.lost += 1;
        continue;
      }
      block.played += 1;
      if (won) block.won += 1;
      else block.lost += 1;
      if (u.status === 'retired') {
        if (won) block.retirements.won += 1;
        else block.retirements.lost += 1;
        continue;
      }
      if (!hasFullScores(u.games, u.winner, rules)) {
        block.matchesWithoutFullScores += 1;
        continue;
      }
      block.matchesWithFullScores += 1;
      for (const g of u.games) {
        const mine = side === 'A' ? g.a : g.b;
        const theirs = side === 'A' ? g.b : g.a;
        block.points.won += mine;
        block.points.lost += theirs;
        if (mine > theirs) block.games.won += 1;
        else block.games.lost += 1;
      }
    }
    if (u.status === 'walkover') {
      walkovers += 1;
      continue;
    }
    if (u.status === 'retired') retired += 1;
    else if (!hasFullScores(u.games, u.winner, rules)) withoutScores += 1;
    const mark: FormMark = won ? 'W' : 'L';
    forms.overall.push(mark);
    forms[u.discipline].push(mark);
  }

  const finish = (block: StatsBlock, form: FormMark[]): void => {
    block.winPercent = percent(block.won, block.played);
    block.form = form.slice(-formLength).reverse();
  };
  finish(overall, forms.overall);
  for (const d of DISCIPLINES) finish(byDiscipline[d], forms[d]);

  return {
    playerId,
    overall,
    byDiscipline,
    limitations: buildLimitations(considered, usable.length, excluded, walkovers, withoutScores, retired),
  };
}

function buildLimitations(
  considered: number,
  counted: number,
  excluded: Record<ExclusionReason, number>,
  walkovers: number,
  withoutScores: number,
  retired: number,
): DataLimitations {
  const notes: string[] = [];
  for (const reason of EXCLUSION_REASONS) {
    const n = excluded[reason];
    if (n > 0) notes.push(`${n} ${n === 1 ? 'match' : 'matches'} left out: ${EXCLUSION_LABELS[reason].toLowerCase()}.`);
  }
  if (walkovers > 0) notes.push(`${walkovers} ${walkovers === 1 ? 'walkover is' : 'walkovers are'} not counted as played, won or lost.`);
  if (withoutScores > 0) notes.push(`${withoutScores} completed ${withoutScores === 1 ? 'match has' : 'matches have'} no full score, so games and points are incomplete.`);
  if (retired > 0) notes.push(`${retired} retired ${retired === 1 ? 'match does' : 'matches do'} not count towards games and points.`);
  return {
    considered,
    counted,
    excluded,
    walkoversNotCountedAsPlayed: walkovers,
    completedWithoutFullScores: withoutScores,
    retiredWithoutPoints: retired,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Head-to-head
// ---------------------------------------------------------------------------------------------------------------------------

export interface Meeting {
  matchId: string;
  date: IsoDate;
  category: Category;
  round: RoundCode;
  status: DecidedStatus;
  /** Which of the two players won. */
  winner: 'a' | 'b';
  /** Games from player a's point of view, only when the scores are full and valid. */
  games: GameScore[] | null;
}

export interface HeadToHead {
  a: string;
  b: string;
  /** Wins in played matches (completed + retired). */
  aWins: number;
  bWins: number;
  walkovers: { a: number; b: number };
  /** Oldest first. */
  meetings: Meeting[];
  limitations: DataLimitations;
}

/**
 * Head-to-head of two players: every decided, confirmed match where they were on OPPOSITE sides (singles or doubles, whoever
 * their partners were). Matches where they were partners are not meetings. Throws RangeError for empty or equal ids.
 */
export function headToHead(matches: readonly StatsMatch[], a: string, b: string, gameRules: GameRules = DEFAULT_GAME_RULES): HeadToHead {
  if (typeof a !== 'string' || typeof b !== 'string' || a.trim() === '' || b.trim() === '') throw new RangeError('headToHead needs two player ids');
  if (a === b) throw new RangeError('headToHead needs two different players');
  if (!validRules(gameRules)) throw new RangeError('gameRules are not valid whole numbers');
  const opposite = (m: StatsMatch): boolean => {
    const sa = sideOf(m, a);
    const sb = sideOf(m, b);
    return sa !== null && sb !== null && sa !== sb;
  };
  const { usable, considered, excluded } = screen(matches, opposite);
  const result: HeadToHead = { a, b, aWins: 0, bWins: 0, walkovers: { a: 0, b: 0 }, meetings: [], limitations: buildLimitations(0, 0, excluded, 0, 0, 0) };
  let walkovers = 0;
  let withoutScores = 0;
  let retired = 0;
  for (const u of usable) {
    const sideA = sideOf(u.match, a);
    if (sideA === null) continue;
    const aWon = u.winner === sideA;
    if (u.status === 'walkover') {
      walkovers += 1;
      if (aWon) result.walkovers.a += 1;
      else result.walkovers.b += 1;
    } else if (aWon) result.aWins += 1;
    else result.bWins += 1;
    if (u.status === 'retired') retired += 1;
    const full = u.status === 'completed' && hasFullScores(u.games, u.winner, gameRules);
    if (u.status === 'completed' && !full) withoutScores += 1;
    result.meetings.push({
      matchId: u.match.id,
      date: u.match.date,
      category: u.match.category,
      round: u.match.round,
      status: u.status,
      winner: aWon ? 'a' : 'b',
      games: full ? u.games.map((g) => (sideA === 'A' ? { a: g.a, b: g.b } : { a: g.b, b: g.a })) : null,
    });
  }
  result.limitations = buildLimitations(considered, usable.length, excluded, walkovers, withoutScores, retired);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Partner history
// ---------------------------------------------------------------------------------------------------------------------------

export interface PartnerRecord {
  partnerId: string;
  /** Completed + retired together. */
  played: number;
  won: number;
  lost: number;
  winPercent: number | null;
  walkovers: { won: number; lost: number };
  disciplines: Discipline[];
  firstDate: IsoDate;
  lastDate: IsoDate;
}

export interface PartnerHistory {
  playerId: string;
  /** Most matches played together first, then by partner id. */
  partners: PartnerRecord[];
  limitations: DataLimitations;
}

/** Every partner a player had in doubles and mixed (decided, confirmed matches only), with the record together. */
export function partnerHistory(matches: readonly StatsMatch[], playerId: string): PartnerHistory {
  if (typeof playerId !== 'string' || playerId.trim() === '') throw new RangeError('partnerHistory needs a player id');
  const doublesWith = (m: StatsMatch): boolean => disciplineOf(m.category) !== 'singles' && sideOf(m, playerId) !== null;
  const { usable, considered, excluded } = screen(matches, doublesWith);
  const byPartner = new Map<string, PartnerRecord>();
  let walkovers = 0;
  for (const u of usable) {
    const side = sideOf(u.match, playerId);
    if (side === null) continue;
    const partnerId = (side === 'A' ? u.match.sideA : u.match.sideB).find((p) => p !== playerId);
    if (partnerId === undefined) continue;
    const rec = byPartner.get(partnerId) ?? {
      partnerId,
      played: 0,
      won: 0,
      lost: 0,
      winPercent: null,
      walkovers: { won: 0, lost: 0 },
      disciplines: [],
      firstDate: u.match.date,
      lastDate: u.match.date,
    };
    const won = u.winner === side;
    if (u.status === 'walkover') {
      walkovers += 1;
      if (won) rec.walkovers.won += 1;
      else rec.walkovers.lost += 1;
    } else {
      rec.played += 1;
      if (won) rec.won += 1;
      else rec.lost += 1;
    }
    if (!rec.disciplines.includes(u.discipline)) rec.disciplines.push(u.discipline);
    rec.lastDate = u.match.date; // usable is sorted oldest first
    byPartner.set(partnerId, rec);
  }
  const partners = [...byPartner.values()].map((r) => ({
    ...r,
    winPercent: percent(r.won, r.played),
    disciplines: DISCIPLINES.filter((d) => r.disciplines.includes(d)),
  }));
  partners.sort((x, y) => y.played - x.played || (x.partnerId < y.partnerId ? -1 : x.partnerId > y.partnerId ? 1 : 0));
  return { playerId, partners, limitations: buildLimitations(considered, usable.length, excluded, walkovers, 0, 0) };
}
