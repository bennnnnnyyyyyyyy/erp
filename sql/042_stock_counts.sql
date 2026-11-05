-- 042_stock_counts.sql
-- S3 of documentation/plans/SUPERFIX_WORKFLOW_PLAN.md: a stock count session for a whole warehouse (or chosen items).
--   counting  -> lines hold the expected quantity SNAPSHOT taken when the count started; people enter counted quantities
--   submitted -> every line counted; managers are asked to approve
--   approved  -> (inside the decision) one 'adjust' move per line with a difference, difference = counted - snapshot (decision D4:
--                movements during the count are kept), then
--   applied   -- or rejected / cancelled.
-- The approval control is in the data, as for adjustments: the decider is never the person who started or submitted the count, and
-- the ledger guard refuses an 'adjust' move unless its count is 'approved'. Every move writes its own audit row in the same transaction.
-- v1 counts per item and warehouse, like single adjustments. Batch-tracked items follow the existing batch rules (a positive
-- difference goes to the UNBATCHED batch, a negative one is taken first-expiry-first-out); per-batch counting is a later step.
-- Depends on sql/001-041. Rerun-safe. Run the whole file, then sql/tests/037_stock_counts.sql.

begin;

create table if not exists public.inv_counts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  number           text not null,
  warehouse_id     uuid not null,
  note             text check (note is null or length(note) <= 500),
  status           text not null default 'counting' check (status in ('counting', 'submitted', 'approved', 'applied', 'rejected', 'cancelled')),
  requester_id     uuid not null references auth.users(id),
  submitted_by     uuid references auth.users(id),
  submitted_at     timestamptz,
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id),
  constraint inv_counts_decider_not_requester check (decided_by is null or (decided_by <> requester_id and decided_by is distinct from submitted_by)),
  constraint inv_counts_decided_when_approved check (status not in ('approved', 'applied') or decided_by is not null),
  constraint inv_counts_submitted_has_submitter check (status in ('counting', 'cancelled') or submitted_by is not null)
);

create table if not exists public.inv_count_lines (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  count_id     uuid not null,
  item_id      uuid not null,
  expected_qty numeric(18, 3) not null check (expected_qty >= 0),
  counted_qty  numeric(18, 3) check (counted_qty is null or counted_qty >= 0),
  counted_by   uuid references auth.users(id),
  counted_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (count_id, item_id),
  foreign key (org_id, count_id) references public.inv_counts (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);
create index if not exists inv_count_lines_count_idx on public.inv_count_lines (org_id, count_id);

alter table public.inv_counts enable row level security;
alter table public.inv_count_lines enable row level security;
revoke all on public.inv_counts, public.inv_count_lines from anon, authenticated;
grant select on public.inv_counts, public.inv_count_lines to authenticated;
drop policy if exists inv_counts_member_read on public.inv_counts;
create policy inv_counts_member_read on public.inv_counts for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_count_lines_member_read on public.inv_count_lines;
create policy inv_count_lines_member_read on public.inv_count_lines for select to authenticated using (public.is_org_member(org_id));

drop trigger if exists inv_counts_updated_at on public.inv_counts;
create trigger inv_counts_updated_at before update on public.inv_counts for each row execute function public.set_updated_at();

-- What may change on a count, and in which order the statuses may go.
create or replace function public.inv_counts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.requester_id <> old.requester_id or new.number <> old.number or new.warehouse_id <> old.warehouse_id then
    raise exception 'INVALID_STATE' using detail = 'a count cannot be moved to another warehouse or renumbered';
  end if;
  if new.status <> old.status and not (
       (old.status = 'counting' and new.status in ('submitted', 'cancelled'))
    or (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled'))
    or (old.status = 'approved' and new.status = 'applied')
  ) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;
drop trigger if exists inv_counts_guard on public.inv_counts;
create trigger inv_counts_guard before update on public.inv_counts for each row execute function public.inv_counts_guard();

-- Lines change only while their count is being counted (the functions check too; this holds even for direct writes as table owner).
create or replace function public.inv_count_lines_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_status text;
begin
  if tg_op = 'DELETE' then raise exception 'INVALID_STATE' using detail = 'count lines are never deleted'; end if;
  select c.status into v_status from public.inv_counts c where c.org_id = new.org_id and c.id = new.count_id;
  if v_status is distinct from 'counting' then raise exception 'INVALID_STATE' using detail = format('the count is %s', coalesce(v_status, 'missing')); end if;
  if tg_op = 'UPDATE' and (new.expected_qty <> old.expected_qty or new.item_id <> old.item_id or new.count_id <> old.count_id) then
    raise exception 'INVALID_STATE' using detail = 'the expected quantity is a snapshot and cannot change';
  end if;
  return new;
end $$;
drop trigger if exists inv_count_lines_guard on public.inv_count_lines;
create trigger inv_count_lines_guard before insert or update or delete on public.inv_count_lines for each row execute function public.inv_count_lines_guard();

-- The ledger: an 'adjust' move now names either an adjustment or a count (same rules otherwise as sql/033).
alter table public.inv_stock_moves add column if not exists count_id uuid;
alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_count_fk;
alter table public.inv_stock_moves add constraint inv_stock_moves_count_fk foreign key (org_id, count_id) references public.inv_counts (org_id, id);
alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_check;
alter table public.inv_stock_moves add constraint inv_stock_moves_check check (
  (kind = 'receipt' and qty > 0)
  or (kind = 'issue' and qty < 0 and request_id is not null)
  or (kind = 'adjust' and qty <> 0 and ((adjustment_id is not null)::int + (count_id is not null)::int) = 1)
  or (kind = 'transfer_out' and qty < 0 and transfer_id is not null)
  or (kind = 'transfer_in' and qty > 0 and transfer_id is not null)
);

-- sql/033's guard plus: an 'adjust' move for a count needs the count to be 'approved'.
create or replace function public.inv_stock_moves_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if new.kind = 'issue' then
    select r.status into v_status from public.inv_requests r where r.org_id = new.org_id and r.id = new.request_id;
    if v_status is distinct from 'approved' then raise exception 'APPROVAL_REQUIRED'; end if;
  elsif new.kind = 'adjust' and new.count_id is not null then
    select c.status into v_status from public.inv_counts c where c.org_id = new.org_id and c.id = new.count_id;
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

create or replace function public.inv__next_count_number(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.inv_counters (org_id, key, value) values (p_org, 'count', 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v;
  return 'CNT-' || lpad(v::text, 4, '0');
end $$;

-- Start a count. p_item_ids null = every item that has a stock row in the warehouse. The expected quantity is snapshotted now.
create or replace function public.inv_start_count(p_warehouse_id uuid, p_item_ids uuid[] default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id uuid := gen_random_uuid(); v_number text; v_n int;
begin
  if not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown warehouse';
  end if;
  if p_item_ids is not null and exists (
       select 1 from unnest(p_item_ids) x(id)
        where not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = x.id and i.deleted_at is null)) then
    raise exception 'INVALID_INPUT' using detail = 'unknown item';
  end if;
  v_number := public.inv__next_count_number(v_org);
  insert into public.inv_counts (id, org_id, number, warehouse_id, note, requester_id)
  values (v_id, v_org, v_number, p_warehouse_id, nullif(trim(p_note), ''), auth.uid());
  insert into public.inv_count_lines (org_id, count_id, item_id, expected_qty)
  select v_org, v_id, it.id, coalesce(b.on_hand, 0)
    from public.inv_items it
    left join public.inv_stock_balances b on b.org_id = it.org_id and b.item_id = it.id and b.warehouse_id = p_warehouse_id
   where it.org_id = v_org and it.deleted_at is null
     and (case when p_item_ids is null then b.item_id is not null else it.id = any (p_item_ids) end);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'INVALID_INPUT' using detail = 'nothing to count in this warehouse'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.count.started', 'stock_count', v_id::text, format('%s started: %s item(s), expected quantities snapshotted', v_number, v_n));
  return jsonb_build_object('id', v_id, 'number', v_number, 'lines', v_n);
end $$;

-- Enter (or clear, with null) a counted quantity. An item not yet on the count is added with its snapshot taken now.
create or replace function public.inv_set_count_line(p_count_id uuid, p_item_id uuid, p_counted_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']); c public.inv_counts;
begin
  if p_counted_qty is not null and p_counted_qty < 0 then raise exception 'INVALID_INPUT' using detail = 'a count cannot be negative'; end if;
  select * into c from public.inv_counts x where x.org_id = v_org and x.id = p_count_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.status <> 'counting' then raise exception 'INVALID_STATE' using detail = format('the count is %s', c.status); end if;
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown item';
  end if;
  insert into public.inv_count_lines (org_id, count_id, item_id, expected_qty, counted_qty, counted_by, counted_at)
  select v_org, c.id, p_item_id, coalesce((select b.on_hand from public.inv_stock_balances b where b.org_id = v_org and b.item_id = p_item_id and b.warehouse_id = c.warehouse_id), 0),
         p_counted_qty, case when p_counted_qty is null then null else auth.uid() end, case when p_counted_qty is null then null else now() end
  on conflict (count_id, item_id) do update
    set counted_qty = excluded.counted_qty, counted_by = excluded.counted_by, counted_at = excluded.counted_at;
end $$;

create or replace function public.inv_submit_count(p_count_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']); c public.inv_counts; v_open int; v_diff int;
begin
  select * into c from public.inv_counts x where x.org_id = v_org and x.id = p_count_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.status <> 'counting' then raise exception 'INVALID_STATE' using detail = format('the count is %s', c.status); end if;
  select count(*) filter (where counted_qty is null), count(*) filter (where counted_qty is not null and counted_qty <> expected_qty)
    into v_open, v_diff from public.inv_count_lines l where l.org_id = v_org and l.count_id = c.id;
  if v_open > 0 then raise exception 'COUNT_INCOMPLETE' using detail = format('%s line(s) not counted', v_open); end if;
  update public.inv_counts x set status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where x.id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.count.submitted', 'stock_count', c.id::text, format('%s submitted for approval: %s line(s) differ from the snapshot', c.number, v_diff));
  return jsonb_build_object('id', c.id, 'number', c.number, 'differences', v_diff);
end $$;

-- Approve or reject. Approve posts one 'adjust' move per differing line, difference = counted - snapshot, applied to current stock.
create or replace function public.inv_decide_count(p_count_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  c public.inv_counts; l record; b public.inv_stock_balances; v_delta numeric; v_moves int := 0;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then raise exception 'INVALID_INPUT'; end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into c from public.inv_counts x where x.org_id = v_org and x.id = p_count_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.requester_id = auth.uid() or c.submitted_by = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if c.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('the count is %s', c.status); end if;

  if p_decision = 'rejected' then
    update public.inv_counts x set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = c.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.count.rejected', 'stock_count', c.id::text, format('%s rejected; stock unchanged', c.number), p_channel);
    return jsonb_build_object('id', c.id, 'status', 'rejected', 'moves', 0);
  end if;

  update public.inv_counts x set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = c.id;
  for l in select * from public.inv_count_lines x where x.org_id = v_org and x.count_id = c.id and x.counted_qty <> x.expected_qty order by x.item_id loop
    v_delta := l.counted_qty - l.expected_qty;
    select * into b from public.inv_stock_balances s where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = c.warehouse_id for update;
    if coalesce(b.on_hand, 0) + v_delta < coalesce(b.reserved, 0) then
      raise exception 'INVALID_STATE' using detail = format('item %s: applying %s to %s on hand would go below the %s reserved', l.item_id, v_delta, coalesce(b.on_hand, 0), coalesce(b.reserved, 0));
    end if;
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, count_id, ref, posted_by)
    values (v_org, l.item_id, c.warehouse_id, v_delta, 'adjust', c.id, c.number, auth.uid());
    -- Update the existing balance row; insert only when there is none (then the snapshot was 0, so the difference is positive).
    -- Not "insert ... on conflict": the not-negative check would fire on the proposed insert before the conflict clause (as in sql/026).
    if b.item_id is not null then
      update public.inv_stock_balances s set on_hand = s.on_hand + v_delta, updated_at = now()
       where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = c.warehouse_id;
    else
      insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved) values (v_org, l.item_id, c.warehouse_id, v_delta, 0);
    end if;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel, metadata)
    values (v_org, auth.uid(), 'inventory.count.line_posted', 'stock_count', c.id::text,
            format('%s: item adjusted by %s (snapshot %s, counted %s)', c.number, v_delta, l.expected_qty, l.counted_qty), p_channel,
            jsonb_build_object('item_id', l.item_id, 'delta', v_delta));
    v_moves := v_moves + 1;
  end loop;
  update public.inv_counts x set status = 'applied' where x.id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), 'inventory.count.applied', 'stock_count', c.id::text, format('%s approved and applied: %s stock move(s)', c.number, v_moves), p_channel);
  return jsonb_build_object('id', c.id, 'status', 'applied', 'moves', v_moves);
end $$;

-- Cancel while counting or waiting for approval: the person who started it, or an owner or admin.
create or replace function public.inv_cancel_count(p_count_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']); c public.inv_counts;
begin
  select * into c from public.inv_counts x where x.org_id = v_org and x.id = p_count_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.requester_id <> auth.uid() and public.core__my_role(v_org) not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if c.status not in ('counting', 'submitted') then raise exception 'INVALID_STATE' using detail = format('the count is %s', c.status); end if;
  update public.inv_counts x set status = 'cancelled', decision_comment = nullif(trim(p_reason), '') where x.id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.count.cancelled', 'stock_count', c.id::text, format('%s cancelled%s', c.number, coalesce(': ' || nullif(trim(p_reason), ''), '')));
end $$;

-- Ask managers when a count is submitted; tell the person who started it about the decision.
create or replace function public.inv_counts_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if new.status = 'submitted' and old.status = 'counting' then
    for m in select u.user_id from public.msg__managers(new.org_id) u where u.user_id <> new.requester_id and u.user_id is distinct from new.submitted_by loop
      perform public.msg__enqueue(new.org_id, m.user_id, 'approval_request', format('%s: stock count needs your approval', new.number), coalesce(new.note, ''),
        'stock_count', new.id, format('count:%s:submitted:%s', new.id, m.user_id));
    end loop;
  elsif new.status <> old.status and new.status in ('applied', 'rejected') then
    perform public.msg__enqueue(new.org_id, new.requester_id, 'decision', format('%s was %s', new.number, new.status), coalesce(new.decision_comment, ''),
      'stock_count', new.id, format('count:%s:decision', new.id));
  end if;
  return null;
end $$;
drop trigger if exists inv_counts_notify on public.inv_counts;
create trigger inv_counts_notify after update of status on public.inv_counts for each row execute function public.inv_counts_notify();

revoke all on function public.inv_counts_guard(), public.inv_count_lines_guard(), public.inv_counts_notify(), public.inv__next_count_number(uuid),
  public.inv_stock_moves_guard() from public, anon, authenticated;
revoke all on function public.inv_start_count(uuid, uuid[], text), public.inv_set_count_line(uuid, uuid, numeric), public.inv_submit_count(uuid),
  public.inv_decide_count(uuid, text, text, text), public.inv_cancel_count(uuid, text) from public, anon;
grant execute on function public.inv_start_count(uuid, uuid[], text), public.inv_set_count_line(uuid, uuid, numeric), public.inv_submit_count(uuid),
  public.inv_decide_count(uuid, text, text, text), public.inv_cancel_count(uuid, text) to authenticated;

commit;

-- Verification (read-only): RLS on both tables; no write grants to users; functions open to signed-in users only.
select relname, relrowsecurity from pg_class where relname in ('inv_counts', 'inv_count_lines') order by relname;
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name in ('inv_counts', 'inv_count_lines') and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select has_function_privilege('authenticated', 'public.inv_decide_count(uuid, text, text, text)', 'execute') as users_can_decide,
       has_function_privilege('anon', 'public.inv_decide_count(uuid, text, text, text)', 'execute') as anon_can_decide;
