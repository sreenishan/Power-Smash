// Fictional people and tournaments only.
import { describe, expect, it } from 'vitest';
import {
  buildOutboxRecords,
  consentDecision,
  idempotencyKey,
  MAX_KEY_LENGTH,
  NOTIFICATION_KINDS,
  OutboxEventError,
  renderMessage,
  type DomainEvent,
  type Recipient,
} from '../../src/lib/notify/outbox';

const NOW = new Date('2026-11-01T04:00:00.000Z');
const GRANT = { granted: true, grantedAt: '2026-10-01T00:00:00.000Z' };

const adult = (id: string, extra: Partial<Recipient> = {}): Recipient => ({
  id,
  greetingName: 'Kavitha Imaginary',
  ageStatus: 'adult_confirmed',
  consent: { in_app: GRANT, email: GRANT },
  ...extra,
});

const base = { tournamentName: 'Fictional Valley Open 2026', eventName: "Men's Doubles" };

const sampleEvents: DomainEvent[] = [
  { ...base, kind: 'registration_confirmation', eventId: 'reg-1', registrationRef: 'PS-REG-0001' },
  { ...base, kind: 'registration_approved', eventId: 'reg-1', registrationRef: 'PS-REG-0001' },
  { ...base, kind: 'registration_rejected', eventId: 'reg-1', registrationRef: 'PS-REG-0001', reason: 'Event is full' },
  { ...base, kind: 'payment_verification', eventId: 'pay-1', registrationRef: 'PS-REG-0001', outcome: 'verified' },
  { ...base, kind: 'payment_verification', eventId: 'pay-2', registrationRef: 'PS-REG-0001', outcome: 'not_verified' },
  { ...base, kind: 'announcement', eventId: 'ann-1', title: 'Parking update', body: 'Use gate 2.\n\n\n\nThanks.' },
  { ...base, kind: 'schedule_change', eventId: 'm-12', matchLabel: 'Match 12', newStart: '2026-11-07T04:00:00.000Z', previousStart: '2026-11-07T03:00:00.000Z' },
  { ...base, kind: 'court_change', eventId: 'm-12', matchLabel: 'Match 12', newCourt: 'Court 3', previousCourt: 'Court 1' },
  { ...base, kind: 'match_reminder', eventId: 'm-12', matchLabel: 'Match 12', start: '2026-11-07T04:00:00.000Z', court: 'Court 3' },
  { ...base, kind: 'draw_published', eventId: 'draw-1' },
  { ...base, kind: 'results_published', eventId: 'res-1' },
  { ...base, kind: 'postponement', eventId: 'pp-1', scope: 'tournament', newDate: '2026-12-05' },
  { ...base, kind: 'cancellation', eventId: 'cx-1', scope: 'match', matchLabel: 'Match 12', reason: 'Rain damage to the hall' },
];

describe('idempotency keys', () => {
  it('are deterministic and differ by every part', () => {
    const p = { kind: 'court_change' as const, eventId: 'm-12', revision: 0, recipientId: 'u-1', channel: 'email' as const };
    expect(idempotencyKey(p)).toBe(idempotencyKey({ ...p }));
    const keys = new Set([
      idempotencyKey(p),
      idempotencyKey({ ...p, revision: 1 }),
      idempotencyKey({ ...p, recipientId: 'u-2' }),
      idempotencyKey({ ...p, channel: 'in_app' }),
      idempotencyKey({ ...p, kind: 'schedule_change' }),
      idempotencyKey({ ...p, eventId: 'm-13' }),
    ]);
    expect(keys.size).toBe(6);
  });
  it('cannot be made to collide with a separator inside an id', () => {
    const a = idempotencyKey({ kind: 'announcement', eventId: 'a:1', revision: 0, recipientId: 'b', channel: 'email' });
    const b = idempotencyKey({ kind: 'announcement', eventId: 'a', revision: 0, recipientId: '1:b', channel: 'email' });
    expect(a).not.toBe(b);
  });
  it('stays within the length limit for long ids and is still stable', () => {
    const p = { kind: 'announcement' as const, eventId: 'x'.repeat(500), revision: 0, recipientId: 'u-1', channel: 'email' as const };
    const k = idempotencyKey(p);
    expect(k.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    expect(idempotencyKey(p)).toBe(k);
    expect(idempotencyKey({ ...p, eventId: 'x'.repeat(499) + 'y' })).not.toBe(k);
  });
  it('refuses a bad revision or an empty id', () => {
    expect(() => idempotencyKey({ kind: 'announcement', eventId: 'e', revision: -1, recipientId: 'u', channel: 'email' })).toThrow();
    expect(() => idempotencyKey({ kind: 'announcement', eventId: '', revision: 0, recipientId: 'u', channel: 'email' })).toThrow();
  });
});

describe('consent and preferences', () => {
  it('skips a channel without consent, a withdrawn consent and a muted kind', () => {
    const r = adult('u-1', { consent: { email: { granted: true, grantedAt: '2026-10-01T00:00:00Z', withdrawnAt: '2026-10-20T00:00:00Z' }, in_app: GRANT }, mutedKinds: ['announcement'] });
    expect(consentDecision(r, 'whatsapp', 'court_change', NOW)).toBe('no_consent');
    expect(consentDecision(r, 'email', 'court_change', NOW)).toBe('consent_withdrawn');
    expect(consentDecision(r, 'in_app', 'announcement', NOW)).toBe('muted_kind');
    expect(consentDecision(r, 'in_app', 'court_change', NOW)).toBeNull();
  });
  it('treats granted:false, a future grant and an unreadable withdrawal as no permission', () => {
    expect(consentDecision(adult('u', { consent: { email: { granted: false } } }), 'email', 'draw_published', NOW)).toBe('no_consent');
    expect(consentDecision(adult('u', { consent: { email: { granted: false, grantedAt: '2026-01-01T00:00:00Z' } } }), 'email', 'draw_published', NOW)).toBe('consent_withdrawn');
    expect(consentDecision(adult('u', { consent: { email: { granted: true, grantedAt: '2027-01-01T00:00:00Z' } } }), 'email', 'draw_published', NOW)).toBe('no_consent');
    expect(consentDecision(adult('u', { consent: { email: { granted: true, withdrawnAt: 'not a date' } } }), 'email', 'draw_published', NOW)).toBe('consent_withdrawn');
  });
  it('protects juniors and unknown ages unless the contact is a guardian contact (D-012)', () => {
    for (const ageStatus of ['minor_confirmed', 'minor_suspected', 'unknown', null, undefined] as const) {
      expect(consentDecision(adult('u', { ageStatus }), 'email', 'match_reminder', NOW)).toBe('protected_recipient');
      expect(consentDecision(adult('u', { ageStatus, guardianContact: true }), 'email', 'match_reminder', NOW)).toBeNull();
    }
  });
});

describe('buildOutboxRecords', () => {
  const event: DomainEvent = { ...base, kind: 'court_change', eventId: 'm-12', matchLabel: 'Match 12', newCourt: 'Court 3' };

  it('makes one record per recipient and channel, queued or skipped with a reason', () => {
    const recs = buildOutboxRecords(event, [adult('u-1'), adult('u-2', { consent: { in_app: GRANT } })], ['email', 'in_app', 'email', 'whatsapp'], { now: NOW });
    expect(recs).toHaveLength(6);
    const by = (id: string, ch: string) => recs.find((r) => r.recipientId === id && r.channel === ch);
    expect(by('u-1', 'email')?.status).toBe('queued');
    expect(by('u-1', 'whatsapp')).toMatchObject({ status: 'skipped', skipReason: 'no_consent' });
    expect(by('u-2', 'email')).toMatchObject({ status: 'skipped', skipReason: 'no_consent' });
    expect(by('u-2', 'in_app')?.status).toBe('queued');
    for (const r of recs) {
      expect(r.attempts).toBe(0);
      expect(r.createdAt).toBe(NOW.toISOString());
      expect(r.sentAt).toBeNull();
    }
  });

  it('is deterministic: building twice gives identical records, and duplicate recipients are folded', () => {
    const a = buildOutboxRecords(event, [adult('u-1'), adult('u-1')], ['email'], { now: NOW });
    const b = buildOutboxRecords(event, [adult('u-1')], ['email'], { now: NOW });
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
  });

  it('gives a new key for a new revision of the same change', () => {
    const r0 = buildOutboxRecords(event, [adult('u-1')], ['email'], { now: NOW })[0];
    const r1 = buildOutboxRecords({ ...event, revision: 1 }, [adult('u-1')], ['email'], { now: NOW })[0];
    expect(r0?.key).not.toBe(r1?.key);
  });

  it('stores no address: records hold only the opaque recipient id', () => {
    const recs = buildOutboxRecords(event, [adult('u-1')], ['email', 'in_app'], { now: NOW });
    const text = JSON.stringify(recs);
    expect(text).not.toMatch(/@|\b9100000000\d{2}\b|wa\.me/);
  });

  it('expires a reminder at the match start and skips one built after it', () => {
    const rem: DomainEvent = { ...base, kind: 'match_reminder', eventId: 'm-12', matchLabel: 'Match 12', start: '2026-11-01T03:00:00.000Z' };
    const [late] = buildOutboxRecords(rem, [adult('u-1')], ['in_app'], { now: NOW });
    expect(late).toMatchObject({ status: 'skipped', skipReason: 'expired', expiresAt: '2026-11-01T03:00:00.000Z' });
    const [early] = buildOutboxRecords({ ...rem, start: '2026-11-02T03:00:00.000Z' }, [adult('u-1')], ['in_app'], { now: NOW });
    expect(early?.status).toBe('queued');
  });

  it('refuses events that cannot be rendered truthfully', () => {
    expect(() => buildOutboxRecords({ ...event, eventId: ' ' }, [adult('u')], ['email'], { now: NOW })).toThrow(OutboxEventError);
    expect(() => buildOutboxRecords(event, [adult('u')], ['email'], { now: NOW, expiresAt: 'not a time' })).toThrow(OutboxEventError);
    expect(() => buildOutboxRecords(event, [adult('u')], ['email'], { now: NOW, expiresAt: '2026-13-45T99:00:00Z' })).toThrow(OutboxEventError);
    expect(() => buildOutboxRecords({ ...base, kind: 'match_reminder', eventId: 'e', matchLabel: 'M', start: 'tomorrow' }, [adult('u')], ['email'], { now: NOW })).toThrow(OutboxEventError);
    expect(() => buildOutboxRecords({ ...base, kind: 'postponement', eventId: 'e', scope: 'event', newDate: '2026-02-30' }, [adult('u')], ['email'], { now: NOW })).toThrow(OutboxEventError);
  });
});

describe('templates', () => {
  it('covers every kind of the brief with plain text and a one-line subject', () => {
    const kinds = new Set(sampleEvents.map((e) => e.kind));
    expect([...kinds].sort()).toEqual([...NOTIFICATION_KINDS].sort());
    for (const e of sampleEvents) {
      const m = renderMessage(e, { greetingName: 'Kavitha Imaginary' });
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.subject.length).toBeLessThanOrEqual(200);
      expect(m.body.startsWith('Hi Kavitha,')).toBe(true);
      expect(m.body).not.toMatch(/<[a-z]/i);
      expect(m.body).not.toMatch(/TODO/);
    }
  });

  it('never promises a reply time unless the owner set one', () => {
    for (const e of sampleEvents) {
      const m = renderMessage(e, {});
      expect(m.body).not.toMatch(/\b\d+\s*(hours?|days?|minutes?)\b/i);
      expect(m.body).not.toMatch(/within/i);
    }
    const ack = sampleEvents[0] as DomainEvent;
    expect(renderMessage(ack, {}).body).toContain('We will get back to you as soon as we can.');
    expect(renderMessage(ack, {}, { replyWindow: '2 working days' }).body).toContain('We will reply within 2 working days.');
  });

  it('names an opponent only when adult_confirmed (D-012)', () => {
    const rem = (ageStatus: Recipient['ageStatus']): DomainEvent => ({ ...base, kind: 'match_reminder', eventId: 'm', matchLabel: 'Match 12', start: '2026-11-07T04:00:00.000Z', opponent: { name: 'Zed Invented', ageStatus } });
    expect(renderMessage(rem('adult_confirmed'), {}).body).toContain('against Zed Invented');
    for (const s of ['minor_confirmed', 'minor_suspected', 'unknown', null] as const) {
      const body = renderMessage(rem(s), {}).body;
      expect(body).not.toContain('Zed');
      expect(body).toContain('against your opponent');
    }
  });

  it('formats times in India time and payment text asks for no card or PIN', () => {
    const sc = sampleEvents.find((e) => e.kind === 'schedule_change') as DomainEvent;
    expect(renderMessage(sc, {}).body).toMatch(/9:30\s?am.*India time/i);
    const pay = renderMessage(sampleEvents.find((e) => e.kind === 'payment_verification') as DomainEvent, {}).body;
    expect(pay).toContain('by hand');
    expect(pay).toContain('We never ask for your card number, UPI PIN or OTP.');
  });

  it('strips injection from organiser text and adds a link only with an origin and an internal path', () => {
    const e: DomainEvent = { tournamentName: 'Fake Cup\r\nBcc: x@example.test', kind: 'draw_published', eventId: 'd', pagePath: '/tournaments/fake-cup' };
    const noOrigin = renderMessage(e, {});
    expect(noOrigin.subject).not.toMatch(/[\r\n]/);
    expect(noOrigin.body).not.toContain('Details:');
    expect(renderMessage(e, {}, { siteOrigin: 'https://example.test' }).body).toContain('Details: https://example.test/tournaments/fake-cup/');
    expect(renderMessage({ ...e, pagePath: '//evil.example.test/x' }, {}, { siteOrigin: 'https://example.test' }).body).not.toContain('Details:');
  });

  it('greets "there" without a name and strips markup-like names', () => {
    const e = sampleEvents[9] as DomainEvent;
    expect(renderMessage(e, {}).body.startsWith('Hi there,')).toBe(true);
    expect(renderMessage(e, { greetingName: '<script>' }).body).not.toContain('<');
  });
});
