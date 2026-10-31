// Title check (spec 10.8): type a planned YouTube title, see how the site will read it. Pure logic in src/lib/admin/title-check.ts.
// Nothing is sent anywhere: the title is read in the browser.
import { useMemo, useState } from 'react';
import { checkTitle, YOUTUBE_TITLE_MAX } from '../../lib/admin/title-check';
import { Badge, Button, Empty, Field, cardCls, inputCls, useAdmin } from '../ui';

export function TitleCheck() {
  const { notify } = useAdmin();
  const [title, setTitle] = useState('');
  const result = useMemo(() => (title.trim() === '' ? null : checkTitle(title)), [title]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Copied.');
    } catch {
      notify('Could not copy. Press and hold the text to copy it.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Type or paste the title you plan to use on YouTube. Nothing is saved or sent. The reading is the one the site uses.</p>
      <Field label="Planned YouTube title" htmlFor="tc-title" hint={`${title.length} of ${YOUTUBE_TITLE_MAX} characters (YouTube cuts it there).`}>
        <textarea id="tc-title" className={inputCls} rows={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Player A vs Player B || MS Final || Tournament name 2026" />
      </Field>
      {result === null ? (
        <Empty>Type a title above to see how it is read.</Empty>
      ) : (
        <div className="flex flex-col gap-4" aria-live="polite">
          {result.ageWarning ? <p role="alert" className="rounded-lg border border-ps-live border-l-4 bg-ps-live-tint p-4 font-semibold text-ps-ink">{result.ageWarning}</p> : null}

          <section className={cardCls} aria-label="Verdict">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={result.verdict.accepted ? 'good' : 'warn'}>{result.verdict.accepted ? 'Will auto-accept' : 'Will need review'}</Badge>
              <span className="font-bold">{result.verdict.headline}</span>
            </p>
            {result.verdict.reasons.length > 0 ? <ul className="mt-2 list-disc pl-5 text-small">{result.verdict.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
            <p className="mt-2 text-small text-fg-muted">Confidence: <span className="ps-num font-semibold">{result.confidencePoints}</span> of 100. Anything under 70, or any warning above, goes to Videos to check.</p>
          </section>

          <section className={cardCls} aria-label="How it is read">
            <h2 className="text-h4 font-bold text-heading">How the site reads it <span className="text-small font-normal text-fg-muted">(details by Power Smash)</span></h2>
            {result.kind === 'not_a_match' ? (
              <p className="mt-1">{result.notAMatchWhy}</p>
            ) : (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-fg-muted">Side A</dt><dd>{result.sideA.join(' and ') || 'not found'}</dd>
                <dt className="text-fg-muted">Side B</dt><dd>{result.sideB.join(' and ') || 'not found'}</dd>
                <dt className="text-fg-muted">Category</dt><dd>{result.category ?? 'not found'}</dd>
                <dt className="text-fg-muted">Age group</dt><dd>{result.ageGroup ?? 'none (treated as open)'}</dd>
                <dt className="text-fg-muted">Round</dt><dd>{result.round ?? 'not found'}</dd>
                <dt className="text-fg-muted">Tournament</dt><dd>{result.tournament ?? 'not found'}</dd>
                <dt className="text-fg-muted">Year</dt><dd>{result.year === null ? 'not found' : `${result.year} (${result.yearNote})`}</dd>
                <dt className="text-fg-muted">Place</dt><dd>{result.location ?? 'not found'}</dd>
              </dl>
            )}
          </section>

          {result.suggestions.length > 0 ? (
            <section className={cardCls} aria-label="Suggestions">
              <h2 className="text-h4 font-bold text-heading">To match the title convention</h2>
              <ul className="mt-2 list-disc pl-5 text-small">{result.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>
          ) : (
            <p role="status" className="text-small font-semibold">This title follows the convention.</p>
          )}

          {result.correctedTitle && result.correctedDiffers ? (
            <section className={cardCls} aria-label="Corrected title">
              <h2 className="text-h4 font-bold text-heading">A cleaner title</h2>
              <p className="mt-1 break-words font-semibold" data-testid="corrected-title">{result.correctedTitle}</p>
              <p className="mt-1 text-small text-fg-muted">Built from what was found. Check the spelling of names, then copy it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button small variant="primary" onClick={() => void copy(result.correctedTitle!)}>Copy this title</Button>
                <Button small onClick={() => setTitle(result.correctedTitle!)}>Use it above</Button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
