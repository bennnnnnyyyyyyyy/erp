-- sql/tests/060_sole_approver_more.sql
-- The sole-approver exception for adjustments, transfers, counts and credit notes (sql/065). Always rolls back. Needs sql/001-065.
-- Covers: a sole owner decides their own adjustment, transfer, count and credit note; each is flagged self_decided and has a
-- '<area>.self_decided' audit row; once a second admin exists the strict rule is back; the table refuses an unflagged self-decision;
-- another company cannot decide; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w1 uuid; w2 uuid; i1 uuid; cu uuid; so uuid; sol uuid; inv uuid; il uuid;
  adj uuid; adj2 uuid; tr uuid; cnt uuid; nt uuid; ok boolean; st text; q numeric;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sm-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'sm-a@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'sm-x@tests.invalid');
  o := public.bootstrap_organization('Solo More A', 'solo-more-a', 'sm-o@tests.invalid');
  ob := public.bootstrap_organization('Solo More B', 'solo-more-b', 'sm-x@tests.invalid');
  insert into public.org_modules (org_id, module_key) values (o, 'inventory'), (o, 'sales'), (ob, 'inventory'), (ob, 'sales');
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main', null);
  w2 := public.inv_create_warehouse('SHOP', 'Shop', null);
  i1 := public.inv_create_item('SM-1', 'Solo stock', null, 'piece', 100, w1);
  cu := public.sal_create_customer('Solo Buyer', null, null, null);

  -- ---- S1: own stock adjustment
  adj := (public.inv_submit_adjustment(i1, w1, 95, 'found five missing') ->> 'id')::uuid;
  perform public.inv_decide_adjustment(adj, 'approved');
  select status into st from public.inv_adjustments where id = adj;
  if st <> 'applied' then raise exception 'FAIL S1a: own adjustment is %', st; end if;
  select sum(on_hand) into q from public.inv_stock_balances where item_id = i1;
  if q <> 95 then raise exception 'FAIL S1b: on hand %, expected 95', q; end if;

  -- ---- S2: own transfer
  tr := (public.inv_submit_transfer(w1, w2, 'restock the shop', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10))) ->> 'id')::uuid;
  perform public.inv_decide_transfer(tr, 'approved');
  select status into st from public.inv_transfers where id = tr;
  if st <> 'approved' then raise exception 'FAIL S2: own transfer is %', st; end if;

  -- ---- S3: own stock count
  cnt := (public.inv_start_count(w1, array[i1], null) ->> 'id')::uuid;
  perform public.inv_set_count_line(cnt, i1, 93);
  perform public.inv_submit_count(cnt);
  perform public.inv_decide_count(cnt, 'approved');
  select status into st from public.inv_counts where id = cnt;
  if st <> 'applied' then raise exception 'FAIL S3: own count is %', st; end if;

  -- ---- S4: own credit note (invoice inserted directly, as in tests/031)
  reset role;
  so := gen_random_uuid(); sol := gen_random_uuid(); inv := gen_random_uuid(); il := gen_random_uuid();
  insert into public.sal_orders (id, org_id, number, customer_id, warehouse_id, status, currency, created_by) values (so, o, 'SO-9101', cu, w1, 'stock_requested', 'EGP', u);
  insert into public.sal_order_lines (id, org_id, order_id, item_id, qty, unit_price_minor) values (sol, o, so, i1, 5, 1000);
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values (inv, o, 'INV-9101', so, cu, current_date, 'EGP', u);
  insert into public.sal_invoice_lines (id, org_id, invoice_id, order_line_id, qty, unit_price_minor) values (il, o, inv, sol, 5, 1000);
  set local role authenticated;
  nt := (public.sal_submit_note(inv, 'credit', 'one broken', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 1))) ->> 'id')::uuid;
  perform public.sal_decide_note(nt, 'approved');
  select status into st from public.sal_notes where id = nt;
  if st <> 'approved' then raise exception 'FAIL S4: own credit note is %', st; end if;

  -- ---- S5: all flagged and audited
  reset role;
  if not (select self_decided from public.inv_adjustments where id = adj) or not (select self_decided from public.inv_transfers where id = tr)
     or not (select self_decided from public.inv_counts where id = cnt) or not (select self_decided from public.sal_notes where id = nt) then
    raise exception 'FAIL S5a: a self-decision is not flagged';
  end if;
  if (select count(*) from public.audit_log where org_id = o and action in
      ('inventory.adjustment.self_decided', 'inventory.transfer.self_decided', 'inventory.count.self_decided', 'sales.note.self_decided')
      and summary like '%self-approved%') <> 4 then
    raise exception 'FAIL S5b: self-decisions not all audited';
  end if;

  -- ---- T1: the table refuses an unflagged self-decision
  ok := false; begin update public.inv_adjustments set self_decided = false where id = adj; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL T1a: adjustments accept an unflagged self-decision'; end if;
  ok := false; begin update public.sal_notes set self_decided = false where id = nt; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL T1b: notes accept an unflagged self-decision'; end if;

  -- ---- S6: a second admin brings the strict rule back
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin');
  set local role authenticated;
  adj2 := (public.inv_submit_adjustment(i1, w1, 92, 'recount') ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_adjustment(adj2, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S6: own adjustment approved although an admin exists'; end if;

  -- ---- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_decide_adjustment(adj2, 'approved'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1: another company decided an adjustment'; end if;
  reset role;

  if has_function_privilege('anon', 'public.inv_decide_adjustment(uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.sal_decide_note(uuid, text, text, text)', 'execute') then
    raise exception 'FAIL A1: anonymous callers can decide';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
