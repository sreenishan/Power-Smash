/**
 * Catalogue profile: runs the real parser over a list of videos and measures it (BUILD_PLAN M0 item 5, DoD 1).
 *
 * `analyse()` returns TWO things:
 *  - `report`: counts, percentages and anonymised pattern shapes only. It never holds an input title, a player name or a
 *    tournament name (a test asserts it). This is the part that may be pasted into chat.
 *  - `detail`: the same findings WITH real titles, names and ids. Written only when the owner passes --show-titles, and only
 *    to a git-ignored folder (see cli.ts).
 *
 * Definitions (also in docs/PROFILING.md):
 *  - match-style = the parser says `match` or `team_tie`, the video type is `match` (not a Short, not live) and it is not
 *    international (international videos are hidden and create no entities, so they never wait in the review queue).
 *  - held = `needsReview || minorHold`: the pipeline holds a match when either is true (D-012, types.ts).
 *  - auto-accept = match-style and not held. DoD 1 = auto-accept / match-style, with a 95% Wilson interval.
 *  - Not modelled: the sync's SHORT_UNCERTAIN extra review reason and the identity step's AMBIGUOUS_ALIAS (both need data the
 *    title list does not have), so the real review queue can be slightly larger than the one measured here.
 */
import { PARSER_VERSION, parseTitle } from '../parser';
import { DOUBLES_CATEGORIES } from '../parser/vocab';
import type { ParseResult } from '../parser/types';
import type { InputItem } from './input';
import { titleShape } from './shape';
import { bump, editDistance, pct, ranked, wilson } from './stats';

export type Row = { index: number; item: InputItem; parse: ParseResult | null; stratum: string; matchStyle: boolean; held: boolean };

export type Counted = { label: string; count: number }[];
const toCounted = (m: Map<string, number>): Counted => ranked(m).map(([label, count]) => ({ label, count }));

export type Report = {
  tool: 'power-smash-catalogue-profile';
  generatedAt: string;
  parserVersion: string;
  input: { videos: number; skippedEntries: number; parserErrors: number };
  counts: {
    byVideoType: Counted;
    byKind: Counted;
    nonMatchReasons: Counted;
    international: number;
    shortsUncertainNote: string;
  };
  matchStyle: {
    total: number;
    autoAccept: number;
    held: number;
    heldByNeedsReview: number;
    heldByMinorHoldOnly: number;
    dod1: { percent: number | null; ci95Low: number | null; ci95High: number | null; target: 90; verdict: string };
    parserOnly: { autoAcceptPercent: number | null; ci95Low: number | null; ci95High: number | null };
    confidenceHistogram: { bucket: string; autoAccept: number; held: number }[];
    hardFlagsRanked: { flag: string; titles: number; soleReason: number }[];
    softFlagsRanked: Counted;
    reviewQueueSize: number;
  };
  age: {
    playerAppearances: number;
    minorSuspected: number;
    unknown: number;
    adultConfirmed: number;
    protectedPercent: number | null;
    distinctPlayers: number;
    distinctPlayersWithMinorSuspected: number;
    titlesWithMinorSuspected: number;
    titlesWithMinorHold: number;
    titlesWithUnknownAgeWord: number;
    ageGroups: Counted;
  };
  shapesOfInterest: {
    textBeforeSideA: { titles: number; percentOfMatchStyle: string; topShapes: { shape: string; count: number }[] };
    slashlessDoubles: { titles: number; percentOfDoubles: string };
    doublesTitles: number;
    firstNameOnly: { appearances: number; titles: number; distinct: number; initialsOnlyAppearances: number };
  };
  tournaments: {
    titlesWithTournament: number;
    titlesWithoutTournament: number;
    clusters: number;
    sizeHistogram: Counted;
    clustersWithSeveralYears: number;
    clustersWithEdition: number;
    possibleSplitClusters: number;
  };
  collisions: {
    distinctKeys: number;
    keysWithSeveralDistricts: number;
    keysWithSeveralAffiliations: number;
    singleTokenKeysAcrossSeries: number;
    keysWithSeveralSpellings: number;
  };
  duplicates: { sameMatchKeyGroups: number; sameMatchKeyPairs: number; nearIdenticalTitlePairs: number; nearIdenticalNamePairs: number; comparedTitles: number };
  fixFirst: {
    patterns: { rank: number; shape: string; titles: number; percentOfHeld: string; topReasons: string[] }[];
    top10CoversPercentOfHeld: string;
    reasonCombinations: { reasons: string; titles: number; percentOfHeld: string }[];
  };
};

export type Detail = {
  heldPatternExamples: { shape: string; examples: { id: string | null; title: string; reasons: string[] }[] }[];
  textBeforeSideA: { id: string | null; title: string; before: string }[];
  slashlessDoubles: { id: string | null; title: string }[];
  firstNameOnly: { id: string | null; title: string; names: string[] }[];
  tournamentClusters: { name: string; titles: number; years: string[]; editions: number[] }[];
  possibleSplitClusters: { a: string; b: string }[];
  collisions: { key: string; spellings: string[]; districts: string[]; affiliations: string[]; series: number }[];
  duplicatePairs: { a: { id: string | null; title: string }; b: { id: string | null; title: string }; kind: string }[];
  nearIdenticalNames: { a: string; b: string }[];
};

export type AnalyseOptions = { now?: Date; maxDuplicateCompare?: number };

const NOTE = 'Short-length videos with no playlist or hashtag signal are not flagged here (the sync adds SHORT_UNCERTAIN for those).';

function bucketOf(points: number): string {
  if (points >= 100) return '100';
  const lo = Math.floor(points / 10) * 10;
  return `${lo}-${lo + 9}`;
}
const BUCKETS = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-99', '100'];

function stripNoise(text: string): string {
  return text.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function classifyRow(item: InputItem): { parse: ParseResult | null } {
  try {
    const parse = parseTitle(item.title, {
      durationSeconds: item.durationSeconds,
      liveBroadcastContent: item.liveBroadcastContent,
      hasLiveStreamingDetails: item.hasLiveStreamingDetails,
      playlist: item.playlist,
      rssLinkType: item.rssLinkType,
      publishedAt: item.publishedAt,
    }) as ParseResult;
    return { parse };
  } catch {
    return { parse: null };
  }
}

function stratumOf(p: ParseResult | null, matchStyle: boolean, held: boolean): string {
  if (p === null) return 'parser_error';
  if (p.isInternational) return 'international';
  if (p.videoType === 'short') return 'short';
  if (p.videoType === 'live') return 'live';
  if (p.kind === 'non_match') return 'non_match';
  if (p.kind === 'team_tie') return held ? 'team_tie_review' : 'team_tie_auto';
  if (matchStyle) return held ? 'match_review' : 'match_auto';
  return 'other';
}

export function analyse(items: readonly InputItem[], skippedEntries = 0, options: AnalyseOptions = {}): { report: Report; detail: Detail; rows: Row[] } {
  const rows: Row[] = items.map((item, index) => {
    const { parse } = classifyRow(item);
    const matchStyle = parse !== null && (parse.kind === 'match' || parse.kind === 'team_tie') && parse.videoType === 'match' && !parse.isInternational;
    const held = matchStyle && parse !== null && (parse.needsReview || parse.minorHold);
    return { index, item, parse, matchStyle, held, stratum: stratumOf(parse, matchStyle, held) };
  });

  const byType = new Map<string, number>();
  const byKind = new Map<string, number>();
  const nonMatch = new Map<string, number>();
  let international = 0;
  let parserErrors = 0;
  for (const r of rows) {
    if (r.parse === null) {
      parserErrors++;
      continue;
    }
    bump(byType, r.parse.videoType);
    bump(byKind, r.parse.kind);
    if (r.parse.kind === 'non_match') bump(nonMatch, r.parse.nonMatchReason ?? 'unknown');
    if (r.parse.isInternational) international++;
  }

  const ms = rows.filter((r) => r.matchStyle && r.parse !== null) as (Row & { parse: ParseResult })[];
  const held = ms.filter((r) => r.held);
  const heldByReview = ms.filter((r) => r.parse.needsReview).length;
  const autoAccept = ms.length - held.length;
  const parserOnlyAuto = ms.length - heldByReview;
  const w = wilson(autoAccept, ms.length);
  const wp = wilson(parserOnlyAuto, ms.length);
  const pc = (v: number | undefined): number | null => (v === undefined ? null : Math.round(v * 1000) / 10);

  const hist = new Map<string, { a: number; h: number }>(BUCKETS.map((b) => [b, { a: 0, h: 0 }]));
  const hard = new Map<string, { n: number; sole: number }>();
  const soft = new Map<string, number>();
  for (const r of ms) {
    const h = hist.get(bucketOf(r.parse.confidencePoints)) as { a: number; h: number };
    if (r.held) h.h++;
    else h.a++;
    const reasons = r.parse.reviewReasons.filter((x) => x !== 'LOW_SCORE');
    for (const reason of r.parse.reviewReasons) {
      const e = hard.get(reason) ?? { n: 0, sole: 0 };
      e.n++;
      if (r.parse.reviewReasons.length === 1) e.sole++;
      hard.set(reason, e);
    }
    void reasons;
    for (const s of r.parse.softFlags) bump(soft, s.flag);
  }
  if (held.some((r) => !r.parse.needsReview)) {
    hard.set('MINOR_HOLD', { n: held.filter((r) => r.parse.minorHold).length, sole: held.filter((r) => !r.parse.needsReview).length });
  }

  // ---- age
  let appearances = 0;
  let minor = 0;
  let unknown = 0;
  let adult = 0;
  const distinct = new Map<string, boolean>();
  let titlesMinor = 0;
  let titlesHold = 0;
  let titlesUnknownWord = 0;
  const ageGroups = new Map<string, number>();
  for (const r of ms) {
    const players = [...r.parse.sideA, ...r.parse.sideB];
    let anyMinor = false;
    for (const p of players) {
      appearances++;
      const st = p.ageStatus as string;
      if (st === 'minor_suspected') {
        minor++;
        anyMinor = true;
      } else if (st === 'adult_confirmed') adult++;
      else unknown++;
      const key = p.latinKey ?? p.nameNormalized;
      distinct.set(key, (distinct.get(key) ?? false) || st === 'minor_suspected');
    }
    if (anyMinor) titlesMinor++;
    if (r.parse.minorHold) titlesHold++;
    if (r.parse.ageSignals.some((s) => s.startsWith('unknown_age_word:'))) titlesUnknownWord++;
    if (r.parse.ageGroup) bump(ageGroups, r.parse.ageGroup);
  }

  // ---- shapes of interest
  const beforeShapes = new Map<string, number>();
  const beforeDetail: Detail['textBeforeSideA'] = [];
  let beforeCount = 0;
  const slashless: Detail['slashlessDoubles'] = [];
  let doubles = 0;
  let fnAppear = 0;
  let fnTitles = 0;
  let initialsAppear = 0;
  const fnDistinct = new Set<string>();
  const fnDetail: Detail['firstNameOnly'] = [];
  for (const r of ms) {
    const p = r.parse;
    const first = p.sideA[0];
    if (first) {
      const norm = p.normalizedTitle;
      const at = norm.toLowerCase().indexOf(first.raw.toLowerCase());
      if (at > 0) {
        const before = stripNoise(norm.slice(0, at));
        if (/\p{L}{2,}/u.test(before)) {
          beforeCount++;
          bump(beforeShapes, titleShape(before));
          beforeDetail.push({ id: r.item.id, title: r.item.title, before });
        }
      }
    }
    // The parser leaves a slash-less pair as ONE name or an unknown format, so doubles is read from the format, the category or the word.
    if (p.format === 'doubles' || (p.category !== null && DOUBLES_CATEGORIES.includes(p.category)) || /doubles/iu.test(p.normalizedTitle)) {
      doubles++;
      if (!/[/&+]|\band\b/iu.test(p.normalizedTitle)) slashless.push({ id: r.item.id, title: r.item.title });
    }
    const names: string[] = [];
    for (const pl of [...p.sideA, ...p.sideB]) {
      if (pl.identityTier === 'single_token') {
        fnAppear++;
        fnDistinct.add(pl.latinKey ?? pl.nameNormalized);
        names.push(pl.displayName);
      } else if (pl.identityTier === 'initials_only') initialsAppear++;
    }
    if (names.length > 0) {
      fnTitles++;
      fnDetail.push({ id: r.item.id, title: r.item.title, names });
    }
  }

  // ---- tournaments
  const clusters = new Map<string, { name: string; titles: number; years: Set<string>; editions: Set<number> }>();
  let withTournament = 0;
  for (const r of ms) {
    const p = r.parse;
    if (p.seriesKey) {
      withTournament++;
      const c = clusters.get(p.seriesKey) ?? { name: p.tournamentName ?? p.seriesKey, titles: 0, years: new Set<string>(), editions: new Set<number>() };
      c.titles++;
      if (p.seasonLabel) c.years.add(p.seasonLabel);
      else if (p.year !== null) c.years.add(String(p.year));
      if (p.editionNo !== null) c.editions.add(p.editionNo);
      clusters.set(p.seriesKey, c);
    }
  }
  const sizeHist = new Map<string, number>([['1', 0], ['2-4', 0], ['5-9', 0], ['10+', 0]]);
  for (const c of clusters.values()) bump(sizeHist, c.titles === 1 ? '1' : c.titles <= 4 ? '2-4' : c.titles <= 9 ? '5-9' : '10+');
  const keys = [...clusters.keys()];
  const splitPairs: Detail['possibleSplitClusters'] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i] as string;
      const b = keys[j] as string;
      if (a.length >= 8 && Math.abs(a.length - b.length) <= 2 && editDistance(a, b, 2) <= 2) splitPairs.push({ a, b });
    }
  }

  // ---- collisions
  type Ctx = { spellings: Set<string>; districts: Set<string>; affiliations: Set<string>; series: Set<string>; single: boolean };
  const ctxs = new Map<string, Ctx>();
  for (const r of ms) {
    for (const pl of [...r.parse.sideA, ...r.parse.sideB]) {
      const key = pl.latinKey ?? pl.nameNormalized;
      const c = ctxs.get(key) ?? { spellings: new Set(), districts: new Set(), affiliations: new Set(), series: new Set(), single: pl.identityTier === 'single_token' };
      c.spellings.add(pl.displayName);
      if (pl.districtHint) c.districts.add(pl.districtHint);
      if (pl.affiliationHint) c.affiliations.add(pl.affiliationHint.toLowerCase());
      if (r.parse.seriesKey) c.series.add(r.parse.seriesKey);
      ctxs.set(key, c);
    }
  }
  const collisions: Detail['collisions'] = [];
  let sevDist = 0;
  let sevAff = 0;
  let singleAcross = 0;
  let sevSpell = 0;
  for (const [key, c] of ctxs) {
    const d = c.districts.size > 1;
    const a = c.affiliations.size > 1;
    if (d) sevDist++;
    if (a) sevAff++;
    if (c.single && c.series.size > 1) singleAcross++;
    if (c.spellings.size > 1) sevSpell++;
    if (d || a || (c.single && c.series.size > 1)) {
      collisions.push({ key, spellings: [...c.spellings], districts: [...c.districts], affiliations: [...c.affiliations], series: c.series.size });
    }
  }

  // ---- duplicates
  const byMatchKey = new Map<string, Row[]>();
  for (const r of ms) if (r.parse.matchKey) byMatchKey.set(r.parse.matchKey, [...(byMatchKey.get(r.parse.matchKey) ?? []), r]);
  const dupPairs: Detail['duplicatePairs'] = [];
  let groups = 0;
  let pairs = 0;
  for (const g of byMatchKey.values()) {
    if (g.length < 2) continue;
    groups++;
    pairs += (g.length * (g.length - 1)) / 2;
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        dupPairs.push({ a: { id: (g[i] as Row).item.id, title: (g[i] as Row).item.title }, b: { id: (g[j] as Row).item.id, title: (g[j] as Row).item.title }, kind: 'same_match_key' });
      }
    }
  }
  const cap = options.maxDuplicateCompare ?? 6000;
  const cmp = ms.filter((r) => r.parse.normalizedTitle.length >= 15).slice(0, cap).map((r) => ({ r, t: r.parse.normalizedTitle.toLowerCase() }));
  cmp.sort((a, b) => a.t.length - b.t.length);
  let nearTitles = 0;
  for (let i = 0; i < cmp.length; i++) {
    for (let j = i + 1; j < cmp.length; j++) {
      const a = cmp[i] as (typeof cmp)[number];
      const b = cmp[j] as (typeof cmp)[number];
      if (b.t.length - a.t.length > 2) break;
      if (a.t === b.t || editDistance(a.t, b.t, 2) <= 2) {
        nearTitles++;
        dupPairs.push({ a: { id: a.r.item.id, title: a.r.item.title }, b: { id: b.r.item.id, title: b.r.item.title }, kind: a.t === b.t ? 'same_normalised_title' : 'near_identical_title' });
      }
    }
  }
  const nameKeys = [...ctxs.keys()].filter((k) => k.length >= 6).sort((a, b) => a.length - b.length);
  const nearNames: Detail['nearIdenticalNames'] = [];
  for (let i = 0; i < nameKeys.length; i++) {
    for (let j = i + 1; j < nameKeys.length; j++) {
      const a = nameKeys[i] as string;
      const b = nameKeys[j] as string;
      if (b.length - a.length > 1) break;
      if (editDistance(a, b, 1) <= 1) nearNames.push({ a, b });
    }
  }

  // ---- fix first
  const patterns = new Map<string, { rows: (Row & { parse: ParseResult })[]; reasons: Map<string, number> }>();
  const combos = new Map<string, number>();
  for (const r of held) {
    const shape = titleShape(r.item.title);
    const e = patterns.get(shape) ?? { rows: [], reasons: new Map<string, number>() };
    e.rows.push(r);
    const reasons = r.parse.reviewReasons.length > 0 ? r.parse.reviewReasons : ['MINOR_HOLD'];
    for (const x of reasons) bump(e.reasons, x);
    patterns.set(shape, e);
    bump(combos, [...reasons].sort().join(' + '));
  }
  const patternList = [...patterns.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length || (a[0] < b[0] ? -1 : 1));
  const top = patternList.slice(0, 10);
  const topCovered = top.reduce((s, [, e]) => s + e.rows.length, 0);

  const report: Report = {
    tool: 'power-smash-catalogue-profile',
    generatedAt: (options.now ?? new Date()).toISOString(),
    parserVersion: PARSER_VERSION,
    input: { videos: rows.length, skippedEntries, parserErrors },
    counts: { byVideoType: toCounted(byType), byKind: toCounted(byKind), nonMatchReasons: toCounted(nonMatch), international, shortsUncertainNote: NOTE },
    matchStyle: {
      total: ms.length,
      autoAccept,
      held: held.length,
      heldByNeedsReview: heldByReview,
      heldByMinorHoldOnly: held.filter((r) => !r.parse.needsReview).length,
      dod1: {
        percent: pc(w?.point),
        ci95Low: pc(w?.low),
        ci95High: pc(w?.high),
        target: 90,
        verdict: w === null ? 'no match-style titles' : w.low * 100 >= 90 ? 'PASS (the whole 95% interval is at or above 90%)' : w.point * 100 >= 90 ? 'LIKELY PASS (the point value is at or above 90% but the interval dips below)' : 'FAIL (below 90%: see "what to fix first")',
      },
      parserOnly: { autoAcceptPercent: pc(wp?.point), ci95Low: pc(wp?.low), ci95High: pc(wp?.high) },
      confidenceHistogram: BUCKETS.map((b) => ({ bucket: b, autoAccept: (hist.get(b) as { a: number }).a, held: (hist.get(b) as { h: number }).h })),
      hardFlagsRanked: [...hard.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1)).map(([flag, v]) => ({ flag, titles: v.n, soleReason: v.sole })),
      softFlagsRanked: toCounted(soft),
      reviewQueueSize: held.length,
    },
    age: {
      playerAppearances: appearances,
      minorSuspected: minor,
      unknown,
      adultConfirmed: adult,
      protectedPercent: appearances === 0 ? null : Math.round(((appearances - adult) / appearances) * 1000) / 10,
      distinctPlayers: distinct.size,
      distinctPlayersWithMinorSuspected: [...distinct.values()].filter(Boolean).length,
      titlesWithMinorSuspected: titlesMinor,
      titlesWithMinorHold: titlesHold,
      titlesWithUnknownAgeWord: titlesUnknownWord,
      ageGroups: toCounted(ageGroups),
    },
    shapesOfInterest: {
      textBeforeSideA: { titles: beforeCount, percentOfMatchStyle: pct(beforeCount, ms.length), topShapes: ranked(beforeShapes).slice(0, 5).map(([shape, count]) => ({ shape, count })) },
      slashlessDoubles: { titles: slashless.length, percentOfDoubles: pct(slashless.length, doubles) },
      doublesTitles: doubles,
      firstNameOnly: { appearances: fnAppear, titles: fnTitles, distinct: fnDistinct.size, initialsOnlyAppearances: initialsAppear },
    },
    tournaments: {
      titlesWithTournament: withTournament,
      titlesWithoutTournament: ms.length - withTournament,
      clusters: clusters.size,
      sizeHistogram: toCounted(sizeHist).sort((a, b) => ['1', '2-4', '5-9', '10+'].indexOf(a.label) - ['1', '2-4', '5-9', '10+'].indexOf(b.label)),
      clustersWithSeveralYears: [...clusters.values()].filter((c) => c.years.size > 1).length,
      clustersWithEdition: [...clusters.values()].filter((c) => c.editions.size > 0).length,
      possibleSplitClusters: splitPairs.length,
    },
    collisions: {
      distinctKeys: ctxs.size,
      keysWithSeveralDistricts: sevDist,
      keysWithSeveralAffiliations: sevAff,
      singleTokenKeysAcrossSeries: singleAcross,
      keysWithSeveralSpellings: sevSpell,
    },
    duplicates: { sameMatchKeyGroups: groups, sameMatchKeyPairs: pairs, nearIdenticalTitlePairs: nearTitles, nearIdenticalNamePairs: nearNames.length, comparedTitles: cmp.length },
    fixFirst: {
      patterns: top.map(([shape, e], i) => ({
        rank: i + 1,
        shape,
        titles: e.rows.length,
        percentOfHeld: pct(e.rows.length, held.length),
        topReasons: ranked(e.reasons).slice(0, 3).map(([k, n]) => `${k} (${n})`),
      })),
      top10CoversPercentOfHeld: pct(topCovered, held.length),
      reasonCombinations: ranked(combos).slice(0, 10).map(([reasons, titles]) => ({ reasons, titles, percentOfHeld: pct(titles, held.length) })),
    },
  };

  const detail: Detail = {
    heldPatternExamples: top.map(([shape, e]) => ({
      shape,
      examples: e.rows.slice(0, 3).map((r) => ({ id: r.item.id, title: r.item.title, reasons: [...r.parse.reviewReasons] })),
    })),
    textBeforeSideA: beforeDetail,
    slashlessDoubles: slashless,
    firstNameOnly: fnDetail,
    tournamentClusters: [...clusters.values()].sort((a, b) => b.titles - a.titles).map((c) => ({ name: c.name, titles: c.titles, years: [...c.years].sort(), editions: [...c.editions].sort((x, y) => x - y) })),
    possibleSplitClusters: splitPairs,
    collisions,
    duplicatePairs: dupPairs,
    nearIdenticalNames: nearNames,
  };
  return { report, detail, rows };
}
