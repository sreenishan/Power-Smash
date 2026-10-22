/**
 * Quota ledger (D-033, VF-C1). Costs verified 2026-10-20 at https://developers.google.com/youtube/v3/determine_quota_cost:
 * channels.list, playlistItems.list and videos.list cost 1 unit per call (multi-part videos.list is still 1). search.list
 * is never used. Default daily quota 10,000, reset at midnight Pacific Time. D-033: fail closed above 3,000 units a day
 * (serve cached data). A 304 response still costs the call, so every attempt is charged (conservative).
 */
export const QUOTA_COST = { channelsList: 1, playlistItemsList: 1, videosList: 1 } as const;
export type QuotaMethod = keyof typeof QUOTA_COST;

export const GOOGLE_DEFAULT_DAILY_QUOTA = 10_000;
export const FAIL_CLOSED_UNITS_PER_DAY = 3_000;

export class QuotaExceededError extends Error {
  /** 'ledger' = our own fail-closed threshold; 'api' = Google answered quotaExceeded. */
  readonly source: 'ledger' | 'api';
  constructor(source: 'ledger' | 'api') {
    super(`youtube_quota_${source}`);
    this.name = 'QuotaExceededError';
    this.source = source;
  }
}

export class QuotaLedger {
  private used: number;
  private readonly byMethod: Record<QuotaMethod, number> = { channelsList: 0, playlistItemsList: 0, videosList: 0 };
  readonly limit: number;

  /** `alreadyUsedToday` comes from the sync_runs of the current Pacific quota day. */
  constructor(limit: number = FAIL_CLOSED_UNITS_PER_DAY, alreadyUsedToday = 0) {
    this.limit = limit;
    this.used = alreadyUsedToday;
  }

  /** Charge one call; throws BEFORE the call would cross the limit. */
  charge(method: QuotaMethod): void {
    const cost = QUOTA_COST[method];
    if (this.used + cost > this.limit) throw new QuotaExceededError('ledger');
    this.used += cost;
    this.byMethod[method] += cost;
  }

  /** Units charged in total today, including units from earlier runs. */
  get unitsToday(): number {
    return this.used;
  }

  /** Units charged by this ledger instance (this run). */
  get unitsThisRun(): number {
    return this.byMethod.channelsList + this.byMethod.playlistItemsList + this.byMethod.videosList;
  }

  breakdown(): Readonly<Record<QuotaMethod, number>> {
    return { ...this.byMethod };
  }
}

/** The Pacific-time calendar day (YYYY-MM-DD) that the YouTube quota belongs to. */
export function quotaDayKey(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
