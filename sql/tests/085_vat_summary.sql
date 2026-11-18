-- sql/tests/085_vat_summary.sql
-- VAT part 3 (sql/089): known-answer test for fin_vat_summary. Always rolls back. Needs sql/001-089.
-- One month with: an invoice at 14%, 5%, 0% export and exempt; an approved credit note (a waiting one is left out); an invoice in the
-- month before, a void one and one in another currency (all left out); a bill mixing goods and a machine with VAT as printed
-- (deductible); an import (deductible) and an expense whose VAT is not deductible. Checks every section, the totals, the warnings,
-- the documents, who may read it, and that another company sees none of it.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  a uuid := gen_random_uuid();  -- admin, org A
  m uuid := gen_random_uuid();  -- member, org A
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid; c uuid; so uuid; sol1 uuid; sol2 uuid; sol3 uuid; sol4 uuid; r14 uuid; r5 uuid; r0 uuid;
  inv1 uuid; inv2 uuid; inv3 uuid; inv4 uuid; il1 uuid; cn uuid; sup uuid; po uuid; pl1 uuid; pl2 uuid; cat uuid;
  v_month date; v_end date; j jsonb; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'vs-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'vs-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'vs-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'vs-x@tests.invalid');
  o := public.bootstrap_organization('VAT Summary A', 'vat-sum-a', 'vs-o@tests.invalid');
  ob := public.bootstrap_organization('VAT Summary B', 'vat-sum-b', 'vs-x@tests.invalid');
  -- the company currency is set explicitly: the column default on live is not EGP (found 16 Nov), and the summary counts only it
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  v_month := date_trunc('month', public.acc__local_date(o, now()))::date;
  v_end := (v_month + interval '1 month')::date - 1;
  r14 := gen_random_uuid(); r5 := gen_random_uuid(); r0 := gen_random_uuid();
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label, is_default) values
    (r14, o, 'T1', 'V009', 14, 'VAT 14%', true), (r5, o, 'T1', 'V010', 5, 'VAT 5%', false), (r0, o, 'T1', 'V001', 0, 'Export 0%', false);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  perform public.core_set_vat(true, r14);   -- VAT from the first of this month
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('S-1', 'Goods', null, 'piece', 0, w);
  i2 := public.inv_create_item('S-2', 'Machine', null, 'piece', 0, w);
  i3 := public.inv_create_item('S-3', 'Export goods', null, 'piece', 0, w);
  i4 := public.inv_create_item('S-4', 'Exempt goods', null, 'piece', 0, w);
  c := public.sal_create_customer('Customer', null, null, null);
  sup := public.pur_create_supplier('Supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10, 'unitCostMinor', 100),
                                                          jsonb_build_object('itemId', i2, 'qty', 1, 'unitCostMinor', 5000))) ->> 'id')::uuid;
  perform public.pur_receive_order(po);
  cat := public.fin_create_category('Customs');
  reset role;
  update public.pur_suppliers set tax_number = '111-222-333' where id = sup;
  select id into pl1 from public.pur_order_lines where order_id = po and item_id = i1;
  select id into pl2 from public.pur_order_lines where order_id = po and item_id = i2;

  -- ---- sales fixtures (written directly: invoicing is tested in 018 and 082; the line trigger computes net and VAT)
  so := gen_random_uuid(); sol1 := gen_random_uuid(); sol2 := gen_random_uuid(); sol3 := gen_random_uuid(); sol4 := gen_random_uuid();
  insert into public.sal_orders (id, org_id, number, customer_id, warehouse_id, status, currency, created_by) values (so, o, 'SO-1', c, w, 'stock_requested', 'EGP', u);
  insert into public.sal_order_lines (id, org_id, order_id, item_id, qty, unit_price_minor) values
    (sol1, o, so, i1, 100, 1000), (sol2, o, so, i2, 100, 2000), (sol3, o, so, i3, 100, 3000), (sol4, o, so, i4, 100, 500);
  inv1 := gen_random_uuid(); inv2 := gen_random_uuid(); inv3 := gen_random_uuid(); inv4 := gen_random_uuid(); il1 := gen_random_uuid();
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by, status) values
    (inv1, o, 'INV-1', so, c, v_month, 'EGP', u, 'issued'), (inv2, o, 'INV-2', so, c, v_month - 1, 'EGP', u, 'issued'),
    (inv3, o, 'INV-3', so, c, v_month, 'EGP', u, 'issued'), (inv4, o, 'INV-4', so, c, v_month, 'USD', u, 'issued');
  insert into public.sal_invoice_lines (id, org_id, invoice_id, order_line_id, qty, unit_price_minor, tax_rate_id, tax_rate) values
    (il1, o, inv1, sol1, 10, 1000, r14, 14),              -- 10000 + 1400
    (gen_random_uuid(), o, inv1, sol2, 1, 2000, r5, 5),    -- 2000 + 100
    (gen_random_uuid(), o, inv1, sol3, 1, 3000, r0, 0),    -- 3000 export
    (gen_random_uuid(), o, inv1, sol4, 1, 500, null, 0),   -- 500 exempt
    (gen_random_uuid(), o, inv2, sol1, 1, 1000, r14, 14),  -- last month: out
    (gen_random_uuid(), o, inv3, sol1, 1, 1000, r14, 14),  -- voided below: out
    (gen_random_uuid(), o, inv4, sol1, 1, 1000, r14, 14);  -- USD: out
  update public.sal_invoices set status = 'void', voided_at = now(), voided_by = u where id = inv3;
  -- an approved credit note: 1 x 1000 at 14% = 1000 + 140; and a waiting one (left out)
  cn := gen_random_uuid();
  insert into public.sal_notes (id, org_id, number, kind, invoice_id, customer_id, currency, reason, status, total_minor, net_minor, tax_minor, gross_minor,
                                requester_id, decided_by, decided_at)
  values (cn, o, 'CN-1', 'credit', inv1, c, 'EGP', 'damaged', 'approved', 1140, 1000, 140, 1140, m, a, now());
  insert into public.sal_note_lines (org_id, note_id, invoice_line_id, qty, unit_price_minor, tax_rate_id, tax_rate) values (o, cn, il1, 1, 1000, r14, 14);
  insert into public.sal_notes (id, org_id, number, kind, invoice_id, customer_id, currency, reason, status, total_minor, requester_id)
  values (gen_random_uuid(), o, 'CN-2', 'credit', inv1, c, 'EGP', 'waiting', 'submitted', 500, m);

  -- ---- purchases: a mixed bill, VAT printed 841 (computed 140 + 700), deductible; an import; a non-deductible expense
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.pur_record_supplier_invoice(sup, po, 'B-1', v_month,
    jsonb_build_array(jsonb_build_object('orderLineId', pl1, 'qty', 10), jsonb_build_object('orderLineId', pl2, 'qty', 1, 'vatClass', 'capital')),
    jsonb_build_object('taxMinor', 841, 'documentRef', 'ETA-B1'));
  perform public.fin_record_expense(v_month, cat, 5600, null, 'Customs', jsonb_build_object('taxMinor', 600, 'vatClass', 'import', 'documentRef', 'DECL-1', 'supplierTaxNumber', '999888777'));
  perform public.fin_record_expense(v_month, cat, 1140, null, 'Taxi', jsonb_build_object('taxMinor', 140));

  -- ---- S1: the summary for this month
  j := public.fin_vat_summary(v_month, v_end);
  reset role;
  -- sales: 14% 10000/1400 less the note 1000/140 = 9000/1260; 5% 2000/100; export 3000; exempt 500
  select count(*) into n from jsonb_array_elements(j -> 'sales') s where
    (s ->> 'kind' = 'taxable' and (s ->> 'rate')::numeric = 14 and (s ->> 'invoicesNetMinor')::bigint = 10000 and (s ->> 'invoicesTaxMinor')::bigint = 1400
       and (s ->> 'notesNetMinor')::bigint = -1000 and (s ->> 'notesTaxMinor')::bigint = -140 and (s ->> 'netMinor')::bigint = 9000 and (s ->> 'taxMinor')::bigint = 1260)
    or (s ->> 'kind' = 'taxable' and (s ->> 'rate')::numeric = 5 and (s ->> 'netMinor')::bigint = 2000 and (s ->> 'taxMinor')::bigint = 100)
    or (s ->> 'kind' = 'zero_rated' and (s ->> 'netMinor')::bigint = 3000 and (s ->> 'taxMinor')::bigint = 0)
    or (s ->> 'kind' = 'exempt' and (s ->> 'netMinor')::bigint = 500 and (s ->> 'taxMinor')::bigint = 0);
  if n <> 4 or jsonb_array_length(j -> 'sales') <> 4 then raise exception 'FAIL S1a: sales sections wrong (% matched): %', n, j -> 'sales'; end if;
  -- purchases: local 1000 bill + 1000 taxi, 140 deductible + 140 not; capital 5000 with 701 (its share of the printed 841); import 5000/600
  select count(*) into n from jsonb_array_elements(j -> 'purchases') s where
    (s ->> 'kind' = 'local' and (s ->> 'netMinor')::bigint = 2000 and (s ->> 'deductibleTaxMinor')::bigint = 140 and (s ->> 'nonDeductibleTaxMinor')::bigint = 140)
    or (s ->> 'kind' = 'capital' and (s ->> 'netMinor')::bigint = 5000 and (s ->> 'deductibleTaxMinor')::bigint = 701 and (s ->> 'nonDeductibleTaxMinor')::bigint = 0)
    or (s ->> 'kind' = 'import' and (s ->> 'netMinor')::bigint = 5000 and (s ->> 'deductibleTaxMinor')::bigint = 600);
  if n <> 3 or jsonb_array_length(j -> 'purchases') <> 3 then raise exception 'FAIL S1b: purchase sections wrong (% matched): %', n, j -> 'purchases'; end if;
  -- totals: output 1400 + 100 - 140 = 1360; input 140 + 701 + 600 = 1441; a credit of 81
  if (j ->> 'outputTaxMinor')::bigint <> 1360 or (j ->> 'inputTaxMinor')::bigint <> 1441 or (j ->> 'dueMinor')::bigint <> -81 then
    raise exception 'FAIL S1c: totals % / % / %, expected 1360 / 1441 / -81', j ->> 'outputTaxMinor', j ->> 'inputTaxMinor', j ->> 'dueMinor';
  end if;
  -- warnings: partial deduction (taxable and exempt sales), another currency (1); not before VAT
  -- (sql/094: supplier notes are included, so the 'excludes_supplier_credit_notes' warning no longer appears)
  if not (j -> 'warnings' ? 'partial_deduction' and j -> 'warnings' ? 'other_currency') or j -> 'warnings' ? 'excludes_supplier_credit_notes'
     or j -> 'warnings' ? 'before_vat_from' or j -> 'warnings' ? 'not_registered' or (j ->> 'otherCurrencyDocuments')::int <> 1 then
    raise exception 'FAIL S1d: warnings %', j -> 'warnings';
  end if;
  -- documents: invoice 1 in 4 sections, the credit note, the bill in 2, the two expenses; none of the left-out ones
  if jsonb_array_length(j -> 'documents') <> 9 then raise exception 'FAIL S1e: % documents, expected 9', jsonb_array_length(j -> 'documents'); end if;
  select count(*) into n from jsonb_array_elements(j -> 'documents') d where d ->> 'number' in ('INV-2', 'INV-3', 'INV-4', 'CN-2');
  if n <> 0 then raise exception 'FAIL S1f: a left-out document is listed'; end if;

  -- ---- S2: a period that starts before VAT; bad periods
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.fin_vat_summary(v_month - 31, v_end);   -- an admin may read it
  if not (j -> 'warnings' ? 'before_vat_from') then raise exception 'FAIL S2a: a period before VAT was not flagged'; end if;
  ok := false; begin perform public.fin_vat_summary(v_end, v_month); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S2b: a period ending before it starts was accepted'; end if;
  ok := false; begin perform public.fin_vat_summary(v_month - 800, v_end); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S2c: a period of over a year was accepted'; end if;
  -- ---- S3: members cannot read it
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.fin_vat_summary(v_month, v_end); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S3: a member read the VAT summary'; end if;
  -- ---- S4: another company sees an empty summary (and is not registered)
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  j := public.fin_vat_summary(v_month, v_end);
  reset role;
  if jsonb_array_length(j -> 'documents') <> 0 or (j ->> 'outputTaxMinor')::bigint <> 0 or not (j -> 'warnings' ? 'not_registered') then
    raise exception 'FAIL S4: company B sees %', j;
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
