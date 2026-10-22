// View-model helpers: turn the content model plus the owner-supplied facts into plain data the Astro components print.
// Pure and tested (tests/legal/view.test.ts). A missing owner fact becomes a `todo` node, never a made-up value.
import { formatDate, isIsoDate } from '../../lib/dates';
import { path } from '../../lib/urls';
import type { LegalFacts } from './facts';
import { resolveSiteField, type Inline, type LegalSiteFacts } from './model';
import { grievanceRows, mailHref, telHref } from './routes';

export type InlineNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'todo'; readonly what: string }
  | { readonly kind: 'link'; readonly href: string; readonly text: string; readonly external: boolean }
  | { readonly kind: 'email'; readonly address: string; readonly href: string }
  | { readonly kind: 'phone'; readonly display: string; readonly href: string }
  | { readonly kind: 'address'; readonly text: string };

const isExternal = (href: string): boolean => /^https?:\/\//i.test(href);

function siteNode(facts: LegalSiteFacts, i: Extract<Inline, { t: 'site' }>): InlineNode {
  const value = resolveSiteField(facts, i.field);
  if (value === null) return { kind: 'todo', what: i.todo };
  if (i.field === 'publicEmail' || i.field === 'grievanceEmail') {
    const href = mailHref(value);
    return href ? { kind: 'email', address: value, href } : { kind: 'todo', what: i.todo };
  }
  if (i.field === 'phone' || i.field === 'grievanceOfficerPhone') {
    const href = telHref(value);
    return href ? { kind: 'phone', display: value, href } : { kind: 'todo', what: i.todo };
  }
  if (i.field === 'postalAddress') return { kind: 'address', text: value };
  return { kind: 'text', text: value };
}

export function inlineNodes(items: readonly Inline[], facts: LegalSiteFacts, legalFacts: LegalFacts): InlineNode[] {
  return items.map((i): InlineNode => {
    if (typeof i === 'string') return { kind: 'text', text: i };
    switch (i.t) {
      case 'todo':
        return { kind: 'todo', what: i.what };
      case 'strong':
        return { kind: 'strong', text: i.text };
      case 'link':
        // Internal links go through the one URL helper (R-LINKS: "/privacy" is written "/privacy/"); external links stay as written.
        return { kind: 'link', href: isExternal(i.href) ? i.href : path(i.href), text: i.text, external: isExternal(i.href) };
      case 'site':
        return siteNode(facts, i);
      case 'fact': {
        const v = legalFacts[i.name];
        return { kind: 'text', text: v ? (isIsoDate(v) ? formatDate(v) : v) : '' };
      }
    }
  });
}

export interface GrievanceItem {
  readonly label: string;
  readonly node: InlineNode;
}

/** The grievance-officer block as label and value nodes (a missing value is a Todo node). */
export function grievanceItems(facts: LegalSiteFacts): GrievanceItem[] {
  return grievanceRows(facts).map((r): GrievanceItem => {
    if (r.value === null) return { label: r.label, node: { kind: 'todo', what: r.todo } };
    if (r.kind === 'email') {
      const href = mailHref(r.value);
      return { label: r.label, node: href ? { kind: 'email', address: r.value, href } : { kind: 'todo', what: r.todo } };
    }
    if (r.kind === 'phone') {
      const href = telHref(r.value);
      return { label: r.label, node: href ? { kind: 'phone', display: r.value, href } : { kind: 'todo', what: r.todo } };
    }
    if (r.kind === 'address') return { label: r.label, node: { kind: 'address', text: r.value } };
    return { label: r.label, node: { kind: 'text', text: r.value } };
  });
}
