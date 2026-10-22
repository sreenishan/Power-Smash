// No invented money or timelines on the legal pages (hard rule 7, D-020, D-021).
//  - No price, fee or percentage appears anywhere in the wording we write. Owner amounts are <Todo> only.
//  - Refund, cancellation and delivery pages contain NO timeline at all outside a <Todo>.
//  - Every other timeline is on an explicit allow-list below, with the fact it comes from. A new number fails the test until
//    someone adds it here on purpose (and the lawyer sees it).
import { describe, expect, it } from 'vitest';
import { legalDocs } from '../../src/content/legal';
import { docTodos, docWording } from '../../src/content/legal/model';
import type { LegalPageKey } from '../../src/content/legal/status';
import { ALL_OFF, ALL_ON, CURRENCY, DOC_ENTRIES, PERCENT, durationsIn, entriesFor } from './helpers';

/**
 * Timelines we state ourselves at G1 (every later feature off), per page, with their source. Lower-case, single spaces.
 * Retention figures are policy commitments (spec 15.4, D-028); the retention job that applies them is an M4 deliverable and must be
 * live before the first record reaches that age (see docs/legal/G1_REREAD_CHECKLIST.md).
 */
export const ALLOWED_DURATIONS: Record<LegalPageKey, Record<string, string>> = {
  privacy: {
    '24 months': 'spec 15.4: closed leads are anonymised after 24 months',
    '12 months': 'D-028: request records kept until resolved plus 12 months, then redacted',
    '90 days': 'D-028: raw events 90 days then daily totals; DPDP Rule 14(3) outer limit of 90 days for answering a request (VF-E6, third-party summary)',
    '48 hours': 'E-Commerce Rules 2020: grievance acknowledged within 48 hours (VF-E10, D-037); D-014 minors target',
    'one month': 'E-Commerce Rules 2020: redress within one month (VF-E10, D-037)',
    'two months': 'D-011: encrypted backups kept 56 to 60 days',
  },
  terms: {
    '48 hours': 'E-Commerce Rules 2020: grievance acknowledged within 48 hours (VF-E10, D-037)',
    'one month': 'E-Commerce Rules 2020: redress within one month (VF-E10, D-037)',
  },
  refunds: {},
  delivery: {},
  disclosures: {
    // The ASCI label-length figures (3 seconds, 15 seconds, 2 minutes) are no longer written here: they were presented as the
    // owner's own practice (finding C-11). The page links to the ASCI guidelines instead.
    '30 days': 'E-Commerce Amendment Rules 2026: lowest price of the preceding 30 days (VF-E11, D-037; third-party summary)',
  },
  contentRemoval: {
    '24 hours': 'D-014: acknowledge within 24 hours (the 2021 IT Rules; VF-E9)',
    '7 days': 'D-014: resolve within 7 days (IT Rules 2026, VF-E9; third-party summary)',
    '48 hours': 'D-014, spec 15.3 and 15.6: minors and removal-request target',
    '3 hours': 'D-014: court order or reasoned government notice (IT Rules 2026, VF-E9; third-party summary)',
    '12 months': 'D-028: request records kept until resolved plus 12 months',
  },
};

/** Timelines that may appear ONLY while a later feature is on (so they are not on the G1 pages). Source in each value. */
export const FUTURE_DURATIONS: Partial<Record<LegalPageKey, Record<string, string>>> = {
  privacy: {
    '30 days': 'spec 15.4: event documents deleted 30 days after the event (flag eventDocuments)',
    '90 days': 'D-028: payment contact fields redacted after 90 days (flag paymentRecords); the G1 pages already carry 90 days',
  },
};

const wideEntries = entriesFor(ALL_ON);

describe('no invented money on legal pages', () => {
  it.each([...DOC_ENTRIES, ...wideEntries])('%s: no currency amount and no percentage', (_k, doc) => {
    for (const text of docWording(doc)) {
      expect(text, `currency in: ${text.slice(0, 80)}`).not.toMatch(CURRENCY);
      expect(text, `percentage in: ${text.slice(0, 80)}`).not.toMatch(PERCENT);
    }
  });

  it.each([...DOC_ENTRIES, ...wideEntries])('%s: no standalone amounts like "1,000" or "499"', (_k, doc) => {
    for (const text of docWording(doc)) {
      expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    }
  });
});

describe('timelines on legal pages', () => {
  it.each(entriesFor(ALL_OFF))('%s (G1 wording): only allow-listed timelines appear outside a Todo', (key, doc) => {
    const allowed = new Set(Object.keys(ALLOWED_DURATIONS[key]));
    const found = new Set(docWording(doc).flatMap(durationsIn));
    for (const f of found) expect(allowed.has(f), `"${f}" on the ${key} page is not on the allow-list`).toBe(true);
  });

  it.each(entriesFor(ALL_OFF))('%s (G1 wording): the allow-list has no stale entries', (key, doc) => {
    const found = new Set(docWording(doc).flatMap(durationsIn));
    for (const a of Object.keys(ALLOWED_DURATIONS[key])) expect(found.has(a), `"${a}" is allow-listed but not on the ${key} page`).toBe(true);
  });

  it.each(wideEntries)('%s (every later feature on): only G1 or future allow-listed timelines appear', (key, doc) => {
    const allowed = new Set([...Object.keys(ALLOWED_DURATIONS[key]), ...Object.keys(FUTURE_DURATIONS[key] ?? {})]);
    for (const f of new Set(docWording(doc).flatMap(durationsIn))) expect(allowed.has(f), `"${f}" on the ${key} page is not on any allow-list`).toBe(true);
  });

  it('every future-only timeline really appears once its feature is on, and not at G1', () => {
    const wide = Object.fromEntries(wideEntries) as Record<LegalPageKey, (typeof wideEntries)[number][1]>;
    const now = Object.fromEntries(entriesFor(ALL_OFF)) as typeof wide;
    expect(new Set(docWording(wide.privacy).flatMap(durationsIn)).has('30 days')).toBe(true);
    expect(new Set(docWording(now.privacy).flatMap(durationsIn)).has('30 days')).toBe(false);
  });

  it('the refund and delivery pages state no timeline of their own (every one is a Todo for the owner)', () => {
    for (const key of ['refunds', 'delivery'] as const) {
      expect(docWording(legalDocs[key]).flatMap(durationsIn)).toEqual([]);
    }
  });

  it('on the Terms the only timelines are about how we handle a complaint, never about refunds or delivery', () => {
    for (const text of docWording(legalDocs.terms)) {
      if (durationsIn(text).length > 0) expect(text).toMatch(/complaint/i);
    }
  });

  it('the refund and delivery pages carry owner Todos for every decision (OT-20, OT-21)', () => {
    const refundTodos = JSON.stringify(legalDocs.refunds.sections);
    const deliveryTodos = JSON.stringify(legalDocs.delivery.sections);
    for (const needle of ['advance', 'early cancellation window', 'late cancellation window', 'digital file has been delivered', 'how long a refund takes', 'payment provider']) {
      expect(refundTodos).toContain(needle);
    }
    for (const needle of ['how long after the event', 'delivery time for each product', 'time allowed to report a problem']) {
      expect(deliveryTodos).toContain(needle);
    }
  });

  it('optional owner text is hidden, never a Todo (finding C-14): travel policy, live-stream venue needs, rights-dispute target', () => {
    const delivery = docTodos(legalDocs.delivery).join('\n');
    expect(delivery).not.toMatch(/travel|live stream|venue/i);
    expect(docTodos(legalDocs.contentRemoval).join('\n')).not.toMatch(/rights dispute|target time/i);
  });
});
