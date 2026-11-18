-- sql/tests/086_vat_settlement.sql
-- VAT part 4 (sql/091). Always rolls back. Needs sql/001-091.
-- Covers: 2872 and its role on the chart; the month from the ledger beside the document summary; only an ended month can be closed;
-- members cannot; a close is a manual journal (draft for an admin, approved by someone else; posted directly by the owner) that
-- clears output and input VAT to the settlement account; one close per month; the close itself is left out of the month's figures;
-- payments up to what is due; credit months and the refund count; the opening balance once; the return settings (owner); a reversed
-- close frees the month; append-only records; audit rows; another company sees nothing.
-- Deferred triggers (invoice posting, balance checks) are forced with SET CONSTRAINTS ... IMMEDIATE, as in tests/041.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  a uuid := gen_random_uuid();  -- admin, org A
  m uuid := gen_random_uuid();  -- member, org A
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; w uuid; i1 uuid; c uuid; so uuid; sol uuid; inv uuid; r14 uuid; cat uuid; bank uuid;
  v_now date; v_m1 date; v_m2 date; j jsonb; k jsonb; pid uuid; jid uuid; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'vset-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'vset-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'vset-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'vset-x@tests.invalid');
  o := public.bootstrap_organization('VAT Settle A', 'vat-settle-a', 'vset-o@tests.invalid');
  ob := public.bootstrap_organization('VAT Settle B', 'vat-settle-b', 'vset-x@tests.invalid');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.acc__seed_chart(o);
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  v_now := public.acc__local_date(o, now());
  v_m1 := (date_trunc('month', v_now) - interval '1 month')::date;   -- last month
  v_m2 := (date_trunc('month', v_now) - interval '2 months')::date;  -- the month before
  r14 := gen_random_uuid();
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label, is_default) values (r14, o, 'T1', 'V009', 14, 'VAT 14%', true);
  select account_id into bank from public.acc_account_roles where org_id = o and role_key = 'bank';

  -- ---- V1: the settlement account is on the chart
  select count(*) into n from public.acc_account_roles r join public.acc_accounts ac on ac.id = r.account_id
   where r.org_id = o and r.role_key = 'vat_settlement' and ac.code = '2872' and ac.kind = 'liability';
  if n <> 1 then raise exception 'FAIL V1: no 2872 VAT settlement account'; end if;

  -- ---- fixtures: VAT from two months ago; last month an invoice (1400 VAT) and a deductible expense (140); the month before an expense (500)
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  perform public.core_set_vat(true, r14, v_m2);
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('VS-1', 'Goods', null, 'piece', 0, w);
  c := public.sal_create_customer('Customer', null, null, null);
  cat := public.fin_create_category('Rent');
  perform public.fin_record_expense(v_m1 + 3, cat, 1140, null, 'rent', jsonb_build_object('taxMinor', 140, 'documentRef', 'ETA-R1', 'supplierTaxNumber', '123456789'));
  perform public.fin_record_expense(v_m2 + 3, cat, 4071, null, 'rent', jsonb_build_object('taxMinor', 500, 'documentRef', 'ETA-R0', 'supplierTaxNumber', '123456789'));
  reset role;
  so := gen_random_uuid(); sol := gen_random_uuid(); inv := gen_random_uuid();
  insert into public.sal_orders (id, org_id, number, customer_id, warehouse_id, status, currency, created_by) values (so, o, 'SO-1', c, w, 'stock_requested', 'EGP', u);
  insert into public.sal_order_lines (id, org_id, order_id, item_id, qty, unit_price_minor) values (sol, o, so, i1, 10, 1000);
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values (inv, o, 'INV-1', so, c, v_m1 + 5, 'EGP', u);
  insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, tax_rate_id, tax_rate) values (o, inv, sol, 10, 1000, r14, 14);
  execute 'set constraints public.acc_post_sal_invoice immediate'; execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';

  -- ---- V2: the month from the ledger, beside the document summary
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.acc_vat_month(v_m1);
  if (j ->> 'ledgerOutputMinor')::bigint <> 1400 or (j ->> 'ledgerInputMinor')::bigint <> 140 or (j ->> 'ledgerDueMinor')::bigint <> 1260
     or (j ->> 'summaryDueMinor')::bigint <> 1260 or (j ->> 'differenceMinor')::bigint <> 0 or not (j ->> 'ended')::boolean or j -> 'period' <> 'null'::jsonb then
    raise exception 'FAIL V2a: %', j;
  end if;
  if (j ->> 'returnDueOn')::date <> (v_m1 + interval '2 months')::date - 1 then raise exception 'FAIL V2b: return due %', j ->> 'returnDueOn'; end if;
  -- ---- V3: only an ended month; not members
  ok := false; begin perform public.acc_vat_close_month(v_now); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V3a: the current month was closed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_vat_close_month(v_m1); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL V3b: a member closed a VAT month'; end if;
  ok := false; begin perform public.acc_vat_month(v_m1); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL V3c: a member read the VAT month'; end if;

  -- ---- V4: an admin closes last month: a draft journal Dr output 1400 / Cr input 140 / Cr settlement 1260; once only
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  k := public.acc_vat_close_month(v_m1);
  pid := (k ->> 'periodId')::uuid; jid := (k -> 'journal' ->> 'id')::uuid;
  if k -> 'journal' ->> 'status' <> 'draft' or (k ->> 'dueMinor')::bigint <> 1260 then raise exception 'FAIL V4a: %', k; end if;
  ok := false; begin perform public.acc_vat_close_month(v_m1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V4b: a month was closed twice'; end if;
  reset role;
  select count(*) into n from public.acc_manual_journal_lines l join public.acc_accounts ac on ac.id = l.account_id
   where l.journal_id = jid and ((ac.code = '2871' and l.debit_minor = 1400) or (ac.code = '1811' and l.credit_minor = 140) or (ac.code = '2872' and l.credit_minor = 1260));
  if n <> 3 then raise exception 'FAIL V4c: the closing journal lines are wrong (% of 3)', n; end if;
  -- ---- V5: the owner approves it; the month's ledger figures leave the close out; output VAT for the month is now cleared
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.acc_decide_journal(jid, 'approved');
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  j := public.acc_vat_month(v_m1);
  if (j ->> 'ledgerDueMinor')::bigint <> 1260 or j -> 'period' ->> 'journalStatus' <> 'posted' or (j -> 'period' ->> 'leftMinor')::bigint <> 1260 then
    raise exception 'FAIL V5a: %', j;
  end if;
  reset role;
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into n from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id
   where l.org_id = o and ac.code = '2871';
  if n <> 0 then raise exception 'FAIL V5b: output VAT not cleared (%)', n; end if;

  -- ---- V6: payments up to what is due; the owner posts directly
  set local role authenticated;
  ok := false; begin perform public.acc_vat_record_payment(pid, bank, 1261, v_now, true); exception when others then ok := (sqlerrm = 'OVERPAYMENT'); end;
  if not ok then raise exception 'FAIL V6a: more than was due was paid'; end if;
  k := public.acc_vat_record_payment(pid, bank, 1000, v_now, true);
  if k -> 'journal' ->> 'status' <> 'posted' then raise exception 'FAIL V6b: %', k; end if;
  j := public.acc_vat_month(v_m1);
  if (j -> 'period' ->> 'leftMinor')::bigint <> 260 or (j ->> 'ledgerDueMinor')::bigint <> 1260 then raise exception 'FAIL V6c: %', j; end if;

  -- ---- V7: the month before is a credit (input 500 only): closed directly; one credit month, no refund yet
  k := public.acc_vat_close_month(v_m2, true);
  if (k ->> 'dueMinor')::bigint <> -500 or k -> 'journal' ->> 'status' <> 'posted' then raise exception 'FAIL V7a: %', k; end if;
  j := public.acc_vat_month(v_m2);
  if (j ->> 'creditStreak')::int <> 1 or (j ->> 'refundAvailable')::boolean then raise exception 'FAIL V7b: %', j; end if;
  ok := false; begin perform public.acc_vat_record_payment((k ->> 'periodId')::uuid, bank, 1, v_now, true); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V7c: a payment on a credit month was accepted'; end if;

  -- ---- V8: the opening balance, once
  k := public.acc_vat_opening(300, true);
  ok := false; begin perform public.acc_vat_opening(100, true); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V8: a second opening VAT balance was accepted'; end if;

  -- ---- V9: return settings: owner only
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_vat_return(15, true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL V9a: an admin changed the return settings'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.core_set_vat_return(15, true);
  j := public.acc_vat_month(v_m1);
  if (j ->> 'returnDueOn')::date <> (v_m1 + interval '1 month')::date - 1 + 15 or not (j ->> 'smallEnterprise')::boolean then raise exception 'FAIL V9b: %', j; end if;

  -- ---- V10: reversing a posted close frees the month
  perform public.acc_reverse_journal((public.acc_vat_month(v_m2) -> 'period' ->> 'journalId')::uuid, v_now, 'Re-close');
  j := public.acc_vat_month(v_m2);
  if j -> 'period' <> 'null'::jsonb then raise exception 'FAIL V10a: a reversed close still counts (%)', j -> 'period'; end if;
  k := public.acc_vat_close_month(v_m2, true);
  if (k ->> 'dueMinor')::bigint <> -500 then raise exception 'FAIL V10b: the month could not be closed again (%)', k; end if;
  reset role;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';

  -- ---- V11: records are append-only; audit rows
  ok := false; begin update public.acc_vat_periods set due_minor = 0 where id = pid; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL V11a: a closed month was edited'; end if;
  select count(*) into n from public.audit_log where org_id = o and action in ('accounting.vat.closed', 'accounting.vat.paid', 'accounting.vat.opening', 'organization.vat_return_changed');
  if n <> 6 then raise exception 'FAIL V11b: % audit rows, expected 6 (3 closes, 1 payment, 1 opening, 1 setting)', n; end if;

  -- ---- V12: another company sees none of it
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.acc_vat_periods;
  if n <> 0 then raise exception 'FAIL V12a: company B sees % closed months', n; end if;
  select count(*) into n from public.acc_vat_payments;
  if n <> 0 then raise exception 'FAIL V12b: company B sees payments'; end if;
  ok := false; begin perform public.acc_vat_record_payment(pid, bank, 1, v_now, true); exception when others then ok := sqlerrm in ('NOT_FOUND', 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL V12c: company B paid against company A''s month'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
