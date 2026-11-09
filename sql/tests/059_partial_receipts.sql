-- sql/tests/059_partial_receipts.sql
-- Receiving part of a purchase order (sql/064). Always rolls back. Needs sql/001-064.
-- Covers: part of an order arrives and the rest is still coming (stock goes up by what came, the order stays open); a second receipt
-- completes it; closing an order short; billing is capped by what arrived, also while the order is still open; more than is still to
-- come is refused; an order with something received cannot be cancelled; "receive everything" takes only what is left; the forecast
-- counts only what has not arrived; a viewer cannot receive; another company cannot; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; j uuid; s uuid; po uuid; po2 uuid; po3 uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid;
  r jsonb; ok boolean; st text; q numeric;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'pr-o@tests.invalid'), (v, 'authenticated', 'authenticated', 'pr-v@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'pr-x@tests.invalid');
  o := public.bootstrap_organization('Partial Test A', 'partial-test-a', 'pr-o@tests.invalid');
  ob := public.bootstrap_organization('Partial Test B', 'partial-test-b', 'pr-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, v, 'viewer');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('PR-1', 'Boxes', null, 'piece', 0, null);
  j := public.inv_create_item('PR-2', 'Tape', null, 'piece', 0, null);
  s := public.pur_create_supplier('Partial Supplier', null, null, null);
  po := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 500),
                                                         jsonb_build_object('itemId', j, 'qty', 4, 'unitCostMinor', 200))) ->> 'id')::uuid;
  select id into l1 from public.pur_order_lines where order_id = po and item_id = i;
  select id into l2 from public.pur_order_lines where order_id = po and item_id = j;

  -- ---- P1: 6 of 10 boxes and no tape arrive; the rest is still coming
  r := public.pur_receive_lines(po, jsonb_build_array(jsonb_build_object('lineId', l1, 'qty', 6), jsonb_build_object('lineId', l2, 'qty', 0)), true);
  if r ->> 'status' <> 'ordered' or (r ->> 'stillToCome')::numeric <> 8 then raise exception 'FAIL P1a: %', r; end if;
  select sum(on_hand) into q from public.inv_stock_balances where item_id = i;
  if q <> 6 then raise exception 'FAIL P1b: on hand %, expected 6', q; end if;
  reset role;
  select f.on_order into q from public.inv__forecast_for(o) f where f.item_id = i;
  if q <> 4 then raise exception 'FAIL P1c: forecast on order %, expected 4', q; end if;
  set local role authenticated;

  -- ---- P2: billing is capped by what arrived, while the order is still open
  perform public.pur_record_supplier_invoice(s, po, 'PB-1', current_date, jsonb_build_array(jsonb_build_object('orderLineId', l1, 'qty', 6)));
  ok := false;
  begin perform public.pur_record_supplier_invoice(s, po, 'PB-2', current_date, jsonb_build_array(jsonb_build_object('orderLineId', l1, 'qty', 1)));
  exception when others then ok := (sqlerrm = 'BILL_QTY_EXCEEDS_RECEIVED'); end;
  if not ok then raise exception 'FAIL P2: billed more than arrived'; end if;

  -- ---- P3: more than is still to come is refused; an order with receipts cannot be cancelled; nothing at all is refused
  ok := false; begin perform public.pur_receive_lines(po, jsonb_build_array(jsonb_build_object('lineId', l1, 'qty', 5)), true); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P3a: received more than ordered'; end if;
  ok := false; begin perform public.pur_cancel_order(po); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3b: cancelled an order that was partly received'; end if;
  ok := false; begin perform public.pur_receive_lines(po, '[]'::jsonb, true); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P3c: an empty receipt was accepted'; end if;

  -- ---- P4: the rest arrives; the order is complete
  r := public.pur_receive_lines(po, jsonb_build_array(jsonb_build_object('lineId', l1, 'qty', 4), jsonb_build_object('lineId', l2, 'qty', 4)), true);
  if r ->> 'status' <> 'received' then raise exception 'FAIL P4a: %', r; end if;
  select status into st from public.pur_orders where id = po;
  if st <> 'received' then raise exception 'FAIL P4b: order is %', st; end if;
  select sum(on_hand) into q from public.inv_stock_balances where item_id = i;
  if q <> 10 then raise exception 'FAIL P4c: on hand %, expected 10', q; end if;

  -- ---- P5: closing short; what never came cannot be billed
  po2 := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 5, 'unitCostMinor', 500))) ->> 'id')::uuid;
  select id into l3 from public.pur_order_lines where order_id = po2;
  r := public.pur_receive_lines(po2, jsonb_build_array(jsonb_build_object('lineId', l3, 'qty', 3)), false);
  if r ->> 'status' <> 'received' then raise exception 'FAIL P5a: %', r; end if;
  ok := false;
  begin perform public.pur_record_supplier_invoice(s, po2, 'PB-3', current_date, jsonb_build_array(jsonb_build_object('orderLineId', l3, 'qty', 4)));
  exception when others then ok := (sqlerrm = 'BILL_QTY_EXCEEDS_RECEIVED'); end;
  if not ok then raise exception 'FAIL P5b: billed what never came'; end if;
  ok := false; begin perform public.pur_receive_lines(po2, jsonb_build_array(jsonb_build_object('lineId', l3, 'qty', 1)), true); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P5c: received on a closed order'; end if;

  -- ---- P6: "receive everything" after a part receipt takes only what is left
  po3 := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', j, 'qty', 10, 'unitCostMinor', 200))) ->> 'id')::uuid;
  select id into l4 from public.pur_order_lines where order_id = po3;
  perform public.pur_receive_lines(po3, jsonb_build_array(jsonb_build_object('lineId', l4, 'qty', 7)), true);
  perform public.pur_receive_order(po3);
  select received_qty into q from public.pur_order_lines where id = l4;
  if q <> 10 then raise exception 'FAIL P6a: received_qty %', q; end if;
  select sum(on_hand) into q from public.inv_stock_balances where item_id = j;
  if q <> 14 then raise exception 'FAIL P6b: tape on hand %, expected 14 (4 + 10)', q; end if;

  -- ---- R1: a viewer cannot receive
  po3 := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', j, 'qty', 2, 'unitCostMinor', 200))) ->> 'id')::uuid;
  select id into l5 from public.pur_order_lines where order_id = po3;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.pur_receive_lines(po3, jsonb_build_array(jsonb_build_object('lineId', l5, 'qty', 1)), true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R1: a viewer received stock'; end if;

  -- ---- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.pur_receive_lines(po3, jsonb_build_array(jsonb_build_object('lineId', l5, 'qty', 1)), true); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1: another company received stock'; end if;
  reset role;

  -- ---- A2: audit
  if not exists (select 1 from public.audit_log where org_id = o and action = 'purchasing.order.partly_received' and summary like '%still to come%') then
    raise exception 'FAIL A2a: part receipt not audited';
  end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'purchasing.order.received' and summary like '%closed short%') then
    raise exception 'FAIL A2b: closing short not audited';
  end if;
  if has_function_privilege('anon', 'public.pur_receive_lines(uuid, jsonb, boolean)', 'execute') then raise exception 'FAIL A1: anonymous callers can receive'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
