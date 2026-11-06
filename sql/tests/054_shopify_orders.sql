-- sql/tests/054_shopify_orders.sql
-- Shopify orders in (sql/059). Always rolls back. Needs sql/001-059.
-- Covers: nothing is created while Shopify is off or in the wrong mode; a good order becomes one open sales order (SKU match,
-- quantities, prices in minor units, customer found by phone, warehouse by code); a replay creates nothing; any problem (unknown SKU,
-- other currency, one SKU at two prices, no lines) holds the whole order for review and creates no sales order; stock and money are
-- untouched; the simulated test order works for owners and admins only; the webhook secret is found by shop domain and only for the
-- server; other companies see nothing; no anonymous use; audit rows.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; w2 uuid; i uuid; i2 uuid; r jsonb; n bigint; ok boolean; v_cur text; moves_before bigint; pays_before bigint; so uuid;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'shp-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'shp-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'shp-x@tests.invalid');
  o := public.bootstrap_organization('Shop Test A', 'shop-test-a', 'shp-o@tests.invalid');
  ob := public.bootstrap_organization('Shop Test B', 'shop-test-b', 'shp-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  select default_currency into v_cur from public.organizations where id = o;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  w2 := public.inv_create_warehouse('SHOP', 'Shop warehouse');
  i := public.inv_create_item('SKU-A', 'Item A', null, 'piece', 50, w);
  i2 := public.inv_create_item('SKU-B', 'Item B', null, 'piece', 50, w);

  -- ---- S1: off and wrong mode
  reset role;
  r := public.sal__ingest_shopify_order(o, '{"id": "1", "line_items": []}');
  if r ->> 'result' <> 'off' then raise exception 'FAIL S1a: ingest while off: %', r; end if;
  select count(*) into moves_before from public.inv_stock_moves where org_id = o;
  select count(*) into pays_before from public.fin_payments where org_id = o;
  set local role authenticated;
  perform public.core_save_provider_fields('shopify', '{"shop_domain": "test-shop.myshopify.com", "webhook_secret": "whsec-s", "warehouse_code": "shop"}');
  perform public.core_save_integration('shopify', true, 'simulated', null);
  reset role;
  r := public.sal__ingest_shopify_order(o, '{"id": "2", "line_items": [{"sku": "SKU-A", "quantity": 1, "price": "10.00"}]}', null, false);
  if r ->> 'result' <> 'mode_mismatch' then raise exception 'FAIL S1b: real order in simulated mode: %', r; end if;

  -- ---- G1: a good order (as the server would send it for a company in simulated mode: simulated = true)
  r := public.sal__ingest_shopify_order(o, jsonb_build_object('id', '1001', 'name', '#1001', 'currency', v_cur,
    'customer', jsonb_build_object('first_name', 'Mona', 'last_name', 'Ali', 'phone', '01111111111', 'email', 'm@x.invalid'),
    'shipping_address', jsonb_build_object('city', 'Giza'),
    'line_items', jsonb_build_array(jsonb_build_object('sku', 'sku-a', 'quantity', 2, 'price', '125.50'), jsonb_build_object('sku', 'SKU-B', 'quantity', 1, 'price', '40.00'))), 'wh-1', true);
  if r ->> 'result' <> 'imported' then raise exception 'FAIL G1a: %', r; end if;
  so := (r ->> 'salesOrderId')::uuid;
  if (select status from public.sal_orders where id = so) <> 'open' then raise exception 'FAIL G1b: order not open'; end if;
  if (select warehouse_id from public.sal_orders where id = so) <> w2 then raise exception 'FAIL G1c: warehouse code not used'; end if;
  if (select sum(round(qty * unit_price_minor)) from public.sal_order_lines where order_id = so) <> 2 * 12550 + 4000 then raise exception 'FAIL G1d: line totals'; end if;
  if (select count(*) from public.sal_customers where org_id = o and phone = '01111111111') <> 1 then raise exception 'FAIL G1e: customer not created once'; end if;
  r := public.sal__ingest_shopify_order(o, jsonb_build_object('id', '1001', 'name', '#1001', 'currency', v_cur, 'line_items', jsonb_build_array(jsonb_build_object('sku', 'SKU-A', 'quantity', 1, 'price', '1'))), null, true);
  if r ->> 'result' <> 'duplicate' then raise exception 'FAIL G1f: replay: %', r; end if;
  if (select count(*) from public.sal_orders where org_id = o) <> 1 then raise exception 'FAIL G1g: a replay created an order'; end if;
  r := public.sal__ingest_shopify_order(o, jsonb_build_object('id', '1002', 'currency', v_cur, 'customer', jsonb_build_object('phone', '01111111111'),
    'line_items', jsonb_build_array(jsonb_build_object('sku', 'SKU-B', 'quantity', 1, 'price', '40.00'))), null, true);
  if (select count(*) from public.sal_customers where org_id = o and phone = '01111111111') <> 1 then raise exception 'FAIL G1h: customer not matched by phone'; end if;

  -- ---- R1: problems hold the whole order
  r := public.sal__ingest_shopify_order(o, jsonb_build_object('id', '2001', 'currency', v_cur, 'line_items', jsonb_build_array(
    jsonb_build_object('sku', 'SKU-A', 'quantity', 1, 'price', '1'), jsonb_build_object('sku', 'NOPE', 'quantity', 1, 'price', '1'))), null, true);
  if r ->> 'result' <> 'review' or r ->> 'reason' not like '%NOPE%' then raise exception 'FAIL R1a: unknown SKU: %', r; end if;
  r := public.sal__ingest_shopify_order(o, jsonb_build_object('id', '2002', 'currency', 'ZZZ', 'line_items', jsonb_build_array(jsonb_build_object('sku', 'SKU-A', 'quantity', 1, 'price', '1'))), null, true);
  if r ->> 'result' <> 'review' then raise exception 'FAIL R1b: other currency: %', r; end if;
  r := public.sal__ingest_shopify_order(o, jsonb_build_object('id', '2003', 'currency', v_cur, 'line_items', jsonb_build_array(
    jsonb_build_object('sku', 'SKU-A', 'quantity', 1, 'price', '1.00'), jsonb_build_object('sku', 'SKU-A', 'quantity', 1, 'price', '2.00'))), null, true);
  if r ->> 'result' <> 'review' then raise exception 'FAIL R1c: two prices: %', r; end if;
  r := public.sal__ingest_shopify_order(o, jsonb_build_object('id', '2004', 'currency', v_cur, 'line_items', '[]'::jsonb), null, true);
  if r ->> 'result' <> 'review' then raise exception 'FAIL R1d: no lines: %', r; end if;
  if (select count(*) from public.sal_orders where org_id = o) <> 2 then raise exception 'FAIL R1e: a held order created a sales order'; end if;
  if (select count(*) from public.sal_shopify_orders where org_id = o and status = 'review') <> 4 then raise exception 'FAIL R1f: review rows'; end if;
  if (select count(*) from public.inv_stock_moves where org_id = o) <> moves_before or (select count(*) from public.fin_payments where org_id = o) <> pays_before then
    raise exception 'FAIL R1g: an import touched stock or money';
  end if;
  if (select count(*) from public.audit_log where org_id = o and action in ('sales.shopify.imported', 'sales.shopify.review')) <> 6 then raise exception 'FAIL R1h: audit rows'; end if;

  -- ---- T1: the simulated test order
  set local role authenticated;
  r := public.sal_shopify_test_order();
  if r ->> 'result' <> 'imported' then raise exception 'FAIL T1a: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_shopify_test_order(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T1b: a member made a test order'; end if;
  reset role;

  -- ---- K1: the secret is found by shop domain, for the server only
  if public.sal__shopify_callback_credentials('TEST-SHOP.myshopify.com') -> 'credentials' ->> 'webhook_secret' <> 'whsec-s' then raise exception 'FAIL K1a: secret not found by domain'; end if;
  if public.sal__shopify_callback_credentials('other.myshopify.com') is not null then raise exception 'FAIL K1b: an unknown shop matched'; end if;

  -- ---- P1: other companies, anonymous
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sal_shopify_orders; if n <> 0 then raise exception 'FAIL P1a: another company sees % imports', n; end if;
  ok := false; begin perform public.sal__ingest_shopify_order(ob, '{}'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P1b: a user called ingest'; end if;
  reset role;
  if has_function_privilege('anon', 'public.sal_shopify_test_order()', 'execute')
     or has_function_privilege('authenticated', 'public.sal__shopify_callback_credentials(text)', 'execute') then
    raise exception 'FAIL P2: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
