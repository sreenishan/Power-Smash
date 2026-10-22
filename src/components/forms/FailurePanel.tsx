/** @jsxImportSource react */
// Shown under the Send button when sending failed (degraded, server error, no connection, rate limit...). Loaded only
// when needed (React.lazy in LeadForm.tsx), so it moves focus to its own heading when it appears.
// Rules: the visitor's input stays in the form (this panel never replaces it), there is always a way forward
// (Try again when it can help, WhatsApp always when a number exists), and the WhatsApp text carries no personal data
// beyond the message the visitor typed (see whatsapp-prefill.ts and summary.ts).
import { useEffect, useRef } from 'react';
import type { FailedOutcome } from '../../lib/forms/flow';
import { fallbackSummary } from '../../lib/forms/summary';
import type { FormDef, Values } from '../../lib/forms/types';
import { fallbackLink } from '../../lib/forms/whatsapp-prefill';
import { buttonPrimary } from './styles';
import { WhatsAppButton } from './WhatsAppButton';

export interface FailurePanelProps {
  form: FormDef;
  values: Values;
  failure: FailedOutcome;
  /** Official WhatsApp number from site.ts; null hides the button. */
  whatsappNumber: string | null;
  /** The server's own WhatsApp link, used only when the page has no number. */
  serverWaLink: string | null;
  onRetry: () => void;
}

/** "about 3 minutes" for a retry-after in seconds. */
export function waitText(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return 'a few minutes';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`;
}

export default function FailurePanel({ form, values, failure, whatsappNumber, serverWaLink, onRetry }: FailurePanelProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [failure]);
  const rate = failure.code === 'rate_limited';
  const whatsappHref = fallbackLink(whatsappNumber, form.kind, fallbackSummary(form, values)) ?? serverWaLink;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line border-l-8 border-l-ps-live bg-surface p-5 shadow-card sm:p-6" aria-labelledby="ps-failure-title">
      <h3 id="ps-failure-title" ref={headingRef} tabIndex={-1} className="text-h4">
        {rate ? 'Please wait a little' : 'It did not go through. Your details are still here.'}
      </h3>
      <p className="text-body">
        {rate
          ? `Please try again in ${waitText(failure.retryAfterSec)}, or send it on WhatsApp now.`
          : 'Nothing is lost. You can try again, or send the same request on WhatsApp.'}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {failure.retryable ? (
          <button type="button" className={`${buttonPrimary} w-full sm:w-auto`} onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <WhatsAppButton href={whatsappHref} label="Send it on WhatsApp instead" context={rate ? 'rate-limited' : 'fallback'} kind={form.kind} />
      </div>
      {failure.correlationId ? (
        <p className="text-small text-fg-muted">
          If you ask us for help, please quote this code: <span className="ps-num font-semibold text-fg">{failure.correlationId}</span>
        </p>
      ) : null}
    </section>
  );
}
