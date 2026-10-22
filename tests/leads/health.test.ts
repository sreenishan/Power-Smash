import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleHealth } from '../../src/lib/leads/health';
import { fakeConfig } from './helpers';

const get = (method = 'GET') => new Request('https://powersmash.example.test/api/health', { method });

afterEach(() => vi.restoreAllMocks());

describe('GET /api/health (D-039)', () => {
  it('returns 200 JSON, no cache, noindex', async () => {
    const res = handleHealth(get(), fakeConfig());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(await res.json()).toEqual({ ok: true, service: 'power-smash', lead: 'ready', ready: true });
  });

  it('answers 200 even when the lead endpoint is unconfigured, and says so in one word', async () => {
    const res = handleHealth(get(), fakeConfig({ SUPABASE_SECRET_KEY: undefined }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'power-smash', lead: 'unconfigured', ready: false, reason: 'missing_secrets' });
    expect(await handleHealth(get(), null).json()).toMatchObject({ lead: 'unconfigured', ready: false, reason: 'missing_secrets' });
  });

  it('S-1: a Cloudflare TEST Turnstile secret without TURNSTILE_ALLOW_TEST_KEYS=true is reported as not ready, with a reason', async () => {
    const testSecret = '1x0000000000000000000000000000000AA';
    const res = handleHealth(get(), fakeConfig({ TURNSTILE_SECRET_KEY: testSecret }));
    expect(res.status).toBe(200); // the monitor sees the word, the Worker itself is up
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, service: 'power-smash', lead: 'unconfigured', ready: false, reason: 'turnstile_test_key' });
    expect(JSON.stringify(body)).not.toContain(testSecret);
    // deliberately allowed (dev and preview): ready, and the response says test mode is on so production can be watched for it
    const allowed = (await handleHealth(get(), fakeConfig({ TURNSTILE_SECRET_KEY: testSecret, TURNSTILE_ALLOW_TEST_KEYS: 'true' })).json()) as Record<string, unknown>;
    expect(allowed).toEqual({ ok: true, service: 'power-smash', lead: 'ready', ready: true, testMode: true });
    // a real secret: no testMode word
    expect(await handleHealth(get(), fakeConfig()).text()).not.toContain('testMode');
  });

  it('S-17: a Supabase URL that is not https and *.supabase.co is reported as not ready (reason supabase_url)', async () => {
    for (const url of ['http://fakeref.supabase.co', 'https://evil.example', 'https://fakeref.supabase.co.evil.example']) {
      const body = (await handleHealth(get(), fakeConfig({ SUPABASE_URL: url })).json()) as Record<string, unknown>;
      expect(body, url).toMatchObject({ lead: 'unconfigured', ready: false, reason: 'supabase_url' });
      expect(JSON.stringify(body)).not.toContain('evil');
    }
  });

  it('answers HEAD with no body (some monitors use HEAD) and refuses other methods', async () => {
    const head = handleHealth(get('HEAD'), fakeConfig());
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(handleHealth(get('POST'), fakeConfig()).status).toBe(405);
  });

  it('exposes no secret, no version and no detail', async () => {
    const text = await handleHealth(get(), fakeConfig()).text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['lead', 'ok', 'ready', 'service']);
    expect(text).not.toMatch(/sb_|secret|token|key|version|supabase/i);
  });

  it('makes NO outbound call and NO database write (a fetch spy is never called)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('health must not call fetch')));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      handleHealth(get(), fakeConfig());
      handleHealth(get('HEAD'), fakeConfig());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the health sources contain no database or network access at all', () => {
    for (const file of ['src/lib/leads/health.ts', 'src/pages/api/health.ts']) {
      const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, file).not.toMatch(/fetch\s*\(|supabase|createSupabaseRest|\.insert\(|\.update\(|\.remove\(|XMLHttpRequest|WebSocket/i);
    }
    const route = readFileSync('src/pages/api/health.ts', 'utf8');
    expect(route).toContain('export const prerender = false');
    expect(route).toContain('export const GET');
    expect(route).not.toContain('export const POST');
  });
});
