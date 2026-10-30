// International events (D-112): the owner lists major international events with ONE link to the official page (BWF, tournament
// software, or a website the owner adds), edits them, hides or shows them. Nothing is copied from those sites: no results, draws,
// rankings, logos or player names. The screen takes its store as a prop (the integrator passes the admin client once AdminStore
// includes InternationalAdminStore).
import { useState } from 'react';
import type { InternationalAdminStore, InternationalEventDto, InternationalSettingsDto } from '../../../lib/admin/international/types';
import { internationalLinksFlag } from '../../../lib/international/in-build';
import { listText } from '../../../lib/international/link-rules';
import { Badge, Button, Confirm, Empty, Field, LoadState, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { ErrorText, H2, Input, Note, ReasonField, useAction } from '../competition/shared';
import {
  EMPTY_EVENT_FORM,
  eventPlace,
  eventWhen,
  formFromEvent,
  formProblems,
  hostsFromText,
  hostsProblem,
  hostsSavedText,
  savedText,
  stateText,
  toSaveInput,
  type EventForm,
} from './logic';

export function InternationalScreen({ store }: { store: InternationalAdminStore }) {
  const { data, error, loading } = useAsync(() => store.internationalList(), []);
  const [form, setForm] = useState<EventForm | null>(null);
  const pageOn = internationalLinksFlag();
  return (
    <div className="flex flex-col gap-6">
      <Note>
        List big international events here with ONE link to their official page. Power Smash does not copy results, draws, rankings, logos or player names from
        other websites: the page says &quot;Details and results on the official site&quot;.
        {pageOn ? '' : " The International events page is switched off (it needs your yes and the lawyer's), so nothing here is on the website yet."}
      </Note>
      <LoadState loading={loading} error={error}>
        {data ? (
          form ? (
            <EventEditor store={store} initial={form} settings={data.settings} onDone={() => setForm(null)} />
          ) : (
            <>
              <section aria-labelledby="intl-list-h" className={cardCls}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <H2 id="intl-list-h">International events</H2>
                  <Button variant="primary" onClick={() => setForm({ ...EMPTY_EVENT_FORM })}>
                    Add an event
                  </Button>
                </div>
                {data.events.length === 0 ? (
                  <div className="mt-3">
                    <Empty>No international events are listed yet.</Empty>
                  </div>
                ) : (
                  <ul className="mt-3 flex flex-col gap-3">
                    {data.events.map((e) => (
                      <EventItem key={e.id} store={store} event={e} pageOn={pageOn} onEdit={() => setForm(formFromEvent(e))} />
                    ))}
                  </ul>
                )}
              </section>
              <HostsCard store={store} settings={data.settings} />
            </>
          )
        ) : null}
      </LoadState>
    </div>
  );
}

function EventItem({ store, event: e, pageOn, onEdit }: { store: InternationalAdminStore; event: InternationalEventDto; pageOn: boolean; onEdit: () => void }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const toggle = async () => {
    const r = reason.trim();
    if (r.length < 3 || r.length > 500) {
      setReasonError('Write a short reason (3 to 500 characters).');
      return;
    }
    setReasonError(null);
    const res = await act.run(() => store.internationalSetPublished(actor, { id: e.id, published: !e.published, expectedRevision: e.revision, reason: r }));
    if (!res) return;
    setConfirm(false);
    setReason('');
    notify(!res.changed ? 'Nothing changed.' : res.published ? 'Event shown.' : 'Event hidden.');
    bump();
  };
  return (
    <li className="rounded-lg border border-line p-3" data-intl-event={e.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-heading">{e.name}</span>
        {e.published ? <Badge tone={e.onAllowList ? 'good' : 'warn'}>{e.onAllowList ? 'Shown' : 'Link not allowed'}</Badge> : <Badge>Hidden</Badge>}
      </div>
      {e.levelText ? <p className="text-small text-fg-muted">{e.levelText}</p> : null}
      <p className="text-small">{eventWhen(e)} &middot; {eventPlace(e)}</p>
      <p className="text-small text-fg-muted break-all">Link: {e.host}</p>
      <p className="mt-1 text-small">{stateText(e, pageOn)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button small onClick={onEdit}>
          Edit
        </Button>
        <Button small variant={e.published ? 'danger' : 'quiet'} onClick={() => setConfirm(true)}>
          {e.published ? 'Hide' : 'Show'}
        </Button>
        <a href={e.officialUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-tap items-center text-small font-semibold">
          Open the official page<span className="sr-only"> (new tab)</span>
        </a>
      </div>
      {confirm ? (
        <Confirm
          title={e.published ? 'Hide this event?' : 'Show this event?'}
          body={e.published ? 'It leaves the International events page at the next website update. You can show it again later.' : 'It appears on the International events page at the next website update.'}
          confirmLabel={e.published ? 'Hide' : 'Show'}
          danger={e.published}
          busy={act.busy}
          onConfirm={() => void toggle()}
          onCancel={() => {
            setConfirm(false);
            act.clear();
          }}
        >
          <ReasonField id={`intl-pub-reason-${e.id}`} value={reason} onChange={setReason} error={reasonError} />
          <ErrorText text={act.error} />
        </Confirm>
      ) : null}
    </li>
  );
}

function EventEditor({ store, initial, settings, onDone }: { store: InternationalAdminStore; initial: EventForm; settings: InternationalSettingsDto; onDone: () => void }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [f, setF] = useState<EventForm>(initial);
  const [local, setLocal] = useState<Record<string, string>>({});
  const errors = { ...act.fields, ...local };
  const hosts = [...settings.defaultHosts, ...settings.extraHosts];
  const set = (patch: Partial<EventForm>) => setF({ ...f, ...patch });
  const save = async () => {
    const problems = formProblems(f, settings.extraHosts);
    setLocal(problems);
    if (Object.keys(problems).length > 0) {
      act.fail('Please check the fields marked below.');
      return;
    }
    const r = await act.run(() => store.internationalSave(actor, toSaveInput(f)));
    if (!r) return;
    notify(savedText(r));
    bump();
    onDone();
  };
  const field = (key: keyof EventForm, label: string, opts: { hint?: string; type?: string; maxLength?: number; placeholder?: string } = {}) => (
    <Field label={label} htmlFor={`intl-${key}`} hint={opts.hint}>
      <Input id={`intl-${key}`} type={opts.type} value={String(f[key] ?? '')} maxLength={opts.maxLength} placeholder={opts.placeholder} onChange={(v) => set({ [key]: v } as Partial<EventForm>)} error={errors[key]} />
      <ErrorText id={`intl-${key}-error`} text={errors[key]} />
    </Field>
  );
  return (
    <section aria-labelledby="intl-edit-h" className={cardCls}>
      <H2 id="intl-edit-h">{f.id ? 'Edit the event' : 'Add an event'}</H2>
      <div className="mt-3 flex flex-col gap-4">
        {field('name', 'Event name', { maxLength: 160, hint: 'For example the name on the official page. Do not write player names.' })}
        {field('levelText', 'Level (optional)', { maxLength: 80, hint: 'Your own short words, for example the tour level.' })}
        {field('startDate', 'First day', { type: 'date', hint: 'Calendar date, read as India time.' })}
        {field('endDate', 'Last day', { type: 'date' })}
        {field('city', 'City (optional)', { maxLength: 60 })}
        {field('country', 'Country', { maxLength: 60 })}
        {field('officialUrl', 'Link to the official page', {
          type: 'url',
          maxLength: 500,
          placeholder: 'https://',
          hint: `Copy it from the address bar. Allowed websites: ${listText(hosts)} (with or without www.). Tracking parts such as utm_ are removed.`,
        })}
        <label className="flex min-h-tap items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={f.published} onChange={(e) => set({ published: e.target.checked })} />
          Show on the International events page
        </label>
        <ReasonField id="intl-reason" value={f.reason} onChange={(v) => set({ reason: v })} error={errors.reason} />
        <ErrorText text={act.error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" busy={act.busy} onClick={() => void save()}>
            {f.id ? 'Save the event' : 'Add the event'}
          </Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
      </div>
    </section>
  );
}

function HostsCard({ store, settings }: { store: InternationalAdminStore; settings: InternationalSettingsDto }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [text, setText] = useState(settings.extraHosts.join('\n'));
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState<{ hosts?: string; reason?: string }>({});
  const save = async () => {
    const hp = hostsProblem(text);
    const r = reason.trim();
    const next = { hosts: hp ?? undefined, reason: r.length < 3 || r.length > 500 ? 'Write a short reason (3 to 500 characters).' : undefined };
    setLocal(next);
    if (next.hosts || next.reason) return;
    const res = await act.run(() => store.internationalSaveHosts(actor, { hosts: hostsFromText(text), reason: r }));
    if (!res) return;
    setText(res.hosts.join('\n'));
    setReason('');
    notify(hostsSavedText(res));
    bump();
  };
  const hostsError = local.hosts ?? act.fields.hosts;
  return (
    <section aria-labelledby="intl-hosts-h" className={cardCls}>
      <H2 id="intl-hosts-h">Allowed websites</H2>
      <p className="mt-2 text-small">Always allowed: {listText(settings.defaultHosts)}. Add another official website only if an event has no page on these.</p>
      <div className="mt-3 flex flex-col gap-4">
        <Field label="More allowed websites (one per line)" htmlFor="intl-hosts" hint="Only the website name, such as example.org. Link shorteners and names in other alphabets are not accepted.">
          <textarea
            id="intl-hosts"
            className={`${inputCls} min-h-[5rem]`}
            value={text}
            aria-invalid={hostsError ? true : undefined}
            aria-describedby={hostsError ? 'intl-hosts-error' : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <ErrorText id="intl-hosts-error" text={hostsError} />
        </Field>
        <ReasonField id="intl-hosts-reason" value={reason} onChange={setReason} error={local.reason} />
        <ErrorText text={act.error} />
        <div>
          <Button variant="primary" busy={act.busy} onClick={() => void save()}>
            Save the websites
          </Button>
        </div>
      </div>
    </section>
  );
}
