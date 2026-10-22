/**
 * Fixture loaders for the parser tests. Fixture files are PRIVATE (real players' names,
 * possibly minors): they are read from disk here and never copied anywhere else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParseContext } from '../../../src/lib/parser/types';

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export function readFixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

export function readFixtureJson<T>(name: string): T {
  return JSON.parse(readFixtureText(name)) as T;
}

/** One entry of titles.proposed.json (the audit's compact form). */
export type ProposedFixture = {
  id: string;
  input: string;
  origin: 'real-from-spec' | 'synthetic';
  expected: string;
  why: string;
  note?: string;
};

export type ExpectedRelation = { type: 'same_match_key' | 'same_series_key'; with: string };

/** One entry of expected.proposed.json (the machine-checkable form). */
export type ExpectedEntry = {
  id: string;
  index: number;
  origin: 'real-from-spec' | 'synthetic';
  input: string;
  context?: ParseContext;
  /** Partial ParseResult, compared as a subset (see helpers/compare.ts). */
  expected: Record<string, unknown>;
  decision_pending?: string;
  /** Paths excluded from comparison; '*' excludes everything (the whole expectation is pending). */
  pending_fields?: string[];
  relations?: ExpectedRelation[];
  note?: string;
  review_basis: 'stated_in_audit' | 'derived_from_PC-03' | 'not_applicable_non_match';
};

export type ExpectedFile = {
  schema_version: number;
  description: string;
  source: string;
  scoring: { start: number; review_threshold_points: number; hard_flag_penalty_points: number; rule: string };
  entries: ExpectedEntry[];
};

export const proposedFixtures = (): ProposedFixture[] => readFixtureJson<ProposedFixture[]>('titles.proposed.json');
export const expectedFile = (): ExpectedFile => readFixtureJson<ExpectedFile>('expected.proposed.json');
export const realTitles = (): string[] => readFixtureJson<string[]>('real-titles.raw.json');
