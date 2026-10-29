-- sql/tests/002_inventory_approval.sql
-- Proves the inventory slice rules (documentation/plans/INVENTORY_PLAN.md) on a real database: approval blocks stock,
-- no self-approval, reservation, ledger append-only, audit per step, organization isolation.
-- Self-contained, always rolls back. Result: an ERROR saying "ALL TESTS PASSED" is a pass; "FAIL S<n>" names the check.
-- Needs sql/001 to sql/006 applied.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner, org A
  ub uuid := gen_random_uuid();  -- admin (the manager), org A
  uc uuid := gen_random_uuid();  -- member (the requester), org A
  ud uuid := gen_random_uuid();  -- viewer, org A
  ue uuid := gen_random_uuid();  -- owner, org B
  oa uuid;
  ob uuid;
  w1 uuid;
  wb uuid;
  i1 uuid;
  i2 uuid;
  ib uuid;
  r1 uuid;
  r2 uuid;
  r3 uuid;
  r4 uuid;
  n  bigint;
  oh numeric;
  rs numeric;
  st text;
  nm text;
  ok boolean;
begin
  -- ------------------------------------------------------------ setup (as postgres)
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'inv-a@tests.invalid'),
    (ub, 'authenticated', 'authenticated', 'inv-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'inv-c@tests.invalid'),
    (ud, 'authenticated', 'authenticated', 'inv-d@tests.invalid'),
    (ue, 'authenticated', 'authenticated', 'inv-e@tests.invalid');
  oa := public.bootstrap_organization('Inventory Test A', 'inv-test-a', 'inv-a@tests.invalid');
  ob := public.bootstrap_organization('Inventory Test B', 'inv-test-b', 'inv-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member'), (oa, ud, 'viewer');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (ob, 'inventory');

  -- ------------------------------------------------------------ S1: owner sets up warehouse, items, opening stock
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main warehouse', 'المستودع الرئيسي');
  i1 := public.inv_create_item('GLV-001', 'Safety gloves', 'قفازات أمان', 'pair', 100, w1);
  i2 := public.inv_create_item('TAP-002', 'Packing tape', null, 'roll', 10, w1);
  reset role;

  select on_hand, reserved into oh, rs from public.inv_stock_balances where org_id = oa and item_id = i1 and warehouse_id = w1;
  if oh <> 100 or rs <> 0 then raise exception 'FAIL S1a: opening balance is %/%, expected 100/0', oh, rs; end if;
  select count(*) into n from public.inv_stock_moves where org_id = oa and kind = 'receipt';
  if n <> 2 then raise exception 'FAIL S1b: expected 2 receipt rows, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action in ('inventory.warehouse.created', 'inventory.item.created', 'inventory.stock.received');
  if n <> 5 then raise exception 'FAIL S1c: expected 5 setup audit rows, found %', n; end if;

  -- ------------------------------------------------------------ S2: a viewer can read but not change anything
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_items;
  if n <> 2 then raise exception 'FAIL S2a: viewer sees % items, expected 2', n; end if;
  ok := false;
  begin perform public.inv_create_item('X-1', 'Nope'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2b: a viewer could create an item'; end if;
  ok := false;
  begin perform public.inv_submit_request(w1, 'viewer', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 1))); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2c: a viewer could submit a request'; end if;

  -- ------------------------------------------------------------ S3: requester submits; stock is reserved
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r1 := (public.inv_submit_request(w1, 'Dispatch to customer', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 30))) ->> 'id')::uuid;
  reset role;
  select number, status into nm, st from public.inv_requests where id = r1;
  if nm <> 'OUT-0001' or st <> 'submitted' then raise exception 'FAIL S3a: request is % %, expected OUT-0001 submitted', nm, st; end if;
  select reserved into rs from public.inv_stock_balances where org_id = oa and item_id = i1 and warehouse_id = w1;
  if rs <> 30 then raise exception 'FAIL S3b: reserved is %, expected 30', rs; end if;

  -- ------------------------------------------------------------ S4: cannot reserve more than is available (100 - 30 = 70)
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_submit_request(w1, 'too much', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 80))); exception when others then ok := (sqlerrm = 'INSUFFICIENT_AVAILABLE'); end;
  if not ok then raise exception 'FAIL S4a: a request for more than available was accepted'; end if;
  reset role;
  select reserved into rs from public.inv_stock_balances where org_id = oa and item_id = i1 and warehouse_id = w1;
  if rs <> 30 then raise exception 'FAIL S4b: the refused request changed the reservation to %', rs; end if;

  -- ------------------------------------------------------------ S5: no self-approval, and members cannot approve
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_decide_request(r1, 'approved'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S5a: a plain member could approve'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r2 := (public.inv_submit_request(w1, 'owner own request', jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 2))) ->> 'id')::uuid;
  ok := false;
  begin perform public.inv_decide_request(r2, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S5b: an owner approved their own request'; end if;
  perform public.inv_cancel_request(r2);
  reset role;

  -- ------------------------------------------------------------ S6: issue without approval is refused
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_post_issue(r1); exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S6a: stock was issued for a request that is not approved'; end if;
  ok := false;
  begin insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, request_id, posted_by) values (oa, i1, w1, -30, 'issue', r1, uc); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S6b: a signed-in user could write to the ledger directly'; end if;
  reset role;
  -- Even the database owner cannot skip the approval: the ledger trigger refuses an issue for a non-approved request.
  ok := false;
  begin insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, request_id, posted_by) values (oa, i1, w1, -30, 'issue', r1, uc); exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S6c: a direct ledger insert skipped the approval'; end if;
  select count(*) into n from public.inv_stock_moves where kind = 'issue' and org_id = oa;
  if n <> 0 then raise exception 'FAIL S6d: % issue rows exist before any approval', n; end if;

  -- ------------------------------------------------------------ S7: the data itself refuses an approval by the requester
  ok := false;
  begin update public.inv_requests set status = 'approved', decided_by = requester_id where id = r1; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL S7a: the table accepted a request approved by its own requester'; end if;
  ok := false;
  begin update public.inv_requests set status = 'issued' where id = r1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S7b: a request jumped from submitted to issued'; end if;

  -- ------------------------------------------------------------ S8: the manager approves
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(r1, 'approved', 'OK to ship');
  ok := false;
  begin perform public.inv_decide_request(r1, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S8a: a request could be decided twice'; end if;
  reset role;
  select status into st from public.inv_requests where id = r1;
  if st <> 'approved' then raise exception 'FAIL S8b: request is %, expected approved', st; end if;
  select count(*) into n from public.inv_approvals where request_id = r1 and decision = 'approved' and approver_id = ub and channel = 'app';
  if n <> 1 then raise exception 'FAIL S8c: expected one approval record, found %', n; end if;

  -- ------------------------------------------------------------ S9: issue moves the stock exactly once
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_post_issue(r1);
  ok := false;
  begin perform public.inv_post_issue(r1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S9a: a request could be issued twice'; end if;
  reset role;
  select on_hand, reserved into oh, rs from public.inv_stock_balances where org_id = oa and item_id = i1 and warehouse_id = w1;
  if oh <> 70 or rs <> 0 then raise exception 'FAIL S9b: balance is %/%, expected 70/0', oh, rs; end if;
  select count(*) into n from public.inv_stock_moves where request_id = r1 and kind = 'issue' and qty = -30;
  if n <> 1 then raise exception 'FAIL S9c: expected one issue row of -30, found %', n; end if;
  select status into st from public.inv_requests where id = r1;
  if st <> 'issued' then raise exception 'FAIL S9d: request is %, expected issued', st; end if;

  -- ------------------------------------------------------------ S10: rejecting releases the reservation and blocks the issue
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r3 := (public.inv_submit_request(w1, 'will be rejected', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10))) ->> 'id')::uuid;
  reset role;
  select reserved into rs from public.inv_stock_balances where org_id = oa and item_id = i1 and warehouse_id = w1;
  if rs <> 10 then raise exception 'FAIL S10a: reserved is %, expected 10', rs; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(r3, 'rejected', 'not needed');
  reset role;
  select reserved into rs from public.inv_stock_balances where org_id = oa and item_id = i1 and warehouse_id = w1;
  if rs <> 0 then raise exception 'FAIL S10b: reserved is % after rejection, expected 0', rs; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_post_issue(r3); exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S10c: a rejected request could be issued'; end if;
  reset role;

  -- ------------------------------------------------------------ S11: cancelling releases the reservation; roles are checked
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r4 := (public.inv_submit_request(w1, 'will be cancelled', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_cancel_request(r4); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S11a: a viewer could cancel a request'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_cancel_request(r4);
  ok := false;
  begin perform public.inv_cancel_request(r4); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S11b: a cancelled request could be cancelled again'; end if;
  reset role;
  select reserved into rs from public.inv_stock_balances where org_id = oa and item_id = i1 and warehouse_id = w1;
  if rs <> 0 then raise exception 'FAIL S11c: reserved is % after cancel, expected 0', rs; end if;

  -- ------------------------------------------------------------ S12: another organization sees and changes nothing of ours
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_items;
  if n <> 0 then raise exception 'FAIL S12a: org B sees % of org A items', n; end if;
  select count(*) into n from public.inv_requests;
  if n <> 0 then raise exception 'FAIL S12b: org B sees org A requests'; end if;
  select count(*) into n from public.inv_stock_moves;
  if n <> 0 then raise exception 'FAIL S12c: org B sees org A ledger rows'; end if;
  ok := false;
  begin perform public.inv_decide_request(r3, 'approved'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S12d: org B reached an org A request'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  ok := false;
  begin perform public.inv_decide_request(r3, 'approved'); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL S12e: org B user acted inside org A'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  wb := public.inv_create_warehouse('MAIN', 'B main');
  ib := public.inv_create_item('GLV-001', 'B gloves', null, 'pair', 5, wb);
  reset role;
  select count(*) into n from public.inv_items where org_id = oa;
  if n <> 2 then raise exception 'FAIL S12f: org A items changed to %', n; end if;

  -- ------------------------------------------------------------ S13: the module switch is enforced in the database
  update public.org_modules set disabled_at = now() where org_id = ob and module_key = 'inventory';
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_create_item('Z-9', 'blocked'); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL S13: an item was created while the module is off'; end if;
  reset role;

  -- ------------------------------------------------------------ S14: ledger and approvals are append-only, even for the owner
  ok := false;
  begin update public.inv_stock_moves set qty = qty * 2; exception when others then ok := (sqlerrm like 'inv_stock_moves is append-only%'); end;
  if not ok then raise exception 'FAIL S14a: ledger update was not refused'; end if;
  ok := false;
  begin delete from public.inv_stock_moves; exception when others then ok := (sqlerrm like 'inv_stock_moves is append-only%'); end;
  if not ok then raise exception 'FAIL S14b: ledger delete was not refused'; end if;
  ok := false;
  begin truncate public.inv_stock_moves; exception when others then ok := (sqlerrm like 'inv_stock_moves is append-only%'); end;
  if not ok then raise exception 'FAIL S14c: ledger truncate was not refused'; end if;
  ok := false;
  begin update public.inv_approvals set decision = 'rejected'; exception when others then ok := (sqlerrm like 'inv_approvals is append-only%'); end;
  if not ok then raise exception 'FAIL S14d: approval update was not refused'; end if;

  -- ------------------------------------------------------------ S15: every step is in the audit log, and the chains are clean
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.submitted';
  if n <> 4 then raise exception 'FAIL S15a: expected 4 submitted audit rows, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.approved' and channel = 'app';
  if n <> 1 then raise exception 'FAIL S15b: expected 1 approved audit row, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.rejected';
  if n <> 1 then raise exception 'FAIL S15c: expected 1 rejected audit row, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.stock.issued';
  if n <> 1 then raise exception 'FAIL S15d: expected 1 issued audit row, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.cancelled';
  if n <> 2 then raise exception 'FAIL S15e: expected 2 cancelled audit rows, found %', n; end if;
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S15f: audit chain of org A is broken'; end if;
  select count(*) into n from public.audit_verify(ob);
  if n <> 0 then raise exception 'FAIL S15g: audit chain of org B is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
