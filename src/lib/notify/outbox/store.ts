// The outbox store interface and a fictional in-memory implementation (tests and the preview). A real store (a Supabase table
// with a UNIQUE key column, RLS on, no public grant, written only by a SECURITY DEFINER function) is NOT part of this wave:
// TODO(lead): add the migration and a supabase-backed store when the owner switches notifications on.
import type { OutboxRecord, RecordStatus } from './types';

export interface EnqueueResult {
  inserted: number;
  /** Records whose key already existed: kept as they were (idempotent enqueue, never a second message). */
  duplicates: number;
}

export interface OutboxStore {
  /** Inserts each record whose key is new; an existing key is left untouched. */
  enqueue(records: readonly OutboxRecord[]): Promise<EnqueueResult>;
  /** Records that may be worked on at `nowIso`: queued and due, or `sending` with an expired lease (a crashed attempt). */
  listDue(nowIso: string, limit: number): Promise<OutboxRecord[]>;
  /**
   * Replaces the record ONLY when its current status and attempts still equal `expect` (compare and set), so two dispatchers
   * can never both send one record. Returns false when someone else changed it first.
   */
  compareAndSet(key: string, expect: { status: RecordStatus; attempts: number }, next: OutboxRecord): Promise<boolean>;
  get(key: string): Promise<OutboxRecord | null>;
}

export class MemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, OutboxRecord>();

  async enqueue(records: readonly OutboxRecord[]): Promise<EnqueueResult> {
    let inserted = 0;
    let duplicates = 0;
    for (const r of records) {
      if (this.rows.has(r.key)) duplicates += 1;
      else {
        this.rows.set(r.key, { ...r });
        inserted += 1;
      }
    }
    return { inserted, duplicates };
  }

  async listDue(nowIso: string, limit: number): Promise<OutboxRecord[]> {
    const now = Date.parse(nowIso);
    return [...this.rows.values()]
      .filter((r) => (r.status === 'queued' && Date.parse(r.notBefore) <= now) || (r.status === 'sending' && r.leaseUntil !== null && Date.parse(r.leaseUntil) <= now))
      .sort((a, b) => Date.parse(a.notBefore) - Date.parse(b.notBefore) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, Math.max(0, limit))
      .map((r) => ({ ...r }));
  }

  async compareAndSet(key: string, expect: { status: RecordStatus; attempts: number }, next: OutboxRecord): Promise<boolean> {
    const cur = this.rows.get(key);
    if (!cur || cur.status !== expect.status || cur.attempts !== expect.attempts || next.key !== key) return false;
    this.rows.set(key, { ...next });
    return true;
  }

  async get(key: string): Promise<OutboxRecord | null> {
    const r = this.rows.get(key);
    return r ? { ...r } : null;
  }

  all(): OutboxRecord[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}
