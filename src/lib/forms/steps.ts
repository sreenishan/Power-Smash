// Small pure helpers over a FormDef and a set of field errors. Kept apart from validate.ts so the part of the form that is
// loaded when the island hydrates does not pull in the validation rules (they load on the first touch of the form).
import type { FieldDef, FieldMessages, FormDef } from './types';

export function allFieldDefs(form: FormDef): FieldDef[] {
  return form.steps.flatMap((s) => [...s.fields]);
}

export { presetValue } from './flow-base';

/** Index of the first step that has a field with an error, or -1. */
export function firstStepWithError(form: FormDef, errors: FieldMessages): number {
  return form.steps.findIndex((s) => s.fields.some((f) => f.name in errors));
}

/** Name of the first field (in display order) that has an error, or null. */
export function firstErrorField(form: FormDef, errors: FieldMessages, stepIndex?: number): string | null {
  const steps = stepIndex === undefined ? form.steps : form.steps.slice(stepIndex, stepIndex + 1);
  for (const step of steps) {
    for (const f of step.fields) if (f.name in errors) return f.name;
  }
  return null;
}
