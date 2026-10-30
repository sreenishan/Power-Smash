// The PAGE MODEL of the public competition pages (platform wave 3). PURE: no I/O, no clock (generatedAt comes from the provider),
// no randomness. It turns one RawCompetitionData snapshot into everything the /competitions/ pages lay out, in the shapes of the
// display components in src/components/competition/ (EntryList, BracketView, ScheduleTable, MatchScoreboard, RankingTable).
//
// Rules (tests/competition-public/model.test.ts):
//  - Names only through protect.ts (ONE place, fail closed). No player link anywhere: player pages belong to the archive, which may be
//    out of the build (D-107); a side is a name or "Protected player", nothing more.
//  - A tournament needs a valid slug (paths.ts); an event needs a known tournament and a valid, unique code. Anything else is left
//    out and counted in `dropped`, never given a guessed address.
//  - Results: only confirmed results (the views already hide the rest). A finished match whose result is not confirmed yet
//    ('awaiting_result') shows no winner and no score. A static page never says "Live" (D-113: near-live comes in wave 5): the
//    scoreboards only receive decided matches, and in-progress matches appear in the order of play with their plain status.
//  - Knockout events: the whole bracket is derived with the bracket engine (../brackets) from the published draw lines, and confirmed
//    results advance winners; later rounds read "To be decided". If the lines do not form a valid bracket, the rounds are shown from
//    the match list as stored. Groups (round robin, groups then knockout): one entry table per group; the knockout stage, if any,
//    from the match list.
//  - Knockout tree vs stored matches: if a confirmed stored knockout result does not fit the derived tree (the owner fixed a pairing
//    by hand, a substitution), the tree is NOT shown from the draw lines; the rounds are shown as stored, so the draw and the results
//    list on one page never disagree.
//  - Rankings: published snapshots only (the view returns nothing until the owner publishes AND switches rankings_public on); junior
//    rankings are not shown; protected players are left out (D-109) and the shown rows are RENUMBERED among themselves (ties stay
//    ties, no gaps), so a missing number never hints that a hidden player stands between two shown ones.
//  - Freshness: the pages are a once-per-build snapshot, so they print when it was taken (updatedText).
import { ageGroupLabel } from '../../archive/labels';
import { formatDateRange, formatInstantIst, isIsoDate } from '../../dates';
import { absoluteUrl } from '../../urls';
import { sportsEventJsonLd } from '../../jsonld';
import { BYE, applyResult, createBracket, type Bracket, type Slot } from '../brackets';
import type { GameScore, MatchStatus, RoundCode, Side } from '../types';
import type {
  EventFormat,
  PublicCompetitionDrawSlot,
  PublicCompetitionMatch,
  PublicCompetitionMatchGame,
  PublicMatchStatus,
} from '../db';
import {
  eventLabel,
  type BracketMatchView,
  type BracketRoundView,
  type EntryItem,
  type PlayerRef,
  type RankingItem,
  type ScheduleItem,
  type SlotView,
} from '../../../components/competition/helpers';
import { competitionEventPath, competitionTournamentPath, eventCode, isCompetitionTournamentSlug } from './paths';
import { eventIsJunior, publicSide, rankingIsShowable, rankingRowIsShowable, type ProtectEvent, type SideFace } from './protect';
import type { CompetitionEventRow, CompetitionSource, CompetitionTournamentRow, RawCompetitionData } from './provider';

export interface ResultView {
  id: string;
  a: PlayerRef[];
  b: PlayerRef[];
  status: MatchStatus;
  winner: Side | null;
  games: GameScore[];
  round: RoundCode;
  court: string | null;
}

export interface GroupView {
  label: string;
  entries: EntryItem[];
}

export interface CompetitionEventPage {
  id: string;
  code: string;
  path: string;
  tournamentSlug: string;
  tournamentName: string;
  /** "Men's singles", "Boys' singles, Under 15". */
  title: string;
  category: string;
  ageGroup: string | null;
  format: EventFormat;
  formatText: string;
  status: 'open' | 'closed';
  /** Every player in this event is protected (junior or unrecognised event): the page says so once, plainly. */
  junior: boolean;
  drawPublished: boolean;
  entries: EntryItem[];
  /** Knockout rounds (knockout events, or the knockout stage after groups); null when there is none. */
  bracket: BracketRoundView[] | null;
  groups: GroupView[];
  schedule: ScheduleItem[];
  results: ResultView[];
  /** Finished matches whose result is not confirmed yet (shown with no winner and no score). */
  awaitingCount: number;
}

export interface CompetitionTournamentPage {
  id: string;
  slug: string;
  name: string;
  path: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  venue: string | null;
  status: string | null;
  events: CompetitionEventPage[];
}

export interface RankingPageItem {
  snapshotId: string;
  title: string;
  label: string;
  /** YYYY-MM-DD */
  asOf: string;
  items: RankingItem[];
}

export interface CompetitionSite {
  source: CompetitionSource;
  generatedAt: string;
  tournaments: CompetitionTournamentPage[];
  rankings: RankingPageItem[];
  dropped: { tournaments: number; events: number; rankingSnapshots: number };
}

const FORMAT_TEXT: Record<EventFormat, string> = {
  knockout: 'Knockout',
  round_robin: 'Round robin (everyone plays everyone in the group)',
  groups_knockout: 'Groups, then knockout',
};

const KNOCKOUT_CODES: readonly string[] = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', '3P'];
const DECIDED: readonly string[] = ['completed', 'walkover', 'retired'];
const RESULT_STATUSES: readonly string[] = [...DECIDED, 'abandoned'];

/** "Men's singles, Under 17": category words, then the age-group words when there is one. */
export function eventTitle(category: string, ageGroup: string | null): string {
  const cat = eventLabel(category) || category;
  if (ageGroup === null) return cat;
  return `${cat}, ${ageGroupLabel(ageGroup) ?? ageGroup}`;
}

/** The public status as a display status: a result not confirmed yet reads as finished (no winner, no score is ever attached). */
export function displayStatus(status: PublicMatchStatus): MatchStatus {
  return status === 'awaiting_result' ? 'completed' : status;
}

function flip(side: Side): Side {
  return side === 'A' ? 'B' : 'A';
}

function sideFace(m: PublicCompetitionMatch, side: Side): SideFace {
  return side === 'A'
    ? { player1_name: m.side_a_player1_name, player2_name: m.side_a_player2_name, is_protected: m.side_a_protected }
    : { player1_name: m.side_b_player1_name, player2_name: m.side_b_player2_name, is_protected: m.side_b_protected };
}

function slotFace(s: PublicCompetitionDrawSlot): SideFace {
  return { player1_name: s.player1_name, player2_name: s.player2_name, is_protected: s.is_protected };
}

function isConfirmedResult(m: PublicCompetitionMatch): boolean {
  return m.result_confirmed === true && RESULT_STATUSES.includes(m.status);
}

interface EventContext {
  event: CompetitionEventRow;
  slots: PublicCompetitionDrawSlot[];
  matches: PublicCompetitionMatch[];
  gamesByMatch: Map<string, PublicCompetitionMatchGame[]>;
}

function buildEventParts(ctx: EventContext) {
  const ev: ProtectEvent = { category: ctx.event.category, ageGroup: ctx.event.age_group, isJunior: ctx.event.is_junior };
  // entry id -> face and seed (the draw slot wins; a match side fills in an entry not on a slot)
  const faces = new Map<string, { face: SideFace; seed: number | null }>();
  for (const s of ctx.slots) if (s.entry_id) faces.set(s.entry_id, { face: slotFace(s), seed: s.seed });
  for (const m of ctx.matches) {
    if (m.side_a_entry && !faces.has(m.side_a_entry)) faces.set(m.side_a_entry, { face: sideFace(m, 'A'), seed: null });
    if (m.side_b_entry && !faces.has(m.side_b_entry)) faces.set(m.side_b_entry, { face: sideFace(m, 'B'), seed: null });
  }
  const playersOf = (entryId: string | null): PlayerRef[] => publicSide(entryId ? faces.get(entryId)?.face : null, ev);
  const gamesOf = (matchId: string, swap: boolean): GameScore[] =>
    (ctx.gamesByMatch.get(matchId) ?? []).map((g) => (swap ? { a: g.points_b, b: g.points_a } : { a: g.points_a, b: g.points_b }));
  const entryItem = (s: PublicCompetitionDrawSlot): EntryItem => ({ id: s.entry_id as string, players: playersOf(s.entry_id), seed: s.seed });

  const drawn = ctx.slots.filter((s) => s.entry_id !== null && s.is_bye !== true);
  const entries = drawn.map(entryItem);

  // groups
  const groups: GroupView[] = [];
  if (ctx.event.format !== 'knockout') {
    const byLabel = new Map<string, EntryItem[]>();
    for (const s of drawn) {
      const label = s.group_label && s.group_label.trim() !== '' ? s.group_label.trim() : '';
      const list = byLabel.get(label);
      if (list) list.push(entryItem(s));
      else byLabel.set(label, [entryItem(s)]);
    }
    for (const [label, list] of [...byLabel.entries()].sort((x, y) => x[0].localeCompare(y[0], 'en-IN', { numeric: true }))) {
      groups.push({ label: label === '' ? 'Group' : /^group\b/i.test(label) ? label : `Group ${label}`, entries: list });
    }
  }

  // knockout bracket
  const koMatches = ctx.matches.filter((m) => KNOCKOUT_CODES.includes(m.round_code));
  let bracket: BracketRoundView[] | null = null;
  if (ctx.event.format === 'knockout' && ctx.slots.length > 0) {
    bracket = engineBracket(ctx, koMatches, faces, playersOf, gamesOf);
  }
  if (bracket === null && koMatches.length > 0) bracket = storedBracket(koMatches, playersOf, gamesOf);

  // order of play: every match without a confirmed result
  const schedule: ScheduleItem[] = ctx.matches
    .filter((m) => !isConfirmedResult(m))
    .sort((x, y) => x.match_number - y.match_number)
    .map((m) => ({
      id: m.id,
      startsAt: m.scheduled_at,
      court: m.court_label,
      round: m.round_code,
      a: m.side_a_entry ? playersOf(m.side_a_entry) : [],
      b: m.side_b_entry ? playersOf(m.side_b_entry) : [],
      status: displayStatus(m.status),
    }));

  const results: ResultView[] = ctx.matches
    .filter(isConfirmedResult)
    .sort((x, y) => x.match_number - y.match_number)
    .map((m) => ({
      id: m.id,
      a: playersOf(m.side_a_entry),
      b: playersOf(m.side_b_entry),
      status: m.status as MatchStatus,
      winner: DECIDED.includes(m.status) && (m.winner_side === 'A' || m.winner_side === 'B') ? m.winner_side : null,
      games: gamesOf(m.id, false),
      round: m.round_code,
      court: m.court_label,
    }));

  const awaitingCount = ctx.matches.filter((m) => m.status === 'awaiting_result').length;
  return { entries, groups, bracket, schedule, results, awaitingCount };
}

function slotView(slot: Slot, faces: Map<string, { face: SideFace; seed: number | null }>, playersOf: (id: string | null) => PlayerRef[]): SlotView {
  if (slot.kind === 'bye') return { kind: 'bye' };
  if (slot.kind === 'tbd') return { kind: 'tbd' };
  return { kind: 'entry', players: playersOf(slot.entryId), seed: faces.get(slot.entryId)?.seed ?? null };
}

/** The full knockout tree from the published draw lines; confirmed results advance winners. Null when the lines are not a bracket. */
function engineBracket(
  ctx: EventContext,
  koMatches: readonly PublicCompetitionMatch[],
  faces: Map<string, { face: SideFace; seed: number | null }>,
  playersOf: (id: string | null) => PlayerRef[],
  gamesOf: (matchId: string, swap: boolean) => GameScore[],
): BracketRoundView[] | null {
  const lines = [...ctx.slots].sort((x, y) => x.position - y.position).map((s) => s.entry_id ?? BYE);
  const created = createBracket(lines, { thirdPlace: koMatches.some((m) => m.round_code === '3P') });
  if (!created.ok) return null;
  const key = (round: string, x: string, y: string): string => `${round}|${[x, y].sort().join('|')}`;
  const stored = new Map<string, PublicCompetitionMatch>();
  for (const m of koMatches) if (m.side_a_entry && m.side_b_entry) stored.set(key(m.round_code, m.side_a_entry, m.side_b_entry), m);
  const lookup = (a: Slot, b: Slot, round: string): { m: PublicCompetitionMatch; swap: boolean } | null => {
    if (a.kind !== 'entry' || b.kind !== 'entry') return null;
    const m = stored.get(key(round, a.entryId, b.entryId));
    return m ? { m, swap: m.side_a_entry !== a.entryId } : null;
  };

  let bracket: Bracket = created.bracket;
  // Apply confirmed results until nothing more can advance (each pass decides at least one match, so this ends).
  for (let guard = 0; guard < bracket.matches.length + 1; guard += 1) {
    let progressed = false;
    for (const bm of bracket.matches) {
      if (bm.state !== 'ready') continue;
      const hit = lookup(bm.a, bm.b, bm.round);
      if (!hit || !isConfirmedResult(hit.m)) continue;
      const decided = DECIDED.includes(hit.m.status);
      if (decided && hit.m.winner_side !== 'A' && hit.m.winner_side !== 'B') continue;
      const winner = decided ? (hit.swap ? flip(hit.m.winner_side as Side) : (hit.m.winner_side as Side)) : null;
      const r = applyResult(bracket, bm.id, {
        status: hit.m.status as 'completed' | 'walkover' | 'retired' | 'abandoned',
        winner,
        games: gamesOf(hit.m.id, hit.swap),
        confirmed: true,
      });
      if (r.ok) {
        bracket = r.bracket;
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }

  const rounds = new Map<string, BracketMatchView[]>();
  const applied = new Set<string>();
  for (const bm of bracket.matches) {
    const hit = lookup(bm.a, bm.b, bm.round);
    if (hit && (bm.state === 'decided' || bm.state === 'abandoned')) applied.add(hit.m.id);
    const view: BracketMatchView = { id: bm.id, a: slotView(bm.a, faces, playersOf), b: slotView(bm.b, faces, playersOf) };
    if (bm.state === 'decided' || bm.state === 'abandoned') {
      view.status = (bm.result?.status ?? 'completed') as MatchStatus;
      view.winner = bm.state === 'decided' && bm.winner ? (bm.a.kind === 'entry' && bm.a.entryId === bm.winner ? 'A' : 'B') : null;
      view.games = bm.result ? bm.result.games.map((g) => ({ a: g.a, b: g.b })) : [];
    } else if (bm.state === 'ready' || bm.state === 'waiting') {
      view.status = hit ? displayStatus(hit.m.status) : 'scheduled';
    }
    const list = rounds.get(bm.round);
    if (list) list.push(view);
    else rounds.set(bm.round, [view]);
  }
  // Every confirmed stored knockout result must sit in the derived tree; otherwise the tree would contradict the results list.
  if (koMatches.some((m) => isConfirmedResult(m) && !applied.has(m.id))) return null;
  return [...rounds.entries()].map(([code, matches]) => ({ code, matches }));
}

/** Knockout rounds as stored (the stage after groups, or a draw that is not a clean bracket): no derivation, no guessing. */
function storedBracket(
  koMatches: readonly PublicCompetitionMatch[],
  playersOf: (id: string | null) => PlayerRef[],
  gamesOf: (matchId: string, swap: boolean) => GameScore[],
): BracketRoundView[] {
  const rounds = new Map<string, BracketMatchView[]>();
  for (const m of [...koMatches].sort((x, y) => x.match_number - y.match_number)) {
    const confirmed = isConfirmedResult(m);
    const side = (entry: string | null): SlotView => (entry ? { kind: 'entry', players: playersOf(entry) } : { kind: 'tbd' });
    const view: BracketMatchView = {
      id: m.id,
      a: side(m.side_a_entry),
      b: side(m.side_b_entry),
      status: displayStatus(m.status),
      winner: confirmed && DECIDED.includes(m.status) ? m.winner_side : null,
      games: confirmed ? gamesOf(m.id, false) : [],
    };
    const list = rounds.get(m.round_code);
    if (list) list.push(view);
    else rounds.set(m.round_code, [view]);
  }
  return [...rounds.entries()].map(([code, matches]) => ({ code, matches }));
}

export function buildCompetitionSite(raw: RawCompetitionData, opts: { source: CompetitionSource }): CompetitionSite {
  const dropped = { tournaments: 0, events: 0, rankingSnapshots: 0 };
  const tournamentsById = new Map<string, CompetitionTournamentRow>();
  const usedSlugs = new Set<string>();
  for (const t of raw.tournaments) {
    if (!isCompetitionTournamentSlug(t.slug) || usedSlugs.has(t.slug) || typeof t.name !== 'string' || t.name.trim() === '') {
      dropped.tournaments += 1;
      continue;
    }
    usedSlugs.add(t.slug);
    tournamentsById.set(t.id, t);
  }

  const slotsByDraw = groupBy(raw.slots, (s) => s.draw_id);
  const drawByEvent = new Map(raw.draws.map((d) => [d.event_id, d]));
  const matchesByEvent = groupBy(raw.matches, (m) => m.event_id);
  const gamesByMatch = new Map<string, PublicCompetitionMatchGame[]>();
  for (const [id, list] of groupBy(raw.games, (g) => g.match_id)) gamesByMatch.set(id, [...list].sort((x, y) => x.game_number - y.game_number));

  const pages = new Map<string, CompetitionTournamentPage>();
  const codesByTournament = new Map<string, Set<string>>();
  const events = [...raw.events].sort((x, y) => x.category.localeCompare(y.category) || (x.age_group ?? '').localeCompare(y.age_group ?? '') || x.id.localeCompare(y.id));
  for (const e of events) {
    const t = tournamentsById.get(e.tournament_id);
    const code = eventCode(e.category, e.age_group);
    const codes = codesByTournament.get(e.tournament_id) ?? new Set<string>();
    if (!t || code === null || codes.has(code) || (e.status !== 'open' && e.status !== 'closed')) {
      dropped.events += 1;
      continue;
    }
    codes.add(code);
    codesByTournament.set(e.tournament_id, codes);
    let page = pages.get(t.id);
    if (!page) {
      page = {
        id: t.id,
        slug: t.slug,
        name: t.name.trim(),
        path: competitionTournamentPath(t.slug),
        startDate: isIsoDate(t.start_date) ? t.start_date : null,
        endDate: isIsoDate(t.end_date) ? t.end_date : null,
        city: t.city,
        venue: t.venue,
        status: t.status,
        events: [],
      };
      pages.set(t.id, page);
    }
    const draw = drawByEvent.get(e.id);
    const parts = buildEventParts({
      event: e,
      slots: draw ? [...(slotsByDraw.get(draw.id) ?? [])] : [],
      matches: [...(matchesByEvent.get(e.id) ?? [])],
      gamesByMatch,
    });
    page.events.push({
      id: e.id,
      code,
      path: competitionEventPath(t.slug, code),
      tournamentSlug: t.slug,
      tournamentName: page.name,
      title: eventTitle(e.category, e.age_group),
      category: e.category,
      ageGroup: e.age_group,
      format: e.format,
      formatText: FORMAT_TEXT[e.format] ?? e.format,
      status: e.status,
      junior: eventIsJunior({ category: e.category, ageGroup: e.age_group, isJunior: e.is_junior }),
      drawPublished: draw !== undefined,
      ...parts,
    });
  }

  const tournaments = [...pages.values()].sort(
    (x, y) => (y.startDate ?? '').localeCompare(x.startDate ?? '') || x.name.localeCompare(y.name, 'en-IN') || x.slug.localeCompare(y.slug),
  );

  const rankings: RankingPageItem[] = [];
  for (const [snapshotId, rows] of groupBy(raw.rankings, (r) => r.snapshot_id)) {
    const first = rows[0]!;
    if (!rankingIsShowable(first.category, first.age_group) || !isIsoDate(first.as_of) || rows.some((r) => r.category !== first.category || r.age_group !== first.age_group)) {
      dropped.rankingSnapshots += 1;
      continue;
    }
    const shown = rows.filter(rankingRowIsShowable).filter((r) => Number.isInteger(r.rank) && r.rank > 0);
    const items: RankingItem[] = shown.map((r) => ({
      rank: publicRank(r.rank, shown),
      player: { name: (r.player_name as string).trim(), protected: false },
      points: r.points,
      played: r.events_counted,
    }));
    const scope = first.category ? eventTitle(first.category, first.age_group) : first.age_group ? (ageGroupLabel(first.age_group) ?? first.age_group) : '';
    const label = typeof first.label === 'string' && first.label.trim() !== '' ? first.label.trim() : 'Ranking';
    rankings.push({ snapshotId, label, title: scope && !label.includes(scope) ? `${label} (${scope})` : label, asOf: first.as_of, items });
  }
  rankings.sort((x, y) => y.asOf.localeCompare(x.asOf) || x.title.localeCompare(y.title, 'en-IN'));

  return { source: opts.source, generatedAt: raw.generatedAt, tournaments, rankings, dropped };
}

/**
 * The rank of a shown row among the SHOWN rows only: 1 + the number of shown rows with a strictly better original rank. Ties stay ties
 * and there are no gaps, so a protected player who was left out leaves no trace (1, =2, =2, 4 rather than 1, =2, =2, 5).
 */
export function publicRank(original: number, shown: readonly { rank: number }[]): number {
  return 1 + shown.filter((r) => r.rank < original).length;
}

/**
 * "Updated Friday, 30 October 2026 at 12:00 pm (India time)": when this snapshot was taken (the pages are rebuilt nightly or on demand,
 * so times, courts and "In progress" can be out of date). Empty for an unreadable instant.
 */
export function updatedText(generatedAt: string): string {
  try {
    return `Updated ${formatInstantIst(generatedAt)}`;
  } catch {
    return '';
  }
}

/** SportsEvent structured data for a tournament with a readable start date, from real data only (null for the fictional seed). */
export function competitionTournamentJsonLd(t: CompetitionTournamentPage, source: CompetitionSource, origin: string | URL): Record<string, unknown> | null {
  if (source === 'seed' || !t.startDate) return null;
  const status = t.status === 'cancelled' ? 'cancelled' : t.status === 'postponed' ? 'postponed' : 'scheduled';
  return sportsEventJsonLd({
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
    url: absoluteUrl(t.path, origin),
    venue: t.venue,
    city: t.city,
    status,
  });
}

/** "7–8 November 2026" (India dates through src/lib/dates.ts), or a plain "Dates to be confirmed". */
export function tournamentWhen(t: Pick<CompetitionTournamentPage, 'startDate' | 'endDate'>): string {
  return t.startDate ? formatDateRange(t.startDate, t.endDate) : 'Dates to be confirmed';
}

/** "Demo Indoor Stadium, Sampleur", or an empty string. */
export function tournamentPlace(t: Pick<CompetitionTournamentPage, 'venue' | 'city'>): string {
  return [t.venue, t.city].filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()).join(', ');
}

/** "1 event", "3 events". */
export function eventCountText(n: number): string {
  return `${n} event${n === 1 ? '' : 's'}`;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * The /competitions/ page of an owner-entered tournament (src/content/tournaments.ts), for a link from its /tournaments/<slug>/ page.
 * The SAME slug AND the SAME start date are required, so an unrelated database tournament that happens to share a slug is never
 * linked. Null for the fictional seed (a made-up draw must never be linked from a real tournament), when either start date is
 * missing, and when the site has no such tournament (for example a build without competition pages).
 */
export function competitionLinkFor(
  site: Pick<CompetitionSite, 'source' | 'tournaments'>,
  tournament: { slug: string; startDate: string | null | undefined },
): string | null {
  if (site.source === 'seed') return null;
  if (!isIsoDate(tournament.startDate)) return null;
  return site.tournaments.find((t) => t.slug === tournament.slug && t.startDate === tournament.startDate)?.path ?? null;
}
