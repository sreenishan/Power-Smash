// Content model for the legal pages. The pages are DATA (so tests can read every sentence) rendered by
// src/components/legal/LegalDocument.astro. Pure TypeScript: no Astro, no DOM.
//
// Rules the model enforces by construction:
//   - An owner-supplied fact (legal name, address, phone, email, grievance officer) is a `site` inline: it renders the value
//     from src/content/site.ts, or <Todo what="..."> when the value is null. Never a made-up value.
//   - An owner BUSINESS decision (advance, windows, timelines, refund rules) is a `todo` inline. Never a number written here.
//   - Links are `link` inlines with a fixed href so tests can check every host.
import type { LegalPageKey } from './status';
import { hiddenMarkerName, type LegalFactName } from './facts';

/** The site.ts fields a legal page may need. `grievanceOfficerPhone` is optional: the Site-shell worker may add it (see docs/m1/legal-notes.md). */
export type SiteField =
  | 'legalName'
  | 'postalAddress'
  | 'phone'
  | 'publicEmail'
  | 'grievanceOfficerName'
  | 'grievanceEmail'
  | 'grievanceOfficerPhone';

/** The shape of src/content/site.ts that the legal pages read (the real `site` object is assignable to it). */
export interface LegalSiteFacts {
  readonly legalName: string | null;
  readonly postalAddress: string | null;
  readonly phone: string | null;
  readonly publicEmail: string | null;
  readonly grievanceOfficerName: string | null;
  readonly grievanceEmail: string | null;
  readonly grievanceOfficerPhone?: string | null;
  readonly whatsappNumber: string | null;
}

export type Inline =
  | string
  | { readonly t: 'todo'; readonly what: string }
  | { readonly t: 'link'; readonly href: string; readonly text: string }
  | { readonly t: 'site'; readonly field: SiteField; readonly todo: string }
  | { readonly t: 'fact'; readonly name: LegalFactName }
  | { readonly t: 'strong'; readonly text: string };

type BlockBody =
  | { readonly k: 'p'; readonly c: readonly Inline[] }
  | { readonly k: 'ul'; readonly items: readonly (readonly Inline[])[] }
  | { readonly k: 'ol'; readonly items: readonly (readonly Inline[])[] }
  | {
      readonly k: 'table';
      readonly caption: string;
      readonly head: readonly string[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
      /** Per row (same order as `rows`): the owner fact the row needs, or null for a row that always shows. A row whose fact is missing is hidden (D-034). */
      readonly rowShowWhen?: readonly (LegalFactName | null)[];
    }
  | { readonly k: 'note'; readonly c: readonly Inline[] }
  /** Seller, customer-care and grievance-officer details (D-037). */
  | { readonly k: 'grievance' }
  /** Ways to reach us about a removal request: WhatsApp (waLink), email, urgent phone, online form. Hidden when missing; a Todo if none exist. */
  | { readonly k: 'routes' };

/** Any block may carry `showWhen`: it is hidden until that owner fact in facts.ts is supplied (hide rule, D-034). */
export type Block = BlockBody & { readonly showWhen?: LegalFactName };

export interface LegalSection {
  /** Kebab-case, unique within the page. Used for the table of contents anchor. */
  readonly id: string;
  /** Plain-English heading (rendered as H2, or H3 for a subsection). */
  readonly heading: string;
  readonly blocks: readonly Block[];
  /** One level of H3 subsections, rendered after `blocks`. */
  readonly subsections?: readonly LegalSection[];
  /** Hide the whole section (heading, table-of-contents entry and body) until this fact in facts.ts is supplied (hide-section rule, D-034). */
  readonly showWhen?: LegalFactName;
  /** Hide the whole section until AT LEAST ONE of these facts is supplied. */
  readonly showWhenAny?: readonly LegalFactName[];
}

export interface LegalDoc {
  readonly key: LegalPageKey;
  readonly path: string;
  /** The H1 and the page title. */
  readonly title: string;
  /** Meta description. */
  readonly description: string;
  /** The "in short" lead paragraph under the title. */
  readonly summary: readonly Inline[];
  readonly sections: readonly LegalSection[];
}

// --------------------------------------------------------------------------------------------------------------------
// Builders (keep the page files readable)
// --------------------------------------------------------------------------------------------------------------------
type Part = Inline | readonly Inline[];
const run = (x: Part): readonly Inline[] => (typeof x === 'string' || !Array.isArray(x) ? ([x] as Inline[]) : (x as readonly Inline[]));

export const todo = (what: string): Inline => ({ t: 'todo', what });
export const link = (href: string, text: string): Inline => ({ t: 'link', href, text });
export const field = (name: SiteField, what: string): Inline => ({ t: 'site', field: name, todo: what });
export const fact = (name: LegalFactName): Inline => ({ t: 'fact', name });
export const strong = (text: string): Inline => ({ t: 'strong', text });

export const p = (...c: Inline[]): Block => ({ k: 'p', c });
export const note = (...c: Inline[]): Block => ({ k: 'note', c });
export const ul = (...items: Part[]): Block => ({ k: 'ul', items: items.map(run) });
export const ol = (...items: Part[]): Block => ({ k: 'ol', items: items.map(run) });
export const table = (caption: string, head: string[], rows: Part[][], opts: { rowShowWhen?: (LegalFactName | null)[] } = {}): Block => ({
  k: 'table',
  caption,
  head,
  rows: rows.map((r) => r.map(run)),
  ...(opts.rowShowWhen ? { rowShowWhen: opts.rowShowWhen } : {}),
});
/** The same block, hidden until the owner fact is supplied (hide rule, D-034). */
export const whenFact = (name: LegalFactName, block: Block): Block => ({ ...block, showWhen: name });
export const grievance = (): Block => ({ k: 'grievance' });
/** `items` when the condition holds, otherwise nothing. Used to include wording only while a feature flag is on (status.ts). */
export const ifOn = <T>(on: boolean, ...items: T[]): T[] => (on ? items : []);
export const routes = (): Block => ({ k: 'routes' });
export const section = (
  id: string,
  heading: string,
  blocks: Block[],
  opts: { subsections?: LegalSection[]; showWhen?: LegalFactName; showWhenAny?: LegalFactName[] } = {},
): LegalSection => ({
  id,
  heading,
  blocks,
  ...(opts.subsections ? { subsections: opts.subsections } : {}),
  ...(opts.showWhen ? { showWhen: opts.showWhen } : {}),
  ...(opts.showWhenAny ? { showWhenAny: opts.showWhenAny } : {}),
});

// --------------------------------------------------------------------------------------------------------------------
// Resolution and inspection (shared by the components and the tests)
// --------------------------------------------------------------------------------------------------------------------

/** The trimmed value of a site field, or null when the owner has not supplied it. */
export function resolveSiteField(facts: LegalSiteFacts, name: SiteField): string | null {
  const v = facts[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Every Inline run in a list of blocks, depth first, in reading order. */
export function blockRuns(blocks: readonly Block[]): (readonly Inline[])[] {
  const out: (readonly Inline[])[] = [];
  for (const b of blocks) {
    switch (b.k) {
      case 'p':
      case 'note':
        out.push(b.c);
        break;
      case 'ul':
      case 'ol':
        out.push(...b.items);
        break;
      case 'table':
        for (const row of b.rows) out.push(...row);
        break;
      case 'grievance':
      case 'routes':
        break;
    }
  }
  return out;
}

export function allSections(doc: LegalDoc): LegalSection[] {
  return doc.sections.flatMap((s) => [s, ...(s.subsections ?? [])]);
}

/** Every Inline run on the page: the summary first, then every section in order. */
export function docRuns(doc: LegalDoc): (readonly Inline[])[] {
  return [doc.summary, ...allSections(doc).flatMap((s) => blockRuns(s.blocks))];
}

/** Every block on the page. */
export function docBlocks(doc: LegalDoc): Block[] {
  return allSections(doc).flatMap((s) => [...s.blocks]);
}

type FactValues = Partial<Record<LegalFactName, string | null>>;
const supplied = (facts: FactValues, name: LegalFactName): boolean => {
  const v = facts[name];
  return typeof v === 'string' && v.trim() !== '';
};

/** True when a section should show: no condition, its fact is supplied, or (for `showWhenAny`) at least one fact is supplied. */
export function sectionVisible(s: LegalSection, facts: FactValues): boolean {
  if (s.showWhen && !supplied(facts, s.showWhen)) return false;
  if (s.showWhenAny && !s.showWhenAny.some((n) => supplied(facts, n))) return false;
  return true;
}

/** The sections to show: those without a condition, or whose fact is supplied. */
export function visibleSections(doc: LegalDoc, facts: FactValues): LegalSection[] {
  return doc.sections.filter((s) => sectionVisible(s, facts));
}

/** The blocks of a section to show (a block whose `showWhen` fact is missing is hidden). */
export function visibleBlocks(blocks: readonly Block[], facts: FactValues): Block[] {
  return blocks.filter((b) => !b.showWhen || supplied(facts, b.showWhen));
}

/** The rows of a table block to show, each with the cells for that row (a row whose fact is missing is hidden). */
export function visibleRows(block: Extract<Block, { k: 'table' }>, facts: FactValues): (readonly (readonly Inline[])[])[] {
  return block.rows.filter((_, i) => {
    const need = block.rowShowWhen?.[i] ?? null;
    return need === null || supplied(facts, need);
  });
}

/**
 * Names of the optional owner inputs that are hiding something on this page right now, one per missing fact, in reading order.
 * LegalDocument prints each as an invisible <template data-owner-hidden="name"> so scripts/check-placeholders.ts can list what
 * is waiting for the owner (D-034).
 */
export function hiddenMarkers(doc: LegalDoc, facts: FactValues): string[] {
  const names: LegalFactName[] = [];
  const add = (n: LegalFactName | undefined | null) => {
    if (n && !supplied(facts, n) && !names.includes(n)) names.push(n);
  };
  for (const s of doc.sections) {
    if (!sectionVisible(s, facts)) {
      add(s.showWhen);
      for (const n of s.showWhenAny ?? []) add(n);
      continue;
    }
    for (const b of s.blocks) {
      add(b.showWhen);
      if (b.k === 'table') for (const n of b.rowShowWhen ?? []) add(n);
    }
  }
  return names.map(hiddenMarkerName);
}

/** The visible plain text of a run. A todo contributes nothing (it is the owner's placeholder, not our wording); a site field contributes its value if supplied. */
export function runText(r: readonly Inline[], facts?: LegalSiteFacts): string {
  return r
    .map((i) => {
      if (typeof i === 'string') return i;
      switch (i.t) {
        case 'todo':
          return '';
        case 'link':
          return i.text;
        case 'strong':
          return i.text;
        case 'fact':
          return '';
        case 'site':
          return facts ? (resolveSiteField(facts, i.field) ?? '') : '';
      }
    })
    .join('');
}

/** All wording written by us on the page (no Todo text, no site values): headings, paragraphs, list items, table captions, headers and cells. */
export function docWording(doc: LegalDoc): string[] {
  const out: string[] = [doc.title, doc.description, runText(doc.summary)];
  for (const s of allSections(doc)) {
    out.push(s.heading);
    for (const b of s.blocks) collectBlockWording(b, out);
  }
  return out.filter((t) => t !== '');
}

function collectBlockWording(b: Block, out: string[]): void {
  switch (b.k) {
    case 'p':
    case 'note':
      out.push(runText(b.c));
      break;
    case 'ul':
    case 'ol':
      for (const i of b.items) out.push(runText(i));
      break;
    case 'table':
      out.push(b.caption, ...b.head);
      for (const row of b.rows) for (const cell of row) out.push(runText(cell));
      break;
    case 'grievance':
    case 'routes':
      break;
  }
}

/** The `what` text of every explicit Todo written on the page (not the ones a missing site field will produce). */
export function docTodos(doc: LegalDoc): string[] {
  return docRuns(doc).flatMap((r) => r.flatMap((i) => (typeof i !== 'string' && i.t === 'todo' ? [i.what] : [])));
}

/** The Todo texts that appear when the named site facts are all missing (every `site` inline on the page). */
export function docSiteFieldTodos(doc: LegalDoc): string[] {
  return docRuns(doc).flatMap((r) => r.flatMap((i) => (typeof i !== 'string' && i.t === 'site' ? [i.todo] : [])));
}

/** Every static link on the page. */
export function docLinks(doc: LegalDoc): { href: string; text: string }[] {
  return docRuns(doc).flatMap((r) =>
    r.flatMap((i) => (typeof i !== 'string' && i.t === 'link' ? [{ href: i.href, text: i.text }] : [])),
  );
}

/** Headings in reading order: H1 is the title, H2 the sections, H3 the subsections. */
export function docHeadings(doc: LegalDoc): { level: 1 | 2 | 3; id: string | null; text: string }[] {
  const out: { level: 1 | 2 | 3; id: string | null; text: string }[] = [{ level: 1, id: null, text: doc.title }];
  for (const s of doc.sections) {
    out.push({ level: 2, id: s.id, text: s.heading });
    for (const sub of s.subsections ?? []) out.push({ level: 3, id: sub.id, text: sub.heading });
  }
  return out;
}
