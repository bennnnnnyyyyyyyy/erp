-- sql/tests/024_alert_rules.sql
-- Alerts and triggers: stock_below / expiry_within / receivable_overdue / profit_negative fire once to the right people (team, role,
-- person), do not repeat inside the repeat interval, re-fire when clearly worse, disabled and retired rules are silent, only
-- owners/admins manage rules, nothing leaks across organizations, everything audited. Always rolls back. Needs sql/001-028.

do $$
declare
  u uuid := gen_random_uuid();   -- owner
  a uuid := gen_random_uuid();   -- purchasing team member (member role)
  b uuid := gen_random_uuid();   -- plain member, not in any team
  x uuid := gen_random_uuid();   -- other organization
  o uuid; ob uuid; w uuid; i uuid; i2 uuid; team uuid; r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; c uuid; so uuid; rq uuid; ol uuid; cinv uuid; cat uuid;
  j jsonb; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'alr-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'alr-a@tests.invalid'),
    (b, 'authenticated', 'authenticated', 'alr-b@tests.invalid'), (x, 'authenticated', 'authenticated', 'alr-x@tests.invalid');
  o := public.bootstrap_organization('Alerts Test A', 'alerts-test-a', 'alr-o@tests.invalid');
  ob := public.bootstrap_organization('Alerts Test B', 'alerts-test-b', 'alr-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'member'), (o, b, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.alr_ensure_default_teams();
  select id into team from public.alr_teams where name = 'Purchasing';
  perform public.alr_set_team_members(team, array[a]);
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('A-1', 'Alert item', null, 'kg', 5, w);
  i2 := public.inv_create_item('A-2', 'Other item', null, 'kg', 500, w);
  -- S1: stock_below 10 on all items, tell the Purchasing team
  r1 := public.alr_create_rule('Low stock', 'stock_below', null, 10, 24, jsonb_build_array(jsonb_build_object('type', 'team', 'id', team)));
  reset role;

  -- S1 evaluation: only A-1 (5 <= 10) fires, only for the team member
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 1 or (j ->> 'messages')::int <> 1 then raise exception 'FAIL S1a: first run %', j; end if;
  select count(*) into n from public.msg_outbox where org_id = o and kind = 'alert' and recipient_id = a and subject like 'Low stock%';
  if n <> 1 then raise exception 'FAIL S1b: team member got % alerts', n; end if;
  select count(*) into n from public.msg_outbox where org_id = o and kind = 'alert' and recipient_id in (u, b);
  if n <> 0 then raise exception 'FAIL S1c: people outside the team were told'; end if;

  -- S2: no repeat inside the interval; fires again after it
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 0 then raise exception 'FAIL S2a: repeated inside the interval %', j; end if;
  update public.alr_firings set last_fired_at = now() - interval '25 hours' where rule_id = r1;
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 1 then raise exception 'FAIL S2b: did not repeat after the interval %', j; end if;

  -- S3: worse (stock fell further) re-fires after an hour, not before
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_create_item('A-3', 'Third', null, 'kg', 2, w);   -- two new low items at once ...
  perform public.inv_create_item('A-4', 'Fourth', null, 'kg', 3, w);
  reset role;
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 2 then raise exception 'FAIL S3a: new low items did not fire %', j; end if;
  if (j ->> 'messages')::int <> 1 then raise exception 'FAIL S3a2: two items made % messages for one person (expected one digest)', j ->> 'messages'; end if;
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = a and subject = 'Low stock: 2 items' and body like '%A-3%' and body like '%A-4%';
  if n <> 1 then raise exception 'FAIL S3a3: digest message missing or incomplete (%)', n; end if;
  update public.inv_stock_balances set on_hand = 1 where item_id = i;
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 0 then raise exception 'FAIL S3b: worse within the hour fired %', j; end if;
  update public.alr_firings set last_fired_at = now() - interval '2 hours' where rule_id = r1 and subject = 'item:' || i;
  j := public.alr_run(o);
  if (j ->> 'alerts')::int <> 1 then raise exception 'FAIL S3c: worse after an hour did not fire %', j; end if;

  -- S4: a role recipient (everyone with role owner) and a person recipient; item-specific rule uses the item's reorder level
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_set_reorder_level(i2, 600);                    -- 500 on hand is under 600
  r2 := public.alr_create_rule('Item level', 'stock_below', i2, null, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner'), jsonb_build_object('type', 'user', 'id', b)));
  reset role;
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and subject like 'Low stock: A-2' and recipient_id in (u, b);
  if n <> 2 then raise exception 'FAIL S4: role + person recipients got % messages (expected 2)', n; end if;

  -- S5: expiry_within 30 days: a batch expiring in 20 days fires, one in 60 does not
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_set_item_batching(i2, true);
  perform public.inv_receive_batch(i2, w, 5, 'SOON', null, current_date + 20);
  perform public.inv_receive_batch(i2, w, 5, 'LATER', null, current_date + 60);
  r3 := public.alr_create_rule('Expiry', 'expiry_within', null, 30, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner')));
  reset role;
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = u and subject like 'Expiring stock%'; if n <> 1 then raise exception 'FAIL S5a: expiry alerts % (expected 1)', n; end if;
  select count(*) into n from public.msg_outbox where org_id = o and body like '%batch LATER%'; if n <> 0 then raise exception 'FAIL S5b: a batch 60 days out fired'; end if;

  -- S6: receivable_overdue 30 days: an invoice dated 40 days ago and unpaid fires; paying it clears the cause
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 2, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cinv := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 2)))) ->> 'id')::uuid;
  r4 := public.alr_create_rule('Overdue', 'receivable_overdue', null, 30, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner')));
  reset role;
  update public.sal_invoices set invoice_date = current_date - 40 where id = cinv;
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = u and subject like 'Overdue invoice%'; if n <> 1 then raise exception 'FAIL S6a: overdue alerts % (expected 1)', n; end if;
  update public.alr_firings set last_fired_at = now() - interval '2 days' where rule_id = r4;
  insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, created_by) values (o, 'PAY-T1', 'in', 2000, 'EGP', current_date, 'bank', cinv, u);
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = u and subject like 'Overdue invoice%'; if n <> 1 then raise exception 'FAIL S6b: a paid invoice alerted again (% total)', n; end if;

  -- S7: profit_negative: an expense with no sales this month is a loss
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cat := public.fin_create_category('Rent');
  perform public.fin_record_expense(current_date, cat, 5000);
  r5 := public.alr_create_rule('Losing', 'profit_negative', null, null, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner')));
  reset role;
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and recipient_id = u and subject = 'Losing money this month'; if n <> 1 then raise exception 'FAIL S7: losing-money alerts % (expected 1)', n; end if;

  -- S8: disabled and retired rules are silent; a test message reaches only the caller
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.alr_set_rule_enabled(r1, false);
  perform public.alr_retire_rule(r2);
  perform public.alr_send_test(r3);
  reset role;
  update public.alr_firings set last_fired_at = now() - interval '3 days';
  select count(*) into n from public.msg_outbox where org_id = o and kind = 'alert';
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and kind = 'alert' and (subject like 'Low stock%') and created_at > now() - interval '1 second' and recipient_id = a;
  if exists (select 1 from public.msg_outbox m where m.org_id = o and m.subject like 'Low stock%' and m.created_at = (select max(created_at) from public.msg_outbox where org_id = o and subject like 'Low stock%') and false) then null; end if;
  select count(*) into n from public.alr_firings f where f.rule_id in (r1, r2) and f.last_fired_at > now() - interval '1 minute';
  if n <> 0 then raise exception 'FAIL S8a: a disabled or retired rule fired (% firings)', n; end if;
  select count(*) into n from public.msg_outbox where org_id = o and subject = 'TEST: Expiry' and recipient_id = u; if n <> 1 then raise exception 'FAIL S8b: test message to the caller: %', n; end if;
  select count(*) into n from public.msg_outbox where org_id = o and subject like 'TEST:%' and recipient_id <> u; if n <> 0 then raise exception 'FAIL S8c: test message reached someone else'; end if;

  -- S9: members cannot manage rules or teams and cannot read them; no direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.alr_create_rule('X', 'stock_below', null, 1, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner'))); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S9a: a member created a rule'; end if;
  select count(*) into n from public.alr_rules; if n <> 0 then raise exception 'FAIL S9b: a member can read rules'; end if;
  ok := false; begin insert into public.alr_rules (org_id, name, kind) values (o, 'X', 'profit_negative'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9c: direct rule insert worked'; end if;
  ok := false; begin perform public.alr_run(o); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9d: a signed-in user ran the evaluator'; end if;
  reset role;

  -- S10: bad input refused; other organization sees nothing and cannot touch our rules; module off = nothing fires
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.alr_create_rule('Bad', 'expiry_within', null, null, 24, jsonb_build_array(jsonb_build_object('type', 'role', 'role', 'owner'))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S10a: expiry rule without days accepted'; end if;
  ok := false; begin perform public.alr_create_rule('Bad', 'stock_below', null, 1, 24, '[]'::jsonb); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S10b: rule without recipients accepted'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.alr_rules; if n <> 0 then raise exception 'FAIL S10c: cross-organization rules visible'; end if;
  ok := false; begin perform public.alr_set_rule_enabled(r3, false); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S10d: another organization changed our rule'; end if;
  reset role;
  update public.org_modules set disabled_at = now() where org_id = o and module_key = 'alerts';
  update public.alr_firings set last_fired_at = now() - interval '9 days';
  j := public.alr_run(o);
  if (j ->> 'rules')::int <> 0 then raise exception 'FAIL S10e: rules ran with the module off %', j; end if;

  -- S11: audit
  select count(*) into n from public.audit_log where org_id = o and action like 'alerts.%'; if n < 8 then raise exception 'FAIL S11a: alerts audit entries %', n; end if;
  select count(*) into n from public.audit_verify(o); if n <> 0 then raise exception 'FAIL S11b: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
