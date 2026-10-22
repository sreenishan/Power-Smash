/** @jsxImportSource react */
// Submit button with a pending state. It uses aria-disabled (not disabled) so keyboard focus is not thrown away while
// sending, and ignores clicks while pending so a double tap cannot send twice. The sending text is announced by FormStatus.
import type { ReactNode } from 'react';
import { buttonPrimary } from './styles';

export interface SubmitButtonProps {
  pending: boolean;
  children: ReactNode;
}

export function SubmitButton({ pending, children }: SubmitButtonProps) {
  return (
    <button type="submit" onClick={(e) => pending && e.preventDefault()} aria-disabled={pending} className={`${buttonPrimary} w-full sm:w-auto`}>
      {pending ? (
        <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      ) : null}
      <span>{pending ? 'Sending...' : children}</span>
    </button>
  );
}
