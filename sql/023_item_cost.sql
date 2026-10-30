-- 023_item_cost.sql
-- Slice F, part 1 (documentation/plans/OWNER_INSIGHTS_PLAN.md section 4): cost per item.
-- Method: weighted AVERAGE cost per item (Ben's question 1 default). Every purchase receipt updates the average; every
-- issue/adjustment move remembers the average at that moment (so cost of goods sold can be summed later). Opening stock has
-- no cost until an owner/admin sets it (inv_set_item_cost). Money is integer minor units in the organization's currency.
-- Cost is sensitive: the cost columns are hidden from members/viewers by column privileges; only owner/admin read it,
-- through inv_item_costs(). Depends on sql/001-022. Rerun-safe. Then run sql/tests/019_item_cost.sql.
--
-- NOTE for future migrations: inv_items and inv_stock_moves now use COLUMN grants. A new column must be granted to
-- `authenticated` explicitly (grant select (new_col) on ...) or the API cannot read it.

begin;

alter table public.inv_items add column if not exists avg_cost_minor bigint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inv_items_avg_cost_nonneg') then
    alter table public.inv_items add constraint inv_items_avg_cost_nonneg check (avg_cost_minor >= 0);
  end if;
end $$;
alter table public.inv_stock_moves add column if not exists unit_cost_minor bigint;

-- Append-only history of every cost change: what the average was before and after, and why.
create table if not exists public.inv_cost_log (
  id               bigint generated always as identity primary key,
  org_id           uuid not null references public.organizations(id),
  item_id          uuid not null,
  source           text not null check (source in ('purchase_receipt', 'manual')),
  ref              text,
  qty              numeric(18,3),
  unit_cost_minor  bigint not null check (unit_cost_minor >= 0),
  avg_before_minor bigint not null,
  avg_after_minor  bigint not null,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  foreign key (org_id, item_id) references public.inv_items(org_id, id)
);
create index if not exists inv_cost_log_org_item_idx on public.inv_cost_log(org_id, item_id, id desc);
alter table public.inv_cost_log enable row level security;
revoke all on public.inv_cost_log from anon, authenticated;

create or replace function public.inv_cost_log_guard() returns trigger
language plpgsql set search_path = public as $$
begin raise exception 'APPEND_ONLY'; end $$;
drop trigger if exists inv_cost_log_no_change on public.inv_cost_log;
create trigger inv_cost_log_no_change before update or delete on public.inv_cost_log for each row execute function public.inv_cost_log_guard();

-- Every issue/adjustment move remembers the average cost at that moment.
create or replace function public.inv_stock_moves_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('issue', 'adjust') and new.unit_cost_minor is null then
    select i.avg_cost_minor into new.unit_cost_minor from public.inv_items i where i.org_id = new.org_id and i.id = new.item_id;
  end if;
  return new;
end $$;
drop trigger if exists inv_stock_moves_cost on public.inv_stock_moves;
create trigger inv_stock_moves_cost before insert on public.inv_stock_moves for each row execute function public.inv_stock_moves_cost();

-- Called right AFTER a receipt has been posted: average = (stock before x average + received x unit cost) / (stock before + received).
create or replace function public.inv__apply_cost(p_org uuid, p_item uuid, p_qty numeric, p_unit_cost bigint, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric; v_prev numeric; v_avg bigint; v_new bigint;
begin
  select coalesce(sum(on_hand), 0) into v_total from public.inv_stock_balances where org_id = p_org and item_id = p_item;
  v_prev := greatest(v_total - p_qty, 0);
  select avg_cost_minor into v_avg from public.inv_items where org_id = p_org and id = p_item for update;
  v_new := round((v_prev * v_avg + p_qty * p_unit_cost) / nullif(v_prev + p_qty, 0));
  update public.inv_items set avg_cost_minor = coalesce(v_new, p_unit_cost) where org_id = p_org and id = p_item;
  insert into public.inv_cost_log (org_id, item_id, source, ref, qty, unit_cost_minor, avg_before_minor, avg_after_minor, created_by)
  values (p_org, p_item, 'purchase_receipt', p_ref, p_qty, p_unit_cost, v_avg, coalesce(v_new, p_unit_cost), auth.uid());
end $$;
revoke all on function public.inv__apply_cost(uuid, uuid, numeric, bigint, text) from public, anon, authenticated;

-- Purchase receipts now also update the item's average cost (same function as sql/017 plus the cost step).
create or replace function public.pur_receive_order(p_order_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin','member']); v_order public.pur_orders%rowtype; l record;
begin
  select * into v_order from public.pur_orders where org_id=v_org and id=p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if; if v_order.status <> 'ordered' then raise exception 'INVALID_STATE'; end if;
  for l in select item_id,qty,unit_cost_minor from public.pur_order_lines where org_id=v_org and order_id=v_order.id order by item_id loop
    perform public.inv__receipt(v_org,l.item_id,v_order.warehouse_id,l.qty,v_order.number);
    perform public.inv__apply_cost(v_org,l.item_id,l.qty,l.unit_cost_minor,v_order.number);
  end loop;
  update public.pur_orders set status='received',received_by=auth.uid(),received_at=now() where id=v_order.id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.received','purchase_order',v_order.id::text,format('%s received into stock',v_order.number));
end $$;

-- Owner/admin sets an item's cost by hand (opening stock, a correction). Audited and logged.
create or replace function public.inv_set_item_cost(p_item_id uuid, p_unit_cost_minor bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  v_old bigint; v_sku text;
begin
  if p_unit_cost_minor is null or p_unit_cost_minor < 0 then raise exception 'INVALID_INPUT'; end if;
  select avg_cost_minor, sku into v_old, v_sku from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.inv_items set avg_cost_minor = p_unit_cost_minor where org_id = v_org and id = p_item_id;
  insert into public.inv_cost_log (org_id, item_id, source, ref, unit_cost_minor, avg_before_minor, avg_after_minor, created_by)
  values (v_org, p_item_id, 'manual', 'manual', p_unit_cost_minor, v_old, p_unit_cost_minor, auth.uid());
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.item.cost_set', 'item', p_item_id::text, format('Cost of %s set from %s to %s minor units', v_sku, v_old, p_unit_cost_minor));
end $$;

-- Costs and stock value, for owner/admin only. Value = on hand (all warehouses) x average cost.
create or replace function public.inv_item_costs() returns table (item_id uuid, sku text, name text, avg_cost_minor bigint, on_hand numeric, value_minor bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']);
begin
  return query
    select i.id, i.sku, i.name, i.avg_cost_minor, coalesce(sum(b.on_hand), 0), round(coalesce(sum(b.on_hand), 0) * i.avg_cost_minor)::bigint
      from public.inv_items i
      left join public.inv_stock_balances b on b.org_id = i.org_id and b.item_id = i.id
     where i.org_id = v_org and i.deleted_at is null
     group by i.id
     order by i.sku;
end $$;

revoke all on function public.inv_set_item_cost(uuid, bigint), public.inv_item_costs() from public, anon;
grant execute on function public.inv_set_item_cost(uuid, bigint), public.inv_item_costs() to authenticated;

-- Hide the cost columns from members and viewers: table-wide SELECT becomes column SELECT without them.
do $$
declare cols_items text; cols_moves text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position) into cols_items from information_schema.columns
   where table_schema = 'public' and table_name = 'inv_items' and column_name <> 'avg_cost_minor';
  select string_agg(format('%I', column_name), ', ' order by ordinal_position) into cols_moves from information_schema.columns
   where table_schema = 'public' and table_name = 'inv_stock_moves' and column_name <> 'unit_cost_minor';
  execute 'revoke select on public.inv_items from authenticated';
  execute 'revoke select on public.inv_stock_moves from authenticated';
  execute format('grant select (%s) on public.inv_items to authenticated', cols_items);
  execute format('grant select (%s) on public.inv_stock_moves to authenticated', cols_moves);
end $$;

commit;

-- Verification (read-only): members cannot read the cost columns (expect false, false), the functions are callable (true).
select has_column_privilege('authenticated', 'public.inv_items', 'avg_cost_minor', 'select') as items_cost_visible,
       has_column_privilege('authenticated', 'public.inv_stock_moves', 'unit_cost_minor', 'select') as moves_cost_visible,
       has_function_privilege('authenticated', 'public.inv_item_costs()', 'execute') as costs_fn;
