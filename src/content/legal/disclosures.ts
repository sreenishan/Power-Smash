// Disclosures: sponsorship, affiliate links, paid promotion in videos and live streams, our own match details, and how we show
// prices (DRAFT for a lawyer, OT-15). Not legal advice. Sources: spec 8.3, 15.5; D-016 (item 3: the "by Power Smash" sentence),
// D-037; VF-E11, VF-E12, VF-E13, VF-E14.
//
// What we promise about videos and live streams is only what spec 15.5 records as the owner's practice (disclose inside the video,
// out loud and on screen, also in live streams; tick YouTube's paid-promotion setting). The ASCI label-length rules are NOT
// presented as our own practice any more (review finding C-11): the page points to the ASCI guidelines instead.
//
// RULE (review finding C-11): only what is TRUE at the first public launch (G1) is written in `buildDisclosuresDoc`. Wording about
// something that does not exist yet (banners beside a player, the counting /go link, player pages) or a practice the owner has not
// confirmed (the health-claims rule) lives in `disclosuresFuture` and reaches the page only when its flag in status.ts is on.
import { LINKS } from './meta';
import { fact, grievance, ifOn, link, p, section, ul, type LegalDoc, type LegalSection } from './model';
import { features, type LegalFeatures } from './status';

// --------------------------------------------------------------------------------------------------------------------
// FUTURE WORDING. NOT rendered until the flag named in each key is true (src/content/legal/status.ts).
// --------------------------------------------------------------------------------------------------------------------
export const disclosuresFuture = {
  /** M2c or M3. Banners beside the video player (D-016 item 6). */
  sponsorBanners: {
    bullet: 'Banners sit beside the video player. They are never placed over or inside the player.',
  },
  /** M3. Sponsor and partner links routed through the counting /go link. */
  sponsorLinkTracking: {
    bullet: "A click on a sponsor or partner link goes through a Power Smash link that counts the click and then sends you on to the sponsor's website.",
  },
  /** M2c. Archive pages and protected players (D-012 is still PROPOSED). */
  archivePages: {
    protectedBullet: 'We do not show sponsor banners on the pages of players who are protected (see our Privacy Policy).',
    section: section('match-details', 'Match details by Power Smash', [
      p(
        'On our pages, the player, tournament, category and round details are our own records, made by reading video titles. We label them "Match details by Power Smash". A video\'s title is always shown exactly as it is on YouTube.',
      ),
    ]),
  },
  /** M2a. YouTube API data is shown, so view counts appear. */
  youtubeApiData: {
    viewCounts: 'View counts are labelled "YouTube views" and shown as YouTube reports them.',
  },
  /** The owner confirms this rule as his own practice. */
  healthClaimsRule: {
    section: section('health-claims', 'Health, injury and supplement claims', [
      p(
        'We do not make health, injury-recovery or supplement claims unless the person speaking has the right qualifications and says so up front.',
      ),
    ]),
  },
} as const;

export function buildDisclosuresDoc(f: LegalFeatures = features): LegalDoc {
  const fut = disclosuresFuture;
  const sections: LegalSection[] = [
    section('sponsored-placements', 'Sponsored and partner placements on this website', [
      ul(
        ['Every paid placement is labelled clearly, for example "Sponsored" or "Partners".'],
        ['Sponsor and partner logos and banners are images that we place ourselves. Other companies cannot show advertisements on this website, and we do not use pop-ups.'],
        ...ifOn(f.sponsorBanners, [fut.sponsorBanners.bullet]),
        ...ifOn(f.sponsorLinkTracking, [fut.sponsorLinkTracking.bullet]),
        ...ifOn(f.archivePages, [fut.archivePages.protectedBullet]),
      ),
    ]),

    section('affiliate-links', 'Affiliate links', [
      p(
        'Some pages may include affiliate links. Where they do, we label them "Affiliate link" next to the link and say that we may earn a commission if you buy through it.',
      ),
    ]),

    section('videos-and-live-streams', 'Paid promotions in our videos and live streams', [
      p(
        'When we have a paid or other material connection with a brand, we say so in the video or live stream itself, out loud and on screen. We also use YouTube\'s "Includes paid promotion" setting where it applies. We do not rely only on our channel description, the end of a video, text behind a "more" link or hashtags.',
      ),
      p(
        'We aim to follow the influencer guidelines of the Advertising Standards Council of India (ASCI) and the Department of Consumer Affairs\' guidance on endorsements. These set rules for the wording of a label and for how long it must stay on screen. You can read the guidelines on ',
        link(LINKS.asciGuidelines, "ASCI's website"),
        '.',
      ),
    ]),

    ...ifOn(f.healthClaimsRule, fut.healthClaimsRule.section),

    ...ifOn(
      f.archivePages,
      f.youtubeApiData
        ? { ...fut.archivePages.section, blocks: [...fut.archivePages.section.blocks, p(fut.youtubeApiData.viewCounts)] }
        : fut.archivePages.section,
    ),

    section('prices-and-offers', 'How we show prices and offers', [
      ul(
        ['We show the total price, with every charge, before you pay.'],
        ['We do not use countdown timers or pre-ticked boxes, and we do not add hidden fees.'],
        ['We do not start a membership that renews by itself without a clear way to cancel.'],
        ['If we show a reduced price, we also show the lowest price of the previous 30 days.'],
      ),
    ]),

    section(
      'self-audit',
      'Our self-audit',
      [p('We last checked this website for misleading design practices on ', fact('darkPatternSelfAuditDate'), '.')],
      { showWhen: 'darkPatternSelfAuditDate' },
    ),

    section('tell-us', 'Tell us if something looks wrong', [
      p('If an advertisement, label or price on this website looks wrong or unclear, please tell us. You can use the details below.'),
      grievance(),
    ]),
  ];

  return {
    key: 'disclosures',
    path: '/disclosures',
    title: 'Disclosures',
    description: 'How Power Smash labels sponsors, partners, affiliate links and paid promotions, and how we show prices.',
    summary: [
      'When money, a free product or a business relationship is involved, we say so clearly. This page explains how we label sponsors, partners and paid promotions, in our videos and on this website.',
    ],
    sections,
  };
}

export const disclosuresDoc: LegalDoc = buildDisclosuresDoc();
