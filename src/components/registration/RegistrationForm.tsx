/** @jsxImportSource react */
// The registration form island (D-111). One screen: the player name(s), a contact phone, an optional email, the payment reference
// (only for an event with a fee; never card or UPI credentials), the notice tick box, the spam check, Send. The rules are the shared
// ones (src/lib/registration/constants.ts, also run by the server); the body and the answer handling are src/lib/registration/form-logic.ts.
// There is NO age field: a self-claimed age is never asked for or trusted (D-012). Nothing is charged here.
// Accessibility: every control is labelled, errors are linked with aria-describedby, focus moves to the first error, then to the
// confirmation heading on success. Before hydration the controls are disabled (a tap can never post the page).
import { useEffect, useId, useRef, useState } from 'react';
import type { ConsentText } from '../../content/consent';
import type { TurnstileMode, WidgetController } from '../../lib/forms/turnstile';
import { REGISTRATION_ENDPOINT, REGISTRATION_HONEYPOT, REGISTRATION_LIMITS } from '../../lib/registration/constants';
import { EMPTY_REGISTRATION_VALUES, buildRegistrationBody, fieldMessages, readRegistrationAnswer, type RegistrationFormValues } from '../../lib/registration/form-logic';
import { ConsentNotice } from '../forms/ConsentNotice';
import { Honeypot } from '../forms/Honeypot';
import { TurnstileWidget } from '../forms/TurnstileWidget';
import { buttonPrimary, errorClass, fieldWrapClass, hintClass, inputClass, inputErrorClass, labelClass, optionalTagClass, panelClass, stackClass } from '../forms/styles';

export interface RegistrationFormProps {
  eventId: string;
  eventTitle: string;
  playersNeeded: 1 | 2;
  /** "₹500" when the event has a fee, else null (the payment reference box is then not shown). */
  feeText: string | null;
  notice: ConsentText;
  privacyHref: string;
  turnstileMode: TurnstileMode;
  turnstileSiteKey: string | null;
}

type Values = RegistrationFormValues;

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

export default function RegistrationForm({ eventId, eventTitle, playersNeeded, feeText, notice, privacyHref, turnstileMode, turnstileSiteKey }: RegistrationFormProps) {
  const id = useId();
  const fid = (n: string) => `${id}-${n}`;
  const [ready, setReady] = useState(false);
  const [values, setValues] = useState<Values>(EMPTY_REGISTRATION_VALUES);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; waLink: string | null; correlationId: string | null } | null>(null);
  const [done, setDone] = useState<{ ref: string; waLink: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const keyRef = useRef<string | null>(null);
  const startedAt = useRef<number | null>(null);
  const controllerRef = useRef<WidgetController | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const doneRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const touch = () => {
    if (!started) setStarted(true);
    if (startedAt.current === null) startedAt.current = Date.now();
  };
  const set = (name: keyof Values, value: string | boolean) => setValues((v) => ({ ...v, [name]: value }));

  const focusFirstError = (errs: Record<string, string>) => {
    const first = Object.keys(errs)[0];
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`);
    el?.focus();
  };

  const onSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (busy) return;
    touch();
    setProblem(null);
    const token = controllerRef.current?.token() ?? '';
    if (keyRef.current === null) keyRef.current = newKey();
    const built = buildRegistrationBody({
      eventId,
      playersNeeded,
      values: feeText === null ? { ...values, paymentReference: '' } : values,
      consent: { id: notice.id, version: notice.version },
      idempotencyKey: keyRef.current,
      token,
      honeypot,
      elapsedMs: startedAt.current === null ? 0 : Date.now() - startedAt.current,
    });
    if (!built.ok) {
      const msgs = fieldMessages(built.fieldErrors);
      setErrors(msgs);
      setStatus('Some details need fixing. Please check the highlighted boxes.');
      focusFirstError(msgs);
      return;
    }
    setErrors({});
    if (turnstileMode === 'widget' && token === '') {
      setStatus('Please complete the spam check first.');
      boxRef.current?.focus();
      return;
    }
    setBusy(true);
    setStatus('Sending...');
    let answer;
    try {
      const res = await fetch(REGISTRATION_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(built.body) });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      answer = readRegistrationAnswer(res.status, body);
    } catch {
      setBusy(false);
      setStatus(null);
      setProblem({ message: 'The registration could not be sent. Please check your internet connection and try again.', waLink: null, correlationId: null });
      return; // the token was not used: keep it and the same key
    }
    setBusy(false);
    startedAt.current = Date.now();
    if (answer.kind === 'done') {
      setStatus(null);
      setDone({ ref: answer.ref, waLink: answer.waLink });
      return;
    }
    if (answer.resetCheck) controllerRef.current?.reset();
    if (answer.kind === 'fields') {
      setErrors(answer.fieldErrors);
      setStatus(answer.message);
      focusFirstError(answer.fieldErrors);
      return;
    }
    if (answer.newKey) keyRef.current = newKey();
    setStatus(null);
    setProblem({ message: answer.message, waLink: answer.waLink, correlationId: answer.correlationId });
  };

  if (done) {
    return (
      <div className={panelClass} data-registration-done>
        <h2 ref={doneRef} tabIndex={-1} className="text-h3 normal-case">
          Registration received
        </h2>
        <p className="mt-3">
          Your reference is <strong className="ps-num">{done.ref}</strong>. Please keep it.
        </p>
        <p className="mt-3">
          The organiser checks every registration by hand{feeText ? ', including the payment,' : ''} before the entry list is made. Your registration is not an entry until it is confirmed.
        </p>
        {done.waLink ? (
          <p className="mt-4">
            <a className={buttonPrimary} href={done.waLink} rel="noopener">
              Send us the reference on WhatsApp
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  const field = (name: 'player1Name' | 'player2Name' | 'phone' | 'email' | 'paymentReference', label: string, o: { optional?: boolean; hint?: string; type?: string; autoComplete?: string; inputMode?: 'tel' | 'email' | 'text'; maxLength: number }) => {
    const err = errors[name];
    const hintId = o.hint ? fid(`${name}-hint`) : undefined;
    const errId = err ? fid(`${name}-err`) : undefined;
    return (
      <div className={fieldWrapClass}>
        <label className={labelClass} htmlFor={fid(name)}>
          {label}
          {o.optional ? <span className={optionalTagClass}>(optional)</span> : null}
        </label>
        {o.hint ? (
          <p id={hintId} className={hintClass}>
            {o.hint}
          </p>
        ) : null}
        <input
          id={fid(name)}
          name={name}
          data-field={name}
          type={o.type ?? 'text'}
          autoComplete={o.autoComplete ?? 'off'}
          inputMode={o.inputMode}
          maxLength={o.maxLength}
          value={values[name]}
          aria-invalid={err ? true : undefined}
          aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
          className={`${inputClass} ${err ? inputErrorClass : ''}`}
          onChange={(ev) => set(name, ev.target.value)}
        />
        {err ? (
          <p id={errId} className={errorClass}>
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form ref={formRef} className={`${panelClass} ${stackClass}`} noValidate onSubmit={onSubmit} onFocus={touch} onPointerDown={touch} aria-label={`Register for ${eventTitle}`}>
      {/* disabled until the island has hydrated, like LeadForm: nothing can be typed or sent before the checks are in place */}
      <fieldset role="none" disabled={!ready} className={`m-0 min-w-0 border-0 p-0 ${stackClass}`}>
      {!ready ? <p className={hintClass}>Loading the form...</p> : null}
      {field('player1Name', playersNeeded === 2 ? 'Player 1 full name' : 'Player full name', { autoComplete: 'name', maxLength: REGISTRATION_LIMITS.name.max, hint: 'As it should appear on the entry list. Names are shown on the website only after Power Smash has checked them.' })}
      {playersNeeded === 2 ? field('player2Name', 'Partner full name', { maxLength: REGISTRATION_LIMITS.name.max }) : null}
      {field('phone', 'Contact mobile number', { type: 'tel', autoComplete: 'tel', inputMode: 'tel', maxLength: 32, hint: 'We use it only about this registration. It is never shown on the website.' })}
      <label className="flex items-start gap-3 text-body">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={values.whatsappOk} onChange={(ev) => set('whatsappOk', ev.target.checked)} />
        <span>This number is on WhatsApp</span>
      </label>
      {field('email', 'Email', { optional: true, type: 'email', autoComplete: 'email', inputMode: 'email', maxLength: REGISTRATION_LIMITS.email.max })}
      {feeText
        ? field('paymentReference', 'Payment reference', {
            optional: true,
            inputMode: 'text',
            maxLength: 40,
            hint: `The entry fee is ${feeText}. If you have paid, type the transaction reference (for example the 12-digit UPI reference). Never type a card number, PIN or password.`,
          })
        : null}
      <ConsentNotice notice={notice} privacyHref={privacyHref} />
      <div className={fieldWrapClass}>
        <label className="flex items-start gap-3 text-body">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            data-field="consent"
            checked={values.consent}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? fid('consent-err') : undefined}
            onChange={(ev) => set('consent', ev.target.checked)}
          />
          <span>I have read the notice above and agree.</span>
        </label>
        {errors.consent ? (
          <p id={fid('consent-err')} className={errorClass}>
            {errors.consent}
          </p>
        ) : null}
      </div>
      <Honeypot name={REGISTRATION_HONEYPOT} value={honeypot} onChange={(_n, v) => setHoneypot(v)} />
      <TurnstileWidget mode={turnstileMode} siteKey={turnstileSiteKey} started={started} controllerRef={controllerRef} boxRef={boxRef} onSolved={() => setStatus(null)} />
      <p role="status" aria-live="polite" className="text-small font-semibold text-fg">
        {status ?? ''}
      </p>
      {problem ? (
        <div role="alert" className={errorClass}>
          <span>
            {problem.message}
            {problem.correlationId ? ` (code ${problem.correlationId})` : ''}{' '}
            {problem.waLink ? (
              <a href={problem.waLink} rel="noopener">
                Message us on WhatsApp
              </a>
            ) : null}
          </span>
        </div>
      ) : null}
      <button type="submit" className={buttonPrimary} disabled={busy} aria-busy={busy || undefined}>
        {busy ? 'Sending...' : 'Send registration'}
      </button>
      </fieldset>
    </form>
  );
}
