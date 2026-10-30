// The Supabase REST provider of the competition pages, with a MOCKED fetch only (no project exists yet): publishable key, the api
// profile, explicit column lists from db.ts, stable ordering, pagination over the 1,000-row cap, errors without the response body,
// and the provider choice (seed unless PS_COMPETITION_SOURCE is exactly "supabase" with a URL and a key).
import { describe, expect, it } from 'vitest';
import { COMPETITION_VIEW_COLUMNS, COMPETITION_VIEWS } from '../../src/lib/competition/db';
import { selectCompetitionProvider } from '../../src/lib/competition/public/load';
import { COMPETITION_EVENT_READ_COLUMNS, COMPETITION_TOURNAMENT_COLUMNS } from '../../src/lib/competition/public/provider';
import { competitionSeedProvider, seedCompetitionData } from '../../src/lib/competition/public/seed';
import {
  COMPETITION_VIEW_ORDER,
  REST_PAGE_SIZE,
  createCompetitionSupabaseProvider,
  readAllRows,
} from '../../src/lib/competition/public/supabase-provider';
import { buildCompetitionSite } from '../../src/lib/competition/public/model';

const URL_OK = 'https://fakeprojectref.supabase.co';
const KEY = ['sb', 'publishable', 'FAKE'].join('_');

interface Call {
  url: URL;
  headers: Record<string, string>;
}

/** A fetch that serves the seed rows per view, honouring limit and offset. */
function mockFetch(rowsByView: Record<string, readonly unknown[]>, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const view = url.pathname.split('/').pop() ?? '';
    const rows = rowsByView[view];
    if (!rows) return new Response('secret body text', { status: 404 });
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset'));
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function seedRowsByView(extraTournaments: readonly unknown[] = []): Record<string, readonly unknown[]> {
  const raw = seedCompetitionData();
  return {
    public_competition_events: raw.events,
    public_competition_draws: raw.draws,
    public_competition_draw_slots: raw.slots,
    public_competition_matches: raw.matches,
    public_competition_match_games: raw.games,
    public_competition_rankings: raw.rankings,
    public_tournaments: [...raw.tournaments, ...extraTournaments],
  };
}

describe('createCompetitionSupabaseProvider', () => {
  it('reads the six views and the tournament facts with the publishable key and explicit columns', async () => {
    const calls: Call[] = [];
    const provider = createCompetitionSupabaseProvider({ url: URL_OK, publishableKey: KEY, fetch: mockFetch(seedRowsByView(), calls), now: () => new Date('2026-11-07T06:00:00Z') });
    expect(provider.id).toBe('supabase');
    const raw = await provider.load();
    const views = calls.map((c) => c.url.pathname.split('/').pop());
    expect(new Set(views)).toEqual(new Set([...COMPETITION_VIEWS, 'public_tournaments']));
    for (const c of calls) {
      const view = c.url.pathname.split('/').pop() as string;
      expect(c.url.origin).toBe(URL_OK);
      expect(c.url.pathname).toBe(`/rest/v1/${view}`);
      expect(c.headers.apikey).toBe(KEY);
      expect(c.headers['accept-profile']).toBe('api');
      const select = c.url.searchParams.get('select');
      expect(select).not.toContain('*');
      const expected =
        view === 'public_tournaments'
          ? COMPETITION_TOURNAMENT_COLUMNS
          : view === 'public_competition_events'
            ? COMPETITION_EVENT_READ_COLUMNS
            : COMPETITION_VIEW_COLUMNS[view as keyof typeof COMPETITION_VIEW_COLUMNS];
      expect(select).toBe(expected.join(','));
      expect(c.url.searchParams.get('order')).toBe(COMPETITION_VIEW_ORDER[view as keyof typeof COMPETITION_VIEW_ORDER]);
      expect(c.url.searchParams.get('limit')).toBe(String(REST_PAGE_SIZE));
    }
    expect(raw.generatedAt).toBe('2026-11-07T06:00:00.000Z');
    expect(raw.events).toHaveLength(seedCompetitionData().events.length);
  });

  it("the events read is exactly the db.ts column list, which carries the view's junior flag once", () => {
    expect(COMPETITION_EVENT_READ_COLUMNS).toEqual(COMPETITION_VIEW_COLUMNS.public_competition_events);
    expect(COMPETITION_EVENT_READ_COLUMNS.filter((c) => c === 'is_junior')).toHaveLength(1);
  });

  it('rankings are read in a unique, stable order (the player slug is unique within a snapshot)', () => {
    expect(COMPETITION_VIEW_ORDER.public_competition_rankings).toBe('snapshot_id.asc,rank.asc,player_slug.asc.nullslast');
    expect(COMPETITION_VIEW_ORDER.public_competition_rankings).not.toContain('player_name');
  });

  it('the tournament columns hold no organizer contact', () => {
    for (const c of COMPETITION_TOURNAMENT_COLUMNS) expect(c).not.toMatch(/organizer|contact|phone|mail|registration/);
  });

  it('keeps only the tournaments that have a public event', async () => {
    const other = { id: 'ct-x', slug: 'mock-unrelated-cup', name: 'Mock Unrelated Cup', start_date: null, end_date: null, city: null, venue: null, status: null };
    const provider = createCompetitionSupabaseProvider({ url: URL_OK, publishableKey: KEY, fetch: mockFetch(seedRowsByView([other])) });
    const raw = await provider.load();
    expect(raw.tournaments.map((t) => t.id).sort()).toEqual(['ct-1', 'ct-2', 'ct-3']);
  });

  it('the same rows give the same pages as the seed (the masking does not depend on the source)', async () => {
    const provider = createCompetitionSupabaseProvider({ url: URL_OK, publishableKey: KEY, fetch: mockFetch(seedRowsByView()), now: () => new Date('2026-10-30T06:30:00Z') });
    const viaRest = buildCompetitionSite(await provider.load(), { source: 'seed' });
    const direct = buildCompetitionSite(seedCompetitionData(), { source: 'seed' });
    expect(viaRest.tournaments).toEqual(direct.tournaments);
    expect(viaRest.rankings).toEqual(direct.rankings);
  });

  it('refuses a missing key and a URL that is not a Supabase project', () => {
    const f = mockFetch({});
    expect(() => createCompetitionSupabaseProvider({ url: URL_OK, publishableKey: '', fetch: f })).toThrow('competition_publishable_key_missing');
    for (const bad of ['http://fakeprojectref.supabase.co', 'https://example.test', 'https://fakeprojectref.supabase.co/rest', 'https://u:p@fakeprojectref.supabase.co']) {
      expect(() => createCompetitionSupabaseProvider({ url: bad, publishableKey: KEY, fetch: f })).toThrow('supabase_url_refused');
    }
  });
});

describe('readAllRows', () => {
  const opts = (fetchImpl: typeof fetch) => ({ url: URL_OK, publishableKey: KEY, fetch: fetchImpl });

  it('pages through more than 1,000 rows without overlap', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({ id: `r-${String(i).padStart(5, '0')}` }));
    const calls: Call[] = [];
    const got = await readAllRows<{ id: string }>(opts(mockFetch({ v: rows }, calls)), 'v', ['id'], 'id.asc');
    expect(got).toEqual(rows);
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '1000', '2000']);
  });

  it('stops after an exactly full last page with one more empty read', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const calls: Call[] = [];
    expect(await readAllRows(opts(mockFetch({ v: rows }, calls)), 'v', ['id'], 'id.asc')).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it('an error names the view and the status, never the response body', async () => {
    await expect(readAllRows(opts(mockFetch({})), 'public_competition_events', ['id'], 'id.asc')).rejects.toThrow(/^competition_read_failed_public_competition_events_404$/);
    await expect(readAllRows(opts(mockFetch({})), 'public_competition_events', ['id'], 'id.asc')).rejects.not.toThrow(/secret body/);
  });

  it('a body that is not a list is refused', async () => {
    const f = (async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })) as typeof fetch;
    await expect(readAllRows(opts(f), 'v', ['id'], 'id.asc')).rejects.toThrow('competition_read_bad_shape_v');
  });
});

describe('selectCompetitionProvider', () => {
  const f = mockFetch({});

  it('the seed by default and for anything but exactly "supabase" with a URL and a key', () => {
    expect(selectCompetitionProvider({}, f)).toBe(competitionSeedProvider);
    expect(selectCompetitionProvider({ PS_COMPETITION_SOURCE: 'Supabase', PUBLIC_SUPABASE_URL: URL_OK, PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY }, f)).toBe(competitionSeedProvider);
    expect(selectCompetitionProvider({ PS_COMPETITION_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: URL_OK }, f)).toBe(competitionSeedProvider);
    expect(selectCompetitionProvider({ PS_COMPETITION_SOURCE: 'supabase', PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY }, f)).toBe(competitionSeedProvider);
    // the archive's switch does not choose the competition source
    expect(selectCompetitionProvider({ PS_ARCHIVE_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: URL_OK, PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY }, f)).toBe(competitionSeedProvider);
  });

  it('the REST provider when asked exactly', () => {
    expect(selectCompetitionProvider({ PS_COMPETITION_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: URL_OK, PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY }, f).id).toBe('supabase');
  });
});
