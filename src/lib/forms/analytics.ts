// First-party, cookieless event sender, the part every page loads (src/lib/wa-click.ts, the site-wide WhatsApp click logger,
// imports it). Kept as small as possible and free of runtime imports so the site-wide script stays tiny (review C-1): the form
// events (form_start, form_submit, whatsapp_click from inside a form) are built in events.ts, which loads with the form engine.
// Fire and forget: never awaited by callers, never throws, never blocks the page. NEVER a name, phone, email, message text,
// reference code or any typed value in a body.
import type { EventName } from '../contracts/lead-constants';

/** Same value as EVENT_ENDPOINT in src/lib/contracts/lead-constants.ts (a test keeps them equal; no import so this file stays tiny). */
const EVENT_PATH = '/api/event';

/** The only events the forms send. A subset of EVENT_NAMES (src/lib/contracts/lead-constants.ts). */
export type FormEventName = Extract<EventName, 'form_start' | 'form_submit' | 'whatsapp_click'>;

export interface EventBody {
  name: FormEventName;
  path: string;
  props?: Record<string, string | boolean>;
}

export interface BeaconEnv {
  sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
  fetchImpl?: typeof fetch;
}

/** Send one event. Returns true if it was handed to the browser. Never throws. */
export function sendEvent(body: EventBody, env: BeaconEnv = defaultEnv()): boolean {
  try {
    const json = JSON.stringify(body);
    if (env.sendBeacon && typeof Blob !== 'undefined') {
      if (env.sendBeacon(EVENT_PATH, new Blob([json], { type: 'application/json' }))) return true;
    }
    if (env.fetchImpl) {
      // keepalive lets the request finish even if the visitor navigates away (for example to WhatsApp).
      void env
        .fetchImpl(EVENT_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json, keepalive: true, credentials: 'same-origin' })
        .catch(() => undefined);
      return true;
    }
  } catch {
    /* analytics must never break the page */
  }
  return false;
}

function defaultEnv(): BeaconEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    sendBeacon: nav && typeof nav.sendBeacon === 'function' ? (url, data) => nav.sendBeacon(url, data) : undefined,
    fetchImpl: typeof fetch === 'function' ? (...args) => fetch(...args) : undefined,
  };
}
