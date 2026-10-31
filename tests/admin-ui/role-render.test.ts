// Server render of the admin per role (D-108, D-117, D-122): the owner sees everything as before; an organizer sees the Competitions
// and scoring areas of their tournaments without rankings, the points table, venues or any other area, with a plain sentence where a
// job is the owner's; a scorer sees only the matches with the result form, and the scoring console. tests/admin/organizer-search.test.ts
// proves the server refuses the same things. Effects do not run in a server render, so loaded data is passed in. Fictional data only.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { previewRoleFrom, tabsFor } from '../../src/admin/AdminApp';
import { moreItemsFor } from '../../src/admin/screens/More';
import { Competitions, EVENT_SETUP_IS_ORGANIZERS, HomeView, RANKINGS_ARE_OWNERS } from '../../src/admin/screens/competition/CompetitionsArea';
import { EntriesTab, FoundPlayers, MORE_PLAYERS_NOTE, NEW_PLAYER_NOTE, NewPlayer, offerNewPlayer, SearchOutcome, type SearchAnswer } from '../../src/admin/screens/competition/Entries';
import { EventDetailView, eventTabsFor } from '../../src/admin/screens/competition/EventDetail';
import { ResultsTab } from '../../src/admin/screens/competition/Results';
import { Courts, TournamentSchedule } from '../../src/admin/screens/competition/Schedule';
import { ScoringScreen } from '../../src/admin/screens/scoring/Scoring';
import { AdminContext, type AdminCtx } from '../../src/admin/ui';
import { competitionUiFor } from '../../src/lib/admin/accounts/access';
import { COMP_SEED } from '../../src/lib/admin/competition/memory-backend';
import type { CompetitionEventDetail } from '../../src/lib/admin/competition/types';
import { MemoryAdminStore, previewAs, PREVIEW_STAFF } from '../../src/lib/admin/memory-store';
import type { Actor, StoreResult } from '../../src/lib/admin/types';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const T1 = '20000000-0000-4000-8000-000000000001';
const OWNER: Actor = { userId: 'preview-owner', role: 'owner' };
const ORG: Actor = { userId: '9c000000-0000-4000-8000-000000000001', role: 'organizer' };
const SCO: Actor = { userId: '9c000000-0000-4000-8000-000000000002', role: 'scorer' };
const R = 'demo reason';

function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.data;
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function setup() {
  let n = 0;
  const client = new MemoryAdminStore({ now: () => NOW, newId: () => `97000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, randomSeed: () => 99 });
  const render = (actor: Actor, el: ReactElement) => {
    const ctx: AdminCtx = { client, actor, mode: 'preview', notify: () => undefined, check: ((r: StoreResult<unknown>) => r.ok) as AdminCtx['check'], signOut: () => undefined, version: 0, bump: () => undefined };
    return renderToStaticMarkup(createElement(AdminContext.Provider, { value: ctx }, el));
  };
  return { client, render };
}

/** The men's singles event with a published draw, as the owner made it (the organizer and scorer render the same data). */
async function publishedEvent(client: MemoryAdminStore): Promise<CompetitionEventDetail> {
  const g = ok(await client.competitionGenerateDraw(OWNER, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
  ok(await client.competitionPublishDraw(OWNER, { eventId: COMP_SEED.eventMs, drawId: g.drawId, reason: R }));
  return ok(await client.competitionEvent({ eventId: COMP_SEED.eventMs }, OWNER));
}

const g = globalThis as { location?: { hash: string } };
afterEach(() => {
  delete g.location;
});

describe('which areas each role sees', () => {
  it('the owner keeps every tab and every More item; organizers and scorers only Competitions and scoring', () => {
    expect(tabsFor('owner').length).toBeGreaterThan(3);
    expect(moreItemsFor('owner')).toContain('accounts');
    expect(moreItemsFor('owner')).toContain('prices');
    expect([...tabsFor('organizer')].sort()).toEqual(['competitions', 'scoring']);
    expect([...tabsFor('scorer')]).toEqual(['scoring', 'competitions']);
    for (const role of ['organizer', 'scorer'] as const) {
      expect([...moreItemsFor(role)].sort()).toEqual(['competitions', 'scoring']);
      for (const hidden of ['videos', 'players', 'tournaments', 'prices', 'sponsors', 'settings', 'accounts', 'registrations', 'international', 'notices', 'posters', 'live', 'inbox', 'dashboard']) {
        expect(tabsFor(role), `${role} ${hidden}`).not.toContain(hidden);
        expect(moreItemsFor(role)).not.toContain(hidden);
      }
    }
    expect(tabsFor('editor')).toEqual([]);
  });
  it('the event tabs: all three for the owner and the organizer, only the matches for a scorer', () => {
    expect(eventTabsFor(competitionUiFor('owner'))).toEqual(['entries', 'draw', 'matches']);
    expect(eventTabsFor(competitionUiFor('organizer'))).toEqual(['entries', 'draw', 'matches']);
    expect(eventTabsFor(competitionUiFor('scorer'))).toEqual(['matches']);
  });
});

describe('the Competitions home per role', () => {
  it('owner: the rankings link, Add an event, Courts and schedule', async () => {
    const { client, render } = setup();
    const list = ok(await client.competitionTournaments());
    const t = text(render(OWNER, createElement(HomeView, { list, loading: false, error: null, owner: true })));
    expect(t).toContain('Rankings and points table');
    expect(t).toContain('Add an event');
    expect(t).toContain('Courts and schedule');
    expect(t).not.toContain(RANKINGS_ARE_OWNERS);
  });
  it('organizer: no rankings link but the plain sentence; Add an event and Courts and schedule stay', async () => {
    const { client, render } = setup();
    const list = ok(await client.competitionTournaments()).filter((x) => x.id === T1);
    const html = render(ORG, createElement(HomeView, { list, loading: false, error: null, owner: false }));
    const t = text(html);
    expect(t).not.toContain('Rankings and points table');
    expect(html).not.toContain('#/competitions/rankings');
    expect(t).toContain(RANKINGS_ARE_OWNERS);
    expect(t).toContain('Add an event');
    expect(t).toContain('Courts and schedule');
    expect(html).toContain(`#/competitions/event/${COMP_SEED.eventMs}/entries`);
  });
  it('scorer: no event setup, no courts, events open on the matches; an empty list says the owner gives tournaments', async () => {
    const { client, render } = setup();
    const list = ok(await client.competitionTournaments()).filter((x) => x.id === T1);
    const html = render(SCO, createElement(HomeView, { list, loading: false, error: null, owner: false }));
    const t = text(html);
    expect(t).not.toContain('Add an event');
    expect(t).not.toContain('Courts and schedule');
    expect(t).not.toContain('Rankings and points table');
    expect(t).toContain('record a result');
    expect(html).toContain(`#/competitions/event/${COMP_SEED.eventMs}/matches`);
    expect(html).not.toContain(`#/competitions/event/${COMP_SEED.eventMs}/entries`);
    expect(text(render(SCO, createElement(HomeView, { list: [], loading: false, error: null, owner: false })))).toContain('The owner gives you tournaments');
  });
  it('an organizer or scorer who types the rankings or event-setup address gets a plain sentence, not the screen', () => {
    const { render } = setup();
    g.location = { hash: '#/competitions/rankings' };
    const org = text(render(ORG, createElement(Competitions)));
    expect(org).toContain(RANKINGS_ARE_OWNERS);
    expect(org).not.toContain('Work out the ranking');
    g.location = { hash: `#/competitions/new/${T1}` };
    expect(text(render(SCO, createElement(Competitions)))).toContain(EVENT_SETUP_IS_ORGANIZERS);
    g.location = { hash: `#/competitions/edit/${COMP_SEED.eventMs}` };
    expect(text(render(SCO, createElement(Competitions)))).toContain(EVENT_SETUP_IS_ORGANIZERS);
  });
});

describe('one event per role', () => {
  it('organizer: three tabs, the event can be changed, the update button after publishing', async () => {
    const { client, render } = setup();
    const d = await publishedEvent(client);
    const html = render(ORG, createElement(EventDetailView, { detail: d, tab: 'entries' }));
    const t = text(html);
    expect(html).toContain('aria-label="Parts of this event"');
    expect(t).toContain('Change the event details');
    expect(t).toContain('Update matches');
    expect(t).toContain('Draw');
  });
  it('scorer: no tabs, no event change, no update button; an entries or draw address shows the matches instead', async () => {
    const { client, render } = setup();
    const d = await publishedEvent(client);
    for (const tab of ['entries', 'draw', 'matches'] as const) {
      const html = render(SCO, createElement(EventDetailView, { detail: d, tab }));
      const t = text(html);
      expect(html).not.toContain('aria-label="Parts of this event"');
      expect(t).not.toContain('Change the event details');
      expect(t).not.toContain('Update matches');
      expect(t).not.toContain('Add the entry');
      expect(t).not.toContain('Make the draw');
      expect(t).toContain('Record result');
    }
  });
  it('matches: the scorer records only (no confirm, no time and court, no schedule link) and reads who confirms', async () => {
    const { client, render } = setup();
    const d0 = await publishedEvent(client);
    const m = d0.matches.find((x) => x.sideA !== null && x.sideB !== null)!;
    ok(await client.competitionRecordResult(OWNER, { matchId: m.id, expectedRevision: m.revision, status: 'completed', games: [{ a: 21, b: 10 }, { a: 21, b: 12 }], walkoverWinner: null, retiringSide: null, reason: R }));
    const d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventMs }, OWNER));
    const sco = text(render(SCO, createElement(ResultsTab, { detail: d })));
    expect(sco).not.toContain('Confirm result');
    expect(sco).not.toContain('Time and court');
    expect(sco).not.toContain('Courts and schedule');
    expect(sco).toContain('Change the result');
    expect(sco).toContain('The organizer or the owner checks each one and confirms it');
    const org = text(render(ORG, createElement(ResultsTab, { detail: d })));
    expect(org).toContain('Confirm result');
    expect(org).toContain('Time and court');
    expect(org).toContain('Courts and schedule');
    expect(org).not.toContain('The organizer or the owner checks each one');
    const owner = text(render(OWNER, createElement(ResultsTab, { detail: d })));
    expect(owner).toContain('Confirm result');
  });
});

describe('entries for an organizer', () => {
  it('the add form asks for 3 letters, points at the owner for the academy (no Players screen), and shows the public naming', async () => {
    const { client, render } = setup();
    const d = ok(await client.competitionEvent({ eventId: COMP_SEED.eventWs }, ORG));
    const t = text(render(ORG, createElement(EntriesTab, { detail: d })));
    expect(t).toContain('Type at least 3 letters of the name.');
    expect(t).not.toContain('Players screen');
    expect(t).toContain('the owner keeps');
    // the preview tells the truth: one protected entry (unknown age), the two adults named
    expect(t.match(/On the site: Protected player/g)).toHaveLength(1);
    const owner = text(render(OWNER, createElement(EntriesTab, { detail: ok(await client.competitionEvent({ eventId: COMP_SEED.eventWs }, OWNER)) })));
    expect(owner).toContain('Players screen');
    expect(owner).not.toContain('Type at least 3 letters');
  });
  it('found players never show an age; a naming badge only when it is known (a new player); a taken player cannot be chosen twice', () => {
    const { render } = setup();
    const html = render(ORG, createElement(FoundPlayers, {
      items: [{ id: 'a', displayName: 'Demo Found Named', named: true }, { id: 'b', displayName: 'Demo Found Hidden', named: false }],
      taken: (id: string) => id === 'b',
      onChoose: () => undefined,
    }));
    const t = text(html);
    expect(t).toContain('On the site: named');
    expect(t).toContain('On the site: Protected player');
    expect(t).not.toMatch(/Adult|Unknown age|Minor/);
    expect(t).toContain('Choose Demo Found Named');
    expect(t).toContain('Already entered');
  });
  it('the new player box explains what happens, has a labelled name field and asks before adding', () => {
    const { render } = setup();
    const html = render(ORG, createElement(NewPlayer, { tournamentId: T1, typed: 'Demo Newcomer', onAdded: () => undefined }));
    expect(text(html)).toContain(NEW_PLAYER_NOTE);
    expect(html).toMatch(/<label[^>]*for="new-player-name"/);
    expect(html).toContain('value="Demo Newcomer"');
    expect(text(html)).toContain('Add as a new player');
    expect(html).not.toContain('role="alertdialog"');
  });
});

describe('the organizer search result (no match, more players, a slower old answer)', () => {
  const base = { canCreate: true, tournamentId: T1, taken: () => false, onChoose: () => undefined, onAdded: () => undefined, onPage: () => undefined };
  const answer = (query: string, items: SearchAnswer['items'], hasMore = false, offset = 0): SearchAnswer => ({ query, offset, items, hasMore });
  it('offers a new player when only a LONGER name was found (Ravi while Ravi Shankar exists), not when the exact name was found', () => {
    expect(offerNewPlayer('Demo Ravi', [{ id: 'a', displayName: 'Demo Ravi Shankar' }])).toBe(true);
    expect(offerNewPlayer('  demo   RAVI ', [{ id: 'a', displayName: 'Demo Ravi' }])).toBe(false);
    expect(offerNewPlayer('de', [])).toBe(false);
    const { render } = setup();
    const t = text(render(ORG, createElement(SearchOutcome, { ...base, typed: 'Demo Ravi', loading: false, answer: answer('Demo Ravi', [{ id: 'a', displayName: 'Demo Ravi Shankar' }]) })));
    expect(t).toContain('Choose Demo Ravi Shankar');
    expect(t).toContain(NEW_PLAYER_NOTE);
    const exact = text(render(ORG, createElement(SearchOutcome, { ...base, typed: 'Demo Ravi', loading: false, answer: answer('Demo Ravi', [{ id: 'a', displayName: 'Demo Ravi' }]) })));
    expect(exact).not.toContain(NEW_PLAYER_NOTE);
  });
  it('says when more players match and offers the next page', () => {
    const { render } = setup();
    const t = text(render(ORG, createElement(SearchOutcome, { ...base, typed: 'Demo Comp', loading: false, answer: answer('Demo Comp', [{ id: 'a', displayName: 'Demo Comp One' }], true) })));
    expect(t).toContain(MORE_PLAYERS_NOTE);
    expect(t).toContain('More players');
    expect(t).not.toContain('Previous players');
    const second = text(render(ORG, createElement(SearchOutcome, { ...base, typed: 'Demo Comp', loading: false, answer: answer('Demo Comp', [{ id: 'b', displayName: 'Demo Comp Two' }], false, 8) })));
    expect(second).toContain('Previous players');
    expect(second).not.toContain(MORE_PLAYERS_NOTE);
  });
  it('never shows the no-match branch while loading or for an answer to an older query', () => {
    const { render } = setup();
    const loading = text(render(ORG, createElement(SearchOutcome, { ...base, typed: 'Demo Comp Anand', loading: true, answer: answer('Demo Comp Anand', []) })));
    expect(loading).not.toContain(NEW_PLAYER_NOTE);
    expect(loading).toContain('Searching');
    const stale = text(render(ORG, createElement(SearchOutcome, { ...base, typed: 'Demo Comp Anand', loading: false, answer: answer('Demo Com', []) })));
    expect(stale).not.toContain(NEW_PLAYER_NOTE);
    expect(stale).not.toContain('No player has that name');
    const owner = text(render(OWNER, createElement(SearchOutcome, { ...base, canCreate: false, typed: 'Demo Zz', loading: true, answer: answer('Demo Z', []) })));
    expect(owner).not.toContain('No player has that name');
  });
});

describe('courts and venues per role', () => {
  it('the owner adds courts and venues; an organizer adds courts and reads that venues are the owner\'s job', () => {
    const { render } = setup();
    const owner = text(render(OWNER, createElement(Courts, { tournamentId: T1 })));
    expect(owner).toContain('Add the court');
    expect(owner).toContain('Add a venue');
    const org = text(render(ORG, createElement(Courts, { tournamentId: T1 })));
    expect(org).toContain('Add the court');
    expect(org).not.toContain('Add a venue');
    expect(org).toContain('only the owner adds them');
  });
  it('a scorer who opens the courts address gets a plain sentence', () => {
    const { render } = setup();
    const t = text(render(SCO, createElement(TournamentSchedule, { tournamentId: T1 })));
    expect(t).toContain('Courts and the order of play are set by the tournament organizer or the owner');
    expect(t).not.toContain('Add the court');
  });
});

describe('the scoring console per role', () => {
  it('only the owner sees the live switch; the others read that it is the owner\'s choice', () => {
    const { client, render } = setup();
    const owner = text(render(OWNER, createElement(ScoringScreen, { store: client })));
    expect(owner).toContain('switched on below');
    for (const actor of [ORG, SCO]) {
      const t = text(render(actor, createElement(ScoringScreen, { store: client })));
      expect(t).not.toContain('switched on below');
      expect(t).toContain("the owner's choice");
    }
  });
});

describe('the preview as an organizer or scorer (made-up data, preview mode only)', () => {
  it('reads the role from ?preview-as= and nothing else', () => {
    expect(previewRoleFrom('?preview-as=organizer')).toBe('organizer');
    expect(previewRoleFrom('?preview-as=scorer')).toBe('scorer');
    expect(previewRoleFrom('?preview-as=owner')).toBeNull();
    expect(previewRoleFrom('?preview-as=Organizer')).toBeNull();
    expect(previewRoleFrom('')).toBeNull();
  });
  it('answers like the admin function: the organizer works on the Demo Open Cup and nothing else; the scorer only records', async () => {
    const org = previewAs(new MemoryAdminStore({ now: () => NOW }), 'organizer');
    expect(org.actor).toEqual({ userId: PREVIEW_STAFF.organizer, role: 'organizer' });
    expect((await org.client.competitionTournaments()).ok).toBe(true);
    expect(ok(await org.client.competitionTournaments()).map((t) => t.id)).toEqual([T1]);
    expect((await org.client.competitionSearchPlayers(org.actor, { tournamentId: T1, q: 'demo comp', limit: 5, offset: 0 })).ok).toBe(true);
    expect(await org.client.competitionRankings()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await org.client.searchPlayers({ query: '', limit: 5, offset: 0 })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await (org.client as unknown as { accountsList: () => Promise<unknown> }).accountsList()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const ev = ok(await org.client.competitionEvent({ eventId: COMP_SEED.eventWs }, org.actor));
    expect(ev.entries.filter((e) => e.isProtected)).toHaveLength(1);
    const sco = previewAs(new MemoryAdminStore({ now: () => NOW }), 'scorer');
    expect(await sco.client.competitionAddEntry(sco.actor, { eventId: COMP_SEED.eventMs, players: [COMP_SEED.anand], seed: null, status: 'pending', reason: R })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await sco.client.competitionSearchPlayers(sco.actor, { tournamentId: T1, q: 'demo comp', limit: 5, offset: 0 })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sco.client.liveScoringMatches(sco.actor)).ok).toBe(true);
  });
});
