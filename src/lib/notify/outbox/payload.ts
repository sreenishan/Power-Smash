// The outbox rules that the database enforces too (migration 0017 and 0023), in ONE TS place, so the Supabase store refuses a record
// before the round trip and the two sides cannot drift (tests/notify-outbox/payload-parity.test.ts runs the same cases as
// supabase/checks/0023_assertions.sql):
//  - payload: app.competition_outbox_payload_ok (0017). Its one TS copy is outboxPayloadProblem in src/lib/competition/db.ts; it is
//    re-exported here, never copied a second time.
//  - message text: app.notify_text_ok (0023). The rendered subject and body may be stored, but never with contact data in them: no
//    email address, no run of 9 or more digits (a phone number, with single spaces, dots, dashes or brackets between digits), no
//    wa.me, tel: or api.whatsapp.com link, and no control character (a line break only in the body).
//  - idempotency key: notification_outbox_idempotency_key_check (0023), the form keys.ts produces.
//  - recipient: a reference only, 'lead:<uuid>', 'profile:<uuid>' or 'subscriber:<uuid>' (notification_outbox_one_recipient).
import { outboxPayloadProblem, type OutboxPayload } from '../../competition/db';
import { CHANNELS, NOTIFICATION_KINDS, type OutboxRecord } from './types';

export { outboxPayloadProblem, type OutboxPayload };

/** notification_outbox_idempotency_key_check (0023). keys.ts escapes every other character as %XX. */
export const OUTBOX_KEY_PATTERN = /^[A-Za-z0-9:%_-]{8,200}$/;

/** The SQL patterns of app.notify_text_ok, written so the same text works in JavaScript and in PostgreSQL's regex engine. */
export const OUTBOX_TEXT_SQL_PATTERNS = {
  email: String.raw`[^\s@]+@[^\s@]+\.[^\s@]+`,
  phone: String.raw`(\+?\d[\s().-]?){9,}`,
  link: String.raw`(wa\.me/|tel:|api\.whatsapp\.com)`,
} as const;

const EMAIL_RE = new RegExp(OUTBOX_TEXT_SQL_PATTERNS.email);
const PHONE_RE = new RegExp(OUTBOX_TEXT_SQL_PATTERNS.phone);
const LINK_RE = new RegExp(OUTBOX_TEXT_SQL_PATTERNS.link, 'i');
// PostgreSQL text can never hold U+0000, so the SQL ranges start at \x01; here U+0000 is refused too.
const CONTROL_ONE_LINE = /[\u0000-\u001f\u007f]/;
const CONTROL_MULTILINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export const SUBJECT_MAX = 200;
export const BODY_MAX = 3000;

/** Mirrors app.notify_text_ok(text, max, multiline). Null when fine, else a plain reason. */
export function outboxTextProblem(text: unknown, max: number, multiline: boolean): string | null {
  if (typeof text !== 'string') return 'the text is missing';
  if (text.length > max) return `the text is longer than ${max} characters`;
  if ((multiline ? CONTROL_MULTILINE : CONTROL_ONE_LINE).test(text)) return 'the text holds a control character';
  if (EMAIL_RE.test(text)) return 'the text holds an email address';
  if (PHONE_RE.test(text)) return 'the text holds a phone number';
  if (LINK_RE.test(text)) return 'the text holds a WhatsApp or phone link';
  return null;
}

// ------------------------------------------------------------------------------------------------------------- recipient references

export const RECIPIENT_TYPES = ['lead', 'profile', 'subscriber'] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const RECIPIENT_REF_PATTERN = new RegExp(`^(lead|profile|subscriber):(${UUID})$`);

/** The opaque recipient id the outbox uses for a database row: 'subscriber:<uuid>'. Throws on a malformed id. */
export function recipientRef(type: RecipientType, id: string): string {
  const ref = `${type}:${id.toLowerCase()}`;
  if (!RECIPIENT_REF_PATTERN.test(ref)) throw new RangeError('not a recipient reference');
  return ref;
}

export function parseRecipientRef(ref: string): { type: RecipientType; id: string } | null {
  const m = RECIPIENT_REF_PATTERN.exec(ref);
  return m ? { type: m[1] as RecipientType, id: m[2] as string } : null;
}

// ------------------------------------------------------------------------------------------------------------- a whole record

/** What the store puts in `payload`: references and codes only (the event id and its revision). */
export function recordPayload(r: Pick<OutboxRecord, 'eventId' | 'revision'>): OutboxPayload {
  return { event: r.eventId, revision: r.revision };
}

const instantOk = (v: string | null, nullable: boolean): boolean => (v === null ? nullable : /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)));

/** Every rule the database applies to a NEW outbox row. Null when the Supabase store may send it, else the reason. */
export function outboxRecordProblem(r: OutboxRecord): string | null {
  if (!OUTBOX_KEY_PATTERN.test(r.key)) return 'the key is not in the outbox key form';
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(r.kind)) return 'unknown kind';
  if (!(CHANNELS as readonly string[]).includes(r.channel)) return 'unknown channel';
  const ref = parseRecipientRef(r.recipientId);
  if (!ref) return 'the recipient must be lead:, profile: or subscriber: and an id';
  if (ref.type === 'subscriber' && r.channel !== 'email') return 'a subscriber is reached by email only';
  if (r.status !== 'queued' && r.status !== 'skipped') return 'a new record is queued or skipped';
  if ((r.status === 'skipped') !== (r.skipReason !== null)) return 'a skipped record needs its reason (and only a skipped one)';
  if (!Number.isInteger(r.revision) || r.revision < 0 || r.revision > 999_999) return 'the revision must be a whole number from 0 to 999999';
  const payload = outboxPayloadProblem(recordPayload(r));
  if (payload) return `payload: ${payload} (the event id must be a uuid or a code)`;
  const subject = outboxTextProblem(r.subject, SUBJECT_MAX, false);
  if (subject) return `subject: ${subject}`;
  const body = outboxTextProblem(r.body, BODY_MAX, true);
  if (body) return `body: ${body}`;
  if (!instantOk(r.createdAt, false) || !instantOk(r.notBefore, false) || !instantOk(r.expiresAt, true)) return 'a time is not an ISO instant';
  return null;
}

/** The database's error code form: lower-case letters and underscores, 1 to 40 (notification_outbox.last_error_code). */
export function storedErrorCode(code: string | null): string | null {
  if (code === null) return null;
  const s = code.toLowerCase().replace(/[^a-z_]/g, '').slice(0, 40);
  return s === '' ? 'failed' : s;
}
