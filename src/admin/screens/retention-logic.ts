// Pure helpers for the keep-for periods card on the Settings screen (migration 0025, D-028, D-127). Tested in tests/admin-ui.
// The boxes start from the saved value (empty when no period is set) and NEVER from a suggested number: the lawyer decides.
import { checkPeriods, describePeriod, describeRetentionRun, RETENTION_SCREEN_TEXT, type KeepDaysField, type RetentionSettings } from '../../lib/retention/platform';
import type { RetentionSummaryDto } from '../../lib/admin/retention/types';

export type RetentionForm = Record<KeepDaysField, string> & { keepUnsubscribeHash: boolean };

/** The boxes as the saved settings (empty text for "not set"; the code box as saved, unticked by default). */
export function retentionFormFrom(p: RetentionSettings): RetentionForm {
  return {
    registrationKeepDays: p.registrationKeepDays === null ? '' : String(p.registrationKeepDays),
    subscriberKeepDays: p.subscriberKeepDays === null ? '' : String(p.subscriberKeepDays),
    keepUnsubscribeHash: p.keepUnsubscribeHash,
  };
}

export type RetentionFormCheck = { ok: true; value: RetentionSettings } | { ok: false; problems: string[] };

/** Checks the boxes with the shared rule (same limits as the database). Empty = never remove. */
export function checkRetentionForm(form: RetentionForm): RetentionFormCheck {
  const c = checkPeriods(form);
  return c.ok ? { ok: true, value: { ...c.value, keepUnsubscribeHash: form.keepUnsubscribeHash === true } } : c;
}

/** True when the boxes differ from what is saved. */
export function retentionFormChanged(form: RetentionForm, saved: RetentionSettings): boolean {
  const c = checkPeriods(form);
  if (!c.ok) return true;
  return c.value.registrationKeepDays !== saved.registrationKeepDays || c.value.subscriberKeepDays !== saved.subscriberKeepDays || form.keepUnsubscribeHash !== saved.keepUnsubscribeHash;
}

/** "Now: 30 days" or "Now: not set, so nothing is removed". */
export function currentPeriodText(days: number | null): string {
  return `Now: ${describePeriod(days)}`;
}

/** The "what the next clean-up would remove" lines (counts only), plus how many unsubscribe codes are kept. */
export function dueNowLines(s: RetentionSummaryDto): string[] {
  const lines = describeRetentionRun(s.dueNow);
  lines.push(
    s.keepUnsubscribeHash
      ? 'Removed unsubscribed addresses are remembered as a code, so an import never adds them back.'
      : 'Removed unsubscribed addresses are not remembered (the box below is unticked).',
  );
  lines.push(`Removed unsubscribed addresses remembered as a code so far: ${s.unsubscribeHashesKept}.`);
  return lines;
}

/** The sentence after a save. */
export function retentionSavedText(fields: readonly string[]): string {
  if (fields.length === 0) return 'Nothing changed.';
  return 'Saved. The weekly clean-up uses the new settings from its next run (it runs only while the clean-up switch is on).';
}

export const RETENTION_TEXT = RETENTION_SCREEN_TEXT;
