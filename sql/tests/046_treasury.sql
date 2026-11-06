-- sql/tests/046_treasury.sql
-- Phase 2, slice 2 (sql/051): treasury accounts, payments through them, transfers. Always rolls back. Needs sql/001-051.
-- Covers: treasury needs accounting on; seeding on the role accounts (safe to repeat); a new box gets its own ledger account under 19;
-- a payment before treasury is on keeps posting to the role; once on, cash and bank need a treasury account of the right kind and
-- currency; it posts to that account; card takes none; transfers post, are refused for the same account or another currency, void
-- reverses once; lock date; balance from the ledger; no deactivation with money in it; ledger account rules; members and other
-- companies see nothing; audit; no anonymous use; the books still balance.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; cat uuid; ex1 uuid; ex2 uuid; ex3 uuid; cash_main uuid; bank_main uuid; alex uuid; usd uuid; tr jsonb; n bigint; ok boolean;
  v_bal bigint; v_ledger uuid; acc195 uuid; pay jsonb; v_dr bigint; v_cr bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'trs-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'trs-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'trs-x@tests.invalid');
  o := public.bootstrap_organization('Treasury Test A', 'treasury-test-a', 'trs-o@tests.invalid');
  ob := public.bootstrap_organization('Treasury Test B', 'treasury-test-b', 'trs-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);   -- the test needs a known company currency
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- ---- T0: treasury needs accounting on
  ok := false; begin insert into public.org_modules (org_id, module_key) values (ob, 'treasury'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T0: treasury switched on without accounting'; end if;

  -- accounting on for A (as sql/tests/044)
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.acc_prepare(); reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);

  -- ---- T11 (first): a cash payment before treasury is on needs no treasury account and posts to the cash role (191)
  set local role authenticated;
  cat := public.fin_create_category('Rent');
  ex1 := ((public.fin_record_expense(current_date, cat, 50000, null, 'Rent')) ->> 'id')::uuid;
  pay := public.fin_record_payment('out', 10000, current_date, 'cash', null, null, ex1, 'before treasury');
  reset role;
  if not exists (select 1 from public.acc_entry_lines l join public.acc_accounts a on a.id = l.account_id
                  join public.acc_entries e on e.id = l.entry_id
                 where e.org_id = o and e.source_id = pay ->> 'id' and a.code = '191' and l.credit_minor = 10000) then
    raise exception 'FAIL T11: a payment before treasury did not post to 191';
  end if;
  insert into public.org_modules (org_id, module_key) values (o, 'treasury');
  set local role authenticated;

  -- ---- T1: seeding on the role accounts; safe to repeat
  if (public.trs_prepare() ->> 'accountsAdded')::int <> 6 then raise exception 'FAIL T1a: expected 6 default accounts'; end if;
  if (public.trs_prepare() ->> 'accountsAdded')::int <> 0 then raise exception 'FAIL T1b: prepare added accounts twice'; end if;
  select id into cash_main from public.trs_accounts where org_id = o and code = 'CASH-MAIN';
  select id into bank_main from public.trs_accounts where org_id = o and code = 'BANK-MAIN';
  if (select a.code from public.trs_accounts t join public.acc_accounts a on a.id = t.ledger_account_id where t.id = cash_main) <> '191' then
    raise exception 'FAIL T1c: the main cash box is not on 191';
  end if;
  if (select branch_id from public.trs_accounts where id = cash_main) is distinct from (select id from public.core_branches where org_id = o and code = 'MAIN') then
    raise exception 'FAIL T1d: default accounts not in MAIN';
  end if;

  -- ---- T2: a new box gets its own ledger account under 19
  alex := public.trs_save_account(null, 'cash-alx', 'Cash box Alex', 'خزينة الإسكندرية', 'cash', null, null, null, true);
  select t.ledger_account_id into acc195 from public.trs_accounts t where t.id = alex;
  if (select code from public.acc_accounts where id = acc195) <> '195' then raise exception 'FAIL T2a: new ledger code %', (select code from public.acc_accounts where id = acc195); end if;
  if (select p.code from public.acc_accounts a join public.acc_accounts p on p.id = a.parent_id where a.id = acc195) <> '19' then raise exception 'FAIL T2b: not under 19'; end if;
  ok := false; begin perform public.trs_save_account(null, 'DUP', 'Same ledger', null, 'cash', null, null, acc195); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL T2c: two treasury accounts on one ledger account'; end if;
  ok := false; begin perform public.trs_save_account(null, 'REV', 'Revenue as cash', null, 'cash', null, null, (select id from public.acc_accounts where org_id = o and code = '411')); exception when others then ok := (sqlerrm = 'ACCOUNT_INACTIVE'); end;
  if not ok then raise exception 'FAIL T2d: a revenue account accepted as a cash box'; end if;
  ok := false; begin perform public.trs_save_account(null, 'GRP', 'Group', null, 'cash', null, null, (select id from public.acc_accounts where org_id = o and code = '19')); exception when others then ok := (sqlerrm = 'NOT_LEAF'); end;
  if not ok then raise exception 'FAIL T2e: a group account accepted as a cash box'; end if;
  usd := public.trs_save_account(null, 'USD-BOX', 'Dollar box', null, 'cash', 'USD', null, null, true);

  -- ---- T3: cash and bank payments need a fitting treasury account, and post to it
  ex2 := ((public.fin_record_expense(current_date, cat, 50000, null, 'Rent 2')) ->> 'id')::uuid;
  ok := false; begin perform public.fin_record_payment('out', 10000, current_date, 'cash', null, null, ex2, null); exception when others then ok := (sqlerrm = 'TREASURY_ACCOUNT_REQUIRED'); end;
  if not ok then raise exception 'FAIL T3a: a cash payment without a treasury account was accepted'; end if;
  ok := false; begin perform public.fin_record_payment('out', 10000, current_date, 'cash', null, null, ex2, null, bank_main); exception when others then ok := (sqlerrm = 'TREASURY_MISMATCH'); end;
  if not ok then raise exception 'FAIL T3b: a cash payment through a bank account was accepted'; end if;
  ok := false; begin perform public.fin_record_payment('out', 10000, current_date, 'cash', null, null, ex2, null, usd); exception when others then ok := (sqlerrm = 'TREASURY_MISMATCH'); end;
  if not ok then raise exception 'FAIL T3c: an EGP payment through a USD box was accepted'; end if;
  ok := false; begin perform public.fin_record_payment('out', 10000, current_date, 'card', null, null, ex2, null, alex); exception when others then ok := (sqlerrm = 'TREASURY_MISMATCH'); end;
  if not ok then raise exception 'FAIL T3d: a card payment took a cash box'; end if;
  pay := public.fin_record_payment('out', 20000, current_date, 'cash', null, null, ex2, null, alex);
  perform public.fin_record_payment('out', 5000, current_date, 'card', null, null, ex2, null);
  reset role;
  if not exists (select 1 from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
                 where e.org_id = o and e.source_id = pay ->> 'id' and l.account_id = acc195 and l.credit_minor = 20000) then
    raise exception 'FAIL T3e: the cash payment did not post to the box''s ledger account';
  end if;
  set local role authenticated;

  -- ---- T4: transfers
  tr := public.trs_record_transfer(bank_main, alex, 100000, current_date, 'float');
  select balance_minor into v_bal from public.trs_balances() where account_id = alex;
  if v_bal <> 80000 then raise exception 'FAIL T4a: Alex balance %, expected 80000 (100000 in, 20000 out)', v_bal; end if;
  select balance_minor into v_bal from public.trs_balances() where account_id = bank_main;
  if v_bal <> -100000 then raise exception 'FAIL T4b: bank balance %', v_bal; end if;
  ok := false; begin perform public.trs_record_transfer(alex, alex, 100, current_date); exception when others then ok := (sqlerrm = 'SAME_ACCOUNT'); end;
  if not ok then raise exception 'FAIL T4c: a transfer to the same account'; end if;
  ok := false; begin perform public.trs_record_transfer(alex, usd, 100, current_date); exception when others then ok := (sqlerrm = 'CURRENCY_MISMATCH'); end;
  if not ok then raise exception 'FAIL T4d: a transfer between currencies'; end if;
  ok := false; begin perform public.trs_record_transfer(alex, bank_main, 0, current_date); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T4e: a zero transfer'; end if;
  perform public.trs_void_transfer((tr ->> 'id')::uuid);
  select balance_minor into v_bal from public.trs_balances() where account_id = alex;
  if v_bal <> -20000 then raise exception 'FAIL T4f: Alex balance after the void %, expected -20000', v_bal; end if;
  ok := false; begin perform public.trs_void_transfer((tr ->> 'id')::uuid); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T4g: a transfer voided twice'; end if;

  -- ---- T5: no deactivation with money in it; an empty one can be
  ok := false; begin perform public.trs_save_account(alex, 'CASH-ALX', 'Cash box Alex', null, 'cash', null, null, null, false, null, null, false); exception when others then ok := (sqlerrm = 'HAS_BALANCE'); end;
  if not ok then raise exception 'FAIL T5a: deactivated a box that holds money'; end if;
  perform public.trs_save_account(usd, 'USD-BOX', 'Dollar box', null, 'cash', 'USD', null, null, false, null, null, false);
  ok := false; begin perform public.trs_save_account(alex, 'CASH-ALX', 'Cash box Alex', null, 'bank'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T5b: changed a box into a bank account'; end if;

  -- ---- T6: lock date
  perform public.core_set_lock_date(current_date - 1);
  ok := false; begin perform public.trs_record_transfer(bank_main, alex, 100, current_date - 5); exception when others then ok := (sqlerrm = 'PERIOD_LOCKED'); end;
  if not ok then raise exception 'FAIL T6: a transfer dated in a locked period'; end if;

  -- ---- T7: members see nothing and cannot transfer
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  select count(*) into n from public.trs_accounts;
  if n <> 0 then raise exception 'FAIL T7a: a member sees % treasury accounts', n; end if;
  ok := false; begin perform public.trs_record_transfer(bank_main, alex, 100, current_date); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T7b: a member made a transfer'; end if;
  ok := false; begin insert into public.trs_transfers (org_id, number, from_account_id, to_account_id, amount_minor, currency, transfer_date, created_by)
    values (o, 'X', bank_main, alex, 1, 'EGP', current_date, m); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL T7c: direct insert into transfers allowed'; end if;

  -- ---- T8: another company sees nothing
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.trs_accounts where org_id = o;
  if n <> 0 then raise exception 'FAIL T8a: another company sees % treasury accounts', n; end if;
  ok := false; begin perform public.trs_record_transfer(bank_main, alex, 100, current_date); exception when others then ok := (sqlerrm in ('MODULE_DISABLED', 'NOT_FOUND')); end;
  if not ok then raise exception 'FAIL T8b: another company moved money'; end if;
  reset role;

  -- ---- T9: audit, the books balance, no anonymous use
  select count(*) into n from public.audit_log where org_id = o and action in ('treasury.prepared', 'treasury.account.created', 'treasury.account.changed',
    'treasury.transfer.recorded', 'treasury.transfer.voided');
  if n < 6 then raise exception 'FAIL T9a: only % treasury audit rows', n; end if;
  select sum(l.debit_minor), sum(l.credit_minor) into v_dr, v_cr from public.acc_entry_lines l where l.org_id = o;
  if v_dr <> v_cr then raise exception 'FAIL T9b: books do not balance: % / %', v_dr, v_cr; end if;
  if has_function_privilege('anon', 'public.trs_record_transfer(uuid, uuid, bigint, date, text)', 'execute')
     or has_function_privilege('anon', 'public.fin_record_payment(text, bigint, date, text, uuid, uuid, uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.trs__ledger_balance(uuid, uuid, text, date)', 'execute') then
    raise exception 'FAIL T9c: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
