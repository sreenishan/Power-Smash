import { describe, expect, it } from 'vitest';
import { SPAMCHECK_WAIT_MESSAGE, clearSpamcheckWait, createReducer, errorSummary, type FlowAction } from '../../src/lib/forms/flow';
import { applyChange, initialState, presetValue, type FlowState } from '../../src/lib/forms/flow-base';
import { initialValues } from '../../src/lib/forms/definitions';
import type { SubmitOutcome } from '../../src/lib/forms/submit';
import type { FieldValue, FormDef } from '../../src/lib/forms/types';
import { mapFieldErrors, validateStep, validateValues } from '../../src/lib/forms/validate';
import { forms, fullValues, pinClock } from './helpers';

pinClock();

// The reducer takes validation results in its actions (validation loads lazily in the page). These helpers do what
// LeadForm.tsx does: validate with the engine, then dispatch.
// Typing is applied by the page itself (applyChange in flow-base.ts); everything else goes through the reducer.
type Act = FlowAction | 'next' | 'submit' | { type: 'change'; name: string; value: FieldValue };

function stepper(form: FormDef) {
  const reduce = createReducer(form);
  return (state: FlowState, action: Act): FlowState => {
    if (typeof action === 'object' && action.type === 'change') return applyChange(state, form, action.name, action.value);
    if (action === 'next') return reduce(state, { type: 'next', errors: validateStep(form, state.step, state.values) });
    if (action === 'submit') return reduce(state, { type: 'submit', errors: validateValues(form, state.values).fields });
    if (action.type === 'result' && action.outcome.status === 'invalid') {
      return reduce(state, { ...action, serverFieldMessages: mapFieldErrors(form, action.outcome.fieldErrors).fields });
    }
    return reduce(state, action);
  };
}

const book = forms.coverage!;
const reduce = stepper(book);

function run(state: FlowState, ...actions: Act[]): FlowState {
  return actions.reduce((s, a) => reduce(s, a), state);
}

const withValues = (values: Record<string, unknown>, step = 0): FlowState => ({ ...initialState(book), step, values: { ...initialState(book).values, ...values } as FlowState['values'] });

describe('step state machine (coverage: Event > Services > Contact)', () => {
  it('starts on step 1, nothing typed, nothing ticked, no focus request', () => {
    const s = initialState(book);
    expect(s).toMatchObject({ step: 0, phase: 'editing', errors: {}, focus: null, failure: null, reference: null, formError: '' });
    expect(book.steps.map((st) => st.title)).toEqual(['Event', 'Services', 'Contact']);
  });

  it('Next on an empty step 1 stays put, lists the errors, and focuses the first one', () => {
    const s = run(initialState(book), 'next');
    expect(s.step).toBe(0);
    expect(Object.keys(s.errors).sort()).toEqual(['eventName', 'name', 'phone', 'startDate']);
    expect(s.focus).toEqual({ kind: 'field', name: 'eventName' });
    expect(s.formError).toBe(errorSummary(4));
    expect(s.focusSeq).toBe(1);
  });

  it('Next with step 1 filled moves to step 2 and focuses the step heading', () => {
    const s = run(withValues({ eventName: 'Sample Open', startDate: '2027-01-05', name: 'Test Person', phone: '9876543210' }), 'next');
    expect(s.step).toBe(1);
    expect(s.errors).toEqual({});
    expect(s.focus).toEqual({ kind: 'step' });
  });

  it('Back returns to the previous step and keeps what was typed', () => {
    const start = withValues({ eventName: 'Sample Open', startDate: '2027-01-05', name: 'Test Person', phone: '9876543210' });
    const s = run(start, 'next', { type: 'back' });
    expect(s.step).toBe(0);
    expect(s.values.eventName).toBe('Sample Open');
  });

  it('Back on step 1 and Next on the last step do nothing', () => {
    expect(run(initialState(book), { type: 'back' }).step).toBe(0);
    const lastStep = withValues(fullValues.coverage!, 2);
    expect(run(lastStep, 'next')).toBe(lastStep);
  });

  it('typing clears that field error and, when none are left, the error banner', () => {
    let s = run(initialState(book), 'next');
    expect(Object.keys(s.errors)).toHaveLength(4);
    s = run(s, { type: 'change', name: 'eventName', value: 'Sample Open' });
    expect(s.errors.eventName).toBeUndefined();
    expect(s.formError).not.toBe('');
    for (const [name, value] of [['startDate', '2027-01-05'], ['name', 'Test Person'], ['phone', '9876543210']] as const) {
      s = run(s, { type: 'change', name, value });
    }
    expect(s.errors).toEqual({});
    expect(s.formError).toBe('');
  });

  it('Send on an incomplete form jumps to the first step that has an error and focuses it', () => {
    const state = withValues({ ...fullValues.coverage!, eventName: '' }, 2);
    const s = run(state, 'submit');
    expect(s.phase).toBe('editing');
    expect(s.step).toBe(0);
    expect(s.focus).toEqual({ kind: 'field', name: 'eventName' });
    expect(s.errors.eventName).toBe('Please enter the name of the tournament.');
  });

  it('Send on a complete form moves to "submitting" with a polite status and no errors', () => {
    const s = run(withValues(fullValues.coverage!, 2), 'submit');
    expect(s.phase).toBe('submitting');
    expect(s.status).toBe('Sending your coverage request...');
    expect(s.errors).toEqual({});
  });

  it('a second Send while submitting is ignored (no double submit)', () => {
    const sending = run(withValues(fullValues.coverage!, 2), 'submit');
    expect(run(sending, 'submit')).toBe(sending);
    expect(run(sending, 'next')).toBe(sending);
    expect(run(sending, { type: 'back' })).toBe(sending);
  });

  it('the spam check not being ready returns to editing and focuses the spam check', () => {
    const sending = run(withValues(fullValues.coverage!, 2), 'submit');
    const s = run(sending, { type: 'spamcheck-missing', message: 'wait' });
    expect(s.phase).toBe('editing');
    expect(s.formError).toBe('wait');
    expect(s.focus).toEqual({ kind: 'spamcheck' });
    expect(s.values.eventName).toBe('Sample Open 2027');
  });
});

describe('results from the server', () => {
  const sending = () => run(withValues(fullValues.coverage!, 2), 'submit');

  it('success: confirmation with the reference, focus on its heading, personal data wiped from memory', () => {
    const outcome: SubmitOutcome = { status: 'success', ref: 'PS-2027-7K3QDM', waLink: 'https://wa.me/910000000000', replay: false, attempts: 1 };
    const s = run(sending(), { type: 'result', outcome });
    expect(s.phase).toBe('done');
    expect(s.reference).toBe('PS-2027-7K3QDM');
    expect(s.focus).toEqual({ kind: 'confirmation' });
    expect(s.values.name).toBe('');
    expect(s.values.phone).toBe('');
    expect(s.values.addOns).toEqual([]);
    expect(s.serverWaLink).toBe('https://wa.me/910000000000');
  });

  it('server field errors are mapped onto the form, the right step opens and the first error gets focus', () => {
    const outcome: SubmitOutcome = { status: 'invalid', message: 'x', fieldErrors: { phone: 'invalid_phone', notes: 'too_long' }, attempts: 1 };
    const s = run(sending(), { type: 'result', outcome });
    expect(s.phase).toBe('editing');
    expect(s.step).toBe(0);
    expect(s.errors.phone).toBe('Please enter a valid mobile number with 10 digits.');
    expect(s.errors.notes).toBe('This is too long. Please shorten it.');
    expect(s.focus).toEqual({ kind: 'field', name: 'phone' });
    expect(s.values.phone).toBe('98765 43210'); // never lost
  });

  it('server errors about fields the visitor cannot see become a "failed" state with Retry, not a dead end', () => {
    const outcome: SubmitOutcome = { status: 'invalid', message: 'x', fieldErrors: { token: 'invalid' }, correlationId: 'c-1', attempts: 1 };
    const s = run(sending(), { type: 'result', outcome });
    expect(s.phase).toBe('failed');
    expect(s.failure?.retryable).toBe(true);
    expect(s.failure?.correlationId).toBe('c-1');
    expect(s.focus).toEqual({ kind: 'failure' });
  });

  it('a failure keeps every typed value, shows the message, focuses the failure panel on the last step', () => {
    const outcome: SubmitOutcome = {
      status: 'failed',
      code: 'degraded',
      message: 'We could not save your enquiry just now. Please message us on WhatsApp so it is not lost.',
      retryable: true,
      resetSpamCheck: true,
      newKey: false,
      waLink: 'https://wa.me/910000000000',
      attempts: 2,
    };
    const s = run(sending(), { type: 'result', outcome });
    expect(s.phase).toBe('failed');
    expect(s.step).toBe(2);
    expect(s.values).toEqual(withValues(fullValues.coverage!, 2).values);
    expect(s.formError).toBe(outcome.message);
    expect(s.focus).toEqual({ kind: 'failure' });
    expect(s.serverWaLink).toBe('https://wa.me/910000000000');
  });

  it('Try again after a failure validates again and sends again', () => {
    const failed = run(sending(), {
      type: 'result',
      outcome: { status: 'failed', code: 'network', message: 'm', retryable: true, resetSpamCheck: true, newKey: false, attempts: 2 },
    });
    expect(failed.phase).toBe('failed');
    const again = run(failed, 'submit');
    expect(again.phase).toBe('submitting');
    expect(again.failure).toBeNull();
  });
});

describe('contact form: a phone number or an email', () => {
  const contact = forms.general!;
  const r = stepper(contact);

  it('fixing either box clears the shared complaint', () => {
    let s = initialState(contact);
    s = r(s, { type: 'change', name: 'name', value: 'Test Person' });
    s = r(s, { type: 'change', name: 'message', value: 'A real message here.' });
    s = r(s, 'submit');
    expect(s.errors.phone).toBe('Please give a phone number or an email address.');
    expect(s.focus).toEqual({ kind: 'field', name: 'phone' });
    s = r(s, { type: 'change', name: 'email', value: 'a@example.com' });
    expect(s.errors.phone).toBeUndefined();
  });

  it('is a single step: no step indicator, Next never exists', () => {
    expect(contact.steps).toHaveLength(1);
    const s = initialState(contact);
    expect(r(s, 'next')).toBe(s);
  });
});

describe('the other forms have the step counts the plan calls for', () => {
  it('partner = 2 steps, tournament submission = 3 steps, contact = 1 step', () => {
    expect(forms.sponsorship!.steps).toHaveLength(2);
    expect(forms.tournament_submission!.steps).toHaveLength(3);
    expect(forms.general!.steps).toHaveLength(1);
  });

  it('D-025: step 1 of /book, /partner and /tournaments/submit asks for exactly four things', () => {
    for (const kind of ['coverage', 'sponsorship', 'tournament_submission']) {
      expect(forms[kind]!.steps[0]!.fields, kind).toHaveLength(4);
    }
    const names = (kind: string) => forms[kind]!.steps[0]!.fields.map((f) => f.name);
    expect(names('coverage')).toEqual(expect.arrayContaining(['name', 'phone']));
    expect(names('sponsorship')).toEqual(expect.arrayContaining(['name', 'phone']));
    expect(names('tournament_submission')).toEqual(expect.arrayContaining(['name', 'phone']));
  });
});

describe('the part of the machine the page loads at once (flow-base.ts)', () => {
  it('every definition carries its starting values, the same ones the helper computes: nothing typed, nothing ticked', () => {
    for (const [kind, form] of Object.entries(forms)) {
      expect(form.initial, kind).toEqual(initialValues(form));
      expect(initialState(form).values, kind).toBe(form.initial);
    }
  });

  it("typing clears that box's complaint and the banner when none are left, and keeps everything else", () => {
    const start = { ...withValues({ eventName: '' }), errors: { eventName: 'x' }, formError: 'banner' };
    const typed = applyChange(start, book, 'eventName', 'Sample Open');
    expect(typed.values.eventName).toBe('Sample Open');
    expect(typed.errors).toEqual({});
    expect(typed.formError).toBe('');
    expect(typed.step).toBe(start.step);
  });

  it('a successful send returns the form to its starting values', () => {
    const outcome: SubmitOutcome = { status: 'success', ref: 'PS-2027-7K3QDM', replay: false, attempts: 1 };
    const s = run(run(withValues(fullValues.coverage!, 2), 'submit'), { type: 'result', outcome });
    expect(s.values).toEqual(book.initial);
  });
});

describe('B-14: "the spam check is still finishing" goes away when the check passes', () => {
  const sending = () => run(withValues(fullValues.coverage!, 2), 'submit');

  it('the message is set when Send is pressed too early, and cleared when the widget reports a solved check', () => {
    const early = run(sending(), { type: 'spamcheck-missing', message: SPAMCHECK_WAIT_MESSAGE });
    expect(early.formError).toBe(SPAMCHECK_WAIT_MESSAGE);
    const solved = clearSpamcheckWait(early);
    expect(solved.formError).toBe('');
    expect(solved.values).toEqual(early.values); // nothing else changed
    expect(solved.phase).toBe('editing');
  });

  it('a different message (for example "please check 2 boxes") is NOT cleared by a solved check', () => {
    const state = { ...withValues(fullValues.coverage!, 2), formError: errorSummary(2) };
    expect(clearSpamcheckWait(state)).toBe(state);
  });

  it('with no message at all the state object is returned unchanged', () => {
    const state = withValues(fullValues.coverage!, 2);
    expect(clearSpamcheckWait(state)).toBe(state);
  });

  it('the message is plain English and says what to do', () => {
    expect(SPAMCHECK_WAIT_MESSAGE).toMatch(/spam check is still finishing/);
    expect(SPAMCHECK_WAIT_MESSAGE).toMatch(/press the button again/);
  });
});

describe('R-TOPIC and ?package=: the address bar picks from a list, it never supplies text', () => {
  const options = [
    { value: 'essential', label: 'Essential' },
    { value: 'pro', label: 'Pro' },
  ];

  it('a key in the field\'s own options gives that value', () => {
    expect(presetValue('?package=pro', { param: 'package', field: 'packageKey' }, options)).toBe('pro');
    expect(presetValue('?x=1&package=essential', { param: 'package', field: 'packageKey' }, options)).toBe('essential');
  });

  it('with a prefix the value is the prefix plus the NAME from the list, not anything from the address', () => {
    const preset = { param: 'topic', field: 'message', options, prefix: 'I would like to know more about: ' };
    expect(presetValue('?topic=pro', preset)).toBe('I would like to know more about: Pro');
  });

  it('anything that is not in the list gives nothing, including free text, markup and look-alikes', () => {
    const preset = { param: 'topic', field: 'message', options, prefix: 'I would like to know more about: ' };
    for (const search of ['?topic=made-up', '?topic=', '?topic=PRO', '?topic=pro%20', '?topic=%3Cscript%3E', '?topic=Call+me+on+9876543210', '?topic=__proto__', '?topic=constructor', '?other=pro', '']) {
      expect(presetValue(search, preset), search).toBeNull();
    }
  });

  it('no list, no preset, or an empty list gives nothing', () => {
    expect(presetValue('?package=pro', undefined, options)).toBeNull();
    expect(presetValue('?package=pro', { param: 'package', field: 'packageKey' }, undefined)).toBeNull();
    expect(presetValue('?package=pro', { param: 'package', field: 'packageKey' }, [])).toBeNull();
  });
});
