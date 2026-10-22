/**
 * Fixture tests (M2b, formerly the M0 RED tests): every proposed fixture run through parseTitle() and
 * compared with its machine-checkable expectation in tests/fixtures/expected.proposed.json.
 *
 * GREEN since M2b. The comparison machinery (helpers/compare.ts and the expected file itself) is proven
 * sound by expected.selfcheck.test.ts. An entry with pending_fields ['*'] depends on an undecided owner /
 * native-speaker decision and is skipped (reported as skipped, not as passed): PF-041 (Tamil vocabulary, PO-05).
 * The file name keeps '.red.' so history and docs still find it.
 */
import { describe, expect, it } from 'vitest';
import { isNotImplemented, parseTitle } from '../../src/lib/parser';
import type { ParseResult } from '../../src/lib/parser';
import { compareParse } from './helpers/compare';
import { expectedFile } from './helpers/fixtures';
import type { ExpectedEntry } from './helpers/fixtures';

const entries = expectedFile().entries;

function parseOrFail(entry: ExpectedEntry): ParseResult {
  const outcome = parseTitle(entry.input, entry.context);
  expect(
    isNotImplemented(outcome),
    `${entry.id}: parseTitle returned NOT_IMPLEMENTED (the corrected parser lands in milestone M2b)`,
  ).toBe(false);
  return outcome as ParseResult;
}

describe('RED fixtures: parseTitle() against expected.proposed.json', () => {
  for (const entry of entries) {
    const pendingAll = entry.pending_fields?.includes('*') === true;
    const label = `${entry.id} [${entry.origin}] ${entry.input}${entry.decision_pending ? `  (pending ${entry.decision_pending})` : ''}`;
    const run = pendingAll ? it.skip : it;
    run(label, () => {
      const result = parseOrFail(entry);
      expect(result.rawTitle, `${entry.id}: the raw title must be preserved byte-exact`).toBe(entry.input);
      const mismatches = compareParse(result, entry.expected, entry.pending_fields ?? []);
      expect(mismatches, `${entry.id}: ${mismatches.length} mismatch(es)`).toEqual([]);
    });
  }
});

describe('RED fixtures: relations between fixtures', () => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    for (const relation of entry.relations ?? []) {
      it(`${entry.id} ${relation.type} ${relation.with}`, () => {
        const other = byId.get(relation.with);
        expect(other, `relation target ${relation.with} must exist`).toBeDefined();
        const a = parseOrFail(entry);
        const b = parseOrFail(other as ExpectedEntry);
        if (relation.type === 'same_match_key') {
          expect(a.matchKey, `${entry.id}: matchKey must be set`).not.toBeNull();
          expect(a.matchKey).toBe(b.matchKey);
        } else {
          expect(a.seriesKey, `${entry.id}: seriesKey must be set`).not.toBeNull();
          expect(a.seriesKey).toBe(b.seriesKey);
          expect(a.year).toBe(b.year);
        }
      });
    }
  }
});
