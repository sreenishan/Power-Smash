import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseProvider } from '../../src/lib/archive/supabase-provider';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0006_archive_api.sql'), 'utf8').replace(/\r\n/g, '\n');

/** Output column names of `create view api.<name> ... as select ... from`. */
function viewColumns(name: string): string[] {
  const start = sql.indexOf(`create view api.${name} `);
  expect(start, name).toBeGreaterThan(-1);
  const rest = sql.slice(start).split(/;\s*\n/)[0] ?? '';
  const multi = rest.split('\nselect\n')[1];
  const block =
    multi !== undefined
      ? (multi.split(/\nfrom /)[0] ?? '')
      : (/\nselect ([^\n]+)\nfrom /.exec(rest)?.[1] ?? '').split(',').join('\n');
  const cols: string[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim().replace(/,$/, '');
    if (line === '') continue;
    const alias = /\bas\s+([a-z_0-9]+)$/.exec(line);
    const plain = /(?:^|\.)([a-z_0-9]+)$/.exec(line);
    const col = alias?.[1] ?? plain?.[1];
    if (col) cols.push(col);
  }
  return cols;
}

describe('supabase-provider selects only columns the api views really have (migration 0006)', () => {
  it('parses the view columns sanely', () => {
    expect(viewColumns('public_videos')).toContain('youtube_id');
    expect(viewColumns('public_videos')).toContain('page_mode');
    expect(viewColumns('public_tournaments')).toContain('page_eligible');
  });

  it('every selected and ordered column exists in its view', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response('[]', { status: 200 });
    });
    await createSupabaseProvider({ url: 'https://abcdefgh.supabase.co', publishableKey: 'pk_FAKE', fetch: f as unknown as typeof fetch }).load();
    expect(urls.length).toBe(6);
    for (const u of urls) {
      const parsed = new URL(u);
      const view = parsed.pathname.split('/').pop() as string;
      const cols = new Set(viewColumns(view));
      const select = (parsed.searchParams.get('select') ?? '').split(',');
      expect(select.length, view).toBeGreaterThan(0);
      for (const c of select) expect(cols.has(c), `${view}.${c}`).toBe(true);
      const order = (parsed.searchParams.get('order') ?? '').split(',').map((o) => o.split('.')[0] as string);
      for (const c of order) expect(cols.has(c), `${view} order ${c}`).toBe(true);
      expect(parsed.searchParams.get('limit')).toBe('1000');
    }
  });

  it('reads the api schema with the publishable key in the apikey header only', async () => {
    const seen: RequestInit[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(init);
      return new Response('[]', { status: 200 });
    });
    await createSupabaseProvider({ url: 'https://abcdefgh.supabase.co', publishableKey: 'pk_FAKE', fetch: f as unknown as typeof fetch }).load();
    for (const init of seen) {
      const h = init.headers as Record<string, string>;
      expect(h['accept-profile']).toBe('api');
      expect(h.apikey).toBe('pk_FAKE');
      expect(h.authorization).toBeUndefined();
    }
  });
});
