-- 010_task_replies.sql
-- S4 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): the person a task is assigned to can acknowledge or complete it by
-- replying on their VERIFIED WhatsApp number ("ACK 1A2B", "DONE 1A2B"). The reply is turned into a call to the same function the
-- app uses (tsk_set_status) as that person, so the rules, transitions and audit are the same. A reply from an unverified number,
-- for someone else's task, or for a task that is not open, changes nothing and is audited.
-- Depends on sql/001-009. Rerun-safe. Run the whole file, then sql/tests/006_task_replies.sql.

begin;

-- Short reference shown in messages and typed back: the first 4 characters of the task id, upper case.
create or replace function public.tsk__ref(p_id uuid) returns text
language sql immutable set search_path = public as $$ select upper(substr(replace(p_id::text, '-', ''), 1, 4)) $$;

-- Same as 007, plus: an assignee with a verified WhatsApp number also gets a WhatsApp message with the reply instructions.
create or replace function public.tsk_tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id <> new.created_by then
      perform public.msg__enqueue(new.org_id, new.assignee_id, 'task_assigned', format('New task: %s', new.title),
        coalesce(case when new.due_at is not null then 'Due ' || to_char(new.due_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC' end, ''),
        'task', new.id, format('task:%s:assigned', new.id));
      if exists (select 1 from public.msg_identities i where i.org_id = new.org_id and i.user_id = new.assignee_id and i.channel = 'whatsapp' and i.status = 'verified') then
        perform public.msg__enqueue(new.org_id, new.assignee_id, 'task_assigned', format('New task: %s', new.title),
          format('Reply ACK %s to say you have seen it, or DONE %s when it is finished.', public.tsk__ref(new.id), public.tsk__ref(new.id)),
          'task', new.id, format('task:%s:whatsapp:%s', new.id, new.assignee_id), 'whatsapp');
      end if;
    end if;
  elsif new.status = 'done' and old.status <> 'done' and new.created_by is distinct from new.completed_by then
    perform public.msg__enqueue(new.org_id, new.created_by, 'task_update', format('Task done: %s', new.title), '', 'task', new.id, format('task:%s:done', new.id));
  end if;
  return null;
end $$;

-- Called by the webhook (service role). Returns {ok, code, ...} and never raises for a refusal; refusals are audited.
--   text: ACK|START [ref] and DONE [ref]; a ref is needed only when the person has more than one open task.
--   codes: OK, NOT_A_TASK_REPLY, UNKNOWN_IDENTITY, NO_OPEN_TASK, AMBIGUOUS (with the list of open tasks), or the database
--   reason when tsk_set_status refused (INVALID_STATE, FORBIDDEN, MODULE_DISABLED).
create or replace function public.msg_task_reply(p_channel text, p_address text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_addr   text := regexp_replace(coalesce(p_address, ''), '[\s-]', '', 'g');
  v_m      text[] := regexp_match(upper(trim(coalesce(p_text, ''))), '^(ACK|START|DONE)(?:\s+([0-9A-F]{4}))?$');
  v_status text;
  idn      public.msg_identities;
  tk       public.tsk_tasks;
  n_open   int;
  v_code   text;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'code', 'NOT_A_TASK_REPLY'); end if;
  v_status := case when v_m[1] = 'DONE' then 'done' else 'in_progress' end;

  select * into idn from public.msg_identities i where i.channel = p_channel and i.address = v_addr and i.status = 'verified';
  if not found then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_IDENTITY'); end if;

  select count(*) into n_open from public.tsk_tasks t
  where t.org_id = idn.org_id and t.assignee_id = idn.user_id and t.status in ('open', 'in_progress') and (v_m[2] is null or public.tsk__ref(t.id) = v_m[2]);
  if n_open = 0 then v_code := 'NO_OPEN_TASK';
  elsif n_open > 1 then
    return jsonb_build_object('ok', false, 'code', 'AMBIGUOUS', 'tasks', (
      select jsonb_agg(jsonb_build_object('ref', public.tsk__ref(t.id), 'title', t.title) order by t.created_at)
      from public.tsk_tasks t where t.org_id = idn.org_id and t.assignee_id = idn.user_id and t.status in ('open', 'in_progress')));
  end if;
  if v_code is not null then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (idn.org_id, idn.user_id, 'messaging.inbound.refused', 'identity', idn.id::text, format('Task reply from %s refused: %s', public.msg__mask(v_addr), v_code), p_channel);
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  select t.* into tk from public.tsk_tasks t
  where t.org_id = idn.org_id and t.assignee_id = idn.user_id and t.status in ('open', 'in_progress') and (v_m[2] is null or public.tsk__ref(t.id) = v_m[2]);

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', idn.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', json_build_object('x-org-id', idn.org_id)::text, true);
    perform public.tsk_set_status(tk.id, v_status);
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (idn.org_id, idn.user_id, 'messaging.inbound.task_reply', 'task', tk.id::text, format('Task "%s" set to %s by reply from %s', tk.title, v_status, public.msg__mask(v_addr)), p_channel);
    return jsonb_build_object('ok', true, 'code', 'OK', 'task_id', tk.id, 'status', v_status);
  exception when others then
    v_code := sqlerrm;
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (idn.org_id, idn.user_id, 'messaging.inbound.refused', 'task', tk.id::text, format('Task reply from %s refused by the task rules: %s', public.msg__mask(v_addr), v_code), p_channel);
  return jsonb_build_object('ok', false, 'code', v_code);
end $$;

revoke all on function public.tsk__ref(uuid) from public, anon, authenticated;
revoke all on function public.tsk_tasks_notify() from public, anon, authenticated;
revoke all on function public.msg_task_reply(text, text, text) from public, anon, authenticated;
grant execute on function public.msg_task_reply(text, text, text) to service_role;

commit;

-- Verification (read-only): signed-in users cannot call the webhook function (expect false).
select has_function_privilege('authenticated', 'public.msg_task_reply(text,text,text)', 'execute') as can_call;
