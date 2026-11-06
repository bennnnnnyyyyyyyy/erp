-- sql/tests/052_payment_links.sql
-- Payment links (sql/057). Always rolls back. Needs sql/001-057.
-- Covers: a link needs the provider switched on and an open invoice; amount limits; one open link per invoice and provider; the
-- signed callback path (settle) records one card payment, once, whatever the replays; failed, wrong amount, wrong currency, invoice
-- paid meanwhile, and a simulated callback on a real link all leave the books alone (review or refused); simulated links can be paid
-- by an owner or admin and say so; members and other companies see nothing; keys readable only by the server and only for a new
-- link; no anonymous use; every payment is audited.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid; cinv uuid; l jsonb; l2 jsonb; l3 uuid; r jsonb; n bigint; ok boolean; v_ref text; v_cur text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'pl-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'pl-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'pl-x@tests.invalid');
  o := public.bootstrap_organization('Links Test A', 'links-test-a', 'pl-o@tests.invalid');
  ob := public.bootstrap_organization('Links Test B', 'links-test-b', 'pl-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- fixture: a delivered and invoiced order, 10 x 250 = 2500
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('PL-1', 'Link item', null, 'piece', 50, w);
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cinv := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 10)))) ->> 'id')::uuid;

  -- ---- L1: creating links
  ok := false; begin perform public.fin_create_payment_link(cinv, 'paymob'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL L1a: a link without the provider switched on'; end if;
  ok := false; begin perform public.fin_create_payment_link(cinv, 'stripe'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL L1b: unknown provider'; end if;
  perform public.core_save_integration('paymob', true, 'simulated', null);
  l := public.fin_create_payment_link(cinv, 'paymob');
  if (l ->> 'amountMinor')::bigint <> 2500 or not (l ->> 'simulated')::boolean then raise exception 'FAIL L1c: link %', l; end if;
  ok := false; begin perform public.fin_create_payment_link(cinv, 'paymob', 2501); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL L1d: more than owed accepted'; end if;
  l2 := public.fin_create_payment_link(cinv, 'paymob', 1000);   -- cancels the first open link
  reset role;
  if (select status from public.fin_payment_links where id = (l ->> 'id')::uuid) <> 'cancelled' then raise exception 'FAIL L1e: older link still open'; end if;

  -- ---- L2: simulated payment by the owner records one card payment, once
  set local role authenticated;
  r := public.fin_simulate_pay_link((l2 ->> 'id')::uuid);
  if r ->> 'result' <> 'paid' then raise exception 'FAIL L2a: %', r; end if;
  reset role;
  select count(*) into n from public.fin_payments where org_id = o and customer_invoice_id = cinv and method = 'card' and amount_minor = 1000 and note like '%SIMULATED%';
  if n <> 1 then raise exception 'FAIL L2b: % simulated payments', n; end if;
  if public.fin__invoice_outstanding(o, cinv) <> 1500 then raise exception 'FAIL L2c: outstanding %', public.fin__invoice_outstanding(o, cinv); end if;
  set local role authenticated;
  ok := false; begin perform public.fin_simulate_pay_link((l2 ->> 'id')::uuid); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL L2d: a paid link paid again'; end if;
  reset role;

  -- ---- C1: real (non simulated) callbacks. Switch to live-style link by inserting directly as the server would have
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.core_save_integration('fawry', true, 'simulated', null);
  l := public.fin_create_payment_link(cinv, 'fawry', 1500);
  reset role;
  update public.fin_payment_links set simulated = false where id = (l ->> 'id')::uuid;   -- as if the company were live
  v_ref := l ->> 'providerRef';
  select currency into v_cur from public.sal_invoices where id = cinv;
  r := public.fin__settle_payment_link('fawry', v_ref, 'T-1', 1500, v_cur, true, true);
  if r ->> 'result' <> 'mode_mismatch' then raise exception 'FAIL C1a: simulated callback on a live link: %', r; end if;
  r := public.fin__settle_payment_link('fawry', v_ref, 'T-2', 1400, v_cur, true, false);
  if r ->> 'result' <> 'review' then raise exception 'FAIL C1b: wrong amount: %', r; end if;
  if (select status from public.fin_payment_links where provider_ref = v_ref) <> 'review' then raise exception 'FAIL C1c: link not in review'; end if;
  select count(*) into n from public.fin_payments where org_id = o and customer_invoice_id = cinv; if n <> 1 then raise exception 'FAIL C1d: a wrong amount recorded a payment'; end if;
  update public.fin_payment_links set status = 'pending' where provider_ref = v_ref;
  r := public.fin__settle_payment_link('fawry', v_ref, 'T-3', 1500, 'XXX', true, false);
  if r ->> 'result' <> 'review' then raise exception 'FAIL C1e: wrong currency: %', r; end if;
  update public.fin_payment_links set status = 'pending' where provider_ref = v_ref;
  r := public.fin__settle_payment_link('fawry', v_ref, 'T-4', 1500, v_cur, false, false);
  if r ->> 'result' <> 'failed' then raise exception 'FAIL C1f: failed payment: %', r; end if;
  r := public.fin__settle_payment_link('fawry', v_ref, 'T-5', 1500, v_cur, true, false);   -- a retry on the same link succeeds
  if r ->> 'result' <> 'paid' then raise exception 'FAIL C1g: retry after failure: %', r; end if;
  r := public.fin__settle_payment_link('fawry', v_ref, 'T-5', 1500, v_cur, true, false);
  if r ->> 'result' <> 'duplicate' then raise exception 'FAIL C1h: replay: %', r; end if;
  r := public.fin__settle_payment_link('fawry', v_ref, 'T-6', 1500, v_cur, true, false);   -- a second transaction for a paid link
  if r ->> 'result' <> 'already_paid' then raise exception 'FAIL C1i: second payment on a paid link: %', r; end if;
  select count(*) into n from public.fin_payments where org_id = o and customer_invoice_id = cinv and status = 'recorded'; if n <> 2 then raise exception 'FAIL C1j: % payments', n; end if;
  if public.fin__invoice_outstanding(o, cinv) <> 0 then raise exception 'FAIL C1k: invoice not fully paid'; end if;
  if (public.fin__settle_payment_link('fawry', 'NOSUCHREF000', 'T-9', 1, v_cur, true, false)) ->> 'result' <> 'unknown' then raise exception 'FAIL C1l: unknown reference'; end if;

  -- invoice paid another way while a link is open: review, no overpayment
  l3 := gen_random_uuid();
  insert into public.fin_payment_links (id, org_id, invoice_id, provider, provider_ref, amount_minor, currency, created_by)
  values (l3, o, cinv, 'paymob', 'ERPLATE000000001', 100, v_cur, u);
  r := public.fin__settle_payment_link('paymob', 'ERPLATE000000001', 'T-10', 100, v_cur, true, false);
  if r ->> 'result' <> 'review' then raise exception 'FAIL C2a: overpayment not held for review: %', r; end if;
  select count(*) into n from public.fin_payments where org_id = o and customer_invoice_id = cinv and status = 'recorded'; if n <> 2 then raise exception 'FAIL C2b: overpaid'; end if;

  -- audit
  select count(*) into n from public.audit_log where org_id = o and action = 'finance.payment.recorded' and summary like '%link%'; if n < 2 then raise exception 'FAIL A1: audit rows %', n; end if;

  -- ---- K1: keys
  if public.fin__link_credentials(l3) is not null then raise exception 'FAIL K1a: keys served for a link that is not pending'; end if;
  perform public.core_save_provider_fields('paymob', '{"secret_key": "sk_test_ZZZ"}');
  update public.fin_payment_links set status = 'pending', url = null where id = l3;
  if public.fin__link_credentials(l3) -> 'credentials' ->> 'secret_key' <> 'sk_test_ZZZ' then raise exception 'FAIL K1b: keys not served to the server for a new link'; end if;
  update public.fin_payment_links set created_at = now() - interval '1 hour' where id = l3;
  if public.fin__link_credentials(l3) is not null then raise exception 'FAIL K1c: keys served for an old link'; end if;

  -- ---- P1: members, other companies, anonymous
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.fin_create_payment_link(cinv, 'paymob'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1a: a member created a link'; end if;
  select count(*) into n from public.fin_payment_links; if n <> 0 then raise exception 'FAIL P1b: member sees links'; end if;
  ok := false; begin perform public.fin__settle_payment_link('fawry', v_ref, 'T-77', 1, v_cur, true, false); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P1c: a user called settle'; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.fin_payment_links; if n <> 0 then raise exception 'FAIL P2a: another company sees % links', n; end if;
  select count(*) into n from public.fin_payment_link_events; if n <> 0 then raise exception 'FAIL P2b: another company sees events'; end if;
  reset role;
  if has_function_privilege('anon', 'public.fin_create_payment_link(uuid, text, bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.fin__link_credentials(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.fin__callback_credentials(text, text)', 'execute') then
    raise exception 'FAIL P3: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
