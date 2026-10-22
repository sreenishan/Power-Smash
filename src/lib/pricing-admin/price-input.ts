// Rupee text from the admin form to integer paise, and back. PURE, no floats anywhere (CLAUDE.md: money is integer paise; no price,
// fee, tax rate or discount is hardcoded or defaulted). An empty field is `null` ("not supplied"), never 0 and never a default.

/**
 * A typo guard, NOT a price: a single amount above this many paise (Rs 10 crore) is refused so a stray extra digit cannot be saved.
 * Nothing in the product, fee or tax logic reads it as a business value.
 */
export const MAX_AMOUNT_PAISE = 10_000_000_000;

export type RupeeParse = { ok: true; paise: number | null } | { ok: false; error: string };

const INDIAN_OR_WESTERN_GROUPS = /^(?:\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)$/;

/**
 * `"5,000"` `"₹12,50,000.50"` `"Rs. 2500"` `"INR 99"` to paise. Rules: optional currency prefix, digits with valid Indian or Western grouping,
 * at most two decimals. A blank value is `{ ok: true, paise: null }` (not supplied). Zero is refused: a price is a positive amount.
 */
export function parseRupeesToPaise(input: string | null | undefined): RupeeParse {
  const raw = (input ?? '').normalize('NFKC').trim();
  if (raw === '') return { ok: true, paise: null };
  const text = raw.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/\s+/g, '');
  const m = /^([\d,]+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return { ok: false, error: 'Enter an amount in rupees, for example 5,000 or 5000.50.' };
  const whole = m[1] as string;
  if (!INDIAN_OR_WESTERN_GROUPS.test(whole)) return { ok: false, error: 'The commas in the amount are in the wrong places.' };
  const rupees = Number(whole.replace(/,/g, ''));
  const paise = rupees * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise)) return { ok: false, error: 'That amount is too large.' };
  if (paise <= 0) return { ok: false, error: 'The amount must be more than zero.' };
  if (paise > MAX_AMOUNT_PAISE) return { ok: false, error: 'That amount looks too large. Check the digits.' };
  return { ok: true, paise };
}

/** Integer paise as the text an input field shows, without a currency sign or grouping: 500050 -> "5000.50", 500000 -> "5000". */
export function rupeesInputFromPaise(paise: number | null): string {
  if (paise === null) return '';
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError('paise must be a non-negative integer');
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p === 0 ? String(r) : `${r}.${String(p).padStart(2, '0')}`;
}

/** A valid amount of integer paise (a positive safe integer under the typo guard). */
export const isAmountPaise = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT_PAISE;

/** A valid non-negative amount (zero allowed), for fees, tax and TDS lines. */
export const isNonNegativePaise = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_AMOUNT_PAISE;
