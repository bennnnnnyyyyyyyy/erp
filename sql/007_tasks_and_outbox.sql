-- 007_tasks_and_outbox.sql
-- Slice 2 (documentation/plans/TASKS_AND_OUTBOX_PLAN.md): tasks, a transactional notification outbox, an in-app
-- notification inbox, retries with backoff, message expiry, reminders and escalation.
--
-- ADR-0003 rules hold: signed-in users can only SELECT; every change is a database function; outbox rows are written
-- by triggers in the same transaction as the event that causes them. Channels never decide or change stock: delivery
-- only moves messages; approval stays in inv_decide_request.
--
-- Depends on sql/001-006. Rerun-safe: tables `if not exists`, functions `create or replace`, triggers and policies
-- dropped and recreated by name. No table or data is dropped. Run the whole file, then the verification queries
-- (each on its own), then sql/tests/003_tasks_and_outbox.sql.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.tsk_tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  title        text not null check (length(trim(title)) between 1 and 200),
  description  text not null default '',
  assignee_id  uuid not null references auth.users(id),
  created_by   uuid not null references auth.users(id),
  due_at       timestamptz,
  status       text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  linked_type  text,
  linked_id    uuid,
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, id)
);

create table if not exists public.msg_outbox (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  recipient_id    uuid not null references auth.users(id),
  channel         text not null default 'in_app' check (channel in ('in_app', 'fake', 'email', 'whatsapp', 'voice')),
  kind            text not null check (kind in ('approval_request', 'decision', 'task_assigned', 'task_update', 'reminder', 'escalation', 'info')),
  subject         text not null,
  body            text not null default '',
  entity_type     text,
  entity_id       uuid,
  idempotency_key text not null,
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'expired', 'cancelled')),
  attempts        int not null default 0,
  max_attempts    int not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours',
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create table if not exists public.msg_notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  user_id     uuid not null references auth.users(id),
  outbox_id   uuid unique references public.msg_outbox(id),
  title       text not null,
  body        text not null default '',
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists tsk_tasks_org_assignee_idx on public.tsk_tasks (org_id, assignee_id, status);
create index if not exists msg_outbox_due_idx on public.msg_outbox (status, next_attempt_at) where status in ('pending', 'sending');
create index if not exists msg_outbox_org_idx on public.msg_outbox (org_id, created_at desc);
create index if not exists msg_notifications_user_idx on public.msg_notifications (org_id, user_id, created_at desc);

drop trigger if exists tsk_tasks_updated_at on public.tsk_tasks;
create trigger tsk_tasks_updated_at before update on public.tsk_tasks for each row execute function public.set_updated_at();
drop trigger if exists msg_outbox_updated_at on public.msg_outbox;
create trigger msg_outbox_updated_at before update on public.msg_outbox for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- privileges and row level security

alter table public.tsk_tasks          enable row level security;
alter table public.msg_outbox         enable row level security;
alter table public.msg_notifications  enable row level security;

revoke all on public.tsk_tasks, public.msg_outbox, public.msg_notifications from anon, authenticated;
grant select on public.tsk_tasks, public.msg_outbox, public.msg_notifications to authenticated;

drop policy if exists tsk_tasks_member_read on public.tsk_tasks;
create policy tsk_tasks_member_read on public.tsk_tasks for select to authenticated using (public.is_org_member(org_id));

drop policy if exists msg_notifications_own_read on public.msg_notifications;
create policy msg_notifications_own_read on public.msg_notifications for select to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id));

-- Delivery status is for owners and admins only.
drop policy if exists msg_outbox_manager_read on public.msg_outbox;
create policy msg_outbox_manager_read on public.msg_outbox for select to authenticated
  using (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.memberships m
      where m.org_id = msg_outbox.org_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin') and m.disabled_at is null
    )
  );

-- ---------------------------------------------------------------- internal helpers

-- Caller's organization after checking role and that the given module is switched on for it.
create or replace function public.mod__guard(p_module text, p_roles text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(p_roles);
begin
  if not exists (select 1 from public.org_modules m where m.org_id = v_org and m.module_key = p_module and m.disabled_at is null) then
    raise exception 'MODULE_DISABLED';
  end if;
  return v_org;
end $$;

create or replace function public.msg__managers(p_org uuid, p_roles text[] default array['owner', 'admin']) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select m.user_id from public.memberships m where m.org_id = p_org and m.role = any (p_roles) and m.disabled_at is null;
$$;

-- Puts one message in the outbox. Does nothing (returns null) when the organization has the messaging module off,
-- the person is not an active member, or the same idempotency key was already queued.
create or replace function public.msg__enqueue(
  p_org uuid, p_recipient uuid, p_kind text, p_subject text, p_body text,
  p_entity_type text, p_entity_id uuid, p_key text, p_channel text default 'in_app'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.org_modules m where m.org_id = p_org and m.module_key = 'messaging' and m.disabled_at is null) then
    return null;
  end if;
  if not exists (select 1 from public.memberships mm where mm.org_id = p_org and mm.user_id = p_recipient and mm.disabled_at is null) then
    return null;
  end if;
  insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, entity_type, entity_id, idempotency_key)
  values (p_org, p_recipient, p_channel, p_kind, p_subject, coalesce(p_body, ''), p_entity_type, p_entity_id, p_key)
  on conflict (org_id, idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- triggers: events become messages (same transaction)

create or replace function public.inv_requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if tg_op = 'INSERT' then
    for m in select u.user_id from public.msg__managers(new.org_id) u where u.user_id <> new.requester_id loop
      perform public.msg__enqueue(new.org_id, m.user_id, 'approval_request', format('%s needs your approval', new.number),
        coalesce(nullif(new.reason, ''), 'Open the request to see the items.'), 'stock_request', new.id, format('request:%s:submitted:%s', new.id, m.user_id));
    end loop;
  elsif new.status <> old.status then
    if new.status in ('approved', 'rejected') then
      perform public.msg__enqueue(new.org_id, new.requester_id, 'decision', format('%s was %s', new.number, new.status),
        coalesce(new.decision_comment, ''), 'stock_request', new.id, format('request:%s:decision', new.id));
    elsif new.status = 'issued' and new.issued_by is distinct from new.requester_id then
      perform public.msg__enqueue(new.org_id, new.requester_id, 'info', format('%s was issued', new.number),
        'The stock has left the warehouse.', 'stock_request', new.id, format('request:%s:issued', new.id));
    end if;
  end if;
  return null;
end $$;

drop trigger if exists inv_requests_notify on public.inv_requests;
create trigger inv_requests_notify after insert or update of status on public.inv_requests
  for each row execute function public.inv_requests_notify();

-- A task moves only along the allowed transitions and its identity never changes.
create or replace function public.tsk_tasks_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.created_by <> old.created_by or new.assignee_id <> old.assignee_id then
    raise exception 'INVALID_STATE' using detail = 'task identity cannot change';
  end if;
  if new.status <> old.status and not (
       (old.status = 'open' and new.status in ('in_progress', 'done', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('done', 'cancelled'))
  ) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;

drop trigger if exists tsk_tasks_guard on public.tsk_tasks;
create trigger tsk_tasks_guard before update on public.tsk_tasks for each row execute function public.tsk_tasks_guard();

create or replace function public.tsk_tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id <> new.created_by then
      perform public.msg__enqueue(new.org_id, new.assignee_id, 'task_assigned', format('New task: %s', new.title),
        coalesce(case when new.due_at is not null then 'Due ' || to_char(new.due_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC' end, ''),
        'task', new.id, format('task:%s:assigned', new.id));
    end if;
  elsif new.status = 'done' and old.status <> 'done' and new.created_by is distinct from new.completed_by then
    perform public.msg__enqueue(new.org_id, new.created_by, 'task_update', format('Task done: %s', new.title), '', 'task', new.id, format('task:%s:done', new.id));
  end if;
  return null;
end $$;

drop trigger if exists tsk_tasks_notify on public.tsk_tasks;
create trigger tsk_tasks_notify after insert or update of status on public.tsk_tasks
  for each row execute function public.tsk_tasks_notify();

-- ---------------------------------------------------------------- functions called by signed-in users

create or replace function public.tsk_create_task(
  p_title text, p_assignee uuid, p_due_at timestamptz default null, p_description text default '',
  p_linked_type text default null, p_linked_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.mod__guard('tasks', array['owner', 'admin']);
  v_id  uuid;
begin
  if not exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = p_assignee and m.disabled_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'the assignee is not a member of this organization';
  end if;
  insert into public.tsk_tasks (org_id, title, description, assignee_id, created_by, due_at, linked_type, linked_id)
  values (v_org, trim(p_title), coalesce(p_description, ''), p_assignee, auth.uid(), p_due_at, p_linked_type, p_linked_id)
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'tasks.task.created', 'task', v_id::text, format('Task "%s" assigned', trim(p_title)));
  return v_id;
exception when check_violation then
  raise exception 'INVALID_INPUT' using detail = 'the title is not valid';
end $$;

-- The assignee, the creator, an owner or an admin may change a task's status. Cannot go back to open.
create or replace function public.tsk_set_status(p_task_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.mod__guard('tasks', array['owner', 'admin', 'member']);
  t      public.tsk_tasks;
  v_role text;
begin
  if p_status not in ('in_progress', 'done', 'cancelled') then raise exception 'INVALID_INPUT'; end if;
  select * into t from public.tsk_tasks x where x.org_id = v_org and x.id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if auth.uid() not in (t.assignee_id, t.created_by) and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if t.status = p_status then raise exception 'INVALID_STATE' using detail = 'already ' || p_status; end if;

  update public.tsk_tasks x set status = p_status,
    completed_at = case when p_status = 'done' then now() else x.completed_at end,
    completed_by = case when p_status = 'done' then auth.uid() else x.completed_by end
  where x.id = t.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'tasks.task.' || p_status, 'task', t.id::text, format('Task "%s" is now %s', t.title, p_status));
end $$;

-- Marks one notification (or, with null, all of the caller's) as read.
create or replace function public.msg_mark_read(p_notification_id uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.mod__guard('messaging', array['owner', 'admin', 'member', 'viewer']);
  n int;
begin
  update public.msg_notifications x set read_at = now()
  where x.org_id = v_org and x.user_id = auth.uid() and x.read_at is null and (p_notification_id is null or x.id = p_notification_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- functions for the scheduled job (service role only)

-- Hands out due messages: expires old ones, recovers rows stuck in `sending`, then claims up to p_limit due rows.
create or replace function public.msg_claim_due(p_limit int default 20) returns setof public.msg_outbox
language plpgsql security definer set search_path = public as $$
begin
  -- An expired message is never sent, and the audit log records that it was not.
  with ex as (
    update public.msg_outbox set status = 'expired' where status = 'pending' and expires_at <= now()
    returning org_id, id, kind, subject, recipient_id, channel
  )
  insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
  select ex.org_id, 'messaging.message.expired', 'message', ex.id::text, format('Message "%s" expired before it was delivered', ex.subject),
         jsonb_build_object('channel', ex.channel, 'kind', ex.kind, 'recipient', ex.recipient_id)
  from ex;
  update public.msg_outbox set status = 'pending' where status = 'sending' and updated_at < now() - interval '5 minutes';
  return query
    update public.msg_outbox o set status = 'sending', attempts = o.attempts + 1
    where o.id in (
      select q.id from public.msg_outbox q
      where q.status = 'pending' and q.next_attempt_at <= now() and q.expires_at > now()
      order by q.next_attempt_at, q.created_at
      limit p_limit
      for update skip locked
    )
    returning o.*;
end $$;

-- Records the result of a send. Failure retries with backoff (1, 2, 4 minutes) until max_attempts, then `failed`.
create or replace function public.msg_complete(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.msg_outbox;
begin
  select * into r from public.msg_outbox o where o.id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'sending' then raise exception 'INVALID_STATE' using detail = format('message is %s', r.status); end if;
  if p_ok then
    update public.msg_outbox o set status = 'sent', sent_at = now(), last_error = null where o.id = r.id;
    insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
    values (r.org_id, 'messaging.message.sent', 'message', r.id::text, format('Message "%s" sent', r.subject),
            jsonb_build_object('channel', r.channel, 'kind', r.kind, 'recipient', r.recipient_id, 'attempts', r.attempts));
  elsif r.attempts >= r.max_attempts then
    update public.msg_outbox o set status = 'failed', last_error = left(coalesce(p_error, 'failed'), 500) where o.id = r.id;
    insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
    values (r.org_id, 'messaging.message.failed', 'message', r.id::text, format('Message "%s" failed after %s attempts', r.subject, r.attempts),
            jsonb_build_object('channel', r.channel, 'kind', r.kind, 'recipient', r.recipient_id, 'attempts', r.attempts, 'error', left(coalesce(p_error, 'failed'), 200)));
  else
    update public.msg_outbox o set status = 'pending', last_error = left(coalesce(p_error, 'failed'), 500),
      next_attempt_at = now() + interval '1 minute' * power(2, r.attempts - 1) where o.id = r.id;
  end if;
end $$;

-- The in-app channel: turns an outbox row into an inbox notification. Repeating it creates nothing new.
create or replace function public.msg_deliver_in_app(p_outbox_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.msg_outbox;
begin
  select * into r from public.msg_outbox o where o.id = p_outbox_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.msg_notifications (org_id, user_id, outbox_id, title, body, entity_type, entity_id)
  values (r.org_id, r.recipient_id, r.id, r.subject, r.body, r.entity_type, r.entity_id)
  on conflict (outbox_id) do nothing;
end $$;

-- Reminders and escalation. Safe to run as often as you like: idempotency keys stop repeats.
--   waiting stock request: reminder to each manager after chasing.reminder_after_minutes (default 30),
--                          escalation to each owner after chasing.escalate_after_minutes (default 120)
--   overdue task:          reminder to the assignee when the due time passes, escalation to the creator after the escalation time
create or replace function public.msg_run_chasing(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o     record;
  rq    record;
  tk    record;
  m     record;
  rem   int;
  esc   int;
  v     uuid;
  n_rem int := 0;
  n_esc int := 0;
begin
  for o in
    select og.id, og.settings from public.organizations og
    where og.deleted_at is null and (p_org is null or og.id = p_org)
      and exists (select 1 from public.org_modules mo where mo.org_id = og.id and mo.module_key = 'messaging' and mo.disabled_at is null)
  loop
    rem := coalesce((o.settings #>> '{chasing,reminder_after_minutes}')::int, 30);
    esc := coalesce((o.settings #>> '{chasing,escalate_after_minutes}')::int, 120);

    for rq in select r.id, r.number, r.requester_id, r.created_at from public.inv_requests r
              where r.org_id = o.id and r.status = 'submitted' and r.created_at <= now() - rem * interval '1 minute' loop
      for m in select u.user_id from public.msg__managers(o.id) u where u.user_id <> rq.requester_id loop
        v := public.msg__enqueue(o.id, m.user_id, 'reminder', format('Reminder: %s is still waiting for approval', rq.number),
               'Please approve or reject it.', 'stock_request', rq.id, format('request:%s:reminder:%s', rq.id, m.user_id));
        if v is not null then
          n_rem := n_rem + 1;
          insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
          values (o.id, 'messaging.reminder.queued', 'stock_request', rq.id::text, format('Reminder queued for %s', rq.number));
        end if;
      end loop;
      if rq.created_at <= now() - esc * interval '1 minute' then
        for m in select u.user_id from public.msg__managers(o.id, array['owner']) u where u.user_id <> rq.requester_id loop
          v := public.msg__enqueue(o.id, m.user_id, 'escalation', format('Escalation: %s has had no decision', rq.number),
                 'Nobody has answered yet. Please decide or reassign.', 'stock_request', rq.id, format('request:%s:escalation:%s', rq.id, m.user_id));
          if v is not null then
            n_esc := n_esc + 1;
            insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
            values (o.id, 'messaging.escalation.queued', 'stock_request', rq.id::text, format('Escalation queued for %s', rq.number));
          end if;
        end loop;
      end if;
    end loop;

    for tk in select t.id, t.title, t.assignee_id, t.created_by, t.due_at from public.tsk_tasks t
              where t.org_id = o.id and t.status in ('open', 'in_progress') and t.due_at is not null and t.due_at <= now() loop
      v := public.msg__enqueue(o.id, tk.assignee_id, 'reminder', format('Overdue: %s', tk.title), 'This task is past its due time.', 'task', tk.id, format('task:%s:overdue:%s', tk.id, tk.assignee_id));
      if v is not null then
        n_rem := n_rem + 1;
        insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
        values (o.id, 'messaging.reminder.queued', 'task', tk.id::text, format('Overdue reminder queued for task "%s"', tk.title));
      end if;
      if tk.due_at <= now() - esc * interval '1 minute' and tk.created_by <> tk.assignee_id then
        v := public.msg__enqueue(o.id, tk.created_by, 'escalation', format('Escalation: task "%s" is still not done', tk.title), 'It is well past its due time.', 'task', tk.id, format('task:%s:overdue_escalation:%s', tk.id, tk.created_by));
        if v is not null then
          n_esc := n_esc + 1;
          insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
          values (o.id, 'messaging.escalation.queued', 'task', tk.id::text, format('Overdue escalation queued for task "%s"', tk.title));
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('reminders', n_rem, 'escalations', n_esc);
end $$;

-- ---------------------------------------------------------------- function privileges

revoke all on function public.mod__guard(text, text[]) from public, anon, authenticated;
revoke all on function public.msg__managers(uuid, text[]) from public, anon, authenticated;
revoke all on function public.msg__enqueue(uuid, uuid, text, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.inv_requests_notify() from public, anon, authenticated;
revoke all on function public.tsk_tasks_guard() from public, anon, authenticated;
revoke all on function public.tsk_tasks_notify() from public, anon, authenticated;

revoke all on function public.tsk_create_task(text, uuid, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.tsk_set_status(uuid, text) from public, anon;
revoke all on function public.msg_mark_read(uuid) from public, anon;
grant execute on function public.tsk_create_task(text, uuid, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.tsk_set_status(uuid, text) to authenticated;
grant execute on function public.msg_mark_read(uuid) to authenticated;

revoke all on function public.msg_claim_due(int) from public, anon, authenticated;
revoke all on function public.msg_complete(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.msg_deliver_in_app(uuid) from public, anon, authenticated;
revoke all on function public.msg_run_chasing(uuid) from public, anon, authenticated;
grant execute on function public.msg_claim_due(int) to service_role;
grant execute on function public.msg_complete(uuid, boolean, text) to service_role;
grant execute on function public.msg_deliver_in_app(uuid) to service_role;
grant execute on function public.msg_run_chasing(uuid) to service_role;

commit;

-- ---------------------------------------------------------------- verification (read-only; run each on its own)

-- 1. Three tables with row level security on (expect three rows, all true).
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relname in ('tsk_tasks', 'msg_outbox', 'msg_notifications') order by relname;

-- 2. Signed-in and anonymous roles hold nothing but SELECT on them (expect zero rows).
select grantee, table_name, privilege_type from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name in ('tsk_tasks', 'msg_outbox', 'msg_notifications') and privilege_type <> 'SELECT';

-- 3. Signed-in users may call exactly these functions of this file (expect tsk_create_task, tsk_set_status, msg_mark_read).
select p.proname from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname in ('tsk_create_task', 'tsk_set_status', 'msg_mark_read', 'msg_claim_due', 'msg_complete', 'msg_deliver_in_app', 'msg_run_chasing', 'msg__enqueue', 'msg__managers', 'mod__guard')
  and has_function_privilege('authenticated', p.oid, 'execute') order by 1;
