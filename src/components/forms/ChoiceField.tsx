/** @jsxImportSource react */
// The choice controls: a native select (best mobile picker, free keyboard support), a radio group, one tick box, and a group of
// tick boxes (add-ons). Loaded on its own (React.lazy in FieldRenderer.tsx) because no form shows one of these on its first
// step, so they are not part of the JavaScript that loads with the page (review C-1); the first touch of the form fetches
// this file before the visitor reaches the step that needs it. The label, hint and error pieces come from FieldRenderer.
// Accessibility and rules are the same as for the text boxes: labelled, errors linked with aria-describedby, 44 px targets, and
// tick boxes are NEVER pre-ticked: the parent state starts false (D-028, spec 15.4); there is deliberately no default or
// initial-checked prop. The first radio and the first tick box of a group carry the group's id so focus-on-error lands on a
// real control.
import type { ReactNode } from 'react';
import type { FieldDef, FieldValue } from '../../lib/forms/types';
import { inputClass, inputErrorClass, labelClass } from './styles';

export interface ChoiceFieldProps {
  field: FieldDef;
  id: string;
  value: FieldValue | undefined;
  error: string | undefined;
  onChange: (name: string, value: FieldValue) => void;
  /** The "(optional)" tag, the hint and the error, drawn by FieldRenderer so every control looks the same. */
  optional: ReactNode;
  hint: ReactNode;
  problem: ReactNode;
  describedBy: string | undefined;
}

/** One tick box row: the whole row is the tap target. */
function Tick({ id, name, checked, onChange, invalid, describedBy, children }: {
  id: string;
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  invalid: boolean;
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-h-tap items-start gap-3 rounded-md border-2 p-4 ps-transition ${invalid ? 'border-ps-live bg-ps-live-tint/40' : 'border-line-strong bg-surface hover:border-ps-ink has-[:checked]:border-ps-court has-[:checked]:bg-ps-court-tint'}`}>
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 accent-ps-court"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <label htmlFor={id} className="text-body text-fg">
        {children}
      </label>
    </div>
  );
}

export default function ChoiceField({ field: f, id, value, error, onChange, optional, hint, problem, describedBy }: ChoiceFieldProps) {
  const options = f.options ?? [];
  const text = typeof value === 'string' ? value : '';
  const set = (v: FieldValue) => onChange(f.name, v);

  if (f.type === 'select') {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className={labelClass}>
          {f.label}
          {optional}
        </label>
        <select
          id={id}
          name={f.name}
          value={text}
          onChange={(e) => set(e.target.value)}
          className={`${inputClass} ${error ? inputErrorClass : ''}`}
          aria-invalid={error ? true : undefined}
          aria-required={f.optional ? undefined : true}
          aria-describedby={describedBy}
        >
          <option value="">{f.placeholder ?? 'Choose one'}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hint}
        {problem}
      </div>
    );
  }

  if (f.type === 'checkbox') {
    return (
      <div className="flex flex-col gap-1">
        <Tick id={id} name={f.name} checked={value === true} onChange={set} invalid={Boolean(error)} describedBy={describedBy}>
          {f.label}
        </Tick>
        {hint}
        {problem}
      </div>
    );
  }

  // radio or checks
  const ticked = Array.isArray(value) ? value : [];
  const radio = f.type === 'radio';
  return (
    <fieldset
      role={radio ? 'radiogroup' : undefined}
      className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
      aria-describedby={describedBy}
      aria-required={radio && !f.optional ? true : undefined}
      aria-invalid={radio && error ? true : undefined}
    >
      <legend className={`${labelClass} mb-1 p-0`}>
        {f.label}
        {optional}
      </legend>
      {hint}
      {options.map((o, i) => {
        const optionId = i === 0 ? id : `${id}-${o.value}`;
        if (!radio) {
          return (
            <Tick
              key={o.value}
              id={optionId}
              name={`${f.name}[]`}
              checked={ticked.includes(o.value)}
              onChange={(on) => set(on ? [...ticked, o.value] : ticked.filter((v) => v !== o.value))}
              invalid={false}
            >
              {o.label}
            </Tick>
          );
        }
        const selected = text === o.value;
        return (
          <label
            key={o.value}
            htmlFor={optionId}
            className={`flex min-h-[3.25rem] cursor-pointer items-center gap-3 rounded-md border-2 px-4 py-2.5 text-body text-fg ps-transition has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ps-court ${
              selected ? 'border-ps-court bg-ps-court-tint font-semibold shadow-[inset_4px_0_0_var(--ps-court)]' : error ? 'border-ps-live bg-ps-live-tint/40' : 'border-line-strong bg-surface hover:border-ps-ink'
            }`}
          >
            <input
              id={optionId}
              type="radio"
              name={f.name}
              value={o.value}
              checked={selected}
              onChange={() => set(o.value)}
              className="h-6 w-6 shrink-0 accent-ps-court"
            />
            <span>{o.label}</span>
          </label>
        );
      })}
      {problem}
    </fieldset>
  );
}
