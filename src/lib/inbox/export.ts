// Owner-only CSV export of leads (spec 14, BUILD_PLAN M3 "owner-only CSV exports with controls"). PURE.
//
// Controls:
//  - Only the owner, signed in with MFA (`aal2`), may export (D-007). Anyone else gets a refusal and no data.
//  - The export is capped (EXPORT_MAX_ROWS); a bigger set must be narrowed with a filter first.
//  - Every export returns an audit entry (who, what, how many rows, which filter): the admin writes it to the audit log. It names no lead.
//  - Cells go through the shared CSV writer: formula injection is defused, numbers carry no digit grouping (reports/csv.ts).
import { paiseToDecimal, toCsv } from '../reports/csv';
import type { CsvCell } from '../reports/csv';
import { istDateOfInstant } from './filters';
import type { InboxLead } from './lead';
import { TYPE_LABELS } from './lead';
import { STATUS_LABELS } from './status';

export const EXPORT_MAX_ROWS = 5000;

export interface AdminSession {
  role: string | null | undefined;
  /** Supabase authenticator assurance level of the session. */
  aal: string | null | undefined;
}

/** Owner with MFA only. The editor role (when it is ever enabled) and `aal1` sessions are refused. */
export function canExportLeads(session: AdminSession | null | undefined): boolean {
  return !!session && session.role === 'owner' && session.aal === 'aal2';
}

export interface AuditEntry {
  action: 'export_leads';
  rowCount: number;
  /** A short description of the filter in force (set by the caller; never lead data). */
  filter: string;
}

export type ExportResult =
  | { ok: true; fileName: string; csv: string; audit: AuditEntry }
  | { ok: false; error: 'forbidden' | 'too_many_rows'; message: string };

export const EXPORT_HEADER = ['Reference', 'Created (IST)', 'Type', 'Status', 'Name', 'Organisation', 'Phone', 'Email', 'WhatsApp OK', 'Value (INR)', 'Source page', 'Follow-up on', 'Lost reason', 'Notes'] as const;

/** `919876543210` as `91 98765 43210` so a spreadsheet keeps it as text (a bare 12-digit number turns into 9.19877E+11). Other lengths stay as digits. */
export function phoneForSheet(phone: string | null): string {
  if (!phone) return '';
  const m = /^91([6-9]\d{4})(\d{5})$/.exec(phone);
  return m ? `91 ${m[1]} ${m[2]}` : phone;
}

/** `2026-10-22 14:05` in India time from an ISO instant. */
export function istDateTime(iso: string): string {
  const date = istDateOfInstant(iso);
  const t = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 16);
  return `${date} ${t}`;
}

export function leadRow(l: InboxLead): CsvCell[] {
  return [
    l.refCode,
    istDateTime(l.createdAt),
    TYPE_LABELS[l.type],
    STATUS_LABELS[l.status],
    l.name,
    l.organization ?? '',
    phoneForSheet(l.phone),
    l.email ?? '',
    l.whatsappOk ? 'Yes' : 'No',
    l.valuePaise === null ? '' : paiseToDecimal(l.valuePaise),
    l.sourcePath ?? '',
    l.followUpOn ?? '',
    l.lostReason ?? '',
    l.notes ?? '',
  ];
}

export function exportLeadsCsv(session: AdminSession | null | undefined, leads: readonly InboxLead[], today: string, filterDescription = 'all'): ExportResult {
  if (!canExportLeads(session)) return { ok: false, error: 'forbidden', message: 'Only the owner, signed in with the second step, can export enquiries.' };
  if (leads.length > EXPORT_MAX_ROWS) return { ok: false, error: 'too_many_rows', message: `That is more than ${EXPORT_MAX_ROWS} enquiries. Narrow the filter and export again.` };
  const csv = toCsv([[...EXPORT_HEADER], ...leads.map(leadRow)]);
  return {
    ok: true,
    fileName: `power-smash-enquiries-${today}.csv`,
    csv,
    audit: { action: 'export_leads', rowCount: leads.length, filter: filterDescription.slice(0, 200) },
  };
}
