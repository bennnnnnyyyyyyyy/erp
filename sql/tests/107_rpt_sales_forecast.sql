-- sql/tests/107_rpt_sales_forecast.sql
-- The sales forecast (sql/110). Always rolls back. Needs sql/001-110.
-- Covers: F1 the plan's worked example (60, 30 and 30 sold in the three 30-day blocks: 1.5 a day, 45 in the next 30 days, trend up,
-- 'thin' with 4 invoices); F2 an approved credit note is taken off (54: 1.4 a day); F3 'good' with 10 invoices over 85 days and a flat
-- trend; F4 nothing sold in 90 days: not listed; F5 value per currency, never added across currencies; F6 by customer: values only, no
-- quantity; F7 the horizon (60 days doubles it); V1 refusals (unknown grouping or horizon); R1 members and viewers may read it;
-- I1 another company sees nothing of this company; M1 sales switched off is refused; N1 no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; ia uuid; ib uuid; ic uuid; c1 uuid; c2 uuid; so uuid; solA uuid; solB uuid; solC uuid; inv uuid; il uuid; ilA uuid;
  r jsonb; a jsonb; b jsonb; ok boolean; d int;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sf-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'sf-m@tests.invalid'),
    (v, 'authenticated', 'authenticated', 'sf-v@tests.invalid'), (x, 'authenticated', 'authenticated', 'sf-x@tests.invalid');
  o := public.bootstrap_organization('Forecast A', 'forecast-a', 'sf-o@tests.invalid');
  ob := public.bootstrap_organization('Forecast B', 'forecast-b', 'sf-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member'), (o, v, 'viewer');
  update public.organizations set timezone = 'UTC' where id in (o, ob);
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  ia := public.inv_create_item('SF-A', 'Cream', null, 'piece', 0, w);
  ib := public.inv_create_item('SF-B', 'Soap', null, 'piece', 0, w);
  ic := public.inv_create_item('SF-C', 'Old stock', null, 'piece', 0, w);
  c1 := public.sal_create_customer('Buyer One', null, 'Cairo', null);
  c2 := public.sal_create_customer('Buyer Two', null, 'Giza', null);
  reset role;

  -- fixtures, inserted directly (the order and invoice flow is tested elsewhere): one order, then invoices on chosen dates.
  so := gen_random_uuid(); solA := gen_random_uuid(); solB := gen_random_uuid(); solC := gen_random_uuid();
  insert into public.sal_orders (id, org_id, number, customer_id, warehouse_id, status, currency, created_by) values (so, o, 'SO-SF1', c1, w, 'stock_requested', 'EGP', u);
  insert into public.sal_order_lines (id, org_id, order_id, item_id, qty, unit_price_minor) values (solA, o, so, ia, 100, 1000), (solB, o, so, ib, 100, 500), (solC, o, so, ic, 100, 500);
  -- item A: 30 + 30 in the latest 30 days, 30 at day 40, 30 at day 70 (customer 1)
  for d in select unnest(array[5, 10, 40, 70]) loop
    inv := gen_random_uuid(); il := gen_random_uuid();
    insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values (inv, o, 'INV-SFA-' || d, so, c1, current_date - d, 'EGP', u);
    insert into public.sal_invoice_lines (id, org_id, invoice_id, order_line_id, qty, unit_price_minor, net_minor, tax_minor) values (il, o, inv, solA, 30, 1000, 30000, 0);
    if d = 5 then ilA := il; end if;
  end loop;
  -- item B: 10 invoices of 1 over 85 days (3, 4, 3 per block), customer 2; one of them in USD
  for d in select unnest(array[5, 15, 25, 35, 45, 50, 55, 65, 75, 85]) loop
    inv := gen_random_uuid();
    insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by)
      values (inv, o, 'INV-SFB-' || d, so, c2, current_date - d, case when d = 45 then 'USD' else 'EGP' end, u);
    insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, net_minor, tax_minor) values (o, inv, solB, 1, 500, 500, 0);
  end loop;
  -- item C: sold 100 days ago only; and a void invoice that must not count
  inv := gen_random_uuid();
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values (inv, o, 'INV-SFC', so, c1, current_date - 100, 'EGP', u);
  insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, net_minor, tax_minor) values (o, inv, solC, 50, 500, 25000, 0);
  inv := gen_random_uuid();
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by, status, voided_at, voided_by)
    values (inv, o, 'INV-SFV', so, c1, current_date - 3, 'EGP', u, 'void', now(), u);
  insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, net_minor, tax_minor) values (o, inv, solA, 999, 1000, 999000, 0);

  set local role authenticated;

  -- F1: the worked example
  r := public.rpt_sales_forecast('item', 30);
  select e into a from jsonb_array_elements(r -> 'rows') e where e ->> 'id' = ia::text;
  if a is null then raise exception 'FAIL F1a: item A missing: %', r; end if;
  if (a ->> 'qtyLast30')::numeric <> 60 or (a ->> 'qtyPrev30')::numeric <> 30 or (a ->> 'qtyOldest30')::numeric <> 30 then raise exception 'FAIL F1b: blocks %', a; end if;
  if (a ->> 'dailyQty')::numeric <> 1.5 or (a ->> 'forecastQty')::numeric <> 45 then raise exception 'FAIL F1c: rate %, forecast %', a ->> 'dailyQty', a ->> 'forecastQty'; end if;
  if a ->> 'trend' <> 'up' or a ->> 'confidence' <> 'thin' or (a ->> 'invoices')::int <> 4 or (a ->> 'historyDays')::int <> 70 then raise exception 'FAIL F1d: %', a; end if;
  if (a -> 'values' -> 0 ->> 'forecastMinor')::bigint <> 45000 or a -> 'values' -> 0 ->> 'currency' <> 'EGP' then raise exception 'FAIL F1e: value %', a -> 'values'; end if;

  -- F2: an approved credit note of 6 from the latest invoice is taken off: (0.5 x 54 + 0.3 x 30 + 0.2 x 30) / 30 = 1.4
  reset role;
  with n as (
    insert into public.sal_notes (org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, requester_id, status, decided_by, decided_at, net_minor, tax_minor, gross_minor)
    select o, 'CN-SF1', 'credit', i.invoice_id, c1, 'EGP', 'damaged', 6000, m, 'approved', u, now(), 6000, 0, 6000 from public.sal_invoice_lines i where i.id = ilA
    returning id)
  insert into public.sal_note_lines (org_id, note_id, invoice_line_id, qty, unit_price_minor, net_minor, tax_minor) select o, n.id, ilA, 6, 1000, 6000, 0 from n;
  -- a credit note still waiting changes nothing
  with n as (
    insert into public.sal_notes (org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, requester_id, net_minor, tax_minor, gross_minor)
    select o, 'CN-SF2', 'credit', i.invoice_id, c1, 'EGP', 'waiting', 10000, m, 10000, 0, 10000 from public.sal_invoice_lines i where i.id = ilA
    returning id)
  insert into public.sal_note_lines (org_id, note_id, invoice_line_id, qty, unit_price_minor, net_minor, tax_minor) select o, n.id, ilA, 10, 1000, 10000, 0 from n;
  set local role authenticated;
  select e into a from jsonb_array_elements(public.rpt_sales_forecast('item', 30) -> 'rows') e where e ->> 'id' = ia::text;
  if (a ->> 'qtyLast30')::numeric <> 54 or (a ->> 'dailyQty')::numeric <> 1.4 or (a -> 'values' -> 0 ->> 'last30Minor')::bigint <> 54000 then
    raise exception 'FAIL F2: after the credit note %', a;
  end if;

  -- F3: item B is good and flat
  select e into b from jsonb_array_elements(r -> 'rows') e where e ->> 'id' = ib::text;
  if b ->> 'confidence' <> 'good' or b ->> 'trend' <> 'flat' or (b ->> 'invoices')::int <> 10 then raise exception 'FAIL F3: %', b; end if;

  -- F4: item C (100 days ago) and the void invoice do not count
  if exists (select 1 from jsonb_array_elements(r -> 'rows') e where e ->> 'id' = ic::text) then raise exception 'FAIL F4a: an item with no sales in 90 days is listed'; end if;
  if jsonb_array_length(r -> 'rows') <> 2 then raise exception 'FAIL F4b: % rows, expected 2', jsonb_array_length(r -> 'rows'); end if;

  -- F5: item B sells in two currencies: two values, never one sum
  if jsonb_array_length(b -> 'values') <> 2 or not exists (select 1 from jsonb_array_elements(b -> 'values') val where val ->> 'currency' = 'USD' and (val ->> 'prev30Minor')::bigint = 500) then
    raise exception 'FAIL F5: values %', b -> 'values';
  end if;

  -- F6: by customer: values, no quantity
  r := public.rpt_sales_forecast('customer', 30);
  if jsonb_array_length(r -> 'rows') <> 2 then raise exception 'FAIL F6a: % customers', jsonb_array_length(r -> 'rows'); end if;
  if exists (select 1 from jsonb_array_elements(r -> 'rows') e where e -> 'forecastQty' <> 'null'::jsonb) then raise exception 'FAIL F6b: a customer has a quantity'; end if;
  if (select e ->> 'name' from jsonb_array_elements(r -> 'rows') e where e ->> 'id' = c1::text) <> 'Buyer One' then raise exception 'FAIL F6c: names'; end if;

  -- F7: 60 days doubles the forecast
  select e into a from jsonb_array_elements(public.rpt_sales_forecast('item', 60) -> 'rows') e where e ->> 'id' = ia::text;
  if (a ->> 'forecastQty')::numeric <> 84 then raise exception 'FAIL F7: 60-day forecast %, expected 84', a ->> 'forecastQty'; end if;

  -- V1: refusals
  ok := false; begin perform public.rpt_sales_forecast('branch', 30); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL V1a: unknown grouping accepted'; end if;
  ok := false; begin perform public.rpt_sales_forecast('item', 45); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL V1b: unknown horizon accepted'; end if;

  -- R1: members and viewers
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  if jsonb_array_length(public.rpt_sales_forecast('item', 30) -> 'rows') <> 2 then raise exception 'FAIL R1a: a member does not see the forecast'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  if jsonb_array_length(public.rpt_sales_forecast('customer', 90) -> 'rows') <> 2 then raise exception 'FAIL R1b: a viewer does not see the forecast'; end if;

  -- I1: the other company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  if jsonb_array_length(public.rpt_sales_forecast('item', 30) -> 'rows') <> 0 then raise exception 'FAIL I1a: another company sees this company''s sales'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  ok := false; begin perform public.rpt_sales_forecast('item', 30); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL I1b: a person read the forecast of a company they are not in'; end if;

  -- M1: sales switched off
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  reset role;
  update public.org_modules set disabled_at = now() where org_id = o and module_key = 'sales';
  set local role authenticated;
  ok := false; begin perform public.rpt_sales_forecast('item', 30); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL M1: the forecast ran with sales switched off'; end if;

  -- N1
  reset role;
  set local role anon;
  ok := false; begin perform public.rpt_sales_forecast('item', 30); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL N1: anonymous read the forecast'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
