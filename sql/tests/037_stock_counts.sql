-- sql/tests/037_stock_counts.sql
-- S3 (SUPERFIX_WORKFLOW_PLAN): stock count sessions. Always rolls back. Needs sql/001-042.
-- Covers: the expected quantity is a snapshot; uncounted lines block submit; the person who started or submitted cannot approve;
-- a member cannot approve; difference = counted - snapshot is applied to current stock even after a receipt during the count;
-- the ledger refuses a count move unless the count is approved; reserved stock is protected; rejection leaves stock alone;
-- audit rows per move; lines frozen after submit; cancel rules; isolation of both tables; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A (approver)
  a uuid := gen_random_uuid();  -- admin, org A
  m uuid := gen_random_uuid();  -- member, org A (counter)
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; i3 uuid; cnt uuid; cnt2 uuid; cnt3 uuid; j jsonb;
  n bigint; q numeric; ok boolean; s text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sc-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'sc-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'sc-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'sc-x@tests.invalid');
  o := public.bootstrap_organization('Count Test A', 'count-test-a', 'sc-o@tests.invalid');
  ob := public.bootstrap_organization('Count Test B', 'count-test-b', 'sc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('SC-1', 'Counted one', null, 'piece', 100, w);
  i2 := public.inv_create_item('SC-2', 'Counted two', null, 'piece', 40, w);
  i3 := public.inv_create_item('SC-3', 'Not in this warehouse', null, 'piece', 0, null);

  -- ---- T1: start a count as a member; snapshot of every item with stock in the warehouse
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  j := public.inv_start_count(w, null, 'Month-end count');
  cnt := (j ->> 'id')::uuid;
  if (j ->> 'number') <> 'CNT-0001' or (j ->> 'lines')::int <> 2 then raise exception 'FAIL T1a: start returned %', j; end if;
  reset role;
  select expected_qty into q from public.inv_count_lines where count_id = cnt and item_id = i1;
  if q <> 100 then raise exception 'FAIL T1b: snapshot for SC-1 is %, expected 100', q; end if;
  select count(*) into n from public.inv_count_lines where count_id = cnt and item_id = i3;
  if n <> 0 then raise exception 'FAIL T1c: an item without stock in the warehouse was added'; end if;

  -- ---- T2: enter counts; uncounted lines block submit
  set local role authenticated;
  perform public.inv_set_count_line(cnt, i1, 90);   -- 10 missing
  ok := false; begin perform public.inv_submit_count(cnt); exception when others then ok := (sqlerrm = 'COUNT_INCOMPLETE'); end;
  if not ok then raise exception 'FAIL T2a: a count with an uncounted line was submitted'; end if;
  ok := false; begin perform public.inv_set_count_line(cnt, i2, -1); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T2b: a negative count was accepted'; end if;
  perform public.inv_set_count_line(cnt, i2, 40);   -- matches

  -- ---- T3: a receipt of 5 during the count; the snapshot does not change
  perform public.inv_receive_stock(i1, w, 5, 'delivery during count');
  reset role;
  select expected_qty into q from public.inv_count_lines where count_id = cnt and item_id = i1;
  if q <> 100 then raise exception 'FAIL T3a: the snapshot moved to % after a receipt', q; end if;

  -- ---- T4: the ledger refuses a count move before approval (direct write as the table owner; the guard still runs)
  ok := false;
  begin
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, count_id, ref, posted_by)
    values (o, i1, w, -10, 'adjust', cnt, 'CNT-0001', m);
  exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED');
  end;
  if not ok then raise exception 'FAIL T4a: a count move was posted without approval'; end if;

  -- ---- T5: submit; lines are then frozen
  set local role authenticated;
  j := public.inv_submit_count(cnt);
  if (j ->> 'differences')::int <> 1 then raise exception 'FAIL T5a: % differences, expected 1', j ->> 'differences'; end if;
  ok := false; begin perform public.inv_set_count_line(cnt, i1, 95); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T5b: a line was changed after submit'; end if;

  -- ---- T6: who may decide
  ok := false; begin perform public.inv_decide_count(cnt, 'approved'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T6a: a member approved a count'; end if;
  reset role;
  update public.memberships set role = 'admin' where org_id = o and user_id = m;   -- even as an admin, the counter cannot approve
  set local role authenticated;
  ok := false; begin perform public.inv_decide_count(cnt, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL T6b: the person who started and submitted approved their own count'; end if;
  reset role;
  update public.memberships set role = 'member' where org_id = o and user_id = m;

  -- ---- T7: the owner approves: one move of -10 (counted 90 - snapshot 100) on top of 105 = 95
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  j := public.inv_decide_count(cnt, 'approved', 'ok');
  if (j ->> 'moves')::int <> 1 or (j ->> 'status') <> 'applied' then raise exception 'FAIL T7a: decide returned %', j; end if;
  reset role;
  select on_hand into q from public.inv_stock_balances where org_id = o and item_id = i1 and warehouse_id = w;
  if q <> 95 then raise exception 'FAIL T7b: SC-1 on hand is %, expected 95 (100 + 5 received - 10 missing)', q; end if;
  select sum(qty) into q from public.inv_stock_moves where org_id = o and count_id = cnt;
  if q <> -10 then raise exception 'FAIL T7c: count moves total %, expected -10', q; end if;
  select sum(qty) into q from public.inv_stock_moves where org_id = o and item_id = i1 and warehouse_id = w;
  if q <> 95 then raise exception 'FAIL T7d: ledger total for SC-1 is %, expected 95 (ledger and balance agree)', q; end if;
  select count(*) into n from public.audit_log where org_id = o and entity_id = cnt::text and action = 'inventory.count.line_posted';
  if n <> 1 then raise exception 'FAIL T7e: % audit row(s) for posted lines, expected 1', n; end if;
  select count(*) into n from public.audit_log where org_id = o and entity_id = cnt::text
     and action in ('inventory.count.started', 'inventory.count.submitted', 'inventory.count.applied');
  if n <> 3 then raise exception 'FAIL T7f: % lifecycle audit row(s), expected 3', n; end if;
  select status into s from public.inv_counts where id = cnt;
  if s <> 'applied' then raise exception 'FAIL T7g: status %', s; end if;
  ok := false; begin update public.inv_counts set status = 'counting' where id = cnt; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T7h: an applied count went back to counting'; end if;

  -- ---- T8: reserved stock is protected; rejection leaves stock alone
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_submit_request(w, 'reserve some', jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 30)));   -- reserves 30 of 40
  cnt2 := (public.inv_start_count(w, array[i2], null) ->> 'id')::uuid;
  perform public.inv_set_count_line(cnt2, i2, 10);   -- below the 30 reserved
  perform public.inv_submit_count(cnt2);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_decide_count(cnt2, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T8a: a count took stock below the reserved quantity'; end if;
  j := public.inv_decide_count(cnt2, 'rejected', 'recount');
  reset role;
  select on_hand into q from public.inv_stock_balances where org_id = o and item_id = i2 and warehouse_id = w;
  if q <> 40 then raise exception 'FAIL T8b: a rejected count changed stock to %', q; end if;
  select count(*) into n from public.inv_stock_moves where count_id = cnt2;
  if n <> 0 then raise exception 'FAIL T8c: a rejected count wrote % move(s)', n; end if;

  -- ---- T9: cancel rules
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cnt3 := (public.inv_start_count(w, array[i1], null) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_cancel_count(cnt3); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T9a: a member cancelled someone else''s count'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.inv_cancel_count(cnt3, 'wrong shelf');
  ok := false; begin perform public.inv_set_count_line(cnt3, i1, 1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T9b: a cancelled count accepted a line'; end if;

  -- ---- T10: isolation: org B sees no count rows and cannot act on A's count
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  select count(*) into n from public.inv_counts;
  if n <> 0 then raise exception 'FAIL T10a: org B sees % count(s)', n; end if;
  select count(*) into n from public.inv_count_lines;
  if n <> 0 then raise exception 'FAIL T10b: org B sees % count line(s)', n; end if;
  ok := false; begin perform public.inv_cancel_count(cnt3); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T10c: org B reached org A''s count'; end if;
  ok := false; begin insert into public.inv_counts (org_id, number, warehouse_id, requester_id) values (ob, 'CNT-X', w, x); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL T10d: a user inserted a count directly'; end if;
  ok := false; begin update public.inv_count_lines set counted_qty = 1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL T10e: a user updated count lines directly'; end if;

  -- ---- T11: no anonymous use
  reset role;
  if has_function_privilege('anon', 'public.inv_start_count(uuid, uuid[], text)', 'execute') then raise exception 'FAIL T11a: anonymous can start a count'; end if;
  if has_function_privilege('anon', 'public.inv_decide_count(uuid, text, text, text)', 'execute') then raise exception 'FAIL T11b: anonymous can decide a count'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
