// The international events admin actions (D-112), shared by the memory store (tests, preview) and the Supabase store (the Vercel admin
// function): both give it an InternationalBackend. The form is checked here first with the shared rules
// (src/lib/international/link-rules.ts) so the owner gets a plain-English sentence beside the field; the 0022 RPC checks the same again,
// audits and marks the site for a rebuild. Refusals come back as plain English in `errors`.
import { DEFAULT_ALLOWED_HOSTS, allowedHosts, checkInternationalEvent, cleanExtraHosts, linkHost, storedLinkProblem } from '../../international/link-rules';
import { failResult, okResult, type AdminErrorCode, type StoreResult } from '../types';
import { InternationalError, type InternationalAdminStore, type InternationalBackend, type InternationalEventDto } from './types';

const PASS_THROUGH: readonly AdminErrorCode[] = ['INVALID', 'NOT_FOUND', 'STALE', 'FORBIDDEN', 'BACKEND_ERROR'];

function toFailure(e: unknown) {
  const code = (e as { code?: unknown })?.code;
  const detail = (e as { detail?: unknown })?.detail;
  if (e instanceof InternationalError || (typeof code === 'string' && (PASS_THROUGH as readonly string[]).includes(code))) {
    const c = code as AdminErrorCode;
    return typeof detail === 'string' && detail !== '' ? failResult(c, { form: detail }) : failResult(c);
  }
  return failResult('BACKEND_ERROR');
}

async function guard<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return toFailure(e);
  }
}

export function createInternationalService(b: InternationalBackend): InternationalAdminStore {
  return {
    internationalList: () =>
      guard(async () => {
        const [rows, extra] = await Promise.all([b.listEvents(), b.getExtraHosts()]);
        const hosts = allowedHosts(extra);
        const events: InternationalEventDto[] = rows
          .map((r) => ({ ...r, host: linkHost(r.officialUrl) ?? '', onAllowList: storedLinkProblem(r.officialUrl, hosts) === null }))
          .sort((x, y) => y.startDate.localeCompare(x.startDate) || x.name.localeCompare(y.name));
        return okResult({ events, settings: { defaultHosts: [...DEFAULT_ALLOWED_HOSTS], extraHosts: [...extra].sort() } });
      }),

    internationalSave: (actor, input) =>
      guard(async () => {
        if ((input.id === null) !== (input.expectedRevision === null)) {
          return failResult('INVALID', { form: input.id === null ? 'A new event has no revision.' : 'Open the event again before saving it.' });
        }
        const checked = checkInternationalEvent(input, await b.getExtraHosts());
        if (!checked.ok) return failResult('INVALID', checked.errors);
        const r = await b.saveEvent(actor, input.id, checked.value, input.expectedRevision, input.reason.trim());
        return okResult({ ...r, removedTracking: checked.removedTracking });
      }),

    internationalSetPublished: (actor, input) => guard(async () => okResult(await b.setPublished(actor, input.id, input.published, input.expectedRevision, input.reason.trim()))),

    internationalSaveHosts: (actor, input) =>
      guard(async () => {
        const cleaned = cleanExtraHosts(input.hosts);
        if (!cleaned.ok) return failResult('INVALID', { hosts: cleaned.problem });
        return okResult(await b.setHosts(actor, cleaned.hosts, input.reason.trim()));
      }),
  };
}
