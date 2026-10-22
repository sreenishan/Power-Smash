import { describe, expect, it } from 'vitest';
import { LEAD_STATUSES, LOST_REASON_MAX, LOST_REASON_PRESETS, canTransition, isLeadStatus, isOpen, nextStatuses, validateTransition } from '../../src/lib/inbox/status';
import type { LeadStatus } from '../../src/lib/inbox/status';

describe('lead status machine (spec 8.1)', () => {
  it('has the six statuses the database accepts', () => {
    expect([...LEAD_STATUSES]).toEqual(['new', 'contacted', 'quoted', 'won', 'completed', 'lost']);
    expect(isLeadStatus('new')).toBe(true);
    for (const v of ['NEW', 'open', '', null, undefined, 3]) expect(isLeadStatus(v)).toBe(false);
  });

  it('moves forward, may skip a stage, and may step back one stage to undo', () => {
    expect(nextStatuses('new')).toEqual(['contacted', 'quoted', 'won', 'completed', 'lost']);
    expect(canTransition('new', 'quoted')).toBe(true);
    expect(canTransition('contacted', 'new')).toBe(true);
    expect(canTransition('quoted', 'new')).toBe(false); // only one step back
    expect(canTransition('won', 'quoted')).toBe(true);
  });

  it('lost can be set from every open stage and reopened to new', () => {
    for (const s of ['new', 'contacted', 'quoted', 'won'] as LeadStatus[]) expect(canTransition(s, 'lost')).toBe(true);
    expect(nextStatuses('lost')).toEqual(['new']);
  });

  it('completed is final', () => {
    expect(nextStatuses('completed')).toEqual([]);
    for (const s of LEAD_STATUSES) expect(canTransition('completed', s)).toBe(false);
    expect(isOpen('completed')).toBe(false);
    expect(isOpen('lost')).toBe(false);
    expect(isOpen('quoted')).toBe(true);
  });

  it('no stage can move to itself', () => {
    for (const s of LEAD_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

describe('validateTransition', () => {
  it('accepts a plain move and clears any old lost reason', () => {
    expect(validateTransition('new', 'contacted', 'leftover')).toEqual({ ok: true, status: 'contacted', lostReason: null });
    expect(validateTransition('lost', 'new')).toEqual({ ok: true, status: 'new', lostReason: null });
  });

  it('going to lost needs a reason of 3 to 500 characters, trimmed and tidied', () => {
    expect(validateTransition('quoted', 'lost')).toMatchObject({ ok: false });
    expect(validateTransition('quoted', 'lost', '  ')).toMatchObject({ ok: false });
    expect(validateTransition('quoted', 'lost', 'no')).toMatchObject({ ok: false });
    expect(validateTransition('quoted', 'lost', 'x'.repeat(LOST_REASON_MAX + 1))).toMatchObject({ ok: false });
    expect(validateTransition('quoted', 'lost', '  Went   with\nsomeone else ')).toEqual({ ok: true, status: 'lost', lostReason: 'Went with someone else' });
    for (const preset of LOST_REASON_PRESETS) expect(validateTransition('new', 'lost', preset).ok).toBe(true);
  });

  it('refuses an impossible, same or unknown move with a plain message', () => {
    expect(validateTransition('completed', 'new')).toMatchObject({ ok: false, error: expect.stringContaining('cannot move') });
    expect(validateTransition('new', 'new')).toMatchObject({ ok: false });
    expect(validateTransition('new', 'archived')).toMatchObject({ ok: false });
    expect(validateTransition(undefined, 'new')).toMatchObject({ ok: false });
  });
});
