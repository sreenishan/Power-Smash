/** @jsxImportSource react */
// The one lead form island, used by all four pages (spec 7.8, 7.10, 7.11, 7.15). The page builds a FormDef (which fields exist)
// at build time and passes it in as a prop; this file draws it and connects it to the tested pure modules in src/lib/forms/.
// Page weight (spec 12.5, review C-1): what loads when the island hydrates is React plus THIS file (the first screen of the form).
// Everything that only matters after a touch is a separate chunk: the engine (Next, Back, Send, validation, payload, sending,
// the rest of the step machine), the spam-check logic, the thank-you screen and the "it did not go through" panel.
// Before the island has hydrated the controls are disabled and say "Loading the form..." (review B-10): a tap or an Enter key
// press can never send the form to the server as a plain page request. Without JavaScript the page explains (FormSection.astro).
// Accessibility: every control is labelled, errors are linked by aria-describedby, focus moves to the first error on a failed Next
// or Send, to the step heading when a step opens, and to the confirmation heading on success.
import { Fragment, Suspense, lazy, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { ConsentText } from '../../content/consent';
import { applyChange, initialState, presetValue, type FlowState } from '../../lib/forms/flow-base';
import { createInteractionGate } from '../../lib/forms/gate';
import type { SendControls } from '../../lib/forms/controller';
import type { FieldValue, FormDef } from '../../lib/forms/types';
import type { TurnstileMode, WidgetController } from '../../lib/forms/turnstile';
import { ConsentNotice } from './ConsentNotice';
import { FieldRenderer } from './FieldRenderer';
import { FormStatus } from './FormStatus';
import { Honeypot } from './Honeypot';
import { StepIndicator } from './StepIndicator';
import { SubmitButton } from './SubmitButton';
import { TurnstileWidget } from './TurnstileWidget';
import { buttonQuiet, panelClass, stackClass } from './styles';

type Engine = typeof import('../../lib/forms/engine');

const Confirmation = lazy(() => import('./Confirmation'));
const FailurePanel = lazy(() => import('./FailurePanel'));

export interface LeadFormProps {
  /** The form definition (a plain JSON object, built by the page at build time from src/lib/forms/defs/). */
  form: FormDef;
  /**
   * The notice shown above the Send button (CONSENT.leadNotice from src/content/consent.ts). The page passes it in as a prop so
   * the consent texts are not part of the JavaScript that loads with the page (the payload builder, which stores its id and
   * version, imports the same file in the part that loads on the first touch).
   */
  leadNotice: ConsentText;
  /** Address of the privacy page (the one URL helper, src/lib/urls.ts). */
  privacyHref: string;
  turnstileMode: TurnstileMode;
  turnstileSiteKey: string | null;
  /** Official WhatsApp number (digits with country code) from site.ts, or null (WhatsApp buttons are hidden). */
  whatsappNumber: string | null;
  /** Reply-time promise from site.ts (for example "24 hours"), or null: then no promise is shown. */
  replyPromise: string | null;
}

/** The state changes the page itself makes: typing (`c`), and anything the engine computes as a pure function of the state (`a`). */
type Act = { t: 'c'; name: string; value: FieldValue } | { t: 'a'; fn: (state: FlowState) => FlowState };

const LOAD_PROBLEM_MESSAGE = 'The form could not finish loading. Please check your internet connection and try again, or message us on WhatsApp.';

export default function LeadForm({ form, leadNotice, privacyHref, turnstileMode, turnstileSiteKey, whatsappNumber, replyPromise }: LeadFormProps) {
  const formId = useId();
  const domId = (name: string) => `${formId}-${name}`;

  const reduce = useMemo(() => (s: FlowState, a: Act): FlowState => (a.t === 'c' ? applyChange(s, form, a.name, a.value) : a.fn(s)), [form]);
  const [state, dispatch] = useReducer(reduce, form, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [honeypot, setHoneypot] = useState('');
  const honeypotRef = useRef(honeypot);
  honeypotRef.current = honeypot;

  // False in the server's HTML and during hydration: the controls are disabled and a hint says the form is loading.
  const [ready, setReady] = useState(false);

  // The engine chunk: fetched once, on the first touch (or the first Next / Send, whichever comes first).
  const engineRef = useRef<Promise<Engine> | null>(null);
  const loadEngine = (): Promise<Engine> => {
    if (engineRef.current === null) {
      engineRef.current = import('../../lib/forms/engine');
      engineRef.current.catch(() => {
        engineRef.current = null; // allow another try
      });
    }
    return engineRef.current;
  };

  // When the visitor started filling in (null until the first touch, and again after a SUCCESSFUL send only: after a field error or a
  // failure the original start is kept, review B-4 and N-2); read by the engine when sending.
  const startedAt = useRef<number | null>(null);
  const [started, setStarted] = useState(false);
  const [gate] = useState(() =>
    createInteractionGate(() => {
      startedAt.current ??= Date.now();
      setStarted(true);
      if (form.steps.length > 1) void import('./ChoiceField'); // the later steps have select and radio boxes: fetch them now
      void loadEngine()
        .then((engine) => engine.trackFormEvent('form_start', { form: form.kind }))
        .catch(() => undefined);
    }),
  );

  const controllerRef = useRef<WidgetController | null>(null);
  const spamBoxRef = useRef<HTMLDivElement | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const statusBoxRef = useRef<HTMLDivElement | null>(null);

  // What the engine needs to act on this form (stable for the life of the page).
  const [ctl] = useState<Omit<SendControls, 'alive'>>(() => ({
    form,
    state: () => stateRef.current,
    apply: (fn) => dispatch({ t: 'a', fn }),
    turnstileMode,
    token: () => controllerRef.current?.token() ?? null,
    resetSpamCheck: () => controllerRef.current?.reset(),
    honeypot: () => honeypotRef.current,
    startedAt: () => startedAt.current,
    restartTimer: () => {
      startedAt.current = null;
    },
    session: { current: null },
    page: () => ({ path: window.location.pathname, search: window.location.search }),
  }));
  const problem = () => dispatch({ t: 'a', fn: (s) => ({ ...s, phase: 'editing', formError: LOAD_PROBLEM_MESSAGE, status: '' }) });
  // The spam check passed: the engine drops the "still finishing" message (it is loaded: the widget starts after the first touch).
  const solved = useState(() => () => void engineRef.current?.then((engine) => engine.clearSpamWait(ctl)).catch(() => undefined))[0];

  const last = form.steps.length - 1;
  const isLast = state.step === last;
  const pending = state.phase === 'submitting';

  // Ready: the page has hydrated, so the controls are switched on. Also here: /book?package=essential (the Services page buttons)
  // and /contact?topic=essential pre-fill one box, only from a short list the page supplied (never text from the address bar).
  useEffect(() => {
    const preset = form.preset;
    if (preset) {
      const field = form.steps.flatMap((s) => s.fields).find((f) => f.name === preset.field);
      const wanted = presetValue(window.location.search, preset, field?.options);
      if (wanted) dispatch({ t: 'c', name: preset.field, value: wanted });
    }
    setReady(true);
  }, [form]);

  // Send: runs when the reducer has accepted the validated form and moved to "submitting".
  useEffect(() => {
    if (state.phase !== 'submitting') return;
    let live = true;
    void import('./Confirmation'); // fetch the screens that may be needed when the answer comes back
    void import('./FailurePanel');
    loadEngine()
      .then((engine) => (live ? engine.sendLead({ ...ctl, alive: () => live }) : undefined))
      .catch(() => (live ? problem() : undefined));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Focus: the reducer says where, we do it once per request after React has drawn the new screen. (The thank-you screen and
  // the failure panel are lazy components that focus their own heading when they appear.)
  useEffect(() => {
    const target = stateRef.current.focus;
    if (!target) return;
    const el =
      target.kind === 'field'
        ? document.getElementById(domId(target.name))
        : target.kind === 'step'
          ? (stepHeadingRef.current ?? statusBoxRef.current)
          : target.kind === 'spamcheck'
            ? (spamBoxRef.current ?? statusBoxRef.current)
            : null;
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.focusSeq]);

  const onChange = (name: string, value: FieldValue) => {
    startedAt.current ??= Date.now();
    dispatch({ t: 'c', name, value });
  };

  /** Next, or Send on the last step (the engine checks the boxes first). */
  const advance = () => {
    loadEngine()
      .then((engine) => engine.advance(ctl))
      .catch(problem);
  };

  // ---- screens -------------------------------------------------------------------------------------------------

  if (state.phase === 'done' && state.reference) {
    return (
      <Suspense fallback={<p role="status" className="text-body">Almost done...</p>}>
        <Confirmation
          kind={form.kind}
          reference={state.reference}
          replyPromise={replyPromise}
          whatsappNumber={whatsappNumber}
          serverWaLink={state.serverWaLink}
        />
      </Suspense>
    );
  }

  // The page never renders the island in this mode (FormSection.astro shows the WhatsApp fallback instead); this is a safety net.
  if (turnstileMode === 'blocked') return null;

  const step = form.steps[state.step]!;
  const nextTitle = form.steps[state.step + 1]?.title;

  return (
    <form
      method="post"
      noValidate
      aria-label={`${form.noun} form`}
      className={panelClass}
      onSubmit={(event) => {
        event.preventDefault();
        advance();
      }}
      onFocusCapture={gate.trigger}
      onPointerDownCapture={gate.trigger}
      onKeyDownCapture={gate.trigger}
    >
      <fieldset role="none" disabled={!ready} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        {ready ? null : (
          <p role="status" className="text-small font-semibold text-fg-muted">
            Loading the form...
          </p>
        )}
        {form.steps.length > 1 ? (
          <div className="flex flex-col gap-3">
            <StepIndicator current={state.step} titles={form.steps.map((s) => s.title)} />
            <h2 ref={stepHeadingRef} tabIndex={-1} className="text-h3 font-bold normal-case">
              {step.title}
            </h2>
            {step.intro ? <p className="text-body text-fg-muted">{step.intro}</p> : null}
          </div>
        ) : null}

        <div className={stackClass}>
          {step.fields.map((field, i) => (
            <Fragment key={field.name}>
              {field.group && field.group !== step.fields[i - 1]?.group ? <h3 className="mt-2 text-h4">{field.group}</h3> : null}
              <FieldRenderer field={field} id={domId(field.name)} value={state.values[field.name]} error={state.errors[field.name]} onChange={onChange} />
            </Fragment>
          ))}
        </div>

        <Honeypot name="website" value={honeypot} onChange={(_name, value) => setHoneypot(value)} />

        {isLast ? (
          <div className="flex flex-col gap-4">
            <ConsentNotice notice={leadNotice} privacyHref={privacyHref} />
            <TurnstileWidget
              mode={turnstileMode}
              siteKey={turnstileSiteKey}
              started={started}
              controllerRef={controllerRef}
              boxRef={spamBoxRef}
              onSolved={solved}
            />
          </div>
        ) : null}

        <div ref={statusBoxRef} tabIndex={-1}>
          <FormStatus status={pending ? state.status : ''} error={state.formError} />
        </div>

        {state.phase === 'failed' && state.failure ? (
          <Suspense fallback={null}>
            <FailurePanel
              form={form}
              values={state.values}
              failure={state.failure}
              whatsappNumber={whatsappNumber}
              serverWaLink={state.serverWaLink}
              onRetry={advance}
            />
          </Suspense>
        ) : null}

        <div className={`flex flex-col-reverse gap-3 sm:flex-row ${state.step > 0 ? 'sm:justify-between' : 'sm:justify-end'}`}>
          {state.step > 0 ? (
            <button
              type="button"
              className={`${buttonQuiet} w-full sm:w-auto`}
              disabled={pending}
              onClick={() =>
                loadEngine()
                  .then((engine) => engine.act(ctl, { type: 'back' }))
                  .catch(problem)
              }
            >
              Back
            </button>
          ) : null}
          <SubmitButton pending={pending}>{isLast ? form.submitLabel : nextTitle ? `Next: ${nextTitle}` : 'Next'}</SubmitButton>
        </div>
      </fieldset>
    </form>
  );
}
