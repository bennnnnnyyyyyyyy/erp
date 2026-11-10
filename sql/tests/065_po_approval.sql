-- sql/tests/065_po_approval.sql
-- Purchase order approval (sql/069). Always rolls back. Needs sql/001-069.
-- Covers: by default a new order waits for approval and nothing can be received; its creator cannot approve it while another owner or
-- admin exists; an admin approves and receiving works; rejecting needs a reason and cancels the order; a member cannot decide or change
-- the setting; a sole owner may approve their own order, flagged and audited; the amount threshold and switching it off; the table
-- refuses an unflagged self-decision; another company cannot see or decide the order; anonymous callers cannot call anything.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; wb uuid; i uuid; ib uuid; s uuid; sb uuid; po uuid; po2 uuid; po3 uuid; po4 uuid; pb uuid; l uuid;
  r jsonb; ok boolean; st text; ap text; q numeric;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'poa-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'poa-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'poa-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'poa-x@tests.invalid');
  o := public.bootstrap_organization('PO Approval A', 'po-approval-a', 'poa-o@tests.invalid');
  ob := public.bootstrap_organization('PO Approval B', 'po-approval-b', 'poa-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- the owner sets up and orders
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('POA-1', 'Cartons', null, 'piece', 0, null);
  s := public.pur_create_supplier('Approval Supplier', null, null, null);

  -- ---- P1: default on; the order waits; the setting reads back
  r := public.pur_po_approval();
  if not (r ->> 'on')::boolean or (r ->> 'fromMinor')::bigint <> 0 then raise exception 'FAIL P1a: default setting is %', r; end if;
  r := public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 500)));
  po := (r ->> 'id')::uuid;
  if r ->> 'approval' <> 'pending' then raise exception 'FAIL P1b: new order is %', r ->> 'approval'; end if;
  if (select total_minor from public.pur_orders where id = po) <> 5000 then raise exception 'FAIL P1c: total not 5000'; end if;
  select id into l from public.pur_order_lines where order_id = po;

  -- ---- P2: nothing can be received while it waits (both ways of receiving)
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.pur_receive_lines(po, jsonb_build_array(jsonb_build_object('lineId', l, 'qty', 4)), true);
  exception when others then ok := (sqlerrm = 'NOT_APPROVED'); end;
  if not ok then raise exception 'FAIL P2a: part receipt of a waiting order was not refused'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.pur_receive_order(po); exception when others then ok := (sqlerrm = 'NOT_APPROVED'); end;
  if not ok then raise exception 'FAIL P2b: full receipt of a waiting order was not refused'; end if;

  -- ---- P3: the creator cannot approve while another admin exists; a member cannot decide at all
  ok := false; begin perform public.pur_decide_order(po, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL P3a: creator approved own order with an admin present'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.pur_decide_order(po, 'approved'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P3b: a member approved an order'; end if;
  ok := false; begin perform public.pur_set_po_approval(false, 0); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P3c: a member changed the approval setting'; end if;

  -- ---- P4: another company's owner cannot see or decide it
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.pur_orders where id = po) then raise exception 'FAIL P4a: another company sees the order'; end if;
  ok := false; begin perform public.pur_decide_order(po, 'approved'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P4b: another company decided the order'; end if;

  -- ---- P5: the admin approves; receiving now works
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.pur_decide_order(po, 'approved', 'price checked');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  r := public.pur_receive_lines(po, jsonb_build_array(jsonb_build_object('lineId', l, 'qty', 4)), true);
  select received_qty into q from public.pur_order_lines where id = l;
  if q <> 4 then raise exception 'FAIL P5a: received % after approval', q; end if;
  ok := false; begin perform public.pur_decide_order(po, 'rejected', 'too late'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P5b: an approved order was decided again'; end if;

  -- ---- P6: rejecting needs a reason, and cancels the order
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  po2 := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 2, 'unitCostMinor', 500))) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.pur_decide_order(po2, 'rejected', '  '); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P6a: rejected without a reason'; end if;
  perform public.pur_decide_order(po2, 'rejected', 'wrong supplier');
  select status, approval into st, ap from public.pur_orders where id = po2;
  if st <> 'cancelled' or ap <> 'rejected' then raise exception 'FAIL P6b: rejected order is % / %', st, ap; end if;

  -- ---- P7: threshold, then off
  perform public.pur_set_po_approval(true, 100000);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  r := public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1, 'unitCostMinor', 500)));
  if r ->> 'approval' <> 'not_needed' then raise exception 'FAIL P7a: small order is %', r ->> 'approval'; end if;
  po3 := (r ->> 'id')::uuid;
  perform public.pur_receive_order(po3);
  r := public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 200, 'unitCostMinor', 500)));
  if r ->> 'approval' <> 'pending' then raise exception 'FAIL P7b: large order is %', r ->> 'approval'; end if;
  po4 := (r ->> 'id')::uuid;
  perform public.pur_set_po_approval(false, 0);
  r := public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 200, 'unitCostMinor', 500)));
  if r ->> 'approval' <> 'not_needed' then raise exception 'FAIL P7c: approval off but order is %', r ->> 'approval'; end if;
  if (select approval from public.pur_orders where id = po4) <> 'pending' then raise exception 'FAIL P7d: switching off changed a waiting order'; end if;

  -- ---- P8: a sole owner may approve their own order, flagged
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  wb := public.inv_create_warehouse('MAIN', 'Main', null);
  ib := public.inv_create_item('POB-1', 'Labels', null, 'piece', 0, null);
  sb := public.pur_create_supplier('Solo Supplier', null, null, null);
  pb := (public.pur_create_order(sb, wb, jsonb_build_array(jsonb_build_object('itemId', ib, 'qty', 5, 'unitCostMinor', 100))) ->> 'id')::uuid;
  perform public.pur_decide_order(pb, 'approved');
  perform public.pur_receive_order(pb);
  reset role;
  if not (select approval_self from public.pur_orders where id = pb) then raise exception 'FAIL P8a: sole owner approval not flagged'; end if;
  if not exists (select 1 from public.audit_log where org_id = ob and entity_id = pb::text and action = 'purchasing.order.self_approved') then
    raise exception 'FAIL P8b: self-approval not in the audit log';
  end if;

  -- ---- P9: audit rows for company A
  if not exists (select 1 from public.audit_log where org_id = o and entity_id = po::text and action = 'purchasing.order.approved' and actor_user_id = a) then
    raise exception 'FAIL P9a: approval not audited';
  end if;
  if not exists (select 1 from public.audit_log where org_id = o and entity_id = po2::text and action = 'purchasing.order.rejected' and summary like '%wrong supplier%') then
    raise exception 'FAIL P9b: rejection not audited with its reason';
  end if;
  if (select count(*) from public.audit_log where org_id = o and action = 'purchasing.order_approval.set') <> 2 then
    raise exception 'FAIL P9c: setting changes not audited';
  end if;

  -- ---- P10: the table refuses an unflagged self-decision, and users cannot write the table
  ok := false;
  begin
    update public.pur_orders set approval_self = false where id = pb;
  exception when check_violation then ok := true; when others then ok := true;
  end;
  if not ok then raise exception 'FAIL P10a: an unflagged self-decision was accepted'; end if;
  if has_table_privilege('authenticated', 'public.pur_orders', 'update') then raise exception 'FAIL P10b: users can update orders directly'; end if;

  -- ---- P11: anonymous callers cannot call any of it
  if has_function_privilege('anon', 'public.pur_decide_order(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.pur_set_po_approval(boolean, bigint)', 'execute')
     or has_function_privilege('anon', 'public.pur_po_approval()', 'execute')
     or has_function_privilege('authenticated', 'public.pur__po_approval(uuid)', 'execute') then
    raise exception 'FAIL P11: anonymous or internal access';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
