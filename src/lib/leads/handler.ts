// POST /api/lead as a pure factory (deps injected: config, fetch, clock, randomness, Worker bindings), so every branch
// is testable with a mocked fetch. src/pages/api/lead.ts is a thin wrapper. Behaviour and order: docs/m1/leads-api.md.
//
// Order matters: validate -> honeypot / fill time -> per-connection limit -> IDEMPOTENCY LOOKUP -> global breaker (check only, an
// early refusal) -> Turnstile (fail closed) -> RESERVE the global (hour and day), per-phone and per-email slots -> insert ->
// consent evidence -> owner alert. The lookup comes before Turnstile because a Turnstile token works only once: a retry of the
// same submission must return the same reference without re-verifying. A reservation records its hit FIRST and then counts, so a
// parallel burst cannot get past a cap (N-5); it is held until the lead is stored and given back on any other ending (a failed
// insert, a lost idempotency race, an exception), so a server-side failure never uses up a visitor's allowance (B-6).
//
// Logging: structured, redacted. Only the fields of `LogEntry` are ever logged: outcome, code, kind, reference,
// correlation id, status numbers. Never a body, name, phone, email, token, IP or URL (D-029).
import { LEAD_ERROR_MESSAGES, LEAD_ERROR_STATUS, LEAD_LIMITS, MIN_FILL_MS, type FieldErrorCode, type LeadErrorCode, type LeadErrorResponse, type LeadKind, type LeadSuccessResponse } from '../contracts/lead-constants';
import { validateLeadRequest, type LeadRequest } from '../contracts/lead';
import { waLink } from '../whatsapp';
import { KIND_LABELS, type AlertLead } from '../notify/telegram';
import { notifyDegraded, notifyFlood, notifyNewLead, type NotifyContext } from '../notify/alerts';
import { readBodyCapped } from '../security/body';
import { clientIpFromHeaders } from '../security/client-ip';
import { normaliseIp, parseHmacKey, pseudonym, randomHex, type ParsedHmacKey } from '../security/hash';
import { GLOBAL_KEY, LEAD_RATE_RULES, RATE_ROW_TTL_SEC, checkAndRecord, checkRules, createSupabaseRateStore, globalLeadRules, reserve, type RateDecision, type RateRule, type RateStore, type Reservation } from '../security/ratelimit';
import { emailRateKey } from '../security/text';
import { verifyTurnstile } from '../security/turnstile';
import { SupabaseError, createSupabaseRest } from '../supabase/rest';
import { leadEndpointConfigured, type LeadHandlerConfig } from './config';
import { makeRefCode } from './ref';
import {
  LEAD_IDEMPOTENCY_CONSTRAINT,
  LEAD_REF_CONSTRAINT,
  consentEntriesOf,
  coverageChildPayload,
  createLeadStore,
  deriveUuid,
  districtOf,
  isConstraint,
  toLeadRow,
  type ConsentEntry,
  type LeadStore,
} from './store';

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface LogEntry {
  evt: 'lead';
  outcome: string;
  code?: string;
  kind?: string;
  ref?: string;
  cid: string;
  status?: number;
  detail?: string;
}

export interface LeadHandlerDeps {
  config: LeadHandlerConfig;
  fetch: typeof fetch;
  now: () => Date;
  randomBytes: (n: number) => Uint8Array;
  /** Workers Rate Limiting binding for the per-connection limit (optional; the database counter always applies). */
  ipLimiter?: RateLimiterBinding;
  /** Cloudflare `ctx.waitUntil`: when given, alerts run after the response is sent. */
  waitUntil?: (p: Promise<unknown>) => void;
  log?: (entry: LogEntry) => void;
}

export interface LeadRequestContext {
  /** Client IP from Cloudflare (`cf-connecting-ip`). Hashed immediately; never stored or logged raw. */
  clientIp?: string | null;
}

const defaultLog = (entry: LogEntry): void => {
  const line = JSON.stringify(entry);
  if (entry.outcome === 'ok' || entry.outcome === 'replay') console.log(line);
  else console.error(line);
};

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
} as const;

const jsonResponse = (body: unknown, status: number, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

export function sameOriginAllowed(request: Request, config: LeadHandlerConfig): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // not a browser cross-site request; Turnstile and the limits still apply
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // ignore
  }
  if (config.siteOrigin) allowed.add(config.siteOrigin);
  return allowed.has(origin);
}

const topicOf = (kind: LeadKind): string => KIND_LABELS[kind].toLowerCase();

export function createLeadHandler(deps: LeadHandlerDeps) {
  const { config } = deps;
  const log = deps.log ?? defaultLog;

  const hmac: ParsedHmacKey | null = parseHmacKey(config.hmacKey);
  // `config.supabaseUrl` is null for a refused URL (S-17), so the secret key can only ever go to the project's own host.
  const db =
    config.supabaseUrl && config.supabaseSecretKey
      ? createSupabaseRest({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey, fetch: deps.fetch, allowLocalUrl: config.supabaseAllowLocalUrl })
      : null;
  const store: LeadStore | null = db ? createLeadStore(db) : null;
  const rateStore: RateStore | null = db ? createSupabaseRateStore(db) : null;

  const notifyCtx = (): NotifyContext => ({ config, fetch: deps.fetch, now: deps.now, store: rateStore, hmac });
  const runLater = (task: () => Promise<void>): Promise<void> | void => {
    const p = task().catch(() => undefined); // alerts never reject into the request
    if (deps.waitUntil) {
      deps.waitUntil(p);
      return undefined;
    }
    return p;
  };

  return async function handleLead(request: Request, ctx: LeadRequestContext = {}): Promise<Response> {
    const cid = `c-${randomHex(deps.randomBytes, 4)}`;
    let kindForLog: string | undefined;
    // Reservations of the global, per-phone and per-email counters held by this request (step 9). Kept only when a lead is stored.
    let held: Reservation[] = [];
    const releaseHeld = async (): Promise<void> => {
      const mine = held;
      held = [];
      await Promise.all(mine.map((r) => r.release()));
    };

    const fail = (code: LeadErrorCode, o: { status?: number; fieldErrors?: Record<string, FieldErrorCode>; fallback?: { kind?: LeadKind; ref?: string }; retryAfterSec?: number; detail?: string } = {}): Response => {
      const status = o.status ?? LEAD_ERROR_STATUS[code];
      const body: LeadErrorResponse = { ok: false, code, message: LEAD_ERROR_MESSAGES[code], correlationId: cid };
      if (o.fieldErrors) body.fieldErrors = o.fieldErrors;
      if (o.retryAfterSec !== undefined) body.retryAfterSec = o.retryAfterSec;
      const kind = o.fallback?.kind;
      const text = `Hi Power Smash, I tried to send ${kind ? `a ${topicOf(kind)}` : 'an enquiry'} on the website but it did not go through.${o.fallback?.ref ? ` Ref ${o.fallback.ref}.` : ''}`;
      const link = waLink(config.whatsappNumber, text);
      if (link && code !== 'validation') body.waLink = link;
      if (o.fallback?.ref) body.ref = o.fallback.ref;
      log({ evt: 'lead', outcome: 'error', code, kind: kindForLog, cid, status, detail: o.detail });
      return jsonResponse(body, status, o.retryAfterSec !== undefined ? { 'retry-after': String(o.retryAfterSec) } : {});
    };

    const success = (ref: string, kind: LeadKind, status: number, replay: boolean): Response => {
      const body: LeadSuccessResponse = { ok: true, ref };
      const link = waLink(config.whatsappNumber, `Hi Power Smash, I just sent a ${topicOf(kind)} on the website. Ref ${ref}.`);
      if (link) body.waLink = link;
      if (replay) body.replay = true;
      log({ evt: 'lead', outcome: replay ? 'replay' : 'ok', kind, ref, cid, status });
      return jsonResponse(body, status);
    };

    try {
      // 1. Method, origin, content type, size, JSON
      if (request.method !== 'POST') return fail('validation', { status: 405, detail: 'method' });
      if (!sameOriginAllowed(request, config)) return fail('validation', { status: 403, detail: 'origin' });
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.startsWith('application/json')) return fail('validation', { status: 415, detail: 'content_type' });
      const body = await readBodyCapped(request, LEAD_LIMITS.bodyBytes);
      if (!body.ok) return fail('validation', { status: body.tooLarge ? 413 : 400, detail: body.tooLarge ? 'too_large' : 'encoding' });
      let json: unknown;
      try {
        json = JSON.parse(body.text);
      } catch {
        return fail('validation', { status: 400, fieldErrors: { _: 'invalid' }, detail: 'json' });
      }

      // 2. Validation. A body that is not a JSON object (null, an array, a number, a string) is a plain 400, never a 500 (B-3).
      if (json === null || typeof json !== 'object' || Array.isArray(json)) {
        return fail('validation', { status: 400, fieldErrors: { _: 'invalid' }, detail: 'json_shape' });
      }
      const parsed = validateLeadRequest(json, { now: deps.now() });
      if (!parsed.ok) {
        const keys = Object.keys(parsed.fieldErrors);
        if (keys.length > 0 && keys.every((k) => k === 'token')) return fail('turnstile', { detail: 'token_missing' });
        const kind = (json as { kind?: unknown }).kind;
        kindForLog = typeof kind === 'string' && kind.length < 30 ? kind : undefined;
        return fail('validation', { fieldErrors: parsed.fieldErrors, detail: keys.slice(0, 6).join(',') });
      }
      const req: LeadRequest = parsed.data;
      kindForLog = req.kind;

      // 3. Honeypot: fake success, store nothing. Too fast: ask for a retry (a person can simply press again).
      if (req.website && req.website.trim() !== '') {
        const fakeRef = makeRefCode(deps.now(), deps.randomBytes);
        log({ evt: 'lead', outcome: 'honeypot', kind: req.kind, cid, status: 201 });
        const link = waLink(config.whatsappNumber, `Hi Power Smash, I just sent a ${topicOf(req.kind)} on the website. Ref ${fakeRef}.`);
        return jsonResponse({ ok: true, ref: fakeRef, ...(link ? { waLink: link } : {}) } satisfies LeadSuccessResponse, 201);
      }
      if (req.elapsedMs !== undefined && req.elapsedMs < MIN_FILL_MS) return fail('rate_limited', { retryAfterSec: 5, detail: 'too_fast', fallback: { kind: req.kind } });

      // 4. Configuration (fail closed for the visitor, loud for the owner through /api/health and logs)
      if (!leadEndpointConfigured(config) || !db || !store || !rateStore || !hmac) {
        return fail('degraded', { detail: 'unconfigured', fallback: { kind: req.kind } });
      }
      const now = deps.now();
      const fallback = { kind: req.kind } as const;

      // 5. Per-connection limit
      const ipHash = await pseudonym(hmac, 'ip', normaliseIp(ctx.clientIp ?? clientIpFromHeaders(request.headers)));
      if (deps.ipLimiter) {
        try {
          const r = await deps.ipLimiter.limit({ key: ipHash });
          if (!r.success) return fail('rate_limited', { retryAfterSec: 60, detail: 'ip_binding', fallback });
        } catch {
          // binding failure: fall through to the database counter
        }
      }
      let limiterDown = false;
      try {
        const d = await checkAndRecord(rateStore, LEAD_RATE_RULES.ip, ipHash, now);
        if (!d.allowed) return fail('rate_limited', { retryAfterSec: d.retryAfterSec, detail: 'ip', fallback });
        // Housekeeping: now and then (about 1 request in 64) delete counter rows older than the longest window.
        if (deps.waitUntil && (deps.randomBytes(1)[0] as number) < 4) {
          deps.waitUntil(rateStore.purgeBefore(new Date(now.getTime() - RATE_ROW_TTL_SEC * 1000).toISOString()).catch(() => undefined));
        }
      } catch {
        limiterDown = true; // counters unavailable: do not block the lead; the insert below will show whether the database is down
      }

      // 6. Idempotency lookup (before Turnstile: the token is single use)
      const sameSubmission = (s: { kind: string; phone: string | null; email: string | null }): boolean =>
        s.kind === req.kind && (s.phone ?? null) === (req.phone ?? null) && (s.email ?? null) === (req.email ?? null);
      const replayOrConflict = async (): Promise<Response | null> => {
        const existing = await store.findByIdempotencyKey(req.idempotencyKey);
        if (!existing) return null;
        return sameSubmission(existing) ? success(existing.ref, req.kind, 200, true) : fail('duplicate', { detail: 'key_reuse', fallback });
      };
      try {
        const r = await replayOrConflict();
        if (r) return r;
      } catch {
        // database trouble: the insert will decide
      }

      // 7. Global circuit breaker, CHECK ONLY (S-6, N-3): too many enquiries stored in the last hour or day, whoever sent them.
      // Checked here, before the Turnstile call, so an obvious flood costs no siteverify calls and does not use up a token. This is
      // only an early refusal: the authoritative, race-free decision is the reservation made after Turnstile (step 9).
      const globalRules = globalLeadRules(config.globalHourlyCap, config.globalDailyCap);
      const refuseGlobal = async (d: RateDecision): Promise<Response> => {
        const rule = d.blockedBy;
        const noticeLater = runLater(async () => {
          await notifyFlood(notifyCtx(), rule?.max ?? config.globalHourlyCap, rule !== undefined && rule.windowSec > 3600 ? 'day' : 'hour');
        });
        if (noticeLater) await noticeLater;
        return fail('rate_limited', { retryAfterSec: d.retryAfterSec, detail: 'global', fallback });
      };
      if (!limiterDown) {
        try {
          const g = await checkRules(rateStore, globalRules, GLOBAL_KEY, now);
          if (!g.allowed) return await refuseGlobal(g);
        } catch {
          // counters unavailable: do not block
        }
      }

      // 8. Turnstile (fail closed)
      const requestHost = (() => {
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
        remoteIp: ctx.clientIp ?? clientIpFromHeaders(request.headers),
        expectedHostnames: config.turnstileHostnames.length > 0 ? config.turnstileHostnames : requestHost ? [requestHost] : [],
        expectedAction: config.turnstileAction,
        testMode: config.turnstileTestMode,
      });
      if (!ts.ok) return fail('turnstile', { detail: ts.reason, fallback });

      // 9. RESERVE the global (hour and day), per-phone and per-email slots (N-5, N-2, N-3). Each reservation records its hit first and
      // then counts, so a parallel burst cannot get past a cap. They are held until the lead is stored; any other ending gives them
      // back (releaseHeld), so a failed insert never uses up a visitor's allowance (B-6). Reserved only AFTER Turnstile: a request
      // that did not pass the spam check never takes a slot. The email key folds `+tag` and Gmail dots (S-6).
      if (!limiterDown) {
        const wanted: Array<{ kind: 'global' | 'contact'; rules: readonly RateRule[]; key: string }> = [{ kind: 'global', rules: globalRules, key: GLOBAL_KEY }];
        try {
          if (req.phone) wanted.push({ kind: 'contact', rules: LEAD_RATE_RULES.phone, key: await pseudonym(hmac, 'phone', req.phone) });
          if (req.email) wanted.push({ kind: 'contact', rules: LEAD_RATE_RULES.email, key: await pseudonym(hmac, 'email', emailRateKey(req.email)) });
        } catch {
          // hashing failed: reserve what we have; never block on it
        }
        // a reservation whose counter failed was already given back and counts as "counters unavailable": fail open for that one
        const settled = await Promise.allSettled(wanted.map((w) => reserve(rateStore, w.rules, w.key, now)));
        const results = settled.flatMap((s, i) => (s.status === 'fulfilled' ? [{ kind: (wanted[i] as { kind: 'global' | 'contact' }).kind, r: s.value }] : []));
        held = results.filter((x) => x.r.allowed).map((x) => x.r);
        const refused = results.filter((x) => !x.r.allowed);
        if (refused.length > 0) {
          await releaseHeld();
          const globalRefusal = refused.find((x) => x.kind === 'global');
          if (globalRefusal) return await refuseGlobal(globalRefusal.r);
          return fail('rate_limited', { retryAfterSec: Math.max(...refused.map((x) => x.r.retryAfterSec)), detail: 'contact', fallback });
        }
      }

      // 10. Insert (random reference; a collision on the reference retries with a new suffix)
      const leadId = crypto.randomUUID();
      let ref = '';
      let inserted = false;
      let dbFailed = false;
      for (let attempt = 0; attempt < 4 && !inserted && !dbFailed; attempt += 1) {
        ref = makeRefCode(now, deps.randomBytes);
        try {
          await store.insertLead(toLeadRow({ id: leadId, ref, req, consentAtIso: now.toISOString(), ipHash, idempotencyKey: req.idempotencyKey }));
          inserted = true;
        } catch (e) {
          if (isConstraint(e, LEAD_IDEMPOTENCY_CONSTRAINT)) {
            // two identical requests raced: the other one won; answer with its reference
            try {
              const r = await replayOrConflict();
              if (r) {
                await releaseHeld(); // the other request won and holds its own slots
                return r;
              }
            } catch {
              // fall through to degraded
            }
            dbFailed = true;
          } else if (isConstraint(e, LEAD_REF_CONSTRAINT)) {
            continue;
          } else {
            dbFailed = true;
            log({ evt: 'lead', outcome: 'db_error', kind: req.kind, cid, status: e instanceof SupabaseError ? e.status : 0, code: e instanceof SupabaseError ? (e.pgCode ?? undefined) : undefined });
          }
        }
      }

      const alertLead: AlertLead & { email?: string } = {
        ref,
        kind: req.kind,
        name: req.name,
        phone: req.phone,
        district: districtOf(req),
        email: req.email,
        sourcePath: req.source?.path,
      };

      if (!inserted) {
        await releaseHeld(); // nothing was stored: the visitor keeps every allowance (B-6)
        // DEGRADED MODE: the enquiry was NOT stored. Tell the owner now (minimal content + "NOT SAVED") and give the
        // visitor the WhatsApp fallback with the provisional reference so the two can be matched.
        const task = async () => {
          const told = await notifyDegraded(notifyCtx(), alertLead);
          log({ evt: 'lead', outcome: told ? 'degraded_alerted' : 'degraded_unalerted', kind: req.kind, ref, cid });
        };
        const later = runLater(task);
        if (later) await later;
        return fail('degraded', { detail: 'db_insert', fallback: { kind: req.kind, ref } });
      }

      // 11. The lead is stored: the reservations made in step 9 STAY (they are the phone, email and global hits, B-6, S-6, N-3). Now write
      // the consent evidence (C-10, D-028). It cannot fail the visitor's request; a row that could not be written is logged for the owner.
      const consentFor = (id: string, entries?: ConsentEntry[]) =>
        store.recordConsent(id, entries ?? consentEntriesOf(req)).catch(() => {
          log({ evt: 'lead', outcome: 'consent_unrecorded', kind: req.kind, ref, cid });
        });
      await consentFor(leadId);

      // 12. Tournament listing with the coverage box ticked: also create a coverage lead (spec 7.8)
      if (req.kind === 'tournament_submission' && req.coverageInterest) {
        const childRef = makeRefCode(now, deps.randomBytes);
        try {
          const childKey = await deriveUuid(req.idempotencyKey, 'coverage');
          const childId = crypto.randomUUID();
          await store.insertLead(
            toLeadRow({
              id: childId,
              ref: childRef,
              req,
              consentAtIso: now.toISOString(),
              ipHash,
              idempotencyKey: childKey,
              parentLeadId: leadId,
              kindOverride: 'coverage',
              payloadOverride: coverageChildPayload(req),
            }),
            { ignoreDuplicates: true },
          );
          await consentFor(childId, [{ id: req.consent.id, version: req.consent.version, given: true }]);
          alertLead.alsoCoverage = childRef;
        } catch {
          alertLead.alsoCoverage = true; // the owner still hears that coverage was asked for
          log({ evt: 'lead', outcome: 'child_failed', kind: req.kind, ref, cid });
        }
      }

      // 13. Owner alert (after the response when waitUntil exists). A failed alert never fails the visitor's request.
      const alertTask = async () => {
        const outcome = await notifyNewLead(notifyCtx(), alertLead);
        try {
          await store.recordAlert(leadId, outcome.ownerAlerted ? 'sent' : 'failed', { telegram: outcome.telegram, owner_email: outcome.ownerEmail, ack_email: outcome.ackEmail }, deps.now().toISOString());
        } catch {
          log({ evt: 'lead', outcome: 'alert_state_unrecorded', kind: req.kind, ref, cid });
        }
        if (!outcome.ownerAlerted) log({ evt: 'lead', outcome: 'owner_not_alerted', kind: req.kind, ref, cid });
      };
      const later = runLater(alertTask);
      if (later) await later;

      return success(ref, req.kind, 201, false);
    } catch (e) {
      await releaseHeld().catch(() => undefined); // an unexpected failure never keeps a slot
      log({ evt: 'lead', outcome: 'exception', cid, kind: kindForLog, detail: e instanceof Error ? e.name : 'unknown' });
      return fail('server', { detail: 'exception', fallback: {} });
    }
  };
}

export type LeadHandler = ReturnType<typeof createLeadHandler>;
