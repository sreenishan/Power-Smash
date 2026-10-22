import { describe, expect, it } from 'vitest';
import { countByStatus, filterLeads, groupByColumn, istDateOfInstant, matchesFilter, moveButtons, sortLeads } from '../../src/lib/inbox/filters';
import { dueLeads, followUpDays, followUpState, validateFollowUpDate } from '../../src/lib/inbox/followup';
import { toInboxLead } from '../../src/lib/inbox/lead';
import { lead } from './helpers';

const TODAY = '2026-10-22';

describe('follow-up due logic in India time', () => {
  it('classifies an open lead by its date against today', () => {
    expect(followUpState(lead({ followUpOn: '2026-10-21' }), TODAY)).toBe('overdue');
    expect(followUpState(lead({ followUpOn: '2026-10-22' }), TODAY)).toBe('due_today');
    expect(followUpState(lead({ followUpOn: '2026-10-23' }), TODAY)).toBe('upcoming');
    expect(followUpState(lead({ followUpOn: null }), TODAY)).toBe('none');
  });

  it('a closed lead is never due', () => {
    expect(followUpState(lead({ status: 'completed', followUpOn: '2026-10-01' }), TODAY)).toBe('none');
    expect(followUpState(lead({ status: 'lost', followUpOn: '2026-10-01' }), TODAY)).toBe('none');
  });

  it('ignores a malformed stored date instead of throwing', () => {
    expect(followUpState(lead({ followUpOn: 'tomorrow' }), TODAY)).toBe('none');
  });

  it('counts days, negative when overdue', () => {
    expect(followUpDays(lead({ followUpOn: '2026-10-19' }), TODAY)).toBe(-3);
    expect(followUpDays(lead({ followUpOn: '2026-10-25' }), TODAY)).toBe(3);
    expect(followUpDays(lead(), TODAY)).toBeNull();
  });

  it('IST day boundary: the same instant is a different calendar day in India than in UTC', () => {
    expect(istDateOfInstant('2026-10-21T20:00:00Z')).toBe('2026-10-22');
    expect(istDateOfInstant('2026-10-22T18:29:00Z')).toBe('2026-10-22');
    expect(istDateOfInstant('2026-10-22T18:30:00Z')).toBe('2026-10-23');
  });

  it('dueLeads: overdue and today, most overdue first, closed ones left out', () => {
    const a = lead({ followUpOn: '2026-10-22' });
    const b = lead({ followUpOn: '2026-10-18' });
    const c = lead({ followUpOn: '2026-10-30' });
    const d = lead({ followUpOn: '2026-10-01', status: 'lost' });
    expect(dueLeads([a, b, c, d], TODAY).map((l) => l.id)).toEqual([b.id, a.id]);
  });

  it('validates a date the owner picks', () => {
    expect(validateFollowUpDate('', TODAY)).toEqual({ ok: true, date: null });
    expect(validateFollowUpDate(null, TODAY)).toEqual({ ok: true, date: null });
    expect(validateFollowUpDate('2026-10-22', TODAY)).toEqual({ ok: true, date: '2026-10-22' });
    expect(validateFollowUpDate('2026-10-21', TODAY)).toMatchObject({ ok: false });
    expect(validateFollowUpDate('2026-02-30', TODAY)).toMatchObject({ ok: false });
    expect(validateFollowUpDate('2028-10-22', TODAY)).toMatchObject({ ok: false });
    expect(validateFollowUpDate(20261022, TODAY)).toMatchObject({ ok: false });
  });
});

describe('filters and sort', () => {
  const a = lead({ name: 'Asha Fictional', refCode: 'PS-2026-AAAAAA', status: 'new', type: 'coverage', phone: '910000000001', createdAt: '2026-10-20T10:00:00Z' });
  const b = lead({ name: 'Bala Fictional', refCode: 'PS-2026-BBBBBB', status: 'quoted', type: 'sponsorship', phone: '910000000002', valuePaise: 500000, followUpOn: '2026-10-21', createdAt: '2026-10-21T10:00:00Z', sourcePath: '/partner/' });
  const c = lead({ name: 'Chitra Fictional', refCode: 'PS-2026-CCCCCC', status: 'lost', type: 'general', valuePaise: 100, followUpOn: '2026-10-22', createdAt: '2026-10-22T10:00:00Z' });
  const all = [a, b, c];

  it('filters by status and type', () => {
    expect(filterLeads(all, { statuses: ['quoted'] }, TODAY).map((l) => l.id)).toEqual([b.id]);
    expect(filterLeads(all, { types: ['coverage', 'general'] }, TODAY)).toHaveLength(2);
    expect(filterLeads(all, { statuses: [], types: [] }, TODAY)).toHaveLength(3);
  });

  it('text search: reference, name, organisation, source page, and phone digits (4 or more)', () => {
    expect(filterLeads(all, { text: 'bbbbbb' }, TODAY)).toHaveLength(1);
    expect(filterLeads(all, { text: '  ASHA ' }, TODAY)).toHaveLength(1);
    expect(filterLeads(all, { text: '/partner' }, TODAY)).toHaveLength(1);
    expect(filterLeads(all, { text: 'fictional association' }, TODAY)).toHaveLength(3);
    expect(filterLeads(all, { text: '0000000002' }, TODAY).map((l) => l.id)).toEqual([b.id]);
    expect(filterLeads(all, { text: '12' }, TODAY)).toHaveLength(0); // too few digits to match a phone
  });

  it('follow-up filters ignore closed leads', () => {
    expect(filterLeads(all, { followUp: 'overdue' }, TODAY).map((l) => l.id)).toEqual([b.id]);
    expect(filterLeads(all, { followUp: 'due' }, TODAY).map((l) => l.id)).toEqual([b.id]); // c is lost
    expect(filterLeads(all, { followUp: 'none' }, TODAY)).toHaveLength(2);
  });

  it('created range is by India calendar date, both ends inclusive', () => {
    expect(filterLeads(all, { createdFrom: '2026-10-21', createdTo: '2026-10-21' }, TODAY).map((l) => l.id)).toEqual([b.id]);
    expect(filterLeads(all, { createdFrom: '2026-10-21' }, TODAY)).toHaveLength(2);
    expect(matchesFilter(lead({ createdAt: '2026-10-21T19:00:00Z' }), { createdFrom: '2026-10-22', createdTo: '2026-10-22' }, TODAY)).toBe(true);
  });

  it('only leads with a value', () => {
    expect(filterLeads(all, { hasValue: true }, TODAY)).toHaveLength(2);
  });

  it('sorts newest first by default, and by oldest, follow-up and value', () => {
    expect(sortLeads(all, 'newest').map((l) => l.id)).toEqual([c.id, b.id, a.id]);
    expect(sortLeads(all, 'oldest').map((l) => l.id)).toEqual([a.id, b.id, c.id]);
    expect(sortLeads(all, 'follow_up').map((l) => l.id)).toEqual([b.id, c.id, a.id]);
    expect(sortLeads(all, 'value').map((l) => l.id)).toEqual([b.id, c.id, a.id]);
    expect(all.map((l) => l.id)).toEqual([a.id, b.id, c.id]); // the input is not reordered
  });

  it('counts per status', () => {
    expect(countByStatus(all)).toEqual({ new: 1, contacted: 0, quoted: 1, won: 0, completed: 0, lost: 1 });
  });
});

describe('board columns', () => {
  it('groups leads into the pipeline columns then Lost, with counts and the sum of values that ARE set', () => {
    const leads = [
      lead({ status: 'new' }),
      lead({ status: 'new', valuePaise: 100000 }),
      lead({ status: 'won', valuePaise: 250050 }),
      lead({ status: 'won', valuePaise: 50 }),
      lead({ status: 'won' }),
      lead({ status: 'lost', lostReason: 'Price' }),
    ];
    const cols = groupByColumn(leads);
    expect(cols.map((c) => c.status)).toEqual(['new', 'contacted', 'quoted', 'won', 'completed', 'lost']);
    expect(cols.map((c) => c.count)).toEqual([2, 0, 0, 3, 0, 1]);
    const won = cols.find((c) => c.status === 'won');
    expect(won).toMatchObject({ valuePaise: 250100, withoutValue: 1, label: 'Won' });
    expect(cols.find((c) => c.status === 'contacted')).toMatchObject({ valuePaise: 0, withoutValue: 0 });
  });

  it('gives each card only the move buttons the machine allows, and flags the reason prompt', () => {
    const buttons = moveButtons('quoted');
    expect(buttons.map((b) => b.to)).toEqual(['won', 'completed', 'contacted', 'lost']);
    expect(buttons.find((b) => b.to === 'lost')?.needsReason).toBe(true);
    expect(buttons.find((b) => b.to === 'won')?.label).toBe('Move to Won');
    expect(moveButtons('completed')).toEqual([]);
  });
});

describe('database row mapping', () => {
  const row = { id: '30000000-0000-4000-8000-000000000999', ref_code: 'PS-2026-7K3QDM', type: 'coverage', status: 'quoted', name: 'Fictional Person', phone: '910000000000', whatsapp_ok: true, value_paise: 500000, created_at: '2026-10-20T06:30:00Z', follow_up_on: '2026-10-25' };

  it('maps a row, accepting a bigint that arrives as a string', () => {
    expect(toInboxLead(row)).toMatchObject({ refCode: 'PS-2026-7K3QDM', status: 'quoted', valuePaise: 500000, followUpOn: '2026-10-25', organization: null, whatsappOk: true });
    expect(toInboxLead({ ...row, value_paise: '500000' })?.valuePaise).toBe(500000);
    expect(toInboxLead({ ...row, value_paise: -5 })?.valuePaise).toBeNull();
    expect(toInboxLead({ ...row, value_paise: 'abc' })?.valuePaise).toBeNull();
  });

  it('refuses a row it cannot trust', () => {
    expect(toInboxLead({ ...row, status: 'archived' })).toBeNull();
    expect(toInboxLead({ ...row, type: 'spam' })).toBeNull();
    expect(toInboxLead({ ...row, ref_code: null })).toBeNull();
  });
});
