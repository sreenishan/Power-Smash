// Shared rules of the email sign-up (D-114), used by BOTH the browser form (src/components/site/notices/SubscribeForm.tsx) and the
// server (src/lib/notices/contract.ts and handlers.ts), like src/lib/contracts/lead-constants.ts for the lead forms. No zod and no
// server-only import here, so the form bundle stays small. A change here is a change on both sides (tests/notices/parity.test.ts).
//
// The answer a visitor gets NEVER says whether an address is already on the list: a new address, a pending one, an active one and a
// too-soon repeat all get exactly SUBSCRIBE_ACCEPTED_MESSAGE with the same status code.

export const SUBSCRIBE_ENDPOINT = '/api/notify/subscribe';
export const CONFIRM_ENDPOINT = '/api/notify/confirm';
export const UNSUBSCRIBE_ENDPOINT = '/api/notify/unsubscribe';

export const SUBSCRIBE_LIMITS = {
  bodyBytes: 4096,
  emailMax: 254,
  tokenMax: 2048,
  websiteMax: 200,
} as const;

/** Faster than this from first touch to send is treated as a bot (the lead forms' rule). */
export const SUBSCRIBE_MIN_FILL_MS = 1500;

/** How long a confirmation link works. MUST equal the interval in public.notify_subscribe (migration 0023). */
export const CONFIRM_TTL_HOURS = 48;

/**
 * The sign-up notice (a DRAFT for the lawyer to re-read before features.emailNotifications goes on). Stored with each sign-up as
 * consent_id and consent_version; a wording change needs a new version.
 */
export const SUBSCRIBE_CONSENT = {
  id: 'email-updates-notice',
  version: '2026-10-31-draft1',
  text:
    'We use your email address only to send Power Smash updates you asked for. We first send one email with a link to confirm the ' +
    'address; nothing else is sent until you open it. Every email has a link to stop the emails at once. We never show your address ' +
    'on the website and never share it except with the service that sends our emails.',
} as const;

export type SubscribeErrorCode = 'validation' | 'turnstile' | 'rate_limited' | 'closed' | 'degraded' | 'server';
export type SubscribeFieldCode = 'required' | 'invalid' | 'too_long';

export const SUBSCRIBE_ACCEPTED_MESSAGE = `Thank you. If this address can get emails from us, we have sent it a link. Open the link within ${CONFIRM_TTL_HOURS} hours to start getting updates. If no email arrives, check your spam folder.`;

export const SUBSCRIBE_ERROR_MESSAGES: Record<SubscribeErrorCode, string> = {
  validation: 'Some details need fixing. Please check the highlighted boxes.',
  turnstile: 'The spam check did not work. Please try it again.',
  rate_limited: 'Too many tries. Please wait a few minutes and try again.',
  closed: 'Email updates are not open yet. Please follow us on the WhatsApp Channel or YouTube for now.',
  degraded: 'We could not take your sign-up just now. Please try again later.',
  server: 'Something went wrong on our side. Please try again later.',
};

export const SUBSCRIBE_ERROR_STATUS: Record<SubscribeErrorCode, number> = {
  validation: 400,
  turnstile: 403,
  rate_limited: 429,
  closed: 409,
  degraded: 503,
  server: 500,
};

export const SUBSCRIBE_FIELD_MESSAGES: Record<'email' | 'consent' | 'adult', Partial<Record<SubscribeFieldCode, string>>> = {
  email: { required: 'Type your email address.', invalid: 'Check the email address, for example name@example.com.', too_long: 'That email address is too long.' },
  consent: { required: 'Tick this box to get the emails.' },
  adult: { required: 'You must be 18 or older to sign up.' },
};

export interface SubscribeAcceptedResponse {
  ok: true;
  message: string;
}
export interface SubscribeErrorResponse {
  ok: false;
  code: SubscribeErrorCode;
  message: string;
  correlationId: string;
  fieldErrors?: Partial<Record<'email' | 'consent' | 'adult' | '_', SubscribeFieldCode>>;
  retryAfterSec?: number;
}

/** The request body the form sends. */
export interface SubscribeBody {
  email: string;
  consent: boolean;
  adult: boolean;
  consentId: string;
  consentVersion: string;
  token: string;
  website: string;
  elapsedMs?: number;
}

/**
 * The browser and the server check the fields the same way: a quick shape check of the address (the server then normalises it with
 * src/lib/security/text.ts normaliseEmail), both boxes ticked.
 */
export function subscribeFieldProblems(v: { email: unknown; consent: unknown; adult: unknown }): Partial<Record<'email' | 'consent' | 'adult', SubscribeFieldCode>> {
  const out: Partial<Record<'email' | 'consent' | 'adult', SubscribeFieldCode>> = {};
  const email = typeof v.email === 'string' ? v.email.trim() : '';
  if (email === '') out.email = 'required';
  else if (email.length > SUBSCRIBE_LIMITS.emailMax) out.email = 'too_long';
  else if (!/^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[A-Za-z]{2,24}$/.test(email)) out.email = 'invalid';
  if (v.consent !== true) out.consent = 'required';
  if (v.adult !== true) out.adult = 'required';
  return out;
}
