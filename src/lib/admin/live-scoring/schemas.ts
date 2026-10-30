// zod schemas of the live scoring admin actions (D-113). The integrator spreads LIVE_SCORING_SCHEMAS into the handler's SCHEMAS.
// Bounds mirror the 0021 RPCs; the database checks everything again.
import { z } from 'zod';
import { IDEMPOTENCY_KEY_RE, LIVE_ACTIONS, LIVE_END_STATUSES, LIVE_WINDOW_SECONDS_MAX, LIVE_WINDOW_SECONDS_MIN, MAX_SEQ, SCORE_EVENT_KINDS } from '../../live-scores/rules';

const uuid = z.uuid();
const side = z.enum(['A', 'B']);
const reason = z.string().trim().min(3).max(500);

export const liveMatchesSchema = z.object({}).strict();
export const liveMatchSchema = z.object({ matchId: uuid }).strict();
export const liveScoreSchema = z
  .object({
    matchId: uuid,
    kind: z.enum(SCORE_EVENT_KINDS),
    side: side.nullable(),
    key: z.string().regex(IDEMPOTENCY_KEY_RE),
    expectedSeq: z.number().int().min(0).max(MAX_SEQ),
  })
  .strict()
  .refine((v) => (v.kind === 'undo') === (v.side === null), { message: 'A rally and the first server name a side; an undo does not.', path: ['side'] });
export const liveStatusSchema = z
  .object({
    matchId: uuid,
    action: z.enum(LIVE_ACTIONS),
    endStatus: z.enum(LIVE_END_STATUSES).nullable(),
    retiringSide: side.nullable(),
    expectedRevision: z.number().int().min(1).max(1_000_000_000),
    reason,
  })
  .strict()
  .refine((v) => (v.action === 'end') === (v.endStatus !== null), { message: 'Only ending a match names how it ended.', path: ['endStatus'] })
  .refine((v) => (v.endStatus === 'retired') === (v.retiringSide !== null), { message: 'Say which side retired, and only for a retirement.', path: ['retiringSide'] });
export const liveSettingsSchema = z.object({}).strict();
export const saveLiveSettingsSchema = z
  .object({ public: z.boolean(), windowSeconds: z.number().int().min(LIVE_WINDOW_SECONDS_MIN).max(LIVE_WINDOW_SECONDS_MAX), reason })
  .strict();

/** Action name -> input schema. Policy: the first three reads are owner reads; liveScore and liveStatus are owner writes now ('score'
 *  access for organizers and scorers once the accounts wave is wired); saveLiveSettings stays owner only. */
export const LIVE_SCORING_SCHEMAS = {
  'competition.liveMatches': liveMatchesSchema,
  'competition.liveMatch': liveMatchSchema,
  'competition.liveSettings': liveSettingsSchema,
  'competition.liveScore': liveScoreSchema,
  'competition.liveStatus': liveStatusSchema,
  'competition.saveLiveSettings': saveLiveSettingsSchema,
} as const;

export type LiveScoringActionName = keyof typeof LIVE_SCORING_SCHEMAS;

/** The access each action needs (for the policy table and the accounts wave's SCOPED_ACTION_NEEDS). */
export const LIVE_SCORING_ACCESS: Readonly<Record<LiveScoringActionName, 'read' | 'score' | 'owner'>> = {
  'competition.liveMatches': 'read',
  'competition.liveMatch': 'read',
  'competition.liveSettings': 'owner',
  'competition.liveScore': 'score',
  'competition.liveStatus': 'score',
  'competition.saveLiveSettings': 'owner',
};
