-- sql/tests/025_stock_forecast.sql
-- Forecast: a KNOWN ANSWER. Item F-1: receipt of 200, then issues of 60 units in the latest 30 days and 30 units in the 30 before:
-- rate = (0.5 x 60 + 0.3 x 30 + 0.2 x 0) / 30 = 1.3 per day; available 110; cover = floor(110 / 1.3) = 84 days; thin data (3 issues,
-- history under 60 days); lead time 7 (never bought) -> suggestion = ceil(1.3 x 14 - 110) = 0. Item F-2 is nearly out (cover 3 days,
-- suggestion > 0), F-3 had no usage (no forecast), F-4 has 12 issues over 80 days (confidence good), purchases set the lead time and
-- the "already ordered" quantity. Also: members may read, isolation, anonymous refused. Always rolls back. Needs sql/001-029.

do $$
declare
  u uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid; s uuid; po uuid; rq uuid;
  rec record; n bigint; ok boolean; k int;
begin
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'fc-o@tests.invalid'), (x, 'authenticated', 'authenticated', 'fc-x@tests.invalid');
  o := public.bootstrap_organization('Forecast Test A', 'forecast-test-a', 'fc-o@tests.invalid');
  ob := public.bootstrap_organization('Forecast Test B', 'forecast-test-b', 'fc-x@tests.invalid');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('F-1', 'Steady item', null, 'piece', 200, w);
  i2 := public.inv_create_item('F-2', 'Nearly out', null, 'piece', 96, w);
  i3 := public.inv_create_item('F-3', 'No usage', null, 'piece', 50, w);
  i4 := public.inv_create_item('F-4', 'Long history', null, 'piece', 500, w);
  s := public.pur_create_supplier('Supplier', null, null, null);
  reset role;

  -- history: issues written directly with back-dated times (the ledger only accepts them against an approved request)
  create temp table t_h (sku text, days_ago int, qty numeric) on commit drop;
  insert into t_h values ('F-1', 5, 30), ('F-1', 20, 30), ('F-1', 40, 30),            -- 60 in the latest 30 days? 5 and 20 days ago = 60; 40 days ago = 30 (second period)
                         ('F-2', 2, 9), ('F-2', 4, 9), ('F-2', 6, 9), ('F-2', 8, 9), ('F-2', 10, 9), ('F-2', 12, 9), ('F-2', 14, 9), ('F-2', 16, 9), ('F-2', 18, 9), ('F-2', 20, 9);   -- 90 units in 20 days: 6 left, 1.5 a day
  for k in 1..12 loop insert into t_h values ('F-4', 80 - (k - 1) * 7, 10); end loop;   -- 12 issues of 10, from 80 days ago to 3 days ago
  for rec in select * from t_h order by days_ago desc loop
    insert into public.inv_requests (org_id, number, requester_id, warehouse_id, reason, status, decided_by, decided_at)
    values (o, 'T-' || (select count(*) + 1 from public.inv_requests where org_id = o), u, w, 'history', 'approved', (select id from auth.users where id = x), now())
    returning id into rq;
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, request_id, posted_by, posted_at)
    values (o, (select id from public.inv_items where org_id = o and sku = rec.sku), w, -rec.qty, 'issue', rq, u, now() - make_interval(days => rec.days_ago));
  end loop;
  -- balances follow the ledger
  update public.inv_stock_balances b set on_hand = coalesce((select sum(m.qty) from public.inv_stock_moves m where m.org_id = b.org_id and m.item_id = b.item_id and m.warehouse_id = b.warehouse_id), 0) where b.org_id = o;

  -- S1: the known answer for F-1
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into rec from public.inv_forecast() where sku = 'F-1';
  reset role;
  -- latest 30 days: issues 5 and 20 days ago = 60; 30-60 days: 40 days ago = 30
  if rec.available <> 110 then raise exception 'FAIL S1a: available % (expected 110)', rec.available; end if;
  if round(rec.daily_rate, 3) <> 1.300 then raise exception 'FAIL S1b: daily rate % (expected 1.3)', rec.daily_rate; end if;
  if rec.days_of_cover <> 84 then raise exception 'FAIL S1c: days of cover % (expected 84)', rec.days_of_cover; end if;
  if rec.runs_out_on <> current_date + 84 then raise exception 'FAIL S1d: runs out on %', rec.runs_out_on; end if;
  if rec.confidence <> 'thin' or rec.issues_count <> 3 then raise exception 'FAIL S1e: confidence % with % issues', rec.confidence, rec.issues_count; end if;
  if rec.lead_days <> 7 or rec.suggested_order <> 0 then raise exception 'FAIL S1f: lead % suggestion %', rec.lead_days, rec.suggested_order; end if;

  -- S2: F-2 is nearly out (6 left at 1.5 a day = 4 days) and a reorder is suggested; F-3 has no forecast; F-4 has good confidence
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into rec from public.inv_forecast() where sku = 'F-2';
  if rec.suggested_order is null or rec.suggested_order <= 0 then raise exception 'FAIL S2a: no reorder suggested for the nearly-out item (%)', rec.suggested_order; end if;
  if rec.days_of_cover is null or rec.days_of_cover > 5 then raise exception 'FAIL S2b: cover % days', rec.days_of_cover; end if;
  select * into rec from public.inv_forecast() where sku = 'F-3';
  if rec.confidence <> 'none' or rec.days_of_cover is not null or rec.runs_out_on is not null or rec.suggested_order is not null then raise exception 'FAIL S3: an unused item got a forecast (%)', rec; end if;
  select * into rec from public.inv_forecast() where sku = 'F-4';
  if rec.confidence <> 'good' or rec.issues_count <> 12 then raise exception 'FAIL S4: long-history item is % with % issues', rec.confidence, rec.issues_count; end if;
  reset role;

  -- S5: purchases set the lead time (10 days) and the quantity already on order is subtracted from the suggestion
  insert into public.pur_orders (org_id, number, supplier_id, warehouse_id, status, currency, created_by, received_by, received_at, created_at)
  values (o, 'PO-T1', s, w, 'received', 'EGP', u, u, now() - interval '20 days', now() - interval '30 days') returning id into po;
  insert into public.pur_order_lines (org_id, order_id, item_id, qty, unit_cost_minor) values (o, po, i2, 5, 100);
  insert into public.pur_orders (org_id, number, supplier_id, warehouse_id, status, currency, created_by) values (o, 'PO-T2', s, w, 'ordered', 'EGP', u) returning id into po;
  insert into public.pur_order_lines (org_id, order_id, item_id, qty, unit_cost_minor) values (o, po, i2, 4, 100);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into rec from public.inv_forecast() where sku = 'F-2';
  reset role;
  if rec.lead_days <> 10 then raise exception 'FAIL S5a: lead time % (expected 10)', rec.lead_days; end if;
  if rec.on_order <> 4 then raise exception 'FAIL S5b: on order % (expected 4)', rec.on_order; end if;

  -- S6: ordering is by days of cover (soonest first, unused items last); read-only for another organization; anonymous refused
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select sku into rec from public.inv_forecast() limit 1;
  if rec.sku <> 'F-2' then raise exception 'FAIL S6a: first row is % (expected F-2)', rec.sku; end if;
  select sku into rec from (select sku from public.inv_forecast() offset 3 limit 1) z;
  if rec.sku <> 'F-3' then raise exception 'FAIL S6b: last row is % (expected F-3)', rec.sku; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_forecast(); if n <> 0 then raise exception 'FAIL S6c: another organization sees % rows', n; end if;
  reset role;
  set local role anon;
  ok := false; begin perform public.inv_forecast(); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL S6d: anonymous could call it'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
