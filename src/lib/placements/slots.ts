// Sponsor slot catalogue (spec 8.3, D-031, D-016, D-035). Pure data, no imports: the page components, the schedule resolver, the
// beacon endpoint and the admin all read the same table.
//
// Guardrails baked into the catalogue (spec 8.3): at most ONE banner above the fold per page, never inside the video player, no
// pop-ups, always labelled. Sizes are DESIGN choices (the standard 728x90 / 320x100 banner formats), not business facts: they only
// reserve space so the layout never shifts when the creative arrives.

export const SLOT_KEYS = [
  'home_partner_strip',
  'footer_partner_strip',
  'player_page_banner',
  'match_page_banner',
  'tournament_page_banner',
  'tournament_coverage_title',
  'gear_page_banner',
] as const;

export type SlotKey = (typeof SLOT_KEYS)[number];

/** `banner` = one image box, `strip` = a row of partner logos, `title` = a "Coverage by ..." line next to a tournament title. */
export type SlotForm = 'banner' | 'strip' | 'title';

/** The kind of public page a slot lives on. `any` = every content page (the footer strip). */
export type SlotPage = 'home' | 'any' | 'player' | 'match' | 'tournament' | 'gear';

export interface SlotDef {
  readonly key: SlotKey;
  readonly title: string;
  readonly form: SlotForm;
  readonly page: SlotPage;
  /** True when the placement must name one tournament (its slug) because the slot is per tournament. */
  readonly scoped: 'required' | 'optional' | 'none';
  /** How many placements the slot shows at once (a strip shows several partners, a banner one). */
  readonly maxItems: number;
  /** Reserved box in CSS pixels so the layout never shifts (desktop from 768 px wide, mobile below). */
  readonly reserved: { readonly desktopHeight: number; readonly mobileHeight: number; readonly desktopMaxWidth: number; readonly mobileMaxWidth: number };
  /** M3 can create placements for it (the page it lives on exists in Phase 1). */
  readonly availableInM3: boolean;
  /** Shown only when the page passes the independent-value rule (D-016 III.G.1.d). */
  readonly requiresIndependentContent: boolean;
  /** Off until the owner switches it on in settings (D-035 row 2: the match-page banner). */
  readonly offByDefault: boolean;
  /** One plain-English line for the admin. */
  readonly note: string;
}

const BANNER = { desktopHeight: 90, mobileHeight: 100, desktopMaxWidth: 728, mobileMaxWidth: 320 } as const;
const STRIP = { desktopHeight: 88, mobileHeight: 72, desktopMaxWidth: 960, mobileMaxWidth: 360 } as const;
const TITLE = { desktopHeight: 28, mobileHeight: 28, desktopMaxWidth: 360, mobileMaxWidth: 320 } as const;

export const SLOTS: Readonly<Record<SlotKey, SlotDef>> = {
  home_partner_strip: {
    key: 'home_partner_strip',
    title: 'Home partner strip',
    form: 'strip',
    page: 'home',
    scoped: 'none',
    maxItems: 6,
    reserved: STRIP,
    availableInM3: true,
    requiresIndependentContent: true,
    offByDefault: false,
    note: 'Logos of current partners on the home page, labelled "Partners".',
  },
  footer_partner_strip: {
    key: 'footer_partner_strip',
    title: 'Footer partner strip',
    form: 'strip',
    page: 'any',
    scoped: 'none',
    maxItems: 6,
    reserved: STRIP,
    availableInM3: true,
    requiresIndependentContent: true,
    offByDefault: false,
    note: 'Logos of current partners above the footer of every content page, labelled "Partners".',
  },
  player_page_banner: {
    key: 'player_page_banner',
    title: 'Player page banner',
    form: 'banner',
    page: 'player',
    scoped: 'none',
    maxItems: 1,
    reserved: BANNER,
    availableInM3: true,
    requiresIndependentContent: true,
    offByDefault: false,
    note: 'One banner beside the player profile. Never on a protected-player page.',
  },
  match_page_banner: {
    key: 'match_page_banner',
    title: 'Match page banner',
    form: 'banner',
    page: 'match',
    scoped: 'none',
    maxItems: 1,
    reserved: BANNER,
    availableInM3: true,
    requiresIndependentContent: true,
    offByDefault: true,
    note: 'One banner beside the video player on a match page. Off by default (D-035 row 2) and only on pages with real independent content (D-016).',
  },
  tournament_page_banner: {
    key: 'tournament_page_banner',
    title: 'Tournament page banner',
    form: 'banner',
    page: 'tournament',
    scoped: 'optional',
    maxItems: 1,
    reserved: BANNER,
    availableInM3: true,
    requiresIndependentContent: true,
    offByDefault: false,
    note: 'One banner on tournament pages: for all tournaments, or for one tournament when a slug is set (a one-tournament placement wins).',
  },
  tournament_coverage_title: {
    key: 'tournament_coverage_title',
    title: 'Tournament coverage sponsor',
    form: 'title',
    page: 'tournament',
    scoped: 'required',
    maxItems: 1,
    reserved: TITLE,
    availableInM3: true,
    requiresIndependentContent: true,
    offByDefault: false,
    note: 'A "Coverage by ..." line next to one tournament title (per tournament).',
  },
  gear_page_banner: {
    key: 'gear_page_banner',
    title: 'Gear page banner',
    form: 'banner',
    page: 'gear',
    scoped: 'none',
    maxItems: 1,
    reserved: BANNER,
    availableInM3: false, // /gear is Phase 2 (spec 8.6)
    requiresIndependentContent: true,
    offByDefault: true,
    note: 'Phase 2: the gear page does not exist in Phase 1.',
  },
};

export const isSlotKey = (value: unknown): value is SlotKey => typeof value === 'string' && (SLOT_KEYS as readonly string[]).includes(value);

/** Slots the admin may create placements for in Phase 1. */
export const slotsAvailableInM3 = (): SlotDef[] => SLOT_KEYS.map((k) => SLOTS[k]).filter((s) => s.availableInM3);

/** What the visitor reads on the label: paid slots are "Sponsored", partner logos "Partner" (spec 15.5, D-031). */
export const PLACEMENT_LABELS = ['Sponsored', 'Partner'] as const;
export type PlacementLabel = (typeof PLACEMENT_LABELS)[number];
