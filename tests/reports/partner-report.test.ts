import { describe, expect, it } from 'vitest';
import { COUNTING_NOTES, buildPartnerReport, isMonth, monthRange, partnerReportCsv, partnerReportFileName } from '../../src/lib/reports/partner-report';
import type { DailyStat, PageStat, ReportInput, ReportPlacement } from '../../src/lib/reports/partner-report';

const S1 = { id: 'sponsor-1', name: 'Fictional Shuttles' };
const P1: ReportPlacement = { id: 'p1', sponsorId: 'sponsor-1', slot: 'player_page_banner', scopeKey: null, label: 'Sponsored', startDate: '2026-10-01', endDate: '2026-12-31' };
const P2: ReportPlacement = { id: 'p2', sponsorId: 'sponsor-1', slot: 'footer_partner_strip', scopeKey: null, label: 'Partner', startDate: '2026-10-01', endDate: '2026-12-31' };
const OTHER: ReportPlacement = { id: 'p3', sponsorId: 'sponsor-2', slot: 'player_page_banner', scopeKey: null, label: 'Sponsored', startDate: '2026-10-01', endDate: '2026-12-31' };

const d = (placementId: string, date: string, impressions: number, clicks: number): DailyStat => ({ placementId, date, impressions, clicks });
const pg = (placementId: string, date: string, pagePath: string, impressions: number, clicks: number): PageStat => ({ placementId, date, pagePath, impressions, clicks });

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    sponsor: S1,
    month: '2026-10',
    placements: [P1, P2, OTHER],
    daily: [d('p1', '2026-10-05', 1000, 25), d('p1', '2026-10-06', 500, 5), d('p2', '2026-10-05', 200, 0), d('p3', '2026-10-05', 99999, 999), d('p1', '2026-09-30', 7777, 77), d('p1', '2026-11-01', 8888, 88)],
    pages: [pg('p1', '2026-10-05', '/players/fictional-a/', 900, 20), pg('p1', '2026-10-06', '/players/fictional-a/', 100, 2), pg('p1', '2026-10-05', '/players/fictional-b/', 500, 8), pg('p3', '2026-10-05', '/players/other/', 5000, 50)],
    today: '2026-11-15',
    ...over,
  };
}

describe('partner report numbers', () => {
  it('sums impressions and clicks for the sponsor in the month and computes CTR', () => {
    const r = buildPartnerReport(input());
    expect(r.totals.impressions).toBe(1700);
    expect(r.totals.clicks).toBe(30);
    expect(r.totals.ctrBp).toBe(176); // 30 / 1700 = 1.7647 percent
    expect(r.totals.ctrPercent).toBe('1.76');
    expect(r.partial).toBe(false);
    expect(r.noData).toBe(false);
  });

  it('leaves out other sponsors and other months', () => {
    const r = buildPartnerReport(input());
    expect(r.perPlacement.map((p) => p.placementId).sort()).toEqual(['p1', 'p2']);
    expect(r.totals.impressions).not.toBeGreaterThan(1700);
  });

  it('lists each placement with its own CTR, busiest first, and a zero placement shows no CTR', () => {
    const r = buildPartnerReport(input());
    expect(r.perPlacement[0]).toMatchObject({ placementId: 'p1', impressions: 1500, clicks: 30, ctrPercent: '2.00' });
    expect(r.perPlacement[1]).toMatchObject({ placementId: 'p2', impressions: 200, clicks: 0, ctrPercent: '0.00' });
    const empty = buildPartnerReport(input({ daily: [] }));
    expect(empty.perPlacement.every((p) => p.ctrPercent === null && p.ctrBp === null)).toBe(true);
    expect(empty.totals.ctrPercent).toBeNull();
  });

  it('top pages: summed per path across days, sorted by impressions then clicks then path, limited, sponsor only', () => {
    const r = buildPartnerReport(input());
    expect(r.topPages.map((p) => [p.pagePath, p.impressions, p.clicks])).toEqual([
      ['/players/fictional-a/', 1000, 22],
      ['/players/fictional-b/', 500, 8],
    ]);
    const many = Array.from({ length: 15 }, (_, i) => pg('p1', '2026-10-05', `/players/p${String(i).padStart(2, '0')}/`, 100 - i, 1));
    expect(buildPartnerReport(input({ pages: many })).topPages).toHaveLength(10);
    expect(buildPartnerReport(input({ pages: many, topPages: 3 })).topPages).toHaveLength(3);
  });

  it('a month with no counts says so and reports zeros, never an invented figure', () => {
    const r = buildPartnerReport(input({ month: '2026-08' }));
    expect(r.noData).toBe(true);
    expect(r.totals).toMatchObject({ impressions: 0, clicks: 0, ctrBp: null });
    expect(r.notes.some((n) => n.includes('no counts'))).toBe(true);
  });

  it('marks a month that is still running as partial', () => {
    const r = buildPartnerReport(input({ today: '2026-10-20' }));
    expect(r.partial).toBe(true);
    expect(r.notes.some((n) => n.includes('not finished'))).toBe(true);
  });

  it('ignores negative, fractional and non-numeric counts instead of letting them distort the totals', () => {
    const r = buildPartnerReport(input({ daily: [d('p1', '2026-10-05', -50, 1.5), d('p1', '2026-10-06', Number.NaN, 3), d('p1', '2026-10-07', 10, 1)] }));
    expect(r.totals.impressions).toBe(10);
    expect(r.totals.clicks).toBe(4); // 0 (fractional) + 3 + 1: each count is judged on its own
  });

  it('always carries the counting rules and the ad-blocker note (D-031), and no score or ranking field', () => {
    const r = buildPartnerReport(input());
    for (const n of COUNTING_NOTES) expect(r.notes).toContain(n);
    expect(r.notes.join(' ')).toMatch(/ad blocker/);
    expect(JSON.stringify(r)).not.toMatch(/score|rank|reach|estimate|views/i);
  });

  it('knows its months', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02').to).toBe('2028-02-29');
    expect(monthRange('2026-12').to).toBe('2026-12-31');
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('2026-1')).toBe(false);
    expect(() => monthRange('October')).toThrow(RangeError);
  });
});

describe('partner report CSV', () => {
  it('has the sections in order and plain numbers', () => {
    const csv = partnerReportCsv(buildPartnerReport(input()));
    const text = csv.replace(/^﻿/, '');
    const lines = text.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Power Smash Partner Report');
    expect(lines).toContain('Sponsor,Fictional Shuttles');
    expect(lines).toContain('Month,2026-10');
    expect(lines).toContain('Status,Month complete');
    expect(lines).toContain('Impressions,Clicks,CTR (%)');
    expect(lines).toContain('1700,30,1.76');
    expect(lines).toContain('player_page_banner,,Sponsored,1500,30,2.00');
    expect(lines).toContain('/players/fictional-a/,1000,22,2.20');
    expect(text).not.toMatch(/\d,\d{3}\b(?!,)/); // no digit grouping such as 1,700 or 1,00,000
  });

  it('leaves the CTR cell empty when there were no impressions', () => {
    const csv = partnerReportCsv(buildPartnerReport(input({ daily: [d('p1', '2026-10-05', 0, 0)], pages: [] })));
    expect(csv).toContain('\r\n0,0,\r\n');
  });

  it('defuses a sponsor name that a spreadsheet could run as a formula', () => {
    const csv = partnerReportCsv(buildPartnerReport(input({ sponsor: { id: 'sponsor-1', name: '=HYPERLINK("http://x.example")' } })));
    expect(csv).toContain(`Sponsor,"'=HYPERLINK(""http://x.example"")"`);
    expect(csv).not.toMatch(/\r\nSponsor,=/);
  });

  it('defuses a hostile page path too', () => {
    const csv = partnerReportCsv(buildPartnerReport(input({ pages: [pg('p1', '2026-10-05', '=cmd', 5, 1)] })));
    expect(csv).toContain("'=cmd,5,1");
  });

  it('builds a safe file name', () => {
    expect(partnerReportFileName('Fictional Shuttles Pvt. Ltd.', '2026-10')).toBe('power-smash-partner-report-fictional-shuttles-pvt-ltd-2026-10.csv');
    expect(partnerReportFileName('../../etc/passwd', '2026-10')).toBe('power-smash-partner-report-etc-passwd-2026-10.csv');
    expect(partnerReportFileName('தமிழ்', '2026-10')).toBe('power-smash-partner-report-sponsor-2026-10.csv');
  });
});
