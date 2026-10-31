// Keep-for periods for registrations and email sign-ups (migration 0025_platform_retention.sql, D-028 retention schedule).
//
// The periods are OWNER SETTINGS with NO default: null means "never remove". How long to keep is a legal decision (DPDP, the lawyer's
// call), so nothing here suggests a number. The ranges below are only limits on what the owner may type, and must match the SQL
// (tests/retention/platform-parity.test.ts reads the migration and compares).
//
// The retention job itself runs in the database (public.admin_run_platform_retention, called by .github/workflows/retention.yml when
// RETENTION_ENABLED is exactly 'true'). Its answer is counts only; parseRetentionRun() accepts nothing else, so a screen or a log built on
// it can never show a name, phone, email or address hash.

/** The limits on what the owner may type, in days. NOT a suggested period. */
export const KEEP_DAYS_LIMITS = {
  registrationKeepDays: { min: 7, max: 3650 },
  subscriberKeepDays: { min: 1, max: 3650 },
} as const;

export type KeepDaysField = keyof typeof KEEP_DAYS_LIMITS;

export interface RetentionPeriods {
  /** Days a closed registration is kept after the event ended (and after it was closed). null = never removed. */
  registrationKeepDays: number | null;
  /** Days an unconfirmed or unsubscribed email sign-up is kept. null = never removed. */
  subscriberKeepDays: number | null;
}

/**
 * The periods plus the separate yes to keeping a code (SHA-256) of a deleted unsubscribed address. false = the address is deleted and
 * nothing is kept (the default, until the lawyer says yes: D-127).
 */
export interface RetentionSettings extends RetentionPeriods {
  keepUnsubscribeHash: boolean;
}

/** The starting state: nothing is ever removed until the owner, on the lawyer's advice, sets a period. */
export const NO_PERIODS: Readonly<RetentionPeriods> = Object.freeze({ registrationKeepDays: null, subscriberKeepDays: null });

/** Owner-facing text for the settings screen (plain English, for a phone). */
export const RETENTION_SCREEN_TEXT = {
  title: 'How long to keep registrations and email sign-ups',
  intro:
    'Your lawyer decides these periods. Leave a box empty to keep everything of that kind. When a period is set, the weekly clean-up removes what is older than it. It never removes active email subscribers, event entries or players.',
  fields: {
    registrationKeepDays: {
      label: 'Closed registrations: days to keep after the event',
      help:
        'Counted from the end of the event (or from when you closed the registration, if later). Registrations that became entries, or where you recorded a payment, keep the entry and the amount; only the names as typed, phone, email and payment reference are removed. Other closed registrations are deleted. A registration whose tournament has no date is never removed.',
    },
    subscriberKeepDays: {
      label: 'Email sign-ups: days to keep unconfirmed or unsubscribed addresses',
      help:
        'A sign-up that was never confirmed is deleted once its confirmation link has expired and this many days have passed. An unsubscribed address is deleted this many days after the unsubscribe.',
    },
  },
  keepUnsubscribeHash: {
    label: 'Remember removed unsubscribed addresses as a code',
    help:
      'When ticked, a deleted unsubscribed address is kept as a code (not the address itself), so a future import never adds it back. Someone holding the address could still match it to the code. Tick this only after your lawyer says yes. Untick it to keep nothing.',
  },
  empty: 'not set, so nothing is removed',
  lawyerNote: 'The lawyer decides',
} as const;

export type PeriodsCheck = { ok: true; value: RetentionPeriods } | { ok: false; problems: string[] };

function checkOne(field: KeepDaysField, raw: unknown, problems: string[]): number | null {
  const { min, max } = KEEP_DAYS_LIMITS[field];
  const label = RETENTION_SCREEN_TEXT.fields[field].label;
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t === '') return null;
    if (!/^[0-9]{1,5}$/.test(t)) {
      problems.push(`${label}: enter a whole number of days, or leave it empty.`);
      return null;
    }
    raw = Number(t);
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    problems.push(`${label}: enter a whole number of days, or leave it empty.`);
    return null;
  }
  if (raw < min || raw > max) {
    problems.push(`${label}: enter a number from ${min} to ${max}, or leave it empty.`);
    return null;
  }
  return raw;
}

/**
 * Checks the owner's input (numbers, digit strings from a text box, or empty). Empty means null: never remove. Same limits as the SQL;
 * the database checks again.
 */
export function checkPeriods(input: { registrationKeepDays?: unknown; subscriberKeepDays?: unknown }): PeriodsCheck {
  const problems: string[] = [];
  const registrationKeepDays = checkOne('registrationKeepDays', input.registrationKeepDays, problems);
  const subscriberKeepDays = checkOne('subscriberKeepDays', input.subscriberKeepDays, problems);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { registrationKeepDays, subscriberKeepDays } };
}

/** "not set, so nothing is removed", "1 day", "30 days". */
export function describePeriod(days: number | null): string {
  if (days === null) return RETENTION_SCREEN_TEXT.empty;
  return days === 1 ? '1 day' : `${days} days`;
}

/** The record admin_set_platform_retention takes (every key present, null allowed for a period; the hash answer always given). */
export function toRpcRecord(p: RetentionSettings): { registrationKeepDays: number | null; subscriberKeepDays: number | null; keepUnsubscribeHash: boolean } {
  return { registrationKeepDays: p.registrationKeepDays, subscriberKeepDays: p.subscriberKeepDays, keepUnsubscribeHash: p.keepUnsubscribeHash };
}

// ------------------------------------------------------------------------------------------------------------------
// The job's answer (public.admin_run_platform_retention / app.platform_retention): counts only
// ------------------------------------------------------------------------------------------------------------------

export const RUN_COUNT_KEYS = [
  'registrations_anonymised',
  'registrations_deleted',
  'registrations_without_event_date',
  'subscribers_unconfirmed_deleted',
  'subscribers_unsubscribed_deleted',
  'unsubscribe_hashes_kept',
  'outbox_rows_removed',
] as const;

export type RunCountKey = (typeof RUN_COUNT_KEYS)[number];

export interface RetentionRun {
  dryRun: boolean;
  registrationKeepDays: number | null;
  subscriberKeepDays: number | null;
  counts: Record<RunCountKey, number>;
}

const ALLOWED_KEYS = new Set<string>(['dry_run', 'registration_keep_days', 'subscriber_keep_days', ...RUN_COUNT_KEYS]);

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isDays = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3650);

/**
 * Reads the job's answer. Anything other than the known keys with whole-number values (a text, an unknown key) is refused, so nothing
 * but counts can reach a screen or a log through it.
 */
export function parseRetentionRun(json: unknown): RetentionRun {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('The clean-up answer is not a record.');
  const o = json as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ALLOWED_KEYS.has(k)) throw new Error(`The clean-up answer has an unknown field: ${k.slice(0, 40).replace(/[^a-z_]/g, '?')}`);
  if (typeof o.dry_run !== 'boolean') throw new Error('The clean-up answer has no dry-run flag.');
  if (!isDays(o.registration_keep_days) || !isDays(o.subscriber_keep_days)) throw new Error('The clean-up answer has a bad period.');
  const counts = {} as Record<RunCountKey, number>;
  for (const k of RUN_COUNT_KEYS) {
    const v = o[k];
    if (!isCount(v)) throw new Error(`The clean-up answer has a bad count: ${k}`);
    counts[k] = v;
  }
  return { dryRun: o.dry_run, registrationKeepDays: o.registration_keep_days, subscriberKeepDays: o.subscriber_keep_days, counts };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Plain-English lines for the owner (a dry run says "would"). */
export function describeRetentionRun(run: RetentionRun): string[] {
  const c = run.counts;
  const will = run.dryRun ? 'would be' : 'were';
  const lines: string[] = [run.dryRun ? 'Preview only: nothing was changed.' : 'Clean-up done.'];
  if (run.registrationKeepDays === null) {
    lines.push('Registrations: no period set, so nothing is removed.');
  } else {
    lines.push(
      `Registrations (kept ${describePeriod(run.registrationKeepDays)} after the event): ${plural(c.registrations_anonymised, 'registration', 'registrations')} ${will} cleared of contact details (entry and amount kept), ${plural(c.registrations_deleted, 'registration', 'registrations')} ${will} deleted.`,
    );
    if (c.registrations_without_event_date > 0) {
      lines.push(
        `${plural(c.registrations_without_event_date, 'old registration is', 'old registrations are')} kept because the tournament has no date. Add the tournament dates to let the clean-up handle them.`,
      );
    }
  }
  if (run.subscriberKeepDays === null) {
    lines.push('Email sign-ups: no period set, so nothing is removed.');
  } else {
    lines.push(
      `Email sign-ups (kept ${describePeriod(run.subscriberKeepDays)}): ${plural(c.subscribers_unconfirmed_deleted, 'unconfirmed address', 'unconfirmed addresses')} and ${plural(c.subscribers_unsubscribed_deleted, 'unsubscribed address', 'unsubscribed addresses')} ${will} deleted.`,
    );
  }
  return lines;
}
