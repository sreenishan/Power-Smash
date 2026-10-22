import { describe, expect, it, vi } from 'vitest';
import {
  TURNSTILE_ACTION,
  TURNSTILE_ONLOAD_NAME,
  TURNSTILE_SCRIPT_ID,
  TURNSTILE_SCRIPT_URL,
  createInteractionGate,
  loadTurnstile,
  renderWidget,
  resolveTurnstileMode,
  widgetMessage,
  type DocumentLike,
  type ScriptLike,
  type TurnstileApi,
  type TurnstileRenderOptions,
  type WindowLike,
} from '../../src/lib/forms/turnstile';

function fakeDom() {
  const scripts: ScriptLike[] = [];
  const doc: DocumentLike = {
    createElement: () => ({ id: '', src: '', async: false, defer: false, onload: null, onerror: null, remove: vi.fn() }),
    head: { appendChild: (node) => scripts.push(node) },
  };
  const win: WindowLike = {};
  return { doc, win, scripts };
}

function fakeApi() {
  const renders: { container: unknown; options: TurnstileRenderOptions }[] = [];
  const api: TurnstileApi = {
    render: vi.fn((container, options) => {
      renders.push({ container, options });
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
    getResponse: vi.fn(),
  };
  return { api, renders };
}

describe('Turnstile loads only when asked (D-010)', () => {
  it('nothing is injected until loadTurnstile is called', () => {
    const { scripts } = fakeDom();
    expect(scripts).toHaveLength(0);
  });

  it('injects Cloudflare\'s script once, with explicit rendering and an onload callback', async () => {
    const { doc, win, scripts } = fakeDom();
    const first = loadTurnstile(doc, win);
    const second = loadTurnstile(doc, win);
    expect(first).toBe(second);
    expect(scripts).toHaveLength(1);
    const s = scripts[0]!;
    expect(s.id).toBe(TURNSTILE_SCRIPT_ID);
    expect(s.src).toBe(`${TURNSTILE_SCRIPT_URL}?render=explicit&onload=${TURNSTILE_ONLOAD_NAME}`);
    expect(s.src.startsWith('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(true);
    expect(s.async).toBe(true);
    expect(s.defer).toBe(true);

    const { api } = fakeApi();
    win.turnstile = api;
    (win[TURNSTILE_ONLOAD_NAME] as () => void)();
    await expect(first).resolves.toBe(api);
  });

  it('also resolves from the script load event if the onload callback was not called', async () => {
    const { doc, win, scripts } = fakeDom();
    const p = loadTurnstile(doc, win);
    const { api } = fakeApi();
    win.turnstile = api;
    scripts[0]!.onload?.();
    await expect(p).resolves.toBe(api);
  });

  it('does not inject again when the API is already on the page', async () => {
    const { doc, win, scripts } = fakeDom();
    const { api } = fakeApi();
    win.turnstile = api;
    await expect(loadTurnstile(doc, win)).resolves.toBe(api);
    expect(scripts).toHaveLength(0);
  });

  it('a failed script load rejects, removes the broken tag, and the next try injects again', async () => {
    const { doc, win, scripts } = fakeDom();
    const first = loadTurnstile(doc, win);
    scripts[0]!.onerror?.();
    await expect(first).rejects.toMatchObject({ reason: 'script-failed' });
    expect(scripts[0]!.remove).toHaveBeenCalled();
    const second = loadTurnstile(doc, win);
    expect(second).not.toBe(first);
    expect(scripts).toHaveLength(2);
  });

  it('a script that loads but defines no API rejects instead of hanging', async () => {
    const { doc, win } = fakeDom();
    const p = loadTurnstile(doc, win);
    (win[TURNSTILE_ONLOAD_NAME] as () => void)();
    await expect(p).rejects.toMatchObject({ reason: 'api-missing' });
  });
});

describe('interaction gate: first focus, pointer or key event only', () => {
  it('fires once however many events arrive', () => {
    const onFirst = vi.fn();
    const gate = createInteractionGate(onFirst);
    expect(gate.hasFired()).toBe(false);
    gate.trigger();
    gate.trigger();
    gate.trigger();
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(gate.hasFired()).toBe(true);
  });

  it('does not fire by itself (no interaction, no load)', () => {
    const onFirst = vi.fn();
    createInteractionGate(onFirst);
    expect(onFirst).not.toHaveBeenCalled();
  });
});

describe('missing site key never skips the check silently', () => {
  it('a key means the widget', () => {
    expect(resolveTurnstileMode({ siteKey: '1x00000000000000000000AA', dev: false })).toBe('widget');
    expect(resolveTurnstileMode({ siteKey: '1x00000000000000000000AA', dev: true })).toBe('widget');
  });

  it('no key in a development build shows the dev-only notice', () => {
    expect(resolveTurnstileMode({ siteKey: null, dev: true })).toBe('dev-unconfigured');
    expect(resolveTurnstileMode({ siteKey: '   ', dev: true })).toBe('dev-unconfigured');
  });

  it('no key in any other build (including strict release builds) blocks the form', () => {
    expect(resolveTurnstileMode({ siteKey: null, dev: false })).toBe('blocked');
    expect(resolveTurnstileMode({ siteKey: undefined, dev: false })).toBe('blocked');
    expect(resolveTurnstileMode({ siteKey: '', dev: false })).toBe('blocked');
  });
});

describe('widget controller', () => {
  it('renders the managed widget with the site key, the lead action and automatic refresh', () => {
    const { api, renders } = fakeApi();
    renderWidget(api, 'box', 'SITEKEY', () => undefined);
    expect(renders[0]!.container).toBe('box');
    expect(renders[0]!.options).toMatchObject({ sitekey: 'SITEKEY', action: TURNSTILE_ACTION, size: 'flexible', 'refresh-expired': 'auto' });
    expect(TURNSTILE_ACTION).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it('keeps the token, drops it on expiry, error and timeout, and reports each state', () => {
    const { api, renders } = fakeApi();
    const seen: string[] = [];
    const controller = renderWidget(api, 'box', 'k', (s) => seen.push(`${s.status}:${s.token ?? '-'}`));
    const o = renders[0]!.options;
    o.callback?.('TOKEN-1');
    expect(controller.token()).toBe('TOKEN-1');
    o['expired-callback']?.();
    expect(controller.token()).toBeNull();
    o.callback?.('TOKEN-2');
    o['error-callback']?.('300030');
    expect(controller.token()).toBeNull();
    o.callback?.('TOKEN-3');
    o['timeout-callback']?.();
    expect(controller.token()).toBeNull();
    o['unsupported-callback']?.();
    expect(seen).toEqual(['ready:-', 'solved:TOKEN-1', 'expired:-', 'solved:TOKEN-2', 'error:-', 'solved:TOKEN-3', 'expired:-', 'unsupported:-']);
  });

  it('reset() clears the token and resets the widget (a token is single use); remove() removes it', () => {
    const { api, renders } = fakeApi();
    const controller = renderWidget(api, 'box', 'k', () => undefined);
    renders[0]!.options.callback?.('T');
    controller.reset();
    expect(controller.token()).toBeNull();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    controller.remove();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('messages for every state are plain English', () => {
    for (const status of ['loading', 'ready', 'solved', 'expired', 'error', 'unsupported', 'load-failed'] as const) {
      const text = widgetMessage({ status, token: null });
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/undefined|null|\d{5,}/);
    }
    expect(widgetMessage({ status: 'load-failed', token: null })).toMatch(/WhatsApp/);
  });
});

describe('the island\'s own loading sentence matches the engine\'s (they are written out twice on purpose, to keep the first load small)', () => {
  it('TurnstileWidget.tsx says what widgetMessage says for "loading"', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/components/forms/TurnstileWidget.tsx'), 'utf8');
    const m = /WIDGET_LOADING_FALLBACK = '([^']+)'/.exec(src);
    expect(m?.[1]).toBe(widgetMessage({ status: 'loading', token: null }));
  });
});
