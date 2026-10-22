import { describe, expect, it } from 'vitest';
import { cleanTargetUrl, validatePlacement } from '../../src/lib/placements/validate';
import type { PlacementInput } from '../../src/lib/placements/validate';
import { SPONSOR_A, placement } from './helpers';

const input = (over: Partial<PlacementInput> = {}): PlacementInput => ({
  sponsorId: SPONSOR_A,
  slot: 'player_page_banner',
  creativeDesktopPath: 'sponsors/fictional/banner-d.png',
  creativeMobilePath: 'sponsors/fictional/banner-m.png',
  alt: 'Fictional sponsor banner',
  targetUrl: 'https://sponsor.example/landing',
  goSlug: 'fictional-banner',
  startDate: '2026-12-01',
  endDate: '2026-12-31',
  label: 'Sponsored',
  ...over,
});

describe('cleanTargetUrl', () => {
  it('accepts https on a real host and normalises it', () => {
    expect(cleanTargetUrl(' https://Sponsor.example/a?b=1#c ')).toBe('https://sponsor.example/a?b=1#c');
  });
  it('refuses http, a login in the URL, a bare host, an IP address and junk', () => {
    for (const u of ['http://sponsor.example', 'https://user:pw@sponsor.example', 'https://localhost', 'https://10.0.0.1/x', 'javascript:alert(1)', 'sponsor.example', '']) expect(cleanTargetUrl(u)).toBeNull();
  });
});

describe('validatePlacement', () => {
  it('accepts a complete placement and defaults to a draft with priority 0', () => {
    const r = validatePlacement(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ status: 'draft', priority: 0, scopeKey: null, slot: 'player_page_banner' });
      expect(r.targetUrl).toBe('https://sponsor.example/landing');
    }
  });

  it('refuses the gear slot in Phase 1 and an unknown slot', () => {
    expect(validatePlacement(input({ slot: 'gear_page_banner' }))).toMatchObject({ ok: false, errors: { slot: expect.any(String) } });
    expect(validatePlacement(input({ slot: 'sidebar' }))).toMatchObject({ ok: false, errors: { slot: expect.any(String) } });
  });

  it('needs a tournament for the coverage title and refuses one for a slot that is not per tournament', () => {
    expect(validatePlacement(input({ slot: 'tournament_coverage_title' }))).toMatchObject({ ok: false, errors: { scopeKey: expect.any(String) } });
    expect(validatePlacement(input({ slot: 'tournament_coverage_title', scopeKey: 'fictional-open' })).ok).toBe(true);
    expect(validatePlacement(input({ slot: 'home_partner_strip', scopeKey: 'fictional-open' }))).toMatchObject({ ok: false, errors: { scopeKey: expect.any(String) } });
    expect(validatePlacement(input({ slot: 'tournament_page_banner', scopeKey: 'Bad Slug' }))).toMatchObject({ ok: false, errors: { scopeKey: expect.any(String) } });
  });

  it('needs an image, safe Storage keys, and alt text', () => {
    expect(validatePlacement(input({ creativeDesktopPath: null, creativeMobilePath: null }))).toMatchObject({ ok: false, errors: { creative: expect.any(String) } });
    for (const bad of ['../etc/passwd', '/abs/path.png', 'a//b.png', 'https://evil.example/x.png', 'a b.png']) {
      expect(validatePlacement(input({ creativeDesktopPath: bad }))).toMatchObject({ ok: false, errors: { creative: expect.any(String) } });
    }
    expect(validatePlacement(input({ alt: '  ' }))).toMatchObject({ ok: false, errors: { alt: expect.any(String) } });
    expect(validatePlacement(input({ alt: 'x'.repeat(201) }))).toMatchObject({ ok: false, errors: { alt: expect.any(String) } });
  });

  it('warns when only one image is given', () => {
    const r = validatePlacement(input({ creativeMobilePath: null }));
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('checks the dates', () => {
    expect(validatePlacement(input({ startDate: '2026-02-30' }))).toMatchObject({ ok: false, errors: { startDate: expect.any(String) } });
    expect(validatePlacement(input({ endDate: '2026-11-30' }))).toMatchObject({ ok: false, errors: { endDate: expect.any(String) } });
    expect(validatePlacement(input({ startDate: '2026-12-31', endDate: '2026-12-31' })).ok).toBe(true);
  });

  it('checks priority, label, status, headline, target and go slug', () => {
    expect(validatePlacement(input({ priority: 101 }))).toMatchObject({ ok: false, errors: { priority: expect.any(String) } });
    expect(validatePlacement(input({ priority: 1.5 }))).toMatchObject({ ok: false, errors: { priority: expect.any(String) } });
    expect(validatePlacement(input({ label: 'Ad' }))).toMatchObject({ ok: false, errors: { label: expect.any(String) } });
    expect(validatePlacement(input({ status: 'deleted' }))).toMatchObject({ ok: false, errors: { status: expect.any(String) } });
    expect(validatePlacement(input({ headline: 'h'.repeat(81) }))).toMatchObject({ ok: false, errors: { headline: expect.any(String) } });
    expect(validatePlacement(input({ targetUrl: 'http://sponsor.example' }))).toMatchObject({ ok: false, errors: { targetUrl: expect.any(String) } });
    for (const bad of ['Has Space', 'UPPER', '-lead', 'a_b', '', 'x'.repeat(64)]) expect(validatePlacement(input({ goSlug: bad }))).toMatchObject({ ok: false, errors: { goSlug: expect.any(String) } });
  });

  it('the go slug must be unique across placements, but the placement itself may keep its own', () => {
    const other = placement({ goSlug: 'taken' });
    expect(validatePlacement(input({ goSlug: 'taken' }), [other])).toMatchObject({ ok: false, errors: { goSlug: expect.any(String) } });
    expect(validatePlacement(input({ id: other.id, goSlug: 'taken' }), [other]).ok).toBe(true);
  });

  it('refuses an equal-priority overlap in a one-item slot and warns on a priority-resolved one', () => {
    const existing = placement({ startDate: '2026-12-10', endDate: '2026-12-20', priority: 3 });
    expect(validatePlacement(input({ priority: 3 }), [existing])).toMatchObject({ ok: false, errors: { priority: expect.stringContaining('same priority') } });
    const r = validatePlacement(input({ priority: 4 }), [existing]);
    expect(r.ok && r.warnings.some((w) => w.includes('overlaps'))).toBe(true);
  });

  it('S2-10: when the sponsor website is known the target host must be its host or a subdomain', () => {
    expect(validatePlacement(input({ sponsorWebsite: 'https://sponsor.example' })).ok).toBe(true);
    expect(validatePlacement(input({ sponsorWebsite: 'https://sponsor.example', targetUrl: 'https://shop.sponsor.example/x' })).ok).toBe(true);
    for (const t of ['https://other.example/x', 'https://evilsponsor.example/x', 'https://sponsor.example.evil.example/x']) {
      expect(validatePlacement(input({ sponsorWebsite: 'https://sponsor.example', targetUrl: t }))).toMatchObject({ ok: false, errors: { targetUrl: expect.any(String) } });
    }
    expect(validatePlacement(input({ sponsorWebsite: null }))).toMatchObject({ ok: false, errors: { targetUrl: expect.any(String) } });
  });

  it('does not count a paused or ended placement as an overlap', () => {
    expect(validatePlacement(input(), [placement({ startDate: '2026-12-10', endDate: '2026-12-20', status: 'paused' })]).ok).toBe(true);
  });
});
