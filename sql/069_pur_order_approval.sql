-- 069_pur_order_approval.sql
-- Approval for purchase orders (Dynamics review gap 3; Ben, 10 Nov 2026: "fix that asap").
--
-- Until now a purchase order could be created and received with no second person. Now:
--   * a company setting `po_approval` in organizations.settings: {"on": true|false, "fromMinor": <amount>}; default on, from 0, so
--     every new order needs approval until an owner or admin changes it (pur_set_po_approval, audited);
--   * pur_create_order works out the order's total and, when approval applies, marks the order `pending`;
--   * pur_decide_order(order, 'approved'|'rejected', note): owners and admins, never the person who created the order, except a sole
--     owner or admin (decision D1, core__sole_approver, flagged approval_self and audited as purchasing.order.self_approved);
--     rejecting needs a reason and cancels the order;
--   * a table rule on pur_order_lines refuses any receipt (received_qty going up) while the order is pending or rejected, so neither
--     pur_receive_lines nor pur_receive_order can bring stock in without approval; supplier bills are already capped by what arrived;
--   * orders that existed before this migration are `not_needed` (nothing changes for them).
-- Rerun-safe. Ends with read-only checks.

begin;

alter table public.pur_orders add column if not exists approval text not null default 'not_needed';
alter table public.pur_orders add column if not exists total_minor bigint;
alter table public.pur_orders add column if not exists approval_decided_by uuid references auth.users(id);
alter table public.pur_orders add column if not exists approval_decided_at timestamptz;
alter table public.pur_orders add column if not exists approval_note text;
alter table public.pur_orders add column if not exists approval_self boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pur_orders_approval_check' and conrelid = 'public.pur_orders'::regclass) then
    alter table public.pur_orders add constraint pur_orders_approval_check check (approval in ('not_needed', 'pending', 'approved', 'rejected'));
  end if;
  -- A decision names who and when, and is never the creator's own unless flagged as a sole approver's.
  if not exists (select 1 from pg_constraint where conname = 'pur_orders_approval_decider' and conrelid = 'public.pur_orders'::regclass) then
    alter table public.pur_orders add constraint pur_orders_approval_decider check (
      approval not in ('approved', 'rejected')
      or (approval_decided_by is not null and approval_decided_at is not null and (approval_decided_by <> created_by or approval_self)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_orders_rejected_cancelled' and conrelid = 'public.pur_orders'::regclass) then
    alter table public.pur_orders add constraint pur_orders_rejected_cancelled check (approval <> 'rejected' or status = 'cancelled');
  end if;
end $$;

-- The order guard (sql/017) plus: approval only moves pending -> approved or rejected, and its columns change only with it.
create or replace function public.pur_orders_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.number <> old.number or new.supplier_id <> old.supplier_id or new.warehouse_id <> old.warehouse_id
     or new.currency <> old.currency or new.created_by <> old.created_by then
    raise exception 'INVALID_STATE';
  end if;
  if new.status <> old.status and not (old.status = 'ordered' and new.status in ('received', 'cancelled')) then raise exception 'INVALID_STATE'; end if;
  if new.approval is distinct from old.approval then
    -- A decision (pending -> approved or rejected), or the order's creation setting it waiting together with its first total.
    if not ((old.approval = 'pending' and new.approval in ('approved', 'rejected'))
            or (old.approval = 'not_needed' and new.approval = 'pending' and old.total_minor is null and new.total_minor is not null)) then
      raise exception 'INVALID_STATE';
    end if;
  elsif new.approval_decided_by is distinct from old.approval_decided_by or new.approval_decided_at is distinct from old.approval_decided_at
     or new.approval_self is distinct from old.approval_self or new.approval_note is distinct from old.approval_note then
    raise exception 'INVALID_STATE';
  end if;
  if new.total_minor is distinct from old.total_minor and old.total_minor is not null then raise exception 'INVALID_STATE'; end if;
  return new;
end $$;

-- No goods in while the order waits for approval or was rejected.
create or replace function public.pur__order_lines_receive_guard() returns trigger language plpgsql set search_path = public as $$
declare v_approval text;
begin
  if new.received_qty > old.received_qty then
    select approval into v_approval from public.pur_orders where org_id = new.org_id and id = new.order_id;
    if v_approval in ('pending', 'rejected') then
      raise exception 'NOT_APPROVED' using detail = 'this purchase order needs approval before goods can be received';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pur_order_lines_receive_guard on public.pur_order_lines;
create trigger pur_order_lines_receive_guard before update of received_qty on public.pur_order_lines
  for each row execute function public.pur__order_lines_receive_guard();

-- The setting, with its default (on, from 0).
create or replace function public.pur__po_approval(p_org uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'on', coalesce((o.settings -> 'po_approval' ->> 'on')::boolean, true),
    'fromMinor', coalesce((o.settings -> 'po_approval' ->> 'fromMinor')::bigint, 0))
  from public.organizations o where o.id = p_org;
$$;

create or replace function public.pur_po_approval() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin', 'member']);
begin
  return public.pur__po_approval(v_org);
end $$;

create or replace function public.pur_set_po_approval(p_on boolean, p_from_minor bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); v_before jsonb; v_after jsonb;
begin
  if p_on is null or p_from_minor is null or p_from_minor < 0 then raise exception 'INVALID_INPUT'; end if;
  v_before := public.pur__po_approval(v_org);
  v_after := jsonb_build_object('on', p_on, 'fromMinor', p_from_minor);
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('po_approval', v_after) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'purchasing.order_approval.set', 'organization', v_org::text,
          case when p_on then format('Purchase orders need approval from %s (minor units)', p_from_minor) else 'Purchase orders need no approval' end,
          v_before, v_after);
  return v_after;
end $$;

-- As sql/017, plus the order's total and, when the company asks for it, approval.
create or replace function public.pur_create_order(p_supplier_id uuid, p_warehouse_id uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin']); v_id uuid; v_number text; v_currency char(3); v_line jsonb; v_item uuid; v_qty numeric; v_cost bigint; v_count int := 0;
  v_total bigint; v_rule jsonb; v_approval text := 'not_needed';
begin
  if not exists(select 1 from public.pur_suppliers where org_id=v_org and id=p_supplier_id and deleted_at is null) or not exists(select 1 from public.inv_warehouses where org_id=v_org and id=p_warehouse_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'INVALID_INPUT'; end if;
  select default_currency into v_currency from public.organizations where id=v_org;
  v_number := public.pur__next_number(v_org);
  insert into public.pur_orders(org_id,number,supplier_id,warehouse_id,currency,created_by) values(v_org,v_number,p_supplier_id,p_warehouse_id,v_currency,auth.uid()) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin v_item := (v_line->>'itemId')::uuid; v_qty := (v_line->>'qty')::numeric; v_cost := (v_line->>'unitCostMinor')::bigint; exception when others then raise exception 'INVALID_INPUT'; end;
    if v_qty <= 0 or v_cost < 0 or not exists(select 1 from public.inv_items where org_id=v_org and id=v_item and deleted_at is null) then raise exception 'INVALID_INPUT'; end if;
    insert into public.pur_order_lines(org_id,order_id,item_id,qty,unit_cost_minor) values(v_org,v_id,v_item,v_qty,v_cost);
    v_count := v_count + 1;
  end loop;
  select coalesce(round(sum(qty * unit_cost_minor)), 0)::bigint into v_total from public.pur_order_lines where org_id=v_org and order_id=v_id;
  v_rule := public.pur__po_approval(v_org);
  if (v_rule->>'on')::boolean and v_total >= (v_rule->>'fromMinor')::bigint then v_approval := 'pending'; end if;
  update public.pur_orders set total_minor = v_total, approval = v_approval where id = v_id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.created','purchase_order',v_id::text,
    format('%s created with %s line(s)%s', v_number, v_count, case when v_approval = 'pending' then '; waiting for approval' else '' end));
  return jsonb_build_object('id',v_id,'number',v_number,'approval',v_approval);
end $$;

create or replace function public.pur_decide_order(p_order_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); o public.pur_orders; v_self boolean; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_action text;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_INPUT'; end if;
  if p_decision = 'rejected' and v_note is null then raise exception 'INVALID_INPUT' using detail = 'a reason is needed to reject'; end if;
  select * into o from public.pur_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.approval <> 'pending' or o.status <> 'ordered' then raise exception 'INVALID_STATE' using detail = format('the order is %s', o.approval); end if;
  v_self := o.created_by = auth.uid();
  if v_self and not public.core__sole_approver(v_org) then raise exception 'SELF_APPROVAL'; end if;
  if p_decision = 'approved' then
    update public.pur_orders set approval = 'approved', approval_decided_by = auth.uid(), approval_decided_at = now(), approval_note = v_note, approval_self = v_self
     where id = o.id;
    v_action := case when v_self then 'purchasing.order.self_approved' else 'purchasing.order.approved' end;
  else
    update public.pur_orders set approval = 'rejected', approval_decided_by = auth.uid(), approval_decided_at = now(), approval_note = v_note, approval_self = v_self,
           status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
     where id = o.id;
    v_action := 'purchasing.order.rejected';
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), v_action, 'purchase_order', o.id::text,
          format('%s %s%s%s', o.number, p_decision, case when v_self then ' (self-approved: no second approver in the company)' else '' end,
                 case when v_note is not null then ': ' || v_note else '' end));
  return jsonb_build_object('id', o.id, 'approval', p_decision);
end $$;

revoke all on function public.pur__order_lines_receive_guard(), public.pur__po_approval(uuid) from public, anon, authenticated;
revoke all on function public.pur_po_approval(), public.pur_set_po_approval(boolean, bigint), public.pur_create_order(uuid, uuid, jsonb),
  public.pur_decide_order(uuid, text, text) from public, anon;
grant execute on function public.pur_po_approval(), public.pur_set_po_approval(boolean, bigint), public.pur_create_order(uuid, uuid, jsonb),
  public.pur_decide_order(uuid, text, text) to authenticated;

commit;

-- Read-only verification.
select count(*) filter (where approval = 'not_needed') as existing_orders_not_needed, count(*) filter (where approval <> 'not_needed') as others
  from public.pur_orders;
select has_function_privilege('anon', 'public.pur_decide_order(uuid, text, text)', 'execute') as anon_decides,
       has_function_privilege('authenticated', 'public.pur__po_approval(uuid)', 'execute') as users_call_internal,
       exists (select 1 from pg_trigger where tgname = 'pur_order_lines_receive_guard') as receive_guard;
