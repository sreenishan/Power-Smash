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
