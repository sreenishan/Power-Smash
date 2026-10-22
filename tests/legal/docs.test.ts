import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { legalLinks } from '../../src/components/site/nav';
import { buildLegalDocs, legalDocs } from '../../src/content/legal';
import { lastUpdated } from '../../src/content/legal/meta';
import { allSections, docHeadings, docWording, type LegalDoc } from '../../src/content/legal/model';
import { isIsoDate } from '../../src/lib/dates';
import { path } from '../../src/lib/urls';
import { ALL_ON, ALL_OFF, DOC_ENTRIES, ROOT, entriesFor, readRepoFile } from './helpers';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

describe('legal page registry', () => {
  it('has exactly the six pages the spec requires (spec 15.1)', () => {
    expect(Object.keys(legalDocs).sort()).toEqual(['contentRemoval', 'delivery', 'disclosures', 'privacy', 'refunds', 'terms']);
  });

  it.each(DOC_ENTRIES)('%s: key, path and page file agree', (key, doc) => {
    expect(doc.key).toBe(key);
    expect(doc.path).toMatch(/^\/[a-z-]+$/);
    const file = `src/pages${doc.path}.astro`;
    expect(existsSync(`${ROOT}${file}`), `${file} must exist`).toBe(true);
  });

  it('uses unique paths', () => {
    const paths = DOC_ENTRIES.map(([, d]) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('is linked from the footer (nav.ts legalLinks), in the one URL form of R-LINKS (trailing slash)', () => {
    const footerPaths = legalLinks.map((l) => l.href);
    for (const [, doc] of DOC_ENTRIES) expect(footerPaths).toContain(path(doc.path));
  });

  it('has a real ISO "last updated" date', () => {
    expect(isIsoDate(lastUpdated)).toBe(true);
  });
});

describe('page files', () => {
  it.each(DOC_ENTRIES)('%s: the page file renders its doc through LegalDocument inside BaseLayout', (key, doc) => {
    const src = readRepoFile(`src/pages${doc.path}.astro`);
    expect(src).toContain("import BaseLayout from '../layouts/BaseLayout.astro'");
    expect(src).toContain("import LegalDocument from '../components/legal/LegalDocument.astro'");
    expect(src).toMatch(/<LegalDocument doc=\{\w+Doc\} \/>/);
    expect(src).toContain(`from '../content/legal/${key}'`);
    expect(src).toContain('title={');
    expect(src).not.toMatch(/set:html|dangerouslySetInnerHTML/);
  });

  it('LegalDocument always renders the draft notice for its page', () => {
    const src = readRepoFile('src/components/legal/LegalDocument.astro');
    expect(src).toContain('<LegalDraftNotice page={doc.key} />');
    expect(src).toContain('lastUpdated');
    expect(src).not.toMatch(/set:html|dangerouslySetInnerHTML/);
  });

  it('no legal component injects raw HTML', () => {
    for (const f of ['GrievanceOfficer', 'LegalBlock', 'LegalDocument', 'LegalDraftNotice', 'LegalInline', 'LegalNode']) {
      expect(readRepoFile(`src/components/legal/${f}.astro`)).not.toMatch(/set:html|dangerouslySetInnerHTML|innerHTML/);
    }
  });
});

function checkDoc(doc: LegalDoc) {
  const headings = docHeadings(doc);
  return { headings, sections: allSections(doc) };
}

// The structure rules hold for the page as rendered now, with every later feature off, and with every later feature on.
const STRUCTURE_ENTRIES: [string, LegalDoc][] = [
  ...DOC_ENTRIES.map(([k, d]): [string, LegalDoc] => [`${k} (now)`, d]),
  ...entriesFor(ALL_OFF).map(([k, d]): [string, LegalDoc] => [`${k} (all later features off)`, d]),
  ...entriesFor(ALL_ON).map(([k, d]): [string, LegalDoc] => [`${k} (all later features on)`, d]),
];

describe.each(STRUCTURE_ENTRIES)('%s: structure', (_key, doc) => {
  it('has a title, a meta description and an "in short" summary', () => {
    expect(doc.title.trim()).not.toBe('');
    expect(doc.description.length).toBeGreaterThanOrEqual(40);
    expect(doc.description.length).toBeLessThanOrEqual(220);
    expect(doc.summary.length).toBeGreaterThan(0);
  });

  it('has exactly one H1 and headings in order (no skipped level)', () => {
    const { headings } = checkDoc(doc);
    expect(headings[0]).toMatchObject({ level: 1, text: doc.title });
    expect(headings.filter((h) => h.level === 1)).toHaveLength(1);
    for (let i = 1; i < headings.length; i++) {
      const jump = headings[i]!.level - headings[i - 1]!.level;
      expect(jump, `heading "${headings[i]!.text}" skips a level`).toBeLessThanOrEqual(1);
    }
    // an H3 may only follow an H2 or another H3
    expect(headings[1]?.level).toBe(2);
  });

  it('has unique, kebab-case section ids and unique, plain-English headings', () => {
    const { sections } = checkDoc(doc);
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(KEBAB);
      expect(id).not.toBe('main');
    }
    const texts = sections.map((s) => s.heading);
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) {
      expect(t.trim()).not.toBe('');
      expect(t.length).toBeLessThanOrEqual(80);
      expect(t).not.toMatch(/[:;]$/);
    }
  });

  it('has at least three sections, each with content', () => {
    expect(doc.sections.length).toBeGreaterThanOrEqual(3);
    for (const s of allSections(doc)) expect(s.blocks.length, `section ${s.id} is empty`).toBeGreaterThan(0);
  });

  it('has well-formed lists and tables', () => {
    for (const s of allSections(doc)) {
      for (const b of s.blocks) {
        if (b.k === 'ul' || b.k === 'ol') {
          expect(b.items.length).toBeGreaterThan(0);
          for (const item of b.items) expect(item.length).toBeGreaterThan(0);
        }
        if (b.k === 'table') {
          expect(b.caption.trim()).not.toBe('');
          expect(b.head.length).toBeGreaterThanOrEqual(2);
          expect(b.rows.length).toBeGreaterThan(0);
          for (const row of b.rows) {
            expect(row.length, `table "${b.caption}" has a ragged row`).toBe(b.head.length);
            for (const cell of row) expect(cell.length).toBeGreaterThan(0);
          }
        }
        if (b.k === 'p' || b.k === 'note') expect(b.c.length).toBeGreaterThan(0);
      }
    }
  });

  it('wording is plain: no long unbroken paragraphs, no jargon placeholders', () => {
    for (const text of docWording(doc)) {
      expect(text.length, `a single block is very long: "${text.slice(0, 60)}..."`).toBeLessThanOrEqual(900);
      expect(text).not.toMatch(/lorem ipsum|\bxxx\b|\btbd\b|\bfixme\b|\[\s*\]|\{\{|\}\}/i);
    }
  });
});

describe('required content (what the page says at G1, with every later feature off)', () => {
  const m1 = buildLegalDocs(ALL_OFF);

  it('Privacy Policy covers the children and takedown handling that is true at G1', () => {
    const text = docWording(m1.privacy).join('\n');
    expect(text).toMatch(/for adults/i);
    expect(text).toMatch(/parent or guardian/i);
    expect(text).toMatch(/We aim to act within 48 hours/);
  });

  it('Privacy Policy states the retention rules of spec 15.4 that apply at G1 (closed leads)', () => {
    const text = docWording(m1.privacy).join('\n');
    expect(text).toMatch(/24 months/);
    expect(text).toMatch(/anonymise/);
  });

  it('Delivery Policy has a shipping section (it doubles as the gateway shipping page)', () => {
    expect(allSections(legalDocs.delivery).map((s) => s.id)).toContain('shipping');
  });

  it('Disclosures says paid connections are disclosed in the video or live stream itself, and points to the ASCI guidelines (spec 15.5)', () => {
    const text = docWording(m1.disclosures).join('\n');
    expect(text).toMatch(/in the video or live stream itself, out loud and on screen/);
    expect(text).toMatch(/Includes paid promotion/);
    expect(text).toMatch(/not rely only on/);
    expect(text).toMatch(/Advertising Standards Council of India/);
  });

  it('Content Removal has the minors fast path and the response-target table (D-014)', () => {
    const text = docWording(m1.contentRemoval).join('\n');
    expect(text).toMatch(/Hide first, then verify/);
    expect(text).toMatch(/not a guarantee/);
    expect(text).toMatch(/Act within 48 hours/);
  });

  it('every page points the reader at the seller and grievance-officer details (D-037)', () => {
    for (const [key, doc] of DOC_ENTRIES) {
      const hasBlock = allSections(doc).some((s) => s.blocks.some((b) => b.k === 'grievance'));
      expect(hasBlock, `${key} has no grievance block`).toBe(true);
    }
  });
});

describe('required content once the later features are on (the statements the YouTube policies and D-012 need)', () => {
  const all = buildLegalDocs(ALL_ON);

  it('Privacy Policy names the YouTube API Services statement with both required links (Developer Policies III.A.2)', () => {
    const text = docWording(all.privacy).join('\n');
    expect(text).toMatch(/uses YouTube API Services/);
    expect(text).toMatch(/agree to be bound by the YouTube Terms of Service/);
    expect(text).toMatch(/Google Privacy Policy/);
  });

  it('Terms of Use says users agree to be bound by the YouTube Terms of Service (Developer Policies III.A.1)', () => {
    expect(docWording(all.terms).join('\n')).toMatch(/agree to be bound by the YouTube Terms of Service/);
  });

  it('Privacy Policy covers the children and protected-player handling of D-012', () => {
    const text = docWording(all.privacy).join('\n');
    for (const needle of ['do not create a profile page', 'asks? search engines not to index', 'no sponsor banner', 'parent or guardian']) {
      expect(text).toMatch(new RegExp(needle, 'i'));
    }
  });

  it('Privacy Policy states the 30-day event-document rule of spec 15.4', () => {
    expect(docWording(all.privacy).join('\n')).toMatch(/Event documents are deleted 30 days after the event/);
  });

  it('Content Removal has the protected-player fast path (D-012, D-014)', () => {
    expect(docWording(all.contentRemoval).join('\n')).toMatch(/hide the name or page as soon as we receive it/);
  });

  it('Disclosures has the Match details label sentence (D-016 item 3)', () => {
    expect(docWording(all.disclosures).join('\n')).toMatch(/Match details by Power Smash/);
  });
});
