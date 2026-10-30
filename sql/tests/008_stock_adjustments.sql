-- sql/tests/008_stock_adjustments.sql
-- I3: stock adjustments from a count. Always rolls back. Needs sql/001-012.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner
  ub uuid := gen_random_uuid();  -- admin
  uc uuid := gen_random_uuid();  -- member (counts)
  ud uuid := gen_random_uuid();  -- viewer
  ue uuid := gen_random_uuid();  -- owner, other organization
  oa uuid; ob uuid;
  w1 uuid; i1 uuid; wb uuid; ib uuid;
  j jsonb;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid;
  rq uuid;
  n bigint; oh numeric; rs numeric;
  st text;
  ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'adj-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'adj-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'adj-c@tests.invalid'), (ud, 'authenticated', 'authenticated', 'adj-d@tests.invalid'),
    (ue, 'authenticated', 'authenticated', 'adj-e@tests.invalid');
  oa := public.bootstrap_organization('Adjust Test A', 'adj-test-a', 'adj-a@tests.invalid');
  ob := public.bootstrap_organization('Adjust Test B', 'adj-test-b', 'adj-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member'), (oa, ud, 'viewer');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (oa, 'messaging'), (ob, 'inventory');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('GLV', 'Gloves', null, 'pair', 100, w1);
  reset role;

  -- ---- S1: submitting a count: rules on who and what
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.inv_submit_adjustment(i1, w1, 92, 'Cycle count aisle 4');
  a1 := (j ->> 'id')::uuid;
  if j ->> 'number' <> 'ADJ-0001' then raise exception 'FAIL S1a: first adjustment is %, expected ADJ-0001', j ->> 'number'; end if;
  ok := false;
  begin perform public.inv_submit_adjustment(i1, w1, 100, 'same'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1b: a count equal to the book quantity was accepted'; end if;
  ok := false;
  begin perform public.inv_submit_adjustment(i1, w1, 90, ''); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1c: a count without a reason was accepted'; end if;
  ok := false;
  begin perform public.inv_submit_adjustment(i1, w1, -1, 'negative'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1d: a negative count was accepted'; end if;
  reset role;
  select count(*) into n from public.inv_adjustments where id = a1 and expected_qty = 100 and counted_qty = 92 and delta = -8 and status = 'submitted';
  if n <> 1 then raise exception 'FAIL S1e: the adjustment was not stored as expected 100, counted 92, difference -8'; end if;
  select b.on_hand into oh from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1;
  if oh <> 100 then raise exception 'FAIL S1f: submitting a count changed stock to %', oh; end if;
  select count(*) into n from public.msg_outbox where entity_id = a1 and kind = 'approval_request';
  if n <> 2 then raise exception 'FAIL S1g: expected a message for each of the 2 managers, found %', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_submit_adjustment(i1, w1, 90, 'viewer'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S1h: a viewer submitted a count'; end if;
  reset role;

  -- ---- S2: nobody applies a count without approval, not even by writing to the ledger directly
  ok := false;
  begin insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, adjustment_id, posted_by) values (oa, i1, w1, -8, 'adjust', a1, uc); exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S2a: an adjust movement was accepted for an adjustment that is not approved'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_decide_adjustment(a1, 'approved'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2b: a member approved a count'; end if;
  ok := false;
  begin insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, adjustment_id, posted_by) values (oa, i1, w1, -8, 'adjust', a1, uc); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S2c: a signed-in user wrote an adjust movement'; end if;
  reset role;
  ok := false;
  begin update public.inv_adjustments set status = 'applied' where id = a1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S2d: an adjustment jumped from submitted to applied'; end if;
  ok := false;
  begin update public.inv_adjustments set status = 'approved', decided_by = requester_id where id = a1; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL S2e: the table accepted an adjustment approved by its own requester'; end if;

  -- ---- S3: a manager approves: the difference reaches the ledger and the balance, with audit
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_adjustment(a1, 'approved', 'confirmed');
  reset role;
  select b.on_hand into oh from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1;
  if oh <> 92 then raise exception 'FAIL S3a: on hand is %, expected 92', oh; end if;
  select count(*) into n from public.inv_stock_moves where adjustment_id = a1 and kind = 'adjust' and qty = -8 and posted_by = ub;
  if n <> 1 then raise exception 'FAIL S3b: expected one adjust movement of -8 by the approver'; end if;
  select status into st from public.inv_adjustments where id = a1;
  if st <> 'applied' then raise exception 'FAIL S3c: adjustment is %, expected applied', st; end if;
  select count(*) into n from public.audit_log where org_id = oa and entity_id = a1::text and action in ('inventory.adjustment.submitted', 'inventory.adjustment.applied');
  if n <> 2 then raise exception 'FAIL S3d: expected 2 audit rows for the adjustment, found %', n; end if;
  set local role authenticated;
  ok := false;
  begin perform public.inv_decide_adjustment(a1, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S3e: an applied adjustment could be decided again'; end if;
  reset role;
  select count(*) into n from public.msg_outbox where entity_id = a1 and kind = 'decision' and recipient_id = uc;
  if n <> 1 then raise exception 'FAIL S3f: the person who counted was not told the result'; end if;

  -- ---- S4: a count above the book quantity, then a stale count
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a2 := (public.inv_submit_adjustment(i1, w1, 95, 'found a box') ->> 'id')::uuid;
  a3 := (public.inv_submit_adjustment(i1, w1, 90, 'recount') ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_adjustment(a2, 'approved');
  ok := false;
  begin perform public.inv_decide_adjustment(a3, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S4a: a stale count (stock changed since) was applied'; end if;
  reset role;
  select b.on_hand into oh from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1;
  if oh <> 95 then raise exception 'FAIL S4b: on hand is %, expected 95', oh; end if;
  select count(*) into n from public.inv_stock_moves where adjustment_id = a3;
  if n <> 0 then raise exception 'FAIL S4c: a stale count left a ledger row'; end if;

  -- ---- S5: reject and cancel leave stock alone; a count cannot go below what is reserved
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_adjustment(a3, 'rejected', 'count again');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a4 := (public.inv_submit_adjustment(i1, w1, 96, 'maybe')) ->> 'id';
  perform public.inv_cancel_adjustment(a4);
  rq := (public.inv_submit_request(w1, 'reserve', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 50))) ->> 'id')::uuid;
  ok := false;
  begin perform public.inv_submit_adjustment(i1, w1, 40, 'too low'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5a: a count below the reserved quantity was accepted'; end if;
  reset role;
  select b.on_hand, b.reserved into oh, rs from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1;
  if oh <> 95 or rs <> 50 then raise exception 'FAIL S5b: balance is %/%, expected 95/50', oh, rs; end if;
  select status into st from public.inv_adjustments where id = a3;
  if st <> 'rejected' then raise exception 'FAIL S5c: rejected adjustment is %', st; end if;
  select status into st from public.inv_adjustments where id = a4::uuid;
  if st <> 'cancelled' then raise exception 'FAIL S5d: cancelled adjustment is %', st; end if;

  -- ---- S6: the ledger and audit stay consistent; other organizations; direct writes; chain
  select coalesce(sum(m.qty), 0) into n from public.inv_stock_moves m where m.org_id = oa and m.item_id = i1;
  if n <> 95 then raise exception 'FAIL S6a: the ledger adds up to %, expected 95 (100 opening - 8 + 3)', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_adjustments;
  if n <> 0 then raise exception 'FAIL S6b: another organization sees these adjustments'; end if;
  ok := false;
  begin perform public.inv_decide_adjustment(a2, 'approved'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S6c: another organization reached an adjustment'; end if;
  ok := false;
  begin update public.inv_adjustments set status = 'applied'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S6d: direct update of adjustments was allowed'; end if;
  reset role;
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S6e: the audit chain is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
