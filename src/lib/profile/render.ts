/** Markdown renderers for the profile report (counts only) and the private detail file (real titles). */
import type { Counted, Detail, Report } from './analyse';

const table = (head: string[], rows: (string | number)[][]): string =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/gu, '\\|')).join(' | ')} |`)].join('\n');
const counted = (title: string, c: Counted): string => (c.length === 0 ? `${title}: none.` : table([title, 'Count'], c.map((x) => [x.label, x.count])));
const n = (v: number | null): string => (v === null ? 'n/a' : `${v}%`);

export function renderReport(r: Report): string {
  const m = r.matchStyle;
  const out: string[] = [];
  out.push('# Power Smash catalogue profile (counts only)', '');
  out.push(`Generated ${r.generatedAt}. Parser ${r.parserVersion}. This file has no video titles, no player names and no tournament names: it is safe to paste into chat.`, '');
  out.push('## 1. The headline: DoD 1', '');
  out.push(`- Match-style videos: **${m.total}** (of ${r.input.videos} videos read; ${r.input.skippedEntries} entries skipped; ${r.input.parserErrors} parser errors).`);
  out.push(`- Auto-accepted (no review, no minor hold): **${m.autoAccept}**. Held for the review queue: **${m.held}**.`);
  out.push(`- **DoD 1 number: ${n(m.dod1.percent)}** auto-accept, 95% interval ${n(m.dod1.ci95Low)} to ${n(m.dod1.ci95High)} (Wilson). Target: at least 90%. Verdict: ${m.dod1.verdict}.`);
  out.push(`- Parser score alone (ignoring the minor hold): ${n(m.parserOnly.autoAcceptPercent)} (${n(m.parserOnly.ci95Low)} to ${n(m.parserOnly.ci95High)}).`);
  out.push(`- Review queue size at launch: **${m.reviewQueueSize}** (${m.heldByNeedsReview} from the parser, ${m.heldByMinorHoldOnly} only because of a minor hold).`, '');
  out.push('## 2. What is in the catalogue', '');
  out.push(counted('Video type', r.counts.byVideoType), '', counted('Parser kind', r.counts.byKind), '', counted('Non-match reason', r.counts.nonMatchReasons), '');
  out.push(`International videos (hidden, no pages): ${r.counts.international}. ${r.counts.shortsUncertainNote}`, '');
  out.push('## 3. Confidence of match-style titles', '');
  out.push(table(['Score', 'Auto-accept', 'Held'], m.confidenceHistogram.map((b) => [b.bucket, b.autoAccept, b.held])), '');
  out.push('## 4. Why titles are held (ranked)', '');
  out.push(table(['Reason', 'Titles', 'Only reason'], m.hardFlagsRanked.map((h) => [h.flag, h.titles, h.soleReason])), '');
  out.push(counted('Soft flag (points off, any title)', m.softFlagsRanked), '');
  const a = r.age;
  out.push('## 5. Age and the protected-player load', '');
  out.push(`The parser never confirms an adult, so every player is protected until the owner confirms (D-012). Player appearances in match-style titles: ${a.playerAppearances}; minor_suspected ${a.minorSuspected}; unknown ${a.unknown}; adult_confirmed ${a.adultConfirmed}; protected ${n(a.protectedPercent)}.`);
  out.push(`Distinct players (by name key): ${a.distinctPlayers}, of which seen with a minor signal at least once: ${a.distinctPlayersWithMinorSuspected}. Titles with a minor-suspected player: ${a.titlesWithMinorSuspected}; titles on minor hold: ${a.titlesWithMinorHold}; titles with an unmapped age-like word: ${a.titlesWithUnknownAgeWord}.`, '');
  out.push(counted('Age group in title', a.ageGroups), '');
  const s = r.shapesOfInterest;
  out.push('## 6. Shapes the parser struggles with', '');
  out.push(`- Text before side A: ${s.textBeforeSideA.titles} titles (${s.textBeforeSideA.percentOfMatchStyle} of match-style). Most common shapes: ${s.textBeforeSideA.topShapes.map((x) => `\`${x.shape}\` (${x.count})`).join(', ') || 'none'}.`);
  out.push(`- Doubles titles: ${s.doublesTitles}; with no slash, ampersand, plus or "and": ${s.slashlessDoubles.titles} (${s.slashlessDoubles.percentOfDoubles} of doubles).`);
  out.push(`- First-name-only players: ${s.firstNameOnly.appearances} appearances in ${s.firstNameOnly.titles} titles, ${s.firstNameOnly.distinct} distinct; initials-only appearances: ${s.firstNameOnly.initialsOnlyAppearances}.`, '');
  const t = r.tournaments;
  out.push('## 7. Tournaments', '');
  out.push(`Titles with a tournament: ${t.titlesWithTournament}; without: ${t.titlesWithoutTournament}. Clusters (same normalised series name): ${t.clusters}; with more than one year or season: ${t.clustersWithSeveralYears}; with an edition number: ${t.clustersWithEdition}; pairs of clusters whose names differ by 2 letters or fewer (maybe one series split in two): ${t.possibleSplitClusters}.`, '');
  out.push(counted('Cluster size (titles)', t.sizeHistogram), '');
  const c = r.collisions;
  out.push('## 8. Name collisions and duplicates', '');
  out.push(`Distinct name keys: ${c.distinctKeys}. Same key with different districts: ${c.keysWithSeveralDistricts}; different affiliations: ${c.keysWithSeveralAffiliations}; first-name-only keys seen in several tournaments (likely different people): ${c.singleTokenKeysAcrossSeries}; keys written in several spellings: ${c.keysWithSeveralSpellings}.`);
  const d = r.duplicates;
  out.push(`Videos sharing a match key (same match uploaded twice?): ${d.sameMatchKeyGroups} groups, ${d.sameMatchKeyPairs} pairs. Titles within 2 edits of each other: ${d.nearIdenticalTitlePairs} pairs (${d.comparedTitles} compared). Player names within 1 edit: ${d.nearIdenticalNamePairs} pairs.`, '');
  out.push('## 9. What to fix first', '');
  out.push(`The ten commonest held title shapes cover ${r.fixFirst.top10CoversPercentOfHeld} of the review queue. Shapes replace letters with classes: Aaaa = Capitalised word, AAA = ALL CAPS, aaa = lower case, T = Tamil word, 9 = digit; "*3" = three in a row.`, '');
  out.push(table(['#', 'Shape', 'Titles', 'Of queue', 'Main reasons'], r.fixFirst.patterns.map((p) => [p.rank, `\`${p.shape}\``, p.titles, p.percentOfHeld, p.topReasons.join(', ')])), '');
  out.push(table(['Reason combination', 'Titles', 'Of queue'], r.fixFirst.reasonCombinations.map((x) => [x.reasons, x.titles, x.percentOfHeld])), '');
  return out.join('\n') + '\n';
}

export const PRIVATE_WARNING =
  'WARNING: THIS FILE HOLDS REAL VIDEO TITLES AND PLAYER NAMES, POSSIBLY UNDER-18 PLAYERS. Keep it on this PC, in the git-ignored tmp folder. Never paste it into chat, an issue, a web tool or a commit.';

export function renderPrivate(d: Detail): string {
  const out: string[] = [`# PRIVATE: titles and names`, '', `**${PRIVATE_WARNING}**`, ''];
  const list = (title: string, lines: string[]): void => {
    out.push(`## ${title} (${lines.length})`, '', ...(lines.length === 0 ? ['None.'] : lines.slice(0, 200).map((l) => `- ${l}`)), lines.length > 200 ? `- ... ${lines.length - 200} more in the JSON file` : '', '');
  };
  out.push('## Held title patterns with examples', '');
  for (const p of d.heldPatternExamples) {
    out.push(`### \`${p.shape}\``, '');
    for (const e of p.examples) out.push(`- ${e.id ?? '(no id)'}: ${e.title}  [${e.reasons.join(', ')}]`);
    out.push('');
  }
  list('Text before side A', d.textBeforeSideA.map((x) => `${x.id ?? ''} before="${x.before}" :: ${x.title}`));
  list('Slash-less doubles', d.slashlessDoubles.map((x) => `${x.id ?? ''} ${x.title}`));
  list('First-name-only players', d.firstNameOnly.map((x) => `${x.id ?? ''} [${x.names.join(', ')}] ${x.title}`));
  list('Tournament clusters', d.tournamentClusters.map((c) => `${c.name}: ${c.titles} titles, years ${c.years.join(', ') || '-'}, editions ${c.editions.join(', ') || '-'}`));
  list('Possible split tournament clusters', d.possibleSplitClusters.map((p) => `${p.a}  <->  ${p.b}`));
  list('Name collisions', d.collisions.map((c) => `${c.key}: spellings ${c.spellings.join(' / ')}; districts ${c.districts.join(', ') || '-'}; affiliations ${c.affiliations.join(', ') || '-'}; ${c.series} series`));
  list('Possible duplicate videos', d.duplicatePairs.map((p) => `${p.kind}: "${p.a.title}" (${p.a.id ?? ''})  <->  "${p.b.title}" (${p.b.id ?? ''})`));
  list('Near-identical player names', d.nearIdenticalNames.map((p) => `${p.a}  <->  ${p.b}`));
  return out.join('\n') + '\n';
}
