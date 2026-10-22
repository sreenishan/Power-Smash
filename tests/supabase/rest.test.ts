import { describe, expect, it } from 'vitest';
import { createSupabaseRest, SupabaseError } from '../../src/lib/supabase/rest';
import { FAKE } from '../leads/helpers';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function mock(handler: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const f = (async (input: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const s: Seen = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined };
    seen.push(s);
    return handler(s);
  }) as unknown as typeof fetch;
  return { seen, f };
}

const client = (f: typeof fetch) => createSupabaseRest({ url: `${FAKE.supabaseUrl}/`, secretKey: FAKE.supabaseSecret, fetch: f });

describe('Supabase REST client', () => {
  it('sends the secret key on the apikey header only, never on Authorization (non-JWT keys, VF-B9)', async () => {
    const { seen, f } = mock((x) => (x.method === 'GET' ? new Response('[]', { status: 200 }) : new Response(null, { status: 201, headers: { 'content-range': '*/0' } })));
    const db = client(f);
    await db.insert('leads', { a: 1 });
    await db.update('leads', 'id=eq.1', { b: 2 });
    await db.remove('rate_limit_hits', 'hit_at=lt.2026-01-01T00:00:00.000Z');
    await db.select('leads', 'id=eq.1');
    await db.count('leads', 'id=eq.1');
    expect(seen).toHaveLength(5);
    for (const s of seen) {
      expect(s.headers.apikey).toBe(FAKE.supabaseSecret);
      expect(s.headers.authorization).toBeUndefined();
      expect(s.url.startsWith(`${FAKE.supabaseUrl}/rest/v1/`)).toBe(true);
      expect(s.url).not.toContain(FAKE.supabaseSecret);
    }
  });

  it('inserts with return=minimal (the secret role needs INSERT only, nothing comes back)', async () => {
    const { seen, f } = mock(() => new Response(null, { status: 201 }));
    await client(f).insert('leads', { a: 1 });
    expect(seen[0]?.headers.prefer).toBe('return=minimal');
    expect(seen[0]?.method).toBe('POST');
    expect(JSON.parse(seen[0]?.body as string)).toEqual({ a: 1 });
  });

  it('supports ignore-duplicates upserts for idempotent writes', async () => {
    const { seen, f } = mock(() => new Response(null, { status: 201 }));
    await client(f).insert('daily_salts', { day: '2026-11-02' }, { onConflict: 'day', ignoreDuplicates: true });
    expect(seen[0]?.url).toContain('/rest/v1/daily_salts?on_conflict=day');
    expect(seen[0]?.headers.prefer).toBe('return=minimal,resolution=ignore-duplicates');
  });

  it('turns an error into a SupabaseError with status, Postgres code and constraint name only', async () => {
    const { f } = mock(() => new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "leads_ref_code_uq"', details: 'Key (phone)=(919876543210) already exists.', hint: null }), { status: 409 }));
    const err = await client(f).insert('leads', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupabaseError);
    const e = err as SupabaseError;
    expect(e.status).toBe(409);
    expect(e.pgCode).toBe('23505');
    expect(e.constraint).toBe('leads_ref_code_uq');
    expect(e.isUniqueViolation).toBe(true);
    expect(String(e.message)).not.toContain('919876543210');
    expect(JSON.stringify(e)).not.toContain('919876543210');
    expect(e.stack ?? '').not.toContain('919876543210');
  });

  it('a network failure, a timeout or a non-JSON error becomes a plain status 0 or status-only error', async () => {
    const a = await client((async () => { throw new TypeError('boom'); }) as unknown as typeof fetch).select('leads', 'id=eq.1').catch((e: unknown) => e as SupabaseError);
    expect((a as SupabaseError).status).toBe(0);
    const b = await client((async () => new Response('<html>bad gateway', { status: 502 })) as unknown as typeof fetch).insert('leads', {}).catch((e: unknown) => e as SupabaseError);
    expect((b as SupabaseError).status).toBe(502);
    expect((b as SupabaseError).pgCode).toBeNull();
    expect(String((b as SupabaseError).message)).not.toContain('html');
  });

  it('count reads the total from Content-Range (HEAD + Prefer: count=exact)', async () => {
    const { seen, f } = mock(() => new Response(null, { status: 200, headers: { 'content-range': '0-0/7' } }));
    expect(await client(f).count('rate_limit_hits', 'bucket=eq.x')).toBe(7);
    expect(seen[0]?.method).toBe('HEAD');
    expect(seen[0]?.headers.prefer).toBe('count=exact');
    const empty = mock(() => new Response(null, { status: 200, headers: { 'content-range': '*/0' } }));
    expect(await client(empty.f).count('rate_limit_hits', 'bucket=eq.x')).toBe(0);
  });

  it('select returns the parsed rows', async () => {
    const { f } = mock(() => new Response(JSON.stringify([{ id: 'x' }]), { status: 200 }));
    expect(await client(f).select('leads', 'id=eq.x')).toEqual([{ id: 'x' }]);
  });
});
