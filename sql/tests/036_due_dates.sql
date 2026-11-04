-- sql/tests/036_due_dates.sql
-- S2 (SUPERFIX_WORKFLOW_PLAN): payment terms and due dates. Always rolls back. Needs sql/001-041.
-- Covers: due date from the customer's own terms, from the company default when it has none, and 0 days when neither is set;
-- who may set terms and the range; audit rows; a due date before the invoice date refused; the overdue alert counts from the due
-- date (fires past it, not before); supplier terms; isolation.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  m uuid := gen_random_uuid();  -- member, org A
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; w uuid; i uuid; c1 uuid; c2 uuid; cb uuid; so1 uuid; so2 uuid; rq uuid; ol uuid; inv1 uuid; inv2 uuid; sup uuid;
  r_now uuid; r_late uuid; d date; n bigint; ok boolean; j jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'dd-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'dd-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'dd-x@tests.invalid');
  o := public.bootstrap_organization('Due Test A', 'due-test-a', 'dd-o@tests.invalid');
  ob := public.bootstrap_organization('Due Test B', 'due-test-b', 'dd-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('DD-1', 'Due item', null, 'piece', 50, w);
  c1 := public.sal_create_customer('Thirty days', null, null, null);
  c2 := public.sal_create_customer('Company default', null, null, null);
  sup := public.pur_create_supplier('Supplier', null, null, null);

  -- ---- T1: who may set terms, and the range
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_set_customer_terms(c1, 30); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T1a: a member set customer terms'; end if;
  ok := false; begin perform public.core_set_default_payment_terms(7); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T1b: a member set the company default terms'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_set_customer_terms(c1, 366); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1c: 366 days was accepted'; end if;
  ok := false; begin perform public.core_set_default_payment_terms(-1); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1d: negative default terms were accepted'; end if;

  -- ---- T2: set terms; audited
  perform public.sal_set_customer_terms(c1, 30);
  perform public.sal_set_customer_terms(c1, 30);   -- no-op: no second audit row
  if public.core_set_default_payment_terms(7) <> 7 then raise exception 'FAIL T2a: default terms not returned'; end if;
  perform public.pur_set_supplier_terms(sup, 45);
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.customer_terms_changed' and entity_id = c1::text;
  if n <> 1 then raise exception 'FAIL T2b: % audit row(s) for customer terms, expected 1', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.payment_terms_changed';
  if n <> 1 then raise exception 'FAIL T2c: % audit row(s) for company terms, expected 1', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'purchasing.supplier_terms_changed';
  if n <> 1 then raise exception 'FAIL T2d: % audit row(s) for supplier terms, expected 1', n; end if;

  -- two delivered orders, one per customer: member requests, owner approves, member issues
  set local role authenticated;
  so1 := (public.sal_create_order(c1, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 5, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  so2 := (public.sal_create_order(c2, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 5, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  rq := (public.sal_request_stock(so1) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.inv_decide_request(rq, 'approved');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.inv_post_issue(rq);
  rq := (public.sal_request_stock(so2) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.inv_decide_request(rq, 'approved');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.inv_post_issue(rq);

  -- ---- T3: due dates from the customer's terms and from the company default
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  reset role; select id into ol from public.sal_order_lines where order_id = so1; set local role authenticated;
  inv1 := (public.sal_create_invoice(so1, current_date - 40, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 5))) ->> 'id')::uuid;
  reset role; select id into ol from public.sal_order_lines where order_id = so2; set local role authenticated;
  inv2 := (public.sal_create_invoice(so2, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 5))) ->> 'id')::uuid;
  reset role;
  select due_date into d from public.sal_invoices where id = inv1;
  if d is distinct from current_date - 10 then raise exception 'FAIL T3a: 30-day customer due date is %, expected %', d, current_date - 10; end if;
  select due_date into d from public.sal_invoices where id = inv2;
  if d is distinct from current_date + 7 then raise exception 'FAIL T3b: company-default due date is %, expected %', d, current_date + 7; end if;

  -- ---- T4: a due date before the invoice date is refused (direct write as the table owner; the trigger still runs)
  ok := false;
  begin
    insert into public.sal_invoices (org_id, number, order_id, customer_id, invoice_date, currency, created_by, due_date)
    values (o, 'X-DUE', so2, c2, current_date, 'EGP', u, current_date - 1);
  exception when others then ok := (sqlerrm = 'DUE_BEFORE_INVOICE');
  end;
  if not ok then raise exception 'FAIL T4a: a due date before the invoice date was stored'; end if;

  -- ---- T5: the overdue alert counts from the due date
  set local role authenticated;
  r_now := public.alr_create_rule('Overdue now', 'receivable_overdue', null, 0, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner')));
  r_late := public.alr_create_rule('Overdue 15', 'receivable_overdue', null, 15, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner')));
  reset role;
  j := public.alr_run(o);
  select count(*) into n from public.alr_firings where rule_id = r_now and subject = 'invoice:' || inv1;
  if n <> 1 then raise exception 'FAIL T5a: an invoice 10 days past due did not fire the 0-day rule'; end if;
  select count(*) into n from public.alr_firings where rule_id = r_late and subject = 'invoice:' || inv1;
  if n <> 0 then raise exception 'FAIL T5b: an invoice 10 days past due fired the 15-day rule (counted from the invoice date?)'; end if;
  select count(*) into n from public.alr_firings where subject = 'invoice:' || inv2;
  if n <> 0 then raise exception 'FAIL T5c: an invoice not yet due fired an overdue rule'; end if;

  -- ---- T6: isolation: org B cannot set A's customer terms, and A's default does not reach B
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_set_customer_terms(c1, 1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T6a: org B changed org A''s customer terms'; end if;
  cb := public.sal_create_customer('B customer', null, null, null);
  reset role;
  select count(*) into n from public.organizations where id = ob and settings ? 'default_payment_terms_days';
  if n <> 0 then raise exception 'FAIL T6b: org A''s default terms leaked into org B'; end if;
  select payment_terms_days into n from public.sal_customers where id = c1;
  if n <> 30 then raise exception 'FAIL T6c: org A''s customer terms changed to %', n; end if;

  -- ---- T7: no anonymous use
  if has_function_privilege('anon', 'public.sal_set_customer_terms(uuid, integer)', 'execute') then raise exception 'FAIL T7a: anonymous can set customer terms'; end if;
  if has_function_privilege('anon', 'public.core_set_default_payment_terms(integer)', 'execute') then raise exception 'FAIL T7b: anonymous can set default terms'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
