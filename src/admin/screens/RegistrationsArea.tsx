// The Registrations area (D-111, owner only). A thin entry so the router can lazy-load it; the screen lives in ./registrations/.
import { useAdmin } from '../ui';
import { RegistrationsScreen } from './registrations/Registrations';

export function Registrations() {
  const { client } = useAdmin();
  return <RegistrationsScreen store={client} />;
}
