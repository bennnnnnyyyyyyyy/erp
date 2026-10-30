-- 012_stock_adjustments.sql
-- I3 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): stock adjustments from a count. A person counts an item in a
-- warehouse and submits the counted quantity with a reason; a manager (not the same person) approves; only then does the
-- difference reach the ledger as an `adjust` movement. Same pattern as outgoing stock: the ledger trigger refuses an adjust
-- movement unless its adjustment is approved, so even a direct insert cannot change stock without an approval. If the stock
-- changed between the count and the approval, the approval is refused and the count must be repeated.
-- Depends on sql/001-011. Rerun-safe. Run the whole file, then sql/tests/008_stock_adjustments.sql.

begin;

alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_kind_check;
alter table public.inv_stock_moves add constraint inv_stock_moves_kind_check check (kind in ('receipt', 'issue', 'adjust'));
alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_check;
alter table public.inv_stock_moves add column if not exists adjustment_id uuid;

create table if not exists public.inv_adjustments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  number           text not null,
  item_id          uuid not null,
  warehouse_id     uuid not null,
  counted_qty      numeric(18, 3) not null check (counted_qty >= 0),
  expected_qty     numeric(18, 3) not null check (expected_qty >= 0),
  delta            numeric(18, 3) not null check (delta <> 0),
  reason           text not null check (length(trim(reason)) between 1 and 500),
  status           text not null default 'submitted' check (status in ('submitted', 'approved', 'applied', 'rejected', 'cancelled')),
  requester_id     uuid not null references auth.users(id),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, item_id) references public.inv_items (org_id, id),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id),
  constraint inv_adjustments_delta_matches check (delta = counted_qty - expected_qty),
  constraint inv_adjustments_decider_not_requester check (decided_by is null or decided_by <> requester_id),
  constraint inv_adjustments_decided_when_approved check (status not in ('approved', 'applied') or decided_by is not null)
);
create index if not exists inv_adjustments_org_status_idx on public.inv_adjustments (org_id, status);

alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_adjustment_fk;
alter table public.inv_stock_moves add constraint inv_stock_moves_adjustment_fk foreign key (org_id, adjustment_id) references public.inv_adjustments (org_id, id);
alter table public.inv_stock_moves add constraint inv_stock_moves_check check (
  (kind = 'receipt' and qty > 0)
  or (kind = 'issue' and qty < 0 and request_id is not null)
  or (kind = 'adjust' and qty <> 0 and adjustment_id is not null)
);

drop trigger if exists inv_adjustments_updated_at on public.inv_adjustments;
create trigger inv_adjustments_updated_at before update on public.inv_adjustments for each row execute function public.set_updated_at();

create or replace function public.inv_adjustments_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.requester_id <> old.requester_id or new.number <> old.number or new.item_id <> old.item_id
     or new.warehouse_id <> old.warehouse_id or new.counted_qty <> old.counted_qty or new.expected_qty <> old.expected_qty or new.delta <> old.delta then
    raise exception 'INVALID_STATE' using detail = 'an adjustment cannot be edited';
  end if;
  if new.status <> old.status and not (
       (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled')) or (old.status = 'approved' and new.status = 'applied')
  ) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;
drop trigger if exists inv_adjustments_guard on public.inv_adjustments;
create trigger inv_adjustments_guard before update on public.inv_adjustments for each row execute function public.inv_adjustments_guard();

-- An outgoing movement needs an approved request, an adjust movement needs an approved adjustment (same idea as 006).
create or replace function public.inv_stock_moves_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if new.kind = 'issue' then
    select r.status into v_status from public.inv_requests r where r.org_id = new.org_id and r.id = new.request_id;
    if v_status is distinct from 'approved' then raise exception 'APPROVAL_REQUIRED'; end if;
  elsif new.kind = 'adjust' then
    select a.status into v_status from public.inv_adjustments a where a.org_id = new.org_id and a.id = new.adjustment_id;
    if v_status is distinct from 'approved' then raise exception 'APPROVAL_REQUIRED'; end if;
  end if;
  return new;
end $$;

alter table public.inv_adjustments enable row level security;
revoke all on public.inv_adjustments from anon, authenticated;
grant select on public.inv_adjustments to authenticated;
drop policy if exists inv_adjustments_member_read on public.inv_adjustments;
create policy inv_adjustments_member_read on public.inv_adjustments for select to authenticated using (public.is_org_member(org_id));

-- Managers get an in-app message when a count needs approval.
create or replace function public.inv_adjustments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if tg_op = 'INSERT' then
    for m in select u.user_id from public.msg__managers(new.org_id) u where u.user_id <> new.requester_id loop
      perform public.msg__enqueue(new.org_id, m.user_id, 'approval_request', format('%s: stock count needs your approval', new.number), new.reason,
        'stock_adjustment', new.id, format('adjustment:%s:submitted:%s', new.id, m.user_id));
    end loop;
  elsif new.status <> old.status and new.status in ('applied', 'rejected') then
    perform public.msg__enqueue(new.org_id, new.requester_id, 'decision', format('%s was %s', new.number, new.status), coalesce(new.decision_comment, ''),
      'stock_adjustment', new.id, format('adjustment:%s:decision', new.id));
  end if;
  return null;
end $$;
drop trigger if exists inv_adjustments_notify on public.inv_adjustments;
create trigger inv_adjustments_notify after insert or update of status on public.inv_adjustments for each row execute function public.inv_adjustments_notify();

create or replace function public.inv__next_adjustment_number(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.inv_counters (org_id, key, value) values (p_org, 'adjustment', 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v;
  return 'ADJ-' || lpad(v::text, 4, '0');
end $$;

-- A person submits what they counted. The expected quantity is the book quantity at this moment.
create or replace function public.inv_submit_adjustment(p_item_id uuid, p_warehouse_id uuid, p_counted_qty numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_expected numeric;
  v_reserved numeric;
  v_id       uuid := gen_random_uuid();
  v_number   text;
begin
  if p_counted_qty is null or p_counted_qty < 0 or length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a counted quantity and a reason are required'; end if;
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null)
     or not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown item or warehouse';
  end if;
  select b.on_hand, b.reserved into v_expected, v_reserved from public.inv_stock_balances b
  where b.org_id = v_org and b.item_id = p_item_id and b.warehouse_id = p_warehouse_id;
  v_expected := coalesce(v_expected, 0);
  if p_counted_qty = v_expected then raise exception 'INVALID_INPUT' using detail = 'the count matches the book quantity, nothing to adjust'; end if;
  if p_counted_qty < coalesce(v_reserved, 0) then raise exception 'INVALID_INPUT' using detail = format('%s is reserved for open requests; the count cannot be lower', v_reserved); end if;
  v_number := public.inv__next_adjustment_number(v_org);
  insert into public.inv_adjustments (id, org_id, number, item_id, warehouse_id, counted_qty, expected_qty, delta, reason, requester_id)
  values (v_id, v_org, v_number, p_item_id, p_warehouse_id, p_counted_qty, v_expected, p_counted_qty - v_expected, trim(p_reason), auth.uid());
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.adjustment.submitted', 'stock_adjustment', v_id::text,
          format('%s: counted %s, book %s (difference %s): %s', v_number, p_counted_qty, v_expected, p_counted_qty - v_expected, trim(p_reason)));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

-- Owner or admin, never the person who counted. Approving applies the difference to the ledger in the same transaction.
create or replace function public.inv_decide_adjustment(p_adjustment_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  a     public.inv_adjustments;
  b     public.inv_stock_balances;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then raise exception 'INVALID_INPUT'; end if;
  select * into a from public.inv_adjustments x where x.org_id = v_org and x.id = p_adjustment_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.requester_id = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if a.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('adjustment is %s', a.status); end if;

  if p_decision = 'rejected' then
    update public.inv_adjustments x set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = a.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.adjustment.rejected', 'stock_adjustment', a.id::text, format('%s rejected; stock unchanged', a.number), p_channel);
    return;
  end if;

  select * into b from public.inv_stock_balances s where s.org_id = v_org and s.item_id = a.item_id and s.warehouse_id = a.warehouse_id for update;
  if coalesce(b.on_hand, 0) <> a.expected_qty then
    raise exception 'INVALID_STATE' using detail = format('stock changed since the count (book is now %s, the count assumed %s); please count again', coalesce(b.on_hand, 0), a.expected_qty);
  end if;
  if a.counted_qty < coalesce(b.reserved, 0) then
    raise exception 'INVALID_STATE' using detail = format('%s is now reserved for open requests; the count cannot be lower', b.reserved);
  end if;

  update public.inv_adjustments x set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = a.id;
  insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, adjustment_id, ref, posted_by)
  values (v_org, a.item_id, a.warehouse_id, a.delta, 'adjust', a.id, a.number, auth.uid());
  insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved) values (v_org, a.item_id, a.warehouse_id, a.counted_qty, 0)
  on conflict (org_id, item_id, warehouse_id) do update set on_hand = a.counted_qty;
  update public.inv_adjustments x set status = 'applied' where x.id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), 'inventory.adjustment.applied', 'stock_adjustment', a.id::text, format('%s applied: stock %s to %s (difference %s)', a.number, a.expected_qty, a.counted_qty, a.delta), p_channel);
end $$;

create or replace function public.inv_cancel_adjustment(p_adjustment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.inv__guard(array['owner', 'admin', 'member']);
  a      public.inv_adjustments;
  v_role text;
begin
  select * into a from public.inv_adjustments x where x.org_id = v_org and x.id = p_adjustment_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if a.requester_id <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if a.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('adjustment is %s', a.status); end if;
  update public.inv_adjustments x set status = 'cancelled' where x.id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.adjustment.cancelled', 'stock_adjustment', a.id::text, format('%s cancelled', a.number));
end $$;

revoke all on function public.inv_adjustments_guard() from public, anon, authenticated;
revoke all on function public.inv_adjustments_notify() from public, anon, authenticated;
revoke all on function public.inv_stock_moves_guard() from public, anon, authenticated;
revoke all on function public.inv__next_adjustment_number(uuid) from public, anon, authenticated;
revoke all on function public.inv_submit_adjustment(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.inv_decide_adjustment(uuid, text, text, text) from public, anon;
revoke all on function public.inv_cancel_adjustment(uuid) from public, anon;
grant execute on function public.inv_submit_adjustment(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.inv_decide_adjustment(uuid, text, text, text) to authenticated;
grant execute on function public.inv_cancel_adjustment(uuid) to authenticated;

commit;

-- Verification (read-only): expect true, true, true, false.
select has_function_privilege('authenticated', 'public.inv_submit_adjustment(uuid,uuid,numeric,text)', 'execute') as submit,
       has_function_privilege('authenticated', 'public.inv_decide_adjustment(uuid,text,text,text)', 'execute') as decide,
       has_function_privilege('authenticated', 'public.inv_cancel_adjustment(uuid)', 'execute') as cancel,
       has_function_privilege('authenticated', 'public.inv__next_adjustment_number(uuid)', 'execute') as helper;
