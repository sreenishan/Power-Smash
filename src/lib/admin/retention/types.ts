// Keep-for periods in the admin (migration 0025, D-028, D-127): the owner types how long closed registrations and unconfirmed or
// unsubscribed email sign-ups are kept. Both start EMPTY (null = never remove); the lawyer decides the numbers, so nothing here
// suggests one. There is no "run now": the job runs only from .github/workflows/retention.yml; the summary's dueNow is the preview.
import type { RetentionRun, RetentionSettings } from '../../retention/platform';
import type { Actor, StoreResult } from '../types';

export interface RetentionSummaryDto extends RetentionSettings {
  /** When the periods were last saved (an instant), or null when unknown. */
  updatedAt: string | null;
  /** What a clean-up now would do (a dry run; counts only). */
  dueNow: RetentionRun;
  /** How many hashes of deleted unsubscribed addresses are kept (a count, never a hash). */
  unsubscribeHashesKept: number;
}

export interface RetentionSaveInput extends RetentionSettings {
  reason: string;
}

export interface RetentionSaveResult extends RetentionSettings {
  /** Names of the settings that changed (empty = nothing changed). */
  fields: string[];
}

/** The store methods every AdminStore carries (memory, Supabase and HTTP stores). Owner only. */
export interface RetentionAdminStore {
  retentionSummary(actor: Actor): Promise<StoreResult<RetentionSummaryDto>>;
  retentionSave(actor: Actor, input: RetentionSaveInput): Promise<StoreResult<RetentionSaveResult>>;
}

/** The data layer under the service: the memory backend (tests, preview) or the 0025 owner RPCs. */
export interface RetentionBackend {
  /** The raw answer of admin_platform_retention_summary (checked by the service: counts only). */
  summary(actor: Actor): Promise<unknown>;
  save(actor: Actor, settings: RetentionSettings, reason: string): Promise<RetentionSaveResult>;
}

export class RetentionError extends Error {
  constructor(
    readonly code: 'INVALID' | 'FORBIDDEN' | 'BACKEND_ERROR',
    readonly detail?: string,
  ) {
    super(code);
  }
}
