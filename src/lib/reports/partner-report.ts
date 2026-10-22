// The monthly "Power Smash Partner Report" (spec 8.3, 14; D-031, D-016). PURE: counts in, a report object and a CSV out.
//
// What it reports: per sponsor and calendar month (IST), impressions, clicks, CTR (clicks / impressions) and the top pages, in total and
// per placement. What it NEVER does: invent a figure (a month with no data reports zeros and says "no data", a day with no row counts
// as zero), score, rank or estimate reach, or use YouTube view counts (D-016). CTR is shown only when there is at least one impression.
// Every report carries the counting rules and the ad-blocker note, because under-counting is real (D-031).
import { basisPoints, percentFromBasisPoints, toCsv } from './csv';
import type { CsvCell } from './csv';

export interface ReportPlacement {
  id: string;
  sponsorId: string;
  slot: string;
  /** Tournament slug when the placement is for one tournament. */
  scopeKey: string | null;
  label: string;
  startDate: string;
  endDate: string;
}

export interface DailyStat {
  placementId: string;
  /** IST calendar date YYYY-MM-DD. */
  date: string;
  impressions: number;
  clicks: number;
}

export interface PageStat {
  placementId: string;
  date: string;
  pagePath: string;
  impressions: number;
  clicks: number;
}

export interface ReportInput {
  sponsor: { id: string; name: string };
  /** Calendar month `YYYY-MM` (IST). */
  month: string;
  placements: readonly ReportPlacement[];
  daily: readonly DailyStat[];
  pages: readonly PageStat[];
  /** IST date of the report run; a month that has not ended yet is marked as partial. */
  today: string;
  /** How many top pages to list. Default 10. */
  topPages?: number;
}

export interface Totals {
  impressions: number;
  clicks: number;
  /** Basis points (clicks per 10,000 impressions), or null when there were no impressions. */
  ctrBp: number | null;
  /** The same as text, "1.25" meaning 1.25 percent, or null. */
  ctrPercent: string | null;
}

export interface PlacementLine extends Totals {
  placementId: string;
  slot: string;
  scopeKey: string | null;
  label: string;
}

export interface PageLine extends Totals {
  pagePath: string;
}

export interface PartnerReport {
  sponsorName: string;
  month: string;
  /** True when the month has not finished at `today`: the figures are to date. */
  partial: boolean;
  /** True when no counter row exists for the sponsor in the month. */
  noData: boolean;
  totals: Totals;
  perPlacement: PlacementLine[];
  topPages: PageLine[];
  notes: string[];
}

export const COUNTING_NOTES: readonly string[] = [
  'An impression is counted when a placement was at least half visible on screen for one second, once per visitor session per day.',
  'A click is a visit through the tracked Power Smash link. Clicks by automated visitors are not counted.',
  'Click-through rate is clicks divided by impressions, shown only when there is at least one impression.',
  'Visitors who use an ad blocker or switch off scripts are not counted, so the real numbers can be higher than reported.',
];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value);
}

/** First and last IST calendar date of a `YYYY-MM` month. */
export function monthRange(month: string): { from: string; to: string } {
  if (!isMonth(month)) throw new RangeError('month must be YYYY-MM');
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const nonNeg = (n: number): number => (Number.isSafeInteger(n) && n > 0 ? n : 0);

function totalsOf(impressions: number, clicks: number): Totals {
  const bp = basisPoints(clicks, impressions);
  return { impressions, clicks, ctrBp: bp, ctrPercent: bp === null ? null : percentFromBasisPoints(bp) };
}

export function buildPartnerReport(input: ReportInput): PartnerReport {
  const { from, to } = monthRange(input.month);
  const mine = input.placements.filter((p) => p.sponsorId === input.sponsor.id);
  const ids = new Set(mine.map((p) => p.id));
  const inMonth = (date: string): boolean => date >= from && date <= to;

  const perPlacementMap = new Map<string, { i: number; c: number }>();
  for (const p of mine) perPlacementMap.set(p.id, { i: 0, c: 0 });
  let rowCount = 0;
  for (const d of input.daily) {
    if (!ids.has(d.placementId) || !inMonth(d.date)) continue;
    rowCount += 1;
    const acc = perPlacementMap.get(d.placementId);
    if (!acc) continue;
    acc.i += nonNeg(d.impressions);
    acc.c += nonNeg(d.clicks);
  }

  const perPlacement: PlacementLine[] = mine
    .map((p) => {
      const acc = perPlacementMap.get(p.id) ?? { i: 0, c: 0 };
      return { placementId: p.id, slot: p.slot, scopeKey: p.scopeKey, label: p.label, ...totalsOf(acc.i, acc.c) };
    })
    .sort((a, b) => b.impressions - a.impressions || (a.placementId < b.placementId ? -1 : 1));

  const totalI = perPlacement.reduce((s, p) => s + p.impressions, 0);
  const totalC = perPlacement.reduce((s, p) => s + p.clicks, 0);

  const pageMap = new Map<string, { i: number; c: number }>();
  for (const pg of input.pages) {
    if (!ids.has(pg.placementId) || !inMonth(pg.date)) continue;
    const acc = pageMap.get(pg.pagePath) ?? { i: 0, c: 0 };
    acc.i += nonNeg(pg.impressions);
    acc.c += nonNeg(pg.clicks);
    pageMap.set(pg.pagePath, acc);
  }
  const topPages: PageLine[] = [...pageMap.entries()]
    .map(([pagePath, v]) => ({ pagePath, ...totalsOf(v.i, v.c) }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || (a.pagePath < b.pagePath ? -1 : 1))
    .slice(0, Math.max(1, Math.min(50, input.topPages ?? 10)));

  const partial = input.today <= to;
  const notes = [...COUNTING_NOTES];
  if (partial) notes.push(`This month is not finished: the figures are up to ${input.today < from ? from : input.today}.`);
  if (rowCount === 0 && totalC === 0) notes.push('There are no counts for this month.');

  return {
    sponsorName: input.sponsor.name,
    month: input.month,
    partial,
    noData: rowCount === 0 && totalC === 0,
    totals: totalsOf(totalI, totalC),
    perPlacement,
    topPages,
    notes,
  };
}

const ctrCell = (t: Totals): CsvCell => t.ctrPercent ?? '';

/** The partner report as CSV text: a header block, one line per placement, then the top pages, then the notes. */
export function partnerReportCsv(report: PartnerReport): string {
  const rows: CsvCell[][] = [
    ['Power Smash Partner Report'],
    ['Sponsor', report.sponsorName],
    ['Month', report.month],
    ['Status', report.partial ? 'Month in progress' : 'Month complete'],
    [],
    ['Summary'],
    ['Impressions', 'Clicks', 'CTR (%)'],
    [report.totals.impressions, report.totals.clicks, ctrCell(report.totals)],
    [],
    ['By placement'],
    ['Slot', 'Tournament', 'Label', 'Impressions', 'Clicks', 'CTR (%)'],
    ...report.perPlacement.map((p) => [p.slot, p.scopeKey ?? '', p.label, p.impressions, p.clicks, ctrCell(p)]),
    [],
    ['Top pages'],
    ['Page', 'Impressions', 'Clicks', 'CTR (%)'],
    ...report.topPages.map((p) => [p.pagePath, p.impressions, p.clicks, ctrCell(p)]),
    [],
    ['Notes'],
    ...report.notes.map((n) => [n]),
  ];
  return toCsv(rows);
}

/** A safe file name: `power-smash-partner-report-<sponsor>-<month>.csv`. */
export function partnerReportFileName(sponsorName: string, month: string): string {
  const slug = sponsorName
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `power-smash-partner-report-${slug || 'sponsor'}-${month}.csv`;
}
