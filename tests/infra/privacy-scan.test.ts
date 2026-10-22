import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPrivacyReport, loadOfficialContacts, scanPrivacy, secretValuesFrom } from '../../scripts/privacy-scan.ts';
import { canonicalPhone, mask } from '../../scripts/lib/privacy-rules.ts';
import {
  cleanupTemp,
  fakeAgePrivateKey,
  fakeGoogleKey,
  fakeJwt,
  fakeSupabaseSecret,
  fakeTelegramToken,
  FIXTURES,
  makeDist,
  page,
  runScript,
} from './helpers';
import { join } from 'node:path';

afterEach(cleanupTemp);
// Some tests start Node child processes (the way npm runs the scripts): allow for a busy PC.
vi.setConfig({ testTimeout: 30_000 });

const none = loadOfficialContacts({}, null);
const rules = (root: string, official = none, secrets: Record<string, string> = {}) => scanPrivacy(root, official, secrets).findings.map((f) => f.rule);

describe('privacy scan: what it finds', () => {
  it('finds an email address', () => {
    expect(rules(makeDist({ 'index.html': page('<p>write to someone@example.com today</p>') }))).toEqual(['email-address']);
  });

  it('finds an Indian mobile number in several formats', () => {
    const body = '<p>98765 43210</p><p>+91 98765 43210</p><p>919876543210</p><p>098765-43210</p><p>9876543210</p>';
    const found = rules(makeDist({ 'index.html': page(body) }));
    expect(found.filter((r) => r === 'indian-mobile-number').length).toBeGreaterThanOrEqual(5);
  });

  it('finds a JWT-shaped string and a Supabase secret-key-shaped string (built at run time)', () => {
    const root = makeDist({ 'index.html': page(`<p>${fakeJwt()}</p>`), '_astro/a.js': `const k="${fakeSupabaseSecret()}";` });
    const report = scanPrivacy(root, none);
    expect(report.findings.map((f) => `${f.file}:${f.rule}`).sort()).toEqual(['_astro/a.js:supabase-secret-key', 'index.html:jwt']);
    expect(report.findings.every((f) => f.severity === 'critical')).toBe(true);
  });

  it('finds the other secret shapes: Telegram token, Google key, age private key, database URL, private key block', () => {
    const root = makeDist({
      'a.html': page(`<p>${fakeTelegramToken()}</p><p>${fakeGoogleKey()}</p><p>${fakeAgePrivateKey()}</p>`),
      'b.txt': `${['postgresql', '://', 'user', ':', 'pa55word', '@', 'db.example.com', ':5432/postgres'].join('')}\n${'-----BEGIN ' + 'PRIVATE KEY-----'}`,
    });
    // the password@host part of the database URL also looks like an address, so it is reported twice
    expect(rules(root).sort()).toEqual(['age-secret-key', 'database-url-with-password', 'email-address', 'google-api-key', 'private-key-block', 'telegram-bot-token']);
  });

  it('finds private field names and secret variable names', () => {
    const root = makeDist({ 'x.json': JSON.stringify({ tournament_private: 1, contact_phone: 2 }), '_astro/b.js': 'const n="SUPABASE_SECRET_KEY";' });
    expect(rules(root)).toEqual(['private-field-name', 'private-field-name', 'private-field-name']);
  });

  it('finds localhost and loopback URLs', () => {
    const root = makeDist({ 'index.html': page('<a href="http://localhost:4321/x">a</a><a href="https://127.0.0.1/y">b</a><a href="http://[::1]:3000">c</a>') });
    expect(rules(root)).toEqual(['localhost-url', 'localhost-url', 'localhost-url']);
  });

  it('finds an email, a formatted phone and a bare 10-digit literal inside a script, but not a timestamp or a long number (S-2)', () => {
    const root = makeDist({ '_astro/app.js': 'x="a@b.example";y="+91 98765 43210";z=9876543210;t=1760000000000;u=1760000000;m=9007199254740991;' });
    expect(rules(root).sort()).toEqual(['email-address', 'indian-mobile-number-code', 'indian-mobile-number-formatted']);
  });

  it('does not mistake image names or version strings for emails', () => {
    const root = makeDist({ 'index.html': page('<img srcset="logo@2x.png 2x"><p>react@19.3.0 and core-js@3.2.1</p>') });
    expect(rules(root)).toEqual([]);
  });

  it('finds the exact VALUE of a private variable and never prints it', () => {
    const value = `${'s3cr3t'}-${'value'}-${'12345678'}`;
    const root = makeDist({ 'index.html': page(`<p>${value}</p>`) });
    const report = scanPrivacy(root, none, { RESEND_API_KEY: value });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ rule: 'known-secret-value:RESEND_API_KEY', severity: 'critical' });
    const output = formatPrivacyReport(report, true, '.vercel/output/static').lines.join('\n');
    expect(output).not.toContain(value);
    expect(output).toContain('RESEND_API_KEY');
  });

  it('a clean fixture build is clean', () => {
    expect(scanPrivacy(join(FIXTURES, 'site-clean'), none).findings).toEqual([]);
  });
});

describe('privacy scan: official contact details are the only allowed values', () => {
  const official = loadOfficialContacts(
    { PUBLIC_WHATSAPP_NUMBER: '919876500001' },
    "export const site = {\n  phone: '+91 98765 00002',\n  publicEmail: 'hello@fixture.example',\n  grievanceEmail: null as string | null,\n  whatsappNumber: env.whatsappNumber,\n};",
  );

  it('reads the official values from the environment and from string literals in site config', () => {
    expect(official.emails).toEqual(new Set(['hello@fixture.example']));
    expect(official.phones).toEqual(new Set(['9876500001', '9876500002']));
  });

  it('allows the official number in any common format and the official email in any case', () => {
    const body = '<a href="https://wa.me/919876500001">wa</a><p>+91 98765 00001</p><p>098765 00002</p><p>Hello@Fixture.example</p>';
    const report = scanPrivacy(makeDist({ 'index.html': page(body) }), official);
    expect(report.findings).toEqual([]);
    expect(report.allowedOfficial['indian-mobile-number']).toBeGreaterThanOrEqual(3);
    expect(report.allowedOfficial['email-address']).toBe(1);
  });

  it('still reports any other number or address on the same page', () => {
    const body = '<p>+91 98765 00001</p><p>other@fixture.example</p><p>98765 43210</p>';
    const found = rules(makeDist({ 'index.html': page(body) }), official);
    expect(found.sort()).toEqual(['email-address', 'indian-mobile-number']);
  });

  it('null values in site config allow nothing', () => {
    const c = loadOfficialContacts({}, "phone: null as string | null,\n  publicEmail: null as string | null,");
    expect(c.phones.size + c.emails.size).toBe(0);
  });

  it('canonicalPhone treats +91, 91, 0 and plain forms alike', () => {
    expect(new Set(['+91 98765 43210', '919876543210', '098765-43210', '9876543210', '0091 9876543210'].map(canonicalPhone))).toEqual(new Set(['9876543210']));
  });
});

describe('privacy scan: output and exit code', () => {
  const root = () => makeDist({ 'index.html': page('<p>someone@example.com</p><p>http://localhost:4321</p>') });

  it('personal data fails the strict build and is a summary in a normal build', () => {
    const report = scanPrivacy(root(), none);
    expect(formatPrivacyReport(report, true, 'x').exitCode).toBe(1);
    const normal = formatPrivacyReport(report, false, 'x');
    expect(normal.exitCode).toBe(0);
    expect(normal.lines.join('\n')).toContain('informational');
  });

  it('a secret-shaped value fails EVERY build, strict or not', () => {
    const report = scanPrivacy(makeDist({ 'index.html': page(fakeSupabaseSecret()) }), none);
    expect(formatPrivacyReport(report, false, 'x').exitCode).toBe(1);
    expect(formatPrivacyReport(report, true, 'x').exitCode).toBe(1);
  });

  it('never prints a full matched value (masked sample only)', () => {
    const secret = fakeSupabaseSecret();
    const email = 'someone@example.com';
    const report = scanPrivacy(makeDist({ 'index.html': page(`${secret} ${email} 98765 43210`) }), none);
    const text = formatPrivacyReport(report, true, 'x').lines.join('\n');
    expect(text).not.toContain(secret);
    expect(text).not.toContain(email);
    expect(text).not.toContain('98765 43210');
    expect(text).toMatch(/index\.html:1:\d+/);
    expect(mask(secret)).not.toContain(secret.slice(8));
  });

  it('secretValuesFrom picks only long enough values of the private variable names', () => {
    expect(secretValuesFrom({ RESEND_API_KEY: 'x'.repeat(10), HMAC_KEY: 'short', PUBLIC_SITE_URL: 'https://a.example', TURNSTILE_SECRET_KEY: '  ' })).toEqual({ RESEND_API_KEY: 'x'.repeat(10) });
  });

  it('strict mode fails an empty build', () => {
    const report = scanPrivacy(makeDist({ 'a.png': Buffer.from([0, 1]) }), none);
    expect(formatPrivacyReport(report, true, 'x').exitCode).toBe(1);
  });
});

describe('privacy scan: command line', () => {
  const script = 'scripts/privacy-scan.ts';
  it('strict fails on an email, normal passes, a secret fails both; the output never contains the value', () => {
    const withEmail = makeDist({ 'index.html': page('<p>someone@example.com</p>') });
    const strict = runScript(script, ['--dist', withEmail, '--strict']);
    expect(strict.status).toBe(1);
    expect(strict.stdout).not.toContain('someone@example.com');
    expect(runScript(script, ['--dist', withEmail]).status).toBe(0);

    const secret = fakeSupabaseSecret();
    const withSecret = makeDist({ 'index.html': page(secret) });
    const normal = runScript(script, ['--dist', withSecret]);
    expect(normal.status).toBe(1);
    expect(normal.stdout + normal.stderr).not.toContain(secret);
  });

  it('a private variable value present in the environment fails the build when found in the output, without printing it', () => {
    const value = `${'abc'}${'DEF'}-${'ghi'}${'JKL'}-0123456789`;
    const root = makeDist({ 'index.html': page(`<p>${value}</p>`) });
    const r = runScript(script, ['--dist', root], { TELEGRAM_CHAT_ID: '123456789012345', OWNER_EMAIL: value });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain(value);
    expect(r.stdout).toContain('known-secret-value:OWNER_EMAIL');
  });

  it('the official WhatsApp number from the environment is allowed (public by design)', () => {
    const root = makeDist({ 'index.html': page('<a href="https://wa.me/919876500001">chat</a>') });
    expect(runScript(script, ['--dist', root, '--strict'], { PUBLIC_WHATSAPP_NUMBER: '919876500001' }).status).toBe(0);
    expect(runScript(script, ['--dist', root, '--strict'], {}).status).toBe(1);
  });
});
