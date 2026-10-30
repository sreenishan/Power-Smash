// The zod schemas of the account actions (the integrator adds them to SCHEMAS in handler.ts). Generous bounds and exact shapes here;
// the plain-English rules are rules.ts (shared with the form) and the SQL (0019).
import { z } from 'zod';
import { DISPLAY_NAME_MAX, EMAIL_MAX, REASON_MAX, REASON_MIN, TOURNAMENTS_MAX } from './rules';
import type { AccountActionName } from './access';

const uuid = z.uuid();
const reason = z.string().trim().min(REASON_MIN).max(REASON_MAX);

export const ACCOUNT_SCHEMAS = {
  'accounts.list': z.object({}).strict(),
  'accounts.invite': z
    .object({
      email: z.string().trim().min(3).max(EMAIL_MAX),
      role: z.enum(['organizer', 'scorer']),
      displayName: z.string().max(DISPLAY_NAME_MAX + 20),
      tournamentIds: z.array(uuid).min(1).max(TOURNAMENTS_MAX),
      reason,
    })
    .strict(),
  'accounts.assign': z.object({ profileId: uuid, tournamentId: uuid, reason }).strict(),
  'accounts.revokeAssignment': z.object({ assignmentId: uuid, reason }).strict(),
  'accounts.disable': z.object({ profileId: uuid, reason }).strict(),
  'accounts.setAccess': z.object({ enabled: z.boolean(), reason }).strict(),
} as const satisfies Record<AccountActionName, z.ZodType>;
