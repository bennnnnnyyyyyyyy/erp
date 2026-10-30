-- 013_reorder_levels.sql
-- I6 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): reorder levels and low-stock notifications. An item can have a
-- reorder level; when the quantity AVAILABLE (on hand minus reserved, all warehouses) is at or below it, the managers get one
-- message per item per day. It rides on the existing chasing job (msg_run_chasing), so it uses the same outbox, retries and
-- audit as everything else, and only for organizations with the messaging module on.
-- Depends on sql/001-012. Rerun-safe. Run the whole file, then sql/tests/009_reorder_levels.sql.

begin;

alter table public.inv_items add column if not exists reorder_level numeric(18, 3) check (reorder_level is null or reorder_level >= 0);

-- Owner or admin sets the reorder level of an item. A null level removes it.
create or replace function public.inv_set_reorder_level(p_item_id uuid, p_level numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  i     public.inv_items;
begin
  if p_level is not null and p_level < 0 then raise exception 'INVALID_INPUT'; end if;
  select * into i from public.inv_items x where x.org_id = v_org and x.id = p_item_id and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.inv_items x set reorder_level = p_level where x.id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.reorder_level.set', 'item', i.id::text,
          case when p_level is null then format('Reorder level of %s removed', i.sku) else format('Reorder level of %s set to %s', i.sku, p_level) end);
end $$;

-- Same as 007, plus low-stock messages and a `low_stock` count in the result.
create or replace function public.msg_run_chasing(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o     record;
  rq    record;
  tk    record;
  it    record;
  m     record;
  rem   int;
  esc   int;
  v     uuid;
  n_rem int := 0;
  n_esc int := 0;
  n_low int := 0;
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

    -- Low stock: available quantity (all warehouses) at or below the reorder level, one message per manager per item per day.
    for it in
      select i.id, i.sku, i.name, i.reorder_level, coalesce(sum(b.on_hand - b.reserved), 0) as available
      from public.inv_items i
      left join public.inv_stock_balances b on b.org_id = i.org_id and b.item_id = i.id
      where i.org_id = o.id and i.deleted_at is null and i.reorder_level is not null
      group by i.id, i.sku, i.name, i.reorder_level
      having coalesce(sum(b.on_hand - b.reserved), 0) <= i.reorder_level
    loop
      for m in select u.user_id from public.msg__managers(o.id) u loop
        v := public.msg__enqueue(o.id, m.user_id, 'info', format('Low stock: %s %s', it.sku, it.name),
               format('Available %s, reorder level %s.', it.available, it.reorder_level), 'item', it.id,
               format('lowstock:%s:%s:%s', it.id, to_char(now() at time zone 'utc', 'YYYYMMDD'), m.user_id));
        if v is not null then
          n_low := n_low + 1;
          insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
          values (o.id, 'messaging.lowstock.queued', 'item', it.id::text, format('Low stock message queued for %s (available %s, level %s)', it.sku, it.available, it.reorder_level));
        end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('reminders', n_rem, 'escalations', n_esc, 'low_stock', n_low);
end $$;

revoke all on function public.inv_set_reorder_level(uuid, numeric) from public, anon;
grant execute on function public.inv_set_reorder_level(uuid, numeric) to authenticated;
revoke all on function public.msg_run_chasing(uuid) from public, anon, authenticated;
grant execute on function public.msg_run_chasing(uuid) to service_role;

commit;

-- Verification (read-only): expect true (signed-in users may set a level; the job function is service-role only: false).
select has_function_privilege('authenticated', 'public.inv_set_reorder_level(uuid,numeric)', 'execute') as set_level,
       has_function_privilege('authenticated', 'public.msg_run_chasing(uuid)', 'execute') as job;
