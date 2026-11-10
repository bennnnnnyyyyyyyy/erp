-- sql/tests/064_bank_statements_2.sql
-- Bank statement import, part 2 (sql/068). Always rolls back. Needs sql/001-068.
-- Covers: explaining a fee with no category creates the Bank charges account (under 33) and category once, records the expense and its
-- payment from the bank, and matches the new ledger line; an expense with a chosen category; a transfer from and to the cash box; a
-- customer payment against an invoice; money in cannot be explained as an expense (and the other way round); rules saved and removed;
-- the reconcile roles can be read; another company cannot explain; no anonymous use; audit.

do $$
declare
  u uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; bank uuid; cash uuid; w uuid; i uuid; cu uuid; so uuid; sol uuid; inv uuid; rent uuid; rule uuid;
  j jsonb; imp uuid; s_fee uuid; s_rent uuid; s_out uuid; s_in uuid; s_cust uuid; ok boolean; n bigint; v bigint; d date := current_date - 5;
begin
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'b2-o@tests.invalid'), (x, 'authenticated', 'authenticated', 'b2-x@tests.invalid');
  o := public.bootstrap_organization('Bank2 Test A', 'bank2-test-a', 'b2-o@tests.invalid');
  ob := public.bootstrap_organization('Bank2 Test B', 'bank2-test-b', 'b2-x@tests.invalid');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.acc_prepare(); reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  insert into public.org_modules (org_id, module_key) values (o, 'treasury');
  set local role authenticated;
  perform public.trs_prepare();
  select id into bank from public.trs_accounts where org_id = o and code = 'BANK-MAIN';
  select id into cash from public.trs_accounts where org_id = o and code = 'CASH-MAIN';
  rent := public.fin_create_category('Rent');

  -- a customer invoice of 1,000.00 (inserted directly, as in tests/031)
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('B2-1', 'Item', null, 'piece', 0, null);
  cu := public.sal_create_customer('Paying Customer', null, null, null);
  reset role;
  so := gen_random_uuid(); sol := gen_random_uuid(); inv := gen_random_uuid();
  insert into public.sal_orders (id, org_id, number, customer_id, warehouse_id, status, currency, created_by) values (so, o, 'SO-9201', cu, w, 'stock_requested', 'EGP', u);
  insert into public.sal_order_lines (id, org_id, order_id, item_id, qty, unit_price_minor) values (sol, o, so, i, 10, 10000);
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values (inv, o, 'INV-9201', so, cu, d, 'EGP', u);
  insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor) values (o, inv, sol, 10, 10000);
  execute 'set constraints public.acc_post_sal_invoice immediate'; execute 'set constraints public.acc_post_sal_invoice deferred';
  set local role authenticated;

  j := public.trs_import_statement(bank, 'b2.csv', repeat('e', 64), 'csv', null, null, jsonb_build_array(
    jsonb_build_object('bookingDate', d, 'amountMinor', -1500, 'description', 'MONTHLY ACCOUNT FEE', 'fingerprint', 'fee'),
    jsonb_build_object('bookingDate', d, 'amountMinor', -800000, 'description', 'Rent November', 'fingerprint', 'rent'),
    jsonb_build_object('bookingDate', d + 1, 'amountMinor', -50000, 'description', 'To petty cash', 'fingerprint', 'out'),
    jsonb_build_object('bookingDate', d + 1, 'amountMinor', 20000, 'description', 'Cash deposit', 'fingerprint', 'in'),
    jsonb_build_object('bookingDate', d + 2, 'amountMinor', 100000, 'description', 'From Paying Customer INV-9201', 'fingerprint', 'cust')));
  imp := (j ->> 'id')::uuid;
  select id into s_fee from public.trs_statement_lines where import_id = imp and fingerprint = 'fee';
  select id into s_rent from public.trs_statement_lines where import_id = imp and fingerprint = 'rent';
  select id into s_out from public.trs_statement_lines where import_id = imp and fingerprint = 'out';
  select id into s_in from public.trs_statement_lines where import_id = imp and fingerprint = 'in';
  select id into s_cust from public.trs_statement_lines where import_id = imp and fingerprint = 'cust';

  -- ---- E1: a fee with no category: Bank charges account and category are created once; matched
  j := public.trs_explain_line(s_fee, 'expense', '{}'::jsonb);
  if (select status from public.trs_statement_lines where id = s_fee) <> 'matched' then raise exception 'FAIL E1a: fee not matched (%)', j; end if;
  reset role;
  if (select count(*) from public.acc_accounts where org_id = o and name = 'Bank charges' and code like '33_' and kind = 'expense') <> 1 then raise exception 'FAIL E1b: no Bank charges account under 33'; end if;
  if (select count(*) from public.fin_categories c join public.acc_accounts a on a.id = c.account_id where c.org_id = o and c.name = 'Bank charges' and a.name = 'Bank charges') <> 1 then
    raise exception 'FAIL E1c: the Bank charges category does not point at the account';
  end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v from public.acc_entry_lines l join public.acc_accounts a on a.id = l.account_id where l.org_id = o and a.name = 'Bank charges';
  if v <> 1500 then raise exception 'FAIL E1d: Bank charges account %, expected 1500', v; end if;
  set local role authenticated;
  if public.trs_prepare_bank_charges() <> (select id from public.fin_categories where org_id = o and name = 'Bank charges') then raise exception 'FAIL E1e: a second category'; end if;

  -- ---- E2: an expense with a chosen category; direction mistakes refused
  ok := false; begin perform public.trs_explain_line(s_in, 'expense', '{}'::jsonb); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL E2a: money in explained as an expense'; end if;
  ok := false; begin perform public.trs_explain_line(s_rent, 'customer_payment', jsonb_build_object('invoiceId', inv)); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL E2b: money out explained as a customer payment'; end if;
  perform public.trs_explain_line(s_rent, 'expense', jsonb_build_object('categoryId', rent, 'note', 'November rent'));
  if not exists (select 1 from public.fin_expenses where org_id = o and category_id = rent and amount_minor = 800000 and expense_date = d) then raise exception 'FAIL E2c: rent expense missing'; end if;

  -- ---- T1: transfers both ways
  perform public.trs_explain_line(s_out, 'transfer', jsonb_build_object('otherAccountId', cash));
  perform public.trs_explain_line(s_in, 'transfer', jsonb_build_object('otherAccountId', cash));
  if (select count(*) from public.trs_transfers where org_id = o and status = 'recorded') <> 2 then raise exception 'FAIL T1a: transfers not recorded'; end if;
  if not exists (select 1 from public.trs_transfers where org_id = o and from_account_id = bank and to_account_id = cash and amount_minor = 50000)
     or not exists (select 1 from public.trs_transfers where org_id = o and from_account_id = cash and to_account_id = bank and amount_minor = 20000) then
    raise exception 'FAIL T1b: transfer directions wrong';
  end if;

  -- ---- C1: a customer payment against the invoice
  perform public.trs_explain_line(s_cust, 'customer_payment', jsonb_build_object('invoiceId', inv));
  if not exists (select 1 from public.fin_payments where org_id = o and customer_invoice_id = inv and amount_minor = 100000 and treasury_account_id = bank) then
    raise exception 'FAIL C1: payment not recorded against the invoice';
  end if;
  if exists (select 1 from public.trs_statement_lines where import_id = imp and status <> 'matched') then raise exception 'FAIL C1b: a line is not matched'; end if;

  -- ---- R1: rules and roles
  rule := public.trs_save_rule(null, bank, 'ACCOUNT FEE', public.trs_prepare_bank_charges(), 'monthly fee');
  perform public.trs_save_rule(rule, null, 'ACCOUNT FEE', public.trs_prepare_bank_charges(), null);
  ok := false; begin perform public.trs_save_rule(null, null, 'x', rent); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R1a: a one-letter rule was saved'; end if;
  perform public.trs_delete_rule(rule);
  if not exists (select 1 from public.trs_match_rules where id = rule and deleted_at is not null) then raise exception 'FAIL R1b: rule not removed'; end if;
  if public.trs_reconcile_roles() <> array['head_accountant', 'owner'] then raise exception 'FAIL R1c: roles %', public.trs_reconcile_roles(); end if;

  -- ---- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.trs_explain_line(s_fee, 'expense', '{}'::jsonb); exception when others then ok := (sqlerrm in ('NOT_FOUND', 'MODULE_DISABLED', 'FORBIDDEN')); end;
  if not ok then raise exception 'FAIL I1: another company explained a line'; end if;
  reset role;

  -- ---- A1: audit and access
  select count(*) into n from public.audit_log where org_id = o and action = 'treasury.statement_line_explained';
  if n <> 5 then raise exception 'FAIL A1a: % explained rows, expected 5', n; end if;
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL A1b: audit chain broken'; end if;
  if has_function_privilege('anon', 'public.trs_explain_line(uuid, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.trs__bank_charges_category(uuid)', 'execute') then
    raise exception 'FAIL A1c: functions open too widely';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
