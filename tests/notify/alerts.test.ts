import { describe, expect, it } from 'vitest';
import { createLeadHandler } from '../../src/lib/leads/handler';
import { notifyDegraded, notifyFlood, notifyNewLead, type NotifyContext } from '../../src/lib/notify/alerts';
import { createSupabaseRateStore } from '../../src/lib/security/ratelimit';
import { parseHmacKey } from '../../src/lib/security/hash';
import { createSupabaseRest } from '../../src/lib/supabase/rest';
import { coverageBody, createWorld, FAKE, fakeConfig, leadRequest, makeDeps, NOW, readJson, validUuid } from '../leads/helpers';

const EMAIL_ON = { EMAIL_ENABLED: 'true', RESEND_API_KEY: FAKE.resendKey, EMAIL_FROM: FAKE.emailFrom, OWNER_EMAIL: FAKE.ownerEmail };

function ctx(world = createWorld(), env: Record<string, string | undefined> = {}): NotifyContext & { world: ReturnType<typeof createWorld> } {
  const db = createSupabaseRest({ url: FAKE.supabaseUrl, secretKey: FAKE.supabaseSecret, fetch: world.fetch });
  return { world, config: fakeConfig(env), fetch: world.fetch, now: () => NOW, store: createSupabaseRateStore(db), hmac: parseHmacKey(FAKE.hmacKey) };
}

const lead = { ref: 'PS-2026-7K3QDM', kind: 'coverage' as const, name: 'Ravi Kumar', phone: '919876543210', district: 'Madurai', email: 'ravi@example.test' };

describe('email is OFF until EMAIL_ENABLED=true (D-022)', () => {
  it('Telegram only, even if the Resend variables are present', async () => {
    const c = ctx(createWorld(), { RESEND_API_KEY: FAKE.resendKey, EMAIL_FROM: FAKE.emailFrom, OWNER_EMAIL: FAKE.ownerEmail });
    const out = await notifyNewLead(c, lead);
    expect(out).toEqual({ telegram: 'sent', ownerEmail: 'skipped', ackEmail: 'skipped', ownerAlerted: true });
    expect(c.world.callsTo('api.resend.com')).toHaveLength(0);
    expect(c.world.telegramMessages()).toHaveLength(1);
  });

  it('only the exact string "true" turns it on', async () => {
    for (const v of ['TRUE', '1', 'yes', 'on', ' ', '']) {
      const c = ctx(createWorld(), { ...EMAIL_ON, EMAIL_ENABLED: v });
      await notifyNewLead(c, lead);
      expect(c.world.callsTo('api.resend.com'), JSON.stringify(v)).toHaveLength(0);
    }
  });

  it('end to end through the handler: a lead with an email sends no mail while the flag is off', async () => {
    const world = createWorld();
    const h = makeDeps(world, {}, { RESEND_API_KEY: FAKE.resendKey, EMAIL_FROM: FAKE.emailFrom, OWNER_EMAIL: FAKE.ownerEmail });
    const res = await createLeadHandler(h.deps)(leadRequest(coverageBody({ email: 'ravi@example.test' })));
    expect(res.status).toBe(201);
    expect(world.callsTo('api.resend.com')).toHaveLength(0);
    expect(String((await readJson(res)).waLink)).toContain('wa.me'); // the confirmation screen's receipt is the WhatsApp link
  });
});

describe('email ON (after the domain is verified)', () => {
  it('sends the owner alert and the customer acknowledgement, each with an idempotency key', async () => {
    const c = ctx(createWorld(), EMAIL_ON);
    const out = await notifyNewLead(c, lead);
    expect(out).toEqual({ telegram: 'sent', ownerEmail: 'sent', ackEmail: 'sent', ownerAlerted: true });
    const mails = c.world.resendMails();
    expect(mails).toHaveLength(2);
    const owner = mails.find((m) => m.to === FAKE.ownerEmail);
    const ack = mails.find((m) => m.to === 'ravi@example.test');
    expect(owner?.subject).toBe('New lead PS-2026-7K3QDM: Coverage enquiry');
    expect(owner?.headers['idempotency-key']).toBe('PS-2026-7K3QDM-owner');
    expect(ack?.subject).toBe("We've got your request - PS-2026-7K3QDM");
    expect(ack?.headers['idempotency-key']).toBe('PS-2026-7K3QDM-ack');
    expect(ack?.text).toContain('Hi Ravi,');
    expect(ack?.text).not.toContain('Kumar');
    expect(ack?.text).not.toContain('Madurai');
    for (const m of mails) expect(m.headers.authorization).toBe(`Bearer ${FAKE.resendKey}`);
  });

  it('one acknowledgement per address per 24 hours (the owner alert still goes every time)', async () => {
    const world = createWorld();
    const c = ctx(world, EMAIL_ON);
    await notifyNewLead(c, lead);
    const second = await notifyNewLead(c, { ...lead, ref: 'PS-2026-BBBBBB' });
    expect(second.ackEmail).toBe('skipped');
    expect(second.ownerEmail).toBe('sent');
    expect(world.resendMails().filter((m) => m.to === 'ravi@example.test')).toHaveLength(1);
    // another address is unaffected; the same address 25 hours later is acknowledged again
    expect((await notifyNewLead(c, { ...lead, ref: 'PS-2026-CCCCCC', email: 'other@example.test' })).ackEmail).toBe('sent');
    const later = { ...c, now: () => new Date(NOW.getTime() + 25 * 3600_000) };
    expect((await notifyNewLead(later, { ...lead, ref: 'PS-2026-DDDDDD' })).ackEmail).toBe('sent');
    // the counter stores a hash, never the address
    expect(JSON.stringify(world.hits)).not.toContain('ravi@example.test');
  });

  it('no acknowledgement for a lead without an email, none if the 24-hour rule cannot be checked', async () => {
    const c = ctx(createWorld(), EMAIL_ON);
    expect((await notifyNewLead(c, { ...lead, email: undefined })).ackEmail).toBe('skipped');
    const blind = { ...c, store: null };
    expect((await notifyNewLead(blind, lead)).ackEmail).toBe('skipped');
    c.world.db.failRateStore = true;
    expect((await notifyNewLead(c, lead)).ackEmail).toBe('skipped');
  });

  it('a mail address with CR/LF in it is never sent (header injection)', async () => {
    const c = ctx(createWorld(), EMAIL_ON);
    const out = await notifyNewLead(c, { ...lead, email: 'x@example.test\r\nBcc: evil@example.test' });
    expect(out.ackEmail).toBe('failed');
    expect(c.world.resendMails().map((m) => m.to)).not.toContain('x@example.test\r\nBcc: evil@example.test');
    for (const m of c.world.resendMails()) expect(m.to).not.toMatch(/[\r\n]/);
  });

  it('each channel fails independently; the owner is alerted if either owner channel works', async () => {
    const a = ctx(createWorld(), EMAIL_ON);
    a.world.telegram.mode = 'fail';
    expect(await notifyNewLead(a, lead)).toMatchObject({ telegram: 'failed', ownerEmail: 'sent', ownerAlerted: true });
    const b = ctx(createWorld(), EMAIL_ON);
    b.world.resend.mode = 'fail';
    expect(await notifyNewLead(b, lead)).toMatchObject({ telegram: 'sent', ownerEmail: 'failed', ackEmail: 'failed', ownerAlerted: true });
    const both = ctx(createWorld(), EMAIL_ON);
    both.world.telegram.mode = 'throw';
    both.world.resend.mode = 'throw';
    expect((await notifyNewLead(both, lead)).ownerAlerted).toBe(false);
  });

  it('needs the key and the sender; the owner address is optional only for the customer mail', async () => {
    const noKey = ctx(createWorld(), { ...EMAIL_ON, RESEND_API_KEY: undefined });
    await notifyNewLead(noKey, lead);
    expect(noKey.world.callsTo('api.resend.com')).toHaveLength(0);
    const noOwner = ctx(createWorld(), { ...EMAIL_ON, OWNER_EMAIL: undefined });
    expect((await notifyNewLead(noOwner, lead)).ownerEmail).toBe('skipped');
    expect(noOwner.world.resendMails().map((m) => m.to)).toEqual(['ravi@example.test']);
  });
});

describe('no channels configured', () => {
  it('nobody was told: ownerAlerted is false (the lead row is then marked alert_state=failed)', async () => {
    const c = ctx(createWorld(), { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined });
    expect(await notifyNewLead(c, lead)).toEqual({ telegram: 'skipped', ownerEmail: 'skipped', ackEmail: 'skipped', ownerAlerted: false });
  });
});

describe('degraded alert', () => {
  it('Telegram says NOT SAVED and holds no phone by default (R-TELEGRAM-PHONE); the reply link only when switched on', async () => {
    const c = ctx();
    expect(await notifyDegraded(c, lead)).toBe(true);
    expect(c.world.telegramMessages()[0]).toMatch(/^LEAD NOT SAVED \(database problem\): PS-2026-7K3QDM/);
    expect(c.world.telegramMessages()[0]).not.toContain('wa.me');
    const on = ctx(createWorld(), { TELEGRAM_ALERT_PHONE_LINK: 'true' });
    expect(await notifyDegraded(on, lead)).toBe(true);
    expect(on.world.telegramMessages()[0]).toContain('wa.me/919876543210');
  });
  it('also emails the owner when email is on; false when nothing could be sent', async () => {
    const c = ctx(createWorld(), EMAIL_ON);
    c.world.telegram.mode = 'fail';
    expect(await notifyDegraded(c, lead)).toBe(true);
    expect(c.world.resendMails()[0]?.subject).toContain('NOT SAVED');
    const none = ctx(createWorld(), { TELEGRAM_BOT_TOKEN: undefined });
    expect(await notifyDegraded(none, lead)).toBe(false);
  });
  it('the owner is told about a database failure even for a second, different lead', async () => {
    const world = createWorld();
    world.db.failLeadInsert = true;
    const h = makeDeps(world);
    const handle = createLeadHandler(h.deps);
    await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(201) })));
    await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(202), phone: '99887 76655' }), { headers: { 'x-vercel-forwarded-for': '203.0.113.50' } }));
    expect(world.telegramMessages().filter((m) => m.startsWith('LEAD NOT SAVED'))).toHaveLength(2);
  });
});

describe('R-TELEGRAM-PHONE: the owner alert holds the phone only when TELEGRAM_ALERT_PHONE_LINK is exactly "true"', () => {
  const owner = { ...lead, sourcePath: '/book/' };

  it('default (unset): neither the Telegram alert nor the owner email carries a phone, a wa.me link or the email address', async () => {
    const c = ctx(createWorld(), EMAIL_ON);
    await notifyNewLead(c, owner);
    const texts = [...c.world.telegramMessages(), ...c.world.resendMails().filter((m) => m.to === FAKE.ownerEmail).map((m) => m.text)];
    expect(texts).toHaveLength(2);
    for (const t of texts) {
      for (const forbidden of ['919876543210', '9876543210', 'wa.me', 'ravi@example.test', 'Madurai', 'Kumar']) expect(t, forbidden).not.toContain(forbidden);
      expect(t).toContain('Open the lead in Supabase Studio (leads table, reference PS-2026-7K3QDM)');
      expect(t).toContain('Page: /book/');
    }
  });

  it('only the exact string "true" switches it on (the owner email follows the same switch)', async () => {
    for (const v of ['TRUE', 'yes', '1', ' ', '']) {
      const c = ctx(createWorld(), { ...EMAIL_ON, TELEGRAM_ALERT_PHONE_LINK: v });
      await notifyNewLead(c, owner);
      expect(c.world.telegramMessages()[0], JSON.stringify(v)).not.toContain('wa.me');
    }
    const on = ctx(createWorld(), { ...EMAIL_ON, TELEGRAM_ALERT_PHONE_LINK: 'true' });
    await notifyNewLead(on, owner);
    expect(on.world.telegramMessages()[0]).toContain('https://wa.me/919876543210?text=');
    expect(on.world.resendMails().find((m) => m.to === FAKE.ownerEmail)?.text).toContain('https://wa.me/919876543210?text=');
    expect(on.world.telegramMessages()[0]).not.toContain('ravi@example.test'); // the email address is never in an alert
  });

  it('through the handler: a stored lead alerts with the source page and no phone by default', async () => {
    const world = createWorld();
    const h = makeDeps(world);
    await createLeadHandler(h.deps)(leadRequest(coverageBody({ source: { path: '/book/', utm: { source: 'ig' } } })));
    const msg = world.telegramMessages()[0] as string;
    expect(msg).toContain('Page: /book/');
    expect(msg).not.toMatch(/wa\.me|9876543210|Chennai/);
  });
});

describe('R-ACK-PROMISE: the acknowledgement promises a reply time only when the owner supplied one', () => {
  it('default wording has no time; a configured reply window is used', async () => {
    const none = ctx(createWorld(), EMAIL_ON);
    await notifyNewLead(none, lead);
    const text = none.world.resendMails().find((m) => m.to === 'ravi@example.test')?.text as string;
    expect(text).toContain('We will get back to you as soon as we can.');
    expect(text).not.toMatch(/24 hours|within/i);

    const given = ctx(createWorld(), EMAIL_ON);
    const withWindow = { ...given, config: { ...given.config, replyWindow: '2 working days' } };
    await notifyNewLead(withWindow, lead);
    expect(given.world.resendMails().find((m) => m.to === 'ravi@example.test')?.text).toContain('We will reply within 2 working days.');
  });
});

describe('S-6: aliases of one mailbox share the acknowledgement allowance', () => {
  it('victim+1@gmail.com and v.ictim@googlemail.com count as victim@gmail.com', async () => {
    const world = createWorld();
    const c = ctx(world, EMAIL_ON);
    expect((await notifyNewLead(c, { ...lead, email: 'victim@gmail.com' })).ackEmail).toBe('sent');
    for (const [i, alias] of ['victim+1@gmail.com', 'v.ictim@gmail.com', 'v.ictim+x@googlemail.com'].entries()) {
      expect((await notifyNewLead(c, { ...lead, ref: `PS-2026-AAAA${i}A`, email: alias })).ackEmail, alias).toBe('skipped');
    }
    expect(world.resendMails().filter((m) => /victim|v\.ictim/.test(m.to))).toHaveLength(1);
  });
});

describe('S-6: flood notice', () => {
  it('tells the owner once per hour, on Telegram and by email when it is on, with no visitor data', async () => {
    const c = ctx(createWorld(), EMAIL_ON);
    expect(await notifyFlood(c, 40)).toBe(true);
    expect(await notifyFlood(c, 40)).toBe(false); // the notice is itself limited to one an hour
    expect(c.world.telegramMessages()).toHaveLength(1);
    expect(c.world.telegramMessages()[0]).toContain('FLOOD PROTECTION IS ON');
    expect(c.world.telegramMessages()[0]).toContain('more than 40 enquiries');
    expect(c.world.resendMails()).toHaveLength(1);
    const later = { ...c, now: () => new Date(NOW.getTime() + 61 * 60_000) };
    expect(await notifyFlood(later, 40)).toBe(true);
  });

  it('the notice names the window that tripped (hour or day)', async () => {
    const c = ctx(createWorld());
    expect(await notifyFlood(c, 100, 'day')).toBe(true);
    expect(c.world.telegramMessages()[0]).toContain('more than 100 enquiries were saved in the last day');
    expect(c.world.telegramMessages()[0]).not.toContain('last hour');
  });

  it('stays silent when the counter cannot be used (no flood of notices)', async () => {
    const c = ctx(createWorld());
    expect(await notifyFlood({ ...c, store: null }, 40)).toBe(false);
    expect(c.world.callsTo('api.telegram.org')).toHaveLength(0);
  });
});
