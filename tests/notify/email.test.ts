import { describe, expect, it } from 'vitest';
import { buildAckEmail, buildOwnerAlertEmail, readCappedText, RESEND_ERROR_BODY_MAX, RESEND_URL, safeMailbox, sendEmail } from '../../src/lib/notify/email';

const msg = { from: 'Power Smash <hello@mail.example.test>', to: 'a@example.test', subject: 'Hello', text: 'Body' };

function capture(status = 200, body: unknown = { id: 'x' }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url, headers, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, f };
}

describe('safeMailbox', () => {
  it('accepts a bare address or a simple display name', () => {
    expect(safeMailbox('hello@mail.example.test')).toBe('hello@mail.example.test');
    expect(safeMailbox('Power Smash <Hello@Mail.Example.Test>')).toBe('Power Smash <hello@mail.example.test>');
  });
  it('refuses CR/LF injection, extra recipients and odd characters', () => {
    for (const bad of ['a@example.test\r\nBcc: x@example.test', 'a@example.test\nSubject: x', 'Evil <x@example.test>\r\n', '"Evil" <a@example.test>', 'a@example.test, b@example.test', 'Name <a@example.test> <b@example.test>', '', 'noat', 'A<B <a@example.test>']) {
      expect(safeMailbox(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('sendEmail (Resend REST)', () => {
  it('posts JSON with Bearer auth and an idempotency key', async () => {
    const { calls, f } = capture();
    expect(await sendEmail({ fetch: f, apiKey: 're_FAKE', message: { ...msg, idempotencyKey: 'PS-2026-AAAAAA-owner', replyTo: 'reply@example.test' } })).toEqual({ ok: true });
    expect(calls[0]?.url).toBe(RESEND_URL);
    expect(calls[0]?.headers.authorization).toBe('Bearer re_FAKE');
    expect(calls[0]?.headers['idempotency-key']).toBe('PS-2026-AAAAAA-owner');
    expect(calls[0]?.body).toEqual({ from: 'Power Smash <hello@mail.example.test>', to: 'a@example.test', subject: 'Hello', text: 'Body', reply_to: 'reply@example.test' });
    expect(calls[0]?.body.html).toBeUndefined(); // text only: nothing is ever interpreted as markup
  });

  it('refuses header injection before any request is made', async () => {
    const { calls, f } = capture();
    for (const m of [
      { ...msg, subject: 'Hi\r\nBcc: evil@example.test' },
      { ...msg, to: 'a@example.test\r\nBcc: evil@example.test' },
      { ...msg, from: 'x@example.test\nBcc: e@example.test' },
      { ...msg, replyTo: 'r@example.test\r\n' },
      { ...msg, idempotencyKey: 'k\r\nX: y' },
      { ...msg, subject: 'x'.repeat(300) },
    ]) {
      expect(await sendEmail({ fetch: f, apiKey: 're_FAKE', message: m })).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(calls).toHaveLength(0);
  });

  it('maps failures to small codes; a 409 is never "sent" (VF-R2)', async () => {
    // the same key still in flight: try again later (Resend then answers with the first result, without sending twice)
    expect(await sendEmail({ fetch: capture(409, { name: 'concurrent_idempotent_requests', message: 'x' }).f, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'unavailable' });
    // the key was used for different content: a permanent failure, never retried
    expect(await sendEmail({ fetch: capture(409, { name: 'invalid_idempotent_request', message: 'x' }).f, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'rejected' });
    // an unreadable 409 body: temporary
    expect(await sendEmail({ fetch: capture(409, 'not json').f, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await sendEmail({ fetch: capture(429).f, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'rate_limited' });
    expect(await sendEmail({ fetch: capture(403).f, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'rejected' });
    expect(await sendEmail({ fetch: capture(500).f, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await sendEmail({ fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await sendEmail({ fetch: capture().f, apiKey: null, message: msg })).toEqual({ ok: false, reason: 'unconfigured' });
  });
});

describe('the 409 body is read with a cap', () => {
  it('reads a small body, refuses a declared or streamed body over the cap without buffering the rest', async () => {
    expect(await readCappedText(new Response('{"name":"x"}'), RESEND_ERROR_BODY_MAX)).toBe('{"name":"x"}');
    expect(await readCappedText(new Response('abc', { headers: { 'content-length': String(RESEND_ERROR_BODY_MAX + 1) } }), RESEND_ERROR_BODY_MAX)).toBeNull();
    // a body with no length that never ends: the reader stops after the cap instead of buffering it all
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        c.enqueue(new Uint8Array(512).fill(32));
      },
    });
    expect(await readCappedText(new Response(endless), RESEND_ERROR_BODY_MAX)).toBeNull();
    expect(pulled).toBeLessThan(20);
  });
  it('a 409 with an oversized body is a temporary failure, never "sent"', async () => {
    const big = { name: 'invalid_idempotent_request', message: 'x'.repeat(RESEND_ERROR_BODY_MAX * 2) };
    expect(await sendEmail({ fetch: capture(409, big).f, apiKey: 'k', message: msg })).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('message builders', () => {
  const lead = { ref: 'PS-2026-7K3QDM', kind: 'sponsorship' as const, name: 'Ravi Kumar', phone: '919876543210', district: 'Madurai', sourcePath: '/partner/' };

  it('owner alert: the same minimal content as Telegram, and by default NO phone (R-TELEGRAM-PHONE)', () => {
    const mail = buildOwnerAlertEmail(lead);
    expect(mail.subject).toBe('New lead PS-2026-7K3QDM: Sponsorship enquiry');
    expect(mail.text).toContain('From: Ravi');
    expect(mail.text).toContain('Page: /partner/');
    expect(mail.text).toContain('Open the lead in Supabase Studio (leads table, reference PS-2026-7K3QDM)');
    for (const forbidden of ['Kumar', 'wa.me', '919876543210', 'Madurai']) expect(mail.text, forbidden).not.toContain(forbidden);
  });

  it('owner alert with TELEGRAM_ALERT_PHONE_LINK=true carries the WhatsApp reply link and the district', () => {
    const mail = buildOwnerAlertEmail(lead, { includePhoneLink: true });
    expect(mail.text).toContain('https://wa.me/919876543210');
    expect(mail.text).toContain('District: Madurai');
    expect(mail.text).not.toContain('Kumar');
  });

  it('acknowledgement: only the reference and a sanitised first name, per the Appendix D template', () => {
    const mail = buildAckEmail({ ref: 'PS-2026-7K3QDM', name: 'Ravi\r\nBcc: evil@example.test Kumar', kind: 'coverage', whatsappNumber: '919999900000' });
    expect(mail.subject).toBe("We've got your request - PS-2026-7K3QDM");
    expect(mail.text).toContain('Hi Ravi, thanks for contacting Power Smash.');
    expect(mail.text).toContain('Reference: PS-2026-7K3QDM');
    expect(mail.text).toContain('https://wa.me/919999900000?text=');
    expect(mail.text).not.toContain('evil');
    expect(mail.text).not.toContain('Kumar');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    const noWa = buildAckEmail({ ref: 'PS-2026-7K3QDM', name: 'Ravi', kind: 'general', whatsappNumber: null });
    expect(noWa.text).not.toContain('wa.me');
    expect(noWa.text).toContain('message');
  });

  it('R-ACK-PROMISE: no reply time is promised unless the owner supplied one (never "24 hours" by default)', () => {
    const base = { ref: 'PS-2026-7K3QDM', name: 'Ravi', kind: 'coverage' as const, whatsappNumber: null };
    for (const replyWindow of [undefined, null, '', '   ']) {
      const text = buildAckEmail({ ...base, replyWindow }).text;
      expect(text, JSON.stringify(replyWindow)).toContain('We will get back to you as soon as we can.');
      expect(text).not.toMatch(/24 hours|within/i);
    }
    const promised = buildAckEmail({ ...base, replyWindow: '2 working days' }).text;
    expect(promised).toContain('We will reply within 2 working days.');
    expect(promised).not.toContain('as soon as we can');
    // a control character in the owner-supplied text cannot break the layout of the mail
    expect(buildAckEmail({ ...base, replyWindow: 'a day\r\nBcc: x' }).text.split('\n')[0]).toContain('within a day  Bcc: x');
  });
});
