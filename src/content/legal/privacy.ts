// Privacy Policy (DRAFT for a lawyer, OT-15). Not legal advice. Sources: spec 15.4, 15.7, 15.8; D-012, D-014, D-015, D-016,
// D-028, D-029, D-037; VF-E1, VF-E2, VF-E5 to VF-E8, VF-E10, VF-E17, VF-C8, VF-B6, VF-F2. Every duration written here is listed
// with its source in tests/legal/numbers.test.ts.
//
// RULE (review finding C-11): this page says only what is TRUE at the first public launch (G1). Wording about a feature that
// does not exist yet, or a practice the owner has not confirmed, lives in `privacyFuture` below and reaches the page only
// when its flag in status.ts is switched on. tests/legal/features.test.ts guards this.
import { legalFacts, type LegalFacts } from './facts';
import { LINKS } from './meta';
import { field, grievance, ifOn, link, p, section, strong, table, todo, ul, type Inline, type LegalDoc, type LegalSection } from './model';
import { features, type LegalFeatures } from './status';

// --------------------------------------------------------------------------------------------------------------------
// FUTURE WORDING. NOT rendered until the flag named in each key is true (src/content/legal/status.ts).
// --------------------------------------------------------------------------------------------------------------------
export const privacyFuture = {
  /** M2c. Player, match and tournament pages; D-012 is still a PROPOSED decision, so the owner approves this wording first. */
  archivePages: {
    whoWeAre: ' It also has an archive of those videos, with player, match and tournament pages.',
    summary: 'Players who might be under 18 get extra protection. ',
    childrenHeading: 'Children and protected players',
    protectedPlayers: [
      p(
        'Many players in badminton tournaments are children, and a video title usually does not tell us a player\'s age. So, on this website, we treat every player as "protected" unless an adult\'s age has been confirmed. For a protected player we:',
      ),
      ul(
        ['do not create a profile page;'],
        ['show the name only as plain text where it already appears in a video title or in match details;'],
        ['ask search engines not to index the page, and keep the name out of our site search, lists, sitemaps and the pages of other players;'],
        ['show no sponsor banner, no click or view tracking, no "follow" button and no ready-made share message that names them;'],
        ['show a neutral court picture instead of the video thumbnail.'],
      ),
      p(
        'Where there is a clear sign that a player is under 18, we may hide the page until a parent or guardian agrees to it being shown.',
      ),
    ],
    reviewing:
      ' We are also reviewing how the law applies to older videos and match details that may involve players under 18, and we will change what we do if we need to.',
    matchDetails:
      'The player, tournament, category and round details on our pages are our own records. We make them by reading video titles, and we label them "Match details by Power Smash". A video\'s title is always shown exactly as it appears on YouTube.',
  },

  /** M2a. The site calls the YouTube API (Developer Policies III.A.1 and III.A.2: the privacy policy must say so and link both policies). */
  youtubeApiData: {
    providerPart: 'Supply public information about our channel through YouTube API Services.',
    section: section('youtube-api', 'YouTube API Services', [
      p(
        'This website uses YouTube API Services to get public information about videos on the Power Smash YouTube channel, such as the title, thumbnail, length, publish date, whether a video can be embedded, whether it is live, and the view count.',
      ),
      p(
        'By using the parts of this website that show YouTube videos or YouTube information, you agree to be bound by the ',
        link(LINKS.youtubeTerms, 'YouTube Terms of Service'),
        '. The ',
        link(LINKS.googlePrivacy, 'Google Privacy Policy'),
        ' applies to what Google collects.',
      ),
      p('We do not ask you to sign in with Google or connect a Google account, and we do not use YouTube API Services to collect information about you.'),
      p(
        'We keep the video information we get from YouTube together with the time we fetched it. We refresh it regularly. If we cannot refresh a value, for example because a video was deleted, made private or can no longer be embedded, we delete it, within the limits that YouTube\'s developer policies set.',
      ),
    ]),
    viewCounts: 'View counts are shown as YouTube reports them.',
  },

  /** M2c. Click-to-load player and thumbnails (D-028 video facade notice; D-016 item 8 wants a browser test before any cookie claim). */
  youtubeEmbeds: {
    providerPart: 'Play our videos and supply video thumbnails.',
    cookiesBullet: [
      strong('YouTube. '),
      "A video loads from YouTube only after you tap to play, and the page tells you so first. Video thumbnails come from YouTube's image servers, so your device contacts Google when they load. When you play a video, YouTube and Google may collect information and may use cookies or similar technology, as the ",
      link(LINKS.googlePrivacy, 'Google Privacy Policy'),
      ' explains. We do not control that.',
    ] as Inline[],
  },

  /** M2d. A one-time code (or similar) to check who is making a request. */
  requestVerification: {
    collectRow: ' (for example, a one-time code sent to your phone)',
    rightsParagraph: 'for example with a one-time code sent to the phone number or email address you used',
  },

  /** M2d. Age proof (D-015, still PROPOSED: owner approval first). */
  ageProofChecks: {
    collectRow: ' If age matters, we may ask to see age proof. We view it privately and then delete it.',
    retentionRow: ['Age or identity proof', 'Viewed privately and deleted straight after the check.'] as const,
  },

  /** M3. Email alerts sign-up. */
  emailAlerts: {
    collectRow: [
      'Sign up for email alerts',
      'Your email address, the time you signed up and the version of the notice you saw.',
      'To send you the alerts you chose, and to show that you chose them. You can unsubscribe at any time with the link in every email.',
    ] as const,
    retentionRow: ['Email alerts list', todo('how long we keep an email address after you unsubscribe (D-026)')] as const,
    adultsOnly: ' Any alerts sign-up will ask you to confirm that you are 18 or older.',
  },

  /** M3. "Send your match video" form. */
  videoSubmissions: {
    collectRow: [
      'Send us a video',
      'The details on the form: your name, phone and email, a link to the video, the event it shows, and your confirmations about rights, the licence and removal.',
      'To check, publish and credit the video.',
    ] as const,
    retentionRow: ['Videos and forms people send us', todo('how long we keep a submitted video and its form if we do not publish it')] as const,
  },

  /** M3. Sponsor and partner links that go through the counting /go link. */
  sponsorLinkTracking: {
    visitRow: ' and on sponsor or partner links',
  },

  /** M3. The site stores payment records from the payment provider. */
  paymentRecords: {
    retentionRow: ['Payment records from the payment provider', 'Contact details in them are redacted after 90 days.'] as const,
  },

  /** Later (P3). Spec 15.4: event documents deleted 30 days after the event. Open question for the lawyer: this must not cover permission letters we need as proof of rights (D-019). */
  eventDocuments: {
    retentionRow: ['Documents for an event', 'Event documents are deleted 30 days after the event.'] as const,
  },

  /** M2d or later. The erasure log of D-028 exists and is applied after a restore. */
  erasureLog: {
    backupSentence: ' We keep an erasure log, so an erased record is removed again if a backup is ever restored.',
  },

  /** The owner confirms an encrypted off-GitHub copy of the backups and its retention (D-011). */
  offsiteBackupCopy: {
    providerRow: ['GitHub and a private cloud-storage account', 'Hold our website code and our encrypted database backups.', 'Chosen by the provider.'] as const,
    retentionRow: ['Encrypted backup copy in the cloud-storage account', todo('how long the encrypted backup copy in the cloud-storage account is kept (D-011)')] as const,
  },

  /** R-TELEGRAM-PHONE. Only after the owner and the lawyer agree AND the Worker variable TELEGRAM_ALERT_PHONE_LINK is "true". */
  telegramPhoneLink: {
    alertSentence:
      'An alert carries the kind of enquiry, a reference code, a first name or initial, the page you used, the district you gave, and a reply link that contains the phone number you gave us. It does not carry your email address or the text you typed.',
  },

  /** Page-view statistics: only in a build that carries the Cloudflare Web Analytics beacon. */
  cloudflareWebAnalytics: {
    providerPart: ' It also provides page-view statistics that do not use cookies.',
    visitRow: ' Page-view statistics that do not use cookies.',
    why: 'see, in totals, which pages, buttons and forms people use;',
    cookiesBullet: [
      strong('Page views. '),
      'We count page views with Cloudflare Web Analytics. Cloudflare says it does not use cookies or local storage for this and does not fingerprint your device.',
    ] as Inline[],
  },
} as const;

const region = (value: string | null): string => (value && value.trim() !== '' ? `${value.trim()} (the region we selected).` : 'Chosen when we set up the account.');

export function buildPrivacyDoc(f: LegalFeatures = features, facts: LegalFacts = legalFacts): LegalDoc {
  const fut = privacyFuture;
  const youtubeAny = f.youtubeApiData || f.youtubeEmbeds;

  const collectTable = table(
    'Personal information we collect',
    ['When you', 'What we collect', 'Why'],
    [
      [
        'Send an enquiry (book coverage, partner with us, ask about player products, contact us)',
        'Your name, organisation, phone or WhatsApp number, email address, the details you type about your event or enquiry, any budget range, a reference code we give you, the page you sent it from and any campaign tag in the link, and the time. We also record which version of the notice you saw. To stop spam and repeat submissions we keep a scrambled code (a hash) made from your internet connection address. We do not store the address itself.',
        'To reply, prepare a quote, arrange the service, tell the owner that a new enquiry has arrived, and keep a record of the enquiry.',
      ],
      [
        'List a tournament',
        'The tournament details, the organiser or association, a contact person with phone and, if you give it, email, the venue, dates and categories, a registration link, and a link to a poster if you add one. The contact is shown publicly only if you tick the box that says so.',
        'To check, publish and update the listing.',
      ],
      [
        'Message us on WhatsApp or by email',
        'Your number or email address, your name if it shows, and what you write.',
        'To reply and keep a record of the conversation.',
      ],
      [
        'Pay us',
        "We never see or store your card or UPI details. You pay on the payment provider's own page, or in another way named in our quote. We receive the payment status, amount, date and reference, and the contact details the provider passes to us. If you pay in another way, such as a bank transfer, we see the details that your bank passes on.",
        'To confirm your payment and keep our accounts.',
      ],
      [
        'Ask us to hide, remove or correct something',
        `Your name, how to reach you, which page or video it is about, your reason, and how we checked it is you${f.requestVerification ? fut.requestVerification.collectRow : ''}.${f.ageProofChecks ? fut.ageProofChecks.collectRow : ''}`,
        'To deal with your request.',
      ],
      [
        'Visit this website',
        `Basic technical information handled by our hosting provider (such as your IP address, browser type, the page requested and the time).${f.cloudflareWebAnalytics ? fut.cloudflareWebAnalytics.visitRow : ''} We record taps on our WhatsApp buttons${f.sponsorLinkTracking ? fut.sponsorLinkTracking.visitRow : ''}, and when a form is started or sent (which button, link or form, the page and the time), without your name or number. A scrambled code that changes every day lets us count visitors without knowing who they are.`,
        'To keep the site secure, fix faults and see which pages, buttons and forms are useful.',
      ],
      ...ifOn(f.emailAlerts, [...fut.emailAlerts.collectRow]),
      ...ifOn(f.videoSubmissions, [...fut.videoSubmissions.collectRow]),
    ],
  );

  const providers = table(
    'Service providers that handle personal information for us',
    ['Service provider', 'What it does for us', 'Where'],
    [
      [
        'Vercel',
        'Hosts and delivers this website, and runs the code that receives what you send through our forms.',
        'A worldwide network delivers the pages. The code that handles forms and enquiries runs in one region that we set in our account.',
      ],
      [
        'Cloudflare',
        `Runs the spam check (Turnstile) on forms.${f.cloudflareWebAnalytics ? fut.cloudflareWebAnalytics.providerPart : ''}`,
        'A worldwide network. We do not choose the location.',
      ],
      ['Supabase', 'Stores our database of enquiries and tournament submissions.', region(facts.supabaseRegion)],
      [
        'Telegram',
        `Sends instant alerts about new enquiries to the owner's private chat. ${
          f.telegramPhoneLink
            ? fut.telegramPhoneLink.alertSentence
            : 'An alert carries the kind of enquiry, a reference code, a first name or initial and the page you used. It does not carry your phone number, email address or the text you typed.'
        }`,
        'Chosen by Telegram.',
      ],
      [
        'Resend',
        'Sends automatic emails from this website, such as a confirmation that we received your enquiry, once email sending is switched on.',
        region(facts.resendRegion),
      ],
      ['Razorpay', 'Takes online payments on its own page and tells us the payment status.', 'Chosen by Razorpay.'],
      ...ifOn(youtubeAny, [
        'YouTube and Google',
        [f.youtubeEmbeds ? fut.youtubeEmbeds.providerPart : '', f.youtubeApiData ? fut.youtubeApiData.providerPart : ''].filter(Boolean).join(' '),
        'Chosen by Google.',
      ]),
      f.offsiteBackupCopy
        ? [...fut.offsiteBackupCopy.providerRow]
        : ['GitHub', 'Holds our website code and our encrypted database backups.', 'Chosen by GitHub.'],
    ],
  );

  const retention = table(
    'How long we keep personal information',
    ['Information', 'How long'],
    [
      ['Enquiries and tournament submissions', 'Until the enquiry is closed, and then for 24 months. After that we anonymise the record so that it no longer identifies you.'],
      ['Accounting and tax records', 'For as long as tax and accounting law requires.'],
      ['Published tournament listings', 'Until the listing is removed. You can ask us at any time to remove it or to hide the contact.'],
      ['Requests to hide, remove or correct something', 'Until the request is resolved and for 12 months after that. Then we redact the personal details.'],
      ...ifOn(f.eventDocuments, [...fut.eventDocuments.retentionRow]),
      ...ifOn(f.ageProofChecks, [...fut.ageProofChecks.retentionRow]),
      ['Records of taps on buttons and links, and of forms started or sent', 'For up to 90 days. After that only daily totals remain.'],
      ...ifOn(f.paymentRecords, [...fut.paymentRecords.retentionRow]),
      ['Security and access logs', 'Kept by our hosting and database providers for the period their service sets, and then deleted by them.'],
      ...ifOn(f.emailAlerts, [...fut.emailAlerts.retentionRow]),
      ...ifOn(f.videoSubmissions, [...fut.videoSubmissions.retentionRow]),
      [
        'Encrypted backups',
        `For about two months, and then they are deleted automatically. A record you ask us to erase can stay in a backup until that backup expires.${f.erasureLog ? fut.erasureLog.backupSentence : ''}`,
      ],
      ...ifOn(f.offsiteBackupCopy, [...fut.offsiteBackupCopy.retentionRow]),
    ],
  );

  const sections: LegalSection[] = [
    section('who-we-are', 'Who we are', [
      p(
        `Power Smash is a Tamil Nadu badminton media brand. We publish match videos on our YouTube channel and run this website, which lists our services, such as tournament coverage, sponsorship and player products, and Tamil Nadu badminton tournaments.${f.archivePages ? fut.archivePages.whoWeAre : ''}`,
      ),
      p('This website is run by ', field('legalName', 'legal name of the business (OT-19)'), ', ', field('postalAddress', 'postal address to publish (OT-19)'), '. In this policy, "we" means that business.'),
      p(
        'This policy covers this website and the enquiries, messages and requests that come through it. It does not cover YouTube, WhatsApp, Instagram or Facebook. Those services have their own policies.',
      ),
    ]),

    section('what-we-collect', 'What we collect', [
      p('We collect only what each form or request needs. This table shows what we collect, and why.'),
      collectTable,
      p('We do not ask for sensitive information such as passwords, health details or card numbers. Please do not type them into any message box.'),
    ]),

    section('why-we-use-it', 'Why we use your information', [
      p('We use your information to:'),
      ul(
        ['reply to your enquiry and arrange the service you ask about;'],
        ['send you quotes, payment links, receipts and confirmations;'],
        ['keep accounts and meet our tax and legal duties;'],
        ['publish a tournament listing that you asked us to publish, and show its contact only if you ticked the public-contact box;'],
        ['protect the website from spam and abuse, and fix faults;'],
        [f.cloudflareWebAnalytics ? fut.cloudflareWebAnalytics.why : 'see, in totals, which buttons and forms people use;'],
        ['deal with requests to hide, remove or correct something, and with complaints;'],
        ['follow the law, and orders from courts or authorities.'],
      ),
      p(
        'We do not use your enquiry details for marketing. If we ever want to send you updates, we will ask you separately, with a box that you tick yourself.',
      ),
      p(
        'Under Indian law we rely mainly on your consent (for example, the notice and tick-boxes on our forms). Where the law allows, we also rely on other lawful grounds, such as dealing with a request you made yourself or meeting a legal duty. You can withdraw your consent at any time.',
      ),
    ]),

    section('who-we-share-with', 'Who we share it with', [
      p(
        'We do not sell your information and we do not share it with advertisers. We share it only with the service providers that help us run the website and the business, and only for that purpose.',
      ),
      providers,
      p('Some of these providers handle information outside India.'),
      p(
        'If a tournament listing says its contact may be shown publicly, anyone who visits the page can see it. We never show a contact publicly unless you tick that box.',
      ),
      p('We may also disclose information if the law, a court or a government authority requires it, or to protect someone\'s safety.'),
    ]),

    section('how-long-we-keep-it', 'How long we keep it', [retention]),

    section('your-rights', 'Your rights and choices', [
      p('You can ask us to:'),
      ul(
        ['tell you what personal information we hold about you;'],
        ['correct it if it is wrong or out of date;'],
        ['delete it;'],
        ['stop using it, by withdrawing a consent you gave. Withdrawing is as easy as giving it: write to us and we will stop, except where the law requires us to keep something, such as accounting records;'],
        ['look into a complaint (see "Questions and complaints" below).'],
      ),
      p(
        'To use a right, write to us using the details below, or ',
        link('/request', 'use the request form'),
        `. We may ask you to show it is you, ${
          f.requestVerification ? fut.requestVerification.rightsParagraph : 'for example by replying to a message that we send to the phone number or email address you used'
        }. This is so that we never give your information to the wrong person.`,
      ),
      p(
        'We acknowledge your request within 48 hours and aim to resolve it within one month. If it is complicated, we will tell you why and when you will get an answer. It will never take longer than 90 days.',
      ),
      p(
        'Some duties under India\'s Digital Personal Data Protection Act, 2023 start to apply from about 13 May 2027. We have tried to design our forms around its principles already.',
      ),
    ]),

    section(
      'children',
      f.archivePages ? fut.archivePages.childrenHeading : 'Children',
      [
        p(
          `Our forms and services are for adults: organisers, businesses, coaches, parents, and players aged 18 or over. If you are under 18, please ask a parent or guardian to contact us for you. We do not market to anyone under 18.${f.emailAlerts ? fut.emailAlerts.adultsOnly : ''}`,
        ),
        ...ifOn(f.archivePages, ...fut.archivePages.protectedPlayers),
        p(
          'A parent or guardian can ask us at any time to hide a child\'s name or to remove a video, a page or a listing. See our ',
          link('/content-removal', 'Content Removal and Takedown Policy'),
          '. We aim to act within 48 hours.',
        ),
        p(
          `We cannot recall copies that already exist on YouTube, in search-engine caches, in messaging apps or on other websites.${f.archivePages ? fut.archivePages.reviewing : ''}`,
        ),
      ],
    ),

    section('cookies', 'Cookies and similar technology', [
      ul(
        [strong('No advertising or tracking cookies. '), 'We do not use Google Analytics or a Meta (Facebook) pixel.'],
        ...ifOn(f.cloudflareWebAnalytics, fut.cloudflareWebAnalytics.cookiesBullet),
        [strong('Your browser. '), 'Our own pages do not store cookies or other data in your browser.'],
        [
          strong('Spam check. '),
          'When you start a form, Cloudflare Turnstile runs to tell people from automated programs. Cloudflare provides it, and its ',
          link(LINKS.cloudflarePrivacy, 'privacy policy'),
          ' explains what it collects.',
        ],
        ...ifOn(f.youtubeEmbeds, fut.youtubeEmbeds.cookiesBullet),
        [
          strong('Other websites. '),
          'When you tap a link to YouTube, Instagram, Facebook or WhatsApp, you leave this website. That service\'s own policy then applies, and it may use cookies.',
        ],
        [
          strong('No third-party ads. '),
          'We do not let other companies show advertisements on this website. Sponsor and partner logos and banners are images that we place ourselves, and we label them clearly.',
        ],
      ),
    ]),

    ...ifOn(f.youtubeApiData, {
      ...fut.youtubeApiData.section,
      blocks: [
        ...fut.youtubeApiData.section.blocks,
        ...ifOn(f.archivePages, p(`${fut.archivePages.matchDetails} ${fut.youtubeApiData.viewCounts}`)),
      ],
    } satisfies LegalSection),

    section('security', 'Keeping your information safe', [
      p(
        'We limit who can see personal information, and we use encryption when information travels to our site and for our backups. No online service is completely secure. If a breach affects your personal information, we will tell you without delay and report it to the authorities as the law requires.',
      ),
    ]),

    section('changes', 'Changes to this policy', [
      p(
        'When we change this policy we change the "last updated" date at the top, and for a big change we say so on this page. The notices on our forms have version numbers, so we can show which wording you saw when you used a form.',
      ),
    ]),

    section('questions-and-complaints', 'Questions and complaints', [
      p('For any privacy question, request or complaint, write to our grievance officer:'),
      grievance(),
      p(
        'We acknowledge a complaint within 48 hours, send you a copy of it as we record it, and aim to resolve it within one month. For how we handle removal requests, see our ',
        link('/content-removal', 'Content Removal and Takedown Policy'),
        '.',
      ),
    ]),
  ];

  return {
    key: 'privacy',
    path: '/privacy',
    title: 'Privacy Policy',
    description:
      'What personal information Power Smash collects, why, who helps us handle it, how long we keep it, and how to use your rights.',
    summary: [
      'We ask only for what we need to reply to you and run our services. We do not sell your information and we do not use advertising cookies. ',
      ...ifOn(f.archivePages, fut.archivePages.summary),
      'You can ask us to correct or delete your information at any time.',
    ],
    sections,
  };
}

export const privacyDoc: LegalDoc = buildPrivacyDoc();
