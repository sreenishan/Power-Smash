import { describe, expect, it } from 'vitest';
import { handleGo } from '../../src/lib/infra/go-handler';
import type { GoDeps, OutboundClick } from '../../src/lib/infra/go-handler';
import { buildPublicSchedule, creativeUrl, liveSlots, placementsFromPublic, placementsToGoData } from '../../src/lib/placements/public';
import { resolveSlot } from '../../src/lib/placements/schedule';
import { SPONSOR_A, SPONSOR_B, placement } from './helpers';

const BASE = 'https://fakeproject.supabase.co/storage/v1/object/public/creatives';
const TODAY = '2026-11-10';

describe('buildPublicSchedule', () => {
  it('holds only the explicit public fields and never the sponsor, target URL or status', () => {
    const p = placement({ headline: 'Hello' });
    const out = buildPublicSchedule([p], TODAY, { creativeBase: BASE });
    expect(out.v).toBe(1);
    expect(out.today).toBe(TODAY);
    expect(out.placements).toHaveLength(1);
    const row = out.placements[0] as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['alt', 'desktop', 'end', 'headline', 'href', 'id', 'label', 'mobile', 'priority', 'scope', 'slot', 'start']);
    expect(row.href).toBe(`/go/${p.goSlug}`);
    expect(JSON.stringify(out)).not.toMatch(/sponsorId|targetUrl|target_url|status|contact/);
  });

  it('builds image URLs under the creative base without doubling slashes', () => {
    expect(creativeUrl(`${BASE}/`, '/a/b.png')).toBe(`${BASE}/a/b.png`);
    const out = buildPublicSchedule([placement({ creativeDesktopPath: 'a/d.png', creativeMobilePath: null })], TODAY, { creativeBase: BASE });
    expect(out.placements[0]?.desktop).toBe(`${BASE}/a/d.png`);
    expect(out.placements[0]?.mobile).toBeNull();
  });

  it('includes the live and the next-day placements, not the finished, later, paused or imageless ones', () => {
    const live = placement();
    const tomorrow = placement({ startDate: '2026-11-11' });
    const later = placement({ startDate: '2026-11-20' });
    const over = placement({ endDate: '2026-11-09' });
    const paused = placement({ status: 'paused' });
    const draft = placement({ status: 'draft' });
    const noImage = placement({ creativeDesktopPath: null, creativeMobilePath: null });
    const out = buildPublicSchedule([live, tomorrow, later, over, paused, draft, noImage], TODAY, { creativeBase: BASE });
    expect(out.placements.map((p) => p.id).sort()).toEqual([live.id, tomorrow.id].sort());
  });

  it('the browser can resolve the same winner from the payload as the server would', () => {
    const low = placement({ priority: 1 });
    const high = placement({ priority: 9 });
    const payload = buildPublicSchedule([low, high], TODAY, { creativeBase: BASE });
    const winner = resolveSlot(placementsFromPublic(payload), { slot: 'player_page_banner', date: TODAY })[0];
    expect(winner?.id).toBe(high.id);
  });

  it('a creative switches at midnight India time without a new fetch (next-day placement is in the payload)', () => {
    const next = placement({ startDate: '2026-11-11', endDate: '2026-11-20' });
    const restored = placementsFromPublic(buildPublicSchedule([next], TODAY, { creativeBase: BASE }));
    expect(resolveSlot(restored, { slot: 'player_page_banner', date: '2026-11-10' })).toEqual([]);
    expect(resolveSlot(restored, { slot: 'player_page_banner', date: '2026-11-11' })).toHaveLength(1);
  });

  it('liveSlots lists slots with a live placement', () => {
    expect(liveSlots([placement(), placement({ slot: 'home_partner_strip' }), placement({ slot: 'match_page_banner', status: 'paused' })], TODAY)).toEqual(['home_partner_strip', 'player_page_banner']);
  });
});

describe('placementsToGoData (the /go contract, D-031)', () => {
  const sponsors = [
    { id: SPONSOR_A, website: 'https://sponsor.example' },
    { id: SPONSOR_B, website: null },
  ];

  it('builds links with the placement id as targetId, the label and the end date', () => {
    const p = placement({ goSlug: 'spring-cup', label: 'Partner', endDate: '2026-12-31' });
    const out = placementsToGoData([p], { [p.id]: 'https://sponsor.example/landing?x=1' }, sponsors);
    expect(out.links['spring-cup']).toEqual({ target: 'https://sponsor.example/landing?x=1', label: 'partner', expires: '2026-12-31', targetId: p.id });
    expect(out.allowedHosts).toEqual(['sponsor.example']);
    const s = placement({ goSlug: 'paid', label: 'Sponsored' });
    expect(placementsToGoData([s], { [s.id]: 'https://sponsor.example/x' }, sponsors).links.paid?.label).toBe('sponsored');
  });

  it('allows the registered host and its subdomains only', () => {
    const ok = placement({ goSlug: 'sub' });
    const bad = placement({ goSlug: 'bad' });
    const lookalike = placement({ goSlug: 'look' });
    const out = placementsToGoData(
      [ok, bad, lookalike],
      { [ok.id]: 'https://shop.sponsor.example/x', [bad.id]: 'https://other.example/x', [lookalike.id]: 'https://evilsponsor.example/x' },
      sponsors,
    );
    expect(Object.keys(out.links)).toEqual(['sub']);
  });

  it('leaves out paused, draft and ended placements, a sponsor with no registered website, and a non-https target', () => {
    const paused = placement({ goSlug: 'paused', status: 'paused' });
    const noSite = placement({ goSlug: 'nosite', sponsorId: SPONSOR_B });
    const http = placement({ goSlug: 'plain' });
    const out = placementsToGoData([paused, noSite, http], { [paused.id]: 'https://sponsor.example/a', [noSite.id]: 'https://sponsor.example/a', [http.id]: 'http://sponsor.example/a' }, sponsors);
    expect(out.links).toEqual({});
    expect(out.allowedHosts).toEqual([]);
  });

  it('works end to end with the real /go handler: a click is logged with the placement id, an expired one is a 404', async () => {
    const p = placement({ goSlug: 'e2e-banner', endDate: '2026-11-30' });
    const data = placementsToGoData([p], { [p.id]: 'https://sponsor.example/landing' }, sponsors);
    const clicks: OutboundClick[] = [];
    const pending: Promise<unknown>[] = [];
    const deps = (now: string): GoDeps => ({
      links: data.links,
      allowedHosts: data.allowedHosts,
      now: () => new Date(now),
      logClick: async (c) => void clicks.push(c),
      hashUserAgent: async () => 'hash',
      waitUntil: (x) => void pending.push(x),
      siteOrigins: ['https://powersmash.example'],
    });
    const headers = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', referer: 'https://powersmash.example/players/fictional-player/' };
    const res = await handleGo('e2e-banner', new Request('https://powersmash.example/go/e2e-banner', { headers }), deps('2026-11-10T10:00:00Z'));
    await Promise.all(pending);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://sponsor.example/landing');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ go_slug: 'e2e-banner', target_type: 'sponsored', target_id: p.id, page_path: '/players/fictional-player/' });
    const late = await handleGo('e2e-banner', new Request('https://powersmash.example/go/e2e-banner', { headers }), deps('2026-12-01T10:00:00Z'));
    expect(late.status).toBe(404);
  });
});
