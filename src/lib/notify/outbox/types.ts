// Module 13 (platform brief, wave 2): the notification OUTBOX vocabulary.
//
// What this layer is: a pure builder turns a domain event (a registration was approved, a court changed, ...) into outbox
// records, one per recipient and channel, each with a deterministic idempotency key; a dispatcher later hands queued records to
// channel adapters. NOTHING here sends by itself: there is no schedule, no route and no wiring into a page or the admin. Whoever
// wires it in later needs the owner's yes (CLAUDE.md "Ask first": anything that changes what people's phones receive).
//
// SAFE DEFAULTS (wave 2, 2026-10-30):
//  - The dispatcher does nothing unless it is called with `enabled: true` (no default switch-on). Every channel adapter without
//    configured credentials answers `not_configured` and the record is marked `skipped`; a record is marked `sent` ONLY when an
//    adapter returned exactly `{ status: 'sent' }`.
//  - Consent is opt-in per channel: no recorded consent = skipped with a reason. A withdrawn consent wins over a grant.
//  - Protected people (D-012): a recipient whose age status is not `adult_confirmed` is reached only through a guardian contact;
//    another player (an opponent) is named in a message only when that player is `adult_confirmed`, otherwise "your opponent".
//  - Records hold NO contact data (no phone, no email address): only an opaque recipient id. The adapter resolves the address at
//    send time through an injected lookup, so the outbox table never becomes a second copy of private data (D-029).
//  - Registration and payments are OFF in this wave; payment messages talk only about MANUAL verification by the organiser.
//  - No reply-time promise unless the owner set one (site.replyTimePromise, passed in as `replyWindow`); never a default.
//  - WhatsApp and push vendors are UNVERIFIED (no vendor facts checked): their adapters are interfaces only, `not_configured`.
import type { AgeStatus } from '../../parser/types';

export type { AgeStatus };

/** Calendar date YYYY-MM-DD read as India time; instants are ISO strings in UTC (D-030). */
export type IsoDate = string;
export type IsoInstant = string;

export const CHANNELS = ['in_app', 'email', 'push', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

/** The notification kinds of the brief. */
export const NOTIFICATION_KINDS = [
  'registration_confirmation',
  'registration_approved',
  'registration_rejected',
  'payment_verification',
  'announcement',
  'schedule_change',
  'court_change',
  'match_reminder',
  'draw_published',
  'results_published',
  'postponement',
  'cancellation',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Who the event is about: a tournament, and optionally an event inside it ("Men's Doubles"). Plain text, set by the organiser. */
export interface EventContext {
  tournamentName: string;
  eventName?: string | null;
}

/** Another player mentioned in a message. Named ONLY when `ageStatus` is exactly `adult_confirmed` (D-012, fail closed). */
export interface MentionedPlayer {
  name: string;
  ageStatus: AgeStatus | null | undefined;
}

/** The domain events the builder understands. `eventId` is stable for one real-world event; `revision` changes when it changes again. */
export type DomainEvent = EventContext & {
  /** Stable id of the thing that happened (a registration id, a match id plus change number, an announcement id). */
  eventId: string;
  /** Bumped when the same thing changes again (a second schedule change), so the new message gets a new key. Default 0. */
  revision?: number;
  /** Optional internal page path for "see the details" (for example /tournaments/<slug>/); shown only with a site origin. */
  pagePath?: string | null;
} & (
    | { kind: 'registration_confirmation'; registrationRef: string }
    | { kind: 'registration_approved'; registrationRef: string }
    | { kind: 'registration_rejected'; registrationRef: string; reason?: string | null }
    | { kind: 'payment_verification'; registrationRef: string; outcome: 'verified' | 'not_verified' }
    | { kind: 'announcement'; title: string; body: string }
    | { kind: 'schedule_change'; matchLabel: string; newStart: IsoInstant; previousStart?: IsoInstant | null }
    | { kind: 'court_change'; matchLabel: string; newCourt: string; previousCourt?: string | null }
    | { kind: 'match_reminder'; matchLabel: string; start: IsoInstant; court?: string | null; opponent?: MentionedPlayer | null }
    | { kind: 'draw_published' }
    | { kind: 'results_published' }
    | { kind: 'postponement'; scope: 'match' | 'event' | 'tournament'; matchLabel?: string | null; newDate?: IsoDate | null; reason?: string | null }
    | { kind: 'cancellation'; scope: 'match' | 'event' | 'tournament'; matchLabel?: string | null; reason?: string | null }
  );

/** A recorded consent for one channel. Withdrawn wins over granted. */
export interface ChannelConsent {
  granted: boolean;
  grantedAt?: IsoInstant | null;
  withdrawnAt?: IsoInstant | null;
}

/** A person who may receive a notification. Holds NO address: adapters look addresses up by `id` at send time. */
export interface Recipient {
  /** Opaque id (a profile or contact id). Never a phone number or an email address. */
  id: string;
  /** Used only as a sanitised first name in the greeting; absent = "Hi there". */
  greetingName?: string | null;
  /** Age status of the person the notification is ABOUT when the recipient is that person. Unknown = protected (D-012). */
  ageStatus: AgeStatus | null | undefined;
  /** True when this contact is a parent or guardian of a protected player (set by the organiser, never from a self-claim). */
  guardianContact?: boolean;
  /** Per-channel consent. A channel missing here has NO consent. */
  consent: Partial<Record<Channel, ChannelConsent>>;
  /** Kinds the recipient turned off (honoured for every kind). */
  mutedKinds?: readonly NotificationKind[];
  /**
   * 'subscriber' = someone on the double-opt-in EMAIL LIST (D-114, migration 0023), not a player or a registration contact. A subscriber
   * gets only announcements, only by email, and only with a confirmed email consent (consent.ts). Default 'participant'.
   */
  audience?: 'participant' | 'subscriber';
}

export type RecordStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export type SkipReason =
  | 'no_consent'
  | 'consent_withdrawn'
  | 'muted_kind'
  | 'protected_recipient'
  | 'channel_not_configured'
  | 'no_address'
  | 'expired'
  | 'consent_changed';

/** One outbox row: one message, to one recipient, on one channel. */
export interface OutboxRecord {
  /** Deterministic idempotency key (see keys.ts): the same event, revision, recipient and channel always give the same key. */
  key: string;
  kind: NotificationKind;
  eventId: string;
  revision: number;
  recipientId: string;
  channel: Channel;
  status: RecordStatus;
  skipReason: SkipReason | null;
  subject: string;
  body: string;
  createdAt: IsoInstant;
  /** Earliest time the dispatcher may try (backoff moves it). */
  notBefore: IsoInstant;
  /** After this the message is pointless (a reminder after the match started): it is skipped as `expired`, never sent late. */
  expiresAt: IsoInstant | null;
  attempts: number;
  /** While `sending`: until when this dispatcher holds the record; after it a crashed attempt can be picked up again. */
  leaseUntil: IsoInstant | null;
  /** A short code only (never a vendor response body, never an address). */
  lastError: string | null;
  sentAt: IsoInstant | null;
}

/** What a channel adapter returns. Only `sent` makes a record `sent`. */
export type AdapterResult =
  | { status: 'sent' }
  | { status: 'not_configured' }
  | { status: 'skipped'; reason: 'no_address' }
  | { status: 'failed'; retryable: boolean; code: string };

/** The message an adapter receives: the record's text plus its key (passed to the vendor as an idempotency key where supported). */
export interface OutgoingMessage {
  key: string;
  kind: NotificationKind;
  recipientId: string;
  channel: Channel;
  subject: string;
  body: string;
  createdAt: IsoInstant;
}

export interface ChannelAdapter {
  readonly channel: Channel;
  send(message: OutgoingMessage): Promise<AdapterResult>;
}
