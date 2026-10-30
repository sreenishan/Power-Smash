// Pure admin request handler (D-006). The Astro route src/pages/api/admin/[action].ts only builds the dependencies and calls this.
// Every action: POST only, JSON body capped at 64 KB, strict zod validation, origin check, then auth (JWT, aal2, role, policy),
// then the store. Failures return short generic bodies; nothing from the database or GitHub is echoed back on errors.
import { z } from 'zod';
import { AGE_STATUSES, SUPPRESSION_KINDS, TOURNAMENT_LEVELS } from '../archive/types';
import { CATEGORIES } from '../parser/types';
import { LEAD_STATUSES } from '../inbox/status';
import { authorizeAdmin, authorizeEnrolCheck, type AuthDeps } from './auth';
import type { DispatchFn, DispatchKind } from './dispatch';
import { ADMIN_ACTIONS, ENROL_CHECK_ACTION, isAdminAction, type AdminActionName } from './policy';
import { PARSED_FIELDS, PROTECTED_MODE_KEYS, type Actor, type AdminErrorCode, type AdminStore, type StoreResult } from './types';

export interface AdminHandlerDeps {
  auth: AuthDeps;
  store: AdminStore;
  /** null = REBUILD_DISPATCH_TOKEN etc. not configured: dispatching answers `not_configured`, never silently succeeds. */
  dispatch: DispatchFn | null;
  /** Origins allowed to call (the admin hostname). Same-origin requests are always fine. */
  allowedOrigins: readonly string[];
  /** Number of MFA factors the user already has (GoTrue admin API, service key). null = not configured: enrolment is then never offered. */
  factorCount?: ((userId: string) => Promise<number>) | null;
}

const MAX_BODY = 64 * 1024;

const uuid = z.uuid();
const reason = z.string().trim().min(3).max(500);
const videoId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const fieldEnum = z.enum(PARSED_FIELDS);
const shortText = z.string().trim().max(200);
const modeEnum = z.enum(['noindex_minimal', 'hidden']);
const ageNoAdult = z.enum(AGE_STATUSES.filter((s) => s !== 'adult_confirmed') as ['unknown', 'minor_suspected', 'minor_confirmed']);

const empty = z.object({}).strict();
const page = z.object({ limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) }).strict();

// competitions (D-108 to D-114): generous bounds here; the exact rules are in src/lib/admin/competition (validate.ts, the engines) and the SQL
const nullableUuid = uuid.nullable();
const category = z.enum(CATEGORIES);
const ageGroup = z.string().trim().max(20).nullable().transform((v) => (v === '' ? null : v));
const sideEnum = z.enum(['A', 'B']);
const roundCode = z.enum(['F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league']);
const groupLabel = z.string().regex(/^[A-Z]{1,2}$/).nullable();
const revision = z.number().int().min(1).max(1_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const smallInt = (min: number, max: number) => z.number().int().min(min).max(max);
const ruleset = z
  .object({ gamesToWin: smallInt(1, 9), pointsToWin: smallInt(1, 99), winBy: smallInt(1, 99), pointCap: smallInt(1, 99).nullable(), intervalAt: smallInt(1, 99).nullable(), changeEndsInDecidingGameAt: smallInt(1, 99).nullable() })
  .strict();

const COMPETITION_SCHEMAS = {
  'competition.tournaments': empty,
  'competition.event': z.object({ eventId: uuid }).strict(),
  'competition.courts': z.object({ tournamentId: uuid }).strict(),
  'competition.rankings': empty,
  'competition.ranking': z.object({ snapshotId: uuid }).strict(),
  'competition.settings': empty,
  'competition.saveEvent': z
    .object({ id: nullableUuid, tournamentId: uuid, category, ageGroup, format: z.enum(['knockout', 'round_robin', 'groups_knockout']), ruleset, capacity: smallInt(0, 100_000).nullable(), status: z.enum(['draft', 'open', 'closed']), reason })
    .strict(),
  'competition.addEntry': z.object({ eventId: uuid, players: z.array(uuid).min(1).max(2), seed: smallInt(1, 256).nullable(), status: z.enum(['pending', 'confirmed', 'waitlisted']), reason }).strict(),
  'competition.withdrawEntry': z.object({ entryId: uuid, reason }).strict(),
  'competition.setEntry': z.object({ entryId: uuid, status: z.enum(['pending', 'confirmed', 'waitlisted', 'rejected']), seed: smallInt(1, 256).nullable(), reason }).strict(),
  'competition.generateDraw': z
    .object({ eventId: uuid, seed: smallInt(0, 4294967295).nullable().optional(), separateClubs: z.boolean(), seeds: smallInt(0, 64), groupCount: smallInt(1, 26).nullable().optional(), advancePerGroup: smallInt(1, 64).nullable().optional(), reason })
    .strict(),
  'competition.publishDraw': z.object({ eventId: uuid, drawId: uuid, reason }).strict(),
  'competition.syncMatches': z.object({ eventId: uuid, reason }).strict(),
  'competition.saveMatch': z
    .object({
      id: nullableUuid,
      expectedRevision: revision.nullable(),
      eventId: uuid,
      roundCode,
      matchNumber: smallInt(1, 9999),
      groupLabel,
      sideA: nullableUuid,
      sideB: nullableUuid,
      scheduledAt: z.iso.datetime({ offset: true }).nullable(),
      courtId: nullableUuid,
      reason,
    })
    .strict(),
  'competition.schedule': z
    .object({
      tournamentId: uuid,
      eventIds: z.array(uuid).min(1).max(50).optional(),
      windows: z.array(z.object({ date: isoDate, start: hhmm, end: hhmm }).strict()).min(1).max(14),
      durationMinutes: smallInt(5, 300),
      restMinutes: smallInt(0, 600),
      courtIds: z.array(uuid).min(1).max(64).optional(),
      save: z.boolean(),
      expected: z.record(z.uuid(), revision).optional(),
      reason,
    })
    .strict(),
  'competition.recordResult': z
    .object({
      matchId: uuid,
      expectedRevision: revision,
      status: z.enum(['completed', 'walkover', 'retired', 'abandoned']),
      games: z.array(z.object({ a: smallInt(0, 99), b: smallInt(0, 99) }).strict()).max(5),
      walkoverWinner: sideEnum.nullable(),
      retiringSide: sideEnum.nullable(),
      reason,
    })
    .strict(),
  'competition.confirmResult': z.object({ matchId: uuid, expectedRevision: revision, reason }).strict(),
  'competition.computeRanking': z.object({ label: z.string().trim().min(2).max(120), category: category.nullable(), ageGroup, asOf: isoDate, reason }).strict(),
  'competition.publishRanking': z.object({ snapshotId: uuid, reason }).strict(),
  'competition.saveVenue': z.object({ id: nullableUuid, name: z.string().max(200), city: z.string().max(100).nullable(), reason }).strict(),
  'competition.saveCourt': z.object({ id: nullableUuid, tournamentId: uuid, venueId: nullableUuid, label: z.string().max(60), sort: smallInt(0, 999), reason }).strict(),
  'competition.approvePointsTable': z
    .object({
      label: z.string().max(200),
      levels: z.record(z.string().max(30), z.record(z.string().max(10), smallInt(0, 1_000_000))),
      windowDays: smallInt(1, 100_000),
      bestN: smallInt(1, 1000),
      reason,
    })
    .strict(),
} as const;

const SCHEMAS: Record<AdminActionName, z.ZodType> = {
  ...COMPETITION_SCHEMAS,
  'dashboard': empty,
  'review.list': page,
  'review.resolve': z
    .object({
      videoId,
      decision: z.enum(['approve', 'ignore', 'keep_hidden']),
      changes: z.partialRecord(fieldEnum, shortText.nullable()).optional(),
      lockFields: z.array(fieldEnum).max(10).optional(),
      reason,
    })
    .strict(),
  'review.lock': z.object({ videoId, field: fieldEnum, locked: z.boolean() }).strict(),
  'players.search': z.object({ query: z.string().trim().max(80).default(''), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) }).strict(),
  'players.duplicates': z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
  'players.participants': z.object({ playerId: uuid, limit: z.number().int().min(1).max(500).default(200) }).strict(),
  'players.dismissDuplicate': z.object({ aId: uuid, bId: uuid, reason }).strict(),
  'players.merge': z.object({ keepId: uuid, dropId: uuid, reason, overrideReason: z.string().trim().min(3).max(500).optional() }).strict(),
  'players.split': z
    .object({ playerId: uuid, newDisplayName: z.string().trim().min(1).max(120), participantIds: z.array(uuid).min(1).max(200), moveAliasIds: z.array(uuid).max(50).optional(), reason })
    .strict(),
  'players.getProfile': z.object({ playerId: uuid }).strict(),
  // generous bounds here; the exact limits (60/120/600 after trimming) are checked by validatePlayerProfile and by the SQL
  'players.updateProfile': z.object({ playerId: uuid, district: z.string().max(200).nullable(), academy: z.string().max(400).nullable(), bio: z.string().max(2000).nullable(), reason }).strict(),
  'players.rename': z.object({ playerId: uuid, newDisplayName: z.string().trim().min(1).max(120), keepOldAsAlias: z.boolean().optional(), reason }).strict(),
  'players.confirmAdult': z.object({ playerIds: z.array(uuid).min(1).max(200), evidence: z.string().trim().min(3).max(500), reason }).strict(),
  'profileRequests.list': empty,
  'profileRequests.resolve': z.object({ id: uuid, decision: z.enum(['resolve', 'reject']), reason }).strict(),
  'tournaments.candidates': empty,
  'tournaments.decide': z.object({ id: uuid, decision: z.enum(['promote', 'reject', 'hide']), reason }).strict(),
  'tournaments.approved': empty,
  'tournaments.previewSubmission': z.object({ leadId: uuid }).strict(),
  'tournaments.addSubmission': z.object({ leadId: uuid, reason }).strict(),
  'tournaments.permission': z.object({ tournamentId: uuid }).strict(),
  // generous bounds here; the exact rules (statuses, granted is complete, lengths, a past date) are in validatePermission
  'tournaments.setPermission': z
    .object({
      tournamentId: uuid,
      status: z.string().max(20),
      grantedByName: z.string().max(400).nullable(),
      grantedByRole: z.string().max(400).nullable(),
      grantedOn: z.string().max(20).nullable(),
      scopeFilming: z.boolean(),
      scopeYoutube: z.boolean(),
      scopeLiveStream: z.boolean(),
      scopeSponsorOverlays: z.boolean(),
      exclusivePartner: z.string().max(20),
      documentRef: z.string().max(1000).nullable(),
      reason,
    })
    .strict(),
  'tournaments.details': z.object({ id: uuid }).strict(),
  // generous bounds here; the exact rules (lengths, levels, categories, real dates, featured until today or later) are in validateTournamentEdit
  'tournaments.update': z
    .object({
      id: uuid,
      name: z.string().max(400),
      level: z.string().max(40).nullable(),
      city: z.string().max(200).nullable(),
      district: z.string().max(200).nullable(),
      venue: z.string().max(400).nullable(),
      startDate: z.string().max(20).nullable(),
      endDate: z.string().max(20).nullable(),
      categories: z.array(z.string().max(10)).max(20),
      isFeatured: z.boolean(),
      featuredUntil: z.string().max(20).nullable(),
      coveredByPowerSmash: z.boolean(),
      reason,
      expected: z
        .object({
          name: z.string().max(400),
          level: z.enum(TOURNAMENT_LEVELS).nullable(),
          city: z.string().max(200).nullable(),
          district: z.string().max(200).nullable(),
          venue: z.string().max(400).nullable(),
          startDate: z.string().max(20).nullable(),
          endDate: z.string().max(20).nullable(),
          categories: z.array(z.enum(CATEGORIES)).max(20),
          isFeatured: z.boolean(),
          featuredUntil: z.string().max(20).nullable(),
          coveredByPowerSmash: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  'leads.list': z.object({ limit: z.number().int().min(1).max(500).default(200) }).strict(),
  'leads.update': z
    .object({
      id: uuid,
      to: z.enum(LEAD_STATUSES).optional(),
      lostReason: z.string().max(600).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      valuePaise: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
    })
    .strict(),
  'payments.list': z.object({ leadId: uuid }).strict(),
  'payments.mark': z
    .object({
      leadId: uuid,
      provider: z.string().max(30),
      providerRef: z.string().max(120).nullable().optional(),
      paidOn: z.string().max(10),
      grossPaise: z.number().int().min(0).max(10_000_000_000),
      gatewayFeePaise: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
      gstOnFeePaise: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
      tdsPaise: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
      tdsCertificateReceived: z.boolean().nullable().optional(),
      tdsCertificateOn: z.string().max(10).nullable().optional(),
      documentType: z.string().max(30),
      gstRegistered: z.boolean().nullable(),
      reverseCharge: z.boolean().nullable().optional(),
      invoiceTotalPaise: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
    })
    .strict(),
  'submissions.list': z.object({ limit: z.number().int().min(1).max(200).default(100) }).strict(),
  'submissions.review': z
    .object({ id: uuid, action: z.enum(['approve', 'reject', 'mark_uploaded']), reason: z.string().max(600).nullable().optional(), youtubeId: z.string().max(40).nullable().optional() })
    .strict(),
  'placements.list': empty,
  'placements.create': z
    .object({
      sponsorId: uuid,
      slot: z.string().max(60),
      scopeKey: z.string().max(80).nullable().optional(),
      creativeDesktopPath: z.string().max(200).nullable().optional(),
      creativeMobilePath: z.string().max(200).nullable().optional(),
      alt: z.string().max(300),
      headline: z.string().max(120).nullable().optional(),
      targetUrl: z.string().max(500),
      goSlug: z.string().max(80),
      startDate: z.string().max(10),
      endDate: z.string().max(10),
      priority: z.number().int().min(-1000).max(1000).optional(),
      label: z.string().max(20),
    })
    .strict(),
  'placements.setStatus': z.object({ id: uuid, status: z.enum(['active', 'paused', 'ended']) }).strict(),
  'products.list': empty,
  'live.get': empty,
  // generous bounds here; the exact rules (ids or YouTube links, 20 streams, 100-character titles, real dates) are in validateLiveEdit
  'live.save': z.object({ pinned: z.string().max(300).nullable(), past: z.array(z.object({ video: z.string().max(300), title: z.string().max(400), date: z.string().max(20).nullable() }).strict()).max(40), reason }).strict(),
  'products.save': z
    .object({
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
      name: z.string().max(200),
      summary: z.string().max(600),
      priceType: z.string().max(20),
      priceRupees: z.string().max(30).nullable().optional(),
      pricePaise: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
      gstInclusive: z.boolean().nullable().optional(),
      deliveryDays: z.number().int().min(0).max(1000).nullable().optional(),
      visible: z.boolean(),
      sort: z.number().int().min(0).max(10_000).optional(),
      inclusions: z.array(z.string().max(300)).max(40).optional(),
      inclusionsApproved: z.boolean().optional(),
      quoteWordingApproved: z.boolean().optional(),
    })
    .strict(),
  'posters.list': empty,
  'settings.get': empty,
  'settings.setProtectedMode': z.object({ key: z.enum(PROTECTED_MODE_KEYS), value: modeEnum, reason }).strict(),
  'emergency.hide': z
    .object({
      kind: z.enum(SUPPRESSION_KINDS),
      value: z.string().trim().min(1).max(200),
      reason,
      receivedAt: z.iso.datetime().optional(),
      requestedBy: z.string().trim().max(120).optional(),
    })
    .strict(),
  'emergency.release': z.object({ suppressionId: uuid, reason }).strict(),
  'site.syncNow': empty,
  'site.publishNow': empty,
  'audit.list': z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
  'undo': z
    .object({
      descriptor: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('set_setting'), key: z.enum(PROTECTED_MODE_KEYS), value: modeEnum }).strict(),
        z.object({ kind: z.literal('release_suppression'), suppressionId: uuid }).strict(),
        z.object({ kind: z.literal('restore_age'), entries: z.array(z.object({ id: uuid, status: ageNoAdult }).strict()).min(1).max(200) }).strict(),
        z.object({ kind: z.literal('merge'), token: z.string().min(8).max(100) }).strict(),
      ]),
    })
    .strict(),
};

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
} as const;

const STATUS: Record<AdminErrorCode, number> = {
  NOT_FOUND: 404,
  SAME_PLAYER: 422,
  ALREADY_MERGED: 409,
  SUPPRESSED: 409,
  MINOR_ADULT_MERGE_BLOCKED: 409,
  OVERRIDE_REASON_REQUIRED: 422,
  EMPTY_NAME: 422,
  ALIAS_NOT_OWNED: 422,
  REDIRECT_LOOP: 409,
  UNDO_UNAVAILABLE: 409,
  STALE: 409,
  INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  BACKEND_ERROR: 502,
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

function corsFor(request: Request, allowed: readonly string[]): { ok: boolean; headers: Record<string, string> } {
  const origin = request.headers.get('origin');
  if (origin === null) return { ok: true, headers: {} };
  let sameOrigin = false;
  try {
    sameOrigin = new URL(request.url).origin === origin;
  } catch {
    sameOrigin = false;
  }
  if (sameOrigin || allowed.includes(origin)) {
    return { ok: true, headers: { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '600' } };
  }
  return { ok: false, headers: {} };
}

const fromStore = <T>(r: StoreResult<T>, cors: Record<string, string>): Response =>
  r.ok ? json({ ok: true, data: r.data }, 200, cors) : json({ ok: false, code: r.code, ...(r.errors ? { errors: r.errors } : {}) }, STATUS[r.code], cors);

export function createAdminHandler(deps: AdminHandlerDeps) {
  return async function handle(request: Request, actionName: string): Promise<Response> {
    const cors = corsFor(request, deps.allowedOrigins);
    if (!cors.ok) return json({ ok: false, code: 'forbidden' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...cors.headers } });
    if (request.method !== 'POST') return json({ ok: false, code: 'method' }, 405, { allow: 'POST, OPTIONS' });
    if (actionName === ENROL_CHECK_ACTION) return enrolCheck(request, deps, cors.headers);
    if (!isAdminAction(actionName)) return json({ ok: false, code: 'not_found' }, 404, cors.headers);

    const decision = await authorizeAdmin(request, actionName, deps.auth);
    if (!decision.ok) return json({ ok: false, code: decision.code }, decision.status, cors.headers);

    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return json({ ok: false, code: 'invalid' }, 400, cors.headers);
    }
    if (raw.length > MAX_BODY) return json({ ok: false, code: 'too_large' }, 413, cors.headers);
    let body: unknown = {};
    if (raw.trim() !== '') {
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ ok: false, code: 'invalid' }, 400, cors.headers);
      }
    }
    const parsed = SCHEMAS[actionName].safeParse(body);
    if (!parsed.success) return json({ ok: false, code: 'invalid' }, 400, cors.headers);
    return run(actionName, decision.actor, parsed.data as Record<string, never>, deps, cors.headers);
  };
}

/** S2-8: a session may enrol a factor only when the owner profile exists AND no factor exists yet. Never adds a second factor from aal1. */
async function enrolCheck(request: Request, deps: AdminHandlerDeps, cors: Record<string, string>): Promise<Response> {
  const d = await authorizeEnrolCheck(request, deps.auth);
  if (!d.ok) return json({ ok: false, code: d.code }, d.status, cors);
  if (!deps.factorCount) return json({ ok: true, data: { allowed: false } }, 200, cors);
  let count: number;
  try {
    count = await deps.factorCount(d.actor.userId);
  } catch {
    return json({ ok: false, code: 'unavailable' }, 503, cors);
  }
  return json({ ok: true, data: { allowed: count === 0 } }, 200, cors);
}

// The cast below is safe: SCHEMAS[action] validated the exact input shape the store method takes.
async function run(action: AdminActionName, actor: Actor, input: any, deps: AdminHandlerDeps, cors: Record<string, string>): Promise<Response> {
  const s = deps.store;
  switch (action) {
    case 'dashboard': return fromStore(await s.getDashboard(), cors);
    case 'review.list': return fromStore(await s.listReviewQueue(input), cors);
    case 'review.resolve': return fromStore(await s.resolveReview(actor, input), cors);
    case 'review.lock': return fromStore(await s.setFieldLock(actor, input), cors);
    case 'players.search': return fromStore(await s.searchPlayers(input), cors);
    case 'players.duplicates': return fromStore(await s.listDuplicates(input), cors);
    case 'players.participants': return fromStore(await s.listParticipants(input), cors);
    case 'players.dismissDuplicate': return fromStore(await s.dismissDuplicate(actor, input), cors);
    case 'players.merge': return fromStore(await s.mergePlayers(actor, input), cors);
    case 'players.split': return fromStore(await s.splitPlayer(actor, input), cors);
    case 'players.rename': return fromStore(await s.renamePlayer(actor, input), cors);
    case 'players.getProfile': return fromStore(await s.getPlayerProfile(input), cors);
    case 'players.updateProfile': return fromStore(await s.updatePlayerProfile(actor, input), cors);
    case 'players.confirmAdult': return fromStore(await s.confirmAdultBulk(actor, input), cors);
    case 'leads.list': return fromStore(await s.listLeads(input), cors);
    case 'leads.update': return fromStore(await s.updateLead(actor, input), cors);
    case 'payments.list': return fromStore(await s.listPayments(input), cors);
    case 'payments.mark': return fromStore(await s.markPaid(actor, input), cors);
    case 'submissions.list': return fromStore(await s.listSubmissions(input), cors);
    case 'submissions.review': return fromStore(await s.reviewSubmission(actor, input), cors);
    case 'placements.list': return fromStore(await s.listPlacements(), cors);
    case 'placements.create': return fromStore(await s.createPlacement(actor, input), cors);
    case 'placements.setStatus': return fromStore(await s.setPlacementStatus(actor, input), cors);
    case 'products.list': return fromStore(await s.listProducts(), cors);
    case 'products.save': return fromStore(await s.saveProduct(actor, input), cors);
    case 'live.get': return fromStore(await s.getLive(), cors);
    case 'live.save': return fromStore(await s.saveLive(actor, input), cors);
    case 'posters.list': return fromStore(await s.listPosterTargets(), cors);
    case 'profileRequests.list': return fromStore(await s.listProfileRequests(), cors);
    case 'profileRequests.resolve': return fromStore(await s.resolveProfileRequest(actor, input), cors);
    case 'tournaments.candidates': return fromStore(await s.listTournamentCandidates(), cors);
    case 'tournaments.decide': return fromStore(await s.decideTournament(actor, input), cors);
    case 'tournaments.approved': return fromStore(await s.listApprovedTournaments(), cors);
    case 'tournaments.previewSubmission': return fromStore(await s.previewSubmission(input), cors);
    case 'tournaments.addSubmission': return fromStore(await s.addSubmission(actor, input), cors);
    case 'tournaments.permission': return fromStore(await s.getFilmingPermission(input), cors);
    case 'tournaments.setPermission': return fromStore(await s.setFilmingPermission(actor, input), cors);
    case 'tournaments.details': return fromStore(await s.getTournamentDetails(input), cors);
    case 'tournaments.update': return fromStore(await s.updateTournamentDetails(actor, input), cors);
    case 'settings.get': return fromStore(await s.getProtectedModes(), cors);
    case 'settings.setProtectedMode': return fromStore(await s.setProtectedMode(actor, input), cors);
    case 'emergency.release': return fromStore(await s.releaseSuppression(actor, input), cors);
    case 'audit.list': return fromStore(await s.listAudit(input), cors);
    case 'undo': return fromStore(await s.undo(actor, input.descriptor), cors);
    case 'competition.tournaments': return fromStore(await s.competitionTournaments(), cors);
    case 'competition.event': return fromStore(await s.competitionEvent(input, actor), cors);
    case 'competition.courts': return fromStore(await s.competitionCourts(input), cors);
    case 'competition.rankings': return fromStore(await s.competitionRankings(), cors);
    case 'competition.ranking': return fromStore(await s.competitionRanking(input, actor), cors);
    case 'competition.settings': return fromStore(await s.competitionSettings(), cors);
    case 'competition.saveEvent': return fromStore(await s.competitionSaveEvent(actor, input), cors);
    case 'competition.addEntry': return fromStore(await s.competitionAddEntry(actor, input), cors);
    case 'competition.withdrawEntry': return fromStore(await s.competitionWithdrawEntry(actor, input), cors);
    case 'competition.setEntry': return fromStore(await s.competitionSetEntry(actor, input), cors);
    case 'competition.generateDraw': return fromStore(await s.competitionGenerateDraw(actor, input), cors);
    case 'competition.publishDraw': return fromStore(await s.competitionPublishDraw(actor, input), cors);
    case 'competition.syncMatches': return fromStore(await s.competitionSyncMatches(actor, input), cors);
    case 'competition.saveMatch': return fromStore(await s.competitionSaveMatch(actor, input), cors);
    case 'competition.schedule': return fromStore(await s.competitionSchedule(actor, input), cors);
    case 'competition.recordResult': return fromStore(await s.competitionRecordResult(actor, input), cors);
    case 'competition.confirmResult': return fromStore(await s.competitionConfirmResult(actor, input), cors);
    case 'competition.computeRanking': return fromStore(await s.competitionComputeRanking(actor, input), cors);
    case 'competition.publishRanking': return fromStore(await s.competitionPublishRanking(actor, input), cors);
    case 'competition.saveVenue': return fromStore(await s.competitionSaveVenue(actor, input), cors);
    case 'competition.saveCourt': return fromStore(await s.competitionSaveCourt(actor, input), cors);
    case 'competition.approvePointsTable': return fromStore(await s.competitionApprovePointsTable(actor, input), cors);
    case 'site.syncNow': return dispatchAction('sync', actor, deps, cors);
    case 'site.publishNow': return dispatchAction('publish', actor, deps, cors);
    case 'emergency.hide': {
      const r = await s.emergencyHide(actor, input);
      if (!r.ok) return fromStore(r, cors);
      // D-014: hide actions call Publish now automatically. A failed dispatch does not undo the hide; the owner is told.
      const deploy = deps.dispatch ? ((await deps.dispatch('publish')).ok ? 'requested' : 'failed') : 'not_configured';
      if (deploy === 'requested') await s.recordDispatch(actor, { kind: 'publish', ok: true });
      return json({ ok: true, data: { ...r.data, deploy } }, 200, cors);
    }
  }
}

async function dispatchAction(kind: DispatchKind, actor: Actor, deps: AdminHandlerDeps, cors: Record<string, string>): Promise<Response> {
  if (!deps.dispatch) return json({ ok: false, code: 'not_configured' }, 503, cors);
  const outcome = await deps.dispatch(kind);
  const audited = await deps.store.recordDispatch(actor, { kind, ok: outcome.ok });
  if (!outcome.ok) return json({ ok: false, code: outcome.reason === 'not_configured' ? 'not_configured' : 'dispatch_failed' }, outcome.reason === 'not_configured' ? 503 : 502, cors);
  return json({ ok: true, data: { dispatched: true, audited: audited.ok } }, 200, cors);
}

export { ADMIN_ACTIONS };
