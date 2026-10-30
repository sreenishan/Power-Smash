// Review status of each legal page (OT-15). Owned by the Legal-drafts worker; the LEAD flips a flag after a lawyer has
// reviewed that page and the owner has approved the final wording. Nothing else may set `reviewedByLawyer: true`.
//
// While a flag is false, <LegalDraftNotice page="..."> renders <Todo what="lawyer review of this page (OT-15)">, which
// prints the literal text "TODO(owner): ..." and so FAILS the strict release gate (PS_STRICT=1, D-034). That is on purpose:
// a draft legal page can never ship by accident.
export type LegalPageKey = 'privacy' | 'terms' | 'refunds' | 'delivery' | 'disclosures' | 'contentRemoval';

export interface LegalReviewStatus {
  /** True only after a lawyer reviewed this page's final wording. */
  readonly reviewedByLawyer: boolean;
  /** ISO calendar date (YYYY-MM-DD) of that review. Required when `reviewedByLawyer` is true; null otherwise. */
  readonly reviewedOn: string | null;
}

export const legalStatus: Record<LegalPageKey, LegalReviewStatus> = {
  privacy: { reviewedByLawyer: false, reviewedOn: null },
  terms: { reviewedByLawyer: false, reviewedOn: null },
  refunds: { reviewedByLawyer: false, reviewedOn: null },
  delivery: { reviewedByLawyer: false, reviewedOn: null },
  disclosures: { reviewedByLawyer: false, reviewedOn: null },
  contentRemoval: { reviewedByLawyer: false, reviewedOn: null },
};

// --------------------------------------------------------------------------------------------------------------------
// Feature flags for legal WORDING (review finding C-11)
//
// A legal page may only say what is TRUE on the day it is published. Text about something that does not exist yet (a
// one-time code, the YouTube player, player pages, sponsor banners ...) sits in a `futureWording` block next to the page
// that needs it (privacy.ts, terms.ts, ...) and is NOT rendered until the flag below is switched to true. Only the lead
// switches a flag, in the same change that ships the feature (or when the owner confirms the practice). Every flag is
// `false` today except `cloudflareWebAnalytics`, which follows the build: it is true only when the build has an analytics
// token, i.e. exactly when the beacon is on the page (src/components/site/Analytics.astro uses the same test).
//
// tests/legal/features.test.ts proves that with a flag off none of its words reach a page, and that switching it on adds them.
// docs/legal/G1_REREAD_CHECKLIST.md lists every flag with the milestone that unlocks it.
// --------------------------------------------------------------------------------------------------------------------
export interface LegalFeatures {
  // -- Features that arrive in a later milestone -------------------------------------------------------------------
  /** M2a. The site calls the YouTube API and shows API data (titles, thumbnails, views). Unlocks the "YouTube API Services" statements and links (Developer Policies III.A). */
  readonly youtubeApiData: boolean;
  /** M2c. Click-to-load video player ("This loads YouTube" notice) and thumbnails from YouTube's image servers. */
  readonly youtubeEmbeds: boolean;
  /** M2c. Player, match and tournament archive pages and the protected-player rules of D-012 (decision still PROPOSED: owner approval first). */
  readonly archivePages: boolean;
  /**
   * Platform wave 3. Public competition pages (/competitions/: entry lists, draws, order of play, results, published local
   * rankings) built from the data the organizer and the owner enter. A player is named only when age_status is
   * adult_confirmed, the player is public, not provisional, not merged and not suppressed (no published video needed:
   * the archive rule stays separate); everyone else, and everyone in a junior event or a minor-signal tournament, is
   * "Protected player" and left out of rankings. Competition pages never link to player pages (D-012, D-109).
   */
  readonly competitionPages: boolean;
  /** M2d. A one-time code (or similar) to check that a requester controls the phone or email. */
  readonly requestVerification: boolean;
  /** M2d. Age proof viewed privately and deleted (D-015, still PROPOSED). */
  readonly ageProofChecks: boolean;
  /** M3. Email alerts sign-up (D-026). */
  readonly emailAlerts: boolean;
  /** M3. "Send your match video" form and licence. */
  readonly videoSubmissions: boolean;
  /** M2c or M3. Sponsor banners beside the video player (D-016 item 6). */
  readonly sponsorBanners: boolean;
  /** M3. Sponsor and partner links routed through the click-counting /go link. */
  readonly sponsorLinkTracking: boolean;
  /** M3. Payment records from the payment provider are stored by the site and redacted after 90 days. */
  readonly paymentRecords: boolean;
  /** Later (P3). Event documents are held and deleted 30 days after the event (spec 15.4). */
  readonly eventDocuments: boolean;
  /** M2d or later. An erasure log exists and is re-applied after a backup restore (D-028). */
  readonly erasureLog: boolean;
  // -- Practices the owner must confirm, or a switch the owner makes ---------------------------------------------------
  /** The owner confirms an encrypted off-GitHub backup copy exists and how long it is kept (D-011). */
  readonly offsiteBackupCopy: boolean;
  /** D-019 approved and in daily use: no paid coverage starts without the written agreement. */
  readonly coverageAgreementRequired: boolean;
  /** The owner confirms the health, injury and supplement claims rule as his own practice. */
  readonly healthClaimsRule: boolean;
  /**
   * R-TELEGRAM-PHONE. Switch on ONLY together with the Worker variable TELEGRAM_ALERT_PHONE_LINK=true and only after the
   * owner and the lawyer agree: the owner alert then carries a WhatsApp reply link that contains the customer's phone number.
   */
  readonly telegramPhoneLink: boolean;
  // -- Follows the build ---------------------------------------------------------------------------------------------
  /** True only when this build carries the Cloudflare Web Analytics beacon (a valid PUBLIC_CF_ANALYTICS_TOKEN). Do not set by hand. */
  readonly cloudflareWebAnalytics: boolean;
}

export type FeatureName = keyof LegalFeatures;

/** The same test as src/components/site/Analytics.astro: 16 to 64 letters or digits. */
export function analyticsTokenIsValid(raw: unknown): boolean {
  return typeof raw === 'string' && /^[A-Za-z0-9]{16,64}$/.test(raw.trim());
}

export const features: LegalFeatures = {
  youtubeApiData: false,
  youtubeEmbeds: false,
  archivePages: false,
  competitionPages: false,
  requestVerification: false,
  ageProofChecks: false,
  emailAlerts: false,
  videoSubmissions: false,
  sponsorBanners: false,
  sponsorLinkTracking: false,
  paymentRecords: false,
  eventDocuments: false,
  erasureLog: false,
  offsiteBackupCopy: false,
  coverageAgreementRequired: false,
  healthClaimsRule: false,
  telegramPhoneLink: false,
  cloudflareWebAnalytics: analyticsTokenIsValid(import.meta.env?.PUBLIC_CF_ANALYTICS_TOKEN),
};

/** Every flag name, for tests and checklists. */
export const FEATURE_NAMES = Object.keys(features) as FeatureName[];

/** What each flag unlocks and when. Plain data so the G1 checklist and the tests read one list. */
export const FEATURE_INFO: Record<FeatureName, { readonly arrives: string; readonly unlocks: string }> = {
  youtubeApiData: { arrives: 'M2a', unlocks: 'YouTube API Services statement, YouTube Terms of Service agreement, Google Privacy Policy links, "YouTube views" wording' },
  youtubeEmbeds: { arrives: 'M2c', unlocks: 'the click-to-load video player and thumbnails: cookie and provider wording' },
  archivePages: { arrives: 'M2c', unlocks: 'player, match and tournament pages: protected-player rules (D-012), "Match details by Power Smash"' },
  competitionPages: { arrives: 'platform wave 3 (owner + lawyer)', unlocks: 'the /competitions/ pages in the release build: entry lists, draws, order of play, results and local rankings (not official BWF rankings), with "Protected player" for anyone not confirmed adult' },
  requestVerification: { arrives: 'M2d', unlocks: 'one-time code to check who is making a request' },
  ageProofChecks: { arrives: 'M2d', unlocks: 'age proof viewed privately and deleted (D-015)' },
  emailAlerts: { arrives: 'M3', unlocks: 'email alerts sign-up wording and the 18+ confirmation' },
  videoSubmissions: { arrives: 'M3', unlocks: 'the "send your video" form: Terms section and Privacy wording' },
  sponsorBanners: { arrives: 'M2c/M3', unlocks: 'banners beside the video player' },
  sponsorLinkTracking: { arrives: 'M3', unlocks: 'sponsor and partner links that go through the counting /go link' },
  paymentRecords: { arrives: 'M3', unlocks: 'stored payment records and the 90-day redaction row' },
  eventDocuments: { arrives: 'P3', unlocks: 'event documents deleted 30 days after the event' },
  erasureLog: { arrives: 'M2d+', unlocks: 'the erasure log sentence about restored backups' },
  offsiteBackupCopy: { arrives: 'owner', unlocks: 'the private cloud-storage backup copy in the provider list' },
  coverageAgreementRequired: { arrives: 'owner (D-019)', unlocks: '"we do not start paid coverage without that agreement"' },
  healthClaimsRule: { arrives: 'owner', unlocks: 'the health, injury and supplement claims rule on Disclosures' },
  telegramPhoneLink: { arrives: 'owner + lawyer (R-TELEGRAM-PHONE)', unlocks: 'owner alerts carry a reply link with the phone number' },
  cloudflareWebAnalytics: { arrives: 'build (token set)', unlocks: 'page-view statistics sentences' },
};

/** The text of the Todo shown while a page is unreviewed. Kept here so the component and the tests share one string. */
export const LAWYER_REVIEW_TODO = 'lawyer review of this page (OT-15)';

/** True while the page still needs its lawyer review (so the draft notice must be shown). */
export function needsLawyerReview(page: LegalPageKey, status: Record<LegalPageKey, LegalReviewStatus> = legalStatus): boolean {
  return status[page].reviewedByLawyer !== true;
}

/** The Todo text for a page, or null when the lawyer has reviewed it. */
export function draftNoticeTodo(page: LegalPageKey, status: Record<LegalPageKey, LegalReviewStatus> = legalStatus): string | null {
  return needsLawyerReview(page, status) ? LAWYER_REVIEW_TODO : null;
}
