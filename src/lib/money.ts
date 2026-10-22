// Money helpers (CLAUDE.md: money is stored as INTEGER PAISE; no price, fee, tax rate or discount is hardcoded or defaulted).
// Pure functions only, so Vitest can import them directly. Nothing in this file knows any actual price.

/** The rupee sign U+20B9. It is not in the Latin font subsets: it renders through Noto Sans Tamil (D-041 item 4). */
export const RUPEE_SIGN = '₹';

export interface FormatInrOptions {
  /** Drop ".00" when the amount is a whole number of rupees (for price tags). Default false: always two decimals. */
  trimZeroPaise?: boolean;
}

/** Insert Indian digit grouping (last three digits, then pairs): "12500000" -> "1,25,00,000". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${lastThree}`;
}

/**
 * Format integer paise as rupees with Indian grouping: 12345600 -> "₹1,23,456.00".
 * Rejects anything that is not a safe integer (no floats, NaN, Infinity): money never travels as a float.
 */
export function formatInr(paise: number, options: FormatInrOptions = {}): string {
  if (typeof paise !== 'number' || !Number.isSafeInteger(paise)) {
    throw new RangeError('formatInr expects an integer number of paise');
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  const whole = groupIndian(String(rupees));
  const fraction = remainder === 0 && options.trimZeroPaise ? '' : `.${String(remainder).padStart(2, '0')}`;
  return `${negative ? '-' : ''}${RUPEE_SIGN}${whole}${fraction}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Price display decision (used by PriceTag.astro). Pure, so the rule "never show a price the owner has not supplied"
// is unit-tested without rendering anything.

export type PriceType = 'fixed' | 'starting_from' | 'quote';

export interface PriceInput {
  priceType: PriceType;
  /** Integer paise, or null until the owner supplies it (OT-20). */
  pricePaise: number | null;
  /** True only after the owner approves the "on quote" wording (OT-13/OT-20). */
  quoteWordingApproved?: boolean;
  /** null = the owner has not said whether the price includes GST. Nothing is claimed in that case. */
  gstInclusive?: boolean | null;
}

export type PriceDisplay =
  /** A real price. `prefix` is "Starting from" for starting_from prices (and for a quote with an indicative amount). */
  | { kind: 'amount'; amountText: string; prefix: string | null; gstText: string | null }
  /** The approved "on quote" wording. */
  | { kind: 'quote'; text: string }
  /** Nothing the visitor can be told yet: the component shows <Todo what="price for ...">. */
  | { kind: 'todo' };

export const QUOTE_TEXT = 'On quote - message us on WhatsApp';
export const STARTING_FROM_LABEL = 'Starting from';

/** A usable amount is a positive safe integer of paise. Zero, negatives, floats and null count as "not supplied". */
export function isSuppliedPaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Decide what a price tag may show.
 *  - an amount is supplied (positive integer paise)  -> the formatted price, "Starting from" wording when the type is
 *    starting_from (a quote-type product with an amount is treated as an indicative starting price);
 *  - type quote, no amount, wording approved          -> "On quote - message us on WhatsApp";
 *  - anything else                                    -> todo (the owner has not supplied the price).
 */
export function priceDisplay(input: PriceInput): PriceDisplay {
  if (isSuppliedPaise(input.pricePaise)) {
    const gstText = input.gstInclusive === true ? 'incl. GST' : input.gstInclusive === false ? '+ GST' : null;
    return {
      kind: 'amount',
      amountText: formatInr(input.pricePaise, { trimZeroPaise: true }),
      prefix: input.priceType === 'fixed' ? null : STARTING_FROM_LABEL,
      gstText,
    };
  }
  if (input.priceType === 'quote' && input.quoteWordingApproved === true) {
    return { kind: 'quote', text: QUOTE_TEXT };
  }
  return { kind: 'todo' };
}
