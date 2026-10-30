-- 026_batches_expiry_storage.sql
-- Slice B of documentation/plans/OWNER_INSIGHTS_PLAN.md section 8: batches (lots) with expiry dates, quarantine, first-expiry-
-- first-out issuing, and storage conditions (ambient, cool, cold...) that must match between an item and a warehouse.
-- Number 026 because 025 belongs to the security-audit branch.
--
-- How it works: an item is "batch tracked" only if an owner/admin switches that on (nothing changes for other items).
-- For a tracked item every stock move is mirrored to batches by a trigger on the ledger:
--   receipt  -> into the batch named by inv_receive_batch, else into a batch called UNBATCHED (no expiry);
--   issue / negative adjustment -> taken first-expiry-first-out from batches that are available (not quarantined) and not
--     expired; UNBATCHED last; if those do not cover the quantity the whole issue is refused with BATCH_STOCK_SHORT;
--   positive adjustment -> UNBATCHED.
-- Storage conditions are organization data (name + temperature range), not hard-coded. Receiving a batch into a warehouse whose
-- condition differs from the item's condition is refused (STORAGE_MISMATCH). Where either side has no condition set, no check.
-- Not covered yet: temperature sensor logs; transfers between warehouses (none exist yet); batch choice by the approver.
-- Depends on sql/001-024. Rerun-safe. Then run sql/tests/022_batches_expiry_storage.sql.

begin;

create table if not exists public.inv_storage_conditions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  name        text not null check (length(trim(name)) between 1 and 80),
  min_temp_c  numeric(5,1),
  max_temp_c  numeric(5,1),
  created_at  timestamptz not null default now(),
  unique (org_id, id),
  check (min_temp_c is null or max_temp_c is null or min_temp_c <= max_temp_c)
);
create unique index if not exists inv_storage_conditions_org_name_uq on public.inv_storage_conditions(org_id, lower(name));

alter table public.inv_warehouses add column if not exists storage_condition_id uuid;
alter table public.inv_items add column if not exists tracks_batches boolean not null default false;
alter table public.inv_items add column if not exists storage_condition_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inv_warehouses_storage_fk') then
    alter table public.inv_warehouses add constraint inv_warehouses_storage_fk foreign key (org_id, storage_condition_id) references public.inv_storage_conditions(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inv_items_storage_fk') then
    alter table public.inv_items add constraint inv_items_storage_fk foreign key (org_id, storage_condition_id) references public.inv_storage_conditions(org_id, id);
  end if;
end $$;
-- inv_items has column-level grants since sql/023: new columns must be granted explicitly.
grant select (tracks_batches, storage_condition_id) on public.inv_items to authenticated;

create table if not exists public.inv_batches (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  item_id      uuid not null,
  batch_no     text not null check (length(trim(batch_no)) between 1 and 60),
  mfg_date     date,
  expiry_date  date,
  supplier_id  uuid,
  status       text not null default 'available' check (status in ('available', 'quarantined')),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, item_id, batch_no),
  foreign key (org_id, item_id) references public.inv_items(org_id, id),
  foreign key (org_id, supplier_id) references public.pur_suppliers(org_id, id),
  check (mfg_date is null or expiry_date is null or mfg_date <= expiry_date)
);
create table if not exists public.inv_batch_balances (
  org_id       uuid not null references public.organizations(id),
  batch_id     uuid not null,
  warehouse_id uuid not null,
  qty          numeric(18,3) not null check (qty >= 0),
  primary key (org_id, batch_id, warehouse_id),
  foreign key (org_id, batch_id) references public.inv_batches(org_id, id),
  foreign key (org_id, warehouse_id) references public.inv_warehouses(org_id, id)
);
create table if not exists public.inv_batch_moves (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id),
  batch_id      uuid not null,
  warehouse_id  uuid not null,
  qty           numeric(18,3) not null,
  stock_move_id bigint not null,
  created_at    timestamptz not null default now(),
  foreign key (org_id, batch_id) references public.inv_batches(org_id, id)
);
create index if not exists inv_batches_org_expiry_idx on public.inv_batches(org_id, expiry_date);
create index if not exists inv_batch_balances_org_batch_idx on public.inv_batch_balances(org_id, batch_id);
create index if not exists inv_batch_moves_org_batch_idx on public.inv_batch_moves(org_id, batch_id);

create or replace function public.inv_batch_moves_guard() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'APPEND_ONLY'; end $$;
drop trigger if exists inv_batch_moves_no_change on public.inv_batch_moves;
create trigger inv_batch_moves_no_change before update or delete on public.inv_batch_moves for each row execute function public.inv_batch_moves_guard();

alter table public.inv_storage_conditions enable row level security;
alter table public.inv_batches enable row level security;
alter table public.inv_batch_balances enable row level security;
alter table public.inv_batch_moves enable row level security;
revoke all on public.inv_storage_conditions, public.inv_batches, public.inv_batch_balances, public.inv_batch_moves from anon, authenticated;
grant select on public.inv_storage_conditions, public.inv_batches, public.inv_batch_balances, public.inv_batch_moves to authenticated;
drop policy if exists inv_storage_conditions_member_read on public.inv_storage_conditions;
create policy inv_storage_conditions_member_read on public.inv_storage_conditions for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_batches_member_read on public.inv_batches;
create policy inv_batches_member_read on public.inv_batches for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_batch_balances_member_read on public.inv_batch_balances;
create policy inv_batch_balances_member_read on public.inv_batch_balances for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_batch_moves_member_read on public.inv_batch_moves;
create policy inv_batch_moves_member_read on public.inv_batch_moves for select to authenticated using (public.is_org_member(org_id));

-- ---------------------------------------------------------------- ledger mirror (the heart of it)

-- The batch that holds un-batched stock of an item (created on demand).
create or replace function public.inv__unbatched(p_org uuid, p_item uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.inv_batches where org_id = p_org and item_id = p_item and batch_no = 'UNBATCHED';
  if v is null then
    insert into public.inv_batches (org_id, item_id, batch_no) values (p_org, p_item, 'UNBATCHED')
    on conflict (org_id, item_id, batch_no) do nothing;
    select id into v from public.inv_batches where org_id = p_org and item_id = p_item and batch_no = 'UNBATCHED';
  end if;
  return v;
end $$;

create or replace function public.inv__batch_add(p_org uuid, p_batch uuid, p_wh uuid, p_qty numeric, p_move bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.inv_batch_balances (org_id, batch_id, warehouse_id, qty) values (p_org, p_batch, p_wh, p_qty)
  on conflict (org_id, batch_id, warehouse_id) do update set qty = public.inv_batch_balances.qty + excluded.qty;
  insert into public.inv_batch_moves (org_id, batch_id, warehouse_id, qty, stock_move_id) values (p_org, p_batch, p_wh, p_qty, p_move);
end $$;

create or replace function public.inv_stock_moves_batches() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tracked boolean; v_batch uuid; v_need numeric; r record; v_take numeric; v_ctx text;
begin
  select i.tracks_batches into v_tracked from public.inv_items i where i.org_id = new.org_id and i.id = new.item_id;
  if not coalesce(v_tracked, false) then return null; end if;

  if new.qty > 0 then
    v_ctx := nullif(current_setting('erp.batch_id', true), '');
    v_batch := coalesce(v_ctx::uuid, public.inv__unbatched(new.org_id, new.item_id));
    perform public.inv__batch_add(new.org_id, v_batch, new.warehouse_id, new.qty, new.id);
  else
    v_need := -new.qty;
    -- first expiry first out; batches without expiry (including UNBATCHED) last; quarantined and expired are skipped
    for r in
      select bb.batch_id, bb.qty
        from public.inv_batch_balances bb join public.inv_batches b on b.org_id = bb.org_id and b.id = bb.batch_id
       where bb.org_id = new.org_id and b.item_id = new.item_id and bb.warehouse_id = new.warehouse_id and bb.qty > 0
         and b.status = 'available' and (b.expiry_date is null or b.expiry_date >= current_date)
       order by b.expiry_date asc nulls last, b.created_at asc, b.id
         for update of bb
    loop
      exit when v_need <= 0;
      v_take := least(r.qty, v_need);
      perform public.inv__batch_add(new.org_id, r.batch_id, new.warehouse_id, -v_take, new.id);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then raise exception 'BATCH_STOCK_SHORT'; end if;
  end if;
  return null;
end $$;
drop trigger if exists inv_stock_moves_batches on public.inv_stock_moves;
create trigger inv_stock_moves_batches after insert on public.inv_stock_moves for each row execute function public.inv_stock_moves_batches();

-- ---------------------------------------------------------------- functions

create or replace function public.inv_create_storage_condition(p_name text, p_min_temp_c numeric default null, p_max_temp_c numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 or (p_min_temp_c is not null and p_max_temp_c is not null and p_min_temp_c > p_max_temp_c) then raise exception 'INVALID_INPUT'; end if;
  insert into public.inv_storage_conditions (org_id, name, min_temp_c, max_temp_c) values (v_org, trim(p_name), p_min_temp_c, p_max_temp_c) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.storage_condition.created', 'storage_condition', v_id::text, trim(p_name));
  return v_id;
exception when unique_violation then raise exception 'DUPLICATE';
end $$;

create or replace function public.inv_set_warehouse_storage(p_warehouse_id uuid, p_condition_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']);
begin
  if not exists (select 1 from public.inv_warehouses where org_id = v_org and id = p_warehouse_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  if p_condition_id is not null and not exists (select 1 from public.inv_storage_conditions where org_id = v_org and id = p_condition_id) then raise exception 'NOT_FOUND'; end if;
  update public.inv_warehouses set storage_condition_id = p_condition_id where org_id = v_org and id = p_warehouse_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.warehouse.storage_set', 'warehouse', p_warehouse_id::text, 'Storage condition ' || coalesce((select name from public.inv_storage_conditions where id = p_condition_id), 'cleared'));
end $$;

-- Switch batch tracking on for an item (existing stock moves into UNBATCHED per warehouse) and/or set the condition it needs.
-- Switching tracking off is refused while any batch stock exists.
create or replace function public.inv_set_item_batching(p_item_id uuid, p_tracks boolean, p_condition_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); it public.inv_items%rowtype; b record; v_ub uuid;
begin
  select * into it from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_condition_id is not null and not exists (select 1 from public.inv_storage_conditions where org_id = v_org and id = p_condition_id) then raise exception 'NOT_FOUND'; end if;
  if p_tracks and not it.tracks_batches then
    update public.inv_items set tracks_batches = true where org_id = v_org and id = p_item_id;
    v_ub := public.inv__unbatched(v_org, p_item_id);
    for b in select warehouse_id, on_hand from public.inv_stock_balances where org_id = v_org and item_id = p_item_id and on_hand > 0 loop
      insert into public.inv_batch_balances (org_id, batch_id, warehouse_id, qty) values (v_org, v_ub, b.warehouse_id, b.on_hand)
      on conflict (org_id, batch_id, warehouse_id) do update set qty = excluded.qty;
    end loop;
  elsif not p_tracks and it.tracks_batches then
    if exists (select 1 from public.inv_batch_balances bb join public.inv_batches x on x.org_id = bb.org_id and x.id = bb.batch_id where bb.org_id = v_org and x.item_id = p_item_id and bb.qty > 0) then raise exception 'INVALID_STATE'; end if;
    update public.inv_items set tracks_batches = false where org_id = v_org and id = p_item_id;
  end if;
  update public.inv_items set storage_condition_id = p_condition_id where org_id = v_org and id = p_item_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.item.batching_set', 'item', p_item_id::text, format('%s: batches %s', it.sku, case when p_tracks then 'tracked' else 'not tracked' end));
end $$;

create or replace function public.inv_receive_batch(p_item_id uuid, p_warehouse_id uuid, p_qty numeric, p_batch_no text,
  p_mfg_date date default null, p_expiry_date date default null, p_supplier_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
  it public.inv_items%rowtype; wh public.inv_warehouses%rowtype; v_batch uuid; v_exp date; v_no text := trim(coalesce(p_batch_no, ''));
begin
  if p_qty is null or p_qty <= 0 or length(v_no) = 0 or upper(v_no) = 'UNBATCHED' then raise exception 'INVALID_INPUT'; end if;
  if p_mfg_date is not null and p_expiry_date is not null and p_mfg_date > p_expiry_date then raise exception 'INVALID_INPUT'; end if;
  select * into it from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null;
  select * into wh from public.inv_warehouses where org_id = v_org and id = p_warehouse_id and deleted_at is null;
  if it.id is null or wh.id is null then raise exception 'NOT_FOUND'; end if;
  if not it.tracks_batches then raise exception 'NOT_TRACKED'; end if;
  if p_expiry_date is not null and p_expiry_date < current_date then raise exception 'EXPIRED'; end if;
  if it.storage_condition_id is not null and wh.storage_condition_id is not null and it.storage_condition_id <> wh.storage_condition_id then raise exception 'STORAGE_MISMATCH'; end if;
  if p_supplier_id is not null and not exists (select 1 from public.pur_suppliers where org_id = v_org and id = p_supplier_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;

  select id, expiry_date into v_batch, v_exp from public.inv_batches where org_id = v_org and item_id = p_item_id and batch_no = v_no;
  if v_batch is null then
    insert into public.inv_batches (org_id, item_id, batch_no, mfg_date, expiry_date, supplier_id, created_by) values (v_org, p_item_id, v_no, p_mfg_date, p_expiry_date, p_supplier_id, auth.uid()) returning id into v_batch;
  elsif v_exp is distinct from p_expiry_date then
    raise exception 'INVALID_INPUT';   -- the same batch number cannot arrive with a different expiry date
  end if;

  perform set_config('erp.batch_id', v_batch::text, true);
  perform public.inv__receipt(v_org, p_item_id, p_warehouse_id, p_qty, 'batch ' || v_no);
  perform set_config('erp.batch_id', '', true);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.batch.received', 'batch', v_batch::text, format('%s batch %s: %s received, expires %s', it.sku, v_no, p_qty, coalesce(p_expiry_date::text, 'never')));
  return v_batch;
end $$;

create or replace function public.inv_set_batch_status(p_batch_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); b public.inv_batches%rowtype;
begin
  if p_status not in ('available', 'quarantined') then raise exception 'INVALID_INPUT'; end if;
  select * into b from public.inv_batches where org_id = v_org and id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status = p_status then raise exception 'INVALID_STATE'; end if;
  update public.inv_batches set status = p_status where id = b.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.batch.' || p_status, 'batch', b.id::text, format('Batch %s %s%s', b.batch_no, p_status, coalesce(': ' || nullif(trim(p_note), ''), '')));
end $$;

-- Batches with stock that expire within p_days (or are already expired), soonest first.
create or replace function public.inv_expiry_report(p_days int default 90)
returns table (batch_id uuid, item_id uuid, sku text, name text, batch_no text, warehouse_id uuid, qty numeric, expiry_date date, days_left int, status text)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']);
begin
  if p_days is null or p_days < 0 or p_days > 3650 then raise exception 'INVALID_INPUT'; end if;
  return query
    select b.id, i.id, i.sku, i.name, b.batch_no, bb.warehouse_id, bb.qty, b.expiry_date, (b.expiry_date - current_date)::int, b.status
      from public.inv_batch_balances bb
      join public.inv_batches b on b.org_id = bb.org_id and b.id = bb.batch_id
      join public.inv_items i on i.org_id = b.org_id and i.id = b.item_id
     where bb.org_id = v_org and bb.qty > 0 and b.expiry_date is not null and b.expiry_date <= current_date + p_days
     order by b.expiry_date, i.sku;
end $$;

revoke all on function public.inv__unbatched(uuid, uuid), public.inv__batch_add(uuid, uuid, uuid, numeric, bigint), public.inv_stock_moves_batches() from public, anon, authenticated;
revoke all on function public.inv_create_storage_condition(text, numeric, numeric), public.inv_set_warehouse_storage(uuid, uuid), public.inv_set_item_batching(uuid, boolean, uuid),
  public.inv_receive_batch(uuid, uuid, numeric, text, date, date, uuid), public.inv_set_batch_status(uuid, text, text), public.inv_expiry_report(int) from public, anon;
grant execute on function public.inv_create_storage_condition(text, numeric, numeric), public.inv_set_warehouse_storage(uuid, uuid), public.inv_set_item_batching(uuid, boolean, uuid),
  public.inv_receive_batch(uuid, uuid, numeric, text, date, date, uuid), public.inv_set_batch_status(uuid, text, text), public.inv_expiry_report(int) to authenticated;

commit;

-- Verification (read-only): four tables with RLS (expect four rows).
select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('inv_storage_conditions', 'inv_batches', 'inv_batch_balances', 'inv_batch_moves') and relrowsecurity order by relname;
