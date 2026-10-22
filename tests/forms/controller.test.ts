// The engine's Next / Send logic (src/lib/forms/controller.ts), run without React or a browser: a fake "island" supplies the state,
// the spam check token and the timer, a fake fetch plays the Worker. Covers review B-4 (timer clamp and reset), B-5 (no second
// try with a used token), B-14 (stale "still finishing" message) and the order of events on Send.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAD_ERROR_MESSAGES, MIN_FILL_MS } from '../../src/lib/contracts/lead-constants';
import { DEV_NO_KEY_TOKEN, act, advance, clearSpamWait, sendLead, type SendControls } from '../../src/lib/forms/controller';
import { SPAMCHECK_WAIT_MESSAGE } from '../../src/lib/forms/flow';
import { applyChange, initialState, type FlowState } from '../../src/lib/forms/flow-base';
import type { SubmitDeps } from '../../src/lib/forms/submit';
import type { FormDef } from '../../src/lib/forms/types';
import { NOW, forms, fullValues, pinClock } from './helpers';

pinClock();

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = { ok: true, ref: 'PS-2026-7K3QDM', waLink: 'https://wa.me/910000000000?text=Hi', replay: false };
const failure = (code: string, extra: Record<string, unknown> = {}) => ({ ok: false, code, message: 'm', correlationId: 'c-1', ...extra });

interface Harness {
  ctl: SendControls;
  state(): FlowState;
  widget: { token: string | null; resets: number };
  timer: { startedAt: number | null; restarts: number };
  sent: Record<string, unknown>[];
  deps(fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response>): Partial<SubmitDeps>;
}

function harness(form: FormDef, options: { mode?: SendControls['turnstileMode']; step?: number; values?: Record<string, unknown>; startedAt?: number | null } = {}): Harness {
  let state: FlowState = {
    ...initialState(form),
    step: options.step ?? form.steps.length - 1,
    values: { ...initialState(form).values, ...(options.values ?? fullValues[form.kind]!) } as FlowState['values'],
  };
  const widget = { token: 'tok-1.abc' as string | null, resets: 0 };
  const timer = { startedAt: options.startedAt === undefined ? 1_000_000 : options.startedAt, restarts: 0 };
  const sent: Record<string, unknown>[] = [];
  const ctl: SendControls = {
    form,
    state: () => state,
    apply: (fn) => {
      state = fn(state);
    },
    turnstileMode: options.mode ?? 'widget',
    token: () => widget.token,
    resetSpamCheck: () => {
      widget.token = null; // a reset widget has no token until the visitor's browser solves a new check
      widget.resets += 1;
    },
    honeypot: () => '',
    startedAt: () => timer.startedAt,
    restartTimer: () => {
      timer.startedAt = null;
      timer.restarts += 1;
    },
    session: { current: null },
    page: () => ({ path: '/book/', search: '?utm_source=test' }),
    alive: () => true,
  };
  return {
    ctl,
    state: () => state,
    widget,
    timer,
    sent,
    deps: (fetchImpl) => ({
      fetchImpl: ((url: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return fetchImpl(url as never, init);
      }) as typeof fetch,
      sleep: async () => undefined,
      retryDelayMs: 0,
      timeoutMs: 50,
    }),
  };
}

const book = forms.coverage!;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}'))); // the form_submit event goes through this, never to a real server
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Next and Send go through the same checks as the reducer', () => {
  it('Next on an empty first step shows the errors and stays; on a complete first step it moves on', () => {
    const h = harness(book, { step: 0, values: {} });
    advance(h.ctl, NOW);
    expect(h.state().step).toBe(0);
    expect(Object.keys(h.state().errors).sort()).toEqual(['eventName', 'name', 'phone', 'startDate']);
    for (const [name, value] of [['eventName', 'Sample Open'], ['startDate', '2027-01-05'], ['name', 'Test Person'], ['phone', '9876543210']] as const) {
      h.ctl.apply((s) => applyChange(s, book, name, value)); // typing is applied by the page itself
    }
    advance(h.ctl, NOW);
    expect(h.state().step).toBe(1);
    expect(h.state().errors).toEqual({});
  });

  it('Send on the last step checks the whole form and then moves to "submitting"', () => {
    const bad = harness(book, { values: { ...fullValues.coverage!, venue: '=SUM(A1)' } });
    advance(bad.ctl, NOW);
    expect(bad.state().phase).toBe('editing');
    expect(bad.state().errors.venue).toBeDefined();
    const good = harness(book);
    advance(good.ctl, NOW);
    expect(good.state().phase).toBe('submitting');
  });

  it('a second press while submitting does nothing', () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    const sending = h.state();
    advance(h.ctl, NOW);
    expect(h.state()).toBe(sending);
  });

  it('a date outside the window is refused with the one agreed sentence (R-DATE)', () => {
    const h = harness(book, { step: 0, values: { ...fullValues.coverage!, startDate: '2001-05-05' } });
    advance(h.ctl, NOW);
    expect(h.state().errors.startDate).toBe('Please check the date: it should be from yesterday up to three years ahead.');
  });

  it('Back goes to the previous step', () => {
    const h = harness(book, { step: 2 });
    act(h.ctl, { type: 'back' });
    expect(h.state().step).toBe(1);
  });
});

describe('sending', () => {
  it('posts the payload with the token, the idempotency key and the timer, then shows the confirmation', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_012_345);
    expect(h.sent).toHaveLength(1);
    const body = h.sent[0]!;
    expect(body).toMatchObject({ kind: 'coverage', token: 'tok-1.abc', elapsedMs: 12_345, website: '' });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.source).toEqual({ path: '/book/', utm: { source: 'test' } });
    expect(h.state().phase).toBe('done');
    expect(h.state().reference).toBe(ok.ref);
    expect(h.state().values.name).toBe(''); // wiped after a success
  });

  it('a success starts a new key for the next form, and tells the owner-facing analytics only the fixed labels', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)));
    expect(h.ctl.session.current).not.toBeNull();
    const events = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String((c[1] as RequestInit | undefined)?.body ?? ''));
    expect(events.join(' ')).toContain('form_submit');
    expect(events.join(' ')).not.toContain('Test Person');
  });

  it('with no spam check token yet it does not send: it asks the visitor to wait, and focuses the check', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    h.widget.token = null;
    await sendLead(h.ctl, h.deps(async () => json(201, ok)));
    expect(h.sent).toHaveLength(0);
    expect(h.state().phase).toBe('editing');
    expect(h.state().formError).toBe(SPAMCHECK_WAIT_MESSAGE);
    expect(h.state().focus).toEqual({ kind: 'spamcheck' });
    expect(h.state().values.eventName).toBe('Sample Open 2027'); // nothing typed is lost
  });

  it('in a development build with no site key it sends a marker token (the server still refuses it)', async () => {
    const h = harness(book, { mode: 'dev-unconfigured' });
    h.widget.token = null;
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(403, failure('turnstile'))));
    expect(h.sent[0]!.token).toBe(DEV_NO_KEY_TOKEN);
  });

  it('nothing happens if the form went away while the request was out', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    const before = h.state();
    await sendLead({ ...h.ctl, alive: () => false }, h.deps(async () => json(201, ok)));
    expect(h.state()).toBe(before);
  });

  it('a field error from the server resets the spam check, opens the right step and keeps the typing', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(422, failure('validation', { fieldErrors: { phone: 'invalid_phone' } }))));
    expect(h.widget.resets).toBe(1);
    expect(h.state().phase).toBe('editing');
    expect(h.state().step).toBe(0);
    expect(h.state().errors.phone).toBe('Please enter a valid mobile number with 10 digits.');
    expect(h.state().values.phone).toBe('98765 43210');
  });
});

describe('B-4 / R-ELAPSED / N-2: the timer is clamped, restarts only after a SUCCESS, and a retry is never "too fast"', () => {
  /** What the island does on an edit: the timer starts if it is not running (LeadForm.tsx onChange). */
  const edit = (h: Harness, at: number) => {
    h.timer.startedAt ??= at;
  };

  it('a form left open for days sends the 24-hour maximum, not a value the server would refuse', async () => {
    const h = harness(book, { startedAt: 1_000 });
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_000 + 3 * 86_400_000);
    expect(h.sent[0]!.elapsedMs).toBe(86_400_000);
  });

  it('the timer restarts after a SUCCESS only', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)));
    expect(h.timer.restarts).toBe(1);
    expect(h.timer.startedAt).toBeNull();
  });

  it('a failed, degraded, rate-limited, network-failed or field-error send keeps the original start', async () => {
    const answers: [string, () => Promise<Response>][] = [
      ['server error', async () => json(500, failure('server'))],
      ['degraded', async () => json(503, failure('degraded'))],
      ['rate limited', async () => json(429, failure('rate_limited', { retryAfterSec: 60 }))],
      ['spam check refused', async () => json(403, failure('turnstile'))],
      ['field error', async () => json(422, failure('validation', { fieldErrors: { phone: 'invalid_phone' } }))],
      [
        'network down',
        async () => {
          throw new TypeError('Failed to fetch');
        },
      ],
    ];
    for (const [label, answer] of answers) {
      const h = harness(book, { startedAt: 1_000_000 });
      advance(h.ctl, NOW);
      await sendLead(h.ctl, h.deps(answer), () => 1_050_000);
      expect(h.timer.restarts, label).toBe(0);
      expect(h.timer.startedAt, label).toBe(1_000_000);
    }
  });

  it('N-2: after a field error the visitor fixes one character and presses Enter at once: the retry is NOT "too fast"', async () => {
    const h = harness(book, { startedAt: 1_000_000 });
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(422, failure('validation', { fieldErrors: { budgetRange: 'invalid' } }))), () => 1_050_000);
    // the visitor fixes one character 200 ms before pressing Enter
    edit(h, 1_050_800);
    h.widget.token = 'tok-2.abc';
    act(h.ctl, { type: 'dismissFailure' });
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_051_000);
    const second = h.sent[1]!.elapsedMs as number;
    expect(second).toBeGreaterThanOrEqual(1000); // MIN_FILL_MS: below this the server answers rate_limited
    expect(second).toBe(51_000); // counted from the ORIGINAL start
  });

  it('N-2: the same after a degraded answer and after a lost connection', async () => {
    for (const first of [async () => json(503, failure('degraded')), async () => { throw new TypeError('Failed to fetch'); }]) {
      const h = harness(book, { startedAt: 1_000_000 });
      advance(h.ctl, NOW);
      await sendLead(h.ctl, h.deps(first), () => 1_050_000);
      edit(h, 1_050_900);
      h.widget.token = 'tok-2.abc';
      advance(h.ctl, NOW);
      await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_051_000);
      expect(h.sent[h.sent.length - 1]!.elapsedMs as number).toBeGreaterThanOrEqual(1000);
    }
  });

  it('belt and braces: a RETRY never carries less than the minimum fill time, whatever the timer says', async () => {
    const h = harness(book, { startedAt: 1_000_000 });
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(500, failure('server'))), () => 1_050_000);
    h.timer.startedAt = 1_060_000; // a timer that somehow started again just now
    h.widget.token = 'tok-2.abc';
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_060_200);
    expect(h.sent[1]!.elapsedMs).toBe(MIN_FILL_MS);
  });

  it('...but a FIRST send is never raised: a very fast first send is still reported as it is', async () => {
    const h = harness(book, { startedAt: 1_000_000 });
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_000_200);
    expect(h.sent[0]!.elapsedMs).toBe(200);
  });

  it('a first send that stopped early for lack of a spam check token is still a first send', async () => {
    const h = harness(book, { startedAt: 1_000_000 });
    advance(h.ctl, NOW);
    h.widget.token = null;
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_000_300);
    expect(h.sent).toHaveLength(0);
    h.widget.token = 'tok-1.abc';
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_000_400);
    expect(h.sent[0]!.elapsedMs).toBe(400);
  });

  it('a long retry keeps counting from the original start (no cap other than 24 hours)', async () => {
    const h = harness(book, { startedAt: 1_000_000 });
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(500, failure('server'))), () => 1_050_000);
    h.widget.token = 'tok-2.abc';
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)), () => 1_000_000 + 5 * 60_000);
    expect(h.sent[1]!.elapsedMs).toBe(300_000);
  });

  it('before the first touch there is no timer, so none is sent', async () => {
    const h = harness(book, { startedAt: null });
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(201, ok)));
    expect(h.sent[0]).not.toHaveProperty('elapsedMs');
  });
});

describe('B-5: a spam check token is never used twice', () => {
  it('degraded: one request only, the widget is reset, and the real message with WhatsApp is shown', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(async () => json(503, failure('degraded', { waLink: 'https://wa.me/910000000000' }))));
    expect(h.sent).toHaveLength(1);
    expect(h.widget.resets).toBe(1);
    expect(h.widget.token).toBeNull();
    expect(h.state().phase).toBe('failed');
    expect(h.state().formError).toBe(LEAD_ERROR_MESSAGES.degraded);
    expect(h.state().failure).toMatchObject({ code: 'degraded', retryable: true });
    expect(h.state().serverWaLink).toBe('https://wa.me/910000000000');
  });

  it('then "Try again" needs a fresh token: until the check is solved the visitor is asked to wait, and the old token is never re-sent', async () => {
    const used = new Set<string>();
    let saving = false; // the database is down for the first try only
    const server = async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { token: string };
      if (used.has(body.token)) return json(403, failure('turnstile'));
      used.add(body.token);
      return saving ? json(201, ok) : json(503, failure('degraded'));
    };
    const h = harness(book);
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(server));
    expect(h.state().failure?.code).toBe('degraded');

    // "Try again" (the failure panel's button runs advance) before the new check is solved
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(server));
    expect(h.sent).toHaveLength(1); // nothing sent: no token
    expect(h.state().formError).toBe(SPAMCHECK_WAIT_MESSAGE);

    // the check is solved: the stale message goes away (B-14) and the retry works with the NEW token
    h.widget.token = 'tok-2.def';
    clearSpamWait(h.ctl);
    expect(h.state().formError).toBe('');
    saving = true;
    advance(h.ctl, NOW);
    await sendLead(h.ctl, h.deps(server));
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.token).toBe('tok-2.def');
    expect(h.sent[1]!.idempotencyKey).toBe(h.sent[0]!.idempotencyKey); // same enquiry, same key: nothing is duplicated
    expect(h.state().phase).toBe('done');
  });

  it('only a dropped connection is tried again automatically, with the same body; the token is reset if both tries fail', async () => {
    const h = harness(book);
    advance(h.ctl, NOW);
    await sendLead(
      h.ctl,
      h.deps(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]).toEqual(h.sent[1]);
    expect(h.widget.resets).toBe(1);
    expect(h.state().failure?.code).toBe('network');
  });
});

describe('B-14: the "still finishing" message goes away when the check is solved', () => {
  it('clearSpamWait clears that message and nothing else', () => {
    const h = harness(book);
    h.ctl.apply((s) => ({ ...s, formError: SPAMCHECK_WAIT_MESSAGE }));
    clearSpamWait(h.ctl);
    expect(h.state().formError).toBe('');
    h.ctl.apply((s) => ({ ...s, formError: 'Please check 2 boxes marked in red before you continue.' }));
    clearSpamWait(h.ctl);
    expect(h.state().formError).toBe('Please check 2 boxes marked in red before you continue.');
  });
});
