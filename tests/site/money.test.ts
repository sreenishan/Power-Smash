import { describe, expect, it } from 'vitest';
import {
  QUOTE_TEXT,
  RUPEE_SIGN,
  STARTING_FROM_LABEL,
  formatInr,
  isSuppliedPaise,
  priceDisplay,
} from '../../src/lib/money';

describe('formatInr (integer paise, Indian digit grouping)', () => {
  it('formats the reference amounts', () => {
    expect(formatInr(0)).toBe('₹0.00');
    expect(formatInr(100)).toBe('₹1.00');
    expect(formatInr(5)).toBe('₹0.05');
    expect(formatInr(99)).toBe('₹0.99');
    expect(formatInr(12345600)).toBe('₹1,23,456.00');
    expect(formatInr(1250000000)).toBe('₹1,25,00,000.00'); // Rs 1,25,00,000.00
  });

  it('groups the last three digits, then pairs (lakh and crore)', () => {
    expect(formatInr(99900)).toBe('₹999.00');
    expect(formatInr(100000)).toBe('₹1,000.00');
    expect(formatInr(10000000)).toBe('₹1,00,000.00'); // 1 lakh
    expect(formatInr(1000000000)).toBe('₹1,00,00,000.00'); // 1 crore
    expect(formatInr(123456789)).toBe('₹12,34,567.89');
  });

  it('keeps the paise exactly', () => {
    expect(formatInr(123456)).toBe('₹1,234.56');
    expect(formatInr(100001)).toBe('₹1,000.01');
  });

  it('can drop ".00" for price tags but never drops real paise', () => {
    expect(formatInr(500000, { trimZeroPaise: true })).toBe('₹5,000');
    expect(formatInr(0, { trimZeroPaise: true })).toBe('₹0');
    expect(formatInr(500050, { trimZeroPaise: true })).toBe('₹5,000.50');
  });

  it('formats negatives with a leading minus', () => {
    expect(formatInr(-12345600)).toBe('-₹1,23,456.00');
    expect(formatInr(-5)).toBe('-₹0.05');
  });

  it('rejects anything that is not an integer number of paise', () => {
    for (const bad of [1.5, 0.1, NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_VALUE]) {
      expect(() => formatInr(bad)).toThrow(RangeError);
    }
    expect(() => formatInr('100' as unknown as number)).toThrow(RangeError);
    expect(() => formatInr(null as unknown as number)).toThrow(RangeError);
    expect(() => formatInr(undefined as unknown as number)).toThrow(RangeError);
  });

  it('uses the real rupee sign U+20B9', () => {
    expect(RUPEE_SIGN).toBe('₹');
    expect(RUPEE_SIGN.codePointAt(0)).toBe(0x20b9);
  });
});

describe('isSuppliedPaise', () => {
  it('accepts only positive safe integers', () => {
    expect(isSuppliedPaise(1)).toBe(true);
    expect(isSuppliedPaise(500000)).toBe(true);
    expect(isSuppliedPaise(0)).toBe(false);
    expect(isSuppliedPaise(-100)).toBe(false);
    expect(isSuppliedPaise(10.5)).toBe(false);
    expect(isSuppliedPaise(null)).toBe(false);
    expect(isSuppliedPaise(undefined)).toBe(false);
    expect(isSuppliedPaise('500')).toBe(false);
    expect(isSuppliedPaise(NaN)).toBe(false);
  });
});

describe('priceDisplay (PriceTag decision logic)', () => {
  it('shows a fixed amount without any "starting from" wording', () => {
    expect(priceDisplay({ priceType: 'fixed', pricePaise: 500000 })).toEqual({
      kind: 'amount',
      amountText: '₹5,000',
      prefix: null,
      gstText: null,
    });
  });

  it('adds "Starting from" for starting_from prices', () => {
    const d = priceDisplay({ priceType: 'starting_from', pricePaise: 1250000 });
    expect(d).toEqual({ kind: 'amount', amountText: '₹12,500', prefix: STARTING_FROM_LABEL, gstText: null });
  });

  it('treats a quote-type product that has an amount as an indicative starting price', () => {
    const d = priceDisplay({ priceType: 'quote', pricePaise: 300000, quoteWordingApproved: true });
    expect(d).toMatchObject({ kind: 'amount', prefix: STARTING_FROM_LABEL });
  });

  it('says nothing about GST unless the owner supplied it', () => {
    expect(priceDisplay({ priceType: 'fixed', pricePaise: 100000, gstInclusive: null })).toMatchObject({ gstText: null });
    expect(priceDisplay({ priceType: 'fixed', pricePaise: 100000 })).toMatchObject({ gstText: null });
    expect(priceDisplay({ priceType: 'fixed', pricePaise: 100000, gstInclusive: true })).toMatchObject({ gstText: 'incl. GST' });
    expect(priceDisplay({ priceType: 'fixed', pricePaise: 100000, gstInclusive: false })).toMatchObject({ gstText: '+ GST' });
  });

  it('shows the approved "on quote" wording only for a quote with approval and no amount', () => {
    expect(priceDisplay({ priceType: 'quote', pricePaise: null, quoteWordingApproved: true })).toEqual({
      kind: 'quote',
      text: QUOTE_TEXT,
    });
    expect(QUOTE_TEXT).toBe('On quote - message us on WhatsApp');
  });

  it('falls back to a Todo when the owner has not supplied what the page needs', () => {
    // quote type, wording not approved
    expect(priceDisplay({ priceType: 'quote', pricePaise: null })).toEqual({ kind: 'todo' });
    expect(priceDisplay({ priceType: 'quote', pricePaise: null, quoteWordingApproved: false })).toEqual({ kind: 'todo' });
    // fixed or starting_from with no amount: never the quote wording, even if "approved"
    expect(priceDisplay({ priceType: 'fixed', pricePaise: null, quoteWordingApproved: true })).toEqual({ kind: 'todo' });
    expect(priceDisplay({ priceType: 'starting_from', pricePaise: null })).toEqual({ kind: 'todo' });
  });

  it('treats a zero, negative or fractional amount as not supplied', () => {
    expect(priceDisplay({ priceType: 'fixed', pricePaise: 0 })).toEqual({ kind: 'todo' });
    expect(priceDisplay({ priceType: 'fixed', pricePaise: -500 })).toEqual({ kind: 'todo' });
    expect(priceDisplay({ priceType: 'fixed', pricePaise: 99.5 })).toEqual({ kind: 'todo' });
  });
});
