-- 017_purchasing_core.sql
-- Purchasing slice 1: suppliers, purchase orders and receipt into the inventory ledger.
-- Depends on 001-016. All signed-in writes use the functions below; each writes its audit row atomically.

begin;

create table if not exists public.pur_suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 200),
  contact text, city text, phone text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (org_id, id)
);
create unique index if not exists pur_suppliers_org_name_active_uq on public.pur_suppliers (org_id, lower(name)) where deleted_at is null;

create table if not exists public.pur_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  number text not null, supplier_id uuid not null, warehouse_id uuid not null,
  status text not null default 'ordered' check (status in ('ordered', 'received', 'cancelled')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id), received_by uuid references auth.users(id), received_at timestamptz,
  cancelled_by uuid references auth.users(id), cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (org_id, id), unique (org_id, number),
  foreign key (org_id, supplier_id) references public.pur_suppliers(org_id, id),
  foreign key (org_id, warehouse_id) references public.inv_warehouses(org_id, id),
  constraint pur_orders_received_when_received check (status <> 'received' or (received_by is not null and received_at is not null)),
  constraint pur_orders_cancelled_when_cancelled check (status <> 'cancelled' or (cancelled_by is not null and cancelled_at is not null))
);

create table if not exists public.pur_order_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  order_id uuid not null, item_id uuid not null, qty numeric(18,3) not null check (qty > 0),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (order_id, item_id),
  foreign key (org_id, order_id) references public.pur_orders(org_id, id),
  foreign key (org_id, item_id) references public.inv_items(org_id, id)
);
create index if not exists pur_orders_org_status_idx on public.pur_orders(org_id, status, created_at desc);
create index if not exists pur_order_lines_org_order_idx on public.pur_order_lines(org_id, order_id);

drop trigger if exists pur_suppliers_updated_at on public.pur_suppliers;
create trigger pur_suppliers_updated_at before update on public.pur_suppliers for each row execute function public.set_updated_at();
drop trigger if exists pur_orders_updated_at on public.pur_orders;
create trigger pur_orders_updated_at before update on public.pur_orders for each row execute function public.set_updated_at();
drop trigger if exists pur_order_lines_updated_at on public.pur_order_lines;
create trigger pur_order_lines_updated_at before update on public.pur_order_lines for each row execute function public.set_updated_at();

create or replace function public.pur_orders_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.number <> old.number or new.supplier_id <> old.supplier_id or new.warehouse_id <> old.warehouse_id or new.currency <> old.currency or new.created_by <> old.created_by then raise exception 'INVALID_STATE'; end if;
  if new.status <> old.status and not (old.status = 'ordered' and new.status in ('received', 'cancelled')) then raise exception 'INVALID_STATE'; end if;
  return new;
end $$;
drop trigger if exists pur_orders_guard on public.pur_orders;
create trigger pur_orders_guard before update on public.pur_orders for each row execute function public.pur_orders_guard();

alter table public.pur_suppliers enable row level security;
alter table public.pur_orders enable row level security;
alter table public.pur_order_lines enable row level security;
revoke all on public.pur_suppliers, public.pur_orders, public.pur_order_lines from anon, authenticated;
grant select on public.pur_suppliers, public.pur_orders, public.pur_order_lines to authenticated;
drop policy if exists pur_suppliers_member_read on public.pur_suppliers;
create policy pur_suppliers_member_read on public.pur_suppliers for select to authenticated using (public.is_org_member(org_id));
drop policy if exists pur_orders_member_read on public.pur_orders;
create policy pur_orders_member_read on public.pur_orders for select to authenticated using (public.is_org_member(org_id));
drop policy if exists pur_order_lines_member_read on public.pur_order_lines;
create policy pur_order_lines_member_read on public.pur_order_lines for select to authenticated using (public.is_org_member(org_id));

create or replace function public.pur__guard(p_roles text[]) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(p_roles);
begin
  if not exists (select 1 from public.org_modules where org_id = v_org and module_key = 'purchasing' and disabled_at is null) then raise exception 'MODULE_DISABLED'; end if;
  return v_org;
end $$;
create or replace function public.pur__next_number(p_org uuid) returns text language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.inv_counters(org_id,key,value) values (p_org,'purchase_order',1)
  on conflict (org_id,key) do update set value = public.inv_counters.value + 1 returning value into v;
  return 'PO-' || lpad(v::text, 4, '0');
end $$;

create or replace function public.pur_create_supplier(p_name text, p_contact text default null, p_city text default null, p_phone text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin']); v_id uuid;
begin
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'INVALID_INPUT'; end if;
  insert into public.pur_suppliers(org_id,name,contact,city,phone) values(v_org,trim(p_name),nullif(trim(p_contact),''),nullif(trim(p_city),''),nullif(trim(p_phone),'')) returning id into v_id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.supplier.created','supplier',v_id::text,trim(p_name));
  return v_id;
end $$;

create or replace function public.pur_create_order(p_supplier_id uuid, p_warehouse_id uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin']); v_id uuid; v_number text; v_currency char(3); v_line jsonb; v_item uuid; v_qty numeric; v_cost bigint; v_count int := 0;
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
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.created','purchase_order',v_id::text,format('%s created with %s line(s)',v_number,v_count));
  return jsonb_build_object('id',v_id,'number',v_number);
end $$;

create or replace function public.pur_receive_order(p_order_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin','member']); v_order public.pur_orders%rowtype; l record;
begin
  select * into v_order from public.pur_orders where org_id=v_org and id=p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if; if v_order.status <> 'ordered' then raise exception 'INVALID_STATE'; end if;
  for l in select item_id,qty from public.pur_order_lines where org_id=v_org and order_id=v_order.id order by item_id loop perform public.inv__receipt(v_org,l.item_id,v_order.warehouse_id,l.qty,v_order.number); end loop;
  update public.pur_orders set status='received',received_by=auth.uid(),received_at=now() where id=v_order.id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.received','purchase_order',v_order.id::text,format('%s received into stock',v_order.number));
end $$;

create or replace function public.pur_cancel_order(p_order_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin']); v_order public.pur_orders%rowtype;
begin
  select * into v_order from public.pur_orders where org_id=v_org and id=p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if; if v_order.status <> 'ordered' then raise exception 'INVALID_STATE'; end if;
  update public.pur_orders set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now() where id=v_order.id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.cancelled','purchase_order',v_order.id::text,format('%s cancelled',v_order.number));
end $$;

revoke all on function public.pur__guard(text[]), public.pur__next_number(uuid), public.pur_orders_guard() from public, anon, authenticated;
revoke all on function public.pur_create_supplier(text,text,text,text), public.pur_create_order(uuid,uuid,jsonb), public.pur_receive_order(uuid), public.pur_cancel_order(uuid) from public, anon;
grant execute on function public.pur_create_supplier(text,text,text,text), public.pur_create_order(uuid,uuid,jsonb), public.pur_receive_order(uuid), public.pur_cancel_order(uuid) to authenticated;
commit;

-- Read-only verification: expect three RLS tables and no direct non-SELECT privileges for signed-in users.
select relname from pg_class where relnamespace='public'::regnamespace and relname in ('pur_suppliers','pur_orders','pur_order_lines') and relrowsecurity order by relname;
select table_name, privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public' and table_name like 'pur_%' and privilege_type <> 'SELECT' order by table_name, privilege_type;
