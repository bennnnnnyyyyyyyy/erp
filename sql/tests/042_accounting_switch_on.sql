-- sql/tests/042_accounting_switch_on.sql
-- Accounting slice 3 (sql/047): switching accounting on for a company with history. Always rolls back. Needs sql/001-047.
-- Covers: the preview; owner only; refused while a receipt is uncosted or a role is missing; entering a receipt cost (owner or head
-- accountant, zero needs a reason, only uncosted receipts, append-only); the backfill posts every existing document (receipts,
-- issues, adjustment, customer invoices and a void, supplier invoice, payments and a void, expense and its void, credit note) marked
-- as backfill, even before the lock date; the books balance and tie out; it cannot run twice; accounting cannot be switched off;
-- documents after switch-on post normally; audit row; members see nothing.

do $$
declare
  u uuid := gen_random_uuid();  -- owner
  a uuid := gen_random_uuid();  -- admin
  m uuid := gen_random_uuid();  -- member
  o uuid; w uuid; i uuid; c uuid; so uuid; so2 uuid; rq uuid; rq2 uuid; ol uuid; ol2 uuid; cinv uuid; cinv2 uuid; sup uuid; po uuid; pol uuid; sinv uuid;
  cat uuid; ex uuid; ex2 uuid; p1 uuid; il uuid; note uuid; adj uuid; v_move bigint; acc_pv uuid; r jsonb; n bigint; ok boolean;
  v_dr bigint; v_cr bigint; v_bal bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'accs-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'accs-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'accs-m@tests.invalid');
  o := public.bootstrap_organization('Switch-on Test', 'switch-on-test', 'accs-o@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- ---- history, with accounting OFF
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('S-1', 'Item', null, 'piece', 20, w);   -- opening stock with no cost: allowed while accounting is off
  sup := public.pur_create_supplier('Supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0); -- sql/069: this test is not about approval
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 300))) ->> 'id')::uuid;
  perform public.pur_receive_order(po);
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 3, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  so2 := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  select id into ol2 from public.sal_order_lines where order_id = so2;
  select id into pol from public.pur_order_lines where order_id = po;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; rq2 := (public.sal_request_stock(so2) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); perform public.inv_decide_request(rq2, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); perform public.inv_post_issue(rq2);
  adj := ((public.inv_submit_adjustment(i, w, 25, 'Count')) ->> 'id')::uuid; reset role;   -- 20 + 10 - 3 - 1 = 26 on hand, counted 25
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_adjustment(adj, 'approved');
  cinv := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 3)))) ->> 'id')::uuid;   -- 3000
  cinv2 := ((public.sal_create_invoice(so2, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol2, 'qty', 1)))) ->> 'id')::uuid; -- 1000
  perform public.sal_void_invoice(cinv2);
  sinv := public.pur_record_supplier_invoice(sup, po, 'SUP-1', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pol, 'qty', 10)));
  p1 := ((public.fin_record_payment('in', 1000, current_date, 'cash', cinv)) ->> 'id')::uuid;
  perform public.fin_void_payment(p1);
  perform public.fin_record_payment('in', 500, current_date, 'card', cinv);
  perform public.fin_record_payment('out', 3000, current_date, 'bank', null, sinv);
  cat := public.fin_create_category('Rent');
  ex := ((public.fin_record_expense(current_date, cat, 700, null, 'Rent')) ->> 'id')::uuid;
  ex2 := ((public.fin_record_expense(current_date, cat, 50, null, 'Mistake')) ->> 'id')::uuid;
  perform public.fin_void_expense(ex2);
  reset role;
  select id into il from public.sal_invoice_lines where invoice_id = cinv;
  set local role authenticated;
  note := ((public.sal_submit_note(cinv, 'credit', 'Damaged', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 1)))) ->> 'id')::uuid;   -- 1000
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.sal_decide_note(note, 'approved'); reset role;
  select count(*) into n from public.acc_entries where org_id = o;
  if n <> 0 then raise exception 'FAIL S0a: % entries before switch-on', n; end if;

  -- ---- S1: preview, permissions, blockers
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.acc_switch_on_preview(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S1a: a member saw the preview'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := public.acc_switch_on_preview();
  if (r ->> 'uncostedReceipts')::int <> 1 or (r ->> 'accountingOn')::boolean then raise exception 'FAIL S1b: preview %', r; end if;
  ok := false; begin perform public.acc_switch_on(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S1c: an admin switched accounting on'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_switch_on(); exception when others then ok := (sqlerrm = 'UNCOSTED_RECEIPTS'); end;
  if not ok then raise exception 'FAIL S1d: switch-on ran with an uncosted receipt'; end if;

  -- ---- S2: entering the cost of the uncosted opening stock
  select move_id into v_move from public.acc_uncosted_receipts();
  ok := false; begin perform public.acc_set_receipt_cost(v_move, 0); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S2a: a zero cost without a reason was accepted'; end if;
  perform public.acc_set_receipt_cost(v_move, 250, 'Supplier invoice of the opening stock');
  ok := false; begin perform public.acc_set_receipt_cost(v_move, 260); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S2b: a receipt was costed twice'; end if;

  -- ---- S3: a missing role blocks switch-on and names the role
  perform public.acc_prepare();
  reset role;
  select account_id into acc_pv from public.acc_account_roles where org_id = o and role_key = 'price_variance';
  delete from public.acc_account_roles where org_id = o and role_key = 'price_variance';
  set local role authenticated;
  ok := false; begin perform public.acc_switch_on(); exception when others then ok := (sqlerrm = 'ACCOUNT_ROLE_MISSING'); end;
  if not ok then raise exception 'FAIL S3a: switch-on ran with a missing role'; end if;
  perform public.acc_set_account_role('price_variance', acc_pv);

  -- ---- S4: switch on, with a lock date set to today (backfill is allowed before it)
  perform public.core_set_lock_date(current_date);
  r := public.acc_switch_on();
  reset role;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  select count(*) into n from public.acc_entries where org_id = o and not is_backfill;
  if n <> 0 then raise exception 'FAIL S4a: % backfill entries not marked as backfill', n; end if;
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) into v_dr, v_cr from public.acc_entry_lines where org_id = o;
  if v_dr <> v_cr or v_dr = 0 then raise exception 'FAIL S4b: debits %, credits %', v_dr, v_cr; end if;
  -- every kind of document produced its entry
  select count(distinct (source_type, event)) into n from public.acc_entries where org_id = o;
  if n < 12 then raise exception 'FAIL S4c: only % kinds of entries: %', n, (select string_agg(distinct source_type || '/' || event, ', ') from public.acc_entries where org_id = o); end if;
  -- customers: 3000 + 1000 (voided: -1000) + 1000 paid, voided (+1000 back) - 500 card - 1000 credit note = 1500
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id where l.org_id = o and ac.code = '171';
  if v_bal <> 1500 then raise exception 'FAIL S4d: customers %, expected 1500', v_bal; end if;
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id where l.org_id = o and ac.code = '282';
  if v_bal <> 0 then raise exception 'FAIL S4e: GRNI %, expected 0', v_bal; end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id where l.org_id = o and ac.code = '193';
  if v_bal <> 500 then raise exception 'FAIL S4f: card clearing %, expected 500', v_bal; end if;
  -- inventory account = value of the moves at their posted costs (opening stock at the entered 250)
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id where l.org_id = o and ac.code = '161';
  select coalesce(sum(round(abs(mv.qty) * coalesce(mv.unit_cost_minor, rc.unit_cost_minor, ol2.unit_cost_minor)) * sign(mv.qty)), 0) into v_dr
    from public.inv_stock_moves mv
    left join public.acc_receipt_costs rc on rc.org_id = mv.org_id and rc.stock_move_id = mv.id
    left join public.pur_orders po2 on po2.org_id = mv.org_id and po2.number = mv.ref
    left join public.pur_order_lines ol2 on ol2.org_id = mv.org_id and ol2.order_id = po2.id and ol2.item_id = mv.item_id
   where mv.org_id = o;
  if v_bal <> v_dr then raise exception 'FAIL S4g: inventory account % vs stock moves %', v_bal, v_dr; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'accounting.switched_on';
  if n <> 1 then raise exception 'FAIL S4h: % switch-on audit rows', n; end if;

  -- ---- S5: once on: cannot run twice, cannot be switched off, new documents post normally
  set local role authenticated;
  ok := false; begin perform public.acc_switch_on(); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S5a: switch-on ran twice'; end if;
  ok := false; begin perform public.core_set_module('accounting', false); exception when others then ok := (sqlerrm in ('FORBIDDEN', 'USE_SWITCH_ON')); end;
  if not ok then raise exception 'FAIL S5b: accounting was switched off'; end if;
  perform public.core_set_lock_date(null);
  ex := ((public.fin_record_expense(current_date, cat, 120, null, 'After switch-on')) ->> 'id')::uuid;
  reset role;
  if not public.acc__enabled(o) then raise exception 'FAIL S5b2: accounting is no longer on'; end if;
  select count(*) into n from public.acc_entries where org_id = o and source_type = 'expense' and source_id = ex::text and not is_backfill;
  if n <> 1 then raise exception 'FAIL S5c: a new expense did not post as a normal entry'; end if;
  -- P17: a cost changed by hand revalues the 25 on hand (average 100 -> 120: +500)
  select avg_cost_minor into v_bal from public.inv_items where id = i;
  if v_bal <> 100 then raise exception 'FAIL S5d0: average cost %, expected 100', v_bal; end if;
  set local role authenticated; perform public.inv_set_item_cost(i, 120); reset role;
  select count(*) into n from public.acc_entries e join public.acc_entry_lines l on l.entry_id = e.id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.event = 'revalued' and ((ac.code = '161' and l.debit_minor = 500) or (ac.code = '332' and l.credit_minor = 500));
  if n <> 2 then raise exception 'FAIL S5d: the hand cost change did not revalue the stock on hand by 500'; end if;

  -- ---- S6: no anonymous use; internal list closed
  if has_function_privilege('anon', 'public.acc_switch_on()', 'execute') then raise exception 'FAIL S6a: anonymous can switch on'; end if;
  if has_function_privilege('authenticated', 'public.acc__uncosted_receipts(uuid)', 'execute') then raise exception 'FAIL S6b: users can call the internal list'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
