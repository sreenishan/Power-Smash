// Sponsor /go links from the database (D-031): active placements + their sponsors' registered websites, turned into the
// `links` and `allowedHosts` that handleGo takes by placementsToGoData(). The static map in src/content/go-links.ts stays for
// non-placement links and always wins on a slug clash. Any failure (no database settings, network, bad rows) falls back to the
// static map only: a sponsor link then answers 404, the site never breaks. Cached per isolate for a short time.
import { createSupabaseRest } from '../supabase/rest';
import type { SupabaseRest } from '../supabase/rest';
import { placementFromRow, PLACEMENT_COLUMNS } from '../placements/store';
import { placementsToGoData } from '../placements/public';
import type { SponsorForGo } from '../placements/public';
import { todayIst } from '../dates';
import type { GoLinks } from './go';

export interface GoData {
  links: GoLinks;
  allowedHosts: string[];
}

type Row = Record<string, unknown>;

export function mergeGoData(staticLinks: GoLinks, staticHosts: readonly string[], fromDb: GoData): GoData {
  const links: Record<string, GoLinks[string]> = { ...fromDb.links };
  for (const [slug, link] of Object.entries(staticLinks)) links[slug] = link; // the static map wins
  return { links, allowedHosts: [...new Set([...staticHosts, ...fromDb.allowedHosts])] };
}

/** Read active placements (with target_url) and sponsors, then build the go data. Throws on a database error. */
export async function loadSponsorGoData(db: SupabaseRest, now: Date): Promise<GoData> {
  const today = todayIst(now);
  const rows = await db.select<Row>('placements', `status=eq.active&end_date=gte.${encodeURIComponent(today)}&select=${PLACEMENT_COLUMNS},target_url&limit=1000`);
  const placements = [];
  const targets: Record<string, string> = {};
  for (const r of rows) {
    const p = placementFromRow(r);
    if (!p) continue;
    placements.push(p);
    if (typeof r.target_url === 'string') targets[p.id] = r.target_url;
  }
  if (placements.length === 0) return { links: {}, allowedHosts: [] };
  const sponsorRows = await db.select<Row>('sponsors', 'select=id,website&limit=1000');
  const sponsors: SponsorForGo[] = sponsorRows.flatMap((s) => (typeof s.id === 'string' ? [{ id: s.id, website: typeof s.website === 'string' ? s.website : null }] : []));
  return placementsToGoData(placements, targets, sponsors);
}

export interface GoDataEnv {
  SUPABASE_URL?: string;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

const TTL_MS = 60_000;
let cache: { at: number; data: GoData } | null = null;

/** Static links plus sponsor links; cached 60 s per isolate. Never throws. */
export async function resolveGoData(
  env: GoDataEnv,
  statics: { links: GoLinks; allowedHosts: readonly string[] },
  deps: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<{ links: GoLinks; allowedHosts: readonly string[] }> {
  const now = (deps.now ?? (() => new Date()))();
  if (cache && now.getTime() - cache.at < TTL_MS) return mergeGoData(statics.links, statics.allowedHosts, cache.data);
  const url = (env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL ?? '').trim();
  const secret = (env.SUPABASE_SECRET_KEY ?? '').trim();
  if (url === '' || secret === '') return statics;
  try {
    const db = createSupabaseRest({ url, secretKey: secret, fetch: deps.fetchImpl ?? fetch });
    const data = await loadSponsorGoData(db, now);
    cache = { at: now.getTime(), data };
    return mergeGoData(statics.links, statics.allowedHosts, data);
  } catch {
    return statics;
  }
}

export function resetGoDataCacheForTests(): void {
  cache = null;
}
