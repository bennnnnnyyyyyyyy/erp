-- sql/tests/081_financial_statements.sql
-- Financial statements (sql/085): income statement for a period and balance sheet at a date, by statement line. Always rolls back.
-- Needs sql/001-085. Covers: default lines from the Egyptian chart codes; natural signs; net profit; the balance sheet balances, with the
-- year's profit to date and earlier years' unclosed profit as equity rows; a set line overrides the default and is audited; a line from
-- the other statement is refused; members cannot read or set; another company sees nothing.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; cash uuid; bank uuid; sales uuid; cogs uuid; exp331 uuid; stock uuid; capital uuid;
  n bigint; s text; ok boolean; v bigint; v_assets bigint; v_claims bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'fs-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'fs-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'fs-x@tests.invalid');
  o := public.bootstrap_organization('Statements Test A', 'statements-test-a', 'fs-o@tests.invalid');
  ob := public.bootstrap_organization('Statements Test B', 'statements-test-b', 'fs-x@tests.invalid');
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
  select id into sales from public.acc_accounts where org_id = o and code = '411';
  select id into cogs from public.acc_accounts where org_id = o and code = '341';
  select id into exp331 from public.acc_accounts where org_id = o and code = '331';
  select id into stock from public.acc_accounts where org_id = o and code = '161';
  select id into capital from public.acc_accounts where org_id = o and code = '211';

  -- The ledger. 2025: sales 1,000.00 into the bank (an earlier year, not closed). 2026: opening capital 500.00 in the bank (1 Jan); in
  -- March sales 300.00, cost of those goods 120.00, stationery 20.00 from the bank.
  set local role authenticated;
  perform public.acc_create_fiscal_year('FY2025', date '2025-01-01', date '2025-12-31');
  perform public.acc_create_fiscal_year('FY2026', date '2026-01-01', date '2026-12-31');
  perform public.acc_save_journal(null, date '2025-06-01', 'Old sales', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 100000), jsonb_build_object('accountId', sales, 'creditMinor', 100000)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-01-01', 'Opening', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 50000), jsonb_build_object('accountId', capital, 'creditMinor', 50000)), 'opening', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-05', 'Sales', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 30000), jsonb_build_object('accountId', sales, 'creditMinor', 30000)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-06', 'Cost', jsonb_build_array(jsonb_build_object('accountId', cogs, 'debitMinor', 12000), jsonb_build_object('accountId', stock, 'creditMinor', 12000)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-07', 'Stationery', jsonb_build_array(jsonb_build_object('accountId', exp331, 'debitMinor', 2000), jsonb_build_object('accountId', bank, 'creditMinor', 2000)), 'manual', 'EGP', true);

  -- ---- F1: income statement for March 2026, default lines
  select amount_minor into v from public.acc_income_statement(date '2026-03-01', date '2026-03-31') where line = 'revenue' and code = '411';
  if v is distinct from 30000::bigint then raise exception 'FAIL F1a: revenue %', v; end if;
  select amount_minor into v from public.acc_income_statement(date '2026-03-01', date '2026-03-31') where line = 'cost_of_sales' and code = '341';
  if v is distinct from 12000::bigint then raise exception 'FAIL F1b: cost of sales %', v; end if;
  select amount_minor into v from public.acc_income_statement(date '2026-03-01', date '2026-03-31') where line = 'operating_expenses' and code = '331';
  if v is distinct from 2000::bigint then raise exception 'FAIL F1c: operating expenses %', v; end if;
  select sum(case when line in ('revenue', 'other_income') then amount_minor else -amount_minor end) into v from public.acc_income_statement(date '2026-03-01', date '2026-03-31');
  if v is distinct from 16000::bigint then raise exception 'FAIL F1d: net profit %', v; end if;
  select count(*) into n from public.acc_income_statement(date '2026-03-01', date '2026-03-31');
  if n <> 3 then raise exception 'FAIL F1e: % rows (balance sheet accounts or 2025 must not appear)', n; end if;

  -- ---- F2: balance sheet at 31 Mar 2026 balances
  select amount_minor into v from public.acc_balance_sheet(date '2026-03-31') where code = '192';
  if v is distinct from 178000::bigint then raise exception 'FAIL F2a: bank % (cash line)', v; end if;
  select line into s from public.acc_balance_sheet(date '2026-03-31') where code = '192';
  if s is distinct from 'cash' then raise exception 'FAIL F2b: the bank is not on the cash line'; end if;
  select amount_minor into v from public.acc_balance_sheet(date '2026-03-31') where name = 'Profit for the year to date';
  if v is distinct from 16000::bigint then raise exception 'FAIL F2c: profit for the year %', v; end if;
  select amount_minor into v from public.acc_balance_sheet(date '2026-03-31') where name = 'Profit of earlier years not yet closed';
  if v is distinct from 100000::bigint then raise exception 'FAIL F2d: earlier years %', v; end if;
  select coalesce(sum(amount_minor) filter (where line in ('non_current_assets', 'inventory', 'receivables', 'cash', 'other_current_assets')), 0),
         coalesce(sum(amount_minor) filter (where line in ('equity', 'non_current_liabilities', 'current_liabilities')), 0)
    into v_assets, v_claims from public.acc_balance_sheet(date '2026-03-31');
  if v_assets <> v_claims or v_assets <> 166000 then raise exception 'FAIL F2e: assets % vs equity and liabilities %', v_assets, v_claims; end if;
  select count(*) into n from public.acc_balance_sheet(date '2026-03-31') where code in ('411', '341', '331');
  if n <> 0 then raise exception 'FAIL F2f: income statement accounts on the balance sheet'; end if;

  -- ---- F3: a set line overrides the default, is audited, and a line from the other statement is refused
  perform public.acc_set_statement_line(exp331, 'finance_costs');
  select count(*) into n from public.acc_income_statement(date '2026-03-01', date '2026-03-31') where code = '331' and line = 'finance_costs';
  if n <> 1 then raise exception 'FAIL F3a: the set line was not used'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action = 'accounting.account.statement_line' and entity_id = exp331::text;
  if n <> 1 then raise exception 'FAIL F3b: % audit rows', n; end if;
  set local role authenticated;
  ok := false; begin perform public.acc_set_statement_line(capital, 'revenue'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL F3c: an equity account was put on the income statement'; end if;
  perform public.acc_set_statement_line(exp331, null);
  select count(*) into n from public.acc_income_statement(date '2026-03-01', date '2026-03-31') where code = '331' and line = 'operating_expenses';
  if n <> 1 then raise exception 'FAIL F3d: clearing the line did not restore the default'; end if;
  ok := false; begin perform public.acc_balance_sheet(null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL F3e: a balance sheet without a date was accepted'; end if;

  -- ---- F4: a member can neither read nor set
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_income_statement(date '2026-03-01', date '2026-03-31'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL F4a: a member read the income statement'; end if;
  ok := false; begin perform public.acc_set_statement_line(exp331, 'finance_costs'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL F4b: a member set a statement line'; end if;

  -- ---- F5: the other company sees none of it
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.acc_income_statement(date '2025-01-01', date '2026-12-31');
  if n <> 0 then raise exception 'FAIL F5a: company B sees % income statement rows', n; end if;
  select count(*) into n from public.acc_balance_sheet(date '2026-12-31');
  if n <> 0 then raise exception 'FAIL F5b: company B sees % balance sheet rows', n; end if;
  ok := false; begin perform public.acc_set_statement_line(exp331, 'finance_costs'); exception when others then ok := (sqlerrm in ('NOT_FOUND', 'FORBIDDEN')); end;
  if not ok then raise exception 'FAIL F5c: company B changed company A''s account'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
