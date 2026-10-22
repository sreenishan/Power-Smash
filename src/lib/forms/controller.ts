// What happens after a visitor touches a form: Next and Back, the full check before Send, and sending. Plain TypeScript with no
// React and no DOM, so Vitest runs it with fakes. The island (src/components/forms/LeadForm.tsx) loads this with the rest of the
// engine on the first focus, tap or key press and hands in a `Controls` object (how to read the latest state, how to change it,
// where the spam check token is). Keeping this out of the part that loads with the page is what keeps the page small (review C-1).
import { MIN_FILL_MS } from '../contracts/lead-constants';
import { buildPayload, kindOf } from './payload';
import { SPAMCHECK_WAIT_MESSAGE, clearSpamcheckWait, createReducer, type FlowAction } from './flow';
import type { FlowState } from './flow-base';
import { createIdempotencySession, type IdempotencySession } from './idempotency';
import { submitLead, type SubmitDeps } from './submit';
import { trackFormEvent } from './events';
import type { TurnstileMode } from './turnstile';
import { mapFieldErrors, validateStep, validateValues } from './validate';
import type { FieldMessages, FormDef } from './types';

/** Used in place of a token in a development build with no site key: the server will still refuse it. */
export const DEV_NO_KEY_TOKEN = 'dev-no-key';

export interface Controls {
  form: FormDef;
  /** The latest state, read when called. */
  state(): FlowState;
  /** Change the state with a pure function of the latest state (the reducer applies it in order with typing). */
  apply(fn: (state: FlowState) => FlowState): void;
}

export interface SendControls extends Controls {
  turnstileMode: TurnstileMode;
  /** The current spam check token, or null when there is none (not solved yet, expired or already used). */
  token(): string | null;
  /** Ask the spam check widget for a new challenge (a token works once). */
  resetSpamCheck(): void;
  /** Value of the honeypot box (normally empty). */
  honeypot(): string;
  /** When the visitor started filling in (ms since the epoch), or null: not touched yet, or the last send succeeded. */
  startedAt(): number | null;
  /**
   * The timer restarts after a SUCCESSFUL send only (R-ELAPSED). After a field error, a failure or a "degraded" answer the original
   * start is kept: restarting there made a quick fix-and-Enter look like a bot that was too fast (review N-2).
   */
  restartTimer(): void;
  /** One idempotency session per form on the page (kept across sends). */
  session: { current: IdempotencySession | null };
  page(): { path: string; search: string };
  /** False once the form has gone away (the visitor left); nothing more is done then. */
  alive(): boolean;
}

const reducers = new WeakMap<FormDef, ReturnType<typeof createReducer>>();
function reducerFor(form: FormDef) {
  let reduce = reducers.get(form);
  if (!reduce) {
    reduce = createReducer(form);
    reducers.set(form, reduce);
  }
  return reduce;
}

/** Run one flow action (Back, dismiss...) on the latest state. */
export function act(ctl: Controls, action: FlowAction): void {
  const reduce = reducerFor(ctl.form);
  ctl.apply((state) => reduce(state, action));
}

/** The spam check has passed: the "still finishing" message goes away (review B-14). */
export function clearSpamWait(ctl: Controls): void {
  ctl.apply(clearSpamcheckWait);
}

/**
 * Next (checks this step) or, on the last step, Send (checks the whole form). The check runs on the LATEST state inside the
 * reducer, so a keystroke typed a moment ago is never lost. `now` is the clock for the date window.
 */
export function advance(ctl: Controls, now?: Date): void {
  const { form } = ctl;
  const reduce = reducerFor(form);
  const last = form.steps.length - 1;
  if (ctl.state().phase === 'submitting') return;
  ctl.apply((state) =>
    state.step < last
      ? reduce(state, { type: 'next', errors: validateStep(form, state.step, state.values, now) })
      : reduce(state, { type: 'submit', errors: validateValues(form, state.values, now).fields }),
  );
}

/**
 * Called when the reducer has accepted the form and moved to "submitting". Builds the payload, sends it, resets the spam check
 * after any answer that used or rejected the token, and reports the result to the reducer. Never throws.
 */
export async function sendLead(ctl: SendControls, deps: Partial<SubmitDeps> = {}, clock: () => number = Date.now): Promise<void> {
  const { form } = ctl;
  const reduce = reducerFor(form);

  const token = ctl.turnstileMode === 'widget' ? ctl.token() : DEV_NO_KEY_TOKEN;
  if (!token) {
    ctl.apply((state) => reduce(state, { type: 'spamcheck-missing', message: SPAMCHECK_WAIT_MESSAGE }));
    return;
  }

  // A send was already made for this form (a field error, a failure, a retry): this one is a retry.
  const retry = ctl.session.current !== null;
  const startedAt = ctl.startedAt();
  let elapsedMs = startedAt === null ? undefined : clock() - startedAt;
  // Belt and braces (N-2): a retry never reports less than the minimum fill time, because the server refuses anything below it
  // as "too fast" and that answer has no Try again. A first send is reported as it is.
  if (retry && elapsedMs !== undefined) elapsedMs = Math.max(elapsedMs, MIN_FILL_MS);
  const page = ctl.page();
  const draft = buildPayload(form, ctl.state().values, {
    idempotencyKey: '',
    token,
    page: page.path,
    search: page.search,
    elapsedMs,
    honeypot: ctl.honeypot(),
  });
  const session = (ctl.session.current ??= createIdempotencySession());
  const outcome = await submitLead({ ...draft, idempotencyKey: session.keyFor(draft) }, deps);

  if (outcome.status === 'success') ctl.restartTimer(); // R-ELAPSED: only a success starts a new fill (N-2: never after a failure)
  if (!ctl.alive()) return;

  let serverFieldMessages: FieldMessages | undefined;
  if (outcome.status === 'success') {
    session.rotate();
    trackFormEvent('form_submit', { form: kindOf(form, ctl.state().values) });
  } else if (outcome.status === 'failed') {
    if (outcome.newKey) session.rotate();
    if (outcome.resetSpamCheck) ctl.resetSpamCheck();
  } else {
    ctl.resetSpamCheck(); // the token was used even though a field was wrong
    serverFieldMessages = mapFieldErrors(form, outcome.fieldErrors).fields;
  }
  ctl.apply((state) => reduce(state, { type: 'result', outcome, serverFieldMessages }));
}
