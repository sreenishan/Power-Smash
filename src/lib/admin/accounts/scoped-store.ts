// The per-tournament check BEFORE the store (D-108). The admin handler wraps the competition part of the store with this for an
// organizer or scorer; the owner gets the store unchanged. For each call it: (1) looks up the action in the role-to-action map
// (access.ts), (2) works out which tournament(s) the input touches (an event, entry, draw, match or court id is resolved to its
// tournament on the server, never taken from the browser), and (3) reads the caller's ACTIVE assignments fresh from the database for
// this request, so a revoke or an ended account takes effect on the very next call. Any doubt is a refusal (FORBIDDEN), and an id
// that does not exist is refused the same way, so a non-owner never learns whether it exists. The database repeats the check
// (app.require_competition_access, 0019).
import { failResult, okResult, type Actor, type StoreResult } from '../types';
import type {
  CompetitionAdminStore,
  CompetitionEventDetail,
  CompetitionPlayerDto,
  CompetitionTournamentDto,
} from '../competition/types';
import type { LiveMatchSummaryDto, LiveScoringAdminStore } from '../live-scoring/types';
import { assignmentSatisfies, scopedNeed, type AccessNeed } from './access';
import { isScopedRole, type PlatformActor, type ScopedRole } from './types';

export type ScopeKind = 'tournament' | 'event' | 'entry' | 'draw' | 'match' | 'court';

/** Resolves a record to its tournament on the server (null = not found). */
export interface ScopeResolver {
  tournamentOf(kind: Exclude<ScopeKind, 'tournament'>, id: string): Promise<string | null>;
}

export interface ActiveAssignment {
  tournamentId: string;
  role: ScopedRole;
}

export interface ScopeDeps {
  resolver: ScopeResolver;
  /** The caller's ACTIVE assignments (revoked_at is null), read for this request. An ended account has none. */
  assignments: (userId: string) => Promise<ActiveAssignment[]>;
}

/** The method of CompetitionAdminStore behind each admin action. */
export const METHOD_ACTION = {
  competitionTournaments: 'competition.tournaments',
  competitionEvent: 'competition.event',
  competitionCourts: 'competition.courts',
  competitionRankings: 'competition.rankings',
  competitionRanking: 'competition.ranking',
  competitionSettings: 'competition.settings',
  competitionSaveEvent: 'competition.saveEvent',
  competitionAddEntry: 'competition.addEntry',
  competitionWithdrawEntry: 'competition.withdrawEntry',
  competitionSetEntry: 'competition.setEntry',
  competitionGenerateDraw: 'competition.generateDraw',
  competitionPublishDraw: 'competition.publishDraw',
  competitionSyncMatches: 'competition.syncMatches',
  competitionSaveMatch: 'competition.saveMatch',
  competitionSchedule: 'competition.schedule',
  competitionRecordResult: 'competition.recordResult',
  competitionConfirmResult: 'competition.confirmResult',
  competitionComputeRanking: 'competition.computeRanking',
  competitionPublishRanking: 'competition.publishRanking',
  competitionSaveVenue: 'competition.saveVenue',
  competitionSaveCourt: 'competition.saveCourt',
  competitionApprovePointsTable: 'competition.approvePointsTable',
  competitionSearchPlayers: 'competition.searchPlayers',
  competitionCreatePlayer: 'competition.createPlayer',
} as const satisfies Record<keyof CompetitionAdminStore, string>;

export interface ScopeTarget {
  kind: ScopeKind;
  id: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Every record an action's input touches. Each one must belong to a tournament the caller holds with the right role.
 * `null` = a list read (the result is filtered instead); an unknown action has no targets and is refused by the need check first.
 */
export function targetsOf(action: string, input: Record<string, unknown>): ScopeTarget[] | null {
  const t: ScopeTarget[] = [];
  const add = (kind: ScopeKind, v: unknown) => {
    const id = str(v);
    // a missing id where one is required is a target that cannot resolve: refused
    t.push({ kind, id: id ?? '' });
  };
  switch (action) {
    case 'competition.tournaments':
    case 'competition.liveMatches':
      return null;
    case 'competition.liveMatch':
    case 'competition.liveScore':
    case 'competition.liveStatus':
      add('match', input['matchId']);
      break;
    case 'competition.event':
    case 'competition.addEntry':
    case 'competition.generateDraw':
    case 'competition.syncMatches':
      add('event', input['eventId']);
      break;
    case 'competition.courts':
      add('tournament', input['tournamentId']);
      break;
    case 'competition.saveEvent':
      add('tournament', input['tournamentId']);
      if (input['id'] !== null && input['id'] !== undefined) add('event', input['id']);
      break;
    case 'competition.withdrawEntry':
    case 'competition.setEntry':
      add('entry', input['entryId']);
      break;
    case 'competition.publishDraw':
      add('event', input['eventId']);
      add('draw', input['drawId']);
      break;
    case 'competition.saveMatch':
      add('event', input['eventId']);
      if (input['id'] !== null && input['id'] !== undefined) add('match', input['id']);
      if (input['courtId'] !== null && input['courtId'] !== undefined) add('court', input['courtId']);
      break;
    case 'competition.schedule':
      add('tournament', input['tournamentId']);
      if (Array.isArray(input['eventIds'])) for (const e of input['eventIds']) add('event', e);
      if (Array.isArray(input['courtIds'])) for (const c of input['courtIds']) add('court', c);
      break;
    case 'competition.recordResult':
    case 'competition.confirmResult':
      add('match', input['matchId']);
      break;
    case 'competition.searchPlayers':
    case 'competition.createPlayer':
      add('tournament', input['tournamentId']);
      break;
    case 'competition.saveCourt':
      add('tournament', input['tournamentId']);
      if (input['id'] !== null && input['id'] !== undefined) add('court', input['id']);
      break;
    default:
      return [];
  }
  return t;
}

/** The tournaments the caller may use for this need. */
export function allowedTournaments(assignments: readonly ActiveAssignment[], role: ScopedRole, need: AccessNeed): Set<string> {
  // the assignment's role must be the account's role (the SQL checks the same), then the need decides
  return new Set(assignments.filter((a) => a.role === role && assignmentSatisfies(a.role, need)).map((a) => a.tournamentId));
}

/** The check, without the store: allowed, or the reason it was refused (for tests; the caller only ever sees FORBIDDEN). */
export async function checkScope(
  actor: PlatformActor,
  action: string,
  input: Record<string, unknown>,
  deps: ScopeDeps,
): Promise<{ ok: true; need: AccessNeed; allowed: Set<string> } | { ok: false; why: 'role' | 'action' | 'target' | 'unavailable' }> {
  if (!isScopedRole(actor.role)) return { ok: false, why: 'role' };
  const need = scopedNeed(actor.role, action);
  if (need === null) return { ok: false, why: 'action' };
  let allowed: Set<string>;
  try {
    allowed = allowedTournaments(await deps.assignments(actor.userId), actor.role, need);
  } catch {
    return { ok: false, why: 'unavailable' };
  }
  const targets = targetsOf(action, input);
  if (targets === null) return { ok: true, need, allowed };
  if (targets.length === 0) return { ok: false, why: 'action' };
  for (const target of targets) {
    if (target.id === '') return { ok: false, why: 'target' };
    let tournament: string | null;
    try {
      tournament = target.kind === 'tournament' ? target.id : await deps.resolver.tournamentOf(target.kind, target.id);
    } catch {
      return { ok: false, why: 'unavailable' };
    }
    if (tournament === null || !allowed.has(tournament)) return { ok: false, why: 'target' };
  }
  return { ok: true, need, allowed };
}

export const PROTECTED_NAME = 'Protected player';

/**
 * A scorer is not the organizer: D-109 keeps names of anyone who is not a confirmed adult, and of everyone in a junior event, to the
 * owner and the assigned organizer. The scorer sees "Protected player" for them (ids stay, so the score still goes to the right side).
 * Decided from the stored age status and the event's junior flag, not from the public naming rule (that needs the owner's RPC).
 */
export function maskForScorer(detail: CompetitionEventDetail): CompetitionEventDetail {
  // the same junior rule as the live console (live-scoring/supabase-backend.ts): the event's flag (which already folds in the
  // tournament's minor signal) OR a school_college tournament
  const junior = detail.event.isJunior || detail.tournament.level === 'school_college';
  // a masked player also loses the age status: the scorer's browser never learns who is a minor or unconfirmed
  const mask = (p: CompetitionPlayerDto): CompetitionPlayerDto =>
    junior || p.ageStatus !== 'adult_confirmed' ? { ...p, displayName: PROTECTED_NAME, ageStatus: 'unknown', isProtected: true } : p;
  return { ...detail, entries: detail.entries.map((e) => ({ ...e, players: e.players.map(mask) })) };
}

/**
 * Wraps the competition store for one verified caller. The owner (and anyone not a scoped role) gets `inner` back unchanged; an
 * organizer or scorer gets the checked version. An organizer's event read passes the organizer as the "naming preview" actor: the
 * service then asks the scoped RPC admin_competition_event_naming (0024, 'run' access) instead of the owner-only one, so the "On the
 * site" badges match the owner's. A scorer's reads pass no actor (nobody named; the detail is masked anyway).
 */
export function createScopedCompetitionStore(inner: CompetitionAdminStore, actor: PlatformActor, deps: ScopeDeps): CompetitionAdminStore {
  if (!isScopedRole(actor.role)) return inner;
  const role: ScopedRole = actor.role;
  // the database decides by the id (app.require_competition_access); Actor carries the four roles since 0019
  const asActor = actor as Actor;
  const forbidden = <T>(): StoreResult<T> => failResult('FORBIDDEN');

  async function gate<T>(method: keyof CompetitionAdminStore, input: Record<string, unknown>, run: (allowed: Set<string>) => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
    const verdict = await checkScope(actor, METHOD_ACTION[method], input, deps);
    if (!verdict.ok) return verdict.why === 'unavailable' ? failResult('BACKEND_ERROR') : forbidden<T>();
    return run(verdict.allowed);
  }
  const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});

  return {
    competitionTournaments: () =>
      gate('competitionTournaments', {}, async (allowed) => {
        const r = await inner.competitionTournaments();
        return r.ok ? okResult(r.data.filter((t: CompetitionTournamentDto) => allowed.has(t.id))) : r;
      }),
    competitionEvent: (opts) =>
      gate('competitionEvent', o(opts), async () => {
        // an organizer passes as the actor so the "On the site" preview asks the scoped naming RPC (0024) and tells the truth; a
        // scorer passes none (nobody named) and gets the masked detail
        const r = await inner.competitionEvent(opts, role === 'organizer' ? asActor : undefined);
        if (!r.ok) return r;
        return okResult(role === 'scorer' ? maskForScorer(r.data) : r.data);
      }),
    competitionCourts: (opts) => gate('competitionCourts', o(opts), () => inner.competitionCourts(opts)),
    competitionRankings: () => gate('competitionRankings', {}, () => inner.competitionRankings()),
    competitionRanking: (opts) => gate('competitionRanking', o(opts), () => inner.competitionRanking(opts)),
    competitionSettings: () => gate('competitionSettings', {}, () => inner.competitionSettings()),
    competitionSaveEvent: (_a, input) => gate('competitionSaveEvent', o(input), () => inner.competitionSaveEvent(asActor, input)),
    competitionAddEntry: (_a, input) => gate('competitionAddEntry', o(input), () => inner.competitionAddEntry(asActor, input)),
    competitionWithdrawEntry: (_a, input) => gate('competitionWithdrawEntry', o(input), () => inner.competitionWithdrawEntry(asActor, input)),
    competitionSetEntry: (_a, input) => gate('competitionSetEntry', o(input), () => inner.competitionSetEntry(asActor, input)),
    competitionGenerateDraw: (_a, input) => gate('competitionGenerateDraw', o(input), () => inner.competitionGenerateDraw(asActor, input)),
    competitionPublishDraw: (_a, input) => gate('competitionPublishDraw', o(input), () => inner.competitionPublishDraw(asActor, input)),
    competitionSyncMatches: (_a, input) => gate('competitionSyncMatches', o(input), () => inner.competitionSyncMatches(asActor, input)),
    competitionSaveMatch: (_a, input) => gate('competitionSaveMatch', o(input), () => inner.competitionSaveMatch(asActor, input)),
    competitionSchedule: (_a, input) => gate('competitionSchedule', o(input), () => inner.competitionSchedule(asActor, input)),
    competitionRecordResult: (_a, input) => gate('competitionRecordResult', o(input), () => inner.competitionRecordResult(asActor, input)),
    competitionConfirmResult: (_a, input) => gate('competitionConfirmResult', o(input), () => inner.competitionConfirmResult(asActor, input)),
    competitionComputeRanking: (_a, input) => gate('competitionComputeRanking', o(input), () => inner.competitionComputeRanking(asActor, input)),
    competitionPublishRanking: (_a, input) => gate('competitionPublishRanking', o(input), () => inner.competitionPublishRanking(asActor, input)),
    competitionSaveVenue: (_a, input) => gate('competitionSaveVenue', o(input), () => inner.competitionSaveVenue(asActor, input)),
    competitionSaveCourt: (_a, input) => gate('competitionSaveCourt', o(input), () => inner.competitionSaveCourt(asActor, input)),
    competitionApprovePointsTable: (_a, input) => gate('competitionApprovePointsTable', o(input), () => inner.competitionApprovePointsTable(asActor, input)),
    competitionSearchPlayers: (_a, input) => gate('competitionSearchPlayers', o(input), () => inner.competitionSearchPlayers(asActor, input)),
    competitionCreatePlayer: (_a, input) => gate('competitionCreatePlayer', o(input), () => inner.competitionCreatePlayer(asActor, input)),
  };
}

/** The live scoring method behind each admin action (D-113). The live switch is never reachable by a scoped role. */
export const LIVE_METHOD_ACTION = {
  liveScoringMatches: 'competition.liveMatches',
  liveScoringMatch: 'competition.liveMatch',
  liveScoringScore: 'competition.liveScore',
  liveScoringStatus: 'competition.liveStatus',
  liveScoringSettings: 'competition.liveSettings',
  liveScoringSaveSettings: 'competition.saveLiveSettings',
} as const satisfies Record<keyof LiveScoringAdminStore, string>;

/**
 * The live scoring console for one verified caller, with the same check as the competition store: the owner gets `inner` unchanged;
 * an organizer or scorer sees only the matches of their tournaments, and a tap or status change is checked against the match's
 * tournament before the store (the database checks it again: app.require_competition_access in admin_live_score and
 * admin_live_match_status, 0021). Names: the console shows a name to a non-owner only for a confirmed adult in an adult event.
 */
export function createScopedLiveScoringStore(inner: LiveScoringAdminStore, actor: PlatformActor, deps: ScopeDeps): LiveScoringAdminStore {
  if (!isScopedRole(actor.role)) return inner;
  const asActor = actor as Actor;
  async function gate<T>(method: keyof LiveScoringAdminStore, input: Record<string, unknown>, run: (allowed: Set<string>) => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
    const verdict = await checkScope(actor, LIVE_METHOD_ACTION[method], input, deps);
    if (!verdict.ok) return verdict.why === 'unavailable' ? failResult('BACKEND_ERROR') : failResult('FORBIDDEN');
    return run(verdict.allowed);
  }
  const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
  return {
    liveScoringMatches: () =>
      gate('liveScoringMatches', {}, async (allowed) => {
        const r = await inner.liveScoringMatches(asActor);
        return r.ok ? okResult(r.data.filter((m: LiveMatchSummaryDto) => allowed.has(m.tournamentId))) : r;
      }),
    liveScoringMatch: (input) => gate('liveScoringMatch', o(input), () => inner.liveScoringMatch(input, asActor)),
    liveScoringScore: (_a, input) => gate('liveScoringScore', o(input), () => inner.liveScoringScore(asActor, input)),
    liveScoringStatus: (_a, input) => gate('liveScoringStatus', o(input), () => inner.liveScoringStatus(asActor, input)),
    liveScoringSettings: () => gate('liveScoringSettings', {}, () => inner.liveScoringSettings()),
    liveScoringSaveSettings: (_a, input) => gate('liveScoringSaveSettings', o(input), () => inner.liveScoringSaveSettings(asActor, input)),
  };
}
