// The owner alert for a new registration (D-111, D-029). Telegram when configured, and the owner email when EMAIL_ENABLED is on; each
// channel independent, nothing thrown to the visitor. The alert holds ONLY: the kind ("New registration"), the reference, the first
// INITIAL of the first player's name, the event (category and age group, public facts) and a pointer to the admin screen. Never a full
// name, phone, email, payment reference or link, whatever TELEGRAM_ALERT_PHONE_LINK says: a registration may be a child's, so the opt-in
// phone link of the lead alerts does not apply here. No acknowledgement mail is sent to the registrant in this wave.
import type { LeadHandlerConfig } from '../leads/config';
import { sendEmail } from '../notify/email';
import { sendTelegram, TELEGRAM_TEXT_LIMIT } from '../notify/telegram';
import { sanitisedFirstName } from '../security/text';

export interface RegistrationAlert {
  ref: string;
  /** The first player's name as typed; only its first letter is used. */
  player1Name: string;
  category: string | null;
  ageGroup: string | null;
  /** The fee shown when the person registered (integer paise), or null. Only "fee: yes/no" goes into the alert. */
  feePaise: number | null;
  /** The person typed a payment reference (the reference itself is never in the alert). */
  hasPaymentReference: boolean;
}

/** One capital letter (any script), or "?" when the name has no letter. */
export function firstInitial(name: string): string {
  const first = sanitisedFirstName(name, 20);
  if (first === 'there') return '?';
  const ch = Array.from(first)[0] ?? '?';
  return /\p{L}/u.test(ch) ? ch.toLocaleUpperCase('en-IN') : '?';
}

/** "MS U17" from the database's category and age group (both checked shapes); "event" when unknown. */
export function eventLabel(category: string | null, ageGroup: string | null): string {
  const c = category && /^[A-Z]{2}$/.test(category) ? category : null;
  const a = ageGroup && /^[A-Za-z0-9_+]{1,20}$/.test(ageGroup) ? ageGroup.replace(/_/g, ' ') : null;
  if (!c) return 'event';
  return a ? `${c} ${a}` : c;
}

export const REGISTRATION_ADMIN_POINTER = 'Open the admin: More, then Registrations';

export function buildRegistrationAlertText(a: RegistrationAlert, options: { notSaved?: boolean } = {}): string {
  const lines = [
    options.notSaved ? `REGISTRATION NOT SAVED (database problem): ${a.ref}` : `New registration ${a.ref}`,
    `Event: ${eventLabel(a.category, a.ageGroup)}`,
    `Player initial: ${firstInitial(a.player1Name)}`,
  ];
  if (!options.notSaved) {
    lines.push(a.feePaise === null ? 'Fee: none shown' : a.hasPaymentReference ? 'Fee: payment reference given, check it' : 'Fee: not paid yet');
    lines.push(`${REGISTRATION_ADMIN_POINTER} (reference ${a.ref})`);
  } else {
    lines.push(`This registration is NOT saved and this alert holds no contact details. The person was shown a WhatsApp link quoting ${a.ref}: watch your WhatsApp for it.`);
  }
  return Array.from(lines.join('\n')).slice(0, TELEGRAM_TEXT_LIMIT).join('');
}

export interface RegistrationAlertOutcome {
  telegram: 'sent' | 'failed' | 'skipped';
  ownerEmail: 'sent' | 'failed' | 'skipped';
  ownerAlerted: boolean;
}

export async function notifyRegistration(
  ctx: { config: LeadHandlerConfig; fetch: typeof fetch },
  a: RegistrationAlert,
  options: { notSaved?: boolean } = {},
): Promise<RegistrationAlertOutcome> {
  const { config } = ctx;
  const text = buildRegistrationAlertText(a, options);
  const telegramP = (async () => {
    if (!config.telegramBotToken || !config.telegramChatId) return 'skipped' as const;
    const r = await sendTelegram({ fetch: ctx.fetch, token: config.telegramBotToken, chatId: config.telegramChatId, text });
    return r.ok ? ('sent' as const) : ('failed' as const);
  })();
  const emailP = (async () => {
    if (!config.emailEnabled || !config.resendApiKey || !config.emailFrom || !config.ownerEmail) return 'skipped' as const;
    const r = await sendEmail({
      fetch: ctx.fetch,
      apiKey: config.resendApiKey,
      message: {
        from: config.emailFrom,
        to: config.ownerEmail,
        subject: `${options.notSaved ? 'NOT SAVED ' : ''}New registration ${a.ref}`,
        text,
        idempotencyKey: `${a.ref}-${options.notSaved ? 'degraded' : 'owner'}`,
      },
    });
    return r.ok ? ('sent' as const) : ('failed' as const);
  })();
  const [telegram, ownerEmail] = await Promise.all([telegramP.catch(() => 'failed' as const), emailP.catch(() => 'failed' as const)]);
  return { telegram, ownerEmail, ownerAlerted: telegram === 'sent' || ownerEmail === 'sent' };
}
