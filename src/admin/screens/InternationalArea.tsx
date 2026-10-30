// The International events area (D-112, owner only). A thin entry so the router can lazy-load it; the screen lives in ./international/.
import { useAdmin } from '../ui';
import { InternationalScreen } from './international/International';

export function International() {
  const { client } = useAdmin();
  return <InternationalScreen store={client} />;
}
