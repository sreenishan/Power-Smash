// Turns what the owner typed into integer paise for the Mark paid form. PURE. Nothing is filled in for the owner: a blank field stays
// "not entered" (null), and zero is accepted only where zero is meaningful (a fee of 0, TDS of 0).
import { parseRupeesToPaise } from '../pricing-admin/price-input';

export type PaiseField = { ok: true; paise: number | null } | { ok: false; error: string };

/** `''` is "not entered" (null). `0`, `0.00`, `₹0` give 0 when `allowZero`, otherwise the "more than zero" message. */
export function parsePaiseField(input: string | null | undefined, options: { allowZero?: boolean } = {}): PaiseField {
  const raw = (input ?? '').normalize('NFKC').trim();
  if (raw === '') return { ok: true, paise: null };
  if (options.allowZero && /^(?:₹|rs\.?|inr)?\s*0+(?:\.0{1,2})?$/i.test(raw)) return { ok: true, paise: 0 };
  return parseRupeesToPaise(raw);
}
