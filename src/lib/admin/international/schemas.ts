// zod schemas of the international events admin actions (D-112). The integrator adds them to the action table in
// src/lib/admin/handler.ts and the policy in src/lib/admin/policy.ts (owner only, aal2). Generous bounds: the exact rules (with plain
// English refusals) are in src/lib/international/link-rules.ts, applied by the service, and again in the 0022 SQL.
import { z } from 'zod';

const uuid = z.uuid();
const reason = z.string().trim().min(3).max(500);
const revision = z.number().int().min(1).max(1_000_000_000);

export const INTERNATIONAL_ACTION_SCHEMAS = {
  'international.list': z.object({}).strict(),
  'international.save': z
    .object({
      id: uuid.nullable(),
      expectedRevision: revision.nullable(),
      name: z.string().max(200),
      levelText: z.string().max(120),
      startDate: z.string().max(10),
      endDate: z.string().max(10),
      city: z.string().max(100),
      country: z.string().max(100),
      officialUrl: z.string().max(600),
      published: z.boolean(),
      reason,
    })
    .strict(),
  'international.setPublished': z.object({ id: uuid, published: z.boolean(), expectedRevision: revision, reason }).strict(),
  'international.saveHosts': z.object({ hosts: z.array(z.string().max(300)).max(40), reason }).strict(),
} as const;

export type InternationalActionName = keyof typeof INTERNATIONAL_ACTION_SCHEMAS;
export const INTERNATIONAL_ACTION_NAMES = Object.keys(INTERNATIONAL_ACTION_SCHEMAS) as InternationalActionName[];

/** read or write, for the integrator's policy table (every one owner only). */
export const INTERNATIONAL_ACTION_KINDS: Record<InternationalActionName, 'read' | 'write'> = {
  'international.list': 'read',
  'international.save': 'write',
  'international.setPublished': 'write',
  'international.saveHosts': 'write',
};

/** The owner RPCs of migration 0022, for COMPETITION_DETAIL_RPCS in supabase-store.ts (their INVALID sentences reach the owner). */
export const INTERNATIONAL_RPCS = ['admin_save_international_event', 'admin_set_international_event_published', 'admin_set_international_hosts'] as const;
