-- sql/tests/088_vat_prices_include.sql
-- VAT part 5 (sql/093): sales prices that include VAT. Always rolls back. Needs sql/001-093.
-- Covers: only the owner switches it (audited); an invoice line with the setting on splits its price into net and VAT (per line, half
-- away from zero) and records how it was typed; a credit note on it is split the same way; switching the setting off changes only new
-- invoices; with the setting on, VAT can be switched on while Shopify is on, and the setting cannot then be switched off.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; c uuid; so uuid; rq uuid; ol1 uuid; ol2 uuid; r14 uuid; r5 uuid; rb uuid;
  inv1 uuid; inv2 uuid; il1 uuid; cn uuid; v_net bigint; v_tax bigint; v_gross bigint; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'vpi-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'vpi-a@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'vpi-x@tests.invalid');
  o := public.bootstrap_organization('Incl VAT A', 'incl-vat-a', 'vpi-o@tests.invalid');
  ob := public.bootstrap_organization('Incl VAT B', 'incl-vat-b', 'vpi-x@tests.invalid');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  r14 := gen_random_uuid(); r5 := gen_random_uuid(); rb := gen_random_uuid();
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label, is_default) values
    (r14, o, 'T1', 'V009', 14, 'VAT 14%', true), (r5, o, 'T1', 'V010', 5, 'VAT 5%', false), (rb, ob, 'T1', 'V009', 14, 'VAT 14%', true);

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  -- ---- P1: only the owner switches it
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_set_prices_include_vat(true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1a: an admin switched prices to include VAT'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.core_set_vat(true, r14);
  perform public.core_set_prices_include_vat(true);
  perform public.core_set_prices_include_vat(true);   -- the same again: no second audit row
  -- fixtures: a delivered order (the admin approves the owner's stock request)
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('PI-1', 'Standard', null, 'piece', 10, w);
  i2 := public.inv_create_item('PI-2', 'Reduced', null, 'piece', 10, w);
  perform public.inv_set_item_vat_rate(i2, r5);
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 2, 'unitPriceMinor', 1140),
                                                        jsonb_build_object('itemId', i2, 'qty', 3, 'unitPriceMinor', 333))) ->> 'id')::uuid;
  rq := (public.sal_request_stock(so) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.inv_decide_request(rq, 'approved');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.inv_post_issue(rq);
  reset role;
  select id into ol1 from public.sal_order_lines where order_id = so and item_id = i1;
  select id into ol2 from public.sal_order_lines where order_id = so and item_id = i2;
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.prices_include_vat_changed';
  if n <> 1 then raise exception 'FAIL P1b: % audit rows, expected 1', n; end if;

  -- ---- P2: prices with VAT: 1 x 1140 at 14% = 1000 + 140; 3 x 333 = 999 at 5% = 951 + 48 (999 x 100 / 105 = 951.43)
  set local role authenticated;
  inv1 := (public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol1, 'qty', 1), jsonb_build_object('orderLineId', ol2, 'qty', 3))) ->> 'id')::uuid;
  reset role;
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_invoices where id = inv1;
  if (v_net, v_tax, v_gross) <> (1951, 188, 2139) then raise exception 'FAIL P2a: invoice %/%/%, expected 1951/188/2139', v_net, v_tax, v_gross; end if;
  select count(*) into n from public.sal_invoice_lines where invoice_id = inv1 and price_includes_vat and (
    (order_line_id = ol1 and net_minor = 1000 and tax_minor = 140) or (order_line_id = ol2 and net_minor = 951 and tax_minor = 48));
  if n <> 2 then raise exception 'FAIL P2b: % of 2 lines split as expected', n; end if;
  select id into il1 from public.sal_invoice_lines where invoice_id = inv1 and order_line_id = ol1;

  -- ---- P3: a credit note on an inclusive line is inclusive: 1 x 1140 = 1000 + 140
  set local role authenticated;
  cn := (public.sal_submit_note(inv1, 'credit', 'Returned', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1))) ->> 'id')::uuid;
  reset role;
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_notes where id = cn;
  if (v_net, v_tax, v_gross) <> (1000, 140, 1140) then raise exception 'FAIL P3: credit note %/%/%, expected 1000/140/1140', v_net, v_tax, v_gross; end if;

  -- ---- P4: switched off: the next invoice adds VAT on top (1140 + 159.6 -> 160); the first one is unchanged
  set local role authenticated;
  perform public.core_set_prices_include_vat(false);
  inv2 := (public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol1, 'qty', 1))) ->> 'id')::uuid;
  reset role;
  select net_minor, tax_minor into v_net, v_tax from public.sal_invoices where id = inv2;
  if (v_net, v_tax) <> (1140, 160) then raise exception 'FAIL P4a: invoice 2 %/%, expected 1140/160', v_net, v_tax; end if;
  select gross_minor into v_gross from public.sal_invoices where id = inv1;
  if v_gross <> 2139 then raise exception 'FAIL P4b: invoice 1 changed to %', v_gross; end if;

  -- ---- P5: Shopify with VAT when prices include VAT; the setting then stays on
  reset role;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings) values (ob, 'shopify', 'live', true, '{}'::jsonb);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_set_vat(true, rb); exception when others then ok := (sqlerrm = 'VAT_SHOPIFY_NOT_SUPPORTED'); end;
  if not ok then raise exception 'FAIL P5a: VAT with Shopify accepted while prices are before VAT'; end if;
  perform public.core_set_prices_include_vat(true);
  perform public.core_set_vat(true, rb);
  ok := false; begin perform public.core_set_prices_include_vat(false); exception when others then ok := (sqlerrm = 'VAT_SHOPIFY_NOT_SUPPORTED'); end;
  if not ok then raise exception 'FAIL P5b: prices switched back to before VAT while VAT and Shopify are on'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
