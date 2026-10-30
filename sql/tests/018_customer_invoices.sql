-- sql/tests/018_customer_invoices.sql
-- Customer invoices: undelivered order refused, partial then final invoicing, over-invoicing refused, price from the
-- order line, void frees the quantity, members cannot invoice, no direct writes, isolation, audit. Always rolls back.
-- Needs sql/001-022.

do $$
declare
  u uuid := gen_random_uuid();  -- owner
  m uuid := gen_random_uuid();  -- member
  x uuid := gen_random_uuid();  -- owner of another organization
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid; inv1 uuid; inv2 uuid;
  n bigint; ok boolean; j jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ci-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'ci-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'ci-x@tests.invalid');
  o := public.bootstrap_organization('Cust Inv Test A', 'cust-inv-a', 'ci-o@tests.invalid');
  ob := public.bootstrap_organization('Cust Inv Test B', 'cust-inv-b', 'ci-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('CI-1', 'Invoice item', null, 'piece', 20, w);
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;

  -- S1: an order that is not delivered cannot be invoiced
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))); exception when others then ok := (sqlerrm = 'NOT_DELIVERED'); end;
  if not ok then raise exception 'FAIL S1: undelivered order was invoiced'; end if;
  reset role;

  -- deliver it: member requests, owner approves, member issues
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;

  -- S2: a member cannot invoice
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2: a member created an invoice'; end if;
  reset role;

  -- S3: partial invoice of 4, price taken from the order line (a price in the request is ignored)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 4, 'unitPriceMinor', 1)));
  reset role;
  inv1 := (j ->> 'id')::uuid;
  if j ->> 'number' <> 'INV-0001' then raise exception 'FAIL S3a: number %', j ->> 'number'; end if;
  select unit_price_minor into n from public.sal_invoice_lines where invoice_id = inv1;
  if n <> 250 then raise exception 'FAIL S3b: price not from the order line (%)', n; end if;

  -- S4: over-invoicing refused (4 + 7 > 10); the failed attempt leaves no invoice behind
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 7))); exception when others then ok := (sqlerrm = 'INVOICE_QTY_EXCEEDS_DELIVERED'); end;
  reset role;
  if not ok then raise exception 'FAIL S4a: over-invoicing accepted'; end if;
  select count(*) into n from public.sal_invoices where order_id = so;
  if n <> 1 then raise exception 'FAIL S4b: % invoices exist', n; end if;

  -- S5: the final 6 is accepted, then nothing is left
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  inv2 := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 6)))) ->> 'id')::uuid;
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))); exception when others then ok := (sqlerrm = 'INVOICE_QTY_EXCEEDS_DELIVERED'); end;
  if not ok then raise exception 'FAIL S5: invoiced beyond the full quantity'; end if;

  -- S6: voiding frees the quantity; voiding twice is refused
  perform public.sal_void_invoice(inv2);
  ok := false; begin perform public.sal_void_invoice(inv2); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S6a: a void invoice was voided again'; end if;
  perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 6)));
  reset role;

  -- S7: no direct writes by signed-in users
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin update public.sal_invoices set status = 'issued' where id = inv2; get diagnostics n = row_count; ok := (n = 0); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S7a: direct update of an invoice worked'; end if;
  ok := false; begin delete from public.sal_invoices where id = inv1; ok := false; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S7b: direct delete of an invoice worked'; end if;
  reset role;

  -- S8: another organization sees nothing and cannot invoice or void
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.sal_invoices;
  if n <> 0 then raise exception 'FAIL S8a: cross-organization invoices visible'; end if;
  ok := false; begin perform public.sal_void_invoice(inv1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S8b: voided another organization''s invoice'; end if;
  reset role;

  -- S9: audit entries exist and the chain is intact
  select count(*) into n from public.audit_log where org_id = o and action in ('sales.invoice.created', 'sales.invoice.voided');
  if n < 4 then raise exception 'FAIL S9a: expected at least 4 invoice audit entries, found %', n; end if;
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL S9b: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
