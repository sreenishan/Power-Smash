// Everything the form needs once somebody TOUCHES it: Next, Back and Send, validation, the payload, the idempotency key,
// sending, the form events, and the rest of the step state machine. The React island loads this with a dynamic import() on the
// first focus, tap or key press (see LeadForm.tsx), so a page that is only looked at carries React and the first screen of the
// form, and nothing else (page budget, spec 12.5).
export { act, advance, clearSpamWait, sendLead, DEV_NO_KEY_TOKEN, type Controls, type SendControls } from './controller';
export { mapFieldErrors, validateStep, validateValues } from './validate';
export { trackFormEvent } from './events';
