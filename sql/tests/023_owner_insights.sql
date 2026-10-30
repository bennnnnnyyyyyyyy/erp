-- sql/tests/023_owner_insights.sql
-- Owner insights: a KNOWN ANSWER. One delivered and invoiced order (10 units at 250 = 2500, average cost 100 = cost of goods
-- 1000), one expense of 300, one payment of 1000 received: this month revenue 2500, cost 1000, expenses 300, net 1200, owed to
-- me 1500. Also stock value, low stock, expiry buckets, decisions waiting, members refused, isolation. Always rolls back.
-- Needs sql/001-027. Run after the demo data exists or not: it uses its own organization.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid; cinv uuid; cat uuid; ex uuid; ba uuid; rq2 uuid;
  j jsonb; cur jsonb; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ins-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'ins-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'ins-x@tests.invalid');
  o := public.bootstrap_organization('Insights Test A', 'ins-test-a', 'ins-o@tests.invalid');
  ob := public.bootstrap_organization('Insights Test B', 'ins-test-b', 'ins-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('I-1', 'Insight item', null, 'piece', 40, w);
  perform public.inv_set_item_cost(i, 100);
  perform public.inv_set_reorder_level(i, 100);                       -- 40 on hand is below 100: counts as low
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq);
  rq2 := (public.inv_submit_request(w, 'waiting', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1))) ->> 'id')::uuid;   -- stays waiting
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cinv := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 10)))) ->> 'id')::uuid;
  cat := public.fin_create_category('Rent');
  ex := ((public.fin_record_expense(current_date, cat, 300)) ->> 'id')::uuid;
  perform public.fin_record_payment('in', 1000, current_date, 'bank', cinv);
  perform public.inv_set_item_batching(i, true);
  ba := public.inv_receive_batch(i, w, 5, 'EXP1', null, current_date + 20);
  j := public.insights_home();
  reset role;

  -- S1: the known answer for this month (the last element of the 12-month series)
  cur := j -> 'months' -> 11;
  if (cur ->> 'revenue')::bigint <> 2500 then raise exception 'FAIL S1a: revenue % (expected 2500)', cur ->> 'revenue'; end if;
  if (cur ->> 'cogs')::bigint <> 1000 then raise exception 'FAIL S1b: cost of goods % (expected 1000)', cur ->> 'cogs'; end if;
  if (cur ->> 'expenses')::bigint <> 300 then raise exception 'FAIL S1c: expenses % (expected 300)', cur ->> 'expenses'; end if;
  if (cur ->> 'net')::bigint <> 1200 then raise exception 'FAIL S1d: net % (expected 1200)', cur ->> 'net'; end if;
  if jsonb_array_length(j -> 'months') <> 12 then raise exception 'FAIL S1e: % months', jsonb_array_length(j -> 'months'); end if;
  if cur ->> 'month' <> to_char(current_date, 'YYYY-MM') then raise exception 'FAIL S1f: last month label %', cur ->> 'month'; end if;

  -- S2: owed to me 1500, nothing overdue; I owe the 300 expense (unpaid)
  if (j ->> 'owedToMeMinor')::bigint <> 1500 then raise exception 'FAIL S2a: owed to me % (expected 1500)', j ->> 'owedToMeMinor'; end if;
  if (j ->> 'overdueMinor')::bigint <> 0 then raise exception 'FAIL S2b: overdue %', j ->> 'overdueMinor'; end if;
  if (j ->> 'iOweMinor')::bigint <> 300 then raise exception 'FAIL S2c: I owe % (expected 300)', j ->> 'iOweMinor'; end if;

  -- S3: stock value = (40 - 10 + 5) on hand x 100 = 3500; the item is low (35 available after the reservation of 1 <= 100)
  if (j ->> 'stockValueMinor')::bigint <> 3500 then raise exception 'FAIL S3a: stock value % (expected 3500)', j ->> 'stockValueMinor'; end if;
  if (j ->> 'itemsLow')::int <> 1 then raise exception 'FAIL S3b: items low %', j ->> 'itemsLow'; end if;

  -- S4: expiry bucket (batch of 5 expiring in 20 days, value 500) and decisions waiting
  if (j -> 'expiry' -> 'in30' ->> 'batches')::int <> 1 or (j -> 'expiry' -> 'in30' ->> 'valueMinor')::bigint <> 500 then raise exception 'FAIL S4a: expiry in30 %', j -> 'expiry' -> 'in30'; end if;
  if (j -> 'expiry' -> 'expired' ->> 'batches')::int <> 0 then raise exception 'FAIL S4b: expired %', j -> 'expiry' -> 'expired'; end if;
  if (j -> 'decisions' ->> 'submitted')::int <> 1 then raise exception 'FAIL S4c: submitted %', j -> 'decisions'; end if;
  if jsonb_array_length(j -> 'topProducts') <> 1 or (j -> 'topProducts' -> 0 ->> 'revenue')::bigint <> 2500 then raise exception 'FAIL S4d: top products %', j -> 'topProducts'; end if;

  -- S5: a void invoice drops out of revenue
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.fin_void_payment((select id from public.fin_payments where customer_invoice_id = cinv)); perform public.sal_void_invoice(cinv); j := public.insights_home(); reset role;
  if ((j -> 'months' -> 11) ->> 'revenue')::bigint <> 0 or (j ->> 'owedToMeMinor')::bigint <> 0 then raise exception 'FAIL S5: void invoice still counted (%)', j -> 'months' -> 11; end if;

  -- S6: members and viewers get nothing; another organization cannot read this one's numbers
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.insights_home(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  reset role;
  if not ok then raise exception 'FAIL S6a: a member read the owner numbers'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated; j := public.insights_home(); reset role;
  if ((j -> 'months' -> 11) ->> 'revenue')::bigint <> 0 or (j ->> 'stockValueMinor')::bigint <> 0 then raise exception 'FAIL S6b: another organization sees numbers (%)', j; end if;
  ok := false; begin set local role anon; perform public.insights_home(); exception when insufficient_privilege then ok := true; end; reset role;
  if not ok then raise exception 'FAIL S6c: anonymous could call it'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
