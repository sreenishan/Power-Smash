// POST /api/register as a pure factory (deps injected), the registration twin of the lead handler (src/lib/leads/handler.ts) and built
// from the same parts: the body cap, the same-origin check, the honeypot and fill-time rule, the salted per-connection and per-phone
// counters, Turnstile (fail closed), generic error bodies, the WhatsApp fallback and the degraded mode. src/pages/api/register.ts is a
// thin wrapper.
//
// Order: switch -> method, origin, type, size, JSON, shape and field rules -> honeypot / fill time -> configured? -> per-connection
// limit -> IDEMPOTENCY LOOKUP (before Turnstile: a token works once) -> Turnstile -> RESERVE the global and per-phone slots ->
// registration_submit (the database checks the owner's switch, the event, the category, duplicates and capacity under a row lock)
// -> owner alert (kind, reference, initial, event, pointer only).
//
// Switched OFF unless REGISTRATION_ENABLED is exactly "true" and features.registrations is on: otherwise every request gets `closed` and nothing is read or stored.
// Logging: only the fields of LogEntry (outcome, code, reference, correlation id, status). Never a body, name, phone, email, token,
// payment reference or IP.
import { leadEndpointConfigured, type LeadHandlerConfig } from '../leads/config';
import { readBodyCapped } from '../security/body';
import { clientIpFromHeaders } from '../security/client-ip';
import { normaliseIp, parseHmacKey, pseudonym, randomHex } from '../security/hash';
import { checkAndRecord, createSupabaseRateStore, reserve, type RateRule, type RateStore, type Reservation } from '../security/ratelimit';
import { verifyTurnstile } from '../security/turnstile';
import { createSupabaseRest } from '../supabase/rest';
import { waLink } from '../whatsapp';
import { sameOriginAllowed } from '../leads/handler';
import { features } from '../../content/legal/status';
import { notifyRegistration, type RegistrationAlert } from './alert';
import { REGISTRATION_CONSENT } from './consent';
import {
  MIN_FILL_MS,
  REGISTRATION_ERROR_MESSAGES,
  REGISTRATION_ERROR_STATUS,
  REGISTRATION_LIMITS,
  type RegistrationErrorCode,
  type RegistrationErrorResponse,
  type RegistrationFieldCode,
  type RegistrationSuccessResponse,
} from './constants';
import { validateRegistrationRequest, type RegistrationRequest } from './contract';
import { createRegistrationStore, makeRegistrationRef, type RegistrationStore, type SubmitOutcome } from './store';

/** Engineering defaults, not business facts (the lead endpoint's reasoning: CGNAT makes the per-IP rule generous). */
export const REGISTRATION_RATE_RULES = {
  ip: [{ bucket: 'reg_ip', windowSec: 3600, max: 20 }],
  phone: [
    { bucket: 'reg_phone', windowSec: 3600, max: 5 },
    { bucket: 'reg_phone', windowSec: 86_400, max: 12 },
  ],
  global: [
    { bucket: 'reg_all', windowSec: 3600, max: 60 },
    { bucket: 'reg_all', windowSec: 86_400, max: 300 },
  ],
} as const satisfies Record<string, readonly RateRule[]>;
export const REGISTRATION_GLOBAL_KEY = 'all';

/**
 * The endpoint is on only when the runtime switch REGISTRATION_ENABLED is exactly "true" (anything else, such as "TRUE", "1" or
 * " true", keeps it closed) AND the legal flag features.registrations is on: personal data is never collected before the privacy
 * wording that describes it is published.
 */
export function registrationSwitchOn(env: Readonly<Record<string, unknown>>, flags: unknown = features): boolean {
  const f = flags && typeof flags === 'object' ? (flags as Record<string, unknown>) : {};
  return env.REGISTRATION_ENABLED === 'true' && f.registrations === true;
}

export interface RegistrationLogEntry {
  evt: 'register';
  outcome: string;
  code?: string;
  ref?: string;
  cid: string;
  status?: number;
  detail?: string;
}

export interface RegistrationHandlerDeps {
  /** The lead endpoint's configuration (Supabase, Turnstile, HMAC, Telegram, email, WhatsApp, site origin): one set of settings. */
  config: LeadHandlerConfig;
  /** REGISTRATION_ENABLED is exactly "true" AND features.registrations (registrationSwitchOn). */
  enabled: boolean;
  fetch: typeof fetch;
  now: () => Date;
  randomBytes: (n: number) => Uint8Array;
  waitUntil?: (p: Promise<unknown>) => void;
  log?: (entry: RegistrationLogEntry) => void;
  /** Tests: replace the database calls and counters (default: built from config over Supabase REST with the secret key). */
  store?: RegistrationStore | null;
  rateStore?: RateStore | null;
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
} as const;

const json = (body: unknown, status: number, extra: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

const defaultLog = (entry: RegistrationLogEntry): void => {
  const line = JSON.stringify(entry);
  if (entry.outcome === 'ok' || entry.outcome === 'replay' || entry.outcome === 'closed') console.log(line);
  else console.error(line);
};

export function createRegistrationHandler(deps: RegistrationHandlerDeps) {
  const { config } = deps;
  const log = deps.log ?? defaultLog;
  const hmac = parseHmacKey(config.hmacKey);
  const db =
    config.supabaseUrl && config.supabaseSecretKey
      ? createSupabaseRest({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey, fetch: deps.fetch, allowLocalUrl: config.supabaseAllowLocalUrl })
      : null;
  const store: RegistrationStore | null = deps.store !== undefined ? deps.store : db ? createRegistrationStore(db) : null;
  const rateStore: RateStore | null = deps.rateStore !== undefined ? deps.rateStore : db ? createSupabaseRateStore(db) : null;

  const runLater = (task: () => Promise<void>): Promise<void> | void => {
    const p = task().catch(() => undefined);
    if (deps.waitUntil) {
      deps.waitUntil(p);
      return undefined;
    }
    return p;
  };

  return async function handleRegister(request: Request): Promise<Response> {
    const cid = `c-${randomHex(deps.randomBytes, 4)}`;
    let held: Reservation[] = [];
    const releaseHeld = async (): Promise<void> => {
      const mine = held;
      held = [];
      await Promise.all(mine.map((r) => r.release()));
    };

    const fail = (code: RegistrationErrorCode, o: { status?: number; fieldErrors?: Record<string, RegistrationFieldCode>; retryAfterSec?: number; ref?: string; detail?: string } = {}): Response => {
      const status = o.status ?? REGISTRATION_ERROR_STATUS[code];
      const body: RegistrationErrorResponse = { ok: false, code, message: REGISTRATION_ERROR_MESSAGES[code], correlationId: cid };
      if (o.fieldErrors) body.fieldErrors = o.fieldErrors;
      if (o.retryAfterSec !== undefined) body.retryAfterSec = o.retryAfterSec;
      if (o.ref) body.ref = o.ref;
      if (code === 'degraded' || code === 'server' || code === 'rate_limited') {
        const link = waLink(config.whatsappNumber, `Hi Power Smash, I tried to register for an event on the website but it did not go through.${o.ref ? ` Ref ${o.ref}.` : ''}`);
        if (link) body.waLink = link;
      }
      log({ evt: 'register', outcome: code === 'closed' ? 'closed' : 'error', code, cid, status, detail: o.detail });
      return json(body, status, o.retryAfterSec !== undefined ? { 'retry-after': String(o.retryAfterSec) } : {});
    };

    const success = (ref: string, feePaise: number | null, status: number, replay: boolean): Response => {
      const body: RegistrationSuccessResponse = { ok: true, ref, feePaise };
      const link = waLink(config.whatsappNumber, `Hi Power Smash, I just registered for an event on the website. Ref ${ref}.`);
      if (link) body.waLink = link;
      if (replay) body.replay = true;
      log({ evt: 'register', outcome: replay ? 'replay' : 'ok', ref, cid, status });
      return json(body, status);
    };

    try {
      // 0. The switch. Off = closed, before the body is even read.
      if (request.method !== 'POST') return fail('validation', { status: 405, detail: 'method' });
      if (!deps.enabled) return fail('closed', { detail: 'switched_off' });

      // 1. Origin, content type, size, JSON
      if (!sameOriginAllowed(request, config)) return fail('validation', { status: 403, detail: 'origin' });
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.startsWith('application/json')) return fail('validation', { status: 415, detail: 'content_type' });
      const raw = await readBodyCapped(request, REGISTRATION_LIMITS.bodyBytes);
      if (!raw.ok) return fail('validation', { status: raw.tooLarge ? 413 : 400, detail: raw.tooLarge ? 'too_large' : 'encoding' });
      let body: unknown;
      try {
        body = JSON.parse(raw.text);
      } catch {
        return fail('validation', { status: 400, fieldErrors: { _: 'invalid' }, detail: 'json' });
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail('validation', { status: 400, fieldErrors: { _: 'invalid' }, detail: 'json_shape' });

      // 2. Shape and the shared field rules
      const parsed = validateRegistrationRequest(body);
      if (!parsed.ok) {
        const keys = Object.keys(parsed.fieldErrors);
        if (keys.length > 0 && keys.every((k) => k === 'token')) return fail('turnstile', { detail: 'token_missing' });
        return fail('validation', { fieldErrors: parsed.fieldErrors, detail: keys.slice(0, 6).join(',') });
      }
      const req: RegistrationRequest = parsed.data;

      // 3. Honeypot: a normal-looking success, nothing stored. Too fast: ask for a retry.
      if (req.website.trim() !== '') {
        const fakeRef = makeRegistrationRef(deps.now(), deps.randomBytes);
        log({ evt: 'register', outcome: 'honeypot', cid, status: 201 });
        return json({ ok: true, ref: fakeRef, feePaise: null } satisfies RegistrationSuccessResponse, 201);
      }
      if (req.elapsedMs !== undefined && req.elapsedMs < MIN_FILL_MS) return fail('rate_limited', { retryAfterSec: 5, detail: 'too_fast' });

      // 4. Configuration (fail closed: the WhatsApp fallback)
      if (!leadEndpointConfigured(config) || !store || !rateStore || !hmac) return fail('degraded', { detail: 'unconfigured' });
      const now = deps.now();
      const clientIp = clientIpFromHeaders(request.headers);

      // 5. Per-connection limit. Unlike the lead endpoint, the counters FAIL CLOSED here: a registration holds personal data and its
      //    answers say whether a name and phone are already registered, so without working limits nothing is accepted (degraded, with
      //    the WhatsApp fallback). Usually the database is down anyway when the counters are.
      const ipHash = await pseudonym(hmac, 'ip', normaliseIp(clientIp));
      try {
        const d = await checkAndRecord(rateStore, REGISTRATION_RATE_RULES.ip, ipHash, now);
        if (!d.allowed) return fail('rate_limited', { retryAfterSec: d.retryAfterSec, detail: 'ip' });
      } catch {
        return fail('degraded', { detail: 'counters_down' });
      }

      // 6. Idempotency lookup before Turnstile
      try {
        const l = await store.lookup(req.idempotencyKey, req.eventId, req.phone);
        if (l.outcome === 'same') return success(l.ref, null, 200, true);
        if (l.outcome === 'different') return fail('duplicate', { detail: 'key_reuse' });
      } catch {
        // database trouble: the submit below decides (and degrades)
      }

      // 7. Turnstile (fail closed). The widget is the lead forms' widget, rendered with the same action.
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

      // 8. Reserve the global and per-phone slots (held until stored; given back on any other ending). Fail closed as in step 5.
      {
        const wanted: Array<{ rules: readonly RateRule[]; key: string }> = [
          { rules: REGISTRATION_RATE_RULES.global, key: REGISTRATION_GLOBAL_KEY },
          { rules: REGISTRATION_RATE_RULES.phone, key: await pseudonym(hmac, 'reg_phone', req.phone) },
        ];
        const settled = await Promise.allSettled(wanted.map((w) => reserve(rateStore, w.rules, w.key, now)));
        const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
        held = results.filter((r) => r.allowed);
        if (results.length < wanted.length) {
          await releaseHeld();
          return fail('degraded', { detail: 'counters_down' });
        }
        const refused = results.filter((r) => !r.allowed);
        if (refused.length > 0) {
          await releaseHeld();
          return fail('rate_limited', { retryAfterSec: Math.max(...refused.map((r) => r.retryAfterSec)), detail: 'counters' });
        }
      }

      // 9. Store (a reference collision retries with a new suffix)
      let outcome: SubmitOutcome | null = null;
      let ref = '';
      let dbFailed = false;
      for (let attempt = 0; attempt < 4 && (outcome === null || outcome.outcome === 'ref_taken'); attempt += 1) {
        ref = makeRegistrationRef(now, deps.randomBytes);
        try {
          outcome = await store.submit({
            ref,
            idempotencyKey: req.idempotencyKey,
            eventId: req.eventId,
            player1Name: req.player1Name,
            player2Name: req.player2Name,
            phone: req.phone,
            email: req.email,
            whatsappOk: req.whatsappOk,
            paymentReference: req.paymentReference,
            consentId: REGISTRATION_CONSENT.id,
            consentVersion: REGISTRATION_CONSENT.version,
            consentText: REGISTRATION_CONSENT.text,
            ipHash,
          });
        } catch {
          dbFailed = true;
          break;
        }
      }

      const alert: RegistrationAlert = { ref, player1Name: req.player1Name, category: null, ageGroup: null, feePaise: null, hasPaymentReference: req.paymentReference !== null };
      if (dbFailed || outcome === null || outcome.outcome === 'ref_taken') {
        await releaseHeld();
        const later = runLater(async () => {
          const told = await notifyRegistration({ config, fetch: deps.fetch }, alert, { notSaved: true });
          log({ evt: 'register', outcome: told.ownerAlerted ? 'degraded_alerted' : 'degraded_unalerted', ref, cid });
        });
        if (later) await later;
        return fail('degraded', { detail: 'db', ref });
      }

      switch (outcome.outcome) {
        case 'created': {
          const created = outcome;
          const later = runLater(async () => {
            const r = await notifyRegistration({ config, fetch: deps.fetch }, { ...alert, ref: created.ref, category: created.category, ageGroup: created.ageGroup, feePaise: created.feePaise });
            if (!r.ownerAlerted) log({ evt: 'register', outcome: 'owner_not_alerted', ref: created.ref, cid });
          });
          if (later) await later;
          return success(created.ref, created.feePaise, 201, false);
        }
        case 'replay':
          await releaseHeld();
          return success(outcome.ref, null, 200, true);
        case 'conflict':
          await releaseHeld();
          return fail('duplicate', { detail: 'key_reuse' });
        case 'closed':
        case 'full':
        case 'already_registered':
          await releaseHeld();
          return fail(outcome.outcome, { detail: outcome.outcome });
        case 'partner_required':
        case 'partner_not_allowed':
          await releaseHeld();
          return fail('validation', { fieldErrors: { player2Name: outcome.outcome }, detail: outcome.outcome });
      }
    } catch (e) {
      await releaseHeld().catch(() => undefined);
      log({ evt: 'register', outcome: 'exception', cid, detail: e instanceof Error ? e.name : 'unknown' });
      return fail('server', { detail: 'exception' });
    }
  };
}

export type RegistrationHandler = ReturnType<typeof createRegistrationHandler>;

