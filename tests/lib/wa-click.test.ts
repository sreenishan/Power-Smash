import { describe, expect, it } from 'vitest';
import { buildWaClickBody, cleanWaSource, installWaClickListener } from '../../src/lib/wa-click';
import { validateEvent } from '../../src/lib/contracts/event';

describe('cleanWaSource', () => {
  it('keeps slug-like places and falls back to "page" for anything else', () => {
    expect(cleanWaSource('home-hero')).toBe('home-hero');
    expect(cleanWaSource(' Services-Hero ')).toBe('services-hero');
    expect(cleanWaSource(null)).toBe('page');
    expect(cleanWaSource('')).toBe('page');
    expect(cleanWaSource('has spaces')).toBe('page');
    expect(cleanWaSource('x'.repeat(60))).toBe('page');
  });
  it('never lets a phone-number-like value through', () => {
    expect(cleanWaSource('919876543210')).toBe('page');
  });
});

describe('buildWaClickBody', () => {
  it('carries only the event name, a bare path and the context', () => {
    const body = buildWaClickBody('header', '/services?utm_source=x#top');
    expect(body).toEqual({ name: 'whatsapp_click', path: '/services', props: { context: 'header' } });
  });
  it('is accepted unchanged by the server-side event contract', () => {
    const result = validateEvent(buildWaClickBody('home-hero', '/'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.props).toEqual({ context: 'home-hero' });
  });
});

describe('installWaClickListener', () => {
  function makeDoc() {
    let handler: ((event: { target: unknown }) => void) | undefined;
    let passive: boolean | undefined;
    return {
      doc: {
        addEventListener: (_t: 'click', h: (event: { target: unknown }) => void, o?: { passive: boolean }) => {
          handler = h;
          passive = o?.passive;
        },
        location: { pathname: '/pricing' },
      },
      click: (target: unknown) => handler?.({ target }),
      passive: () => passive,
    };
  }
  const button = (source: string | null) => ({
    closest: (sel: string) => (sel === '[data-wa-click]' ? { getAttribute: () => source } : null),
  });

  it('sends one event for a click on a WhatsApp button and none for other clicks', () => {
    const sent: unknown[] = [];
    const h = makeDoc();
    installWaClickListener(h.doc, (b) => sent.push(b));
    h.click({ closest: () => null });
    h.click(null);
    h.click(button('footer'));
    expect(h.passive()).toBe(true);
    expect(sent).toEqual([{ name: 'whatsapp_click', path: '/pricing', props: { context: 'footer' } }]);
  });
});
