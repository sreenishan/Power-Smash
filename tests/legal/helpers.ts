// Shared helpers for the legal tests. No network, no Astro: the pages are data (src/content/legal/*.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLegalDocs, legalDocs } from '../../src/content/legal';
import type { LegalDoc, LegalSiteFacts } from '../../src/content/legal/model';
import { FEATURE_NAMES, type FeatureName, type LegalFeatures, type LegalPageKey } from '../../src/content/legal/status';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function readRepoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
}

export const DOC_ENTRIES = Object.entries(legalDocs) as [LegalPageKey, LegalDoc][];

// ---- feature flags (review finding C-11) -----------------------------------------------------------------------------
/** Every flag off: exactly what a build without any later feature says. */
export const ALL_OFF = Object.fromEntries(FEATURE_NAMES.map((n) => [n, false])) as unknown as LegalFeatures;
/** Every flag on: the widest wording the pages can ever show. */
export const ALL_ON = Object.fromEntries(FEATURE_NAMES.map((n) => [n, true])) as unknown as LegalFeatures;
/** Only one flag on. */
export const only = (flag: FeatureName): LegalFeatures => ({ ...ALL_OFF, [flag]: true });
/** The six pages for a set of flags, as [key, doc] pairs. */
export const entriesFor = (f: LegalFeatures): [LegalPageKey, LegalDoc][] => Object.entries(buildLegalDocs(f)) as [LegalPageKey, LegalDoc][];

/** What the Site-shell's `site` object looks like before the owner has supplied anything. */
export const NO_FACTS: LegalSiteFacts = {
  legalName: null,
  postalAddress: null,
  phone: null,
  publicEmail: null,
  grievanceOfficerName: null,
  grievanceEmail: null,
  whatsappNumber: null,
};

/** Obviously fake values for tests only (never real contact details). */
export const FAKE_FACTS: LegalSiteFacts = {
  legalName: 'Example Legal Name',
  postalAddress: '1 Example Road\nExample City',
  phone: '+91 00000 00000',
  publicEmail: 'hello@example.invalid',
  grievanceOfficerName: 'Example Officer',
  grievanceEmail: 'grievance@example.invalid',
  grievanceOfficerPhone: '+91 11111 11111',
  whatsappNumber: '910000000000',
};

// ---- numeric patterns -------------------------------------------------------------------------------------------------
export const CURRENCY = /₹|\bRs\.?(?=[\s\d])|\bINR\b|\bUSD\b|\d[\d,.]*\s*(?:rupees?|rs)\b|\$/i; // the bare word \"rupees\" is fine; an amount is not
export const PERCENT = /%|\bper\s?cent\b|\bpercent(age)?\b/i;
const NUMBER_WORD =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|sixty|ninety|hundred|half)';
const UNIT = '(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)';
/** A number (digits or a number word, or "a"/"an") followed by a unit of time: a timeline. */
export const DURATION = new RegExp(
  `(?:\\b\\d+(?:[.,]\\d+)?|\\b${NUMBER_WORD}|\\b(?:a|an))[ -]+(?:business[ -]+|working[ -]+|calendar[ -]+)?${UNIT}\\b`,
  'gi',
);

/** Every timeline phrase in a piece of text, lower-cased with single spaces. */
export function durationsIn(text: string): string[] {
  return [...text.matchAll(DURATION)].map((m) => m[0].toLowerCase().replace(/[ -]+/g, ' '));
}
