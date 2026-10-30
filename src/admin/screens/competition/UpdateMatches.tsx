// "Update matches" on the event screen: once the draw is published, one tap asks the server to bring the matches in line with the draw
// (competition.syncMatches: make any missing match, update changed ones, move confirmed winners on). Safe to press again: it changes
// nothing when the matches already follow the draw. The outcome is shown in plain sentences, problems as a list.
import { useState } from 'react';
import type { CompetitionEventDetail, MatchSyncOutcome } from '../../../lib/admin/competition/types';
import { Button, useAdmin } from '../../ui';
import { compHash, syncOutcomeLines, syncOutcomeNotice, UPDATE_MATCHES_LABEL, UPDATE_MATCHES_REASON } from './logic';
import { ErrorText, useAction } from './shared';

export function UpdateMatches({ detail }: { detail: CompetitionEventDetail }) {
  const { client, actor, notify, bump } = useAdmin();
  const act = useAction();
  const [outcome, setOutcome] = useState<MatchSyncOutcome | null>(null);
  const published = detail.draw !== null && detail.draw.status !== 'draft';
  if (!published) return null;
  const go = async () => {
    const r = await act.run(() => client.competitionSyncMatches(actor, { eventId: detail.event.id, reason: UPDATE_MATCHES_REASON }));
    if (!r) return;
    setOutcome(r);
    notify(syncOutcomeNotice(r));
    bump();
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-fg-muted">Winners move on when you confirm a result. If a match seems to be missing or out of date, update the matches from the draw.</p>
      <div>
        <Button onClick={() => void go()} busy={act.busy}>{UPDATE_MATCHES_LABEL}</Button>
      </div>
      <ErrorText text={act.error} />
      {outcome ? <SyncOutcomeNote outcome={outcome} detail={detail} /> : null}
    </div>
  );
}

/** What an update (or a publish) of the matches did. */
export function SyncOutcomeNote({ outcome, detail }: { outcome: MatchSyncOutcome; detail: CompetitionEventDetail }) {
  return (
    <div role="status" className="rounded-lg border-2 border-ps-court p-3 text-small">
      {syncOutcomeLines(outcome).map((l) => <p key={l}>{l}</p>)}
      {outcome.problems.length > 0 ? (
        <ul aria-label="Needs your attention" className="mt-1 list-disc pl-5">
          {outcome.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      ) : null}
      <p className="mt-1"><a href={compHash({ view: 'event', eventId: detail.event.id, tab: 'matches' })}>See the matches</a></p>
    </div>
  );
}
