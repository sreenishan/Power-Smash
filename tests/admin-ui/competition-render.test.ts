// Server-side render of the competition admin screens with the memory store (fictional seed): they render without crashing, the owner
// sees every name, the public-view note says "Protected player", buttons and fields carry labels, and the irreversible steps are behind a
// confirmation. Effects (data loading) do not run in a server render, so the screens are fed an event detail directly. Fictional data only.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminContext, type AdminCtx } from '../../src/admin/ui';
import { DrawPreview, DrawTab } from '../../src/admin/screens/competition/Draw';
import { EntriesTab } from '../../src/admin/screens/competition/Entries';
import { ResultsTab } from '../../src/admin/screens/competition/Results';
import { UpdateMatches } from '../../src/admin/screens/competition/UpdateMatches';
import { COMP_SEED } from '../../src/lib/admin/competition/memory-backend';
import type { CompetitionEventDetail } from '../../src/lib/admin/competition/types';
import { MemoryAdminStore } from '../../src/lib/admin/memory-store';
import type { StoreResult } from '../../src/lib/admin/types';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const ACTOR = { userId: 'preview-owner', role: 'owner' as const };
const R = 'demo reason';

function setup() {
  let n = 0;
  const client = new MemoryAdminStore({ now: () => NOW, newId: () => `90000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, randomSeed: () => 99 });
  const ctx: AdminCtx = { client, actor: ACTOR, mode: 'preview', notify: () => undefined, check: ((r: StoreResult<unknown>) => r.ok) as AdminCtx['check'], signOut: () => undefined, version: 0, bump: () => undefined };
  const render = (el: ReactElement) => renderToStaticMarkup(createElement(AdminContext.Provider, { value: ctx }, el));
  return { client, render };
}
function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.data;
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('competition screens render (server render, fictional seed)', () => {
  it('entries: the owner sees the unknown-age player by name, with the public "Protected player" badge', async () => {
    const { client, render } = setup();
    const d: CompetitionEventDetail = ok(await client.competitionEvent({ eventId: COMP_SEED.eventWs }, ACTOR));
    const html = render(createElement(EntriesTab, { detail: d }));
    const t = text(html);
    expect(t).toContain('Demo Meena Samplestone');
    expect(t).toContain('On the site: Protected player');
    expect(t).toContain('Add the entry');
    expect(html).toMatch(/<label[^>]*for="entry-find"/);
    // no confirmation is open until the owner asks
    expect(html).not.toContain('role="alertdialog"');
  });

  it('draw: no draw yet offers "Make the draw" with its draw number field; a draft shows its number and a publish button', async () => {
    const { client, render } = setup();
    let d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventMs }, ACTOR));
    let t = text(render(createElement(DrawTab, { detail: d })));
    expect(t).toContain('No draw yet');
    expect(t).toContain('Draw number (optional)');
    ok(await client.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventMs }, ACTOR));
    t = text(render(createElement(DrawTab, { detail: d })));
    expect(t).toContain('Draw number 42');
    expect(t).toContain('Publish the draw');
    expect(t).toContain('Make the draw again');
    expect(t).toContain('Semi-final');
    expect(t).toContain('Demo Comp Anand Mockwell');
  });

  it('draw preview of a league with a protected player, owner view by default', async () => {
    const { client, render } = setup();
    ok(await client.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventWs, seed: 5, separateClubs: false, seeds: 0, reason: R }));
    const d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventWs }, ACTOR));
    const t = text(render(createElement(DrawPreview, { detail: d })));
    expect(t).toContain('Your view (all names)');
    expect(t).toContain('What the website will show');
    expect(t).toContain('Everyone plays everyone');
  });

  it('matches: a published draw gives match cards with record-result and time buttons; no confirm until a result exists', async () => {
    const { client, render } = setup();
    const made = ok(await client.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    ok(await client.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventMs, drawId: made.drawId, reason: R }));
    const d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventMs }, ACTOR));
    const html = render(createElement(ResultsTab, { detail: d }));
    const t = text(html);
    expect(t).toContain('Record result');
    expect(t).toContain('Time and court');
    expect(t).not.toContain('Confirm result');
    expect(t).toContain('To be decided');
    expect(html).toMatch(/aria-label="Match MS SF match 1"/);
  });

  it('update matches: hidden while the draw is a draft; after publishing the event screen offers "Update matches" and the draw tab points at it', async () => {
    const { client, render } = setup();
    const made = ok(await client.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    let d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventMs }, ACTOR));
    expect(render(createElement(UpdateMatches, { detail: d }))).toBe('');
    ok(await client.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventMs, drawId: made.drawId, reason: R }));
    d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventMs }, ACTOR));
    const html = render(createElement(UpdateMatches, { detail: d }));
    expect(html).toMatch(/<button[^>]*>Update matches<\/button>/);
    const draw = text(render(createElement(DrawTab, { detail: d })));
    expect(draw).toContain('use "Update matches" at the top of this event');
    expect(draw).not.toContain('Check the matches against the draw');
  });

  it('update matches: the server call with a reason changes nothing on a fresh publish (safe to press again)', async () => {
    const { client } = setup();
    const made = ok(await client.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    ok(await client.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventMs, drawId: made.drawId, reason: R }));
    const o = ok(await client.competitionSyncMatches(ACTOR, { eventId: COMP_SEED.eventMs, reason: 'Matches updated from the published draw by owner' }));
    expect(o.created).toBe(0);
    expect(o.problems).toEqual([]);
  });
});
