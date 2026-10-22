// Site-wide WhatsApp click logging (spec 16, D-025, D-029): one delegated, passive click listener for every button that
// carries `data-wa-click` (WhatsAppButton.astro sets it together with `data-wa-source`). It sends the allow-listed
// `whatsapp_click` event with the button's place as `context` and nothing else: no text, number, name or reference code.
// Fire and forget; analytics must never break or slow the page. Buttons inside the form islands log through
// src/lib/forms/analytics.ts instead (they do not carry data-wa-click).
import { sendEvent, type EventBody } from './forms/analytics';

const SLUG = /^[a-z0-9][a-z0-9_.:-]{0,39}$/;

/** Turns a `data-wa-source` value into a safe event context (a slug, or "page" when missing or unsafe). */
export function cleanWaSource(raw: string | null | undefined): string {
  const v = (raw ?? '').trim().toLowerCase();
  return SLUG.test(v) && !/\d{6,}/.test(v) ? v : 'page';
}

export function buildWaClickBody(source: string | null | undefined, path: string): EventBody {
  return {
    name: 'whatsapp_click',
    path: path.split(/[?#]/)[0] || '/',
    props: { context: cleanWaSource(source) },
  };
}

interface ClickTarget {
  closest?: (selector: string) => { getAttribute: (name: string) => string | null } | null;
}
interface ListenerHost {
  addEventListener: (type: 'click', handler: (event: { target: unknown }) => void, options?: { passive: boolean }) => void;
  location?: { pathname: string };
}

/** Installs the delegated listener once. `send` is injectable for tests. */
export function installWaClickListener(
  doc: ListenerHost,
  send: (body: EventBody) => unknown = (body) => sendEvent(body),
): void {
  doc.addEventListener(
    'click',
    (event) => {
      const el = (event.target as ClickTarget | null)?.closest?.('[data-wa-click]');
      if (!el) return;
      const path = typeof location !== 'undefined' ? location.pathname : (doc.location?.pathname ?? '/');
      send(buildWaClickBody(el.getAttribute('data-wa-source'), path));
    },
    { passive: true },
  );
}
