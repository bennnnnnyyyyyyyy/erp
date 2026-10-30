-- sql/tests/016_sales_retry.sql
-- Sales retry: a rejected request lets the order raise a new one; a live request blocks a second request; a delivered
-- order cannot be cancelled; cancelling after a rejection works; every step audited. Always rolls back. Needs sql/001-020.

do $$
declare
  u uuid := gen_random_uuid();  -- owner (approves)
  m uuid := gen_random_uuid();  -- member (sells, requests, issues)
  o uuid; w uuid; i uuid; c uuid; so uuid; so2 uuid; r1 uuid; r2 uuid; r3 uuid;
  n bigint; s text; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'salesretry-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'salesretry-m@tests.invalid');
  o := public.bootstrap_organization('Sales Retry Test', 'sales-retry-test', 'salesretry-o@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  insert into public.org_modules (org_id, module_key) values (o, 'inventory'), (o, 'sales');
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('R-1', 'Retry item', null, 'piece', 10, w);
  c := public.sal_create_customer('Customer', null, null, null);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 3, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  r1 := (public.sal_request_stock(so) ->> 'id')::uuid;

  -- S1: a live request blocks a second request
  ok := false; begin perform public.sal_request_stock(so); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S1: second request allowed while the first is live'; end if;
  reset role;

  -- S2: the owner rejects it; the member can retry with a new request, audited
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(r1, 'rejected'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin r2 := (public.sal_request_stock(so) ->> 'id')::uuid;
  exception when others then raise exception 'FAIL S2: could not retry after a rejected request (%)', sqlerrm; end;
  reset role;
  select request_id into r3 from public.sal_orders where id = so;
  if r3 is distinct from r2 then raise exception 'FAIL S2b: order not linked to the new request'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.order.stock_requested' and entity_id = so::text and summary like '%retry after rejected%';
  if n <> 1 then raise exception 'FAIL S2c: retry not audited (%)', n; end if;

  -- S3: approve and issue the new request: a delivered order cannot be cancelled
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(r2, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_post_issue(r2);
  ok := false; begin perform public.sal_cancel_order(so); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S3: a delivered order was cancelled'; end if;

  -- S4: an order whose request was rejected can be cancelled
  so2 := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1, 'unitPriceMinor', 100))) ->> 'id')::uuid;
  r3 := (public.sal_request_stock(so2) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(r3, 'rejected'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.sal_cancel_order(so2); reset role;
  select status into s from public.sal_orders where id = so2;
  if s <> 'cancelled' then raise exception 'FAIL S4: order not cancelled (%)', s; end if;
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL S5: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
