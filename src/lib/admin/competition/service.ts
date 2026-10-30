// The competition admin actions (D-108 to D-114). Shared by the memory store (tests, preview) and the Supabase store (Vercel function):
// both give it a CompetitionBackend and it does the rest the same way. Engines run HERE, on the server: the draw (with its recorded
// seed), the bracket progression (a winner advances only on a CONFIRMED result), the scheduler and its conflict report, the result
// check and the local ranking. Every write is one owner RPC that audits; refusals come back as plain English in `errors`.
import { isIsoDate, todayIst } from '../../dates';
import { RANKING_DISCLAIMER } from '../../competition/stats/ranking';
import { findConflicts, scheduleMatches, type Schedule, type SchedulableMatch, type ScheduledMatch } from '../../competition/scheduling';
import { failResult, okResult, type Actor, type AdminErrorCode, type StoreResult } from '../types';
import { knockoutFeeders, planDraw, planMatchSync } from './draw';
import { isJuniorScope, rankingFromResults } from './ranking';
import { checkResult } from './result';
import { rankingProtectedMessage } from './messages';
import { describePointsTable, eventProblems, playersPerEntry, pointsTableProblems } from './validate';
import {
  CompetitionError,
  type CompDrawRow,
  type CompEntryRow,
  type CompEventRow,
  type CompMatchRow,
  type CompSnapshotRow,
  type CompetitionAdminStore,
  type CompetitionBackend,
  type CompetitionEntryDto,
  type CompetitionEventSummary,
  type CompetitionMatchDto,
  type MatchSyncOutcome,
  type ScheduleResultDto,
} from './types';

export interface CompetitionServiceOptions {
  now?: () => Date;
  /** A new random draw seed (0 .. 2^32 - 1). Default: the platform's crypto random source. */
  randomSeed?: () => number;
}

const EDITABLE = new Set(['scheduled', 'ready', 'postponed']);
const PASS_THROUGH: readonly AdminErrorCode[] = ['INVALID', 'NOT_FOUND', 'STALE', 'FORBIDDEN', 'BACKEND_ERROR'];

/** The plain sentence for any problem the scheduling engine finds in the days, times or settings (its own text is technical). */
export const SCHEDULE_INPUT_PROBLEM = 'Check the days and times: each day needs a real date and a start time before its end time, for example 09:00 to 18:00. The match length and rest time must be whole minutes.';
/** Shown when a result was confirmed but moving the winner on failed. */
export const CONFIRMED_BUT_NOT_ADVANCED = 'The result is confirmed, but the next match was not updated. Press Update matches to move the winner on.';

const refuse = (message: string, field = 'form') => failResult('INVALID', { [field]: message });

/** Any thrown error becomes a StoreFailure: a CompetitionError (or an error with an allow-listed `code`) keeps its code and sentence. */
function toFailure(e: unknown) {
  const code = (e as { code?: unknown })?.code;
  const detail = (e as { detail?: unknown })?.detail;
  if (e instanceof CompetitionError || (typeof code === 'string' && (PASS_THROUGH as readonly string[]).includes(code))) {
    const c = code as AdminErrorCode;
    return typeof detail === 'string' && detail !== '' ? failResult(c, { form: detail }) : failResult(c);
  }
  return failResult('BACKEND_ERROR');
}

async function guard<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return toFailure(e);
  }
}

const detailOf = (e: unknown): string => {
  const d = (e as { detail?: unknown })?.detail;
  return typeof d === 'string' && d !== '' ? d : 'the database refused it';
};

function defaultRandomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 0;
}

/** "MS U19 QF match 5", "WS group A match 2", "XD league match 1". */
export function matchLabel(event: Pick<CompEventRow, 'category' | 'ageGroup'>, m: { roundCode: string; matchNumber: number; groupLabel: string | null }): string {
  const round = m.roundCode === 'group' ? `group ${m.groupLabel ?? ''}`.trim() : m.roundCode === 'league' ? 'league' : m.roundCode;
  return `${event.category}${event.ageGroup ? ` ${event.ageGroup}` : ''} ${round} match ${m.matchNumber}`;
}

export { rankingProtectedMessage };

export function createCompetitionService(b: CompetitionBackend, opts: CompetitionServiceOptions = {}): CompetitionAdminStore {
  const now = opts.now ?? (() => new Date());
  const randomSeed = opts.randomSeed ?? defaultRandomSeed;

  /**
   * Which of `playerIds` are protected in a ranking right now: everyone in a junior ranking, otherwise everyone the competition naming
   * rule (app.competition_named_players, through the backend) does not name. Fail closed: no actor or an unknown player = protected.
   */
  async function protectedInRanking(actor: Actor | null, snapshot: { category: CompSnapshotRow['category']; ageGroup: string | null }, playerIds: readonly string[]): Promise<Set<string>> {
    if (isJuniorScope(snapshot.category, snapshot.ageGroup)) return new Set(playerIds);
    const unique = [...new Set(playerIds)];
    const named = new Set(unique.length === 0 ? [] : await b.rankablePlayerIds(actor, unique));
    return new Set(unique.filter((id) => !named.has(id)));
  }

  async function loadEvent(eventId: string): Promise<CompEventRow> {
    const [event] = await b.listEvents({ ids: [eventId] });
    if (!event) throw new CompetitionError('NOT_FOUND');
    return event;
  }

  /** Brings the stored matches in line with the published draw and every confirmed result. Idempotent; refusals become `problems`. */
  async function syncMatches(actor: Actor, event: CompEventRow, draw: CompDrawRow, reason: string): Promise<MatchSyncOutcome> {
    const [entries, matches] = await Promise.all([b.listEntries([event.id]), b.listMatches([event.id])]);
    const plan = planMatchSync(event, draw.slots, entries, matches, (m) => matchLabel(event, m));
    const out: MatchSyncOutcome = { created: 0, updated: 0, advanced: [], problems: [...plan.problems] };
    for (const rec of plan.creates) {
      try {
        await b.saveMatch(actor, null, rec, null, reason);
        out.created += 1;
      } catch (e) {
        out.problems.push(`${matchLabel(event, rec)} could not be added: ${detailOf(e)}.`);
      }
    }
    for (const u of plan.updates) {
      try {
        await b.saveMatch(actor, u.id, u.record, u.expectedRevision, reason);
        out.updated += 1;
        for (const a of u.advanced) out.advanced.push({ matchId: u.id, side: a.side, entryId: a.entryId });
      } catch (e) {
        out.problems.push(`${matchLabel(event, u.record)} could not be updated: ${detailOf(e)}.`);
      }
    }
    return out;
  }

  return {
    // ------------------------------------------------------------------ reads
    competitionTournaments: () =>
      guard(async () => {
        const tournaments = await b.listTournaments();
        const events = tournaments.length === 0 ? [] : await b.listEvents({ tournamentIds: tournaments.map((t) => t.id) });
        const ids = events.map((e) => e.id);
        const [entries, draws, matches] = ids.length === 0 ? [[], [], []] : await Promise.all([b.listEntries(ids), b.listDraws(ids), b.listMatches(ids)]);
        const summary = (e: CompEventRow): CompetitionEventSummary => {
          const mine = entries.filter((x) => x.eventId === e.id);
          const ms = matches.filter((m) => m.eventId === e.id);
          return {
            id: e.id,
            tournamentId: e.tournamentId,
            category: e.category,
            ageGroup: e.ageGroup,
            isJunior: e.isJunior || (tournaments.find((t) => t.id === e.tournamentId)?.minorSignal ?? true),
            format: e.format,
            status: e.status,
            capacity: e.capacity,
            activeEntries: mine.filter((x) => x.status === 'pending' || x.status === 'confirmed').length,
            confirmedEntries: mine.filter((x) => x.status === 'confirmed').length,
            drawStatus: draws.find((d) => d.eventId === e.id)?.status ?? null,
            matchCount: ms.length,
            confirmedResults: ms.filter((m) => m.confirmed).length,
          };
        };
        return okResult(tournaments.map((t) => ({ id: t.id, name: t.name, level: t.level, startDate: t.startDate, endDate: t.endDate, events: events.filter((e) => e.tournamentId === t.id).map(summary) })));
      }),

    competitionEvent: ({ eventId }, actor) =>
      guard(async () => {
        const event = await loadEvent(eventId);
        const t = await b.getTournament(event.tournamentId);
        if (!t) return failResult('NOT_FOUND');
        const [entries, draw, matches, courts] = await Promise.all([b.listEntries([event.id]), b.getDraw(event.id), b.listMatches([event.id]), b.listCourts(t.id)]);
        const players = new Map((await b.getPlayers([...new Set(entries.flatMap((e) => e.players))])).map((p) => [p.id, p]));
        const games = matches.length === 0 ? [] : await b.listGames(matches.map((m) => m.id));
        const junior = event.isJunior || t.minorSignal;
        // The competition naming rule (app.competition_named_players through the backend), the same one the public views use, so
        // "On the site:" in the admin tells the owner the truth. Fail closed: no verified actor or an unknown player = protected.
        const entryPlayerIds = [...players.keys()];
        const named = new Set(entryPlayerIds.length === 0 ? [] : await b.rankablePlayerIds(actor ?? null, entryPlayerIds));
        const entryDtos: CompetitionEntryDto[] = entries.map((e) => {
          const ps = e.players.map((id) => {
            const p = players.get(id);
            return { id, displayName: p?.displayName ?? 'Unknown player', ageStatus: p?.ageStatus ?? 'unknown', isProtected: !p || !named.has(id) };
          });
          return { id: e.id, players: ps, seed: e.seed, status: e.status, isProtected: junior || ps.some((p) => p.isProtected) };
        });
        const courtLabel = new Map(courts.map((c) => [c.id, c.label]));
        const matchDtos: CompetitionMatchDto[] = [...matches]
          .sort((x, y) => x.matchNumber - y.matchNumber)
          .map((m) => ({
            id: m.id,
            label: matchLabel(event, m),
            roundCode: m.roundCode,
            matchNumber: m.matchNumber,
            groupLabel: m.groupLabel,
            sideA: m.sideA,
            sideB: m.sideB,
            scheduledAt: m.scheduledAt,
            courtId: m.courtId,
            courtLabel: m.courtId ? (courtLabel.get(m.courtId) ?? null) : null,
            status: m.status,
            winnerSide: m.winnerSide,
            confirmed: m.confirmed,
            revision: m.revision,
            games: games.filter((g) => g.matchId === m.id).sort((x, y) => x.gameNumber - y.gameNumber).map((g) => ({ a: g.a, b: g.b, finished: g.finished })),
          }));
        return okResult({
          tournament: { id: t.id, name: t.name, level: t.level, startDate: t.startDate, endDate: t.endDate },
          event: { ...event, isJunior: junior },
          entries: entryDtos,
          draw: draw ? { id: draw.id, seed: draw.seed, status: draw.status, publishedAt: draw.publishedAt, slots: [...draw.slots].sort((x, y) => x.position - y.position) } : null,
          matches: matchDtos,
          courts,
        });
      }),

    competitionCourts: ({ tournamentId }) =>
      guard(async () => {
        if (!(await b.getTournament(tournamentId))) return failResult('NOT_FOUND');
        const [venues, courts] = await Promise.all([b.listVenues(), b.listCourts(tournamentId)]);
        return okResult({ venues, courts });
      }),

    competitionRankings: () => guard(async () => okResult(await b.listSnapshots())),

    competitionRanking: ({ snapshotId }, actor) =>
      guard(async () => {
        const snapshot = await b.getSnapshot(snapshotId);
        if (!snapshot) return failResult('NOT_FOUND');
        const [entries, settings] = await Promise.all([b.getSnapshotEntries(snapshotId), b.getSettings()]);
        const players = new Map((await b.getPlayers(entries.map((e) => e.playerId))).map((p) => [p.id, p]));
        const protectedNow = await protectedInRanking(actor ?? null, snapshot, entries.map((e) => e.playerId));
        return okResult({
          snapshot,
          rows: [...entries].sort((x, y) => x.rank - y.rank).map((e) => ({
            playerId: e.playerId,
            displayName: players.get(e.playerId)?.displayName ?? 'Unknown player',
            rank: e.rank,
            points: e.points,
            eventsCounted: e.eventsCounted,
            isProtected: protectedNow.has(e.playerId),
          })),
          disclaimer: RANKING_DISCLAIMER,
          publiclyVisible: snapshot.published && settings.rankingsPublic,
        });
      }),

    competitionSettings: () =>
      guard(async () => {
        const s = await b.getSettings();
        return okResult({ rankingsPublic: s.rankingsPublic, registrationEnabled: s.registrationEnabled, pointsTable: s.pointsTable, pointsTableSummary: describePointsTable(s.pointsTable) });
      }),

    // ------------------------------------------------------------------ events and entries
    competitionSaveEvent: (actor, input) =>
      guard(async () => {
        const { id, reason, ...record } = input;
        const errors = eventProblems(record);
        if (Object.keys(errors).length > 0) return failResult('INVALID', errors);
        return okResult(await b.saveEvent(actor, id, record, reason));
      }),

    competitionAddEntry: (actor, input) =>
      guard(async () => {
        const event = await loadEvent(input.eventId);
        const need = playersPerEntry(event.category);
        if (input.players.length !== need) return refuse(need === 1 ? `${event.category} is singles: choose one player.` : `${event.category} is doubles: choose two players.`, 'players');
        if (need === 2 && input.players[0] === input.players[1]) return refuse('Choose two different players for a pair.', 'players');
        return okResult(await b.addEntry(actor, input.eventId, { players: [...input.players], seed: input.seed, status: input.status }, input.reason));
      }),

    competitionWithdrawEntry: (actor, input) => guard(async () => okResult(await b.withdrawEntry(actor, input.entryId, input.reason))),

    competitionSetEntry: (actor, input) => guard(async () => okResult(await b.setEntry(actor, input.entryId, { status: input.status, seed: input.seed }, input.reason))),

    // ------------------------------------------------------------------ draws
    competitionGenerateDraw: (actor, input) =>
      guard(async () => {
        const event = await loadEvent(input.eventId);
        const existing = await b.getDraw(event.id);
        if (existing && existing.status !== 'draft') return refuse('The draw is already published, so it cannot be made again.');
        const entries = (await b.listEntries([event.id])).filter((e) => e.status === 'confirmed');
        const players = new Map((await b.getPlayers([...new Set(entries.flatMap((e) => e.players))])).map((p) => [p.id, p]));
        const seed = input.seed ?? randomSeed();
        const plan = planDraw(event, entries, players, { seed, separateClubs: input.separateClubs, seeds: input.seeds, groupCount: input.groupCount ?? null, advancePerGroup: input.advancePerGroup ?? null });
        if (!plan.ok) return refuse(plan.reasons.join(' '));
        const saved = await b.saveDraw(actor, event.id, { seed, slots: plan.slots }, input.reason);
        return okResult({ drawId: saved.id, seed, status: 'draft' as const, format: event.format, slots: plan.slots, notes: plan.notes });
      }),

    competitionPublishDraw: (actor, input) =>
      guard(async () => {
        const event = await loadEvent(input.eventId);
        const draw = await b.getDraw(event.id);
        if (!draw || draw.id !== input.drawId) return failResult('NOT_FOUND');
        if (draw.status !== 'draft') return refuse('The draw is already published.');
        // the draw must hold exactly today's confirmed entries (an entry confirmed or withdrawn after it was made changes that)
        const confirmed = new Set((await b.listEntries([event.id])).filter((e) => e.status === 'confirmed').map((e) => e.id));
        const placed = new Set(draw.slots.map((s) => s.entryId).filter((x): x is string => x !== null));
        if (confirmed.size !== placed.size || [...confirmed].some((id) => !placed.has(id))) {
          return refuse('The confirmed entries changed after this draw was made. Make the draw again, then publish it.');
        }
        await b.publishDraw(actor, draw.id, input.reason);
        const sync = await syncMatches(actor, event, { ...draw, status: 'published' }, input.reason);
        return okResult({ drawId: draw.id, status: 'published' as const, ...sync });
      }),

    competitionSyncMatches: (actor, input) =>
      guard(async () => {
        const event = await loadEvent(input.eventId);
        const draw = await b.getDraw(event.id);
        if (!draw || draw.status === 'draft') return refuse('Publish the draw first; the matches come from the published draw.');
        return okResult(await syncMatches(actor, event, draw, input.reason));
      }),

    // ------------------------------------------------------------------ matches and schedule
    competitionSaveMatch: (actor, input) =>
      guard(async () => {
        const { id, expectedRevision, reason, ...record } = input;
        if (id !== null && expectedRevision === null) return refuse('Open the match again before changing it.');
        if (record.scheduledAt !== null && Number.isNaN(Date.parse(record.scheduledAt))) return refuse('The time is not a real date and time.', 'scheduledAt');
        return okResult(await b.saveMatch(actor, id, record, id === null ? null : expectedRevision, reason));
      }),

    competitionSchedule: (actor, input) =>
      guard(async () => {
        const t = await b.getTournament(input.tournamentId);
        if (!t) return failResult('NOT_FOUND');
        const events = await b.listEvents({ tournamentIds: [t.id] });
        const scope = new Set(input.eventIds ?? events.map((e) => e.id));
        if ([...scope].some((id) => !events.some((e) => e.id === id))) return refuse('An event is not part of this tournament.');
        const allCourts = await b.listCourts(t.id);
        const courts = input.courtIds ? allCourts.filter((c) => input.courtIds?.includes(c.id)) : allCourts;
        if (input.courtIds && courts.length !== new Set(input.courtIds).size) return refuse('A court is not part of this tournament.');
        if (courts.length === 0) return refuse('Add the courts of this tournament first.');
        if (input.windows.length === 0) return refuse('Add at least one day with start and end times.');
        const eventById = new Map(events.map((e) => [e.id, e]));
        const allMatches = events.length === 0 ? [] : await b.listMatches(events.map((e) => e.id));
        const entries = events.length === 0 ? [] : await b.listEntries(events.map((e) => e.id));
        const entryPlayers = new Map(entries.map((e) => [e.id, e.players]));
        const players = new Map((await b.getPlayers([...new Set(entries.flatMap((e) => e.players))])).map((p) => [p.id, p]));
        const label = (m: CompMatchRow): string => matchLabel(eventById.get(m.eventId) ?? { category: 'MS', ageGroup: null }, m);
        const sidePlayers = (entry: string | null): string[] => (entry ? [...(entryPlayers.get(entry) ?? [])] : []);
        const courtLabel = new Map(allCourts.map((c) => [c.id, c.label]));
        const courtIdByLabel = new Map(allCourts.map((c) => [c.label, c.id]));

        const toPlace = allMatches.filter((m) => scope.has(m.eventId) && !m.confirmed && EDITABLE.has(m.status));
        const placeIds = new Set(toPlace.map((m) => m.id));
        const fixed = allMatches.filter((m) => !placeIds.has(m.id) && m.scheduledAt !== null && m.courtId !== null && m.status !== 'cancelled' && m.status !== 'postponed');
        const duration = input.durationMinutes * 60_000;

        // knockout dependencies: a match waits for the matches that feed it (fixed feeders become an earliest start)
        const depends = new Map<string, string[]>();
        const earliest = new Map<string, number>();
        for (const e of events) {
          if (e.format !== 'knockout' || !scope.has(e.id)) continue;
          const draw = await b.getDraw(e.id);
          if (!draw || draw.status === 'draft') continue;
          const feeders = knockoutFeeders(draw.slots);
          const byNumber = new Map(allMatches.filter((m) => m.eventId === e.id).map((m) => [m.matchNumber, m]));
          for (const [target, from] of feeders) {
            const m = byNumber.get(target);
            if (!m || !placeIds.has(m.id)) continue;
            for (const n of from) {
              const f = byNumber.get(n);
              if (!f) continue;
              if (placeIds.has(f.id)) depends.set(m.id, [...(depends.get(m.id) ?? []), f.id]);
              else if (f.scheduledAt) earliest.set(m.id, Math.max(earliest.get(m.id) ?? 0, Date.parse(f.scheduledAt) + duration + input.restMinutes * 60_000));
            }
          }
        }

        // fixed matches go first, pinned to their court, so the new ones fit around them; only the new ones are saved
        const fixedInput: SchedulableMatch[] = fixed.map((m) => ({ id: m.id, sideA: sidePlayers(m.sideA), sideB: sidePlayers(m.sideB), durationMinutes: input.durationMinutes, earliestStart: m.scheduledAt ?? undefined, court: courtLabel.get(m.courtId ?? ''), label: label(m) }));
        const newInput: SchedulableMatch[] = toPlace.map((m) => {
          const at = earliest.get(m.id);
          return { id: m.id, sideA: sidePlayers(m.sideA), sideB: sidePlayers(m.sideB), durationMinutes: input.durationMinutes, label: label(m), ...(depends.has(m.id) ? { dependsOn: depends.get(m.id) } : {}), ...(at ? { earliestStart: new Date(at).toISOString() } : {}) };
        });
        const settings = { courts: courts.map((c) => c.label), windows: input.windows, restMinutes: input.restMinutes };
        let result: ReturnType<typeof scheduleMatches>;
        try {
          result = scheduleMatches([...fixedInput.filter((m) => m.court !== undefined && settings.courts.includes(m.court)), ...newInput], settings);
        } catch (e) {
          // the engine's own messages are technical (ids, ISO formats): the owner gets one plain sentence
          return refuse(e instanceof RangeError ? SCHEDULE_INPUT_PROBLEM : 'The schedule could not be worked out. Try again, or change the days and times.');
        }
        const placed = result.schedule.matches.filter((m) => placeIds.has(m.matchId));
        // the conflict report: the new places together with the fixed matches at their REAL times, on every court of the tournament
        const real: ScheduledMatch[] = fixed.map((m) => {
          const start = Date.parse(m.scheduledAt ?? '');
          return { matchId: m.id, label: label(m), court: courtLabel.get(m.courtId ?? '') ?? 'unknown court', start: new Date(start).toISOString(), end: new Date(start + duration).toISOString(), durationMinutes: input.durationMinutes, sideA: sidePlayers(m.sideA), sideB: sidePlayers(m.sideB), dependsOn: [] };
        });
        const report: Schedule = { matches: [...real, ...placed], settings: { ...result.schedule.settings, courts: allCourts.map((c) => c.label) } };
        const name = (text: string): string => {
          let out = text;
          for (const [id, p] of players) out = out.split(id).join(p.displayName);
          return out;
        };
        const conflicts = findConflicts(report)
          .filter((c) => c.matchIds.some((id) => placeIds.has(id)) && c.kind !== 'unknown-court')
          .map((c) => ({ kind: c.kind, matchIds: [...c.matchIds], message: name(c.message) }));
        const revisions = Object.fromEntries(toPlace.map((m) => [m.id, m.revision]));
        const byId = new Map(toPlace.map((m) => [m.id, m]));
        const out: ScheduleResultDto = {
          placed: placed.map((p) => ({ matchId: p.matchId, label: p.label, courtId: courtIdByLabel.get(p.court) ?? '', courtLabel: p.court, start: p.start, end: p.end, revision: byId.get(p.matchId)?.revision ?? 0 })),
          unplaced: result.unplaced.filter((u) => placeIds.has(u.matchId)).map((u) => ({ matchId: u.matchId, label: byId.get(u.matchId) ? label(byId.get(u.matchId) as CompMatchRow) : u.matchId, reason: name(u.reason) })),
          conflicts,
          saved: 0,
          problems: [],
          revisions,
        };
        if (!input.save) return okResult(out);

        if (!input.expected) return refuse('Look at the schedule first, then save it.');
        const expected = input.expected;
        if (toPlace.some((m) => expected[m.id] !== m.revision) || Object.keys(expected).some((id) => !placeIds.has(id))) {
          return failResult('STALE', { form: 'A match changed since you looked at the schedule. Look at it again before saving.' });
        }
        for (const p of out.placed) {
          const m = byId.get(p.matchId) as CompMatchRow;
          try {
            const saved = await b.saveMatch(actor, m.id, { eventId: m.eventId, roundCode: m.roundCode, matchNumber: m.matchNumber, groupLabel: m.groupLabel, sideA: m.sideA, sideB: m.sideB, scheduledAt: p.start, courtId: p.courtId }, m.revision, input.reason);
            out.saved += 1;
            out.revisions[m.id] = saved.revision;
            p.revision = saved.revision;
          } catch (e) {
            out.problems.push(`${p.label} was not saved: ${detailOf(e)}.`);
          }
        }
        return okResult(out);
      }),

    // ------------------------------------------------------------------ results
    competitionRecordResult: (actor, input) =>
      guard(async () => {
        const m = await b.getMatch(input.matchId);
        if (!m) return failResult('NOT_FOUND');
        if (m.revision !== input.expectedRevision) return failResult('STALE', { form: 'The match changed since you opened it. Open it again.' });
        if (m.confirmed) return refuse('This result is confirmed and cannot be changed.');
        const event = await loadEvent(m.eventId);
        const record = { status: input.status, games: input.games.map((g) => ({ a: g.a, b: g.b })), walkoverWinner: input.walkoverWinner, retiringSide: input.retiringSide };
        const check = checkResult(record, event.ruleset);
        if (!check.ok) return refuse(check.reasons.join(' '), 'games');
        return okResult(await b.recordResult(actor, m.id, record, input.expectedRevision, input.reason));
      }),

    competitionConfirmResult: (actor, input) =>
      guard(async () => {
        const m = await b.getMatch(input.matchId);
        if (!m) return failResult('NOT_FOUND');
        const confirmed = await b.confirmResult(actor, m.id, input.expectedRevision, input.reason);
        // the result is confirmed from here on: a failure while moving the winner on must not report the confirmation as failed
        // (a retry would only say "already confirmed"); the owner is told to press Update matches instead
        let sync: MatchSyncOutcome = { created: 0, updated: 0, advanced: [], problems: [] };
        try {
          const event = await loadEvent(m.eventId);
          const draw = await b.getDraw(event.id);
          // the winner moves on only now that the result is confirmed (brackets engine); a league needs nothing moved
          if (draw && draw.status !== 'draft' && event.format === 'knockout') sync = await syncMatches(actor, event, draw, input.reason);
        } catch {
          sync = { ...sync, problems: [CONFIRMED_BUT_NOT_ADVANCED] };
        }
        return okResult({ ...confirmed, ...sync });
      }),

    // ------------------------------------------------------------------ rankings and settings
    competitionComputeRanking: (actor, input) =>
      guard(async () => {
        const settings = await b.getSettings();
        if (!settings.pointsTable) return refuse('No ranking points table is approved yet. Approve the points table in the competition settings first; the ranking never uses example points.');
        if (isJuniorScope(input.category, input.ageGroup)) return refuse('A junior ranking would only list protected players, who are never ranked publicly, so it cannot be made.');
        if (!isIsoDate(input.asOf)) return refuse('The ranking date is not a real date.', 'asOf');
        if (input.asOf > todayIst(now())) return refuse('The ranking date cannot be in the future.', 'asOf');
        const tournaments = await b.listTournaments();
        const events = tournaments.length === 0 ? [] : await b.listEvents({ tournamentIds: tournaments.map((t) => t.id) });
        const ids = events.map((e) => e.id);
        const [entries, matches, drawList] = ids.length === 0 ? [[], [], []] : await Promise.all([b.listEntries(ids), b.listMatches(ids), b.listDraws(ids)]);
        const draws = new Map<string, CompDrawRow>();
        for (const d of drawList) {
          if (d.status === 'draft') continue;
          const full = await b.getDraw(d.eventId);
          if (full) draws.set(d.eventId, full);
        }
        const players = new Map((await b.getPlayers([...new Set(entries.flatMap((e: CompEntryRow) => e.players))])).map((p) => [p.id, p]));
        // only players competition pages may name are ranked (app.competition_named_players), so no published rank can have a gap
        const adults = [...players.values()].filter((p) => p.ageStatus === 'adult_confirmed').map((p) => p.id);
        const rankable = new Set(adults.length === 0 ? [] : await b.rankablePlayerIds(actor, adults));
        const r = rankingFromResults({ category: input.category, ageGroup: input.ageGroup, asOf: input.asOf, table: settings.pointsTable, tournaments: new Map(tournaments.map((t) => [t.id, t])), events, draws, matches, entries, players, rankable });
        if (r.rows.length === 0) return refuse(['There are no confirmed results to rank yet for this category.', ...r.excluded].join(' '));
        if (r.rows.length > 1000) return refuse('A ranking holds at most 1000 players. Choose a category.');
        const saved = await b.saveRankingSnapshot(actor, { label: input.label.trim(), category: input.category, ageGroup: input.ageGroup, asOf: input.asOf, entries: r.rows }, input.reason);
        return okResult({ snapshotId: saved.id, rows: saved.rows, protectedLeftOut: r.protectedLeftOut, excluded: r.excluded, formula: r.formula, disclaimer: r.disclaimer, published: false as const });
      }),

    competitionPublishRanking: (actor, input) =>
      guard(async () => {
        const snapshot = await b.getSnapshot(input.snapshotId);
        if (!snapshot) return failResult('NOT_FOUND');
        if (snapshot.published) return refuse('The ranking is already published.');
        // a player whose profile changed after the ranking was worked out (hidden, provisional, merged, suppressed, age no longer
        // confirmed) is protected NOW: refuse, so the table the owner approves is the table the public sees (the SQL refuses too)
        const entries = await b.getSnapshotEntries(snapshot.id);
        const protectedNow = await protectedInRanking(actor, snapshot, entries.map((e) => e.playerId));
        if (protectedNow.size > 0) return refuse(rankingProtectedMessage(protectedNow.size));
        return okResult(await b.publishRankingSnapshot(actor, snapshot.id, input.reason));
      }),

    competitionSaveVenue: (actor, input) =>
      guard(async () => {
        const name = input.name.trim();
        if (name.length < 2 || name.length > 160) return refuse('The venue name must be 2 to 160 characters.', 'name');
        const city = input.city?.trim() || null;
        if (city !== null && city.length > 60) return refuse('The city must be 60 characters or fewer.', 'city');
        return okResult(await b.saveVenue(actor, input.id, { name, city }, input.reason));
      }),

    competitionSaveCourt: (actor, input) =>
      guard(async () => {
        const label = input.label.trim();
        if (label.length < 1 || label.length > 40) return refuse('The court name must be 1 to 40 characters, for example "Court 1".', 'label');
        return okResult(await b.saveCourt(actor, input.id, { tournamentId: input.tournamentId, venueId: input.venueId, label, sort: input.sort }, input.reason));
      }),

    competitionApprovePointsTable: (actor, input) =>
      guard(async () => {
        const { reason, ...record } = input;
        const errors = pointsTableProblems(record);
        if (Object.keys(errors).length > 0) return failResult('INVALID', errors);
        return okResult(await b.setPointsTable(actor, { ...record, label: record.label.trim() }, reason));
      }),
  };
}

