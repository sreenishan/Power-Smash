// The page model of the public competition pages with the FICTIONAL seed, end to end through the display helpers the components use:
// protected players are never named, junior rankings and protected ranking rows never appear, no "Live" on a static page, and the
// knockout tree is derived from the draw lines with confirmed results only.
import { describe, expect, it } from 'vitest';
import { bracketColumns, bracketMatchSummary, entryRows, rankingRows, scheduleRows, sideName, statusBadge } from '../../src/components/competition/helpers';
import {
  buildCompetitionSite,
  competitionLinkFor,
  competitionTournamentJsonLd,
  displayStatus,
  eventTitle,
  publicRank,
  tournamentPlace,
  updatedText,
  tournamentWhen,
  type CompetitionEventPage,
} from '../../src/lib/competition/public/model';
import { emptyCompetitionData } from '../../src/lib/competition/public/provider';
import { SEED_ENTRY_FACES, SEED_NAMED_WITHOUT_ARCHIVE_MATCH, seedCompetitionData } from '../../src/lib/competition/public/seed';
import { path } from '../../src/lib/urls';

const site = buildCompetitionSite(seedCompetitionData(), { source: 'seed' });
const event = (slug: string, code: string): CompetitionEventPage => {
  const e = site.tournaments.find((t) => t.slug === slug)?.events.find((x) => x.code === code);
  if (!e) throw new Error(`no event ${slug}/${code}`);
  return e;
};
const ms = event('sample-city-open-2026', 'ms');
const xd = event('sample-city-open-2026', 'xd-open');
const bs = event('sample-city-open-2026', 'bs-u15');
const wd = event('demo-corporate-shuttle-league-2026', 'wd');
const college = event('trial-college-games-2026', 'ms');

/** Every text the components would print for an event (through the same helpers they use). */
function renderedText(e: CompetitionEventPage): string {
  const parts: string[] = [];
  parts.push(...entryRows(e.entries).map((r) => `${r.seedText} ${r.name} ${r.club}`));
  for (const g of e.groups) parts.push(...entryRows(g.entries).map((r) => r.name));
  for (const col of bracketColumns(e.bracket ?? [])) parts.push(...col.matches.map(bracketMatchSummary));
  parts.push(...scheduleRows(e.schedule).map((r) => `${r.sideA} versus ${r.sideB} ${r.statusText}`));
  parts.push(...e.results.map((r) => `${sideName(r.a)} versus ${sideName(r.b)}`));
  return parts.join('\n');
}

describe('the seed site', () => {
  it('has both fictional tournaments, newest first, with valid slash paths', () => {
    expect(site.tournaments.map((t) => t.slug)).toEqual(['sample-city-open-2026', 'demo-corporate-shuttle-league-2026', 'trial-college-games-2026']);
    for (const t of site.tournaments) {
      expect(t.path).toBe(path(t.path));
      for (const e of t.events) {
        expect(e.path).toBe(`/competitions/${t.slug}/${e.code}/`);
        expect(e.path).toBe(path(e.path));
      }
    }
    expect(site.dropped).toEqual({ tournaments: 0, events: 0, rankingSnapshots: 1 });
  });

  it('titles, dates (India dates) and places read plainly', () => {
    expect(eventTitle('MS', null)).toBe("Men's singles");
    expect(bs.title).toMatch(/^Boys' singles, /);
    const t = site.tournaments[0]!;
    expect(tournamentWhen(t)).toMatch(/7.8 November 2026/);
    expect(tournamentPlace(t)).toBe('Demo Indoor Stadium, Sampleur');
    expect(tournamentWhen({ startDate: null, endDate: null })).toBe('Dates to be confirmed');
  });
});

describe('protected players are never named (D-012, D-109)', () => {
  const all = site.tournaments.flatMap((t) => t.events);
  const everything = all.map(renderedText).join('\n') + JSON.stringify(site);

  it('the unknown-age player, the protected pair and the junior event names appear nowhere in the model', () => {
    for (const leak of ['Trial Junior Leak', 'trial-junior-leak', 'Mock Prakash D', 'mock-prakash-d', 'Trial College Leak', 'trial-college-leak']) {
      expect(everything).not.toContain(leak);
    }
  });

  it('no player slug or player link reaches the model (player pages belong to the archive)', () => {
    const json = JSON.stringify(site);
    for (const face of Object.values(SEED_ENTRY_FACES)) {
      for (const s of [face.player1_slug, face.player2_slug]) if (s) expect(json).not.toContain(`"${s}"`);
    }
    expect(json).not.toContain('/players/');
  });

  it('an adult-confirmed public player with no archive match is named (the competition rule needs no video)', () => {
    const { entryId, name } = SEED_NAMED_WITHOUT_ARCHIVE_MATCH;
    expect(SEED_ENTRY_FACES[entryId]).toMatchObject({ player1_name: name, is_protected: false });
    expect(renderedText(ms)).toContain(name);
    expect(rankingRows(site.rankings[0]!.items).map((r) => r.name)).toContain(name);
  });

  it('a junior event names nobody, even a row the SQL should have nulled', () => {
    expect(bs.junior).toBe(true);
    const text = renderedText(bs);
    expect(text).toContain('Protected player');
    expect(text).not.toMatch(/Trial|Demo|Mock|Sample/);
  });

  it("an adult category in a minor-signal tournament (the view's is_junior) names nobody, even rows the SQL should have nulled", () => {
    expect(college.category).toBe('MS');
    expect(college.junior).toBe(true);
    const text = renderedText(college);
    expect(text).toContain('Protected player');
    expect(text).not.toMatch(/Trial College Leak/);
    expect(college.results).toHaveLength(1);
  });

  it('an event row without the junior flag is treated as junior (fail closed)', () => {
    const raw = seedCompetitionData();
    const events = raw.events.map((e) => (e.id === 'ce-ms' ? { ...e, is_junior: undefined } : e.id === 'ce-xd' ? { ...e, is_junior: null } : e));
    const s2 = buildCompetitionSite({ ...raw, events }, { source: 'seed' });
    for (const code of ['ms', 'xd-open']) {
      const e = s2.tournaments[0]!.events.find((x) => x.code === code)!;
      expect(e.junior).toBe(true);
      expect(renderedText(e)).not.toMatch(/Demo|Mock|Sample/);
    }
  });

  it('an unknown-age adult in an adult event reads "Protected player" with no club', () => {
    const rows = entryRows(ms.entries);
    expect(rows.map((r) => r.name)).toContain('Protected player');
    expect(rows.find((r) => r.name === 'Protected player')?.club).toBe('');
    expect(rows.map((r) => r.name)).toContain('Demo Karthik R');
  });

  it('a doubles pair with one protected player is masked as a whole', () => {
    const names = entryRows(xd.entries).map((r) => r.name);
    expect(names).toContain('Protected player / Protected player');
    expect(names).toContain('Demo Ravi M / Mock Nithya S');
  });
});

describe('knockout draw', () => {
  const cols = bracketColumns(ms.bracket ?? []);

  it('shows the whole tree from the draw lines: quarter-finals, semi-finals, final', () => {
    expect(cols.map((c) => c.code)).toEqual(['QF', 'SF', 'F']);
    expect(cols[0]!.matches).toHaveLength(4);
  });

  it('byes advance without a match', () => {
    const summaries = cols[0]!.matches.map(bracketMatchSummary);
    expect(summaries[0]).toBe('[1] Demo Karthik R advances without a match (bye)');
    expect(summaries[3]).toBe('[2] Mock Bala S advances without a match (bye)');
  });

  it('confirmed results advance winners; a stored match with swapped sides is turned round to the draw order', () => {
    const qf3 = cols[0]!.matches[2]!;
    expect(bracketMatchSummary(qf3)).toBe('Demo Vetri K versus Mock Siva P, winner Mock Siva P, walkover');
    const sf = cols[1]!.matches.map(bracketMatchSummary);
    expect(sf[0]).toBe('[1] Demo Karthik R versus Protected player, winner [1] Demo Karthik R, score 21-12, 21-15');
    // the second semi-final waits for its result to be confirmed: no winner, no score
    expect(sf[1]).toBe('Mock Siva P versus [2] Mock Bala S, completed');
    expect(bracketMatchSummary(cols[2]!.matches[0]!)).toBe('[1] Demo Karthik R versus To be decided, scheduled');
  });

  it('groups then knockout: one table per group and the knockout stage as stored', () => {
    expect(wd.groups.map((g) => g.label)).toEqual(['Group A', 'Group B']);
    expect(bracketColumns(wd.bracket ?? []).map((c) => c.code)).toEqual(['F']);
    expect(xd.bracket).toBeNull();
  });

  it('a confirmed stored result that does not fit the derived tree (a hand-fixed pairing) shows the rounds as stored instead', () => {
    const raw = seedCompetitionData();
    // the owner swapped a semi-final opponent by hand: seed 1 played en-ms-3, not the quarter-final winner en-ms-4
    const matches = raw.matches.map((m) =>
      m.id === 'cm-ms-sf1' ? { ...m, side_b_entry: 'en-ms-3', side_b_player1_name: 'Sample Arul T', side_b_player1_slug: 'sample-arul-t', side_b_protected: false } : m,
    );
    const s2 = buildCompetitionSite({ ...raw, matches }, { source: 'seed' });
    const e = s2.tournaments[0]!.events.find((x) => x.code === 'ms')!;
    const cols = bracketColumns(e.bracket ?? []);
    // as stored: two quarter-finals, two semi-finals, one final (no derived bye lines)
    expect(cols.map((c) => c.matches.length)).toEqual([2, 2, 1]);
    expect(bracketMatchSummary(cols[1]!.matches[0]!)).toBe('Demo Karthik R versus Sample Arul T, winner Demo Karthik R, score 21-12, 21-15');
    // the draw and the results list agree
    const r = e.results.find((x) => x.id === 'cm-ms-sf1')!;
    expect(r.winner).toBe('A');
    expect(sideName(r.b)).toBe('Sample Arul T');
  });

  it('the seed tree uses every confirmed stored knockout result (no fallback)', () => {
    expect(bracketColumns(ms.bracket ?? [])[0]!.matches).toHaveLength(4);
  });
});

describe('order of play and results', () => {
  it('the order of play holds every match without a confirmed result, times in India time', () => {
    const rows = scheduleRows(ms.schedule);
    expect(rows.map((r) => r.id)).toEqual(['cm-ms-sf2', 'cm-ms-f']);
    expect(rows[0]!.timeText).toBe('3:00 pm IST');
    expect(ms.awaitingCount).toBe(1);
  });

  it('results are confirmed results only, with games', () => {
    expect(ms.results.map((r) => r.id)).toEqual(['cm-ms-qf2', 'cm-ms-qf3', 'cm-ms-sf1']);
    expect(ms.results.find((r) => r.id === 'cm-ms-qf3')).toMatchObject({ status: 'walkover', winner: 'A', games: [] });
    expect(wd.results.find((r) => r.id === 'cm-wd-b')).toMatchObject({ status: 'retired', winner: 'A' });
  });

  it('never "Live" on a static page: an in-progress match is in the order of play with its plain status', () => {
    expect(scheduleRows(xd.schedule).find((r) => r.id === 'cm-xd-2')?.statusText).toBe('In progress');
    for (const r of [...ms.results, ...xd.results, ...bs.results, ...wd.results]) {
      expect(r.status).not.toBe('live');
      expect(statusBadge({ live: false, status: r.status, now: new Date(site.generatedAt) }).isLive).toBe(false);
    }
  });

  it('an unconfirmed result reads as finished and never carries a winner', () => {
    expect(displayStatus('awaiting_result')).toBe('completed');
    expect(displayStatus('postponed')).toBe('postponed');
  });
});

describe('rankings', () => {
  it('only the adult snapshot, without the protected row; the junior snapshot is left out', () => {
    expect(site.rankings).toHaveLength(1);
    const r = site.rankings[0]!;
    expect(r.asOf).toBe('2026-10-15');
    const rows = rankingRows(r.items);
    expect(rows.map((x) => x.name)).toEqual(['Demo Karthik R', 'Mock Siva P', 'Sample Arul T', 'Mock Bala S']);
    // the protected row (rank 4) is left out WITHOUT a gap: the shown rows are renumbered among themselves
    expect(rows.map((x) => x.rankText)).toEqual(['1', '=2', '=2', '4']);
    expect(JSON.stringify(site.rankings)).not.toContain('Protected player');
    expect(JSON.stringify(site.rankings)).not.toContain('Trial Junior Leak');
  });
});

describe('ranking numbers leave no trace of a hidden player', () => {
  const ladder = (rows: Array<[number, string | null, boolean]>) => {
    const raw = seedCompetitionData();
    const base = raw.rankings.find((r) => r.snapshot_id === 'rs-ms')!;
    const rankings = rows.map(([rank, name, prot], i) => ({ ...base, rank, player_name: name, player_slug: name ? `demo-row-${i}` : null, is_protected: prot }));
    return rankingRows(buildCompetitionSite({ ...raw, rankings }, { source: 'seed' }).rankings[0]!.items);
  };

  it('a hidden player at rank 1: the first shown row is 1', () => {
    const rows = ladder([[1, null, true], [2, 'Demo Row A', false], [3, 'Demo Row B', false]]);
    expect(rows.map((r) => r.rankText)).toEqual(['1', '2']);
  });

  it('a hidden player tied with shown ones, and hidden players in a row', () => {
    const rows = ladder([[1, 'Demo Row A', false], [2, null, true], [2, 'Demo Row B', false], [4, null, true], [5, null, true], [6, 'Demo Row C', false], [6, 'Demo Row D', false], [8, 'Demo Row E', false]]);
    expect(rows.map((r) => r.rankText)).toEqual(['1', '2', '=3', '=3', '5']);
  });

  it('publicRank counts only strictly better shown rows', () => {
    const shown = [{ rank: 1 }, { rank: 3 }, { rank: 3 }, { rank: 7 }];
    expect(shown.map((r) => publicRank(r.rank, shown))).toEqual([1, 2, 2, 4]);
  });
});

describe('the snapshot time', () => {
  it('is printed in India time through src/lib/dates.ts', () => {
    expect(updatedText('2026-10-30T06:30:00.000Z')).toBe('Updated Friday, 30 October 2026 at 12:00 pm (India time)');
    expect(updatedText(site.generatedAt)).toMatch(/^Updated .+India time\)$/);
  });

  it('an unreadable instant prints nothing rather than a wrong time', () => {
    expect(updatedText('not a time')).toBe('');
  });
});

describe('fail closed on bad data', () => {
  it('drops a tournament with a reserved or malformed slug, and its events', () => {
    const raw = seedCompetitionData();
    const s = buildCompetitionSite(
      { ...raw, tournaments: raw.tournaments.map((t, i) => (i === 0 ? { ...t, slug: 'rankings' } : { ...t, slug: 'Bad Slug' })) },
      { source: 'seed' },
    );
    expect(s.tournaments).toEqual([]);
    expect(s.dropped.tournaments).toBe(3);
    expect(s.dropped.events).toBe(5);
  });

  it('drops an event with an age group outside the vocabulary or a draft status', () => {
    const raw = seedCompetitionData();
    const events = raw.events.map((e) => (e.id === 'ce-ms' ? { ...e, age_group: 'U-17 boys' } : e.id === 'ce-xd' ? { ...e, status: 'draft' as never } : e));
    const s = buildCompetitionSite({ ...raw, events }, { source: 'seed' });
    expect(s.dropped.events).toBe(2);
  });

  it('a draw that is not a clean bracket falls back to the stored rounds without guessing', () => {
    const raw = seedCompetitionData();
    const s = buildCompetitionSite({ ...raw, slots: raw.slots.filter((x) => !(x.draw_id === 'cd-ms' && x.position === 8)) }, { source: 'seed' });
    const e = s.tournaments[0]!.events.find((x) => x.code === 'ms')!;
    const cols = bracketColumns(e.bracket ?? []);
    expect(cols.map((c) => c.code)).toEqual(['QF', 'SF', 'F']);
    expect(cols[0]!.matches).toHaveLength(2);
  });

  it('an empty snapshot gives an empty site', () => {
    const s = buildCompetitionSite(emptyCompetitionData(), { source: 'supabase' });
    expect(s.tournaments).toEqual([]);
    expect(s.rankings).toEqual([]);
  });
});

describe('links and structured data', () => {
  it('a real tournament page links its competition page; the seed is never linked', () => {
    const own = { slug: 'sample-city-open-2026', startDate: '2026-11-07' };
    expect(competitionLinkFor(site, own)).toBeNull();
    const real = { ...site, source: 'supabase' as const };
    expect(competitionLinkFor(real, own)).toBe('/competitions/sample-city-open-2026/');
    expect(competitionLinkFor(real, { slug: 'not-there', startDate: '2026-11-07' })).toBeNull();
  });

  it('the same slug with a different start date is an unrelated tournament and is not linked', () => {
    const real = { ...site, source: 'supabase' as const };
    expect(competitionLinkFor(real, { slug: 'sample-city-open-2026', startDate: '2025-11-07' })).toBeNull();
    expect(competitionLinkFor(real, { slug: 'sample-city-open-2026', startDate: null })).toBeNull();
    const undated = { ...real, tournaments: real.tournaments.map((t) => ({ ...t, startDate: null })) };
    expect(competitionLinkFor(undated, { slug: 'sample-city-open-2026', startDate: '2026-11-07' })).toBeNull();
  });

  it('SportsEvent JSON-LD only for real data, with the canonical slash URL and no player', () => {
    const t = site.tournaments[0]!;
    expect(competitionTournamentJsonLd(t, 'seed', 'https://example.test')).toBeNull();
    const ld = competitionTournamentJsonLd(t, 'supabase', 'https://example.test');
    expect(ld).toMatchObject({ '@type': 'SportsEvent', url: 'https://example.test/competitions/sample-city-open-2026/', startDate: '2026-11-07' });
    expect(JSON.stringify(ld)).not.toMatch(/Demo Karthik|Protected/);
  });
});
