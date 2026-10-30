-- sql/tests/026_forecast_alert_rule.sql
-- Forecast alert rule: "tell Purchasing when an item has fewer than 14 days left". F-2 (about 4 days of stock) fires, F-1 (84 days) and
-- F-3 (no use, no forecast) do not; the message carries the days, the date and the confidence; no repeat inside the interval; an
-- item-specific rule only watches that item; needs a number of days; members cannot create it; the public forecast still works.
-- Always rolls back. Needs sql/001-030.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  o uuid; w uuid; i1 uuid; i2 uuid; i3 uuid; team uuid; r1 uuid; r2 uuid; rq uuid; rec record; j jsonb; n bigint; ok boolean; v_text text;
begin
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'fa-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'fa-a@tests.invalid');
  o := public.bootstrap_organization('Forecast Alert Test', 'forecast-alert-test', 'fa-o@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'member');
  perform public.core_enable_all_modules(o);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.alr_ensure_default_teams();
  select id into team from public.alr_teams where name = 'Purchasing';
  perform public.alr_set_team_members(team, array[a]);
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('F-1', 'Steady item', null, 'piece', 200, w);
  i2 := public.inv_create_item('F-2', 'Nearly out', null, 'piece', 96, w);
  i3 := public.inv_create_item('F-3', 'No usage', null, 'piece', 50, w);
  reset role;

  -- history (same shape as test 025): F-1 60 + 30 units, F-2 90 units in 20 days
  create temp table t_h (sku text, days_ago int, qty numeric) on commit drop;
  insert into t_h values ('F-1', 5, 30), ('F-1', 20, 30), ('F-1', 40, 30),
    ('F-2', 2, 9), ('F-2', 4, 9), ('F-2', 6, 9), ('F-2', 8, 9), ('F-2', 10, 9), ('F-2', 12, 9), ('F-2', 14, 9), ('F-2', 16, 9), ('F-2', 18, 9), ('F-2', 20, 9);
  for rec in select * from t_h order by days_ago desc loop
    insert into public.inv_requests (org_id, number, requester_id, warehouse_id, reason, status, decided_by, decided_at)
    values (o, 'T-' || (select count(*) + 1 from public.inv_requests where org_id = o), u, w, 'history', 'approved', a, now()) returning id into rq;
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, request_id, posted_by, posted_at)
    values (o, (select id from public.inv_items where org_id = o and sku = rec.sku), w, -rec.qty, 'issue', rq, u, now() - make_interval(days => rec.days_ago));
  end loop;
  update public.inv_stock_balances b set on_hand = coalesce((select sum(m.qty) from public.inv_stock_moves m where m.org_id = b.org_id and m.item_id = b.item_id and m.warehouse_id = b.warehouse_id), 0) where b.org_id = o;

  -- S1: a rule for every item, 14 days, tell the Purchasing team
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r1 := public.alr_create_rule('Running out', 'forecast_stockout', null, 14, 24, jsonb_build_array(jsonb_build_object('type', 'team', 'id', team)));
  reset role;
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 1 or (j ->> 'messages')::int <> 1 then raise exception 'FAIL S1a: first run %', j; end if;
  select m.body into v_text from public.msg_outbox m where org_id = o and recipient_id = a and kind = 'alert' and subject = 'Running out soon: F-2';
  if v_text is null then raise exception 'FAIL S1b: no message for F-2 to the team member'; end if;
  if v_text not like '%F-2%' or v_text not like '%day(s) left%' or v_text not like '%using 1.5%' or v_text not like '%suggested order%' then raise exception 'FAIL S1c: message text is missing details: %', v_text; end if;
  if v_text not like '%THIN history%' then raise exception 'FAIL S1d: a thin-history forecast was not labelled as a guess: %', v_text; end if;
  select count(*) into n from public.msg_outbox where org_id = o and kind = 'alert' and (body like '%F-1%' or body like '%F-3%'); if n <> 0 then raise exception 'FAIL S1e: healthy or unused items were reported'; end if;

  -- S2: no repeat inside the interval
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 0 then raise exception 'FAIL S2: repeated inside the interval %', j; end if;

  -- S3: a wider window (100 days) also catches F-1 (84 days), a new digest of one item; the existing F-2 stays quiet
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r2 := public.alr_create_rule('Watch F-1 only', 'forecast_stockout', i1, 100, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner')));
  reset role;
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 1 then raise exception 'FAIL S3a: item rule fired % subjects', j ->> 'alerts'; end if;
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = u and subject = 'Running out soon: F-1'; if n <> 1 then raise exception 'FAIL S3b: owner got % messages about F-1', n; end if;
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = u and body like '%F-2%'; if n <> 0 then raise exception 'FAIL S3c: an item rule reported another item'; end if;

  -- S4: validation and permissions
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.alr_create_rule('No days', 'forecast_stockout', null, null, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner'))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S4a: a forecast rule without a number of days was accepted'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.alr_create_rule('X', 'forecast_stockout', null, 14, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner'))); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S4b: a member created a forecast rule'; end if;
  -- the public forecast still works for members and is still sorted soonest first
  select sku into rec from public.inv_forecast() limit 1;
  reset role;
  if rec.sku <> 'F-2' then raise exception 'FAIL S4c: public forecast first row is %', rec.sku; end if;

  -- S5: the other rule kinds still work after the evaluator was replaced (low stock still fires)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.alr_create_rule('Low', 'stock_below', i3, 100, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner')));
  reset role;
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = u and subject = 'Low stock: F-3'; if n <> 1 then raise exception 'FAIL S5: the older rule kinds stopped working (% messages)', n; end if;

  select count(*) into n from public.audit_verify(o); if n <> 0 then raise exception 'FAIL S6: audit chain broken'; end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
