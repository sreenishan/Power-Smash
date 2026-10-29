-- 0011_products.sql: the owner's products and prices (admin "Products and pricing", spec 14, D-020, D-021, D-099).
--
-- Until now the admin Prices screen called public.admin_save_product, which did not exist, so every save failed closed. This adds:
--   public.products            one row per product the owner has edited (slug = the slug in src/content/products.ts). NO seed rows.
--   api.public_products        the VISIBLE products only, explicit columns, for the build (publishable key).
--   public.admin_save_product  the one write path: owner only (app.require_owner), every field checked, audited, marks the site dirty.
--
-- Money rules (D-020, D-021): a price is integer paise the OWNER typed. price_paise, gst_inclusive and delivery_days have NO default
-- (supabase/checks/0011_assertions.sql asserts it). A visible fixed or starting_from product needs a price; a visible quote product without
-- a price needs the owner's approval of the "On quote" wording (the same rule as src/lib/pricing-admin/product-edit.ts validateProductEdit).
-- House rules (0001-0010): RLS on with NO policies, everything revoked, then explicit grants; writes only through the SECURITY DEFINER RPC.

create table public.products (
  slug                    text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name                    text not null check (length(btrim(name)) between 2 and 120),
  summary                 text not null check (length(summary) <= 300),
  price_type              text not null check (price_type in ('fixed', 'starting_from', 'quote')),
  price_paise             bigint check (price_paise is null or (price_paise > 0 and price_paise <= 10000000000)),
  gst_inclusive           boolean,
  delivery_days           integer check (delivery_days is null or delivery_days between 1 and 365),
  visible                 boolean not null default false,
  sort                    integer not null default 0 check (sort between 0 and 9999),
  inclusions              text[] not null default '{}' check (cardinality(inclusions) <= 20),
  inclusions_approved     boolean not null default false,
  quote_wording_approved  boolean not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              text not null,
  constraint products_visible_needs_price check (
    not visible
    or (price_type in ('fixed', 'starting_from') and price_paise is not null)
    or (price_type = 'quote' and (price_paise is not null or quote_wording_approved))
  )
);
comment on table public.products is 'Owner-edited products and prices (D-099). Integer paise; no default price, GST or delivery value (D-020, D-021).';

alter table public.products enable row level security;
-- Deliberately NO policies: only the service role reads it, and writes go through admin_save_product.
revoke all on table public.products from public, anon, authenticated, service_role;
grant select on public.products to service_role;

-- The build reads visible products only, with explicit columns (no select *; inclusions stay in the content file for now, D-099).
create view api.public_products with (security_barrier = true) as
  select p.slug, p.name, p.summary, p.price_type, p.price_paise, p.gst_inclusive, p.delivery_days, p.sort
  from public.products p
  where p.visible;
grant select on api.public_products to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_save_product: the owner saves one product (upsert by slug)
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_product(p_actor text, p_slug text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['name', 'summary', 'priceType', 'pricePaise', 'gstInclusive', 'deliveryDays', 'visible', 'sort',
    'inclusions', 'inclusionsApproved', 'quoteWordingApproved'];
  v_key text;
  v_old public.products;
  v_old_rec jsonb;
  v_fields jsonb;
  v_price bigint;
  v_delivery integer;
  v_row public.products;
begin
  perform app.require_owner(p_actor);
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) > 80 then
    raise exception 'INVALID: the product slug is not valid' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'INVALID: a product change needs a reason' using errcode = '22023'; end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object' then raise exception 'INVALID: the product must be an object' using errcode = '22023'; end if;
  -- every key known, every key present (the admin sends the whole record)
  for v_key in select jsonb_object_keys(p_record) loop
    if not v_key = any (v_allowed) then raise exception 'INVALID: unknown product field %', v_key using errcode = '22023'; end if;
  end loop;
  foreach v_key in array v_allowed loop
    if not p_record ? v_key then raise exception 'INVALID: the product field % is missing', v_key using errcode = '22023'; end if;
  end loop;
  -- types: never coerced, never defaulted
  if jsonb_typeof(p_record->'name') <> 'string' or jsonb_typeof(p_record->'summary') <> 'string' or jsonb_typeof(p_record->'priceType') <> 'string'
     or jsonb_typeof(p_record->'visible') <> 'boolean' or jsonb_typeof(p_record->'sort') <> 'number' or jsonb_typeof(p_record->'inclusions') <> 'array'
     or jsonb_typeof(p_record->'inclusionsApproved') <> 'boolean' or jsonb_typeof(p_record->'quoteWordingApproved') <> 'boolean'
     or jsonb_typeof(p_record->'gstInclusive') not in ('boolean', 'null') then
    raise exception 'INVALID: a product field has the wrong type' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record->'pricePaise') = 'null' then
    v_price := null;
  elsif jsonb_typeof(p_record->'pricePaise') = 'number' and (p_record->>'pricePaise')::numeric = trunc((p_record->>'pricePaise')::numeric)
        and (p_record->>'pricePaise')::numeric > 0 and (p_record->>'pricePaise')::numeric <= 10000000000 then
    v_price := (p_record->>'pricePaise')::bigint;
  else
    raise exception 'INVALID: the price must be a whole number of paise above zero, or empty' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record->'deliveryDays') = 'null' then
    v_delivery := null;
  elsif jsonb_typeof(p_record->'deliveryDays') = 'number' and (p_record->>'deliveryDays')::numeric = trunc((p_record->>'deliveryDays')::numeric) then
    v_delivery := (p_record->>'deliveryDays')::integer;
  else
    raise exception 'INVALID: delivery days must be a whole number, or empty' using errcode = '22023';
  end if;
  if (p_record->>'sort')::numeric <> trunc((p_record->>'sort')::numeric) then raise exception 'INVALID: the order must be a whole number' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_record->'inclusions') e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 200) then
    raise exception 'INVALID: each inclusion is text of up to 200 characters' using errcode = '22023';
  end if;

  select * into v_old from public.products where slug = p_slug for update;
  v_old_rec := case when v_old.slug is null then '{}'::jsonb else jsonb_build_object(
    'name', v_old.name, 'summary', v_old.summary, 'priceType', v_old.price_type, 'pricePaise', v_old.price_paise,
    'gstInclusive', v_old.gst_inclusive, 'deliveryDays', v_old.delivery_days, 'visible', v_old.visible, 'sort', v_old.sort,
    'inclusions', to_jsonb(v_old.inclusions), 'inclusionsApproved', v_old.inclusions_approved, 'quoteWordingApproved', v_old.quote_wording_approved) end;
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_fields
    from unnest(v_allowed) k where (v_old_rec -> k) is distinct from (p_record -> k);

  -- the table checks (price range, visible needs a price, lengths) refuse anything else with a constraint error
  insert into public.products as t (slug, name, summary, price_type, price_paise, gst_inclusive, delivery_days, visible, sort, inclusions,
      inclusions_approved, quote_wording_approved, updated_at, updated_by)
    values (p_slug, btrim(p_record->>'name'), p_record->>'summary', p_record->>'priceType', v_price, (p_record->>'gstInclusive')::boolean, v_delivery,
      (p_record->>'visible')::boolean, (p_record->>'sort')::integer, array(select jsonb_array_elements_text(p_record->'inclusions')),
      (p_record->>'inclusionsApproved')::boolean, (p_record->>'quoteWordingApproved')::boolean, now(), p_actor)
    on conflict (slug) do update set name = excluded.name, summary = excluded.summary, price_type = excluded.price_type,
      price_paise = excluded.price_paise, gst_inclusive = excluded.gst_inclusive, delivery_days = excluded.delivery_days,
      visible = excluded.visible, sort = excluded.sort, inclusions = excluded.inclusions, inclusions_approved = excluded.inclusions_approved,
      quote_wording_approved = excluded.quote_wording_approved, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    returning * into v_row;

  -- the audit holds prices, visibility and the NAMES of changed fields only (no free text from the record)
  perform app.audit(p_actor, 'save_product', 'products', p_slug,
    jsonb_build_object('old_paise', v_old.price_paise, 'new_paise', v_row.price_paise, 'old_visible', v_old.visible, 'new_visible', v_row.visible,
      'fields', v_fields), p_reason);
  perform app.mark_dirty('price change', false);
  return jsonb_build_object('slug', v_row.slug, 'pricePaise', v_row.price_paise, 'visible', v_row.visible, 'fields', v_fields);
end;
$$;

revoke all on function public.admin_save_product(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_save_product(text, text, jsonb, text) to service_role;
