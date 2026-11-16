-- sql/tests/083_vat_on_purchases.sql
-- VAT part 2 (sql/087). Always rolls back. Needs sql/001-087.
-- Covers: bill lines take a rate (item default, company default, given, exempt) and compute net and VAT; the VAT as printed is kept
-- within the tolerance and refused beyond it; deductible needs registration, VAT and a document reference, and defaults to that;
-- posting with input VAT (deductible) or VAT into cost (not deductible), balanced; the amount owed on a bill is its gross; expenses
-- with VAT as printed, checked against a rate; import and capital classes; amounts and VAT cannot be edited; rows written directly get
-- VAT 0; "VAT from" is set when VAT is switched on; audit rows; a company that is not registered cannot deduct.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  x uuid := gen_random_uuid();  -- owner, org B (not VAT registered)
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; r14 uuid; r5 uuid; sup uuid; supb uuid; po uuid; po2 uuid; pl1 uuid; pl2 uuid; pl3 uuid;
  b1 uuid; b2 uuid; b9 uuid; cat uuid; catb uuid; e1 uuid; e2 uuid; e3 uuid; e9 uuid; j jsonb; n bigint; ok boolean;
  v_net bigint; v_tax bigint; v_gross bigint; v_ded boolean; v_class text; v_ref text; v_tin text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'vatp-o@tests.invalid'), (x, 'authenticated', 'authenticated', 'vatp-x@tests.invalid');
  o := public.bootstrap_organization('VAT Purchases A', 'vat-purch-a', 'vatp-o@tests.invalid');
  ob := public.bootstrap_organization('VAT Purchases B', 'vat-purch-b', 'vatp-x@tests.invalid');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.acc__seed_chart(o);
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  r14 := gen_random_uuid(); r5 := gen_random_uuid();
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label, is_default) values
    (r14, o, 'T1', 'V009', 14, 'VAT 14%', true), (r5, o, 'T1', 'V010', 5, 'VAT 5%', false);

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  j := public.core_set_vat(true, r14);
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('P-1', 'Standard item', null, 'piece', 0, w);
  i2 := public.inv_create_item('P-2', 'Reduced item', null, 'piece', 0, w);
  sup := public.pur_create_supplier('VAT Supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 3, 'unitCostMinor', 333),
                                                          jsonb_build_object('itemId', i2, 'qty', 1, 'unitCostMinor', 1050))) ->> 'id')::uuid;
  perform public.pur_receive_order(po);
  po2 := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 2, 'unitCostMinor', 100))) ->> 'id')::uuid;
  perform public.pur_receive_order(po2);
  cat := public.fin_create_category('Rent');
  reset role;
  update public.pur_suppliers set tax_number = '100-200-300' where id = sup;
  update public.inv_items set default_tax_rate_id = r5 where id = i2;
  select id into pl1 from public.pur_order_lines where order_id = po and item_id = i1;
  select id into pl2 from public.pur_order_lines where order_id = po and item_id = i2;
  select id into pl3 from public.pur_order_lines where order_id = po2;

  -- ---- P1: "VAT from" is set when VAT is switched on
  if j ->> 'vatFrom' is null then raise exception 'FAIL P1a: no VAT-from date returned (%)', j; end if;
  select count(*) into n from public.organizations where id = o and settings ->> 'vat_from' = j ->> 'vatFrom';
  if n <> 1 then raise exception 'FAIL P1b: VAT-from date not stored'; end if;

  -- ---- P2: the printed VAT must be close to the computed VAT (1 minor unit per line, at least 5)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.pur_record_supplier_invoice(sup, po, 'S-1', current_date,
      jsonb_build_array(jsonb_build_object('orderLineId', pl1, 'qty', 3), jsonb_build_object('orderLineId', pl2, 'qty', 1)), jsonb_build_object('taxMinor', 300));
    exception when others then ok := (sqlerrm = 'VAT_MISMATCH'); end;
  if not ok then raise exception 'FAIL P2a: a printed VAT far from the lines was accepted'; end if;
  ok := false; begin perform public.pur_record_supplier_invoice(sup, po, 'S-1', current_date,
      jsonb_build_array(jsonb_build_object('orderLineId', pl1, 'qty', 3)), jsonb_build_object('vatClass', 'rent'));
    exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P2b: an unknown VAT class was accepted'; end if;
  -- lines: 999 at 14% = 139.86 -> 140 (company default), 1050 at 5% = 52.5 -> 53 (item default): 193 computed, 194 printed
  b1 := public.pur_record_supplier_invoice(sup, po, 'S-1', current_date,
          jsonb_build_array(jsonb_build_object('orderLineId', pl1, 'qty', 3), jsonb_build_object('orderLineId', pl2, 'qty', 1)),
          jsonb_build_object('taxMinor', 194, 'documentRef', 'ETA-UUID-0001'));
  -- deductible asked for without a document reference is refused
  ok := false; begin perform public.pur_record_supplier_invoice(sup, po2, 'S-2', current_date,
      jsonb_build_array(jsonb_build_object('orderLineId', pl3, 'qty', 2)), jsonb_build_object('deductible', true));
    exception when others then ok := (sqlerrm = 'VAT_NOT_DEDUCTIBLE'); end;
  if not ok then raise exception 'FAIL P2c: deductible VAT without the supplier''s e-invoice number was accepted'; end if;
  -- no reference: not deductible by default; 200 at 14% = 28
  b2 := public.pur_record_supplier_invoice(sup, po2, 'S-2', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pl3, 'qty', 2)));
  reset role;
  select net_minor, tax_minor, gross_minor, vat_deductible, vat_class, vat_document_ref, supplier_tax_number into v_net, v_tax, v_gross, v_ded, v_class, v_ref, v_tin
    from public.pur_supplier_invoices where id = b1;
  if (v_net, v_tax, v_gross) <> (2049, 194, 2243) or not v_ded or v_class <> 'local' or v_ref <> 'ETA-UUID-0001' or v_tin <> '100-200-300' then
    raise exception 'FAIL P2d: bill 1 is %/%/% deductible % class % ref % tin %', v_net, v_tax, v_gross, v_ded, v_class, v_ref, v_tin;
  end if;
  select count(*) into n from public.pur_supplier_invoices where id = b1 and line_tax_minor = 193;
  if n <> 1 then raise exception 'FAIL P2e: the computed VAT is not kept beside the printed one'; end if;
  select count(*) into n from public.pur_supplier_invoice_lines where invoice_id = b1 and (
    (order_line_id = pl1 and tax_rate_id = r14 and net_minor = 999 and tax_minor = 140) or (order_line_id = pl2 and tax_rate_id = r5 and net_minor = 1050 and tax_minor = 53));
  if n <> 2 then raise exception 'FAIL P2f: % of 2 bill lines have the expected rate and VAT', n; end if;
  select tax_minor, gross_minor, vat_deductible into v_tax, v_gross, v_ded from public.pur_supplier_invoices where id = b2;
  if v_tax <> 28 or v_gross <> 228 or v_ded then raise exception 'FAIL P2g: bill 2 VAT % gross % deductible %', v_tax, v_gross, v_ded; end if;

  -- ---- P3: posting: deductible VAT to input VAT; non-deductible VAT into the cost (price differences); balanced
  execute 'set constraints public.acc_post_pur_invoice immediate'; execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'supplier_invoice' and e.source_id = b1::text and
         ((ac.code = '282' and l.debit_minor = 2049) or (ac.code = '1811' and l.debit_minor = 194) or (ac.code = '281' and l.credit_minor = 2243 and l.party_id = sup) or ac.code = '334');
  if n <> 3 then raise exception 'FAIL P3a: bill 1 did not post 2049 GRNI / 194 input VAT / 2243 suppliers (% lines)', n; end if;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'supplier_invoice' and e.source_id = b2::text and
         ((ac.code = '282' and l.debit_minor = 200) or (ac.code = '334' and l.debit_minor = 28) or (ac.code = '281' and l.credit_minor = 228) or ac.code = '1811');
  if n <> 3 then raise exception 'FAIL P3b: bill 2 did not put its VAT into the cost (% lines)', n; end if;

  -- ---- P4: what is owed on a bill is its gross
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.fin_record_payment('out', 2244, current_date, 'cash', null, b1); exception when others then ok := (sqlerrm = 'OVERPAYMENT'); end;
  if not ok then raise exception 'FAIL P4a: a payment above the bill''s gross was accepted'; end if;
  perform public.fin_record_payment('out', 2243, current_date, 'cash', null, b1);

  -- ---- P5: expenses: VAT as printed, checked against a rate; deductible with a reference
  ok := false; begin perform public.fin_record_expense(current_date, cat, 1140, null, 'rent', jsonb_build_object('taxMinor', 100, 'taxRateId', r14));
    exception when others then ok := (sqlerrm = 'VAT_MISMATCH'); end;
  if not ok then raise exception 'FAIL P5a: an expense VAT far from its rate was accepted'; end if;
  ok := false; begin perform public.fin_record_expense(current_date, cat, 1140, null, 'rent', jsonb_build_object('taxMinor', 1140));
    exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P5b: an expense that is all VAT was accepted'; end if;
  e1 := (public.fin_record_expense(current_date, cat, 1140, null, 'November rent', jsonb_build_object('taxMinor', 140, 'taxRateId', r14, 'documentRef', 'ETA-RENT-11')) ->> 'id')::uuid;
  -- an import: customs declaration as the reference, the customs tax number typed
  e2 := (public.fin_record_expense(current_date, cat, 5000, null, 'Customs', jsonb_build_object('taxMinor', 600, 'vatClass', 'import', 'documentRef', 'DECL-77',
          'supplierTaxNumber', 'CUSTOMS')) ->> 'id')::uuid;
  -- a capital asset with no reference: class kept, not deductible
  e3 := (public.fin_record_expense(current_date, cat, 2280, sup, 'Machine', jsonb_build_object('taxMinor', 280, 'vatClass', 'capital')) ->> 'id')::uuid;
  j := public.insights_home();
  reset role;
  select net_minor, tax_minor, vat_deductible, vat_class into v_net, v_tax, v_ded, v_class from public.fin_expenses where id = e1;
  if (v_net, v_tax) <> (1000, 140) or not v_ded or v_class <> 'local' then raise exception 'FAIL P5c: rent expense %/% deductible % class %', v_net, v_tax, v_ded, v_class; end if;
  select count(*) into n from public.fin_expenses where id = e2 and vat_class = 'import' and vat_deductible and supplier_tax_number = 'CUSTOMS' and vat_document_ref = 'DECL-77';
  if n <> 1 then raise exception 'FAIL P5d: the import was not recorded as a deductible import'; end if;
  select count(*) into n from public.fin_expenses where id = e3 and vat_class = 'capital' and not vat_deductible and supplier_tax_number = '100-200-300';
  if n <> 1 then raise exception 'FAIL P5e: the capital purchase is wrong (class, deductible or supplier tax number)'; end if;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'expense' and e.source_id = e1::text and
         ((ac.code = '331' and l.debit_minor = 1000) or (ac.code = '1811' and l.debit_minor = 140) or (ac.code = '283' and l.credit_minor = 1140));
  if n <> 3 then raise exception 'FAIL P5f: the rent did not post 1000 / 140 input VAT / 1140 (% lines)', n; end if;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'expense' and e.source_id = e3::text and ((ac.code = '331' and l.debit_minor = 2280) or ac.code = '1811');
  if n <> 1 then raise exception 'FAIL P5g: the non-deductible VAT of the machine was not put into the cost'; end if;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  -- input VAT balance: 194 (bill 1) + 140 (rent) + 600 (import)
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into n from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id where l.org_id = o and ac.code = '1811';
  if n <> 934 then raise exception 'FAIL P5h: input VAT balance %, expected 934', n; end if;
  -- owner insights: what I owe = bill 2 (228) + the three expenses (1140 + 5000 + 2280); bill 1 is paid
  if (j ->> 'iOweMinor')::bigint <> 8648 then raise exception 'FAIL P5i: owner insights owe %, expected 8648', j ->> 'iOweMinor'; end if;

  -- ---- P6: amounts and VAT cannot be edited, even directly
  ok := false; begin update public.fin_expenses set tax_minor = 0, net_minor = amount_minor where id = e1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P6a: an expense''s VAT was edited'; end if;
  ok := false; begin update public.pur_supplier_invoices set vat_deductible = false where id = b1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P6b: a bill''s deductible flag was edited'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.fin_void_expense(e3);   -- voiding (status only) still works
  reset role;

  -- ---- P7: rows written directly get no VAT
  insert into public.fin_expenses (org_id, number, expense_date, category_id, amount_minor, currency, created_by) values (o, 'EXP-9901', current_date, cat, 500, 'EGP', u) returning id into e9;
  select net_minor, tax_minor, vat_deductible into v_net, v_tax, v_ded from public.fin_expenses where id = e9;
  if (v_net, v_tax) <> (500, 0) or v_ded then raise exception 'FAIL P7a: a direct expense got %/% deductible %', v_net, v_tax, v_ded; end if;
  b9 := gen_random_uuid();
  insert into public.pur_supplier_invoices (id, org_id, number, supplier_id, order_id, invoice_date, currency, created_by) values (b9, o, 'S-9901', sup, po2, current_date, 'EGP', u);
  insert into public.pur_supplier_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_cost_minor, tax_rate, net_minor) values (o, b9, pl3, 1.5, 101, 14, 1);
  select net_minor, line_tax_minor, tax_minor, gross_minor into v_net, n, v_tax, v_gross from public.pur_supplier_invoices where id = b9;
  if (v_net, n, v_tax, v_gross) <> (152, 21, 0, 152) then raise exception 'FAIL P7b: a direct bill gave %/%/%/%', v_net, n, v_tax, v_gross; end if;

  -- ---- P8: audit rows carry the VAT
  select count(*) into n from public.audit_log where org_id = o and action = 'purchasing.supplier_invoice.recorded' and entity_id = b1::text
     and (after ->> 'tax_minor')::bigint = 194 and (after ->> 'computed_tax_minor')::bigint = 193 and (after ->> 'vat_deductible')::boolean;
  if n <> 1 then raise exception 'FAIL P8a: the bill audit row lacks its VAT'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'finance.expense.recorded' and entity_id = e2::text and after ->> 'vatClass' = 'import';
  if n <> 1 then raise exception 'FAIL P8b: the expense audit row lacks its VAT class'; end if;

  -- ---- P9: a company that is not VAT registered pays VAT as cost and cannot deduct it; it cannot see A's bills
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  catb := public.fin_create_category('Rent B');
  ok := false; begin perform public.fin_record_expense(current_date, catb, 1140, null, 'rent', jsonb_build_object('taxMinor', 140, 'documentRef', 'X', 'deductible', true));
    exception when others then ok := (sqlerrm = 'VAT_NOT_DEDUCTIBLE'); end;
  if not ok then raise exception 'FAIL P9a: a company that is not registered deducted VAT'; end if;
  e9 := (public.fin_record_expense(current_date, catb, 1140, null, 'rent', jsonb_build_object('taxMinor', 140, 'documentRef', 'X')) ->> 'id')::uuid;
  select count(*) into n from public.pur_supplier_invoices where org_id = o;
  if n <> 0 then raise exception 'FAIL P9b: company B sees A''s bills'; end if;
  reset role;
  select count(*) into n from public.fin_expenses where id = e9 and not vat_deductible and tax_minor = 140;
  if n <> 1 then raise exception 'FAIL P9c: the unregistered company''s VAT was marked deductible'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
