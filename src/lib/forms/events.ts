// The form events: form_start, form_submit and whatsapp_click from the buttons inside a form (spec 16, D-025, D-029). Loads with
// the form engine (not with the page). The sender itself is in analytics.ts. The body carries an event name, the page path and a
// few fixed labels. NEVER a name, phone, email, message text, reference code or any typed value.
// Prop keys follow src/lib/contracts/event.ts (EVENT_PROP_KEYS): form_start {form}, form_submit {form, ok},
// whatsapp_click {context, page_type}. The server drops any other key.
import type { LeadKind } from '../contracts/lead-constants';
import { sendEvent, type EventBody, type FormEventName } from './analytics';

export type WhatsAppContext = 'form-side' | 'confirmation' | 'fallback' | 'rate-limited';

export interface EventProps {
  /** Which form (a fixed list of kinds) */
  form?: LeadKind;
  /** Where the WhatsApp button was (a fixed list of places) */
  context?: WhatsAppContext;
}

export function buildEventBody(name: FormEventName, path: string, props?: EventProps): EventBody {
  const body: EventBody = { name, path: path.split(/[?#]/)[0] || '/' };
  const out: Record<string, string | boolean> = {};
  if (name === 'form_start' && props?.form) out.form = props.form;
  if (name === 'form_submit') {
    if (props?.form) out.form = props.form;
    out.ok = true;
  }
  if (name === 'whatsapp_click') {
    if (props?.context) out.context = props.context;
    if (props?.form) out.page_type = props.form;
  }
  if (Object.keys(out).length > 0) body.props = out;
  return body;
}

/** Convenience used by the components: builds the body from the current page path and sends it. */
export function trackFormEvent(name: FormEventName, props?: EventProps): void {
  const path = typeof location !== 'undefined' ? location.pathname : '/';
  sendEvent(buildEventBody(name, path, props));
}
