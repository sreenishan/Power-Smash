// Sending a lead to POST /api/lead (contract: src/lib/contracts/lead-constants.ts and lead.ts).
// Behaviour: JSON body, a timeout per attempt, ONE automatic retry only when no answer came back at all (a dropped connection
// or a timeout: safe because the body carries an idempotency key and the server looks that key up before it looks at the spam
// check token), and a small outcome type the UI can switch on. Never throws. Never logs the body.
// Any answer from the server or a gateway, "degraded" included, is final for this attempt: the Turnstile token may already be
// used (a token works once), so the caller resets the widget and the visitor sends again with a fresh token (review B-5).
import {
  FIELD_ERROR_MESSAGES,
  LEAD_ENDPOINT,
  LEAD_ERROR_CODES,
  LEAD_ERROR_MESSAGES,
  LEAD_LIMITS,
  REF_CODE_PATTERN,
  type FieldErrorCode,
  type LeadErrorCode,
} from '../contracts/lead-constants';

export const SUBMIT_TIMEOUT_MS = 15_000;
export const RETRY_DELAY_MS = 1_200;

/** Failure reasons that only the browser can produce, next to the server's own codes. */
export type ClientFailure = 'network' | 'timeout' | 'too_large' | 'unknown';
export type FailureCode = LeadErrorCode | ClientFailure;

export type SubmitOutcome =
  | { status: 'success'; ref: string; waLink?: string; replay: boolean; attempts: number }
  | {
      status: 'invalid';
      message: string;
      fieldErrors: Record<string, FieldErrorCode>;
      correlationId?: string;
      attempts: number;
    }
  | {
      status: 'failed';
      code: FailureCode;
      /** Plain-English sentence for the status area. */
      message: string;
      /** Show a Retry button (input is kept). */
      retryable: boolean;
      /** The Turnstile token was used or rejected: reset the widget before the next try. */
      resetSpamCheck: boolean;
      /** Start a new idempotency key before the next try. */
      newKey: boolean;
      correlationId?: string;
      retryAfterSec?: number;
      /** The server's own WhatsApp fallback link, used only if the page has no number of its own. */
      waLink?: string;
      attempts: number;
    };

export interface SubmitDeps {
  fetchImpl: typeof fetch;
  endpoint: string;
  timeoutMs: number;
  retryDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultDeps(): SubmitDeps {
  return {
    fetchImpl: (...args) => fetch(...args),
    endpoint: LEAD_ENDPOINT,
    timeoutMs: SUBMIT_TIMEOUT_MS,
    retryDelayMs: RETRY_DELAY_MS,
    sleep: defaultSleep,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Messages in plain English (owner-facing tone: short, no blame, always a next step)
// ---------------------------------------------------------------------------------------------------------------

export const CLIENT_FAILURE_MESSAGES: Record<ClientFailure, string> = {
  network: 'We could not reach our server. Please check your internet connection and try again, or message us on WhatsApp.',
  timeout: 'This is taking too long. Nothing is lost: please try again, or message us on WhatsApp.',
  too_large: 'This enquiry is too long to send. Please shorten the longer boxes and try again.',
  unknown: 'Something went wrong. Please try again, or message us on WhatsApp.',
};

export function messageForCode(code: FailureCode): string {
  return code in CLIENT_FAILURE_MESSAGES ? CLIENT_FAILURE_MESSAGES[code as ClientFailure] : LEAD_ERROR_MESSAGES[code as LeadErrorCode];
}

export function messageForFieldError(code: string | undefined): string {
  return (code && (FIELD_ERROR_MESSAGES as Record<string, string>)[code]) || FIELD_ERROR_MESSAGES.invalid;
}

/** What the UI should do for each failure. Keeps the decisions in one tested place. */
export function failureActions(code: FailureCode): { retryable: boolean; resetSpamCheck: boolean; newKey: boolean } {
  switch (code) {
    case 'turnstile':
      return { retryable: true, resetSpamCheck: true, newKey: false };
    case 'duplicate':
      return { retryable: true, resetSpamCheck: true, newKey: true };
    case 'rate_limited':
      return { retryable: false, resetSpamCheck: true, newKey: false };
    case 'too_large':
      return { retryable: false, resetSpamCheck: false, newKey: false };
    case 'validation':
      return { retryable: true, resetSpamCheck: true, newKey: false };
    default:
      // degraded, server, network, timeout, unknown: the token may or may not have been used; get a fresh one.
      return { retryable: true, resetSpamCheck: true, newKey: false };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing the response
// ---------------------------------------------------------------------------------------------------------------

export type Attempt =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'network' }
  | { kind: 'timeout' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isErrorCode = (v: unknown): v is LeadErrorCode => typeof v === 'string' && (LEAD_ERROR_CODES as readonly string[]).includes(v);

function codeFromStatus(status: number): LeadErrorCode | ClientFailure {
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'turnstile';
  if (status === 400 || status === 422) return 'validation';
  if (status === 503) return 'degraded';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Turn one raw attempt into an outcome (no retry logic here). Exported for tests. */
export function interpretAttempt(attempt: Attempt, attempts: number): SubmitOutcome {
  if (attempt.kind === 'network' || attempt.kind === 'timeout') {
    const code: ClientFailure = attempt.kind;
    return { status: 'failed', code, message: CLIENT_FAILURE_MESSAGES[code], ...failureActions(code), attempts };
  }
  const { status, body } = attempt;

  if (status >= 200 && status < 300 && isRecord(body) && body.ok === true && typeof body.ref === 'string' && REF_CODE_PATTERN.test(body.ref)) {
    return {
      status: 'success',
      ref: body.ref,
      waLink: typeof body.waLink === 'string' ? body.waLink : undefined,
      replay: body.replay === true,
      attempts,
    };
  }

  if (isRecord(body) && body.ok === false && isErrorCode(body.code)) {
    const code = body.code;
    const correlationId = typeof body.correlationId === 'string' ? body.correlationId : undefined;
    if (code === 'validation' && isRecord(body.fieldErrors) && Object.keys(body.fieldErrors).length > 0) {
      const fieldErrors: Record<string, FieldErrorCode> = {};
      for (const [path, value] of Object.entries(body.fieldErrors)) {
        fieldErrors[path] = (typeof value === 'string' ? value : 'invalid') as FieldErrorCode;
      }
      return { status: 'invalid', message: LEAD_ERROR_MESSAGES.validation, fieldErrors, correlationId, attempts };
    }
    return {
      status: 'failed',
      code,
      message: messageForCode(code),
      ...failureActions(code),
      correlationId,
      retryAfterSec: typeof body.retryAfterSec === 'number' ? body.retryAfterSec : undefined,
      waLink: typeof body.waLink === 'string' ? body.waLink : undefined,
      attempts,
    };
  }

  // Not our JSON (a proxy error page, an empty body, a changed API): decide from the HTTP status only.
  const code = codeFromStatus(status);
  return { status: 'failed', code, message: messageForCode(code), ...failureActions(code), attempts };
}

/**
 * Retry once, with the SAME body, only when no answer came back at all (network error or timeout). When something answered,
 * even with "degraded" or a gateway error, the Turnstile token may have been used already (single use), so the same body would
 * fail at the spam check and hide the real message: show the failure, reset the widget, let the visitor send again.
 */
export function isSafeToRetry(outcome: SubmitOutcome, attempt: Attempt): boolean {
  return outcome.status === 'failed' && (attempt.kind === 'network' || attempt.kind === 'timeout');
}

// ---------------------------------------------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------------------------------------------

async function once(body: string, deps: SubmitDeps): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const res = await deps.fetchImpl(deps.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { kind: 'response', status: res.status, body: parsed };
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    return { kind: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Bytes of the JSON body as the server will count them (UTF-8). */
export function bodyBytes(json: string): number {
  return new TextEncoder().encode(json).length;
}

export async function submitLead(payload: unknown, overrides: Partial<SubmitDeps> = {}): Promise<SubmitOutcome> {
  const deps = { ...defaultDeps(), ...overrides };
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return interpretAttempt({ kind: 'response', status: 400, body: null }, 0);
  }
  if (bodyBytes(json) > LEAD_LIMITS.bodyBytes) {
    return { status: 'failed', code: 'too_large', message: CLIENT_FAILURE_MESSAGES.too_large, ...failureActions('too_large'), attempts: 0 };
  }

  const first = await once(json, deps);
  const firstOutcome = interpretAttempt(first, 1);
  if (!isSafeToRetry(firstOutcome, first)) return firstOutcome;

  await deps.sleep(deps.retryDelayMs);
  const second = await once(json, deps);
  return interpretAttempt(second, 2);
}
