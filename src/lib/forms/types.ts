// Shared types for the form engine. Pure data: a form is described by a FormDef (kind, steps, fields) and rendered by the
// generic LeadForm island, so the four pages share one tested engine. No React or DOM types here.
import type { ConsentKey } from '../../content/consent';
import type { FieldErrorCode, LeadKind } from '../contracts/lead-constants';

export interface Option {
  value: string;
  label: string;
}

export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'date'
  | 'month'
  | 'number'
  | 'textarea'
  | 'select'
  | 'radio'
  /** One tick box (boolean). NEVER pre-ticked: the initial value is false. */
  | 'checkbox'
  /** A group of tick boxes (string[] of option values). Nothing ticked at the start. */
  | 'checks';

/** How a field value becomes a payload entry (see payload.ts). */
export type PayloadAs =
  /** trimmed string, omitted when blank (the default) */
  | 'string'
  /** comma or new-line separated text becomes a string array, omitted when empty */
  | 'list'
  /** radio "yes" / "no" becomes true / false, omitted when nothing is chosen */
  | 'yesno'
  /** a checkbox boolean, always sent */
  | 'bool'
  /** a string[] of slugs, omitted when empty */
  | 'slugs';

export interface FieldDef {
  /** Payload key (and value-state key). Must match src/lib/contracts/lead.ts. */
  name: string;
  label: string;
  type: FieldType;
  /** Shown as "(optional)". Everything else is required by the contract or by the form. */
  optional?: boolean;
  /** Optional in the contract but required by this form (e.g. coverage startDate, D-025). */
  requiredByForm?: boolean;
  hint?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'tel' | 'email' | 'url' | 'numeric' | 'decimal';
  maxLength?: number;
  rows?: number;
  options?: readonly Option[];
  as?: PayloadAs;
  /** Friendlier text for specific error codes on this field; the default texts come from the contract. */
  errors?: Partial<Record<FieldErrorCode, string>>;
  /** A small heading shown above this field when it differs from the previous field's group. */
  group?: string;
  /**
   * Include a "Label: value" line in the WhatsApp fallback summary (choices only, never personal data).
   * 'date' values are formatted for people. Never set this on name, phone, email, organization or company fields.
   */
  summary?: boolean;
  /**
   * M3: a separate consent tick box. The payload sends `{ id, version, given }` from CONSENT[consentKey] under this field's name
   * (the field's label is that consent's exact text). Pair with `requiredTick` when the box must be ticked to send.
   */
  consentKey?: ConsentKey;
  /** The box must be ticked: unticked gives the `consent_required` error (the server refuses it too). Checkboxes only. */
  requiredTick?: boolean;
}

export interface StepDef {
  id: string;
  title: string;
  /** One line under the step title. */
  intro?: string;
  fields: readonly FieldDef[];
}

/**
 * A value the address bar may pre-fill (`?package=pro` on /book and /partner, `?topic=pro` on /contact, R-TOPIC). The value never
 * comes from the address bar: the parameter is only looked up in an allow-list (`options`, or the target field's own options)
 * and a match supplies the value or, with `prefix`, the prefix plus the option's label. No match: nothing happens.
 */
export interface UrlPreset {
  /** Query parameter name, for example `package` or `topic`. */
  param: string;
  /** Name of the field that receives the value. */
  field: string;
  /** The allow-list. Omitted = the options of the target field. */
  options?: readonly Option[];
  /** When set, the field gets `prefix + label` (a sentence) instead of the option value. */
  prefix?: string;
}

export interface FormDef {
  kind: LeadKind;
  steps: readonly StepDef[];
  submitLabel: string;
  /** Name of the field whose text is the visitor's own message (used in the WhatsApp fallback). */
  messageField?: string;
  /** Short text for a screen reader and the status line, e.g. "your coverage request". */
  noun: string;
  /** Do the three-state button labels need a different wording at the last step? */
  nextLabel?: string;
  /** Pre-fill from the address bar, see UrlPreset. */
  preset?: UrlPreset;
  /**
   * The lead kind follows a box: the request form sends `content_removal` when the visitor picks "remove a video or page" and
   * `profile_request` (the form's own `kind`) for every other choice. Choices not listed use `kind`.
   */
  kindBy?: { field: string; kinds: Readonly<Record<string, LeadKind>> };
  /** Which notice is shown above Send and stored with the lead (a key of CONSENT). Default `leadNotice`; the request form uses `requestNotice`. */
  noticeKey?: 'leadNotice' | 'requestNotice';
  /**
   * The starting values: nothing typed, nothing ticked (the one pre-selected radio is the free tournament listing). Worked out when
   * the page is built (finishForm in defs/common.ts) and handed to the island with the rest of the definition, so the browser
   * does not carry the code that computes them (review C-1). Also what the form returns to after a successful send.
   */
  initial: Values;
}

export type FieldValue = string | boolean | string[];
export type Values = Record<string, FieldValue>;

/** field name -> plain-English message */
export type FieldMessages = Record<string, string>;
