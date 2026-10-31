// The keep-for periods admin actions (migration 0025, D-028, D-127), shared by the memory store (tests, preview) and the Supabase store
// (the Vercel admin function): both give it a RetentionBackend. The owner's input is checked here first with the shared rule
// (src/lib/retention/platform.ts checkPeriods: same limits as the SQL) so the owner gets one plain sentence; the 0025 RPC checks again
// and audits field names and the new numbers. The summary's dry run is read through parseRetentionRun, so only counts reach a screen.
import { checkPeriods, parseRetentionRun, toRpcRecord, type RetentionSettings } from '../../retention/platform';
import { failResult, okResult, type Actor, type AdminErrorCode, type StoreResult } from '../types';
import { RetentionError, type RetentionAdminStore, type RetentionBackend, type RetentionSaveResult, type RetentionSummaryDto } from './types';

const PASS_THROUGH: readonly AdminErrorCode[] = ['INVALID', 'FORBIDDEN', 'BACKEND_ERROR'];

function toFailure(e: unknown) {
  const code = (e as { code?: unknown })?.code;
  const detail = (e as { detail?: unknown })?.detail;
  if (e instanceof RetentionError || (typeof code === 'string' && (PASS_THROUGH as readonly string[]).includes(code))) {
    const c = code as AdminErrorCode;
    return typeof detail === 'string' && detail !== '' ? failResult(c, { form: detail }) : failResult(c);
  }
  return failResult('BACKEND_ERROR');
}

async function guard<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return toFailure(e);
  }
}

const isDays = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3650);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Reads the summary RPC's answer; anything unexpected is a BACKEND_ERROR (never shown as it is). */
export function parseRetentionSummary(json: unknown): RetentionSummaryDto {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new RetentionError('BACKEND_ERROR');
  const o = json as Record<string, unknown>;
  if (!isDays(o.registrationKeepDays) || !isDays(o.subscriberKeepDays) || typeof o.keepUnsubscribeHash !== 'boolean' || !isCount(o.unsubscribeHashesKept)) throw new RetentionError('BACKEND_ERROR');
  let dueNow;
  try {
    dueNow = parseRetentionRun(o.dueNow);
  } catch {
    throw new RetentionError('BACKEND_ERROR');
  }
  return {
    registrationKeepDays: o.registrationKeepDays,
    subscriberKeepDays: o.subscriberKeepDays,
    keepUnsubscribeHash: o.keepUnsubscribeHash,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    dueNow,
    unsubscribeHashesKept: o.unsubscribeHashesKept,
  };
}

export function createRetentionService(b: RetentionBackend): RetentionAdminStore {
  return {
    retentionSummary: (actor) => guard(async () => okResult(parseRetentionSummary(await b.summary(actor)))),

    retentionSave: (actor, input) =>
      guard(async () => {
        const checked = checkPeriods({ registrationKeepDays: input.registrationKeepDays, subscriberKeepDays: input.subscriberKeepDays });
        if (!checked.ok) return failResult('INVALID', { form: checked.problems.join(' ') });
        if (typeof input.keepUnsubscribeHash !== 'boolean') return failResult('INVALID', { form: 'Say yes or no to remembering removed unsubscribed addresses as a code.' });
        const reason = input.reason.trim();
        if (reason.length < 3 || reason.length > 500) return failResult('INVALID', { reason: 'Write a short reason (3 to 500 characters).' });
        return okResult<RetentionSaveResult>(await b.save(actor, { ...checked.value, keepUnsubscribeHash: input.keepUnsubscribeHash }, reason));
      }),
  };
}

// ------------------------------------------------------------------------------------------------------------------ memory backend

export interface MemoryRetentionAudit {
  actor: string;
  action: 'set_platform_retention';
  /** Field names and the new values only. */
  diff: Record<string, unknown>;
  reason: string;
}

export interface MemoryRetentionOptions {
  /** Default: any actor whose role is 'owner'. */
  isOwner?: (actor: Actor) => boolean;
  audit?: (entry: MemoryRetentionAudit) => void;
  now?: () => Date;
}

/**
 * In-memory RetentionBackend for tests and the no-backend admin preview. Both periods start EMPTY (never remove), as in the database;
 * the preview has no registrations or sign-ups old enough to be due, so every count is 0.
 */
export function createMemoryRetentionBackend(opts: MemoryRetentionOptions = {}): RetentionBackend & { periods: RetentionSettings } {
  const isOwner = opts.isOwner ?? ((a: Actor) => a.role === 'owner');
  const now = opts.now ?? (() => new Date());
  const state: { periods: RetentionSettings; updatedAt: string } = { periods: { registrationKeepDays: null, subscriberKeepDays: null, keepUnsubscribeHash: false }, updatedAt: now().toISOString() };
  const forbidden = (): never => {
    throw new RetentionError('FORBIDDEN');
  };
  return {
    get periods() {
      return { ...state.periods };
    },
    summary: async (actor) => {
      if (!isOwner(actor)) forbidden();
      const p = state.periods;
      return {
        registrationKeepDays: p.registrationKeepDays,
        subscriberKeepDays: p.subscriberKeepDays,
        keepUnsubscribeHash: p.keepUnsubscribeHash,
        updatedAt: state.updatedAt,
        dueNow: {
          dry_run: true,
          registration_keep_days: p.registrationKeepDays,
          subscriber_keep_days: p.subscriberKeepDays,
          registrations_anonymised: 0,
          registrations_deleted: 0,
          registrations_without_event_date: 0,
          subscribers_unconfirmed_deleted: 0,
          subscribers_unsubscribed_deleted: 0,
          unsubscribe_hashes_kept: 0,
          outbox_rows_removed: 0,
        },
        unsubscribeHashesKept: 0,
      };
    },
    save: async (actor, periods, reason) => {
      if (!isOwner(actor)) forbidden();
      const fields: string[] = [];
      if (state.periods.registrationKeepDays !== periods.registrationKeepDays) fields.push('registrationKeepDays');
      if (state.periods.subscriberKeepDays !== periods.subscriberKeepDays) fields.push('subscriberKeepDays');
      if (state.periods.keepUnsubscribeHash !== periods.keepUnsubscribeHash) fields.push('keepUnsubscribeHash');
      if (fields.length > 0) {
        state.periods = { ...periods };
        state.updatedAt = now().toISOString();
        opts.audit?.({ actor: actor.userId, action: 'set_platform_retention', diff: { fields, registration_keep_days: periods.registrationKeepDays, subscriber_keep_days: periods.subscriberKeepDays, keep_unsubscribe_hash: periods.keepUnsubscribeHash }, reason });
      }
      return { ...state.periods, fields };
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------ Supabase backend

export interface SupabaseRetentionDeps {
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
}

/** The 0025 owner RPCs with the VERIFIED actor id as p_actor (the Vercel admin function only; service_role). */
export function createSupabaseRetentionBackend(deps: SupabaseRetentionDeps): RetentionBackend {
  return {
    summary: (a) => deps.rpc<unknown>('admin_platform_retention_summary', { p_actor: a.userId }),
    save: async (a, periods, reason) => {
      const r = await deps.rpc<Record<string, unknown>>('admin_set_platform_retention', {
        p_actor: a.userId,
        p_record: toRpcRecord(periods),
        p_reason: reason,
      });
      if (!isDays(r?.registrationKeepDays) || !isDays(r?.subscriberKeepDays) || typeof r?.keepUnsubscribeHash !== 'boolean' || !Array.isArray(r?.fields)) throw new RetentionError('BACKEND_ERROR');
      return {
        registrationKeepDays: r.registrationKeepDays,
        subscriberKeepDays: r.subscriberKeepDays,
        keepUnsubscribeHash: r.keepUnsubscribeHash,
        fields: (r.fields as unknown[]).filter((f): f is string => f === 'registrationKeepDays' || f === 'subscriberKeepDays' || f === 'keepUnsubscribeHash'),
      };
    },
  };
}
