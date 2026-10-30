// Server render of the owner's International events screen (D-112) with the memory service, plus the pure screen helpers: the plain
// notes, labelled fields, the allow-list in the link hint, hide behind a confirmation, links with rel noopener noreferrer nofollow.
// Fictional data only.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminContext, type AdminCtx } from '../../src/admin/ui';
import { InternationalScreen } from '../../src/admin/screens/international/International';
import { EMPTY_EVENT_FORM, formFromEvent, formProblems, hostsFromText, hostsProblem, hostsSavedText, savedText, stateText } from '../../src/admin/screens/international/logic';
import { createMemoryInternationalBackend } from '../../src/lib/admin/international/memory-backend';
import { createInternationalService } from '../../src/lib/admin/international/service';
import { MemoryAdminStore } from '../../src/lib/admin/memory-store';
import type { InternationalEventDto } from '../../src/lib/admin/international/types';
import type { StoreResult } from '../../src/lib/admin/types';

const NOW = new Date('2026-10-31T04:00:00.000Z');
const OWNER = { userId: '9c000000-0000-4000-8000-000000000001', role: 'owner' as const };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function render(el: ReactElement) {
  const client = new MemoryAdminStore({ now: () => NOW });
  const ctx: AdminCtx = { client, actor: OWNER, mode: 'preview', notify: () => undefined, check: ((r: StoreResult<unknown>) => r.ok) as AdminCtx['check'], signOut: () => undefined, version: 0, bump: () => undefined };
  return renderToStaticMarkup(createElement(AdminContext.Provider, { value: ctx }, el));
}

describe('InternationalScreen (first render)', () => {
  it('renders the note and the loading state without crashing', () => {
    const store = createInternationalService(createMemoryInternationalBackend());
    const html = render(createElement(InternationalScreen, { store }));
    const t = text(html);
    expect(t).toContain('ONE link to their official page');
    expect(t).toContain('Details and results on the official site');
    expect(t).toContain('switched off');
    expect(t).toContain('Loading...');
    expect(html).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('screen helpers', () => {
  const dto: InternationalEventDto = {
    id: 'b1000000-0000-4000-8000-000000000001', name: 'Sample World Open 2026', levelText: null, startDate: '2026-11-17', endDate: '2026-11-22', city: null, country: 'Demo Country',
    officialUrl: 'https://bwfbadminton.com/', published: true, revision: 3, createdAt: 'a', updatedAt: 'b', host: 'bwfbadminton.com', onAllowList: true,
  };

  it('a form from an event keeps the revision; empty optional texts become empty boxes', () => {
    const f = formFromEvent(dto);
    expect(f).toMatchObject({ id: dto.id, expectedRevision: 3, levelText: '', city: '', reason: '' });
    expect(EMPTY_EVENT_FORM.published).toBe(false);
  });

  it('formProblems checks the fields with the shared rules, and the reason', () => {
    expect(formProblems({ ...formFromEvent(dto), reason: 'ok reason' }, [])).toEqual({});
    const p = formProblems({ ...EMPTY_EVENT_FORM, officialUrl: 'https://user@bwfbadminton.com/' }, []);
    expect(Object.keys(p).sort()).toEqual(['country', 'endDate', 'name', 'officialUrl', 'reason', 'startDate']);
    expect(p.officialUrl).toMatch(/user name or password/);
  });

  it('the hosts box', () => {
    expect(hostsFromText('example.org\n example.net, ,x.org')).toEqual(['example.org', 'example.net', 'x.org']);
    expect(hostsProblem('example.org')).toBeNull();
    expect(hostsProblem('bit.ly')).toMatch(/shorteners/);
  });

  it('plain sentences', () => {
    expect(stateText(dto, false)).toMatch(/once that page is switched on/);
    expect(stateText({ ...dto, onAllowList: false }, true)).toMatch(/no longer on an allowed website/);
    expect(stateText({ ...dto, published: false }, true)).toBe('Hidden: not on the website.');
    expect(savedText({ created: true, fields: [], removedTracking: true })).toBe('Event added. Tracking parts (such as utm_) were removed from the link.');
    expect(savedText({ created: false, fields: [], removedTracking: false })).toBe('Nothing changed.');
    expect(hostsSavedText({ fields: ['extra_hosts'], eventsOffList: 2 })).toMatch(/2 shown events link to a website that is no longer allowed/);
  });
});

describe('the screen source', () => {
  it('external links carry rel noopener noreferrer nofollow; hide sits behind a confirmation', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/admin/screens/international/International.tsx', import.meta.url), 'utf8');
    expect(src).toContain('rel="noopener noreferrer nofollow"');
    expect(src).toContain('<Confirm');
    expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(src).toContain('Do not write player names.');
  });
});
