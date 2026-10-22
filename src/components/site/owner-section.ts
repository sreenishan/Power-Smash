// The hide-section decision (D-034), kept out of the .astro file so Vitest can test it without rendering anything.
// OwnerSection.astro calls decideOwnerSection() and does nothing else.
//
// "Supplied" means the owner really gave the input:
//   - null, undefined, false, 0, NaN and "" are NOT supplied;
//   - a string that is only spaces is NOT supplied (it would draw an empty paragraph);
//   - an array is supplied only when it has at least one item;
//   - anything else (true, a number other than 0, a non-blank string, an object) is supplied.
//
// A hidden section leaves `<template data-owner-hidden="name"></template>`: invisible, never rendered by the browser, and
// listed by scripts/check-placeholders.ts so the owner can see what is waiting for an input (review findings B-8 and C-3).
// The name is kebab-case, at most 40 characters and UNIQUE per call site (tests/site/owner-section.test.ts scans for it).
// A call site without a name still leaves a marker (attribute with no value) which the gate lists as "(unnamed)" and which
// the build test treats as a failure, so a forgotten name is caught instead of silently hiding nothing.

export const OWNER_SECTION_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isSupplied(when: unknown): boolean {
  if (Array.isArray(when)) return when.length > 0;
  if (typeof when === 'string') return when.trim() !== '';
  if (typeof when === 'number') return Number.isFinite(when) && when !== 0;
  return Boolean(when);
}

export type OwnerSectionDecision =
  /** Render the slot. */
  | { kind: 'show' }
  /** Render only the hidden marker. `marker` is the name, or '' when the call site gave no name. */
  | { kind: 'hidden'; marker: string };

/** Show the content when `when` is supplied, otherwise a marker. An invalid (non-empty) name is a programming error and throws. */
export function decideOwnerSection(when: unknown, name?: string | null): OwnerSectionDecision {
  if (isSupplied(when)) return { kind: 'show' };
  if (name === undefined || name === null || name === '') return { kind: 'hidden', marker: '' };
  if (!OWNER_SECTION_NAME.test(name)) {
    throw new RangeError(`OwnerSection name "${name}" must be kebab-case (a-z, 0-9, hyphen), at most 40 characters.`);
  }
  return { kind: 'hidden', marker: name };
}
