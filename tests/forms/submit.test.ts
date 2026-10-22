import { describe, expect, it, vi } from 'vitest';
import { LEAD_ENDPOINT, LEAD_ERROR_CODES, LEAD_ERROR_MESSAGES, LEAD_LIMITS } from '../../src/lib/contracts/lead-constants';
import {
  CLIENT_FAILURE_MESSAGES,
  failureActions,
  interpretAttempt,
  isSafeToRetry,
  messageForCode,
  submitLead,
  type SubmitDeps,
} from '../../src/lib/forms/submit';
import { buildPayload } from '../../src/lib/forms/payload';
import { createIdempotencySession, newIdempotencyKey, payloadFingerprint } from '../../src/lib/forms/idempotency';
import { META, forms, fullValues } from './helpers';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = { ok: true, ref: 'PS-2027-7K3QDM', waLink: 'https://wa.me/910000000000?text=Hi', replay: false };
const failure = (code: string, extra: Record<string, unknown> = {}) => ({ ok: false, code, message: 'm', correlationId: 'c-1', ...extra });

function deps(fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response>): Partial<SubmitDeps> {
  return { fetchImpl: fetchImpl as typeof fetch, sleep: async () => undefined, retryDelayMs: 0, timeoutMs: 50 };
}

const payload = () => ({ ...buildPayload(forms.coverage!, fullValues.coverage!, META) });

describe('submitLead', () => {
  it('posts JSON to /api/lead and returns the reference', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const out = await submitLead(
      payload(),
      deps(async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return json(201, ok);
      }),
    );
    expect(out).toEqual({ status: 'success', ref: 'PS-2027-7K3QDM', waLink: ok.waLink, replay: false, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(LEAD_ENDPOINT);
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.init.body as string).kind).toBe('coverage');
  });

  it('a 200 replay of an earlier submission is still a success with the same reference', async () => {
    const out = await submitLead(payload(), deps(async () => json(200, { ...ok, replay: true })));
    expect(out).toMatchObject({ status: 'success', ref: ok.ref, replay: true });
  });

  it('422 with fieldErrors is "invalid" and is NOT retried', async () => {
    const fetchMock = vi.fn(async () => json(422, failure('validation', { fieldErrors: { phone: 'invalid_phone' } })));
    const out = await submitLead(payload(), deps(fetchMock));
    expect(out).toMatchObject({ status: 'invalid', fieldErrors: { phone: 'invalid_phone' }, correlationId: 'c-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('403 turnstile: reset the spam check, keep the same key, no automatic retry', async () => {
    const fetchMock = vi.fn(async () => json(403, failure('turnstile')));
    const out = await submitLead(payload(), deps(fetchMock));
    expect(out).toMatchObject({ status: 'failed', code: 'turnstile', retryable: true, resetSpamCheck: true, newKey: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('409 duplicate: asks for a new idempotency key', async () => {
    const out = await submitLead(payload(), deps(async () => json(409, failure('duplicate'))));
    expect(out).toMatchObject({ status: 'failed', code: 'duplicate', newKey: true, retryable: true });
  });

  it('429 rate limit: no retry button, no automatic retry, keeps retryAfterSec and the server WhatsApp link', async () => {
    const fetchMock = vi.fn(async () => json(429, failure('rate_limited', { retryAfterSec: 120, waLink: 'https://wa.me/910000000000' })));
    const out = await submitLead(payload(), deps(fetchMock));
    expect(out).toMatchObject({ status: 'failed', code: 'rate_limited', retryable: false, retryAfterSec: 120, waLink: 'https://wa.me/910000000000' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('500 server error: shows the correlation id, no automatic retry', async () => {
    const fetchMock = vi.fn(async () => json(500, failure('server')));
    const out = await submitLead(payload(), deps(fetchMock));
    expect(out).toMatchObject({ status: 'failed', code: 'server', correlationId: 'c-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('503 degraded is NOT retried with the same body: the spam-check token may be used up (B-5)', async () => {
    const fetchMock = vi.fn(async () => json(503, failure('degraded', { waLink: 'https://wa.me/910000000000', ref: 'PS-2027-7K3QDM' })));
    const out = await submitLead(payload(), deps(fetchMock));
    expect(out).toMatchObject({ status: 'failed', code: 'degraded', attempts: 1, resetSpamCheck: true, retryable: true, newKey: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // the visitor sees the real message, not a second spam-check failure
    expect((out as { message: string }).message).toBe(LEAD_ERROR_MESSAGES.degraded);
    expect((out as { message: string }).message).toMatch(/WhatsApp/);
  });

  it('B-5: a Turnstile token that works once is never sent twice after the server answered', async () => {
    const used = new Set<string>();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { token: string };
      if (used.has(body.token)) return json(403, failure('turnstile')); // the real spam check refuses a reused token
      used.add(body.token);
      return json(503, failure('degraded')); // saving failed AFTER the token was checked
    });
    const out = await submitLead(payload(), deps(fetchMock));
    expect(out).toMatchObject({ status: 'failed', code: 'degraded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a dropped connection is retried once with the SAME body (same idempotency key) and can succeed', async () => {
    const bodies: string[] = [];
    let n = 0;
    const out = await submitLead(
      payload(),
      deps(async (_url, init) => {
        bodies.push((init as RequestInit).body as string);
        n += 1;
        if (n === 1) throw new TypeError('Failed to fetch');
        return json(201, ok);
      }),
    );
    expect(out).toMatchObject({ status: 'success', attempts: 2 });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('two network failures end as a "network" failure with Retry and no personal text in the message', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await submitLead(payload(), deps(fetchMock));
    expect(out).toMatchObject({ status: 'failed', code: 'network', retryable: true, resetSpamCheck: true, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((out as { message: string }).message).toBe(CLIENT_FAILURE_MESSAGES.network);
  });

  it('a request that never answers times out (aborted), is retried once, then reported as "timeout"', async () => {
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const out = await submitLead(payload(), deps(fetchMock as never));
    expect(out).toMatchObject({ status: 'failed', code: 'timeout', retryable: true, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a gateway error page (502, 503 or 504, not our JSON) is not retried automatically either: an answer came back', async () => {
    for (const status of [502, 503, 504]) {
      const fetchMock = vi.fn(async () => new Response('<html>Bad gateway</html>', { status }));
      const out = await submitLead(payload(), deps(fetchMock));
      expect(out, String(status)).toMatchObject({ status: 'failed', attempts: 1, retryable: true, resetSpamCheck: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('only "no answer at all" (network error, timeout) is retried, once, with the same body', () => {
    for (const attempt of [{ kind: 'network' }, { kind: 'timeout' }] as const) {
      expect(isSafeToRetry(interpretAttempt(attempt, 1), attempt), attempt.kind).toBe(true);
    }
    for (const status of [200, 201, 400, 403, 409, 413, 422, 429, 500, 502, 503, 504]) {
      const attempt = { kind: 'response', status, body: status === 503 ? { ok: false, code: 'degraded', message: 'm', correlationId: 'c' } : null } as const;
      expect(isSafeToRetry(interpretAttempt(attempt, 1), attempt), String(status)).toBe(false);
    }
  });

  it('an unexpected 200 body is never treated as success', async () => {
    const out = await submitLead(payload(), deps(async () => json(200, { ok: true, ref: 'not-a-reference' })));
    expect(out.status).toBe('failed');
  });

  it('413 from the server and an over-large body are refused with plain wording, without sending', async () => {
    const fetchMock = vi.fn(async () => json(200, ok));
    const huge = { ...payload(), notes: 'x'.repeat(LEAD_LIMITS.bodyBytes + 10) };
    const out = await submitLead(huge, deps(fetchMock));
    expect(out).toMatchObject({ status: 'failed', code: 'too_large', retryable: false, attempts: 0 });
    expect(fetchMock).not.toHaveBeenCalled();

    const out413 = await submitLead(payload(), deps(async () => new Response('', { status: 413 })));
    expect(out413).toMatchObject({ status: 'failed', code: 'too_large' });
  });
});

describe('error code messages are plain English and every server code has one', () => {
  it('has a message for every lead error code and every client failure', () => {
    for (const code of LEAD_ERROR_CODES) {
      expect(messageForCode(code), code).toBe(LEAD_ERROR_MESSAGES[code]);
      expect(messageForCode(code).length).toBeGreaterThan(20);
    }
    for (const [code, message] of Object.entries(CLIENT_FAILURE_MESSAGES)) {
      expect(messageForCode(code as 'network'), code).toBe(message);
    }
  });

  it('no message shows a code, a status number or technical words', () => {
    const all = [...Object.values(LEAD_ERROR_MESSAGES), ...Object.values(CLIENT_FAILURE_MESSAGES)];
    for (const message of all) {
      expect(message).not.toMatch(/\b(4\d\d|5\d\d)\b|undefined|exception|fetch|json|turnstile|idempot|token|null/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });

  it('every message for a problem on our side or on the network points to WhatsApp or a retry', () => {
    for (const code of ['degraded', 'server', 'rate_limited'] as const) expect(messageForCode(code)).toMatch(/WhatsApp/);
    for (const code of ['network', 'timeout'] as const) expect(messageForCode(code)).toMatch(/try again|WhatsApp/i);
  });

  it('failure actions: turnstile and duplicate and unknown codes always allow another try', () => {
    expect(failureActions('turnstile')).toEqual({ retryable: true, resetSpamCheck: true, newKey: false });
    expect(failureActions('duplicate').newKey).toBe(true);
    expect(failureActions('rate_limited').retryable).toBe(false);
    expect(failureActions('unknown').retryable).toBe(true);
  });
});

describe('idempotency key (one per form session, reused on retry)', () => {
  it('is a version 4 UUID, which is what the contract requires', () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('builds a valid UUID from getRandomValues when randomUUID is missing', () => {
    const key = newIdempotencyKey({ getRandomValues: (a) => (a as Uint8Array).fill(255) as never });
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('refuses to invent a key without a secure random source', () => {
    expect(() => newIdempotencyKey({})).toThrow();
  });

  it('the same data gets the same key even though the spam-check token and the timer changed', () => {
    const session = createIdempotencySession();
    const a = buildPayload(forms.coverage!, fullValues.coverage!, { ...META, token: 'first-token', elapsedMs: 5000 });
    const b = buildPayload(forms.coverage!, fullValues.coverage!, { ...META, token: 'second-token', elapsedMs: 9000, idempotencyKey: 'ignored' });
    expect(session.keyFor(a)).toBe(session.keyFor(b));
  });

  it('changed data gets a new key (a correction is never lost to a replay)', () => {
    const session = createIdempotencySession();
    const a = buildPayload(forms.coverage!, fullValues.coverage!, META);
    const b = buildPayload(forms.coverage!, { ...fullValues.coverage!, venue: 'Another hall' }, META);
    expect(session.keyFor(a)).not.toBe(session.keyFor(b));
  });

  it('rotate() starts a new key, used after a duplicate answer or a success', () => {
    const session = createIdempotencySession();
    const p = buildPayload(forms.coverage!, fullValues.coverage!, META);
    const first = session.keyFor(p);
    session.rotate();
    expect(session.keyFor(p)).not.toBe(first);
  });

  it('the fingerprint ignores key order and volatile fields only', () => {
    expect(payloadFingerprint({ a: 1, b: { y: 1, x: 2 }, token: 't', elapsedMs: 1 })).toBe(payloadFingerprint({ b: { x: 2, y: 1 }, a: 1, token: 'other' }));
    expect(payloadFingerprint({ a: 1 })).not.toBe(payloadFingerprint({ a: 2 }));
  });

  it('the retry in submitLead really sends the key that keyFor returned, twice', async () => {
    const session = createIdempotencySession();
    const draft = buildPayload(forms.coverage!, fullValues.coverage!, META);
    const body = { ...draft, idempotencyKey: session.keyFor(draft) };
    const sent: string[] = [];
    let n = 0;
    await submitLead(
      body,
      deps(async (_u, init) => {
        sent.push(JSON.parse((init as RequestInit).body as string).idempotencyKey);
        n += 1;
        if (n === 1) throw new TypeError('x');
        return json(201, ok);
      }),
    );
    expect(new Set(sent).size).toBe(1);
    expect(sent).toHaveLength(2);
  });
});
