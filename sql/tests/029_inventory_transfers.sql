-- sql/tests/029_inventory_transfers.sql
-- Stock transfers between warehouses, with approval. Always rolls back. Needs sql/001-033.
-- Covers: who may request / approve / dispatch / receive, the ledger refusing movement without approval, stock in transit,
-- reservation released on reject and cancel, batches and expiry travelling with the goods, quarantined batches never moving,
-- storage-condition refusal, multi-approval policy, another organization seeing nothing, append-only records, the audit chain.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner
  ub uuid := gen_random_uuid();  -- admin
  ug uuid := gen_random_uuid();  -- second admin (for the two-approval policy)
  uc uuid := gen_random_uuid();  -- member (requests, dispatches, receives)
  ud uuid := gen_random_uuid();  -- viewer
  ue uuid := gen_random_uuid();  -- owner, other organization
  uf uuid := gen_random_uuid();  -- second member (not the requester)
  oa uuid; ob uuid;
  w1 uuid; w2 uuid; w3 uuid; wb uuid;
  i1 uuid; i2 uuid; i3 uuid;
  c_cold uuid; c_amb uuid;
  b1 uuid; b2 uuid;
  j jsonb;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid;
  n bigint; oh numeric; rs numeric; q numeric; ex date;
  st text; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'tr-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'tr-b@tests.invalid'),
    (ug, 'authenticated', 'authenticated', 'tr-g@tests.invalid'), (uc, 'authenticated', 'authenticated', 'tr-c@tests.invalid'),
    (ud, 'authenticated', 'authenticated', 'tr-d@tests.invalid'), (ue, 'authenticated', 'authenticated', 'tr-e@tests.invalid'),
    (uf, 'authenticated', 'authenticated', 'tr-f@tests.invalid');
  oa := public.bootstrap_organization('Transfer Test A', 'tr-test-a', 'tr-a@tests.invalid');
  ob := public.bootstrap_organization('Transfer Test B', 'tr-test-b', 'tr-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, ug, 'admin'), (oa, uc, 'member'), (oa, ud, 'viewer'), (oa, uf, 'member');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (oa, 'messaging'), (ob, 'inventory');

  -- ---- setup as the owner: three warehouses, a plain item, a batch-tracked item, a cold-storage item
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main');
  w2 := public.inv_create_warehouse('BRANCH', 'Branch');
  w3 := public.inv_create_warehouse('AMB', 'Ambient room');
  i1 := public.inv_create_item('GLV', 'Gloves', null, 'pair', 100, w1);
  i2 := public.inv_create_item('TUB', 'Tubes', null, 'piece', 0, w1);
  perform public.inv_set_item_batching(i2, true, null);
  b1 := public.inv_receive_batch(i2, w1, 30, 'EARLY', null, current_date + 20);
  b2 := public.inv_receive_batch(i2, w1, 50, 'LATE', null, current_date + 200);
  c_cold := public.inv_create_storage_condition('Cold', 2, 8);
  c_amb := public.inv_create_storage_condition('Ambient', 15, 25);
  perform public.inv_set_warehouse_storage(w3, c_amb);
  i3 := public.inv_create_item('SER', 'Serum', null, 'piece', 20, w1);
  perform public.inv_set_item_batching(i3, true, c_cold);
  reset role;

  -- ---- S1: requesting a transfer
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.inv_submit_transfer(w1, w2, 'Restock the branch', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 30)));
  t1 := (j ->> 'id')::uuid;
  if j ->> 'number' <> 'TR-000001' then raise exception 'FAIL S1a: first transfer is %, expected TR-000001', j ->> 'number'; end if;
  reset role;
  select b.on_hand, b.reserved into oh, rs from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  if oh <> 100 or rs <> 30 then raise exception 'FAIL S1b: after request on hand % reserved %, expected 100 and 30', oh, rs; end if;
  set local role authenticated;
  ok := false; begin perform public.inv_submit_transfer(w1, w1, 'same', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1c: a transfer to the same warehouse was accepted'; end if;
  ok := false; begin perform public.inv_submit_transfer(w1, w2, 'none', '[]'::jsonb); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1d: a transfer with no lines was accepted'; end if;
  ok := false; begin perform public.inv_submit_transfer(w1, w2, 'zero', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 0))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1e: a zero quantity was accepted'; end if;
  ok := false; begin perform public.inv_submit_transfer(w1, w2, 'too much', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 80))); exception when others then ok := (sqlerrm = 'INSUFFICIENT_AVAILABLE'); end;
  if not ok then raise exception 'FAIL S1f: asking for more than the available quantity (100 - 30 reserved) was accepted'; end if;
  ok := false; begin perform public.inv_submit_transfer(w1, w2, 'ghost', jsonb_build_array(jsonb_build_object('itemId', gen_random_uuid(), 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1g: an unknown item was accepted'; end if;
  reset role;
  select count(*) into n from public.inv_transfers where org_id = oa;
  if n <> 1 then raise exception 'FAIL S1h: refused requests left % rows behind, expected 1', n; end if;

  -- a viewer cannot request
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_submit_transfer(w1, w2, 'viewer', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 1))); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S1i: a viewer could request a transfer'; end if;
  reset role;

  -- ---- S2: the approval blocks the movement, in the data
  ok := false;
  begin
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, transfer_id, posted_by) values (oa, i1, w1, -30, 'transfer_out', t1, uc);
  exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S2a: a transfer_out movement was accepted for a transfer that is not approved'; end if;
  ok := false;
  begin
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, transfer_id, posted_by) values (oa, i1, w2, 30, 'transfer_in', t1, uc);
  exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S2b: a transfer_in movement was accepted for a transfer that was never dispatched'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, transfer_id, posted_by) values (oa, i1, w1, -30, 'transfer_out', t1, uc);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S2c: a signed-in user could insert into the stock ledger directly'; end if;
  -- a member cannot approve
  ok := false; begin perform public.inv_decide_transfer(t1, 'approved'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2d: a member could approve a transfer'; end if;
  reset role;

  -- the requester cannot approve their own, even as an admin
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.inv_submit_transfer(w1, w2, 'admin own', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 1)));
  t2 := (j ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_transfer(t2, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S2e: a requester approved their own transfer'; end if;
  -- the other admin approves T1
  perform public.inv_decide_transfer(t1, 'approved', 'ok');
  reset role;
  select status into st from public.inv_transfers where id = t1;
  if st <> 'approved' then raise exception 'FAIL S2f: T1 is %, expected approved', st; end if;
  -- dispatch of an unapproved transfer, and receive of an undispatched one
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_dispatch_transfer(t2); exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S2g: an unapproved transfer was dispatched'; end if;
  ok := false; begin perform public.inv_receive_transfer(t1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S2h: a transfer that was not dispatched could be received'; end if;
  reset role;

  -- ---- S3: dispatch puts stock in transit; receive lands it
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_dispatch_transfer(t1);
  select s.qty, s.transfers into q, n from public.inv_in_transit() s where s.item_id = i1;
  if q <> 30 or n <> 1 then raise exception 'FAIL S3a: in transit shows % in % transfers, expected 30 in 1', q, n; end if;
  reset role;
  select b.on_hand, b.reserved into oh, rs from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  -- reserved is 1, not 0: transfer T2 (the admin's own request for 1 unit, made in S2) is still open and holds 1
  if oh <> 70 or rs <> 1 then raise exception 'FAIL S3b: source on hand % reserved %, expected 70 and 1 (T2 still open)', oh, rs; end if;
  select count(*) into n from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w2;
  if n <> 0 then raise exception 'FAIL S3c: destination had stock before receipt'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_receive_transfer(t1); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S3d: a viewer could receive a transfer'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_cancel_transfer(t1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S3e: a dispatched transfer could be cancelled'; end if;
  perform public.inv_receive_transfer(t1);
  ok := false; begin perform public.inv_receive_transfer(t1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S3f: a transfer was received twice'; end if;
  select count(*) into n from public.inv_in_transit() s where s.item_id = i1;
  if n <> 0 then raise exception 'FAIL S3g: in transit still shows stock after receipt'; end if;
  reset role;
  select b.on_hand into oh from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w2;
  select b.on_hand into q from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  if oh <> 30 or q <> 70 then raise exception 'FAIL S3h: destination % source %, expected 30 and 70', oh, q; end if;
  select count(*) into n from public.inv_stock_moves where org_id = oa and transfer_id = t1 and kind = 'transfer_out' and qty = -30;
  if n <> 1 then raise exception 'FAIL S3i: expected one transfer_out of -30'; end if;
  select count(*) into n from public.inv_stock_moves where org_id = oa and transfer_id = t1 and kind = 'transfer_in' and qty = 30;
  if n <> 1 then raise exception 'FAIL S3j: expected one transfer_in of +30'; end if;
  select count(*) into n from public.audit_log where org_id = oa and entity_type = 'stock_transfer' and entity_id = t1::text;
  if n <> 4 then raise exception 'FAIL S3k: expected 4 audit rows for T1 (submitted, approved, dispatched, received), got %', n; end if;

  -- ---- S4: reject and cancel release the reservation
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.inv_submit_transfer(w1, w2, 'to reject', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10)));
  t3 := (j ->> 'id')::uuid;
  j := public.inv_submit_transfer(w1, w2, 'to cancel', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 5)));
  t4 := (j ->> 'id')::uuid;
  reset role;
  select b.reserved into rs from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  if rs <> 15 + 1 then raise exception 'FAIL S4a: reserved % with three open transfers (10 + 5 + the 1 of T2), expected 16', rs; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_transfer(t3, 'rejected', 'not now');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_cancel_transfer(t4); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S4b: someone who is not the requester or an admin cancelled a transfer'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_cancel_transfer(t4);
  reset role;
  select b.reserved into rs from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  if rs <> 1 then raise exception 'FAIL S4c: reserved % after reject and cancel, expected 1 (T2 only)', rs; end if;
  select status into st from public.inv_transfers where id = t3;
  if st <> 'rejected' then raise exception 'FAIL S4d: T3 is %', st; end if;
  select count(*) into n from public.inv_stock_moves where org_id = oa and transfer_id in (t3, t4);
  if n <> 0 then raise exception 'FAIL S4e: a rejected or cancelled transfer moved stock'; end if;

  -- ---- S5: batches and expiry travel with the goods; first expiry first out
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.inv_submit_transfer(w1, w2, 'tubes', jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 40)));
  t5 := (j ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_transfer(t5, 'approved');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_dispatch_transfer(t5);
  reset role;
  select tb.qty into q from public.inv_transfer_batches tb where tb.transfer_id = t5 and tb.batch_id = b1;
  if q is distinct from 30 then raise exception 'FAIL S5a: expected 30 taken from the early-expiry batch, got %', q; end if;
  select tb.qty into q from public.inv_transfer_batches tb where tb.transfer_id = t5 and tb.batch_id = b2;
  if q is distinct from 10 then raise exception 'FAIL S5b: expected 10 taken from the late-expiry batch, got %', q; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_receive_transfer(t5);
  reset role;
  select bb.qty into q from public.inv_batch_balances bb where bb.org_id = oa and bb.batch_id = b1 and bb.warehouse_id = w2;
  if q is distinct from 30 then raise exception 'FAIL S5c: early batch at destination is %, expected 30', q; end if;
  select bb.qty into q from public.inv_batch_balances bb where bb.org_id = oa and bb.batch_id = b2 and bb.warehouse_id = w2;
  if q is distinct from 10 then raise exception 'FAIL S5d: late batch at destination is %, expected 10', q; end if;
  select bb.qty into q from public.inv_batch_balances bb where bb.org_id = oa and bb.batch_id = b2 and bb.warehouse_id = w1;
  if q is distinct from 40 then raise exception 'FAIL S5e: late batch left at source is %, expected 40', q; end if;
  select b.expiry_date into ex from public.inv_batches b where b.id = b1;
  if ex <> current_date + 20 then raise exception 'FAIL S5f: the early batch lost its expiry date'; end if;
  select b.on_hand into oh from public.inv_stock_balances b where b.org_id = oa and b.item_id = i2 and b.warehouse_id = w2;
  if oh <> 40 then raise exception 'FAIL S5g: destination balance for the batch-tracked item is %, expected 40', oh; end if;

  -- a quarantined batch is never moved: dispatch fails as a whole and the transfer stays approved
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.inv_submit_transfer(w1, w2, 'more tubes', jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 20)));
  t6 := (j ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_transfer(t6, 'approved');
  perform public.inv_set_batch_status(b2, 'quarantined', 'test');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_dispatch_transfer(t6); exception when others then ok := (sqlerrm = 'BATCH_STOCK_SHORT'); end;
  if not ok then raise exception 'FAIL S5h: a quarantined batch was dispatched'; end if;
  reset role;
  select status into st from public.inv_transfers where id = t6;
  if st <> 'approved' then raise exception 'FAIL S5i: T6 is % after a failed dispatch, expected approved', st; end if;
  select b.on_hand into oh from public.inv_stock_balances b where b.org_id = oa and b.item_id = i2 and b.warehouse_id = w1;
  if oh <> 40 then raise exception 'FAIL S5j: source on hand % after a failed dispatch, expected 40', oh; end if;

  -- ---- S6: storage condition (cold item to an ambient warehouse)
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_submit_transfer(w1, w3, 'cold to ambient', jsonb_build_array(jsonb_build_object('itemId', i3, 'qty', 5))); exception when others then ok := (sqlerrm = 'STORAGE_MISMATCH'); end;
  if not ok then raise exception 'FAIL S6a: a cold item was transferred to an ambient warehouse'; end if;
  reset role;
  select b.reserved into rs from public.inv_stock_balances b where b.org_id = oa and b.item_id = i3 and b.warehouse_id = w1;
  if rs <> 0 then raise exception 'FAIL S6b: a refused transfer left % reserved', rs; end if;

  -- ---- S7: another organization sees and touches nothing
  wb := null;
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_transfers;
  if n <> 0 then raise exception 'FAIL S7a: another organization can read % transfers', n; end if;
  select count(*) into n from public.inv_transfer_lines;
  if n <> 0 then raise exception 'FAIL S7b: another organization can read transfer lines'; end if;
  select count(*) into n from public.inv_transfer_batches;
  if n <> 0 then raise exception 'FAIL S7c: another organization can read transfer batches'; end if;
  select count(*) into n from public.inv_transfer_approvals;
  if n <> 0 then raise exception 'FAIL S7d: another organization can read transfer approvals'; end if;
  ok := false; begin perform public.inv_decide_transfer(t2, 'approved'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S7e: another organization reached a transfer (decide)'; end if;
  ok := false; begin perform public.inv_dispatch_transfer(t6); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S7f: another organization reached a transfer (dispatch)'; end if;
  ok := false; begin perform public.inv_receive_transfer(t1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S7g: another organization reached a transfer (receive)'; end if;
  ok := false; begin perform public.inv_cancel_transfer(t2); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S7h: another organization reached a transfer (cancel)'; end if;
  ok := false; begin update public.inv_transfers set status = 'received'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S7i: direct update of transfers was allowed'; end if;
  select count(*) into n from public.inv_in_transit();
  if n <> 0 then raise exception 'FAIL S7j: another organization sees stock in transit'; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);

  -- ---- S8: append-only records and the status order
  ok := false; begin update public.inv_transfer_approvals set comment = 'edited'; exception when others then ok := (sqlerrm like '%append-only%'); end;
  if not ok then raise exception 'FAIL S8a: an approval record was edited'; end if;
  ok := false; begin delete from public.inv_transfer_batches; exception when others then ok := (sqlerrm like '%append-only%'); end;
  if not ok then raise exception 'FAIL S8b: a batch record was deleted'; end if;
  ok := false; begin update public.inv_stock_moves set qty = qty; exception when others then ok := (sqlerrm like '%append-only%'); end;
  if not ok then raise exception 'FAIL S8c: the stock ledger was edited'; end if;
  ok := false; begin update public.inv_transfers set status = 'received' where id = t2; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S8d: a transfer skipped from submitted to received'; end if;

  -- ---- S9: a two-approval policy needs two different people (run last: it changes the policy for the whole warehouse)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_set_approval_policy(w1, 0, 2);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.inv_submit_transfer(w1, w2, 'two approvals', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 2)));
  t8 := (j ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_transfer(t8, 'approved');
  reset role;
  select status into st from public.inv_transfers where id = t8;
  if st <> 'submitted' then raise exception 'FAIL S9a: one approval of two made the transfer %, expected submitted', st; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_decide_transfer(t8, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S9b: the same person approved twice'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ug, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_transfer(t8, 'approved');
  reset role;
  select status into st from public.inv_transfers where id = t8;
  if st <> 'approved' then raise exception 'FAIL S9c: two approvals did not approve the transfer (%)', st; end if;
  select count(*) into n from public.inv_transfer_approvals where transfer_id = t8 and decision = 'approved';
  if n <> 2 then raise exception 'FAIL S9d: expected 2 approval records, got %', n; end if;

  -- ---- S10: the audit chain is intact
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S10: the audit chain is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
