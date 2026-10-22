// What the audience-figures block may show (review C-8; BUILD_PLAN M1 and OT-12: the owner's dated YouTube Studio figures
// must be on /partner before G1). Pure, so Vitest can test the rule without rendering anything.
//
// Rules (D-016 item 5, hard rule 7, "Never fabricate"):
//  - nothing is ever invented or computed: every value is the owner's own wording, copied from `site.audience`;
//  - figures are NEVER shown without their "as of" wording (an undated number is not allowed);
//  - with no figure at all, or with figures but no date, the block shows a <Todo> that fails the strict release gate until
//    the owner supplies it (OT-12 is a G1 input);
//  - only the fields the owner supplied are shown; the others are simply absent (no empty rows, no "n/a").

import type { AudienceShare } from '../../content/site';

export interface AudienceInput {
  readonly asOf: string | null;
  readonly asOfDate?: string | null;
  readonly monthlyViews: string | null;
  readonly topLocations: readonly AudienceShare[];
  readonly ageGroups: readonly AudienceShare[];
  readonly genderSplit: readonly AudienceShare[];
  readonly avgViewDuration: string | null;
}

export interface AudienceGroup {
  /** Heading of the list, plain English. */
  readonly title: string;
  readonly items: readonly AudienceShare[];
}

export type AudienceView =
  /** Show the dated figures. */
  | {
      kind: 'figures';
      asOf: string;
      /** Single figures, in display order: label and the owner's wording. */
      facts: readonly { readonly label: string; readonly value: string }[];
      groups: readonly AudienceGroup[];
    }
  /** Show one <Todo> saying what is still needed. */
  | { kind: 'todo'; what: string };

const text = (value: string | null | undefined): string | null => {
  const t = (value ?? '').trim();
  return t === '' ? null : t;
};

const cleanShares = (items: readonly AudienceShare[]): AudienceShare[] =>
  items
    .map((i) => ({ label: i.label.trim(), share: i.share.trim() }))
    .filter((i) => i.label !== '' && i.share !== '');

export const AUDIENCE_TODO_FIGURES =
  "the audience figures from YouTube Studio (top locations, age and gender, monthly views, average view duration) with the 'as of' date (OT-12)";
export const AUDIENCE_TODO_DATE = "the 'as of' date for the audience figures (OT-12): figures are not shown without it";

export function audienceView(input: AudienceInput): AudienceView {
  const asOf = text(input.asOf);
  const monthlyViews = text(input.monthlyViews);
  const avgViewDuration = text(input.avgViewDuration);
  const groups: AudienceGroup[] = [
    { title: 'Top locations', items: cleanShares(input.topLocations) },
    { title: 'Age groups', items: cleanShares(input.ageGroups) },
    { title: 'Gender', items: cleanShares(input.genderSplit) },
  ].filter((g) => g.items.length > 0);
  const facts: { label: string; value: string }[] = [];
  if (monthlyViews) facts.push({ label: 'Monthly views', value: monthlyViews });
  if (avgViewDuration) facts.push({ label: 'Average view duration', value: avgViewDuration });

  if (facts.length === 0 && groups.length === 0) return { kind: 'todo', what: AUDIENCE_TODO_FIGURES };
  if (asOf === null) return { kind: 'todo', what: AUDIENCE_TODO_DATE };
  return { kind: 'figures', asOf, facts, groups };
}
