-- sql/tests/082_vat_on_documents.sql
-- VAT part 1 (sql/086). Always rolls back. Needs sql/001-086.
-- Covers: the VAT setting (who, what rate, audited); a company that is not registered has no tax and refuses a rate; line maths and
-- rounding (half away from zero, per line); the rate taken from the line, else the item, else the company default, or "exempt"; the
-- rate copied, not linked; totals stored once and not editable; rows written directly (older code, fixtures) get net = gross, tax 0;
-- posting with output VAT for an invoice, a credit note and a debit note, each balanced; note lines carry the invoice line's rate;
-- amount owed (gross - credit notes + debit notes - payments) in the overpayment check, payment links and owner insights; the VAT
-- accounts and roles; audit rows; another company cannot use this one's rate or see its invoices.
-- Deferred triggers (invoice posting, balance checks) are forced with SET CONSTRAINTS ... IMMEDIATE, as in tests/041.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  a uuid := gen_random_uuid();  -- admin, org A
  m uuid := gen_random_uuid();  -- member, org A
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; w uuid; wb uuid; i1 uuid; i2 uuid; i3 uuid; ib uuid; c uuid; cb uuid; so uuid; sob uuid; rq uuid;
  ol1 uuid; ol2 uuid; ol3 uuid; olb uuid; r14 uuid; r5 uuid; rt uuid; rb uuid; inv1 uuid; inv2 uuid; invb uuid; inv9 uuid;
  cn uuid; dn uuid; il1 uuid; il2 uuid; j jsonb; n bigint; ok boolean; v_t text; v_s text;
  v_net bigint; v_tax bigint; v_gross bigint; v_rate numeric;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'vat-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'vat-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'vat-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'vat-x@tests.invalid');
  o := public.bootstrap_organization('VAT Test A', 'vat-test-a', 'vat-o@tests.invalid');
  ob := public.bootstrap_organization('VAT Test B', 'vat-test-b', 'vat-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  -- accounting on for A (as tests/041 does it)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.acc__seed_chart(o);
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);

  -- rates (company data, written directly: the rate screens are tested in tests/030)
  r14 := gen_random_uuid(); r5 := gen_random_uuid(); rt := gen_random_uuid(); rb := gen_random_uuid();
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label, is_default) values
    (r14, o, 'T1', 'V009', 14, 'VAT 14%', true), (r5, o, 'T1', 'V010', 5, 'VAT 5%', false), (rb, ob, 'T1', 'V009', 14, 'VAT 14%', true);
  select t.tax_type, t.sub_type into v_t, v_s from public.eta_tax_subtypes t where t.tax_type <> 'T1' order by 1, 2 limit 1;
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label) values (rt, o, v_t, v_s, 8, 'Not VAT');

  -- ---- fixtures: three items (the second with a 5% default), a customer, an order delivered in full
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('V-1', 'Standard item', null, 'piece', 50, w, 100);
  i2 := public.inv_create_item('V-2', 'Reduced item', null, 'piece', 50, w, 100);
  i3 := public.inv_create_item('V-3', 'Exempt item', null, 'piece', 50, w, 100);
  c := public.sal_create_customer('VAT Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(
          jsonb_build_object('itemId', i1, 'qty', 5, 'unitPriceMinor', 333),
          jsonb_build_object('itemId', i2, 'qty', 1, 'unitPriceMinor', 1050),
          jsonb_build_object('itemId', i3, 'qty', 2, 'unitPriceMinor', 100))) ->> 'id')::uuid;
  reset role;
  update public.inv_items set default_tax_rate_id = r5 where id = i2;
  select id into ol1 from public.sal_order_lines where order_id = so and item_id = i1;
  select id into ol2 from public.sal_order_lines where order_id = so and item_id = i2;
  select id into ol3 from public.sal_order_lines where order_id = so and item_id = i3;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;

  -- ---- V1: not registered: a rate is refused, "exempt" is fine, the invoice has no tax
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol3, 'qty', 1, 'taxRateId', r14)));
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL V1a: a company that is not VAT registered charged VAT'; end if;
  inv9 := (public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol3, 'qty', 1, 'taxRateId', 'exempt'))) ->> 'id')::uuid;
  reset role;
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_invoices where id = inv9;
  if (v_net, v_tax, v_gross) <> (100, 0, 100) then raise exception 'FAIL V1b: unregistered invoice totals %/%/%, expected 100/0/100', v_net, v_tax, v_gross; end if;
  select count(*) into n from public.sal_invoice_lines where invoice_id = inv9 and tax_rate = 0 and tax_rate_id is null and tax_minor = 0 and net_minor = 100;
  if n <> 1 then raise exception 'FAIL V1c: unregistered invoice line has a rate'; end if;

  -- ---- V2: the setting: owner or admin only, a T1 rate required to switch on, audited
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_set_vat(true, r14); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL V2a: a member switched VAT on'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_vat(true, rt); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL V2c: a non-VAT rate was accepted as the default VAT rate'; end if;
  ok := false; begin perform public.core_set_vat(true, rb); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL V2d: another company''s rate was accepted'; end if;
  -- no rate named: the company's default VAT rate is used (no new rate added)
  j := public.core_set_vat(true, null);
  perform public.core_set_vat(true, r14);   -- the same again: no second audit row
  reset role;
  if (j ->> 'vatRegistered')::boolean is not true or j ->> 'defaultVatRateId' <> r14::text or (j ->> 'rateAdded')::boolean then
    raise exception 'FAIL V2e: %', j;
  end if;
  select count(*) into n from public.tax_rates where org_id = o and deleted_at is null;
  if n <> 3 then raise exception 'FAIL V2b: switching on added a rate although the company had a default (% rates)', n; end if;
  select count(*) into n from public.organizations where id = o and (settings ->> 'vat_registered')::boolean and settings ->> 'default_vat_rate_id' = r14::text;
  if n <> 1 then raise exception 'FAIL V2f: the setting was not stored'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.vat_changed';
  if n <> 1 then raise exception 'FAIL V2g: % VAT audit rows, expected 1', n; end if;

  -- ---- V3: registered: line rate from the item (5%), else the company default (14%), or exempt; maths per line, half away from zero
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.sal_create_invoice(so, current_date, jsonb_build_array(
         jsonb_build_object('orderLineId', ol1, 'qty', 3),                          -- 999 net, 14% = 139.86 -> 140
         jsonb_build_object('orderLineId', ol2, 'qty', 1),                          -- 1050 net, item 5% = 52.5 -> 53
         jsonb_build_object('orderLineId', ol3, 'qty', 1, 'taxRateId', 'exempt'))); -- 100 net, no VAT
  inv1 := (j ->> 'id')::uuid;
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol1, 'qty', 1, 'taxRateId', 'nonsense')));
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL V3a: a malformed rate was accepted'; end if;
  ok := false; begin perform public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol1, 'qty', 1, 'taxRateId', rt)));
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL V3b: a non-VAT rate was used as VAT'; end if;
  -- the rest of line 1 with the rate chosen on the line (5%): 666 net, 33.3 -> 33
  inv2 := (public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol1, 'qty', 2, 'taxRateId', r5))) ->> 'id')::uuid;
  reset role;
  if (j ->> 'netMinor')::bigint <> 2149 or (j ->> 'taxMinor')::bigint <> 193 or (j ->> 'grossMinor')::bigint <> 2342 then
    raise exception 'FAIL V3c: returned totals %, expected 2149 / 193 / 2342', j;
  end if;
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_invoices where id = inv1;
  if (v_net, v_tax, v_gross) <> (2149, 193, 2342) then raise exception 'FAIL V3d: stored totals %/%/%', v_net, v_tax, v_gross; end if;
  select count(*) into n from public.sal_invoice_lines where invoice_id = inv1 and (
    (order_line_id = ol1 and tax_rate_id = r14 and tax_rate = 14 and net_minor = 999 and tax_minor = 140) or
    (order_line_id = ol2 and tax_rate_id = r5 and tax_rate = 5 and net_minor = 1050 and tax_minor = 53) or
    (order_line_id = ol3 and tax_rate_id is null and tax_rate = 0 and net_minor = 100 and tax_minor = 0));
  if n <> 3 then raise exception 'FAIL V3e: % of 3 lines have the expected rate and tax', n; end if;
  select gross_minor into v_gross from public.sal_invoices where id = inv2;
  if v_gross <> 699 then raise exception 'FAIL V3f: invoice 2 gross %, expected 699', v_gross; end if;
  select id into il1 from public.sal_invoice_lines where invoice_id = inv1 and order_line_id = ol1;
  select id into il2 from public.sal_invoice_lines where invoice_id = inv1 and order_line_id = ol2;

  -- ---- V4: the rate is copied: changing the company rate later does not change the invoice
  update public.tax_rates set rate = 10 where id = r14;
  select tax_rate into v_rate from public.sal_invoice_lines where id = il1;
  select tax_minor into v_tax from public.sal_invoices where id = inv1;
  if v_rate <> 14 or v_tax <> 193 then raise exception 'FAIL V4: the invoice followed a rate change (% / %)', v_rate, v_tax; end if;
  update public.tax_rates set rate = 14 where id = r14;

  -- ---- V5: totals cannot be edited, even directly
  ok := false; begin update public.sal_invoices set gross_minor = 1, net_minor = 1, tax_minor = 0 where id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V5a: invoice totals were edited'; end if;
  ok := false; begin update public.sal_invoices set tax_minor = 0, gross_minor = net_minor where id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V5b: invoice VAT was removed'; end if;

  -- ---- V6: posting: Dr customers gross / Cr sales net / Cr output VAT tax, balanced
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set constraints public.acc_post_sal_invoice immediate'; execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'customer_invoice' and e.source_id = inv1::text and
         ((ac.code = '171' and l.debit_minor = 2342 and l.party_id = c) or (ac.code = '411' and l.credit_minor = 2149) or (ac.code = '2871' and l.credit_minor = 193));
  if n <> 3 then raise exception 'FAIL V6a: the invoice did not post 2342 / 2149 / 193 (% lines)', n; end if;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
   where e.org_id = o and e.source_type = 'customer_invoice' and e.source_id = inv9::text;
  if n <> 2 then raise exception 'FAIL V6b: a zero-VAT invoice posted % lines, expected 2 (no VAT line)', n; end if;

  -- ---- V7: a credit note takes the invoice line's rate: 1 x 333 at 14% = 333 + 46.62 -> 47 = 380
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cn := (public.sal_submit_note(inv1, 'credit', 'Damaged', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1))) ->> 'id')::uuid;
  -- a debit note on the 5% line at a new price: 1 x 200 = 200 + 10 = 210
  dn := (public.sal_submit_note(inv1, 'debit', 'Price correction', jsonb_build_array(jsonb_build_object('invoiceLineId', il2, 'qty', 1, 'unitPriceMinor', 200))) ->> 'id')::uuid;
  reset role;
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_notes where id = cn;
  if (v_net, v_tax, v_gross) <> (333, 47, 380) then raise exception 'FAIL V7a: credit note %/%/%, expected 333/47/380', v_net, v_tax, v_gross; end if;
  select count(*) into n from public.sal_notes where id = cn and total_minor = 380;
  if n <> 1 then raise exception 'FAIL V7b: the note total is not its gross'; end if;
  select count(*) into n from public.sal_note_lines where note_id = cn and tax_rate_id = r14 and tax_rate = 14 and net_minor = 333 and tax_minor = 47;
  if n <> 1 then raise exception 'FAIL V7c: the credit note line did not take the invoice line''s rate'; end if;
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_notes where id = dn;
  if (v_net, v_tax, v_gross) <> (200, 10, 210) then raise exception 'FAIL V7d: debit note %/%/%, expected 200/10/210', v_net, v_tax, v_gross; end if;
  ok := false; begin update public.sal_notes set tax_minor = 0, gross_minor = net_minor where id = cn; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V7e: a note''s VAT was edited'; end if;

  -- waiting notes change nothing owed; approved ones do, and post with output VAT
  if public.sal__invoice_owed(o, inv1) <> 2342 then raise exception 'FAIL V8a: waiting notes changed the amount owed (%)', public.sal__invoice_owed(o, inv1); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.sal_decide_note(cn, 'approved', null, 'app');
  perform public.sal_decide_note(dn, 'approved', null, 'app');
  reset role;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'sales_note' and e.source_id = cn::text and
         ((ac.code = '412' and l.debit_minor = 333) or (ac.code = '2871' and l.debit_minor = 47) or (ac.code = '171' and l.credit_minor = 380 and l.party_id = c));
  if n <> 3 then raise exception 'FAIL V7f: the credit note did not post 333 / 47 / 380 (% lines)', n; end if;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'sales_note' and e.source_id = dn::text and
         ((ac.code = '171' and l.debit_minor = 210) or (ac.code = '411' and l.credit_minor = 200) or (ac.code = '2871' and l.credit_minor = 10));
  if n <> 3 then raise exception 'FAIL V7g: the debit note did not post 210 / 200 / 10 (% lines)', n; end if;
  -- output VAT balance: 193 + 33 (invoice 2) - 47 + 10 = 189
  execute 'set constraints public.acc_post_sal_invoice immediate'; execute 'set constraints all deferred';
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into n from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id
   where l.org_id = o and ac.code = '2871';
  if n <> 189 then raise exception 'FAIL V7h: output VAT balance %, expected 189', n; end if;

  -- ---- V8: amount owed = gross - credit + debit - payments, everywhere it is computed
  if public.sal__invoice_owed(o, inv1) <> 2172 then raise exception 'FAIL V8b: owed %, expected 2342 - 380 + 210 = 2172', public.sal__invoice_owed(o, inv1); end if;
  if public.fin__invoice_outstanding(o, inv1) <> 2172 then raise exception 'FAIL V8c: payment links see % owed', public.fin__invoice_outstanding(o, inv1); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.fin_record_payment('in', 2173, current_date, 'cash', inv1); exception when others then ok := (sqlerrm = 'OVERPAYMENT'); end;
  if not ok then raise exception 'FAIL V8d: a payment above the gross net of notes was accepted'; end if;
  perform public.fin_record_payment('in', 2172, current_date, 'cash', inv1);
  j := public.insights_home();
  reset role;
  if public.sal__invoice_owed(o, inv1) <> 0 then raise exception 'FAIL V8e: owed % after paying in full', public.sal__invoice_owed(o, inv1); end if;
  -- owed to me: invoice 2 (699) and the unregistered one (100); invoice 1 is paid
  if (j ->> 'owedToMeMinor')::bigint <> 799 then raise exception 'FAIL V8f: owner insights owed %, expected 799', j ->> 'owedToMeMinor'; end if;

  -- ---- V9: rows written directly (older code, fixtures): line net computed, invoice totals rolled up, note net = gross = total
  inv9 := gen_random_uuid();
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values (inv9, o, 'INV-9901', so, c, current_date, 'EGP', u);
  insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, net_minor, tax_minor) values (o, inv9, ol3, 1.5, 101, 1, 999);
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_invoices where id = inv9;
  if (v_net, v_tax, v_gross) <> (152, 0, 152) then raise exception 'FAIL V9a: a direct invoice line gave %/%/% (expected 152/0/152: 151.5 rounds up)', v_net, v_tax, v_gross; end if;
  dn := gen_random_uuid();
  insert into public.sal_notes (id, org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, requester_id)
  values (dn, o, 'CN-9901', 'credit', inv9, c, 'EGP', 'fixture', 50, m);
  select net_minor, tax_minor, gross_minor into v_net, v_tax, v_gross from public.sal_notes where id = dn;
  if (v_net, v_tax, v_gross) <> (50, 0, 50) then raise exception 'FAIL V9b: a direct note gave %/%/%', v_net, v_tax, v_gross; end if;

  -- ---- V10: accounts and roles: 2871 and 1811 on the new chart; added once to a chart made before sql/086
  select count(*) into n from public.acc_account_roles r join public.acc_accounts ac on ac.id = r.account_id
   where r.org_id = o and ((r.role_key = 'output_vat' and ac.code = '2871' and ac.kind = 'liability') or (r.role_key = 'input_vat' and ac.code = '1811' and ac.kind = 'asset'));
  if n <> 2 then raise exception 'FAIL V10a: the VAT roles do not point at 2871 and 1811'; end if;
  perform public.acc__seed_chart_base(ob);
  if public.acc__ensure_vat_accounts(ob) <> 3 then raise exception 'FAIL V10b: an older chart did not get group 18, 1811 and 2871'; end if;
  if public.acc__ensure_vat_accounts(ob) <> 0 then raise exception 'FAIL V10c: a second run added accounts'; end if;
  select count(*) into n from public.acc_account_roles where org_id = ob and role_key in ('output_vat', 'input_vat');
  if n <> 2 then raise exception 'FAIL V10d: the older chart has % VAT roles', n; end if;

  -- ---- V11: audit rows carry the figures
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.invoice.created' and entity_id = inv1::text
     and (after ->> 'tax_minor')::bigint = 193 and (after ->> 'gross_minor')::bigint = 2342;
  if n <> 1 then raise exception 'FAIL V11a: the invoice audit row lacks its VAT'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.note.submitted' and entity_id = cn::text and (after ->> 'tax_minor')::bigint = 47;
  if n <> 1 then raise exception 'FAIL V11b: the note audit row lacks its VAT'; end if;

  -- ---- V12: company B (not registered) ignores item defaults; it cannot use A's rates or see A's invoices
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  wb := public.inv_create_warehouse('MAIN', 'Main B');
  ib := public.inv_create_item('VB-1', 'B item', null, 'piece', 10, wb);
  cb := public.sal_create_customer('B Customer', null, null, null);
  sob := (public.sal_create_order(cb, wb, jsonb_build_array(jsonb_build_object('itemId', ib, 'qty', 1, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  rq := (public.sal_request_stock(sob) ->> 'id')::uuid;
  ok := false; begin perform public.core_set_vat(true, r14); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL V12a: company B used company A''s rate'; end if;
  select count(*) into n from public.sal_invoices where org_id = o;
  if n <> 0 then raise exception 'FAIL V12b: company B sees % of A''s invoices', n; end if;
  select count(*) into n from public.sal_invoice_lines where tax_rate_id = r14;
  if n <> 0 then raise exception 'FAIL V12c: company B sees A''s invoice lines'; end if;
  reset role;
  update public.inv_items set default_tax_rate_id = rb where id = ib;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(rq, 'approved');   -- sole owner (decision D1)
  perform public.inv_post_issue(rq);
  select id into olb from public.sal_order_lines where order_id = sob;
  invb := (public.sal_create_invoice(sob, current_date, jsonb_build_array(jsonb_build_object('orderLineId', olb, 'qty', 1))) ->> 'id')::uuid;
  reset role;
  select tax_minor, gross_minor into v_tax, v_gross from public.sal_invoices where id = invb;
  if v_tax <> 0 or v_gross <> 1000 then raise exception 'FAIL V12d: an unregistered company charged VAT from an item default (% / %)', v_tax, v_gross; end if;

  -- ---- V13 (sql/088): switching on with no VAT rate at all is refused; nothing is added
  update public.inv_items set default_tax_rate_id = null where id = ib;
  update public.tax_rates set deleted_at = now(), is_default = false where id = rb;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_set_vat(true, null); exception when others then ok := (sqlerrm = 'VAT_RATE_MISSING'); end;
  reset role;
  if not ok then raise exception 'FAIL V13a: VAT was switched on with no rate'; end if;
  select count(*) into n from public.tax_rates where org_id = ob and deleted_at is null;
  if n <> 0 then raise exception 'FAIL V13b: a rate was added automatically'; end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
