// Small pieces shared by the competition screens: the action runner (plain-English refusals, STALE reloads), error text tied to a field,
// a reason box and the back link. Built on the admin ui.tsx primitives (44 px targets, tokens only).
import { useCallback, useState, type ReactNode } from 'react';
import { features } from '../../../content/legal/status';
import type { StoreResult } from '../../../lib/admin/types';
import { Field, cx, inputCls, useAdmin } from '../../ui';
import { failureText, fieldErrors, reasonProblem } from './logic';

export interface ActionState {
  busy: boolean;
  /** The plain sentence of the last refusal (null when the last action worked). */
  error: string | null;
  /** Field errors of the last refusal. */
  fields: Record<string, string>;
  clear: () => void;
  /** Runs a store call. On success returns the data; on failure shows the sentence (and reloads on STALE) and returns null. */
  run: <T>(call: () => Promise<StoreResult<T>>) => Promise<T | null>;
  /** Shows a sentence without calling the server (a check in the browser). */
  fail: (text: string, fields?: Record<string, string>) => void;
}

export function useAction(): ActionState {
  const { check, bump } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const clear = useCallback(() => {
    setError(null);
    setFields({});
  }, []);
  const fail = useCallback((text: string, f: Record<string, string> = {}) => {
    setError(text);
    setFields(f);
  }, []);
  const run = useCallback(
    async <T,>(call: () => Promise<StoreResult<T>>): Promise<T | null> => {
      setBusy(true);
      try {
        const r = await call();
        if (r.ok) {
          setError(null);
          setFields({});
          return r.data;
        }
        // the shell signs out on UNAUTHORIZED and shows its own sentence
        if (r.code === 'UNAUTHORIZED' || r.code === 'FORBIDDEN') check(r);
        setError(failureText(r));
        setFields(fieldErrors(r));
        if (r.code === 'STALE') bump();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [check, bump],
  );
  return { busy, error, fields, clear, run, fail };
}

/** An error sentence; give it an id and point the field's aria-describedby at it. */
export function ErrorText({ id, text }: { id?: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="font-semibold text-ps-live">
      <span aria-hidden="true">! </span>
      {text}
    </p>
  );
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <p className={cx('rounded-lg border-2 p-3 text-small', tone === 'warn' ? 'border-ps-live bg-ps-live-tint text-ps-ink' : 'border-line-strong bg-surface text-fg')}>{children}</p>;
}

/** A required reason (3 to 500 characters), for steps that change what others see or cannot be undone. */
export function ReasonField({ id, value, onChange, error, label = 'Reason (kept in the record of changes)' }: { id: string; value: string; onChange: (v: string) => void; error?: string | null; label?: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <textarea
        id={id}
        className="block min-h-[4.5rem] w-full rounded-md border-2 border-line-strong bg-surface px-3 py-2 text-body text-fg"
        value={value}
        maxLength={520}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <ErrorText id={`${id}-error`} text={error} />
    </Field>
  );
}

export { reasonProblem };

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex min-h-tap items-center font-semibold text-fg">
      <span aria-hidden="true">&larr;&nbsp;</span>
      {children}
    </a>
  );
}

/** A heading for a block inside a screen (the shell's header holds the h1). */
export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-h3 font-bold text-heading">
      {children}
    </h2>
  );
}

/** Shown on the competition screens while the public pages are off, so the owner knows nothing here is on the website yet. */
export function PublicSwitchNote() {
  if (features.competitionPages) return null;
  return <Note>The public competition pages are switched off (they need your yes and the lawyer&apos;s). Nothing you do here is on the website yet.</Note>;
}

/** A text box whose error sentence (an ErrorText whose id is the box id plus "-error") is tied to it for screen readers. */
export function Input(props: { id: string; value: string; onChange: (v: string) => void; error?: string | null; inputMode?: 'numeric' | 'text'; maxLength?: number; placeholder?: string; type?: string; errorId?: string }) {
  return (
    <input
      id={props.id}
      className={inputCls}
      value={props.value}
      type={props.type ?? 'text'}
      autoComplete="off"
      inputMode={props.inputMode}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      aria-invalid={props.error ? true : undefined}
      aria-describedby={props.error ? (props.errorId ?? `${props.id}-error`) : undefined}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}
