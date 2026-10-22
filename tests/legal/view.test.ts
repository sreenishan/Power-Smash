import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { legalDocs } from '../../src/content/legal';
import { LEGAL_FACT_NAMES, hiddenMarkerName, legalFacts, type LegalFacts } from '../../src/content/legal/facts';
import {
  docRuns,
  docSiteFieldTodos,
  docTodos,
  field,
  hiddenMarkers,
  resolveSiteField,
  runText,
  visibleBlocks,
  visibleRows,
  visibleSections,
  type Block,
  type LegalSiteFacts,
} from '../../src/content/legal/model';
import { REMOVAL_WHATSAPP_PREFILL, grievanceRows, mailHref, resolveContactRoutes, telHref } from '../../src/content/legal/routes';
import { grievanceItems, inlineNodes } from '../../src/content/legal/view';
import { site } from '../../src/content/site';
import { waLink } from '../../src/lib/whatsapp';
import { DOC_ENTRIES, FAKE_FACTS, NO_FACTS } from './helpers';

const NO_LEGAL: LegalFacts = {
  removalFormPath: null,
  darkPatternSelfAuditDate: null,
  travelPolicy: null,
  liveStreamVenueNeeds: null,
  rightsDisputeTarget: null,
  supabaseRegion: null,
  resendRegion: null,
};

describe('owner facts: a missing value is a Todo, never a made-up value', () => {
  it('every site field on every page becomes a todo node when the owner has supplied nothing', () => {
    for (const [, doc] of DOC_ENTRIES) {
      for (const r of docRuns(doc)) {
        for (const n of inlineNodes(r, NO_FACTS, NO_LEGAL)) {
          if (n.kind === 'todo') expect(n.what.trim()).not.toBe('');
          expect(n.kind === 'email' || n.kind === 'phone' || n.kind === 'address').toBe(false);
        }
      }
    }
  });

  it('the Privacy Policy cannot be published without the legal name and postal address (both are Todos until supplied)', () => {
    const todos = docSiteFieldTodos(legalDocs.privacy);
    expect(todos).toContain('legal name of the business (OT-19)');
    expect(todos).toContain('postal address to publish (OT-19)');
  });

  it('supplied values replace the Todo', () => {
    const [name] = inlineNodes([field('legalName', 'x')], FAKE_FACTS, NO_LEGAL);
    expect(name).toEqual({ kind: 'text', text: 'Example Legal Name' });
    const [addr] = inlineNodes([field('postalAddress', 'x')], FAKE_FACTS, NO_LEGAL);
    expect(addr).toEqual({ kind: 'address', text: '1 Example Road\nExample City' });
    const [mail] = inlineNodes([field('publicEmail', 'x')], FAKE_FACTS, NO_LEGAL);
    expect(mail).toEqual({ kind: 'email', address: 'hello@example.invalid', href: 'mailto:hello@example.invalid' });
    const [phone] = inlineNodes([field('phone', 'x')], FAKE_FACTS, NO_LEGAL);
    expect(phone).toEqual({ kind: 'phone', display: '+91 00000 00000', href: 'tel:+910000000000' });
  });

  it('blank or whitespace-only values count as missing', () => {
    const blank: LegalSiteFacts = { ...NO_FACTS, legalName: '   ' };
    expect(resolveSiteField(blank, 'legalName')).toBeNull();
    expect(inlineNodes([field('legalName', 'name')], blank, NO_LEGAL)[0]).toEqual({ kind: 'todo', what: 'name' });
  });

  it('a malformed email or phone is treated as missing, not printed as a broken link', () => {
    const bad: LegalSiteFacts = { ...NO_FACTS, publicEmail: 'not an email', phone: '12' };
    expect(inlineNodes([field('publicEmail', 'mail')], bad, NO_LEGAL)[0]).toEqual({ kind: 'todo', what: 'mail' });
    expect(inlineNodes([field('phone', 'tel')], bad, NO_LEGAL)[0]).toEqual({ kind: 'todo', what: 'tel' });
  });

  it('runText leaves out Todos and unsupplied facts, so wording tests only see our own words', () => {
    expect(runText(['a ', { t: 'todo', what: 'secret todo' }, ' b'])).toBe('a  b');
    expect(runText(['for ', field('legalName', 'n')], FAKE_FACTS)).toBe('for Example Legal Name');
    expect(runText(['for ', field('legalName', 'n')])).toBe('for ');
  });

  it('docTodos lists only explicit Todos', () => {
    expect(docTodos(legalDocs.refunds).length).toBeGreaterThan(10);
    expect(docTodos(legalDocs.delivery).length).toBeGreaterThanOrEqual(3); // publish time, delivery time per product, time to report a problem
    for (const t of DOC_ENTRIES.flatMap(([, d]) => docTodos(d))) {
      expect(t).not.toContain('TODO(owner)'); // the Todo component adds that prefix; never write it by hand
      expect(t.trim()).not.toBe('');
    }
  });
});

describe('dates and facts', () => {
  it('a legal fact date is shown formatted in en-IN, Asia/Kolkata', () => {
    const [n] = inlineNodes([{ t: 'fact', name: 'darkPatternSelfAuditDate' }], NO_FACTS, { ...NO_LEGAL, darkPatternSelfAuditDate: '2027-01-02' });
    expect(n).toEqual({ kind: 'text', text: '2 January 2027' });
  });

  it('the self-audit section is hidden until its fact is supplied (hide-section rule)', () => {
    const hidden = visibleSections(legalDocs.disclosures, legalFacts).map((s) => s.id);
    expect(legalFacts.darkPatternSelfAuditDate).toBeNull();
    expect(hidden).not.toContain('self-audit');
    const shown = visibleSections(legalDocs.disclosures, { darkPatternSelfAuditDate: '2027-01-02' }).map((s) => s.id);
    expect(shown).toContain('self-audit');
  });
});

describe('contact helpers', () => {
  it('mailHref and telHref accept plausible values only', () => {
    expect(mailHref('a@b.co')).toBe('mailto:a@b.co');
    expect(mailHref('a@b')).toBeNull();
    expect(mailHref('a b@c.com')).toBeNull();
    expect(mailHref('a@b.com,c@d.com')).toBeNull();
    expect(mailHref('<script>@x.com')).toBeNull();
    expect(mailHref(null)).toBeNull();
    expect(telHref('+91 98765-43210')).toBe('tel:+919876543210');
    expect(telHref('123')).toBeNull();
    expect(telHref(null)).toBeNull();
  });

  it('with nothing supplied there is no route and nothing is invented', () => {
    const r = resolveContactRoutes(NO_FACTS, null);
    expect(r).toEqual({ whatsapp: null, email: null, phone: null, formPath: null, hasRoute: false });
  });

  it('WhatsApp comes only from waLink() (D-025) and carries no personal data', () => {
    const r = resolveContactRoutes(FAKE_FACTS, null);
    expect(r.whatsapp).toBe(waLink(FAKE_FACTS.whatsappNumber, REMOVAL_WHATSAPP_PREFILL));
    expect(r.whatsapp).toMatch(/^https:\/\/wa\.me\/910000000000\?text=/);
    expect(REMOVAL_WHATSAPP_PREFILL).not.toMatch(/\d{5,}|@/);
    expect(r.hasRoute).toBe(true);
    expect(r.email?.href).toBe('mailto:hello@example.invalid');
    expect(r.phone?.href).toBe('tel:+910000000000');
  });

  it('a phone alone is not a route for removal requests (it is only for urgent orders)', () => {
    const r = resolveContactRoutes({ ...NO_FACTS, phone: '+91 00000 00000' }, null);
    expect(r.phone).not.toBeNull();
    expect(r.hasRoute).toBe(false);
  });

  it('the online form shows only for a same-site path', () => {
    // written through the one URL helper (R-LINKS): trailing slash
    expect(resolveContactRoutes(NO_FACTS, '/content-removal/request').formPath).toBe('/content-removal/request/');
    expect(resolveContactRoutes(NO_FACTS, '//evil.example').formPath).toBeNull();
    expect(resolveContactRoutes(NO_FACTS, '/' + String.fromCharCode(92) + 'evil.example').formPath).toBeNull();
    expect(resolveContactRoutes(NO_FACTS, 'https://evil.example/x').formPath).toBeNull();
    expect(resolveContactRoutes(NO_FACTS, '/x').hasRoute).toBe(true);
  });

  it('the grievance block lists seller, officer and customer-care details; missing ones are Todos', () => {
    const empty = grievanceItems(NO_FACTS);
    expect(empty.map((i) => i.label)).toEqual(['Business name', 'Postal address', 'Grievance officer', 'Grievance email', 'Phone', 'General email']);
    expect(empty.every((i) => i.node.kind === 'todo')).toBe(true);
    const full = grievanceItems(FAKE_FACTS);
    expect(full.every((i) => i.node.kind !== 'todo')).toBe(true);
    // the grievance officer's own phone wins; otherwise the business phone is used
    expect(grievanceRows(FAKE_FACTS).find((r) => r.label === 'Phone')?.value).toBe('+91 11111 11111');
    expect(grievanceRows({ ...FAKE_FACTS, grievanceOfficerPhone: null }).find((r) => r.label === 'Phone')?.value).toBe('+91 00000 00000');
  });

  it('the real site.ts object is accepted by the legal pages (type and shape check) and nothing is invented', () => {
    const facts: LegalSiteFacts = site; // compile-time: site.ts must stay assignable
    // Before the owner supplies OT-19 these are all null. After that they may be real: only check the types here.
    for (const v of [facts.legalName, facts.postalAddress, facts.phone, facts.publicEmail, facts.grievanceOfficerName, facts.grievanceEmail]) {
      expect(v === null || typeof v === 'string').toBe(true);
    }
  });
});

describe('optional owner text is hidden, not a Todo (finding C-14, D-034)', () => {
  const table = (): Extract<Block, { k: 'table' }> => {
    const b = legalDocs.contentRemoval.sections.flatMap((x) => x.blocks).find((x) => x.k === 'table');
    if (!b || b.k !== 'table') throw new Error('no table on the Content Removal page');
    return b;
  };

  it('with nothing supplied the Delivery travel-and-venue section and the rights-dispute row are hidden', () => {
    expect(visibleSections(legalDocs.delivery, NO_LEGAL).map((s) => s.id)).not.toContain('travel-and-venue');
    expect(visibleRows(table(), NO_LEGAL)).toHaveLength(3);
  });

  it('a supplied travel policy shows only its own line; the venue line stays hidden', () => {
    const facts = { ...NO_LEGAL, travelPolicy: 'Travel is quoted per event.' };
    const sec = visibleSections(legalDocs.delivery, facts).find((s) => s.id === 'travel-and-venue');
    expect(sec).toBeDefined();
    const blocks = visibleBlocks(sec!.blocks, facts);
    expect(blocks).toHaveLength(1);
    const [n] = inlineNodes(blocks[0]!.k === 'p' ? blocks[0]!.c : [], NO_FACTS, facts).slice(-1);
    expect(n).toEqual({ kind: 'text', text: 'Travel is quoted per event.' });
  });

  it('a supplied live-stream need shows the section with that line only', () => {
    const facts = { ...NO_LEGAL, liveStreamVenueNeeds: 'Mains power and a wired internet point.' };
    const sec = visibleSections(legalDocs.delivery, facts).find((s) => s.id === 'travel-and-venue')!;
    expect(visibleBlocks(sec.blocks, facts)).toHaveLength(1);
  });

  it('a supplied rights-dispute target shows the fourth row with the owner text', () => {
    const facts = { ...NO_LEGAL, rightsDisputeTarget: 'We decide within the time agreed with our lawyer.' };
    const rows = visibleRows(table(), facts);
    expect(rows).toHaveLength(4);
    expect(inlineNodes(rows[3]![1]!, NO_FACTS, facts)).toEqual([{ kind: 'text', text: 'We decide within the time agreed with our lawyer.' }]);
  });

  it('a blank value counts as not supplied', () => {
    expect(visibleSections(legalDocs.delivery, { ...NO_LEGAL, travelPolicy: '   ' }).map((s) => s.id)).not.toContain('travel-and-venue');
  });

  it('hiddenMarkers lists one invisible marker per missing optional input, kebab-case, at most 40 characters, never duplicated', () => {
    const delivery = hiddenMarkers(legalDocs.delivery, NO_LEGAL);
    expect(delivery).toEqual(['legal-travel-policy', 'legal-live-stream-venue-needs']);
    expect(hiddenMarkers(legalDocs.contentRemoval, NO_LEGAL)).toEqual(['legal-rights-dispute-target']);
    expect(hiddenMarkers(legalDocs.disclosures, NO_LEGAL)).toEqual(['legal-dark-pattern-self-audit-date']);
    expect(hiddenMarkers(legalDocs.delivery, { ...NO_LEGAL, travelPolicy: 'x', liveStreamVenueNeeds: 'y' })).toEqual([]);
    for (const name of LEGAL_FACT_NAMES) {
      const m = hiddenMarkerName(name);
      expect(m).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
    }
  });

  it('no legal page asks for these optional items with a Todo any more', () => {
    for (const [, doc] of DOC_ENTRIES) {
      for (const t of docTodos(doc)) expect(t).not.toMatch(/travel policy|live stream|rights disputes?/i);
    }
  });

  it('the placeholder gate marker is printed by LegalDocument', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/components/legal/LegalDocument.astro', import.meta.url)), 'utf8');
    expect(src).toContain('data-owner-hidden={name}');
    expect(src).toContain('hiddenMarkers(doc, legalFacts)');
  });
});

describe('internal links go through the one URL helper (R-LINKS)', () => {
  it('"/privacy" is written "/privacy/", an anchor is kept, an external link is untouched', () => {
    const nodes = inlineNodes(
      [
        { t: 'link', href: '/privacy', text: 'Privacy Policy' },
        { t: 'link', href: '/services#players', text: 'Players' },
        { t: 'link', href: 'https://consumerhelpline.gov.in/', text: 'NCH' },
      ],
      NO_FACTS,
      NO_LEGAL,
    );
    expect(nodes).toEqual([
      { kind: 'link', href: '/privacy/', text: 'Privacy Policy', external: false },
      { kind: 'link', href: '/services/#players', text: 'Players', external: false },
      { kind: 'link', href: 'https://consumerhelpline.gov.in/', text: 'NCH', external: true },
    ]);
  });
});
