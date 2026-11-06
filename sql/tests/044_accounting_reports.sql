-- sql/tests/044_accounting_reports.sql
-- Accounting slice 5 (sql/049): trial balance and account lines. Always rolls back. Needs sql/001-049 (uses 048's journals to post).
-- Covers: opening / period / closing per account; parents roll up their sub-accounts; totals balance; one currency at a time; an
-- account's lines with a running balance from its opening balance (a group account includes its sub-accounts); bad periods refused;
-- members and other companies see nothing.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; cash uuid; bank uuid; exp331 uuid; capital uuid; grp19 uuid; n bigint; ok boolean; rec record; v_dr bigint; v_cr bigint; v_last bigint;
  lines_open jsonb; lines_bank_cash jsonb; lines_exp jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'accr-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'accr-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'accr-x@tests.invalid');
  o := public.bootstrap_organization('Reports Test A', 'reports-test-a', 'accr-o@tests.invalid');
  ob := public.bootstrap_organization('Reports Test B', 'reports-test-b', 'accr-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.acc_prepare(); reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  select id into cash from public.acc_accounts where org_id = o and code = '191';
  select id into bank from public.acc_accounts where org_id = o and code = '192';
  select id into grp19 from public.acc_accounts where org_id = o and code = '19';
  select id into exp331 from public.acc_accounts where org_id = o and code = '331';
  select id into capital from public.acc_accounts where org_id = o and code = '211';

  -- the ledger: opening capital 1,000.00 in the bank (1 Jan); 50.00 drawn to cash (10 Mar); 20.00 spent from cash (20 Mar); and 7.00 USD
  set local role authenticated;
  perform public.acc_create_fiscal_year('FY2026', date '2026-01-01', date '2026-12-31');
  perform public.acc_save_journal(null, date '2026-01-01', 'Opening', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 100000), jsonb_build_object('accountId', capital, 'creditMinor', 100000)), 'opening', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-10', 'Cash drawn', jsonb_build_array(jsonb_build_object('accountId', cash, 'debitMinor', 5000), jsonb_build_object('accountId', bank, 'creditMinor', 5000)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-20', 'Stationery', jsonb_build_array(jsonb_build_object('accountId', exp331, 'debitMinor', 2000), jsonb_build_object('accountId', cash, 'creditMinor', 2000)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-21', 'USD', jsonb_build_array(jsonb_build_object('accountId', exp331, 'debitMinor', 700), jsonb_build_object('accountId', cash, 'creditMinor', 700)), 'manual', 'USD', true);

  -- ---- R1: trial balance for March, EGP
  for rec in select * from public.acc_trial_balance(date '2026-03-01', date '2026-03-31', 'EGP') loop
    if rec.code = '192' and (rec.opening_minor, rec.debit_minor, rec.credit_minor, rec.closing_minor) <> (100000::bigint, 0::bigint, 5000::bigint, 95000::bigint) then raise exception 'FAIL R1a: bank %', row_to_json(rec); end if;
    if rec.code = '191' and (rec.opening_minor, rec.debit_minor, rec.credit_minor, rec.closing_minor) <> (0::bigint, 5000::bigint, 2000::bigint, 3000::bigint) then raise exception 'FAIL R1b: cash %', row_to_json(rec); end if;
    if rec.code = '19' and (rec.opening_minor, rec.debit_minor, rec.credit_minor, rec.closing_minor, rec.is_leaf) <> (100000::bigint, 5000::bigint, 7000::bigint, 98000::bigint, false) then raise exception 'FAIL R1c: group 19 %', row_to_json(rec); end if;
    if rec.code = '211' and rec.closing_minor <> -100000 then raise exception 'FAIL R1d: capital %', row_to_json(rec); end if;
    if rec.code = '331' and rec.closing_minor <> 2000 then raise exception 'FAIL R1e: expenses % (the USD line must not count)', row_to_json(rec); end if;
  end loop;
  select count(*) into n from public.acc_trial_balance(date '2026-03-01', date '2026-03-31', 'EGP') where code in ('191', '192', '19', '1', '211', '331');
  if n <> 6 then raise exception 'FAIL R1f: % expected rows', n; end if;
  select sum(debit_minor), sum(credit_minor), sum(closing_minor) into v_dr, v_cr, v_last from public.acc_trial_balance(date '2026-03-01', date '2026-03-31', 'EGP') where is_leaf;
  if v_dr <> v_cr or v_last <> 0 then raise exception 'FAIL R1g: leaf totals dr % cr % closing %', v_dr, v_cr, v_last; end if;
  select closing_minor into v_last from public.acc_trial_balance(date '2026-03-01', date '2026-03-31', 'USD') where code = '331';
  if v_last <> 700 then raise exception 'FAIL R1h: USD expenses %', v_last; end if;
  ok := false; begin perform public.acc_trial_balance(date '2026-03-31', date '2026-03-01'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R1i: a reversed period was accepted'; end if;

  -- ---- R2: account lines for group 19 in March: opening 1,000.00, then +50.00, -50.00, -20.00
  select count(*) into n from public.acc_account_lines(grp19, date '2026-03-01', date '2026-03-31', 'EGP');
  if n <> 4 then raise exception 'FAIL R2a: % rows, expected 4 (opening + 3 lines)', n; end if;
  select balance_minor into v_last from public.acc_account_lines(grp19, date '2026-03-01', date '2026-03-31', 'EGP') where is_opening;
  if v_last <> 100000 then raise exception 'FAIL R2b: opening %', v_last; end if;
  select balance_minor into v_last from public.acc_account_lines(grp19, date '2026-03-01', date '2026-03-31', 'EGP') where not is_opening order by entry_date desc, entry_number desc, line_id desc limit 1;
  if v_last <> 98000 then raise exception 'FAIL R2c: closing running balance %, expected 98000', v_last; end if;

  -- ---- R3: members and other companies see nothing
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_trial_balance(date '2026-01-01', date '2026-12-31'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R3a: a member read the trial balance'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.acc_trial_balance(date '2026-01-01', date '2026-12-31');
  if n <> 0 then raise exception 'FAIL R3b: another company sees % rows', n; end if;
  ok := false; begin perform public.acc_account_lines(grp19, date '2026-01-01', date '2026-12-31'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL R3c: another company read an account''s lines'; end if;
  reset role;
  if has_function_privilege('anon', 'public.acc_account_lines(uuid, date, date, text)', 'execute') then raise exception 'FAIL R3d: anonymous can read lines'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
