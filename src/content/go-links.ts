// Tracked outbound links for /go/[slug] (spec 8.3, D-031). M1 keeps them in code; M3 moves them to the database with the sponsor
// placements. The map starts EMPTY on purpose: every sponsor, partner and affiliate target is supplied by the owner (never invented).
//
// Add an entry like this, then rebuild:
//   'example-sponsor': { target: 'https://sponsor.example/landing', label: 'sponsored', expires: '2027-03-31' },
//
//   slug      lower-case letters, digits and hyphens, at most 63 characters; it becomes `utm_campaign`
//   target    https only, and its host must be listed in goAllowedHosts below. An 'internal' link takes a path such as '/partner'
//   label     'sponsored' | 'partner' | 'affiliate' | 'internal'. Paid slots are shown to visitors as "Sponsored" or "Ad" (D-031),
//             affiliate links carry the program's required disclosure wording (spec 8.4)
//   expires   optional. 'YYYY-MM-DD' = valid through the end of that day in India; a full ISO date-time also works
//   targetId  optional uuid of the sponsor or tournament this belongs to (stored with the click in outbound_clicks.target_id, a uuid
//             column). Anything that is not a uuid is dropped and logged once, so a typo can never stop the counting
//
// UTM parameters are added automatically: utm_source=powersmash, utm_medium=sponsor (sponsored and partner) or affiliate, utm_campaign=<slug>.
import type { GoLinks } from '../lib/infra/go';

export const goLinks: GoLinks = {};

/**
 * Hosts an external target may point at: the sponsor's or partner's registered domains (D-031). A subdomain of a listed host is allowed
 * too. Empty until the owner supplies a sponsor; while it is empty every external link is refused.
 */
export const goAllowedHosts: readonly string[] = [];
