import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSlotOnPage, pathKind, slotAllowedOnPath, slotsForPage, tournamentSlugOfPath } from '../../src/lib/placements/guard';
import type { PageContext, PageKind } from '../../src/lib/placements/guard';
import { SLOT_KEYS, SLOTS } from '../../src/lib/placements/slots';

const page = (kind: PageKind, over: Partial<PageContext> = {}): PageContext => ({ kind, isProtected: false, hasIndependentContent: true, ...over });
const KINDS: PageKind[] = ['home', 'players_index', 'player', 'matches_index', 'match', 'tournaments_index', 'tournament', 'gear', 'other'];

describe('protected pages carry no slot and no beacon (D-031, D-012)', () => {
  it('returns no slot for any slot on a protected page of every kind', () => {
    for (const kind of KINDS) {
      const p = page(kind, { isProtected: true, matchBannerEnabled: true, coverageSponsorSlot: true });
      expect(slotsForPage(p)).toEqual([]);
      for (const slot of SLOT_KEYS) expect(checkSlotOnPage(p, slot)).toEqual({ allowed: false, reason: 'protected' });
    }
  });

  it('fails closed: an unknown or missing protection flag counts as protected', () => {
    for (const bad of [undefined, null, 0, 'false', 'no']) {
      const p = { ...page('player'), isProtected: bad } as unknown as PageContext;
      expect(slotsForPage(p)).toEqual([]);
    }
  });

  it('a normal player page gets its banner and the footer strip', () => {
    expect(slotsForPage(page('player'))).toEqual(['player_page_banner', 'footer_partner_strip']);
  });
});

describe('noindex (minimal) pages carry no slot either', () => {
  it('isNoindex is treated like protected', () => {
    for (const kind of KINDS) expect(slotsForPage(page(kind, { isNoindex: true }))).toEqual([]);
  });
});

describe('independent content rule (D-016)', () => {
  it('a page without real independent content gets nothing', () => {
    for (const kind of KINDS) expect(slotsForPage(page(kind, { hasIndependentContent: false, matchBannerEnabled: true, coverageSponsorSlot: true }))).toEqual([]);
  });

  it('non-content pages (legal, forms, errors) get nothing', () => {
    expect(slotsForPage(page('other'))).toEqual([]);
    expect(checkSlotOnPage(page('other'), 'footer_partner_strip').reason).toBe('not_a_content_page');
  });
});

describe('match banner is off by default (D-035 row 2)', () => {
  it('needs the owner setting', () => {
    expect(slotsForPage(page('match'))).toEqual(['footer_partner_strip']);
    expect(checkSlotOnPage(page('match'), 'match_page_banner').reason).toBe('setting_off');
    expect(slotsForPage(page('match', { matchBannerEnabled: true }))).toEqual(['match_page_banner', 'footer_partner_strip']);
  });
});

describe('page and slot fit', () => {
  it('the home page carries the home strip and the footer strip', () => {
    expect(slotsForPage(page('home'))).toEqual(['home_partner_strip', 'footer_partner_strip']);
  });
  it('a tournament page carries the banner, the coverage title only when the tournament has a coverage sponsor slot, and the footer', () => {
    expect(slotsForPage(page('tournament'))).toEqual(['tournament_page_banner', 'footer_partner_strip']);
    expect(slotsForPage(page('tournament', { coverageSponsorSlot: true }))).toEqual(['tournament_page_banner', 'tournament_coverage_title', 'footer_partner_strip']);
  });
  it('a slot cannot appear on the wrong kind of page', () => {
    expect(checkSlotOnPage(page('player'), 'match_page_banner').reason).toBe('slot_not_on_this_page');
    expect(checkSlotOnPage(page('home'), 'player_page_banner').reason).toBe('slot_not_on_this_page');
  });
  it('the gear banner is unavailable in Phase 1 even on a gear page', () => {
    expect(checkSlotOnPage(page('gear'), 'gear_page_banner').reason).toBe('unavailable_in_phase_1');
    expect(slotsForPage(page('gear'))).toEqual(['footer_partner_strip']);
  });
  it('never more than one banner per page (spec 8.3)', () => {
    for (const kind of KINDS) {
      const slots = slotsForPage(page(kind, { matchBannerEnabled: true, coverageSponsorSlot: true }));
      expect(slots.filter((s) => SLOTS[s].form === 'banner').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('route allow-list for the beacon', () => {
  it('maps real routes to a page kind', () => {
    expect(pathKind('/')).toBe('home');
    expect(pathKind('/players/')).toBe('players_index');
    expect(pathKind('/players/fictional-player/')).toBe('player');
    expect(pathKind('/matches/fake-match-1/')).toBe('match');
    expect(pathKind('/tournaments/')).toBe('tournaments_index');
    expect(pathKind('/tournaments/fictional-open-2026/')).toBe('tournament');
    expect(pathKind('/gear/')).toBe('gear');
  });
  it('refuses everything else', () => {
    for (const p of ['/tournaments/submit/', '/book/', '/privacy/', '/admin/', '/players/a/b/', '/players/UPPER/', '/players/x', '//evil/', '/api/placements', '', '/players//']) expect(pathKind(p)).toBeNull();
  });
  it('a slot is only allowed on a path that can carry it', () => {
    expect(slotAllowedOnPath('player_page_banner', '/players/fictional-player/')).toBe(true);
    expect(slotAllowedOnPath('player_page_banner', '/matches/fake-match-1/')).toBe(false);
    expect(slotAllowedOnPath('footer_partner_strip', '/tournaments/')).toBe(true);
    expect(slotAllowedOnPath('footer_partner_strip', '/privacy/')).toBe(false);
    expect(slotAllowedOnPath('gear_page_banner', '/gear/')).toBe(false); // the gear banner is not offered in the page table yet
    expect(slotAllowedOnPath('tournament_coverage_title', '/tournaments/fictional-open-2026/')).toBe(true);
  });
  it('reads the tournament slug', () => {
    expect(tournamentSlugOfPath('/tournaments/fictional-open-2026/')).toBe('fictional-open-2026');
    expect(tournamentSlugOfPath('/tournaments/submit/')).toBeNull();
    expect(tournamentSlugOfPath('/players/x/')).toBeNull();
  });
});

describe('the slot component', () => {
  const src = readFileSync(new URL('../../src/components/site/PlacementSlot.astro', import.meta.url), 'utf8');
  it('asks the guard before rendering anything', () => {
    expect(src).toContain('checkSlotOnPage(page, slot).allowed');
    expect(src).toMatch(/\{allowed && \(/);
  });
  it('never uses set:html or innerHTML and always has a label element', () => {
    expect(src).not.toMatch(/set:html|innerHTML|dangerouslySetInnerHTML/);
    expect(src).toContain('data-slot-label');
  });
  it('reserves its size with the catalogue values', () => {
    expect(src).toContain('def.reserved.mobileHeight');
    expect(src).toContain('def.reserved.desktopHeight');
    expect(src).toContain('min-height: var(--slot-h-mobile)');
  });
  it('the browser script never writes markup from data', () => {
    const client = readFileSync(new URL('../../src/lib/placements/client.ts', import.meta.url), 'utf8');
    expect(client).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });
});
