/** @jsxImportSource react */
// The email sign-up island (D-114, double opt-in). One email box, two separate unticked boxes (the notice, and 18 or older), the spam
// check, Send. The field rules are the shared ones (src/lib/notices/constants.ts, also run by the server). The answer is the same for
// every address: "if this address can get emails from us, we have sent it a link" (nothing reveals whether it was already on the list).
// No name and no phone number are asked for.
// Accessibility: labelled controls, errors linked with aria-describedby, focus to the first error, then to the confirmation heading.
// Before hydration the controls are disabled (a tap can never post the page).
import { useEffect, useId, useRef, useState } from 'react';
import type { TurnstileMode, WidgetController } from '../../../lib/forms/turnstile';
import {
  SUBSCRIBE_ENDPOINT,
  SUBSCRIBE_ERROR_MESSAGES,
  SUBSCRIBE_FIELD_MESSAGES,
  SUBSCRIBE_LIMITS,
  subscribeFieldProblems,
  type SubscribeBody,
  type SubscribeErrorCode,
} from '../../../lib/notices/constants';
import { Honeypot } from '../../forms/Honeypot';
import { TurnstileWidget } from '../../forms/TurnstileWidget';
import { buttonPrimary, errorClass, fieldWrapClass, inputClass, inputErrorClass, labelClass, panelClass, stackClass } from '../../forms/styles';

export interface SubscribeFormProps {
  notice: { id: string; version: string; text: string };
  privacyHref: string;
  turnstileMode: TurnstileMode;
  turnstileSiteKey: string | null;
}

type Field = 'email' | 'consent' | 'adult';

/** The visitor's sentence for a server answer (pure; tests/notices/subscribe-form.test.ts). */
export function answerText(status: number, body: unknown): { done: true; message: string } | { done: false; message: string; fields: Partial<Record<Field, string>>; resetCheck: boolean } {
  const b = (body ?? {}) as { ok?: unknown; message?: unknown; code?: unknown; fieldErrors?: unknown };
  if (status === 202 && b.ok === true && typeof b.message === 'string') return { done: true, message: b.message };
  const code = (typeof b.code === 'string' && b.code in SUBSCRIBE_ERROR_MESSAGES ? b.code : 'server') as SubscribeErrorCode;
  const fields: Partial<Record<Field, string>> = {};
  if (b.fieldErrors && typeof b.fieldErrors === 'object') {
    for (const [k, v] of Object.entries(b.fieldErrors as Record<string, unknown>)) {
      if ((k === 'email' || k === 'consent' || k === 'adult') && typeof v === 'string') {
        fields[k] = SUBSCRIBE_FIELD_MESSAGES[k][v as 'required'] ?? (k === 'consent' ? 'Please reload the page and tick the box again.' : 'Check this.');
      }
    }
  }
  return { done: false, message: SUBSCRIBE_ERROR_MESSAGES[code], fields, resetCheck: code !== 'validation' };
}

export default function SubscribeForm({ notice, privacyHref, turnstileMode, turnstileSiteKey }: SubscribeFormProps) {
  const id = useId();
  const fid = (n: string) => `${id}-${n}`;
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
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
  const focusFirst = (errs: Partial<Record<Field, string>>) => {
    const first = (['email', 'consent', 'adult'] as const).find((k) => errs[k]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
  };

  const onSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (busy) return;
    touch();
    const problems = subscribeFieldProblems({ email, consent, adult });
    const msgs: Partial<Record<Field, string>> = {};
    for (const [k, v] of Object.entries(problems) as Array<[Field, 'required' | 'invalid' | 'too_long']>) msgs[k] = SUBSCRIBE_FIELD_MESSAGES[k][v] ?? 'Check this.';
    setErrors(msgs);
    if (Object.keys(msgs).length > 0) {
      setStatus(SUBSCRIBE_ERROR_MESSAGES.validation);
      focusFirst(msgs);
      return;
    }
    const token = controllerRef.current?.token() ?? '';
    if (turnstileMode === 'widget' && token === '') {
      setStatus('Please complete the spam check first.');
      boxRef.current?.focus();
      return;
    }
    const body: SubscribeBody = {
      email: email.trim(),
      consent,
      adult,
      consentId: notice.id,
      consentVersion: notice.version,
      token,
      website: honeypot,
      elapsedMs: startedAt.current === null ? 0 : Date.now() - startedAt.current,
    };
    setBusy(true);
    setStatus('Sending...');
    let answer;
    try {
      const res = await fetch(SUBSCRIBE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      answer = answerText(res.status, json);
    } catch {
      setBusy(false);
      setStatus('The sign-up could not be sent. Please check your internet connection and try again.');
      return;
    }
    setBusy(false);
    if (answer.done) {
      setStatus(null);
      setDone(answer.message);
      return;
    }
    if (answer.resetCheck) controllerRef.current?.reset();
    setErrors(answer.fields);
    setStatus(answer.message);
    focusFirst(answer.fields);
  };

  if (done) {
    return (
      <div className={panelClass} role="region" aria-labelledby={fid('done')}>
        <h3 id={fid('done')} ref={doneRef} tabIndex={-1} className="text-h4">
          Check your email
        </h3>
        <p className="mt-2">{done}</p>
      </div>
    );
  }

  const box = (name: 'consent' | 'adult', checked: boolean, setChecked: (v: boolean) => void, label: string) => (
    <div className={fieldWrapClass}>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          data-field={name}
          checked={checked}
          disabled={!ready}
          aria-invalid={errors[name] ? true : undefined}
          aria-describedby={errors[name] ? fid(`${name}-err`) : undefined}
          onChange={(ev) => setChecked(ev.target.checked)}
        />
        <span>{label}</span>
      </label>
      {errors[name] ? (
        <p id={fid(`${name}-err`)} className={errorClass}>
          {errors[name]}
        </p>
      ) : null}
    </div>
  );

  return (
    <form ref={formRef} className={`${panelClass} ${stackClass}`} noValidate onSubmit={onSubmit} onFocus={touch} onPointerDown={touch} aria-label="Email updates sign-up">
      <div className={fieldWrapClass}>
        <label htmlFor={fid('email')} className={labelClass}>
          Your email address
        </label>
        <input
          id={fid('email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          data-field="email"
          className={`${inputClass} ${errors.email ? inputErrorClass : ''}`}
          value={email}
          maxLength={SUBSCRIBE_LIMITS.emailMax}
          disabled={!ready}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? fid('email-err') : undefined}
          onChange={(ev) => setEmail(ev.target.value)}
        />
        {errors.email ? (
          <p id={fid('email-err')} className={errorClass}>
            {errors.email}
          </p>
        ) : null}
      </div>
      <p className="text-small text-fg-muted">
        {notice.text}{' '}
        <a className="underline" href={privacyHref}>
          Privacy notice
        </a>
      </p>
      {box('consent', consent, setConsent, 'Yes, email me Power Smash updates.')}
      {box('adult', adult, setAdult, 'I am 18 or older.')}
      <Honeypot name="website" value={honeypot} onChange={(_n, v) => setHoneypot(v)} />
      <TurnstileWidget mode={turnstileMode} siteKey={turnstileSiteKey} started={started} controllerRef={controllerRef} boxRef={boxRef} onSolved={() => setStatus(null)} />
      <p role="status" aria-live="polite" className="text-small font-semibold text-fg">
        {status}
      </p>
      <div>
        <button type="submit" className={buttonPrimary} disabled={!ready || busy} aria-busy={busy || undefined}>
          Sign up
        </button>
      </div>
    </form>
  );
}
