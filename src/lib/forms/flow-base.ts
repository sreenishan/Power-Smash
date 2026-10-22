// The small part of the form state machine that the page needs the moment the island hydrates: the state shape, the starting
// state, typing into a box, and the address-bar pre-fill. Everything else in the machine (Next, Back, Send, results, the failure screens' state) is in
// flow.ts and loads with the engine on the first touch of the form (page budget, spec 12.5, review C-1). Keep this file tiny and
// free of imports other than types.
import type { FieldMessages, FieldValue, FormDef, Option, UrlPreset, Values } from './types';
import type { SubmitOutcome } from './submit';

export type Phase = 'editing' | 'submitting' | 'done' | 'failed';
export type FailedOutcome = Extract<SubmitOutcome, { status: 'failed' }>;

export type FocusTarget =
  | { kind: 'field'; name: string }
  /** The heading of the step that just opened. */
  | { kind: 'step' }
  /** The "we could not send it" panel. */
  | { kind: 'failure' }
  /** The "thank you" heading on the confirmation screen. */
  | { kind: 'confirmation' }
  /** The spam check area, when the visitor sent before the check finished. */
  | { kind: 'spamcheck' };

export interface FlowState {
  step: number;
  values: Values;
  errors: FieldMessages;
  phase: Phase;
  reference: string | null;
  /** WhatsApp link the server sent with a failure or success (used only when the page has no number of its own). */
  serverWaLink: string | null;
  failure: FailedOutcome | null;
  /** Where focus should go; the component acts on it when `focusSeq` changes. */
  focus: FocusTarget | null;
  focusSeq: number;
  /** Polite live message ("Sending..."). */
  status: string;
  /** Assertive live message (something the visitor must fix). */
  formError: string;
}

/** The state a form starts in. The starting values come with the definition (FormDef.initial). */
export function initialState(form: Pick<FormDef, 'initial'>): FlowState {
  return {
    step: 0,
    values: form.initial,
    errors: {},
    phase: 'editing',
    reference: null,
    serverWaLink: null,
    failure: null,
    focus: null,
    focusSeq: 0,
    status: '',
    formError: '',
  };
}

/** Typing into a box (or ticking one): store the value, clear that box's complaint, and clear the banner when none are left. */
export function applyChange(state: FlowState, form: Pick<FormDef, 'kind'>, name: string, value: FieldValue): FlowState {
  const errors = { ...state.errors };
  delete errors[name];
  // "a phone number or an email" (general form): fixing either one clears the shared complaint.
  if (form.kind === 'general' && (name === 'phone' || name === 'email')) {
    delete errors.phone;
    delete errors.email;
  }
  const formError = Object.keys(errors).length === 0 ? '' : state.formError;
  return { ...state, values: { ...state.values, [name]: value }, errors, formError };
}

/**
 * What the address bar may pre-fill (`?package=essential`, `?topic=essential`): the value of `preset.param` is looked up in the
 * allow-list and ONLY a match gives a value (the option's value, or `prefix` + its label). Free text from the address bar is
 * never copied into a field. Returns null when there is nothing to fill.
 */
export function presetValue(search: string, preset: UrlPreset | undefined, fieldOptions?: readonly Option[]): string | null {
  const options = preset?.options ?? fieldOptions;
  if (!preset || !options || options.length === 0) return null;
  const wanted = new URLSearchParams(search).get(preset.param);
  const hit = wanted === null ? undefined : options.find((o) => o.value === wanted);
  return hit ? (preset.prefix ? preset.prefix + hit.label : hit.value) : null;
}
