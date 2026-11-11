-- sql/tests/078_paymob_order_binding.sql
-- sql/084: a Paymob link with a saved order id only settles when the signed order id matches (audit finding 2). Always rolls back.
-- Needs sql/001-084. Covers: a link made before 084 (no saved id) settles as before; a wrong or missing order id sends the link to review
-- and records no payment; the matching id settles once (a replay is a duplicate); a second company's link is not touched by a callback
-- that quotes its order id for the first company's reference; the id can be saved once and only by the server; users and anon cannot
-- call the new functions.

do $$
declare
  u uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid; cinv uuid;
  wb uuid; ib uuid; cb uuid; sob uuid; rqb uuid; olb uuid; cinvb uuid;
  l jsonb; lb jsonb; r jsonb; n bigint; ok boolean; v_cur text; la uuid; lc uuid;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ob-o@tests.invalid'), (x, 'authenticated', 'authenticated', 'ob-x@tests.invalid');
  o := public.bootstrap_organization('Binding Test A', 'binding-test-a', 'ob-o@tests.invalid');
  ob := public.bootstrap_organization('Binding Test B', 'binding-test-b', 'ob-x@tests.invalid');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- fixture, company A: an invoice of 10 x 250 = 2500 (the owner is the only approver, sql/063)
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('OB-1', 'Binding item', null, 'piece', 50, w);
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  set local role authenticated;
  rq := (public.sal_request_stock(so) ->> 'id')::uuid;
  perform public.inv_decide_request(rq, 'approved');
  perform public.inv_post_issue(rq);
  cinv := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 10)))) ->> 'id')::uuid;
  perform public.core_save_provider_fields('paymob', '{"secret_key": "sk_test_AAA", "public_key": "pk_test_AAA", "hmac_secret": "h", "integration_ids": "1"}');
  perform public.core_save_integration('paymob', true, 'live', null);
  l := public.fin_create_payment_link(cinv, 'paymob', 1000);
  reset role;
  select currency into v_cur from public.sal_invoices where id = cinv;
  la := (l ->> 'id')::uuid;

  -- fixture, company B: the same, with its own link
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wb := public.inv_create_warehouse('MAIN', 'Main');
  ib := public.inv_create_item('OB-2', 'Binding item B', null, 'piece', 50, wb);
  cb := public.sal_create_customer('Customer B', null, null, null);
  sob := (public.sal_create_order(cb, wb, jsonb_build_array(jsonb_build_object('itemId', ib, 'qty', 10, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  reset role;
  select id into olb from public.sal_order_lines where order_id = sob;
  set local role authenticated;
  rqb := (public.sal_request_stock(sob) ->> 'id')::uuid;
  perform public.inv_decide_request(rqb, 'approved');
  perform public.inv_post_issue(rqb);
  cinvb := ((public.sal_create_invoice(sob, current_date, jsonb_build_array(jsonb_build_object('orderLineId', olb, 'qty', 10)))) ->> 'id')::uuid;
  perform public.core_save_provider_fields('paymob', '{"secret_key": "sk_test_BBB", "public_key": "pk_test_BBB", "hmac_secret": "h2", "integration_ids": "1"}');
  perform public.core_save_integration('paymob', true, 'live', null);
  lb := public.fin_create_payment_link(cinvb, 'paymob', 1000);
  reset role;

  -- B1: the server saves the order id once; only for a pending Paymob link
  perform public.fin__link_set_provider_order(la, 'ORD-A');
  if (select provider_order_id from public.fin_payment_links where id = la) <> 'ORD-A' then raise exception 'FAIL B1a: order id not saved'; end if;
  ok := false; begin perform public.fin__link_set_provider_order(la, 'ORD-OTHER'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL B1b: the saved order id was replaced'; end if;
  ok := false; begin perform public.fin__link_set_provider_order(la, ''); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL B1c: an empty order id accepted'; end if;
  perform public.fin__link_set_provider_order((lb ->> 'id')::uuid, 'ORD-B');

  -- B2: an altered or missing signed order id goes to review; nothing is recorded; another company's order id does not help
  r := public.fin__settle_payment_link('paymob', l ->> 'providerRef', 'PT-1', 1000, v_cur, true, false, 'ORD-SOMEONE-ELSE');
  if r ->> 'result' <> 'review' then raise exception 'FAIL B2a: altered order id: %', r; end if;
  if (select status from public.fin_payment_links where id = la) <> 'review' then raise exception 'FAIL B2b: link not in review'; end if;
  select count(*) into n from public.fin_payments where org_id = o and customer_invoice_id = cinv; if n <> 0 then raise exception 'FAIL B2c: a payment was recorded'; end if;
  update public.fin_payment_links set status = 'pending' where id = la;
  r := public.fin__settle_payment_link('paymob', l ->> 'providerRef', 'PT-2', 1000, v_cur, true, false);
  if r ->> 'result' <> 'review' then raise exception 'FAIL B2d: no order id: %', r; end if;
  update public.fin_payment_links set status = 'pending' where id = la;
  r := public.fin__settle_payment_link('paymob', l ->> 'providerRef', 'PT-3', 1000, v_cur, true, false, 'ORD-B');
  if r ->> 'result' <> 'review' then raise exception 'FAIL B2e: another company''s order id: %', r; end if;
  if (select status from public.fin_payment_links where id = (lb ->> 'id')::uuid) <> 'pending' then raise exception 'FAIL B2f: company B link touched'; end if;
  select count(*) into n from public.fin_payments where org_id in (o, ob); if n <> 0 then raise exception 'FAIL B2g: a payment was recorded'; end if;
  update public.fin_payment_links set status = 'pending' where id = la;

  -- B3: the matching id settles once
  r := public.fin__settle_payment_link('paymob', l ->> 'providerRef', 'PT-4', 1000, v_cur, true, false, 'ORD-A');
  if r ->> 'result' <> 'paid' then raise exception 'FAIL B3a: matching order id: %', r; end if;
  r := public.fin__settle_payment_link('paymob', l ->> 'providerRef', 'PT-4', 1000, v_cur, true, false, 'ORD-A');
  if r ->> 'result' <> 'duplicate' then raise exception 'FAIL B3b: replay: %', r; end if;
  select count(*) into n from public.fin_payments where org_id = o and customer_invoice_id = cinv and status = 'recorded'; if n <> 1 then raise exception 'FAIL B3c: % payments', n; end if;
  r := public.fin__settle_payment_link('paymob', l ->> 'providerRef', 'PT-5', 1000, v_cur, true, false, 'ORD-WRONG');
  if (select status from public.fin_payment_links where id = la) <> 'paid' then raise exception 'FAIL B3d: a paid link was moved: %', r; end if;
  select count(*) into n from public.fin_payments where org_id = o; if n <> 1 then raise exception 'FAIL B3e: % payments', n; end if;

  -- B4: a link made before 084 (no saved order id) behaves as before
  lc := gen_random_uuid();
  insert into public.fin_payment_links (id, org_id, invoice_id, provider, provider_ref, amount_minor, currency, created_by)
  values (lc, o, cinv, 'paymob', 'ERPLEGACY0000001', 500, v_cur, u);
  r := public.fin__settle_payment_link('paymob', 'ERPLEGACY0000001', 'PT-6', 500, v_cur, true, false);
  if r ->> 'result' <> 'paid' then raise exception 'FAIL B4a: a link without a saved id: %', r; end if;

  -- B5: company B's own matching callback still settles
  r := public.fin__settle_payment_link('paymob', lb ->> 'providerRef', 'PT-7', 1000, v_cur, true, false, 'ORD-B');
  if r ->> 'result' <> 'paid' then raise exception 'FAIL B5a: company B matching: %', r; end if;
  select count(*) into n from public.fin_payments where org_id = ob; if n <> 1 then raise exception 'FAIL B5b: % payments for B', n; end if;

  -- B6: users and anonymous cannot call the new functions
  if has_function_privilege('authenticated', 'public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean, text)', 'execute')
     or has_function_privilege('authenticated', 'public.fin__link_set_provider_order(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean, text)', 'execute')
     or has_function_privilege('anon', 'public.fin__link_set_provider_order(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.fin__link_set_provider_order(uuid, text)', 'execute') then
    raise exception 'FAIL B6a: function privileges';
  end if;
  set local role anon;
  ok := false; begin perform public.fin__link_set_provider_order(lc, 'X'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B6b: anon saved an order id'; end if;
  ok := false; begin perform public.fin__settle_payment_link('paymob', 'ERPLEGACY0000001', 'PT-8', 500, v_cur, true, false, 'X'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B6c: anon settled'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
