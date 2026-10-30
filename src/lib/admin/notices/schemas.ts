// zod schemas of the notices and notification admin actions (D-114). The integrator adds them to the action table in
// src/lib/admin/handler.ts and the policy in src/lib/admin/policy.ts (NOTICES_ACTION_KINDS: who may run each one). Generous bounds;
// the exact rules are in src/lib/notices/site-notices.ts and the 0023 SQL.
import { z } from 'zod';

const uuid = z.uuid();
const reason = z.string().trim().min(3).max(500);
const revision = z.number().int().min(1).max(1_000_000_000);
const instant = z.string().max(40).nullable();
const optionalText = (max: number) => z.string().max(max).nullable();

export const NOTICES_ACTION_SCHEMAS = {
  'notices.list': z.object({}).strict(),
  'notices.staff': z.object({}).strict(),
  'notices.save': z
    .object({
      id: uuid.nullable(),
      expectedRevision: revision.nullable(),
      title: z.string().max(200),
      body: optionalText(1000),
      linkPath: optionalText(200),
      linkUrl: optionalText(400),
      linkLabel: optionalText(100),
      audience: z.enum(['public', 'staff']),
      startsAt: instant,
      endsAt: instant,
      reason,
    })
    .strict(),
  'notices.publish': z.object({ id: uuid, published: z.boolean(), expectedRevision: revision, reason }).strict(),
  'notify.summary': z.object({}).strict(),
  'notify.saveSettings': z.object({ emailSubscribeOpen: z.boolean(), reason }).strict(),
  'notify.queueAnnouncement': z.object({ announcementId: uuid, title: z.string().max(300), body: z.string().max(4000), reason }).strict(),
  'notify.dispatch': z.object({}).strict(),
} as const;

export type NoticesActionName = keyof typeof NOTICES_ACTION_SCHEMAS;
export const NOTICES_ACTION_NAMES = Object.keys(NOTICES_ACTION_SCHEMAS) as NoticesActionName[];

/**
 * read or write, and who: every action is owner only, except notices.staff, which organizers and scorers (wave 4 accounts) may read
 * too (it returns only published staff notices whose window is open; nothing private).
 */
export const NOTICES_ACTION_KINDS: Record<NoticesActionName, { kind: 'read' | 'write'; roles: readonly ('owner' | 'organizer' | 'scorer')[] }> = {
  'notices.list': { kind: 'read', roles: ['owner'] },
  'notices.staff': { kind: 'read', roles: ['owner', 'organizer', 'scorer'] },
  'notices.save': { kind: 'write', roles: ['owner'] },
  'notices.publish': { kind: 'write', roles: ['owner'] },
  'notify.summary': { kind: 'read', roles: ['owner'] },
  'notify.saveSettings': { kind: 'write', roles: ['owner'] },
  'notify.queueAnnouncement': { kind: 'write', roles: ['owner'] },
  'notify.dispatch': { kind: 'write', roles: ['owner'] },
};
