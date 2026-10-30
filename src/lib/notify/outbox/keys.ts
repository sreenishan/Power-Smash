// Deterministic idempotency keys for outbox records. The same (kind, event id, revision, recipient id, channel) ALWAYS gives the
// same key, on every machine and every retry, so enqueueing an event twice (a double click, a retried request, a re-run job)
// never makes a second message: the store keeps one row per key, and the key also goes to the vendor where the vendor supports
// idempotency (Resend `Idempotency-Key`, max 256 characters: src/lib/notify/email.ts).
// No clock and no randomness: the key never depends on when the event was built.
import type { Channel, NotificationKind } from './types';

export const KEY_VERSION = 'ntf1';
/** Upper bound for a key; longer inputs are folded into a hash so the key fits vendor limits (Resend: 256). */
export const MAX_KEY_LENGTH = 200;

export interface KeyParts {
  kind: NotificationKind;
  eventId: string;
  revision: number;
  recipientId: string;
  channel: Channel;
}

/** Each part is escaped so a ':' inside an id can never make two different inputs collide. */
function part(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*~.]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Two independent 32-bit FNV-1a hashes over the UTF-16 code units: a stable 16-hex-digit digest (not a security hash). */
export function stableDigest(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x2f) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function idempotencyKey(p: KeyParts): string {
  if (!Number.isInteger(p.revision) || p.revision < 0) throw new RangeError('revision must be a whole number of 0 or more');
  if (p.eventId === '' || p.recipientId === '') throw new RangeError('eventId and recipientId are required');
  const full = [KEY_VERSION, p.kind, part(p.eventId), String(p.revision), part(p.recipientId), p.channel].join(':');
  if (full.length <= MAX_KEY_LENGTH) return full;
  // Long ids: keep the readable kind and channel, fold the rest into a digest of the full key.
  return [KEY_VERSION, p.kind, 'h', stableDigest(full), p.channel].join(':');
}
