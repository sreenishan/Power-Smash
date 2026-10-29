-- 0011_assertions.sql - self-check for migration 0011_products.sql (public.products, api.public_products, admin_save_product).
-- Run it after applying 0001..0011. It changes nothing: the behaviour tests run in a sub-transaction that is rolled back, with FICTIONAL
-- rows and fictional prices. It raises an exception naming the first broken rule and ends with one row `ok`.

create function pg_temp.expect_fail(p_sql text, p_label text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'ASSERT FAIL: expected an error but the statement succeeded: %', p_label;
end
$f$;

-- ------------------------------------------------------------------------------------------------------------------
-- A. structure: RLS on, no policies, no rights for anon/authenticated, service_role reads only, no default price, a locked-down RPC
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  p text;
  c text;
begin
  if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'products') then
    raise exception 'ASSERT FAIL: row level security is OFF on public.products';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products') then raise exception 'ASSERT FAIL: a policy exists on public.products'; end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.products', p) or has_table_privilege('authenticated', 'public.products', p) then
      raise exception 'ASSERT FAIL: anon or authenticated holds % on public.products', p;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.products', 'SELECT') then raise exception 'ASSERT FAIL: service_role cannot read public.products'; end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('service_role', 'public.products', p) then raise exception 'ASSERT FAIL: service_role holds % on public.products (writes go through the RPC)', p; end if;
  end loop;
  -- D-020/D-021: no price, GST flag or delivery time is ever defaulted
  foreach c in array array['price_paise', 'gst_inclusive', 'delivery_days'] loop
    if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = c) is not null then
      raise exception 'ASSERT FAIL: public.products.% has a default', c;
    end if;
  end loop;
  if not has_table_privilege('anon', 'api.public_products', 'SELECT') then raise exception 'ASSERT FAIL: anon cannot read api.public_products'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'api' and table_name = 'public_products') <> 8 then
    raise exception 'ASSERT FAIL: api.public_products must have exactly its 8 explicit columns';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.admin_save_product(text,text,jsonb,text)'::regprocedure) then
    raise exception 'ASSERT FAIL: admin_save_product is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.admin_save_product(text,text,jsonb,text)'::regprocedure and proconfig @> array['search_path=""']) then
    raise exception 'ASSERT FAIL: admin_save_product does not pin search_path';
  end if;
  if has_function_privilege('anon', 'public.admin_save_product(text,text,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_save_product(text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: anon or authenticated can run admin_save_product';
  end if;
  if not has_function_privilege('service_role', 'public.admin_save_product(text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'ASSERT FAIL: service_role cannot run admin_save_product';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- B. behaviour (rolled back): owner only, every field checked, the visible-needs-a-price rule, audit and dirty flag, the public view
-- ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '22222222-2222-4222-8222-222222222222';
  v_actor text := '11111111-1111-4111-8111-111111111111';
  hidden_rec jsonb := '{"name":"Fake Package","summary":"A fictional product used only in this check.","priceType":"fixed","pricePaise":null,"gstInclusive":null,"deliveryDays":null,"visible":false,"sort":1,"inclusions":["Fake item"],"inclusionsApproved":false,"quoteWordingApproved":false}';
  j jsonb;
  n integer;
begin
  begin
    insert into public.profiles (id, role, display_name) values (v_owner, 'owner', 'Fake Owner'), (v_editor, 'editor', 'Fake Editor');
    update public.site_state set dirty = false, dirty_since = null where id = 1;

    -- the owner check
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_save_product('fake-admin', 'fake-package', %L::jsonb, 'r')$q$, hidden_rec), 'a non-uuid actor');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_editor, hidden_rec), 'an editor actor');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(null, 'fake-package', %L::jsonb, 'r')$q$, hidden_rec), 'a null actor');
    execute 'reset role';
    if exists (select 1 from public.audit_log where action = 'save_product') then raise exception 'ASSERT FAIL: a refused call wrote an audit row'; end if;

    -- field checks: never coerced, never defaulted
    execute 'set local role service_role';
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec || '{"pricePaise": 2500.5}'), 'a fractional price');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec || '{"pricePaise": -100}'), 'a negative price');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec || '{"pricePaise": "250000"}'), 'a price given as text');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec || '{"pricePaise": 0}'), 'a zero price');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec || '{"discount": 10}'), 'an unknown field');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec - 'pricePaise'), 'a missing field');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'Fake Package', %L::jsonb, 'r')$q$, v_actor, hidden_rec), 'a malformed slug');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, '')$q$, v_actor, hidden_rec), 'no reason');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec || '{"visible": true}'), 'a visible fixed product with no price');
    perform pg_temp.expect_fail(format($q$select public.admin_save_product(%L, 'fake-package', %L::jsonb, 'r')$q$, v_actor, hidden_rec || '{"visible": true, "priceType": "quote"}'), 'a visible quote product without the approved wording');
    execute 'reset role';
    if exists (select 1 from public.products) then raise exception 'ASSERT FAIL: a refused save stored a row'; end if;

    -- a hidden product without a price is fine; then the owner types a fictional price and shows it
    execute 'set local role service_role';
    j := public.admin_save_product(v_actor, 'fake-package', hidden_rec, 'product edit');
    j := public.admin_save_product(v_actor, 'fake-package', hidden_rec || '{"pricePaise": 250000, "visible": true}', 'price change');
    perform public.admin_save_product(v_actor, 'fake-quote', hidden_rec || '{"priceType": "quote", "visible": true, "quoteWordingApproved": true}', 'product edit');
    execute 'reset role';
    if (select price_paise from public.products where slug = 'fake-package') <> 250000 then raise exception 'ASSERT FAIL: the price was not stored as integer paise'; end if;
    if j ->> 'pricePaise' <> '250000' or (j -> 'fields') <> '["pricePaise", "visible"]'::jsonb then raise exception 'ASSERT FAIL: wrong save result: %', j; end if;
    select count(*) into n from public.audit_log where action = 'save_product' and entity_id = 'fake-package';
    if n <> 2 then raise exception 'ASSERT FAIL: expected 2 save_product audit rows for fake-package, got %', n; end if;
    if not exists (select 1 from public.audit_log where action = 'save_product' and entity_id = 'fake-package' and (diff ->> 'old_paise') is null
                   and (diff ->> 'new_paise')::bigint = 250000 and actor = v_actor and diff -> 'fields' = '["pricePaise", "visible"]'::jsonb) then
      raise exception 'ASSERT FAIL: the price change was not audited from null to 250000 with the changed field names';
    end if;
    if exists (select 1 from public.audit_log where action = 'save_product' and diff::text like '%fictional product%') then
      raise exception 'ASSERT FAIL: the audit row holds free text from the record';
    end if;
    if not (select dirty from public.site_state where id = 1) then raise exception 'ASSERT FAIL: a price change did not mark the site dirty'; end if;

    -- the public view: visible rows only, and the table stays closed to anon
    execute 'set local role anon';
    if (select count(*) from api.public_products) <> 2 then raise exception 'ASSERT FAIL: api.public_products should show the 2 visible products'; end if;
    if (select price_paise from api.public_products where slug = 'fake-package') <> 250000 then raise exception 'ASSERT FAIL: api.public_products shows the wrong price'; end if;
    execute 'reset role';
    execute 'set local role service_role';
    perform public.admin_save_product(v_actor, 'fake-package', hidden_rec || '{"pricePaise": 250000}', 'hide again');
    execute 'reset role';
    execute 'set local role anon';
    if exists (select 1 from api.public_products where slug = 'fake-package') then raise exception 'ASSERT FAIL: a hidden product is in api.public_products'; end if;
    perform pg_temp.expect_fail($q$select * from public.products$q$, 'anon reading public.products');
    execute 'reset role';

    raise exception 'ps_rollback';
  exception when others then
    if sqlerrm <> 'ps_rollback' then raise; end if;
  end;
end
$$;

select 'ok: 0011_products assertions passed' as result;
