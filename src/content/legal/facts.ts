import { M3_ROUTES } from '../../lib/urls';
// Legal-page facts that are NOT in src/content/site.ts (the Site-shell worker owns that file). Everything is null until it
// exists or is supplied; a section, paragraph or table row that depends on a null value is HIDDEN (hide-section rule, D-034),
// never filled with a made-up value and never shown as a Todo. A Todo is only for what a page cannot honestly do without
// (legal name, address, contact, grievance officer, refund rules, timelines, court city). The lead may move these into
// site.ts or site_settings later.
export interface LegalFacts {
  /** Path of the online content-removal request form (arrives with the M2d profile-request and removal queue). null = no form yet, the form option is hidden. */
  readonly removalFormPath: string | null;
  /** ISO date (YYYY-MM-DD) of the latest dark-pattern self-audit (D-037), once a lawyer or CA says the certificate is needed and the owner has done the audit. null hides that section. */
  readonly darkPatternSelfAuditDate: string | null;

  // ---- OPTIONAL owner text (review finding C-14). Hidden until supplied; the pages are honest without them. ----
  /** The owner's own words on travel for events outside his home district (OT-20). null hides the line on the Delivery page. */
  readonly travelPolicy: string | null;
  /** The owner's own words on what he needs at a venue for a live stream, such as power and internet (OT-20). null hides the line on the Delivery page. */
  readonly liveStreamVenueNeeds: string | null;
  /** The target time for a rights dispute between an organiser and a person who recorded a video, set with the lawyer. null hides that row on the Content Removal page. */
  readonly rightsDisputeTarget: string | null;

  // ---- Where providers process data: stated only once the account exists and the owner confirms (review finding C-11). ----
  /** Region of the production Supabase project, for example "Mumbai, India", once OT-27 is done and the region is checked in the dashboard. null = the policy does not name a region. */
  readonly supabaseRegion: string | null;
  /** Region of the Resend sending domain, for example "Tokyo, Japan", once OT-40 is done. null = the policy does not name a region. */
  readonly resendRegion: string | null;
}

export const legalFacts: LegalFacts = {
  removalFormPath: M3_ROUTES.request, // the /request/ form exists (Forms worker, fix-forms-notes section 11)
  darkPatternSelfAuditDate: null,
  travelPolicy: null,
  liveStreamVenueNeeds: null,
  rightsDisputeTarget: null,
  supabaseRegion: null,
  resendRegion: null,
};

export type LegalFactName = keyof LegalFacts;

/** Every fact name, for tests. */
export const LEGAL_FACT_NAMES = Object.keys(legalFacts) as LegalFactName[];

/** The invisible marker name the placeholder gate lists for a hidden item: "legal-" plus the kebab-case fact name (at most 40 characters). */
export function hiddenMarkerName(name: LegalFactName): string {
  return `legal-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}
