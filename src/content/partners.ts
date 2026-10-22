// Real partners and sponsors ONLY (never fabricate; spec section 0 rule 5, OT-22). Empty until the owner supplies real ones.
// A partner is shown only when `permissionRecorded` is true (written permission to show the name and logo, OT-22 step 2).
// The partners strip (home page and footer) renders nothing while this list has no showable partner (D-034 hide-section rule).

export interface Partner {
  readonly name: string;
  /** Path of a logo under public/ (for example /partners/acme.svg). Supplied by the sponsor. */
  readonly logoPath: string;
  /** Alt text for the logo. */
  readonly logoAlt: string;
  /** Destination. Sponsored links get rel="sponsored nofollow" (D-031); later they go through /go/[slug]. */
  readonly url: string | null;
  /** The owner holds written permission to show this partner. */
  readonly permissionRecorded: boolean;
}

export const partners: readonly Partner[] = [];

/** Only partners with recorded permission may be shown. */
export function showablePartners(list: readonly Partner[] = partners): Partner[] {
  return list.filter((p) => p.permissionRecorded === true && p.name.trim() !== '' && p.logoPath.trim() !== '');
}
