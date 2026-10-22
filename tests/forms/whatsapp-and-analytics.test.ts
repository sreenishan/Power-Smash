import { describe, expect, it, vi } from 'vitest';
import { EVENT_ENDPOINT, EVENT_NAMES, LEAD_KINDS } from '../../src/lib/contracts/lead-constants';
import { validateEvent } from '../../src/lib/contracts/event';
import { sendEvent } from '../../src/lib/forms/analytics';
import { buildEventBody } from '../../src/lib/forms/events';
import { allFields } from '../../src/lib/forms/definitions';
import { fallbackSummary, PERSONAL_FIELD_NAMES } from '../../src/lib/forms/summary';
import {
  KIND_LABEL,
  askText,
  confirmationLink,
  confirmationText,
  fallbackLink,
  fallbackText,
  scrubForWhatsApp,
} from '../../src/lib/forms/whatsapp-prefill';
import { FICTIONAL, forms, fullValues } from './helpers';

const NUMBER = '919800000000'; // fictional, not the owner's number

const decoded = (link: string | null) => decodeURIComponent((link ?? '').split('?text=')[1] ?? '');

describe('WhatsApp links are built by waLink() only', () => {
  it('confirmation: a wa.me link whose text has the reference and no personal data', () => {
    const link = confirmationLink(NUMBER, 'coverage', 'PS-2027-7K3QDM');
    expect(link).toMatch(/^https:\/\/wa\.me\/919800000000\?text=/);
    const text = decoded(link);
    expect(text).toContain('PS-2027-7K3QDM');
    expect(text).toBe(confirmationText('coverage', 'PS-2027-7K3QDM'));
    for (const secret of [FICTIONAL.name, FICTIONAL.phone, FICTIONAL.email, FICTIONAL.organization, '9876543210']) {
      expect(text).not.toContain(secret);
    }
  });

  it('is hidden (null) when there is no usable number', () => {
    expect(confirmationLink(null, 'coverage', 'PS-2027-7K3QDM')).toBeNull();
    expect(confirmationLink('', 'general', 'PS-2027-7K3QDM')).toBeNull();
    expect(fallbackLink('12', 'general', { choices: [] })).toBeNull();
  });

  it('every kind has a human label and a neutral ask text', () => {
    for (const kind of LEAD_KINDS) {
      expect(KIND_LABEL[kind].length).toBeGreaterThan(3);
      expect(askText(kind)).toMatch(/^Hi Power Smash/);
    }
  });
});

describe('fallback text (when sending failed): no personal data beyond the visitor\'s own message', () => {
  it('lists non-personal choices and the typed message, not name, phone, email or organisation', () => {
    for (const [kind, form] of Object.entries(forms)) {
      const values = { ...fullValues[kind]!, notes: 'Please call after 6 pm.', message: 'We need two cameras.' };
      const link = fallbackLink(NUMBER, form.kind, fallbackSummary(form, values));
      const text = decoded(link);
      expect(text, kind).toMatch(/^Hi Power Smash, I tried to send a /);
      for (const secret of [FICTIONAL.name, FICTIONAL.phone, FICTIONAL.email, FICTIONAL.organization, '9876543210', 'Sample District Association', 'Sample Sports Pvt', 'sample-sports.in']) {
        expect(text, `${kind} leaked ${secret}`).not.toContain(secret);
      }
    }
  });

  it('includes the event and the typed message so the owner can pick it up', () => {
    const form = forms.coverage!;
    const text = decoded(fallbackLink(NUMBER, 'coverage', fallbackSummary(form, fullValues.coverage!)));
    expect(text).toContain('Tournament name: Sample Open 2027');
    expect(text).toContain('First day of the tournament: 10 February 2027');
    expect(text).toContain('Package: Essential');
    expect(text).toContain('My message: Please call after 6 pm.');
  });

  it('no summary field in any form is personal data (name, phone, email, organisation, company, organizer, link)', () => {
    for (const [kind, form] of Object.entries(forms)) {
      for (const field of allFields(form)) {
        if (field.summary) expect(PERSONAL_FIELD_NAMES, `${kind}.${field.name}`).not.toContain(field.name);
      }
    }
  });

  it('scrubs emails, links and phone-like numbers out of the typed message too', () => {
    const dirty = 'Call me on +91 98765 43210 or 98765-43210, mail test@example.com, see https://x.example/a and www.y.example now';
    const clean = scrubForWhatsApp(dirty, 400);
    expect(clean).not.toMatch(/\d{5}/);
    expect(clean).not.toContain('@');
    expect(clean).not.toMatch(/https?:|www\./);
    expect(clean).toContain('Call me on');
  });

  it('keeps the text short and drops control characters', () => {
    const text = fallbackText('general', { choices: [], message: `line one\n\n\tline two ${'x'.repeat(2000)}\u0000` });
    expect(text.length).toBeLessThanOrEqual(900);
    expect(text).not.toMatch(/[\u0000-\u0008\u000B-\u001F]/);
    expect(text).toContain('My message: line one line two');
  });

  it('an empty message adds no "My message" line', () => {
    expect(fallbackText('general', { choices: ['Package: Essential'], message: '   ' })).not.toContain('My message');
  });
});

describe('analytics: three events, no personal data, never blocks', () => {
  it('uses names from the allow-list and only the path plus fixed labels', () => {
    const body = buildEventBody('form_start', '/book?utm_source=x#top', { form: 'coverage' });
    expect(EVENT_NAMES).toContain(body.name);
    expect(body).toEqual({ name: 'form_start', path: '/book', props: { form: 'coverage' } });
    expect(buildEventBody('whatsapp_click', '/contact', { context: 'confirmation', form: 'general' })).toEqual({
      name: 'whatsapp_click',
      path: '/contact',
      props: { page_type: 'general', context: 'confirmation' },
    });
    expect(buildEventBody('form_submit', '/partner', { form: 'sponsorship' })).toEqual({
      name: 'form_submit',
      path: '/partner',
      props: { form: 'sponsorship', ok: true },
    });
  });

  it('the Worker\'s event contract keeps every prop we send (nothing is silently dropped)', () => {
    const bodies = [
      buildEventBody('form_start', '/book', { form: 'coverage' }),
      buildEventBody('form_submit', '/tournaments/submit', { form: 'tournament_submission' }),
      buildEventBody('whatsapp_click', '/partner', { context: 'rate-limited', form: 'sponsorship' }),
    ];
    for (const body of bodies) {
      const result = validateEvent(body);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event.path).toBe(body.path);
        expect(result.event.props).toEqual(body.props ?? {});
      }
    }
  });

  it('the body can only carry fixed labels: even a caller that passes typed text cannot get it into the event', () => {
    const sneaky = { form: 'coverage', context: 'fallback', name: FICTIONAL.name, phone: FICTIONAL.phone, email: FICTIONAL.email } as never;
    const body = JSON.stringify(buildEventBody('whatsapp_click', '/book', sneaky));
    for (const secret of [FICTIONAL.name, FICTIONAL.phone, FICTIONAL.email]) expect(body).not.toContain(secret);
  });

  it('prefers sendBeacon with a JSON blob, to the first-party endpoint', async () => {
    const calls: { url: string; data: Blob }[] = [];
    const ok = sendEvent(buildEventBody('form_submit', '/book', { form: 'coverage' }), {
      sendBeacon: (url, data) => {
        calls.push({ url, data: data as Blob });
        return true;
      },
      fetchImpl: vi.fn() as never,
    });
    expect(ok).toBe(true);
    expect(calls[0]!.url).toBe(EVENT_ENDPOINT);
    expect(calls[0]!.data.type).toBe('application/json');
    expect(JSON.parse(await calls[0]!.data.text())).toEqual({ name: 'form_submit', path: '/book', props: { form: 'coverage', ok: true } });
  });

  it('falls back to fetch with keepalive when sendBeacon refuses, and ignores a failing fetch', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const ok = sendEvent(buildEventBody('whatsapp_click', '/book', { context: 'form-side' }), { sendBeacon: () => false, fetchImpl: fetchImpl as never });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(EVENT_ENDPOINT, expect.objectContaining({ method: 'POST', keepalive: true }));
    await Promise.resolve();
  });

  it('never throws, even when everything is missing or broken', () => {
    expect(sendEvent(buildEventBody('form_start', '/x'), {})).toBe(false);
    expect(
      sendEvent(buildEventBody('form_start', '/x'), {
        sendBeacon: () => {
          throw new Error('boom');
        },
      }),
    ).toBe(false);
  });
});
