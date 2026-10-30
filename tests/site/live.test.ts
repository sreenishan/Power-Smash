import { describe, expect, it } from 'vitest';
import { embedUrl, isVideoId, live, liveProblems, watchUrl } from '../../src/content/live';
import { isAllowedEmbedSrc } from '../../src/lib/live-facade';

describe('live settings', () => {
  it('are empty by default (the player section stays hidden)', () => {
    expect(live.pinnedVideoId).toBeNull();
    expect(live.pastStreams).toEqual([]);
    expect(liveProblems()).toEqual([]);
  });
  it('video ids are exactly 11 safe characters', () => {
    expect(isVideoId('abcDEF_-123')).toBe(true);
    for (const bad of ['', 'short', 'abcDEF_-1234', 'abc DEF_-12', 'abc"DEF_-12', '../abcdefgh']) expect(isVideoId(bad), bad).toBe(false);
  });
  it('embed uses the privacy-enhanced domain; watch uses youtube.com; bad ids give null', () => {
    expect(embedUrl('abcDEF_-123')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/abcDEF_-123\?/);
    expect(watchUrl('abcDEF_-123')).toBe('https://www.youtube.com/watch?v=abcDEF_-123');
    expect(embedUrl('x')).toBeNull();
    expect(watchUrl('x')).toBeNull();
  });
  it('reports bad owner input', () => {
    expect(liveProblems({ pinnedVideoId: 'bad', pastStreams: [] })).toHaveLength(1);
    expect(liveProblems({ pinnedVideoId: null, pastStreams: [{ videoId: 'abcDEF_-123', title: ' ', date: 'x' }, { videoId: 'abcDEF_-123', title: 'T', date: null }] }).length).toBe(3);
  });
  it('the facade only loads the privacy-enhanced embed address', () => {
    expect(isAllowedEmbedSrc(embedUrl('abcDEF_-123'))).toBe(true);
    for (const bad of [null, '', 'https://www.youtube.com/embed/abcDEF_-123', 'https://evil.test/https://www.youtube-nocookie.com/embed/x', 'javascript:alert(1)', 'https://www.youtube-nocookie.com/embed/a" onload="x']) {
      expect(isAllowedEmbedSrc(bad), String(bad)).toBe(false);
    }
  });
});

import { readFileSync } from 'node:fs';
describe('the /live page respects the legal switch', () => {
  it('renders the player only when features.youtubeEmbeds is true, and the switch is still off', async () => {
    const page = readFileSync('src/pages/live.astro', 'utf8');
    expect(page).toMatch(/features\.youtubeEmbeds === true/);
    expect(page).toMatch(/pinned && embedsOn \? embedUrl/);
    const { features } = await import('../../src/content/legal/status');
    expect(features.youtubeEmbeds).toBe(false);
  });
});

describe('the /live source (D-101)', () => {
  const ENV = { PS_LIVE_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: 'https://fakeref.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk_FAKE' };
  type Seen = { url: string; headers: Record<string, string> };
  const fakeFetch = (pinned: unknown, past: unknown, status = 200, seen: Seen[] = []) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      const body = url.includes('/public_live_settings?') ? pinned : past;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;

  it('uses the file unless the switch is exactly "supabase" and the address and publishable key are set', async () => {
    const { loadLiveSettings, liveSourceOf } = await import('../../src/lib/live/source');
    const never = (async () => { throw new Error('no network'); }) as unknown as typeof fetch;
    for (const env of [{}, { ...ENV, PS_LIVE_SOURCE: 'Supabase' }, { ...ENV, PS_LIVE_SOURCE: 'true' }, { ...ENV, PUBLIC_SUPABASE_PUBLISHABLE_KEY: ' ' }, { ...ENV, PUBLIC_SUPABASE_URL: '' }]) {
      expect(liveSourceOf(env).id).toBe('file');
      expect(await loadLiveSettings(env, never)).toEqual({ source: 'file', settings: live });
    }
  });

  it('reads the two api views with the publishable key and the api profile, in the owner order', async () => {
    const { loadLiveSettings } = await import('../../src/lib/live/source');
    const seen: Seen[] = [];
    const r = await loadLiveSettings(ENV, fakeFetch([{ pinned_video_id: 'FAKEvid0002' }], [{ video_id: 'FAKEvid0001', title: 'Fake Open 2026 Final', streamed_on: '2026-10-01', position: 0 }], 200, seen));
    expect(r).toEqual({ source: 'supabase', settings: { pinnedVideoId: 'FAKEvid0002', pastStreams: [{ videoId: 'FAKEvid0001', title: 'Fake Open 2026 Final', date: '2026-10-01' }] } });
    expect(seen.map((s) => s.url).sort()).toEqual([
      'https://fakeref.supabase.co/rest/v1/public_live_past_streams?select=video_id,title,streamed_on,position&order=position.asc&limit=100',
      'https://fakeref.supabase.co/rest/v1/public_live_settings?select=pinned_video_id&limit=1',
    ]);
    for (const s of seen) expect(s.headers).toEqual({ apikey: 'pk_FAKE', accept: 'application/json', 'accept-profile': 'api' });
  });

  it('fails the build on a failed read, a non-list answer, bad stored values or a non-Supabase address (never shows a stale pin)', async () => {
    const { loadLiveSettings } = await import('../../src/lib/live/source');
    await expect(loadLiveSettings(ENV, fakeFetch([], [], 500))).rejects.toThrow('HTTP 500');
    await expect(loadLiveSettings(ENV, fakeFetch({ pinned_video_id: null }, []))).rejects.toThrow('did not return a list');
    await expect(loadLiveSettings(ENV, fakeFetch([{ pinned_video_id: 'javascript:x' }], []))).rejects.toThrow('problems');
    await expect(loadLiveSettings(ENV, fakeFetch([{ pinned_video_id: null }], [{ video_id: 'FAKEvid0001', title: '', streamed_on: null, position: 0 }]))).rejects.toThrow('problems');
    await expect(loadLiveSettings({ ...ENV, PUBLIC_SUPABASE_URL: 'https://evil.test' }, fakeFetch([], []))).rejects.toThrow('not a Supabase project address');
  });

  it('an empty database means nothing pinned and no list', async () => {
    const { loadLiveSettings } = await import('../../src/lib/live/source');
    expect(await loadLiveSettings(ENV, fakeFetch([{ pinned_video_id: null }], []))).toEqual({ source: 'supabase', settings: { pinnedVideoId: null, pastStreams: [] } });
  });

  it('the page reads through the source selector, not the file directly', () => {
    const page = readFileSync('src/pages/live.astro', 'utf8');
    expect(page).toContain("await loadLiveSettings()");
    expect(page).not.toMatch(/import \{[^}]*\blive\b[^}]*\} from '\.\.\/content\/live'/);
  });
});
