// Content Removal and Takedown Policy (DRAFT for a lawyer, OT-15). Not legal advice. Sources: spec 15.3, 15.6; D-012, D-014, D-015,
// D-019; VF-E9 (IT Rules 2026 timelines: third-party summary, medium confidence, so the figures below are written as our
// OPERATING TARGETS, as D-014 adopts them, not as a statement that a rule applies to us); VF-E2 and VF-E5 (children's data).
// What the facts do not support is a <Todo>. Whether Power Smash is an "intermediary" for any feature is a lawyer question.
//
// Hide rule (review finding C-14): the target time for rights disputes is OPTIONAL owner text, not a Todo. It shows only when
// the owner supplies it in facts.ts (rightsDisputeTarget); until then that table row is hidden and the build leaves an invisible
// data-owner-hidden marker.
//
// RULE (review finding C-11): only what is TRUE at the first public launch (G1) is written in `buildContentRemovalDoc`. At G1 the
// website has no player pages and no online request form: requests arrive by WhatsApp, email or phone and the owner acts by hand.
// Wording about the archive, a one-time code, age proof or the removal record lives in `contentRemovalFuture` and reaches the page
// only when its flag in status.ts is on (tests/legal/features.test.ts).
import { fact, grievance, ifOn, link, p, routes, section, table, ul, type LegalDoc, type LegalSection } from './model';
import { features, type LegalFeatures } from './status';

// --------------------------------------------------------------------------------------------------------------------
// FUTURE WORDING. NOT rendered until the flag named in each key is true (src/content/legal/status.ts).
// --------------------------------------------------------------------------------------------------------------------
export const contentRemovalFuture = {
  /** M2c. Player, match and tournament pages and the protected-player default (D-012 is still PROPOSED: owner approval first). */
  archivePages: {
    covers: ' It also explains how to ask us to hide, remove or correct a player page, a match page or the details we publish about a match.',
    protectedSection: section('players-under-18', 'Players under 18 and players whose age we do not know', [
      p(
        'Many of the players in our videos may be children. We treat every player whose adult status we have not confirmed as protected. How we protect them is explained in our ',
        link('/privacy', 'Privacy Policy'),
        '.',
      ),
      p(
        'If a request is about a player under 18, we hide the name or page as soon as we receive it. This can be undone. We then check the request. We aim to finish within 48 hours.',
      ),
    ]),
    keepRecord:
      'To make sure a removed name does not come back when we update the website, we keep a small private record of what was removed. We hold it only for that purpose.',
  },
  /** M2d. A one-time code to check who is making a request. */
  requestVerification: {
    sentence: ' For example, we may send you a one-time code on WhatsApp.',
  },
  /** M2d. Age proof (D-015, still PROPOSED: owner approval first). */
  ageProofChecks: {
    sentence: ' If a decision depends on a child\'s age, we may ask to see age proof. We view it privately and then delete it.',
  },
} as const;

export function buildContentRemovalDoc(f: LegalFeatures = features): LegalDoc {
  const fut = contentRemovalFuture;
  const sections: LegalSection[] = [
    section('what-this-covers', 'What this page covers', [
      p(
        `We publish badminton match videos on our YouTube channel, and this website lists tournaments and takes enquiries. This page explains how to ask us to hide, remove or correct a video, a name, a tournament listing or other information we publish, and what we will do.${f.archivePages ? fut.archivePages.covers : ''}`,
      ),
      p('This website does not let visitors publish comments or upload content for others to see.'),
    ]),

    section('who-can-ask', 'Who can ask', [
      ul(
        ['A player aged 18 or over, about themselves.'],
        ['A parent or guardian of a player under 18.'],
        ['The organiser of a tournament, or a promoting association, who has not agreed to our filming or publishing, or who disagrees with how we use it.'],
        ['Anyone who holds the rights in a video, an image or other material we show.'],
        ['A court or a government authority, with a lawful order or notice.'],
        ['Anyone else with a legal complaint about something on this website.'],
      ),
    ]),

    section('how-to-ask', 'How to ask', [
      p('Contact us in any of these ways:'),
      routes(),
      p('Please tell us:'),
      ul(
        ['the page address or the video title, so we can find it;'],
        ['who you are, and how you are connected to it (for example "I am the player" or "I am the parent");'],
        ['what you want us to do (hide a name, remove a page, remove a video, or correct something);'],
        ['your reason, if you wish to give one. If you hold rights in something, please include proof of that.'],
      ),
      p('Please do not send identity documents unless we ask for them.'),
    ]),

    section('how-we-check', 'How we check it is you', [
      p(
        `We may ask you to show that you control the phone number or email address you contact us from, for example by replying to a message that we send to it.${f.requestVerification ? fut.requestVerification.sentence : ''} For a request about a child, we ask for the parent or guardian's name and a way to reach them.${f.ageProofChecks ? fut.ageProofChecks.sentence : ''}`,
      ),
    ]),

    ...ifOn(f.archivePages, fut.archivePages.protectedSection),

    section('how-fast', 'How fast we aim to act', [
      p('These are our targets. They are not a guarantee, and a legal order can set a different time.'),
      table(
        'Our response targets',
        ['Request', 'What we aim to do'],
        [
          ['Any request', 'Acknowledge within 24 hours, and decide within 7 days.'],
          ['A request about a player under 18', 'Hide first, then verify. Act within 48 hours.'],
          ['A lawful court order or a reasoned government notice', 'Act within 3 hours of receiving it.'],
          [
            'A request where two people disagree about who has the rights, for example an organiser and a person who recorded a video',
            [fact('rightsDisputeTarget')],
          ],
        ],
        { rowShowWhen: [null, null, null, 'rightsDisputeTarget'] },
      ),
    ]),

    section('what-we-can-do', 'What we can and cannot do', [
      p('We can:'),
      ul(
        ['hide or remove a name, a page, a listing or a video from this website;'],
        ['set our own videos on our YouTube channel to private or unlisted, or delete them;'],
        ['ask search engines to remove the address of a page we have removed.'],
      ),
      p('We cannot:'),
      ul(
        ['recall copies that already exist elsewhere, such as in search-engine caches, in messaging apps, on other websites, or on other people\'s YouTube channels;'],
        ['change what other people have published.'],
      ),
      ...ifOn(f.archivePages, p(fut.archivePages.keepRecord)),
    ]),

    section('rights-holders', 'Organisers, associations and rights holders', [
      p(
        'If an organiser or a promoting association objects to our filming or publishing, or a rights holder says we do not have the right to show something, we may hide it while we look into it. We will tell you what we decide and why.',
      ),
    ]),

    section('what-we-keep', 'What we keep about a request', [
      p(
        'We record when we received your request and when we acted on it. We keep the request until it is resolved and for 12 months after that, and then we redact the personal details. See our ',
        link('/privacy', 'Privacy Policy'),
        '.',
      ),
    ]),

    section('if-you-disagree', 'If you disagree with our decision', [
      p('Write to our grievance officer. The response times are in our ', link('/terms', 'Terms of Use'), '.'),
      grievance(),
    ]),
  ];

  return {
    key: 'contentRemoval',
    path: '/content-removal',
    title: 'Content Removal and Takedown Policy',
    description:
      'How players, parents and guardians, and rights holders can ask Power Smash to hide, remove or correct content, and how fast we aim to act.',
    summary: [
      'If you or your child appears in something we publish, or you hold rights in it, you can ask us to hide, remove or correct it. For a request about a player under 18, we hide first and check afterwards.',
    ],
    sections,
  };
}

export const contentRemovalDoc: LegalDoc = buildContentRemovalDoc();
