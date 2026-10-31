// Pure display helpers for the competition UI building blocks (Module 15, wave 2 of the platform brief, 2026-10-30).
// The .astro components in this folder hold markup only; every decision (names vs "Protected player", round labels, India time,
// the live-freshness check, status wording, ordering) lives here so Vitest can test it (tests/competition-ui/). PURE: no I/O,
// no clock (the caller passes `now`), no randomness.
//
// NOT wired into any route yet. Safe defaults of this wave (owner decisions pending, see the platform brief):
// - Protected players (D-012): anyone the caller does not mark `protected: false` is shown as "Protected player". Fail closed:
//   a missing flag, a missing name or any value other than exactly `false` means protected. A protected entry's club is hidden too.
// - "Live" appears only when the caller passes live=true, the match status is `live`, and the last update is no older than the
//   freshness window (default 5 minutes, LIVE_FRESHNESS_MS_DEFAULT, a product choice, not a vendor fact). Otherwise no live label.
// - Rankings are local and unofficial: the ranking label below is always shown, with the snapshot date, and a ranking stays
//   marked as a draft until the owner approves publication (`ownerApproved` exactly true).
// - Times are shown in India time (Asia/Kolkata) through src/lib/dates.ts (formatTimeIst, istDateOf; D-030).
import { formatDate, formatTimeIst, isIsoDate, isZonedInstant, istDateOf } from '../../lib/dates';
import { categoryLabel, roundLabel as archiveRoundLabel, ROUND_ORDER } from '../../lib/archive/labels';
import type { GameScore, MatchStatus, RoundCode, Side } from '../../lib/competition/types';

// ------------------------------------------------------------------ players and sides

/** The only text a protected player ever gets on a page (D-012). */
export const PROTECTED_LABEL = 'Protected player';

/** A player as the caller hands it to a component. `protected` must be exactly `false` for the name to be shown. */
export interface PlayerRef {
  name?: string | null;
  protected?: boolean | null;
}

/** True unless the caller said, explicitly, that this player is not protected (fail closed). */
export function isProtectedPlayer(player: PlayerRef | null | undefined): boolean {
  if (!player) return true;
  if (player.protected !== false) return true;
  return typeof player.name !== 'string' || player.name.trim() === '';
}

/** The visible name of one player: the trimmed name, or "Protected player". */
export function playerName(player: PlayerRef | null | undefined): string {
  if (isProtectedPlayer(player)) return PROTECTED_LABEL;
  return (player as PlayerRef).name!.trim().replace(/\s+/g, ' ');
}

/** One side (singles or a doubles pair): names joined with " / ". An empty side reads "To be decided". */
export function sideName(players: readonly PlayerRef[] | null | undefined): string {
  if (!players || players.length === 0) return TBD_LABEL;
  return players.map(playerName).join(' / ');
}

/** True when any player on the side is protected (the component then hides extra details such as the club). */
export function sideHasProtected(players: readonly PlayerRef[] | null | undefined): boolean {
  return !players || players.length === 0 || players.some(isProtectedPlayer);
}

export const BYE_LABEL = 'Bye';
export const TBD_LABEL = 'To be decided';

/** A line of a bracket match: a real side, a bye, or a side not known yet. */
export type SlotView = { kind: 'entry'; players: readonly PlayerRef[]; seed?: number | null } | { kind: 'bye' } | { kind: 'tbd' };

export function slotText(slot: SlotView | null | undefined): string {
  if (!slot || slot.kind === 'tbd') return TBD_LABEL;
  if (slot.kind === 'bye') return BYE_LABEL;
  return sideName(slot.players);
}

/** "[1]" for seed 1; empty for an unseeded side or a seed that is not a positive whole number. */
export function seedText(seed: number | null | undefined): string {
  return typeof seed === 'number' && Number.isInteger(seed) && seed > 0 ? `[${seed}]` : '';
}

// ------------------------------------------------------------------ rounds

/** Round code from the number of lines (players or pairs) still in a knockout round: 2 = F, 4 = SF, 8 = QF, 16 = R16 ... 128. */
export function roundCodeForLines(lines: number): RoundCode | null {
  const map: Record<number, RoundCode> = { 2: 'F', 4: 'SF', 8: 'QF', 16: 'R16', 32: 'R32', 64: 'R64', 128: 'R128' };
  return map[lines] ?? null;
}

/** Words for a round code ("QF" -> "Quarter-final"); an unknown code is shown as it is, never invented; nothing -> "". */
export function roundLabel(code: string | null | undefined): string {
  return archiveRoundLabel(code ?? null) ?? '';
}

/** Words for an event (category code "MS" -> "Men's singles"); an unknown code or free text is shown as it is. */
export function eventLabel(code: string | null | undefined): string {
  if (!code) return '';
  return categoryLabel(code) ?? code;
}

/** Order for bracket columns, left to right: earliest round first (R128 ... F), then the third-place match, then anything else. */
export function bracketRoundRank(code: string): number {
  const knockout = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'];
  const i = knockout.indexOf(code);
  if (i >= 0) return i;
  if (code === '3P') return knockout.length;
  return knockout.length + 1 + Math.max(0, ROUND_ORDER.indexOf(code));
}

// ------------------------------------------------------------------ India time

// formatTimeIst, istDateOf and isZonedInstant live in src/lib/dates.ts (D-030: one date module); re-exported for the components.
export { formatTimeIst, isZonedInstant, istDateOf };

function toDate(instant: string | Date): Date | null {
  const d = instant instanceof Date ? new Date(instant.getTime()) : typeof instant === 'string' ? new Date(instant) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** "30 October 2026" from an India calendar date or an instant (through src/lib/dates.ts); null when unreadable. */
export function formatDateIst(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string' && !isIsoDate(value) && !isZonedInstant(value)) return null;
  try {
    return formatDate(value);
  } catch {
    return null;
  }
}

export const TIME_TBC_LABEL = 'Time to be confirmed';
export const DATE_TBC_LABEL = 'Date to be confirmed';

// ------------------------------------------------------------------ status and live

/** Default freshness window for a "Live" label: 5 minutes. A product choice for this wave (not a vendor fact); callers may pass their own. */
export const LIVE_FRESHNESS_MS_DEFAULT = 5 * 60 * 1000;
/** A last update up to this far in the future is accepted as clock skew; further than that is treated as bad data (not live). */
export const LIVE_CLOCK_SKEW_MS = 60 * 1000;

export interface LiveCheck {
  live?: boolean | null;
  status?: MatchStatus | null;
  lastUpdate?: string | Date | null;
  now: Date;
  freshnessMs?: number;
}

/**
 * True only when ALL hold: the caller passed live === true, the status is `live` (when given), the last update is a readable zoned
 * instant, it is not more than LIVE_CLOCK_SKEW_MS in the future, and it is no older than the freshness window. Anything else: false.
 */
export function isLiveFresh(check: LiveCheck): boolean {
  if (check.live !== true) return false;
  if (check.status != null && check.status !== 'live') return false;
  const windowMs = check.freshnessMs ?? LIVE_FRESHNESS_MS_DEFAULT;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return false;
  const nowMs = check.now instanceof Date ? check.now.getTime() : Number.NaN;
  if (Number.isNaN(nowMs)) return false;
  const lu = check.lastUpdate;
  if (lu == null || (typeof lu === 'string' && !isZonedInstant(lu))) return false;
  const d = toDate(lu);
  if (!d) return false;
  const age = nowMs - d.getTime();
  if (age < -LIVE_CLOCK_SKEW_MS) return false;
  return age <= windowMs;
}

/** "5 minutes" / "1 minute" / "30 seconds", for the freshness note under a live score. */
export function freshnessWindowText(ms: number = LIVE_FRESHNESS_MS_DEFAULT): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const m = ms / 60_000;
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? '' : 's'}`;
}

export type BadgeTone = 'live' | 'court' | 'ink' | 'neutral';

const STATUS_TEXT: Record<MatchStatus, string> = {
  scheduled: 'Scheduled',
  ready: 'Ready to start',
  live: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  walkover: 'Walkover',
  retired: 'Retired',
  abandoned: 'Abandoned',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};

/** Plain words for a match status; an unknown value reads "Status unknown". */
export function statusText(status: MatchStatus | string | null | undefined): string {
  return status != null && Object.prototype.hasOwnProperty.call(STATUS_TEXT, status) ? STATUS_TEXT[status as MatchStatus] : 'Status unknown';
}

/**
 * The status badge: always text (never colour alone). "Live" only when isLiveFresh() is true; a match marked live without a fresh
 * update reads "In progress" with a neutral tone and `stale` set, so the page can say the score may be out of date.
 */
export function statusBadge(check: LiveCheck & { status?: MatchStatus | null }): { text: string; tone: BadgeTone; isLive: boolean; stale: boolean } {
  if (isLiveFresh(check)) return { text: 'Live', tone: 'live', isLive: true, stale: false };
  const status = check.status ?? null;
  const text = statusText(status);
  const stale = status === 'live' || (check.live === true && status == null);
  if (status === 'completed') return { text, tone: 'court', isLive: false, stale: false };
  if (status === 'walkover' || status === 'retired') return { text, tone: 'ink', isLive: false, stale: false };
  return { text, tone: 'neutral', isLive: false, stale };
}

/** The extra word next to a decided match in a bracket or schedule: "Walkover", "Retired", "Abandoned"; empty otherwise. */
export function outcomeNote(status: MatchStatus | string | null | undefined): string {
  if (status === 'walkover') return 'Walkover';
  if (status === 'retired') return 'Retired';
  if (status === 'abandoned') return 'Abandoned';
  return '';
}

// ------------------------------------------------------------------ scores

/** True for a game score of two whole numbers from 0 to 99 (display check only; the scoring engine owns the rules). */
export function isDisplayableGame(g: GameScore | null | undefined): g is GameScore {
  const ok = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 100;
  return !!g && ok(g.a) && ok(g.b);
}

/** Only the readable games, in order. */
export function displayGames(games: readonly GameScore[] | null | undefined): GameScore[] {
  return (games ?? []).filter(isDisplayableGame).map((g) => ({ a: g.a, b: g.b }));
}

/** "21-15, 18-21, 21-19" (side A first); empty when there are no readable games. */
export function gamesText(games: readonly GameScore[] | null | undefined): string {
  return displayGames(games).map((g) => `${g.a}-${g.b}`).join(', ');
}

/** "Game 2: 18 to 21" for screen readers, side A first. */
export function gameAriaLabel(index: number, g: GameScore): string {
  return `Game ${index + 1}: ${g.a} to ${g.b}`;
}

/** Games won by each side among the finished-looking games (a game counts for the side with more points; level games count for nobody). */
export function gamesWon(games: readonly GameScore[] | null | undefined): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const g of displayGames(games)) {
    if (g.a > g.b) a += 1;
    else if (g.b > g.a) b += 1;
  }
  return { a, b };
}

/** True when `side` is the decided winner. Only decided statuses (completed, walkover, retired) have a winner to highlight. */
export function isWinner(side: Side, winner: Side | null | undefined, status: MatchStatus | string | null | undefined): boolean {
  if (winner !== 'A' && winner !== 'B') return false;
  if (status !== 'completed' && status !== 'walkover' && status !== 'retired') return false;
  return side === winner;
}

// ------------------------------------------------------------------ bracket

export interface BracketMatchView {
  id: string;
  a: SlotView;
  b: SlotView;
  status?: MatchStatus | null;
  winner?: Side | null;
  games?: readonly GameScore[] | null;
}

export interface BracketRoundView {
  code: string;
  matches: readonly BracketMatchView[];
}

export interface BracketColumn {
  code: string;
  label: string;
  matches: BracketMatchView[];
}

/** Rounds left to right (earliest first, third place after the final), each with its label. Empty rounds are dropped. */
export function bracketColumns(rounds: readonly BracketRoundView[] | null | undefined): BracketColumn[] {
  return (rounds ?? [])
    .filter((r) => r && r.matches && r.matches.length > 0)
    .map((r, i) => ({ r, i }))
    .sort((x, y) => bracketRoundRank(x.r.code) - bracketRoundRank(y.r.code) || x.i - y.i)
    .map(({ r }) => ({ code: r.code, label: roundLabel(r.code) || r.code, matches: [...r.matches] }));
}

/** A bye line: one side real, the other a bye. Shown as "advances without a match", never with a score or a winner mark. */
export function isByeMatch(m: BracketMatchView): boolean {
  return m.a.kind === 'bye' || m.b.kind === 'bye';
}

/** One readable sentence for a bracket match (used as the accessible name of its list item). */
export function bracketMatchSummary(m: BracketMatchView): string {
  const a = `${seedText(m.a.kind === 'entry' ? m.a.seed : null)} ${slotText(m.a)}`.trim();
  const b = `${seedText(m.b.kind === 'entry' ? m.b.seed : null)} ${slotText(m.b)}`.trim();
  if (m.a.kind === 'bye' && m.b.kind === 'bye') return 'No match (both lines empty)';
  if (isByeMatch(m)) return `${m.a.kind === 'bye' ? b : a} advances without a match (bye)`;
  const parts = [`${a} versus ${b}`];
  const winA = isWinner('A', m.winner, m.status);
  const winB = isWinner('B', m.winner, m.status);
  if (winA || winB) parts.push(`winner ${winA ? a : b}`);
  const note = outcomeNote(m.status);
  if (note) parts.push(note.toLowerCase());
  const score = gamesText(m.games);
  if (score) parts.push(`score ${score}`);
  if (!winA && !winB && !note) parts.push(statusText(m.status ?? 'scheduled').toLowerCase());
  return parts.join(', ');
}

// ------------------------------------------------------------------ schedule

export interface ScheduleItem {
  id: string;
  /** ISO instant with a zone; null or missing = time not fixed yet. */
  startsAt?: string | null;
  /** India calendar date (YYYY-MM-DD) when only the day is known. Ignored when startsAt is readable. */
  date?: string | null;
  court?: string | number | null;
  /** Category code (MS, WD ...) or the event's own name. */
  event?: string | null;
  round?: string | null;
  a: readonly PlayerRef[];
  b: readonly PlayerRef[];
  status?: MatchStatus | null;
}

export interface ScheduleRow {
  id: string;
  dateIso: string | null;
  dateText: string;
  timeText: string;
  courtText: string;
  eventText: string;
  roundText: string;
  sideA: string;
  sideB: string;
  statusText: string;
}

/** "Court 3" for 3 or "3"; free text such as "Centre court" is kept; nothing -> "Court to be confirmed". */
export function courtText(court: string | number | null | undefined): string {
  if (typeof court === 'number' && Number.isFinite(court)) return `Court ${court}`;
  if (typeof court === 'string' && court.trim() !== '') {
    const t = court.trim();
    return /^\d+$/.test(t) ? `Court ${t}` : t;
  }
  return 'Court to be confirmed';
}

/** Rows sorted by India date, then time (unknown times last within their day), then court, then input order. */
export function scheduleRows(items: readonly ScheduleItem[] | null | undefined): ScheduleRow[] {
  const decorated = (items ?? []).map((it, i) => {
    const zoned = isZonedInstant(it.startsAt);
    const ms = zoned ? new Date(it.startsAt as string).getTime() : null;
    const dateIso = zoned ? istDateOf(it.startsAt) : isIsoDate(it.date) ? (it.date as string) : null;
    return { it, i, ms, dateIso };
  });
  decorated.sort((x, y) => {
    if (x.dateIso !== y.dateIso) {
      if (x.dateIso === null) return 1;
      if (y.dateIso === null) return -1;
      return x.dateIso < y.dateIso ? -1 : 1;
    }
    if (x.ms !== y.ms) {
      if (x.ms === null) return 1;
      if (y.ms === null) return -1;
      return x.ms - y.ms;
    }
    const cx = courtText(x.it.court);
    const cy = courtText(y.it.court);
    if (cx !== cy) return cx.localeCompare(cy, 'en-IN', { numeric: true });
    return x.i - y.i;
  });
  return decorated.map(({ it, ms, dateIso }) => ({
    id: it.id,
    dateIso,
    dateText: (dateIso && formatDateIst(dateIso)) || DATE_TBC_LABEL,
    timeText: (ms !== null && formatTimeIst(it.startsAt)) || TIME_TBC_LABEL,
    courtText: courtText(it.court),
    eventText: eventLabel(it.event),
    roundText: roundLabel(it.round),
    sideA: sideName(it.a),
    sideB: sideName(it.b),
    statusText: it.status ? statusText(it.status) : '',
  }));
}

// ------------------------------------------------------------------ ranking

export const RANKING_LABEL = 'Local Power Smash ranking, not an official BWF ranking';
export const RANKING_DRAFT_LABEL = 'Draft: not published. The owner has not approved this ranking for publication.';

export interface RankingItem {
  rank: number;
  player: PlayerRef;
  points?: number | null;
  played?: number | null;
}

export interface RankingRow {
  rankText: string;
  tied: boolean;
  name: string;
  points: string;
  played: string;
}

/** "Snapshot: 30 October 2026"; throws for a date that is not a real YYYY-MM-DD (a ranking without a date is not shown). */
export function snapshotText(snapshotDate: string): string {
  if (!isIsoDate(snapshotDate)) throw new RangeError('A ranking needs a snapshot date written YYYY-MM-DD');
  return `Snapshot: ${formatDate(snapshotDate)}`;
}

/** Rows in rank order (input order kept for equal ranks); a tied rank is written "=2" with `tied` set. Bad ranks are dropped. */
export function rankingRows(items: readonly RankingItem[] | null | undefined): RankingRow[] {
  const valid = (items ?? [])
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => Number.isInteger(it.rank) && it.rank > 0)
    .sort((x, y) => x.it.rank - y.it.rank || x.i - y.i);
  const counts = new Map<number, number>();
  for (const { it } of valid) counts.set(it.rank, (counts.get(it.rank) ?? 0) + 1);
  const num = (n: number | null | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '–');
  return valid.map(({ it }) => {
    const tied = (counts.get(it.rank) ?? 0) > 1;
    return { rankText: tied ? `=${it.rank}` : String(it.rank), tied, name: playerName(it.player), points: num(it.points), played: num(it.played) };
  });
}

/** Publication is the owner's call: only exactly `true` lifts the draft label. */
export function isRankingPublished(ownerApproved: unknown): boolean {
  return ownerApproved === true;
}

// ------------------------------------------------------------------ entry list

export type EntryStatus = 'confirmed' | 'waitlist' | 'withdrawn';

export interface EntryItem {
  id: string;
  players: readonly PlayerRef[];
  seed?: number | null;
  club?: string | null;
  status?: EntryStatus | null;
}

export interface EntryRow {
  id: string;
  seedText: string;
  name: string;
  club: string;
  statusText: string;
  withdrawn: boolean;
}

const ENTRY_STATUS_TEXT: Record<EntryStatus, string> = { confirmed: 'Confirmed', waitlist: 'Waiting list', withdrawn: 'Withdrawn' };

/**
 * Seeded entries first (seed 1 up), then the rest in the caller's order (never sorted by name: a protected player has no name to sort
 * by, and sorting around them could hint at it). Withdrawn entries go last. A protected entry's club is hidden (fail closed).
 */
export function entryRows(items: readonly EntryItem[] | null | undefined): EntryRow[] {
  const validSeed = (s: number | null | undefined): number | null => (typeof s === 'number' && Number.isInteger(s) && s > 0 ? s : null);
  return (items ?? [])
    .map((it, i) => ({ it, i, seed: validSeed(it.seed), out: it.status === 'withdrawn' }))
    .sort((x, y) => {
      if (x.out !== y.out) return x.out ? 1 : -1;
      if (x.seed !== null && y.seed !== null) return x.seed - y.seed || x.i - y.i;
      if (x.seed !== null) return -1;
      if (y.seed !== null) return 1;
      return x.i - y.i;
    })
    .map(({ it, seed, out }) => ({
      id: it.id,
      seedText: seedText(seed),
      name: sideName(it.players),
      club: sideHasProtected(it.players) ? '' : (it.club ?? '').trim(),
      statusText: it.status ? ENTRY_STATUS_TEXT[it.status] ?? '' : '',
      withdrawn: out,
    }));
}
