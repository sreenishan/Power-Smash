/** @jsxImportSource react */
// Draws one FieldDef with the right control. The text-like boxes (text, email, tel, url, date, month, number, text area) are drawn
// here; the choice controls (select, radio group, tick boxes) are in ChoiceField.tsx, a separate chunk, because no form shows one
// on its first step (page budget, spec 12.5, review C-1). Accessibility: every control has a label, the hint and the error are
// linked with aria-describedby, the error carries an icon and a visually hidden "Error:" so colour is never the only signal
// (WCAG 1.4.1, 3.3.1), inputs are 16 px, targets are 44 px.
import { Suspense, lazy } from 'react';
import type { FieldDef, FieldValue } from '../../lib/forms/types';
import { AlertIcon } from './icons';
import { errorClass, fieldWrapClass, hintClass, inputClass, inputErrorClass, labelClass, optionalTagClass } from './styles';

// The choice controls are a separate chunk in the browser. On the server (the build that writes the page's HTML) they are loaded up
// front, so a form with a choice box on its FIRST screen (/alerts, /submit-video, /request) is drawn in full: a lazy component that has
// not loaded yet would make React stream a loading line and a replacement script into the page. `import.meta.env.SSR` is a build-time
// constant: the browser bundle keeps only the lazy branch.
const ChoiceField = import.meta.env.SSR ? (await import('./ChoiceField')).default : lazy(() => import('./ChoiceField'));

export interface FieldRendererProps {
  field: FieldDef;
  /** DOM id for this control (also what focus-on-error looks up). */
  id: string;
  value: FieldValue | undefined;
  error: string | undefined;
  onChange: (name: string, value: FieldValue) => void;
}

export function FieldRenderer({ field: f, id, value, error, onChange }: FieldRendererProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [f.hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const hint = f.hint ? (
    <p id={hintId} className={hintClass}>
      {f.hint}
    </p>
  ) : null;
  const problem = error ? (
    <p id={errorId} className={errorClass}>
      <AlertIcon className="mt-0.5 shrink-0" width={16} height={16} />
      <span>
        <span className="sr-only">Error: </span>
        {error}
      </span>
    </p>
  ) : null;
  const optional = f.optional ? <span className={optionalTagClass}>(optional)</span> : null;

  if (f.type === 'select' || f.type === 'radio' || f.type === 'checks' || f.type === 'checkbox') {
    return (
      <Suspense fallback={<p className="text-small text-fg-muted">Loading...</p>}>
        <ChoiceField field={f} id={id} value={value} error={error} onChange={onChange} optional={optional} hint={hint} problem={problem} describedBy={describedBy} />
      </Suspense>
    );
  }

  const text = typeof value === 'string' ? value : '';
  const common = {
    id,
    name: f.name,
    value: text,
    onChange: (e: { target: { value: string } }) => onChange(f.name, e.target.value),
    className: `${inputClass} ${error ? inputErrorClass : ''}`,
    placeholder: f.placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-required': f.optional ? undefined : true,
    'aria-describedby': describedBy,
  } as const;
  return (
    <div className={fieldWrapClass}>
      <label htmlFor={id} className={labelClass}>
        {f.label}
        {optional}
      </label>
      {f.type === 'textarea' ? (
        <textarea {...common} rows={f.rows ?? 4} maxLength={f.maxLength} />
      ) : (
        <input
          {...common}
          type={f.type}
          autoComplete={f.autoComplete}
          inputMode={f.inputMode}
          maxLength={f.maxLength}
          // Names and organisation words are not checked by the browser: it only adds red squiggles on Tamil place names.
          spellCheck={f.type === 'text' ? false : undefined}
        />
      )}
      {hint}
      {problem}
    </div>
  );
}
