// zod schemas of the two retention admin actions (migration 0025). The integrator adds them to the action table in
// src/lib/admin/handler.ts and to src/lib/admin/policy.ts (owner only, aal2); see docs/m5/integration/retention.md. The limits come from
// KEEP_DAYS_LIMITS (the same numbers as the SQL); null = never remove, and there is no default.
import { z } from 'zod';
import { KEEP_DAYS_LIMITS } from './platform';

const reason = z.string().trim().min(3).max(500);
const days = (field: keyof typeof KEEP_DAYS_LIMITS) => z.number().int().min(KEEP_DAYS_LIMITS[field].min).max(KEEP_DAYS_LIMITS[field].max).nullable();

export const RETENTION_ACTION_SCHEMAS = {
  /** read: the two periods and what a run now would remove (counts only). RPC admin_platform_retention_summary(p_actor). */
  'retention.summary': z.object({}).strict(),
  /** write: RPC admin_set_platform_retention(p_actor, {registrationKeepDays, subscriberKeepDays, keepUnsubscribeHash}, p_reason). */
  'retention.save': z
    .object({ registrationKeepDays: days('registrationKeepDays'), subscriberKeepDays: days('subscriberKeepDays'), keepUnsubscribeHash: z.boolean(), reason })
    .strict(),
} as const;

export const RETENTION_ACTION_KINDS = {
  'retention.summary': 'read',
  'retention.save': 'write',
} as const satisfies Record<keyof typeof RETENTION_ACTION_SCHEMAS, 'read' | 'write'>;

/** The RPC names, for supabase-store.ts's list of RPCs whose INVALID sentences reach the owner as they are. */
export const RETENTION_RPCS = ['admin_platform_retention_summary', 'admin_set_platform_retention'] as const;
