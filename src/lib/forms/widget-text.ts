// Types for the spam check widget, and the two plain-English texts the page itself needs before the widget code has loaded.
// The text for every other state is in widgetMessage() in turnstile.ts, which loads on the first touch of the form (review C-1).

export type WidgetStatus = 'loading' | 'ready' | 'solved' | 'expired' | 'error' | 'unsupported' | 'load-failed';

export interface WidgetSnapshot {
  status: WidgetStatus;
  token: string | null;
  /** Cloudflare error code when status is "error". */
  errorCode?: string;
}

/** Shown from the first touch until the widget reports in. */
export const WIDGET_LOADING_TEXT = 'Getting the spam check ready...';
/** Shown when the widget code or Cloudflare's script could not be loaded. */
export const WIDGET_LOAD_FAILED_TEXT = 'The spam check could not load. Check your internet connection and try again, or message us on WhatsApp.';
