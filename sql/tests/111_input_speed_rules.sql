-- sql/tests/111_input_speed_rules.sql
-- The database side of the input and speed audit (sql/114). Always rolls back. Needs sql/001-114.
-- Covers: P1 the phone rule (Egypt, other countries, Ben's "+2015556487744"); P2 customers and suppliers refuse a bad phone and long
-- contact/city; T1 tax numbers (ETA profile, customer B/P); D1 posting dates:
-- after tomorrow refused, today fine, a year outside 1900-2100 refused, on invoices' and expenses' paths; D2 a new task due in the
-- past refused; C1 caps on amounts; S1 open items summed in SQL (gross, notes, payments) and S2 sales by product; J1 the JSON forms of
-- item costs, the forecast and the expiry report; R1 the report builder still sorts and cuts with "order by ... limit"; F1 the
-- forecast says "limited".

do $$
declare
  u uuid := gen_random_uuid();
  o uuid; w uuid; it uuid; cust uuid; sup uuid; cat uuid; ex uuid; ok boolean; j jsonb; n int;
begin
  -- P1
  foreach j in array array['["01001234567", true]', '["+20 100 123 4567", true]', '["0227912345", true]', '["+971 4 555 0102", true]',
                           '["+2015556487744", false]', '["phone", false]', '["0123", false]', '[null, true]', '["", true]']::jsonb[] loop
    if public.core__phone_ok(j ->> 0) <> (j ->> 1)::boolean then raise exception 'FAIL P1: % gave the wrong answer', j ->> 0; end if;
  end loop;
  if not public.core__phone_ok('٠١٠٠١٢٣٤٥٦٧') then raise exception 'FAIL P1b: Arabic digits refused'; end if;
  if public.core__eg_mobile_ok('0227912345') or not public.core__eg_mobile_ok('+20 100 123 4567') then raise exception 'FAIL P1c: Egyptian mobile rule'; end if;

  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'isr-o@tests.invalid');
  o := public.bootstrap_organization('Input rules A', 'input-rules-a', 'isr-o@tests.invalid');
  perform public.core_enable_all_modules(o);
  update public.organizations set timezone = 'Africa/Cairo' where id = o;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- P2: customers and suppliers
  sup := public.pur_create_supplier('Glass Co', 'Ali', 'Cairo', '+20 100 555 0141');
  ok := false; begin perform public.pur_create_supplier('Bad phone', null, null, '+2015556487744'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL P2a: a bad supplier phone was saved'; end if;
  ok := false; begin perform public.pur_create_supplier('Long contact', repeat('x', 121), null, null); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL P2b: a 121-character contact was saved'; end if;
  ok := false; begin perform public.pur_update_supplier(sup, 'Glass Co', null, repeat('c', 81), null); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL P2c: an 81-character city was saved'; end if;
  -- T1: tax numbers
  reset role;
  ok := false; begin insert into public.tax_profiles (org_id, registration_number, legal_name, activity_code) values (o, '12345', 'X', '4772'); exception when check_violation then ok := true; when others then ok := sqlerrm like '%tax_profiles_eta_numbers_chk%'; end;
  if not ok then raise exception 'FAIL T1a: a 5-digit registration number was saved'; end if;
  insert into public.sal_customers (org_id, name, code) values (o, 'Tax test', 'C-TAX') returning id into cust;
  ok := false; begin update public.sal_customers set tax_id_type = 'B', tax_id = '12345' where id = cust; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL T1b: a business tax ID of 5 digits was saved'; end if;
  ok := false; begin update public.sal_customers set tax_id_type = 'P', tax_id = '12345678901234' where id = cust; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL T1c: a national ID starting with 1 was saved'; end if;
  update public.sal_customers set tax_id_type = 'P', tax_id = '29001011234567' where id = cust;
  set local role authenticated;

  -- D1: posting dates
  cat := public.fin_create_category('Rent');
  ok := false; begin perform public.fin_record_expense(current_date + 5, cat, 5000); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D1a: an expense 5 days ahead was saved'; end if;
  ok := false; begin perform public.fin_record_expense(date '1850-01-01', cat, 5000); exception when others then ok := (sqlerrm in ('INVALID_INPUT', 'PERIOD_LOCKED')); end;
  if not ok then raise exception 'FAIL D1b: an expense in 1850 was saved'; end if;
  ex := (public.fin_record_expense(current_date, cat, 5000) ->> 'id')::uuid;
  if ex is null then raise exception 'FAIL D1c: an expense dated today was refused'; end if;
  reset role;
  ok := false; begin update public.fin_expenses set expense_date = current_date + 10 where id = ex; exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D1d: an expense moved 10 days ahead was saved'; end if;
  update public.fin_expenses set note = 'changed' where id = ex;   -- other changes are not affected
  set local role authenticated;

  -- D2: a new task due in the past
  ok := false; begin perform public.tsk_create_task('Late already', u, now() - interval '1 hour'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D2: a task due an hour ago was made'; end if;
  perform public.tsk_create_task('Fine', u, now() + interval '1 hour');

  -- C1: caps
  ok := false; begin perform public.fin_record_expense(current_date, cat, 2000000000000); exception when others then ok := (sqlerrm in ('INVALID_INPUT') or sqlerrm like '%cap_chk%'); end;
  if not ok then raise exception 'FAIL C1: an expense above 1e12 minor units was saved'; end if;

  -- S1: open items in SQL: the expense of 50.00 is owed (out); nothing is owed in
  j := public.fin_open_items('out');
  if jsonb_array_length(j) <> 1 or (j -> 0 ->> 'kind') <> 'expense' or (j -> 0 ->> 'totalMinor')::bigint <> 5000 or (j -> 0 ->> 'paidMinor')::bigint <> 0
     or (j -> 0 ->> 'detail') not like 'Rent · changed' then
    raise exception 'FAIL S1a: open items out %', j;
  end if;
  if jsonb_array_length(public.fin_open_items('in')) <> 0 then raise exception 'FAIL S1b: open items in should be empty'; end if;
  ok := false; begin perform public.fin_open_items('sideways'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1c: an unknown direction was accepted'; end if;

  -- S2: sales by product (no sales: an empty list and a total of 0)
  j := public.fin_product_sales(90);
  if (j ->> 'totalMinor')::bigint <> 0 or jsonb_array_length(j -> 'rows') <> 0 then raise exception 'FAIL S2: product sales %', j; end if;

  -- J1: the JSON forms
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  it := public.inv_create_item('ISR-1', 'Cream', null, 'piece', 7, w);
  j := public.inv_item_costs_json();
  if jsonb_typeof(j) <> 'array' or not exists (select 1 from jsonb_array_elements(j) e where e ->> 'item_id' = it::text and (e ->> 'on_hand')::numeric = 7) then
    raise exception 'FAIL J1a: item costs %', j;
  end if;
  if jsonb_typeof(public.inv_forecast_json()) <> 'array' then raise exception 'FAIL J1b: forecast is not a list'; end if;
  if jsonb_typeof(public.inv_expiry_report_json(30)) <> 'array' then raise exception 'FAIL J1c: expiry is not a list'; end if;

  -- R1: the report builder sorts and cuts
  j := public.rpt_run('{"source": "stock_on_hand", "groupBy": ["warehouse"], "totals": [{"column": "available", "fn": "sum"}], "sort": [{"column": "sum_available", "dir": "desc"}], "limit": 1}'::jsonb);
  if jsonb_array_length(j -> 'rows') <> 1 or (j -> 'rows' -> 0 ->> 1)::numeric <> 7 then raise exception 'FAIL R1: builder rows %', j -> 'rows'; end if;

  -- F1: the forecast says whether it was cut
  j := public.rpt_sales_forecast('item', 30);
  if j -> 'limited' is null or (j ->> 'limited')::boolean then raise exception 'FAIL F1: forecast limited flag %', j -> 'limited'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
