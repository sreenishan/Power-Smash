// Notice and consent texts, each with an id and a version that is stored with every submission (D-028, spec 15.4).
// DRAFT wording for the lawyer (OT-15). The Legal worker owns this file.
//
// RULES
//   1. Bump `version` whenever `text` changes. tests/legal/consent.test.ts pins a hash of every text: an edit without a version
//      bump fails, and so does a bump without updating the pin, so the change is always deliberate.
//   2. A NOTICE (leadNotice, requestNotice) is shown as plain text and needs no tick. A CONSENT (every other key) is a separate
//      checkbox that is NEVER pre-ticked. Forms store `{ id, version }` plus a timestamp with each submission.
//   3. Keep every text short and plain. Never claim legal compliance. Never put a price or a fee in a text.
//   4. The words "Privacy Policy" inside a text become a link to /privacy in src/components/forms/ConsentNotice.tsx. Keep them.
//   5. Keys marked LATER belong to forms that arrive after M1 (alerts and submit-video in M3, the request form in M2d). They are
//      defined now so the lawyer reviews all wording together.
export interface ConsentText {
  readonly id: string;
  readonly version: string;
  readonly text: string;
}

export const CONSENT = {
  /** NOTICE on every enquiry form (book, partner, contact, tournament submit). */
  leadNotice: {
    id: 'lead-notice',
    version: '2026-10-21-draft2',
    text: 'We use the details you enter only to reply to this enquiry and to arrange the service you ask about. We share them only with the service providers that run this website, and we never sell them. We keep them for 24 months after the enquiry is closed, then anonymise them. See our Privacy Policy. You can ask us to correct or delete them at any time.',
  },
  /** CONSENT checkbox on the tournament submission form. Unticked by default. */
  tournamentPublicContact: {
    id: 'tournament-public-contact',
    version: '2026-10-21-draft2',
    text: 'I agree that the registration contact I enter may be shown publicly on the tournament page. Tick only if you want this. You can ask us to hide it at any time.',
  },
  /** LATER (M3). CONSENT checkbox for the email alerts sign-up (double opt-in, D-026). */
  alertsSignup: {
    id: 'alerts-signup',
    version: '2026-10-21-draft1',
    text: 'Send me email alerts from Power Smash about new tournaments and matches. I can unsubscribe at any time with the link in every email. See our Privacy Policy.',
  },
  /** LATER (M3). CONSENT checkbox shared by the alerts sign-up and the submit-video form (spec 15.3, 7.12). */
  adultConfirmation: {
    id: 'adult-confirmation',
    version: '2026-10-21-draft1',
    text: 'I am 18 or older.',
  },
  /** LATER (M3). Submit-video form, confirmation 1 of 3 (D-019, spec 7.12). */
  videoRights: {
    id: 'video-rights',
    version: '2026-10-21-draft1',
    text: 'I recorded this video myself, or I have the right to share it. It is not broadcast or third-party footage, and it has no copyrighted music.',
  },
  /** LATER (M3). Submit-video form, confirmation 2 of 3: the licence (D-019). The full licence draft is docs/legal/video-submission-licence-draft.md. */
  videoLicence: {
    id: 'video-licence',
    version: '2026-10-21-draft1',
    text: 'I give Power Smash a non-exclusive licence to publish this video on its YouTube channel and website, and to earn money from it there, anywhere in the world, for as long as the video stays on the channel. Power Smash may credit me by name unless I ask it not to.',
  },
  /** LATER (M3). Submit-video form, confirmation 3 of 3 (spec 7.12). */
  videoRemoval: {
    id: 'video-removal',
    version: '2026-10-21-draft1',
    text: 'I understand that Power Smash will remove this video if a player, a parent or guardian, or a rights holder makes a valid request.',
  },
  /** LATER (M2d). NOTICE on the profile-request and content-removal forms (D-015, D-028). */
  requestNotice: {
    id: 'request-notice',
    version: '2026-10-21-draft1',
    text: 'We use the details you enter only to deal with this request and to check that it is you. We keep the record until the request is resolved and for 12 months after that, then redact the personal details. See our Privacy Policy.',
  },
} as const satisfies Record<string, ConsentText>;

export type ConsentKey = keyof typeof CONSENT;
