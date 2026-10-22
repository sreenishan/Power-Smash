// Product editing rules for the admin "Products and pricing" screen (spec 14, BUILD_PLAN M3, D-020, D-021, D-024). PURE.
//
// The hard rules, each with a test:
//  - A price is integer paise the owner typed. There is NO default price, fee, tax rate or discount: a missing price stays `null`.
//  - A visible `fixed` or `starting_from` product must have a price; otherwise it must be hidden (a public page would show a
//    "price needed" marker, which blocks the release build).
//  - A visible `quote` product without a price needs the owner's approval of the "On quote" wording (money.ts `priceDisplay`).
//  - The GST flag is yes, no or unknown (null). Unknown claims nothing on the page.
//  - Delivery days is a whole number or null (unknown: the page claims nothing).
import type { PriceType } from '../money';
import { isAmountPaise, parseRupeesToPaise } from './price-input';

export const PRICE_TYPES: readonly PriceType[] = ['fixed', 'starting_from', 'quote'];

export interface ProductEditInput {
  name: string;
  summary: string;
  priceType: string;
  /** The price as the owner typed it ("5,000"). Use this OR `pricePaise`. Blank = not supplied. */
  priceRupees?: string | null;
  /** The price as integer paise. Use this OR `priceRupees`. */
  pricePaise?: number | null;
  gstInclusive?: boolean | null;
  deliveryDays?: number | null;
  /** Shown on the public site. */
  visible: boolean;
  sort?: number;
  inclusions?: readonly string[];
  /** The owner has approved the inclusions wording. */
  inclusionsApproved?: boolean;
  /** The owner has approved the "On quote - message us on WhatsApp" wording. */
  quoteWordingApproved?: boolean;
}

export interface ProductRecord {
  name: string;
  summary: string;
  priceType: PriceType;
  /** Integer paise, or null = not supplied. */
  pricePaise: number | null;
  gstInclusive: boolean | null;
  deliveryDays: number | null;
  visible: boolean;
  sort: number;
  inclusions: string[];
  inclusionsApproved: boolean;
  quoteWordingApproved: boolean;
}

export type ProductField = 'name' | 'summary' | 'priceType' | 'price' | 'gstInclusive' | 'deliveryDays' | 'visible' | 'sort' | 'inclusions';
export type ProductValidation = { ok: true; value: ProductRecord; warnings: string[] } | { ok: false; errors: Partial<Record<ProductField, string>> };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (s: string): string => s.replace(CONTROL, '').replace(/[ \t]+/g, ' ').trim();

export const INCLUSIONS_MAX = 20;
export const INCLUSION_MAX_LENGTH = 200;
export const DELIVERY_DAYS_MAX = 365;

export function validateProductEdit(input: ProductEditInput): ProductValidation {
  const errors: Partial<Record<ProductField, string>> = {};
  const warnings: string[] = [];

  const name = clean(typeof input.name === 'string' ? input.name : '');
  if (name.length < 2 || name.length > 120) errors.name = 'The name needs 2 to 120 characters.';
  const summary = clean(typeof input.summary === 'string' ? input.summary : '');
  if (summary.length > 300) errors.summary = 'Keep the summary under 300 characters.';

  const priceType = (PRICE_TYPES as readonly string[]).includes(input.priceType) ? (input.priceType as PriceType) : null;
  if (!priceType) errors.priceType = 'Choose Fixed, Starting from or On quote.';

  // price: exactly one source; never a default
  let pricePaise: number | null = null;
  const hasRupees = input.priceRupees !== undefined && input.priceRupees !== null && String(input.priceRupees).trim() !== '';
  const hasPaise = input.pricePaise !== undefined && input.pricePaise !== null;
  if (hasRupees && hasPaise) errors.price = 'Give the price once.';
  else if (hasRupees) {
    const p = parseRupeesToPaise(String(input.priceRupees));
    if (!p.ok) errors.price = p.error;
    else pricePaise = p.paise;
  } else if (hasPaise) {
    if (!isAmountPaise(input.pricePaise)) errors.price = 'The price must be a whole number of paise, more than zero.';
    else pricePaise = input.pricePaise;
  }

  if (typeof input.visible !== 'boolean') errors.visible = 'Choose whether the product is shown.';
  const visible = input.visible === true;

  if (priceType && !errors.price) {
    if (visible && pricePaise === null) {
      if (priceType === 'quote') {
        if (input.quoteWordingApproved !== true) errors.price = 'To show an "On quote" product with no price, approve the "On quote" wording first, or hide the product.';
      } else {
        errors.price = 'Set a price, or hide the product until you have one.';
      }
    }
  }

  const gst = input.gstInclusive;
  if (gst !== undefined && gst !== null && typeof gst !== 'boolean') errors.gstInclusive = 'Choose Including GST, Plus GST or Not sure.';
  if (pricePaise !== null && (gst === null || gst === undefined) && !errors.gstInclusive) {
    warnings.push('GST is set to "Not sure": the page will not say anything about GST next to this price.');
  }

  let deliveryDays: number | null = null;
  if (input.deliveryDays !== undefined && input.deliveryDays !== null) {
    if (!Number.isInteger(input.deliveryDays) || input.deliveryDays < 1 || input.deliveryDays > DELIVERY_DAYS_MAX) errors.deliveryDays = `Delivery days is a whole number from 1 to ${DELIVERY_DAYS_MAX}, or leave it blank.`;
    else deliveryDays = input.deliveryDays;
  }

  const sort = input.sort ?? 0;
  if (!Number.isInteger(sort) || sort < 0 || sort > 9999) errors.sort = 'Order is a whole number from 0 to 9999.';

  const inclusions: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.inclusions ?? []) {
    const t = clean(typeof raw === 'string' ? raw : '');
    if (t === '') continue;
    if (t.length > INCLUSION_MAX_LENGTH) {
      errors.inclusions = `Each inclusion can have up to ${INCLUSION_MAX_LENGTH} characters.`;
      break;
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    inclusions.push(t);
  }
  if (inclusions.length > INCLUSIONS_MAX) errors.inclusions = `Up to ${INCLUSIONS_MAX} inclusions.`;
  if (visible && input.inclusionsApproved !== true && inclusions.length > 0) warnings.push('The inclusions are not approved yet, so they show as a draft on the page.');

  if (Object.keys(errors).length > 0 || !priceType) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    value: {
      name,
      summary,
      priceType,
      pricePaise,
      gstInclusive: gst === undefined ? null : gst,
      deliveryDays,
      visible,
      sort,
      inclusions,
      inclusionsApproved: input.inclusionsApproved === true,
      quoteWordingApproved: input.quoteWordingApproved === true,
    },
  };
}

// ---- change detection for the audit log and the "prices changed" alert ---------------------------------------------------

export type ChangedField = keyof ProductRecord;

export function changedFields(before: ProductRecord, after: ProductRecord): ChangedField[] {
  const keys = Object.keys(after) as ChangedField[];
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

export interface PriceChange {
  fromPaise: number | null;
  toPaise: number | null;
  fromType: PriceType;
  toType: PriceType;
}

/** The price part of a change (what the "prices changed" alert and the audit entry carry), or null when no price field changed. */
export function priceChange(before: ProductRecord, after: ProductRecord): PriceChange | null {
  if (before.pricePaise === after.pricePaise && before.priceType === after.priceType) return null;
  return { fromPaise: before.pricePaise, toPaise: after.pricePaise, fromType: before.priceType, toType: after.priceType };
}
