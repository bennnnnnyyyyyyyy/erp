-- sql/tests/063_bank_statements.sql
-- Bank statement import and reconciliation, part 1 (sql/067). Always rolls back. Needs sql/001-067.
-- Covers: import adds lines; the same file twice is refused; an overlapping file skips lines already in; a match only to the bank
-- account's own ledger lines, the same direction, exactly the amount, each ledger line once; a group match; ignore needs a reason;
-- unmatch reopens; who may reconcile follows the company setting (default owner and head accountant; an admin is refused until added);
-- closing refuses open lines and a balance difference, then locks its lines; reopening needs a reason and never behind the lock date;
-- members and another company see nothing; no anonymous use; every action is audited.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; bank uuid; bank_ledger uuid; cash uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; l1 bigint; l2 bigint; l3a bigint; l3b bigint; l4 bigint;
  j jsonb; imp uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; rec uuid; ok boolean; n bigint; d date := current_date - 10;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'bs-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'bs-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'bs-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'bs-x@tests.invalid');
  o := public.bootstrap_organization('Bank Test A', 'bank-test-a', 'bs-o@tests.invalid');
  ob := public.bootstrap_organization('Bank Test B', 'bank-test-b', 'bs-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.acc_prepare(); reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  insert into public.org_modules (org_id, module_key) values (o, 'treasury');
  set local role authenticated; perform public.trs_prepare(); reset role;
  select id, ledger_account_id into bank, bank_ledger from public.trs_accounts where org_id = o and code = 'BANK-MAIN';
  select id into cash from public.trs_accounts where org_id = o and code = 'CASH-MAIN';

  -- ledger lines on the bank account (posted by the internal helper, as the app's own postings are)
  e1 := public.acc__post(o, d, 'EGP', 'test', 'in-1500', 'posted', 'customer 1500', jsonb_build_array(jsonb_build_object('account', bank_ledger, 'debit', 150000), jsonb_build_object('role', 'opening_balance', 'credit', 150000)));
  e2 := public.acc__post(o, d + 1, 'EGP', 'test', 'out-25', 'posted', 'fee 25', jsonb_build_array(jsonb_build_object('account', bank_ledger, 'credit', 2500), jsonb_build_object('role', 'expense_default', 'debit', 2500)));
  e3 := public.acc__post(o, d + 2, 'EGP', 'test', 'in-300-200', 'posted', 'two cheques', jsonb_build_array(jsonb_build_object('account', bank_ledger, 'debit', 30000), jsonb_build_object('account', bank_ledger, 'debit', 20000), jsonb_build_object('role', 'opening_balance', 'credit', 50000)));
  e4 := public.acc__post(o, d + 3, 'EGP', 'test', 'out-999', 'posted', 'not at the bank yet', jsonb_build_array(jsonb_build_object('account', bank_ledger, 'credit', 99900), jsonb_build_object('role', 'expense_default', 'debit', 99900)));
  execute 'set constraints all immediate'; execute 'set constraints all deferred';
  select id into l1 from public.acc_entry_lines where entry_id = e1 and account_id = bank_ledger;
  select id into l2 from public.acc_entry_lines where entry_id = e2 and account_id = bank_ledger;
  select min(id), max(id) into l3a, l3b from public.acc_entry_lines where entry_id = e3 and account_id = bank_ledger;
  select id into l4 from public.acc_entry_lines where entry_id = e4 and account_id = bank_ledger;

  set local role authenticated;
  -- ---- I1: import
  j := public.trs_import_statement(bank, 'nov.csv', repeat('a', 64), 'csv', 0, 172500, jsonb_build_array(
    jsonb_build_object('bookingDate', d, 'amountMinor', 150000, 'description', 'Transfer from Delta', 'fingerprint', 'f1'),
    jsonb_build_object('bookingDate', d + 1, 'amountMinor', -2500, 'description', 'رسوم بنكية', 'fingerprint', 'f2'),
    jsonb_build_object('bookingDate', d + 2, 'amountMinor', 50000, 'description', 'Cheque deposit', 'fingerprint', 'f3'),
    jsonb_build_object('bookingDate', d + 2, 'amountMinor', -25000, 'description', 'Unknown debit', 'fingerprint', 'f4')));
  imp := (j ->> 'id')::uuid;
  if (j ->> 'added')::int <> 4 or (j ->> 'skipped')::int <> 0 then raise exception 'FAIL I1: %', j; end if;
  select id into s1 from public.trs_statement_lines where import_id = imp and fingerprint = 'f1';
  select id into s2 from public.trs_statement_lines where import_id = imp and fingerprint = 'f2';
  select id into s3 from public.trs_statement_lines where import_id = imp and fingerprint = 'f3';
  select id into s4 from public.trs_statement_lines where import_id = imp and fingerprint = 'f4';

  -- ---- I2: the same file twice; an overlapping file
  ok := false; begin perform public.trs_import_statement(bank, 'nov.csv', repeat('a', 64), 'csv', null, null, jsonb_build_array(jsonb_build_object('bookingDate', d, 'amountMinor', 1, 'fingerprint', 'zz'))); exception when others then ok := (sqlerrm = 'DUPLICATE_FILE'); end;
  if not ok then raise exception 'FAIL I2a: the same file imported twice'; end if;
  j := public.trs_import_statement(bank, 'nov-b.csv', repeat('b', 64), 'csv', null, null, jsonb_build_array(
    jsonb_build_object('bookingDate', d, 'amountMinor', 150000, 'fingerprint', 'f1'), jsonb_build_object('bookingDate', d + 4, 'amountMinor', 700, 'fingerprint', 'f5')));
  if (j ->> 'added')::int <> 1 or (j ->> 'skipped')::int <> 1 then raise exception 'FAIL I2b: overlap %', j; end if;
  ok := false; begin perform public.trs_import_statement(cash, 'c.csv', repeat('c', 64), 'csv', null, null, jsonb_build_array(jsonb_build_object('bookingDate', d, 'amountMinor', 1, 'fingerprint', 'c1'))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL I2c: imported into a cash box'; end if;

  -- ---- M1: matching rules
  ok := false; begin perform public.trs_match_line(s1, array[l2]); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL M1a: money in matched to money out'; end if;
  ok := false; begin perform public.trs_match_line(s3, array[l3a]); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL M1b: a partial amount was matched'; end if;
  ok := false; begin perform public.trs_match_line(s1, array[(select id from public.acc_entry_lines where entry_id = e1 and account_id <> bank_ledger)]); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL M1c: matched to a line of another account'; end if;
  perform public.trs_match_line(s1, array[l1]);
  perform public.trs_match_line(s2, array[l2]);
  perform public.trs_match_line(s3, array[l3a, l3b]);                                    -- a group: two cheques, one deposit
  ok := false; begin perform public.trs_match_line(s1, array[l1]); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL M1d: a matched line matched again'; end if;

  -- ---- M2: ignore needs a reason; unmatch reopens; then ignore
  ok := false; begin perform public.trs_ignore_line(s4, '  '); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL M2a: ignored without a reason'; end if;
  perform public.trs_unmatch_line(s2);
  if (select status from public.trs_statement_lines where id = s2) <> 'open' then raise exception 'FAIL M2b: unmatch did not reopen'; end if;
  perform public.trs_match_line(s2, array[l2]);                                            -- the same ledger line again, after undo
  perform public.trs_ignore_line(s4, 'bank error, refunded next month');

  -- ---- R1: who may reconcile: an admin is refused by default, allowed once the owner adds admins; a member never
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.trs_unmatch_line(s1); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R1a: an admin reconciled without being allowed'; end if;
  ok := false; begin perform public.trs_set_reconcile_roles(array['admin']); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R1b: an admin changed who may reconcile'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  if not ('owner' = any (public.trs_set_reconcile_roles(array['admin']))) then raise exception 'FAIL R1c: owner dropped from the list'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.trs_unmatch_line(s1); perform public.trs_match_line(s1, array[l1]);       -- now allowed
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.trs_ignore_line(s1, 'x'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R1d: a member reconciled'; end if;
  if exists (select 1 from public.trs_statement_lines) then raise exception 'FAIL R1e: a member sees statement lines'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- ---- C1: closing to d+3 (the 7.00 line on d+4 stays open after that date)
  --   books on d+3: 1500 - 25 + 500 - 999 = 976.00; not yet at the bank: -999.00 (l4); ignored at the bank: -250.00
  --   bank closing on d+3 = 976 + 999 - 250 = 1725.00
  ok := false; begin perform public.trs_close_reconciliation(bank, d + 4, 172500); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL C1a: closed with an open line'; end if;
  ok := false; begin perform public.trs_close_reconciliation(bank, d + 3, 172501); exception when others then ok := (sqlerrm = 'RECONCILE_DIFFERENCE'); end;
  if not ok then raise exception 'FAIL C1b: closed with a difference'; end if;
  j := public.trs_close_reconciliation(bank, d + 3, 172500);
  rec := (j ->> 'id')::uuid;
  if (j ->> 'unmatchedLedgerMinor')::bigint <> -99900 or (j ->> 'ignoredBankMinor')::bigint <> -25000 then raise exception 'FAIL C1c: %', j; end if;
  ok := false; begin perform public.trs_unmatch_line(s1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL C1d: a line in a closed period was unmatched'; end if;
  ok := false; begin perform public.trs_import_statement(bank, 'old.csv', repeat('d', 64), 'csv', null, null, jsonb_build_array(jsonb_build_object('bookingDate', d, 'amountMinor', 5, 'fingerprint', 'old1'))); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL C1e: imported into a closed period'; end if;

  -- ---- C2: reopening needs a reason, and never behind the lock date
  ok := false; begin perform public.trs_reopen_reconciliation(rec, ''); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C2a: reopened without a reason'; end if;
  perform public.core_set_lock_date(d + 3);
  ok := false; begin perform public.trs_reopen_reconciliation(rec, 'wrong cheque'); exception when others then ok := (sqlerrm like 'PERIOD_LOCKED%' or sqlerrm like '%LOCK%'); end;
  if not ok then raise exception 'FAIL C2b: reopened behind the lock date (%)', sqlerrm; end if;
  reset role;
  update public.organizations set settings = settings - 'lock_date' where id = o;
  set local role authenticated;
  perform public.trs_reopen_reconciliation(rec, 'wrong cheque');
  perform public.trs_unmatch_line(s1);                                                    -- the period is open again

  -- ---- I3: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.trs_statement_lines where org_id = o) or exists (select 1 from public.trs_reconciliations where org_id = o) then
    raise exception 'FAIL I3a: another company sees the statements';
  end if;
  ok := false; begin perform public.trs_match_line(s1, array[l1]); exception when others then ok := (sqlerrm in ('NOT_FOUND', 'MODULE_DISABLED', 'FORBIDDEN')); end;
  if not ok then raise exception 'FAIL I3b: another company matched a line'; end if;
  reset role;

  -- ---- A1: audit and anonymous
  select count(*) into n from public.audit_log where org_id = o and action like 'treasury.%' and action in
    ('treasury.statement_imported', 'treasury.statement_line_matched', 'treasury.statement_line_ignored', 'treasury.statement_line_reopened',
     'treasury.reconcile_roles_changed', 'treasury.reconciliation_closed', 'treasury.reconciliation_reopened');
  if n < 12 then raise exception 'FAIL A1a: only % audit rows', n; end if;
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL A1b: audit chain broken'; end if;
  if has_function_privilege('anon', 'public.trs_import_statement(uuid, text, text, text, bigint, bigint, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.trs__can_reconcile(uuid)', 'execute') then
    raise exception 'FAIL A1c: functions open too widely';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
