-- sql/tests/101_alert_notification_target.sql
-- sql/104: alert messages get the target "alert:<rule kind>" so the bell can open the right page. Always rolls back.
-- Covers: T1 an alert queued with an alr: key gets entity_type alert:<kind> and the rule as entity_id; T2 the in-app notification
-- copies it; T3 other messages (no alr: key, or with their own entity) are untouched; T4 a key with a broken id or a rule of
-- another company is left alone; T5 users cannot call the trigger function.

do $$
declare
  u uuid := gen_random_uuid(); x uuid := gen_random_uuid(); o uuid; ob uuid; rl uuid; rlb uuid; ob_id uuid; r record; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ant-o@tests.invalid'), (x, 'authenticated', 'authenticated', 'ant-x@tests.invalid');
  o := public.bootstrap_organization('Alert target A', 'alert-target-a', 'ant-o@tests.invalid');
  ob := public.bootstrap_organization('Alert target B', 'alert-target-b', 'ant-x@tests.invalid');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);   -- messages are queued only with messaging on
  insert into public.alr_rules (org_id, name, kind, threshold) values (o, 'Overdue', 'receivable_overdue', 0) returning id into rl;
  insert into public.alr_rules (org_id, name, kind) values (ob, 'Low stock B', 'stock_below') returning id into rlb;

  -- T1 / T2
  ob_id := public.msg__enqueue(o, u, 'alert', 'Overdue invoice INV-1', 'body', null, null, 'alr:' || rl || ':123:' || u);
  select entity_type, entity_id into r from public.msg_outbox where id = ob_id;
  if r.entity_type is distinct from 'alert:receivable_overdue' or r.entity_id is distinct from rl then
    raise exception 'FAIL T1: outbox target % %', r.entity_type, r.entity_id;
  end if;
  perform public.msg_deliver_in_app(ob_id);
  select entity_type, entity_id into r from public.msg_notifications where outbox_id = ob_id;
  if r.entity_type is distinct from 'alert:receivable_overdue' or r.entity_id is distinct from rl then
    raise exception 'FAIL T2: notification target % %', r.entity_type, r.entity_id;
  end if;

  -- T3: a message with its own entity, and one without an alr: key, are not changed
  ob_id := public.msg__enqueue(o, u, 'alert', 't', 'b', 'stock_request', rl, 'alr:' || rl || ':456:' || u);
  select entity_type into r from public.msg_outbox where id = ob_id;
  if r.entity_type <> 'stock_request' then raise exception 'FAIL T3a: own entity replaced by %', r.entity_type; end if;
  ob_id := public.msg__enqueue(o, u, 'decision', 't', 'b', null, null, 'other:' || gen_random_uuid());
  select entity_type into r from public.msg_outbox where id = ob_id;
  if r.entity_type is not null then raise exception 'FAIL T3b: non-alert message got %', r.entity_type; end if;

  -- T4: broken id, and a rule of another company
  ok := true;
  begin
    ob_id := public.msg__enqueue(o, u, 'alert', 't', 'b', null, null, 'alr:not-a-uuid:1:' || u);
  exception when others then ok := false; end;
  if not ok then raise exception 'FAIL T4a: a broken key stopped the message'; end if;
  select entity_type into r from public.msg_outbox where id = ob_id;
  if r.entity_type is not null then raise exception 'FAIL T4b: broken key got a target'; end if;
  ob_id := public.msg__enqueue(o, u, 'alert', 't', 'b', null, null, 'alr:' || rlb || ':1:' || u);
  select entity_type into r from public.msg_outbox where id = ob_id;
  if r.entity_type is not null then raise exception 'FAIL T4c: another company''s rule was used'; end if;

  -- T5
  if has_function_privilege('authenticated', 'public.msg__alert_target()', 'execute') then
    raise exception 'FAIL T5: users can call the trigger function';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
