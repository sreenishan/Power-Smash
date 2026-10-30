// The three email-list endpoints as pure factories (deps injected), built from the lead endpoint's parts (body cap, same-origin check,
// honeypot and fill time, salted counters, Turnstile fail closed, generic answers). src/pages/api/notify/*.ts are thin wrappers.
//
//  POST /api/notify/subscribe    sign-up. Closed unless NOTIFY_SUBSCRIBE_ENABLED is exactly "true", email can really be sent
//                                (EMAIL_ENABLED exactly "true", the Resend key, the From address, an https site origin) and the owner's
//                                switch in the database is on. The visitor ALWAYS gets the same answer (202, SUBSCRIBE_ACCEPTED_MESSAGE)
//                                whether the address is new, waiting, already on the list or asked again too soon: nothing reveals
//                                whether an address exists. Only a new or waiting address gets the confirmation email.
//  GET/POST /api/notify/confirm  the link in the confirmation email. GET shows a page with one button (link scanners and mail
//                                previews open links: a GET never changes anything); the POST confirms. Same switch.
//  GET/POST /api/notify/unsubscribe  the link in every list email. GET shows a page with one button; POST unsubscribes (the
//                                one-click form of RFC 8058 posts `List-Unsubscribe=One-Click` to the same URL). NEVER behind a
//                                switch: an unsubscribe always works while the database answers. The link carries the subscriber id
//                                and an HMAC of it (tokens.ts); nothing else.
// Logging: only the fields of NotifyLogEntry. Never a body, an address, a token or an IP.
import { leadEndpointConfigured, type LeadHandlerConfig } from '../leads/config';
import { sameOriginAllowed } from '../leads/handler';
import { sendEmail } from '../notify/email';
import { readBodyCapped } from '../security/body';
import { clientIpFromHeaders } from '../security/client-ip';
import { normaliseIp, parseHmacKey, pseudonym, randomHex } from '../security/hash';
import { checkAndRecord, createSupabaseRateStore, reserve, type RateRule, type RateStore, type Reservation } from '../security/ratelimit';
import { emailRateKey, normaliseEmail } from '../security/text';
import { verifyTurnstile } from '../security/turnstile';
import { createSupabaseRest } from '../supabase/rest';
import {
  CONFIRM_ENDPOINT,
  SUBSCRIBE_ACCEPTED_MESSAGE,
  SUBSCRIBE_CONSENT,
  SUBSCRIBE_ERROR_MESSAGES,
  SUBSCRIBE_ERROR_STATUS,
  SUBSCRIBE_LIMITS,
  SUBSCRIBE_MIN_FILL_MS,
  UNSUBSCRIBE_ENDPOINT,
  subscribeFieldProblems,
  type SubscribeAcceptedResponse,
  type SubscribeErrorCode,
  type SubscribeErrorResponse,
  type SubscribeFieldCode,
} from './constants';
import { buildConfirmationEmail } from './emails';
import { createSubscriberStore, type SubscriberStore } from './subscriber-store';
import { CONFIRM_TOKEN_PATTERN, confirmUrl, newConfirmToken, tokenHash, verifyUnsubscribe } from './tokens';

/** Engineering defaults, not business facts. */
export const NOTIFY_RATE_RULES = {
  ip: [{ bucket: 'notify_ip', windowSec: 3600, max: 20 }],
  email: [{ bucket: 'notify_email', windowSec: 86_400, max: 3 }],
  global: [
    { bucket: 'notify_all', windowSec: 3600, max: 100 },
    { bucket: 'notify_all', windowSec: 86_400, max: 500 },
  ],
  link: [{ bucket: 'notify_link_ip', windowSec: 3600, max: 60 }],
} as const satisfies Record<string, readonly RateRule[]>;
export const NOTIFY_GLOBAL_KEY = 'all';

export interface NotifyLogEntry {
  evt: 'notify_subscribe' | 'notify_confirm' | 'notify_unsubscribe';
  outcome: string;
  code?: string;
  cid: string;
  status?: number;
  detail?: string;
}

export interface NotifyHandlerDeps {
  /** The lead endpoint's configuration (Supabase, Turnstile, HMAC, email, site origin): one set of settings. */
  config: LeadHandlerConfig;
  /** NOTIFY_SUBSCRIBE_ENABLED is exactly "true" (switches.ts). The unsubscribe handler ignores it. */
  enabled: boolean;
  fetch: typeof fetch;
  now: () => Date;
  randomBytes: (n: number) => Uint8Array;
  waitUntil?: (p: Promise<unknown>) => void;
  log?: (entry: NotifyLogEntry) => void;
  /** Tests: replace the database calls and counters (default: Supabase REST with the secret key). */
  store?: SubscriberStore | null;
  rateStore?: RateStore | null;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
} as const;

/** The pages carry a token in their address: no referrer leaves them, nothing is framed, no script runs. */
export const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
} as const;

const json = (body: unknown, status: number, extra: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

const defaultLog = (entry: NotifyLogEntry): void => {
  const line = JSON.stringify(entry);
  if (entry.outcome === 'ok' || entry.outcome === 'closed' || entry.outcome === 'page') console.log(line);
  else console.error(line);
};

/** The site origin email links may use: https only (an http origin would put a token on the wire in clear). */
function linkOrigin(config: LeadHandlerConfig): string | null {
  return config.siteOrigin && config.siteOrigin.startsWith('https://') ? config.siteOrigin : null;
}

/** Email can really be sent: the existing EMAIL_ENABLED switch, the Resend key, the From address and an https link origin. */
export function emailReady(config: LeadHandlerConfig): boolean {
  return config.emailEnabled === true && Boolean(config.resendApiKey) && Boolean(config.emailFrom) && linkOrigin(config) !== null;
}

function dbOf(deps: NotifyHandlerDeps) {
  const { config } = deps;
  return config.supabaseUrl && config.supabaseSecretKey
    ? createSupabaseRest({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey, fetch: deps.fetch, allowLocalUrl: config.supabaseAllowLocalUrl })
    : null;
}

// ------------------------------------------------------------------------------------------------------------------ the pages

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);

export interface PageSpec {
  title: string;
  message: string;
  /** A form with one button that POSTs to `action` (a same-site endpoint path with its query). */
  form?: { action: string; button: string; fields?: Record<string, string> };
}

/** A small, plain, script-free page (the endpoint answers it directly; no layout, no styles beyond the browser's). */
export function renderPage(p: PageSpec, status = 200): Response {
  const form = p.form
    ? `<form method="post" action="${escapeHtml(p.form.action)}">${Object.entries(p.form.fields ?? {})
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
        .join('')}<button type="submit">${escapeHtml(p.form.button)}</button></form>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(p.title)} | Power Smash</title></head><body><main><h1>${escapeHtml(p.title)}</h1><p>${escapeHtml(p.message)}</p>${form}<p><a href="/">Go to the Power Smash website</a></p></main></body></html>`;
  return new Response(html, { status, headers: { ...PAGE_HEADERS } });
}

export const PAGES = {
  closed: { title: 'Email updates are not open', message: 'Email updates are not open yet, so this link cannot be used now.' },
  confirmAsk: { title: 'Confirm your email', message: 'Press the button to start getting Power Smash updates by email.' },
  confirmed: { title: 'You are signed up', message: 'Thank you. Your email address is confirmed and you will get Power Smash updates. Every email has a link to stop them.' },
  confirmInvalid: { title: 'This link does not work', message: 'This link was already used, has run out, or is not complete. You can sign up again on the website.' },
  unsubscribeAsk: { title: 'Stop Power Smash emails', message: 'Press the button and we will not send you update emails any more.' },
  unsubscribed: { title: 'You are unsubscribed', message: 'You will not get Power Smash update emails any more.' },
  unsubscribeInvalid: { title: 'This link does not work', message: 'This link is not complete. Use the link at the end of one of our emails.' },
  tooMany: { title: 'Please wait', message: 'Too many tries from this connection. Please wait a few minutes and try again.' },
  down: { title: 'Please try again later', message: 'We could not do this just now. Please try again later.' },
} as const satisfies Record<string, Omit<PageSpec, 'form'>>;

// ------------------------------------------------------------------------------------------------------------------ sign-up

export interface SubscribeRequest {
  email: string;
  token: string;
  website: string;
  elapsedMs: number | undefined;
}

/** Shape and field rules of the sign-up body (the browser runs subscribeFieldProblems too). */
export function validateSubscribeRequest(body: unknown): { ok: true; data: SubscribeRequest } | { ok: false; fieldErrors: NonNullable<SubscribeErrorResponse['fieldErrors']>; tokenOnly: boolean } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fieldErrors: { _: 'invalid' }, tokenOnly: false };
  const b = body as Record<string, unknown>;
  const allowed = new Set(['email', 'consent', 'adult', 'consentId', 'consentVersion', 'token', 'website', 'elapsedMs']);
  if (Object.keys(b).some((k) => !allowed.has(k))) return { ok: false, fieldErrors: { _: 'invalid' }, tokenOnly: false };
  const fieldErrors: NonNullable<SubscribeErrorResponse['fieldErrors']> = { ...subscribeFieldProblems({ email: b.email, consent: b.consent, adult: b.adult }) };
  // the notice the person saw must be the current one (a stale page must be reloaded, never stored under the wrong version)
  if (b.consentId !== SUBSCRIBE_CONSENT.id || b.consentVersion !== SUBSCRIBE_CONSENT.version) fieldErrors.consent = 'invalid';
  if (b.website !== undefined && (typeof b.website !== 'string' || b.website.length > SUBSCRIBE_LIMITS.websiteMax)) fieldErrors._ = 'invalid';
  if (b.elapsedMs !== undefined && (typeof b.elapsedMs !== 'number' || !Number.isFinite(b.elapsedMs))) fieldErrors._ = 'invalid';
  const tokenBad = typeof b.token !== 'string' || b.token.length === 0 || b.token.length > SUBSCRIBE_LIMITS.tokenMax;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, tokenOnly: false };
  if (tokenBad) return { ok: false, fieldErrors: {}, tokenOnly: true };
  return {
    ok: true,
    data: { email: (b.email as string).trim(), token: b.token as string, website: typeof b.website === 'string' ? b.website : '', elapsedMs: typeof b.elapsedMs === 'number' ? Math.max(0, Math.min(b.elapsedMs, 86_400_000)) : undefined },
  };
}

export function createSubscribeHandler(deps: NotifyHandlerDeps) {
  const { config } = deps;
  const log = deps.log ?? defaultLog;
  const hmac = parseHmacKey(config.hmacKey);
  const db = dbOf(deps);
  const store: SubscriberStore | null = deps.store !== undefined ? deps.store : db ? createSubscriberStore(db) : null;
  const rateStore: RateStore | null = deps.rateStore !== undefined ? deps.rateStore : db ? createSupabaseRateStore(db) : null;

  const runLater = (task: () => Promise<void>): Promise<void> | void => {
    const p = task().catch(() => undefined);
    if (deps.waitUntil) {
      deps.waitUntil(p);
      return undefined;
    }
    return p;
  };

  return async function handleSubscribe(request: Request): Promise<Response> {
    const cid = `c-${randomHex(deps.randomBytes, 4)}`;
    let held: Reservation[] = [];
    const releaseHeld = async (): Promise<void> => {
      const mine = held;
      held = [];
      await Promise.all(mine.map((r) => r.release()));
    };
    const fail = (code: SubscribeErrorCode, o: { status?: number; fieldErrors?: SubscribeErrorResponse['fieldErrors']; retryAfterSec?: number; detail?: string } = {}): Response => {
      const status = o.status ?? SUBSCRIBE_ERROR_STATUS[code];
      const body: SubscribeErrorResponse = { ok: false, code, message: SUBSCRIBE_ERROR_MESSAGES[code], correlationId: cid };
      if (o.fieldErrors && Object.keys(o.fieldErrors).length > 0) body.fieldErrors = o.fieldErrors;
      if (o.retryAfterSec !== undefined) body.retryAfterSec = o.retryAfterSec;
      log({ evt: 'notify_subscribe', outcome: code === 'closed' ? 'closed' : 'error', code, cid, status, detail: o.detail });
      return json(body, status, o.retryAfterSec !== undefined ? { 'retry-after': String(o.retryAfterSec) } : {});
    };
    /** The ONE answer for every accepted sign-up, whatever the database said. */
    const accepted = (detail: string): Response => {
      log({ evt: 'notify_subscribe', outcome: 'ok', cid, status: 202, detail });
      return json({ ok: true, message: SUBSCRIBE_ACCEPTED_MESSAGE } satisfies SubscribeAcceptedResponse, 202);
    };

    try {
      if (request.method !== 'POST') return fail('validation', { status: 405, detail: 'method' });
      if (!deps.enabled) return fail('closed', { detail: 'switched_off' });
      if (!emailReady(config)) return fail('closed', { detail: 'email_off' }); // no double opt-in without a working email path

      if (!sameOriginAllowed(request, config)) return fail('validation', { status: 403, detail: 'origin' });
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.startsWith('application/json')) return fail('validation', { status: 415, detail: 'content_type' });
      const raw = await readBodyCapped(request, SUBSCRIBE_LIMITS.bodyBytes);
      if (!raw.ok) return fail('validation', { status: raw.tooLarge ? 413 : 400, detail: raw.tooLarge ? 'too_large' : 'encoding' });
      let body: unknown;
      try {
        body = JSON.parse(raw.text);
      } catch {
        return fail('validation', { fieldErrors: { _: 'invalid' }, detail: 'json' });
      }
      const parsed = validateSubscribeRequest(body);
      if (!parsed.ok) {
        if (parsed.tokenOnly) return fail('turnstile', { detail: 'token_missing' });
        return fail('validation', { fieldErrors: parsed.fieldErrors, detail: Object.keys(parsed.fieldErrors).join(',') });
      }
      const req = parsed.data;

      // Honeypot: the normal answer, nothing stored, nothing sent. Too fast: ask for a retry.
      if (req.website.trim() !== '') return accepted('honeypot');
      if (req.elapsedMs !== undefined && req.elapsedMs < SUBSCRIBE_MIN_FILL_MS) return fail('rate_limited', { retryAfterSec: 5, detail: 'too_fast' });

      if (!leadEndpointConfigured(config) || !store || !rateStore || !hmac) return fail('degraded', { detail: 'unconfigured' });
      const email = normaliseEmail(req.email);
      if (!email) return fail('validation', { fieldErrors: { email: 'invalid' as SubscribeFieldCode }, detail: 'email' });
      const now = deps.now();
      const clientIp = clientIpFromHeaders(request.headers);

      const ipHash = await pseudonym(hmac, 'ip', normaliseIp(clientIp));
      let countersDown = false;
      try {
        const d = await checkAndRecord(rateStore, NOTIFY_RATE_RULES.ip, ipHash, now);
        if (!d.allowed) return fail('rate_limited', { retryAfterSec: d.retryAfterSec, detail: 'ip' });
      } catch {
        countersDown = true;
      }

      const host = (() => {
        try {
          return new URL(request.url).hostname.toLowerCase();
        } catch {
          return '';
        }
      })();
      const ts = await verifyTurnstile({
        fetch: deps.fetch,
        secret: config.turnstileSecret,
        token: req.token,
        remoteIp: clientIp,
        expectedHostnames: config.turnstileHostnames.length > 0 ? config.turnstileHostnames : host ? [host] : [],
        expectedAction: config.turnstileAction,
        testMode: config.turnstileTestMode,
      });
      if (!ts.ok) return fail('turnstile', { detail: ts.reason });

      if (!countersDown) {
        const wanted = [
          { rules: NOTIFY_RATE_RULES.global, key: NOTIFY_GLOBAL_KEY },
          { rules: NOTIFY_RATE_RULES.email, key: await pseudonym(hmac, 'notify_email', emailRateKey(email)) },
        ];
        const settled = await Promise.allSettled(wanted.map((w) => reserve(rateStore, w.rules, w.key, now)));
        const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
        held = results.filter((r) => r.allowed);
        const refused = results.filter((r) => !r.allowed);
        if (refused.length > 0) {
          await releaseHeld();
          // the per-address limit answers like an accepted sign-up: a refusal would tell that the address was tried before
          if (refused.every((r) => r.blockedBy?.bucket === 'notify_email')) return accepted('email_limit');
          return fail('rate_limited', { retryAfterSec: Math.max(...refused.map((r) => r.retryAfterSec)), detail: 'counters' });
        }
      }

      const token = newConfirmToken(deps.randomBytes);
      const hash = await tokenHash(token);
      let outcome;
      try {
        outcome = await store.subscribe({ email, consentId: SUBSCRIBE_CONSENT.id, consentVersion: SUBSCRIBE_CONSENT.version, tokenHash: hash });
      } catch {
        await releaseHeld();
        return fail('degraded', { detail: 'db' });
      }
      if (outcome.outcome === 'closed') {
        await releaseHeld();
        return fail('closed', { detail: 'db_switch_off' });
      }
      if (outcome.outcome === 'send') {
        const origin = linkOrigin(config) as string;
        const mail = buildConfirmationEmail({ confirmUrl: confirmUrl(origin, token) });
        const later = runLater(async () => {
          const r = await sendEmail({
            fetch: deps.fetch,
            apiKey: config.resendApiKey,
            message: { from: config.emailFrom as string, to: email, subject: mail.subject, text: mail.text, idempotencyKey: `nsub-confirm-${hash.slice(0, 40)}` },
          });
          if (!r.ok) log({ evt: 'notify_subscribe', outcome: 'confirmation_not_sent', code: r.reason, cid });
        });
        if (later) await later;
      }
      return accepted(outcome.outcome);
    } catch (e) {
      await releaseHeld().catch(() => undefined);
      log({ evt: 'notify_subscribe', outcome: 'exception', cid, detail: e instanceof Error ? e.name : 'unknown' });
      return fail('server', { detail: 'exception' });
    }
  };
}

// ------------------------------------------------------------------------------------------------------------------ links

/** A form-encoded body (the pages' forms and the RFC 8058 one-click post), capped. Anything else reads as empty. */
async function formFields(request: Request): Promise<URLSearchParams> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded')) return new URLSearchParams();
  const raw = await readBodyCapped(request, SUBSCRIBE_LIMITS.bodyBytes);
  return raw.ok ? new URLSearchParams(raw.text) : new URLSearchParams();
}

async function linkLimitOk(deps: NotifyHandlerDeps, rateStore: RateStore | null, request: Request): Promise<boolean> {
  const hmac = parseHmacKey(deps.config.hmacKey);
  if (!rateStore || !hmac) return true;
  try {
    const ipHash = await pseudonym(hmac, 'ip', normaliseIp(clientIpFromHeaders(request.headers)));
    return (await checkAndRecord(rateStore, NOTIFY_RATE_RULES.link, ipHash, deps.now())).allowed;
  } catch {
    return true; // a counter failure never blocks (the tokens themselves are unguessable)
  }
}

export function createConfirmHandler(deps: NotifyHandlerDeps) {
  const log = deps.log ?? defaultLog;
  const db = dbOf(deps);
  const store: SubscriberStore | null = deps.store !== undefined ? deps.store : db ? createSubscriberStore(db) : null;
  const rateStore: RateStore | null = deps.rateStore !== undefined ? deps.rateStore : db ? createSupabaseRateStore(db) : null;

  return async function handleConfirm(request: Request): Promise<Response> {
    const cid = `c-${randomHex(deps.randomBytes, 4)}`;
    const page = (spec: PageSpec, outcome: string, status = 200): Response => {
      log({ evt: 'notify_confirm', outcome, cid, status });
      return renderPage(spec, status);
    };
    try {
      if (request.method !== 'GET' && request.method !== 'POST') return page(PAGES.confirmInvalid, 'method', 405);
      if (!deps.enabled || !emailReady(deps.config)) return page(PAGES.closed, 'closed');
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const t = url.searchParams.get('t') ?? '';
        if (!CONFIRM_TOKEN_PATTERN.test(t)) return page(PAGES.confirmInvalid, 'bad_link', 400);
        return page({ ...PAGES.confirmAsk, form: { action: CONFIRM_ENDPOINT, button: 'Confirm my email', fields: { t } } }, 'page');
      }
      if (!sameOriginAllowed(request, deps.config)) return page(PAGES.confirmInvalid, 'origin', 403);
      const t = (await formFields(request)).get('t') ?? '';
      if (!CONFIRM_TOKEN_PATTERN.test(t)) return page(PAGES.confirmInvalid, 'bad_link', 400);
      if (!store) return page(PAGES.down, 'unconfigured', 503);
      if (!(await linkLimitOk(deps, rateStore, request))) return page(PAGES.tooMany, 'rate_limited', 429);
      let r;
      try {
        r = await store.confirm(await tokenHash(t));
      } catch {
        return page(PAGES.down, 'db', 503);
      }
      if (r.outcome === 'confirmed') return page(PAGES.confirmed, 'ok');
      if (r.outcome === 'closed') return page(PAGES.closed, 'closed');
      return page(PAGES.confirmInvalid, 'invalid', 400);
    } catch (e) {
      log({ evt: 'notify_confirm', outcome: 'exception', cid, detail: e instanceof Error ? e.name : 'unknown' });
      return renderPage(PAGES.down, 500);
    }
  };
}

export function createUnsubscribeHandler(deps: Omit<NotifyHandlerDeps, 'enabled'> & { enabled?: boolean }) {
  const full: NotifyHandlerDeps = { ...deps, enabled: true }; // never behind a switch
  const log = deps.log ?? defaultLog;
  const db = dbOf(full);
  const store: SubscriberStore | null = deps.store !== undefined ? deps.store : db ? createSubscriberStore(db) : null;
  const rateStore: RateStore | null = deps.rateStore !== undefined ? deps.rateStore : db ? createSupabaseRateStore(db) : null;
  const hmac = parseHmacKey(deps.config.hmacKey);

  return async function handleUnsubscribe(request: Request): Promise<Response> {
    const cid = `c-${randomHex(deps.randomBytes, 4)}`;
    const page = (spec: PageSpec, outcome: string, status = 200): Response => {
      log({ evt: 'notify_unsubscribe', outcome, cid, status });
      return renderPage(spec, status);
    };
    try {
      if (request.method !== 'GET' && request.method !== 'POST') return page(PAGES.unsubscribeInvalid, 'method', 405);
      if (!hmac) return page(PAGES.down, 'unconfigured', 503);
      const url = new URL(request.url);
      let s = url.searchParams.get('s') ?? '';
      let t = url.searchParams.get('t') ?? '';
      if (request.method === 'POST' && (s === '' || t === '')) {
        const f = await formFields(request);
        s = f.get('s') ?? '';
        t = f.get('t') ?? '';
      }
      if (!(await verifyUnsubscribe(hmac, s, t))) return page(PAGES.unsubscribeInvalid, 'bad_link', 400);
      if (request.method === 'GET') {
        const action = `${UNSUBSCRIBE_ENDPOINT}?${new URLSearchParams({ s, t }).toString()}`;
        return page({ ...PAGES.unsubscribeAsk, form: { action, button: 'Stop the emails' } }, 'page');
      }
      // A one-click post comes from the mail provider's server (no Origin header); a browser post must be from this site.
      if (!sameOriginAllowed(request, deps.config)) return page(PAGES.unsubscribeInvalid, 'origin', 403);
      if (!store) return page(PAGES.down, 'unconfigured', 503);
      if (!(await linkLimitOk(full, rateStore, request))) return page(PAGES.tooMany, 'rate_limited', 429);
      try {
        await store.unsubscribe(s);
      } catch {
        return page(PAGES.down, 'db', 503);
      }
      return page(PAGES.unsubscribed, 'ok'); // the same page whether or not the address was still on the list
    } catch (e) {
      log({ evt: 'notify_unsubscribe', outcome: 'exception', cid, detail: e instanceof Error ? e.name : 'unknown' });
      return renderPage(PAGES.down, 500);
    }
  };
}
