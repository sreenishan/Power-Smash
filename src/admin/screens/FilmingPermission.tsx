// A tournament's filming permission (D-019, D-105): the owner records what the organizer agreed. Private: it holds the person's name and
// never reaches the site. No record = "Not recorded" (fail closed). D-019 is still waiting for the owner's approval and a lawyer's
// review of the templates; this screen only stores what the owner states.
import { useState } from 'react';
import { EXCLUSIVE_PARTNER, PERMISSION_LIMITS, PERMISSION_STATUSES, STATUS_LABEL, changedPermissionFields, validatePermission, type FilmingPermission, type PermissionInput } from '../../lib/admin/filming-permission';
import { todayIst } from '../../lib/dates';
import { Button, Confirm, Field, LoadState, TextInput, inputCls, useAdmin, useAsync, useBusy } from '../ui';

const PARTNER_LABEL = { unknown: 'Not known', yes: 'Yes', no: 'No' } as const;
const FIELD_WORDS: Record<keyof FilmingPermission, string> = {
  status: 'status', grantedByName: 'who', grantedByRole: 'their role', grantedOn: 'date', scopeFilming: 'filming', scopeYoutube: 'YouTube',
  scopeLiveStream: 'live stream', scopeSponsorOverlays: 'sponsor overlays', exclusivePartner: 'exclusive media partner', documentRef: 'where the proof is',
};

export function FilmingPermissionPanel({ tournamentId, tournamentName, onDone }: { tournamentId: string; tournamentName: string; onDone: () => void }) {
  const { client } = useAdmin();
  const q = useAsync(() => client.getFilmingPermission({ tournamentId }), [tournamentId]);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <LoadState loading={q.loading && !q.data} error={q.error}>
        {q.data ? <PermissionForm tournamentId={tournamentId} tournamentName={tournamentName} initial={q.data} onDone={onDone} /> : null}
      </LoadState>
    </div>
  );
}

function PermissionForm({ tournamentId, tournamentName, initial, onDone }: { tournamentId: string; tournamentName: string; initial: FilmingPermission; onDone: () => void }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [f, setF] = useState<PermissionInput>(() => ({ ...initial }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string[] | null>(null);
  const [busy, run] = useBusy();
  const set = <K extends keyof PermissionInput>(k: K, v: PermissionInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const id = (k: string) => `fp-${k}-${tournamentId}`;
  const err = (k: string) => (errors[k] ? <p role="alert" className="font-semibold text-ps-live">{errors[k]}</p> : null);
  const granted = f.status === 'granted';

  const review = () => {
    const v = validatePermission(f, todayIst());
    setErrors(v.ok ? {} : (v.errors as Record<string, string>));
    if (v.ok) setAsking(changedPermissionFields(initial, v.value).map((k) => FIELD_WORDS[k]));
  };
  const save = async () => {
    const r = await run(() => client.setFilmingPermission(actor, { ...f, tournamentId, reason: 'Filming permission recorded by owner' }));
    setAsking(null);
    if (!r) return;
    if (check(r)) {
      notify(r.data.fields.length > 0 ? 'Filming permission saved.' : 'Nothing to change.');
      bump();
      onDone();
    } else setErrors(r.errors ?? {});
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); review(); }}>
      <p className="text-small text-fg-muted">What the organizer agreed for this tournament. Only you see this; it never appears on the site. Keep the WhatsApp message or letter itself safe, and write below where it is.</p>
      <Field label="Filming permission" htmlFor={id('status')}>
        <select id={id('status')} className={inputCls} value={f.status} onChange={(e) => set('status', e.target.value)}>
          {PERMISSION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      {err('status')}
      <Field label={granted ? 'Who gave permission' : 'Who gave permission (optional)'} htmlFor={id('name')}>
        <TextInput id={id('name')} value={f.grantedByName ?? ''} onChange={(v) => set('grantedByName', v)} maxLength={PERMISSION_LIMITS.grantedByName + 20} />
      </Field>
      {err('grantedByName')}
      <Field label={granted ? 'Their role' : 'Their role (optional)'} htmlFor={id('role')} hint='For example "Secretary, district association".'>
        <TextInput id={id('role')} value={f.grantedByRole ?? ''} onChange={(v) => set('grantedByRole', v)} maxLength={PERMISSION_LIMITS.grantedByRole + 20} />
      </Field>
      {err('grantedByRole')}
      <Field label={granted ? 'Date given' : 'Date given (optional)'} htmlFor={id('on')} hint="For example 2026-10-12. Today or earlier.">
        <TextInput id={id('on')} value={f.grantedOn ?? ''} onChange={(v) => set('grantedOn', v)} placeholder="YYYY-MM-DD" maxLength={20} />
      </Field>
      {err('grantedOn')}
      <fieldset>
        <legend className="text-small font-bold uppercase tracking-wider text-fg">What it covers</legend>
        {([['scopeFilming', 'Filming the matches'], ['scopeYoutube', 'Publishing and earning on YouTube'], ['scopeLiveStream', 'A live stream'], ['scopeSponsorOverlays', 'Sponsor logos on the video']] as const).map(([k, label]) => (
          <label key={k} className="flex min-h-tap items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />{label}</label>
        ))}
      </fieldset>
      {err('scopeFilming')}
      <Field label="Another media partner has exclusive rights?" htmlFor={id('partner')}>
        <select id={id('partner')} className={inputCls} value={f.exclusivePartner} onChange={(e) => set('exclusivePartner', e.target.value)}>
          {EXCLUSIVE_PARTNER.map((p) => <option key={p} value={p}>{PARTNER_LABEL[p]}</option>)}
        </select>
      </Field>
      {err('exclusivePartner')}
      <Field label="Where the proof is (optional)" htmlFor={id('ref')} hint='For example "WhatsApp from the secretary, saved in Drive".'>
        <TextInput id={id('ref')} value={f.documentRef ?? ''} onChange={(v) => set('documentRef', v)} maxLength={PERMISSION_LIMITS.documentRef + 20} />
      </Field>
      {err('documentRef')}
      <div><Button type="submit" variant="primary">Review and save</Button></div>
      {asking ? (
        <Confirm
          title={`Save the filming permission for "${tournamentName}"?`}
          body={asking.length > 0 ? `You are changing: ${asking.join(', ')}. The change is recorded with your name; the person's name is not copied into the record of changes.` : 'Nothing has changed.'}
          confirmLabel="Save"
          busy={busy}
          onConfirm={() => void save()}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </form>
  );
}
