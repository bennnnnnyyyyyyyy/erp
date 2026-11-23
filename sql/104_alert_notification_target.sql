-- 104_alert_notification_target.sql
-- Bellvox roadmap phase 0 (UX audit 20 Nov 2026; Ben approved the roadmap 23 Nov): alert notifications (low stock, expiry, overdue
-- invoices, running out, losing money) opened nothing when clicked, because alr_run queues them with no entity. A trigger on the
-- outbox now gives every alert message the target "alert:<rule kind>" (entity_id = the rule), read from its own idempotency key
-- ('alr:<rule id>:...'); msg__deliver copies it to the in-app notification and the bell opens the page for that kind. alr_run is not
-- changed. Rule kinds are written into the notification itself because alert rules are readable by owners and admins only.
-- Existing alert messages and notifications get the same target (backfill). Depends on sql/007, 028, 030. Rerun-safe.
-- Run the whole file, then sql/tests/101_alert_notification_target.sql.

begin;

create or replace function public.msg__alert_target() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rule uuid; v_kind text;
begin
  if new.kind = 'alert' and new.entity_type is null and new.idempotency_key like 'alr:%' then
    begin
      v_rule := split_part(new.idempotency_key, ':', 2)::uuid;
    exception when others then
      return new;
    end;
    select r.kind into v_kind from public.alr_rules r where r.org_id = new.org_id and r.id = v_rule;
    if v_kind is not null then
      new.entity_type := 'alert:' || v_kind;
      new.entity_id := v_rule;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists msg_outbox_alert_target on public.msg_outbox;
create trigger msg_outbox_alert_target before insert on public.msg_outbox for each row execute function public.msg__alert_target();
revoke all on function public.msg__alert_target() from public, anon, authenticated;

-- Backfill: alert messages already queued or delivered.
update public.msg_outbox o set entity_type = 'alert:' || r.kind, entity_id = r.id
  from public.alr_rules r
 where o.kind = 'alert' and o.entity_type is null and o.idempotency_key like 'alr:%'
   and r.org_id = o.org_id and r.id::text = split_part(o.idempotency_key, ':', 2);
update public.msg_notifications n set entity_type = o.entity_type, entity_id = o.entity_id
  from public.msg_outbox o
 where n.outbox_id = o.id and n.entity_type is null and o.entity_type like 'alert:%';

commit;

-- Verification (read-only).
select
  exists (select 1 from pg_trigger where tgname = 'msg_outbox_alert_target' and not tgisinternal) as trigger_on,
  (select count(*) from public.msg_outbox where kind = 'alert' and entity_type is null and idempotency_key like 'alr:%') as alerts_without_target,
  has_function_privilege('authenticated', 'public.msg__alert_target()', 'execute') as users_call_trigger_fn;
