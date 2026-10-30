-- sql/tests/022_batches_expiry_storage.sql
-- Batches: first-expiry-first-out, quarantine and expired stock never issued, shortage refuses the whole issue, storage
-- mismatch refused, untracked items unaffected, backfill on switch-on, expiry report, roles, isolation, audit, and the
-- invariant that batch totals equal ledger balances. Always rolls back. Needs sql/001-026.

do $$
declare
  u uuid := gen_random_uuid();  -- owner
  m uuid := gen_random_uuid();  -- member
  x uuid := gen_random_uuid();  -- other organization
  o uuid; ob uuid; w uuid; wcold uuid; i uuid; plain uuid;
  cold uuid; amb uuid; ba uuid; bb uuid; bc uuid; rq uuid;
  n bigint; q numeric; ok boolean; s text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'bat-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'bat-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'bat-x@tests.invalid');
  o := public.bootstrap_organization('Batch Test A', 'batch-test-a', 'bat-o@tests.invalid');
  ob := public.bootstrap_organization('Batch Test B', 'batch-test-b', 'bat-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  wcold := public.inv_create_warehouse('COLD', 'Cold room');
  amb := public.inv_create_storage_condition('Ambient', 15, 25);
  cold := public.inv_create_storage_condition('Cold', 2, 8);
  perform public.inv_set_warehouse_storage(wcold, cold);
  perform public.inv_set_warehouse_storage(w, amb);
  i := public.inv_create_item('B-1', 'Batch item', null, 'kg', 5, w);       -- 5 on hand before tracking
  plain := public.inv_create_item('P-1', 'Plain item', null, 'piece', 10, w);

  -- S1: switching tracking on moves the existing 5 into UNBATCHED; the item needs ambient storage
  perform public.inv_set_item_batching(i, true, amb);
  reset role;
  select coalesce(sum(bb2.qty), 0) into q from public.inv_batch_balances bb2 join public.inv_batches b2 on b2.id = bb2.batch_id where b2.item_id = i and b2.batch_no = 'UNBATCHED';
  if q <> 5 then raise exception 'FAIL S1: backfill % (expected 5)', q; end if;

  -- S2: storage mismatch refused (ambient item into the cold room), match accepted; expired and bad input refused
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_receive_batch(i, wcold, 1, 'X', null, current_date + 30); exception when others then ok := (sqlerrm = 'STORAGE_MISMATCH'); end;
  if not ok then raise exception 'FAIL S2a: storage mismatch accepted'; end if;
  ok := false; begin perform public.inv_receive_batch(i, w, 1, 'OLD', null, current_date - 1); exception when others then ok := (sqlerrm = 'EXPIRED'); end;
  if not ok then raise exception 'FAIL S2b: already-expired batch accepted'; end if;
  ok := false; begin perform public.inv_receive_batch(plain, w, 1, 'N1', null, null); exception when others then ok := (sqlerrm = 'NOT_TRACKED'); end;
  if not ok then raise exception 'FAIL S2c: batch for an untracked item accepted'; end if;
  ba := public.inv_receive_batch(i, w, 10, 'LATE', null, current_date + 60);    -- expires later
  bb := public.inv_receive_batch(i, w, 10, 'SOON', null, current_date + 10);    -- expires sooner
  ok := false; begin perform public.inv_receive_batch(i, w, 1, 'SOON', null, current_date + 11); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S2d: same batch number with a different expiry accepted'; end if;
  perform public.inv_receive_batch(i, w, 5, 'SOON', null, current_date + 10);   -- same batch topped up
  reset role;
  select qty into q from public.inv_batch_balances where batch_id = bb and warehouse_id = w;
  if q <> 15 then raise exception 'FAIL S2e: SOON has % (expected 15)', q; end if;

  -- S3: FEFO. Issue 18: takes SOON 15, then LATE 3 (UNBATCHED last, untouched)
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rq := (public.inv_submit_request(w, 'fefo', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 18))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  select qty into q from public.inv_batch_balances where batch_id = bb and warehouse_id = w; if q <> 0 then raise exception 'FAIL S3a: SOON left % (expected 0)', q; end if;
  select qty into q from public.inv_batch_balances where batch_id = ba and warehouse_id = w; if q <> 7 then raise exception 'FAIL S3b: LATE left % (expected 7)', q; end if;
  select coalesce(sum(bb2.qty), 0) into q from public.inv_batch_balances bb2 join public.inv_batches b2 on b2.id = bb2.batch_id where b2.item_id = i and b2.batch_no = 'UNBATCHED'; if q <> 5 then raise exception 'FAIL S3c: UNBATCHED touched (%)', q; end if;

  -- S4: quarantine LATE: only UNBATCHED (5) is issuable, so an issue of 6 is refused as a whole; owner only
  set local role authenticated;
  ok := false; begin perform public.inv_set_batch_status(ba, 'quarantined'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S4a: a member quarantined a batch'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_set_batch_status(ba, 'quarantined', 'QC hold'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rq := (public.inv_submit_request(w, 'too much', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 6))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_post_issue(rq); exception when others then ok := (sqlerrm = 'BATCH_STOCK_SHORT'); end;
  reset role;
  if not ok then raise exception 'FAIL S4b: issue went through although the batch is quarantined'; end if;
  select status into s from public.inv_requests where id = rq; if s <> 'approved' then raise exception 'FAIL S4c: request is % after a refused issue', s; end if;
  select count(*) into n from public.inv_stock_moves where request_id = rq; if n <> 0 then raise exception 'FAIL S4d: a ledger row was left behind'; end if;

  -- S5: expired stock is not issued either (LATE released, then its expiry moves into the past)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_set_batch_status(ba, 'available'); reset role;
  update public.inv_batches set expiry_date = current_date - 1 where id = ba;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_post_issue(rq); exception when others then ok := (sqlerrm = 'BATCH_STOCK_SHORT'); end;
  reset role;
  if not ok then raise exception 'FAIL S5: expired stock was issued'; end if;

  -- S6: expiry report lists LATE (expired, -1 days) and not UNBATCHED; filters by window
  update public.inv_batches set expiry_date = current_date + 20 where id = ba;
  perform public.inv_receive_batch(i, w, 1, 'FAR', null, null) where false;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_expiry_report(30);  if n <> 1 then raise exception 'FAIL S6a: report(30) has % rows (expected 1)', n; end if;
  select count(*) into n from public.inv_expiry_report(10);  if n <> 0 then raise exception 'FAIL S6b: report(10) has % rows (expected 0)', n; end if;
  reset role;

  -- S7: untracked item works exactly as before and has no batches
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rq := (public.inv_submit_request(w, 'plain', jsonb_build_array(jsonb_build_object('itemId', plain, 'qty', 4))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  select count(*) into n from public.inv_batches where item_id = plain; if n <> 0 then raise exception 'FAIL S7: untracked item got batches'; end if;

  -- S8: invariant: batch totals equal the ledger balance for the tracked item
  select coalesce(sum(on_hand), 0) into q from public.inv_stock_balances where item_id = i;
  select coalesce(sum(bb2.qty), 0) into n from public.inv_batch_balances bb2 join public.inv_batches b2 on b2.id = bb2.batch_id where b2.item_id = i;
  if q <> n then raise exception 'FAIL S8a: ledger % but batches % ', q, n; end if;

  -- S9: tracking cannot be switched off while batch stock exists; no direct writes; isolation; audit chain
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_set_item_batching(i, false); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S9a: tracking switched off with stock in batches'; end if;
  ok := false; begin update public.inv_batches set status = 'available' where id = ba; get diagnostics n = row_count; ok := (n = 0); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9b: direct batch update worked'; end if;
  ok := false; begin delete from public.inv_batch_moves; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9c: direct batch-move delete worked'; end if;
  reset role;
  ok := false; begin update public.inv_batch_moves set qty = 0; exception when others then ok := (sqlerrm = 'APPEND_ONLY'); end;
  if not ok then raise exception 'FAIL S9d: batch moves are not append-only'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_batches; if n <> 0 then raise exception 'FAIL S9e: cross-organization batches visible'; end if;
  ok := false; begin perform public.inv_set_batch_status(ba, 'quarantined'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S9f: another organization changed our batch'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action like 'inventory.batch.%'; if n < 4 then raise exception 'FAIL S9g: batch audit entries %', n; end if;
  select count(*) into n from public.audit_verify(o); if n <> 0 then raise exception 'FAIL S9h: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
