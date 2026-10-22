// Database access for placements, behind small interfaces so every test runs with in-memory fakes (hard rule 1). The Supabase
// adapters are real code exercised only with a mocked `fetch`.
//
//  * `loadPlacements(db)`            reads the live and upcoming rows with the secret key (Worker only).
//  * `createRpcClient(...)`          calls a `public` SQL function through PostgREST (`/rest/v1/rpc/<name>`). The existing SupabaseRest
//                                    has no rpc method; see docs/m2/business-notes.md (request: add one, then delete this adapter).
//  * `createImpressionStore(rpc)`    records a batch of impressions atomically: dedupe + counter in one SQL function.
import { isAcceptableSupabaseUrl, SupabaseError } from '../supabase/rest';
import type { SupabaseRest } from '../supabase/rest';
import { isSlotKey, PLACEMENT_LABELS } from './slots';
import type { Placement, PlacementStatus } from './schedule';
import type { PlacementLabel } from './slots';

export const PLACEMENT_COLUMNS =
  'id,sponsor_id,slot,scope_key,creative_desktop_path,creative_mobile_path,alt,headline,go_slug,start_date,end_date,priority,label,status';

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Row of `public.placements` to the typed record; null when the row is not usable (a bad row is skipped, never shown). */
export function placementFromRow(row: Row): Placement | null {
  const id = str(row.id);
  const sponsorId = str(row.sponsor_id);
  const slot = row.slot;
  const goSlug = str(row.go_slug);
  const start = str(row.start_date);
  const end = str(row.end_date);
  const alt = str(row.alt);
  const label = row.label;
  const status = row.status;
  if (!id || !sponsorId || !isSlotKey(slot) || !goSlug || !start || !end || alt === null) return null;
  if (!(PLACEMENT_LABELS as readonly unknown[]).includes(label)) return null;
  if (status !== 'draft' && status !== 'active' && status !== 'paused' && status !== 'ended') return null;
  if (typeof row.priority !== 'number' || !Number.isInteger(row.priority)) return null;
  return {
    id,
    sponsorId,
    slot,
    scopeKey: str(row.scope_key),
    creativeDesktopPath: str(row.creative_desktop_path),
    creativeMobilePath: str(row.creative_mobile_path),
    alt,
    headline: str(row.headline),
    goSlug,
    startDate: start,
    endDate: end,
    priority: row.priority,
    label: label as PlacementLabel,
    status: status as PlacementStatus,
  };
}

/** Active placements that have not ended yet (today is passed as an IST date). Paginated by a fixed cap: a niche site has a handful. */
export async function loadPlacements(db: SupabaseRest, today: string): Promise<Placement[]> {
  const rows = await db.select<Row>('placements', `status=eq.active&end_date=gte.${encodeURIComponent(today)}&select=${PLACEMENT_COLUMNS}&order=start_date.asc,id.asc&limit=1000`);
  return rows.map(placementFromRow).filter((p): p is Placement => p !== null);
}

// ---- rpc -----------------------------------------------------------------------------------------------------------------

export interface RpcClient {
  call(fn: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface RpcOptions {
  url: string;
  secretKey: string;
  fetch: typeof fetch;
  allowLocalUrl?: boolean;
  timeoutMs?: number;
}

/** Same safety rules as SupabaseRest: the secret key goes only to the project's own host, on the `apikey` header, and errors never echo a body. */
export function createRpcClient(opts: RpcOptions): RpcClient {
  if (!isAcceptableSupabaseUrl(opts.url, opts.allowLocalUrl === true)) throw new Error('The database address is not an accepted Supabase project URL.');
  const base = opts.url.trim().replace(/\/+$/, '');
  return {
    async call(fn, args) {
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(fn)) throw new Error('bad function name');
      const res = await opts.fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: opts.secretKey, 'content-type': 'application/json', 'content-profile': 'public', accept: 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      });
      if (!res.ok) throw new SupabaseError(res.status, null, null);
      const text = await res.text();
      if (text === '') return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}

// ---- impressions ---------------------------------------------------------------------------------------------------------

export interface ImpressionBatch {
  /** IST calendar date the impressions are counted for. */
  day: string;
  /** Daily-salted pseudonymous session hash (never the IP). */
  sessionHash: string;
  items: Array<{ placementId: string; pagePath: string }>;
}

export interface ImpressionStore {
  /** Record a batch; returns how many impressions were NEW (counted) after the per-placement, per-day, per-session dedupe. */
  record(batch: ImpressionBatch): Promise<number>;
}

export function createImpressionStore(rpc: RpcClient): ImpressionStore {
  return {
    async record(batch) {
      const out = await rpc.call('record_placement_impressions', {
        p_day: batch.day,
        p_session_hash: batch.sessionHash,
        p_items: batch.items.map((i) => ({ placement_id: i.placementId, page_path: i.pagePath })),
      });
      return typeof out === 'number' && Number.isInteger(out) && out >= 0 ? out : 0;
    },
  };
}
