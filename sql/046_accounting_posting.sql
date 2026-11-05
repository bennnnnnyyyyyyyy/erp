-- 046_accounting_posting.sql
-- Accounting phase 1, slice 2 (documentation/plans/ACCOUNTING_PLAN.md section 7, rules P1-P16; ADR-0004 draft §1-§5).
-- Every document with an accounting effect gets its journal entry in the same transaction, from a trigger on its own table:
--   stock moves (receipts, issues, adjustments and counts, customer returns; transfers post nothing), customer invoices and their
--   voids, supplier invoices, expenses and payments and their voids, approved credit and debit notes.
-- The triggers do nothing for a company until it switches accounting on (sql/047). The posting functions take p_backfill so the
-- switch-on can post the existing documents with the same rules.
-- Also in this slice:
--   * stock moves remember their purchase order and, for receipts, their unit cost (purchase receipts always; manual receipts,
--     opening stock and batch receipts when a cost is given). With accounting on, a receipt without a cost is refused
--     (RECEIPT_COST_REQUIRED, plan P2) - a cost is never invented from the current average. A manual receipt with a cost also updates
--     the item's average cost (logged as 'manual_receipt').
--   * acc_receipt_costs: the documented cost of an old receipt that had none (filled before switch-on; the function is in 047).
--   * acc_issue_reasons + inv_requests.issue_reason_id: internal-use reasons, each pointing to an expense account (plan O4).
--   * fin_categories.account_id: the expense account of a category (null = the expense_default role).
--   * payment methods post to their own accounts: cash, bank, card clearing, cheques (by direction), other clearing; 'other' needs a note.
-- Changed existing functions (same behaviour, one optional parameter more): inv__receipt, inv__apply_cost, inv_create_item,
-- inv_receive_stock, inv_receive_batch, pur_receive_order.
-- Depends on sql/001-045. Rerun-safe. Run the whole file, then sql/tests/041_accounting_posting.sql.

begin;

-- ---------------------------------------------------------------- schema

alter table public.inv_stock_moves add column if not exists purchase_order_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inv_stock_moves_purchase_order_fk') then
    alter table public.inv_stock_moves add constraint inv_stock_moves_purchase_order_fk foreign key (org_id, purchase_order_id) references public.pur_orders (org_id, id);
  end if;
end $$;

alter table public.inv_cost_log drop constraint if exists inv_cost_log_source_check;
alter table public.inv_cost_log add constraint inv_cost_log_source_check check (source in ('purchase_receipt', 'manual', 'customer_return', 'manual_receipt'));

alter table public.fin_categories add column if not exists account_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_categories_account_fk') then
    alter table public.fin_categories add constraint fin_categories_account_fk foreign key (org_id, account_id) references public.acc_accounts (org_id, id);
  end if;
end $$;

create table if not exists public.acc_issue_reasons (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  name        text not null check (length(trim(name)) between 1 and 80),
  name_ar     text check (name_ar is null or length(trim(name_ar)) between 1 and 80),
  account_id  uuid not null,
  active      boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, account_id) references public.acc_accounts (org_id, id)
);
create unique index if not exists acc_issue_reasons_name_uq on public.acc_issue_reasons (org_id, lower(name));
alter table public.acc_issue_reasons enable row level security;
revoke all on public.acc_issue_reasons from anon, authenticated;
grant select on public.acc_issue_reasons to authenticated;
-- Members choose a reason when they ask for stock, so every member may read the list (not the accounts behind it).
drop policy if exists acc_issue_reasons_member_read on public.acc_issue_reasons;
create policy acc_issue_reasons_member_read on public.acc_issue_reasons for select to authenticated using (public.is_org_member(org_id));
drop trigger if exists acc_issue_reasons_updated_at on public.acc_issue_reasons;
create trigger acc_issue_reasons_updated_at before update on public.acc_issue_reasons for each row execute function public.set_updated_at();

alter table public.inv_requests add column if not exists issue_reason_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inv_requests_issue_reason_fk') then
    alter table public.inv_requests add constraint inv_requests_issue_reason_fk foreign key (org_id, issue_reason_id) references public.acc_issue_reasons (org_id, id);
  end if;
end $$;

create table if not exists public.acc_receipt_costs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  -- No foreign key on purpose: one would change how TRUNCATE of the stock ledger is refused (sql/tests/002 S14c). The function that
  -- writes this table (sql/047) checks the move exists, is a receipt and belongs to the same company.
  stock_move_id    bigint not null,
  unit_cost_minor  bigint not null check (unit_cost_minor >= 0),
  rationale        text check (rationale is null or length(trim(rationale)) between 1 and 500),
  set_by           uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (org_id, stock_move_id),
  check (unit_cost_minor > 0 or rationale is not null)
);
alter table public.acc_receipt_costs enable row level security;
revoke all on public.acc_receipt_costs from anon, authenticated;
grant select on public.acc_receipt_costs to authenticated;
drop policy if exists acc_receipt_costs_read on public.acc_receipt_costs;
create policy acc_receipt_costs_read on public.acc_receipt_costs for select to authenticated using (public.acc__can_read(org_id));
drop trigger if exists acc_receipt_costs_append_only on public.acc_receipt_costs;
create trigger acc_receipt_costs_append_only before update or delete on public.acc_receipt_costs for each row execute function public.acc__append_only();

-- ---------------------------------------------------------------- receipts carry their cost and purchase order

-- Average cost after a receipt (unchanged formula from sql/023), now with the cost-log source as a parameter.
drop function if exists public.inv__apply_cost(uuid, uuid, numeric, bigint, text);
create or replace function public.inv__apply_cost(p_org uuid, p_item uuid, p_qty numeric, p_unit_cost bigint, p_ref text, p_source text default 'purchase_receipt') returns void
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
  values (p_org, p_item, p_source, p_ref, p_qty, p_unit_cost, v_avg, coalesce(v_new, p_unit_cost), auth.uid());
end $$;
revoke all on function public.inv__apply_cost(uuid, uuid, numeric, bigint, text, text) from public, anon, authenticated;

-- Adds received stock: one ledger row (now with its unit cost and purchase order when known) and the balance.
drop function if exists public.inv__receipt(uuid, uuid, uuid, numeric, text);
create or replace function public.inv__receipt(p_org uuid, p_item uuid, p_wh uuid, p_qty numeric, p_ref text,
  p_unit_cost bigint default null, p_purchase_order_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, ref, posted_by, unit_cost_minor, purchase_order_id)
  values (p_org, p_item, p_wh, p_qty, 'receipt', p_ref, auth.uid(), p_unit_cost, p_purchase_order_id);
  insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved)
  values (p_org, p_item, p_wh, p_qty, 0)
  on conflict (org_id, item_id, warehouse_id) do update set on_hand = public.inv_stock_balances.on_hand + excluded.on_hand;
end $$;
revoke all on function public.inv__receipt(uuid, uuid, uuid, numeric, text, bigint, uuid) from public, anon, authenticated;

-- Purchase receipts: as sql/023, plus the cost and order on the stock move.
create or replace function public.pur_receive_order(p_order_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin','member']); v_order public.pur_orders%rowtype; l record;
begin
  select * into v_order from public.pur_orders where org_id=v_org and id=p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if; if v_order.status <> 'ordered' then raise exception 'INVALID_STATE'; end if;
  for l in select item_id,qty,unit_cost_minor from public.pur_order_lines where org_id=v_org and order_id=v_order.id order by item_id loop
    perform public.inv__receipt(v_org,l.item_id,v_order.warehouse_id,l.qty,v_order.number,l.unit_cost_minor,v_order.id);
    perform public.inv__apply_cost(v_org,l.item_id,l.qty,l.unit_cost_minor,v_order.number);
  end loop;
  update public.pur_orders set status='received',received_by=auth.uid(),received_at=now() where id=v_order.id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.received','purchase_order',v_order.id::text,format('%s received into stock',v_order.number));
end $$;

-- Create an item, optionally with opening stock. New: p_unit_cost_minor, the cost of that opening stock (required when accounting is
-- on; when given it also sets the item's average cost).
drop function if exists public.inv_create_item(text, text, text, text, numeric, uuid);
create or replace function public.inv_create_item(
  p_sku text, p_name text, p_name_ar text default null, p_uom text default 'piece',
  p_opening_qty numeric default 0, p_warehouse_id uuid default null, p_unit_cost_minor bigint default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id  uuid;
begin
  if coalesce(p_opening_qty, 0) < 0 or coalesce(p_unit_cost_minor, 0) < 0 then raise exception 'INVALID_INPUT'; end if;
  if coalesce(p_opening_qty, 0) > 0 and not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'opening stock needs a warehouse';
  end if;
  insert into public.inv_items (org_id, sku, name, name_ar, uom) values (v_org, upper(trim(p_sku)), trim(p_name), nullif(trim(p_name_ar), ''), coalesce(nullif(trim(p_uom), ''), 'piece'))
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.item.created', 'item', v_id::text, format('Item %s %s created', upper(trim(p_sku)), trim(p_name)));
  if coalesce(p_opening_qty, 0) > 0 then
    perform public.inv__receipt(v_org, v_id, p_warehouse_id, p_opening_qty, 'opening stock', p_unit_cost_minor);
    if p_unit_cost_minor is not null then perform public.inv__apply_cost(v_org, v_id, p_opening_qty, p_unit_cost_minor, 'opening stock', 'manual_receipt'); end if;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (v_org, auth.uid(), 'inventory.stock.received', 'item', v_id::text, format('Opening stock %s received for %s', p_opening_qty, upper(trim(p_sku))));
  end if;
  return v_id;
exception when unique_violation or check_violation then
  raise exception 'INVALID_INPUT' using detail = 'SKU already exists or a value is not valid';
end $$;

-- Receive stock by hand. New: p_unit_cost_minor (required when accounting is on; when given it also updates the average cost).
drop function if exists public.inv_receive_stock(uuid, uuid, numeric, text);
create or replace function public.inv_receive_stock(p_item_id uuid, p_warehouse_id uuid, p_qty numeric, p_ref text default null, p_unit_cost_minor bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
begin
  if p_qty is null or p_qty <= 0 or coalesce(p_unit_cost_minor, 0) < 0 then raise exception 'INVALID_INPUT'; end if;
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null)
     or not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown item or warehouse';
  end if;
  perform public.inv__receipt(v_org, p_item_id, p_warehouse_id, p_qty, p_ref, p_unit_cost_minor);
  if p_unit_cost_minor is not null then perform public.inv__apply_cost(v_org, p_item_id, p_qty, p_unit_cost_minor, p_ref, 'manual_receipt'); end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.stock.received', 'item', p_item_id::text, format('%s received%s', p_qty, coalesce(' (' || p_ref || ')', '')));
end $$;

-- Receive a batch (sql/035 rules unchanged). New: p_unit_cost_minor, as for inv_receive_stock.
drop function if exists public.inv_receive_batch(uuid, uuid, numeric, text, date, date, uuid);
create or replace function public.inv_receive_batch(p_item_id uuid, p_warehouse_id uuid, p_qty numeric, p_batch_no text,
  p_mfg_date date default null, p_expiry_date date default null, p_supplier_id uuid default null, p_unit_cost_minor bigint default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
  it public.inv_items%rowtype; wh public.inv_warehouses%rowtype; v_batch uuid; v_exp date; v_no text := trim(coalesce(p_batch_no, ''));
begin
  if p_qty is null or p_qty <= 0 or length(v_no) = 0 or upper(v_no) = 'UNBATCHED' or coalesce(p_unit_cost_minor, 0) < 0 then raise exception 'INVALID_INPUT'; end if;
  if p_mfg_date is not null and p_expiry_date is not null and p_mfg_date > p_expiry_date then raise exception 'INVALID_INPUT'; end if;
  select * into it from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null;
  select * into wh from public.inv_warehouses where org_id = v_org and id = p_warehouse_id and deleted_at is null;
  if it.id is null or wh.id is null then raise exception 'NOT_FOUND'; end if;
  if not it.tracks_batches then raise exception 'NOT_TRACKED'; end if;
  if p_expiry_date is not null and p_expiry_date < current_date then raise exception 'EXPIRED'; end if;
  if it.storage_condition_id is not null and wh.storage_condition_id is distinct from it.storage_condition_id then raise exception 'STORAGE_MISMATCH'; end if;
  if p_supplier_id is not null and not exists (select 1 from public.pur_suppliers where org_id = v_org and id = p_supplier_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;

  select id, expiry_date into v_batch, v_exp from public.inv_batches where org_id = v_org and item_id = p_item_id and batch_no = v_no;
  if v_batch is null then
    insert into public.inv_batches (org_id, item_id, batch_no, mfg_date, expiry_date, supplier_id, created_by) values (v_org, p_item_id, v_no, p_mfg_date, p_expiry_date, p_supplier_id, auth.uid()) returning id into v_batch;
  elsif v_exp is distinct from p_expiry_date then
    raise exception 'INVALID_INPUT';
  end if;

  perform set_config('erp.batch_id', v_batch::text, true);
  perform public.inv__receipt(v_org, p_item_id, p_warehouse_id, p_qty, 'batch ' || v_no, p_unit_cost_minor);
  perform set_config('erp.batch_id', '', true);
  if p_unit_cost_minor is not null then perform public.inv__apply_cost(v_org, p_item_id, p_qty, p_unit_cost_minor, 'batch ' || v_no, 'manual_receipt'); end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.batch.received', 'batch', v_batch::text, format('%s batch %s: %s received, expires %s', it.sku, v_no, p_qty, coalesce(p_expiry_date::text, 'never')));
  return v_batch;
end $$;

revoke all on function public.inv_create_item(text, text, text, text, numeric, uuid, bigint), public.inv_receive_stock(uuid, uuid, numeric, text, bigint),
  public.inv_receive_batch(uuid, uuid, numeric, text, date, date, uuid, bigint) from public, anon;
grant execute on function public.inv_create_item(text, text, text, text, numeric, uuid, bigint), public.inv_receive_stock(uuid, uuid, numeric, text, bigint),
  public.inv_receive_batch(uuid, uuid, numeric, text, date, date, uuid, bigint) to authenticated;

-- ---------------------------------------------------------------- posting helpers

-- A moment as a date in the company's own time zone (an invoice voided at 01:00 Cairo time is voided on that Cairo day).
create or replace function public.acc__local_date(p_org uuid, p_ts timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select (p_ts at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'UTC'))::date;
$$;
revoke all on function public.acc__local_date(uuid, timestamptz) from public, anon, authenticated;

-- The account role a payment method posts to (plan P13-P15).
create or replace function public.acc__method_role(p_method text, p_direction text) returns text
language sql immutable as $$
  select case p_method
    when 'cash' then 'cash' when 'bank' then 'bank' when 'card' then 'card_clearing'
    when 'cheque' then case when p_direction = 'in' then 'cheque_in_clearing' else 'cheque_out_clearing' end
    else 'other_clearing' end;
$$;
revoke all on function public.acc__method_role(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- posting: stock moves (P1, P2, P4-P7, P11)

create or replace function public.acc__post_move(p_org uuid, p_move_id bigint, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  mv public.inv_stock_moves; v_cost bigint; v_po uuid; v_supplier uuid; v_value bigint; v_cur text; v_date date;
  v_dr jsonb; v_cr jsonb; v_event text; v_reason_acct uuid;
begin
  select * into mv from public.inv_stock_moves where org_id = p_org and id = p_move_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if mv.kind in ('transfer_out', 'transfer_in') then return null; end if;   -- P7: same company, one inventory account
  v_cost := mv.unit_cost_minor;
  if mv.kind = 'receipt' then
    v_po := mv.purchase_order_id;
    if v_po is null and p_backfill then   -- receipts from before sql/046 carry the order number as their reference
      select o.id into v_po from public.pur_orders o where o.org_id = p_org and o.number = mv.ref;
    end if;
    if v_cost is null then select rc.unit_cost_minor into v_cost from public.acc_receipt_costs rc where rc.org_id = p_org and rc.stock_move_id = mv.id; end if;
    if v_cost is null and v_po is not null then
      select ol.unit_cost_minor into v_cost from public.pur_order_lines ol
       where ol.org_id = p_org and ol.order_id = v_po and ol.item_id = mv.item_id and ol.deleted_at is null order by ol.created_at, ol.id limit 1;
    end if;
    if v_cost is null then
      raise exception 'RECEIPT_COST_REQUIRED' using detail = format('stock receipt %s (%s) has no cost; enter one before it can be posted', mv.id, coalesce(mv.ref, 'no reference'));
    end if;
    if v_po is not null then select o.supplier_id into v_supplier from public.pur_orders o where o.org_id = p_org and o.id = v_po; end if;
  end if;
  v_value := round(abs(mv.qty) * coalesce(v_cost, 0));
  if v_value = 0 then return null; end if;   -- nothing to post (zero cost)
  select o.default_currency into v_cur from public.organizations o where o.id = p_org;
  v_date := public.acc__local_date(p_org, mv.posted_at);

  if mv.kind = 'receipt' then
    v_dr := jsonb_build_object('role', 'inventory');
    if v_po is not null then
      v_cr := jsonb_build_object('role', 'grni', 'partyType', 'supplier', 'partyId', v_supplier); v_event := 'received';
    else
      v_cr := jsonb_build_object('role', 'opening_balance'); v_event := 'received_other';
    end if;
  elsif mv.kind = 'issue' then
    v_cr := jsonb_build_object('role', 'inventory');
    if exists (select 1 from public.sal_orders so where so.org_id = p_org and so.request_id = mv.request_id) then
      v_dr := jsonb_build_object('role', 'cogs'); v_event := 'issued_sale';
    else
      select ir.account_id into v_reason_acct from public.inv_requests r join public.acc_issue_reasons ir on ir.org_id = r.org_id and ir.id = r.issue_reason_id
       where r.org_id = p_org and r.id = mv.request_id;
      v_dr := case when v_reason_acct is not null then jsonb_build_object('account', v_reason_acct) else jsonb_build_object('role', 'internal_use') end;
      v_event := 'issued_internal';
    end if;
  elsif mv.kind = 'adjust' then
    v_event := 'adjusted';
    if mv.qty > 0 then v_dr := jsonb_build_object('role', 'inventory'); v_cr := jsonb_build_object('role', 'stock_adjustment');
    else v_dr := jsonb_build_object('role', 'stock_adjustment'); v_cr := jsonb_build_object('role', 'inventory'); end if;
  elsif mv.kind = 'return_in' then
    v_dr := jsonb_build_object('role', 'inventory'); v_cr := jsonb_build_object('role', 'cogs'); v_event := 'returned_in';
  else
    return null;
  end if;

  return public.acc__post(p_org, v_date, v_cur, 'stock_move', mv.id::text, v_event, format('%s %s %s', mv.kind, mv.qty, coalesce(mv.ref, '')),
    jsonb_build_array(
      v_dr || jsonb_build_object('debit', v_value, 'itemId', mv.item_id, 'warehouseId', mv.warehouse_id),
      v_cr || jsonb_build_object('credit', v_value, 'itemId', mv.item_id, 'warehouseId', mv.warehouse_id)),
    p_backfill);
end $$;
revoke all on function public.acc__post_move(uuid, bigint, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- posting: customer invoices (P8, P16)

create or replace function public.acc__post_sal_invoice(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.sal_invoices; v_total bigint;
begin
  select * into i from public.sal_invoices where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(sum(round(l.qty * l.unit_price_minor)), 0)::bigint into v_total from public.sal_invoice_lines l where l.org_id = p_org and l.invoice_id = i.id;
  if v_total = 0 then return null; end if;
  return public.acc__post(p_org, i.invoice_date, i.currency, 'customer_invoice', i.id::text, 'invoiced', 'Customer invoice ' || i.number,
    jsonb_build_array(
      jsonb_build_object('role', 'receivables', 'debit', v_total, 'partyType', 'customer', 'partyId', i.customer_id),
      jsonb_build_object('role', 'sales_revenue', 'credit', v_total, 'partyType', 'customer', 'partyId', i.customer_id)),
    p_backfill);
end $$;

create or replace function public.acc__post_sal_invoice_void(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.sal_invoices; v_entry uuid;
begin
  select * into i from public.sal_invoices where org_id = p_org and id = p_id;
  if not found or i.status <> 'void' then return null; end if;
  v_entry := public.acc__post_sal_invoice(p_org, p_id, p_backfill);   -- idempotent; covers an invoice voided in its own transaction
  if v_entry is null then return null; end if;
  return public.acc__reverse(p_org, v_entry, public.acc__local_date(p_org, coalesce(i.voided_at, now())), 'voided', 'Void of customer invoice ' || i.number, p_backfill);
end $$;

-- ---------------------------------------------------------------- posting: supplier invoices (P3)

-- GRNI is released at the cost the goods were received at (the order line's cost, which every purchase receipt uses); any difference
-- to the billed price goes to purchase price differences. Billing more than was received is already refused by sql/018.
create or replace function public.acc__post_pur_invoice(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare si public.pur_supplier_invoices; v_received bigint; v_billed bigint; v_diff bigint;
begin
  select * into si from public.pur_supplier_invoices where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(sum(round(l.qty * ol.unit_cost_minor)), 0)::bigint, coalesce(sum(round(l.qty * l.unit_cost_minor)), 0)::bigint
    into v_received, v_billed
    from public.pur_supplier_invoice_lines l join public.pur_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
   where l.org_id = p_org and l.invoice_id = si.id;
  if v_billed = 0 and v_received = 0 then return null; end if;
  v_diff := v_billed - v_received;
  return public.acc__post(p_org, si.invoice_date, si.currency, 'supplier_invoice', si.id::text, 'billed', 'Supplier invoice ' || si.number,
    jsonb_build_array(
      jsonb_build_object('role', 'grni', 'debit', v_received, 'partyType', 'supplier', 'partyId', si.supplier_id),
      jsonb_build_object('role', 'price_variance', 'debit', greatest(v_diff, 0), 'credit', 0),
      jsonb_build_object('role', 'price_variance', 'credit', greatest(-v_diff, 0), 'debit', 0),
      jsonb_build_object('role', 'payables', 'credit', v_billed, 'partyType', 'supplier', 'partyId', si.supplier_id)),
    p_backfill);
end $$;

-- ---------------------------------------------------------------- posting: expenses (P12, P16)

create or replace function public.acc__post_expense(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.fin_expenses; v_acct uuid; v_cr jsonb;
begin
  select * into e from public.fin_expenses where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select c.account_id into v_acct from public.fin_categories c where c.org_id = p_org and c.id = e.category_id;
  v_cr := case when e.supplier_id is not null then jsonb_build_object('role', 'payables', 'partyType', 'supplier', 'partyId', e.supplier_id)
               else jsonb_build_object('role', 'expense_payables') end;
  return public.acc__post(p_org, e.expense_date, e.currency, 'expense', e.id::text, 'expensed', 'Expense ' || e.number,
    jsonb_build_array(
      case when v_acct is not null then jsonb_build_object('account', v_acct) else jsonb_build_object('role', 'expense_default') end
        || jsonb_build_object('debit', e.amount_minor, 'memo', e.note),
      v_cr || jsonb_build_object('credit', e.amount_minor)),
    p_backfill);
end $$;

create or replace function public.acc__post_expense_void(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.fin_expenses; v_entry uuid;
begin
  select * into e from public.fin_expenses where org_id = p_org and id = p_id;
  if not found or e.status <> 'void' then return null; end if;
  v_entry := public.acc__post_expense(p_org, p_id, p_backfill);
  return public.acc__reverse(p_org, v_entry, public.acc__local_date(p_org, coalesce(e.voided_at, now())), 'voided', 'Void of expense ' || e.number, p_backfill);
end $$;

-- ---------------------------------------------------------------- posting: payments (P13-P15, P16)

create or replace function public.acc__post_payment(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.fin_payments; v_money jsonb; v_other jsonb; v_party uuid; e public.fin_expenses;
begin
  select * into p from public.fin_payments where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.method = 'other' and length(trim(coalesce(p.note, ''))) = 0 and not p_backfill then
    raise exception 'NOTE_REQUIRED' using detail = 'a payment by "other" needs a note saying what it was';
  end if;
  v_money := jsonb_build_object('role', public.acc__method_role(p.method, p.direction));
  if p.direction = 'in' then
    select i.customer_id into v_party from public.sal_invoices i where i.org_id = p_org and i.id = p.customer_invoice_id;
    v_other := jsonb_build_object('role', 'receivables', 'partyType', 'customer', 'partyId', v_party);
    return public.acc__post(p_org, p.paid_on, p.currency, 'payment', p.id::text, 'paid_in', 'Payment ' || p.number,
      jsonb_build_array(v_money || jsonb_build_object('debit', p.amount_minor), v_other || jsonb_build_object('credit', p.amount_minor)), p_backfill);
  end if;
  if p.supplier_invoice_id is not null then
    select si.supplier_id into v_party from public.pur_supplier_invoices si where si.org_id = p_org and si.id = p.supplier_invoice_id;
    v_other := jsonb_build_object('role', 'payables', 'partyType', 'supplier', 'partyId', v_party);
  else
    select * into e from public.fin_expenses where org_id = p_org and id = p.expense_id;
    v_other := case when e.supplier_id is not null then jsonb_build_object('role', 'payables', 'partyType', 'supplier', 'partyId', e.supplier_id)
                    else jsonb_build_object('role', 'expense_payables') end;
  end if;
  return public.acc__post(p_org, p.paid_on, p.currency, 'payment', p.id::text, 'paid_out', 'Payment ' || p.number,
    jsonb_build_array(v_other || jsonb_build_object('debit', p.amount_minor), v_money || jsonb_build_object('credit', p.amount_minor)), p_backfill);
end $$;

create or replace function public.acc__post_payment_void(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.fin_payments; v_entry uuid;
begin
  select * into p from public.fin_payments where org_id = p_org and id = p_id;
  if not found or p.status <> 'void' then return null; end if;
  v_entry := public.acc__post_payment(p_org, p_id, p_backfill);   -- idempotent; covers a payment voided in its own transaction
  return public.acc__reverse(p_org, v_entry, public.acc__local_date(p_org, coalesce(p.voided_at, now())), 'voided', 'Void of payment ' || p.number, p_backfill);
end $$;

-- ---------------------------------------------------------------- posting: credit and debit notes (P9, P10)

create or replace function public.acc__post_note(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare n public.sal_notes; v_lines jsonb;
begin
  select * into n from public.sal_notes where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if n.status <> 'approved' or n.total_minor = 0 then return null; end if;
  if n.kind = 'credit' then
    v_lines := jsonb_build_array(
      jsonb_build_object('role', 'sales_returns', 'debit', n.total_minor, 'partyType', 'customer', 'partyId', n.customer_id),
      jsonb_build_object('role', 'receivables', 'credit', n.total_minor, 'partyType', 'customer', 'partyId', n.customer_id));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('role', 'receivables', 'debit', n.total_minor, 'partyType', 'customer', 'partyId', n.customer_id),
      jsonb_build_object('role', 'sales_revenue', 'credit', n.total_minor, 'partyType', 'customer', 'partyId', n.customer_id));
  end if;
  return public.acc__post(p_org, public.acc__local_date(p_org, coalesce(n.decided_at, now())), n.currency, 'sales_note', n.id::text,
    case when n.kind = 'credit' then 'credited' else 'debited' end, initcap(n.kind) || ' note ' || n.number, v_lines, p_backfill);
end $$;

revoke all on function public.acc__post_sal_invoice(uuid, uuid, boolean), public.acc__post_sal_invoice_void(uuid, uuid, boolean),
  public.acc__post_pur_invoice(uuid, uuid, boolean), public.acc__post_expense(uuid, uuid, boolean), public.acc__post_expense_void(uuid, uuid, boolean),
  public.acc__post_payment(uuid, uuid, boolean), public.acc__post_payment_void(uuid, uuid, boolean), public.acc__post_note(uuid, uuid, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- the triggers (only for companies with accounting on)

create or replace function public.acc__trg_stock_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.acc__enabled(new.org_id) then perform public.acc__post_move(new.org_id, new.id); end if;
  return null;
end $$;
drop trigger if exists acc_post_stock_move on public.inv_stock_moves;
create trigger acc_post_stock_move after insert on public.inv_stock_moves for each row execute function public.acc__trg_stock_move();

-- Invoices: the header is inserted before its lines, so the entry is made at commit (deferred), when the lines exist.
create or replace function public.acc__trg_sal_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.acc__enabled(new.org_id) then return null; end if;
  if tg_op = 'INSERT' then perform public.acc__post_sal_invoice(new.org_id, new.id);
  elsif new.status = 'void' and old.status is distinct from 'void' then perform public.acc__post_sal_invoice_void(new.org_id, new.id); end if;
  return null;
end $$;
drop trigger if exists acc_post_sal_invoice on public.sal_invoices;
create constraint trigger acc_post_sal_invoice after insert on public.sal_invoices
  deferrable initially deferred for each row execute function public.acc__trg_sal_invoice();
drop trigger if exists acc_post_sal_invoice_void on public.sal_invoices;
create trigger acc_post_sal_invoice_void after update of status on public.sal_invoices for each row execute function public.acc__trg_sal_invoice();

create or replace function public.acc__trg_pur_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.acc__enabled(new.org_id) then perform public.acc__post_pur_invoice(new.org_id, new.id); end if;
  return null;
end $$;
drop trigger if exists acc_post_pur_invoice on public.pur_supplier_invoices;
create constraint trigger acc_post_pur_invoice after insert on public.pur_supplier_invoices
  deferrable initially deferred for each row execute function public.acc__trg_pur_invoice();

create or replace function public.acc__trg_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.acc__enabled(new.org_id) then return null; end if;
  if tg_op = 'INSERT' then perform public.acc__post_expense(new.org_id, new.id);
  elsif new.status = 'void' and old.status is distinct from 'void' then perform public.acc__post_expense_void(new.org_id, new.id); end if;
  return null;
end $$;
drop trigger if exists acc_post_expense on public.fin_expenses;
create trigger acc_post_expense after insert or update of status on public.fin_expenses for each row execute function public.acc__trg_expense();

create or replace function public.acc__trg_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.acc__enabled(new.org_id) then return null; end if;
  if tg_op = 'INSERT' then perform public.acc__post_payment(new.org_id, new.id);
  elsif new.status = 'void' and old.status is distinct from 'void' then perform public.acc__post_payment_void(new.org_id, new.id); end if;
  return null;
end $$;
drop trigger if exists acc_post_payment on public.fin_payments;
create trigger acc_post_payment after insert or update of status on public.fin_payments for each row execute function public.acc__trg_payment();

create or replace function public.acc__trg_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.acc__enabled(new.org_id) and new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    perform public.acc__post_note(new.org_id, new.id);
  end if;
  return null;
end $$;
drop trigger if exists acc_post_note on public.sal_notes;
create trigger acc_post_note after insert or update of status on public.sal_notes for each row execute function public.acc__trg_note();

revoke all on function public.acc__trg_stock_move(), public.acc__trg_sal_invoice(), public.acc__trg_pur_invoice(), public.acc__trg_expense(),
  public.acc__trg_payment(), public.acc__trg_note() from public, anon, authenticated;

-- ---------------------------------------------------------------- settings functions for signed-in users

-- Point an expense category at an expense account (null = the expense_default role). Owner or head accountant. Audited.
create or replace function public.acc_set_category_account(p_category_id uuid, p_account_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); c public.fin_categories; a public.acc_accounts;
begin
  select * into c from public.fin_categories where org_id = v_org and id = p_category_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_account_id is not null then
    select * into a from public.acc_accounts where org_id = v_org and id = p_account_id and deleted_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not a.active then raise exception 'ACCOUNT_INACTIVE'; end if;
    if exists (select 1 from public.acc_accounts x where x.org_id = v_org and x.parent_id = a.id and x.deleted_at is null) then raise exception 'NOT_LEAF'; end if;
  end if;
  if c.account_id is not distinct from p_account_id then return; end if;
  update public.fin_categories set account_id = p_account_id where id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'accounting.category_account.changed', 'finance_category', c.id::text,
          format('%s now posts to %s', c.name, coalesce(a.code || ' ' || a.name, 'the default expense account')),
          jsonb_build_object('account_id', c.account_id), jsonb_build_object('account_id', p_account_id));
end $$;

-- Internal-use reasons (plan O4). Owner or head accountant. Audited.
create or replace function public.acc_save_issue_reason(p_id uuid, p_name text, p_name_ar text, p_account_id uuid, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); a public.acc_accounts; r public.acc_issue_reasons; v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 or p_active is null then raise exception 'INVALID_INPUT'; end if;
  select * into a from public.acc_accounts where org_id = v_org and id = p_account_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not a.active then raise exception 'ACCOUNT_INACTIVE'; end if;
  if exists (select 1 from public.acc_accounts x where x.org_id = v_org and x.parent_id = a.id and x.deleted_at is null) then raise exception 'NOT_LEAF'; end if;
  if p_id is null then
    insert into public.acc_issue_reasons (org_id, name, name_ar, account_id, active, created_by)
    values (v_org, trim(p_name), nullif(trim(coalesce(p_name_ar, '')), ''), p_account_id, p_active, auth.uid()) returning id into v_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'accounting.issue_reason.added', 'issue_reason', v_id::text, format('%s -> %s %s', trim(p_name), a.code, a.name),
            jsonb_build_object('name', trim(p_name), 'account_id', p_account_id));
    return v_id;
  end if;
  select * into r from public.acc_issue_reasons where org_id = v_org and id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.acc_issue_reasons set name = trim(p_name), name_ar = nullif(trim(coalesce(p_name_ar, '')), ''), account_id = p_account_id, active = p_active where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'accounting.issue_reason.changed', 'issue_reason', r.id::text, format('%s -> %s %s', trim(p_name), a.code, a.name),
          jsonb_build_object('name', r.name, 'account_id', r.account_id, 'active', r.active),
          jsonb_build_object('name', trim(p_name), 'account_id', p_account_id, 'active', p_active));
  return r.id;
end $$;

-- Give a stock request its internal-use reason, before it is issued. The requester, or an owner or admin. Audited.
create or replace function public.inv_set_request_reason(p_request_id uuid, p_reason_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']); r public.inv_requests; v_role text;
begin
  select * into r from public.inv_requests where org_id = v_org and id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if r.requester_id <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('submitted', 'approved') then raise exception 'INVALID_STATE'; end if;
  if p_reason_id is not null and not exists (select 1 from public.acc_issue_reasons x where x.org_id = v_org and x.id = p_reason_id and x.active) then
    raise exception 'NOT_FOUND';
  end if;
  if r.issue_reason_id is not distinct from p_reason_id then return; end if;
  update public.inv_requests set issue_reason_id = p_reason_id where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.request.reason_set', 'request', r.id::text, format('%s: internal-use reason set', r.number),
          jsonb_build_object('issue_reason_id', r.issue_reason_id), jsonb_build_object('issue_reason_id', p_reason_id));
end $$;

revoke all on function public.acc_set_category_account(uuid, uuid), public.acc_save_issue_reason(uuid, text, text, uuid, boolean),
  public.inv_set_request_reason(uuid, uuid) from public, anon;
grant execute on function public.acc_set_category_account(uuid, uuid), public.acc_save_issue_reason(uuid, text, text, uuid, boolean),
  public.inv_set_request_reason(uuid, uuid) to authenticated;

commit;

-- Verification (read-only): the posting triggers exist, new tables have RLS and no user writes, internal functions are closed, the
-- changed receive functions are open to signed-in users, and no company has accounting on (so nothing has posted).
select tgname from pg_trigger where tgname like 'acc_post_%' and not tgisinternal order by 1;
select relname, relrowsecurity from pg_class where relname in ('acc_issue_reasons', 'acc_receipt_costs') order by 1;
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name in ('acc_issue_reasons', 'acc_receipt_costs') and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select has_function_privilege('authenticated', 'public.acc__post_move(uuid, bigint, boolean)', 'execute') as users_can_post_moves,
       has_function_privilege('authenticated', 'public.inv_receive_stock(uuid, uuid, numeric, text, bigint)', 'execute') as users_can_receive,
       has_function_privilege('anon', 'public.inv_receive_stock(uuid, uuid, numeric, text, bigint)', 'execute') as anon_can_receive;
select count(*) as accounting_on, (select count(*) from public.acc_entries) as entries from public.org_modules where module_key = 'accounting';
