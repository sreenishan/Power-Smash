import { describe, expect, it } from 'vitest';
import { buildFreshRecord } from '../../src/lib/sync/record';
import { eventScope, playlistOf } from '../../src/lib/youtube/classify';
import type { ParseResult } from '../../src/lib/parser/types';
import type { ApiVideo } from '../../src/lib/youtube/types';

const NOW = new Date('2026-10-22T06:00:00Z');
const MATCH = 'ARJUN VEL/BALA MURUGAN vs DEVAN RAJ/KIRAN MOHAN || Fake Cup Open Badminton Tournament 2026 - Madurai';

function api(over: { id?: string; title?: string; duration?: string; live?: 'none' | 'upcoming' | 'live'; liveDetails?: boolean; privacy?: 'public' | 'unlisted' | 'private' }): ApiVideo {
  return {
    id: over.id ?? 'fake-c1',
    snippet: { publishedAt: '2026-10-01T10:00:00Z', channelId: 'fake-channel', title: over.title ?? MATCH, liveBroadcastContent: over.live ?? 'none' },
    contentDetails: { duration: over.duration ?? 'PT1H' },
    statistics: { viewCount: '10' },
    ...(over.liveDetails ? { liveStreamingDetails: { actualStartTime: '2026-10-01T10:00:00Z' } } : {}),
    status: { privacyStatus: over.privacy ?? 'public', embeddable: true },
  };
}

describe('live classification (D-033, VF-C11)', () => {
  it('a stream in progress is live, an upcoming one too', () => {
    expect(buildFreshRecord(api({ live: 'live' }), NOW).type).toBe('live');
    const up = buildFreshRecord(api({ live: 'upcoming', duration: 'P0D' }), NOW);
    expect(up.type).toBe('live');
    expect(up.live_status).toBe('upcoming');
  });

  it('liveStreamingDetails alone does NOT make a finished stream live: it is a match with wasLive', () => {
    const r = buildFreshRecord(api({ live: 'none', liveDetails: true, duration: 'PT3H' }), NOW);
    expect(r.type).toBe('match');
    expect(r.live_status).toBe('completed');
    expect(r.was_live).toBe(true);
  });

  it('a video without liveStreamingDetails was never live', () => {
    const r = buildFreshRecord(api({}), NOW);
    expect(r.was_live).toBe(false);
    expect(r.live_status).toBe('none');
  });
});

describe('Shorts (VF-C10: the 180 s rule is unreliable for landscape video)', () => {
  const clip = { title: 'Fake smash drill compilation', duration: 'PT2M30S' };

  it('a landscape short-length clip with no signal is typed short but flagged for review', () => {
    const r = buildFreshRecord(api(clip), NOW);
    expect(r.type).toBe('short');
    expect(r.parse_status).toBe('needs_review');
    expect(r.review_reasons).toContain('SHORT_UNCERTAIN');
  });

  it('UULF membership says long-form: not a Short, no review', () => {
    const r = buildFreshRecord(api({ ...clip, id: 'fake-c2' }), NOW, { longFormIds: new Set(['fake-c2']) });
    expect(r.type).not.toBe('short');
    expect(r.review_reasons).not.toContain('SHORT_UNCERTAIN');
  });

  it('UUSH membership says Short, with no review needed', () => {
    const r = buildFreshRecord(api({ ...clip, id: 'fake-c3' }), NOW, { shortsIds: new Set(['fake-c3']) });
    expect(r.type).toBe('short');
    expect(r.parse_status).toBe('parsed');
  });

  it('the RSS /shorts/ link is a second signal', () => {
    const r = buildFreshRecord(api({ ...clip, id: 'fake-c4', duration: 'PT10M' }), NOW, { rssShortsIds: new Set(['fake-c4']) });
    expect(r.type).toBe('short');
  });

  it('a #shorts hashtag within 180 s is a Short without review', () => {
    const r = buildFreshRecord(api({ title: 'Fake drill #shorts', duration: 'PT40S' }), NOW);
    expect(r.type).toBe('short');
    expect(r.parse_status).toBe('parsed');
  });

  it('a short-length match clip with "vs" is not forced into short', () => {
    const r = buildFreshRecord(api({ duration: 'PT2M' }), NOW);
    expect(r.type).toBe('match');
  });

  it('playlistOf prefers UUSH, then UULV, then UULF', () => {
    const s = { shortsIds: new Set(['a']), liveIds: new Set(['a', 'b']), longFormIds: new Set(['a', 'b', 'c']) };
    expect([playlistOf('a', s), playlistOf('b', s), playlistOf('c', s), playlistOf('d', s), playlistOf('a', undefined)]).toEqual(['UUSH', 'UULV', 'UULF', null, null]);
  });
});

describe('scope and visibility (D-018, spec 10.6)', () => {
  it('a Tamil Nadu event is public', () => {
    const r = buildFreshRecord(api({}), NOW);
    expect(r.visibility).toBe('public');
    expect(eventScope(r.parse_result as unknown as ParseResult)).toBe('tamil_nadu');
  });

  it('a non-Tamil-Nadu event is listed without player pages', () => {
    const r = buildFreshRecord(api({ title: MATCH.replace('Madurai', 'Bangalore') }), NOW);
    expect(eventScope(r.parse_result as unknown as ParseResult)).toBe('non_tamil_nadu');
    expect(r.visibility).toBe('listed_no_player_pages');
  });

  it('an event with no detectable place is LISTED without player pages (owner decision)', () => {
    const r = buildFreshRecord(api({ title: MATCH.replace(' - Madurai', '') }), NOW);
    expect(eventScope(r.parse_result as unknown as ParseResult)).toBe('unknown');
    expect(r.visibility).toBe('listed_no_player_pages');
  });

  it('an unlisted video is hidden', () => {
    const r = buildFreshRecord(api({ privacy: 'unlisted' }), NOW);
    expect(r.visibility).toBe('hidden');
    expect(r.hidden_reason).toBe('not_public');
    expect(r.description).toBeNull(); // YouTube descriptions can hold phone numbers: never stored (D-029)
  });

  it('an international broadcast title is hidden by default', () => {
    const r = buildFreshRecord(api({ title: 'ANTHONY SINISUKA GINTING (INA) vs KENTO MOMOTA (JPN) || BWF World Tour Finals 2026' }), NOW);
    expect((r.parse_result as unknown as ParseResult).isInternational).toBe(true);
    expect(r.visibility).toBe('hidden');
    expect(r.hidden_reason).toBe('international');
  });
});

describe('review flags', () => {
  it('an uneven match title needs review', () => {
    const r = buildFreshRecord(api({ title: 'ARJUN VEL/BALA MURUGAN vs DEVAN RAJ || Fake Cup Open Badminton Tournament 2026 - Madurai' }), NOW);
    expect(r.parse_status).toBe('needs_review');
    expect(r.review_reasons.length).toBeGreaterThan(0);
  });

  it('keeps the raw title byte-exact (trailing space, double space)', () => {
    const raw = `${MATCH.replace(' vs ', '  vs ')} `;
    const r = buildFreshRecord(api({ title: raw }), NOW);
    expect(r.title_raw).toBe(raw);
    expect(r.title_normalized).not.toBe(raw);
  });
});
