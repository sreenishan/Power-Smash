import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_PAISE, isAmountPaise, isNonNegativePaise, parseRupeesToPaise, rupeesInputFromPaise } from '../../src/lib/pricing-admin/price-input';
import { changedFields, priceChange, validateProductEdit } from '../../src/lib/pricing-admin/product-edit';
import type { ProductEditInput } from '../../src/lib/pricing-admin/product-edit';

describe('parseRupeesToPaise (no floats, no default)', () => {
  it.each([
    ['5000', 500000],
    ['5,000', 500000],
    ['₹12,50,000.50', 125000050],
    ['1,234,567', 123456700],
    ['Rs. 2500', 250000],
    ['INR 99', 9900],
    ['rs 0.5', 50],
    ['0.05', 5],
    ['  1 000  ', 100000],
    ['19.9', 1990],
  ] as const)('%s -> %i paise', (text, paise) => {
    expect(parseRupeesToPaise(text)).toEqual({ ok: true, paise });
  });

  it('a blank field is "not supplied" (null), never zero', () => {
    for (const v of ['', '   ', null, undefined]) expect(parseRupeesToPaise(v)).toEqual({ ok: true, paise: null });
  });

  it.each(['abc', '12,34', '1,2345', '5,00,00', '1.234', '-100', '1e5', '1..5', '$100', '0', '0.00', '12.', '.5', '99999999999'])('refuses %j', (text) => {
    expect(parseRupeesToPaise(text).ok).toBe(false);
  });

  it('refuses an amount past the typo guard', () => {
    expect(parseRupeesToPaise('99999999999999999999').ok).toBe(false);
    expect(MAX_AMOUNT_PAISE).toBe(10_000_000_000);
  });

  it('is exact where floating point is not (19.99 rupees is 1999 paise)', () => {
    expect(parseRupeesToPaise('19.99')).toEqual({ ok: true, paise: 1999 });
    expect(parseRupeesToPaise('0.07')).toEqual({ ok: true, paise: 7 });
    expect(parseRupeesToPaise('1.15')).toEqual({ ok: true, paise: 115 });
  });

  it('round trips to input text', () => {
    expect(rupeesInputFromPaise(500000)).toBe('5000');
    expect(rupeesInputFromPaise(500050)).toBe('5000.50');
    expect(rupeesInputFromPaise(5)).toBe('0.05');
    expect(rupeesInputFromPaise(null)).toBe('');
    expect(() => rupeesInputFromPaise(1.5)).toThrow(RangeError);
    expect(() => rupeesInputFromPaise(-1)).toThrow(RangeError);
    for (const paise of [1, 99, 100, 12345, 500050, 125000050]) expect(parseRupeesToPaise(rupeesInputFromPaise(paise))).toEqual({ ok: true, paise });
  });

  it('amount guards', () => {
    expect(isAmountPaise(1)).toBe(true);
    for (const v of [0, -1, 1.5, Number.NaN, '5', null, MAX_AMOUNT_PAISE + 1]) expect(isAmountPaise(v)).toBe(false);
    expect(isNonNegativePaise(0)).toBe(true);
    expect(isNonNegativePaise(-1)).toBe(false);
  });
});

const base = (over: Partial<ProductEditInput> = {}): ProductEditInput => ({ name: 'Fictional package', summary: 'A fictional package for tests.', priceType: 'fixed', priceRupees: '5,000', visible: true, gstInclusive: true, ...over });

describe('validateProductEdit', () => {
  it('stores the price as integer paise from rupee text or from paise', () => {
    const a = validateProductEdit(base());
    expect(a.ok && a.value.pricePaise).toBe(500000);
    const b = validateProductEdit(base({ priceRupees: undefined, pricePaise: 750025 }));
    expect(b.ok && b.value.pricePaise).toBe(750025);
  });

  it('there is NO default price: blank stays null, and a visible fixed or starting-from product must have one', () => {
    for (const priceType of ['fixed', 'starting_from']) {
      expect(validateProductEdit(base({ priceType, priceRupees: '' }))).toMatchObject({ ok: false, errors: { price: expect.stringContaining('Set a price') } });
    }
    const hidden = validateProductEdit(base({ priceRupees: '', visible: false }));
    expect(hidden.ok && hidden.value.pricePaise).toBeNull();
  });

  it('a visible quote product with no price needs the owner to approve the On quote wording', () => {
    expect(validateProductEdit(base({ priceType: 'quote', priceRupees: '' }))).toMatchObject({ ok: false, errors: { price: expect.stringContaining('On quote') } });
    const ok = validateProductEdit(base({ priceType: 'quote', priceRupees: '', quoteWordingApproved: true }));
    expect(ok.ok && ok.value.pricePaise).toBeNull();
    const indicative = validateProductEdit(base({ priceType: 'quote', priceRupees: '2,000' }));
    expect(indicative.ok && indicative.value.pricePaise).toBe(200000);
  });

  it('rejects floats, zero, negatives, text and two price sources', () => {
    for (const pricePaise of [1.5, 0, -100, Number.NaN, Number.POSITIVE_INFINITY, '500' as unknown as number]) {
      expect(validateProductEdit(base({ priceRupees: undefined, pricePaise })).ok).toBe(false);
    }
    expect(validateProductEdit(base({ priceRupees: 'free' })).ok).toBe(false);
    expect(validateProductEdit(base({ priceRupees: '5,000', pricePaise: 500000 }))).toMatchObject({ ok: false, errors: { price: 'Give the price once.' } });
  });

  it('checks the price type and the visible flag', () => {
    expect(validateProductEdit(base({ priceType: 'free' }))).toMatchObject({ ok: false, errors: { priceType: expect.any(String) } });
    expect(validateProductEdit(base({ visible: 'yes' as unknown as boolean }))).toMatchObject({ ok: false, errors: { visible: expect.any(String) } });
  });

  it('GST is yes, no or unknown; unknown warns that nothing is claimed', () => {
    expect(validateProductEdit(base({ gstInclusive: false })).ok).toBe(true);
    const unknown = validateProductEdit(base({ gstInclusive: null }));
    expect(unknown.ok && unknown.value.gstInclusive).toBeNull();
    expect(unknown.ok && unknown.warnings.some((w) => w.includes('GST'))).toBe(true);
    expect(validateProductEdit(base({ gstInclusive: 'maybe' as unknown as boolean })).ok).toBe(false);
    const absent = validateProductEdit({ ...base(), gstInclusive: undefined });
    expect(absent.ok && absent.value.gstInclusive).toBeNull();
  });

  it('delivery days: a whole number of 1 to 365, or blank (unknown)', () => {
    expect(validateProductEdit(base({ deliveryDays: 7 })).ok).toBe(true);
    const blank = validateProductEdit(base({ deliveryDays: null }));
    expect(blank.ok && blank.value.deliveryDays).toBeNull();
    for (const v of [0, -1, 1.5, 366]) expect(validateProductEdit(base({ deliveryDays: v })).ok).toBe(false);
  });

  it('name, summary, sort and inclusions are bounded and tidied', () => {
    expect(validateProductEdit(base({ name: 'x' })).ok).toBe(false);
    expect(validateProductEdit(base({ summary: 'x'.repeat(301) })).ok).toBe(false);
    expect(validateProductEdit(base({ sort: -1 })).ok).toBe(false);
    const r = validateProductEdit(base({ name: '  Spaced   out \u0007name ', inclusions: ['  Live score  ', 'live score', '', 'Poster'] }));
    expect(r.ok && r.value.name).toBe('Spaced out name');
    expect(r.ok && r.value.inclusions).toEqual(['Live score', 'Poster']);
    expect(validateProductEdit(base({ inclusions: ['x'.repeat(201)] })).ok).toBe(false);
    expect(validateProductEdit(base({ inclusions: Array.from({ length: 21 }, (_, i) => `Item ${i}`) })).ok).toBe(false);
  });

  it('unapproved inclusions on a visible product are flagged as a draft', () => {
    const r = validateProductEdit(base({ inclusions: ['One'], inclusionsApproved: false }));
    expect(r.ok && r.warnings.some((w) => w.includes('draft'))).toBe(true);
    const ok = validateProductEdit(base({ inclusions: ['One'], inclusionsApproved: true }));
    expect(ok.ok && ok.warnings.some((w) => w.includes('draft'))).toBe(false);
  });

  it('detects what changed, and the price change for the audit entry and alert', () => {
    const before = validateProductEdit(base());
    const after = validateProductEdit(base({ priceRupees: '6,000', name: 'Renamed package' }));
    if (!before.ok || !after.ok) throw new Error('expected ok');
    expect(changedFields(before.value, after.value).sort()).toEqual(['name', 'pricePaise']);
    expect(priceChange(before.value, after.value)).toEqual({ fromPaise: 500000, toPaise: 600000, fromType: 'fixed', toType: 'fixed' });
    expect(priceChange(before.value, before.value)).toBeNull();
  });
});

describe('no price, fee or tax rate is hardcoded in the pricing code', () => {
  const dir = join(process.cwd(), 'src', 'lib', 'pricing-admin');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it('has source files to scan', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
  it('contains no percentage, rate or rupee amount literals', () => {
    for (const f of files) {
      const code = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s\/\/ .*$/gm, '');
      expect(code, f).not.toMatch(/\b(?:rate|gst|tds|fee|price)\w*\s*[:=]\s*0?\.\d+/i);
      expect(code, f).not.toMatch(/\*\s*0?\.\d{1,3}\b/); // multiplying by a rate
      expect(code, f).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    }
  });
});
