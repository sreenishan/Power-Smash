import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../src/lib/urls';
import { buildAlertText, customerReplyLink, displayPage, sendTelegram, TELEGRAM_TEXT_LIMIT, type AlertLead } from '../../src/lib/notify/telegram';

const lead: AlertLead = { ref: 'PS-2026-7K3QDM', kind: 'coverage', name: 'Ravi Kumar', phone: '919876543210', district: 'Madurai', sourcePath: '/book/' };
const ON = { includePhoneLink: true } as const;

describe('alert text, DEFAULT (R-TELEGRAM-PHONE): no phone, no email, no free text', () => {
  it('has exactly: reference, kind, first name, page and a pointer to Supabase Studio', () => {
    const text = buildAlertText(lead);
    expect(text.split('\n')).toEqual([
      'New lead PS-2026-7K3QDM',
      'Type: Coverage enquiry',
      'From: Ravi',
      'Page: /book/',
      'Open the lead in Supabase Studio (leads table, reference PS-2026-7K3QDM)',
    ]);
  });

  it('holds no phone number in any form, no wa.me link, no district and no email', () => {
    const risky = { ...lead, email: 'ravi@example.test', notes: 'secret note', message: 'hello there', organization: 'Acme Pvt' } as unknown as AlertLead;
    const text = buildAlertText(risky);
    for (const forbidden of ['919876543210', '9876543210', '98765', 'wa.me', 'whatsapp.com', 'Madurai', 'Kumar', 'ravi@example.test', 'secret note', 'hello there', 'Acme', 'Reply on WhatsApp']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/\d{6,}/); // no long digit run at all (a reference has 4 and 6 characters, never 6 digits in a row here)
  });

  it('is plain text: markup characters in the name stay harmless (letters only)', () => {
    const text = buildAlertText({ ...lead, name: '<b>Ravi</b> & <i>x</i>' });
    expect(text).toContain('From: bRavib');
    expect(text).not.toContain('<');
  });

  it('an email-only lead looks the same (nothing about contact details)', () => {
    const text = buildAlertText({ ...lead, phone: undefined, kind: 'general' });
    expect(text).not.toContain('wa.me');
    expect(text).not.toContain('Contact:');
    expect(text.split('\n')).toHaveLength(5);
  });

  it('N-1: the Page line shows the path ONLY when it is a known site route (or /tournaments/<slug>); anything else is "(other)"', () => {
    // every real page, with and without the trailing slash
    for (const route of Object.values(ROUTES)) {
      expect(displayPage(route), route).toBe(route);
      if (route !== '/') expect(displayPage(route.replace(/\/$/, '')), route).toBe(route.replace(/\/$/, ''));
    }
    expect(displayPage('/partner/')).toBe('/partner/');
    expect(displayPage('/book')).toBe('/book');
    // a tournament page: /tournaments/<slug> (lowercase letters, digits, hyphens)
    expect(displayPage('/tournaments/salem-cup-2026/')).toBe('/tournaments/salem-cup-2026/');
    expect(displayPage('/tournaments/salem-cup-2026')).toBe('/tournaments/salem-cup-2026');
    // an attacker-chosen path that only LOOKS like a path is never echoed: not a route, a message in the path, a dot, a deep path
    for (const other of [
      '/evil-brand-name/',
      '/pay-now-to-9876543210/',
      '/call-us-or-lose-your-account/',
      '/evil.com/x',
      '/a b',
      '/x%0Ahttps://evil.example',
      '/' + 'a'.repeat(100),
      '/book/extra/',
      '/tournaments/Salem Cup/',
      '/tournaments/UPPER/',
      '/tournaments/a.b/',
      '/tournaments/' + 'x'.repeat(100) + '/',
      '/tournaments/salem/cup/',
      '/api/lead',
      '/go/anything',
      'book',
      '',
    ]) {
      expect(displayPage(other), JSON.stringify(other)).toBe('(other)');
    }
    // no path at all: no Page line
    expect(displayPage(undefined)).toBeNull();
  });

  it('N-1: through the alert text', () => {
    expect(buildAlertText({ ...lead, sourcePath: '/book/' })).toContain('Page: /book/');
    expect(buildAlertText({ ...lead, sourcePath: '/tournaments/salem-cup/' })).toContain('Page: /tournaments/salem-cup/');
    const other = buildAlertText({ ...lead, sourcePath: '/pay-now-to-this-account-or-else/' });
    expect(other).toContain('Page: (other)');
    expect(other).not.toContain('pay-now');
    expect(buildAlertText({ ...lead, sourcePath: '/evil.example/phish' })).not.toContain('evil');
    expect(buildAlertText({ ...lead, sourcePath: undefined }).split('\n')).toHaveLength(4);
    expect(buildAlertText({ ...lead, sourcePath: '/anything-else/' }).split('\n')).toHaveLength(5);
  });

  it('degraded (not saved) alert says so, quotes the reference and holds no contact details', () => {
    const text = buildAlertText(lead, { degraded: true });
    expect(text.split('\n')[0]).toBe('LEAD NOT SAVED (database problem): PS-2026-7K3QDM');
    expect(text).toContain('NOT saved');
    expect(text).toContain('watch your WhatsApp');
    expect(text).toContain('PS-2026-7K3QDM: watch');
    expect(text).not.toContain('wa.me');
    expect(text).not.toContain('919876543210');
    expect(text).not.toContain('Supabase Studio'); // it is NOT in the leads table, so no pointer there
  });

  it('mentions linked coverage (our own reference only) and never exceeds the Telegram limit', () => {
    expect(buildAlertText({ ...lead, kind: 'tournament_submission', alsoCoverage: 'PS-2026-AAAAAA' })).toContain('Also wants coverage: PS-2026-AAAAAA');
    expect(buildAlertText({ ...lead, alsoCoverage: true })).toContain('Also wants coverage');
    expect(buildAlertText({ ...lead, name: 'D'.repeat(10_000) }).length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });
});

describe('alert text with TELEGRAM_ALERT_PHONE_LINK=true (opt-in: the owner and the lawyer decide)', () => {
  it('adds the district and the one-tap WhatsApp reply link, which holds the phone', () => {
    const lines = buildAlertText(lead, ON).split('\n');
    expect(lines[0]).toBe('New lead PS-2026-7K3QDM');
    expect(lines).toContain('District: Madurai');
    const reply = lines.find((l) => l.startsWith('Reply on WhatsApp: '));
    expect(reply).toMatch(/^Reply on WhatsApp: https:\/\/wa\.me\/919876543210\?text=/);
    expect(lines[lines.length - 1]).toBe('Open the lead in Supabase Studio (leads table, reference PS-2026-7K3QDM)');
  });

  it('still never carries the surname, the email address or free text', () => {
    const risky = { ...lead, email: 'ravi@example.test', notes: 'secret note', message: 'hello there', organization: 'Acme Pvt' } as unknown as AlertLead;
    const text = buildAlertText(risky, ON);
    for (const forbidden of ['Kumar', 'ravi@example.test', 'secret note', 'hello there', 'Acme']) expect(text).not.toContain(forbidden);
  });

  it('strips line breaks and control characters from the district (no fake extra lines)', () => {
    const text = buildAlertText({ ...lead, district: 'Madurai\nReply on WhatsApp: https://evil.example\u0000' }, ON);
    expect(text.split('\n').filter((l) => l.startsWith('Reply on WhatsApp: '))).toHaveLength(1);
    expect(text).not.toContain('\u0000');
  });

  it('handles an email-only lead, a degraded alert and the length limit', () => {
    expect(buildAlertText({ ...lead, phone: undefined, kind: 'general' }, ON)).toContain('Contact: email only');
    const degraded = buildAlertText(lead, { ...ON, degraded: true });
    expect(degraded.split('\n')[0]).toBe('LEAD NOT SAVED (database problem): PS-2026-7K3QDM');
    expect(degraded).toContain('Follow up now');
    expect(degraded).toContain('wa.me/919876543210');
    expect(buildAlertText({ ...lead, district: 'D'.repeat(10_000) }, ON).length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it('the customer link uses waLink with a greeting that has only the first name and the reference', () => {
    const link = customerReplyLink(lead) as string;
    expect(link.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    const text = decodeURIComponent(link.split('?text=')[1] as string);
    expect(text).toBe('Hi Ravi, this is Power Smash. Thanks for your enquiry. Ref PS-2026-7K3QDM.');
    expect(customerReplyLink({ ...lead, phone: undefined })).toBeNull();
  });
});

describe('sendTelegram', () => {
  const ok = { token: '123:FAKE', chatId: '42', text: 'hi' };
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const mk = (statuses: Array<number | 'throw'>) => {
    calls.length = 0;
    let i = 0;
    return (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      const s = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      if (s === 'throw') throw new TypeError('network');
      return new Response(JSON.stringify({ ok: s === 200 }), { status: s as number });
    }) as unknown as typeof fetch;
  };

  it('posts plain text JSON with link previews off and no parse_mode', async () => {
    expect(await sendTelegram({ ...ok, fetch: mk([200]) })).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://api.telegram.org/bot123:FAKE/sendMessage');
    expect(calls[0]?.body).toEqual({ chat_id: '42', text: 'hi', link_preview_options: { is_disabled: true } });
    expect(calls[0]?.body.parse_mode).toBeUndefined();
  });

  it('is unconfigured without a token or a chat id', async () => {
    expect(await sendTelegram({ ...ok, token: null, fetch: mk([200]) })).toEqual({ ok: false, reason: 'unconfigured' });
    expect(await sendTelegram({ ...ok, chatId: null, fetch: mk([200]) })).toEqual({ ok: false, reason: 'unconfigured' });
  });

  it('retries once on a network or server failure, not on a client error', async () => {
    expect(await sendTelegram({ ...ok, fetch: mk(['throw', 200]) })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(await sendTelegram({ ...ok, fetch: mk([500, 500]) })).toEqual({ ok: false, reason: 'unavailable' });
    expect(calls).toHaveLength(2);
    expect(await sendTelegram({ ...ok, fetch: mk([403]) })).toEqual({ ok: false, reason: 'rejected' });
    expect(calls).toHaveLength(1);
    expect(await sendTelegram({ ...ok, fetch: mk([429]) })).toEqual({ ok: false, reason: 'rate_limited' });
    expect(calls).toHaveLength(1);
  });

  it('a failure result never contains the token or the URL', async () => {
    const r = await sendTelegram({ ...ok, fetch: mk(['throw']) });
    expect(JSON.stringify(r)).not.toContain('FAKE');
    expect(JSON.stringify(r)).not.toContain('api.telegram.org');
  });
});
