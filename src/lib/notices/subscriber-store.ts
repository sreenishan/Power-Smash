// The email list's database calls (migration 0023), server only (secret key, service_role). Writes are the three RPCs; the two reads
// (the address at send time, the consent re-check before sending) select explicit columns of notify_subscribers.
import type { SupabaseRest } from '../supabase/rest';
import { parseRecipientRef } from '../notify/outbox/payload';
import type { OutboxRecord, SkipReason } from '../notify/outbox/types';

export type SubscribeOutcome = { outcome: 'send'; id: string } | { outcome: 'closed' | 'already_active' | 'too_soon' };
export type ConfirmOutcome = { outcome: 'confirmed'; id: string } | { outcome: 'closed' | 'invalid' };
export type UnsubscribeOutcome = { outcome: 'unsubscribed' | 'unchanged'; skipped: number };

export interface SubscriberStore {
  subscribe(record: { email: string; consentId: string; consentVersion: string; tokenHash: string }): Promise<SubscribeOutcome>;
  confirm(tokenHash: string): Promise<ConfirmOutcome>;
  unsubscribe(subscriberId: string): Promise<UnsubscribeOutcome>;
  /** The address of an ACTIVE subscriber, or null. */
  activeAddress(subscriberId: string): Promise<string | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createSubscriberStore(db: Pick<SupabaseRest, 'rpc' | 'select'>): SubscriberStore {
  return {
    async subscribe(record) {
      const r = await db.rpc<{ outcome?: unknown; id?: unknown }>('notify_subscribe', { p_record: record });
      if (r?.outcome === 'send' && typeof r.id === 'string' && UUID.test(r.id)) return { outcome: 'send', id: r.id };
      if (r?.outcome === 'closed' || r?.outcome === 'already_active' || r?.outcome === 'too_soon') return { outcome: r.outcome };
      throw new Error('notify_subscribe_bad_answer');
    },
    async confirm(hash) {
      const r = await db.rpc<{ outcome?: unknown; id?: unknown }>('notify_confirm', { p_token_hash: hash });
      if (r?.outcome === 'confirmed' && typeof r.id === 'string') return { outcome: 'confirmed', id: r.id };
      if (r?.outcome === 'closed') return { outcome: 'closed' };
      return { outcome: 'invalid' };
    },
    async unsubscribe(id) {
      const r = await db.rpc<{ outcome?: unknown; skipped?: unknown }>('notify_unsubscribe', { p_subscriber: id });
      const skipped = typeof r?.skipped === 'number' ? r.skipped : 0;
      if (r?.outcome === 'unsubscribed') return { outcome: 'unsubscribed', skipped };
      if (r?.outcome === 'unchanged') return { outcome: 'unchanged', skipped };
      throw new Error('notify_unsubscribe_bad_answer');
    },
    async activeAddress(id) {
      if (!UUID.test(id)) return null;
      const [row] = await db.select<{ email: string }>('notify_subscribers', `select=email&id=eq.${id}&status=eq.active&limit=1`);
      return row && typeof row.email === 'string' ? row.email : null;
    },
  };
}

/**
 * The email adapter's address lookup for list recipients ('subscriber:<uuid>'). Any other recipient type is answered by `other`
 * (leads and profiles: wired by whoever sends to them), or null.
 */
export function subscriberAddressResolver(store: Pick<SubscriberStore, 'activeAddress'>, other?: (recipientId: string) => Promise<string | null>) {
  return async (recipientId: string): Promise<string | null> => {
    const ref = parseRecipientRef(recipientId);
    if (ref?.type === 'subscriber') return store.activeAddress(ref.id);
    return other ? other(recipientId) : null;
  };
}

/**
 * The dispatcher's consent re-check (REQUIRED by dispatchOutbox): a list email goes out only while the subscriber is still active and
 * only for an announcement by email; anything else is answered by `other`, or skipped (fail closed).
 */
export function subscriberRecheck(store: Pick<SubscriberStore, 'activeAddress'>, other?: (record: OutboxRecord, now: Date) => Promise<SkipReason | null>) {
  return async (record: OutboxRecord, now: Date): Promise<SkipReason | null> => {
    const ref = parseRecipientRef(record.recipientId);
    if (ref?.type === 'subscriber') {
      if (record.channel !== 'email' || record.kind !== 'announcement') return 'no_consent';
      return (await store.activeAddress(ref.id)) ? null : 'consent_withdrawn';
    }
    return other ? other(record, now) : 'consent_changed';
  };
}
