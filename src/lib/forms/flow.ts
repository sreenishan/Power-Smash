// The step state machine for every form: a pure reducer, so Vitest tests it without a DOM and React only renders it.
// It decides: which step is showing, which field errors are on screen, where keyboard focus should go next, what the
// polite and assertive status lines say, and what happens to the visitor's input (kept on every failure, wiped on success).
//
// The state shape, the starting state and typing into a box (applyChange) are in flow-base.ts, which loads with the page; this file
// is the rest of the machine and loads with the engine on the first touch of the form (review C-1). It does not import flow-base
// at run time, so the page's part stays in one chunk.
//
// Validation is NOT done here. The validation rules load on the first touch of the form (a separate chunk, so the page
// stays small until someone uses it), so the caller computes the errors with validate.ts and passes them in the action.
import type { FailedOutcome, FlowState, FocusTarget } from './flow-base';
import { firstErrorField, firstStepWithError } from './steps';
import type { FieldMessages, FormDef } from './types';
import type { SubmitOutcome } from './submit';

export type { FailedOutcome, FlowState, FocusTarget, Phase } from './flow-base';

export type FlowAction =
  /** `errors`: the validation result for the current step (empty object = fine). */
  | { type: 'next'; errors: FieldMessages }
  | { type: 'back' }
  /** `errors`: the validation result for the whole form. */
  | { type: 'submit'; errors: FieldMessages }
  /** `serverFieldMessages`: for an "invalid" outcome, the server's fieldErrors already mapped to field messages. */
  | { type: 'result'; outcome: SubmitOutcome; serverFieldMessages?: FieldMessages }
  | { type: 'dismissFailure' }
  | { type: 'spamcheck-missing'; message: string }
  /** Something stopped the form from working (a chunk did not load): back to editing with a message. */
  | { type: 'problem'; message: string };

/** Shown when the visitor presses Send before the spam check has produced its token. Cleared when the check passes (B-14). */
export const SPAMCHECK_WAIT_MESSAGE = 'The spam check is still finishing. Please wait a moment, then press the button again.';

/** The spam check has passed: drop the "still finishing" message if that is what the banner says (B-14). */
export function clearSpamcheckWait(state: FlowState): FlowState {
  return state.formError === SPAMCHECK_WAIT_MESSAGE ? { ...state, formError: '' } : state;
}

export function errorSummary(count: number): string {
  return `Please check ${count} ${count === 1 ? 'box' : 'boxes'} marked in red before you continue.`;
}

const withFocus = (s: FlowState, focus: FocusTarget): FlowState => ({ ...s, focus, focusSeq: s.focusSeq + 1 });

export function createReducer(form: FormDef) {
  const last = form.steps.length - 1;

  return function reduce(state: FlowState, action: FlowAction): FlowState {
    switch (action.type) {
      case 'next': {
        if (state.phase === 'submitting' || state.phase === 'done' || state.step >= last) return state;
        const errors = action.errors;
        const count = Object.keys(errors).length;
        if (count > 0) {
          const name = firstErrorField(form, errors, state.step);
          return withFocus({ ...state, errors, formError: errorSummary(count), status: '' }, name ? { kind: 'field', name } : { kind: 'step' });
        }
        return withFocus({ ...state, step: state.step + 1, errors: {}, formError: '', status: '' }, { kind: 'step' });
      }

      case 'back': {
        if (state.phase === 'submitting' || state.phase === 'done' || state.step === 0) return state;
        return withFocus({ ...state, step: state.step - 1, formError: '', status: '' }, { kind: 'step' });
      }

      case 'submit': {
        if (state.phase === 'submitting' || state.phase === 'done') return state;
        const errors = action.errors;
        const count = Object.keys(errors).length;
        if (count > 0) {
          const step = Math.max(0, firstStepWithError(form, errors));
          const name = firstErrorField(form, errors, step);
          return withFocus(
            { ...state, step, errors, phase: 'editing', failure: null, formError: errorSummary(count), status: '' },
            name ? { kind: 'field', name } : { kind: 'step' },
          );
        }
        return { ...state, phase: 'submitting', failure: null, formError: '', status: `Sending your ${form.noun}...` };
      }

      case 'spamcheck-missing':
        return withFocus({ ...state, phase: 'editing', formError: action.message, status: '' }, { kind: 'spamcheck' });

      case 'problem':
        return { ...state, phase: 'editing', formError: action.message, status: '' };

      case 'result': {
        const o = action.outcome;
        if (o.status === 'success') {
          return withFocus(
            {
              ...state,
              phase: 'done',
              reference: o.ref,
              serverWaLink: o.waLink ?? null,
              // Personal data is wiped from memory once it has been sent.
              values: form.initial,
              errors: {},
              failure: null,
              formError: '',
              status: '',
            },
            { kind: 'confirmation' },
          );
        }
        if (o.status === 'invalid') {
          const fields = action.serverFieldMessages ?? {};
          const count = Object.keys(fields).length;
          if (count > 0) {
            const step = Math.max(0, firstStepWithError(form, fields));
            const name = firstErrorField(form, fields, step);
            return withFocus(
              { ...state, step, errors: fields, phase: 'editing', failure: null, formError: errorSummary(count), status: '' },
              name ? { kind: 'field', name } : { kind: 'step' },
            );
          }
          // Only fields the visitor cannot see were rejected: treat it like a server problem so the visitor gets Retry and WhatsApp.
          const failure: FailedOutcome = {
            status: 'failed',
            code: 'server',
            message: 'This form has a problem on our side. Please try again, or message us on WhatsApp.',
            retryable: true,
            resetSpamCheck: true,
            newKey: true,
            correlationId: o.correlationId,
            attempts: o.attempts,
          };
          return withFocus({ ...state, phase: 'failed', failure, formError: failure.message, status: '', step: last }, { kind: 'failure' });
        }
        return withFocus(
          {
            ...state,
            phase: 'failed',
            failure: o,
            serverWaLink: o.waLink ?? state.serverWaLink,
            formError: o.message,
            status: '',
            // Show the failure where the Send button is.
            step: last,
          },
          { kind: 'failure' },
        );
      }

      case 'dismissFailure':
        return { ...state, phase: 'editing', failure: null, formError: '' };
    }
  };
}
