-- sql/tests/003_tasks_and_outbox.sql
-- Proves slice 2 (documentation/plans/TASKS_AND_OUTBOX_PLAN.md) on a real database: transactional outbox, idempotent
-- delivery, retry with backoff, expiry, stuck-message recovery, reminders and escalation, task rules, who sees what,
-- service-only functions, no direct writes. Self-contained, always rolls back.
-- Result: an ERROR saying "ALL TESTS PASSED" is a pass; "FAIL S<n>" names the check. Needs sql/001 to sql/007.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner, org A
  ub uuid := gen_random_uuid();  -- admin (manager), org A
  uc uuid := gen_random_uuid();  -- member (requester, task assignee), org A
  ud uuid := gen_random_uuid();  -- viewer, org A
  ui uuid := gen_random_uuid();  -- second member, org A
  ue uuid := gen_random_uuid();  -- owner, org B
  ug uuid := gen_random_uuid();  -- admin, org B
  oa uuid;
  ob uuid;
  w1 uuid;
  i1 uuid;
  wb uuid;
  ib uuid;
  r1 uuid;
  r2 uuid;
  r3 uuid;
  rb uuid;
  tk1 uuid;
  fid uuid;
  eid uuid;
  sid uuid;
  rec record;
  n  bigint;
  expected bigint;
  st text;
  at_n int;
  j  jsonb;
  ok boolean;
begin
  -- ------------------------------------------------------------ setup (as postgres)
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'tsk-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'tsk-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'tsk-c@tests.invalid'), (ud, 'authenticated', 'authenticated', 'tsk-d@tests.invalid'),
    (ui, 'authenticated', 'authenticated', 'tsk-i@tests.invalid'), (ue, 'authenticated', 'authenticated', 'tsk-e@tests.invalid'),
    (ug, 'authenticated', 'authenticated', 'tsk-g@tests.invalid');
  oa := public.bootstrap_organization('Tasks Test A', 'tsk-test-a', 'tsk-a@tests.invalid');
  ob := public.bootstrap_organization('Tasks Test B', 'tsk-test-b', 'tsk-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member'), (oa, ud, 'viewer'), (oa, ui, 'member'), (ob, ug, 'admin');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (oa, 'messaging'), (oa, 'tasks'), (ob, 'inventory');
  update public.organizations set settings = settings || '{"chasing": {"reminder_after_minutes": 1, "escalate_after_minutes": 2}}'::jsonb where id = oa;

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main warehouse');
  i1 := public.inv_create_item('GLV-001', 'Safety gloves', null, 'pair', 100, w1);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  wb := public.inv_create_warehouse('MAIN', 'B warehouse');
  ib := public.inv_create_item('GLV-001', 'B gloves', null, 'pair', 100, wb);
  rb := (public.inv_submit_request(wb, 'org B request', jsonb_build_array(jsonb_build_object('itemId', ib, 'qty', 1))) ->> 'id')::uuid;
  reset role;

  -- ------------------------------------------------------------ S1: a request creates its messages in the same transaction
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  r1 := (public.inv_submit_request(w1, 'Gloves for the night shift', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 5))) ->> 'id')::uuid;
  reset role;
  select count(*) into n from public.msg_outbox where org_id = oa and entity_id = r1 and kind = 'approval_request' and status = 'pending';
  if n <> 2 then raise exception 'FAIL S1a: expected 2 approval messages (owner and admin), found %', n; end if;
  select count(*) into n from public.msg_outbox where entity_id = r1 and recipient_id = uc;
  if n <> 0 then raise exception 'FAIL S1b: the requester was notified about their own request'; end if;
  if public.msg__enqueue(oa, ub, 'approval_request', 'again', '', 'stock_request', r1, format('request:%s:submitted:%s', r1, ub)) is not null then
    raise exception 'FAIL S1c: a duplicate idempotency key created a second message';
  end if;
  select count(*) into n from public.msg_outbox where entity_id = r1 and kind = 'approval_request';
  if n <> 2 then raise exception 'FAIL S1d: duplicate key changed the outbox to % rows', n; end if;

  -- ------------------------------------------------------------ S2: nothing is queued when the messaging module is off
  select count(*) into n from public.msg_outbox where org_id = ob;
  if n <> 0 then raise exception 'FAIL S2: org B has messaging off but % messages were queued', n; end if;

  -- ------------------------------------------------------------ S3: delivery is idempotent and produces one notification
  select o.id into fid from public.msg_outbox o where o.entity_id = r1 and o.recipient_id = ua;
  select count(*) into n from public.msg_claim_due(100) c where c.id = fid;
  if n <> 1 then raise exception 'FAIL S3a: the due message was not claimed'; end if;
  select status, attempts into st, at_n from public.msg_outbox where id = fid;
  if st <> 'sending' or at_n <> 1 then raise exception 'FAIL S3b: claimed message is % with % attempts', st, at_n; end if;
  perform public.msg_deliver_in_app(fid);
  perform public.msg_deliver_in_app(fid);
  perform public.msg_complete(fid, true);
  select count(*) into n from public.msg_notifications where outbox_id = fid and user_id = ua;
  if n <> 1 then raise exception 'FAIL S3c: delivering twice created % notifications', n; end if;
  select status into st from public.msg_outbox where id = fid;
  if st <> 'sent' then raise exception 'FAIL S3d: message is %, expected sent', st; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.message.sent' and entity_id = fid::text;
  if n <> 1 then raise exception 'FAIL S3f: expected 1 audit row for the sent message, found %', n; end if;
  ok := false;
  begin perform public.msg_complete(fid, true); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S3e: a sent message could be completed again'; end if;

  -- ------------------------------------------------------------ S4: failure retries with backoff, then gives up
  fid := public.msg__enqueue(oa, ub, 'info', 'fake channel test', '', null, null, 'fake:1', 'fake');
  select count(*) into n from public.msg_claim_due(100) c where c.id = fid;
  if n <> 1 then raise exception 'FAIL S4a: the fake message was not claimed'; end if;
  perform public.msg_complete(fid, false, 'provider is down');
  select status, attempts into st, at_n from public.msg_outbox where id = fid;
  if st <> 'pending' or at_n <> 1 then raise exception 'FAIL S4b: after one failure it is % with % attempts, expected pending/1', st, at_n; end if;
  select count(*) into n from public.msg_outbox where id = fid and next_attempt_at > now() + interval '30 seconds' and last_error = 'provider is down';
  if n <> 1 then raise exception 'FAIL S4c: no backoff or error recorded'; end if;
  select count(*) into n from public.msg_claim_due(100) c where c.id = fid;
  if n <> 0 then raise exception 'FAIL S4d: a message in backoff was handed out again'; end if;
  update public.msg_outbox set next_attempt_at = now() where id = fid;
  select count(*) into n from public.msg_claim_due(100) c where c.id = fid;
  if n <> 1 then raise exception 'FAIL S4e: the retry was not handed out when due'; end if;
  perform public.msg_complete(fid, false, 'still down');
  update public.msg_outbox set next_attempt_at = now() where id = fid;
  select count(*) into n from public.msg_claim_due(100) c where c.id = fid;
  perform public.msg_complete(fid, false, 'still down');
  select status, attempts into st, at_n from public.msg_outbox where id = fid;
  if st <> 'failed' or at_n <> 3 then raise exception 'FAIL S4f: after 3 failures it is % with % attempts, expected failed/3', st, at_n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.message.failed' and entity_id = fid::text;
  if n <> 1 then raise exception 'FAIL S4h: expected 1 audit row for the failed message, found %', n; end if;
  update public.msg_outbox set next_attempt_at = now() where id = fid;
  select count(*) into n from public.msg_claim_due(100) c where c.id = fid;
  if n <> 0 then raise exception 'FAIL S4g: a failed message was handed out again'; end if;

  -- ------------------------------------------------------------ S5: expired messages are never sent
  eid := public.msg__enqueue(oa, ub, 'info', 'expires', '', null, null, 'exp:1');
  update public.msg_outbox set expires_at = now() - interval '1 minute' where id = eid;
  select count(*) into n from public.msg_claim_due(100) c where c.id = eid;
  if n <> 0 then raise exception 'FAIL S5a: an expired message was handed out'; end if;
  select status into st from public.msg_outbox where id = eid;
  if st <> 'expired' then raise exception 'FAIL S5b: expired message is %', st; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.message.expired' and entity_id = eid::text;
  if n <> 1 then raise exception 'FAIL S5c: expected 1 audit row for the expired message, found %', n; end if;

  -- ------------------------------------------------------------ S6: a message stuck in "sending" is recovered
  sid := public.msg__enqueue(oa, ub, 'info', 'stuck', '', null, null, 'stuck:1');
  select count(*) into n from public.msg_claim_due(100) c where c.id = sid;
  alter table public.msg_outbox disable trigger msg_outbox_updated_at;
  update public.msg_outbox set updated_at = now() - interval '10 minutes' where id = sid;
  alter table public.msg_outbox enable trigger msg_outbox_updated_at;
  select count(*) into n from public.msg_claim_due(100) c where c.id = sid;
  if n <> 1 then raise exception 'FAIL S6a: the stuck message was not handed out again'; end if;
  select attempts into at_n from public.msg_outbox where id = sid;
  if at_n <> 2 then raise exception 'FAIL S6b: recovered message has % attempts, expected 2', at_n; end if;
  perform public.msg_complete(sid, true);

  -- ------------------------------------------------------------ S7: reminders and escalation, once, and only when due
  update public.inv_requests set created_at = now() - interval '5 minutes' where id = r1;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  r2 := (public.inv_submit_request(w1, 'fresh request', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 1))) ->> 'id')::uuid;
  reset role;
  j := public.msg_run_chasing(oa);
  if (j ->> 'reminders')::int <> 2 or (j ->> 'escalations')::int <> 1 then raise exception 'FAIL S7a: first chasing run gave %, expected 2 reminders and 1 escalation', j; end if;
  select count(*) into n from public.msg_outbox where entity_id = r2 and kind in ('reminder', 'escalation');
  if n <> 0 then raise exception 'FAIL S7b: a request younger than the reminder time was chased'; end if;
  j := public.msg_run_chasing(oa);
  if (j ->> 'reminders')::int <> 0 or (j ->> 'escalations')::int <> 0 then raise exception 'FAIL S7c: second chasing run repeated itself: %', j; end if;
  select count(*) into n from public.msg_outbox where entity_id = r1 and kind = 'escalation' and recipient_id = ua;
  if n <> 1 then raise exception 'FAIL S7d: the owner was not sent the escalation'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action in ('messaging.reminder.queued', 'messaging.escalation.queued');
  if n <> 3 then raise exception 'FAIL S7e: expected 3 chasing audit rows, found %', n; end if;

  -- ------------------------------------------------------------ S8: a decided request stops being chased; decision and issue notify the requester
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r3 := (public.inv_submit_request(w1, 'will be approved', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 2))) ->> 'id')::uuid;
  reset role;
  update public.inv_requests set created_at = now() - interval '5 minutes' where id = r3;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(r3, 'approved', 'ok');
  reset role;
  j := public.msg_run_chasing(oa);
  select count(*) into n from public.msg_outbox where entity_id = r3 and kind in ('reminder', 'escalation');
  if n <> 0 then raise exception 'FAIL S8a: an approved request was still chased'; end if;
  select count(*) into n from public.msg_outbox where entity_id = r3 and kind = 'decision' and recipient_id = uc;
  if n <> 1 then raise exception 'FAIL S8b: the requester got % decision messages, expected 1', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_post_issue(r3);
  reset role;
  select count(*) into n from public.msg_outbox where entity_id = r3 and kind = 'info' and recipient_id = uc;
  if n <> 1 then raise exception 'FAIL S8c: the requester got % issued messages, expected 1', n; end if;

  -- ------------------------------------------------------------ S9: task rules
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.tsk_create_task('not allowed', uc); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S9a: a plain member created a task'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.tsk_create_task('outsider', ue); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S9b: a task was assigned to someone outside the organization'; end if;
  tk1 := public.tsk_create_task('Count aisle 4', uc, now() - interval '10 minutes', 'by 5 pm');
  reset role;
  select count(*) into n from public.msg_outbox where entity_id = tk1 and kind = 'task_assigned' and recipient_id = uc;
  if n <> 1 then raise exception 'FAIL S9c: the assignee was not notified of the task'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'tasks.task.created' and entity_id = tk1::text;
  if n <> 1 then raise exception 'FAIL S9d: no audit row for the new task'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', ui, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.tsk_set_status(tk1, 'done'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S9e: another member changed someone else''s task'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.tsk_set_status(tk1, 'done'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S9f: a viewer changed a task'; end if;
  reset role;

  j := public.msg_run_chasing(oa);
  if (j ->> 'reminders')::int <> 1 or (j ->> 'escalations')::int <> 1 then raise exception 'FAIL S9g: overdue task chasing gave %, expected 1 reminder and 1 escalation', j; end if;
  select count(*) into n from public.msg_outbox where entity_id = tk1 and kind = 'reminder' and recipient_id = uc;
  if n <> 1 then raise exception 'FAIL S9h: the assignee was not reminded'; end if;
  select count(*) into n from public.msg_outbox where entity_id = tk1 and kind = 'escalation' and recipient_id = ub;
  if n <> 1 then raise exception 'FAIL S9i: the creator was not told the task is overdue'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.tsk_set_status(tk1, 'in_progress');
  ok := false;
  begin perform public.tsk_set_status(tk1, 'open'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S9j: a task could be moved back to open'; end if;
  perform public.tsk_set_status(tk1, 'done');
  ok := false;
  begin perform public.tsk_set_status(tk1, 'done'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S9k: a done task could be marked done again'; end if;
  ok := false;
  begin perform public.tsk_set_status(tk1, 'cancelled'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S9l: a done task could be cancelled'; end if;
  reset role;
  select count(*) into n from public.msg_outbox where entity_id = tk1 and kind = 'task_update' and recipient_id = ub;
  if n <> 1 then raise exception 'FAIL S9m: the creator was not told the task is done'; end if;
  select count(*) into n from public.audit_log where org_id = oa and entity_id = tk1::text and action in ('tasks.task.in_progress', 'tasks.task.done');
  if n <> 2 then raise exception 'FAIL S9n: expected 2 task status audit rows, found %', n; end if;
  j := public.msg_run_chasing(oa);
  if (j ->> 'reminders')::int <> 0 or (j ->> 'escalations')::int <> 0 then raise exception 'FAIL S9o: a finished task was chased: %', j; end if;

  -- ------------------------------------------------------------ S10: everyone sees only their own notifications
  for rec in select * from public.msg_claim_due(500) loop
    if rec.channel = 'in_app' then perform public.msg_deliver_in_app(rec.id); end if;
    perform public.msg_complete(rec.id, true);
  end loop;
  select count(*) into expected from public.msg_outbox where org_id = oa and recipient_id = uc and channel = 'in_app' and status = 'sent';
  if expected < 3 then raise exception 'FAIL S10a: expected the requester to have several delivered messages, found %', expected; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.msg_notifications;
  if n <> expected then raise exception 'FAIL S10b: the requester sees % notifications, expected %', n, expected; end if;
  select count(*) into n from public.msg_notifications where user_id <> uc;
  if n <> 0 then raise exception 'FAIL S10c: the requester sees someone else''s notifications'; end if;
  if public.msg_mark_read() <> expected then raise exception 'FAIL S10d: mark-all-read changed the wrong number of rows'; end if;
  if public.msg_mark_read() <> 0 then raise exception 'FAIL S10e: marking read twice changed rows again'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.msg_notifications;
  if n <> 0 then raise exception 'FAIL S10f: the viewer sees % notifications that are not theirs', n; end if;
  reset role;

  -- ------------------------------------------------------------ S11: only owners and admins read the outbox; tasks stay inside the organization
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.msg_outbox;
  if n <> 0 then raise exception 'FAIL S11a: a plain member reads the outbox (% rows)', n; end if;
  select count(*) into n from public.tsk_tasks;
  if n <> 1 then raise exception 'FAIL S11b: a member sees % tasks, expected 1', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.msg_outbox;
  if n < 5 then raise exception 'FAIL S11c: the admin sees only % outbox rows', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.msg_outbox;
  if n <> 0 then raise exception 'FAIL S11d: org B sees org A outbox rows'; end if;
  select count(*) into n from public.tsk_tasks;
  if n <> 0 then raise exception 'FAIL S11e: org B sees org A tasks'; end if;
  select count(*) into n from public.msg_notifications;
  if n <> 0 then raise exception 'FAIL S11f: org B sees org A notifications'; end if;
  ok := false;
  begin perform public.msg_mark_read(); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL S11g: messaging worked in an organization with the module off'; end if;
  reset role;

  -- ------------------------------------------------------------ S12: service functions and direct writes are closed to signed-in users
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.msg_claim_due(5); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12a: msg_claim_due is callable by a signed-in user'; end if;
  ok := false;
  begin perform public.msg_run_chasing(oa); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12b: msg_run_chasing is callable by a signed-in user'; end if;
  ok := false;
  begin perform public.msg_complete(fid, true); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12c: msg_complete is callable by a signed-in user'; end if;
  ok := false;
  begin perform public.msg_deliver_in_app(fid); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12d: msg_deliver_in_app is callable by a signed-in user'; end if;
  ok := false;
  begin perform public.msg__enqueue(oa, uc, 'info', 'forged', '', null, null, 'forged:1'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12e: a signed-in user can queue messages directly'; end if;
  ok := false;
  begin insert into public.tsk_tasks (org_id, title, assignee_id, created_by) values (oa, 'direct', uc, uc); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12f: direct insert into tasks was allowed'; end if;
  ok := false;
  begin update public.msg_outbox set status = 'sent'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12g: direct update of the outbox was allowed'; end if;
  ok := false;
  begin delete from public.msg_notifications; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S12h: direct delete of notifications was allowed'; end if;
  reset role;

  -- ------------------------------------------------------------ S14: a channel cannot change stock or approve anything
  -- By now every approval-request message of r1 and r2 has been claimed, delivered and completed, and chasing has run
  -- several times. None of that may have decided a request or moved stock.
  select count(*) into n from public.inv_requests where id in (r1, r2) and status <> 'submitted';
  if n <> 0 then raise exception 'FAIL S14a: delivering messages changed the status of a request'; end if;
  select count(*) into n from public.inv_approvals where request_id in (r1, r2);
  if n <> 0 then raise exception 'FAIL S14b: delivering messages created an approval'; end if;
  select count(*) into n from public.inv_stock_moves where org_id = oa;
  if n <> 2 then raise exception 'FAIL S14c: expected 2 ledger rows (opening receipt and the one approved issue), found %', n; end if;
  select b.on_hand::int * 1000 + b.reserved::int into n from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  if n <> 98 * 1000 + 6 then raise exception 'FAIL S14d: balance changed unexpectedly (code %), expected 98 on hand and 6 reserved', n; end if;
  -- The messaging functions that write do not touch inventory tables at all, and the chasing job only reads them.
  select count(*) into n from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('msg_claim_due', 'msg_complete', 'msg_deliver_in_app', 'msg_mark_read', 'msg__enqueue', 'msg__managers')
    and p.prosrc ~* 'inv_';
  if n <> 0 then raise exception 'FAIL S14e: a messaging function refers to inventory tables'; end if;
  select count(*) into n from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'msg_run_chasing' and p.prosrc ~* '(insert into|update|delete from)\s+public\.inv_';
  if n <> 0 then raise exception 'FAIL S14f: the chasing job writes to inventory tables'; end if;
  select count(*) into n from information_schema.table_constraints where table_schema = 'public' and table_name = 'msg_outbox' and constraint_type = 'FOREIGN KEY' and constraint_name like '%inv%';
  if n <> 0 then raise exception 'FAIL S14g: the outbox is tied to inventory tables'; end if;

  -- ------------------------------------------------------------ S13: the audit chains are still clean
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S13a: audit chain of org A is broken'; end if;
  select count(*) into n from public.audit_verify(ob);
  if n <> 0 then raise exception 'FAIL S13b: audit chain of org B is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
