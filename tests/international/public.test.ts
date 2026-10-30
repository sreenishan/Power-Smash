// The public side of /international/ (D-112): the page model (upcoming and recent, India dates, rows with a bad link or date dropped),
// the fictional seed, the Supabase provider over a MOCKED fetch (publishable key, explicit columns, pagination, no body in errors) and
// the source choice. No network.
import { describe, expect, it } from 'vitest';
import { buildInternationalPage, RECENT_DAYS } from '../../src/lib/international/public/model';
import { INTERNATIONAL_COLUMNS, type PublicInternationalEventRow } from '../../src/lib/international/public/provider';
import { internationalSeedRows } from '../../src/lib/international/public/seed';
import { createInternationalSupabaseProvider, REST_PAGE_SIZE } from '../../src/lib/international/public/supabase-provider';
import { selectInternationalProvider } from '../../src/lib/international/public/load';
import { EXTERNAL_LINK_REL, linkLabel, OFFICIAL_SITE_NOTE } from '../../src/lib/international/public/text';

const TODAY = '2026-10-31';
const row = (over: Partial<PublicInternationalEventRow>): PublicInternationalEventRow => ({
  id: 'a1000000-0000-4000-8000-000000000010', name: 'Sample Open', level_text: null, start_date: '2026-11-10', end_date: '2026-11-12', city: null,
  country: 'Demo Country', official_url: 'https://bwfbadminton.com/', ...over,
});

describe('buildInternationalPage', () => {
  it('splits the seed into upcoming (with running now) and recent; drops old events and the two bad rows', () => {
    const page = buildInternationalPage(internationalSeedRows(TODAY), { source: 'seed', today: TODAY });
    expect(page.source).toBe('seed');
    expect(page.upcoming.map((e) => e.name)).toEqual(['Mock Team Cup 2026', 'Sample World Open 2026', 'Demo Masters 2026']);
    expect(page.upcoming[0]?.ongoing).toBe(true);
    expect(page.recent.map((e) => e.name)).toEqual(['Sample Junior Open 2026']);
    expect(page.dropped).toBe(2);
    expect(JSON.stringify(page)).not.toMatch(/Old Classic|Plain Http|Port Open/);
  });

  it('formats IST dates, the place and the host', () => {
    const [e] = buildInternationalPage([row({ city: 'Sample City', official_url: 'https://www.tournamentsoftware.com/x?id=1' })], { source: 'supabase', today: TODAY }).upcoming;
    expect(e?.when).toBe('10–12 November 2026');
    expect(e?.place).toBe('Sample City, Demo Country');
    expect(e?.host).toBe('tournamentsoftware.com');
    expect(e?.url).toBe('https://www.tournamentsoftware.com/x?id=1');
  });

  it('fails closed on rows the view should never return', () => {
    const bad = [
      row({ id: 'b1', official_url: 'https://u@bwfbadminton.com/' }),
      row({ id: 'b2', official_url: 'https://bwfbadminton.com/?utm_source=x' }),
      row({ id: 'b3', official_url: 'https://xn--bwfbdminton-q9a.com/' }),
      row({ id: 'b4', official_url: 'javascript:alert(1)' }),
      row({ id: 'b5', start_date: '2026-11-12', end_date: '2026-11-10' }),
      row({ id: 'b6', start_date: '2026-02-30' }),
      row({ id: 'b7', name: '  ' }),
      row({ id: 'b8', country: '' }),
      row({ id: 'b9' }),
      row({ id: 'b9' }),
      null as unknown as PublicInternationalEventRow,
    ];
    const page = buildInternationalPage(bad, { source: 'supabase', today: TODAY });
    expect(page.upcoming.map((e) => e.id)).toEqual(['b9']);
    expect(page.dropped).toBe(10);
  });

  it('recent means ended within RECENT_DAYS; the last day counts as upcoming', () => {
    const page = buildInternationalPage(
      [row({ id: 'r1', start_date: '2026-10-30', end_date: TODAY }), row({ id: 'r2', start_date: '2026-08-01', end_date: '2026-08-02' }), row({ id: 'r3', start_date: '2026-06-01', end_date: '2026-06-02' })],
      { source: 'supabase', today: TODAY },
    );
    expect(RECENT_DAYS).toBe(90);
    expect(page.upcoming.map((e) => e.id)).toEqual(['r1']);
    expect(page.recent.map((e) => e.id)).toEqual(['r2']);
  });
});

describe('the seed', () => {
  it('uses invented names only and links to home pages of allowed sites', () => {
    for (const r of internationalSeedRows(TODAY)) {
      expect(r.name).toMatch(/^(Sample|Demo|Mock) /);
      expect(r.official_url).toMatch(/^(https|ftp):\/\/(www\.)?(bwfbadminton\.com|tournamentsoftware\.com|bwf\.tournamentsoftware\.com)(:8443)?\/$/);
    }
  });
});

describe('the fixed wording', () => {
  it('says where details and results are, and labels the link as external', () => {
    expect(OFFICIAL_SITE_NOTE).toMatch(/^Details and results on the official site\./);
    expect(EXTERNAL_LINK_REL).toBe('noopener noreferrer nofollow');
    expect(linkLabel('bwfbadminton.com')).toBe('Official page on bwfbadminton.com');
  });
});

describe('the Supabase provider (mocked fetch)', () => {
  const opts = (fetchImpl: typeof fetch) => ({ url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: ['sb', 'publishable', 'FAKE'].join('_'), fetch: fetchImpl });

  it('reads the api view with explicit columns, the publishable key and pagination', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const full = Array.from({ length: REST_PAGE_SIZE }, (_, i) => row({ id: `p${i}` }));
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(calls.length === 1 ? full : [row({ id: 'last' })]), { status: 200 });
    }) as unknown as typeof fetch;
    const rows = await createInternationalSupabaseProvider(opts(fetchImpl)).load();
    expect(rows).toHaveLength(REST_PAGE_SIZE + 1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(
      `https://abcdefghijklmnopqrst.supabase.co/rest/v1/public_international_events?select=${encodeURIComponent(INTERNATIONAL_COLUMNS.join(','))}&order=${encodeURIComponent('start_date.asc,id.asc')}&limit=1000&offset=0`,
    );
    expect(calls[1]?.url).toContain('offset=1000');
    expect(calls[0]?.headers['accept-profile']).toBe('api');
    expect(calls[0]?.headers.apikey).toBe(['sb', 'publishable', 'FAKE'].join('_'));
    expect(calls[0]?.url).not.toContain('*');
  });

  it('a failed read stops the build without echoing the body', async () => {
    const fetchImpl = (async () => new Response('secret-looking body 910000000000', { status: 500 })) as unknown as typeof fetch;
    await expect(createInternationalSupabaseProvider(opts(fetchImpl)).load()).rejects.toThrow(/^international_read_failed_500$/);
    const shape = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(createInternationalSupabaseProvider(opts(shape)).load()).rejects.toThrow('international_read_bad_shape');
  });

  it('refuses a missing key or a non-Supabase URL', () => {
    const f = (async () => new Response('[]')) as unknown as typeof fetch;
    expect(() => createInternationalSupabaseProvider({ ...opts(f), publishableKey: '' })).toThrow('international_publishable_key_missing');
    expect(() => createInternationalSupabaseProvider({ ...opts(f), url: 'https://evil.test' })).toThrow('supabase_url_refused');
  });
});

describe('selectInternationalProvider', () => {
  const f = (async () => new Response('[]')) as unknown as typeof fetch;
  it('the seed unless the source is exactly "supabase" with a URL and a publishable key', () => {
    expect(selectInternationalProvider({}, f).id).toBe('seed');
    expect(selectInternationalProvider({ PS_INTERNATIONAL_SOURCE: 'Supabase', PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }, f).id).toBe('seed');
    expect(selectInternationalProvider({ PS_INTERNATIONAL_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: '', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }, f).id).toBe('seed');
    expect(selectInternationalProvider({ PS_INTERNATIONAL_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }, f).id).toBe('supabase');
  });
});
