// api.public_products (migration 0011, D-099) must not drift from src/lib/products/db.ts, and the migration must keep the money rules:
// no default price, GST flag or delivery time (D-020, D-021), RLS on, everything revoked, the RPC locked down.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCT_VIEW, PRODUCT_VIEW_COLUMNS, type PublicProduct } from '../../src/lib/products/db';

const sql = readFileSync('supabase/migrations/0011_products.sql', 'utf8');

describe('migration 0011 products', () => {
  it('the public view selects exactly the declared columns, visible rows only', () => {
    const view = new RegExp(`create view api\\.${PRODUCT_VIEW} with \\(security_barrier = true\\) as\\s+select (.*?)\\s+from public\\.products p\\s+where p\\.visible;`, 's').exec(sql);
    expect(view, 'the view statement').not.toBeNull();
    expect(view![1]!.split(',').map((c) => c.trim().replace(/^p\./, ''))).toEqual([...PRODUCT_VIEW_COLUMNS]);
    // every key of the row type is a column (compile-time list above, run-time check here)
    const keys: (keyof PublicProduct)[] = ['slug', 'name', 'summary', 'price_type', 'price_paise', 'gst_inclusive', 'delivery_days', 'sort'];
    expect([...PRODUCT_VIEW_COLUMNS].sort()).toEqual(keys.sort());
  });

  it('has no default on the price, the GST flag or the delivery time', () => {
    for (const col of ['price_paise', 'gst_inclusive', 'delivery_days']) {
      const line = sql.split('\n').find((l) => new RegExp(`^\\s+${col}\\s`).test(l));
      expect(line, col).toBeDefined();
      expect(line, col).not.toMatch(/\bdefault\b/i);
    }
  });

  it('turns RLS on, revokes everything, grants the service role select only, and writes only through the locked-down RPC', () => {
    expect(sql).toContain('alter table public.products enable row level security;');
    expect(sql).toContain('revoke all on table public.products from public, anon, authenticated, service_role;');
    expect(sql).toContain('grant select on public.products to service_role;');
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*public\.products/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/create or replace function public\.admin_save_product\(p_actor text, p_slug text, p_record jsonb, p_reason text\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/);
    expect(sql).toMatch(/perform app\.require_owner\(p_actor\);/);
    expect(sql).toContain('revoke all on function public.admin_save_product(text, text, jsonb, text) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.admin_save_product(text, text, jsonb, text) to service_role;');
  });

  it('seeds no product and no price', () => {
    expect(sql).not.toMatch(/insert into public\.products\s+(?!as t)/i);
  });
});
