// Local ranking input for the admin (PURE). Turns CONFIRMED results into finishes and runs stats/localRanking with the points table the
// owner approved (D-110). Never from YouTube data. Everyone the public site may not name is left out BEFORE the ranking is worked out:
// protected players (not adult_confirmed), every player of a junior event or minor-signal tournament, and adults outside
// app.competition_named_players (hidden, provisional, merged or suppressed; 0018). So the stored ranks have no gap that could
// point at a left-out player (D-012, D-109, fail closed). Only approved tournaments (published or completed) count.
import { standings } from '../../competition/brackets';
import { localRanking, RANKING_DISCLAIMER, type Finish, type RankingResult } from '../../competition/stats/ranking';
import { isJuniorAgeGroup } from '../../competition/db';
import { bracketFor } from './draw';
import type { ApprovedPointsTable, CompDrawRow, CompEntryRow, CompEventRow, CompMatchRow, CompPlayerRef, CompTournamentRef } from './types';
import type { Category } from '../../parser/types';

const JUNIOR_CATEGORIES = new Set(['BS', 'GS', 'BD', 'GD']);

export function isJuniorScope(category: Category | null, ageGroup: string | null): boolean {
  return (category !== null && JUNIOR_CATEGORIES.has(category)) || isJuniorAgeGroup(ageGroup);
}

export interface RankingInput {
  category: Category | null;
  ageGroup: string | null;
  asOf: string;
  table: ApprovedPointsTable;
  tournaments: ReadonlyMap<string, CompTournamentRef>;
  events: readonly CompEventRow[];
  draws: ReadonlyMap<string, CompDrawRow>;
  matches: readonly CompMatchRow[];
  entries: readonly CompEntryRow[];
  players: ReadonlyMap<string, CompPlayerRef>;
  /** The players competition pages may name (app.competition_named_players, 0018). Anyone else is left out. */
  rankable: ReadonlySet<string>;
}

/** Tournament statuses whose results count: approved ones. pending (not approved yet), cancelled and rejected never count. */
export const RANKED_TOURNAMENT_STATUSES: ReadonlySet<string> = new Set(['published', 'completed']);

export interface RankingOutput {
  rows: { playerId: string; rank: number; points: number; eventsCounted: number }[];
  protectedLeftOut: number;
  excluded: string[];
  formula: string;
  disclaimer: string;
}

/** Each finished entry's finish in each event in scope; null while an entry is still in the event. */
function finishesOf(event: CompEventRow, draw: CompDrawRow | undefined, matches: readonly CompMatchRow[]): Map<string, Finish> {
  const out = new Map<string, Finish>();
  if (!draw || draw.status === 'draft') return out;
  if (event.format === 'knockout') {
    const { bracket } = bracketFor(draw.slots, matches);
    if (!bracket) return out;
    for (const s of standings(bracket).entries) {
      if (s.finish === 'champion') out.set(s.entryId, 'W');
      else if (s.finish === 'runner-up') out.set(s.entryId, 'F');
      else if (s.finish === 'semifinalist' || s.finish === 'third' || s.finish === 'fourth') out.set(s.entryId, 'SF');
      else if (s.finish === 'eliminated') out.set(s.entryId, s.roundReached as Finish);
    }
    return out;
  }
  // a league or group stage counts once every one of its matches has a confirmed result
  if (matches.length === 0 || matches.some((m) => !m.confirmed)) return out;
  const finish: Finish = event.format === 'round_robin' ? 'league' : 'group';
  for (const s of draw.slots) if (s.entryId) out.set(s.entryId, finish);
  return out;
}

export function rankingFromResults(input: RankingInput): RankingOutput {
  const results: RankingResult[] = [];
  const protectedIds = new Set<string>();
  const notPublic = new Set<string>();
  const notes = new Set<string>();
  let sharedFinish = false;
  const entryById = new Map(input.entries.map((e) => [e.id, e]));
  for (const event of input.events) {
    if (input.category !== null && event.category !== input.category) continue;
    if (event.ageGroup !== input.ageGroup) continue;
    const t = input.tournaments.get(event.tournamentId);
    if (!t) continue;
    const junior = event.isJunior || t.minorSignal;
    const finishes = finishesOf(event, input.draws.get(event.id), input.matches.filter((m) => m.eventId === event.id));
    if (finishes.size === 0) continue;
    if (!RANKED_TOURNAMENT_STATUSES.has(t.status)) {
      notes.add(t.status === 'pending' ? `${t.name} is not approved yet, so its results are left out. Approve the tournament first.` : `${t.name} is ${t.status}, so its results are left out.`);
      continue;
    }
    if (event.format !== 'knockout') sharedFinish = true;
    const date = t.endDate ?? t.startDate;
    for (const [entryId, finish] of finishes) {
      const entry = entryById.get(entryId);
      if (!entry) continue;
      for (const playerId of entry.players) {
        const p = input.players.get(playerId);
        if (junior || !p || p.ageStatus !== 'adult_confirmed') {
          protectedIds.add(playerId);
          continue;
        }
        if (!input.rankable.has(playerId)) {
          notPublic.add(playerId);
          continue;
        }
        if (t.level === null) {
          notes.add(`${t.name} has no level set, so its results are left out. Set the level in the tournament details.`);
          continue;
        }
        if (!date) {
          notes.add(`${t.name} has no dates set, so its results are left out. Set the dates in the tournament details.`);
          continue;
        }
        results.push({ entryId: playerId, tournamentId: t.id, level: t.level, finish, date });
      }
    }
  }
  const snap = localRanking(results, { label: input.table.label, approved: true, levels: input.table.levels }, { asOf: input.asOf, windowDays: input.table.windowDays, bestN: input.table.bestN });
  let outside = 0;
  for (const x of snap.excluded) {
    const name = input.tournaments.get(x.result.tournamentId)?.name ?? 'A tournament';
    if (x.reason === 'unknown_level') notes.add(`${name}: its level has no row in the points table, so its results are left out.`);
    else if (x.reason === 'outside_window') outside += 1;
    else if (x.reason === 'duplicate_tournament') notes.add('A player had two results in one tournament; only the better one counts.');
    else notes.add(`${name}: a result could not be read and is left out.`);
  }
  if (notPublic.size > 0) {
    notes.add(
      `${notPublic.size} adult ${notPublic.size === 1 ? 'player is' : 'players are'} left out because the site cannot show their name yet: their profile is hidden, still provisional, or they asked to be removed.`,
    );
  }
  if (sharedFinish) notes.add('League and group events count only as taking part: every player in them gets the same points, whatever their place.');
  if (outside > 0) notes.add(`${outside} ${outside === 1 ? 'result is' : 'results are'} older than the ranking window and left out.`);
  const ranked = new Set(snap.rows.map((r) => r.entryId));
  const leftOut = new Set([...protectedIds, ...notPublic].filter((id) => !ranked.has(id)));
  return {
    rows: snap.rows.map((r) => ({ playerId: r.entryId, rank: r.position, points: r.points, eventsCounted: r.counted.length })),
    protectedLeftOut: leftOut.size,
    excluded: [...notes],
    formula: snap.formula,
    disclaimer: RANKING_DISCLAIMER,
  };
}
