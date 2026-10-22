import { describe, expect, it } from 'vitest';
import { createSupabaseRest, SupabaseError } from '../../src/lib/supabase/rest';

const URL_OK = 'https://abcdefgh.supabase.co';
const KEY = ['sb', 'secret', 'FAKE'].join('_');

function mock(res: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return res;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('SupabaseRest.rpc', () => {
  it('POSTs JSON to /rest/v1/rpc/<fn> with the key in apikey only', async () => {
    const { f, calls } = mock(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const out = await createSupabaseRest({ url: URL_OK, secretKey: KEY, fetch: f }).rpc('bump_stat', { a: 1 });
    expect(out).toEqual({ ok: 1 });
    expect(calls[0]?.url).toBe(`${URL_OK}/rest/v1/rpc/bump_stat`);
    const h = calls[0]?.init.headers as Record<string, string>;
    expect(h.apikey).toBe(KEY);
    expect(h.authorization).toBeUndefined();
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"a":1}');
  });
  it('empty body gives null; a non-JSON body gives null', async () => {
    expect(await createSupabaseRest({ url: URL_OK, secretKey: KEY, fetch: mock(new Response('', { status: 200 })).f }).rpc('x')).toBeNull();
    expect(await createSupabaseRest({ url: URL_OK, secretKey: KEY, fetch: mock(new Response('nope', { status: 200 })).f }).rpc('x')).toBeNull();
  });
  it('errors carry only status and code, never the body', async () => {
    const { f } = mock(new Response(JSON.stringify({ code: 'P0001', message: 'secret detail 910000000000' }), { status: 400 }));
    const err = await createSupabaseRest({ url: URL_OK, secretKey: KEY, fetch: f }).rpc('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupabaseError);
    expect(String((err as Error).message)).not.toContain('9100');
  });
  it('refuses odd function names and keeps the https/*.supabase.co guard', async () => {
    const { f, calls } = mock(new Response('[]'));
    const rest = createSupabaseRest({ url: URL_OK, secretKey: KEY, fetch: f });
    await expect(rest.rpc('a/b')).rejects.toThrow();
    await expect(rest.rpc('x', {}, { schema: 'a;b' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(() => createSupabaseRest({ url: 'http://abcdefgh.supabase.co', secretKey: KEY, fetch: f })).toThrow();
  });
});
