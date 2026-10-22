import { describe, expect, it } from 'vitest';
import { buildPublicArchive } from '../../src/lib/archive/model';
import { createSupabaseProvider, MAX_REST_PAGES, readAll, REST_PAGE_SIZE, settingsFromModes } from '../../src/lib/archive/supabase-provider';
import type { PublicArchiveMode, PublicMatch, PublicMatchParticipant, PublicPlayer, PublicTournament, PublicVideo } from '../../src/lib/archive/types';

const URL_OK = 'https://fakeproject.supabase.co';
const KEY = ['sb', 'publishable', 'FAKE'].join('_');

interface Call {
  url: string;
  headers: Record<string, string>;
}

function mockFetch(tables: Record<string, unknown[]>, calls: Call[] = [], failView?: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const u = new URL(url);
    const view = u.pathname.split('/').pop() as string;
    if (view === failView) return new Response('secret body that must not leak', { status: 500 });
    const rows = tables[view] ?? [];
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset'));
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const video = (n: number, over: Partial<PublicVideo> = {}): PublicVideo => ({
  youtube_id: `fake-v${String(n).padStart(5, '0')}`,
  title_raw: `Fake title ${n}`,
  published_at: '2026-01-02T03:04:05Z',
  duration_s: 600,
  views: 10,
  likes: null,
  stats_fetched_at: null,
  thumbnail_url: null,
  embeddable: true,
  type: 'match',
  live_status: 'none',
  was_live: false,
  visibility: 'public',
  page_mode: 'full',
  noindex: false,
  ...over,
});

describe('readAll pagination', () => {
  it('reads every page of 1,000 rows with the publishable key on the apikey header', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const calls: Call[] = [];
    const got = await readAll<{ id: number }>({ url: URL_OK, publishableKey: KEY, fetch: mockFetch({ public_players: rows }, calls) }, 'public_players', 'id', 'id.asc');
    expect(got.length).toBe(2500);
    expect(calls.length).toBe(3);
    expect(REST_PAGE_SIZE).toBe(1000);
    expect(calls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(['0', '1000', '2000']);
    expect(calls.every((c) => new URL(c.url).searchParams.get('limit') === '1000')).toBe(true);
    expect(calls.every((c) => new URL(c.url).searchParams.get('order') === 'id.asc')).toBe(true);
    expect(calls[0]!.headers.apikey).toBe(KEY);
    expect(calls[0]!.headers['accept-profile']).toBe('api');
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });
  it('an exact multiple of 1,000 takes one extra (empty) read', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const calls: Call[] = [];
    const got = await readAll({ url: URL_OK, publishableKey: KEY, fetch: mockFetch({ v: rows }, calls) }, 'v', 'id', 'id.asc');
    expect(got.length).toBe(1000);
    expect(calls.length).toBe(2);
  });
  it('a failed read throws a message without the response body', async () => {
    await expect(
      readAll({ url: URL_OK, publishableKey: KEY, fetch: mockFetch({}, [], 'public_players') }, 'public_players', 'id', 'id.asc'),
    ).rejects.toThrow(/^archive_read_failed_public_players_500$/);
  });
  it('stops a runaway loop', async () => {
    const always = (async () => new Response(JSON.stringify(new Array(1000).fill({})), { status: 200 })) as unknown as typeof fetch;
    await expect(readAll({ url: URL_OK, publishableKey: KEY, fetch: always }, 'v', 'id', 'id.asc')).rejects.toThrow(/too_many_pages/);
    expect(MAX_REST_PAGES).toBe(200);
  });
});

describe('settings', () => {
  const m = (value: string): PublicArchiveMode[] => [{ key: 'unknown_match_mode', value }];
  it('reads the mode and fails closed on a value it does not know', () => {
    expect(settingsFromModes(m('noindex_minimal')).unknownMatchMode).toBe('noindex_minimal');
    expect(settingsFromModes(m('hidden')).unknownMatchMode).toBe('hidden');
    expect(settingsFromModes(m('full')).unknownMatchMode).toBe('hidden');
    expect(settingsFromModes([]).unknownMatchMode).toBe('noindex_minimal');
    expect(settingsFromModes([]).minorMatchMode).toBe('hidden');
  });
});

describe('createSupabaseProvider', () => {
  it('refuses a bad URL or a missing key', () => {
    expect(() => createSupabaseProvider({ url: 'http://x.supabase.co', publishableKey: KEY, fetch })).toThrow('supabase_url_refused');
    expect(() => createSupabaseProvider({ url: URL_OK, publishableKey: '', fetch })).toThrow('archive_publishable_key_missing');
  });

  const players: PublicPlayer[] = [
    { id: 'pl-1', slug: 'demo-ada-k', display_name: 'Demo Ada K', disambiguator: null, district: 'Madurai', photo_path: null, bio: null, instagram_handle: null, claimed: false, noindex: false },
    { id: 'pl-2', slug: 'p-abc123', display_name: 'Trial Quiet Q', disambiguator: null, district: null, photo_path: null, bio: null, instagram_handle: null, claimed: false, noindex: true },
  ];
  const tournaments: PublicTournament[] = [
    {
      id: 't-1', slug: 'fake-cup-2026', name: 'Fake Cup 2026', series_key: null, edition_year: 2026, edition_no: null, season_label: null, level: 'district', region: 'tamil_nadu',
      city: 'Madurai', district: 'Madurai', venue: null, start_date: '2026-01-01', end_date: null, categories: [], entry_info: null, registration_url: null, poster_path: null,
      status: 'completed', is_featured: false, featured_until: null, covered_by_power_smash: false, visibility: 'public', organizer_name: null, match_count: 3, page_eligible: true,
    },
  ];
  const videos = [video(1), video(2), video(3, { page_mode: 'minimal' }), video(4, { page_mode: 'none', visibility: 'listed_no_player_pages' }), video(5, { type: 'short' })];
  const matches: PublicMatch[] = [
    { id: 'm-1', slug: 'fake-slug-1', video_id: videos[0]!.youtube_id, tournament_id: 't-1', category: 'MS', age_group: 'open', round: 'F', format: 'singles', played_on: '2026-01-02', page_mode: 'full', noindex: false },
    { id: 'm-2', slug: 'fake-slug-2', video_id: videos[1]!.youtube_id, tournament_id: 't-1', category: 'XD', age_group: 'open', round: 'SF', format: 'doubles', played_on: '2026-01-02', page_mode: 'full', noindex: false },
    { id: 'm-3', slug: 'match-fake3', video_id: videos[2]!.youtube_id, tournament_id: null, category: null, age_group: null, round: null, format: 'unknown', played_on: null, page_mode: 'minimal', noindex: true },
  ];
  const participants: PublicMatchParticipant[] = [
    { match_id: 'm-1', side: 'A', position: 1, raw_name: 'Demo Ada K', player_slug: 'demo-ada-k' },
    { match_id: 'm-1', side: 'B', position: 1, raw_name: 'Demo Pageless P', player_slug: null },
    { match_id: 'm-2', side: 'A', position: 1, raw_name: 'Demo Ada K', player_slug: 'demo-ada-k' },
    { match_id: 'm-2', side: 'B', position: 1, raw_name: 'Demo Pageless P', player_slug: null },
  ];
  const modes: PublicArchiveMode[] = [{ key: 'unknown_match_mode', value: 'noindex_minimal' }, { key: 'minor_match_mode', value: 'hidden' }];
  const tables = { public_videos: videos, public_matches: matches, public_match_participants: participants, public_players: players, public_tournaments: tournaments, public_archive_modes: modes };

  it('reshapes the views and the model applies the protected rules on top', async () => {
    const calls: Call[] = [];
    const provider = createSupabaseProvider({ url: URL_OK, publishableKey: KEY, fetch: mockFetch(tables, calls), now: () => new Date('2026-10-20T00:00:00Z') });
    const raw = await provider.load();
    expect(provider.id).toBe('supabase');
    expect(raw.generatedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(calls.every((c) => c.url.startsWith(`${URL_OK}/rest/v1/public_`))).toBe(true);
    expect(calls.every((c) => c.headers.apikey === KEY)).toBe(true);
    // Shorts are not archive matches.
    expect(raw.matches.some((m) => m.videoId === videos[4]!.youtube_id)).toBe(false);

    const a = buildPublicArchive(raw, { source: 'supabase' });
    const byVideo = new Map(a.matches.map((m) => [m.videoId, m]));
    expect(byVideo.get(videos[0]!.youtube_id)?.kind).toBe('full');
    // The page-less adult is named nowhere but in the raw title: no chip, no profile.
    expect(byVideo.get(videos[0]!.youtube_id)?.sideB).toEqual([]);
    expect(a.players.map((p) => p.slug)).toEqual(['demo-ada-k']);
    // The view said minimal: the model keeps it minimal, opaque and unlisted.
    const minimal = byVideo.get(videos[2]!.youtube_id);
    expect(minimal?.kind).toBe('minimal');
    expect(minimal?.slug).toMatch(/^match-/);
    expect(a.grid.some((m) => m.videoId === videos[2]!.youtube_id)).toBe(false);
    // A listed video with no parsed match.
    expect(byVideo.get(videos[3]!.youtube_id)?.kind).toBe('listed');
    // A noindex player row is read as unknown age: a minimal page at most, never indexed or searchable.
    expect(a.minimalPlayers.map((p) => p.slug)).toEqual(['player-pl-2']);
    expect(JSON.stringify(a.players)).not.toContain('Trial Quiet Q');
  });

  it('an unknown_match_mode the code does not recognise hides minimal matches and unknown players', async () => {
    const provider = createSupabaseProvider({
      url: URL_OK,
      publishableKey: KEY,
      fetch: mockFetch({ ...tables, public_archive_modes: [{ key: 'unknown_match_mode', value: 'something_new' }] }),
    });
    const a = buildPublicArchive(await provider.load(), { source: 'supabase' });
    expect(a.matches.some((m) => m.kind === 'minimal')).toBe(false);
    expect(a.minimalPlayers).toEqual([]);
  });
});
