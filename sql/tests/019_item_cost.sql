-- sql/tests/019_item_cost.sql
-- Item cost: weighted average on purchase receipts, manual cost, issue moves remember the average, cost hidden from members,
-- owner/admin only functions, append-only cost log, isolation, audit. Always rolls back. Needs sql/001-023.

do $$
declare
  u uuid := gen_random_uuid();  -- owner
  m uuid := gen_random_uuid();  -- member
  x uuid := gen_random_uuid();  -- owner of another organization
  o uuid; ob uuid; w uuid; i uuid; s uuid; po uuid; rq uuid;
  n bigint; v numeric; ok boolean; c bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'cost-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'cost-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'cost-x@tests.invalid');
  o := public.bootstrap_organization('Cost Test A', 'cost-test-a', 'cost-o@tests.invalid');
  ob := public.bootstrap_organization('Cost Test B', 'cost-test-b', 'cost-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('C-1', 'Cost item', null, 'piece', 10, w);   -- 10 on hand, cost not set yet
  s := public.pur_create_supplier('Supplier', null, null, null);

  -- S1: manual cost 100 on the opening stock; logged and audited
  perform public.inv_set_item_cost(i, 100);
  select avg_cost_minor into c from public.inv_item_costs() where item_id = i;
  if c <> 100 then raise exception 'FAIL S1a: cost %', c; end if;
  reset role;
  select count(*) into n from public.inv_cost_log where item_id = i and source = 'manual';
  if n <> 1 then raise exception 'FAIL S1b: manual change not logged'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'inventory.item.cost_set';
  if n <> 1 then raise exception 'FAIL S1c: manual change not audited'; end if;

  -- S2: receive 10 more at 200 -> average (10x100 + 10x200) / 20 = 150
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  po := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 200))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.pur_receive_order(po);
  reset role;
  select avg_cost_minor into c from public.inv_items where id = i;
  if c <> 150 then raise exception 'FAIL S2: average cost % (expected 150)', c; end if;
  select count(*) into n from public.inv_cost_log where item_id = i and source = 'purchase_receipt' and avg_before_minor = 100 and avg_after_minor = 150;
  if n <> 1 then raise exception 'FAIL S2b: receipt not logged with before/after'; end if;

  -- S3: an issue remembers the average at that moment (150), and a later cost change does not rewrite it
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  rq := (public.inv_submit_request(w, 'cost test', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 4))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  select unit_cost_minor into c from public.inv_stock_moves where request_id = rq;
  if c is distinct from 150 then raise exception 'FAIL S3a: issue cost % (expected 150)', c; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_set_item_cost(i, 999); reset role;
  select unit_cost_minor into c from public.inv_stock_moves where request_id = rq;
  if c is distinct from 150 then raise exception 'FAIL S3b: earlier issue cost was rewritten (%)', c; end if;
  set local role authenticated; perform public.inv_set_item_cost(i, 150); reset role;

  -- S4: stock value = on hand x average (16 x 150 = 2400)
  set local role authenticated;
  select value_minor into n from public.inv_item_costs() where item_id = i;
  reset role;
  if n <> 2400 then raise exception 'FAIL S4: stock value % (expected 2400)', n; end if;

  -- S5: a member cannot read cost columns, call the cost functions, or write directly
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform avg_cost_minor from public.inv_items limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S5a: member read the item cost column'; end if;
  ok := false; begin perform unit_cost_minor from public.inv_stock_moves limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S5b: member read the ledger cost column'; end if;
  select count(*) into n from public.inv_items where sku = 'C-1';   -- ordinary columns still readable
  if n <> 1 then raise exception 'FAIL S5c: member lost normal read access'; end if;
  ok := false; begin perform public.inv_item_costs(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S5d: member read stock value'; end if;
  ok := false; begin perform public.inv_set_item_cost(i, 1); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S5e: member set a cost'; end if;
  ok := false; begin update public.inv_items set avg_cost_minor = 1 where id = i; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S5f: member wrote the cost directly'; end if;
  reset role;

  -- S6: the cost log is append-only
  ok := false; begin update public.inv_cost_log set unit_cost_minor = 1; exception when others then ok := (sqlerrm = 'APPEND_ONLY'); end;
  if not ok then raise exception 'FAIL S6a: cost log was updated'; end if;
  ok := false; begin delete from public.inv_cost_log; exception when others then ok := (sqlerrm = 'APPEND_ONLY'); end;
  if not ok then raise exception 'FAIL S6b: cost log was deleted'; end if;

  -- S7: another organization cannot touch this item's cost and sees nothing of it
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_set_item_cost(i, 1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S7a: another organization changed this cost'; end if;
  select count(*) into n from public.inv_item_costs();
  if n <> 0 then raise exception 'FAIL S7b: another organization sees % cost rows', n; end if;
  reset role;

  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL S8: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
