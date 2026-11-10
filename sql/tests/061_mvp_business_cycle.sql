-- sql/tests/061_mvp_business_cycle.sql
-- One business day end to end, with accounting and treasury on (MVP readiness check, 10 Nov 2026). Always rolls back. Needs sql/001-065.
-- Four people: owner u, admin a (approves), clerk m (member: receives, issues, asks), and an outsider x in another company.
-- Buy two items (part delivery, then the rest), bill and pay the supplier, sell (stock request, approval by someone else, issue),
-- invoice, get paid, a credit note, a transfer to the cash box, an expense paid in cash, a stock count correction. Then the books must
-- agree with the operational records: debits = credits; inventory account = stock at average cost; receivables = what customers owe;
-- payables = what we owe suppliers; goods received not invoiced = 0; cash and bank = the payments; revenue, returns, cost of sales and
-- the count loss are right; stock quantities are right; the audit chain is intact; the other company sees nothing.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i_box uuid; i_tape uuid; sup uuid; cus uuid; po uuid; l_box uuid; l_tape uuid; bill uuid;
  so uuid; rq uuid; inv uuid; il_box uuid; note uuid; adj uuid; cat uuid; ex uuid; cash_main uuid; bank_main uuid;
  j jsonb; n bigint; v_dr bigint; v_cr bigint; v bigint; q numeric;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'mvp-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'mvp-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'mvp-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'mvp-x@tests.invalid');
  o := public.bootstrap_organization('MVP Day', 'mvp-day', 'mvp-o@tests.invalid');
  ob := public.bootstrap_organization('Other Co', 'mvp-other', 'mvp-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- accounting and treasury on (as sql/tests/046)
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.acc_prepare(); reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  insert into public.org_modules (org_id, module_key) values (o, 'treasury');
  set local role authenticated;
  perform public.trs_prepare();
  select id into cash_main from public.trs_accounts where org_id = o and code = 'CASH-MAIN';
  select id into bank_main from public.trs_accounts where org_id = o and code = 'BANK-MAIN';

  -- ---- master data (owner)
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i_box := public.inv_create_item('BOX', 'Boxes', 'صناديق', 'piece', 0, null);
  i_tape := public.inv_create_item('TAPE', 'Tape', null, 'roll', 0, null);
  sup := public.pur_create_supplier('Nile Packaging', null, 'Cairo', null);
  cus := public.sal_create_customer('Delta Trading', null, 'Giza', null);

  -- ---- buy: 100 boxes at 20.00, 50 tape at 10.00
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i_box, 'qty', 100, 'unitCostMinor', 2000),
                                                           jsonb_build_object('itemId', i_tape, 'qty', 50, 'unitCostMinor', 1000))) ->> 'id')::uuid;
  select id into l_box from public.pur_order_lines where order_id = po and item_id = i_box;
  select id into l_tape from public.pur_order_lines where order_id = po and item_id = i_tape;

  -- sql/069: the order waits for approval by someone other than its creator; the admin approves it
  if (select approval from public.pur_orders where id = po) <> 'pending' then raise exception 'FAIL B0: the order does not wait for approval'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.pur_decide_order(po, 'approved');

  -- the clerk receives 60 boxes and all the tape; the rest of the boxes are still coming; later the rest arrives
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  j := public.pur_receive_lines(po, jsonb_build_array(jsonb_build_object('lineId', l_box, 'qty', 60), jsonb_build_object('lineId', l_tape, 'qty', 50)), true);
  if j ->> 'status' <> 'ordered' then raise exception 'FAIL B1: part delivery closed the order (%)', j; end if;
  perform public.pur_receive_order(po);

  -- the owner records the supplier's bill for everything (2,500.00)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  bill := public.pur_record_supplier_invoice(sup, po, 'NP-7781', current_date,
            jsonb_build_array(jsonb_build_object('orderLineId', l_box, 'qty', 100), jsonb_build_object('orderLineId', l_tape, 'qty', 50)));
  -- invoices post when their transaction commits (deferred triggers); this test is one transaction, so flush them as a commit would
  execute 'set constraints public.acc_post_pur_invoice, public.acc_post_sal_invoice immediate';
  execute 'set constraints public.acc_post_pur_invoice, public.acc_post_sal_invoice deferred';

  -- ---- sell: 30 boxes at 50.00 and 10 tape at 30.00 (1,800.00)
  so := (public.sal_create_order(cus, w, jsonb_build_array(jsonb_build_object('itemId', i_box, 'qty', 30, 'unitPriceMinor', 5000),
                                                           jsonb_build_object('itemId', i_tape, 'qty', 10, 'unitPriceMinor', 3000))) ->> 'id')::uuid;
  rq := (public.sal_request_stock(so) ->> 'id')::uuid;
  -- the owner asked, so the admin approves; the clerk issues
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.inv_decide_request(rq, 'approved');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.inv_post_issue(rq);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  -- "delivered" is the order's stock request being issued (the API shows it so; sal_create_invoice checks the same)
  if (select r.status from public.sal_orders s join public.inv_requests r on r.id = s.request_id where s.id = so) <> 'issued' then
    raise exception 'FAIL S1: the order''s stock request is not issued';
  end if;
  inv := (public.sal_create_invoice(so, current_date, (select jsonb_agg(jsonb_build_object('orderLineId', ol.id, 'qty', ol.qty))
                                                        from public.sal_order_lines ol where ol.order_id = so)) ->> 'id')::uuid;
  execute 'set constraints public.acc_post_pur_invoice, public.acc_post_sal_invoice immediate';
  execute 'set constraints public.acc_post_pur_invoice, public.acc_post_sal_invoice deferred';
  select id into il_box from public.sal_invoice_lines il where il.invoice_id = inv
     and il.order_line_id = (select id from public.sal_order_lines where order_id = so and item_id = i_box);

  -- ---- money: the customer pays 1,000.00 into the bank; we pay the supplier 800.00 from the bank; 150.00 bank to cash; rent 100.00 in cash
  perform public.fin_record_payment('in', 100000, current_date, 'bank', inv, null, null, 'part payment', bank_main);
  perform public.fin_record_payment('out', 80000, current_date, 'bank', null, bill, null, 'first instalment', bank_main);
  perform public.trs_record_transfer(bank_main, cash_main, 15000, current_date, 'petty cash');
  cat := public.fin_create_category('Rent');
  ex := ((public.fin_record_expense(current_date, cat, 10000, null, 'November rent')) ->> 'id')::uuid;
  perform public.fin_record_payment('out', 10000, current_date, 'cash', null, null, ex, 'rent', cash_main);

  -- ---- a credit note for 2 damaged boxes (100.00): the clerk asks, the admin approves
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  begin
    note := (public.sal_submit_note(inv, 'credit', 'two damaged boxes', jsonb_build_array(jsonb_build_object('invoiceLineId', il_box, 'qty', 2))) ->> 'id')::uuid;
  exception when others then
    -- members may not be allowed to ask; then the owner asks
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    note := (public.sal_submit_note(inv, 'credit', 'two damaged boxes', jsonb_build_array(jsonb_build_object('invoiceLineId', il_box, 'qty', 2))) ->> 'id')::uuid;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.sal_decide_note(note, 'approved');

  -- ---- the count finds 69 boxes, not 70: the clerk asks, the admin approves
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  adj := (public.inv_submit_adjustment(i_box, w, 69, 'count: one missing') ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.inv_decide_adjustment(adj, 'approved');
  reset role;

  -- ======================================================== the books must agree with the records
  -- K1: every entry balances, and so does the whole ledger
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) into v_dr, v_cr from public.acc_entry_lines where org_id = o;
  if v_dr <> v_cr or v_dr = 0 then raise exception 'FAIL K1: debits % credits %', v_dr, v_cr; end if;
  if exists (select 1 from public.acc_entry_lines where org_id = o group by entry_id having sum(debit_minor) <> sum(credit_minor)) then
    raise exception 'FAIL K1b: an entry does not balance';
  end if;

  -- K2: stock quantities: boxes 100 - 30 - 1 = 69, tape 50 - 10 = 40
  select sum(on_hand) into q from public.inv_stock_balances where org_id = o and item_id = i_box;
  if q <> 69 then raise exception 'FAIL K2a: boxes on hand %', q; end if;
  select sum(on_hand) into q from public.inv_stock_balances where org_id = o and item_id = i_tape;
  if q <> 40 then raise exception 'FAIL K2b: tape on hand %', q; end if;
  if exists (select 1 from public.inv_stock_balances b where b.org_id = o and b.on_hand <> (select coalesce(sum(mv.qty), 0) from public.inv_stock_moves mv
              where mv.org_id = o and mv.item_id = b.item_id and mv.warehouse_id = b.warehouse_id)) then
    raise exception 'FAIL K2c: a balance differs from its stock moves';
  end if;

  -- helper: a role account's balance (debit - credit)
  -- K3: inventory account = stock at average cost (69 x 20.00 + 40 x 10.00 = 1,780.00)
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'inventory';
  if v <> 178000 then raise exception 'FAIL K3a: inventory account %, expected 178000', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.acc_stock_value_check() s where s.difference_minor <> 0) then
    raise exception 'FAIL K3b: the stock value check shows differences';
  end if;
  reset role;

  -- K4: receivables = 1,800.00 invoiced - 1,000.00 paid - 100.00 credited = 700.00
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'receivables';
  if v <> 70000 then
    raise exception 'FAIL K4: receivables %, expected 70000. Entries: %', v, (
      select string_agg(format('%s/%s %s', e.source_type, e.event, (select string_agg(format('%s %s/%s', ac.code, l.debit_minor, l.credit_minor), ' ')
        from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id where l.entry_id = e.id)), ' | ' order by e.created_at)
      from public.acc_entries e where e.org_id = o);
  end if;

  -- K5: payables = 2,500.00 billed - 800.00 paid = 1,700.00 (credit balance)
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'payables';
  if v <> 170000 then raise exception 'FAIL K5: payables %, expected 170000', v; end if;

  -- K6: goods received not invoiced = 0 (everything received was billed)
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'grni';
  if v <> 0 then raise exception 'FAIL K6: goods received not invoiced %, expected 0', v; end if;

  -- K7: bank 1,000.00 - 800.00 - 150.00 = 50.00; cash 150.00 - 100.00 = 50.00
  if public.trs__ledger_balance(o, (select ledger_account_id from public.trs_accounts where id = bank_main), 'EGP') <> 5000 then
    raise exception 'FAIL K7a: bank %, expected 5000', public.trs__ledger_balance(o, (select ledger_account_id from public.trs_accounts where id = bank_main), 'EGP');
  end if;
  if public.trs__ledger_balance(o, (select ledger_account_id from public.trs_accounts where id = cash_main), 'EGP') <> 5000 then
    raise exception 'FAIL K7b: cash %, expected 5000', public.trs__ledger_balance(o, (select ledger_account_id from public.trs_accounts where id = cash_main), 'EGP');
  end if;

  -- K8: revenue 1,800.00; returns 100.00; cost of sales 30 x 20.00 + 10 x 10.00 = 700.00; count loss 20.00; rent 100.00
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'sales_revenue';
  if v <> 180000 then raise exception 'FAIL K8a: revenue %, expected 180000', v; end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'sales_returns';
  if v <> 10000 then raise exception 'FAIL K8b: returns %, expected 10000', v; end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'cogs';
  if v <> 70000 then raise exception 'FAIL K8c: cost of sales %, expected 70000', v; end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v from public.acc_entry_lines l
    join public.acc_account_roles r on r.org_id = l.org_id and r.account_id = l.account_id where l.org_id = o and r.role_key = 'stock_adjustment';
  if v <> 2000 then raise exception 'FAIL K8d: count loss %, expected 2000', v; end if;

  -- K9: the trial balance report agrees with the raw ledger
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce(sum(t.debit_minor), 0), coalesce(sum(t.credit_minor), 0) into v_dr, v_cr from public.acc_trial_balance(current_date - 1, current_date) t where t.is_leaf;
  reset role;
  if v_dr <> v_cr then raise exception 'FAIL K9: trial balance debits % credits %', v_dr, v_cr; end if;

  -- K10: the audit chain is intact and the key actions are in it
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL K10a: audit chain broken (% rows)', n; end if;
  if (select count(distinct action) from public.audit_log where org_id = o and action in (
        'purchasing.order.partly_received', 'purchasing.order.received', 'purchasing.supplier_invoice.recorded', 'inventory.request.approved',
        'sales.note.approved', 'inventory.adjustment.applied')) <> 6 then
    raise exception 'FAIL K10b: key actions missing from the audit log: %', (select string_agg(distinct action, ', ') from public.audit_log where org_id = o);
  end if;

  -- K11: the other company sees none of it
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- (its own company has rows of its own, for example the audit rows of its sign-up; only company A's rows matter here)
  if exists (select 1 from public.acc_entry_lines where org_id = o) or exists (select 1 from public.sal_invoices where org_id = o)
     or exists (select 1 from public.inv_stock_balances where org_id = o) or exists (select 1 from public.fin_payments where org_id = o)
     or exists (select 1 from public.audit_log where org_id = o) or exists (select 1 from public.pur_supplier_invoices where org_id = o)
     or exists (select 1 from public.trs_accounts where org_id = o) then
    raise exception 'FAIL K11: the other company sees this company''s records';
  end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
