-- sql/tests/047_statements.sql
-- Phase 2, slice 3 (sql/052): statements of account. Always rolls back. Needs sql/001-052.
-- Covers: a customer's statement has an opening balance, only their receivable lines (their sales lines excluded), a running balance
-- and a closing balance that matches the ledger; a supplier's the same on payables; another party's lines never appear; an item's
-- statement runs quantity and value, flags a move with no cost, and opens with the balance before the period; members and other
-- companies are refused; bad periods refused; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; cust uuid; cust2 uuid; supp uuid; a171 uuid; a191 uuid; a281 uuid; a331 uuid; a411 uuid; item uuid; wh uuid;
  n bigint; ok boolean; v bigint; q numeric; rec record;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'st-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'st-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'st-x@tests.invalid');
  o := public.bootstrap_organization('Statement Test A', 'statement-test-a', 'st-o@tests.invalid');
  ob := public.bootstrap_organization('Statement Test B', 'statement-test-b', 'st-x@tests.invalid');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.acc_prepare(); reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  select id into a171 from public.acc_accounts where org_id = o and code = '171';
  select id into a191 from public.acc_accounts where org_id = o and code = '191';
  select id into a281 from public.acc_accounts where org_id = o and code = '281';
  select id into a331 from public.acc_accounts where org_id = o and code = '331';
  select id into a411 from public.acc_accounts where org_id = o and code = '411';

  set local role authenticated;
  cust := public.sal_create_customer('Nile Pharmacy'); cust2 := public.sal_create_customer('Other customer'); supp := public.pur_create_supplier('Glass Co');
  -- January: Nile owes 1,000.00 (sale). March: Nile pays 300.00; Nile buys 200.00 more. The other customer owes 50.00 in March.
  -- March: Glass Co bills 500.00.
  perform public.acc_save_journal(null, date '2026-01-15', 'Sale', jsonb_build_array(
    jsonb_build_object('accountId', a171, 'debitMinor', 100000, 'partyType', 'customer', 'partyId', cust),
    jsonb_build_object('accountId', a411, 'creditMinor', 100000, 'partyType', 'customer', 'partyId', cust)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-05', 'Receipt', jsonb_build_array(
    jsonb_build_object('accountId', a191, 'debitMinor', 30000),
    jsonb_build_object('accountId', a171, 'creditMinor', 30000, 'partyType', 'customer', 'partyId', cust)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-20', 'Sale 2', jsonb_build_array(
    jsonb_build_object('accountId', a171, 'debitMinor', 20000, 'partyType', 'customer', 'partyId', cust),
    jsonb_build_object('accountId', a411, 'creditMinor', 20000, 'partyType', 'customer', 'partyId', cust)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-21', 'Other', jsonb_build_array(
    jsonb_build_object('accountId', a171, 'debitMinor', 5000, 'partyType', 'customer', 'partyId', cust2),
    jsonb_build_object('accountId', a411, 'creditMinor', 5000)), 'manual', 'EGP', true);
  perform public.acc_save_journal(null, date '2026-03-10', 'Bill', jsonb_build_array(
    jsonb_build_object('accountId', a331, 'debitMinor', 50000),
    jsonb_build_object('accountId', a281, 'creditMinor', 50000, 'partyType', 'supplier', 'partyId', supp)), 'manual', 'EGP', true);

  -- ---- P1: the customer's March statement
  select count(*) into n from public.acc_party_statement('customer', cust, date '2026-03-01', date '2026-03-31');
  if n <> 3 then raise exception 'FAIL P1a: % rows, expected 3 (opening + receipt + sale 2; revenue and other customers excluded)', n; end if;
  select balance_minor into v from public.acc_party_statement('customer', cust, date '2026-03-01', date '2026-03-31') where is_opening;
  if v <> 100000 then raise exception 'FAIL P1b: opening %', v; end if;
  select balance_minor into v from public.acc_party_statement('customer', cust, date '2026-03-01', date '2026-03-31') where not is_opening
   order by entry_date desc, line_id desc limit 1;
  if v <> 90000 then raise exception 'FAIL P1c: closing %, expected 90000', v; end if;
  for rec in select * from public.acc_party_statement('customer', cust, date '2026-03-01', date '2026-03-31') where not is_opening loop
    if rec.account_code <> '171' then raise exception 'FAIL P1d: a % line in a customer statement', rec.account_code; end if;
  end loop;
  -- the closing balance equals the customer's ledger balance on 171
  reset role;
  select sum(debit_minor - credit_minor) into v from public.acc_entry_lines where org_id = o and party_id = cust and account_id = a171;
  if v <> 90000 then raise exception 'FAIL P1e: ledger says %', v; end if;
  set local role authenticated;

  -- ---- P2: the supplier's statement (credit balance is negative)
  select balance_minor into v from public.acc_party_statement('supplier', supp, date '2026-01-01', date '2026-12-31') where not is_opening
   order by entry_date desc, line_id desc limit 1;
  if v <> -50000 then raise exception 'FAIL P2: supplier closing %, expected -50000', v; end if;
  ok := false; begin perform public.acc_party_statement('customer', supp, date '2026-01-01', date '2026-12-31'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P2b: a supplier id accepted as a customer'; end if;
  ok := false; begin perform public.acc_party_statement('customer', cust, date '2026-03-31', date '2026-03-01'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P2c: a reversed period accepted'; end if;

  -- ---- P3: members and other companies
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_party_statement('customer', cust, date '2026-01-01', date '2026-12-31'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P3a: a member read a customer statement'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_party_statement('customer', cust, date '2026-01-01', date '2026-12-31'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P3b: another company read a customer statement'; end if;

  -- ---- I1: item statement (company B, accounting off: a receipt without cost is allowed there)
  wh := public.inv_create_warehouse('WH', 'Main warehouse');
  item := public.inv_create_item('SOAP', 'Soap', null, 'piece', 10, wh, 100);
  perform public.inv_receive_stock(item, wh, 5, 'PO-1', 130);
  perform public.inv_receive_stock(item, wh, 2, 'gift', null);
  select count(*) into n from public.inv_item_statement(item, current_date, current_date);
  if n <> 4 then raise exception 'FAIL I1a: % rows, expected 4', n; end if;
  select balance_qty, balance_value_minor into q, v from public.inv_item_statement(item, current_date, current_date) where not is_opening order by move_id desc limit 1;
  if q <> 17 or v <> 1650 then raise exception 'FAIL I1b: closing % units, value %; expected 17 and 1650', q, v; end if;
  select count(*) into n from public.inv_item_statement(item, current_date, current_date) where not is_opening and not cost_known;
  if n <> 1 then raise exception 'FAIL I1c: % moves flagged without cost, expected 1', n; end if;
  select balance_qty, balance_value_minor into q, v from public.inv_item_statement(item, current_date + 1, current_date + 1) where is_opening;
  if q <> 17 or v <> 1650 then raise exception 'FAIL I1d: next day opens with % units, %', q, v; end if;
  reset role;
  insert into public.memberships (org_id, user_id, role) values (ob, m, 'member');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_item_statement(item, current_date, current_date); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL I1e: a member read an item statement (costs)'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_item_statement(item, current_date, current_date); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1f: another company read an item statement'; end if;
  reset role;

  if has_function_privilege('anon', 'public.acc_party_statement(text, uuid, date, date, text)', 'execute')
     or has_function_privilege('anon', 'public.inv_item_statement(uuid, date, date, uuid)', 'execute') then
    raise exception 'FAIL A1: anonymous can read statements';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
