// The pure builder: one domain event + recipients + channels -> outbox records. No I/O, no clock of its own (`now` is injected),
// no randomness. Each record carries a deterministic idempotency key (keys.ts), so building the same event twice gives the same
// keys and the store keeps one row per key (retries never duplicate). A recipient that may not be messaged on a channel still
// gets a record, already `skipped` with the reason, so the owner can see why a person was not told.
import { isIsoDate } from '../../dates';
import { consentDecision } from './consent';
import { idempotencyKey } from './keys';
import { renderMessage, type TemplateOptions } from './templates';
import { CHANNELS, NOTIFICATION_KINDS, type Channel, type DomainEvent, type OutboxRecord, type Recipient } from './types';

export interface BuildOptions extends TemplateOptions {
  /** Injected clock: createdAt, notBefore and the consent check use it. */
  now: Date;
  /** Override of the expiry. Default: a match reminder or schedule change expires at the match start; others never. */
  expiresAt?: string | null;
}

export class OutboxEventError extends RangeError {}

const validInstant = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));

/** Throws OutboxEventError when the event cannot be rendered truthfully (missing id, unreadable time). */
export function validateEvent(e: DomainEvent): void {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(e.kind)) throw new OutboxEventError('unknown kind');
  if (typeof e.eventId !== 'string' || e.eventId.trim() === '') throw new OutboxEventError('eventId is required');
  if (e.revision !== undefined && (!Number.isInteger(e.revision) || e.revision < 0)) throw new OutboxEventError('revision must be a whole number of 0 or more');
  if (typeof e.tournamentName !== 'string' || e.tournamentName.trim() === '') throw new OutboxEventError('tournamentName is required');
  switch (e.kind) {
    case 'registration_confirmation':
    case 'registration_approved':
    case 'registration_rejected':
    case 'payment_verification':
      if (!e.registrationRef || e.registrationRef.trim() === '') throw new OutboxEventError('registrationRef is required');
      break;
    case 'announcement':
      if (e.title.trim() === '' && e.body.trim() === '') throw new OutboxEventError('an announcement needs a title or a body');
      break;
    case 'schedule_change':
      if (!validInstant(e.newStart)) throw new OutboxEventError('newStart must be an ISO instant');
      if (e.previousStart != null && !validInstant(e.previousStart)) throw new OutboxEventError('previousStart must be an ISO instant');
      break;
    case 'court_change':
      if (e.newCourt.trim() === '') throw new OutboxEventError('newCourt is required');
      break;
    case 'match_reminder':
      if (!validInstant(e.start)) throw new OutboxEventError('start must be an ISO instant');
      break;
    case 'postponement':
      if (e.newDate != null && !isIsoDate(e.newDate)) throw new OutboxEventError('newDate must be YYYY-MM-DD');
      break;
    default:
      break;
  }
}

function defaultExpiry(e: DomainEvent): string | null {
  if (e.kind === 'match_reminder') return new Date(e.start).toISOString();
  if (e.kind === 'schedule_change') return new Date(e.newStart).toISOString();
  return null;
}

export function buildOutboxRecords(event: DomainEvent, recipients: readonly Recipient[], channels: readonly Channel[], options: BuildOptions): OutboxRecord[] {
  validateEvent(event);
  if (Number.isNaN(options.now.getTime())) throw new OutboxEventError('now is not a valid time');
  const nowIso = options.now.toISOString();
  const revision = event.revision ?? 0;
  if (options.expiresAt != null && !validInstant(options.expiresAt)) throw new OutboxEventError('expiresAt must be an ISO instant');
  const expiresAt = options.expiresAt === undefined ? defaultExpiry(event) : options.expiresAt === null ? null : new Date(options.expiresAt).toISOString();
  const wanted = CHANNELS.filter((c) => channels.includes(c)); // dedupe, fixed order
  const seen = new Set<string>();
  const out: OutboxRecord[] = [];

  for (const r of recipients) {
    if (typeof r.id !== 'string' || r.id.trim() === '' || seen.has(r.id)) continue;
    seen.add(r.id);
    const message = renderMessage(event, r, options);
    for (const channel of wanted) {
      const skip = consentDecision(r, channel, event.kind, options.now);
      const expired = !skip && expiresAt !== null && Date.parse(expiresAt) <= options.now.getTime();
      out.push({
        key: idempotencyKey({ kind: event.kind, eventId: event.eventId, revision, recipientId: r.id, channel }),
        kind: event.kind,
        eventId: event.eventId,
        revision,
        recipientId: r.id,
        channel,
        status: skip || expired ? 'skipped' : 'queued',
        skipReason: skip ?? (expired ? 'expired' : null),
        subject: message.subject,
        body: message.body,
        createdAt: nowIso,
        notBefore: nowIso,
        expiresAt,
        attempts: 0,
        leaseUntil: null,
        lastError: null,
        sentAt: null,
      });
    }
  }
  return out;
}
