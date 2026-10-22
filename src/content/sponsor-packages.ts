// Sponsorship packages (spec Appendix C.4). DRAFT DATA, same rules as products.ts:
//  - every price is `null` until the owner supplies it (OT-20/OT-22); `gstInclusive`, `deliveryDays` are null (unknown);
//  - the deliverables are the spec's SUGGESTIONS; `inclusionsApproved` stays false until the owner approves them;
//  - D-024 proposes re-leading the offer with YouTube, WhatsApp and Instagram deliverables and treating website banners as a
//    bonus line. That is NOT applied here because the owner has not approved D-024: the lead/owner decide, then edit this file.
//    Two Appendix C.4 lines depend on things that do not exist yet, so they carry an `availableFrom` marker and are NEVER shown
//    publicly (R-ALLOWED-CLAIMS, review C-23): "Banners on player and match pages" (the archive arrives in M2, and D-016 item 6
//    limits slots to pages with real original content, match-page banner off by default) and "Power Smash Open naming rights"
//    (the event is Phase 3). The owner still decides the final packages (OT-20, OT-22).
//  - No sponsor names, logos or past partners appear here: real partners live in partners.ts and only with written permission.

import { plainInclusions, type Product } from './products';

export interface SponsorPackage extends Omit<Product, 'group'> {
  readonly group: 'sponsorship';
}

const draft = {
  group: 'sponsorship',
  inclusionsApproved: false,
  priceType: 'fixed',
  pricePaise: null,
  quoteWordingApproved: false,
  gstInclusive: null,
  deliveryDays: null,
} as const;

export const sponsorPackages: readonly SponsorPackage[] = [
  {
    ...draft,
    slug: 'rally-partner',
    name: 'Rally Partner',
    summary: 'A starter partnership: your brand on the website and in video descriptions.',
    inclusions: plainInclusions(
      'Partner strip on the website',
      'Link in the descriptions of all uploads that month',
      'Weekly Instagram story',
    ),
    period: 'month',
    suggestedLead: true,
  },
  {
    ...draft,
    slug: 'court-partner',
    name: 'Court Partner',
    summary: 'Rally Partner, plus your logo on uploads and a monthly report.',
    inclusions: [
      { text: 'Everything in Rally Partner' },
      { text: 'Banners on player and match pages', availableFrom: 'M2' },
      { text: 'Logo on uploads' },
      { text: 'Monthly report' },
    ],
    period: 'month',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'coverage-partner',
    name: 'Coverage Partner',
    summary: 'Present the coverage of one tournament.',
    inclusions: plainInclusions(
      '"Coverage presented by" your brand in titles and overlays',
      'Venue banner',
      'Tournament-page banner',
      'Live-stream overlay',
    ),
    period: 'tournament',
    suggestedLead: false,
  },
  {
    ...draft,
    slug: 'title-partner',
    name: 'Title Partner',
    summary: 'The top partnership: everything above, with priority placements.',
    inclusions: [
      { text: 'Everything above' },
      { text: 'Priority placements' },
      { text: 'Power Smash Open naming rights', availableFrom: 'Phase 3' },
    ],
    period: 'quarter',
    suggestedLead: false,
  },
] as const;

export function sponsorPackageBySlug(slug: string): SponsorPackage | undefined {
  return sponsorPackages.find((p) => p.slug === slug);
}

/** Wording for the billing period shown next to a real price ("per month"). Never shown without a price. */
export const PERIOD_LABEL: Record<NonNullable<Product['period']>, string> = {
  month: 'per month',
  tournament: 'per tournament',
  quarter: 'per quarter',
};
