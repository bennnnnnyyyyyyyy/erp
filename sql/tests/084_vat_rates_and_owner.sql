-- sql/tests/084_vat_rates_and_owner.sql
-- sql/088. Always rolls back. Needs sql/001-088.
-- Covers: VAT rates managed without e-invoicing (create, change, default, 0% export, names unique, removal refused while used or the
-- default); only an owner switches VAT; no rate added automatically; "VAT from" defaults to the first of the month and a mid-month
-- date is flagged; VAT cannot be switched on while Shopify is on, and a Shopify order cannot be invoiced while VAT is on; the kind of
-- purchase per bill line ('mixed' on the bill); non-deductible VAT raises the item's average cost and posts to stock, or to cost of
-- goods sold when nothing is on hand; a deduction needs a 9-digit supplier tax number, stored as digits; audit rows; isolation.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  a uuid := gen_random_uuid();  -- admin, org A
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; sup uuid; po uuid; pl1 uuid; pl2 uuid; r14 uuid; r0 uuid; b1 uuid; b2 uuid; po2 uuid; pl3 uuid;
  c uuid; so uuid; rq uuid; ol uuid; j jsonb; n bigint; ok boolean; v_avg bigint; v_text text; v_month date; v_mid date;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'vr-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'vr-a@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'vr-x@tests.invalid');
  o := public.bootstrap_organization('VAT Rates A', 'vat-rates-a', 'vr-o@tests.invalid');
  ob := public.bootstrap_organization('VAT Rates B', 'vat-rates-b', 'vr-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.acc__seed_chart(o);
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  v_month := date_trunc('month', public.acc__local_date(o, now()))::date;
  v_mid := v_month - 15;   -- the 14th-17th of the previous month: never the 1st

  -- ---- R1: no rate yet: switching VAT on is refused, nothing is added
  set local role authenticated;
  ok := false; begin perform public.core_set_vat(true); exception when others then ok := (sqlerrm = 'VAT_RATE_MISSING'); end;
  if not ok then raise exception 'FAIL R1a: VAT switched on with no rate'; end if;
  -- ---- R2: rates without the e-invoicing module (an admin may manage rates)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r14 := public.core_save_vat_rate(null, 'V009', 14, 'Standard 14%', true);
  r0 := public.core_save_vat_rate(null, 'V001', 0, 'Export 0%', false);
  ok := false; begin perform public.core_save_vat_rate(null, 'W001', 5, 'Not VAT', false); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R2a: a non-VAT sub-type was accepted'; end if;
  ok := false; begin perform public.core_save_vat_rate(null, 'V009', 14, 'standard 14%', false); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R2b: two rates with the same name'; end if;
  ok := false; begin perform public.core_save_vat_rate(null, 'V009', 140, 'Too much', false); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R2c: a rate above 100 was accepted'; end if;
  perform public.core_save_vat_rate(r14, 'V009', 14, 'VAT 14%', true);   -- rename
  -- ---- R3: only an owner switches VAT on
  ok := false; begin perform public.core_set_vat(true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R3a: an admin switched VAT on'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  -- ---- R4: Shopify on: VAT refused
  reset role;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings) values (o, 'shopify', 'live', true, '{}'::jsonb);
  set local role authenticated;
  ok := false; begin perform public.core_set_vat(true); exception when others then ok := (sqlerrm = 'VAT_SHOPIFY_NOT_SUPPORTED'); end;
  if not ok then raise exception 'FAIL R4a: VAT switched on while Shopify is on'; end if;
  reset role;
  update public.core_integrations set enabled = false where org_id = o and kind = 'shopify';
  set local role authenticated;
  -- ---- R5: "VAT from": first of the month by default; another day flagged
  j := public.core_set_vat(true);
  if j ->> 'defaultVatRateId' <> r14::text or (j ->> 'vatFrom')::date <> v_month or (j ->> 'vatFromMidMonth')::boolean then
    raise exception 'FAIL R5a: %', j;
  end if;
  ok := false; begin perform public.core_set_vat(true, r14, current_date + 40); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R5b: a VAT start in the future was accepted'; end if;
  j := public.core_set_vat(true, r14, v_mid);
  if (j ->> 'vatFromMidMonth')::boolean is not true or (j ->> 'vatFrom')::date <> v_mid then raise exception 'FAIL R5c: mid-month start not flagged (%)', j; end if;
  -- ---- R6: a rate in use cannot be removed
  ok := false; begin perform public.core_remove_vat_rate(r14); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL R6a: the default VAT rate was removed'; end if;
  perform public.core_remove_vat_rate(r0);
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action in ('tax.vat_rate.created', 'tax.vat_rate.updated', 'tax.vat_rate.removed');
  if n <> 4 then raise exception 'FAIL R6b: % rate audit rows, expected 4', n; end if;

  -- ---- fixtures for purchases: two items, one with stock, a supplier with a formatted tax number, a received order with both
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('M-1', 'Goods', null, 'piece', 0, w);
  i2 := public.inv_create_item('M-2', 'Machine', null, 'piece', 0, w);
  sup := public.pur_create_supplier('Mixed Supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10, 'unitCostMinor', 100),
                                                          jsonb_build_object('itemId', i2, 'qty', 1, 'unitCostMinor', 5000))) ->> 'id')::uuid;
  perform public.pur_receive_order(po);
  reset role;
  update public.pur_suppliers set tax_number = '12345678' where id = sup;   -- 8 digits: not a valid registration number
  select id into pl1 from public.pur_order_lines where order_id = po and item_id = i1;
  select id into pl2 from public.pur_order_lines where order_id = po and item_id = i2;

  -- ---- P1: a deduction needs a 9-digit tax number
  set local role authenticated;
  ok := false; begin perform public.pur_record_supplier_invoice(sup, po, 'M-1', current_date,
      jsonb_build_array(jsonb_build_object('orderLineId', pl1, 'qty', 10)), jsonb_build_object('documentRef', 'ETA-1', 'deductible', true));
    exception when others then ok := (sqlerrm = 'VAT_NOT_DEDUCTIBLE'); end;
  if not ok then raise exception 'FAIL P1a: VAT deducted without a valid supplier tax number'; end if;
  -- ---- P2: kind per line; not deductible (8-digit number): VAT 140 + 700 = 840 into the cost of the goods
  b1 := public.pur_record_supplier_invoice(sup, po, 'M-1', current_date,
          jsonb_build_array(jsonb_build_object('orderLineId', pl1, 'qty', 10), jsonb_build_object('orderLineId', pl2, 'qty', 1, 'vatClass', 'capital')),
          jsonb_build_object('documentRef', 'ETA-1'));
  reset role;
  select vat_class into v_text from public.pur_supplier_invoices where id = b1;
  if v_text <> 'mixed' then raise exception 'FAIL P2a: the bill kind is %, expected mixed', v_text; end if;
  select count(*) into n from public.pur_supplier_invoice_lines where invoice_id = b1 and
    ((order_line_id = pl1 and vat_class = 'local' and cost_vat_minor = 140 and cost_vat_to = 'inventory') or
     (order_line_id = pl2 and vat_class = 'capital' and cost_vat_minor = 700 and cost_vat_to = 'inventory'));
  if n <> 2 then raise exception 'FAIL P2b: % of 2 lines have their kind and VAT share', n; end if;
  select avg_cost_minor into v_avg from public.inv_items where id = i1;
  if v_avg <> 114 then raise exception 'FAIL P2c: average cost %, expected 114 (100 + 140 VAT over 10)', v_avg; end if;
  select avg_cost_minor into v_avg from public.inv_items where id = i2;
  if v_avg <> 5700 then raise exception 'FAIL P2d: machine average cost %, expected 5700', v_avg; end if;
  select count(*) into n from public.inv_cost_log where org_id = o and source = 'purchase_vat' and ref = 'M-1';
  if n <> 2 then raise exception 'FAIL P2e: % purchase VAT cost-log rows, expected 2', n; end if;
  execute 'set constraints public.acc_post_pur_invoice immediate'; execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'supplier_invoice' and e.source_id = b1::text and
         ((ac.code = '161' and l.debit_minor = 140 and l.item_id = i1) or (ac.code = '161' and l.debit_minor = 700 and l.item_id = i2)
          or (ac.code = '281' and l.credit_minor = 6840) or ac.code in ('334', '1811'));
  if n <> 3 then raise exception 'FAIL P2f: the bill did not post its VAT to stock per item (% lines)', n; end if;

  -- ---- P3: nothing on hand: non-deductible VAT goes to cost of goods sold; a 9-digit number allows a deduction, stored as digits
  set local role authenticated;
  c := public.sal_create_customer('Buyer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 1, 'unitPriceMinor', 9000))) ->> 'id')::uuid;
  rq := (public.sal_request_stock(so) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_post_issue(rq);
  po2 := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 1, 'unitCostMinor', 1000))) ->> 'id')::uuid;
  reset role;
  -- receive it and send it straight back out, so the bill finds none on hand
  set local role authenticated; perform public.pur_receive_order(po2); reset role;
  select id into pl3 from public.pur_order_lines where order_id = po2;
  update public.inv_stock_balances set on_hand = 0 where org_id = o and item_id = i2;
  set local role authenticated;
  b2 := public.pur_record_supplier_invoice(sup, po2, 'M-2', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pl3, 'qty', 1)));
  ok := false; begin perform public.fin_record_expense(current_date, public.fin_create_category('Rent'), 1140, null, 'rent',
      jsonb_build_object('taxMinor', 140, 'documentRef', 'ETA-R', 'supplierTaxNumber', '123-456-789', 'deductible', true));
    exception when others then ok := false; raise; end;
  reset role;
  select count(*) into n from public.pur_supplier_invoice_lines where invoice_id = b2 and cost_vat_minor = 140 and cost_vat_to = 'cogs';
  if n <> 1 then raise exception 'FAIL P3a: VAT on goods no longer on hand did not go to cost of goods sold'; end if;
  select count(*) into n from public.fin_expenses where org_id = o and vat_deductible and supplier_tax_number = '123456789';
  if n <> 1 then raise exception 'FAIL P3b: the 9-digit number was not accepted or not stored as digits'; end if;

  -- ---- P4: a Shopify order cannot be invoiced while VAT is on
  reset role;
  insert into public.sal_shopify_orders (org_id, shopify_order_id, shopify_name, status, sales_order_id, simulated, total_minor, currency)
  values (o, '9001', '#9001', 'imported', so, false, 9000, 'EGP');
  select id into ol from public.sal_order_lines where order_id = so;
  set local role authenticated;
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1)));
    exception when others then ok := (sqlerrm = 'VAT_SHOPIFY_NOT_SUPPORTED'); end;
  reset role;
  if not ok then raise exception 'FAIL P4a: a Shopify order was invoiced with VAT on'; end if;

  -- ---- P5: another company cannot change or see A's rates
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_save_vat_rate(r14, 'V009', 10, 'Hijack', false); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P5a: company B changed company A''s rate'; end if;
  ok := false; begin perform public.core_remove_vat_rate(r14); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P5b: company B removed company A''s rate'; end if;
  select count(*) into n from public.tax_rates where org_id = o;
  if n <> 0 then raise exception 'FAIL P5c: company B sees A''s rates'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
