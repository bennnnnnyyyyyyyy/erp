-- 006_inventory_core.sql
-- Inventory slice 1 (documentation/plans/INVENTORY_PLAN.md): warehouses, items, stock ledger and balances,
-- outgoing stock requests with reservation, single-level approval, issue, cancel. ADR-0003 rules:
--   * signed-in users can only SELECT (RLS); every change is a database function that checks the caller's role
--     and the module, and writes its audit row in the same transaction;
--   * an `issue` ledger row is accepted only for an APPROVED request, enforced by a trigger, so even a direct
--     insert by a privileged role is refused;
--   * a request cannot be approved by the person who made it (table check constraint).
--
-- Depends on sql/001-005. Rerun-safe: tables `if not exists`, functions `create or replace`, triggers and
-- policies dropped and recreated by name. No table or data is dropped. Run the whole file, then the verification
-- queries (each on its own), then sql/tests/002_inventory_approval.sql.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.inv_warehouses (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  code       text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  name       text not null check (length(trim(name)) between 1 and 200),
  name_ar    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  unique (org_id, code)
);

create table if not exists public.inv_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  sku        text not null check (length(trim(sku)) between 1 and 64),
  name       text not null check (length(trim(name)) between 1 and 200),
  name_ar    text,
  uom        text not null default 'piece' check (length(trim(uom)) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  unique (org_id, sku)
);

-- Per-organization request numbering. Internal: no grants to anyone but the functions.
create table if not exists public.inv_counters (
  org_id uuid not null references public.organizations(id),
  key    text not null,
  value  bigint not null default 0,
  primary key (org_id, key)
);

create table if not exists public.inv_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  number           text not null,
  requester_id     uuid not null references auth.users(id),
  warehouse_id     uuid not null,
  reason           text not null default '',
  status           text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'issued', 'cancelled')),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_comment text,
  issued_by        uuid references auth.users(id),
  issued_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id),
  -- The approval control, in the data: nobody decides their own request, and approved or issued needs a decider.
  constraint inv_requests_decider_not_requester check (decided_by is null or decided_by <> requester_id),
  constraint inv_requests_decided_when_approved check (status not in ('approved', 'issued') or decided_by is not null)
);

create table if not exists public.inv_request_lines (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  request_id uuid not null,
  item_id    uuid not null,
  qty        numeric(18, 3) not null check (qty > 0),
  created_at timestamptz not null default now(),
  unique (request_id, item_id),
  foreign key (org_id, request_id) references public.inv_requests (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);

-- Evidence of each decision and the channel it came through (app now; whatsapp and voice later).
create table if not exists public.inv_approvals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  request_id  uuid not null,
  decision    text not null check (decision in ('approved', 'rejected')),
  approver_id uuid not null references auth.users(id),
  comment     text,
  channel     text not null default 'app' check (channel in ('app', 'whatsapp', 'voice', 'api')),
  decided_at  timestamptz not null default now(),
  foreign key (org_id, request_id) references public.inv_requests (org_id, id)
);

-- The stock ledger: append-only. Quantities are signed (receipts positive, issues negative).
create table if not exists public.inv_stock_moves (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id),
  item_id      uuid not null,
  warehouse_id uuid not null,
  qty          numeric(18, 3) not null,
  kind         text not null check (kind in ('receipt', 'issue')),
  request_id   uuid,
  ref          text,
  posted_by    uuid not null references auth.users(id),
  posted_at    timestamptz not null default now(),
  foreign key (org_id, item_id) references public.inv_items (org_id, id),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id),
  foreign key (org_id, request_id) references public.inv_requests (org_id, id),
  check ((kind = 'receipt' and qty > 0) or (kind = 'issue' and qty < 0 and request_id is not null))
);

-- Running totals, changed only by the functions below.
create table if not exists public.inv_stock_balances (
  org_id       uuid not null references public.organizations(id),
  item_id      uuid not null,
  warehouse_id uuid not null,
  on_hand      numeric(18, 3) not null default 0,
  reserved     numeric(18, 3) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (org_id, item_id, warehouse_id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id),
  check (on_hand >= 0 and reserved >= 0 and reserved <= on_hand)
);

create index if not exists inv_requests_org_status_idx on public.inv_requests (org_id, status);
create index if not exists inv_request_lines_org_request_idx on public.inv_request_lines (org_id, request_id);
create index if not exists inv_approvals_org_request_idx on public.inv_approvals (org_id, request_id);
create index if not exists inv_stock_moves_org_item_idx on public.inv_stock_moves (org_id, item_id, posted_at desc);

-- ---------------------------------------------------------------- triggers

drop trigger if exists inv_warehouses_updated_at on public.inv_warehouses;
create trigger inv_warehouses_updated_at before update on public.inv_warehouses for each row execute function public.set_updated_at();
drop trigger if exists inv_items_updated_at on public.inv_items;
create trigger inv_items_updated_at before update on public.inv_items for each row execute function public.set_updated_at();
drop trigger if exists inv_requests_updated_at on public.inv_requests;
create trigger inv_requests_updated_at before update on public.inv_requests for each row execute function public.set_updated_at();
drop trigger if exists inv_stock_balances_updated_at on public.inv_stock_balances;
create trigger inv_stock_balances_updated_at before update on public.inv_stock_balances for each row execute function public.set_updated_at();

-- A request moves only along the allowed transitions, and its identity never changes.
create or replace function public.inv_requests_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.requester_id <> old.requester_id or new.number <> old.number or new.warehouse_id <> old.warehouse_id then
    raise exception 'INVALID_STATE' using detail = 'request identity cannot change';
  end if;
  if new.status <> old.status and not (
       (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled'))
    or (old.status = 'approved' and new.status in ('issued', 'cancelled'))
  ) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;

drop trigger if exists inv_requests_guard on public.inv_requests;
create trigger inv_requests_guard before update on public.inv_requests for each row execute function public.inv_requests_guard();

-- An outgoing movement exists only for an approved request. Enforced here, in the data, so a direct insert
-- by any role (including a privileged one) cannot skip the approval.
create or replace function public.inv_stock_moves_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if new.kind = 'issue' then
    select r.status into v_status from public.inv_requests r where r.org_id = new.org_id and r.id = new.request_id;
    if v_status is distinct from 'approved' then
      raise exception 'APPROVAL_REQUIRED';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists inv_stock_moves_guard on public.inv_stock_moves;
create trigger inv_stock_moves_guard before insert on public.inv_stock_moves for each row execute function public.inv_stock_moves_guard();

-- The ledger and the approvals are append-only, like the audit log.
create or replace function public.inv_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only (% refused)', tg_table_name, tg_op;
end $$;

drop trigger if exists inv_stock_moves_append_only on public.inv_stock_moves;
create trigger inv_stock_moves_append_only before update or delete on public.inv_stock_moves for each statement execute function public.inv_append_only();
drop trigger if exists inv_stock_moves_no_truncate on public.inv_stock_moves;
create trigger inv_stock_moves_no_truncate before truncate on public.inv_stock_moves for each statement execute function public.inv_append_only();
drop trigger if exists inv_approvals_append_only on public.inv_approvals;
create trigger inv_approvals_append_only before update or delete on public.inv_approvals for each statement execute function public.inv_append_only();
drop trigger if exists inv_approvals_no_truncate on public.inv_approvals;
create trigger inv_approvals_no_truncate before truncate on public.inv_approvals for each statement execute function public.inv_append_only();

-- ---------------------------------------------------------------- privileges and row level security

alter table public.inv_warehouses     enable row level security;
alter table public.inv_items          enable row level security;
alter table public.inv_counters       enable row level security;
alter table public.inv_requests       enable row level security;
alter table public.inv_request_lines  enable row level security;
alter table public.inv_approvals      enable row level security;
alter table public.inv_stock_moves    enable row level security;
alter table public.inv_stock_balances enable row level security;

revoke all on public.inv_warehouses, public.inv_items, public.inv_counters, public.inv_requests, public.inv_request_lines,
  public.inv_approvals, public.inv_stock_moves, public.inv_stock_balances from anon, authenticated;
grant select on public.inv_warehouses, public.inv_items, public.inv_requests, public.inv_request_lines,
  public.inv_approvals, public.inv_stock_moves, public.inv_stock_balances to authenticated;

drop policy if exists inv_warehouses_member_read on public.inv_warehouses;
create policy inv_warehouses_member_read on public.inv_warehouses for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_items_member_read on public.inv_items;
create policy inv_items_member_read on public.inv_items for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_requests_member_read on public.inv_requests;
create policy inv_requests_member_read on public.inv_requests for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_request_lines_member_read on public.inv_request_lines;
create policy inv_request_lines_member_read on public.inv_request_lines for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_approvals_member_read on public.inv_approvals;
create policy inv_approvals_member_read on public.inv_approvals for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_stock_moves_member_read on public.inv_stock_moves;
create policy inv_stock_moves_member_read on public.inv_stock_moves for select to authenticated using (public.is_org_member(org_id));
drop policy if exists inv_stock_balances_member_read on public.inv_stock_balances;
create policy inv_stock_balances_member_read on public.inv_stock_balances for select to authenticated using (public.is_org_member(org_id));

-- ---------------------------------------------------------------- internal helpers (not callable by users)

-- Caller's organization after checking role and that the inventory module is switched on for it.
create or replace function public.inv__guard(p_roles text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(p_roles);
begin
  if not exists (select 1 from public.org_modules m where m.org_id = v_org and m.module_key = 'inventory' and m.disabled_at is null) then
    raise exception 'MODULE_DISABLED';
  end if;
  return v_org;
end $$;

create or replace function public.inv__next_number(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.inv_counters (org_id, key, value) values (p_org, 'request', 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1
  returning value into v;
  return 'OUT-' || lpad(v::text, 4, '0');
end $$;

-- Adds received stock: one ledger row and the balance. The caller writes the audit row.
create or replace function public.inv__receipt(p_org uuid, p_item uuid, p_wh uuid, p_qty numeric, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, ref, posted_by)
  values (p_org, p_item, p_wh, p_qty, 'receipt', p_ref, auth.uid());
  insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved)
  values (p_org, p_item, p_wh, p_qty, 0)
  on conflict (org_id, item_id, warehouse_id) do update set on_hand = public.inv_stock_balances.on_hand + excluded.on_hand;
end $$;

-- Releases the reservation held by a request's lines.
create or replace function public.inv__release(p_request public.inv_requests) returns void
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  for l in select item_id, qty from public.inv_request_lines where org_id = p_request.org_id and request_id = p_request.id order by item_id loop
    update public.inv_stock_balances b set reserved = b.reserved - l.qty
    where b.org_id = p_request.org_id and b.item_id = l.item_id and b.warehouse_id = p_request.warehouse_id;
  end loop;
end $$;

-- ---------------------------------------------------------------- public functions (called with the user's own login)

create or replace function public.inv_create_warehouse(p_code text, p_name text, p_name_ar text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  v_id  uuid;
begin
  insert into public.inv_warehouses (org_id, code, name, name_ar) values (v_org, p_code, trim(p_name), nullif(trim(p_name_ar), ''))
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.warehouse.created', 'warehouse', v_id::text, format('Warehouse %s %s created', p_code, trim(p_name)));
  return v_id;
exception when unique_violation or check_violation then
  raise exception 'INVALID_INPUT' using detail = 'warehouse code already exists or is not valid';
end $$;

create or replace function public.inv_create_item(
  p_sku text, p_name text, p_name_ar text default null, p_uom text default 'piece',
  p_opening_qty numeric default 0, p_warehouse_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id  uuid;
begin
  if coalesce(p_opening_qty, 0) < 0 then raise exception 'INVALID_INPUT'; end if;
  if coalesce(p_opening_qty, 0) > 0 and not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'opening stock needs a warehouse';
  end if;
  insert into public.inv_items (org_id, sku, name, name_ar, uom) values (v_org, upper(trim(p_sku)), trim(p_name), nullif(trim(p_name_ar), ''), coalesce(nullif(trim(p_uom), ''), 'piece'))
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.item.created', 'item', v_id::text, format('Item %s %s created', upper(trim(p_sku)), trim(p_name)));
  if coalesce(p_opening_qty, 0) > 0 then
    perform public.inv__receipt(v_org, v_id, p_warehouse_id, p_opening_qty, 'opening stock');
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (v_org, auth.uid(), 'inventory.stock.received', 'item', v_id::text, format('Opening stock %s received for %s', p_opening_qty, upper(trim(p_sku))));
  end if;
  return v_id;
exception when unique_violation or check_violation then
  raise exception 'INVALID_INPUT' using detail = 'SKU already exists or a value is not valid';
end $$;

create or replace function public.inv_receive_stock(p_item_id uuid, p_warehouse_id uuid, p_qty numeric, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
begin
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_INPUT'; end if;
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null)
     or not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown item or warehouse';
  end if;
  perform public.inv__receipt(v_org, p_item_id, p_warehouse_id, p_qty, p_ref);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.stock.received', 'item', p_item_id::text, format('%s received%s', p_qty, coalesce(' (' || p_ref || ')', '')));
end $$;

-- p_lines: [{"itemId": "<uuid>", "qty": 5}, ...]. Reserves the quantities; refuses if not enough is available.
create or replace function public.inv_submit_request(p_warehouse_id uuid, p_reason text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id     uuid := gen_random_uuid();
  v_number text;
  r        record;
  b        record;
  v_names  text := '';
begin
  if not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown warehouse';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'add at least one line';
  end if;

  v_number := public.inv__next_number(v_org);
  insert into public.inv_requests (id, org_id, number, requester_id, warehouse_id, reason)
  values (v_id, v_org, v_number, auth.uid(), p_warehouse_id, coalesce(trim(p_reason), ''));

  -- Same item twice is summed. Rows are locked in item order so two requests cannot deadlock.
  for r in
    select (e ->> 'itemId')::uuid as item_id, sum((e ->> 'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'INVALID_INPUT' using detail = 'quantities must be above zero'; end if;
    if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = r.item_id and i.deleted_at is null) then
      raise exception 'INVALID_INPUT' using detail = 'unknown item';
    end if;
    select s.on_hand, s.reserved into b from public.inv_stock_balances s
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_warehouse_id for update;
    if not found or b.on_hand - b.reserved < r.qty then
      raise exception 'INSUFFICIENT_AVAILABLE' using detail = format('%s available, %s requested', coalesce(b.on_hand - b.reserved, 0), r.qty);
    end if;
    update public.inv_stock_balances s set reserved = s.reserved + r.qty
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_warehouse_id;
    insert into public.inv_request_lines (org_id, request_id, item_id, qty) values (v_org, v_id, r.item_id, r.qty);
    v_names := v_names || case when v_names = '' then '' else ', ' end || r.qty::text || ' x ' || (select i.name from public.inv_items i where i.org_id = v_org and i.id = r.item_id);
  end loop;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.request.submitted', 'stock_request', v_id::text, format('%s submitted: %s', v_number, v_names));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

-- Approve or reject. Owner or admin only, never the requester. The channel records where the decision came from.
create or replace function public.inv_decide_request(p_request_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  r     public.inv_requests;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then
    raise exception 'INVALID_INPUT';
  end if;
  select * into r from public.inv_requests q where q.org_id = v_org and q.id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requester_id = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if r.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('request is %s', r.status); end if;

  update public.inv_requests q set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '')
  where q.id = r.id;
  insert into public.inv_approvals (org_id, request_id, decision, approver_id, comment, channel)
  values (v_org, r.id, p_decision, auth.uid(), nullif(trim(p_comment), ''), p_channel);
  if p_decision = 'rejected' then
    perform public.inv__release(r);
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), 'inventory.request.' || case when p_decision = 'approved' then 'approved' else 'rejected' end, 'stock_request', r.id::text,
          format('%s %s', r.number, p_decision) || case when p_decision = 'rejected' then '; reserved stock released' else '' end, p_channel);
end $$;

-- Issue stock for an approved request. The ledger trigger refuses this for anything not approved.
create or replace function public.inv_post_issue(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.inv__guard(array['owner', 'admin', 'member']);
  r       public.inv_requests;
  l       record;
  v_names text := '';
begin
  select * into r from public.inv_requests q where q.org_id = v_org and q.id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status = 'issued' then raise exception 'INVALID_STATE' using detail = 'already issued'; end if;
  if r.status <> 'approved' then raise exception 'APPROVAL_REQUIRED'; end if;

  for l in select ln.item_id, ln.qty, i.name from public.inv_request_lines ln join public.inv_items i on i.org_id = ln.org_id and i.id = ln.item_id
           where ln.org_id = v_org and ln.request_id = r.id order by ln.item_id loop
    perform 1 from public.inv_stock_balances s where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = r.warehouse_id for update;
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, request_id, posted_by)
    values (v_org, l.item_id, r.warehouse_id, -l.qty, 'issue', r.id, auth.uid());
    update public.inv_stock_balances s set on_hand = s.on_hand - l.qty, reserved = s.reserved - l.qty
    where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = r.warehouse_id;
    v_names := v_names || case when v_names = '' then '' else ', ' end || l.qty::text || ' x ' || l.name;
  end loop;

  update public.inv_requests q set status = 'issued', issued_by = auth.uid(), issued_at = now() where q.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.stock.issued', 'stock_request', r.id::text, format('%s issued: %s', r.number, v_names));
end $$;

-- Cancel: the requester, or an owner or admin. Releases the reservation.
create or replace function public.inv_cancel_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.inv__guard(array['owner', 'admin', 'member']);
  r      public.inv_requests;
  v_role text;
begin
  select * into r from public.inv_requests q where q.org_id = v_org and q.id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if r.requester_id <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('submitted', 'approved') then raise exception 'INVALID_STATE' using detail = format('request is %s', r.status); end if;
  perform public.inv__release(r);
  update public.inv_requests q set status = 'cancelled' where q.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.request.cancelled', 'stock_request', r.id::text, format('%s cancelled; reserved stock released', r.number));
end $$;

-- ---------------------------------------------------------------- function privileges

revoke all on function public.inv__guard(text[]) from public, anon, authenticated;
revoke all on function public.inv__next_number(uuid) from public, anon, authenticated;
revoke all on function public.inv__receipt(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.inv__release(public.inv_requests) from public, anon, authenticated;
revoke all on function public.inv_stock_moves_guard() from public, anon, authenticated;
revoke all on function public.inv_requests_guard() from public, anon, authenticated;
revoke all on function public.inv_append_only() from public, anon, authenticated;

revoke all on function public.inv_create_warehouse(text, text, text) from public, anon;
revoke all on function public.inv_create_item(text, text, text, text, numeric, uuid) from public, anon;
revoke all on function public.inv_receive_stock(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.inv_submit_request(uuid, text, jsonb) from public, anon;
revoke all on function public.inv_decide_request(uuid, text, text, text) from public, anon;
revoke all on function public.inv_post_issue(uuid) from public, anon;
revoke all on function public.inv_cancel_request(uuid) from public, anon;
grant execute on function public.inv_create_warehouse(text, text, text) to authenticated;
grant execute on function public.inv_create_item(text, text, text, text, numeric, uuid) to authenticated;
grant execute on function public.inv_receive_stock(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.inv_submit_request(uuid, text, jsonb) to authenticated;
grant execute on function public.inv_decide_request(uuid, text, text, text) to authenticated;
grant execute on function public.inv_post_issue(uuid) to authenticated;
grant execute on function public.inv_cancel_request(uuid) to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only; run each on its own)

-- 1. Eight inventory tables exist with row level security on (expect eight rows, all true).
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname like 'inv\_%' and relkind = 'r' order by relname;

-- 2. Signed-in and anonymous roles hold nothing but SELECT on them (expect zero rows).
select grantee, table_name, privilege_type from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name like 'inv\_%' and privilege_type <> 'SELECT' order by 1, 2, 3;

-- 3. Users can call exactly the seven public functions and none of the internal ones
--    (expect seven rows, can_execute true; the internal inv__ and trigger functions must not appear).
select p.proname from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%' and has_function_privilege('authenticated', p.oid, 'execute')
order by 1;
