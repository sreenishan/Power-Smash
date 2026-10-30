// Draw generation (Module 4, Phase A): single elimination, round robin, groups then knockout. PURE and deterministic for a given
// integer seed; nothing here is wired into a page, the admin or the database yet. See each file's header for the rules.
export { MAX_BRACKET_SIZE, bracketSizeFor, checkSeedingOrder, knockoutRoundCodes, meetingRound, partnerLine, roundCodeFor, seedingOrder } from './bracket';
export type { SeedingOrderFn } from './bracket';
export type { DrawOutcome, DrawRefusal, DrawRefusalCode } from './validate';
export type { SeparationClash } from './separation';
export { singleElimination } from './single-elimination';
export type { DrawLine, FirstRoundMatch, SingleEliminationDraw, SingleEliminationOptions } from './single-elimination';
export { roundRobin } from './round-robin';
export type { RoundRobinDraw, RoundRobinMatch, RoundRobinOptions, RoundRobinRound } from './round-robin';
export { groupsThenKnockout } from './groups-knockout';
export type { Group, GroupMateMeeting, GroupsThenKnockoutDraw, GroupsThenKnockoutOptions, KnockoutPattern, KnockoutSlotMatch, Qualifier } from './groups-knockout';
