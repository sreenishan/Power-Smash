// Client and server share ONE rule module (src/lib/registration/constants.ts): the form's checks and the endpoint's validation must
// agree on every input, and the SQL (migration 0020) must hold the same shapes for the reference, the payment reference and the card
// rule. Fictional values only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_ERROR_CODES,
  REGISTRATION_ERROR_MESSAGES,
  REGISTRATION_ERROR_STATUS,
  REGISTRATION_FIELD_CODES,
  REGISTRATION_FIELD_MESSAGES,
  REGISTRATION_REF_PATTERN,
  checkRegistrationFields,
  looksLikeCardNumber,
  normalisePaymentReference,
  playerNameKey,
  playersForCategory,
} from '../../src/lib/registration/constants';
import { validateRegistrationRequest } from '../../src/lib/registration/contract';
import { buildRegistrationBody, EMPTY_REGISTRATION_VALUES } from '../../src/lib/registration/form-logic';
import { makeRegistrationRef } from '../../src/lib/registration/store';
import { REGISTRATION_CONSENT } from '../../src/lib/registration/consent';
import { body, NOW, seqBytes, uuid } from './helpers';

const SQL = readFileSync(new URL('../../supabase/migrations/0020_registrations.sql', import.meta.url), 'utf8');

const CASES: Array<Record<string, string>> = [
  { player1Name: 'Fake Reg Alpha', phone: '90000 00001' },
  { player1Name: 'Fake Reg Alpha', phone: '+91 90000 00001', email: 'A@Example.Test' },
  { player1Name: '', phone: '90000 00001' },
  { player1Name: 'A', phone: '90000 00001' },
  { player1Name: '=cmd', phone: '90000 00001' },
  { player1Name: 'fake.com', phone: '90000 00001' },
  { player1Name: 'Fake 9000000001', phone: '90000 00001' },
  { player1Name: 'ஃபேக் வீரர்', phone: '90000 00001' },
  { player1Name: 'Fake Reg Alpha', phone: '12345' },
  { player1Name: 'Fake Reg Alpha', phone: '' },
  { player1Name: 'Fake Reg Alpha', phone: '90000 00001', email: 'nope' },
  { player1Name: 'Fake Reg Alpha', phone: '90000 00001', paymentReference: '4111111111111111' },
  { player1Name: 'Fake Reg Alpha', phone: '90000 00001', paymentReference: 'abc' },
  { player1Name: 'Fake Reg Alpha', phone: '90000 00001', paymentReference: '412345678901' },
  { player1Name: 'Fake Reg Alpha', phone: '90000 00001', player2Name: 'Fake Reg Bravo' },
  { player1Name: 'Fake Reg Alpha', phone: '90000 00001', player2Name: 'fake  reg alpha' },
];

describe('one rule set for the form and the server', () => {
  for (const c of CASES) {
    it(`agree on ${JSON.stringify(c)}`, () => {
      const playersNeeded = c.player2Name ? 2 : 1;
      const client = checkRegistrationFields(
        { player1Name: c.player1Name ?? '', player2Name: c.player2Name ?? '', phone: c.phone ?? '', email: c.email ?? '', paymentReference: c.paymentReference ?? '', consent: true },
        playersNeeded,
      );
      const server = validateRegistrationRequest(body({ ...c, email: c.email, paymentReference: c.paymentReference }));
      if (client.ok) {
        expect(server.ok).toBe(true);
        if (server.ok) {
          expect(server.data.player1Name).toBe(client.value.player1Name);
          expect(server.data.phone).toBe(client.value.phone);
          expect(server.data.email).toBe(client.value.email);
          expect(server.data.paymentReference).toBe(client.value.paymentReference);
          expect(server.data.player2Name).toBe(client.value.player2Name);
        }
      } else {
        expect(server.ok).toBe(false);
        if (!server.ok) expect(server.fieldErrors).toEqual(client.fieldErrors);
      }
    });
  }

  it('the form body the browser builds passes the server contract unchanged', () => {
    const built = buildRegistrationBody({
      eventId: uuid(7),
      playersNeeded: 2,
      values: { ...EMPTY_REGISTRATION_VALUES, player1Name: 'Fake Reg Alpha', player2Name: 'Fake Reg Bravo', phone: '90000 00001', paymentReference: 'utr-0000 1111 22', consent: true, whatsappOk: true },
      consent: { id: REGISTRATION_CONSENT.id, version: REGISTRATION_CONSENT.version },
      idempotencyKey: uuid(8),
      token: 'fake-token',
      honeypot: '',
      elapsedMs: 4000,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const server = validateRegistrationRequest(JSON.parse(JSON.stringify(built.body)));
    expect(server.ok).toBe(true);
    // the tick travels with the body; the server refuses the same body when it is not ticked
    expect(built.body.consent.given).toBe(true);
    const unticked = validateRegistrationRequest({ ...JSON.parse(JSON.stringify(built.body)), consent: { ...built.body.consent, given: false } });
    expect(unticked).toEqual({ ok: false, fieldErrors: { consent: 'consent_required' } });
  });

  it('a singles form ignores a partner name; a doubles form needs a different partner', () => {
    const base = { ...EMPTY_REGISTRATION_VALUES, player1Name: 'Fake Reg Alpha', phone: '90000 00001', consent: true };
    const mk = (playersNeeded: 1 | 2, player2Name: string) =>
      buildRegistrationBody({ eventId: uuid(1), playersNeeded, values: { ...base, player2Name }, consent: { id: 'x', version: 'y' }, idempotencyKey: uuid(2), token: 't', honeypot: '', elapsedMs: 3000 });
    const singles = mk(1, 'Fake Reg Bravo');
    expect(singles.ok && singles.body.player2Name).toBe(undefined);
    expect(mk(2, '')).toEqual({ ok: false, fieldErrors: { player2Name: 'partner_required' } });
    expect(mk(2, 'FAKE reg   alpha')).toEqual({ ok: false, fieldErrors: { player2Name: 'partner_required' } });
  });

  it('every error and field code has a plain message, and every error has a status', () => {
    for (const c of REGISTRATION_ERROR_CODES) {
      expect(REGISTRATION_ERROR_MESSAGES[c]).toMatch(/\.$/);
      expect(REGISTRATION_ERROR_STATUS[c]).toBeGreaterThanOrEqual(400);
    }
    for (const c of REGISTRATION_FIELD_CODES) expect(REGISTRATION_FIELD_MESSAGES[c].length).toBeGreaterThan(5);
    // no fee, price or reply-time promise in any visitor message
    expect(JSON.stringify([REGISTRATION_ERROR_MESSAGES, REGISTRATION_FIELD_MESSAGES])).not.toMatch(/₹\s?\d|\b\d+\s?hours?\b|rupees? \d/i);
  });
});

describe('payment reference and card rule (TS and SQL)', () => {
  it('cleans spaces and hyphens, upper-cases, and refuses card numbers', () => {
    expect(normalisePaymentReference(' utr-1234 5678 90 ')).toEqual({ ok: true, value: 'UTR1234567890' });
    expect(normalisePaymentReference('')).toEqual({ ok: true, value: null });
    expect(normalisePaymentReference('412345678901')).toEqual({ ok: true, value: '412345678901' }); // a 12-digit UPI reference
    expect(normalisePaymentReference('4111 1111 1111 1111')).toEqual({ ok: false, code: 'card_not_allowed' });
    expect(normalisePaymentReference('5555-5555-5555-4444')).toEqual({ ok: false, code: 'card_not_allowed' });
    expect(normalisePaymentReference('upi pin 1234')).toEqual({ ok: false, code: 'invalid_reference' });
    expect(normalisePaymentReference('name@okfake')).toEqual({ ok: false, code: 'invalid_reference' });
    expect(normalisePaymentReference('my password 12345678')).toEqual({ ok: false, code: 'invalid_reference' });
    expect(normalisePaymentReference('OTP 123456')).toEqual({ ok: false, code: 'invalid_reference' });
    expect(normalisePaymentReference('ABCDEFGH12')).toEqual({ ok: false, code: 'invalid_reference' }); // fewer than 6 digits
    expect(normalisePaymentReference('SBIN123456789012')).toEqual({ ok: true, value: 'SBIN123456789012' }); // a bank (NEFT) reference
    expect(looksLikeCardNumber('4111111111111112')).toBe(false);
  });

  it('the SQL holds the same shapes', () => {
    expect(SQL).toContain("payment_reference ~ '^[A-Z0-9]{8,30}$' and length(regexp_replace(payment_reference, '[^0-9]', '', 'g')) >= 6 and not app.registration_card_like(payment_reference)");
    expect(SQL).toContain("p !~ '^[0-9]{13,19}$'");
    expect(SQL).toContain("check (ref ~ '^PSR-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$')");
    expect(REGISTRATION_REF_PATTERN.source).toBe('^PSR-\\d{4}-[0-9A-HJKMNP-TV-Z]{6}$');
    // the name key in TS mirrors the generated column
    expect(SQL).toContain("lower(regexp_replace(player1_name, '\\s+', ' ', 'g'))");
    expect(playerNameKey('  Fake   REG alpha ')).toBe('fake reg alpha');
    // singles and doubles
    expect(SQL).toContain("case when e.category in ('MS', 'WS', 'BS', 'GS') then 1 else 2 end");
    expect(['MS', 'WS', 'BS', 'GS'].map(playersForCategory)).toEqual([1, 1, 1, 1]);
    expect(['MD', 'WD', 'XD', 'BD', 'GD'].map(playersForCategory)).toEqual([2, 2, 2, 2, 2]);
  });

  it('the registration reference is PSR-<IST year>-<6>', () => {
    const ref = makeRegistrationRef(NOW, seqBytes());
    expect(ref).toMatch(REGISTRATION_REF_PATTERN);
    expect(ref.startsWith('PSR-2026-')).toBe(true);
  });
});
