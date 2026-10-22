// Wording for the confirmation screen, kept out of the React file so tests can import it (spec Appendix B "Form success",
// D-022). No prices, no deadlines, no claim that an email was sent: before the domain is verified no confirmation email
// goes out, and the owner has not promised a reply time unless site.replyTimePromise says so.
import type { LeadKind } from '../contracts/lead-constants';

/** "What happens next", plain and without anything the owner has not decided. */
export function nextSteps(kind: LeadKind): string[] {
  switch (kind) {
    case 'coverage':
      return [
        'We read your request. We may message you to confirm the dates, courts and categories.',
        'We reply with a quote for the package that fits your tournament.',
        'Nothing is booked until you say yes.',
      ];
    case 'sponsorship':
      return [
        'We read your enquiry and may ask what you would like to achieve.',
        'We suggest a plan and send you a quote.',
        'Paid placements are always labelled.',
      ];
    case 'tournament_submission':
      return [
        'We check the details you sent.',
        'When it is approved, your tournament is added to the Tournaments page.',
        'Your contact details are shown publicly only if you ticked the box for that.',
      ];
    case 'video_submission':
      return [
        'We open the link and watch the video. We never publish anything automatically.',
        'We may message you to confirm the match details and your permission to publish it. Sending a video does not mean we will publish it.',
        'If we publish it, we credit you by name unless you asked us not to.',
      ];
    case 'profile_request':
    case 'content_removal':
      return [
        'We read your request by hand. The website itself never opens the link you gave.',
        'If you said you are a parent or guardian, we will later ask you to confirm by a one-time code sent to your own phone. That check is not switched on yet. Sending this form does not hide or remove anything by itself.',
        'We reply on the phone number you gave.',
      ];
    case 'alerts_signup':
      return [
        'Your sign-up is saved.',
        'We do not send any email yet. Email alerts are not switched on, so you will not get a confirmation message or any alerts until they are.',
        'When they are switched on, the first message will ask you to confirm your address (double opt-in). Until you confirm, we will not send you alerts.',
      ];
    default:
      return ['We read your message.', 'We reply on the phone number or email address you gave.'];
  }
}

/** "We reply within 24 hours." only when the owner supplied a reply-time promise; otherwise a sentence with no promise. */
export function replyLine(replyPromise: string | null, kind?: LeadKind): string {
  // An alerts sign-up is not an enquiry: nobody replies, so no reply wording at all (the next steps say what is true).
  if (kind === 'alerts_signup') return 'We have saved your email address for alerts.';
  const promise = (replyPromise ?? '').trim();
  return promise === '' ? 'We will get back to you as soon as we can.' : `We reply within ${promise}.`;
}
