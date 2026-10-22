/**
 * Build the row the sync writes from an API video (parse + classify) and merge it into the stored row.
 * Rules: the raw title always follows YouTube (displayed unmodified and "most updated", D-016); fields the owner locked in the
 * admin (`manual_override`, PC-20) are never overwritten; statistics are replaced and stamped (`stats_fetched_at`) so the 30-day
 * rule can see their age (VF-C3); `visibility` is sent ONLY for a new row, never for an existing one.
 */
import { parseTitle } from '../parser';
import type { ParseContext, ParseResult } from '../parser/types';
import { buildParseContext, classifyVideo, playlistOf, type PlaylistSignals } from '../youtube/classify';
import { parseIsoDuration } from '../youtube/client';
import type { ApiVideo } from '../youtube/types';
import { IDENTITY_REVIEW_REASONS, type SyncReviewReason, type VideoRecord, type VideoWrite } from './types';

function num(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** A video the API key cannot see: no snippet, or private. These rows are retired, never stored. */
export function isUnavailable(v: ApiVideo): boolean {
  return !v.snippet || v.snippet.title === undefined || v.status?.privacyStatus === 'private';
}

const asJson = (p: ParseResult): Record<string, unknown> => JSON.parse(JSON.stringify(p)) as Record<string, unknown>;

/** Parse fields shared by a fresh API record and a reparse of a stored row. */
function parseFields(title: string, parsed: ParseResult, shortUncertain: boolean): Pick<VideoWrite, 'title_normalized' | 'parse_status' | 'parser_version' | 'parse_confidence' | 'hard_flags' | 'review_reasons' | 'parse_result' | 'minor_hold' | 'entity_block_reason' | 'is_international'> {
  void title;
  const reasons: SyncReviewReason[] = [...parsed.reviewReasons];
  if (shortUncertain) reasons.push('SHORT_UNCERTAIN');
  const needsReview = reasons.length > 0 && (parsed.kind !== 'non_match' || shortUncertain);
  return {
    title_normalized: parsed.normalizedTitle,
    parse_status: needsReview ? 'needs_review' : 'parsed',
    parser_version: parsed.parserVersion,
    parse_confidence: parsed.confidencePoints,
    hard_flags: [...parsed.hardFlags],
    review_reasons: (needsReview ? reasons : []) as VideoWrite['review_reasons'],
    parse_result: asJson(parsed),
    minor_hold: parsed.minorHold,
    entity_block_reason: parsed.entityBlockReason,
    is_international: parsed.isInternational || (parsed.entityCreation === 'blocked' && parsed.entityBlockReason === 'INTERNATIONAL'),
  };
}

export function buildFreshRecord(v: ApiVideo, now: Date, signals?: PlaylistSignals): VideoWrite {
  const nowIso = now.toISOString();
  const title = v.snippet?.title ?? '';
  const ctx = buildParseContext(v, signals);
  const parsed = parseTitle(title, ctx);
  const cls = classifyVideo(v, parsed, ctx);
  return {
    youtube_id: v.id,
    title_raw: title,
    // YouTube descriptions can hold phone numbers (D-029) and the pipeline does not need them: never stored.
    description: null,
    published_at: v.snippet?.publishedAt ?? nowIso,
    duration_s: parseIsoDuration(v.contentDetails?.duration),
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    stats_fetched_at: nowIso,
    // The ApiVideo type carries no thumbnails and a URL is never invented (CLAUDE.md "never fabricate"): the site builds its own.
    thumbnail_url: null,
    embeddable: v.status?.embeddable ?? null,
    type: cls.videoType,
    live_status: cls.liveStatus,
    was_live: cls.wasLive,
    ...parseFields(title, parsed, cls.shortUncertain),
    // Only used when the row is new (see mergeVideo); the database default and its triggers decide the rest.
    visibility: cls.visibility,
    hidden_reason: cls.hiddenReason,
    playlist_source: playlistOf(v.id, signals) ?? null,
    last_synced_at: nowIso,
    etag: v.etag ?? null,
  };
}

/** Re-read a STORED row without any API call (reparse mode): only parse-derived fields change; API data and its dates stay. */
export function buildReparsedRecord(row: VideoRecord): VideoWrite {
  const ctx: ParseContext = {
    durationSeconds: row.duration_s,
    liveBroadcastContent: row.live_status === 'live' || row.live_status === 'upcoming' ? row.live_status : 'none',
    hasLiveStreamingDetails: row.was_live,
    playlist: row.playlist_source,
    rssLinkType: null,
    publishedAt: row.published_at,
  };
  const parsed = parseTitle(row.title_raw, ctx);
  const pseudo: ApiVideo = { id: row.youtube_id, snippet: { title: row.title_raw, publishedAt: row.published_at ?? undefined }, status: { privacyStatus: 'public' } };
  const cls = classifyVideo(pseudo, parsed, ctx);
  return {
    ...rowToWrite(row),
    type: cls.videoType,
    live_status: cls.liveStatus,
    ...parseFields(row.title_raw, parsed, cls.shortUncertain),
  };
}

/** The stored row as an update payload (no visibility, no generated columns). */
export function rowToWrite(r: VideoRecord): VideoWrite {
  return {
    youtube_id: r.youtube_id,
    title_raw: r.title_raw,
    title_normalized: r.title_normalized,
    description: r.description,
    published_at: r.published_at,
    duration_s: r.duration_s,
    views: r.views,
    likes: r.likes,
    stats_fetched_at: r.stats_fetched_at,
    thumbnail_url: r.thumbnail_url,
    embeddable: r.embeddable,
    type: r.type,
    live_status: r.live_status,
    was_live: r.was_live,
    is_international: r.is_international,
    parse_status: r.parse_status,
    parser_version: r.parser_version,
    parse_confidence: r.parse_confidence,
    hard_flags: r.hard_flags,
    review_reasons: r.review_reasons,
    parse_result: r.parse_result,
    minor_hold: r.minor_hold,
    entity_block_reason: r.entity_block_reason,
    playlist_source: r.playlist_source,
    last_synced_at: r.last_synced_at,
    etag: r.etag,
  };
}

export type ChangeKind = 'inserted' | 'content' | 'minor' | 'stats' | 'unchanged';

const isIdentityReason = (x: string): boolean => (IDENTITY_REVIEW_REASONS as readonly string[]).includes(x);

/**
 * Merge a fresh write into the stored row without touching locked fields. For an existing row the returned write has NO
 * `visibility` and NO `hidden_reason`. Reasons the identity step added (AMBIGUOUS_ALIAS) are carried so a re-sync does not flap them.
 */
export function mergeVideo(existing: VideoRecord | null, fresh: VideoWrite): { write: VideoWrite; change: ChangeKind } {
  if (!existing) return { write: fresh, change: 'inserted' };
  const { visibility: _v, hidden_reason: _h, ...rest } = fresh;
  void _v;
  void _h;
  const next: VideoWrite = { ...rest };
  const lock = existing.manual_override;
  if (lock.type) next.type = existing.type;
  if (lock.parse_status) next.parse_status = existing.parse_status;
  if (lock.is_international) next.is_international = existing.is_international;

  const carried = existing.review_reasons.filter(isIdentityReason);
  if (carried.length > 0) {
    next.review_reasons = [...new Set([...next.review_reasons, ...carried])] as VideoWrite['review_reasons'];
    next.hard_flags = [...new Set([...next.hard_flags, ...(carried as typeof next.hard_flags)])];
    if (!lock.parse_status) next.parse_status = 'needs_review';
  }
  return { write: next, change: classifyChange(existing, next) };
}

/** Order-insensitive JSON (Postgres jsonb does not keep key order). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Postgres returns timestamptz as "+00:00" text, the API as "Z": compare instants, not strings. */
const instant = (x: string | null): number | null => (x === null ? null : Date.parse(x));

function publicSignature(r: VideoRecord | VideoWrite): string {
  return JSON.stringify(canon([r.title_raw, r.type, r.is_international, r.parse_status, r.live_status, r.parse_result, r.embeddable, r.duration_s, instant(r.published_at)]));
}

function stable(r: VideoRecord | VideoWrite): string {
  const w = rowToWrite(r as VideoRecord) as Record<string, unknown>;
  for (const k of ['views', 'likes', 'stats_fetched_at', 'last_synced_at', 'etag']) delete w[k];
  w.published_at = instant(r.published_at);
  return JSON.stringify(canon(w));
}

export function classifyChange(before: VideoRecord, after: VideoWrite): ChangeKind {
  if (publicSignature(before) !== publicSignature(after)) return 'content';
  if (stable(before) !== stable(after)) return 'minor';
  if (before.views !== after.views || before.likes !== after.likes) return 'stats';
  return 'unchanged';
}

/** A new or changed row that is visible on the site (hidden rows never make the site dirty). */
export function affectsPublicSite(change: ChangeKind, write: VideoWrite, before: VideoRecord | null): boolean {
  if (change === 'inserted') return (write.visibility ?? 'hidden') !== 'hidden';
  if (change === 'content') return before !== null && before.visibility !== 'hidden';
  return false;
}

/** The row as it will be stored after this write (used to feed the identity step before a re-read). */
export function materialise(existing: VideoRecord | null, write: VideoWrite, nowIso: string): VideoRecord {
  const base = existing ?? {
    created_at: nowIso,
    updated_at: nowIso,
    hidden_at: null,
    hidden_reason: null,
    manual_override: {},
    override_stale: false,
    visibility: write.visibility ?? 'hidden',
  };
  const { visibility: _v, hidden_reason: _h, ...rest } = write;
  void _v;
  void _h;
  return {
    ...(base as VideoRecord),
    ...rest,
    ...(existing ? {} : { hidden_reason: write.hidden_reason ?? null, visibility: write.visibility ?? 'hidden' }),
  } as VideoRecord;
}
