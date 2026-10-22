import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emailReplyLink, quickActions, replyGreeting, whatsappReply } from '../../src/lib/inbox/actions';
import { EXPORT_HEADER, EXPORT_MAX_ROWS, canExportLeads, exportLeadsCsv, istDateTime, phoneForSheet } from '../../src/lib/inbox/export';
import { lead } from './helpers';

const OWNER = { role: 'owner', aal: 'aal2' };

describe('WhatsApp quick action', () => {
  it('uses waLink to the customer number with a reference-only greeting', () => {
    const l = lead({ phone: '910000000000', refCode: 'PS-2026-7K3QDM', name: 'Fictional Person', organization: 'Fictional Association' });
    const r = whatsappReply(l);
    expect(r.href).toBe(`https://wa.me/910000000000?text=${encodeURIComponent(replyGreeting('PS-2026-7K3QDM'))}`);
    const text = decodeURIComponent(r.href?.split('?text=')[1] ?? '');
    expect(text).toContain('PS-2026-7K3QDM');
    expect(text).not.toContain('Fictional');
    expect(r.customerAgreed).toBe(true);
  });

  it('no usable number gives no link, and a customer who did not agree is shown as such', () => {
    expect(whatsappReply(lead({ phone: null })).href).toBeNull();
    expect(whatsappReply(lead({ phone: '9876543210' })).href).toBeNull(); // 10 digits without 91 would open a dead chat
    expect(whatsappReply(lead({ whatsappOk: false })).customerAgreed).toBe(false);
  });

  it('never writes a wa.me address by hand', () => {
    const src = readFileSync(new URL('../../src/lib/inbox/actions.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/wa\.me/);
  });
});

describe('email quick action', () => {
  it('builds a mailto link with the reference in the subject and no body', () => {
    expect(emailReplyLink(lead({ email: 'Person@Example.Test', refCode: 'PS-2026-7K3QDM' }))).toBe('mailto:person@example.test?subject=Your%20Power%20Smash%20enquiry%20PS-2026-7K3QDM');
  });

  it.each(['a@b.test,c@d.test', 'a@b.test;c@d.test', 'a b@c.test', 'a@b.test\r\nBcc: x@y.test', 'a@b.test?bcc=x@y.test', 'a@b.test&cc=x', 'a@b.test#x', 'not-an-address', '', '<a@b.test>', 'a@b'])('refuses %j', (email) => {
    expect(emailReplyLink(lead({ email }))).toBeNull();
  });

  it('no email, no link', () => {
    expect(emailReplyLink(lead({ email: null }))).toBeNull();
    expect(quickActions(lead({ email: null, phone: null })).whatsapp.href).toBeNull();
  });
});

describe('owner-only export guard', () => {
  it('only the owner with MFA may export', () => {
    expect(canExportLeads(OWNER)).toBe(true);
    for (const s of [{ role: 'owner', aal: 'aal1' }, { role: 'editor', aal: 'aal2' }, { role: null, aal: 'aal2' }, { role: 'owner', aal: undefined }, null, undefined]) {
      expect(canExportLeads(s)).toBe(false);
      const r = exportLeadsCsv(s, [lead()], '2026-10-22');
      expect(r).toMatchObject({ ok: false, error: 'forbidden' });
      expect(JSON.stringify(r)).not.toContain('Fictional');
    }
  });

  it('refuses a very large export and says to narrow the filter', () => {
    const r = exportLeadsCsv(OWNER, Array.from({ length: EXPORT_MAX_ROWS + 1 }, () => lead()), '2026-10-22');
    expect(r).toMatchObject({ ok: false, error: 'too_many_rows' });
  });
});

describe('leads CSV', () => {
  it('has the header, one row per lead, IST dates, rupee values from integer paise, and an audit entry that names no lead', () => {
    const r = exportLeadsCsv(OWNER, [lead({ refCode: 'PS-2026-7K3QDM', valuePaise: 12345600, followUpOn: '2026-10-25', createdAt: '2026-10-20T20:30:00Z', status: 'quoted' })], '2026-10-22', 'status = quoted');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe(EXPORT_HEADER.join(','));
    expect(lines[1]).toContain('PS-2026-7K3QDM,2026-10-21 02:00,Tournament coverage,Quoted,Fictional Person');
    expect(lines[1]).toContain(',123456.00,/book/,2026-10-25,');
    expect(r.fileName).toBe('power-smash-enquiries-2026-10-22.csv');
    expect(r.audit).toEqual({ action: 'export_leads', rowCount: 1, filter: 'status = quoted' });
    expect(JSON.stringify(r.audit)).not.toMatch(/Fictional|PS-2026|0000/);
  });

  it('defuses formula injection in every free-text field', () => {
    const evil = '=HYPERLINK("http://x.example","click")';
    const r = exportLeadsCsv(OWNER, [lead({ name: evil, organization: '@SUM(1)', notes: '+cmd', lostReason: '-1+1', sourcePath: '/book/', email: 'a@b.test' })], '2026-10-22');
    if (!r.ok) throw new Error('expected ok');
    expect(r.csv).toContain(`"'=HYPERLINK(""http://x.example"",""click"")"`);
    expect(r.csv).toContain("'@SUM(1)");
    expect(r.csv).toContain("'+cmd");
    expect(r.csv).toContain("'-1+1");
    const cells = r.csv.split('\r\n')[1] ?? '';
    expect(cells).not.toMatch(/(^|,)[=+@-]/);
  });

  it('writes no digit grouping and keeps the phone as text a spreadsheet will not turn into a number', () => {
    expect(phoneForSheet('919876543210')).toBe('91 98765 43210');
    expect(phoneForSheet('910000000000')).toBe('910000000000'); // not a mobile pattern: left as digits
    expect(phoneForSheet('4412345678')).toBe('4412345678');
    expect(phoneForSheet(null)).toBe('');
    const r = exportLeadsCsv(OWNER, [lead({ phone: '919876543210', valuePaise: 100000000 })], '2026-10-22');
    if (!r.ok) throw new Error('expected ok');
    expect(r.csv).toContain('91 98765 43210');
    expect(r.csv).toContain('1000000.00');
    expect(r.csv).not.toMatch(/\d,\d{2},\d{3}/);
  });

  it('formats India date and time from an instant', () => {
    expect(istDateTime('2026-10-20T20:30:00Z')).toBe('2026-10-21 02:00');
    expect(istDateTime('2026-10-20T18:29:00Z')).toBe('2026-10-20 23:59');
  });

  it('an empty value is an empty cell, never a zero', () => {
    const r = exportLeadsCsv(OWNER, [lead({ valuePaise: null, followUpOn: null })], '2026-10-22');
    if (!r.ok) throw new Error('expected ok');
    expect((r.csv.split('\r\n')[1] ?? '').split(',')).toContain('');
    expect(r.csv).not.toContain('0.00');
  });
});
