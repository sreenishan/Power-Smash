// The products table's PUBLIC view (migration 0011_products.sql, D-099): its name and its explicit columns, kept in step with the SQL by
// tests/supabase/products-view.test.ts (the archive views are declared the same way in src/lib/archive/types.ts). The build will read prices
// through this view with the publishable key once the owner switches the database source on; until then pages read src/content/products.ts.
import type { PriceType } from '../money';

export const PRODUCT_VIEW = 'public_products' as const;

/** api.public_products: VISIBLE products only. Inclusions are not in the view: they stay in the content file for now (D-099). */
export interface PublicProduct {
  slug: string;
  name: string;
  summary: string;
  price_type: PriceType;
  /** Integer paise the owner typed, or null (never a default, D-020, D-021). */
  price_paise: number | null;
  gst_inclusive: boolean | null;
  delivery_days: number | null;
  sort: number;
}

export const PRODUCT_VIEW_COLUMNS = ['slug', 'name', 'summary', 'price_type', 'price_paise', 'gst_inclusive', 'delivery_days', 'sort'] as const satisfies readonly (keyof PublicProduct)[];
