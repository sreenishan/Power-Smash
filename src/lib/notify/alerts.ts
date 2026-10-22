// Alert orchestration for a new lead (D-022, D-029, D-008):
//  - Telegram always (plain text, minimal) when the bot is configured;
//  - email alert to the owner as the second channel, and the customer acknowledgement, ONLY when EMAIL_ENABLED=true;
//  - one acknowledgement per address per 24 hours (a database counter on the HMAC of the address, with `+tag` and Gmail dots
//    folded so aliases of one mailbox share the allowance: S-6);
//  - every channel is independent: one failing never blocks the other, and no failure is thrown to the visitor.
// The result tells the caller whether the OWNER has been told (`ownerAlerted`); if not, the lead row is marked
// `alert_state = 'failed'` so it is findable in Supabase Studio and re-sendable (retryFailedAlerts).
//
// R-TELEGRAM-PHONE: the owner alert (Telegram AND the owner email, which has the same content) holds no phone, no email address
// and no free text unless the Worker variable TELEGRAM_ALERT_PHONE_LINK is exactly "true" (config.telegramPhoneLink).
// R-ACK-PROMISE: the acknowledgement promises a reply time only when config.replyWindow (site.replyTimePromise) is set.
import type { LeadHandlerConfig } from '../leads/config';
import { ACK_EMAIL_RULE, ACK_STOP_AFTER_PER_DAY, FLOOD_NOTICE_RULE, GLOBAL_BUCKET, GLOBAL_KEY, checkAndRecord, type RateStore } from '../security/ratelimit';
import { pseudonym, type ParsedHmacKey } from '../security/hash';
import { emailRateKey } from '../security/text';
import { buildAckEmail, buildOwnerAlertEmail, sendEmail } from './email';
import { buildAlertText, sendTelegram, type AlertLead } from './telegram';

export type ChannelState = 'sent' | 'failed' | 'skipped';

export interface NotifyContext {
  config: LeadHandlerConfig;
  fetch: typeof fetch;
  now: () => Date;
  store: RateStore | null;
  hmac: ParsedHmacKey | null;
  /** Override of ACK_STOP_AFTER_PER_DAY (tests). */
  ackStopAfter?: number;
}

export interface NotifyOutcome {
  telegram: ChannelState;
  ownerEmail: ChannelState;
  ackEmail: ChannelState;
  /** true when at least one owner-facing channel (Telegram or email) delivered. */
  ownerAlerted: boolean;
}

const emailReady = (c: LeadHandlerConfig): boolean => c.emailEnabled && !!c.resendApiKey && !!c.emailFrom;

export async function notifyNewLead(ctx: NotifyContext, lead: AlertLead & { email?: string }): Promise<NotifyOutcome> {
  const { config } = ctx;
  const alertOptions = { includePhoneLink: config.telegramPhoneLink };

  const telegramP = (async (): Promise<ChannelState> => {
    if (!config.telegramBotToken || !config.telegramChatId) return 'skipped';
    const r = await sendTelegram({ fetch: ctx.fetch, token: config.telegramBotToken, chatId: config.telegramChatId, text: buildAlertText(lead, alertOptions) });
    return r.ok ? 'sent' : 'failed';
  })();

  const ownerEmailP = (async (): Promise<ChannelState> => {
    if (!emailReady(config) || !config.ownerEmail) return 'skipped';
    const mail = buildOwnerAlertEmail(lead, alertOptions);
    const r = await sendEmail({
      fetch: ctx.fetch,
      apiKey: config.resendApiKey,
      message: { from: config.emailFrom as string, to: config.ownerEmail, subject: mail.subject, text: mail.text, idempotencyKey: `${lead.ref}-owner` },
    });
    return r.ok ? 'sent' : 'failed';
  })();

  const ackP = (async (): Promise<ChannelState> => {
    if (!emailReady(config) || !lead.email) return 'skipped';
    if (!ctx.store || !ctx.hmac) return 'skipped'; // cannot prove the once-per-24-hours rule: do not send
    try {
      // N-3: past the daily count no acknowledgement is sent (the free mail quota is kept for the owner alerts). The enquiry being
      // alerted is already stored, so its own reservation is in the count. Checked first: a skipped mail must not use up the address's own allowance.
      const storedToday = await ctx.store.count(GLOBAL_BUCKET, GLOBAL_KEY, new Date(ctx.now().getTime() - 86_400_000).toISOString());
      if (storedToday > (ctx.ackStopAfter ?? ACK_STOP_AFTER_PER_DAY)) return 'skipped';
      const keyHash = await pseudonym(ctx.hmac, 'ack_email', emailRateKey(lead.email));
      const decision = await checkAndRecord(ctx.store, [ACK_EMAIL_RULE], keyHash, ctx.now());
      if (!decision.allowed) return 'skipped';
    } catch {
      return 'skipped';
    }
    const mail = buildAckEmail({ ref: lead.ref, name: lead.name, kind: lead.kind, whatsappNumber: config.whatsappNumber, replyWindow: config.replyWindow });
    const r = await sendEmail({
      fetch: ctx.fetch,
      apiKey: config.resendApiKey,
      message: { from: config.emailFrom as string, to: lead.email, subject: mail.subject, text: mail.text, idempotencyKey: `${lead.ref}-ack` },
    });
    return r.ok ? 'sent' : 'failed';
  })();

  const [telegram, ownerEmail, ackEmail] = await Promise.all([telegramP, ownerEmailP, ackP]);
  return { telegram, ownerEmail, ackEmail, ownerAlerted: telegram === 'sent' || ownerEmail === 'sent' };
}

/**
 * Degraded mode (the database could not store the lead): tell the owner anyway, with the same minimal content plus a
 * clear "NOT SAVED" marker, so the enquiry can still be followed up. Telegram first; email too when it is enabled.
 * By default the alert holds no contact details (R-TELEGRAM-PHONE): it tells the owner to watch WhatsApp for the visitor's
 * message quoting the reference (the visitor is shown that WhatsApp link). With TELEGRAM_ALERT_PHONE_LINK=true it also
 * carries the customer's WhatsApp reply link.
 */
export async function notifyDegraded(ctx: NotifyContext, lead: AlertLead): Promise<boolean> {
  const { config } = ctx;
  const alertOptions = { includePhoneLink: config.telegramPhoneLink, degraded: true };
  const results = await Promise.all([
    (async () => {
      if (!config.telegramBotToken || !config.telegramChatId) return false;
      const r = await sendTelegram({ fetch: ctx.fetch, token: config.telegramBotToken, chatId: config.telegramChatId, text: buildAlertText(lead, alertOptions) });
      return r.ok;
    })(),
    (async () => {
      if (!emailReady(config) || !config.ownerEmail) return false;
      const mail = buildOwnerAlertEmail(lead, alertOptions);
      const r = await sendEmail({
        fetch: ctx.fetch,
        apiKey: config.resendApiKey,
        message: {
          from: config.emailFrom as string,
          to: config.ownerEmail,
          subject: `NOT SAVED ${mail.subject}`,
          text: mail.text,
          idempotencyKey: `${lead.ref}-degraded`,
        },
      });
      return r.ok;
    })(),
  ]);
  return results.some(Boolean);
}

/**
 * S-6 flood notice: the global circuit breaker has tripped. Tell the owner ONCE per hour (a counter bucket of its own), on
 * Telegram and, when email is on, by email. Plain text, no visitor data. Returns true when a notice was sent.
 */
export async function notifyFlood(ctx: NotifyContext, cap: number, window: 'hour' | 'day' = 'hour'): Promise<boolean> {
  const { config } = ctx;
  if (!ctx.store) return false; // cannot rate-limit the notice itself: stay silent rather than risk a flood of notices
  const decision = await checkAndRecord(ctx.store, [FLOOD_NOTICE_RULE], GLOBAL_KEY, ctx.now());
  if (!decision.allowed) return false;
  const text = `LEAD FLOOD PROTECTION IS ON: more than ${cap} enquiries were saved in the last ${window}, so new enquiries are being refused until the ${window} has passed and visitors are shown the WhatsApp link instead. If this is not a real rush, check the leads table in Supabase Studio.`;
  const results = await Promise.all([
    (async () => {
      if (!config.telegramBotToken || !config.telegramChatId) return false;
      return (await sendTelegram({ fetch: ctx.fetch, token: config.telegramBotToken, chatId: config.telegramChatId, text })).ok;
    })(),
    (async () => {
      if (!emailReady(config) || !config.ownerEmail) return false;
      const r = await sendEmail({
        fetch: ctx.fetch,
        apiKey: config.resendApiKey,
        message: { from: config.emailFrom as string, to: config.ownerEmail, subject: 'Lead flood protection is on', text, idempotencyKey: `flood-${Math.floor(ctx.now().getTime() / 3_600_000)}` },
      });
      return r.ok;
    })(),
  ]);
  return results.some(Boolean);
}
