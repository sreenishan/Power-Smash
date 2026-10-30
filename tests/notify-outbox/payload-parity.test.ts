// One outbox rule, tested on both sides: the cases between the markers in supabase/checks/0023_assertions.sql run through the SQL
// functions there (pg-local) and through the TS copies here. The SQL patterns themselves are compared with the TS constants.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idempotencyKey } from '../../src/lib/notify/outbox/keys';
import {
  OUTBOX_KEY_PATTERN,
  OUTBOX_TEXT_SQL_PATTERNS,
  outboxPayloadProblem,
  outboxRecordProblem,
  outboxTextProblem,
  parseRecipientRef,
  recipientRef,
  storedErrorCode,
} from '../../src/lib/notify/outbox/payload';
import type { OutboxRecord } from '../../src/lib/notify/outbox/types';

const checks = readFileSync('supabase/checks/0023_assertions.sql', 'utf8').replace(/\r\n/g, '\n');
const sql = readFileSync('supabase/migrations/0023_notifications.sql', 'utf8').replace(/\r\n/g, '\n');

function block(name: string): string[] {
  const m = new RegExp(`-- ${name}:begin\\n([\\s\\S]*?)\\n\\s*-- ${name}:end`).exec(checks);
  if (!m) throw new Error(`no ${name} block`);
  return (m[1] as string).split('\n').map((l) => l.trim()).filter((l) => l !== '');
}
const unq = (s: string) => s.replace(/''/g, "'");

describe('payload rule: the SQL cases through the TS copy', () => {
  const cases = block('payload-cases').map((l) => {
    const m = /^\('(.*)', (true|false)\),?$/.exec(l);
    if (!m) throw new Error(`bad case line ${l}`);
    return { p: JSON.parse(unq(m[1] as string)) as unknown, ok: m[2] === 'true' };
  });
  it('has cases', () => expect(cases.length).toBeGreaterThanOrEqual(10));
  for (const c of cases) it(JSON.stringify(c.p), () => expect(outboxPayloadProblem(c.p) === null).toBe(c.ok));
});

describe('text rule: the SQL cases through the TS copy', () => {
  const cases = block('text-cases').map((l) => {
    const m = /^\('(.*)', (\d+), (true|false), (true|false)\),?$/.exec(l);
    if (!m) throw new Error(`bad case line ${l}`);
    return { t: unq(m[1] as string).replace(/\\n/g, '\n'), max: Number(m[2]), multiline: m[3] === 'true', ok: m[4] === 'true' };
  });
  it('has cases', () => expect(cases.length).toBeGreaterThanOrEqual(10));
  for (const c of cases) it(`${c.t.replace(/\n/g, ' / ')} (${c.max}, ${c.multiline})`, () => expect(outboxTextProblem(c.t, c.max, c.multiline) === null).toBe(c.ok));

  it('the SQL function uses exactly the TS patterns', () => {
    const fn = /create or replace function app\.notify_text_ok[\s\S]*?\$\$;/.exec(sql)?.[0] ?? '';
    expect(fn).toContain(`p_text !~ '${OUTBOX_TEXT_SQL_PATTERNS.email}'`);
    expect(fn).toContain(`p_text !~ '${OUTBOX_TEXT_SQL_PATTERNS.phone}'`);
    expect(fn).toContain(`p_text !~* '${OUTBOX_TEXT_SQL_PATTERNS.link}'`);
  });
});

describe('keys, recipients and error codes match the table', () => {
  it('the key pattern equals the table check, and every key keys.ts makes fits it', () => {
    expect(sql).toContain(`check (idempotency_key ~ '${OUTBOX_KEY_PATTERN.source}')`);
    const keys = [
      idempotencyKey({ kind: 'announcement', eventId: 'c0230000-0000-4000-8000-0000000000a1', revision: 0, recipientId: 'subscriber:00000000-0000-4000-8000-000000000001', channel: 'email' }),
      idempotencyKey({ kind: 'court_change', eventId: "odd id: with (all) the ~*.!' chars", revision: 3, recipientId: 'profile:x y', channel: 'in_app' }),
      idempotencyKey({ kind: 'match_reminder', eventId: 'x'.repeat(400), revision: 0, recipientId: 'lead:1', channel: 'push' }),
    ];
    for (const k of keys) expect(k).toMatch(OUTBOX_KEY_PATTERN);
  });

  it('the announcement key built in SQL is the TS key', () => {
    const ann = 'c0230000-0000-4000-8000-0000000000a1';
    const sub = '00000000-0000-4000-8000-000000000001';
    const ts = idempotencyKey({ kind: 'announcement', eventId: ann, revision: 0, recipientId: `subscriber:${sub}`, channel: 'email' });
    expect(sql).toContain(`'ntf1:announcement:' || v_ann::text || ':0:subscriber%3A' || s.id::text || ':email'`);
    expect(ts).toBe(`ntf1:announcement:${ann}:0:subscriber%3A${sub}:email`);
  });

  it('recipients are references only', () => {
    expect(recipientRef('subscriber', '00000000-0000-4000-8000-00000000000A')).toBe('subscriber:00000000-0000-4000-8000-00000000000a');
    expect(() => recipientRef('lead', 'fake@example.test')).toThrow();
    expect(parseRecipientRef('profile:00000000-0000-4000-8000-000000000001')).toEqual({ type: 'profile', id: '00000000-0000-4000-8000-000000000001' });
    expect(parseRecipientRef('910000000000')).toBeNull();
    expect(sql).toContain("'^(lead|profile|subscriber):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'");
  });

  it('error codes are stored in the column form', () => {
    expect(storedErrorCode('Email_Rate_Limited')).toBe('email_rate_limited');
    expect(storedErrorCode('123')).toBe('failed');
    expect(storedErrorCode(null)).toBeNull();
  });
});

describe('a whole record', () => {
  const base: OutboxRecord = {
    key: idempotencyKey({ kind: 'announcement', eventId: 'ann-1', revision: 0, recipientId: 'subscriber:00000000-0000-4000-8000-000000000001', channel: 'email' }),
    kind: 'announcement',
    eventId: 'ann-1',
    revision: 0,
    recipientId: 'subscriber:00000000-0000-4000-8000-000000000001',
    channel: 'email',
    status: 'queued',
    skipReason: null,
    subject: 'Sample news',
    body: 'Hi there,\n\nSample text.',
    createdAt: '2026-10-31T00:00:00.000Z',
    notBefore: '2026-10-31T00:00:00.000Z',
    expiresAt: null,
    attempts: 0,
    leaseUntil: null,
    lastError: null,
    sentAt: null,
  };
  it('a clean record passes', () => expect(outboxRecordProblem(base)).toBeNull());
  it.each([
    ['a phone in the body', { body: 'Call 910000000000' }],
    ['an email in the subject', { subject: 'fake@example.test' }],
    ['a subscriber on another channel', { channel: 'in_app' as const }],
    ['an address as the recipient', { recipientId: 'fake@example.test' }],
    ['a free-text event id', { eventId: 'Fake Person' }],
    ['a record already sent', { status: 'sent' as const }],
    ['a skip without a reason', { status: 'skipped' as const }],
    ['a bad time', { notBefore: 'soon' }],
  ])('refuses %s', (_label, over) => expect(outboxRecordProblem({ ...base, ...over } as OutboxRecord)).not.toBeNull());
});
