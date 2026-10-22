import { useState } from 'react';
import type { ProtectedMatchMode } from '../../lib/archive/types';
import { PROTECTED_MODE_KEYS, type ProtectedModeKey } from '../../lib/admin/types';
import { MODE_LABEL } from '../messages';
import { Confirm, LoadState, cardCls, cx, useAdmin, useAsync, useBusy } from '../ui';

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
