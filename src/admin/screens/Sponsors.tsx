// Sponsor placements: add one (always a draft), switch on, pause, end. Uses the slot list and the validators of src/lib/placements.
import { useState } from 'react';
import type { Placement } from '../../lib/placements/schedule';
import { slotsAvailableInM3, SLOTS, PLACEMENT_LABELS } from '../../lib/placements/slots';
import type { PlacementCreateInput } from '../../lib/admin/types';
import { Badge, Button, Confirm, Empty, Field, LoadState, TextInput, cardCls, inputCls, useAdmin, useAsync, useBusy } from '../ui';

const STATUS_TONE = { draft: 'neutral', active: 'good', paused: 'warn', ended: 'neutral' } as const;

export function Sponsors() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listPlacements(), []);
  const [adding, setAdding] = useState(false);
  const data = q.data;
  const sponsorName = (id: string) => data?.sponsors.find((s) => s.id === id)?.name ?? 'Unknown sponsor';
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Sponsor placements on the site. A new placement starts as a draft, then you switch it on. Sponsors and image uploads are added in Supabase for now.</p>
      <div><Button variant="primary" onClick={() => setAdding(!adding)}>{adding ? 'Close the form' : 'Add a placement'}</Button></div>
      <LoadState loading={q.loading} error={q.error}>
        {adding && data ? <PlacementForm sponsors={data.sponsors} onDone={() => setAdding(false)} /> : null}
        {data && data.placements.length > 0 ? data.placements.map((p) => <PlacementCard key={p.id} p={p} sponsor={sponsorName(p.sponsorId)} />) : <Empty>No placements yet.</Empty>}
      </LoadState>
    </div>
  );
}

function PlacementCard({ p, sponsor }: { p: Placement; sponsor: string }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [to, setTo] = useState<'active' | 'paused' | 'ended' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const go = async (status: 'active' | 'paused' | 'ended') => {
    setError(null);
    const r = await run(() => client.setPlacementStatus(actor, { id: p.id, status: status }));
    setTo(null);
    if (!r) return;
    if (check(r)) {
      notify(status === 'active' ? 'Switched on.' : status === 'paused' ? 'Paused.' : 'Ended.');
      bump();
    } else if (r.errors?.status) setError(r.errors.status);
  };
  return (
    <article className={cardCls}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
        <Badge>{p.label}</Badge>
        <span className="text-small text-fg-muted">{SLOTS[p.slot].title}</span>
      </div>
      <p className="mt-2 font-bold">{sponsor}</p>
      <p className="text-small text-fg-muted">{p.startDate} to {p.endDate} · priority {p.priority} · link /go/{p.goSlug}</p>
      {error ? <p role="alert" className="mt-1 font-semibold text-ps-live">{error}</p> : null}
      {p.status !== 'ended' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.status !== 'active' ? <Button small variant="primary" onClick={() => setTo('active')}>Switch on</Button> : null}
          {p.status === 'active' ? <Button small onClick={() => setTo('paused')}>Pause</Button> : null}
          <Button small onClick={() => setTo('ended')}>End</Button>
        </div>
      ) : null}
      {to ? <Confirm title={to === 'active' ? 'Switch this placement on?' : to === 'paused' ? 'Pause this placement?' : 'End this placement for good?'} body={to === 'active' ? 'It shows on the site as soon as its start date arrives.' : to === 'paused' ? 'It stops showing. You can switch it on again.' : 'An ended placement cannot be switched on again. Its counters stay.'} confirmLabel="Yes" danger={to === 'ended'} busy={busy} onConfirm={() => void go(to)} onCancel={() => setTo(null)} /> : null}
    </article>
  );
}

function PlacementForm({ sponsors, onDone }: { sponsors: { id: string; name: string; active: boolean }[]; onDone: () => void }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const slots = slotsAvailableInM3();
  const [f, setF] = useState({ sponsorId: sponsors.find((s) => s.active)?.id ?? '', slot: slots[0]?.key ?? '', scopeKey: '', creativeDesktopPath: '', creativeMobilePath: '', alt: '', headline: '', targetUrl: '', goSlug: '', startDate: '', endDate: '', priority: '0', label: 'Sponsored' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [busy, run] = useBusy();
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const input: PlacementCreateInput = {
      sponsorId: f.sponsorId,
      slot: f.slot,
      scopeKey: f.scopeKey.trim() || null,
      creativeDesktopPath: f.creativeDesktopPath.trim() || null,
      creativeMobilePath: f.creativeMobilePath.trim() || null,
      alt: f.alt,
      headline: f.headline.trim() || null,
      targetUrl: f.targetUrl,
      goSlug: f.goSlug.trim(),
      startDate: f.startDate,
      endDate: f.endDate,
      priority: Number.parseInt(f.priority, 10) || 0,
      label: f.label,
    };
    const r = await run(() => client.createPlacement(actor, input));
    setAsking(false);
    if (!r) return;
    if (check(r)) {
      notify('Placement saved as a draft. Switch it on when you are ready.');
      bump();
      onDone();
    } else setErrors(r.errors ?? {});
  };
  const err = (k: string) => (errors[k] ? <p role="alert" className="font-semibold text-ps-live">{errors[k]}</p> : null);
  return (
    <form className={`${cardCls} flex flex-col gap-3`} onSubmit={(e) => { e.preventDefault(); setErrors({}); setAsking(true); }}>
      <h2 className="text-h4 font-bold text-heading">New placement</h2>
      <Field label="Sponsor" htmlFor="pl-sponsor">
        <select id="pl-sponsor" className={inputCls} value={f.sponsorId} onChange={(e) => set('sponsorId')(e.target.value)}>
          {sponsors.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      {err('sponsorId')}
      <Field label="Where it shows" htmlFor="pl-slot">
        <select id="pl-slot" className={inputCls} value={f.slot} onChange={(e) => set('slot')(e.target.value)}>
          {slots.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
        </select>
      </Field>
      {err('slot')}
      {f.slot && SLOTS[f.slot as keyof typeof SLOTS]?.scoped !== 'none' ? (
        <Field label="Tournament page name (the tournament address)" htmlFor="pl-scope" hint={SLOTS[f.slot as keyof typeof SLOTS]?.scoped === 'required' ? 'Needed for this slot.' : 'Leave empty for every tournament page.'}>
          <TextInput id="pl-scope" value={f.scopeKey} onChange={set('scopeKey')} />
        </Field>
      ) : null}
      {err('scopeKey')}
      <Field label="Image file name (already uploaded to the images bucket)" htmlFor="pl-img"><TextInput id="pl-img" value={f.creativeDesktopPath} onChange={set('creativeDesktopPath')} placeholder="creatives/shop-banner.png" /></Field>
      <Field label="Phone-size image (optional)" htmlFor="pl-img2"><TextInput id="pl-img2" value={f.creativeMobilePath} onChange={set('creativeMobilePath')} /></Field>
      {err('creative')}
      <Field label="Describe the image in a few words" htmlFor="pl-alt"><TextInput id="pl-alt" value={f.alt} onChange={set('alt')} /></Field>
      {err('alt')}
      <Field label="Headline (optional)" htmlFor="pl-head"><TextInput id="pl-head" value={f.headline} onChange={set('headline')} maxLength={80} /></Field>
      {err('headline')}
      <Field label="Sponsor's page address" htmlFor="pl-url" hint="Must start with https:// and be on the sponsor's own website."><TextInput id="pl-url" value={f.targetUrl} onChange={set('targetUrl')} type="url" /></Field>
      {err('targetUrl')}
      <Field label="Short link name" htmlFor="pl-go" hint="Lower-case letters, digits and hyphens. The link becomes /go/<name>."><TextInput id="pl-go" value={f.goSlug} onChange={set('goSlug')} /></Field>
      {err('goSlug')}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" htmlFor="pl-start"><input id="pl-start" type="date" className={inputCls} value={f.startDate} onChange={(e) => set('startDate')(e.target.value)} /></Field>
        <Field label="End date" htmlFor="pl-end"><input id="pl-end" type="date" className={inputCls} value={f.endDate} onChange={(e) => set('endDate')(e.target.value)} /></Field>
      </div>
      {err('startDate')}{err('endDate')}
      <Field label="Priority (0 to 100, higher wins)" htmlFor="pl-pri"><TextInput id="pl-pri" value={f.priority} onChange={set('priority')} inputMode="numeric" /></Field>
      {err('priority')}
      <Field label="Label shown with it" htmlFor="pl-label">
        <select id="pl-label" className={inputCls} value={f.label} onChange={(e) => set('label')(e.target.value)}>
          {PLACEMENT_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      {err('label')}
      <div><Button type="submit" variant="primary">Review and save as draft</Button></div>
      {asking ? <Confirm title="Save this placement as a draft?" body="It will not show on the site until you switch it on." confirmLabel="Save draft" busy={busy} onConfirm={() => void save()} onCancel={() => setAsking(false)} /> : null}
    </form>
  );
}
