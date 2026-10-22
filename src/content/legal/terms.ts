// Terms of Use (DRAFT for a lawyer, OT-15). Not legal advice. Sources: spec 15.1, 15.5, 15.6; VF-C8 (YouTube API Developer
// Policies III.A.1: the terms must say users agree to be bound by the YouTube Terms of Service); D-016, D-019, D-020, D-037.
// No price, fee, refund rule or timeline is written here: those live on /pricing and in the Cancellation and Refund Policy.
// This page promises NO reply time for enquiries (R-ACK-PROMISE, findings B-9 and C-7): only the owner's `replyTimePromise` in
// src/content/site.ts may do that, and it is shown on the confirmation screen, not here.
//
// RULE (review finding C-11): only what is TRUE at the first public launch (G1) is written in `buildTermsDoc`. Wording about a
// feature that does not exist yet, or a practice the owner has not confirmed, lives in `termsFuture` and reaches the page only
// when its flag in status.ts is switched on (tests/legal/features.test.ts).
import { LINKS } from './meta';
import { field, grievance, ifOn, link, p, section, strong, todo, ul, type LegalDoc, type LegalSection } from './model';
import { features, type LegalFeatures } from './status';

// --------------------------------------------------------------------------------------------------------------------
// FUTURE WORDING. NOT rendered until the flag named in each key is true (src/content/legal/status.ts).
// --------------------------------------------------------------------------------------------------------------------
export const termsFuture = {
  /** M2c. The click-to-load YouTube player. */
  youtubeEmbeds: {
    videosSentence: "Our videos are on YouTube and are shown on this website through YouTube's player.",
  },
  /** M2c. Archive pages with our own parsed records. */
  archivePages: {
    detailsSentence:
      ' The player, tournament, category and round details next to a video are our own records, made by reading the video title and labelled "Match details by Power Smash". They can contain mistakes.',
  },
  /** M2a (and also shown by `youtubeEmbeds`). Developer Policies III.A.1: the terms say users agree to be bound by the YouTube Terms of Service. */
  youtubeApiData: {
    section: section('youtube', 'YouTube', [
      p(
        'Parts of this website show YouTube videos and information supplied through YouTube API Services. By using those parts of the website, you agree to be bound by the ',
        link(LINKS.youtubeTerms, 'YouTube Terms of Service'),
        '.',
      ),
    ]),
  },
  /** D-019 approved and in daily use. */
  coverageAgreementRequired: {
    sentence: ' We do not start paid coverage without that agreement.',
  },
  /** M3. The "send your video" form. */
  videoSubmissions: {
    section: section('your-material', 'Videos and other material you send us', [
      p(
        'When the "send your video" form is available, you must have the right to share the material you send. It must not be broadcast or third-party footage, and it must not use copyrighted music. You must tell us if players under 18 can be recognised in it.',
      ),
      p(
        'The licence you give us, and how you can ask us to remove the material, are shown with the form when you send it. We may refuse any material, and sending it does not mean we will publish it.',
      ),
    ]),
  },
} as const;

export function buildTermsDoc(f: LegalFeatures = features): LegalDoc {
  const fut = termsFuture;
  const sections: LegalSection[] = [
    section('about', 'About these terms', [
      p(
        'These terms apply when you use this website and when you make an enquiry, booking or request through it. By using the website you agree to them. If you do not agree, please do not use it.',
      ),
      p('The website is run by ', field('legalName', 'legal name of the business (OT-19)'), ' ("we"). Our address and contact details are in the section "Complaints and disputes" below and on our ', link('/contact', 'Contact page'), '.'),
      p(
        'These terms work together with our ',
        link('/privacy', 'Privacy Policy'),
        ', ',
        link('/refunds', 'Cancellation and Refund Policy'),
        ', ',
        link('/delivery', 'Delivery Policy'),
        ', ',
        link('/disclosures', 'Disclosures'),
        ' and ',
        link('/content-removal', 'Content Removal and Takedown Policy'),
        '.',
      ),
    ]),

    section('using-the-site', 'Using the website', [
      p('Please use the website lawfully and fairly. Do not:'),
      ul(
        ['try to break, overload or probe the website or its security;'],
        ['collect other people\'s personal information from it;'],
        ['send false enquiries or spam, or use someone else\'s details without their permission;'],
        ['pretend to be someone else, for example a parent, a player or an organiser.'],
      ),
      p('We may block access or refuse a request if we think the website is being misused.'),
    ]),

    section('what-we-publish', f.archivePages ? 'Videos, match details and tournament information' : 'Videos and tournament information', [
      p(
        `${f.youtubeEmbeds ? fut.youtubeEmbeds.videosSentence : 'Our videos are on our YouTube channel.'}${f.archivePages ? fut.archivePages.detailsSentence : ''} If you see a mistake on this website, tell us and we will correct it.`,
      ),
      p(
        'Tournament listings come from the organisers. Registration is handled by the organiser, not by us. Please check dates, venues, fees and rules with the organiser before you travel or pay.',
      ),
    ]),

    ...ifOn(f.youtubeApiData || f.youtubeEmbeds, fut.youtubeApiData.section),

    section('enquiries-and-bookings', 'Enquiries, quotes and bookings', [
      p(
        'An enquiry is not a booking. A booking exists when we confirm it in writing (a WhatsApp message or an email is fine) and any advance we ask for has been paid.',
      ),
      p(
        'Prices are in Indian rupees. Before you pay, our pricing page or our quote shows the total you will pay, including every charge. Any tax that applies is explained on our pricing page and in the quote or invoice. See our ',
        link('/pricing', 'Pricing page'),
        '.',
      ),
      p(
        `For coverage of a tournament, we ask the organiser or promoting association to agree in writing that we may film and publish, who owns the footage, and how it may be used.${f.coverageAgreementRequired ? fut.coverageAgreementRequired.sentence : ''}`,
      ),
      p(
        'You pay through a payment link from our payment provider, or in another way named in our quote or invoice. We will never ask you to send card numbers or passwords by message.',
      ),
      p('What happens if you cancel is in our ', link('/refunds', 'Cancellation and Refund Policy'), '. How and when we deliver is in our ', link('/delivery', 'Delivery Policy'), '.'),
    ]),

    section('tournament-listings', 'Listing your tournament', [
      p('If you list a tournament, you confirm that you are the organiser or that the organiser has allowed you to list it, and that what you tell us is true and up to date.'),
      p(
        'We check every listing before it appears, and we may change, refuse or remove it. A listing is not an endorsement. We are not a party to any entry or fee between you and the players.',
      ),
      p('We show your contact details publicly only if you tick the box that says so. You can ask us to hide them at any time.'),
    ]),

    ...ifOn(f.videoSubmissions, fut.videoSubmissions.section),

    section('sponsors-and-links', 'Sponsors and links to other websites', [
      p(
        'Paid placements on this website are labelled clearly, for example "Sponsored" or "Partners". See our ',
        link('/disclosures', 'Disclosures'),
        '. We link to other websites for your convenience. We do not control them and are not responsible for what they say or do.',
      ),
    ]),

    section('our-content', 'Our content and brand', [
      p(
        'The Power Smash name, logo, website design and text belong to us or are used with permission. Who owns a video or an image depends on the agreement for that event and on the law. It may be us, the organiser, the person who recorded it, or another rights holder.',
      ),
      p(
        'You may share links to our pages and videos. You may not copy, re-upload or sell our content, or use our name or logo, without our written permission.',
      ),
    ]),

    section('removal-requests', 'Removal and takedown requests', [
      p(
        'If you appear in our content, are the parent or guardian of someone who does, or hold rights in something we show, you can ask us to hide or remove it. See our ',
        link('/content-removal', 'Content Removal and Takedown Policy'),
        '.',
      ),
    ]),

    section('our-responsibility', 'Our responsibility', [
      p(
        'We provide the website and its information "as is". To the extent the law allows, we are not responsible for losses that come from relying on the information on the website, or from things we do not control, such as a fault at YouTube, WhatsApp or our payment provider.',
      ),
      p('Nothing in these terms limits any right you have under consumer law, or any responsibility that the law does not allow us to limit.'),
    ]),

    section('complaints-and-disputes', 'Complaints and disputes', [
      p('If something goes wrong, please write to us first. Our details are:'),
      grievance(),
      p(
        'We acknowledge a complaint within 48 hours, send you a copy of it as we record it, and aim to resolve it within one month. You can also contact the National Consumer Helpline on its toll-free number 1915 or at ',
        link(LINKS.consumerHelpline, 'consumerhelpline.gov.in'),
        '.',
      ),
      p(
        'These terms are governed by the laws of India. The courts at ',
        todo('city whose courts will have jurisdiction over disputes (OT-21 item 3, with the lawyer)'),
        ' can decide any dispute that is not settled, subject to any right you have under consumer law to bring a claim elsewhere.',
      ),
    ]),

    section('changes', 'Changes to these terms', [
      p(
        'We may change these terms. The new version will show a new "last updated" date. ',
        strong('A booking we have confirmed '),
        'continues on the terms that applied when we confirmed it.',
      ),
    ]),
  ];

  return {
    key: 'terms',
    path: '/terms',
    title: 'Terms of Use',
    description: 'The rules for using the Power Smash website and for enquiries, bookings and tournament listings.',
    summary: [
      'These are the rules for using this website and for asking us for services. We have tried to keep them short and plain. Please read them, and our other policies, before you book or pay.',
    ],
    sections,
  };
}

export const termsDoc: LegalDoc = buildTermsDoc();
