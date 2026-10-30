// In-memory CompetitionBackend: tests and the no-backend admin preview. It applies the same rules as the 0017/0018 owner RPCs (published
// draws and confirmed results never change, STALE on an old revision, capacity, duplicates, the event's scoring rules) and writes an
// audit row for every write. FICTIONAL seed only (createCompetitionSeed). Nothing here touches the network.
import { isJuniorAgeGroup } from '../../competition/db';
import { validateGame } from '../../competition/scoring';
import { DEFAULT_RULESET } from '../../competition/scoring';
import { todayIst } from '../../dates';
import type { Actor } from '../types';
import { isJuniorScope } from './ranking';
import { checkResult } from './result';
import { rankingProtectedMessage } from './messages';
import { playersPerEntry } from './validate';
import {
  CompetitionError,
  type CompCourtRow,
  type CompDrawRow,
  type CompEntryRow,
  type CompEventRow,
  type CompGameRow,
  type CompMatchRow,
  type CompPlayerRef,
  type CompSettings,
  type CompSnapshotEntryRow,
  type CompSnapshotRow,
  type CompTournamentRef,
  type CompVenueRow,
  type CompetitionBackend,
} from './types';

export interface MemoryCompetitionState {
  events: CompEventRow[];
  entries: CompEntryRow[];
  draws: CompDrawRow[];
  matches: CompMatchRow[];
  games: CompGameRow[];
  courts: CompCourtRow[];
  venues: CompVenueRow[];
  snapshots: (CompSnapshotRow & { entries: CompSnapshotEntryRow[] })[];
  settings: CompSettings;
}

export interface MemoryCompetitionDeps {
  state: () => MemoryCompetitionState;
  /** Unmerged players only. */
  players: () => CompPlayerRef[];
  tournaments: () => CompTournamentRef[];
  /**
   * Of `ids`, the players competition pages may name: the memory copy of app.competition_named_players (0018: adult_confirmed, public,
   * not provisional, unmerged, not suppressed; no archive match needed). See isCompetitionNamed in src/lib/competition/db.ts.
   */
  rankable: (ids: readonly string[]) => string[];
  audit: (actor: Actor, action: string, entity: string, entityId: string | null, reason: string) => void;
  markDirty: () => void;
  now: () => Date;
  newId: () => string;
}

export function emptyCompetitionState(): MemoryCompetitionState {
  return { events: [], entries: [], draws: [], matches: [], games: [], courts: [], venues: [], snapshots: [], settings: { rankingsPublic: false, registrationEnabled: false, pointsTable: null } };
}

/** Fictional ids of the competition seed (players are added to the identity seed by memory-store.ts). */
export const COMP_SEED = {
  anand: '80000000-0000-4000-8000-000000000001',
  bala: '80000000-0000-4000-8000-000000000002',
  eswar: '80000000-0000-4000-8000-000000000003',
  chitra: '80000000-0000-4000-8000-000000000004',
  divya: '80000000-0000-4000-8000-000000000005',
  eventMs: '81000000-0000-4000-8000-000000000001',
  eventWs: '81000000-0000-4000-8000-000000000002',
  venue: '84000000-0000-4000-8000-000000000001',
  court1: '83000000-0000-4000-8000-000000000001',
  court2: '83000000-0000-4000-8000-000000000002',
} as const;

const entryId = (n: number): string => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * One sample tournament (the seed's Demo Open Cup) with two events: Men's singles (knockout, 4 confirmed adults, no draw yet) and
 * Women's singles (round robin, 2 adults and 1 player of unknown age). Two courts at one venue. No points table approved.
 */
export function createCompetitionSeed(tournamentId: string, adultId: string, unknownAgeId: string): MemoryCompetitionState {
  const s = emptyCompetitionState();
  const event = (id: string, category: 'MS' | 'WS', format: 'knockout' | 'round_robin'): CompEventRow => ({ id, tournamentId, category, ageGroup: null, isJunior: false, format, ruleset: { ...DEFAULT_RULESET }, capacity: 16, status: 'open' });
  s.events.push(event(COMP_SEED.eventMs, 'MS', 'knockout'), event(COMP_SEED.eventWs, 'WS', 'round_robin'));
  const entry = (n: number, eventId: string, player: string, seed: number | null): CompEntryRow => ({ id: entryId(n), eventId, players: [player], seed, status: 'confirmed' });
  s.entries.push(
    entry(1, COMP_SEED.eventMs, adultId, 1),
    entry(2, COMP_SEED.eventMs, COMP_SEED.anand, 2),
    entry(3, COMP_SEED.eventMs, COMP_SEED.bala, null),
    entry(4, COMP_SEED.eventMs, COMP_SEED.eswar, null),
    entry(5, COMP_SEED.eventWs, COMP_SEED.chitra, null),
    entry(6, COMP_SEED.eventWs, COMP_SEED.divya, null),
    entry(7, COMP_SEED.eventWs, unknownAgeId, null),
  );
  s.venues.push({ id: COMP_SEED.venue, name: 'Demo Indoor Hall', city: 'Coimbatore' });
  s.courts.push({ id: COMP_SEED.court1, tournamentId, venueId: COMP_SEED.venue, label: 'Court 1', sort: 1 }, { id: COMP_SEED.court2, tournamentId, venueId: COMP_SEED.venue, label: 'Court 2', sort: 2 });
  return s;
}

const JUNIOR_CATEGORIES = new Set(['BS', 'GS', 'BD', 'GD']);
const ACTIVE = new Set(['pending', 'confirmed']);
const HOLDS_PLACE = new Set(['pending', 'confirmed', 'waitlisted']);
const EDITABLE = new Set(['scheduled', 'ready', 'postponed']);
const RESULT_OK = new Set(['scheduled', 'ready', 'live', 'paused', 'completed', 'walkover', 'retired', 'abandoned']);
const DECIDED_OR_ABANDONED = new Set(['completed', 'walkover', 'retired', 'abandoned']);

const invalid = (message: string): never => {
  throw new CompetitionError('INVALID', message);
};
const notFound = (message: string): never => {
  throw new CompetitionError('NOT_FOUND', message);
};
const copy = <T>(x: T): T => structuredClone(x);
const reasonOk = (reason: string): void => {
  if (reason.trim() === '') invalid('a change needs a reason');
};

export function createMemoryCompetitionBackend(d: MemoryCompetitionDeps): CompetitionBackend {
  const st = (): MemoryCompetitionState => d.state();
  const event = (id: string): CompEventRow => st().events.find((e) => e.id === id) ?? notFound('event not found');
  const isActiveEntryOf = (eventId: string, playerId: string): boolean =>
    st().entries.some((e) => e.eventId === eventId && e.players.includes(playerId) && e.status !== 'withdrawn' && e.status !== 'rejected');
  const drawOf = (eventId: string): CompDrawRow | undefined => st().draws.find((x) => x.eventId === eventId);
  const inPublishedDraw = (entry: string): boolean => st().draws.some((x) => x.status !== 'draft' && x.slots.some((s) => s.entryId === entry));

  return {
    // ------------------------------------------------------------------ reads
    listTournaments: async () => copy(d.tournaments()),
    getTournament: async (id) => copy(d.tournaments().find((t) => t.id === id) ?? null),
    listEvents: async (f) => copy(st().events.filter((e) => (!f.ids || f.ids.includes(e.id)) && (!f.tournamentIds || f.tournamentIds.includes(e.tournamentId)))),
    listEntries: async (ids) => copy(st().entries.filter((e) => ids.includes(e.eventId))),
    getDraw: async (eventId) => copy(drawOf(eventId) ?? null),
    listDraws: async (ids) => copy(st().draws.filter((x) => ids.includes(x.eventId)).map(({ slots: _s, ...rest }) => rest)),
    listMatches: async (ids) => copy(st().matches.filter((m) => ids.includes(m.eventId))),
    getMatch: async (id) => copy(st().matches.find((m) => m.id === id) ?? null),
    listGames: async (ids) => copy(st().games.filter((g) => ids.includes(g.matchId))),
    listCourts: async (tournamentId) => copy(st().courts.filter((c) => c.tournamentId === tournamentId).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))),
    listVenues: async () => copy([...st().venues].sort((a, b) => a.name.localeCompare(b.name))),
    getPlayers: async (ids) => copy(d.players().filter((p) => ids.includes(p.id))),
    listSnapshots: async () => copy([...st().snapshots].reverse().map(({ entries, ...rest }) => ({ ...rest, rows: entries.length }))),
    getSnapshot: async (id) => {
      const found = st().snapshots.find((x) => x.id === id);
      if (!found) return null;
      const { entries, ...rest } = found;
      return copy({ ...rest, rows: entries.length });
    },
    // no verified actor = nobody is named (fail closed), as in the Supabase backend
    rankablePlayerIds: async (actor, ids) => (actor ? d.rankable([...new Set(ids)]) : []),
    getSnapshotEntries: async (id) => copy(st().snapshots.find((s) => s.id === id)?.entries ?? []),
    getSettings: async () => copy(st().settings),

    // ------------------------------------------------------------------ events and entries
    async saveEvent(actor, id, r, reason) {
      reasonOk(reason);
      if (!d.tournaments().some((t) => t.id === r.tournamentId)) notFound('tournament not found');
      const clash = (exceptId: string | null) => st().events.some((e) => e.id !== exceptId && e.tournamentId === r.tournamentId && e.category === r.category && (e.ageGroup ?? '') === (r.ageGroup ?? ''));
      const isJunior = JUNIOR_CATEGORIES.has(r.category) || isJuniorAgeGroup(r.ageGroup);
      const next = { category: r.category, ageGroup: r.ageGroup, format: r.format, ruleset: { ...r.ruleset }, capacity: r.capacity, status: r.status };
      if (id === null) {
        if (clash(null)) invalid('this tournament already has that category and age group');
        const row: CompEventRow = { id: d.newId(), tournamentId: r.tournamentId, isJunior, ...next };
        st().events.push(row);
        d.audit(actor, 'competition.create_event', 'tournament_events', row.id, reason);
        if (r.status !== 'draft') d.markDirty();
        return { id: row.id, created: true, fields: ['category', 'ageGroup', 'format', 'ruleset', 'capacity', 'status'] };
      }
      const e = event(id);
      if (e.tournamentId !== r.tournamentId) invalid('an event cannot move to another tournament');
      const fields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(e[k]) !== JSON.stringify(next[k]));
      if (fields.length === 0) return { id, created: false, fields: [] };
      const matchIds = new Set(st().matches.filter((m) => m.eventId === id).map((m) => m.id));
      if (fields.includes('ruleset') && st().games.some((g) => matchIds.has(g.matchId))) invalid('the scoring rules cannot change once a game is recorded');
      if ((fields.includes('format') || fields.includes('category')) && (drawOf(id)?.status ?? 'draft') !== 'draft') invalid('the format and category cannot change once the draw is published');
      if (fields.includes('category') && st().entries.some((x) => x.eventId === id)) invalid('the category cannot change once the event has entries');
      if (r.capacity !== null && st().entries.filter((x) => x.eventId === id && ACTIVE.has(x.status)).length > r.capacity) invalid('the capacity is below the entries already accepted');
      if (clash(id)) invalid('this tournament already has that category and age group');
      const wasDraft = e.status === 'draft';
      Object.assign(e, next, { isJunior });
      d.audit(actor, 'competition.update_event', 'tournament_events', id, reason);
      if (!wasDraft || r.status !== 'draft') d.markDirty();
      return { id, created: false, fields };
    },

    async addEntry(actor, eventId, r, reason) {
      reasonOk(reason);
      const e = event(eventId);
      if (e.status === 'closed') invalid('the event is closed to new entries');
      const need = playersPerEntry(e.category);
      if (r.players.length !== need) invalid(`${e.category} needs ${need} player(s) per entry`);
      if (r.players.length === 2 && r.players[0] === r.players[1]) invalid('a pair needs two different players');
      for (const p of r.players) {
        if (!d.players().some((x) => x.id === p)) notFound('player not found (or merged into another)');
        if (isActiveEntryOf(eventId, p)) invalid('a player is already entered in this event');
      }
      if (ACTIVE.has(r.status) && e.capacity !== null && st().entries.filter((x) => x.eventId === eventId && ACTIVE.has(x.status)).length >= e.capacity) {
        invalid(`the event is full (capacity ${e.capacity}); waitlist the entry instead`);
      }
      if (r.seed !== null && st().entries.some((x) => x.eventId === eventId && x.seed === r.seed && HOLDS_PLACE.has(x.status))) invalid(`seed ${r.seed} is already used in this event`);
      const row: CompEntryRow = { id: d.newId(), eventId, players: [...r.players], seed: r.seed, status: r.status };
      st().entries.push(row);
      d.audit(actor, 'competition.add_entry', 'event_entries', row.id, reason);
      return { id: row.id, status: row.status };
    },

    async withdrawEntry(actor, id, reason) {
      reasonOk(reason);
      const en = st().entries.find((x) => x.id === id) ?? notFound('entry not found');
      if (en.status === 'withdrawn' || en.status === 'rejected') invalid(`the entry is already ${en.status}`);
      const inDraw = inPublishedDraw(id);
      en.status = 'withdrawn';
      d.audit(actor, 'competition.withdraw_entry', 'event_entries', id, reason);
      if (inDraw) d.markDirty();
      return { id, status: 'withdrawn' as const, inPublishedDraw: inDraw };
    },

    async setEntry(actor, id, r, reason) {
      reasonOk(reason);
      const en = st().entries.find((x) => x.id === id) ?? notFound('entry not found');
      if (en.status === 'withdrawn' || en.status === 'rejected') invalid(`the entry is ${en.status}; add it again instead`);
      if (en.status === r.status && en.seed === r.seed) return { id, status: en.status, seed: en.seed, draftDrawCleared: false };
      if (inPublishedDraw(id)) invalid('the entry is in a published draw; withdraw it instead');
      const e = event(en.eventId);
      if (ACTIVE.has(r.status) && !ACTIVE.has(en.status) && e.capacity !== null && st().entries.filter((x) => x.eventId === e.id && ACTIVE.has(x.status)).length >= e.capacity) {
        invalid(`the event is full (capacity ${e.capacity})`);
      }
      if (r.seed !== null && r.status !== 'rejected' && st().entries.some((x) => x.id !== id && x.eventId === e.id && x.seed === r.seed && HOLDS_PLACE.has(x.status))) invalid(`seed ${r.seed} is already used in this event`);
      // a draft draw that holds (or should hold) this entry is out of date: it is removed and made again
      const draft = drawOf(e.id);
      const cleared = draft !== undefined && draft.status === 'draft' && (draft.slots.some((s) => s.entryId === id) || r.status === 'confirmed' || en.status === 'confirmed');
      if (cleared) st().draws = st().draws.filter((x) => x !== draft);
      en.status = r.status;
      en.seed = r.status === 'rejected' ? null : r.seed;
      d.audit(actor, 'competition.set_entry', 'event_entries', id, reason);
      return { id, status: en.status, seed: en.seed, draftDrawCleared: cleared };
    },

    // ------------------------------------------------------------------ draws
    async saveDraw(actor, eventId, r, reason) {
      reasonOk(reason);
      const e = event(eventId);
      const existing = drawOf(eventId);
      if (existing && existing.status !== 'draft') invalid('the draw is published and cannot be regenerated');
      if (!Number.isInteger(r.seed) || r.seed < 0 || r.seed > 4294967295) invalid('the draw needs the seed it used');
      const n = r.slots.length;
      if (n < 2 || n > 1024) invalid('a draw has 2 to 1024 slots');
      const positions = r.slots.map((s) => s.position).sort((a, b) => a - b);
      if (positions.some((p, i) => p !== i + 1)) invalid(`the positions must be 1 to ${n} with no gaps or repeats`);
      const confirmed = new Set(st().entries.filter((x) => x.eventId === eventId && x.status === 'confirmed').map((x) => x.id));
      const placed = r.slots.map((s) => s.entryId).filter((x): x is string => x !== null);
      if (new Set(placed).size !== placed.length) invalid('an entry is placed twice');
      if (placed.some((x) => !confirmed.has(x))) invalid('a slot holds an entry that is not a confirmed entry of this event');
      if ([...confirmed].some((x) => !placed.includes(x))) invalid('every confirmed entry must be placed in the draw');
      if (placed.length < 2) invalid('a draw needs at least 2 entries');
      if (r.slots.some((s) => (e.format === 'groups_knockout') !== (s.group !== null))) invalid('groups belong to a groups + knockout draw, on every slot');
      if (e.format === 'knockout' && (n & (n - 1)) !== 0) invalid('a knockout draw has a power-of-two size (byes fill the rest)');
      if (e.format !== 'knockout' && placed.length !== n) invalid('only a knockout draw has byes');
      if (e.format === 'groups_knockout') {
        const counts = new Map<string, number>();
        for (const s of r.slots) counts.set(s.group ?? '', (counts.get(s.group ?? '') ?? 0) + 1);
        if ([...counts.values()].some((c) => c < 2)) invalid('every group needs at least 2 entries');
      }
      const slots = r.slots.map((s) => ({ position: s.position, entryId: s.entryId, group: s.group }));
      let id: string;
      if (existing) {
        existing.seed = r.seed;
        existing.slots = slots;
        id = existing.id;
      } else {
        id = d.newId();
        st().draws.push({ id, eventId, seed: r.seed, status: 'draft', publishedAt: null, slots });
      }
      d.audit(actor, 'competition.save_draw', 'draws', id, reason);
      return { id, status: 'draft' as const, slots: n };
    },

    async publishDraw(actor, drawId, reason) {
      reasonOk(reason);
      const dr = st().draws.find((x) => x.id === drawId) ?? notFound('draw not found');
      if (dr.status !== 'draft') invalid('the draw is already published');
      if (event(dr.eventId).status === 'draft') invalid('open the event before publishing its draw');
      if (dr.slots.length === 0) invalid('the draw has no slots');
      // the draw must hold exactly today's confirmed entries (two admin tabs, or an entry confirmed or withdrawn after it was made)
      const confirmed = new Set(st().entries.filter((x) => x.eventId === dr.eventId && x.status === 'confirmed').map((x) => x.id));
      const placed = dr.slots.map((x) => x.entryId).filter((x): x is string => x !== null);
      if (placed.length !== confirmed.size || placed.some((x) => !confirmed.has(x))) invalid('the confirmed entries changed after this draw was made; make the draw again, then publish it');
      dr.status = 'published';
      dr.publishedAt = d.now().toISOString();
      d.audit(actor, 'competition.publish_draw', 'draws', drawId, reason);
      d.markDirty();
      return { id: drawId, status: 'published' as const };
    },

    // ------------------------------------------------------------------ matches and results
    async saveMatch(actor, id, r, expected, reason) {
      reasonOk(reason);
      const e = event(r.eventId);
      if ((r.roundCode === 'group') !== (r.groupLabel !== null)) invalid('a group match has a group, and only a group match');
      if (r.sideA !== null && r.sideA === r.sideB) invalid('an entry cannot play itself');
      for (const side of [r.sideA, r.sideB]) {
        if (side === null) continue;
        const en = st().entries.find((x) => x.id === side);
        if (!en || en.eventId !== e.id || en.status !== 'confirmed') invalid('each side must be a confirmed entry of this event');
      }
      if (r.courtId !== null && !st().courts.some((c) => c.id === r.courtId && c.tournamentId === e.tournamentId)) invalid('the court is not a court of this tournament');
      if (r.scheduledAt !== null && Number.isNaN(Date.parse(r.scheduledAt))) invalid('scheduledAt is not a real instant');
      const numberTaken = (except: string | null) => st().matches.some((m) => m.id !== except && m.eventId === e.id && m.matchNumber === r.matchNumber);
      const fields = { roundCode: r.roundCode, matchNumber: r.matchNumber, groupLabel: r.groupLabel, sideA: r.sideA, sideB: r.sideB, scheduledAt: r.scheduledAt === null ? null : new Date(r.scheduledAt).toISOString(), courtId: r.courtId };
      if (id === null) {
        if (expected !== null) invalid('a new match has no revision');
        if (numberTaken(null)) invalid(`match number ${r.matchNumber} is already used in this event`);
        const row: CompMatchRow = { id: d.newId(), eventId: e.id, ...fields, status: 'scheduled', winnerSide: null, confirmed: false, revision: 1 };
        st().matches.push(row);
        d.audit(actor, 'competition.create_match', 'competition_matches', row.id, reason);
        d.markDirty();
        return { id: row.id, revision: 1 };
      }
      const m = st().matches.find((x) => x.id === id) ?? notFound('match not found');
      if (m.revision !== expected) throw new CompetitionError('STALE', 'the match changed since the form was opened');
      if (m.eventId !== e.id) invalid('a match cannot move to another event');
      if (m.confirmed || !EDITABLE.has(m.status)) invalid('a match that has started or ended cannot be edited here');
      if (numberTaken(id)) invalid(`match number ${r.matchNumber} is already used in this event`);
      Object.assign(m, fields, { revision: m.revision + 1 });
      d.audit(actor, 'competition.update_match_schedule', 'competition_matches', id, reason);
      d.markDirty();
      return { id, revision: m.revision };
    },

    async recordResult(actor, matchId, r, expected, reason) {
      reasonOk(reason);
      const m = st().matches.find((x) => x.id === matchId) ?? notFound('match not found');
      if (m.revision !== expected) throw new CompetitionError('STALE', 'the match changed since the form was opened');
      if (m.confirmed) invalid('a confirmed result cannot be changed');
      if (!RESULT_OK.has(m.status)) invalid(`a ${m.status} match cannot take a result; reschedule it first`);
      if (m.sideA === null || m.sideB === null) invalid('both sides must be known before a result');
      const dr = drawOf(m.eventId);
      if (!dr || dr.status === 'draft') invalid('publish the draw before recording results');
      const e = event(m.eventId);
      const check = checkResult(r, e.ruleset);
      if (!check.ok) invalid(check.reasons.join(' '));
      const winner = check.ok ? check.winner : null;
      const loserEntry = winner === 'A' ? m.sideB : m.sideA;
      for (const side of [m.sideA, m.sideB]) {
        const en = st().entries.find((x) => x.id === side);
        if (en?.status === 'confirmed') continue;
        if (r.status === 'walkover' && en?.status === 'withdrawn' && en.id === loserEntry) continue;
        invalid('both sides must be confirmed entries (only the losing side of a walkover may have withdrawn)');
      }
      st().games = st().games.filter((g) => g.matchId !== matchId);
      r.games.forEach((g, i) => st().games.push({ matchId, gameNumber: i + 1, a: g.a, b: g.b, finished: validateGame(g, e.ruleset).valid }));
      m.status = r.status;
      m.winnerSide = winner;
      m.revision += 1;
      if (dr && dr.status === 'published') dr.status = 'locked';
      d.audit(actor, 'competition.record_result', 'competition_matches', matchId, reason);
      d.markDirty();
      return { id: matchId, status: r.status, winnerSide: winner, confirmed: false as const, revision: m.revision };
    },

    async confirmResult(actor, matchId, expected, reason) {
      reasonOk(reason);
      const m = st().matches.find((x) => x.id === matchId) ?? notFound('match not found');
      if (m.revision !== expected) throw new CompetitionError('STALE', 'the match changed since the form was opened');
      if (m.confirmed) invalid('the result is already confirmed');
      if (!DECIDED_OR_ABANDONED.has(m.status)) invalid('record a result before confirming it');
      m.confirmed = true;
      m.revision += 1;
      d.audit(actor, 'competition.confirm_result', 'competition_matches', matchId, reason);
      d.markDirty();
      return { id: matchId, confirmed: true as const, revision: m.revision };
    },

    // ------------------------------------------------------------------ rankings
    async saveRankingSnapshot(actor, r, reason) {
      reasonOk(reason);
      const label = r.label.trim();
      if (label.length < 2 || label.length > 120) invalid('the label must be 2 to 120 characters');
      if (r.asOf > todayIst(d.now())) invalid('asOf is in the future');
      if (r.entries.length < 1 || r.entries.length > 1000) invalid('a ranking has 1 to 1000 rows');
      const seen = new Set<string>();
      for (const x of r.entries) {
        if (seen.has(x.playerId)) invalid('a player appears twice in the ranking');
        if (!d.players().some((p) => p.id === x.playerId)) notFound('player not found (or merged into another)');
        seen.add(x.playerId);
      }
      const id = d.newId();
      st().snapshots.push({ id, label, category: r.category, ageGroup: r.ageGroup, asOf: r.asOf, published: false, publishedAt: null, createdAt: d.now().toISOString(), entries: r.entries.map((x) => ({ ...x })) });
      d.audit(actor, 'competition.save_ranking_snapshot', 'ranking_snapshots', id, reason);
      return { id, rows: r.entries.length, published: false as const };
    },

    async publishRankingSnapshot(actor, id, reason) {
      reasonOk(reason);
      const s = st().snapshots.find((x) => x.id === id) ?? notFound('ranking not found');
      if (s.published) invalid('the ranking is already published');
      if (s.entries.length === 0) invalid('the ranking has no rows');
      // like admin_publish_ranking_snapshot (0018): refuse a row that is protected NOW (or any row of a junior ranking)
      const ids = s.entries.map((x) => x.playerId);
      const named = new Set(isJuniorScope(s.category, s.ageGroup) ? [] : d.rankable(ids));
      const protectedRows = ids.filter((x) => !named.has(x)).length;
      if (protectedRows > 0) invalid(rankingProtectedMessage(protectedRows));
      s.published = true;
      s.publishedAt = d.now().toISOString();
      const visible = st().settings.rankingsPublic;
      d.audit(actor, 'competition.publish_ranking_snapshot', 'ranking_snapshots', id, reason);
      if (visible) d.markDirty();
      return { id, published: true as const, publiclyVisible: visible };
    },

    // ------------------------------------------------------------------ venues, courts, points table (0018)
    async saveVenue(actor, id, r, reason) {
      reasonOk(reason);
      if (id === null) {
        const row = { id: d.newId(), name: r.name, city: r.city };
        st().venues.push(row);
        d.audit(actor, 'competition.save_venue', 'venues', row.id, reason);
        return { id: row.id, created: true };
      }
      const v = st().venues.find((x) => x.id === id) ?? notFound('venue not found');
      Object.assign(v, { name: r.name, city: r.city });
      d.audit(actor, 'competition.save_venue', 'venues', id, reason);
      return { id, created: false };
    },

    async saveCourt(actor, id, r, reason) {
      reasonOk(reason);
      if (!d.tournaments().some((t) => t.id === r.tournamentId)) notFound('tournament not found');
      if (r.venueId !== null && !st().venues.some((v) => v.id === r.venueId)) notFound('venue not found');
      if (!Number.isInteger(r.sort) || r.sort < 0 || r.sort > 999) invalid('the order must be 0 to 999');
      if (st().courts.some((c) => c.id !== id && c.tournamentId === r.tournamentId && c.label === r.label)) invalid('this tournament already has a court with that name');
      if (id === null) {
        const row: CompCourtRow = { id: d.newId(), tournamentId: r.tournamentId, venueId: r.venueId, label: r.label, sort: r.sort };
        st().courts.push(row);
        d.audit(actor, 'competition.save_court', 'courts', row.id, reason);
        return { id: row.id, created: true };
      }
      const c = st().courts.find((x) => x.id === id) ?? notFound('court not found');
      if (c.tournamentId !== r.tournamentId) invalid('a court cannot move to another tournament');
      Object.assign(c, { venueId: r.venueId, label: r.label, sort: r.sort });
      d.audit(actor, 'competition.save_court', 'courts', id, reason);
      if (st().matches.some((m) => m.courtId === id)) d.markDirty();
      return { id, created: false };
    },

    async setPointsTable(actor, r, reason) {
      reasonOk(reason);
      const approvedAt = d.now().toISOString();
      st().settings.pointsTable = { label: r.label, levels: copy(r.levels), windowDays: r.windowDays, bestN: r.bestN, approvedAt };
      d.audit(actor, 'competition.approve_points_table', 'competition_settings', '1', reason);
      return { approvedAt };
    },
  };
}
