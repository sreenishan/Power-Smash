// Coverage, player-product and promotion products (spec Appendix C.1 to C.3). DRAFT DATA.
//
// RULES (hard rule 7, D-034, CLAUDE.md "Never fabricate"):
//  - The names and inclusions below are the spec's SUGGESTIONS (Appendix C: "Inclusions are suggestions. The owner sets the
//    final inclusions and every price"). `inclusionsApproved` stays false until the owner approves them (OT-20).
//  - EVERY price is `null` until the owner supplies it (integer paise). Nothing here is a default price, fee or tax rate.
//  - `gstInclusive` is null (unknown) and `deliveryDays` is null (unknown): pages show nothing about them until supplied.
//  - Featured academy (Appendix C.3) is not listed: it needs the academy directory, which is Phase 2 (D-024).
//  - Public text must not promise what does not exist yet (R-ALLOWED-CLAIMS, review C-23). An inclusion that depends on a
//    later feature stays in the data with an `availableFrom` marker and is NEVER shown: every page reads inclusions through
//    publicInclusions(). Remove the marker only when the feature exists AND the owner agrees (OT-20, OT-22).
// To supply a price: set `pricePaise` (e.g. 500000 for Rs 5,000), pick the right `priceType`, set `gstInclusive` once the
// CA has said so, and set `inclusionsApproved: true` after the owner has approved the wording.

import type { PriceType } from '../lib/money';
import { ROUTES } from '../lib/urls';
import { site } from './site';

export type ProductGroup = 'organizers' | 'addons' | 'players' | 'promotion';

/** The milestone or phase in which a feature behind an inclusion is planned to exist. */
export type AvailableFrom = 'M2' | 'Phase 3';

/** One line of a package's inclusions. */
export interface Inclusion {
  readonly text: string;
  /**
   * Set = this inclusion depends on a feature that does not exist yet, so it is hidden from every public list until the
   * marker is removed. The value says when the feature is planned (it is a note, it never switches anything on by itself).
   */
  readonly availableFrom?: AvailableFrom;
}

export interface Product {
  /** URL-safe, stable. Also the `?package=` value on /book and /partner and the `?topic=` value on /contact. */
  readonly slug: string;
  readonly name: string;
  readonly group: ProductGroup;
  /** One factual line, restating the spec's description. */
  readonly summary: string;
  /** Suggested inclusions (Appendix C), shown only as a draft until `inclusionsApproved`. Read them through publicInclusions(). */
  readonly inclusions: readonly Inclusion[];
  readonly inclusionsApproved: boolean;
  readonly priceType: PriceType;
  /** Integer paise. null until the owner supplies it. */
  readonly pricePaise: number | null;
  /** True only after the owner approves the "On quote - message us on WhatsApp" wording. */
  readonly quoteWordingApproved: boolean;
  /** null = unknown: the page says nothing about GST on this product. */
  readonly gstInclusive: boolean | null;
  /** Working days to deliver, owner-supplied. null = not supplied: nothing is claimed. */
  readonly deliveryDays: number | null;
  /** D-024 suggests leading with these (tournament promotion, Essential, Rally Partner). The owner confirms under OT-20. */
  readonly suggestedLead: boolean;
  /** For sponsorship: the billing period from Appendix C.4 (shown only next to a real price). */
  readonly period: 'month' | 'tournament' | 'quarter' | null;
}

/** What a PackageCard needs: a coverage product or a sponsor package (the group is not shown on the card). */
export type PackageData = Omit<Product, 'group'>;

const draft = {
  inclusionsApproved: false,
  pricePaise: null,
  quoteWordingApproved: false,
  gstInclusive: null,
  deliveryDays: null,
  period: null,
} as const;

/** Plain inclusions (nothing deferred): `plainInclusions('A', 'B')`. */
export const plainInclusions = (...texts: string[]): Inclusion[] => texts.map((text) => ({ text }));

/**
 * The Tournament promotion summary names the WhatsApp Channel only once it exists (OT-09, site.whatsappChannelUrl): until then
 * the page must not promise a share on a channel that is not there (review C-23).
 */
export function promotionSummary(hasWhatsAppChannel: boolean): string {
  const where = hasWhatsAppChannel
    ? 'the YouTube community tab, Instagram, Facebook and the WhatsApp Channel'
    : 'the YouTube community tab, Instagram and Facebook';
  return `Your pamphlet shared on ${where}, plus a featured listing until the event.`;
}

export const products: readonly Product[] = [
  // --- C.1 Tournament coverage (organizers) ---
  {
    ...draft,
    slug: 'essential',
    name: 'Essential',
    group: 'organizers',
    summary: 'Finals-day coverage with one camera.',
    inclusions: plainInclusions('Finals day', '1 camera', 'Finals uploaded with player names', 'Tournament page on the website'),
    priceType: 'fixed',
    suggestedLead: true,
  },
  {
    ...draft,
    slug: 'pro',
    name: 'Pro',
    group: 'organizers',
    summary: 'Semi-finals and finals with two cameras, a highlights video and promotion.',
    inclusions: plainInclusions(
      'Semi-finals and finals',
      '2 cameras',
      'Highlights video',
      'Pamphlet promotion on all channels',
      'Featured listing',
    ),
    priceType: 'fixed',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'broadcast',
    name: 'Broadcast',
    group: 'organizers',
    summary: 'Live stream with scoreboard and sponsor overlays, and multi-court recording.',
    inclusions: plainInclusions(
      'Live stream with scoreboard and sponsor overlays',
      'Multi-court recording',
      'Full uploads',
      'Highlights',
      'Venue QR posters',
    ),
    priceType: 'fixed',
    suggestedLead: false,
  },
  // Add-ons (Appendix C.1 "Add-ons" row). Names only: no travel policy is stated anywhere (OT-20 supplies it).
  {
    ...draft,
    slug: 'extra-match-day',
    name: 'Extra match day',
    group: 'addons',
    summary: 'An additional match day added to a coverage package.',
    inclusions: [],
    priceType: 'fixed',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'extra-court',
    name: 'Extra court',
    group: 'addons',
    summary: 'An additional court added to a coverage package.',
    inclusions: [],
    priceType: 'fixed',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'travel-outside-home-district',
    name: 'Travel outside the home district',
    group: 'addons',
    summary: 'Coverage at a venue outside the home district.',
    inclusions: [],
    priceType: 'fixed',
    suggestedLead: false,
  },

  // --- C.2 Player products ---
  {
    ...draft,
    slug: 'highlight-reel',
    name: 'Highlight reel',
    group: 'players',
    summary: 'A 2-3 minute edit from chosen matches.',
    inclusions: [],
    priceType: 'fixed',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'hd-match-file',
    name: 'HD match file',
    group: 'players',
    summary: 'The full match, downloadable.',
    inclusions: [],
    priceType: 'fixed',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'season-pack',
    name: 'Season pack',
    group: 'players',
    summary: "All of a player's matches from one year.",
    inclusions: [],
    priceType: 'fixed',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'custom-edit',
    name: 'Custom edit',
    group: 'players',
    summary: 'Coaching cut, trial showreel and similar.',
    inclusions: [],
    // Appendix C.2 prices this "On quote". The wording is shown only after the owner approves it (quoteWordingApproved).
    priceType: 'quote',
    suggestedLead: false,
  },

  // --- C.3 Promotion & listings ---
  {
    ...draft,
    slug: 'tournament-promotion',
    name: 'Tournament promotion',
    group: 'promotion',
    summary: promotionSummary(Boolean(site.whatsappChannelUrl?.trim())),
    inclusions: [],
    priceType: 'fixed',
    suggestedLead: true,
  },
] as const;

export const productGroups: readonly {
  readonly id: ProductGroup;
  readonly title: string;
  readonly intro: string;
}[] = [
  { id: 'organizers', title: 'Tournament coverage', intro: 'For tournament organizers and associations.' },
  { id: 'addons', title: 'Add-ons', intro: 'Extras you can add to a coverage package.' },
  { id: 'players', title: 'Player products', intro: 'For players and parents.' },
  { id: 'promotion', title: 'Promotion', intro: 'Get your tournament in front of the community.' },
];

/** The Services page shows these three groups (add-ons sit with coverage and appear on /pricing). */
export const serviceGroupIds: readonly ProductGroup[] = ['organizers', 'players', 'promotion'];

export function productsInGroup(group: ProductGroup, list: readonly Product[] = products): Product[] {
  return list.filter((p) => p.group === group);
}

/**
 * The inclusions a visitor may see: every line WITHOUT an `availableFrom` marker, as plain text. This is the only way pages
 * and cards read inclusions (tests/site/products.test.ts scans the sources for a direct read).
 */
export function publicInclusions(p: { readonly inclusions: readonly Inclusion[] }): string[] {
  return p.inclusions.filter((i) => i.availableFrom === undefined).map((i) => i.text);
}

/** True when any listed product still shows suggested inclusions the owner has not approved (pages then show ONE <Todo>). */
export function needsInclusionApproval(items: readonly Pick<Product, 'inclusions' | 'inclusionsApproved'>[]): boolean {
  return items.some((p) => publicInclusions(p).length > 0 && !p.inclusionsApproved);
}

export function productBySlug(slug: string, list: readonly Product[] = products): Product | undefined {
  return list.find((p) => p.slug === slug);
}

export type EnquiryGroup = ProductGroup | 'sponsorship';

/**
 * Where the enquiry button for a product or package goes (R-TOPIC, review B-11):
 *  - coverage packages (group "organizers")  -> /book/?package=<slug>      (the booking form preselects it);
 *  - sponsor packages                        -> /partner/?package=<slug>   (the partner form preselects it);
 *  - every other product (add-ons, player products, promotion) -> /contact/?topic=<slug> (the message is prefilled with the
 *    product's name; only a slug that matches a product or sponsor package is ever used).
 * The page paths come from ROUTES, so they carry the trailing slash (R-LINKS).
 */
export function enquiryHref(p: { slug: string; group: EnquiryGroup }): string {
  const key = encodeURIComponent(p.slug);
  if (p.group === 'organizers') return `${ROUTES.book}?package=${key}`;
  if (p.group === 'sponsorship') return `${ROUTES.partner}?package=${key}`;
  return `${ROUTES.contact}?topic=${key}`;
}

// --- Process timeline (spec 7.9): Enquire > Quote > Advance > Coverage day > Delivery > Balance.
// Descriptions are deliberately neutral: they state NO percentage, deadline or payment rule. Those are the owner's (OT-20, OT-21).
export const processSteps: readonly { readonly title: string; readonly text: string }[] = [
  { title: 'Enquire', text: 'Tell us your dates and venue on the booking form or on WhatsApp.' },
  { title: 'Quote', text: 'We reply with a quote for the package you choose.' },
  { title: 'Advance', text: 'An advance payment confirms your dates.' },
  { title: 'Coverage day', text: 'We film at your venue.' },
  { title: 'Delivery', text: 'Your videos are delivered as agreed in the quote.' },
  { title: 'Balance', text: 'The remaining amount is settled as agreed in the quote.' },
];

const CTA_LABEL: Record<EnquiryGroup, string> = {
  organizers: 'Book coverage',
  addons: 'Ask about this',
  players: 'Ask for this',
  promotion: 'Promote my tournament',
  sponsorship: 'Partner with us',
};

/** The enquiry button (link and label) for a product or sponsor package. */
export function enquiryTarget(p: { slug: string; group: EnquiryGroup }): { href: string; label: string } {
  return { href: enquiryHref(p), label: CTA_LABEL[p.group] };
}
