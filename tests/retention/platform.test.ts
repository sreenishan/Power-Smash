// src/lib/retention/platform.ts and schemas.ts: the owner's keep-for periods (no default) and the counts-only answer of the job.
import { describe, expect, it } from 'vitest';
import {
  checkPeriods,
  describePeriod,
  describeRetentionRun,
  KEEP_DAYS_LIMITS,
  NO_PERIODS,
  parseRetentionRun,
  RETENTION_SCREEN_TEXT,
  RUN_COUNT_KEYS,
  toRpcRecord,
} from '../../src/lib/retention/platform';
import { RETENTION_ACTION_KINDS, RETENTION_ACTION_SCHEMAS, RETENTION_RPCS } from '../../src/lib/retention/schemas';

const answer = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  dry_run: true,
  registration_keep_days: 30,
  subscriber_keep_days: 10,
  registrations_anonymised: 4,
  registrations_deleted: 2,
  registrations_without_event_date: 1,
  subscribers_unconfirmed_deleted: 1,
  subscribers_unsubscribed_deleted: 1,
  unsubscribe_hashes_kept: 1,
  outbox_rows_removed: 2,
  ...over,
});

describe('the periods have no default', () => {
  it('starts with both periods empty (never remove)', () => {
    expect(NO_PERIODS).toEqual({ registrationKeepDays: null, subscriberKeepDays: null });
    expect(Object.isFrozen(NO_PERIODS)).toBe(true);
  });

  it('says the lawyer decides and that an empty box keeps everything', () => {
    expect(RETENTION_SCREEN_TEXT.intro).toMatch(/lawyer decides/i);
    expect(RETENTION_SCREEN_TEXT.intro).toMatch(/empty to keep everything/i);
    expect(describePeriod(null)).toBe('not set, so nothing is removed');
    // keeping a code of a removed address is its own box, explained as needing the lawyer's yes
    expect(RETENTION_SCREEN_TEXT.keepUnsubscribeHash.help).toMatch(/lawyer says yes/);
    expect(RETENTION_SCREEN_TEXT.fields.subscriberKeepDays.help).not.toMatch(/scrambled|code of it is kept/i);
    expect(describePeriod(1)).toBe('1 day');
    expect(describePeriod(30)).toBe('30 days');
  });

  it('suggests no number anywhere in the owner text', () => {
    const text = JSON.stringify(RETENTION_SCREEN_TEXT);
    expect(text).not.toMatch(/\b\d+\s*(day|days|month|months|year|years)\b/i);
  });
});

describe('checkPeriods', () => {
  it('accepts whole days in range, digit strings from a text box, and empty values as null', () => {
    expect(checkPeriods({ registrationKeepDays: 30, subscriberKeepDays: null })).toEqual({ ok: true, value: { registrationKeepDays: 30, subscriberKeepDays: null } });
    expect(checkPeriods({ registrationKeepDays: ' 365 ', subscriberKeepDays: '' })).toEqual({ ok: true, value: { registrationKeepDays: 365, subscriberKeepDays: null } });
    expect(checkPeriods({})).toEqual({ ok: true, value: { registrationKeepDays: null, subscriberKeepDays: null } });
    const { registrationKeepDays: r, subscriberKeepDays: s } = KEEP_DAYS_LIMITS;
    expect(checkPeriods({ registrationKeepDays: r.min, subscriberKeepDays: s.min }).ok).toBe(true);
    expect(checkPeriods({ registrationKeepDays: r.max, subscriberKeepDays: s.max }).ok).toBe(true);
  });

  it('refuses out-of-range, fractional, negative and non-numeric input with a plain sentence per box', () => {
    const { registrationKeepDays: r, subscriberKeepDays: s } = KEEP_DAYS_LIMITS;
    for (const bad of [r.min - 1, r.max + 1, 30.5, -1, '3e2', '30 days', true, {}]) {
      const c = checkPeriods({ registrationKeepDays: bad, subscriberKeepDays: null });
      expect(c.ok, String(bad)).toBe(false);
      if (!c.ok) {
        expect(c.problems).toHaveLength(1);
        expect(c.problems[0]).toMatch(/^Closed registrations: days to keep after the event: enter a/);
      }
    }
    const both = checkPeriods({ registrationKeepDays: 0, subscriberKeepDays: s.max + 1 });
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.problems).toHaveLength(2);
  });

  it('builds the RPC record with every key present', () => {
    expect(toRpcRecord({ registrationKeepDays: null, subscriberKeepDays: 10, keepUnsubscribeHash: false })).toEqual({ registrationKeepDays: null, subscriberKeepDays: 10, keepUnsubscribeHash: false });
  });
});

describe('parseRetentionRun: counts only', () => {
  it('reads a full answer', () => {
    const run = parseRetentionRun(answer());
    expect(run.dryRun).toBe(true);
    expect(run.registrationKeepDays).toBe(30);
    expect(run.counts.registrations_anonymised).toBe(4);
    expect(Object.keys(run.counts).sort()).toEqual([...RUN_COUNT_KEYS].sort());
  });

  it('accepts empty periods', () => {
    const run = parseRetentionRun(answer({ registration_keep_days: null, subscriber_keep_days: null }));
    expect(run.registrationKeepDays).toBeNull();
  });

  it('refuses an unknown key, a text where a count belongs, a missing count, a bad flag and non-records', () => {
    expect(() => parseRetentionRun(answer({ email: 'fake@example.test' }))).toThrow(/unknown field/);
    expect(() => parseRetentionRun(answer({ registrations_deleted: 'fake@example.test' }))).toThrow(/bad count/);
    expect(() => parseRetentionRun(answer({ registrations_deleted: -1 }))).toThrow(/bad count/);
    expect(() => parseRetentionRun(answer({ registrations_deleted: 1.5 }))).toThrow(/bad count/);
    const missing = answer();
    delete missing.outbox_rows_removed;
    expect(() => parseRetentionRun(missing)).toThrow(/bad count/);
    expect(() => parseRetentionRun(answer({ dry_run: 'true' }))).toThrow(/dry-run/);
    expect(() => parseRetentionRun(answer({ subscriber_keep_days: 0 }))).toThrow(/period/);
    expect(() => parseRetentionRun(null)).toThrow();
    expect(() => parseRetentionRun([])).toThrow();
  });

  it('never echoes an unknown key with odd characters in its error', () => {
    try {
      parseRetentionRun(answer({ 'fake@example.test': 1 }));
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('@');
    }
  });
});

describe('describeRetentionRun', () => {
  it('a dry run says nothing changed and uses "would be"', () => {
    const lines = describeRetentionRun(parseRetentionRun(answer()));
    expect(lines[0]).toBe('Preview only: nothing was changed.');
    expect(lines.join(' ')).toContain('4 registrations would be cleared of contact details');
    expect(lines.join(' ')).toContain('1 old registration is kept because the tournament has no date');
    expect(lines.join(' ')).toContain('1 unconfirmed address and 1 unsubscribed address would be deleted');
  });

  it('a real run with empty periods says nothing is removed', () => {
    const lines = describeRetentionRun(parseRetentionRun(answer({ dry_run: false, registration_keep_days: null, subscriber_keep_days: null })));
    expect(lines).toEqual(['Clean-up done.', 'Registrations: no period set, so nothing is removed.', 'Email sign-ups: no period set, so nothing is removed.']);
  });
});

describe('admin action schemas', () => {
  it('validate the save action with nulls allowed and the SQL limits', () => {
    const save = RETENTION_ACTION_SCHEMAS['retention.save'];
    expect(save.safeParse({ registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false, reason: 'fake lawyer advice' }).success).toBe(true);
    expect(save.safeParse({ registrationKeepDays: 30, subscriberKeepDays: 10, keepUnsubscribeHash: true, reason: 'fake lawyer advice' }).success).toBe(true);
    // the hash answer is required and a real yes or no
    expect(save.safeParse({ registrationKeepDays: 30, subscriberKeepDays: 10, reason: 'fake lawyer advice' }).success).toBe(false);
    expect(save.safeParse({ registrationKeepDays: 30, subscriberKeepDays: 10, keepUnsubscribeHash: 'true', reason: 'fake lawyer advice' }).success).toBe(false);
    expect(save.safeParse({ registrationKeepDays: 6, subscriberKeepDays: null, reason: 'fake lawyer advice' }).success).toBe(false);
    expect(save.safeParse({ registrationKeepDays: 30, subscriberKeepDays: 3651, reason: 'fake lawyer advice' }).success).toBe(false);
    expect(save.safeParse({ registrationKeepDays: 30, reason: 'fake lawyer advice' }).success).toBe(false);
    expect(save.safeParse({ registrationKeepDays: 30, subscriberKeepDays: null, reason: 'x' }).success).toBe(false);
    expect(save.safeParse({ registrationKeepDays: 30, subscriberKeepDays: null, reason: 'fake reason', extra: 1 }).success).toBe(false);
    expect(RETENTION_ACTION_SCHEMAS['retention.summary'].safeParse({}).success).toBe(true);
  });

  it('declares the kind of each action and the RPC names', () => {
    expect(Object.keys(RETENTION_ACTION_KINDS).sort()).toEqual(Object.keys(RETENTION_ACTION_SCHEMAS).sort());
    expect(RETENTION_RPCS).toEqual(['admin_platform_retention_summary', 'admin_set_platform_retention']);
  });
});
