// The outbox store over Supabase (public.notification_outbox, migrations 0017 and 0023), for server code only (the secret key,
// service_role). Reads select explicit columns; the only writes are two SECURITY DEFINER RPCs:
//  - notify_outbox_enqueue(p_rows)  inserts new records, idempotent on the key (an existing key is left alone and counted);
//  - notify_outbox_cas(p_key, p_expect_status, p_expect_attempts, p_next)  the dispatcher's compare and set. It changes only the
//    delivery state, and only while the row still has the expected status and attempts; a final state never changes again.
// Every record is checked against the database's own rules first (payload.ts), so a refusal names the reason instead of a bare
// constraint error. Nothing here holds or returns an address: the recipient is a reference ('subscriber:<uuid>').
import { outboxRecordProblem, recordPayload, recipientRef, storedErrorCode } from './payload';
import type { EnqueueResult, OutboxStore } from './store';
import type { Channel, NotificationKind, OutboxRecord, RecordStatus, SkipReason } from './types';

/** The two calls the store needs; src/lib/supabase/rest.ts createSupabaseRest() provides both. */
export interface OutboxDb {
  select<T>(table: string, query: string): Promise<T[]>;
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T | null>;
}

export class OutboxStoreError extends Error {
  constructor(
    readonly key: string,
    readonly reason: string,
  ) {
    super(`outbox record refused: ${reason}`);
    this.name = 'OutboxStoreError';
  }
}

export const OUTBOX_TABLE = 'notification_outbox';
export const OUTBOX_COLUMNS = [
  'idempotency_key',
  'kind',
  'channel',
  'recipient_lead_id',
  'recipient_profile_id',
  'recipient_subscriber_id',
  'payload',
  'status',
  'skip_reason',
  'subject',
  'body',
  'created_at',
  'not_before',
  'expires_at',
  'attempts',
  'lease_until',
  'last_error_code',
  'sent_at',
] as const;
/** Largest batch notify_outbox_enqueue takes in one call (the SQL refuses more). */
export const ENQUEUE_BATCH = 500;

export interface OutboxRow {
  idempotency_key: string;
  kind: string;
  channel: string;
  recipient_lead_id: string | null;
  recipient_profile_id: string | null;
  recipient_subscriber_id: string | null;
  payload: Record<string, unknown> | null;
  status: RecordStatus;
  skip_reason: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
  not_before: string;
  expires_at: string | null;
  attempts: number;
  lease_until: string | null;
  last_error_code: string | null;
  sent_at: string | null;
}

const enc = encodeURIComponent;
/** PostgreSQL answers "2026-10-31 10:00:00+00"-style or "+00:00" instants; the dispatcher compares ISO strings, so normalise. */
const iso = (v: string | null): string | null => {
  if (v === null || v === undefined) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** A database row as the dispatcher's record. A row without text (0017's reference-only enqueue) is not a sendable record: null. */
export function rowToRecord(r: OutboxRow): OutboxRecord | null {
  if (r.subject === null || r.body === null) return null;
  const recipientId =
    r.recipient_subscriber_id !== null
      ? recipientRef('subscriber', r.recipient_subscriber_id)
      : r.recipient_profile_id !== null
        ? recipientRef('profile', r.recipient_profile_id)
        : r.recipient_lead_id !== null
          ? recipientRef('lead', r.recipient_lead_id)
          : null;
  if (recipientId === null) return null;
  const payload = r.payload ?? {};
  const eventId = typeof payload.event === 'string' ? payload.event : '';
  const revision = typeof payload.revision === 'number' && Number.isInteger(payload.revision) ? payload.revision : 0;
  return {
    key: r.idempotency_key,
    kind: r.kind as NotificationKind,
    eventId,
    revision,
    recipientId,
    channel: r.channel as Channel,
    status: r.status,
    skipReason: (r.skip_reason as SkipReason | null) ?? null,
    subject: r.subject,
    body: r.body,
    createdAt: iso(r.created_at) ?? r.created_at,
    notBefore: iso(r.not_before) ?? r.not_before,
    expiresAt: iso(r.expires_at),
    attempts: r.attempts,
    leaseUntil: iso(r.lease_until),
    lastError: r.last_error_code,
    sentAt: iso(r.sent_at),
  };
}

/** The JSON one record becomes for notify_outbox_enqueue. Throws OutboxStoreError when the database would refuse it. */
export function recordToEnqueueRow(r: OutboxRecord): Record<string, unknown> {
  const problem = outboxRecordProblem(r);
  if (problem) throw new OutboxStoreError(r.key, problem);
  return {
    key: r.key,
    kind: r.kind,
    channel: r.channel,
    recipient: r.recipientId,
    payload: recordPayload(r),
    status: r.status,
    skipReason: r.skipReason,
    subject: r.subject,
    body: r.body,
    createdAt: r.createdAt,
    notBefore: r.notBefore,
    expiresAt: r.expiresAt,
  };
}

/** The delivery state notify_outbox_cas writes. */
export function recordToState(r: OutboxRecord): Record<string, unknown> {
  return {
    status: r.status,
    attempts: r.attempts,
    notBefore: r.notBefore,
    leaseUntil: r.leaseUntil,
    lastError: storedErrorCode(r.lastError),
    skipReason: r.skipReason,
    sentAt: r.sentAt,
  };
}

const IMMUTABLE: readonly (keyof OutboxRecord)[] = ['key', 'kind', 'eventId', 'revision', 'recipientId', 'channel', 'subject', 'body', 'createdAt', 'expiresAt'];

export class SupabaseOutboxStore implements OutboxStore {
  /**
   * `recipientType` limits listDue to one kind of recipient (for example 'subscriber' for the email-list dispatcher), so a dispatcher
   * that can only re-check consent for that kind never touches (and never skips) anyone else's records.
   */
  constructor(
    private readonly db: OutboxDb,
    private readonly options: { recipientType?: 'lead' | 'profile' | 'subscriber' } = {},
  ) {}

  async enqueue(records: readonly OutboxRecord[]): Promise<EnqueueResult> {
    const rows = records.map(recordToEnqueueRow); // all checked before anything is sent: one bad record stops the whole batch
    let inserted = 0;
    let duplicates = 0;
    for (let i = 0; i < rows.length; i += ENQUEUE_BATCH) {
      const r = await this.db.rpc<{ inserted?: unknown; duplicates?: unknown }>('notify_outbox_enqueue', { p_rows: rows.slice(i, i + ENQUEUE_BATCH) });
      const ins = typeof r?.inserted === 'number' ? r.inserted : 0;
      const dup = typeof r?.duplicates === 'number' ? r.duplicates : 0;
      inserted += ins;
      duplicates += dup;
    }
    return { inserted, duplicates };
  }

  async listDue(nowIso: string, limit: number): Promise<OutboxRecord[]> {
    const n = Math.max(0, Math.min(1000, Math.floor(limit)));
    if (n === 0) return [];
    const cols = OUTBOX_COLUMNS.join(',');
    const now = enc(new Date(nowIso).toISOString());
    const only = this.options.recipientType ? `&recipient_${this.options.recipientType}_id=not.is.null` : '';
    // Two simple reads instead of one or=() filter: queued and due, and a claimed record whose lease ran out (a crashed attempt).
    const [queued, stale] = await Promise.all([
      this.db.select<OutboxRow>(OUTBOX_TABLE, `select=${cols}&status=eq.queued&not_before=lte.${now}&subject=not.is.null${only}&order=not_before.asc,idempotency_key.asc&limit=${n}`),
      this.db.select<OutboxRow>(OUTBOX_TABLE, `select=${cols}&status=eq.sending&lease_until=lte.${now}&subject=not.is.null${only}&order=not_before.asc,idempotency_key.asc&limit=${n}`),
    ]);
    return [...queued, ...stale]
      .map(rowToRecord)
      .filter((r): r is OutboxRecord => r !== null)
      .sort((a, b) => Date.parse(a.notBefore) - Date.parse(b.notBefore) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, n);
  }

  async compareAndSet(key: string, expect: { status: RecordStatus; attempts: number }, next: OutboxRecord): Promise<boolean> {
    if (next.key !== key) return false;
    // The database changes only the delivery state. A caller that tries to change the message itself is refused here, so the memory
    // store and this store never disagree about what was sent.
    const current = await this.get(key);
    if (!current) return false;
    for (const field of IMMUTABLE) if (current[field] !== next[field]) return false;
    const changed = await this.db.rpc<boolean>('notify_outbox_cas', { p_key: key, p_expect_status: expect.status, p_expect_attempts: expect.attempts, p_next: recordToState(next) });
    return changed === true;
  }

  async get(key: string): Promise<OutboxRecord | null> {
    const [row] = await this.db.select<OutboxRow>(OUTBOX_TABLE, `select=${OUTBOX_COLUMNS.join(',')}&idempotency_key=eq.${enc(key)}&limit=1`);
    return row ? rowToRecord(row) : null;
  }
}

export function createSupabaseOutboxStore(db: OutboxDb, options: { recipientType?: 'lead' | 'profile' | 'subscriber' } = {}): OutboxStore {
  return new SupabaseOutboxStore(db, options);
}

