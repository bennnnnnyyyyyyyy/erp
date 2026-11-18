-- sql/tests/093_sal_prices.sql
-- sql/097: prices (MASTER_DATA_PLAN.md slice C). Always rolls back. Needs sql/001-097.
-- Covers: P1 an order records the supplier's last cost; P2 its bill makes it a bill price; P3 a newer order never replaces a bill price,
-- its bill does; P4 a purchase never changes the item's sales price (suggest only), the suggestion = latest cost + markup; P5 item price
-- and price list choice by customer group and date, fallback to the item price; P6 no overlapping lists for a group; P7 customer group
-- rules (in-use delete refused); P8 roles (members read and look up, only owners and admins change); P9 audit rows; P10 isolation;
-- P11 no direct writes; P12 includes-VAT copied from the company setting.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; sup uuid; po1 uuid; po2 uuid; pl uuid; c1 uuid; c2 uuid; gr uuid; gw uuid;
  lst uuid; lst2 uuid; info jsonb; r record; n bigint; ok boolean; v_today date;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'spr-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'spr-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'spr-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'spr-x@tests.invalid');
  o := public.bootstrap_organization('Prices A', 'prices-a', 'spr-o@tests.invalid');
  ob := public.bootstrap_organization('Prices B', 'prices-b', 'spr-x@tests.invalid');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  v_today := public.acc__local_date(o, now());

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('PR-1', 'Juice');
  i2 := public.inv_create_item('PR-2', 'Water');
  sup := public.pur_create_supplier('Supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  c1 := public.sal_create_customer('Retail shop');
  c2 := public.sal_create_customer('Walk-in');

  -- ---- P1: an order records the last cost (source: order)
  po1 := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10, 'unitCostMinor', 10000))) ->> 'id')::uuid;
  select * into r from public.pur_supplier_prices where org_id = o and supplier_id = sup and item_id = i1;
  if r.last_cost_minor <> 10000 or r.source_kind <> 'order' then raise exception 'FAIL P1: % from %', r.last_cost_minor, r.source_kind; end if;

  -- ---- P2: its bill makes it a bill price
  perform public.pur_receive_order(po1);
  select id into pl from public.pur_order_lines where order_id = po1;
  perform public.pur_record_supplier_invoice(sup, po1, 'B-1', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pl, 'qty', 10)));
  select * into r from public.pur_supplier_prices where org_id = o and supplier_id = sup and item_id = i1;
  if r.last_cost_minor <> 10000 or r.source_kind <> 'bill' or r.source_number <> 'B-1' then raise exception 'FAIL P2: % from % %', r.last_cost_minor, r.source_kind, r.source_number; end if;

  -- ---- P3: a newer order at 105.00 does not replace the bill price; its bill does
  po2 := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 5, 'unitCostMinor', 10500))) ->> 'id')::uuid;
  select * into r from public.pur_supplier_prices where org_id = o and supplier_id = sup and item_id = i1;
  if r.last_cost_minor <> 10000 or r.source_kind <> 'bill' then raise exception 'FAIL P3a: an order replaced a bill price (%)', r.last_cost_minor; end if;
  perform public.pur_receive_order(po2);
  select id into pl from public.pur_order_lines where order_id = po2;
  perform public.pur_record_supplier_invoice(sup, po2, 'B-2', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pl, 'qty', 5)));
  select * into r from public.pur_supplier_prices where org_id = o and supplier_id = sup and item_id = i1;
  if r.last_cost_minor <> 10500 or r.source_number <> 'B-2' then raise exception 'FAIL P3b: the new bill price is %', r.last_cost_minor; end if;

  -- ---- P4: suggest only; suggestion = latest cost + markup
  perform public.sal_set_item_price(i1, 15000);
  info := public.sal_item_price_info(i1);
  if (info -> 'salesPrice' ->> 'priceMinor')::bigint <> 15000 then raise exception 'FAIL P4a: a purchase changed the sales price: %', info -> 'salesPrice'; end if;
  if (info ->> 'suggestedPriceMinor')::bigint <> 10500 then raise exception 'FAIL P4b: no markup suggests %', info ->> 'suggestedPriceMinor'; end if;
  perform public.sal_set_default_markup(20);
  info := public.sal_item_price_info(i1);
  if (info ->> 'suggestedPriceMinor')::bigint <> 12600 then raise exception 'FAIL P4c: 105.00 + 20%% suggests %', info ->> 'suggestedPriceMinor'; end if;
  if jsonb_array_length(info -> 'supplierCosts') <> 1 then raise exception 'FAIL P4d: % supplier costs', jsonb_array_length(info -> 'supplierCosts'); end if;

  -- ---- P5: price lists by customer group and date
  gr := public.sal_save_customer_group(null, 'Retail', 'تجزئة');
  gw := public.sal_save_customer_group(null, 'Wholesale');
  perform public.sal_set_customer_group(c1, gr);
  lst := public.sal_save_price_list(null, 'Retail now', gr, v_today - 10, v_today + 10);
  perform public.sal_set_price_list_item(lst, i1, 14000);
  lst2 := public.sal_save_price_list(null, 'Retail next month', gr, v_today + 11, null);
  perform public.sal_set_price_list_item(lst2, i1, 14500);
  select * into r from public.sal_prices_for(c1, array[i1, i2]) p where p.item_id = i1;
  if r.price_minor <> 14000 or r.source <> 'list' or r.price_list_id <> lst then raise exception 'FAIL P5a: retail today gets % from %', r.price_minor, r.source; end if;
  select * into r from public.sal_prices_for(c1, array[i1], v_today + 20) p;
  if r.price_minor <> 14500 or r.price_list_id <> lst2 then raise exception 'FAIL P5b: retail next month gets %', r.price_minor; end if;
  select * into r from public.sal_prices_for(c2, array[i1]) p;
  if r.price_minor <> 15000 or r.source <> 'item' then raise exception 'FAIL P5c: a customer without a group gets % from %', r.price_minor, r.source; end if;
  select * into r from public.sal_prices_for(c1, array[i2]) p;
  if r.price_minor is not null or r.source is not null then raise exception 'FAIL P5d: an item with no price got %', r.price_minor; end if;
  select * into r from public.sal_prices_for(c1, array[i1], v_today - 30) p;
  if r.source <> 'item' then raise exception 'FAIL P5e: before any list the source is %', r.source; end if;

  -- ---- P6: no overlapping lists for one group
  ok := false; begin perform public.sal_save_price_list(null, 'Overlap', gr, v_today, v_today + 1); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL P6a: an overlapping list was saved'; end if;
  ok := false; begin perform public.sal_save_price_list(lst, 'Retail now', gr, v_today - 10, v_today + 11); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL P6b: a list was stretched over the next one'; end if;
  perform public.sal_save_price_list(null, 'Wholesale now', gw, v_today, null);   -- another group: fine

  -- ---- P7: a group in use cannot be deleted
  ok := false; begin perform public.sal_delete_customer_group(gr); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL P7a: a group with customers was deleted'; end if;
  ok := false; begin perform public.sal_save_customer_group(null, 'retail'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL P7b: two groups named Retail'; end if;

  -- ---- P8: roles
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  select count(*) into n from public.sal_prices_for(c1, array[i1]) p where p.price_minor = 14000;
  if n <> 1 then raise exception 'FAIL P8a: a member cannot look up prices'; end if;
  select count(*) into n from public.pur_supplier_prices where org_id = o;
  if n <> 1 then raise exception 'FAIL P8b: a member sees % supplier prices', n; end if;
  select count(*) into n from public.sal_customers where org_id = o and customer_group_id = gr;
  if n <> 1 then raise exception 'FAIL P8c: a member cannot read the customer''s group'; end if;
  ok := false; begin perform public.sal_set_item_price(i1, 1); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P8d: a member set a sales price'; end if;
  ok := false; begin perform public.sal_set_price_list_item(lst, i1, 1); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P8e: a member changed a price list'; end if;
  ok := false; begin perform public.sal_save_customer_group(null, 'Member group'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P8f: a member created a customer group'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.sal_set_price_list_item(lst, i1, 13900);   -- admins may

  -- ---- P11: no direct writes
  ok := false; begin insert into public.pur_supplier_prices (org_id, supplier_id, item_id, currency, last_cost_minor, source_kind, source_id) values (o, sup, i2, 'EGP', 1, 'bill', po1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P11a: a direct insert into supplier prices'; end if;
  ok := false; begin update public.sal_item_prices set price_minor = 1 where org_id = o; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P11b: a direct update of a sales price'; end if;
  ok := false; begin update public.sal_customers set customer_group_id = null where id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P11c: a direct update of a customer''s group'; end if;

  -- ---- P10: another company sees and changes none of it
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  select count(*) into n from (select id from public.pur_supplier_prices where org_id = o union all select id from public.sal_item_prices where org_id = o
    union all select id from public.sal_price_lists where org_id = o union all select id from public.sal_price_list_items where org_id = o
    union all select id from public.sal_customer_groups where org_id = o) t;
  if n <> 0 then raise exception 'FAIL P10a: company B sees % of A''s price rows', n; end if;
  ok := false; begin perform * from public.sal_prices_for(c1, array[i1]); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P10b: company B looked up A''s customer prices'; end if;
  ok := false; begin perform public.sal_set_item_price(i1, 1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P10c: company B priced A''s item'; end if;
  ok := false; begin perform public.sal_set_price_list_item(lst, i1, 1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P10d: company B changed A''s list'; end if;
  ok := false; begin perform public.sal_set_customer_group(c1, null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P10e: company B moved A''s customer'; end if;
  ok := false; begin perform public.sal_item_price_info(i1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P10f: company B read A''s item prices'; end if;

  -- ---- P12: includes-VAT follows the company setting when the price is saved
  reset role;
  update public.organizations set settings = coalesce(settings, '{}'::jsonb) || '{"prices_include_vat": true}' where id = o;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  perform public.sal_set_item_price(i2, 11400);
  select * into r from public.sal_prices_for(c2, array[i2]) p;
  if r.includes_vat is not true then raise exception 'FAIL P12a: the price did not record "includes VAT"'; end if;
  select * into r from public.sal_prices_for(c2, array[i1]) p;
  if r.includes_vat is not false then raise exception 'FAIL P12b: an older price changed meaning'; end if;
  reset role;

  -- ---- P9: audit rows
  select count(*) into n from public.audit_log where org_id = o and action = 'purchasing.supplier_price.recorded';
  if n <> 2 then raise exception 'FAIL P9a: % supplier price audits, expected 2 (100.00 first, then 105.00)', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action like 'sales.price_list.%';
  -- created: 3; item set: 2, admin change: 1
  if n <> 6 then raise exception 'FAIL P9b: % price list audits, expected 6', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action in ('sales.item_price.changed', 'sales.customer_group.created', 'sales.customer.group_changed', 'organization.default_markup_changed');
  if n <> 6 then raise exception 'FAIL P9c: % price and group audits, expected 6', n; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
