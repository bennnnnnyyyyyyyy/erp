-- sql/tests/020_finance_expenses_payments.sql
-- Finance: expenses, payments against customer invoices / supplier invoices / expenses, no overpayment, void rules,
-- owner/admin only (members see nothing), no direct writes, isolation, audit. Always rolls back. Needs sql/001-024.

do $$
declare
  u uuid := gen_random_uuid();  -- owner
  m uuid := gen_random_uuid();  -- member
  x uuid := gen_random_uuid();  -- owner of another organization
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid; cinv uuid; sup uuid; po uuid; pol uuid; sinv uuid;
  cat uuid; ex uuid; p1 uuid; p2 uuid; ps uuid; pe uuid; j jsonb;
  n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'fin-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'fin-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'fin-x@tests.invalid');
  o := public.bootstrap_organization('Finance Test A', 'fin-test-a', 'fin-o@tests.invalid');
  ob := public.bootstrap_organization('Finance Test B', 'fin-test-b', 'fin-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- fixtures: a delivered and invoiced sales order (2500), and a received and billed purchase order (1000)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('F-1', 'Finance item', null, 'piece', 50, w);
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  sup := public.pur_create_supplier('Supplier', null, null, null);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 100))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  select id into pol from public.pur_order_lines where order_id = po;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); perform public.pur_receive_order(po); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cinv := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 10)))) ->> 'id')::uuid;
  sinv := public.pur_record_supplier_invoice(sup, po, 'SUP-1', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pol, 'qty', 10)));
  reset role;

  -- S1: category and expense recorded by the owner; numbering; audit; member refused
  set local role authenticated;
  cat := public.fin_create_category('Rent');
  j := public.fin_record_expense(current_date, cat, 5000, sup, 'October rent');
  ex := (j ->> 'id')::uuid;
  reset role;
  if j ->> 'number' <> 'EXP-0001' then raise exception 'FAIL S1a: number %', j ->> 'number'; end if;
  select count(*) into n from public.audit_log where org_id = o and action in ('finance.category.created', 'finance.expense.recorded');
  if n <> 2 then raise exception 'FAIL S1b: audit entries %', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.fin_record_expense(current_date, cat, 100); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S1c: a member recorded an expense'; end if;
  -- S6 (read side): a member sees no money rows at all
  select count(*) into n from public.fin_expenses; if n <> 0 then raise exception 'FAIL S6a: member sees expenses'; end if;
  select count(*) into n from public.fin_categories; if n <> 0 then raise exception 'FAIL S6b: member sees categories'; end if;
  ok := false; begin insert into public.fin_expenses (org_id, number, expense_date, category_id, amount_minor, currency, created_by) values (o, 'X', current_date, cat, 1, 'EGP', m); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S6c: member inserted an expense directly'; end if;
  reset role;

  -- S2: customer payments: 1000 then 1500 fit the invoice of 2500, one more unit does not; void frees the amount
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  p1 := ((public.fin_record_payment('in', 1000, current_date, 'cash', cinv)) ->> 'id')::uuid;
  p2 := ((public.fin_record_payment('in', 1500, current_date, 'bank', cinv)) ->> 'id')::uuid;
  ok := false; begin perform public.fin_record_payment('in', 1, current_date, 'cash', cinv); exception when others then ok := (sqlerrm = 'OVERPAYMENT'); end;
  if not ok then raise exception 'FAIL S2a: overpayment accepted'; end if;
  perform public.fin_void_payment(p2);
  perform public.fin_record_payment('in', 1500, current_date, 'bank', cinv);
  ok := false; begin perform public.fin_void_payment(p2); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S2b: a void payment was voided again'; end if;
  reset role;

  -- S3: supplier invoice (1000): 600 + 400 fit, 1 more does not
  set local role authenticated;
  ps := ((public.fin_record_payment('out', 600, current_date, 'bank', null, sinv)) ->> 'id')::uuid;
  perform public.fin_record_payment('out', 400, current_date, 'cheque', null, sinv);
  ok := false; begin perform public.fin_record_payment('out', 1, current_date, 'cash', null, sinv); exception when others then ok := (sqlerrm = 'OVERPAYMENT'); end;
  if not ok then raise exception 'FAIL S3: supplier overpayment accepted'; end if;

  -- S4: expense (5000): pay 2000; the expense cannot be voided while it has a payment, can be after the payment is voided
  pe := ((public.fin_record_payment('out', 2000, current_date, 'cash', null, null, ex)) ->> 'id')::uuid;
  ok := false; begin perform public.fin_void_expense(ex); exception when others then ok := (sqlerrm = 'HAS_PAYMENTS'); end;
  if not ok then raise exception 'FAIL S4a: expense with a payment was voided'; end if;
  perform public.fin_void_payment(pe);
  perform public.fin_void_expense(ex);
  ok := false; begin perform public.fin_record_payment('out', 100, current_date, 'cash', null, null, ex); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S4b: a void expense was paid'; end if;

  -- S5: bad combinations and amounts
  ok := false; begin perform public.fin_record_payment('in', 100, current_date, 'cash', null, sinv); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5a: money in without a customer invoice accepted'; end if;
  ok := false; begin perform public.fin_record_payment('out', 100, current_date, 'cash', cinv); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5b: money out against a customer invoice accepted'; end if;
  ok := false; begin perform public.fin_record_payment('out', 0, current_date, 'cash', null, sinv); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5c: zero amount accepted'; end if;
  ok := false; begin perform public.fin_record_payment('out', 100, current_date, 'cash', null, sinv, ex); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5d: two targets accepted'; end if;
  reset role;

  -- S7: the other organization sees nothing and cannot pay our invoices
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.fin_payments; if n <> 0 then raise exception 'FAIL S7a: cross-organization payments visible'; end if;
  ok := false; begin perform public.fin_record_payment('in', 1, current_date, 'cash', cinv); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S7b: paid another organization''s invoice'; end if;
  reset role;

  -- S8: numbering and audit chain
  select count(*) into n from public.fin_payments where org_id = o and number like 'PAY-%';
  if n < 5 then raise exception 'FAIL S8a: % payments numbered', n; end if;
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL S8b: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
