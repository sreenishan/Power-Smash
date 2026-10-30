// The rally-by-rally scoring console (D-113). Made for a phone at the court: two big buttons (a point to side A or side B), Undo, and
// Start / Pause / Resume / End. The engine's cues (interval at 11, change of ends, who serves from which court) are shown after every
// tap. Taps are sent one at a time with their own key; with no connection they wait (in memory) and are sent again automatically
// (logic.ts). Ending writes the result from the rally log as UNCONFIRMED: it reaches the website only after it is confirmed on the
// Results screen.
// The screen takes its store as a prop (the integrator passes the admin client once AdminStore includes LiveScoringAdminStore).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveEndStatus, LiveScoringAdminStore, LiveScoringSettings } from '../../../lib/admin/live-scoring/types';
import { newTapKey, LIVE_WINDOW_SECONDS_MAX, LIVE_WINDOW_SECONDS_MIN } from '../../../lib/live-scores/rules';
import type { Side } from '../../../lib/competition/types';
import { Badge, Button, Confirm, Empty, Field, LoadState, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { ErrorText, H2, Note } from '../competition/shared';
import {
  abilities,
  answer,
  enqueue,
  loadQueue,
  newModel,
  retryDelayMs,
  saveQueue,
  scoreLine,
  sendingHalted,
  shownCues,
  shownState,
  STATUS_REASON,
  STATUS_WORDS,
  type ConsoleModel,
  type StorageLike,
} from './logic';

/**
 * `storage`: where waiting taps survive a reload. None by default (they live in memory): our Privacy Policy says the site stores
 * nothing in the browser, so a browser store needs the owner's and the lawyer's yes and a policy sentence first.
 */
export function ScoringScreen({ store, storage = null }: { store: LiveScoringAdminStore; storage?: StorageLike | null }) {
  const { actor } = useAdmin();
  const [matchId, setMatchId] = useState<string | null>(null);
  return matchId ? (
    <ScoringConsole store={store} matchId={matchId} onBack={() => setMatchId(null)} storage={storage} />
  ) : (
    <div className="flex flex-col gap-6">
      <Note>Score a match point by point from your phone. The website shows the score only while live scores are switched on below AND on the website, and only as &quot;Live&quot; while points keep arriving.</Note>
      {/* the live switch is the owner's alone (admin_set_live_scores stays owner only); organizers and scorers only score */}
      {actor.role === 'owner' ? <LiveSettingsCard store={store} /> : null}
      <MatchList store={store} onOpen={setMatchId} />
    </div>
  );
}

// ----------------------------------------------------------------------------- the owner's switch

export function LiveSettingsCard({ store }: { store: LiveScoringAdminStore }) {
  const { actor, notify, bump } = useAdmin();
  const { data, error, loading } = useAsync(() => store.liveScoringSettings(), []);
  const [confirm, setConfirm] = useState<LiveScoringSettings | null>(null);
  const [minutes, setMinutes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (next: LiveScoringSettings) => {
    setBusy(true);
    const r = await store.liveScoringSaveSettings(actor, { ...next, reason: next.public ? 'Live scores switched on' : 'Live scores switched off' });
    setBusy(false);
    setConfirm(null);
    if (!r.ok) {
      setProblem(r.errors?.form ?? 'The setting was not saved. Try again.');
      return;
    }
    setProblem(null);
    notify(r.data.public ? 'Live scores are on (the website switch is also needed).' : 'Live scores are off.');
    bump();
  };
  return (
    <section className={cardCls} aria-labelledby="live-settings-title">
      <H2 id="live-settings-title">Live scores on the website</H2>
      <LoadState loading={loading} error={error}>
        {data && (
          <div className="mt-2 flex flex-col gap-3">
            <p>
              Now: <Badge tone={data.public ? 'good' : 'neutral'}>{data.public ? 'On' : 'Off'}</Badge> A match shows as &quot;Live&quot; while its last point is less than{' '}
              {Math.round(data.windowSeconds / 60)} minute{data.windowSeconds === 60 ? '' : 's'} old.
            </p>
            <Field label="Minutes before a match stops showing as Live" htmlFor="live-window" hint="1 to 60 minutes. Leave empty to keep it as it is.">
              <input id="live-window" className={inputCls} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} maxLength={2} />
            </Field>
            <ErrorText text={problem} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  const m = minutes.trim() === '' ? Math.round(data.windowSeconds / 60) : Number(minutes.trim());
                  const secs = m * 60;
                  if (!Number.isInteger(m) || secs < LIVE_WINDOW_SECONDS_MIN || secs > LIVE_WINDOW_SECONDS_MAX) {
                    setProblem('Type a whole number of minutes from 1 to 60.');
                    return;
                  }
                  setConfirm({ public: !data.public, windowSeconds: secs });
                }}
              >
                {data.public ? 'Turn live scores off' : 'Turn live scores on'}
              </Button>
            </div>
            {confirm && (
              <Confirm
                title={confirm.public ? 'Show live scores on the website?' : 'Stop showing live scores?'}
                body={
                  confirm.public
                    ? 'Visitors will see the score of matches you are scoring, about once a minute. Players the website may not name show as "Protected player".'
                    : 'Visitors will no longer see live scores. Scoring here keeps working.'
                }
                confirmLabel={confirm.public ? 'Turn on' : 'Turn off'}
                busy={busy}
                onConfirm={() => void save(confirm)}
                onCancel={() => setConfirm(null)}
              />
            )}
          </div>
        )}
      </LoadState>
    </section>
  );
}

// ----------------------------------------------------------------------------- choosing a match

export function MatchList({ store, onOpen }: { store: LiveScoringAdminStore; onOpen: (matchId: string) => void }) {
  const { actor } = useAdmin();
  const { data, error, loading } = useAsync(() => store.liveScoringMatches(actor), []);
  return (
    <section aria-labelledby="live-matches-title" className="flex flex-col gap-3">
      <H2 id="live-matches-title">Matches to score</H2>
      <LoadState loading={loading} error={error}>
        {data && data.length === 0 && <Empty>No match can be scored yet. A match needs a published draw and both players known.</Empty>}
        {data?.map((m) => (
          <div key={m.matchId} className={cardCls}>
            <p className="text-small text-fg-muted">{m.tournamentName}</p>
            <p className="font-bold">{m.label}</p>
            <p>
              {m.sideA} <span className="text-fg-muted">versus</span> {m.sideB}
            </p>
            <p className="mt-1 text-small">
              <Badge tone={m.status === 'live' ? 'good' : 'neutral'}>{STATUS_WORDS[m.status] ?? m.status}</Badge>
              {m.courtLabel ? ` ${m.courtLabel}` : ''}
            </p>
            <Button variant="primary" className="mt-3 w-full" onClick={() => onOpen(m.matchId)}>
              Score this match
            </Button>
          </div>
        ))}
      </LoadState>
    </section>
  );
}

// ----------------------------------------------------------------------------- the console

export function ScoringConsole({ store, matchId, onBack, storage = null }: { store: LiveScoringAdminStore; matchId: string; onBack: () => void; storage?: StorageLike | null }) {
  const { actor } = useAdmin();
  const [model, setModel] = useState<ConsoleModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [wake, setWake] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await store.liveScoringMatch({ matchId }, actor);
    if (!r.ok) {
      setLoadError(r.errors?.form ?? 'The match could not be loaded. Check the connection and try again.');
      return;
    }
    setLoadError(null);
    setModel(newModel(r.data, loadQueue(storage, matchId)));
  }, [store, matchId, actor, storage]);

  useEffect(() => {
    void load();
  }, [load]);

  // keep the waiting taps across a reload, only when a store was passed in (none today)
  useEffect(() => {
    if (model) saveQueue(storage, matchId, model.queue);
  }, [model, matchId, storage]);

  // send the first waiting tap; one at a time, in order
  useEffect(() => {
    // signed out or no access: stop sending (no loop of refused sends); the waiting count stays on screen
    if (!model || sending || model.needsReload || model.queue.length === 0 || sendingHalted(model)) return;
    const head = model.queue[0]!;
    const run = async () => {
      setSending(true);
      const r = await store.liveScoringScore(actor, { matchId, kind: head.kind, side: head.side, key: head.key, expectedSeq: head.expectedSeq });
      setSending(false);
      setModel((m) => (m && m.queue[0]?.key === head.key ? answer(m, r) : m));
    };
    if (head.tries === 0) void run();
    else timer.current = setTimeout(() => void run(), retryDelayMs(head.tries));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [model, sending, store, actor, matchId, wake]);

  // the connection is back: try at once
  useEffect(() => {
    const on = () => setWake((n) => n + 1);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorText text={loadError} />
        <Button onClick={() => void load()}>Try again</Button>
        <Button onClick={onBack}>Back to the matches</Button>
      </div>
    );
  }
  if (!model) return <p className="text-fg-muted" aria-live="polite">Loading...</p>;
  return <ConsoleBody model={model} setModel={setModel} store={store} onBack={onBack} reload={load} />;
}

export function ConsoleBody({
  model,
  setModel,
  store,
  onBack,
  reload,
}: {
  model: ConsoleModel;
  setModel: (m: ConsoleModel) => void;
  store: LiveScoringAdminStore;
  onBack: () => void;
  reload: () => Promise<void>;
}) {
  const { actor, notify, bump } = useAdmin();
  const [ending, setEnding] = useState(false);
  const [endChoice, setEndChoice] = useState<{ status: LiveEndStatus; side: Side | null }>({ status: 'completed', side: null });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const d = model.data;
  const can = abilities(model);
  const state = shownState(model);
  const cues = shownCues(model);
  const tap = (kind: 'rally' | 'undo' | 'first_server', side: Side | null) => {
    const r = enqueue(model, kind, side, newTapKey());
    if (!r.ok) {
      setProblem(r.reason);
      return;
    }
    setProblem(null);
    setModel(r.model);
  };
  const status = async (action: 'start' | 'pause' | 'resume' | 'end') => {
    setBusy(true);
    const r = await store.liveScoringStatus(actor, {
      matchId: d.matchId,
      action,
      endStatus: action === 'end' ? endChoice.status : null,
      retiringSide: action === 'end' && endChoice.status === 'retired' ? endChoice.side : null,
      expectedRevision: d.revision,
      reason: STATUS_REASON[action],
    });
    setBusy(false);
    if (!r.ok) {
      setProblem(r.errors?.form ?? (r.code === 'STALE' ? 'The match changed on another device. Reload it.' : 'That did not work. Check the connection and try again.'));
      return;
    }
    setProblem(null);
    setEnding(false);
    setModel(newModel(r.data, model.queue));
    if (action === 'end') notify('The result is saved. Confirm it on the Results screen to put it on the website.');
    bump();
  };
  const points = state && !state.matchOver ? state.current : null;
  const name = (s: Side) => d.sides[s];

  return (
    <div className="flex flex-col gap-4">
      <Button small onClick={onBack} className="self-start">
        Back to the matches
      </Button>
      <header>
        <p className="text-small text-fg-muted">{d.tournamentName}</p>
        <h2 className="text-h3 font-bold text-heading">{d.label}</h2>
        <p className="text-small">
          <Badge tone={d.status === 'live' ? 'good' : 'neutral'}>{STATUS_WORDS[d.status] ?? d.status}</Badge>
          {d.courtLabel ? ` ${d.courtLabel}` : ''}
        </p>
      </header>

      <section className={cardCls} aria-label="Score">
        <table className="w-full text-center ps-num">
          <caption className="sr-only">Score</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left text-small">Side</th>
              {(state?.games ?? []).map((_, i) => (
                <th scope="col" key={i} className="text-small">Game {i + 1}</th>
              ))}
              {points && <th scope="col" className="text-small">Game {state?.gameNumber} now</th>}
            </tr>
          </thead>
          <tbody>
            {(['A', 'B'] as const).map((s) => (
              <tr key={s}>
                <th scope="row" className="py-2 text-left font-bold">
                  {name(s)}
                  {state?.server === s ? <span className="text-small font-semibold text-fg-muted"> (serving)</span> : null}
                </th>
                {(state?.games ?? []).map((g, i) => (
                  <td key={i} className="text-h4">{s === 'A' ? g.a : g.b}</td>
                ))}
                {points && <td className="text-h2 font-extrabold">{s === 'A' ? points.a : points.b}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-small text-fg-muted">Saved on the server: {scoreLine(d.snapshot)}</p>
      </section>

      <div role="status" aria-live="polite" className="rounded-lg border-2 border-ps-court bg-ps-court-tint p-3 font-bold text-ps-ink">
        {cues.length > 0 ? cues.map((c) => <p key={c}>{c}</p>) : <p>Ready.</p>}
      </div>

      {model.queue.length > 0 && (
        <p className="text-small font-semibold" aria-live="polite">
          {model.queue.length === 1 ? '1 tap waiting to be sent.' : `${model.queue.length} taps waiting to be sent.`}
        </p>
      )}
      <ErrorText text={model.problem ?? problem} />
      {model.needsReload && (
        <Button variant="primary" onClick={() => void reload()}>
          Reload the match
        </Button>
      )}

      {can.firstServer && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-bold uppercase tracking-wider">Who serves first?</legend>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => tap('first_server', 'A')}>{name('A')}</Button>
            <Button onClick={() => tap('first_server', 'B')}>{name('B')}</Button>
          </div>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        {(['A', 'B'] as const).map((s) => (
          <Button key={s} variant="primary" disabled={!can.point} onClick={() => tap('rally', s)} className="min-h-[6rem] text-h4">
            Point to {name(s)}
          </Button>
        ))}
      </div>
      <Button disabled={!can.undo} onClick={() => tap('undo', null)} className="min-h-[3.5rem]">
        Undo the last point
      </Button>

      <div className="flex flex-wrap gap-2">
        {can.start && (
          <Button variant="primary" busy={busy} onClick={() => void status('start')}>
            Start the match
          </Button>
        )}
        {can.pause && (
          <Button busy={busy} onClick={() => void status('pause')}>
            Pause
          </Button>
        )}
        {can.resume && (
          <Button variant="primary" busy={busy} onClick={() => void status('resume')}>
            Resume
          </Button>
        )}
        {can.end && !ending && (
          <Button variant="danger" onClick={() => setEnding(true)}>
            End the match
          </Button>
        )}
      </div>
      {ending && (
        <Confirm
          title="End the match?"
          body="The score is saved as the result. It goes on the website only after you confirm it on the Results screen. This cannot be undone here."
          confirmLabel="End the match"
          danger
          busy={busy}
          onConfirm={() => void status('end')}
          onCancel={() => setEnding(false)}
        >
          <fieldset className="mt-3 flex flex-col gap-2">
            <legend className="font-bold">How did it end?</legend>
            {(
              [
                ['completed', null, state?.matchOver ? `Finished: ${state.winner ? name(state.winner) : ''} won` : 'Finished (not possible yet: nobody has won)'],
                ['retired', 'A', `${name('A')} retired`],
                ['retired', 'B', `${name('B')} retired`],
                ['abandoned', null, 'Abandoned (no winner)'],
              ] as const
            ).map(([st, sd, text]) => (
              <label key={`${st}-${sd ?? ''}`} className="flex min-h-tap items-center gap-2">
                <input
                  type="radio"
                  name="end-choice"
                  className="h-5 w-5"
                  checked={endChoice.status === st && endChoice.side === sd}
                  disabled={st === 'completed' && !state?.matchOver}
                  onChange={() => setEndChoice({ status: st, side: sd })}
                />
                {text}
              </label>
            ))}
          </fieldset>
        </Confirm>
      )}
      <p className="text-small text-fg-muted">A walkover (a side did not play) is recorded on the Results screen, not here.</p>
    </div>
  );
}
