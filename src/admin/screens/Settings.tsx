import { useState } from 'react';
import type { ProtectedMatchMode } from '../../lib/archive/types';
import { PROTECTED_MODE_KEYS, type ProtectedModeKey } from '../../lib/admin/types';
import { MODE_LABEL } from '../messages';
import { Button, Confirm, Field, LoadState, cardCls, cx, useAdmin, useAsync, useBusy } from '../ui';
import type { RetentionSummaryDto } from '../../lib/admin/retention/types';
import type { KeepDaysField } from '../../lib/retention/platform';
import { ErrorText, H2, Input, ReasonField, useAction } from './competition/shared';
import { RETENTION_TEXT, checkRetentionForm, currentPeriodText, dueNowLines, retentionFormChanged, retentionFormFrom, retentionSavedText, type RetentionForm } from './retention-logic';

const TITLE: Record<ProtectedModeKey, string> = {
  unknown_match_mode: 'Players whose age is not known',
  minor_match_mode: 'Players who may be under 18, or are',
};
const HELP: Record<ProtectedModeKey, string> = {
  unknown_match_mode: 'Most players. "Minimal page" shows the video page with the YouTube title only: no player names or links, hidden from Google. "Hidden" removes the page.',
  minor_match_mode: 'Recommended: hidden completely. "Minimal page" would keep a video page online for a possible child.',
};

export function Settings() {
  const { client } = useAdmin();
  const q = useAsync(() => client.getProtectedModes(), []);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">These decide what the public site shows for players who are not confirmed adults. A change takes effect at the next publish.</p>
      <LoadState loading={q.loading} error={q.error}>
        {q.data ? PROTECTED_MODE_KEYS.map((k) => <ModeCard key={k} k={k} value={q.data![k]} />) : null}
      </LoadState>
      <RetentionCard />
    </div>
  );
}

const KEEP_FIELDS: readonly KeepDaysField[] = ['registrationKeepDays', 'subscriberKeepDays'];

/** Keep-for periods (0025, D-028): both empty until the owner types what the lawyer decided. No number is ever suggested. */
function RetentionCard() {
  const { client, actor } = useAdmin();
  const q = useAsync(() => client.retentionSummary(actor), []);
  return (
    <section className={cardCls} aria-labelledby="retention-h">
      <H2 id="retention-h">{RETENTION_TEXT.title}</H2>
      <p className="mt-1 text-small text-fg-muted">{RETENTION_TEXT.intro}</p>
      <LoadState loading={q.loading} error={q.error}>
        {q.data ? <RetentionFields summary={q.data} /> : null}
      </LoadState>
    </section>
  );
}

function RetentionFields({ summary }: { summary: RetentionSummaryDto }) {
  const { client, actor, notify, bump } = useAdmin();
  const act = useAction();
  const [form, setForm] = useState<RetentionForm>(() => retentionFormFrom(summary));
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState<{ form?: string; reason?: string }>({});
  const save = async () => {
    const checked = checkRetentionForm(form);
    const r = reason.trim();
    const next = { form: checked.ok ? undefined : checked.problems.join(' '), reason: r.length < 3 || r.length > 500 ? 'Write a short reason (3 to 500 characters).' : undefined };
    setLocal(next);
    if (!checked.ok || next.reason) return;
    const res = await act.run(() => client.retentionSave(actor, { ...checked.value, reason: r }));
    if (!res) return;
    setReason('');
    notify(retentionSavedText(res.fields));
    bump();
  };
  const formError = local.form ?? act.fields.form ?? act.error;
  return (
    <div className="mt-3 flex flex-col gap-4">
      {KEEP_FIELDS.map((k) => (
        <Field key={k} label={RETENTION_TEXT.fields[k].label} htmlFor={`retention-${k}`} hint={`${RETENTION_TEXT.fields[k].help} ${RETENTION_TEXT.lawyerNote}. Leave it empty to keep everything.`}>
          <Input id={`retention-${k}`} value={form[k]} inputMode="numeric" maxLength={5} errorId="retention-form-error" error={formError} onChange={(v) => setForm({ ...form, [k]: v })} />
          <span className="text-small text-fg-muted">{currentPeriodText(summary[k])}</span>
        </Field>
      ))}
      <div className="flex flex-col gap-1">
        <label className="flex min-h-tap items-center gap-3 font-semibold" htmlFor="retention-keep-hash">
          <input id="retention-keep-hash" type="checkbox" className="h-5 w-5" checked={form.keepUnsubscribeHash} aria-describedby="retention-keep-hash-help" onChange={(ev) => setForm({ ...form, keepUnsubscribeHash: ev.target.checked })} />
          {RETENTION_TEXT.keepUnsubscribeHash.label}
        </label>
        <p id="retention-keep-hash-help" className="text-small text-fg-muted">{RETENTION_TEXT.keepUnsubscribeHash.help}</p>
        <span className="text-small text-fg-muted">{summary.keepUnsubscribeHash ? 'Now: ticked, a code is kept' : 'Now: unticked, nothing is kept'}</span>
      </div>
      <ErrorText id="retention-form-error" text={formError} />
      <ReasonField id="retention-reason" value={reason} onChange={setReason} error={local.reason ?? act.fields.reason} />
      <div>
        <Button variant="primary" busy={act.busy} disabled={!retentionFormChanged(form, summary)} onClick={() => void save()}>
          Save
        </Button>
      </div>
      <section aria-labelledby="retention-due-h" className="rounded-md border border-line p-3">
        <h3 id="retention-due-h" className="text-body font-bold text-heading">What the next clean-up would remove</h3>
        <ul className="mt-2 list-disc pl-5 text-small">
          {dueNowLines(summary).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-small text-fg-muted">The clean-up runs once a week, only while its switch is on. There is no button to run it from here.</p>
      </section>
    </div>
  );
}

function ModeCard({ k, value }: { k: ProtectedModeKey; value: ProtectedMatchMode }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [next, setNext] = useState<ProtectedMatchMode | null>(null);
  const [busy, run] = useBusy();
  const save = async () => {
    if (!next) return;
    const r = await run(() => client.setProtectedMode(actor, { key: k, value: next, reason: `Owner changed ${k}` }));
    setNext(null);
    if (r && check(r)) {
      notify('Saved. Press "Publish now" on the dashboard to apply it to the site.', r.data.undo);
      bump();
    }
  };
  return (
    <section className={cardCls} aria-label={TITLE[k]}>
      <h2 className="text-h4 font-bold text-heading">{TITLE[k]}</h2>
      <p className="mt-1 text-small text-fg-muted">{HELP[k]}</p>
      <div role="radiogroup" aria-label={TITLE[k]} className="mt-3 flex flex-col gap-2">
        {(['noindex_minimal', 'hidden'] as const).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={value === m}
            onClick={() => (m === value ? setNext(null) : setNext(m))}
            className={cx('min-h-tap rounded-md border-2 px-4 text-left font-bold', value === m ? 'border-ps-court bg-ps-court-tint text-ps-ink' : 'border-line-strong bg-surface text-fg')}
          >
            {MODE_LABEL[m]} {value === m ? '(current)' : ''}
          </button>
        ))}
      </div>
      {next ? (
        <Confirm
          title={`Change to "${MODE_LABEL[next]}"?`}
          body={next === 'noindex_minimal' && k === 'minor_match_mode' ? 'This would put a minimal video page online for players who may be under 18. Are you sure?' : 'This is recorded with your name and the time.'}
          confirmLabel="Change it"
          danger={next === 'noindex_minimal' && k === 'minor_match_mode'}
          busy={busy}
          onConfirm={() => void save()}
          onCancel={() => setNext(null)}
        />
      ) : null}
    </section>
  );
}
