// The only module the admin page hydrates eagerly: it loads the real app on demand, so the owner's phone fetches the admin bundle only
// on /admin/ and the first-party JS counted for any page stays small (the app chunk is a dynamic import, reported as "lazy").
import { lazy, Suspense } from 'react';

const AdminApp = lazy(() => import('./AdminApp'));

export default function AdminLoader() {
  return (
    <Suspense fallback={<p className="p-4 text-fg-muted">Loading the admin...</p>}>
      <AdminApp />
    </Suspense>
  );
}
