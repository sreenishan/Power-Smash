// International data (Module 8): the provider-independent vocabulary. PURE types and small validators; no I/O, no clock.
//
// SAFE DEFAULTS (platform brief wave 2, 2026-10-30; docs/m5/international-data.md):
// - NO SCRAPING. A provider is only ever a LICENSED source reached through its documented interface. No licensed source exists
//   yet, so the production registry is EMPTY and every provider reports 'not_registered' / 'awaiting_licence' /
//   'awaiting_credentials' (never a fake success).
// - Players imported from a provider are PROTECTED (D-012): their local age status is always `unknown` on import, whatever the
//   provider says (a provider's age or birth-year field is only a hint; a flag is never lifted from someone else's claim). Only the
//   owner sets `adult_confirmed`, and that field is then a manually verified field the sync never overwrites.
// - Imported results are NOT confirmed results (`MatchResult.confirmed = false`) unless the caller explicitly trusts the provider's
//   `final` flag; winners never advance on an imported result by default.
// - International rankings are the provider's (for example official) rankings, stored as records. They are NOT the local unofficial
//   rankings of src/lib/competition/stats, and nothing here publishes anything.
// - Local data is never deleted because a provider omitted it.
import type { Category, IsoDate, IsoInstant, MatchStatus, RoundCode } from '../competition/types';
import { MATCH_STATUSES } from '../competition/types';
import { CATEGORIES } from '../parser/types';

/** A provider id: lower-case slug, for example `example-licensed`. Never a brand name we have no licence for in code defaults. */
export type ProviderId = string;

export const EXTERNAL_TYPES = ['tournament', 'event', 'draw', 'match', 'player', 'ranking'] as const;
export type ExternalType = (typeof EXTERNAL_TYPES)[number];

/** The idempotency key of every imported record: (provider, externalType, externalId). */
export interface ExternalKey {
  provider: ProviderId;
  externalType: ExternalType;
  externalId: string;
}

/** A stable opaque local id derived from the external key (used as Entry/player ids when mapping onto competition types). */
export function localIdOf(key: ExternalKey): string {
  return `${key.provider}:${key.externalType}:${key.externalId}`;
}

/**
 * Match statuses that can still change (the match is not over). A stored match in one of these keeps its tournament on the refresh
 * list of every default sync run. Over = completed, walkover, retired, abandoned, cancelled.
 */
export const OPEN_MATCH_STATUSES: readonly MatchStatus[] = ['scheduled', 'ready', 'live', 'paused', 'postponed'];

export function isOpenMatchStatus(v: unknown): boolean {
  return (OPEN_MATCH_STATUSES as readonly unknown[]).includes(v);
}

export const ROUND_CODES: readonly RoundCode[] =['F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league'];

/**
 * One page of a paged provider call. `nextCursor` = more pages now; `syncCursor` = where the NEXT run should resume.
 *
 * CURSOR CONTRACT (review finding, wave 2): `syncCursor` MUST be an updated-since / high-water mark that covers items CHANGED since the
 * last run, not only items ADDED since it. An offset-style cursor ("item n onwards") would never return a match that was stored as
 * `live` and later completed. The runner also guards against such providers: for every stored tournament that still has an open
 * match (see `isOpenMatchStatus`), it re-reads that tournament's matches from the start on every default run (`SyncStore.listOpenTournamentIds`).
 */
export interface Page<T> {
  items: readonly T[];
  nextCursor: string | null;
  syncCursor?: string | null;
}

export interface CallContext {
  /** Aborted on timeout or cancellation; a provider must stop its request when it fires. */
  signal: AbortSignal;
}

export interface PagedCallContext extends CallContext {
  cursor: string | null;
  limit: number;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Normalised entities (what every provider returns). Field names are ours, never a vendor's.
// ---------------------------------------------------------------------------------------------------------------------------

export interface ProviderTournament {
  externalId: string;
  name: string;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  /** ISO 3166-1 alpha-2 or alpha-3 as the provider gives it; null = unknown. */
  countryCode: string | null;
  city: string | null;
  /** The provider's level label, kept as text (for example a tour grade); never mapped to a score. */
  level: string | null;
  events: readonly ProviderEvent[];
  updatedAt: IsoInstant | null;
}

export interface ProviderEvent {
  externalId: string;
  name: string;
  category: Category | null;
}

/**
 * A provider player. `ageHint` is ONLY a hint stored for the owner to review: the local age status of an imported player is always
 * `unknown` (protected) until the owner confirms it (D-012, fail closed).
 */
export interface ProviderPlayer {
  externalId: string;
  name: string;
  countryCode: string | null;
  ageHint: 'adult' | 'junior' | 'unknown';
}

export interface ProviderEntry {
  externalId: string;
  playerExternalIds: readonly string[];
  seed: number | null;
}

export interface ProviderDraw {
  externalId: string;
  tournamentExternalId: string;
  eventExternalId: string | null;
  kind: 'knockout' | 'group' | 'league';
  size: number | null;
  entries: readonly ProviderEntry[];
  players: readonly ProviderPlayer[];
  updatedAt: IsoInstant | null;
}

export interface ProviderMatch {
  externalId: string;
  tournamentExternalId: string;
  drawExternalId: string | null;
  round: RoundCode | null;
  status: MatchStatus;
  sideAEntryExternalId: string | null;
  sideBEntryExternalId: string | null;
  /** Games, side A first. Empty when not played. */
  games: readonly { a: number; b: number }[];
  winner: 'A' | 'B' | null;
  /** The provider marks the result as final. Still NOT a confirmed local result by default (see toMatchResult). */
  final: boolean;
  scheduledAt: IsoInstant | null;
  updatedAt: IsoInstant | null;
}

export interface ProviderRankingRow {
  rank: number;
  playerExternalIds: readonly string[];
  points: number | null;
}

export interface ProviderRanking {
  /** One list, for example one category on one date. */
  externalId: string;
  category: Category | null;
  asOf: IsoDate;
  rows: readonly ProviderRankingRow[];
}

/** The adapter every licensed source implements. All calls must honour `signal` and throw the errors in ./errors. */
export interface DataProvider {
  readonly id: ProviderId;
  listTournaments(ctx: PagedCallContext): Promise<Page<ProviderTournament>>;
  getTournament(externalId: string, ctx: CallContext): Promise<ProviderTournament | null>;
  getDraws(tournamentExternalId: string, ctx: CallContext): Promise<readonly ProviderDraw[]>;
  getMatches(tournamentExternalId: string, ctx: PagedCallContext): Promise<Page<ProviderMatch>>;
  getRankings(category: Category | null, ctx: PagedCallContext): Promise<Page<ProviderRanking>>;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Validators (fail closed: an item that does not validate is rejected and counted, never stored half-right).
// ---------------------------------------------------------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isIsoInstant(v: unknown): v is IsoInstant {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));
}

// The validators are TOTAL: they accept `unknown` (provider data is untrusted), never throw, and return a problem for every field that
// is missing or has the wrong shape, so the sync rejects and counts the item instead of crashing the run (review finding, wave 2).
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const optString = (v: unknown) => v === null || typeof v === 'string';
const optDate = (v: unknown) => v === null || isIsoDate(v);
const optInstant = (v: unknown) => v === null || isIsoInstant(v);
const optCategory = (v: unknown) => v === null || (CATEGORIES as readonly unknown[]).includes(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIdList = (v: unknown): v is readonly string[] => Array.isArray(v) && (v as unknown[]).every(nonEmpty);
/** A short, safe label for a problem message (never throws, never echoes a long value). */
const label = (v: unknown) => (typeof v === 'string' ? v.slice(0, 80) : '?');

/** Returns the list of problems (empty = valid). */
export function validateTournament(input: unknown): string[] {
  if (!isObject(input)) return ['tournament is not an object'];
  const t = input;
  const p: string[] = [];
  if (!nonEmpty(t['externalId'])) p.push('externalId is empty');
  if (!nonEmpty(t['name'])) p.push('name is empty');
  if (!optDate(t['startDate'])) p.push('startDate is not YYYY-MM-DD');
  if (!optDate(t['endDate'])) p.push('endDate is not YYYY-MM-DD');
  const start = t['startDate'];
  const end = t['endDate'];
  if (isIsoDate(start) && isIsoDate(end) && end < start) p.push('endDate is before startDate');
  if (!optString(t['countryCode'])) p.push('countryCode is not text');
  if (!optString(t['city'])) p.push('city is not text');
  if (!optString(t['level'])) p.push('level is not text');
  if (!optInstant(t['updatedAt'])) p.push('updatedAt is not an ISO instant');
  const events = t['events'];
  if (!Array.isArray(events)) p.push('events is not a list');
  else
    for (const e of events as unknown[]) {
      if (!isObject(e)) {
        p.push('an event is not an object');
        continue;
      }
      if (!nonEmpty(e['externalId'])) p.push('event externalId is empty');
      if (typeof e['name'] !== 'string') p.push(`event ${label(e['externalId'])} name is not text`);
      if (!optCategory(e['category'])) p.push(`event ${label(e['externalId'])} has an unknown category`);
    }
  return p;
}

export function validateDraw(input: unknown): string[] {
  if (!isObject(input)) return ['draw is not an object'];
  const d = input;
  const p: string[] = [];
  if (!nonEmpty(d['externalId'])) p.push('externalId is empty');
  if (!nonEmpty(d['tournamentExternalId'])) p.push('tournamentExternalId is empty');
  if (!optString(d['eventExternalId'])) p.push('eventExternalId is not text');
  if (!(['knockout', 'group', 'league'] as unknown[]).includes(d['kind'])) p.push('unknown draw kind');
  const size = d['size'];
  if (size !== null && (!Number.isInteger(size) || (size as number) < 0)) p.push('size is not a whole number');
  if (!optInstant(d['updatedAt'])) p.push('updatedAt is not an ISO instant');
  const entries = d['entries'];
  if (!Array.isArray(entries)) p.push('entries is not a list');
  else
    for (const e of entries as unknown[]) {
      if (!isObject(e)) {
        p.push('an entry is not an object');
        continue;
      }
      const id = label(e['externalId']);
      if (!nonEmpty(e['externalId'])) p.push('entry externalId is empty');
      const ids = e['playerExternalIds'];
      if (!isIdList(ids)) p.push(`entry ${id} players is not a list of ids`);
      else if (ids.length < 1 || ids.length > 2) p.push(`entry ${id} must have 1 or 2 players`);
      const seed = e['seed'];
      if (seed !== null && (!Number.isInteger(seed) || (seed as number) < 1)) p.push(`entry ${id} has an invalid seed`);
    }
  const players = d['players'];
  if (!Array.isArray(players)) p.push('players is not a list');
  else
    for (const pl of players as unknown[]) {
      if (!isObject(pl)) {
        p.push('a player is not an object');
        continue;
      }
      const id = label(pl['externalId']);
      if (!nonEmpty(pl['externalId'])) p.push('player externalId is empty');
      if (typeof pl['name'] !== 'string') p.push(`player ${id} name is not text`);
      if (!optString(pl['countryCode'])) p.push(`player ${id} countryCode is not text`);
      if (!(['adult', 'junior', 'unknown'] as unknown[]).includes(pl['ageHint'])) p.push(`player ${id} has an unknown ageHint`);
    }
  return p;
}

export function validateMatch(input: unknown): string[] {
  if (!isObject(input)) return ['match is not an object'];
  const m = input;
  const p: string[] = [];
  if (!nonEmpty(m['externalId'])) p.push('externalId is empty');
  if (!nonEmpty(m['tournamentExternalId'])) p.push('tournamentExternalId is empty');
  if (!optString(m['drawExternalId'])) p.push('drawExternalId is not text');
  if (!(MATCH_STATUSES as readonly unknown[]).includes(m['status'])) p.push('unknown status');
  if (m['round'] !== null && !(ROUND_CODES as readonly unknown[]).includes(m['round'])) p.push('unknown round');
  if (!optString(m['sideAEntryExternalId'])) p.push('sideAEntryExternalId is not text');
  if (!optString(m['sideBEntryExternalId'])) p.push('sideBEntryExternalId is not text');
  if (m['winner'] !== null && m['winner'] !== 'A' && m['winner'] !== 'B') p.push('winner must be A, B or null');
  if (typeof m['final'] !== 'boolean') p.push('final is not true or false');
  const games = m['games'];
  if (!Array.isArray(games)) p.push('games is not a list');
  else
    for (const g of games as unknown[]) {
      if (!isObject(g) || !Number.isInteger(g['a']) || !Number.isInteger(g['b']) || (g['a'] as number) < 0 || (g['b'] as number) < 0) {
        p.push('a game score is not a whole number');
      }
    }
  if (!optInstant(m['scheduledAt'])) p.push('scheduledAt is not an ISO instant');
  if (!optInstant(m['updatedAt'])) p.push('updatedAt is not an ISO instant');
  return p;
}

export function validateRanking(input: unknown): string[] {
  if (!isObject(input)) return ['ranking is not an object'];
  const r = input;
  const p: string[] = [];
  if (!nonEmpty(r['externalId'])) p.push('externalId is empty');
  if (!isIsoDate(r['asOf'])) p.push('asOf is not YYYY-MM-DD');
  if (!optCategory(r['category'])) p.push('unknown category');
  const rows = r['rows'];
  if (!Array.isArray(rows)) p.push('rows is not a list');
  else
    for (const row of rows as unknown[]) {
      if (!isObject(row)) {
        p.push('a ranking row is not an object');
        continue;
      }
      if (!Number.isInteger(row['rank']) || (row['rank'] as number) < 1) p.push('a rank is not a positive whole number');
      if (!isIdList(row['playerExternalIds'])) p.push('a ranking row players is not a list of ids');
      if (row['points'] !== null && !Number.isFinite(row['points'])) p.push('points is not a number');
    }
  return p;
}
