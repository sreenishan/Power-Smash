// Channel adapters. Each one is an interface implementation that answers `not_configured` whenever its credentials or its
// collaborator are missing, and NEVER claims `sent` without a positive answer from the thing that delivers.
//
//  - in-app: writes into an injected inbox store (idempotent by key). No store = not configured.
//  - email: reuses sendEmail (Resend, src/lib/notify/email.ts, vendor facts checked there). A list email (a 'subscriber:' recipient)
//    also needs its one-click unsubscribe link (footer and List-Unsubscribe headers), or it is not sent. Needs EMAIL_ENABLED exactly true
//    (the caller passes the parsed boolean), the API key, a From address and an address lookup. The address is looked up by the
//    opaque recipient id at send time; it is never stored in the outbox and never put in an error code.
//  - push, whatsapp: vendor UNVERIFIED (no provider, endpoint, price or terms checked in this wave). They are a transport
//    interface only; with no transport (the default) they answer `not_configured`.
//    TODO(lead): pick and verify a push provider and a WhatsApp Business provider (terms, template approval, opt-in rules,
//    prices) before any transport is written; record the facts in docs/VERIFIED_FACTS.md and a decision in docs/DECISIONS.md.
import { sendEmail } from '../email';
import type { AdapterResult, Channel, ChannelAdapter, OutgoingMessage } from './types';

/** An adapter that is always `not_configured` (a channel nobody has set up). */
export function notConfiguredAdapter(channel: Channel): ChannelAdapter {
  return { channel, send: async () => ({ status: 'not_configured' }) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// In-app
// ---------------------------------------------------------------------------------------------------------------------------

export interface InAppItem {
  key: string;
  recipientId: string;
  kind: OutgoingMessage['kind'];
  subject: string;
  body: string;
  createdAt: string;
}

export interface InAppInbox {
  /** Stores the item once per key; a second call with the same key must not add a second item. Throws on a storage failure. */
  put(item: InAppItem): Promise<void>;
}

export function inAppAdapter(inbox: InAppInbox | null | undefined): ChannelAdapter {
  return {
    channel: 'in_app',
    async send(m) {
      if (!inbox) return { status: 'not_configured' };
      try {
        await inbox.put({ key: m.key, recipientId: m.recipientId, kind: m.kind, subject: m.subject, body: m.body, createdAt: m.createdAt });
        return { status: 'sent' };
      } catch {
        return { status: 'failed', retryable: true, code: 'inbox_unavailable' };
      }
    },
  };
}

/** A fictional in-memory inbox for tests and the preview. */
export class MemoryInAppInbox implements InAppInbox {
  readonly items = new Map<string, InAppItem>();
  async put(item: InAppItem): Promise<void> {
    if (!this.items.has(item.key)) this.items.set(item.key, { ...item });
  }
  forRecipient(id: string): InAppItem[] {
    return [...this.items.values()].filter((i) => i.recipientId === id);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------------------------------------

export interface EmailAdapterConfig {
  /** EMAIL_ENABLED parsed as exactly "true" by the caller (src/lib/runtime-env.ts). */
  enabled: boolean;
  apiKey: string | null;
  from: string | null;
  fetch: typeof fetch;
  /** Looks the address up by the opaque recipient id; null when there is none. */
  resolveAddress: ((recipientId: string) => Promise<string | null>) | null;
  /**
   * The one-click unsubscribe link for a recipient on the email LIST ('subscriber:<uuid>', D-114), made by the server at send time
   * (src/lib/notices/tokens.ts). A list email is NEVER sent without one: no resolver, or null, = not configured. Other recipients
   * ignore it.
   */
  unsubscribeUrl?: ((recipientId: string) => Promise<string | null>) | null;
}

/** The footer every list email ends with (plain text). */
export function listFooter(unsubscribeUrl: string): string {
  return `You get this email because you signed up for Power Smash updates. To stop them, open this link: ${unsubscribeUrl}`;
}

export function emailAdapter(config: EmailAdapterConfig | null | undefined): ChannelAdapter {
  return {
    channel: 'email',
    async send(m): Promise<AdapterResult> {
      if (!config || config.enabled !== true || !config.apiKey || !config.from || !config.resolveAddress) return { status: 'not_configured' };
      let to: string | null;
      try {
        to = await config.resolveAddress(m.recipientId);
      } catch {
        return { status: 'failed', retryable: true, code: 'address_lookup_failed' };
      }
      if (!to) return { status: 'skipped', reason: 'no_address' };
      let text = m.body;
      let headers: Record<string, string> | undefined;
      if (m.recipientId.startsWith('subscriber:')) {
        let link: string | null;
        try {
          link = config.unsubscribeUrl ? await config.unsubscribeUrl(m.recipientId) : null;
        } catch {
          return { status: 'failed', retryable: true, code: 'unsubscribe_link_failed' };
        }
        if (!link || !/^https:\/\/[^\s<>]+$/.test(link)) return { status: 'not_configured' };
        text = `${m.body}\n\n--\n${listFooter(link)}`;
        headers = { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
      }
      const r = await sendEmail({ fetch: config.fetch, apiKey: config.apiKey, message: { from: config.from, to, subject: m.subject, text, idempotencyKey: m.key, ...(headers ? { headers } : {}) } });
      if (r.ok) return { status: 'sent' };
      switch (r.reason) {
        case 'unconfigured':
          return { status: 'not_configured' };
        case 'rate_limited':
        case 'unavailable':
          return { status: 'failed', retryable: true, code: `email_${r.reason}` };
        default:
          return { status: 'failed', retryable: false, code: `email_${r.reason}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Push and WhatsApp (vendor unverified: interface only)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * What a future, verified push or WhatsApp transport must implement. `ok: true` only on the vendor's positive acceptance.
 * IDEMPOTENCY (MUST): the dispatcher is at-least-once, so the same `m.key` can arrive again after a crash or a lost
 * compare-and-set. An implementation MUST dedupe on `m.key` (a vendor idempotency feature, once one is verified, or its own
 * sent-key ledger checked before delivering) and return `ok: true` for a key it already delivered, without sending again.
 */
export interface MessageTransport {
  deliver(m: OutgoingMessage): Promise<{ ok: true } | { ok: false; retryable: boolean; code: string }>;
}

function transportAdapter(channel: 'push' | 'whatsapp', transport: MessageTransport | null | undefined): ChannelAdapter {
  return {
    channel,
    async send(m) {
      if (!transport) return { status: 'not_configured' };
      try {
        const r = await transport.deliver(m);
        return r.ok === true ? { status: 'sent' } : { status: 'failed', retryable: r.retryable === true, code: stripCode(r.code) };
      } catch {
        return { status: 'failed', retryable: true, code: `${channel}_unavailable` };
      }
    },
  };
}

/** Error codes are short identifiers only (letters and underscores): never a vendor body, a number or an address. */
function stripCode(code: unknown): string {
  const s = typeof code === 'string' ? code.replace(/[^a-z_]/gi, '').slice(0, 40) : '';
  return s === '' ? 'failed' : s;
}

export function pushAdapter(transport: MessageTransport | null = null): ChannelAdapter {
  return transportAdapter('push', transport);
}

/** WhatsApp messages would go through a verified WhatsApp Business provider only; never a hand-made wa.me link (D-029). */
export function whatsappAdapter(transport: MessageTransport | null = null): ChannelAdapter {
  return transportAdapter('whatsapp', transport);
}
