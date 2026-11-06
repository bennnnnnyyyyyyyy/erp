-- sql/tests/050_stock_revaluation.sql
-- Stock revaluation to average cost (sql/055). Always rolls back. Needs sql/001-055.
-- Covers: the check shows books vs quantity × average cost per item; revaluing posts one balanced entry that brings every item to
-- quantity × average cost (write-down and write-up), against the stock-adjustment account; a second run finds nothing to do; the item
-- statement shows the correction and ends at quantity × average cost; owner or head accountant only (admin refused), members see
-- nothing; accounting must be on; lock date; other companies see nothing; audit; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; wh uuid; i1 uuid; i2 uuid; r jsonb; n bigint; ok boolean; v bigint; rec record;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'rv-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'rv-a@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'rv-x@tests.invalid');
  o := public.bootstrap_organization('Revaluation Test A', 'revaluation-test-a', 'rv-o@tests.invalid');
  ob := public.bootstrap_organization('Revaluation Test B', 'revaluation-test-b', 'rv-x@tests.invalid');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wh := public.inv_create_warehouse('WH', 'Main');
  -- before accounting: 10 soap at 1.00 and 4 cream at 5.00
  i1 := public.inv_create_item('SOAP', 'Soap', null, 'piece', 10, wh, 100);
  i2 := public.inv_create_item('CREAM', 'Cream', null, 'piece', 4, wh, 500);
  ok := false; begin perform public.acc_revalue_stock(current_date, 'too early'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL R0: revalued without accounting'; end if;
  perform public.acc_prepare();
  reset role;
  -- switch accounting on by the normal path (posts the two opening receipts), then make the books drift the way the demo seed did:
  -- the average cost is set directly, without a cost-log row, so nothing is posted
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.acc_switch_on();
  reset role;
  update public.inv_items set avg_cost_minor = 80 where id = i1;    -- books 1000, target 10 × 80 = 800: write down 200
  update public.inv_items set avg_cost_minor = 600 where id = i2;   -- books 2000, target 4 × 600 = 2400: write up 400
  set local role authenticated;

  -- ---- C1: the check
  select * into rec from public.acc_stock_value_check() where sku = 'SOAP';
  if rec.book_minor <> 1000 or rec.target_minor <> 800 or rec.difference_minor <> -200 then raise exception 'FAIL C1a: soap %', row_to_json(rec); end if;
  select * into rec from public.acc_stock_value_check() where sku = 'CREAM';
  if rec.difference_minor <> 400 then raise exception 'FAIL C1b: cream %', row_to_json(rec); end if;

  -- ---- P1: an admin who is not head accountant cannot revalue
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_revalue_stock(current_date, 'admin try'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1: an admin revalued stock'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- ---- R1: revalue
  ok := false; begin perform public.acc_revalue_stock(current_date, ''); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R1a: revalued without a reason'; end if;
  r := public.acc_revalue_stock(current_date, 'Correct sample costs');
  if (r ->> 'items')::int <> 2 or (r ->> 'netMinor')::bigint <> 200 then raise exception 'FAIL R1b: result %', r; end if;
  select count(*) into n from public.acc_stock_value_check() where difference_minor <> 0;
  if n <> 0 then raise exception 'FAIL R1c: % items still off after revaluing', n; end if;
  r := public.acc_revalue_stock(current_date, 'again');
  if (r ->> 'items')::int <> 0 then raise exception 'FAIL R1d: a second run posted again'; end if;
  reset role;
  select sum(debit_minor), sum(credit_minor) into v, n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
   where e.org_id = o and e.source_type = 'stock_revaluation';
  if v <> n or v <> 400 + 200 + 200 - 200 + 0 then
    -- lines: soap credit 200, cream debit 400, stock adjustment credit 200 (net +200): debits 400, credits 400
    if v <> 400 or n <> 400 then raise exception 'FAIL R1e: entry debits % credits %', v, n; end if;
  end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'accounting.stock.revalued') then raise exception 'FAIL R1f: no audit row'; end if;

  -- ---- S1: the item statement shows the correction and ends at quantity × average cost
  set local role authenticated;
  -- the revaluation is the day's last row (after that day's movements), so its running value is the closing value
  select balance_value_minor into v from public.inv_item_statement(i1, current_date - 1, current_date + 1) where kind = 'revaluation';
  if v <> 800 then raise exception 'FAIL S1a: soap statement ends at %, expected 800', v; end if;
  select count(*) into n from public.inv_item_statement(i1, current_date - 1, current_date + 1) where kind = 'revaluation';
  if n <> 1 then raise exception 'FAIL S1b: % revaluation rows on the statement', n; end if;

  -- ---- L1: lock date
  perform public.core_set_lock_date(current_date - 1);
  ok := false; begin perform public.acc_revalue_stock(current_date - 5, 'old'); exception when others then ok := (sqlerrm = 'PERIOD_LOCKED'); end;
  if not ok then raise exception 'FAIL L1: revalued in a locked period'; end if;

  -- ---- I1: other companies
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.acc_stock_value_check();
  if n <> 0 then raise exception 'FAIL I1: another company sees % items', n; end if;
  reset role;

  if has_function_privilege('anon', 'public.acc_revalue_stock(date, text)', 'execute')
     or has_function_privilege('authenticated', 'public.acc__stock_value_rows(uuid)', 'execute') then
    raise exception 'FAIL A1: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
