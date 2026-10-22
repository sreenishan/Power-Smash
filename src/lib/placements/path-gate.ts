// Allow-list of real public pages for the impression beacon (S2-3, D-031, D-012). A beacon only counts on a page that exists and is
// neither protected nor minimal. Built from the PUBLIC archive views (the views already apply the protected rules in SQL):
//   players      `public_players` rows that are not noindex (a noindex row is an unknown-age minimal page: no slot, no count);
//   tournaments  `public_tournaments` rows with `page_eligible`;
//   matches      NOT counted: match slugs are assigned at build time and are not in the views, so the server cannot vouch for one
//                (fail closed). The match banner is off by default anyway (D-035); the footer strip on a match page is not counted.
//   home and the index pages are always real; `/gear/` is not a Phase 1 page.
// The list is cached for five minutes inside the isolate; a failed load keeps the last good list, and with none every dynamic path is refused.
import type { SupabaseRest } from '../supabase/rest';
import { pathKind } from './guard';

export const PATH_GATE_TTL_MS = 300_000;
const PAGE = 1000;
const MAX_PAGES = 20;

interface Allowed {
  players: Set<string>;
  tournaments: Set<string>;
}

async function readSlugs(db: SupabaseRest, table: string, filter: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await db.select<{ slug: string }>(table, `${filter}&select=slug&order=slug.asc&limit=${PAGE}&offset=${page * PAGE}`);
    for (const r of rows) if (typeof r.slug === 'string') out.add(r.slug);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function createPathGate(db: SupabaseRest, now: () => number = Date.now): (path: string) => Promise<boolean> {
  let cache: { at: number; value: Allowed } | null = null;
  async function allowed(): Promise<Allowed | null> {
    if (cache && now() - cache.at < PATH_GATE_TTL_MS) return cache.value;
    try {
      const [players, tournaments] = await Promise.all([readSlugs(db, 'public_players', 'noindex=eq.false'), readSlugs(db, 'public_tournaments', 'page_eligible=eq.true')]);
      cache = { at: now(), value: { players, tournaments } };
    } catch {
      // keep serving the last good list; with none, the dynamic pages are refused
    }
    return cache?.value ?? null;
  }
  return async (path: string): Promise<boolean> => {
    const kind = pathKind(path);
    if (kind === 'home' || kind === 'players_index' || kind === 'matches_index' || kind === 'tournaments_index') return true;
    if (kind !== 'player' && kind !== 'tournament') return false;
    const list = await allowed();
    if (!list) return false;
    const slug = path.split('/')[2] as string;
    return kind === 'player' ? list.players.has(slug) : list.tournaments.has(slug);
  };
}
