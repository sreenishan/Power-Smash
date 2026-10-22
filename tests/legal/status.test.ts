import { describe, expect, it } from 'vitest';
import { isIsoDate } from '../../src/lib/dates';
import {
  LAWYER_REVIEW_TODO,
  draftNoticeTodo,
  legalStatus,
  needsLawyerReview,
  type LegalPageKey,
  type LegalReviewStatus,
} from '../../src/content/legal/status';
import { legalDocs } from '../../src/content/legal';
import { readRepoFile } from './helpers';

const KEYS = Object.keys(legalDocs) as LegalPageKey[];

describe('lawyer-review status and the draft notice (OT-15)', () => {
  it('has a status entry for every legal page and no extra ones', () => {
    expect(Object.keys(legalStatus).sort()).toEqual([...KEYS].sort());
  });

  it('the Todo text is exactly the one the plan specifies', () => {
    expect(LAWYER_REVIEW_TODO).toBe('lawyer review of this page (OT-15)');
  });

  it.each(KEYS)('%s: while reviewedByLawyer is false the draft notice shows the Todo; once true it is gone', (key) => {
    const reviewed = legalStatus[key].reviewedByLawyer;
    expect(typeof reviewed).toBe('boolean');
    expect(draftNoticeTodo(key)).toBe(reviewed ? null : LAWYER_REVIEW_TODO);
    expect(needsLawyerReview(key)).toBe(!reviewed);
  });

  it('flipping a flag in a copy of the status removes the notice for that page only', () => {
    const all = Object.fromEntries(KEYS.map((k) => [k, { reviewedByLawyer: false, reviewedOn: null }])) as Record<LegalPageKey, LegalReviewStatus>;
    const flipped = { ...all, privacy: { reviewedByLawyer: true, reviewedOn: '2026-12-01' } };
    expect(draftNoticeTodo('privacy', flipped)).toBeNull();
    for (const k of KEYS.filter((x) => x !== 'privacy')) expect(draftNoticeTodo(k, flipped)).toBe(LAWYER_REVIEW_TODO);
  });

  it('a page marked reviewed must carry the review date, and a page not reviewed must not', () => {
    for (const key of KEYS) {
      const s = legalStatus[key];
      if (s.reviewedByLawyer) expect(isIsoDate(s.reviewedOn), `${key} is marked reviewed without a valid date`).toBe(true);
      else expect(s.reviewedOn).toBeNull();
    }
  });

  it('LegalDraftNotice renders the Todo through the shared status helper', () => {
    const src = readRepoFile('src/components/legal/LegalDraftNotice.astro');
    expect(src).toContain("import Todo from '../site/Todo.astro'");
    expect(src).toContain('draftNoticeTodo(page)');
    expect(src).toContain('<Todo what={what} />');
  });
});
