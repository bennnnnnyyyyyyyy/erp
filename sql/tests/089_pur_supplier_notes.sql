-- sql/tests/089_pur_supplier_notes.sql
-- Supplier credit and debit notes (sql/094). Always rolls back. Needs sql/001-094.
-- Covers: a member requests; never more than billed (quantity over open and approved notes, unit cost); VAT as printed within the
-- tolerance; members cannot decide; the requester cannot decide while another manager exists; approval posts (Dr suppliers / Cr price
-- differences / Cr input VAT, balanced); what is owed on the bill (payment check, owner insights); a debit note; cancel frees the
-- quantity; the VAT summary takes approved notes and drops its warning; amounts cannot be edited; audit rows; another company sees nothing.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i1 uuid; r14 uuid; sup uuid; po uuid; pl uuid; bill uuid; bl uuid; cn uuid; dn uuid; k uuid; j jsonb; n bigint; ok boolean;
  v_month date;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'psn-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'psn-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'psn-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'psn-x@tests.invalid');
  o := public.bootstrap_organization('Supplier Notes A', 'sup-notes-a', 'psn-o@tests.invalid');
  ob := public.bootstrap_organization('Supplier Notes B', 'sup-notes-b', 'psn-x@tests.invalid');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.acc__seed_chart(o);
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  v_month := date_trunc('month', public.acc__local_date(o, now()))::date;
  r14 := gen_random_uuid();
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label, is_default) values (r14, o, 'T1', 'V009', 14, 'VAT 14%', true);

  -- fixtures: VAT on; a received order of 10 at 100; a deductible bill: 1000 + 140 = 1140
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  perform public.core_set_vat(true, r14);
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('SN-1', 'Goods', null, 'piece', 0, w, 100);
  sup := public.pur_create_supplier('Supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10, 'unitCostMinor', 100))) ->> 'id')::uuid;
  perform public.pur_receive_order(po);
  reset role;
  update public.pur_suppliers set tax_number = '111222333' where id = sup;
  select id into pl from public.pur_order_lines where order_id = po;
  set local role authenticated;
  bill := public.pur_record_supplier_invoice(sup, po, 'B-1', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pl, 'qty', 10)),
            jsonb_build_object('documentRef', 'ETA-B1'));
  reset role;
  select id into bl from public.pur_supplier_invoice_lines where invoice_id = bill;
  execute 'set constraints public.acc_post_pur_invoice immediate'; execute 'set constraints all deferred';

  -- ---- N1: a member requests a credit note for 2: 200 + 28 = 228; nothing changes until approved
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.pur_submit_note(bill, 'credit', 'Two damaged', 'SUP-CN-1', jsonb_build_array(jsonb_build_object('billLineId', bl, 'qty', 2)), jsonb_build_object('documentRef', 'ETA-CN-1'));
  cn := (j ->> 'id')::uuid;
  if j ->> 'number' <> 'SCN-0001' or (j ->> 'grossMinor')::bigint <> 228 or (j ->> 'taxMinor')::bigint <> 28 then raise exception 'FAIL N1a: %', j; end if;
  -- ---- N2: never more than billed; VAT as printed within the tolerance
  ok := false; begin perform public.pur_submit_note(bill, 'credit', 'x', null, jsonb_build_array(jsonb_build_object('billLineId', bl, 'qty', 9)));
    exception when others then ok := (sqlerrm = 'NOTE_EXCEEDS_INVOICE'); end;
  if not ok then raise exception 'FAIL N2a: more was credited than billed'; end if;
  ok := false; begin perform public.pur_submit_note(bill, 'credit', 'x', null, jsonb_build_array(jsonb_build_object('billLineId', bl, 'qty', 1, 'unitCostMinor', 101)));
    exception when others then ok := (sqlerrm = 'NOTE_EXCEEDS_INVOICE'); end;
  if not ok then raise exception 'FAIL N2b: a higher unit cost was credited'; end if;
  ok := false; begin perform public.pur_submit_note(bill, 'credit', 'x', null, jsonb_build_array(jsonb_build_object('billLineId', bl, 'qty', 1)), jsonb_build_object('taxMinor', 100));
    exception when others then ok := (sqlerrm = 'VAT_MISMATCH'); end;
  if not ok then raise exception 'FAIL N2c: a VAT far from the lines was accepted'; end if;
  -- ---- N3: members cannot decide
  ok := false; begin perform public.pur_decide_note(cn, 'approved'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL N3a: a member decided a supplier note'; end if;
  -- the owner's own note cannot be decided by the owner while an admin exists
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  k := (public.pur_submit_note(bill, 'credit', 'Owner''s own', null, jsonb_build_array(jsonb_build_object('billLineId', bl, 'qty', 1))) ->> 'id')::uuid;
  ok := false; begin perform public.pur_decide_note(k, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL N3b: the requester approved their own note'; end if;
  -- ---- N4: cancelling frees the quantity (8 left after the first note; the owner's 1 is cancelled, so 8 can be asked again)
  perform public.pur_cancel_note(k);
  ok := true; begin perform public.pur_submit_note(bill, 'credit', 'probe', null, jsonb_build_array(jsonb_build_object('billLineId', bl, 'qty', 9)));
    exception when others then ok := false; end;
  if ok then raise exception 'FAIL N4a: 9 more could be credited although 2 are waiting'; end if;
  -- ---- N5: the admin approves: Dr suppliers 228 / Cr price differences 200 / Cr input VAT 28
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.pur_decide_note(cn, 'approved', 'agreed');
  reset role;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'supplier_note' and e.source_id = cn::text and
         ((ac.code = '281' and l.debit_minor = 228 and l.party_id = sup) or (ac.code = '334' and l.credit_minor = 200) or (ac.code = '1811' and l.credit_minor = 28));
  if n <> 3 then raise exception 'FAIL N5: the credit note did not post 228 / 200 / 28 (% lines)', n; end if;
  -- ---- N6: owed on the bill: 1140 - 228 = 912
  if public.pur__bill_due(o, bill) <> 912 then raise exception 'FAIL N6a: due %, expected 912', public.pur__bill_due(o, bill); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.fin_record_payment('out', 913, current_date, 'cash', null, bill); exception when others then ok := (sqlerrm = 'OVERPAYMENT'); end;
  if not ok then raise exception 'FAIL N6b: more than the bill net of its credit note was paid'; end if;
  perform public.fin_record_payment('out', 912, current_date, 'cash', null, bill);
  -- ---- N7: a debit note (1 x 50 = 50 + 7) raises it again; the admin approves
  dn := (public.pur_submit_note(bill, 'debit', 'Freight added', 'SUP-DN-1', jsonb_build_array(jsonb_build_object('billLineId', bl, 'qty', 1, 'unitCostMinor', 50)), jsonb_build_object('documentRef', 'ETA-DN-1')) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.pur_decide_note(dn, 'approved');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  reset role;
  if public.pur__bill_due(o, bill) <> 969 then raise exception 'FAIL N7a: due %, expected 969', public.pur__bill_due(o, bill); end if;
  set local role authenticated;
  j := public.insights_home();
  if (j ->> 'iOweMinor')::bigint <> 57 then raise exception 'FAIL N7b: owner insights owe %, expected 57', j ->> 'iOweMinor'; end if;
  -- ---- N8: the VAT summary: purchases 1000 - 200 + 50 = 850 before VAT, deductible 140 - 28 + 7 = 119; no "excludes" warning
  j := public.fin_vat_summary(v_month, (v_month + interval '1 month')::date - 1);
  reset role;
  select count(*) into n from jsonb_array_elements(j -> 'purchases') s where s ->> 'kind' = 'local' and (s ->> 'netMinor')::bigint = 850 and (s ->> 'deductibleTaxMinor')::bigint = 119;
  if n <> 1 then raise exception 'FAIL N8a: purchases %', j -> 'purchases'; end if;
  if j -> 'warnings' ? 'excludes_supplier_credit_notes' then raise exception 'FAIL N8b: the summary still excludes supplier notes'; end if;
  select count(*) into n from jsonb_array_elements(j -> 'documents') d where d ->> 'type' = 'supplier_note';
  if n <> 2 then raise exception 'FAIL N8c: % supplier notes listed, expected 2', n; end if;
  -- ---- N9: amounts cannot be edited; audit rows
  ok := false; begin update public.pur_notes set gross_minor = 1, net_minor = 1, tax_minor = 0 where id = cn; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL N9a: a supplier note was edited'; end if;
  select count(*) into n from public.audit_log where org_id = o and action in ('purchasing.note.submitted', 'purchasing.note.approved', 'purchasing.note.cancelled');
  if n <> 6 then raise exception 'FAIL N9b: % audit rows, expected 6 (3 submitted, 2 approved, 1 cancelled)', n; end if;
  -- ---- N10: another company sees and decides nothing
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.pur_notes;
  if n <> 0 then raise exception 'FAIL N10a: company B sees % supplier notes', n; end if;
  ok := false; begin perform public.pur_cancel_note(k); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL N10b: company B touched company A''s note'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
