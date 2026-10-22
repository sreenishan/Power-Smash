/** @jsxImportSource react */
// Two live regions that are ALWAYS in the DOM (a live region must exist before its text changes or screen readers
// miss it): polite for progress ("Sending...", "Step 2 of 3"), assertive for problems the visitor must act on.
import { AlertIcon } from './icons';
import { alertPanelClass } from './styles';

export interface FormStatusProps {
  /** Polite message, e.g. "Sending your enquiry...". Empty string clears it. */
  status: string;
  /** Assertive message, e.g. "Please fix 2 fields". Empty string clears it. */
  error: string;
}

export function FormStatus({ status, error }: FormStatusProps) {
  return (
    <div className="flex flex-col gap-2">
      <div role="status" aria-live="polite" aria-atomic="true" className={status ? 'text-small text-fg-muted' : 'sr-only'}>
        {status}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className={error ? '' : 'sr-only'}>
        {error ? (
          <p className={`${alertPanelClass} flex items-start gap-2 text-body font-semibold`}>
            <AlertIcon className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
