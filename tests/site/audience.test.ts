// Audience figures on /partner (review C-8, OT-12): a Todo until the owner supplies dated figures; dated figures afterwards;
// never an undated figure; nothing invented. The sample figures below are FICTIONAL and exist only in this test file.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIENCE_TODO_DATE, AUDIENCE_TODO_FIGURES, audienceView, type AudienceInput } from '../../src/components/site/audience';
import { site } from '../../src/content/site';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const empty: AudienceInput = {
  asOf: null,
  asOfDate: null,
  monthlyViews: null,
  topLocations: [],
  ageGroups: [],
  genderSplit: [],
  avgViewDuration: null,
};

// Fictional: nothing here is a real Power Smash figure.
const sample: AudienceInput = {
  asOf: 'Sample Month 2030',
  asOfDate: '2030-01-15',
  monthlyViews: 'sample views text',
  topLocations: [
    { label: 'Sample City A', share: 'sample share A' },
    { label: 'Sample City B', share: 'sample share B' },
  ],
  ageGroups: [{ label: 'Sample age group', share: 'sample share C' }],
  genderSplit: [{ label: 'Sample gender', share: 'sample share D' }],
  avgViewDuration: 'sample duration text',
};

describe('site.audience starts empty (never fabricated)', () => {
  it('every field is null or empty until the owner supplies it', () => {
    expect(site.audience).toEqual(empty);
  });

  it('with the real site data the block is a Todo (so the strict gate fails until OT-12 is answered)', () => {
    expect(audienceView(site.audience)).toEqual({ kind: 'todo', what: AUDIENCE_TODO_FIGURES });
    expect(AUDIENCE_TODO_FIGURES).toMatch(/OT-12/);
  });
});

describe('audienceView', () => {
  it('shows a Todo when no figure is supplied, even if a date is', () => {
    expect(audienceView(empty)).toEqual({ kind: 'todo', what: AUDIENCE_TODO_FIGURES });
    expect(audienceView({ ...empty, asOf: 'Sample Month 2030' })).toEqual({ kind: 'todo', what: AUDIENCE_TODO_FIGURES });
  });

  it('never shows undated figures: figures without an as-of wording give a Todo that asks for the date', () => {
    const view = audienceView({ ...sample, asOf: null });
    expect(view).toEqual({ kind: 'todo', what: AUDIENCE_TODO_DATE });
    expect(audienceView({ ...sample, asOf: '   ' })).toEqual({ kind: 'todo', what: AUDIENCE_TODO_DATE });
  });

  it('shows the dated figures, in the owner\'s own wording and in a fixed order', () => {
    const view = audienceView(sample);
    expect(view.kind).toBe('figures');
    if (view.kind !== 'figures') return;
    expect(view.asOf).toBe('Sample Month 2030');
    expect(view.facts).toEqual([
      { label: 'Monthly views', value: 'sample views text' },
      { label: 'Average view duration', value: 'sample duration text' },
    ]);
    expect(view.groups.map((g) => g.title)).toEqual(['Top locations', 'Age groups', 'Gender']);
    expect(view.groups[0]?.items).toEqual([
      { label: 'Sample City A', share: 'sample share A' },
      { label: 'Sample City B', share: 'sample share B' },
    ]);
  });

  it('shows only the fields the owner filled in, with no empty rows', () => {
    const view = audienceView({ ...empty, asOf: 'Sample Month 2030', monthlyViews: 'sample views text', topLocations: [{ label: ' ', share: 'x' }, { label: 'Sample City A', share: ' ' }] });
    expect(view.kind).toBe('figures');
    if (view.kind !== 'figures') return;
    expect(view.facts).toEqual([{ label: 'Monthly views', value: 'sample views text' }]);
    expect(view.groups).toEqual([]);
  });

  it('trims the owner\'s text and does not compute or reformat any number', () => {
    const view = audienceView({ ...empty, asOf: ' Sample Month 2030 ', avgViewDuration: ' 3:20 ', ageGroups: [{ label: ' 18-24 ', share: ' 12.5% ' }] });
    expect(view.kind).toBe('figures');
    if (view.kind !== 'figures') return;
    expect(view.asOf).toBe('Sample Month 2030');
    expect(view.facts).toEqual([{ label: 'Average view duration', value: '3:20' }]);
    expect(view.groups[0]?.items).toEqual([{ label: '18-24', share: '12.5%' }]);
  });
});

describe('AudienceFigures.astro', () => {
  const source = readFileSync(join(ROOT, 'src/components/site/AudienceFigures.astro'), 'utf8');

  it('renders a Todo through the Todo component (never a hand-typed marker) and the figures only from the view', () => {
    expect(source).toContain("import Todo from './Todo.astro'");
    expect(source).toMatch(/<Todo what=\{view\.what\} \/>/);
    expect(source).not.toMatch(/TODO\(owner\)/);
    expect(source).toContain('audienceView(audience)');
    expect(source).toMatch(/as of \{view\.asOf\}/);
  });

  it('defaults to site.audience', () => {
    expect(source).toMatch(/audience = site\.audience/);
  });
});
