import { describe, expect, it } from 'vitest';
import { parsePaiseField } from '../../src/lib/admin/money-input';

describe('parsePaiseField', () => {
  it('blank is not entered, never a default', () => {
    expect(parsePaiseField('')).toEqual({ ok: true, paise: null });
    expect(parsePaiseField('   ')).toEqual({ ok: true, paise: null });
    expect(parsePaiseField(null)).toEqual({ ok: true, paise: null });
  });
  it('typed rupees become integer paise', () => {
    expect(parsePaiseField('5,000')).toEqual({ ok: true, paise: 500000 });
    expect(parsePaiseField('₹12,50,000.50')).toEqual({ ok: true, paise: 125000050 });
    expect(parsePaiseField('236.00')).toEqual({ ok: true, paise: 23600 });
  });
  it('zero only where it means something', () => {
    expect(parsePaiseField('0', { allowZero: true })).toEqual({ ok: true, paise: 0 });
    expect(parsePaiseField('Rs. 0.00', { allowZero: true })).toEqual({ ok: true, paise: 0 });
    expect(parsePaiseField('0')).toMatchObject({ ok: false });
  });
  it('rubbish and negatives are refused in plain words', () => {
    for (const bad of ['abc', '-5', '1,2,3', '12.345', '1e5']) expect(parsePaiseField(bad, { allowZero: true })).toMatchObject({ ok: false, error: expect.stringMatching(/amount|commas|rupees/i) });
  });
});
