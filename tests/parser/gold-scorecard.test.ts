/**
 * GREEN (M2b): agreement of parseTitle() with the PROPOSED gold labels of the 70 real titles
 * (tests/fixtures/gold-seed.real70.json). Nothing is owner-confirmed yet (OT-35), so this is a
 * regression floor on agreement with a first guess, not a correctness claim. It prints per-field
 * precision and recall (counts only, no title). Real titles never leave this private repo.
 */
import { describe, expect, it } from 'vitest';
import { computeScorecard, goldEntries } from './helpers/scorecard';

describe('gold seed (proposed labels) scorecard', () => {
  const card = computeScorecard();
  const field = (name: string) => card.fields.find((f) => f.field === name);

  it('prints the per-field precision and recall', () => {
    const lines = card.fields.map(
      (f) => `${f.field}: precision ${f.precision} recall ${f.recall} (gold ${f.goldCount}, parsed ${f.parsedCount}, agree ${f.agree})`,
    );
    console.log(
      [
        `gold-seed agreement over ${card.titles} titles (labels still proposed)`,
        `kind agreement ${card.kindAgreement}`,
        ...lines,
        `non_match: ${card.autoAccept.nonMatchTotal}; match-style auto-accept ${card.autoAccept.matchAutoAccept}, to review ${card.autoAccept.matchReview} of ${card.autoAccept.matchStyleTotal}`,
      ].join('\n'),
    );
    expect(card.titles).toBe(goldEntries().length);
  });

  it('keeps the agreement floors reached at M2b (precision of the fields the parser fills)', () => {
    expect(card.kindAgreement).toBeGreaterThanOrEqual(0.95);
    for (const name of ['category', 'round', 'year', 'players']) {
      expect(field(name)?.precision ?? 0, `${name} precision`).toBeGreaterThanOrEqual(0.85);
    }
    expect(field('tournament')?.precision ?? 0, 'tournament precision').toBeGreaterThanOrEqual(0.75);
  });
});
