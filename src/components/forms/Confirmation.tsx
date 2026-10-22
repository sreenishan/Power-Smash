/** @jsxImportSource react */
// The "thank you" screen (spec Appendix B "Form success", D-022). Loaded only after a successful send (React.lazy in
// LeadForm.tsx), so it moves keyboard focus to its own heading when it appears.
//  - the reference code (PS-YYYY-XXXXXX) the visitor can quote;
//  - "we reply within ..." ONLY when the owner has supplied a reply-time promise (`replyPromise`); otherwise wording
//    with no promise;
//  - a WhatsApp button prefilled with the reference (no personal data in the text);
//  - "what happens next", plain and without prices or deadlines the owner has not set;
//  - nothing says an email was sent: before the domain is verified no confirmation email goes out (D-022).
import { useEffect, useRef } from 'react';
import type { LeadKind } from '../../lib/contracts/lead-constants';
import { nextSteps, replyLine } from '../../lib/forms/confirmation-text';
import { confirmationLink } from '../../lib/forms/whatsapp-prefill';
import { CheckIcon } from './icons-more';
import { panelClass } from './styles';
import { WhatsAppButton } from './WhatsAppButton';

export interface ConfirmationProps {
  kind: LeadKind;
  reference: string;
  /** From src/content/site.ts, e.g. "24 hours". null = the owner has not promised a reply time. */
  replyPromise: string | null;
  /** Official WhatsApp number from site.ts; null hides the button. */
  whatsappNumber: string | null;
  /** The server's own WhatsApp link, used only when the page has no number. */
  serverWaLink: string | null;
}

export default function Confirmation({ kind, reference, replyPromise, whatsappNumber, serverWaLink }: ConfirmationProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const whatsappHref = confirmationLink(whatsappNumber, kind, reference) ?? serverWaLink;

  return (
    <section className={`${panelClass} flex flex-col gap-5`} aria-labelledby="ps-confirmation-title">
      <div className="flex items-start gap-3">
        <CheckIcon className="mt-1 shrink-0 text-ps-court" width={28} height={28} />
        <h2 id="ps-confirmation-title" ref={headingRef} tabIndex={-1} className="text-h3 font-bold normal-case">
          Thank you. We have received it.
        </h2>
      </div>
      <p className="text-body">
        Your reference is <strong className="ps-num whitespace-nowrap rounded-md border-2 border-ps-court bg-ps-court-tint px-3 py-1 text-lg font-bold tracking-wider text-ps-ink">{reference}</strong>. Please keep it. Quote it if you message us.
      </p>
      <p className="text-body">{replyLine(replyPromise, kind)}</p>
      {whatsappHref && kind !== 'alerts_signup' ? (
        <div>
          <WhatsAppButton href={whatsappHref} label="Chat with us on WhatsApp now" context="confirmation" kind={kind} variant="primary" />
        </div>
      ) : null}
      <div>
        <h3 className="text-h4">What happens next</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-body">
          {nextSteps(kind).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
