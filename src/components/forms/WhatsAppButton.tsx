/** @jsxImportSource react */
// A WhatsApp link styled as a button. The href is ALWAYS built by waLink() (src/lib/whatsapp.ts) by the caller; when there
// is no link (no number configured) nothing is rendered. Clicking sends a `whatsapp_click` event (fire and forget).
import { trackFormEvent, type WhatsAppContext } from '../../lib/forms/events';
import type { LeadKind } from '../../lib/contracts/lead-constants';
import { ChatIcon } from './icons-more';
import { buttonPrimary } from './styles';
import { buttonSecondary } from './styles-more';

export interface WhatsAppButtonProps {
  href: string | null;
  label: string;
  context: WhatsAppContext;
  kind: LeadKind;
  variant?: 'primary' | 'secondary';
  className?: string;
}

export function WhatsAppButton({ href, label, context, kind, variant = 'secondary', className }: WhatsAppButtonProps) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${variant === 'primary' ? buttonPrimary : buttonSecondary} w-full sm:w-auto ${className ?? ''}`}
      onClick={() => trackFormEvent('whatsapp_click', { form: kind, context })}
    >
      <ChatIcon />
      <span>{label}</span>
    </a>
  );
}
