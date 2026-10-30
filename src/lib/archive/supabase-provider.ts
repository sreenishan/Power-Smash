// Supabase REST provider for the public archive (M2c). Reads ONLY the explicit-column `api` views with the PUBLISHABLE key (D-005);
// the build job never holds the secret key. Every list read is paginated (the REST API caps a response at 1,000 rows) and ordered by
// a stable key so pages never overlap. Written and tested with a MOCKED fetch only: no Supabase project exists yet.
//
// The views have already applied the protected rules in SQL (public_matches.page_mode, participants only for `full` matches, masked
// player columns). This provider only reshapes rows into a RawArchive; model.ts then applies protected.ts again on top (two
// independent lines of defence, D-012). Anything it does not understand fails closed:
//   - an unrecognised `unknown_match_mode` value means `hidden`;
//   - a `public_players` row marked noindex is read as an unknown-age player (minimal page at most), never as an adult;
//   - a participant whose player has no public page becomes an adult WITHOUT a profile (named nowhere but in the raw title).

import { isAcceptableSupabaseUrl } from '../supabase/rest';
import {
  DEFAULT_ARCHIVE_SETTINGS,
  type ArchiveProvider,
  type ArchiveSettings,
  type RawArchive,
  type RawMatch,
  type RawPlayer,
  type RawTournament,
  type ScopeVisibility,
} from './provider';
import type { PublicArchiveMode, PublicMatch, PublicMatchParticipant, PublicPlayer, PublicTournament, PublicVideo } from './types';

export const REST_PAGE_SIZE = 1000;
/** A guard against a runaway loop: 200 pages = 200,000 rows, far above the real catalogue. */
export const MAX_REST_PAGES = 200;

export interface SupabaseProviderOptions {
  /** Project URL, https://<ref>.supabase.co */
  url: string;
  /** The PUBLISHABLE key (never the secret key). */
  publishableKey: string;
  fetch: typeof fetch;
  /** Injected clock for `generatedAt`. */
  now?: () => Date;
  allowLocalUrl?: boolean;
}

/** One paginated read of an `api` view. Returns every row; throws a message that never contains a response body. */
export async function readAll<T>(
  opts: SupabaseProviderOptions,
  view: string,
  select: string,
  orderBy: string,
): Promise<T[]> {
  const base = `${opts.url.replace(/\/+$/, '')}/rest/v1/${view}`;
  const rows: T[] = [];
  for (let page = 0; page < MAX_REST_PAGES; page += 1) {
    const url = `${base}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(orderBy)}&limit=${REST_PAGE_SIZE}&offset=${page * REST_PAGE_SIZE}`;
    const res = await opts.fetch(url, {
      method: 'GET',
      headers: { apikey: opts.publishableKey, accept: 'application/json', 'accept-profile': 'api' },
    });
    if (!res.ok) throw new Error(`archive_read_failed_${view}_${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error(`archive_read_bad_shape_${view}`);
    rows.push(...(body as T[]));
    if (body.length < REST_PAGE_SIZE) return rows;
  }
  throw new Error(`archive_read_too_many_pages_${view}`);
}

export function settingsFromModes(modes: readonly PublicArchiveMode[]): ArchiveSettings {
  const unknown = modes.find((m) => m.key === 'unknown_match_mode')?.value;
  return {
    // Missing keeps the owner default; a value we do not recognise fails closed.
    unknownMatchMode: unknown === undefined ? DEFAULT_ARCHIVE_SETTINGS.unknownMatchMode : unknown === 'noindex_minimal' ? 'noindex_minimal' : 'hidden',
    minorMatchMode: 'hidden',
  };
}

function scope(v: string | null | undefined): ScopeVisibility {
  return v === 'public' ? 'public' : v === 'listed_no_player_pages' ? 'listed_no_player_pages' : 'hidden';
}

export function reshape(input: {
  videos: readonly PublicVideo[];
  matches: readonly PublicMatch[];
  participants: readonly PublicMatchParticipant[];
  players: readonly PublicPlayer[];
  tournaments: readonly PublicTournament[];
  modes: readonly PublicArchiveMode[];
  generatedAt: string;
}): RawArchive {
  const players = new Map<string, RawPlayer>();
  const bySlug = new Map<string, string>();
  for (const p of input.players) {
    players.set(p.id, {
      id: p.id,
      slug: p.slug,
      displayName: p.display_name,
      // The view is for public players; a noindex row is protected by default (fails closed).
      ageStatus: p.noindex ? 'unknown' : 'adult_confirmed',
      district: p.noindex ? null : p.district,
      academy: p.noindex ? null : p.academy,
      bio: p.noindex ? null : p.bio,
    });
    bySlug.set(p.slug, p.id);
  }

  const tournaments: RawTournament[] = input.tournaments.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    editionYear: t.edition_year,
    city: t.city,
    district: t.district,
    level: t.level,
    startDate: t.start_date,
    endDate: t.end_date,
    visibility: scope(t.visibility),
    pageEligible: t.page_eligible,
  }));

  const videosById = new Map(input.videos.map((v) => [v.youtube_id, v]));
  const partsByMatch = new Map<string, PublicMatchParticipant[]>();
  for (const part of input.participants) {
    const list = partsByMatch.get(part.match_id);
    if (list) list.push(part);
    else partsByMatch.set(part.match_id, [part]);
  }

  const matches: RawMatch[] = [];
  const seenVideos = new Set<string>();
  for (const m of input.matches) {
    const v = videosById.get(m.video_id);
    if (!v || v.type !== 'match' || !v.published_at) continue;
    seenVideos.add(v.youtube_id);
    const sides: Record<'A' | 'B', string[]> = { A: [], B: [] };
    if (m.page_mode === 'full') {
      const parts = [...(partsByMatch.get(m.id) ?? [])].sort((a, b) => (a.side === b.side ? a.position - b.position : a.side < b.side ? -1 : 1));
      for (const part of parts) {
        const known = part.player_slug ? bySlug.get(part.player_slug) : undefined;
        if (known) {
          sides[part.side].push(known);
        } else {
          // An adult named in a full match who has no public page: a page-less adult, shown nowhere but in the raw title.
          const id = `anon:${m.id}:${part.side}:${part.position}`;
          players.set(id, { id, displayName: part.raw_name, ageStatus: 'adult_confirmed', hasProfile: false });
          sides[part.side].push(id);
        }
      }
    }
    matches.push({
      id: m.id,
      videoId: v.youtube_id,
      rawTitle: v.title_raw,
      publishedAt: v.published_at,
      durationSeconds: v.duration_s,
      views: v.views,
      tournamentId: m.tournament_id,
      category: m.category,
      ageGroup: m.age_group,
      round: m.round,
      sideA: sides.A,
      sideB: sides.B,
      visibility: scope(v.visibility),
      pageMode: m.page_mode,
    });
  }
  // Listed videos with no parsed match (page_mode "none": for example a non-Tamil-Nadu event): raw title only.
  for (const v of input.videos) {
    if (seenVideos.has(v.youtube_id) || v.type !== 'match' || !v.published_at || v.page_mode !== 'none') continue;
    matches.push({
      id: `v:${v.youtube_id}`,
      videoId: v.youtube_id,
      rawTitle: v.title_raw,
      publishedAt: v.published_at,
      durationSeconds: v.duration_s,
      views: v.views,
      tournamentId: null,
      category: null,
      ageGroup: null,
      round: null,
      sideA: [],
      sideB: [],
      visibility: v.visibility === 'listed_no_player_pages' ? 'listed_no_player_pages' : 'public',
      pageMode: null,
    });
  }

  return {
    players: [...players.values()],
    tournaments,
    matches,
    settings: settingsFromModes(input.modes),
    generatedAt: input.generatedAt,
  };
}

export function createSupabaseProvider(opts: SupabaseProviderOptions): ArchiveProvider {
  if (!opts.publishableKey) throw new Error('archive_publishable_key_missing');
  if (!isAcceptableSupabaseUrl(opts.url, opts.allowLocalUrl === true)) throw new Error('supabase_url_refused');
  return {
    id: 'supabase',
    async load() {
      const [videos, matches, participants, players, tournaments, modes] = await Promise.all([
        readAll<PublicVideo>(
          opts,
          'public_videos',
          'youtube_id,title_raw,published_at,duration_s,views,likes,stats_fetched_at,thumbnail_url,embeddable,type,live_status,was_live,visibility,page_mode,noindex',
          'youtube_id.asc',
        ),
        readAll<PublicMatch>(opts, 'public_matches', 'id,video_id,tournament_id,category,age_group,round,format,played_on,page_mode,noindex', 'id.asc'),
        readAll<PublicMatchParticipant>(opts, 'public_match_participants', 'match_id,side,position,raw_name,player_slug', 'match_id.asc,side.asc,position.asc'),
        readAll<PublicPlayer>(opts, 'public_players', 'id,slug,display_name,disambiguator,district,photo_path,bio,instagram_handle,claimed,noindex,academy', 'id.asc'),
        readAll<PublicTournament>(
          opts,
          'public_tournaments',
          'id,slug,name,series_key,edition_year,edition_no,season_label,level,region,city,district,venue,start_date,end_date,categories,entry_info,registration_url,poster_path,status,is_featured,featured_until,covered_by_power_smash,visibility,organizer_name,match_count,page_eligible',
          'id.asc',
        ),
        readAll<PublicArchiveMode>(opts, 'public_archive_modes', 'key,value', 'key.asc'),
      ]);
      return reshape({ videos, matches, participants, players, tournaments, modes, generatedAt: (opts.now?.() ?? new Date()).toISOString() });
    },
  };
}
