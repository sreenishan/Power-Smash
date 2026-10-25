// Owner-supplied site facts: the single source of truth for contact details, links and brand copy (D-034).
// RULE: a value the owner has not supplied is `null`. Never invent one. A section that needs a missing value is hidden with
// <OwnerSection when={...}>; a value that cannot be hidden (the page is not honest without it) is shown with <Todo what="...">
// in dev builds and FAILS the strict release gate (scripts/check-placeholders.ts) until it is supplied.
// The Site-shell worker owns this file and may extend it (keep the nullable-by-default rule).
import { env } from '../config/env';

/** One owner-worded audience figure: a label (a city, an age group, a gender) and its share exactly as YouTube Studio shows it. The share is text so no number is ever computed or invented here. */
export interface AudienceShare {
  readonly label: string;
  readonly share: string;
}

export const site = {
  name: 'Power Smash',
  /** Owner choice from the three options in spec 5.1 (OT-23). null = not chosen yet: show no tagline. */
  tagline: null as string | null,

  // --- Legal entity and contact (OT-19). Needed on /contact and the legal pages; G1 requires them. ---
  /** Owner input 2026-10-25 (OT-19). May change after the CA decides the entity (OT-05). */
  legalName: 'Power Smash' as string | null,
  /** Still missing: the owner gave only "Tamil Nadu", which is not a postal address. Stays hidden until a full address is supplied. */
  postalAddress: null as string | null,
  /** Owner input 2026-10-25 (OT-19): the business number, public by design (spec 13.2). */
  phone: '+91 73733 51087' as string | null,
  /**
   * Owner input 2026-10-25 (OT-19): the business Gmail of the channel (the address the spec publishes, 13.2), as the interim
   * public address. D-022 replaces it with the domain address (hello@...) once the domain is verified. Never the personal Gmail.
   */
  publicEmail: 'powersmash1102@gmail.com' as string | null,
  grievanceOfficerName: null as string | null,
  grievanceOfficerPhone: null as string | null, // OT-19; legal pages fall back to `phone` when null
  grievanceEmail: null as string | null,
  /** Opening/reply hours shown on /contact, e.g. as the owner words them. null = the line is hidden. */
  contactHours: null as string | null,
  /**
   * A reply-time promise the owner is willing to keep, e.g. "24 hours" (OT-30 asks). null = the confirmation screen
   * promises nothing ("We will get back to you as soon as we can."). Never guessed.
   */
  replyTimePromise: null as string | null,
  /** Public path of an owner-supplied media-kit PDF placed under public/, e.g. "/media-kit.pdf" (OT-12/OT-22). null = no download button. */
  mediaKitPdfPath: null as string | null,

  // --- WhatsApp ---
  /** Digits with country code, from the PUBLIC_WHATSAPP_NUMBER build variable. null hides every WhatsApp button. */
  whatsappNumber: env.whatsappNumber,
  /** WhatsApp Channel link (OT-09). null hides the Channel button everywhere. */
  whatsappChannelUrl: null as string | null,

  // --- Public links the spec itself publishes (spec 13.2, owner-provided) ---
  youtubeUrl: 'https://www.youtube.com/@PowerSmash',
  youtubeJoinUrl: 'https://www.youtube.com/channel/UCRhIwO47uhJIM5Iw4uybcFQ/join',
  instagramUrl: 'https://www.instagram.com/power_smash_youtube/',
  facebookUrl: 'https://www.facebook.com/Power-Smash-Tamil-Nadu-badminton-players-1877488702345552/',

  // --- Channel figures: OWNER-STATED, rounded, and dated (spec section 1; confirmed on the public channel page, VF-C14). ---
  // These are NOT API data and never come from a live call. They are shown as "about 88K subscribers, 1.9K videos, as of
  // October 2026". Update `asOf` whenever the owner re-states them (OT-12 gives dated Studio figures); after M2 the Home
  // counters switch to the synced numbers (D-016 item 5: nothing stored from the API for more than 30 days).
  channel: {
    subscribers: '88K',
    videos: '1.9K',
    /** The as-of wording shown to visitors. */
    asOf: 'October 2026',
    /**
     * The same moment as an ISO date (YYYY-MM-DD), for the release check (D-016 item 5, review C-17): the day the figures were
     * confirmed on the public channel page (VF-C14, 2026-10-20). Update it together with `asOf` whenever the owner re-states them.
     */
    asOfDate: '2026-10-20',
  },

  // --- Audience figures for /partner (OT-12, G1 input): the owner's dated YouTube Studio numbers (review C-8). ---
  // Every field is null or empty until the owner supplies it; <AudienceFigures /> (src/components/site/AudienceFigures.astro)
  // shows a <Todo> until then and the dated figures afterwards. Shares are the owner's own wording: nothing is computed
  // or invented here. Figures are NEVER shown without `asOf`.
  audience: {
    /** Wording for the month or date the figures were read from YouTube Studio (the owner words it). */
    asOf: null as string | null,
    /** The same date as ISO (YYYY-MM-DD) so the release check can warn when the figures age. */
    asOfDate: null as string | null,
    /** Monthly views, exactly as the owner words it from YouTube Studio. */
    monthlyViews: null as string | null,
    topLocations: [] as readonly AudienceShare[],
    ageGroups: [] as readonly AudienceShare[],
    genderSplit: [] as readonly AudienceShare[],
    /** Average view duration, exactly as the owner words it from YouTube Studio. */
    avgViewDuration: null as string | null,
  },

  // --- Pricing page copy the owner supplies (OT-20). null = not supplied: /pricing shows a Todo. ---
  /** Plain-English GST note for /pricing, e.g. whether prices include GST. Never guessed (D-021: CA to confirm). */
  gstNote: null as string | null,
  /**
   * How and when payment details are sent to a customer, in the owner's words (OT-20). null = the /pricing line is hidden:
   * the plan (D-020, Appendix D) does not say that payment details travel WITH the quote, so the site does not promise it.
   */
  paymentNote: null as string | null,

  // --- About page (spec 7.15): all owner-supplied. null = the section is hidden. ---
  about: {
    story: null as string | null,
    mission: null as string | null,
    /** People the owner wants named on the page. Empty = hidden. */
    team: [] as readonly { readonly name: string; readonly role: string }[],
    /** Districts covered, as the owner lists them. Empty = hidden. */
    districts: [] as readonly string[],
  },
} as const satisfies Record<string, unknown>;

export type Site = typeof site;
