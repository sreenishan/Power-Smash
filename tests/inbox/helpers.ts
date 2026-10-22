import type { InboxLead } from '../../src/lib/inbox/lead';

let n = 0;
/** A fictional lead: invented names, fake phone digits, example.test e-mail addresses. */
export function lead(over: Partial<InboxLead> = {}): InboxLead {
  n += 1;
  return {
    id: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    refCode: `PS-2026-${String(n).padStart(6, '0').replace(/0/g, '2')}`,
    type: 'coverage',
    status: 'new',
    name: 'Fictional Person',
    organization: 'Fictional Association',
    phone: '910000000000',
    email: 'person@example.test',
    whatsappOk: true,
    valuePaise: null,
    sourcePath: '/book/',
    followUpOn: null,
    notes: null,
    lostReason: null,
    createdAt: '2026-10-20T06:30:00Z',
    ...over,
  };
}
