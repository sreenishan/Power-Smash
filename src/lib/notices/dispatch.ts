// Sending the email-list announcements (D-114): one run of the outbox dispatcher over SUBSCRIBER records only (the store is limited to
// recipient_subscriber_id, so this run never touches a lead's or a player's record). Nothing schedules it: the owner presses
// "Send queued emails now" in the admin (notify.dispatch). Fail closed at every step:
//  - email must be ready (EMAIL_ENABLED exactly "true", the Resend key, the From address, an https site origin) and the HMAC key must
//    exist (the unsubscribe link), else `null` (not set up) and nothing is read;
//  - each record is re-checked just before sending: the subscriber must still be active (an unsubscribe in between wins);
//  - every list email carries the one-click unsubscribe link (footer and List-Unsubscribe headers) or is not sent;
//  - the idempotency key sent to Resend is the outbox key, so a retry after a crash is dropped by Resend within its 24 hours.
import type { LeadHandlerConfig } from '../leads/config';
import { emailAdapter, inAppAdapter, notConfiguredAdapter } from '../notify/outbox/adapters';
import { dispatchOutbox, type DispatchSummary } from '../notify/outbox/dispatcher';
import { createSupabaseOutboxStore, type OutboxDb } from '../notify/outbox/supabase-store';
import { parseHmacKey } from '../security/hash';
import { createSupabaseRest, type SupabaseRest } from '../supabase/rest';
import { emailReady } from './handlers';
import { createSubscriberStore, subscriberAddressResolver, subscriberRecheck } from './subscriber-store';
import { unsubscribeUrlResolver } from './tokens';

export interface SubscriberDispatchDeps {
  config: LeadHandlerConfig;
  fetch: typeof fetch;
  now: () => Date;
  /** Tests: the database (default: Supabase REST with the secret key from config). */
  db?: (OutboxDb & Pick<SupabaseRest, 'rpc' | 'select'>) | null;
  batchSize?: number;
}

export function createSubscriberDispatch(deps: SubscriberDispatchDeps): { emailReady: () => boolean; dispatch: () => Promise<DispatchSummary | null> } {
  const { config } = deps;
  const hmac = parseHmacKey(config.hmacKey);
  const ready = (): boolean => emailReady(config) && hmac !== null;
  return {
    emailReady: ready,
    async dispatch() {
      if (!ready()) return null;
      const db =
        deps.db !== undefined
          ? deps.db
          : config.supabaseUrl && config.supabaseSecretKey
            ? createSupabaseRest({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey, fetch: deps.fetch, allowLocalUrl: config.supabaseAllowLocalUrl })
            : null;
      if (!db) return null;
      const subscribers = createSubscriberStore(db);
      const store = createSupabaseOutboxStore(db, { recipientType: 'subscriber' });
      return dispatchOutbox(
        store,
        {
          email: emailAdapter({
            enabled: config.emailEnabled === true,
            apiKey: config.resendApiKey,
            from: config.emailFrom,
            fetch: deps.fetch,
            resolveAddress: subscriberAddressResolver(subscribers),
            unsubscribeUrl: unsubscribeUrlResolver(hmac, config.siteOrigin),
          }),
          in_app: inAppAdapter(null),
          push: notConfiguredAdapter('push'),
          whatsapp: notConfiguredAdapter('whatsapp'),
        },
        { enabled: true, now: deps.now, recheck: subscriberRecheck(subscribers), batchSize: deps.batchSize ?? 50 },
      );
    },
  };
}
