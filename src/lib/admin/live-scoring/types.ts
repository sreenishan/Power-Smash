// Admin data contract for live scoring (D-113, platform wave 5). The scoring console calls these through the AdminStore
// (POST /api/admin/competition.live*); every write is one of the 0021 RPCs (admin_live_score, admin_live_match_status,
// admin_set_live_scores) or the memory backend's copy of their rules (tests and the no-backend preview, fictional seed).
//
// Two layers, like src/lib/admin/competition:
//   LiveScoringBackend     - primitive reads and the RPC writes (memory-backend.ts, supabase-backend.ts)
//   LiveScoringAdminStore  - what the console calls (service.ts): it rebuilds the score with the scoring engine and answers plain DTOs.
import type { AgeStatus } from '../../archive/types';
import type { Ruleset } from '../../competition/scoring';
import type { MatchStatus, RoundCode, Side } from '../../competition/types';
import type { LiveSnapshot, ScoreEventRow } from '../../live-scores/replay';
import type { LiveAction, LiveEndStatus, ScoreEventKind } from '../../live-scores/rules';
import type { Actor, StoreResult } from '../types';

export type { LiveAction, LiveEndStatus, LiveSnapshot, ScoreEventKind, ScoreEventRow };

/** One player of a side, as the console needs it (the name is shown to the owner; others see "Protected player" when needed). */
export interface LiveSidePlayer {
  displayName: string;
  ageStatus: AgeStatus;
}

/** Everything about a match the console needs, from the private tables (service role). */
export interface LiveMatchFacts {
  matchId: string;
  eventId: string;
  tournamentId: string;
  tournamentName: string;
  category: string;
  ageGroup: string | null;
  /** The event is junior OR its tournament has a minor signal (school_college counts): every player is protected for non-owners. */
  junior: boolean;
  roundCode: RoundCode;
  matchNumber: number;
  groupLabel: string | null;
  courtLabel: string | null;
  scheduledAt: string | null;
  status: MatchStatus;
  revision: number;
  confirmed: boolean;
  ruleset: Ruleset;
  /** The event's draw is published or locked (a match cannot start before). */
  drawPublished: boolean;
  /** null while the side is not known yet. */
  sideA: LiveSidePlayer[] | null;
  sideB: LiveSidePlayer[] | null;
}

export interface LiveScoringSettings {
  /** competition_settings.live_scores_public: the owner's database switch (off by default). */
  public: boolean;
  /** competition_settings.live_window_seconds: "Live" only while the last point is younger than this (60..3600, default 300). */
  windowSeconds: number;
}

// ----------------------------------------------------------------------------- RPC records

export interface ScoreRecord {
  kind: ScoreEventKind;
  side: Side | null;
  key: string;
  expectedSeq: number;
}
export interface StatusRecord {
  action: LiveAction;
  endStatus: LiveEndStatus | null;
  retiringSide: Side | null;
}
/** admin_live_score's answer. */
export interface ScoreRpcResult {
  matchId: string;
  duplicate: boolean;
  seq: number;
  status: MatchStatus;
  revision: number;
  state: LiveSnapshot;
}
/** admin_live_match_status's answer. */
export interface StatusRpcResult {
  id: string;
  status: MatchStatus;
  winnerSide: Side | null;
  confirmed: boolean;
  revision: number;
}

export interface LiveScoringBackend {
  /** Matches that can be scored now or soon: not confirmed, status scheduled/ready/live/paused, both sides known, draw published. */
  listScorableMatches(): Promise<LiveMatchFacts[]>;
  getMatchFacts(matchId: string): Promise<LiveMatchFacts | null>;
  /** The rally log of one match, in order. */
  listScoreEvents(matchId: string): Promise<ScoreEventRow[]>;
  getSettings(): Promise<LiveScoringSettings>;
  score(actor: Actor, matchId: string, record: ScoreRecord): Promise<ScoreRpcResult>;
  setStatus(actor: Actor, matchId: string, record: StatusRecord, expectedRevision: number, reason: string): Promise<StatusRpcResult>;
  setSettings(actor: Actor, record: LiveScoringSettings, reason: string): Promise<LiveScoringSettings>;
}

// ----------------------------------------------------------------------------- what the console gets

export interface LiveMatchSummaryDto {
  matchId: string;
  /** For the per-tournament filter of an organizer or scorer (accounts/scoped-store.ts); never shown. */
  tournamentId: string;
  tournamentName: string;
  /** "MS Final match 1". */
  label: string;
  sideA: string;
  sideB: string;
  status: MatchStatus;
  courtLabel: string | null;
  scheduledAt: string | null;
}

export interface LiveConsoleDto {
  matchId: string;
  tournamentName: string;
  label: string;
  courtLabel: string | null;
  status: MatchStatus;
  revision: number;
  ruleset: Ruleset;
  /** Side names as the actor may see them. */
  sides: { A: string; B: string };
  snapshot: LiveSnapshot;
  /** The engine's cues after the last tap (interval, change of ends, server), plain English. */
  cues: string[];
}

export interface LiveTapDto {
  duplicate: boolean;
  seq: number;
  status: MatchStatus;
  revision: number;
  snapshot: LiveSnapshot;
}

export interface LiveScoreInput extends ScoreRecord {
  matchId: string;
}
export interface LiveStatusInput extends StatusRecord {
  matchId: string;
  expectedRevision: number;
  reason: string;
}
export interface LiveSettingsInput extends LiveScoringSettings {
  reason: string;
}

/** The AdminStore methods (the integrator adds `LiveScoringAdminStore` to AdminStore). */
export interface LiveScoringAdminStore {
  liveScoringMatches(actor: Actor): Promise<StoreResult<LiveMatchSummaryDto[]>>;
  liveScoringMatch(input: { matchId: string }, actor: Actor): Promise<StoreResult<LiveConsoleDto>>;
  liveScoringScore(actor: Actor, input: LiveScoreInput): Promise<StoreResult<LiveTapDto>>;
  liveScoringStatus(actor: Actor, input: LiveStatusInput): Promise<StoreResult<LiveConsoleDto>>;
  liveScoringSettings(): Promise<StoreResult<LiveScoringSettings>>;
  liveScoringSaveSettings(actor: Actor, input: LiveSettingsInput): Promise<StoreResult<LiveScoringSettings>>;
}

/** The method names, for the stores to delegate (like ACCOUNTS_STORE_METHODS). */
export const LIVE_SCORING_STORE_METHODS = [
  'liveScoringMatches',
  'liveScoringMatch',
  'liveScoringScore',
  'liveScoringStatus',
  'liveScoringSettings',
  'liveScoringSaveSettings',
] as const satisfies readonly (keyof LiveScoringAdminStore)[];

/** An error with an allow-listed code and the database's own plain sentence. */
export class LiveScoringError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE' | 'FORBIDDEN' | 'BACKEND_ERROR',
    readonly detail?: string,
  ) {
    super(code);
  }
}
