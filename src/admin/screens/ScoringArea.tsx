// The Live scoring area (D-113): the phone scoring console. The owner, and (once wave 4 is switched on) organizers and scorers of their
// own tournaments. A thin entry so the router can lazy-load it; the screen lives in ./scoring/. Waiting taps are kept in memory only
// (no browser storage: the Privacy Policy says the site stores nothing in the browser).
import { useAdmin } from '../ui';
import { ScoringScreen } from './scoring/Scoring';

export function Scoring() {
  const { client } = useAdmin();
  return <ScoringScreen store={client} />;
}
