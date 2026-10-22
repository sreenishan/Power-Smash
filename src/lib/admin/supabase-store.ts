// AdminStore over Supabase (Worker only). Uses the SECRET key on the `apikey` header (same rule as src/lib/supabase/rest.ts: private
// tables and the admin RPCs are service_role only, D-005), and passes the VERIFIED user id as `p_actor` (src/lib/archive/types.ts
// `AdminRpcArgs`). The browser never talks to Supabase for data. Errors never carry a response body; only a short allow-listed code
// is mapped (PostgREST error messages can echo row values).
//
// Database objects it needs, all in supabase/migrations: tables profile_requests and player_dup_dismissed, RPCs admin_set_setting,
// admin_dismiss_duplicate, admin_decide_tournament, admin_resolve_profile_request and admin_set_match_lock (0008), plus the RPCs of 0006.
import type { PlayerRow, SuppressionKind, VideoRow, AdminRpcArgs, EmergencyHideResult } from '../archive/types';
import { findPossibleDuplicates, canConfirmAdult, MAX_BULK_CONFIRM, planMerge, type IdAlias, type IdPlayer } from '../identity';
import { chooseSlug } from '../identity/operations';
import { nameKey, normalizeName } from '../parser/normalize';
import { products as contentProducts } from '../../content/products';
import { toInboxLead, INBOX_COLUMNS, type InboxLead } from '../inbox/lead';
import { isLeadStatus, type LeadStatus } from '../inbox/status';
import { PLACEMENT_COLUMNS, placementFromRow } from '../placements/store';
import { istDateOf, type Placement } from '../placements/schedule';
import type { ProductRecord } from '../pricing-admin/product-edit';
import { isAcceptableSupabaseUrl } from '../supabase/rest';
import type { PaymentRecord } from '../pricing-admin/mark-paid';
import { applyLeadUpdate, checkStatusChange, prepareMarkPaid, prepareNewPlacement, prepareProductSave } from './ops';
import { leadMove, submissionFromLead, validateReview, type VideoSubmission } from './submissions';
import {
  failResult,
  okResult,
  type Actor,
  type AdminErrorCode,
  type AdminStore,
  type AuditEntry,
  type DashboardData,
  type DuplicatePairDto,
  type LeadUpdateInput,
  type MarkPaidRequest,
  type SubmissionReviewRequest,
  type PlacementCreateInput,
  type PlacementsData,
  type PosterTarget,
  type ProductItem,
  type ProductSaveInput,
  type SponsorDto,
  type ParsedField,
  type PlayerSummary,
  type ProfileRequest,
  type ReviewVideo,
  type StoreResult,
  type TournamentCandidate,
  type UndoDescriptor,
} from './types';

export interface SupabaseStoreConfig {
  url: string;
  secretKey: string;
  fetch: typeof fetch;
  allowLocalUrl?: boolean;
  timeoutMs?: number;
  /** Injected clock (IST dates for follow-ups). Default: the system clock. */
  now?: () => Date;
}

class BackendError extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(code);
  }
}

const KNOWN: readonly AdminErrorCode[] = ['NOT_FOUND', 'SAME_PLAYER', 'ALREADY_MERGED', 'SUPPRESSED', 'MINOR_ADULT_MERGE_BLOCKED', 'OVERRIDE_REASON_REQUIRED', 'EMPTY_NAME', 'ALIAS_NOT_OWNED', 'REDIRECT_LOOP'];

const enc = encodeURIComponent;
const MATCH_COLUMN: Record<ParsedField, string | null> = { tournament: 'tournament_id', category: 'category', age_group: 'age_group', round: 'round', participants: 'participants' };
const EDITABLE_DIRECTLY: ParsedField[] = ['category', 'age_group', 'round'];

type PlayerDbRow = Pick<PlayerRow, 'id' | 'slug' | 'display_name' | 'age_status' | 'age_signal' | 'name_key' | 'latin_key' | 'is_provisional' | 'visibility' | 'merged_into'>;
const PLAYER_COLS = 'id,slug,display_name,age_status,age_signal,name_key,latin_key,is_provisional,visibility,merged_into';

function toIdPlayer(r: PlayerDbRow): IdPlayer {
  return {
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    ageStatus: r.age_status,
    ageSignals: [...(r.age_signal ?? [])],
    nameKey: r.name_key,
    latinKey: r.latin_key,
    provisional: r.is_provisional,
    consentStatus: 'unknown', // players.consent_status is added by a later migration (D-032); unknown is the restrictive reading
    visibility: r.visibility,
    mergedInto: r.merged_into,
  };
}

export function parsedFromResult(pr: Record<string, unknown> | null): ReviewVideo['parsed'] {
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const names = (side: unknown): string =>
    Array.isArray(side) ? side.map((p) => str((p as { displayName?: unknown })?.displayName)).filter((x): x is string => x !== null).join(' & ') : '';
  const a = names(pr?.['sideA']);
  const b = names(pr?.['sideB']);
  const year = typeof pr?.['year'] === 'number' ? ` ${pr['year']}` : '';
  const t = str(pr?.['tournamentName']);
  return {
    tournament: t ? `${t}${year}` : null,
    category: str(pr?.['category']),
    age_group: str(pr?.['ageGroup']),
    round: str(pr?.['round']),
    participants: a || b ? `${a} vs ${b}` : null,
  };
}

export function createSupabaseAdminStore(cfg: SupabaseStoreConfig): AdminStore {
  if (!isAcceptableSupabaseUrl(cfg.url, cfg.allowLocalUrl === true)) throw new Error('supabase_url_refused');
  const base = `${cfg.url.replace(/\/+$/, '')}/rest/v1`;

  async function call(path: string, init: { method: string; headers?: Record<string, string>; body?: unknown }): Promise<Response> {
    let res: Response;
    try {
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(cfg.timeoutMs ?? 8000) : undefined;
      res = await cfg.fetch(`${base}/${path}`, {
        method: init.method,
        headers: { apikey: cfg.secretKey, 'content-type': 'application/json', accept: 'application/json', ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal,
      });
    } catch {
      throw new BackendError('BACKEND_ERROR');
    }
    if (res.ok) return res;
    let code: AdminErrorCode = 'BACKEND_ERROR';
    try {
      const body = (await res.json()) as { message?: unknown };
      const msg = typeof body.message === 'string' ? body.message : '';
      code = KNOWN.find((k) => msg.includes(k)) ?? 'BACKEND_ERROR';
    } catch {
      // not JSON
    }
    throw new BackendError(code);
  }

  const select = async <T>(table: string, query: string): Promise<T[]> => (await (await call(`${table}?${query}`, { method: 'GET' })).json()) as T[];
  const count = async (table: string, query: string): Promise<number> => {
    const res = await call(`${table}?${query}`, { method: 'HEAD', headers: { prefer: 'count=exact' } });
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
    return m ? Number(m[1]) : 0;
  };
  const rpc = async <T = unknown>(name: string, args: Record<string, unknown>): Promise<T> => {
    const res = await call(`rpc/${name}`, { method: 'POST', body: args });
    const text = await res.text();
    return (text === '' ? null : JSON.parse(text)) as T;
  };
  const insert = (table: string, body: Record<string, unknown>) => call(table, { method: 'POST', headers: { prefer: 'return=minimal' }, body });
  const patch = (table: string, query: string, body: Record<string, unknown>) => call(`${table}?${query}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body });

  const guard = async <T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> => {
    try {
      return await fn();
    } catch (e) {
      return failResult(e instanceof BackendError ? e.code : 'BACKEND_ERROR');
    }
  };

  const auditRow = (actor: Actor, action: string, entity: string, entityId: string | null, reason: string | null, diff?: Record<string, unknown>) =>
    insert('audit_log', { actor: actor.userId, action, entity, entity_id: entityId, reason, ...(diff ? { diff } : {}) });
  const now = cfg.now ?? (() => new Date());
  const INBOX_STATUS = (v: unknown): LeadStatus | null => (isLeadStatus(v) ? v : null);
  type SponsorRow = { id: string; name: string; website: string | null; active: boolean };
  const sponsorOf = (r: SponsorRow): SponsorDto => ({ id: r.id, name: r.name, website: r.website, active: r.active });
  const loadPlacementList = async (): Promise<Placement[]> =>
    (await select<Record<string, unknown>>('placements', `select=${PLACEMENT_COLUMNS}&order=start_date.desc&limit=1000`)).map(placementFromRow).filter((p): p is Placement => p !== null);
  // The public product list has no database table yet (no default price exists anywhere): the baseline is the content file with no prices.
  const baseline = (slug: string): ProductItem | undefined => {
    const p = contentProducts.find((x) => x.slug === slug);
    return p
      ? { slug: p.slug, group: p.group, record: { name: p.name, summary: p.summary, priceType: p.priceType, pricePaise: p.pricePaise, gstInclusive: p.gstInclusive, deliveryDays: p.deliveryDays, visible: false, sort: 0, inclusions: p.inclusions.map((i) => i.text), inclusionsApproved: p.inclusionsApproved, quoteWordingApproved: p.quoteWordingApproved } satisfies ProductRecord }
      : undefined;
  };

  async function aliasCounts(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await select<{ player_id: string }>('player_aliases', `select=player_id&player_id=in.(${ids.join(',')})&limit=5000`);
    for (const r of rows) out.set(r.player_id, (out.get(r.player_id) ?? 0) + 1);
    return out;
  }
  const summarize = (r: PlayerDbRow, aliases: Map<string, number>): PlayerSummary => ({
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    ageStatus: r.age_status,
    visibility: r.visibility,
    provisional: r.is_provisional,
    aliasCount: aliases.get(r.id) ?? 0,
    mergedInto: r.merged_into,
    consentStatus: 'unknown',
  });
  const loadPlayers = async (ids: string[]): Promise<PlayerDbRow[]> => (ids.length === 0 ? [] : select<PlayerDbRow>('players', `select=${PLAYER_COLS}&id=in.(${ids.join(',')})`));

  return {
    // ------------------------------------------------------------------ reads
    getDashboard: () =>
      guard(async () => {
        const [needsReview, tournaments, suppressions] = await Promise.all([
          count('videos', 'select=youtube_id&parse_status=eq.needs_review'),
          count('tournaments', 'select=id&status=eq.pending'),
          count('suppression', 'select=id&released_at=is.null'),
        ]);
        const openProfileRequests = await count('profile_requests', 'select=id&status=in.(new,in_review)').catch(() => 0);
        const modes = await getModes();
        const state = (await select<{ dirty: boolean; last_deploy_at: string | null; last_deploy_status: string | null }>('site_state', 'select=dirty,last_deploy_at,last_deploy_status&id=eq.1'))[0];
        const dups = await duplicates(200);
        return okResult<DashboardData>({
          needsReview,
          duplicatePairs: dups.length,
          openProfileRequests,
          tournamentCandidates: tournaments,
          activeSuppressions: suppressions,
          protectedModes: modes,
          siteDirty: state?.dirty ?? false,
          lastDeployStatus: state?.last_deploy_status ?? null,
          lastDeployAt: state?.last_deploy_at ?? null,
        });
      }),

    listReviewQueue: (o) =>
      guard(async () => {
        const rows = await select<Pick<VideoRow, 'youtube_id' | 'title_raw' | 'published_at' | 'review_reasons' | 'hard_flags' | 'parse_confidence' | 'minor_hold' | 'override_stale' | 'parse_result'> & { matches: { manual_override: Record<string, true> }[] | null }>(
          'videos',
          `select=youtube_id,title_raw,published_at,review_reasons,hard_flags,parse_confidence,minor_hold,override_stale,parse_result,matches(manual_override)&parse_status=eq.needs_review&order=published_at.desc&limit=${o.limit}&offset=${o.offset}`,
        );
        return okResult<ReviewVideo[]>(
          rows.map((r) => {
            const mo = r.matches?.[0]?.manual_override ?? {};
            const locks: ReviewVideo['locks'] = {};
            for (const f of Object.keys(MATCH_COLUMN) as ParsedField[]) if (mo[MATCH_COLUMN[f] ?? f]) locks[f] = true;
            return {
              youtubeId: r.youtube_id,
              titleRaw: r.title_raw,
              publishedAt: r.published_at,
              parsed: parsedFromResult(r.parse_result),
              reviewReasons: r.review_reasons.map(String),
              hardFlags: r.hard_flags.map(String),
              confidencePoints: r.parse_confidence,
              minorHold: r.minor_hold,
              locks,
              overrideStale: r.override_stale,
            };
          }),
        );
      }),

    searchPlayers: (o) =>
      guard(async () => {
        const q = normalizeName(o.query);
        const filter = q === null ? '' : `&name_normalized=ilike.*${enc(q.replace(/[*%,()]/g, ' '))}*`;
        const res = await call(`players?select=${PLAYER_COLS}&merged_into=is.null${filter}&order=display_name.asc&limit=${o.limit}&offset=${o.offset}`, { method: 'GET', headers: { prefer: 'count=exact' } });
        const rows = (await res.json()) as PlayerDbRow[];
        const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? rows.length);
        const aliases = await aliasCounts(rows.map((r) => r.id));
        return okResult({ items: rows.map((r) => summarize(r, aliases)), total });
      }),

    listDuplicates: (o) => guard(async () => okResult(await duplicates(o.limit))),

    listParticipants: (o) =>
      guard(async () => {
        const rows = await select<{ id: string; raw_name: string; matches: { videos: { title_raw: string } | null } | null }>(
          'match_participants',
          `select=id,raw_name,matches(videos(title_raw))&player_id=eq.${o.playerId}&order=created_at.desc&limit=${o.limit}`,
        );
        return okResult(rows.map((r) => ({ id: r.id, rawName: r.raw_name, videoTitleRaw: r.matches?.videos?.title_raw ?? null })));
      }),

    listProfileRequests: () =>
      guard(async () => {
        const rows = await select<{ id: string; player_id: string | null; kind: ProfileRequest['kind']; status: ProfileRequest['status']; received_at: string; summary: string }>(
          'profile_requests',
          'select=id,player_id,kind,status,received_at,summary&status=in.(new,in_review)&order=received_at.asc&limit=100',
        );
        return okResult<ProfileRequest[]>(rows.map((r) => ({ id: r.id, playerId: r.player_id, kind: r.kind, status: r.status, receivedAt: r.received_at, summary: r.summary })));
      }),

    listTournamentCandidates: () =>
      guard(async () => {
        const rows = await select<{ id: string; name: string; series_key: string; edition_year: number | null; region: TournamentCandidate['region']; is_promoted: boolean; source: TournamentCandidate['source']; visibility: TournamentCandidate['visibility']; status: TournamentCandidate['status']; matches: { count: number }[] | null }>(
          'tournaments',
          'select=id,name,series_key,edition_year,region,is_promoted,source,visibility,status,matches(count)&status=eq.pending&order=created_at.desc&limit=100',
        );
        return okResult<TournamentCandidate[]>(rows.map((r) => ({ id: r.id, name: r.name, seriesKey: r.series_key, editionYear: r.edition_year, matchCount: r.matches?.[0]?.count ?? 0, region: r.region, isPromoted: r.is_promoted, source: r.source, visibility: r.visibility, status: r.status })));
      }),

    // ------------------------------------------------------------------ leads, placements, prices, posters (owner phone tasks)
    // leads, sponsors and placements are written with the service key (grants: select, insert, update; no delete). There is no admin RPC for
    // them yet, so the audit row is written FIRST (fail closed: no change without its audit row). Audit rows hold field names, never notes or contact data.
    listLeads: (o) =>
      guard(async () => {
        const rows = await select<Record<string, unknown>>('leads', `select=${INBOX_COLUMNS}&order=created_at.desc&limit=${o.limit}`);
        return okResult(rows.map(toInboxLead).filter((l): l is InboxLead => l !== null));
      }),

    updateLead: (actor, input: LeadUpdateInput) =>
      guard(async () => {
        const [row] = await select<Record<string, unknown>>('leads', `select=${INBOX_COLUMNS}&id=eq.${enc(input.id)}`);
        const lead = row ? toInboxLead(row) : null;
        if (!lead) return failResult('NOT_FOUND');
        const r = applyLeadUpdate(lead, input, istDateOf(now()));
        if (!r.ok) return failResult('INVALID', r.errors);
        await auditRow(actor, 'lead.update', 'lead', lead.id, r.changed.join(', '), { fields: r.changed, from: r.from, to: r.to });
        const patchBody: Record<string, unknown> = {};
        if (r.changed.includes('status')) patchBody.status = r.next.status;
        if (r.changed.includes('lost_reason')) patchBody.lost_reason = r.next.lostReason;
        if (r.changed.includes('notes')) patchBody.notes = r.next.notes;
        if (r.changed.includes('follow_up_on')) patchBody.follow_up_on = r.next.followUpOn;
        if (r.changed.includes('value_paise')) patchBody.value_paise = r.next.valuePaise;
        await patch('leads', `id=eq.${enc(lead.id)}`, patchBody);
        if (r.from !== r.to) await insert('lead_events', { lead_id: lead.id, event: 'status_changed', meta: { from: r.from, to: r.to } });
        return okResult({ lead: r.next });
      }),

    // Payments: there is no payments table in the migrations yet (D-020/D-021 orders and payments arrive later). A payment is recorded as an
    // append-only `lead_events` row (`payment_recorded`, meta = the record: amounts in integer paise, method, reference; no name, phone or
    // email). Audit row FIRST (fail closed), then the event, then the status move. PROPOSED: a payments table plus an audited RPC.
    listPayments: (o) =>
      guard(async () => {
        const rows = await select<{ meta: Record<string, unknown> }>('lead_events', `select=meta&lead_id=eq.${enc(o.leadId)}&event=eq.payment_recorded&order=created_at.asc&limit=200`);
        return okResult(rows.map((r) => r.meta as unknown as PaymentRecord).filter((m) => m && typeof m.grossPaise === 'number'));
      }),

    markPaid: (actor, input: MarkPaidRequest) =>
      guard(async () => {
        const [row] = await select<Record<string, unknown>>('leads', `select=${INBOX_COLUMNS}&id=eq.${enc(input.leadId)}`);
        const lead = row ? toInboxLead(row) : null;
        if (!lead) return failResult('NOT_FOUND');
        const prior = await select<{ meta: { grossPaise?: unknown } }>('lead_events', `select=meta&lead_id=eq.${enc(lead.id)}&event=eq.payment_recorded&limit=200`);
        const before = prior.reduce((s, p) => s + (typeof p.meta?.grossPaise === 'number' && Number.isSafeInteger(p.meta.grossPaise) ? p.meta.grossPaise : 0), 0);
        const r = prepareMarkPaid(lead, input, istDateOf(now()), before);
        if (!r.ok) return failResult('INVALID', r.errors);
        await auditRow(actor, 'payment.mark_paid', 'lead', lead.id, `${r.record.provider}, ${r.record.documentType}, gross ${r.record.grossPaise} paise`, {
          provider: r.record.provider,
          document_type: r.record.documentType,
          gross_paise: r.record.grossPaise,
          net_received_paise: r.record.netReceivedPaise,
          from: r.from,
          to: r.to,
        });
        await insert('lead_events', { lead_id: lead.id, event: 'payment_recorded', meta: r.record });
        if (r.from !== r.to) {
          await patch('leads', `id=eq.${enc(lead.id)}`, { status: r.to, lost_reason: null });
          await insert('lead_events', { lead_id: lead.id, event: 'status_changed', meta: { from: r.from, to: r.to } });
        }
        return okResult({ record: r.record, settlement: r.settlement, warnings: r.warnings, leadStatus: r.to });
      }),

    // Video submissions: the leads of type video_submission. The review state is `payload.review`; the lead status is kept in step with the
    // lead status machine. The link is stored text and is never fetched.
    listSubmissions: (o) =>
      guard(async () => {
        const rows = await select<Record<string, unknown>>('leads', `select=id,ref_code,type,name,created_at,payload&type=eq.video_submission&order=created_at.desc&limit=${o.limit}`);
        const ids = rows.map((r) => String(r.id)).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
        const events = ids.length === 0 ? [] : await select<{ lead_id: string; notice_id: string; notice_version: string; given: boolean }>('consent_events', `select=lead_id,notice_id,notice_version,given&lead_id=in.(${ids.join(',')})&limit=2000`);
        return okResult(
          rows
            .map((r) => submissionFromLead(r, events.filter((e) => e.lead_id === r.id).map((e) => ({ id: e.notice_id, version: e.notice_version, given: e.given }))))
            .filter((s): s is VideoSubmission => s !== null),
        );
      }),

    reviewSubmission: (actor, input: SubmissionReviewRequest) =>
      guard(async () => {
        const [row] = await select<Record<string, unknown>>('leads', `select=id,ref_code,type,name,created_at,status,payload&id=eq.${enc(input.id)}&type=eq.video_submission`);
        const sub = row ? submissionFromLead(row, []) : null;
        if (!row || !sub) return failResult('NOT_FOUND');
        const v = validateReview(sub.status, input);
        if (!v.ok) return failResult('INVALID', v.errors);
        const leadStatus = INBOX_STATUS(row.status);
        const move = leadStatus ? leadMove(leadStatus, v.to) : null;
        await auditRow(actor, `submission.${input.action}`, 'lead', sub.id, `${sub.status} -> ${v.to}${v.reason ? `: ${v.reason}` : ''}`, { from: sub.status, to: v.to, ...(v.youtubeId ? { youtube_id: v.youtubeId } : {}) });
        const payload = { ...((row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>), review: { status: v.to, youtubeId: v.youtubeId ?? sub.youtubeId, reason: v.reason ?? null, at: now().toISOString() } };
        await patch('leads', `id=eq.${enc(sub.id)}`, { payload, ...(move ? { status: move, lost_reason: move === 'lost' ? v.reason : null } : {}) });
        if (move) await insert('lead_events', { lead_id: sub.id, event: 'status_changed', meta: { from: leadStatus, to: move } });
        return okResult({ submission: { ...sub, status: v.to, youtubeId: v.youtubeId ?? sub.youtubeId, rejectReason: v.reason ?? sub.rejectReason } });
      }),

    listPlacements: () =>
      guard(async () => {
        const sponsors = await select<SponsorRow>('sponsors', 'select=id,name,website,active&order=name.asc&limit=500');
        return okResult<PlacementsData>({ sponsors: sponsors.map(sponsorOf), placements: await loadPlacementList() });
      }),

    createPlacement: (actor, input: PlacementCreateInput) =>
      guard(async () => {
        const [sp] = await select<SponsorRow>('sponsors', `select=id,name,website,active&id=eq.${enc(input.sponsorId)}`);
        const existing = await loadPlacementList();
        const r = prepareNewPlacement(input, sp ? sponsorOf(sp) : undefined, existing);
        if (!r.ok) return failResult('INVALID', r.errors);
        const id = crypto.randomUUID();
        await auditRow(actor, 'placement.create', 'placement', id, `${r.value.slot} ${r.value.startDate}..${r.value.endDate} (draft)`, { slot: r.value.slot, sponsor_id: r.value.sponsorId });
        await insert('placements', {
          id,
          sponsor_id: r.value.sponsorId,
          slot: r.value.slot,
          scope_key: r.value.scopeKey,
          creative_desktop_path: r.value.creativeDesktopPath,
          creative_mobile_path: r.value.creativeMobilePath,
          alt: r.value.alt,
          headline: r.value.headline,
          target_url: r.targetUrl,
          go_slug: r.value.goSlug,
          start_date: r.value.startDate,
          end_date: r.value.endDate,
          priority: r.value.priority,
          label: r.value.label,
          status: 'draft',
        });
        return okResult({ id });
      }),

    setPlacementStatus: (actor, input) =>
      guard(async () => {
        const all = await loadPlacementList();
        const p = all.find((x) => x.id === input.id);
        if (!p) return failResult('NOT_FOUND');
        const problem = checkStatusChange(p, input.status, all);
        if (problem) return failResult('INVALID', { status: problem });
        await auditRow(actor, 'placement.status', 'placement', p.id, `${p.status} -> ${input.status}`, { from: p.status, to: input.status });
        await patch('placements', `id=eq.${enc(p.id)}`, { status: input.status });
        return okResult({ id: p.id });
      }),

    // Prices: there is no products table in the migrations yet. The list is the content baseline (no prices); saving calls the PROPOSED RPC
    // admin_save_product (migration 0009, docs/m2/admin-notes.md) and fails closed (BACKEND_ERROR) until it exists.
    listProducts: () => guard(async () => okResult(contentProducts.map((p) => baseline(p.slug)!))),

    saveProduct: (actor, input: ProductSaveInput) =>
      guard(async () => {
        const item = baseline(input.slug);
        if (!item) return failResult('NOT_FOUND');
        const r = prepareProductSave(item.record, input);
        if (!r.ok) return failResult('INVALID', r.errors);
        await rpc('admin_save_product', { p_actor: actor.userId, p_slug: input.slug, p_record: r.value, p_reason: r.price ? 'price change' : 'product edit' });
        return okResult<ProductItem>({ ...item, record: r.value });
      }),

    listPosterTargets: () =>
      guard(async () => {
        const rows = await select<{ slug: string; name: string }>('tournaments', 'select=slug,name&visibility=eq.public&status=in.(published,completed)&order=start_date.desc.nullslast&limit=200');
        const out: PosterTarget[] = [{ slug: 'channel', title: 'The Power Smash channel', kind: 'channel' }, ...rows.filter((t) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.slug)).map((t) => ({ slug: t.slug, title: t.name, kind: 'tournament' as const }))];
        return okResult(out);
      }),

    getProtectedModes: () => guard(async () => okResult(await getModes())),

    listAudit: (o) =>
      guard(async () => {
        const rows = await select<{ id: number; ts: string; actor: string; action: string; entity: string; entity_id: string | null; reason: string | null }>('audit_log', `select=id,ts,actor,action,entity,entity_id,reason&order=id.desc&limit=${o.limit}`);
        return okResult<AuditEntry[]>(rows.map((r) => ({ id: r.id, ts: r.ts, actor: r.actor, action: r.action, entity: r.entity, entityId: r.entity_id, reason: r.reason })));
      }),

    // ------------------------------------------------------------------ writes
    resolveReview: (actor, input) =>
      guard(async () => {
        const [video] = await select<{ youtube_id: string; minor_hold: boolean }>('videos', `select=youtube_id,minor_hold&youtube_id=eq.${enc(input.videoId)}`);
        if (!video) return failResult('NOT_FOUND');
        const [match] = await select<{ id: string }>('matches', `select=id&video_id=eq.${enc(input.videoId)}`);
        const changes = Object.entries(input.changes ?? {});
        if (changes.some(([k]) => !EDITABLE_DIRECTLY.includes(k as ParsedField))) return failResult('INVALID'); // tournament and participants are edited in the Tournaments / Players tools
        if (changes.length > 0) {
          if (!match) return failResult('NOT_FOUND');
          await rpc('admin_update_match', { p_actor: actor.userId, p_match_id: match.id, p_changes: Object.fromEntries(changes), p_lock: false, p_reason: input.reason } satisfies AdminRpcArgs['admin_update_match']);
        }
        if (input.decision === 'approve') {
          // a minor hold is never lifted by approve: the views still apply the protected modes (D-012)
          const vis = video.minor_hold ? {} : { visibility: 'public' as const };
          await rpc('admin_update_video', { p_actor: actor.userId, p_video_id: input.videoId, p_changes: { parse_status: 'parsed', ...vis }, p_lock: false, p_reason: input.reason } satisfies AdminRpcArgs['admin_update_video']);
          if (match && !video.minor_hold) await rpc('admin_update_match', { p_actor: actor.userId, p_match_id: match.id, p_changes: { publish_state: 'published' }, p_lock: false, p_reason: input.reason } satisfies AdminRpcArgs['admin_update_match']);
        } else if (input.decision === 'ignore') {
          await rpc('admin_update_video', { p_actor: actor.userId, p_video_id: input.videoId, p_changes: { parse_status: 'ignored', visibility: 'listed_no_player_pages' }, p_lock: false, p_reason: input.reason } satisfies AdminRpcArgs['admin_update_video']);
        }
        for (const f of input.lockFields ?? []) await lock(actor, input.videoId, f, true);
        return okResult({ videoId: input.videoId });
      }),

    setFieldLock: (actor, input) =>
      guard(async () => {
        const ok = await lock(actor, input.videoId, input.field, input.locked);
        return ok ? okResult({ videoId: input.videoId }) : failResult('NOT_FOUND');
      }),

    dismissDuplicate: (actor, input) =>
      guard(async () => {
        await rpc('admin_dismiss_duplicate', { p_actor: actor.userId, p_a: input.aId, p_b: input.bId, p_reason: input.reason });
        return okResult({ dismissed: true as const });
      }),

    mergePlayers: (actor, input) =>
      guard(async () => {
        // pre-validate with the same pure rules so the owner gets a clear answer before the RPC (which enforces them again in SQL)
        const rows = await loadPlayers([input.keepId, input.dropId]);
        const aliases = await select<{ id: string; alias_normalized: string; player_id: string; status: IdAlias['status']; scope_tournament_id: string | null; scope_district: string | null }>(
          'player_aliases',
          `select=id,alias_normalized,player_id,status,scope_tournament_id,scope_district&player_id=in.(${input.keepId},${input.dropId})&limit=2000`,
        );
        const sup = await select<{ kind: SuppressionKind; value: string }>('suppression', 'select=kind,value&released_at=is.null&limit=5000');
        const plan = planMerge(
          {
            players: rows.map(toIdPlayer),
            aliases: aliases.map((a) => ({ id: a.id, aliasNormalized: a.alias_normalized, playerId: a.player_id, status: a.status, scopeTournamentId: a.scope_tournament_id, scopeDistrict: a.scope_district })),
            redirects: [],
          },
          { keepId: input.keepId, dropId: input.dropId, override: input.overrideReason ? { reason: input.overrideReason } : null, suppressions: sup.map((s) => ({ kind: s.kind, key: s.value })), newId: () => crypto.randomUUID() },
        );
        if (!plan.ok) return failResult(plan.code);
        await rpc('admin_merge_players', {
          p_actor: actor.userId,
          p_from: input.dropId,
          p_into: input.keepId,
          p_reason: input.overrideReason ? `${input.reason} | age override: ${input.overrideReason}` : input.reason,
          p_override_age: plan.overrideLogged !== null,
        } satisfies AdminRpcArgs['admin_merge_players']);
        // no undo: a merge in the database is only reversed by a split plus manual checks (documented in the admin notes)
        return okResult({ result: { keepId: input.keepId, dropId: input.dropId } });
      }),

    splitPlayer: (actor, input) =>
      guard(async () => {
        const name = input.newDisplayName.trim();
        const norm = normalizeName(name);
        if (norm === null || nameKey(name) === null) return failResult('EMPTY_NAME');
        const res = await rpc<string | { id?: string } | null>('admin_split_player', {
          p_actor: actor.userId,
          p_player: input.playerId,
          p_participant_ids: input.participantIds,
          p_new_display_name: name,
          p_new_name_normalized: norm,
          p_reason: input.reason,
          p_new_slug: null, // the database assigns an opaque slug for protected players and de-duplicates named ones
        } satisfies AdminRpcArgs['admin_split_player']);
        const id = typeof res === 'string' ? res : (res?.id ?? '');
        return okResult({ newPlayerId: id });
      }),

    renamePlayer: (actor, input) =>
      guard(async () => {
        const name = input.newDisplayName.trim();
        const norm = normalizeName(name);
        if (norm === null || nameKey(name) === null) return failResult('EMPTY_NAME');
        const [row] = await loadPlayers([input.playerId]);
        if (!row) return failResult('NOT_FOUND');
        let slug: string | null = null;
        if (row.age_status === 'adult_confirmed') {
          // adult page: a name-based slug that does not collide with an existing slug or redirect
          const probe: IdPlayer = { ...toIdPlayer(row), displayName: name };
          const baseSlug = chooseSlug(probe, new Set());
          const taken = await select<{ slug: string }>('players', `select=slug&slug=like.${enc(baseSlug)}*&id=neq.${input.playerId}&limit=200`);
          const redirects = await select<{ from_path: string }>('slug_redirects', `select=from_path&from_path=like.*${enc(baseSlug)}*&limit=200`);
          slug = chooseSlug(probe, new Set([...taken.map((t) => t.slug), ...redirects.map((r) => r.from_path.split('/').filter(Boolean).pop() ?? '')]));
        }
        await rpc('admin_rename_player', { p_actor: actor.userId, p_player: input.playerId, p_display_name: name, p_name_normalized: norm, p_reason: input.reason, p_new_slug: slug } satisfies AdminRpcArgs['admin_rename_player']);
        return okResult({ playerId: input.playerId, slug: slug ?? row.slug });
      }),

    confirmAdultBulk: (actor, input) =>
      guard(async () => {
        const ids = [...new Set(input.playerIds)];
        if (ids.length > MAX_BULK_CONFIRM) return failResult('INVALID');
        const rows = await loadPlayers(ids);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const eligible: string[] = [];
        const undo: { id: string; status: 'unknown' | 'minor_suspected' }[] = [];
        const rejected: { id: string; code: string }[] = [];
        for (const id of ids) {
          const r = byId.get(id);
          if (!r) {
            rejected.push({ id, code: 'NOT_FOUND' });
            continue;
          }
          const d = canConfirmAdult(toIdPlayer(r));
          if (!d.ok) rejected.push({ id, code: d.code });
          else {
            eligible.push(id);
            if (r.age_status === 'unknown' || r.age_status === 'minor_suspected') undo.push({ id, status: r.age_status });
          }
        }
        if (eligible.length > 0) {
          await rpc('admin_set_age_status', { p_actor: actor.userId, p_player_ids: eligible, p_status: 'adult_confirmed', p_evidence: input.evidence, p_reason: input.reason } satisfies AdminRpcArgs['admin_set_age_status']);
        }
        return okResult({ result: { confirmed: eligible, rejected }, undo: undo.length ? ({ kind: 'restore_age', entries: undo } as UndoDescriptor) : undefined });
      }),

    resolveProfileRequest: (actor, input) =>
      guard(async () => {
        await rpc('admin_resolve_profile_request', { p_actor: actor.userId, p_id: input.id, p_decision: input.decision, p_reason: input.reason });
        return okResult({ id: input.id });
      }),

    decideTournament: (actor, input) =>
      guard(async () => {
        await rpc('admin_decide_tournament', { p_actor: actor.userId, p_id: input.id, p_decision: input.decision, p_reason: input.reason });
        return okResult({ id: input.id });
      }),

    setProtectedMode: (actor, input) =>
      guard(async () => {
        const prev = (await getModes())[input.key];
        await rpc('admin_set_setting', { p_actor: actor.userId, p_key: input.key, p_value: input.value, p_reason: input.reason });
        return okResult({ result: { key: input.key, value: input.value }, undo: prev === input.value ? undefined : ({ kind: 'set_setting', key: input.key, value: prev } as UndoDescriptor) });
      }),

    emergencyHide: (actor, input) =>
      guard(async () => {
        const r = await rpc<EmergencyHideResult>('admin_emergency_hide', {
          p_actor: actor.userId,
          p_kind: input.kind,
          p_value: input.kind === 'name_normalized' ? (normalizeName(input.value) ?? input.value) : input.value,
          p_reason: input.reason,
          p_received_at: input.receivedAt ?? null,
          p_requested_by: input.requestedBy ?? null,
        } satisfies AdminRpcArgs['admin_emergency_hide']);
        return okResult({
          result: { suppressionId: r.suppression_id, hiddenAt: r.hidden_at, videosHidden: r.videos_hidden, playersHidden: r.players_hidden, tournamentsHidden: r.tournaments_hidden, redirectsRemoved: r.redirects_removed, ownerChecklist: [...r.owner_checklist] },
          undo: { kind: 'release_suppression', suppressionId: r.suppression_id } as UndoDescriptor,
        });
      }),

    releaseSuppression: (actor, input) =>
      guard(async () => {
        await rpc('admin_release_suppression', { p_actor: actor.userId, p_suppression_id: input.suppressionId, p_reason: input.reason } satisfies AdminRpcArgs['admin_release_suppression']);
        return okResult({ suppressionId: input.suppressionId });
      }),

    recordDispatch: (actor, input) =>
      guard(async () => {
        // `admin_mark_dirty` stamps the dirty flag (D-008) and audits; a failed dispatch is audited as a plain audit row
        if (input.ok) await rpc('admin_mark_dirty', { p_actor: actor.userId, p_reason: `${input.kind}_now requested`, p_urgent: input.kind === 'publish' } satisfies AdminRpcArgs['admin_mark_dirty']);
        else await auditRow(actor, `site.${input.kind}_now_failed`, 'site_state', null, 'dispatch failed');
        return okResult({ recorded: true as const });
      }),

    undo: (actor, d) =>
      guard(async () => {
        if (d.kind === 'set_setting') {
          await rpc('admin_set_setting', { p_actor: actor.userId, p_key: d.key, p_value: d.value, p_reason: 'undo' });
        } else if (d.kind === 'release_suppression') {
          await rpc('admin_release_suppression', { p_actor: actor.userId, p_suppression_id: d.suppressionId, p_reason: 'undo' } satisfies AdminRpcArgs['admin_release_suppression']);
        } else if (d.kind === 'restore_age') {
          // restoring only ever sets a protected status, grouped per status; it can never lift protection
          for (const status of ['unknown', 'minor_suspected', 'minor_confirmed'] as const) {
            const ids = d.entries.filter((e) => e.status === status).map((e) => e.id);
            if (ids.length > 0) await rpc('admin_set_age_status', { p_actor: actor.userId, p_player_ids: ids, p_status: status, p_evidence: null, p_reason: 'undo' } satisfies AdminRpcArgs['admin_set_age_status']);
          }
        } else {
          return failResult('UNDO_UNAVAILABLE');
        }
        return okResult({ undone: true as const });
      }),
  };

  // ---------------------------------------------------------------------- helpers (hoisted function declarations)
  async function getModes(): Promise<DashboardData['protectedModes']> {
    const rows = await select<{ key: string; value: string }>('archive_settings', 'select=key,value&key=in.(unknown_match_mode,minor_match_mode)');
    const get = (k: string, fallback: 'noindex_minimal' | 'hidden'): 'noindex_minimal' | 'hidden' => {
      const v = rows.find((r) => r.key === k)?.value;
      return v === 'noindex_minimal' || v === 'hidden' ? v : fallback; // unreadable value: the most protective reading
    };
    return { unknown_match_mode: get('unknown_match_mode', 'hidden'), minor_match_mode: get('minor_match_mode', 'hidden') };
  }

  async function duplicates(limit: number): Promise<DuplicatePairDto[]> {
    const rows = await select<PlayerDbRow>('players', `select=${PLAYER_COLS}&merged_into=is.null&order=latin_key.asc.nullslast&limit=2000`);
    const dismissedRows = await select<{ player_a: string; player_b: string }>('player_dup_dismissed', 'select=player_a,player_b&limit=5000').catch(() => []);
    const dismissed = dismissedRows.map((d) => (d.player_a < d.player_b ? `${d.player_a}|${d.player_b}` : `${d.player_b}|${d.player_a}`));
    const players = rows.map(toIdPlayer);
    const pairs = findPossibleDuplicates(players, { dismissed, maxPairs: limit, blockBy: 'first_letter' });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const aliases = await aliasCounts([...new Set(pairs.flatMap((p) => [p.aId, p.bId]))]);
    return pairs.map((p) => ({ a: summarize(byId.get(p.aId)!, aliases), b: summarize(byId.get(p.bId)!, aliases), distance: p.distance, reason: p.reason, strength: p.strength, needsOverride: p.needsOverride }));
  }

  async function lock(actor: Actor, videoId: string, field: ParsedField, locked: boolean): Promise<boolean> {
    const [match] = await select<{ id: string }>('matches', `select=id&video_id=eq.${enc(videoId)}`);
    if (!match) return false;
    // 0008: one audited RPC per field lock (a direct PATCH of manual_override is undone by the guard trigger of 0005)
    await rpc('admin_set_match_lock', { p_actor: actor.userId, p_match_id: match.id, p_field: MATCH_COLUMN[field] ?? field, p_locked: locked, p_reason: 'review.lock' });
    return true;
  }
}
