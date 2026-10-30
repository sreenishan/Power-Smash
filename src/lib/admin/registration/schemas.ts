// zod schemas of the registration admin actions (D-111). The integrator adds them to the action table in src/lib/admin/handler.ts
// (names below) and the policy in src/lib/admin/policy.ts (owner only, aal2). Generous bounds; the exact rules are in the service and
// the 0020 SQL. Money is integer paise; there is no default anywhere.
import { z } from 'zod';

const uuid = z.uuid();
const reason = z.string().trim().min(3).max(500);
const revision = z.number().int().min(1).max(1_000_000_000);
const paise = (min: number) => z.number().int().min(min).max(100_000_000);
const optionalText = (max: number) => z.string().max(max).nullable();

export const REGISTRATION_ACTION_SCHEMAS = {
  'registrations.settings': z.object({}).strict(),
  'registrations.events': z.object({}).strict(),
  'registrations.list': z.object({ eventId: uuid }).strict(),
  'registrations.saveSettings': z
    .object({ enabled: z.boolean(), paymentInstructions: optionalText(1000), upiId: optionalText(130), payeeName: optionalText(80), reason })
    .strict(),
  'registrations.setEvent': z.object({ eventId: uuid, open: z.boolean(), entryFeePaise: paise(1).nullable(), reason }).strict(),
  'registrations.verifyPayment': z.object({ registrationId: uuid, amountPaise: paise(0), expectedRevision: revision, reason }).strict(),
  'registrations.convert': z
    .object({
      registrationId: uuid,
      players: z.array(z.union([z.object({ playerId: uuid }).strict(), z.object({ newName: z.string().trim().min(2).max(80) }).strict()])).min(1).max(2),
      status: z.enum(['pending', 'confirmed', 'waitlisted']),
      expectedRevision: revision,
      reason,
    })
    .strict(),
  'registrations.reject': z.object({ registrationId: uuid, expectedRevision: revision, reason }).strict(),
} as const;

export type RegistrationActionName = keyof typeof REGISTRATION_ACTION_SCHEMAS;
export const REGISTRATION_ACTION_NAMES = Object.keys(REGISTRATION_ACTION_SCHEMAS) as RegistrationActionName[];

/** read or write, for the integrator's policy table (every one owner only). */
export const REGISTRATION_ACTION_KINDS: Record<RegistrationActionName, 'read' | 'write'> = {
  'registrations.settings': 'read',
  'registrations.events': 'read',
  'registrations.list': 'read',
  'registrations.saveSettings': 'write',
  'registrations.setEvent': 'write',
  'registrations.verifyPayment': 'write',
  'registrations.convert': 'write',
  'registrations.reject': 'write',
};
