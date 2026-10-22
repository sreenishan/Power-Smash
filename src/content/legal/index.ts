// Registry of the six legal pages. The tests walk `legalDocs`.
import { buildContentRemovalDoc, contentRemovalDoc } from './contentRemoval';
import { buildDeliveryDoc, deliveryDoc } from './delivery';
import { buildDisclosuresDoc, disclosuresDoc } from './disclosures';
import type { LegalDoc } from './model';
import { buildPrivacyDoc, privacyDoc } from './privacy';
import { buildRefundsDoc, refundsDoc } from './refunds';
import { buildTermsDoc, termsDoc } from './terms';
import { features, type LegalFeatures, type LegalPageKey } from './status';
import type { LegalFacts } from './facts';
import { legalFacts } from './facts';

/** The six pages as rendered NOW: the wording for every feature whose flag in status.ts is still false is left out (finding C-11). */
export const legalDocs: Record<LegalPageKey, LegalDoc> = {
  privacy: privacyDoc,
  terms: termsDoc,
  refunds: refundsDoc,
  delivery: deliveryDoc,
  disclosures: disclosuresDoc,
  contentRemoval: contentRemovalDoc,
};

/** The six pages for any set of flags and facts (tests use this to switch a feature on or off). */
export function buildLegalDocs(f: LegalFeatures = features, facts: LegalFacts = legalFacts): Record<LegalPageKey, LegalDoc> {
  return {
    privacy: buildPrivacyDoc(f, facts),
    terms: buildTermsDoc(f),
    refunds: buildRefundsDoc(),
    delivery: buildDeliveryDoc(),
    disclosures: buildDisclosuresDoc(f),
    contentRemoval: buildContentRemovalDoc(f),
  };
}

// The footer's legal links live in src/components/site/nav.ts (Site-shell worker); tests/legal/docs.test.ts checks they match these pages.

export { lastUpdated } from './meta';
export type { LegalDoc, LegalSection, Block, Inline } from './model';
export type { LegalPageKey } from './status';
