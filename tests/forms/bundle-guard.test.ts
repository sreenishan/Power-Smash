// Page weight guard (spec 12.5: 80 KB gzip of JavaScript per public page; review C-1). React alone is about 69 KB of that, so what
// the form island loads when it hydrates must stay small. This test reads the import graph of the one island entry file
// (LeadForm.tsx, used by all four pages) and fails if the heavy parts (zod, the contract, the validation rules, the sender, the
// reducer's Next/Send logic, Turnstile logic, the thank-you screen, the form definitions...) are imported eagerly instead of
// through a dynamic import(). It also keeps the site-wide event sender free of imports (every page loads it). It complements the
// measured numbers in docs/m1/fix-forms-notes.md (tmp/measure-js-strict.mjs measures a build the strict way).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_ENDPOINT } from '../../src/lib/contracts/lead-constants';

const ROOT = resolve(__dirname, '../..');
const ISLAND = join(ROOT, 'src/components/forms/LeadForm.tsx');

function resolveSpecifier(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

/** Specifiers of runtime imports (static) and of dynamic import() calls in one file. */
function importsOf(file: string): { staticSpecs: string[]; dynamicSpecs: string[]; external: string[] } {
  const src = readFileSync(file, 'utf8');
  const staticSpecs: string[] = [];
  const external: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) {
    if (m[2]) continue; // import type / export type
    const names = m[3] ?? '';
    const braces = /^\{([\s\S]*)\}$/.exec(names.trim());
    if (braces && braces[1]!.split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
    const spec = m[4]!;
    (spec.startsWith('.') ? staticSpecs : external).push(spec);
  }
  const dynamicSpecs = [...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
  return { staticSpecs, dynamicSpecs, external };
}

function closure(entries: string[], followDynamic: boolean): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>();
  const external = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const { staticSpecs, dynamicSpecs, external: ext } = importsOf(file);
    ext.forEach((e) => external.add(e));
    for (const spec of [...staticSpecs, ...(followDynamic ? dynamicSpecs : [])]) {
      const target = resolveSpecifier(file, spec);
      if (target) queue.push(target);
    }
  }
  return { files, external };
}

const rel = (files: Set<string>) => [...files].map((f) => relative(ROOT, f).replace(/\\/g, '/')).sort();

describe('page weight guard for the form island', () => {
  it('the island reaches the engine, the Turnstile logic, the choice boxes and the thank-you screens only through dynamic import()', () => {
    const forbiddenEager = [
      'src/lib/contracts/lead.ts',
      'src/lib/contracts/event.ts',
      'src/lib/contracts/lead-constants.ts', // the numbers and texts the engine needs; the page gets what it needs through props
      'src/lib/security/text.ts',
      'src/content/consent.ts', // the notice texts reach the island as props from the page
      'src/lib/whatsapp.ts',
      'src/lib/dates.ts',
      // the engine and everything in it
      'src/lib/forms/engine.ts',
      'src/lib/forms/controller.ts',
      'src/lib/forms/flow.ts', // Next, Back, Send and results (the part of the machine the page needs at once is flow-base.ts)
      'src/lib/forms/steps.ts',
      'src/lib/forms/validate.ts',
      'src/lib/forms/rules.ts',
      'src/lib/forms/submit.ts',
      'src/lib/forms/payload.ts',
      'src/lib/forms/idempotency.ts',
      'src/lib/forms/attribution.ts',
      'src/lib/forms/events.ts',
      'src/lib/forms/turnstile.ts',
      'src/lib/forms/whatsapp-prefill.ts',
      'src/lib/forms/summary.ts',
      'src/lib/forms/confirmation-text.ts',
      // the form definitions are built by the page at build time and arrive as a prop
      'src/lib/forms/definitions.ts',
      'src/lib/forms/page-config.ts',
      'src/lib/forms/defs/common.ts',
      'src/lib/forms/defs/coverage.ts',
      'src/lib/forms/defs/general.ts',
      'src/lib/forms/defs/sponsorship.ts',
      'src/lib/forms/defs/tournament.ts',
      // screens and controls that are not on the first screen
      'src/components/forms/Confirmation.tsx',
      'src/components/forms/FailurePanel.tsx',
      'src/components/forms/WhatsAppButton.tsx',
      'src/components/forms/ChoiceField.tsx',
      'src/components/forms/TurnstileLogic.tsx',
      'src/components/forms/icons-more.tsx',
      'src/components/forms/styles-more.ts',
    ];
    const eager = rel(closure([ISLAND], false).files);
    for (const path of forbiddenEager) expect(eager, `LeadForm imports ${path} eagerly`).not.toContain(path);
  });

  it('the first-load graph is exactly this list: a new static import must be added here on purpose, with its weight in mind', () => {
    // Measured weight of this graph (gzip, strict method of tmp/measure-js-strict.mjs): see docs/m1/fix-forms-notes.md section C-1.
    expect(rel(closure([ISLAND], false).files)).toEqual([
      'src/components/forms/ConsentNotice.tsx',
      'src/components/forms/FieldRenderer.tsx',
      'src/components/forms/FormStatus.tsx',
      'src/components/forms/Honeypot.tsx',
      'src/components/forms/LeadForm.tsx',
      'src/components/forms/StepIndicator.tsx',
      'src/components/forms/SubmitButton.tsx',
      'src/components/forms/TurnstileWidget.tsx',
      'src/components/forms/icons.tsx',
      'src/components/forms/styles.ts',
      'src/lib/forms/flow-base.ts',
      'src/lib/forms/gate.ts',
    ]);
  });

  it('every page uses the one island entry and builds its own form definition at build time', () => {
    for (const [page, def] of [
      ['src/pages/book.astro', 'defs/coverage'],
      ['src/pages/partner.astro', 'defs/sponsorship'],
      ['src/pages/contact.astro', 'defs/general'],
      ['src/pages/tournaments/submit.astro', 'defs/tournament'],
    ]) {
      const src = readFileSync(join(ROOT, page!), 'utf8');
      expect(src, page).toMatch(/import LeadForm from '[./]+\/components\/forms\/LeadForm'/);
      expect(src, page).toContain(`lib/forms/${def}`);
      expect(src, page).toMatch(/<LeadForm\s+client:visible/); // hydrates when it scrolls into view, not at page load
      expect(src, page).toContain('plainForm('); // the definition is plain JSON for the island props
    }
  });

  it('zod and the server-side contract never reach the browser, even lazily', () => {
    const all = closure([ISLAND], true);
    expect([...all.external].filter((e) => e === 'zod' || e.startsWith('zod/'))).toEqual([]);
    const files = rel(all.files);
    expect(files).not.toContain('src/lib/contracts/lead.ts');
    expect(files).not.toContain('src/lib/contracts/event.ts');
    for (const def of ['common', 'coverage', 'general', 'sponsorship', 'tournament']) expect(files).not.toContain(`src/lib/forms/defs/${def}.ts`);
  });

  it('the lazy parts really are lazy chunks (they are imported with import())', () => {
    const lead = importsOf(ISLAND);
    expect(lead.dynamicSpecs).toEqual(expect.arrayContaining(['../../lib/forms/engine', './Confirmation', './FailurePanel', './ChoiceField']));
    const widget = importsOf(join(ROOT, 'src/components/forms/TurnstileWidget.tsx'));
    expect(widget.dynamicSpecs).toContain('./TurnstileLogic');
    const logic = importsOf(join(ROOT, 'src/components/forms/TurnstileLogic.tsx'));
    expect(logic.dynamicSpecs).toContain('../../lib/forms/turnstile');
    const field = importsOf(join(ROOT, 'src/components/forms/FieldRenderer.tsx'));
    expect(field.dynamicSpecs).toContain('./ChoiceField');
  });

  it('the engine bundle contains everything that happens after a touch', () => {
    const engine = rel(closure([join(ROOT, 'src/lib/forms/engine.ts')], false).files);
    for (const f of ['src/lib/forms/controller.ts', 'src/lib/forms/flow.ts', 'src/lib/forms/validate.ts', 'src/lib/forms/rules.ts', 'src/lib/forms/submit.ts', 'src/lib/forms/payload.ts', 'src/lib/forms/events.ts']) {
      expect(engine).toContain(f);
    }
  });
});

describe('the site-wide event sender stays tiny (every page loads it through src/lib/wa-click.ts)', () => {
  it('analytics.ts has no runtime imports, so no constants file or form code is dragged onto every page', () => {
    const { staticSpecs, external } = importsOf(join(ROOT, 'src/lib/forms/analytics.ts'));
    expect(staticSpecs).toEqual([]);
    expect(external).toEqual([]);
  });

  it('its endpoint is the contract endpoint (it is written out there instead of imported)', () => {
    const src = readFileSync(join(ROOT, 'src/lib/forms/analytics.ts'), 'utf8');
    expect(src).toContain(`const EVENT_PATH = '${EVENT_ENDPOINT}'`);
  });

  it('the form events live in events.ts and the sender in analytics.ts, not the other way round', () => {
    const analytics = readFileSync(join(ROOT, 'src/lib/forms/analytics.ts'), 'utf8');
    expect(analytics).not.toContain('buildEventBody');
    expect(analytics).not.toContain('trackFormEvent');
    const waClick = importsOf(join(ROOT, 'src/lib/wa-click.ts'));
    expect(waClick.staticSpecs).toEqual(['./forms/analytics']);
  });
});

describe('E-1: the first tap on Send is not lost', () => {
  it('the spam-check fallback keeps the placeholder height, so the Send button does not move under the pointer', () => {
    const src = readFileSync(join(ROOT, 'src/components/forms/TurnstileWidget.tsx'), 'utf8');
    const fallback = /fallback=\{([\s\S]*?)\}\s*>/.exec(src)?.[1] ?? '';
    expect(fallback).toContain('min-h-[65px]');
    expect(src.match(/min-h-\[65px\]/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
