-- sql/tests/038_customer_returns.sql
-- S4 (SUPERFIX_WORKFLOW_PLAN): customer returns through a credit note. Always rolls back. Needs sql/001-043.
-- Covers: stock does not move until the note is approved; the approver is never the requester (sql/037); returned goods come back at
-- the ORIGINAL issue cost, not today's average; the average cost is recomputed and logged as a customer return; returns are limited to
-- what was delivered minus what is already returned or waiting; a return above the credited quantity is refused; rejection posts
-- nothing; the ledger refuses a return move without an approved note; audit per move; isolation; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A (approver)
  m uuid := gen_random_uuid();  -- member, org A (requester)
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid; il uuid; inv uuid; n1 uuid; n2 uuid; n3 uuid;
  n bigint; q numeric; v bigint; ok boolean; j jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'rt-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'rt-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'rt-x@tests.invalid');
  o := public.bootstrap_organization('Return Test A', 'return-test-a', 'rt-o@tests.invalid');
  ob := public.bootstrap_organization('Return Test B', 'return-test-b', 'rt-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('RT-1', 'Returned item', null, 'piece', 50, w);
  perform public.inv_set_item_cost(i, 300);            -- issued at 300
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  rq := (public.sal_request_stock(so) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.inv_decide_request(rq, 'approved');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.inv_post_issue(rq);                    -- 50 - 10 = 40 on hand
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  reset role; select id into ol from public.sal_order_lines where order_id = so; set local role authenticated;
  inv := (public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 10))) ->> 'id')::uuid;
  perform public.inv_set_item_cost(i, 500);            -- today's average differs from the issue cost
  reset role; select id into il from public.sal_invoice_lines where invoice_id = inv; set local role authenticated;

  -- ---- T1: validation
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_submit_return_note(inv, 'damaged', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 2, 'returnQty', 3, 'warehouseId', w))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1a: a return above the credited quantity was accepted'; end if;
  ok := false; begin perform public.sal_submit_return_note(inv, 'damaged', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 2, 'returnQty', 2))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1b: a return without a warehouse was accepted'; end if;
  ok := false; begin perform public.sal_submit_return_note(inv, 'price only', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 2, 'returnQty', 0, 'warehouseId', w))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1c: a return note that returns nothing was accepted'; end if;

  -- ---- T2: a return of 4 is requested; stock does not move yet
  j := public.sal_submit_return_note(inv, 'damaged in transit', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 4, 'returnQty', 4, 'warehouseId', w)));
  n1 := (j ->> 'id')::uuid;
  if (j ->> 'returnLines')::int <> 1 then raise exception 'FAIL T2a: submit returned %', j; end if;
  reset role;
  select on_hand into q from public.inv_stock_balances where org_id = o and item_id = i and warehouse_id = w;
  if q <> 40 then raise exception 'FAIL T2b: stock is % before approval, expected 40', q; end if;

  -- ---- T3: the ledger refuses a return move while the note is waiting
  ok := false;
  begin
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, note_id, ref, posted_by, unit_cost_minor) values (o, i, w, 4, 'return_in', n1, 'x', m, 300);
  exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED');
  end;
  if not ok then raise exception 'FAIL T3a: a return move was posted without an approved note'; end if;

  -- ---- T4: a waiting return counts towards the limit: 4 waiting, so 7 more (11 > 10 delivered) is refused
  set local role authenticated;
  ok := false; begin perform public.sal_submit_return_note(inv, 'more', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 7, 'returnQty', 7, 'warehouseId', w))); exception when others then ok := (sqlerrm in ('RETURN_EXCEEDS_ISSUED', 'NOTE_EXCEEDS_INVOICE')); end;
  if not ok then raise exception 'FAIL T4a: a return beyond delivered minus waiting was accepted'; end if;

  -- ---- T5: the requester cannot approve; the owner approves; stock comes back at the issue cost
  ok := false; begin perform public.sal_decide_note(n1, 'approved'); exception when others then ok := (sqlerrm in ('FORBIDDEN', 'SELF_APPROVAL')); end;
  if not ok then raise exception 'FAIL T5a: the requester approved their own return'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.sal_decide_note(n1, 'approved', 'ok');
  reset role;
  select on_hand into q from public.inv_stock_balances where org_id = o and item_id = i and warehouse_id = w;
  if q <> 44 then raise exception 'FAIL T5b: stock is % after approval, expected 44', q; end if;
  select unit_cost_minor into v from public.inv_stock_moves where org_id = o and note_id = n1 and kind = 'return_in';
  if v <> 300 then raise exception 'FAIL T5c: returned at unit cost %, expected the issue cost 300', v; end if;
  -- average: (40 x 500 + 4 x 300) / 44 = 481.8 -> 482
  select avg_cost_minor into v from public.inv_items where id = i;
  if v <> 482 then raise exception 'FAIL T5d: average cost is %, expected 482', v; end if;
  select count(*) into n from public.inv_cost_log where org_id = o and item_id = i and source = 'customer_return' and ref = (select number from public.sal_notes where id = n1);
  if n <> 1 then raise exception 'FAIL T5e: % cost log row(s) for the return, expected 1', n; end if;
  select count(*) into n from public.audit_log where org_id = o and entity_id = n1::text and action = 'inventory.stock.returned';
  if n <> 1 then raise exception 'FAIL T5f: % audit row(s) for the returned stock, expected 1', n; end if;
  select sum(qty) into q from public.inv_stock_moves where org_id = o and item_id = i and warehouse_id = w;
  if q <> 44 then raise exception 'FAIL T5g: ledger total is %, expected 44 (ledger and balance agree)', q; end if;

  -- ---- T6: limit after approval: 4 returned, 7 more > 10 delivered (credit allows 6, so ask 6 credit and return 6 then 1 more)
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n2 := (public.sal_submit_return_note(inv, 'rest', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 6, 'returnQty', 6, 'warehouseId', w))) ->> 'id')::uuid;
  ok := false; begin perform public.sal_submit_return_note(inv, 'too many', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 1, 'returnQty', 1, 'warehouseId', w))); exception when others then ok := (sqlerrm in ('RETURN_EXCEEDS_ISSUED', 'NOTE_EXCEEDS_INVOICE')); end;
  if not ok then raise exception 'FAIL T6a: an eleventh unit could be returned'; end if;

  -- ---- T7: rejection posts nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.sal_decide_note(n2, 'rejected', 'not received');
  reset role;
  select count(*) into n from public.inv_stock_moves where note_id = n2;
  if n <> 0 then raise exception 'FAIL T7a: a rejected return wrote % move(s)', n; end if;
  select on_hand into q from public.inv_stock_balances where org_id = o and item_id = i and warehouse_id = w;
  if q <> 44 then raise exception 'FAIL T7b: stock changed to % after a rejection', q; end if;

  -- ---- T8: return rows are append-only
  ok := false; begin update public.sal_note_returns set qty = 99 where note_id = n1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL T8a: a return row was edited'; end if;

  -- ---- T9: isolation
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.sal_note_returns;
  if n <> 0 then raise exception 'FAIL T9a: org B sees % return row(s)', n; end if;
  ok := false; begin perform public.sal_submit_return_note(inv, 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 1, 'returnQty', 1, 'warehouseId', w))); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T9b: org B raised a return on org A''s invoice'; end if;
  ok := false; begin insert into public.sal_note_returns (org_id, note_id, invoice_line_id, item_id, order_id, warehouse_id, qty) values (ob, n1, il, i, so, w, 1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL T9c: a user inserted a return row directly'; end if;

  -- ---- T10: no anonymous use
  reset role;
  if has_function_privilege('anon', 'public.sal_submit_return_note(uuid, text, jsonb)', 'execute') then raise exception 'FAIL T10a: anonymous can raise a return'; end if;
  if has_function_privilege('authenticated', 'public.sal_notes_post_returns()', 'execute') then raise exception 'FAIL T10b: users can call the posting trigger function'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
