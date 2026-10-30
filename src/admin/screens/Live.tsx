// Live: pin the stream that shows at the top of /live, and list older streams (spec 7.13, D-101). The owner pastes YouTube links from the
// phone; the shared rule (src/lib/live/rules.ts) reads the video id from them. The player itself shows only when the YouTube-embeds legal
// switch is on; otherwise the page links to YouTube.
import { useState } from 'react';
import { LIVE_LIMITS, validateLiveEdit, type LiveSettings } from '../../lib/live/rules';
import { Badge, Button, Confirm, Field, LoadState, TextInput, cardCls, useAdmin, useAsync, useBusy } from '../ui';

type Row = { key: number; video: string; title: string; date: string };

// Until the owner approves the build switch PS_LIVE_SOURCE=supabase (D-101), the public page still reads src/content/live.ts, so the screen
// must not promise that a save reaches the site. Remove this note in the change that switches the source on.
export const LIVE_SWITCH_NOTE =
  'Not on the site yet: the public Live page still uses the settings written into the website code. What you save here starts to show only after the one-time "Live page from the admin" switch is turned on (it needs your yes). After that, each save shows at the next publish.';

export function Live() {
  const { client } = useAdmin();
  const q = useAsync(() => client.getLive(), []);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Pin a stream to show it at the top of the Live page. Paste the link from YouTube; you do not need to find the video id yourself.</p>
      <p className="rounded-lg border-2 border-ps-live bg-ps-live-tint p-3 text-small text-ps-ink">{LIVE_SWITCH_NOTE}</p>
      <LoadState loading={q.loading} error={q.error}>
        {q.data ? <LiveForm initial={q.data} /> : null}
      </LoadState>
    </div>
  );
}

let nextKey = 1;
const rowsOf = (s: LiveSettings): Row[] => s.pastStreams.map((p) => ({ key: nextKey++, video: p.videoId, title: p.title, date: p.date ?? '' }));

function LiveForm({ initial }: { initial: LiveSettings }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [pinned, setPinned] = useState(initial.pinnedVideoId ?? '');
  const [rows, setRows] = useState<Row[]>(() => rowsOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [busy, run] = useBusy();

  const input = () => ({ pinned, past: rows.map((r) => ({ video: r.video, title: r.title, date: r.date === '' ? null : r.date })) });
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // row errors are keyed by position (past.<n>.*): any change to the list's order or length makes them point at the wrong row, so drop them
  const clearRowErrors = () => setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('past.'))));
  const removeRow = (key: number) => {
    clearRowErrors();
    setRows((rs) => rs.filter((x) => x.key !== key));
  };
  const addRow = () => {
    clearRowErrors();
    setRows((rs) => [...rs, { key: nextKey++, video: '', title: '', date: '' }]);
  };
  const move = (i: number, by: -1 | 1) => {
    clearRowErrors();
    setRows((rs) => {
      const j = i + by;
      if (j < 0 || j >= rs.length) return rs;
      const out = [...rs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });
  };

  const review = () => {
    const v = validateLiveEdit(input());
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) setAsking(true);
  };
  const save = async () => {
    const res = await run(() => client.saveLive(actor, { ...input(), reason: 'Live page edited by owner' }));
    setAsking(false);
    if (!res) return;
    if (check(res)) {
      setErrors({});
      setPinned(res.data.settings.pinnedVideoId ?? '');
      setRows(rowsOf(res.data.settings));
      notify(res.data.fields.length > 0 ? 'Saved in the admin. It is not on the site until the Live page switch is on (see the note at the top).' : 'Nothing to change.');
      bump();
    } else setErrors(res.errors ?? {});
  };
  const err = (k: string) => (errors[k] ? <p role="alert" className="font-semibold text-ps-live">{errors[k]}</p> : null);
  const v = validateLiveEdit(input());
  const pinnedNow = v.ok ? v.value.pinnedVideoId : null;

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); review(); }}>
      <section className={cardCls} aria-labelledby="live-pin-title">
        <h2 id="live-pin-title" className="text-body font-bold">Pinned stream</h2>
        <p className="mt-1"><Badge tone={initial.pinnedVideoId ? 'good' : 'neutral'}>{initial.pinnedVideoId ? `Pinned: ${initial.pinnedVideoId}` : 'Nothing pinned'}</Badge></p>
        <div className="mt-3">
          <Field label="Pinned stream: YouTube link or video id" htmlFor="live-pinned" hint="Leave it empty when the stream is over.">
            <TextInput id="live-pinned" value={pinned} onChange={setPinned} placeholder="https://youtube.com/live/..." maxLength={300} />
          </Field>
          {err('pinned')}
          {pinned.trim() !== '' ? <div className="mt-2"><Button small onClick={() => setPinned('')}>Clear the pin</Button></div> : null}
        </div>
      </section>

      <section className={cardCls} aria-labelledby="live-past-title">
        <h2 id="live-past-title" className="text-body font-bold">Past streams</h2>
        <p className="mt-1 text-small text-fg-muted">Shown under the pinned stream, in this order. Type each title exactly as YouTube shows it. Up to {LIVE_LIMITS.pastStreams}.</p>
        <ol className="mt-3 flex flex-col gap-4">
          {rows.map((r, i) => (
            <li key={r.key} className="flex flex-col gap-2 border-t border-line pt-3">
              <p className="text-small font-bold">Past stream {i + 1}</p>
              <Field label={`Past stream ${i + 1}: YouTube link or video id`} htmlFor={`live-v-${r.key}`}>
                <TextInput id={`live-v-${r.key}`} value={r.video} onChange={(x) => setRow(r.key, { video: x })} maxLength={300} />
              </Field>
              {err(`past.${i}.video`)}
              <Field label={`Past stream ${i + 1}: title, exactly as on YouTube`} htmlFor={`live-t-${r.key}`}>
                <TextInput id={`live-t-${r.key}`} value={r.title} onChange={(x) => setRow(r.key, { title: x })} maxLength={LIVE_LIMITS.title + 20} />
              </Field>
              {err(`past.${i}.title`)}
              <Field label={`Past stream ${i + 1}: date (optional)`} htmlFor={`live-d-${r.key}`} hint="For example 2026-10-01.">
                <TextInput id={`live-d-${r.key}`} value={r.date} onChange={(x) => setRow(r.key, { date: x })} placeholder="YYYY-MM-DD" maxLength={20} />
              </Field>
              {err(`past.${i}.date`)}
              <div className="flex flex-wrap gap-2">
                <Button small onClick={() => move(i, -1)} disabled={i === 0}>Move up</Button>
                <Button small onClick={() => move(i, 1)} disabled={i === rows.length - 1}>Move down</Button>
                <Button small variant="danger" onClick={() => removeRow(r.key)}>Remove</Button>
              </div>
            </li>
          ))}
        </ol>
        {rows.length < LIVE_LIMITS.pastStreams ? (
          <div className="mt-3"><Button small onClick={addRow}>Add a past stream</Button></div>
        ) : null}
      </section>

      {err('form')}
      <div><Button type="submit" variant="primary">Review and save</Button></div>
      {asking ? (
        <Confirm
          title="Save the Live page?"
          body={pinnedNow ? `The stream ${pinnedNow} is pinned, with ${rows.length} past ${rows.length === 1 ? 'stream' : 'streams'}. It shows on the site only once the Live page switch is on.` : `No stream is pinned, with ${rows.length} past ${rows.length === 1 ? 'stream' : 'streams'}. It shows on the site only once the Live page switch is on.`}
          confirmLabel="Save"
          busy={busy}
          onConfirm={() => void save()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </form>
  );
}
