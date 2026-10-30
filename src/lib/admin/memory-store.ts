// In-memory AdminStore: used by tests and by the admin preview when no backend is configured. It applies the SAME pure identity
// rules (src/lib/identity) the SQL RPCs implement, writes an audit row for every privileged action, and offers undo where possible.
// Seed data is FICTIONAL (invented names, `fake-` video ids). Nothing here touches the network.
import { changedProfileFields, validatePlayerProfile, type PlayerProfileFields } from './player-profile';
import { liveChanges, NO_LIVE, validateLiveEdit, type LiveSettings } from '../live/rules';
import { todayIst } from '../dates';
import { changedTournamentFields, sameTournamentDetails, validateTournamentEdit, type TournamentDetails } from './tournament-edit';
import { submissionPreview, type SubmissionPayload, type SubmissionPreview } from './submission-candidate';
import { changedPermissionFields, NO_PERMISSION, validatePermission, type FilmingPermission, type PermissionInput } from './filming-permission';
import { findPossibleDuplicates, pairKey, planMerge, planRename, planSplit, applyMergeUndo, canConfirmAdult, MAX_BULK_CONFIRM, removeRedirectsFor, suppressionsForPlayer, tombstone, addSuppressions } from '../identity';
import type { IdAlias, IdPlayer, IdentityState, MergeUndo, Suppression } from '../identity';
import { normalizeName } from '../parser/normalize';
import { products as contentProducts } from '../../content/products';
import type { InboxLead } from '../inbox/lead';
import type { Placement } from '../placements/schedule';
import { istDateOf } from '../placements/schedule';
import type { ProductRecord } from '../pricing-admin/product-edit';
import type { PaymentRecord } from '../pricing-admin/mark-paid';
import { applyLeadUpdate, checkStatusChange, prepareMarkPaid, prepareNewPlacement, prepareProductSave } from './ops';
import { consentView, leadMove, validateReview, type VideoSubmission } from './submissions';
import type { AdminClient } from './http-store';
import {
  failResult,
  okResult,
  type Actor,
  type AdminStore,
  type AuditEntry,
  type ConfirmAdultResult,
  type DashboardData,
  type DuplicatePairDto,
  type ParsedField,
  type PlayerSummary,
  type LeadUpdateInput,
  type MarkPaidRequest,
  type MarkPaidResult,
  type SubmissionReviewRequest,
  type PlacementCreateInput,
  type ProductSaveInput,
  type LiveSaveInput,
  type TournamentUpdateInput,
  type ProfileRequest,
  type ProtectedMatchMode,
  type PlacementsData,
  type PosterTarget,
  type ProductItem,
  type ReviewVideo,
  type SponsorDto,
  type StoreResult,
  type TournamentCandidate,
  type UndoDescriptor,
  type PlayerProfileInput,
} from './types';

export interface MemoryVideo extends ReviewVideo {
  visibility: 'hidden' | 'listed_no_player_pages' | 'public';
  parseStatus: 'parsed' | 'needs_review' | 'ignored';
}

export interface MemorySuppression extends Suppression {
  id: string;
  reason: string;
  releasedAt: string | null;
  affectedPlayerIds: string[];
  affectedVideoIds: string[];
  affectedTournamentIds: string[];
  /** Companion suppressions (player id / name key) created together with this one. */
  pairedIds: string[];
}

export interface MemoryParticipant {
  id: string;
  matchId: string;
  playerId: string | null;
  rawName: string;
  videoTitleRaw: string | null;
}

export interface MemoryState {
  identity: IdentityState;
  videos: MemoryVideo[];
  participants: MemoryParticipant[];
  profileRequests: ProfileRequest[];
  tournaments: TournamentCandidate[];
  leads: InboxLead[];
  payments: { leadId: string; record: PaymentRecord }[];
  submissions: VideoSubmission[];
  sponsors: SponsorDto[];
  placements: Placement[];
  products: ProductItem[];
  suppressions: MemorySuppression[];
  dismissedPairs: string[];
  modes: { unknown_match_mode: ProtectedMatchMode; minor_match_mode: ProtectedMatchMode };
  /** Adult players' profile fields by player id (D-100). Absent = nothing stated. */
  playerProfiles?: Record<string, PlayerProfileFields>;
  /** The /live pin and past streams (D-101). Absent = nothing pinned, no list. */
  live?: LiveSettings;
  /** Tournament details by id (D-102). Absent = only the name is known. */
  tournamentDetails?: Record<string, TournamentDetails>;
  /** The tournament fields of tournament_submission leads, by lead id (the payload /api/lead stores; no contact data). */
  leadPayloads?: Record<string, SubmissionPayload>;
  /** Which lead became which tournament (D-103), and the addresses given out. */
  submissionLinks?: Record<string, string>;
  tournamentSlugs?: Record<string, string>;
  /** Filming permission by tournament id (D-019, D-105). Absent = unknown. */
  filmingPermissions?: Record<string, FilmingPermission>;
  audit: AuditEntry[];
  siteDirty: boolean;
  lastDeployStatus: string | null;
  lastDeployAt: string | null;
}

export interface MemoryOptions {
  now?: () => Date;
  newId?: () => string;
  state?: MemoryState;
}

const NO_PROFILE: PlayerProfileFields = { district: null, academy: null, bio: null };

const SEED_IDS = {
  p1: '10000000-0000-4000-8000-000000000001',
  p2: '10000000-0000-4000-8000-000000000002',
  p3: '10000000-0000-4000-8000-000000000003',
  p4: '10000000-0000-4000-8000-000000000004',
  p5: '10000000-0000-4000-8000-000000000005',
  p6: '10000000-0000-4000-8000-000000000006',
  t1: '20000000-0000-4000-8000-000000000001',
  t2: '20000000-0000-4000-8000-000000000002',
  r1: '30000000-0000-4000-8000-000000000001',
  r2: '30000000-0000-4000-8000-000000000002',
  l1: '60000000-0000-4000-8000-000000000001',
  l2: '60000000-0000-4000-8000-000000000002',
  s1: '70000000-0000-4000-8000-000000000001',
  l3: '60000000-0000-4000-8000-000000000003',
  l4: '60000000-0000-4000-8000-000000000004',
} as const;
export const SEED = SEED_IDS;

function seedPlayer(id: string, displayName: string, over: Partial<IdPlayer> = {}): IdPlayer {
  return {
    id,
    slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    displayName,
    ageStatus: 'adult_confirmed',
    ageSignals: [],
    nameKey: null,
    latinKey: null,
    provisional: false,
    consentStatus: 'unknown',
    visibility: 'public',
    mergedInto: null,
    ...over,
  };
}

/** Fictional preview data. Invented names only. */
export function createSeedState(): MemoryState {
  const players: IdPlayer[] = [
    seedPlayer(SEED_IDS.p1, 'Demo Arvind Testwell'),
    seedPlayer(SEED_IDS.p2, 'Demo Arvind Testwel', { ageStatus: 'unknown', slug: 'p-0000000000000002', visibility: 'hidden' }),
    seedPlayer(SEED_IDS.p3, 'Demo Meena Samplestone', { ageStatus: 'unknown', slug: 'p-0000000000000003', visibility: 'hidden' }),
    seedPlayer(SEED_IDS.p4, 'Demo Junior Fakeson', { ageStatus: 'minor_suspected', ageSignals: ['age_token:U15'], slug: 'p-0000000000000004', visibility: 'hidden' }),
    seedPlayer(SEED_IDS.p5, 'Demo Kiran Placeholder', { ageStatus: 'unknown', slug: 'p-0000000000000005', visibility: 'hidden', provisional: true }),
    seedPlayer(SEED_IDS.p6, 'Demo Kiran Placeholdr', { ageStatus: 'unknown', slug: 'p-0000000000000006', visibility: 'hidden', provisional: true }),
  ];
  const al = (id: string, alias: string, playerId: string): IdAlias => ({ id, aliasNormalized: alias, playerId, status: 'confirmed', scopeTournamentId: null, scopeDistrict: null });
  const video = (n: number, title: string, over: Partial<MemoryVideo> = {}): MemoryVideo => ({
    youtubeId: `fake-vid-${n}`,
    titleRaw: title,
    publishedAt: '2026-09-01T10:00:00.000Z',
    parsed: { tournament: 'Demo Open Cup', category: 'MS', age_group: null, round: 'Final', participants: 'Demo A vs Demo B' },
    reviewReasons: ['UNKNOWN_AGE_TOKEN'],
    hardFlags: [],
    confidencePoints: 70,
    minorHold: false,
    locks: {},
    overrideStale: false,
    visibility: 'hidden',
    parseStatus: 'needs_review',
    ...over,
  });
  return {
    identity: {
      players,
      aliases: [al('40000000-0000-4000-8000-000000000001', 'demo arvind testwell', SEED_IDS.p1), al('40000000-0000-4000-8000-000000000002', 'demo arvind testwel', SEED_IDS.p2)],
      redirects: [],
    },
    videos: [
      video(1, 'DEMO A vs DEMO B | Demo Open Cup Final | Fake Title One'),
      video(2, 'DEMO C vs DEMO D | Under 15 Boys | Fake Title Two', { reviewReasons: ['MINOR_HOLD'], minorHold: true, hardFlags: ['UNKNOWN_AGE_TOKEN'], parsed: { tournament: 'Demo Juniors', category: null, age_group: 'U15', round: null, participants: 'Demo C vs Demo D' } }),
    ],
    participants: [
      { id: '50000000-0000-4000-8000-000000000001', matchId: 'fake-match-1', playerId: SEED_IDS.p5, rawName: 'DEMO KIRAN', videoTitleRaw: 'DEMO KIRAN vs DEMO ONE | Demo Open Cup | Fake Title Three' },
      { id: '50000000-0000-4000-8000-000000000002', matchId: 'fake-match-2', playerId: SEED_IDS.p5, rawName: 'DEMO KIRAN P', videoTitleRaw: 'DEMO TWO vs DEMO KIRAN P | Demo Open Cup | Fake Title Four' },
    ],
    profileRequests: [{ id: SEED_IDS.r1, playerId: SEED_IDS.p1, kind: 'claim', status: 'new', receivedAt: '2026-10-01T08:00:00.000Z', summary: 'D. asks to claim a profile (demo request)' }],
    tournaments: [
      { id: SEED_IDS.t1, name: 'Demo Open Cup', seriesKey: 'demo open cup', editionYear: 2026, matchCount: 2, region: 'tamil_nadu', isPromoted: false, source: 'submitted', visibility: 'hidden', status: 'pending' },
      { id: SEED_IDS.t2, name: 'Demo Far Away Trophy', seriesKey: 'demo far away trophy', editionYear: 2026, matchCount: 5, region: 'other_india', isPromoted: false, source: 'parsed', visibility: 'listed_no_player_pages', status: 'pending' },
    ],
    leads: [
      { id: SEED_IDS.l1, refCode: 'PS-2026-DEMK01', type: 'coverage', status: 'new', name: 'Demo Organizer', organization: 'Demo Badminton Club', phone: '910000000000', email: null, whatsappOk: true, valuePaise: null, sourcePath: '/book/', followUpOn: null, notes: null, lostReason: null, createdAt: '2026-10-20T06:00:00.000Z' },
      { id: SEED_IDS.l2, refCode: 'PS-2026-DEMK02', type: 'sponsorship', status: 'contacted', name: 'Demo Sponsor Person', organization: 'Demo Sports Shop', phone: '910000000000', email: null, whatsappOk: false, valuePaise: null, sourcePath: '/partner/', followUpOn: '2026-10-25', notes: 'Asked for a call on Saturday (demo note).', lostReason: null, createdAt: '2026-10-18T06:00:00.000Z' },
      { id: SEED_IDS.l3, refCode: 'PS-2026-DEMK03', type: 'video_submission', status: 'new', name: 'Demo Sender', organization: null, phone: '910000000000', email: null, whatsappOk: false, valuePaise: null, sourcePath: '/submit-video/', followUpOn: null, notes: null, lostReason: null, createdAt: '2026-10-19T06:00:00.000Z' },
      { id: SEED_IDS.l4, refCode: 'PS-2026-DEMK04', type: 'tournament_submission', status: 'new', name: 'Demo Club Secretary', organization: 'Demo Shuttle Association', phone: '910000000000', email: null, whatsappOk: true, valuePaise: null, sourcePath: '/tournaments/submit/', followUpOn: null, notes: null, lostReason: null, createdAt: '2026-10-21T06:00:00.000Z' },
    ],
    leadPayloads: {
      [SEED_IDS.l4]: { tournamentName: 'Demo Shuttle Open 2026', startDate: '2026-12-05', endDate: '2026-12-06', venue: 'Demo Indoor Hall', city: 'Coimbatore', district: 'Coimbatore' },
    },
    payments: [],
    submissions: [
      {
        id: SEED_IDS.l3,
        refCode: 'PS-2026-DEMK03',
        createdAt: '2026-10-19T06:00:00.000Z',
        submitterName: 'Demo Sender',
        role: 'coach',
        videoUrl: 'https://video.example.test/watch/demo-clip',
        tournamentName: 'Demo Open Cup',
        matchDate: '2026-10-10',
        category: 'MS',
        round: 'Final',
        players: 'Demo A vs Demo B',
        notes: 'Filmed from the stands (demo).',
        footageSource: 'self',
        organizerName: null,
        filmingPermission: 'unsure',
        minorsVisible: 'no',
        consents: consentView([]).map((c) => ({ ...c, version: c.currentVersion ?? 'demo', given: true })),
        status: 'new',
        youtubeId: null,
        rejectReason: null,
      },
    ],
    sponsors: [{ id: SEED_IDS.s1, name: 'Demo Sports Shop', website: 'https://sponsor.example.test', active: true }],
    placements: [],
    // the real product list (public content) with NO price: a price exists only when the owner types one
    products: contentProducts.slice(0, 3).map((p, i) => ({
      slug: p.slug,
      group: p.group,
      record: { name: p.name, summary: p.summary, priceType: p.priceType, pricePaise: null, gstInclusive: null, deliveryDays: null, visible: false, sort: i, inclusions: p.inclusions.map((x) => x.text), inclusionsApproved: false, quoteWordingApproved: false } satisfies ProductRecord,
    })),
    suppressions: [],
    dismissedPairs: [],
    modes: { unknown_match_mode: 'noindex_minimal', minor_match_mode: 'hidden' },
    audit: [],
    siteDirty: false,
    lastDeployStatus: null,
    lastDeployAt: null,
  };
}

const rnd = (): string => crypto.randomUUID();

export class MemoryAdminStore implements AdminClient {
  readonly state: MemoryState;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly mergeUndo = new Map<string, { snap: MergeUndo; moved: string[] }>();
  private auditSeq = 0;

  constructor(opts: MemoryOptions = {}) {
    this.state = opts.state ?? createSeedState();
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? rnd;
  }

  // ------------------------------------------------------------ helpers
  private audit(actor: Actor, action: string, entity: string, entityId: string | null, reason: string | null): void {
    this.state.audit.unshift({ id: ++this.auditSeq, ts: this.now().toISOString(), actor: actor.userId, action, entity, entityId, reason });
  }

  private summary(p: IdPlayer): PlayerSummary {
    return {
      id: p.id,
      slug: p.slug,
      displayName: p.displayName,
      ageStatus: p.ageStatus,
      visibility: p.visibility,
      provisional: p.provisional,
      aliasCount: this.state.identity.aliases.filter((a) => a.playerId === p.id).length,
      mergedInto: p.mergedInto,
      consentStatus: p.consentStatus,
    };
  }

  private markDirty(): void {
    this.state.siteDirty = true;
  }

  private activeSuppressions(): Suppression[] {
    return this.state.suppressions.filter((s) => s.releasedAt === null);
  }

  // ------------------------------------------------------------ reads
  async getDashboard(): Promise<StoreResult<DashboardData>> {
    return okResult({
      needsReview: this.state.videos.filter((v) => v.parseStatus === 'needs_review').length,
      duplicatePairs: findPossibleDuplicates(this.state.identity.players, { dismissed: this.state.dismissedPairs }).length,
      openProfileRequests: this.state.profileRequests.filter((r) => r.status === 'new' || r.status === 'in_review').length,
      tournamentCandidates: this.state.tournaments.filter((t) => t.status === 'pending').length,
      activeSuppressions: this.activeSuppressions().length,
      protectedModes: { ...this.state.modes },
      siteDirty: this.state.siteDirty,
      lastDeployStatus: this.state.lastDeployStatus,
      lastDeployAt: this.state.lastDeployAt,
    });
  }

  async listReviewQueue(opts: { limit: number; offset: number }): Promise<StoreResult<ReviewVideo[]>> {
    const rows = this.state.videos.filter((v) => v.parseStatus === 'needs_review').slice(opts.offset, opts.offset + opts.limit);
    return okResult(rows.map(({ visibility: _v, parseStatus: _p, ...rest }) => ({ ...rest, locks: { ...rest.locks } })));
  }

  async searchPlayers(opts: { query: string; limit: number; offset: number }): Promise<StoreResult<{ items: PlayerSummary[]; total: number }>> {
    const q = normalizeName(opts.query);
    const all = this.state.identity.players.filter((p) => p.mergedInto === null && (q === null || (normalizeName(p.displayName) ?? '').includes(q)));
    return okResult({ items: all.slice(opts.offset, opts.offset + opts.limit).map((p) => this.summary(p)), total: all.length });
  }

  async listDuplicates(opts: { limit: number }): Promise<StoreResult<DuplicatePairDto[]>> {
    const byId = new Map(this.state.identity.players.map((p) => [p.id, p]));
    const pairs = findPossibleDuplicates(this.state.identity.players, { dismissed: this.state.dismissedPairs, maxPairs: opts.limit });
    return okResult(pairs.map((x) => ({ a: this.summary(byId.get(x.aId)!), b: this.summary(byId.get(x.bId)!), distance: x.distance, reason: x.reason, strength: x.strength, needsOverride: x.needsOverride })));
  }

  async listParticipants(opts: { playerId: string; limit: number }) {
    return okResult(this.state.participants.filter((x) => x.playerId === opts.playerId).slice(0, opts.limit).map((x) => ({ id: x.id, rawName: x.rawName, videoTitleRaw: x.videoTitleRaw })));
  }

  async listLeads(opts: { limit: number }): Promise<StoreResult<InboxLead[]>> {
    return okResult(this.state.leads.slice(0, opts.limit).map((l) => ({ ...l })));
  }

  async updateLead(actor: Actor, input: LeadUpdateInput): Promise<StoreResult<{ lead: InboxLead }>> {
    const i = this.state.leads.findIndex((l) => l.id === input.id);
    if (i < 0) return failResult('NOT_FOUND');
    const r = applyLeadUpdate(this.state.leads[i]!, input, istDateOf(this.now()));
    if (!r.ok) return failResult('INVALID', r.errors);
    this.state.leads[i] = r.next;
    // the audit row names the fields that changed, never the notes text or any contact detail
    this.audit(actor, 'lead.update', 'lead', input.id, r.changed.join(', ') + (r.from !== r.to ? ` (${r.from} -> ${r.to})` : ''));
    return okResult({ lead: { ...r.next } });
  }

  async listPayments(opts: { leadId: string }): Promise<StoreResult<PaymentRecord[]>> {
    return okResult(this.state.payments.filter((p) => p.leadId === opts.leadId).map((p) => ({ ...p.record })));
  }

  async markPaid(actor: Actor, input: MarkPaidRequest): Promise<StoreResult<MarkPaidResult>> {
    const i = this.state.leads.findIndex((l) => l.id === input.leadId);
    if (i < 0) return failResult('NOT_FOUND');
    const lead = this.state.leads[i]!;
    const before = this.state.payments.filter((p) => p.leadId === lead.id).reduce((s, p) => s + p.record.grossPaise, 0);
    const r = prepareMarkPaid(lead, input, istDateOf(this.now()), before);
    if (!r.ok) return failResult('INVALID', r.errors);
    this.audit(actor, 'payment.mark_paid', 'lead', lead.id, `${r.record.provider}, ${r.record.documentType}, gross ${r.record.grossPaise} paise${r.from !== r.to ? `, ${r.from} -> ${r.to}` : ''}`);
    this.state.payments.push({ leadId: lead.id, record: r.record });
    this.state.leads[i] = { ...lead, status: r.to, lostReason: null };
    return okResult({ record: { ...r.record }, settlement: { ...r.settlement }, warnings: r.warnings, leadStatus: r.to });
  }

  async listSubmissions(opts: { limit: number }): Promise<StoreResult<VideoSubmission[]>> {
    return okResult(this.state.submissions.slice(0, opts.limit).map((s) => ({ ...s, consents: s.consents.map((c) => ({ ...c })) })));
  }

  async reviewSubmission(actor: Actor, input: SubmissionReviewRequest): Promise<StoreResult<{ submission: VideoSubmission }>> {
    const s = this.state.submissions.find((x) => x.id === input.id);
    if (!s) return failResult('NOT_FOUND');
    const v = validateReview(s.status, input);
    if (!v.ok) return failResult('INVALID', v.errors);
    const from = s.status;
    this.audit(actor, `submission.${input.action}`, 'lead', s.id, `${from} -> ${v.to}${v.reason ? `: ${v.reason}` : ''}`);
    s.status = v.to;
    if (v.youtubeId) s.youtubeId = v.youtubeId;
    if (v.reason) s.rejectReason = v.reason;
    const li = this.state.leads.findIndex((l) => l.id === s.id);
    if (li >= 0) {
      const lead = this.state.leads[li]!;
      const move = leadMove(lead.status, v.to);
      if (move) this.state.leads[li] = { ...lead, status: move, lostReason: move === 'lost' ? v.reason : null };
    }
    return okResult({ submission: { ...s, consents: s.consents.map((c) => ({ ...c })) } });
  }

  async listPlacements(): Promise<StoreResult<PlacementsData>> {
    return okResult({ sponsors: this.state.sponsors.map((s) => ({ ...s })), placements: this.state.placements.map((p) => ({ ...p })) });
  }

  async createPlacement(actor: Actor, input: PlacementCreateInput): Promise<StoreResult<{ id: string }>> {
    const r = prepareNewPlacement(input, this.state.sponsors.find((s) => s.id === input.sponsorId), this.state.placements);
    if (!r.ok) return failResult('INVALID', r.errors);
    const id = this.newId();
    this.state.placements.push({ ...r.value, id } as Placement);
    this.audit(actor, 'placement.create', 'placement', id, `${r.value.slot} ${r.value.startDate}..${r.value.endDate} (draft)`);
    return okResult({ id });
  }

  async setPlacementStatus(actor: Actor, input: { id: string; status: 'active' | 'paused' | 'ended' }): Promise<StoreResult<{ id: string }>> {
    const p = this.state.placements.find((x) => x.id === input.id);
    if (!p) return failResult('NOT_FOUND');
    const problem = checkStatusChange(p, input.status, this.state.placements);
    if (problem) return failResult('INVALID', { status: problem });
    const from = p.status;
    p.status = input.status;
    this.audit(actor, 'placement.status', 'placement', p.id, `${from} -> ${input.status}`);
    return okResult({ id: p.id });
  }

  async listProducts(): Promise<StoreResult<ProductItem[]>> {
    return okResult(this.state.products.map((p) => ({ ...p, record: { ...p.record, inclusions: [...p.record.inclusions] } })));
  }

  async saveProduct(actor: Actor, input: ProductSaveInput): Promise<StoreResult<ProductItem>> {
    const item = this.state.products.find((p) => p.slug === input.slug);
    if (!item) return failResult('NOT_FOUND');
    const r = prepareProductSave(item.record, input);
    if (!r.ok) return failResult('INVALID', r.errors);
    item.record = r.value;
    this.audit(actor, r.price ? 'product.price_change' : 'product.edit', 'product', item.slug, r.price ? `price ${r.price.fromPaise ?? 'none'} -> ${r.price.toPaise ?? 'none'} paise; ${r.changed.join(', ')}` : r.changed.join(', '));
    this.markDirty(); // prices and visibility are public content: the next build must pick them up
    return okResult({ ...item, record: { ...item.record } });
  }

  async getLive(): Promise<StoreResult<LiveSettings>> {
    const l = this.state.live ?? NO_LIVE;
    return okResult<LiveSettings>({ pinnedVideoId: l.pinnedVideoId, pastStreams: l.pastStreams.map((s) => ({ ...s })) });
  }

  async saveLive(actor: Actor, input: LiveSaveInput) {
    const v = validateLiveEdit(input);
    if (!v.ok) return failResult('INVALID', v.errors);
    const fields = liveChanges(this.state.live ?? NO_LIVE, v.value);
    if (fields.length === 0) return okResult({ settings: v.value, fields: [] as string[] });
    this.state.live = v.value;
    // the ids are public; the titles are not repeated in the audit (like the SQL)
    this.audit(actor, 'live.save', 'live_settings', '1', `${fields.join(', ')}; pinned ${v.value.pinnedVideoId ?? 'none'}; ${v.value.pastStreams.length} past`);
    this.markDirty();
    return okResult({ settings: v.value, fields: fields as string[] });
  }

  async listPosterTargets(): Promise<StoreResult<PosterTarget[]>> {
    return okResult([{ slug: 'channel', title: 'The Power Smash channel', kind: 'channel' }, ...this.state.tournaments.filter((t) => t.visibility === 'public').map((t) => ({ slug: t.seriesKey.replace(/ /g, '-'), title: t.name, kind: 'tournament' as const }))]);
  }

  async listProfileRequests(): Promise<StoreResult<ProfileRequest[]>> {
    return okResult(this.state.profileRequests.map((r) => ({ ...r })));
  }
  private previewOf(leadId: string): StoreResult<SubmissionPreview> {
    const lead = this.state.leads.find((l) => l.id === leadId);
    if (!lead) return failResult('NOT_FOUND');
    if (lead.type !== 'tournament_submission') return failResult('INVALID');
    const tid = this.state.submissionLinks?.[leadId];
    const slugs = new Set(Object.values(this.state.tournamentSlugs ?? {}));
    return okResult(
      submissionPreview({ id: lead.id, refCode: lead.refCode, payload: this.state.leadPayloads?.[leadId] ?? {} }, {
        addedAs: tid ? { tournamentId: tid } : null,
        slugTaken: (s) => slugs.has(s),
        isDuplicate: (key, year) => this.state.tournaments.some((t) => t.seriesKey === key && t.editionYear === year),
      }),
    );
  }

  async previewSubmission(opts: { leadId: string }): Promise<StoreResult<SubmissionPreview>> {
    return this.previewOf(opts.leadId);
  }

  async addSubmission(actor: Actor, input: { leadId: string; reason: string }): Promise<StoreResult<{ tournamentId: string; slug: string }>> {
    const p = this.previewOf(input.leadId);
    if (!p.ok) return p;
    const r = p.data.record;
    if (!r || p.data.problem) return failResult('INVALID', { form: p.data.problem ?? 'This submission cannot be added.' });
    const id = this.newId();
    this.state.tournaments.push({ id, name: r.name, seriesKey: r.seriesKey, editionYear: r.editionYear, matchCount: 0, region: r.region, isPromoted: false, source: 'submitted', visibility: 'hidden', status: 'pending' });
    (this.state.tournamentDetails ??= {})[id] = { name: r.name, level: null, city: r.city, district: r.district, venue: r.venue, startDate: r.startDate, endDate: r.endDate, categories: [], isFeatured: false, featuredUntil: null, coveredByPowerSmash: false };
    (this.state.submissionLinks ??= {})[input.leadId] = id;
    (this.state.tournamentSlugs ??= {})[id] = r.slug;
    // ids and the address only, like the SQL audit; never contact data
    this.audit(actor, 'tournament.add_submission', 'tournament', id, `lead ${p.data.refCode}; ${r.slug}`);
    this.markDirty();
    return okResult({ tournamentId: id, slug: r.slug });
  }

  /** A list entry with its permission status and covered flag, so the screen can show the gap (D-019). */
  private withPermission(t: TournamentCandidate): TournamentCandidate {
    return { ...t, filmingPermission: this.state.filmingPermissions?.[t.id]?.status ?? 'unknown', coveredByPowerSmash: this.state.tournamentDetails?.[t.id]?.coveredByPowerSmash ?? false };
  }

  async listApprovedTournaments(): Promise<StoreResult<TournamentCandidate[]>> {
    return okResult(this.state.tournaments.filter((t) => t.status === 'published' || t.status === 'completed').map((t) => this.withPermission(t)));
  }

  async getFilmingPermission(opts: { tournamentId: string }): Promise<StoreResult<FilmingPermission>> {
    if (!this.state.tournaments.some((t) => t.id === opts.tournamentId)) return failResult('NOT_FOUND');
    return okResult({ ...(this.state.filmingPermissions?.[opts.tournamentId] ?? NO_PERMISSION) });
  }

  async setFilmingPermission(actor: Actor, input: PermissionInput & { tournamentId: string; reason: string }) {
    if (!this.state.tournaments.some((t) => t.id === input.tournamentId)) return failResult('NOT_FOUND');
    const v = validatePermission(input, todayIst(this.now()));
    if (!v.ok) return failResult('INVALID', v.errors as Record<string, string>);
    const before = this.state.filmingPermissions?.[input.tournamentId] ?? NO_PERMISSION;
    const fields = changedPermissionFields(before, v.value) as string[];
    if (fields.length === 0) return okResult({ tournamentId: input.tournamentId, permission: v.value, fields });
    (this.state.filmingPermissions ??= {})[input.tournamentId] = v.value;
    // the status only, like the SQL audit; never the person's name, role or the proof reference
    this.audit(actor, 'tournament.set_permission', 'tournament', input.tournamentId, `${before.status} -> ${v.value.status}; ${fields.join(', ')}`);
    return okResult({ tournamentId: input.tournamentId, permission: v.value, fields });
  }

  private tournamentDetailsOf(t: TournamentCandidate): TournamentDetails {
    const d = this.state.tournamentDetails?.[t.id];
    return d ? { ...d, categories: [...d.categories] } : { name: t.name, level: null, city: null, district: null, venue: null, startDate: null, endDate: null, categories: [], isFeatured: false, featuredUntil: null, coveredByPowerSmash: false };
  }

  async getTournamentDetails(opts: { id: string }): Promise<StoreResult<TournamentDetails>> {
    const t = this.state.tournaments.find((x) => x.id === opts.id);
    return t ? okResult(this.tournamentDetailsOf(t)) : failResult('NOT_FOUND');
  }

  async updateTournamentDetails(actor: Actor, input: TournamentUpdateInput) {
    const t = this.state.tournaments.find((x) => x.id === input.id);
    if (!t) return failResult('NOT_FOUND');
    const before = this.tournamentDetailsOf(t);
    const v = validateTournamentEdit(input, todayIst(this.now()), before);
    if (!v.ok) return failResult('INVALID', v.errors as Record<string, string>);
    // refuse instead of undoing a change made since the form was opened (the SQL checks the same, under a row lock)
    if (!sameTournamentDetails(before, input.expected)) return failResult('STALE');
    // D-014: a suppressed tournament stays as it is (the SQL refuses too)
    if (this.state.suppressions.some((s) => s.releasedAt === null && (s.affectedTournamentIds.includes(t.id) || (s.kind === 'tournament_id' && s.key === t.id)))) return failResult('SUPPRESSED');
    const fields = changedTournamentFields(before, v.value);
    if (fields.length === 0) return okResult({ id: t.id, details: v.value, fields });
    (this.state.tournamentDetails ??= {})[t.id] = v.value;
    t.name = v.value.name;
    this.audit(actor, 'tournament.update', 'tournament', t.id, fields.join(', ')); // field names only, like the SQL audit
    this.markDirty();
    return okResult({ id: t.id, details: v.value, fields });
  }

  async listTournamentCandidates(): Promise<StoreResult<TournamentCandidate[]>> {
    return okResult(this.state.tournaments.map((t) => ({ ...t })));
  }
  async getProtectedModes(): Promise<StoreResult<DashboardData['protectedModes']>> {
    return okResult({ ...this.state.modes });
  }
  async listAudit(opts: { limit: number }): Promise<StoreResult<AuditEntry[]>> {
    return okResult(this.state.audit.slice(0, opts.limit).map((a) => ({ ...a })));
  }

  // ------------------------------------------------------------ review queue
  async resolveReview(actor: Actor, input: Parameters<AdminStore['resolveReview']>[1]): Promise<StoreResult<{ videoId: string }>> {
    const v = this.state.videos.find((x) => x.youtubeId === input.videoId);
    if (!v) return failResult('NOT_FOUND');
    if (input.changes) {
      for (const [k, val] of Object.entries(input.changes)) (v.parsed as Record<string, string | null>)[k] = val ?? null;
    }
    for (const f of input.lockFields ?? []) v.locks[f] = true;
    if (input.decision === 'approve') {
      // a minor hold is never lifted by a plain approve: protected modes still decide what the public sees (D-012)
      v.parseStatus = 'parsed';
      v.visibility = v.minorHold ? 'hidden' : 'public';
    } else if (input.decision === 'ignore') {
      v.parseStatus = 'ignored';
      v.visibility = 'listed_no_player_pages';
    }
    this.audit(actor, `review.${input.decision}`, 'video', v.youtubeId, input.reason);
    this.markDirty();
    return okResult({ videoId: v.youtubeId });
  }

  async setFieldLock(actor: Actor, input: { videoId: string; field: ParsedField; locked: boolean }): Promise<StoreResult<{ videoId: string }>> {
    const v = this.state.videos.find((x) => x.youtubeId === input.videoId);
    if (!v) return failResult('NOT_FOUND');
    if (input.locked) v.locks[input.field] = true;
    else delete v.locks[input.field];
    this.audit(actor, input.locked ? 'review.lock' : 'review.unlock', 'video', v.youtubeId, input.field);
    return okResult({ videoId: v.youtubeId });
  }

  // ------------------------------------------------------------ identity
  async dismissDuplicate(actor: Actor, input: { aId: string; bId: string; reason: string }): Promise<StoreResult<{ dismissed: true }>> {
    const ids = new Set(this.state.identity.players.map((p) => p.id));
    if (!ids.has(input.aId) || !ids.has(input.bId) || input.aId === input.bId) return failResult('NOT_FOUND');
    const key = pairKey(input.aId, input.bId);
    if (!this.state.dismissedPairs.includes(key)) this.state.dismissedPairs.push(key);
    this.audit(actor, 'players.dismiss_duplicate', 'player', input.aId, input.reason);
    return okResult({ dismissed: true });
  }

  async mergePlayers(actor: Actor, input: Parameters<AdminStore['mergePlayers']>[1]) {
    const res = planMerge(this.state.identity, {
      keepId: input.keepId,
      dropId: input.dropId,
      override: input.overrideReason ? { reason: input.overrideReason } : null,
      suppressions: this.activeSuppressions(),
      newId: this.newId,
    });
    if (!res.ok) return failResult(res.code);
    this.state.identity = res.state;
    // participations follow the merge
    const moved: string[] = [];
    for (const part of this.state.participants) {
      if (part.playerId === input.dropId) {
        part.playerId = input.keepId;
        moved.push(part.id);
      }
    }
    const token = this.newId();
    this.mergeUndo.set(token, { snap: res.undo, moved });
    this.audit(actor, 'player.merge', 'player', input.keepId, input.reason);
    if (res.overrideLogged) this.audit(actor, 'player.merge.age_override', 'player', input.keepId, res.overrideLogged.reason);
    this.markDirty();
    return okResult({ result: { keepId: input.keepId, dropId: input.dropId }, undo: { kind: 'merge', token } as UndoDescriptor });
  }

  async splitPlayer(actor: Actor, input: Parameters<AdminStore['splitPlayer']>[1]) {
    const newPlayerId = this.newId();
    const res = planSplit(this.state.identity, { playerId: input.playerId, newPlayerId, newDisplayName: input.newDisplayName, moveAliasIds: input.moveAliasIds ?? [], newId: this.newId });
    if (!res.ok) return failResult(res.code);
    this.state.identity = res.state;
    const move = new Set(input.participantIds);
    for (const part of this.state.participants) if (move.has(part.id) && part.playerId === input.playerId) part.playerId = newPlayerId;
    this.audit(actor, 'player.split', 'player', input.playerId, input.reason);
    this.markDirty();
    return okResult({ newPlayerId });
  }

  async renamePlayer(actor: Actor, input: Parameters<AdminStore['renamePlayer']>[1]) {
    const res = planRename(this.state.identity, { playerId: input.playerId, newDisplayName: input.newDisplayName, keepOldAsAlias: input.keepOldAsAlias, newId: this.newId });
    if (!res.ok) return failResult(res.code);
    this.state.identity = res.state;
    const p = res.state.players.find((x) => x.id === input.playerId)!;
    this.audit(actor, 'player.rename', 'player', input.playerId, input.reason);
    this.markDirty();
    return okResult({ playerId: p.id, slug: p.slug });
  }

  async getPlayerProfile(opts: { playerId: string }) {
    const p = this.state.identity.players.find((x) => x.id === opts.playerId);
    if (!p) return failResult('NOT_FOUND');
    if (p.ageStatus !== 'adult_confirmed') return okResult<PlayerProfileFields | null>(null); // D-012: no profile, nothing passed on
    return okResult<PlayerProfileFields | null>({ ...(this.state.playerProfiles?.[p.id] ?? NO_PROFILE) });
  }

  async updatePlayerProfile(actor: Actor, input: PlayerProfileInput) {
    const p = this.state.identity.players.find((x) => x.id === input.playerId);
    if (!p) return failResult('NOT_FOUND');
    const v = validatePlayerProfile(input, p.ageStatus);
    if (!v.ok) return failResult('INVALID', v.errors as Record<string, string>);
    const fields = changedProfileFields(this.state.playerProfiles?.[p.id] ?? NO_PROFILE, v.value);
    if (fields.length === 0) return okResult({ playerId: p.id, fields: [] as string[] });
    (this.state.playerProfiles ??= {})[p.id] = v.value;
    this.audit(actor, 'player.update_profile', 'player', p.id, fields.join(', ')); // field names only, like the SQL audit (never the text)
    this.markDirty();
    return okResult({ playerId: p.id, fields: fields as string[] });
  }

  async confirmAdultBulk(actor: Actor, input: Parameters<AdminStore['confirmAdultBulk']>[1]) {
    if (input.playerIds.length > MAX_BULK_CONFIRM) return failResult('INVALID');
    const result: ConfirmAdultResult = { confirmed: [], rejected: [] };
    const undo: { id: string; status: 'unknown' | 'minor_suspected' }[] = [];
    for (const id of new Set(input.playerIds)) {
      const p = this.state.identity.players.find((x) => x.id === id);
      if (!p) {
        result.rejected.push({ id, code: 'NOT_FOUND' });
        continue;
      }
      const ok = canConfirmAdult(p);
      if (!ok.ok) {
        result.rejected.push({ id, code: ok.code });
        continue;
      }
      if (p.ageStatus === 'unknown' || p.ageStatus === 'minor_suspected') undo.push({ id, status: p.ageStatus });
      p.ageStatus = 'adult_confirmed';
      result.confirmed.push(id);
    }
    if (result.confirmed.length > 0) {
      this.audit(actor, 'players.confirm_adult', 'player', null, `${input.reason} (${result.confirmed.length} players; evidence: ${input.evidence})`);
      this.markDirty();
    }
    return okResult({ result, undo: undo.length ? ({ kind: 'restore_age', entries: undo } as UndoDescriptor) : undefined });
  }

  // ------------------------------------------------------------ requests, tournaments
  async resolveProfileRequest(actor: Actor, input: { id: string; decision: 'resolve' | 'reject'; reason: string }): Promise<StoreResult<{ id: string }>> {
    const r = this.state.profileRequests.find((x) => x.id === input.id);
    if (!r) return failResult('NOT_FOUND');
    r.status = input.decision === 'resolve' ? 'resolved' : 'rejected';
    this.audit(actor, `profile_request.${input.decision}`, 'profile_request', r.id, input.reason);
    return okResult({ id: r.id });
  }

  async decideTournament(actor: Actor, input: { id: string; decision: 'promote' | 'reject' | 'hide'; reason: string }): Promise<StoreResult<{ id: string }>> {
    const t = this.state.tournaments.find((x) => x.id === input.id);
    if (!t) return failResult('NOT_FOUND');
    if (input.decision === 'promote') {
      // D-018: a non-Tamil-Nadu event never gets a tournament page, even when promoted
      t.isPromoted = true;
      t.status = 'published';
      t.visibility = t.region === 'tamil_nadu' ? 'public' : 'listed_no_player_pages';
    } else if (input.decision === 'reject') {
      t.status = 'rejected';
      t.visibility = 'hidden';
    } else {
      t.visibility = 'hidden';
    }
    this.audit(actor, `tournament.${input.decision}`, 'tournament', t.id, input.reason);
    this.markDirty();
    return okResult({ id: t.id });
  }

  // ------------------------------------------------------------ settings
  async setProtectedMode(actor: Actor, input: Parameters<AdminStore['setProtectedMode']>[1]) {
    const prev = this.state.modes[input.key];
    this.state.modes[input.key] = input.value;
    this.audit(actor, 'settings.protected_mode', 'archive_settings', input.key, `${prev} -> ${input.value}: ${input.reason}`);
    this.markDirty();
    return okResult({ result: { key: input.key, value: input.value }, undo: prev === input.value ? undefined : ({ kind: 'set_setting', key: input.key, value: prev } as UndoDescriptor) });
  }

  // ------------------------------------------------------------ takedown
  async emergencyHide(actor: Actor, input: Parameters<AdminStore['emergencyHide']>[1]) {
    const id = this.newId();
    const hiddenAt = this.now().toISOString();
    const key = input.kind === 'name_normalized' ? (normalizeName(input.value) ?? input.value) : input.value;
    const sup: MemorySuppression = { id, kind: input.kind, key, reason: input.reason, releasedAt: null, affectedPlayerIds: [], affectedVideoIds: [], affectedTournamentIds: [], pairedIds: [] };
    let redirectsRemoved = 0;
    let extra: Suppression[] = [];
    const hidePlayer = (p: IdPlayer) => {
      if (p.visibility === 'hidden') return;
      sup.affectedPlayerIds.push(p.id);
      redirectsRemoved += this.state.identity.redirects.filter((r) => r.fromSlug === p.slug || r.toSlug === p.slug).length;
      this.state.identity.redirects = removeRedirectsFor(this.state.identity.redirects, p.slug);
      this.state.identity.players = this.state.identity.players.map((x) => (x.id === p.id ? tombstone(x) : x));
      extra = extra.concat(suppressionsForPlayer(p));
    };
    if (input.kind === 'player_id') {
      const p = this.state.identity.players.find((x) => x.id === input.value);
      if (!p) return failResult('NOT_FOUND');
      hidePlayer(p);
    } else if (input.kind === 'name_normalized') {
      for (const p of this.state.identity.players.filter((x) => normalizeName(x.displayName) === key)) hidePlayer(p);
    } else if (input.kind === 'youtube_id') {
      const v = this.state.videos.find((x) => x.youtubeId === input.value);
      if (v) {
        v.visibility = 'hidden';
        sup.affectedVideoIds.push(v.youtubeId);
      }
    } else {
      const t = this.state.tournaments.find((x) => x.id === input.value);
      if (!t) return failResult('NOT_FOUND');
      t.visibility = 'hidden';
      sup.affectedTournamentIds.push(t.id);
    }
    this.state.suppressions.push(sup);
    // the id and name keys of every hidden player join the list so merge, sync and backfill never resurrect them
    for (const e of addSuppressions([], extra)) {
      if (this.state.suppressions.some((s) => s.releasedAt === null && s.kind === e.kind && s.key === e.key)) continue;
      const pid = this.newId();
      sup.pairedIds.push(pid);
      this.state.suppressions.push({ ...e, id: pid, reason: input.reason, releasedAt: null, affectedPlayerIds: [], affectedVideoIds: [], affectedTournamentIds: [], pairedIds: [] });
    }
    this.audit(actor, 'emergency.hide', input.kind, input.value, input.reason);
    this.markDirty();
    return okResult({
      result: {
        suppressionId: id,
        hiddenAt,
        videosHidden: sup.affectedVideoIds.length,
        playersHidden: sup.affectedPlayerIds.length,
        tournamentsHidden: sup.affectedTournamentIds.length,
        redirectsRemoved,
        ownerChecklist: ['deploy_now', 'purge_cache_for_urls', 'set_youtube_video_private', 'search_console_removals_request'],
      },
      undo: { kind: 'release_suppression', suppressionId: id } as UndoDescriptor,
    });
  }

  async releaseSuppression(actor: Actor, input: { suppressionId: string; reason: string }): Promise<StoreResult<{ suppressionId: string }>> {
    const s = this.state.suppressions.find((x) => x.id === input.suppressionId);
    if (!s || s.releasedAt !== null) return failResult('NOT_FOUND');
    s.releasedAt = this.now().toISOString();
    // restoring visibility is a deliberate, audited step; players come back hidden-by-default only if they were hidden before
    for (const id of s.affectedPlayerIds) this.state.identity.players = this.state.identity.players.map((p) => (p.id === id ? { ...p, visibility: p.ageStatus === 'adult_confirmed' ? 'public' : 'hidden' } : p));
    for (const id of s.affectedVideoIds) {
      const v = this.state.videos.find((x) => x.youtubeId === id);
      if (v) v.visibility = 'hidden'; // back to hidden: the owner re-publishes through the review queue
    }
    for (const id of s.affectedTournamentIds) {
      const t = this.state.tournaments.find((x) => x.id === id);
      if (t) t.visibility = 'hidden';
    }
    for (const x of this.state.suppressions) if (s.pairedIds.includes(x.id)) x.releasedAt = s.releasedAt;
    this.audit(actor, 'emergency.release', 'suppression', s.id, input.reason);
    this.markDirty();
    return okResult({ suppressionId: s.id });
  }

  // ------------------------------------------------------------ site + undo
  async recordDispatch(actor: Actor, input: { kind: 'sync' | 'publish'; ok: boolean }): Promise<StoreResult<{ recorded: true }>> {
    this.audit(actor, `site.${input.kind}_now`, 'site_state', null, input.ok ? 'requested' : 'failed');
    if (input.ok && input.kind === 'publish') {
      this.state.lastDeployStatus = 'requested';
      this.state.lastDeployAt = this.now().toISOString();
      this.state.siteDirty = false;
    }
    return okResult({ recorded: true });
  }

  /** Preview-mode stand-ins for the Worker's dispatch actions: nothing leaves the browser. */
  async syncNow(): Promise<StoreResult<{ dispatched: boolean }>> {
    this.state.audit.unshift({ id: ++this.auditSeq, ts: this.now().toISOString(), actor: 'preview', action: 'site.sync_now', entity: 'site_state', entityId: null, reason: 'preview only, nothing was sent' });
    return okResult({ dispatched: false });
  }
  async publishNow(): Promise<StoreResult<{ dispatched: boolean }>> {
    this.state.audit.unshift({ id: ++this.auditSeq, ts: this.now().toISOString(), actor: 'preview', action: 'site.publish_now', entity: 'site_state', entityId: null, reason: 'preview only, nothing was sent' });
    return okResult({ dispatched: false });
  }

  async undo(actor: Actor, d: UndoDescriptor): Promise<StoreResult<{ undone: true }>> {
    if (d.kind === 'set_setting') {
      const r = await this.setProtectedMode(actor, { key: d.key, value: d.value, reason: 'undo' });
      return r.ok ? okResult({ undone: true }) : failResult(r.code);
    }
    if (d.kind === 'release_suppression') {
      const r = await this.releaseSuppression(actor, { suppressionId: d.suppressionId, reason: 'undo' });
      return r.ok ? okResult({ undone: true }) : failResult(r.code);
    }
    if (d.kind === 'restore_age') {
      for (const e of d.entries) {
        const p = this.state.identity.players.find((x) => x.id === e.id);
        // undo only ever restores a protected status (the schema excludes adult_confirmed): it can never lift protection
        if (p && p.mergedInto === null) p.ageStatus = e.status;
      }
      this.audit(actor, 'players.restore_age', 'player', null, `undo (${d.entries.length} players)`);
      this.markDirty();
      return okResult({ undone: true });
    }
    const entry = this.mergeUndo.get(d.token);
    if (!entry) return failResult('UNDO_UNAVAILABLE');
    const snap = entry.snap;
    this.state.identity = applyMergeUndo(this.state.identity, snap);
    const movedSet = new Set(entry.moved);
    for (const part of this.state.participants) if (movedSet.has(part.id)) part.playerId = snap.dropBefore.id;
    this.mergeUndo.delete(d.token);
    this.audit(actor, 'player.merge.undo', 'player', snap.keepBefore.id, 'undo');
    this.markDirty();
    return okResult({ undone: true });
  }
}
