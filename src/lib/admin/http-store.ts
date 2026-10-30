// Browser-side AdminStore: calls the Worker (`POST /api/admin/<action>`) with the Supabase session token as a bearer header. The actor
// argument of the interface is ignored on purpose: the Worker takes the actor ONLY from the verified token, never from the browser.
import {
  failResult,
  okResult,
  type AdminErrorCode,
  type AdminStore,
  type StoreResult,
} from './types';

export interface AdminClient extends AdminStore {
  syncNow(): Promise<StoreResult<{ dispatched: boolean }>>;
  publishNow(): Promise<StoreResult<{ dispatched: boolean }>>;
}

export interface HttpStoreOptions {
  /** Default `/api/admin`. */
  baseUrl?: string;
  getToken: () => string | null;
  fetch: typeof fetch;
}

const CODES: readonly AdminErrorCode[] = ['NOT_FOUND', 'SAME_PLAYER', 'ALREADY_MERGED', 'SUPPRESSED', 'MINOR_ADULT_MERGE_BLOCKED', 'OVERRIDE_REASON_REQUIRED', 'EMPTY_NAME', 'ALIAS_NOT_OWNED', 'REDIRECT_LOOP', 'UNDO_UNAVAILABLE', 'STALE', 'INVALID', 'UNAUTHORIZED', 'FORBIDDEN'];


/** S2-8: asks the Worker whether a first TOTP factor may be enrolled for this (aal1) session. Anything but an explicit yes is a no. */
export async function canEnrolTotp(opts: { baseUrl?: string; token: string; fetch: typeof fetch }): Promise<boolean> {
  try {
    const res = await opts.fetch(`${(opts.baseUrl ?? '/api/admin').replace(/\/+$/, '')}/session.enrolCheck`, { method: 'POST', headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean; data?: { allowed?: boolean } };
    return json.ok === true && json.data?.allowed === true;
  } catch {
    return false;
  }
}

export function createHttpAdminStore(opts: HttpStoreOptions): AdminClient {
  const base = (opts.baseUrl ?? '/api/admin').replace(/\/+$/, '');
  async function post<T>(action: string, body: object = {}): Promise<StoreResult<T>> {
    const token = opts.getToken();
    if (!token) return failResult('UNAUTHORIZED');
    let res: Response;
    try {
      res = await opts.fetch(`${base}/${action}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      return failResult('BACKEND_ERROR');
    }
    let json: { ok?: boolean; data?: T; code?: string; errors?: Record<string, string> } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      // not JSON
    }
    if (res.ok && json.ok === true) return okResult(json.data as T);
    if (res.status === 401) return failResult('UNAUTHORIZED');
    if (res.status === 403) return failResult('FORBIDDEN');
    const code = (json.code ?? '').toString();
    const upper = CODES.find((c) => c === code);
    return failResult(upper ?? 'BACKEND_ERROR', json.errors && typeof json.errors === 'object' ? json.errors : undefined);
  }
  const noActor = <I>(action: string) => (_actor: unknown, input: I) => post<never>(action, input as object);
  return {
    getDashboard: () => post('dashboard'),
    listReviewQueue: (o) => post('review.list', o),
    resolveReview: noActor('review.resolve'),
    setFieldLock: noActor('review.lock'),
    searchPlayers: (o) => post('players.search', o),
    listDuplicates: (o) => post('players.duplicates', o),
    listParticipants: (o) => post('players.participants', o),
    dismissDuplicate: noActor('players.dismissDuplicate'),
    mergePlayers: noActor('players.merge'),
    splitPlayer: noActor('players.split'),
    renamePlayer: noActor('players.rename'),
    getPlayerProfile: (o) => post('players.getProfile', o),
    updatePlayerProfile: noActor('players.updateProfile'),
    confirmAdultBulk: noActor('players.confirmAdult'),
    listLeads: (o) => post('leads.list', o),
    updateLead: noActor('leads.update'),
    listPayments: (o) => post('payments.list', o),
    markPaid: noActor('payments.mark'),
    listSubmissions: (o) => post('submissions.list', o),
    reviewSubmission: noActor('submissions.review'),
    listPlacements: () => post('placements.list'),
    createPlacement: noActor('placements.create'),
    setPlacementStatus: noActor('placements.setStatus'),
    listProducts: () => post('products.list'),
    saveProduct: noActor('products.save'),
    listPosterTargets: () => post('posters.list'),
    getLive: () => post('live.get'),
    saveLive: noActor('live.save'),
    listProfileRequests: () => post('profileRequests.list'),
    resolveProfileRequest: noActor('profileRequests.resolve'),
    listTournamentCandidates: () => post('tournaments.candidates'),
    decideTournament: noActor('tournaments.decide'),
    listApprovedTournaments: () => post('tournaments.approved'),
    previewSubmission: (o) => post('tournaments.previewSubmission', o),
    addSubmission: noActor('tournaments.addSubmission'),
    getFilmingPermission: (o) => post('tournaments.permission', o),
    setFilmingPermission: noActor('tournaments.setPermission'),
    getTournamentDetails: (o) => post('tournaments.details', o),
    updateTournamentDetails: noActor('tournaments.update'),
    getProtectedModes: () => post('settings.get'),
    setProtectedMode: noActor('settings.setProtectedMode'),
    emergencyHide: noActor('emergency.hide'),
    releaseSuppression: noActor('emergency.release'),
    recordDispatch: async () => okResult({ recorded: true as const }), // the Worker records dispatches itself
    listAudit: (o) => post('audit.list', o),
    undo: (_actor, descriptor) => post('undo', { descriptor }),
    // competitions (D-108 to D-114)
    competitionTournaments: () => post('competition.tournaments'),
    competitionEvent: (o) => post('competition.event', o),
    competitionCourts: (o) => post('competition.courts', o),
    competitionRankings: () => post('competition.rankings'),
    competitionRanking: (o) => post('competition.ranking', o),
    competitionSettings: () => post('competition.settings'),
    competitionSaveEvent: noActor('competition.saveEvent'),
    competitionAddEntry: noActor('competition.addEntry'),
    competitionWithdrawEntry: noActor('competition.withdrawEntry'),
    competitionSetEntry: noActor('competition.setEntry'),
    competitionGenerateDraw: noActor('competition.generateDraw'),
    competitionPublishDraw: noActor('competition.publishDraw'),
    competitionSyncMatches: noActor('competition.syncMatches'),
    competitionSaveMatch: noActor('competition.saveMatch'),
    competitionSchedule: noActor('competition.schedule'),
    competitionRecordResult: noActor('competition.recordResult'),
    competitionConfirmResult: noActor('competition.confirmResult'),
    competitionComputeRanking: noActor('competition.computeRanking'),
    competitionPublishRanking: noActor('competition.publishRanking'),
    competitionSaveVenue: noActor('competition.saveVenue'),
    competitionSaveCourt: noActor('competition.saveCourt'),
    competitionApprovePointsTable: noActor('competition.approvePointsTable'),
    syncNow: () => post('site.syncNow'),
    publishNow: () => post('site.publishNow'),
  };
}
