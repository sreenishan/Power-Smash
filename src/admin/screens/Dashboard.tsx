import { useState } from 'react';
import type { EmergencyHideOutcome } from '../../lib/admin/types';
import { SUPPRESSION_KINDS } from '../../lib/archive/types';
import { hashFor, MODE_LABEL, type AdminRoute } from '../messages';
import { Badge, Button, Confirm, Empty, Field, Icon, LoadState, TextInput, cardCls, cx, inputCls, useAdmin, useAsync, useBusy } from '../ui';

const KIND_LABEL: Record<(typeof SUPPRESSION_KINDS)[number], string> = {
  player_id: 'A player (by player id)',
  name_normalized: 'Everyone with this name',
  youtube_id: 'A video (by YouTube video id)',
  tournament_id: 'A tournament (by tournament id)',
};

const CHECKLIST: Record<string, string> = {
  deploy_now: 'Publish the site now (done for you when the key is set up; otherwise press "Publish now").',
  purge_cache_for_urls: 'Clear Cloudflare cache for the affected web addresses.',
  set_youtube_video_private: 'Set the YouTube video to private or unlisted in YouTube Studio.',
  search_console_removals_request: 'Send a Removals request in Google Search Console.',
};

function Stat(props: { label: string; value: number; to: AdminRoute }) {
  return (
    <a href={hashFor(props.to)} className={cx('ps-admin-card ps-admin-kpi', props.value === 0 && 'is-zero')}>
      <span className="ps-admin-kpi-value">
        {props.value}
        <Icon name="chevronRight" size={20} />
      </span>
      <span className="ps-admin-kpi-label">{props.label}</span>
    </a>
  );
}

export function Dashboard() {
  const { client, notify, check, bump } = useAdmin();
  const dash = useAsync(() => client.getDashboard(), []);
  const audit = useAsync(() => client.listAudit({ limit: 8 }), []);
  const [busy, run] = useBusy();
  const [confirm, setConfirm] = useState<'sync' | 'publish' | null>(null);

  const dispatch = async (kind: 'sync' | 'publish') => {
    const r = await run(() => (kind === 'sync' ? client.syncNow() : client.publishNow()));
    setConfirm(null);
    if (r && check(r)) notify(r.data.dispatched ? (kind === 'sync' ? 'Sync requested. New videos appear in a few minutes.' : 'Publish requested. The site updates in a few minutes.') : 'Preview mode: nothing was sent.');
    bump();
  };

  return (
    <div className="flex flex-col gap-5">
      <LoadState loading={dash.loading} error={dash.error}>
        {dash.data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Videos to check" value={dash.data.needsReview} to="videos" />
              <Stat label="Possible duplicate players" value={dash.data.duplicatePairs} to="players" />
              <Stat label="Player requests" value={dash.data.openProfileRequests} to="players" />
              <Stat label="Tournaments to decide" value={dash.data.tournamentCandidates} to="tournaments" />
            </div>
            <section className={cardCls} aria-label="Site status">
              <h2 className="text-h4 font-bold text-heading">Site</h2>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {dash.data.siteDirty ? <Badge tone="warn">Changes waiting to be published</Badge> : <Badge tone="good">Up to date</Badge>}{' '}
                {dash.data.lastDeployAt ? <span className="text-small text-fg-muted">Last publish: {new Date(dash.data.lastDeployAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span> : null}
              </p>
              <p className="mt-3 max-w-prose text-small text-fg-muted">
                Unknown-age players: {MODE_LABEL[dash.data.protectedModes.unknown_match_mode]}. Possible minors: {MODE_LABEL[dash.data.protectedModes.minor_match_mode]}.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button onClick={() => setConfirm('sync')}>Sync videos now</Button>
                <Button variant="primary" onClick={() => setConfirm('publish')}>Publish now</Button>
              </div>
              {confirm ? (
                <Confirm
                  title={confirm === 'sync' ? 'Fetch new videos from YouTube now?' : 'Publish the site now?'}
                  body={confirm === 'sync' ? 'This asks the sync job to run. It uses a little of the daily YouTube quota.' : 'This rebuilds and publishes the public site with everything you changed.'}
                  confirmLabel={confirm === 'sync' ? 'Sync now' : 'Publish now'}
                  busy={busy}
                  onConfirm={() => void dispatch(confirm)}
                  onCancel={() => setConfirm(null)}
                />
              ) : null}
            </section>
          </>
        ) : null}
      </LoadState>

      <EmergencyHide />

      <section className={cardCls} aria-label="Recent activity">
        <h2 className="text-h4 font-bold text-heading">Recent activity</h2>
        <LoadState loading={audit.loading} error={audit.error}>
          {audit.data && audit.data.length > 0 ? (
            <ul className="mt-2 divide-y divide-line">
              {audit.data.map((a) => (
                <li key={a.id} className="py-2 text-small">
                  <span className="font-semibold">{a.action}</span> <span className="text-fg-muted">{new Date(a.ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                  {a.reason ? <span className="block text-fg-muted">{a.reason}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing yet.</Empty>
          )}
        </LoadState>
      </section>
    </div>
  );
}

function EmergencyHide() {
  const { client, actor, notify, check, bump } = useAdmin();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof SUPPRESSION_KINDS)[number]>('player_id');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, run] = useBusy();
  const [outcome, setOutcome] = useState<(EmergencyHideOutcome & { deploy?: string }) | null>(null);

  const ready = value.trim() !== '' && reason.trim().length >= 3;
  const hide = async () => {
    const r = await run(() => client.emergencyHide(actor, { kind, value: value.trim(), reason: reason.trim() }));
    setAsking(false);
    if (r && check(r)) {
      setOutcome({ ...r.data.result, deploy: (r.data as unknown as { deploy?: string }).deploy });
      notify('Hidden. Now finish the checklist below.', r.data.undo);
      setValue('');
      setReason('');
      bump();
    }
  };

  return (
    <section className={cardCls} aria-label="Emergency hide">
      <h2 className="text-h4 font-bold text-heading">Emergency hide</h2>
      <p className="max-w-prose text-small text-fg-muted">Takes something off the public site at once and stops it coming back on the next sync. Use for takedown requests.</p>
      {!open ? (
        <div className="mt-4 grid grid-cols-1 sm:flex">
          <Button onClick={() => setOpen(true)}>Open</Button>
        </div>
      ) : (
        <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (ready) setAsking(true); }}>
          <Field label="What to hide" htmlFor="eh-kind">
            <select id="eh-kind" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {SUPPRESSION_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Id or name" htmlFor="eh-value">
            <TextInput id="eh-value" value={value} onChange={setValue} />
          </Field>
          <Field label="Reason (kept in the audit trail)" htmlFor="eh-reason">
            <TextInput id="eh-reason" value={reason} onChange={setReason} />
          </Field>
          <div><Button type="submit" variant="danger" disabled={!ready}>Hide now</Button></div>
          {asking ? (
            <Confirm title="Hide this now?" body="It disappears from the site after the next publish and is blocked from coming back. You can release it later from the Undo button." confirmLabel="Yes, hide it" danger busy={busy} onConfirm={() => void hide()} onCancel={() => setAsking(false)} />
          ) : null}
        </form>
      )}
      {outcome ? (
        <div className="ps-admin-row mt-4 p-3" role="status">
          <p className="font-bold">Hidden at {new Date(outcome.hiddenAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
          <p className="text-small text-fg-muted">
            Videos {outcome.videosHidden}, players {outcome.playersHidden}, tournaments {outcome.tournamentsHidden}, web addresses removed {outcome.redirectsRemoved}.
            {outcome.deploy === 'requested' ? ' Publish requested.' : outcome.deploy === 'failed' ? ' Publish could not be requested: press Publish now.' : ' Publish is not set up: press Publish now.'}
          </p>
          <p className="mt-2 font-semibold">Only you can do these:</p>
          <ul className="list-disc pl-5">
            {outcome.ownerChecklist.map((c) => (
              <li key={c}>{CHECKLIST[c] ?? c}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
