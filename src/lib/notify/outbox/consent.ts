// Consent and preference checks (pure). Fail closed: anything not clearly allowed is a skip with a reason, recorded in the outbox
// so the owner can see WHY a person did not get a message.
//
// Rules, in order:
//  1. Protected people (D-012): a recipient whose age status is not exactly `adult_confirmed` (unknown included) is reached only
//     through a contact the organiser marked as a guardian contact. Never lifted from a self-claim.
//  2. Consent is opt-in per channel. No entry for the channel = `no_consent`; a withdrawal (withdrawnAt set, or granted false
//     after a grant) = `consent_withdrawn`. A withdrawal dated after the check time does not count yet (injected clock).
//  3. A kind the recipient turned off = `muted_kind` (honoured for every kind; the safer choice is to send less).
//  0. Email-list subscribers (audience 'subscriber', D-114): only kind 'announcement' and only channel 'email'; everything else is
//     'no_consent'. The list is a general announcement list: the D-012 protection of rule 1 is about PLAYERS and their contacts, and a
//     subscriber is never linked to a player record (the sign-up asks the person to confirm they are 18 or older, and nothing about a
//     player is ever lifted from that answer). Rules 2 and 3 apply as usual.
// A legal review may later decide that some service messages need no separate consent; until then every channel needs one.
import type { Channel, NotificationKind, Recipient, SkipReason } from './types';

export function isProtectedRecipient(r: Pick<Recipient, 'ageStatus' | 'guardianContact'>): boolean {
  return r.ageStatus !== 'adult_confirmed' && r.guardianContact !== true;
}

/** Returns null when the message may be queued, or the reason it must be skipped. `now` is the injected check time. */
export function consentDecision(recipient: Recipient, channel: Channel, kind: NotificationKind, now: Date): SkipReason | null {
  if (recipient.audience === 'subscriber') {
    if (channel !== 'email' || kind !== 'announcement') return 'no_consent';
  } else if (isProtectedRecipient(recipient)) return 'protected_recipient';
  const c = recipient.consent[channel];
  if (!c) return 'no_consent';
  if (c.withdrawnAt) {
    const at = Date.parse(c.withdrawnAt);
    // An unreadable withdrawal date still counts as a withdrawal (fail closed).
    if (Number.isNaN(at) || at <= now.getTime()) return 'consent_withdrawn';
  }
  if (c.granted !== true) return c.grantedAt ? 'consent_withdrawn' : 'no_consent';
  if (c.grantedAt) {
    const at = Date.parse(c.grantedAt);
    if (Number.isNaN(at) || at > now.getTime()) return 'no_consent'; // a grant in the future (or unreadable) is not a grant yet
  }
  if (recipient.mutedKinds?.includes(kind)) return 'muted_kind';
  return null;
}
