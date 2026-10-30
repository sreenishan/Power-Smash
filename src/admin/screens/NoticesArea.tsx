// The Notices and email area (D-114, owner only). A thin entry so the router can lazy-load it; the screen lives in ./notices/.
import { useAdmin } from '../ui';
import { NoticesScreen } from './notices/Notices';

export function Notices() {
  const { client } = useAdmin();
  return <NoticesScreen store={client} />;
}
