-- 033_inventory_transfers.sql
-- Stock transfers between warehouses, with approval (documentation/plans/INVENTORY_TRANSFERS_PLAN.md). A person requests a move of
-- items from one warehouse to another (the stock is reserved at the source); a manager who is not the requester approves; the
-- source warehouse dispatches (stock leaves the source and is IN TRANSIT); the destination warehouse receives (stock enters the
-- destination). Same pattern as outgoing stock and adjustments: the ledger trigger refuses a transfer_out movement unless its
-- transfer is approved and a transfer_in movement unless it is dispatched, so even a direct insert cannot move stock around.
-- Batches and expiry travel with the goods: dispatch records the batches taken (first expiry first out) and receipt posts the
-- same batches at the destination. Average cost is per item for the organization, so a transfer changes no cost.
-- Depends on sql/001-032. Rerun-safe. Run the whole file, then sql/tests/029_inventory_transfers.sql.

begin;

alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_kind_check;
alter table public.inv_stock_moves add constraint inv_stock_moves_kind_check check (kind in ('receipt', 'issue', 'adjust', 'transfer_out', 'transfer_in'));
alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_check;
alter table public.inv_stock_moves add column if not exists transfer_id uuid;

create table if not exists public.inv_transfers (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  number            text not null,
  requester_id      uuid not null references auth.users(id),
  from_warehouse_id uuid not null,
  to_warehouse_id   uuid not null,
  reason            text not null default '' check (length(reason) <= 500),
  status            text not null default 'submitted' check (status in ('submitted', 'approved', 'dispatched', 'received', 'rejected', 'cancelled')),
  decided_by        uuid references auth.users(id),
  decided_at        timestamptz,
  decision_comment  text,
  dispatched_by     uuid references auth.users(id),
  dispatched_at     timestamptz,
  received_by       uuid references auth.users(id),
  received_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, from_warehouse_id) references public.inv_warehouses (org_id, id),
  foreign key (org_id, to_warehouse_id) references public.inv_warehouses (org_id, id),
  constraint inv_transfers_two_warehouses check (from_warehouse_id <> to_warehouse_id),
  -- The approval control, in the data: nobody decides their own transfer, and approved or later needs a decider.
  constraint inv_transfers_decider_not_requester check (decided_by is null or decided_by <> requester_id),
  constraint inv_transfers_decided_when_approved check (status not in ('approved', 'dispatched', 'received') or decided_by is not null),
  constraint inv_transfers_dispatched_by check (status not in ('dispatched', 'received') or dispatched_by is not null),
  constraint inv_transfers_received_by check (status <> 'received' or received_by is not null)
);
create index if not exists inv_transfers_org_status_idx on public.inv_transfers (org_id, status);

create table if not exists public.inv_transfer_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  transfer_id uuid not null,
  item_id     uuid not null,
  qty         numeric(18, 3) not null check (qty > 0),
  created_at  timestamptz not null default now(),
  unique (transfer_id, item_id),
  foreign key (org_id, transfer_id) references public.inv_transfers (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);
create index if not exists inv_transfer_lines_org_transfer_idx on public.inv_transfer_lines (org_id, transfer_id);

-- Evidence of each decision and the channel it came through (same shape as inv_approvals).
create table if not exists public.inv_transfer_approvals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  transfer_id uuid not null,
  decision    text not null check (decision in ('approved', 'rejected')),
  approver_id uuid not null references auth.users(id),
  comment     text,
  channel     text not null default 'app' check (channel in ('app', 'whatsapp', 'voice', 'api')),
  decided_at  timestamptz not null default now(),
  foreign key (org_id, transfer_id) references public.inv_transfers (org_id, id)
);
create index if not exists inv_transfer_approvals_org_transfer_idx on public.inv_transfer_approvals (org_id, transfer_id);

-- The batches actually taken at dispatch, so the destination receives the same batches (and expiry dates).
create table if not exists public.inv_transfer_batches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  transfer_id uuid not null,
  item_id     uuid not null,
  batch_id    uuid not null,
  qty         numeric(18, 3) not null check (qty > 0),
  created_at  timestamptz not null default now(),
  unique (transfer_id, item_id, batch_id),
  foreign key (org_id, transfer_id) references public.inv_transfers (org_id, id),
  foreign key (org_id, batch_id) references public.inv_batches (org_id, id)
);
create index if not exists inv_transfer_batches_org_transfer_idx on public.inv_transfer_batches (org_id, transfer_id);

alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_transfer_fk;
alter table public.inv_stock_moves add constraint inv_stock_moves_transfer_fk foreign key (org_id, transfer_id) references public.inv_transfers (org_id, id);
alter table public.inv_stock_moves add constraint inv_stock_moves_check check (
  (kind = 'receipt' and qty > 0)
  or (kind = 'issue' and qty < 0 and request_id is not null)
  or (kind = 'adjust' and qty <> 0 and adjustment_id is not null)
  or (kind = 'transfer_out' and qty < 0 and transfer_id is not null)
  or (kind = 'transfer_in' and qty > 0 and transfer_id is not null)
);

drop trigger if exists inv_transfers_updated_at on public.inv_transfers;
create trigger inv_transfers_updated_at before update on public.inv_transfers for each row execute function public.set_updated_at();

-- What may change on a transfer, and in which order the statuses may go.
create or replace function public.inv_transfers_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.requester_id <> old.requester_id or new.number <> old.number
     or new.from_warehouse_id <> old.from_warehouse_id or new.to_warehouse_id <> old.to_warehouse_id or new.reason <> old.reason then
    raise exception 'INVALID_STATE' using detail = 'a transfer cannot be edited';
  end if;
  if new.status <> old.status and not (
       (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled'))
    or (old.status = 'approved' and new.status in ('dispatched', 'cancelled'))
    or (old.status = 'dispatched' and new.status = 'received')
  ) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;
drop trigger if exists inv_transfers_guard on public.inv_transfers;
create trigger inv_transfers_guard before update on public.inv_transfers for each row execute function public.inv_transfers_guard();

-- The ledger, the approvals and the batch record are append-only, like the audit log.
drop trigger if exists inv_transfer_approvals_append_only on public.inv_transfer_approvals;
create trigger inv_transfer_approvals_append_only before update or delete on public.inv_transfer_approvals for each statement execute function public.inv_append_only();
drop trigger if exists inv_transfer_approvals_no_truncate on public.inv_transfer_approvals;
create trigger inv_transfer_approvals_no_truncate before truncate on public.inv_transfer_approvals for each statement execute function public.inv_append_only();
drop trigger if exists inv_transfer_batches_append_only on public.inv_transfer_batches;
create trigger inv_transfer_batches_append_only before update or delete on public.inv_transfer_batches for each statement execute function public.inv_append_only();
drop trigger if exists inv_transfer_batches_no_truncate on public.inv_transfer_batches;
create trigger inv_transfer_batches_no_truncate before truncate on public.inv_transfer_batches for each statement execute function public.inv_append_only();

-- An outgoing movement needs an approved request, an adjust movement an approved adjustment, a transfer_out movement an approved
-- transfer, and a transfer_in movement a dispatched one (same idea as 006 and 012).
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
  elsif new.kind = 'transfer_out' then
    select t.status into v_status from public.inv_transfers t where t.org_id = new.org_id and t.id = new.transfer_id;
    if v_status is distinct from 'approved' then raise exception 'APPROVAL_REQUIRED'; end if;
  elsif new.kind = 'transfer_in' then
    select t.status into v_status from public.inv_transfers t where t.org_id = new.org_id and t.id = new.transfer_id;
    if v_status is distinct from 'dispatched' then raise exception 'APPROVAL_REQUIRED'; end if;
  end if;
  return new;
end $$;

alter table public.inv_transfers enable row level security;
alter table public.inv_transfer_lines enable row level security;
alter table public.inv_transfer_approvals enable row level security;
alter table public.inv_transfer_batches enable row level security;
revoke all on public.inv_transfers, public.inv_transfer_lines, public.inv_transfer_approvals, public.inv_transfer_batches from anon, authenticated;
grant select on public.inv_transfers, public.inv_transfer_lines, public.inv_transfer_approvals, public.inv_transfer_batches to authenticated;
drop policy if exists inv_transfers_member_read on public.inv_transfers;
create policy inv_transfers_member_read on public.inv_transfers for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_transfer_lines_member_read on public.inv_transfer_lines;
create policy inv_transfer_lines_member_read on public.inv_transfer_lines for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_transfer_approvals_member_read on public.inv_transfer_approvals;
create policy inv_transfer_approvals_member_read on public.inv_transfer_approvals for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_transfer_batches_member_read on public.inv_transfer_batches;
create policy inv_transfer_batches_member_read on public.inv_transfer_batches for select to authenticated using (public.is_org_member(org_id));

-- Managers get an in-app message when a transfer needs approval; the requester hears about the decision and the arrival.
create or replace function public.inv_transfers_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if tg_op = 'INSERT' then
    for m in select u.user_id from public.msg__managers(new.org_id) u where u.user_id <> new.requester_id loop
      perform public.msg__enqueue(new.org_id, m.user_id, 'approval_request', format('%s: stock transfer needs your approval', new.number), new.reason,
        'stock_transfer', new.id, format('transfer:%s:submitted:%s', new.id, m.user_id));
    end loop;
  elsif new.status <> old.status and new.status in ('approved', 'rejected', 'received') then
    perform public.msg__enqueue(new.org_id, new.requester_id, 'decision', format('%s was %s', new.number, new.status), coalesce(new.decision_comment, ''),
      'stock_transfer', new.id, format('transfer:%s:%s', new.id, new.status));
  end if;
  return null;
end $$;
drop trigger if exists inv_transfers_notify on public.inv_transfers;
create trigger inv_transfers_notify after insert or update of status on public.inv_transfers for each row execute function public.inv_transfers_notify();

create or replace function public.inv__next_transfer_number(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.inv_counters (org_id, key, value) values (p_org, 'transfer', 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v;
  return 'TR-' || lpad(v::text, 6, '0');
end $$;

-- Releases the reservation a transfer holds at its source warehouse (reject, cancel).
create or replace function public.inv__release_transfer(p_transfer public.inv_transfers) returns void
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  for l in select item_id, qty from public.inv_transfer_lines where org_id = p_transfer.org_id and transfer_id = p_transfer.id order by item_id loop
    update public.inv_stock_balances b set reserved = b.reserved - l.qty
    where b.org_id = p_transfer.org_id and b.item_id = l.item_id and b.warehouse_id = p_transfer.from_warehouse_id;
  end loop;
end $$;

-- ---------------------------------------------------------------- public functions (called with the user's own login)

-- Request a transfer. Reserves the stock at the source; refuses an item whose storage condition does not match the destination.
create or replace function public.inv_submit_transfer(p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_reason text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id     uuid := gen_random_uuid();
  v_number text;
  r        record;
  b        record;
  it       public.inv_items%rowtype;
  wt       public.inv_warehouses%rowtype;
  v_names  text := '';
begin
  if p_from_warehouse_id is null or p_to_warehouse_id is null or p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'INVALID_INPUT' using detail = 'choose two different warehouses';
  end if;
  if not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_from_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown source warehouse';
  end if;
  select * into wt from public.inv_warehouses w where w.org_id = v_org and w.id = p_to_warehouse_id and w.deleted_at is null;
  if not found then raise exception 'INVALID_INPUT' using detail = 'unknown destination warehouse'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'add at least one line';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'INVALID_INPUT' using detail = 'the reason is too long'; end if;

  v_number := public.inv__next_transfer_number(v_org);
  insert into public.inv_transfers (id, org_id, number, requester_id, from_warehouse_id, to_warehouse_id, reason)
  values (v_id, v_org, v_number, auth.uid(), p_from_warehouse_id, p_to_warehouse_id, coalesce(trim(p_reason), ''));

  -- Same item twice is summed. Rows are locked in item order so two transfers cannot deadlock.
  for r in
    select (e ->> 'itemId')::uuid as item_id, sum((e ->> 'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'INVALID_INPUT' using detail = 'quantities must be above zero'; end if;
    select * into it from public.inv_items i where i.org_id = v_org and i.id = r.item_id and i.deleted_at is null;
    if not found then raise exception 'INVALID_INPUT' using detail = 'unknown item'; end if;
    if it.storage_condition_id is not null and wt.storage_condition_id is not null and it.storage_condition_id <> wt.storage_condition_id then
      raise exception 'STORAGE_MISMATCH' using detail = format('%s needs a different storage condition than the destination warehouse', it.sku);
    end if;
    select s.on_hand, s.reserved into b from public.inv_stock_balances s
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_from_warehouse_id for update;
    if not found or b.on_hand - b.reserved < r.qty then
      raise exception 'INSUFFICIENT_AVAILABLE' using detail = format('%s available, %s requested', coalesce(b.on_hand - b.reserved, 0), r.qty);
    end if;
    update public.inv_stock_balances s set reserved = s.reserved + r.qty
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_from_warehouse_id;
    insert into public.inv_transfer_lines (org_id, transfer_id, item_id, qty) values (v_org, v_id, r.item_id, r.qty);
    v_names := v_names || case when v_names = '' then '' else ', ' end || r.qty::text || ' x ' || it.name;
  end loop;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.transfer.submitted', 'stock_transfer', v_id::text,
          format('%s submitted: %s, %s to %s', v_number, v_names,
                 (select w.name from public.inv_warehouses w where w.org_id = v_org and w.id = p_from_warehouse_id), wt.name));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

-- Approve or reject. Owner or admin only, never the requester; the approval policy for the source warehouse decides how many approvals
-- are needed. The channel records where the decision came from; only the messaging webhook may record a channel other than 'app'.
create or replace function public.inv_decide_transfer(p_transfer_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid := public.inv__guard(array['owner', 'admin']);
  t          public.inv_transfers;
  v_total    numeric;
  v_required int;
  v_have     int;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then
    raise exception 'INVALID_INPUT';
  end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into t from public.inv_transfers x where x.org_id = v_org and x.id = p_transfer_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.requester_id = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if t.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('transfer is %s', t.status); end if;
  if p_decision = 'approved' and exists (select 1 from public.inv_transfer_approvals a where a.transfer_id = t.id and a.approver_id = auth.uid() and a.decision = 'approved') then
    raise exception 'INVALID_STATE' using detail = 'you already approved this transfer';
  end if;

  insert into public.inv_transfer_approvals (org_id, transfer_id, decision, approver_id, comment, channel)
  values (v_org, t.id, p_decision, auth.uid(), nullif(trim(p_comment), ''), p_channel);

  if p_decision = 'rejected' then
    update public.inv_transfers x set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = t.id;
    perform public.inv__release_transfer(t);
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.transfer.rejected', 'stock_transfer', t.id::text, format('%s rejected; reserved stock released', t.number), p_channel);
    return;
  end if;

  select coalesce(sum(l.qty), 0) into v_total from public.inv_transfer_lines l where l.org_id = v_org and l.transfer_id = t.id;
  v_required := public.inv__required_approvals(v_org, t.from_warehouse_id, v_total);
  select count(distinct a.approver_id) into v_have from public.inv_transfer_approvals a where a.transfer_id = t.id and a.decision = 'approved';

  if v_have >= v_required then
    update public.inv_transfers x set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = t.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.transfer.approved', 'stock_transfer', t.id::text,
            format('%s approved%s', t.number, case when v_required > 1 then format(' (%s of %s approvals)', v_have, v_required) else '' end), p_channel);
  else
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.transfer.approval_recorded', 'stock_transfer', t.id::text,
            format('%s: approval %s of %s recorded, still waiting', t.number, v_have, v_required), p_channel);
  end if;
end $$;

-- Dispatch an approved transfer: the stock leaves the source warehouse and is in transit. The batches taken (first expiry first
-- out; quarantined and expired batches are skipped by the ledger trigger) are recorded so the destination receives the same ones.
create or replace function public.inv_dispatch_transfer(p_transfer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.inv__guard(array['owner', 'admin', 'member']);
  t       public.inv_transfers;
  l       record;
  v_move  bigint;
  v_names text := '';
begin
  select * into t from public.inv_transfers x where x.org_id = v_org and x.id = p_transfer_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.status in ('dispatched', 'received') then raise exception 'INVALID_STATE' using detail = format('transfer is already %s', t.status); end if;
  if t.status <> 'approved' then raise exception 'APPROVAL_REQUIRED'; end if;

  for l in
    select ln.item_id, ln.qty, i.name from public.inv_transfer_lines ln join public.inv_items i on i.org_id = ln.org_id and i.id = ln.item_id
     where ln.org_id = v_org and ln.transfer_id = t.id order by ln.item_id
  loop
    perform 1 from public.inv_stock_balances s where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = t.from_warehouse_id for update;
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, transfer_id, ref, posted_by)
    values (v_org, l.item_id, t.from_warehouse_id, -l.qty, 'transfer_out', t.id, t.number, auth.uid())
    returning id into v_move;
    update public.inv_stock_balances s set on_hand = s.on_hand - l.qty, reserved = s.reserved - l.qty
    where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = t.from_warehouse_id;
    insert into public.inv_transfer_batches (org_id, transfer_id, item_id, batch_id, qty)
    select v_org, t.id, l.item_id, bm.batch_id, -sum(bm.qty)
      from public.inv_batch_moves bm where bm.org_id = v_org and bm.stock_move_id = v_move and bm.qty < 0 group by bm.batch_id;
    v_names := v_names || case when v_names = '' then '' else ', ' end || l.qty::text || ' x ' || l.name;
  end loop;

  update public.inv_transfers x set status = 'dispatched', dispatched_by = auth.uid(), dispatched_at = now() where x.id = t.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.transfer.dispatched', 'stock_transfer', t.id::text, format('%s dispatched, in transit: %s', t.number, v_names));
end $$;

-- Receive a dispatched transfer: the stock enters the destination warehouse, batch by batch with the same batch and expiry.
create or replace function public.inv_receive_transfer(p_transfer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.inv__guard(array['owner', 'admin', 'member']);
  t       public.inv_transfers;
  l       record;
  tb      record;
  v_names text := '';
begin
  select * into t from public.inv_transfers x where x.org_id = v_org and x.id = p_transfer_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.status <> 'dispatched' then raise exception 'INVALID_STATE' using detail = format('transfer is %s, only a dispatched transfer can be received', t.status); end if;

  for l in
    select ln.item_id, ln.qty, i.name from public.inv_transfer_lines ln join public.inv_items i on i.org_id = ln.org_id and i.id = ln.item_id
     where ln.org_id = v_org and ln.transfer_id = t.id order by ln.item_id
  loop
    if exists (select 1 from public.inv_transfer_batches b where b.org_id = v_org and b.transfer_id = t.id and b.item_id = l.item_id) then
      for tb in select b.batch_id, b.qty from public.inv_transfer_batches b where b.org_id = v_org and b.transfer_id = t.id and b.item_id = l.item_id order by b.batch_id loop
        perform set_config('erp.batch_id', tb.batch_id::text, true);
        insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, transfer_id, ref, posted_by)
        values (v_org, l.item_id, t.to_warehouse_id, tb.qty, 'transfer_in', t.id, t.number, auth.uid());
        perform set_config('erp.batch_id', '', true);
      end loop;
    else
      insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, transfer_id, ref, posted_by)
      values (v_org, l.item_id, t.to_warehouse_id, l.qty, 'transfer_in', t.id, t.number, auth.uid());
    end if;
    insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved) values (v_org, l.item_id, t.to_warehouse_id, l.qty, 0)
    on conflict (org_id, item_id, warehouse_id) do update set on_hand = public.inv_stock_balances.on_hand + excluded.on_hand;
    v_names := v_names || case when v_names = '' then '' else ', ' end || l.qty::text || ' x ' || l.name;
  end loop;

  update public.inv_transfers x set status = 'received', received_by = auth.uid(), received_at = now() where x.id = t.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.transfer.received', 'stock_transfer', t.id::text, format('%s received: %s', t.number, v_names));
end $$;

-- Cancel: the requester, or an owner or admin, before dispatch. Releases the reservation. After dispatch a wrong move is corrected
-- by a transfer back, so the ledger stays honest.
create or replace function public.inv_cancel_transfer(p_transfer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.inv__guard(array['owner', 'admin', 'member']);
  t      public.inv_transfers;
  v_role text;
begin
  select * into t from public.inv_transfers x where x.org_id = v_org and x.id = p_transfer_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if t.requester_id <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if t.status not in ('submitted', 'approved') then raise exception 'INVALID_STATE' using detail = format('transfer is %s', t.status); end if;
  update public.inv_transfers x set status = 'cancelled' where x.id = t.id;
  perform public.inv__release_transfer(t);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.transfer.cancelled', 'stock_transfer', t.id::text, format('%s cancelled; reserved stock released', t.number));
end $$;

-- Stock in transit: dispatched and not yet received, per item. It belongs to no warehouse, so nobody can sell it meanwhile.
create or replace function public.inv_in_transit() returns table (item_id uuid, sku text, name text, uom text, qty numeric, transfers int)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']);
begin
  return query
    select l.item_id, i.sku, i.name, i.uom, sum(l.qty), count(distinct t.id)::int
      from public.inv_transfers t
      join public.inv_transfer_lines l on l.org_id = t.org_id and l.transfer_id = t.id
      join public.inv_items i on i.org_id = l.org_id and i.id = l.item_id
     where t.org_id = v_org and t.status = 'dispatched'
     group by l.item_id, i.sku, i.name, i.uom
     order by i.sku;
end $$;

revoke all on function public.inv_transfers_guard() from public, anon, authenticated;
revoke all on function public.inv_transfers_notify() from public, anon, authenticated;
revoke all on function public.inv_stock_moves_guard() from public, anon, authenticated;
revoke all on function public.inv__next_transfer_number(uuid) from public, anon, authenticated;
revoke all on function public.inv__release_transfer(public.inv_transfers) from public, anon, authenticated;
revoke all on function public.inv_submit_transfer(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.inv_decide_transfer(uuid, text, text, text) from public, anon;
revoke all on function public.inv_dispatch_transfer(uuid) from public, anon;
revoke all on function public.inv_receive_transfer(uuid) from public, anon;
revoke all on function public.inv_cancel_transfer(uuid) from public, anon;
revoke all on function public.inv_in_transit() from public, anon;
grant execute on function public.inv_submit_transfer(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.inv_decide_transfer(uuid, text, text, text) to authenticated;
grant execute on function public.inv_dispatch_transfer(uuid) to authenticated;
grant execute on function public.inv_receive_transfer(uuid) to authenticated;
grant execute on function public.inv_cancel_transfer(uuid) to authenticated;
grant execute on function public.inv_in_transit() to authenticated;

commit;

-- Verification (read-only): expect true x6 for the first six columns, false x2 for the helpers.
select has_function_privilege('authenticated', 'public.inv_submit_transfer(uuid,uuid,text,jsonb)', 'execute') as submit,
       has_function_privilege('authenticated', 'public.inv_decide_transfer(uuid,text,text,text)', 'execute') as decide,
       has_function_privilege('authenticated', 'public.inv_dispatch_transfer(uuid)', 'execute') as dispatch,
       has_function_privilege('authenticated', 'public.inv_receive_transfer(uuid)', 'execute') as receive,
       has_function_privilege('authenticated', 'public.inv_cancel_transfer(uuid)', 'execute') as cancel,
       has_function_privilege('authenticated', 'public.inv_in_transit()', 'execute') as in_transit,
       has_function_privilege('authenticated', 'public.inv__next_transfer_number(uuid)', 'execute') as helper_number,
       has_function_privilege('authenticated', 'public.inv__release_transfer(public.inv_transfers)', 'execute') as helper_release;
