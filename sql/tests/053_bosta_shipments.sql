-- sql/tests/053_bosta_shipments.sql
-- Bosta shipments (sql/058). Always rolls back. Needs sql/001-058.
-- Covers: a shipment needs Bosta switched on and an open order; one open shipment per order; simulated shipments get a test tracking
-- number and can be stepped by an owner or admin to delivered; status updates are idempotent, mode-checked and never reopen a finished
-- shipment; unknown references are ignored; a real shipment's keys are served to the server only while brand new; stock and money are
-- untouched by any status; other companies see nothing; no anonymous use; audit rows.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; sh jsonb; sh2 jsonb; sid uuid; r jsonb; n bigint; ok boolean; ref text; moves_before bigint; pays_before bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sh-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'sh-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'sh-x@tests.invalid');
  o := public.bootstrap_organization('Ship Test A', 'ship-test-a', 'sh-o@tests.invalid');
  ob := public.bootstrap_organization('Ship Test B', 'ship-test-b', 'sh-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('SH-1', 'Ship item', null, 'piece', 50, w);
  c := public.sal_create_customer('Customer', null, 'Cairo', '01000000000');
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 2, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  reset role;
  select count(*) into moves_before from public.inv_stock_moves where org_id = o;
  select count(*) into pays_before from public.fin_payments where org_id = o;

  -- ---- H1: creating
  set local role authenticated;
  ok := false; begin perform public.sal_create_shipment(so, 'A', '01000000000', 'Cairo', '1 Street'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL H1a: a shipment with Bosta off'; end if;
  perform public.core_save_integration('bosta', true, 'simulated', null);
  ok := false; begin perform public.sal_create_shipment(so, 'A', '01000000000', 'Cairo', '1 Street', -1); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL H1b: negative cash on delivery'; end if;
  sh := public.sal_create_shipment(so, 'Customer', '01000000000', 'Cairo', '1 Street, Nasr City', 500);
  sid := (sh ->> 'id')::uuid; ref := sh ->> 'reference';
  if not (sh ->> 'simulated')::boolean then raise exception 'FAIL H1c: not simulated'; end if;
  ok := false; begin perform public.sal_create_shipment(so, 'Customer', '01000000000', 'Cairo', '1 Street'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL H1d: a second open shipment for the order'; end if;
  reset role;
  if (select tracking from public.sal_shipments where id = sid) not like 'SIM-%' or (select status from public.sal_shipments where id = sid) <> 'created' then
    raise exception 'FAIL H1e: simulated shipment not ready';
  end if;

  -- ---- H2: stepping a simulated shipment
  set local role authenticated;
  r := public.sal_simulate_shipment_step(sid);
  if r ->> 'status' <> 'picked_up' then raise exception 'FAIL H2a: %', r; end if;
  r := public.sal_simulate_shipment_step(sid);
  r := public.sal_simulate_shipment_step(sid);
  if r ->> 'status' <> 'delivered' then raise exception 'FAIL H2b: %', r; end if;
  ok := false; begin perform public.sal_simulate_shipment_step(sid); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL H2c: stepped past delivered'; end if;
  reset role;

  -- ---- W1: the server's status updates (a real shipment)
  update public.sal_shipments set simulated = false, status = 'created' where id = sid;
  r := public.sal__apply_shipment_status(ref, 20, 'k-1', null, true);
  if r ->> 'result' <> 'mode_mismatch' then raise exception 'FAIL W1a: simulated update on a real shipment: %', r; end if;
  r := public.sal__apply_shipment_status(ref, 20, 'k-1', null, false);
  if r ->> 'status' <> 'picked_up' then raise exception 'FAIL W1b: %', r; end if;
  r := public.sal__apply_shipment_status(ref, 20, 'k-1', null, false);
  if r ->> 'result' <> 'duplicate' then raise exception 'FAIL W1c: replay: %', r; end if;
  r := public.sal__apply_shipment_status(ref, 45, 'k-2', null, false);
  if r ->> 'status' <> 'delivered' then raise exception 'FAIL W1d: %', r; end if;
  r := public.sal__apply_shipment_status(ref, 30, 'k-3', null, false);   -- a late "in transit" after delivery
  if r ->> 'result' <> 'ignored' or (select status from public.sal_shipments where id = sid) <> 'delivered' then raise exception 'FAIL W1e: a finished shipment was reopened: %', r; end if;
  r := public.sal__apply_shipment_status(ref, 46, 'k-4', null, false);   -- returned after delivery is allowed
  if r ->> 'status' <> 'returned' then raise exception 'FAIL W1f: %', r; end if;
  if (public.sal__apply_shipment_status('NOSUCHREF0001', 45, 'k-9', null, false)) ->> 'result' <> 'unknown' then raise exception 'FAIL W1g: unknown reference'; end if;
  if (select count(*) from public.inv_stock_moves where org_id = o) <> moves_before or (select count(*) from public.fin_payments where org_id = o) <> pays_before then
    raise exception 'FAIL W1h: a status update touched stock or money';
  end if;
  if (select count(*) from public.audit_log where org_id = o and action in ('sales.shipment.created', 'sales.shipment.status')) < 5 then raise exception 'FAIL W1i: audit rows'; end if;

  -- ---- K1: keys
  set local role authenticated;
  perform public.core_save_provider_fields('bosta', '{"api_key": "bk_test_1", "webhook_secret": "whsec-1"}');
  reset role;
  update public.sal_shipments set status = 'cancelled' where id = sid;   -- (as if it had been cancelled)
  set local role authenticated;
  sh2 := public.sal_create_shipment(so, 'Customer', '01000000000', 'Cairo', '1 Street');
  reset role;
  update public.sal_shipments set simulated = false, status = 'pending', tracking = null where id = (sh2 ->> 'id')::uuid;
  if public.sal__shipment_credentials((sh2 ->> 'id')::uuid) -> 'credentials' ->> 'api_key' <> 'bk_test_1' then raise exception 'FAIL K1a: keys not served for a new real shipment'; end if;
  if public.sal__shipment_callback_credentials(sh2 ->> 'reference') -> 'credentials' ->> 'webhook_secret' <> 'whsec-1' then raise exception 'FAIL K1b: webhook secret not found by reference'; end if;
  update public.sal_shipments set created_at = now() - interval '1 hour' where id = (sh2 ->> 'id')::uuid;
  if public.sal__shipment_credentials((sh2 ->> 'id')::uuid) is not null then raise exception 'FAIL K1c: keys served for an old shipment'; end if;

  -- ---- P1: other companies, anonymous, members cannot step simulations
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_simulate_shipment_step(sid); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1a: a member stepped a simulation'; end if;
  ok := false; begin perform public.sal__apply_shipment_status(ref, 45, 'k-77', null, false); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL P1b: a user applied a status'; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sal_shipments; if n <> 0 then raise exception 'FAIL P2a: another company sees % shipments', n; end if;
  select count(*) into n from public.sal_shipment_events; if n <> 0 then raise exception 'FAIL P2b: another company sees events'; end if;
  reset role;
  if has_function_privilege('anon', 'public.sal_create_shipment(uuid, text, text, text, text, bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.sal__shipment_credentials(uuid)', 'execute') then
    raise exception 'FAIL P3: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
