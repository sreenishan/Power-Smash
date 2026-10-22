// Cloudflare Turnstile client logic (D-010, D-029): plain TypeScript, no DOM types needed, so Vitest can test it with fakes.
//
// Facts used (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ and
// .../widget-configurations/, read 2026-10-21):
//  - script: https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=<global function name>
//  - turnstile.render(container, { sitekey, callback, 'error-callback', 'expired-callback', 'timeout-callback',
//    'unsupported-callback', theme, size: normal|flexible|compact, 'refresh-expired': auto|manual|never, retry, action, ... })
//  - turnstile.reset(widgetId), turnstile.remove(widgetId), turnstile.getResponse(widgetId)
//  - a token is valid for 300 seconds and can be validated only once (so every failed submit must reset the widget).
//
// The script is injected ONLY on the first interaction with a form (D-010: no third-party script on the page-load path).

import { WIDGET_LOADING_TEXT, WIDGET_LOAD_FAILED_TEXT, type WidgetSnapshot, type WidgetStatus } from './widget-text';

export const TURNSTILE_SCRIPT_URL ='https://challenges.cloudflare.com/turnstile/v0/api.js';
export const TURNSTILE_SCRIPT_ID = 'ps-turnstile-script';
export const TURNSTILE_ONLOAD_NAME = 'psTurnstileOnload';
/** The action label sent with every widget; the Worker checks it in siteverify (D-029). Alphanumeric, _ and -, max 32. */
export const TURNSTILE_ACTION = 'lead';

// ---------------------------------------------------------------------------------------------------------------
// Minimal structural types (the real DOM types are assignable via a cast in the React component)
// ---------------------------------------------------------------------------------------------------------------

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: 'auto' | 'light' | 'dark';
  size?: 'normal' | 'flexible' | 'compact';
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  retry?: 'auto' | 'never';
  callback?: (token: string) => void;
  'error-callback'?: (errorCode?: string) => unknown;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'unsupported-callback'?: () => void;
}

export interface TurnstileApi {
  render(container: unknown, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
}

export interface ScriptLike {
  id: string;
  src: string;
  async: boolean;
  defer: boolean;
  onload: ((event?: unknown) => unknown) | null;
  onerror: ((event?: unknown) => unknown) | null;
  remove?: () => void;
}

export interface DocumentLike {
  createElement(tag: 'script'): ScriptLike;
  head: { appendChild(node: ScriptLike): unknown };
}

export interface WindowLike {
  turnstile?: TurnstileApi;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------------------------------------------
// Mode: what the form does with the spam check
// ---------------------------------------------------------------------------------------------------------------

export type TurnstileMode =
  /** A site key exists: load the widget on first interaction and require its token. */
  | 'widget'
  /** No key, development build: show a clear dev-only notice; the form can still be exercised (the server decides). */
  | 'dev-unconfigured'
  /** No key, any non-development build: the form is blocked and shows the WhatsApp fallback. Never silently skipped. */
  | 'blocked';

export function resolveTurnstileMode(input: { siteKey: string | null | undefined; dev: boolean }): TurnstileMode {
  const key = (input.siteKey ?? '').trim();
  if (key !== '') return 'widget';
  return input.dev ? 'dev-unconfigured' : 'blocked';
}

// The interaction gate (first focus, pointer or key event) lives in a small file that the part of the form loaded first can
// import without this loader; re-exported here so everything about Turnstile can be found in one place.
export { createInteractionGate } from './gate';
export type { WidgetSnapshot, WidgetStatus } from './widget-text';

/** Plain-English text for the spam-check area, shown under the widget. Never blames the visitor. */
export function widgetMessage(snapshot: WidgetSnapshot): string {
  switch (snapshot.status) {
    case 'loading':
      return WIDGET_LOADING_TEXT;
    case 'ready':
      return 'Checking that you are a person...';
    case 'solved':
      return 'Spam check passed.';
    case 'expired':
      return 'The spam check ran out of time. It will refresh by itself; please wait a moment.';
    case 'unsupported':
      return 'This browser cannot run our spam check. Please try another browser or message us on WhatsApp.';
    case 'load-failed':
      return WIDGET_LOAD_FAILED_TEXT;
    case 'error':
      return 'The spam check hit a problem. Please try again, or message us on WhatsApp.';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Script loader: injects the script once per document, resolves with the API, allows a retry after a failure
// ---------------------------------------------------------------------------------------------------------------

const loads = new WeakMap<object, Promise<TurnstileApi>>();

export class TurnstileLoadError extends Error {
  readonly reason: 'script-failed' | 'api-missing';
  constructor(reason: 'script-failed' | 'api-missing') {
    super(`Turnstile ${reason}`);
    this.name = 'TurnstileLoadError';
    this.reason = reason;
  }
}

export function loadTurnstile(doc: DocumentLike, win: WindowLike): Promise<TurnstileApi> {
  const cached = loads.get(doc);
  if (cached) return cached;

  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    if (win.turnstile) {
      resolve(win.turnstile);
      return;
    }
    const script = doc.createElement('script');
    const finish = () => {
      if (win.turnstile) resolve(win.turnstile);
      else reject(new TurnstileLoadError('api-missing'));
    };
    // Cloudflare calls this global once the API is ready; the script's own load event is the backup.
    win[TURNSTILE_ONLOAD_NAME] = finish;
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit&onload=${TURNSTILE_ONLOAD_NAME}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (win.turnstile) resolve(win.turnstile);
    };
    script.onerror = () => {
      script.remove?.();
      reject(new TurnstileLoadError('script-failed'));
    };
    doc.head.appendChild(script);
  });

  loads.set(doc, promise);
  // A failed load must not be cached forever: the next interaction or the Retry button tries again.
  promise.catch(() => {
    if (loads.get(doc) === promise) loads.delete(doc);
  });
  return promise;
}

// ---------------------------------------------------------------------------------------------------------------
// Widget controller: one rendered widget, token bookkeeping, reset after every consumed token
// ---------------------------------------------------------------------------------------------------------------

export interface WidgetController {
  /** Current token, or null when none or expired. */
  token(): string | null;
  /** Call after every submit attempt that reached the server (a token is single use) or after an error. */
  reset(): void;
  remove(): void;
}

export function renderWidget(
  api: TurnstileApi,
  container: unknown,
  siteKey: string,
  onChange: (snapshot: WidgetSnapshot) => void,
): WidgetController {
  let token: string | null = null;
  let widgetId: string | undefined;

  const emit = (status: WidgetStatus, errorCode?: string) => onChange({ status, token, errorCode });

  widgetId = api.render(container, {
    sitekey: siteKey,
    action: TURNSTILE_ACTION,
    theme: 'auto',
    size: 'flexible',
    'refresh-expired': 'auto',
    callback: (t) => {
      token = t;
      emit('solved');
    },
    'expired-callback': () => {
      token = null;
      emit('expired');
    },
    'timeout-callback': () => {
      token = null;
      emit('expired');
    },
    'error-callback': (code) => {
      token = null;
      emit('error', code);
    },
    'unsupported-callback': () => {
      token = null;
      emit('unsupported');
    },
  });
  emit('ready');

  return {
    token: () => token,
    reset: () => {
      token = null;
      if (widgetId !== undefined) api.reset(widgetId);
      emit('ready');
    },
    remove: () => {
      token = null;
      if (widgetId !== undefined) api.remove(widgetId);
      widgetId = undefined;
    },
  };
}
