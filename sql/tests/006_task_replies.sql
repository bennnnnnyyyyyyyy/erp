-- sql/tests/006_task_replies.sql
-- S4: acknowledge or complete a task by replying from a verified WhatsApp number. Always rolls back. Needs sql/001-010.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner
  ub uuid := gen_random_uuid();  -- admin, assigns the tasks
  uc uuid := gen_random_uuid();  -- member, assignee (verified number)
  ud uuid := gen_random_uuid();  -- member, other person (verified number)
  ue uuid := gen_random_uuid();  -- member, assignee without a verified number
  oa uuid;
  t1 uuid; t2 uuid; t3 uuid; te uuid;
  r1 text; r2 text;
  res jsonb;
  n bigint;
  st text;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'rep-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'rep-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'rep-c@tests.invalid'), (ud, 'authenticated', 'authenticated', 'rep-d@tests.invalid'),
    (ue, 'authenticated', 'authenticated', 'rep-e@tests.invalid');
  oa := public.bootstrap_organization('Reply Test A', 'rep-test-a', 'rep-a@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member'), (oa, ud, 'member'), (oa, ue, 'member');
  insert into public.org_modules (org_id, module_key) values (oa, 'tasks'), (oa, 'messaging');
  insert into public.msg_identities (org_id, user_id, channel, address, status, verified_at) values
    (oa, uc, 'whatsapp', '+201000000003', 'verified', now() - interval '1 hour'), (oa, ud, 'whatsapp', '+201000000004', 'verified', now() - interval '1 hour');

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  t1 := public.tsk_create_task('Count aisle 4', uc);
  te := public.tsk_create_task('No number task', ue);
  reset role;

  -- ---- S1: the assignee with a verified number gets a WhatsApp message with the reference; the other assignee does not
  select count(*) into n from public.msg_outbox where entity_id = t1 and channel = 'whatsapp' and recipient_id = uc and body like '%' || public.tsk__ref(t1) || '%';
  if n <> 1 then raise exception 'FAIL S1a: no WhatsApp task message with the reference'; end if;
  select count(*) into n from public.msg_outbox where entity_id = te and channel = 'whatsapp';
  if n <> 0 then raise exception 'FAIL S1b: a WhatsApp message went to someone without a verified number'; end if;
  select count(*) into n from public.msg_outbox where entity_id = t1 and channel = 'in_app';
  if n <> 1 then raise exception 'FAIL S1c: the in-app task message changed'; end if;

  -- ---- S2: acknowledge, then complete
  res := public.msg_task_reply('whatsapp', '+201000000003', 'ack');
  if not (res ->> 'ok')::boolean then raise exception 'FAIL S2a: acknowledge by reply failed: %', res; end if;
  select status into st from public.tsk_tasks where id = t1;
  if st <> 'in_progress' then raise exception 'FAIL S2b: task is %, expected in_progress', st; end if;
  res := public.msg_task_reply('whatsapp', '+201000000003', 'DONE ' || public.tsk__ref(t1));
  if not (res ->> 'ok')::boolean then raise exception 'FAIL S2c: complete by reply failed: %', res; end if;
  select status into st from public.tsk_tasks where id = t1;
  if st <> 'done' then raise exception 'FAIL S2d: task is %, expected done', st; end if;
  select count(*) into n from public.msg_outbox where entity_id = t1 and kind = 'task_update' and recipient_id = ub;
  if n <> 1 then raise exception 'FAIL S2e: the creator was not told the task is done'; end if;
  select count(*) into n from public.audit_log where org_id = oa and entity_id = t1::text and action in ('tasks.task.in_progress', 'tasks.task.done');
  if n <> 2 then raise exception 'FAIL S2f: expected the 2 task status audit rows from the shared function, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.inbound.task_reply' and channel = 'whatsapp';
  if n <> 2 then raise exception 'FAIL S2g: expected 2 inbound audit rows with channel whatsapp, found %', n; end if;

  -- ---- S3: refusals change nothing
  res := public.msg_task_reply('whatsapp', '+201999999999', 'DONE');
  if res ->> 'code' <> 'UNKNOWN_IDENTITY' then raise exception 'FAIL S3a: an unknown number was not refused: %', res; end if;
  res := public.msg_task_reply('whatsapp', '+201000000003', 'thanks');
  if res ->> 'code' <> 'NOT_A_TASK_REPLY' then raise exception 'FAIL S3b: free text was treated as a task reply: %', res; end if;
  res := public.msg_task_reply('whatsapp', '+201000000003', 'DONE');
  if res ->> 'code' <> 'NO_OPEN_TASK' then raise exception 'FAIL S3c: completing with no open task was not refused: %', res; end if;
  res := public.msg_task_reply('whatsapp', '+201000000004', 'DONE ' || public.tsk__ref(te));
  if res ->> 'code' <> 'NO_OPEN_TASK' then raise exception 'FAIL S3d: someone completed a task that is not theirs: %', res; end if;
  select status into st from public.tsk_tasks where id = te;
  if st <> 'open' then raise exception 'FAIL S3e: the other person''s task is %, expected open', st; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.inbound.refused';
  if n < 2 then raise exception 'FAIL S3f: refusals are not audited (found %)', n; end if;

  -- ---- S4: two open tasks need a reference
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t2 := public.tsk_create_task('Check dock 2', ud);
  t3 := public.tsk_create_task('Restock gloves', ud);
  reset role;
  res := public.msg_task_reply('whatsapp', '+201000000004', 'DONE');
  if res ->> 'code' <> 'AMBIGUOUS' or jsonb_array_length(res -> 'tasks') <> 2 then raise exception 'FAIL S4a: two open tasks were not reported as ambiguous: %', res; end if;
  select count(*) into n from public.tsk_tasks where assignee_id = ud and status = 'done';
  if n <> 0 then raise exception 'FAIL S4b: an ambiguous reply completed a task'; end if;
  r2 := public.tsk__ref(t3);
  res := public.msg_task_reply('whatsapp', '+201000000004', 'done ' || r2);
  if not (res ->> 'ok')::boolean then raise exception 'FAIL S4c: a reply with the reference failed: %', res; end if;
  select status into st from public.tsk_tasks where id = t3;
  if st <> 'done' then raise exception 'FAIL S4d: the named task is %, expected done', st; end if;
  select status into st from public.tsk_tasks where id = t2;
  if st <> 'open' then raise exception 'FAIL S4e: the other task is %, expected open', st; end if;

  -- ---- S5: closed to signed-in users; chain clean
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.msg_task_reply('whatsapp', '+201000000003', 'DONE');
    raise exception 'FAIL S5a: a signed-in user could call the webhook function';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S5b: the audit chain is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
