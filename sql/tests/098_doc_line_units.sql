-- sql/tests/098_doc_line_units.sql
-- sql/101: units on order lines and default units per item (MASTER_DATA_PLAN.md slice D). Always rolls back. Needs sql/001-101.
-- Covers: U1 a sales line typed in boxes keeps unit and factor, quantity and price stay in pieces; U2 half a box (whole pieces) is fine,
-- a part piece is refused, a measure (kg) may hold decimals; U3 a unit not set up, or not offered for that use, is refused; U4 back to
-- the base unit clears it; U5 purchase order lines (owners and admins); U6 default units (owners and admins, use checked); U7 a sales
-- order no longer open, a purchase order with goods received, is refused; U8 another company cannot; U9 no direct writes; U10 audit.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; sup uuid; cus uuid; so uuid; so2 uuid; po uuid; r record; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'dlu-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'dlu-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'dlu-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'dlu-x@tests.invalid');
  o := public.bootstrap_organization('Line units A', 'line-units-a', 'dlu-o@tests.invalid');
  ob := public.bootstrap_organization('Line units B', 'line-units-b', 'dlu-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('CRM-50', 'Face cream 50ml');                 -- base unit: piece
  i2 := public.inv_create_item('OIL-KG', 'Almond oil', null, 'kg');          -- base unit: kg (a measure)
  perform public.inv_set_item_unit(i1, 'box', 12, true, true);
  perform public.inv_set_item_unit(i1, 'carton', 24, true, false);           -- buying only
  perform public.inv_set_item_unit(i2, 'drum', 25, true, true);
  sup := public.pur_create_supplier('Supplier', null, null, null);
  cus := public.sal_create_customer('Shop');

  -- ---- U1: 3 boxes at 120.00 a box = 36 pieces at 10.00
  so := (public.sal_create_order(cus, w, jsonb_build_array(
          jsonb_build_object('itemId', i1, 'qty', 36, 'unitPriceMinor', 1000),
          jsonb_build_object('itemId', i2, 'qty', 37.5, 'unitPriceMinor', 500))) ->> 'id')::uuid;
  perform public.sal_set_order_line_units(so, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'BOX')));
  select * into r from public.sal_order_lines where order_id = so and item_id = i1;
  if r.unit <> 'box' or r.unit_factor <> 12 or r.qty <> 36 or r.unit_price_minor <> 1000 then
    raise exception 'FAIL U1: line is % % x% at %', r.qty, r.unit, r.unit_factor, r.unit_price_minor;
  end if;

  -- ---- U2: a measure may hold decimals (37.5 kg = 1.5 drums); a part piece is refused
  perform public.sal_set_order_line_units(so, jsonb_build_array(jsonb_build_object('itemId', i2, 'unit', 'drum')));
  select unit_factor into r from public.sal_order_lines where order_id = so and item_id = i2;
  if r.unit_factor <> 25 then raise exception 'FAIL U2a: kg line factor %', r.unit_factor; end if;
  so2 := (public.sal_create_order(cus, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 15.6, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  ok := false; begin perform public.sal_set_order_line_units(so2, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'box')));
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL U2b: 1.3 boxes (15.6 pieces) accepted'; end if;

  -- ---- U3: carton is for buying only; an unknown unit is refused
  ok := false; begin perform public.sal_set_order_line_units(so, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'carton')));
  exception when others then ok := (sqlerrm = 'UNKNOWN_UNIT'); end;
  if not ok then raise exception 'FAIL U3a: sold in a buying-only unit'; end if;
  ok := false; begin perform public.sal_set_order_line_units(so, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'crate')));
  exception when others then ok := (sqlerrm = 'UNKNOWN_UNIT'); end;
  if not ok then raise exception 'FAIL U3b: an unknown unit accepted'; end if;

  -- ---- U4: the base unit clears it
  perform public.sal_set_order_line_units(so, jsonb_build_array(jsonb_build_object('itemId', i2, 'unit', 'kg')));
  select unit, unit_factor into r from public.sal_order_lines where order_id = so and item_id = i2;
  if r.unit is not null or r.unit_factor is not null then raise exception 'FAIL U4: base unit kept as %', r.unit; end if;

  -- ---- U5: purchase order in cartons (owner), member refused
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 48, 'unitCostMinor', 800))) ->> 'id')::uuid;
  perform public.pur_set_order_line_units(po, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'carton')));
  select unit, unit_factor, qty into r from public.pur_order_lines where order_id = po;
  if r.unit <> 'carton' or r.unit_factor <> 24 or r.qty <> 48 then raise exception 'FAIL U5a: PO line % x%', r.unit, r.unit_factor; end if;

  -- ---- U6: default units
  perform public.inv_set_item_default_units(i1, 'Carton', 'box');
  select default_purchase_unit, default_sale_unit into r from public.inv_items where id = i1;
  if r.default_purchase_unit <> 'carton' or r.default_sale_unit <> 'box' then raise exception 'FAIL U6a: defaults % / %', r.default_purchase_unit, r.default_sale_unit; end if;
  ok := false; begin perform public.inv_set_item_default_units(i1, null, 'carton'); exception when others then ok := (sqlerrm = 'UNKNOWN_UNIT'); end;
  if not ok then raise exception 'FAIL U6b: sells by default in a buying-only unit'; end if;
  perform public.inv_set_item_default_units(i1, 'piece', null);
  select default_purchase_unit into r from public.inv_items where id = i1;
  if r.default_purchase_unit is not null then raise exception 'FAIL U6c: base unit stored as a default'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_set_item_default_units(i1, 'carton', null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL U6d: a member set default units'; end if;
  ok := false; begin perform public.pur_set_order_line_units(po, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'box'))); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL U5b: a member set purchase units'; end if;
  perform public.sal_set_order_line_units(so2, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', null)));  -- members sell
  select default_sale_unit into r from public.inv_items where id = i1;   -- members read the defaults
  if r.default_sale_unit <> 'box' then raise exception 'FAIL U6e: a member cannot read the default sale unit'; end if;
  reset role;

  -- ---- U7: no longer open / goods received
  -- set up directly (the approval and receiving flows are tested elsewhere); triggers off for these two rows only
  set local session_replication_role = replica;
  update public.sal_orders set status = 'cancelled' where id = so2;
  update public.pur_order_lines set received_qty = 24 where order_id = po;
  set local session_replication_role = origin;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_set_order_line_units(so2, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'box')));
  exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL U7a: units changed on a cancelled order'; end if;
  ok := false; begin perform public.pur_set_order_line_units(po, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', null)));
  exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL U7b: units changed after goods were received'; end if;

  -- ---- U9: no direct writes
  ok := false; begin update public.sal_order_lines set unit = 'box', unit_factor = 12 where order_id = so2; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL U9a: a direct update of a sales line'; end if;
  ok := false; begin update public.inv_items set default_sale_unit = 'box' where id = i1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL U9b: a direct update of an item'; end if;
  ok := false; begin perform public.inv__line_unit(o, i1, 'box', 12, 'sale'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL U9c: users call the internal helper'; end if;
  reset role;

  -- ---- U8: another company
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.sal_order_lines where org_id = o;
  if n <> 0 then raise exception 'FAIL U8a: company B sees A''s lines'; end if;
  ok := false; begin perform public.sal_set_order_line_units(so, jsonb_build_array(jsonb_build_object('itemId', i1, 'unit', 'box')));
  exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL U8b: company B changed A''s order'; end if;
  ok := false; begin perform public.inv_set_item_default_units(i1, null, null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL U8c: company B changed A''s item'; end if;
  reset role;

  -- ---- U10: audit rows: sales units 3 (box, drum, kg back) + so2 none (null = base, unchanged), purchase 1, defaults 2
  select count(*) into n from public.audit_log where org_id = o and action in ('sales.order.units_set', 'purchasing.order.units_set', 'inventory.item.default_units_changed');
  if n <> 6 then raise exception 'FAIL U10: % unit audit rows, expected 6', n; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
