// Normalised provider entities -> stored record data, and -> the shared competition vocabulary (src/lib/competition/types.ts). PURE.
import { DECIDED_STATUSES, type Entry, type MatchResult } from '../competition/types';
import type { RecordData } from './merge';
import {
  localIdOf,
  type ProviderDraw,
  type ProviderEntry,
  type ProviderId,
  type ProviderMatch,
  type ProviderPlayer,
  type ProviderRanking,
  type ProviderTournament,
} from './types';

/** Fields a sync writes only when a record is created (the owner owns them afterwards). */
export const LOCAL_ONLY_FIELDS = {
  tournament: [] as string[],
  draw: [] as string[],
  match: [] as string[],
  ranking: [] as string[],
  // D-012: an imported player is protected (`unknown`) and only the owner changes that; a sync never touches it again.
  player: ['ageStatus'],
} as const;

const playerLocalId = (provider: ProviderId, externalId: string) => localIdOf({ provider, externalType: 'player', externalId });

export function entryLocalId(provider: ProviderId, entryExternalId: string): string {
  return `${provider}:entry:${entryExternalId}`;
}

export function tournamentData(t: ProviderTournament): RecordData {
  return {
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
    countryCode: t.countryCode,
    city: t.city,
    level: t.level,
    events: t.events.map((e) => ({ externalId: e.externalId, name: e.name, category: e.category })),
    providerUpdatedAt: t.updatedAt,
  };
}

export function drawData(provider: ProviderId, d: ProviderDraw): RecordData {
  return {
    tournamentExternalId: d.tournamentExternalId,
    eventExternalId: d.eventExternalId,
    kind: d.kind,
    size: d.size,
    entries: d.entries.map((e) => ({
      externalId: e.externalId,
      players: e.playerExternalIds.map((p) => playerLocalId(provider, p)),
      seed: e.seed,
    })),
    providerUpdatedAt: d.updatedAt,
  };
}

/**
 * A provider player as stored. `ageStatus` is ALWAYS `unknown` (protected, D-012) whatever the provider's hint says; the hint is kept
 * only for the owner's review. The name is stored for the admin; any public use must go through src/lib/archive/protected.ts.
 */
export function playerData(p: ProviderPlayer): RecordData {
  return { name: p.name, countryCode: p.countryCode, ageHint: p.ageHint, ageStatus: 'unknown' };
}

export function matchData(m: ProviderMatch): RecordData {
  return {
    tournamentExternalId: m.tournamentExternalId,
    drawExternalId: m.drawExternalId,
    round: m.round,
    status: m.status,
    sideAEntryExternalId: m.sideAEntryExternalId,
    sideBEntryExternalId: m.sideBEntryExternalId,
    games: m.games.map((g) => ({ a: g.a, b: g.b })),
    winner: m.winner,
    final: m.final,
    scheduledAt: m.scheduledAt,
    providerUpdatedAt: m.updatedAt,
  };
}

export function rankingData(provider: ProviderId, r: ProviderRanking): RecordData {
  return {
    category: r.category,
    asOf: r.asOf,
    // The provider's list, kept as the provider's. NOT the local unofficial ranking, and never published by this module.
    rows: r.rows.map((row) => ({ rank: row.rank, players: row.playerExternalIds.map((p) => playerLocalId(provider, p)), points: row.points })),
  };
}

/** A provider entry as a competition Entry (opaque local ids). */
export function toCompetitionEntry(provider: ProviderId, e: ProviderEntry): Entry {
  const entry: Entry = { id: entryLocalId(provider, e.externalId), players: e.playerExternalIds.map((p) => playerLocalId(provider, p)) };
  return e.seed !== null ? { ...entry, seed: e.seed } : entry;
}

/**
 * A provider match as a competition MatchResult, or null when the match is not decided (or decided without a winner).
 * `confirmed` is false unless the caller explicitly trusts the provider's `final` flag: by default an imported result never advances
 * a winner locally.
 */
export function toMatchResult(m: ProviderMatch, opts: { trustProviderFinal?: boolean } = {}): MatchResult | null {
  const games = m.games.map((g) => ({ a: g.a, b: g.b }));
  if (m.status === 'abandoned') return { status: 'abandoned', winner: null, games, confirmed: false };
  if (!(DECIDED_STATUSES as readonly string[]).includes(m.status)) return null;
  if (m.winner === null) return null;
  return {
    status: m.status as MatchResult['status'],
    winner: m.winner,
    games,
    confirmed: opts.trustProviderFinal === true && m.final === true,
  };
}
