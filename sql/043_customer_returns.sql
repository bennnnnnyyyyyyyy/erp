-- 043_customer_returns.sql
-- S4 of documentation/plans/SUPERFIX_WORKFLOW_PLAN.md: goods a customer returns come back into stock through a credit note.
--   * sal_submit_return_note(invoice, reason, lines) raises a CREDIT note exactly as sal_submit_note (sql/037) does, and records per
--     line how much comes back and into which warehouse (sal_note_returns). Debit notes never move stock.
--   * Limit: per sales order and item, returned (waiting or approved) never exceeds what was issued for that order; checked when the
--     note is submitted and again when it is approved.
--   * When the note is approved (sal_decide_note, unchanged), an AFTER trigger posts one 'return_in' move per return line in the same
--     transaction, at the unit cost of the original issue (decision D5), updates the balance and the average cost, and writes an audit
--     row per move. If the check fails at approval, the whole approval is refused.
--   * Batch-tracked items go back into the batch that supplied most of the original issue (v1; one batch per return line).
--   * The ledger guard refuses a 'return_in' move unless its note is approved.
-- Depends on sql/001-042. Rerun-safe. Run the whole file, then sql/tests/038_customer_returns.sql.

begin;

create table if not exists public.sal_note_returns (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  note_id         uuid not null,
  invoice_line_id uuid not null,
  item_id         uuid not null,
  order_id        uuid not null,
  warehouse_id    uuid not null,
  qty             numeric(18, 3) not null check (qty > 0),
  created_at      timestamptz not null default now(),
  unique (note_id, invoice_line_id),
  foreign key (org_id, note_id) references public.sal_notes (org_id, id),
  foreign key (org_id, invoice_line_id) references public.sal_invoice_lines (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id),
  foreign key (org_id, order_id) references public.sal_orders (org_id, id),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id)
);
create index if not exists sal_note_returns_order_item_idx on public.sal_note_returns (org_id, order_id, item_id);
alter table public.sal_note_returns enable row level security;
revoke all on public.sal_note_returns from anon, authenticated;
grant select on public.sal_note_returns to authenticated;
drop policy if exists sal_note_returns_member_read on public.sal_note_returns;
create policy sal_note_returns_member_read on public.sal_note_returns for select to authenticated using (public.is_org_member(org_id));
drop trigger if exists sal_note_returns_append_only on public.sal_note_returns;
create trigger sal_note_returns_append_only before update or delete on public.sal_note_returns for each statement execute function public.inv_append_only();
drop trigger if exists sal_note_returns_no_truncate on public.sal_note_returns;
create trigger sal_note_returns_no_truncate before truncate on public.sal_note_returns for each statement execute function public.inv_append_only();

-- The ledger gains 'return_in' (positive, names its note).
alter table public.inv_stock_moves add column if not exists note_id uuid;
alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_note_fk;
alter table public.inv_stock_moves add constraint inv_stock_moves_note_fk foreign key (org_id, note_id) references public.sal_notes (org_id, id);
alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_kind_check;
alter table public.inv_stock_moves add constraint inv_stock_moves_kind_check check (kind in ('receipt', 'issue', 'adjust', 'transfer_out', 'transfer_in', 'return_in'));
alter table public.inv_stock_moves drop constraint if exists inv_stock_moves_check;
alter table public.inv_stock_moves add constraint inv_stock_moves_check check (
  (kind = 'receipt' and qty > 0)
  or (kind = 'issue' and qty < 0 and request_id is not null)
  or (kind = 'adjust' and qty <> 0 and ((adjustment_id is not null)::int + (count_id is not null)::int) = 1)
  or (kind = 'transfer_out' and qty < 0 and transfer_id is not null)
  or (kind = 'transfer_in' and qty > 0 and transfer_id is not null)
  or (kind = 'return_in' and qty > 0 and note_id is not null)
);

-- sql/042's guard plus: a 'return_in' move needs its credit note to be approved.
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
  elsif new.kind = 'return_in' then
    select n.status into v_status from public.sal_notes n where n.org_id = new.org_id and n.id = new.note_id and n.kind = 'credit';
    if v_status is distinct from 'approved' then raise exception 'APPROVAL_REQUIRED'; end if;
  end if;
  return new;
end $$;

-- The cost log learns a third source.
alter table public.inv_cost_log drop constraint if exists inv_cost_log_source_check;
alter table public.inv_cost_log add constraint inv_cost_log_source_check check (source in ('purchase_receipt', 'manual', 'customer_return'));

-- Issued for one sales order and item (from the ledger), and returned so far (waiting or approved notes; p_exclude_note left out).
create or replace function public.sal__issued_for(p_org uuid, p_order uuid, p_item uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(-sum(mv.qty), 0) from public.inv_stock_moves mv
   where mv.org_id = p_org and mv.kind = 'issue' and mv.item_id = p_item
     and mv.request_id in (select so.request_id from public.sal_orders so where so.org_id = p_org and so.id = p_order and so.request_id is not null)
$$;
create or replace function public.sal__returned_for(p_org uuid, p_order uuid, p_item uuid, p_exclude_note uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.qty), 0) from public.sal_note_returns r join public.sal_notes n on n.org_id = r.org_id and n.id = r.note_id
   where r.org_id = p_org and r.order_id = p_order and r.item_id = p_item and n.status in ('submitted', 'approved')
     and (p_exclude_note is null or r.note_id <> p_exclude_note)
$$;

-- Raise a credit note that also returns goods. p_lines: [{ "invoiceLineId", "qty", "unitPriceMinor"?, "returnQty", "warehouseId" }].
-- qty is what is credited (money); returnQty (0..qty) is what comes back into stock. Lines with returnQty 0 credit money only.
create or replace function public.sal_submit_return_note(p_invoice_id uuid, p_reason text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
  v_note jsonb; v_note_id uuid; r record; il record; v_issued numeric; v_returned numeric; v_n int := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT' using detail = 'add at least one line'; end if;
  -- the credit note itself, with all of sql/037's checks (and its own audit row)
  v_note := public.sal_submit_note(p_invoice_id, 'credit', p_reason, p_lines);
  v_note_id := (v_note ->> 'id')::uuid;

  for r in
    select (x ->> 'invoiceLineId')::uuid as line_id, sum(coalesce((x ->> 'returnQty')::numeric, 0)) as rqty,
           sum((x ->> 'qty')::numeric) as qty, max(x ->> 'warehouseId') as wh
      from jsonb_array_elements(p_lines) x group by 1 order by 1
  loop
    continue when r.rqty = 0;
    if r.rqty < 0 or r.rqty > r.qty then raise exception 'INVALID_INPUT' using detail = 'returnQty must be between 0 and the credited quantity'; end if;
    if r.wh is null or not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = r.wh::uuid and w.deleted_at is null) then
      raise exception 'INVALID_INPUT' using detail = 'a warehouse to return into is required';
    end if;
    select l.id, ol.item_id, ol.order_id into il
      from public.sal_invoice_lines l join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
     where l.org_id = v_org and l.id = r.line_id;
    v_issued := public.sal__issued_for(v_org, il.order_id, il.item_id);
    v_returned := public.sal__returned_for(v_org, il.order_id, il.item_id);
    if v_returned + r.rqty > v_issued then
      raise exception 'RETURN_EXCEEDS_ISSUED' using detail = format('%s delivered, %s already returned or waiting, %s requested', v_issued, v_returned, r.rqty);
    end if;
    insert into public.sal_note_returns (org_id, note_id, invoice_line_id, item_id, order_id, warehouse_id, qty)
    values (v_org, v_note_id, il.id, il.item_id, il.order_id, r.wh::uuid, r.rqty);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'INVALID_INPUT' using detail = 'nothing is returned: use a plain credit note'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.note.return_requested', 'sales_note', v_note_id::text, format('%s: %s line(s) to come back into stock when approved', v_note ->> 'number', v_n));
  return v_note || jsonb_build_object('returnLines', v_n);
end $$;

-- Posts the returns when a credit note becomes approved (runs inside sal_decide_note's transaction, as the approver).
create or replace function public.sal_notes_post_returns() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record; v_issued numeric; v_returned numeric; v_cost bigint; v_move bigint; v_batch uuid; v_tracked boolean;
  v_total numeric; v_avg bigint; v_new bigint;
begin
  if not (new.kind = 'credit' and new.status = 'approved' and old.status = 'submitted') then return null; end if;
  for r in select * from public.sal_note_returns x where x.org_id = new.org_id and x.note_id = new.id order by x.item_id loop
    v_issued := public.sal__issued_for(new.org_id, r.order_id, r.item_id);
    v_returned := public.sal__returned_for(new.org_id, r.order_id, r.item_id, new.id);
    if v_returned + r.qty > v_issued then
      raise exception 'RETURN_EXCEEDS_ISSUED' using detail = format('%s delivered, %s already returned or waiting, %s on this note', v_issued, v_returned, r.qty);
    end if;
    -- cost of the original issue (weighted over that order's issue moves for the item)
    select round(sum(-mv.qty * mv.unit_cost_minor) / nullif(sum(-mv.qty), 0)) into v_cost
      from public.inv_stock_moves mv
     where mv.org_id = new.org_id and mv.kind = 'issue' and mv.item_id = r.item_id
       and mv.request_id in (select so.request_id from public.sal_orders so where so.org_id = new.org_id and so.id = r.order_id);
    select i.tracks_batches, i.avg_cost_minor into v_tracked, v_avg from public.inv_items i where i.org_id = new.org_id and i.id = r.item_id for update;
    v_cost := coalesce(v_cost, v_avg, 0);
    if coalesce(v_tracked, false) then
      select bm.batch_id into v_batch
        from public.inv_batch_moves bm join public.inv_stock_moves mv on mv.id = bm.stock_move_id
       where bm.org_id = new.org_id and mv.kind = 'issue' and mv.item_id = r.item_id
         and mv.request_id in (select so.request_id from public.sal_orders so where so.org_id = new.org_id and so.id = r.order_id)
       group by bm.batch_id order by sum(-bm.qty) desc, bm.batch_id limit 1;
      perform set_config('erp.batch_id', coalesce(v_batch::text, ''), true);
    end if;
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, note_id, ref, posted_by, unit_cost_minor)
    values (new.org_id, r.item_id, r.warehouse_id, r.qty, 'return_in', new.id, new.number, auth.uid(), v_cost)
    returning id into v_move;
    perform set_config('erp.batch_id', '', true);
    insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved) values (new.org_id, r.item_id, r.warehouse_id, r.qty, 0)
    on conflict (org_id, item_id, warehouse_id) do update set on_hand = public.inv_stock_balances.on_hand + r.qty, updated_at = now();
    -- average cost, as for a receipt, logged as a customer return
    select coalesce(sum(on_hand), 0) into v_total from public.inv_stock_balances where org_id = new.org_id and item_id = r.item_id;
    v_new := round((greatest(v_total - r.qty, 0) * v_avg + r.qty * v_cost) / nullif(greatest(v_total - r.qty, 0) + r.qty, 0));
    update public.inv_items set avg_cost_minor = coalesce(v_new, v_cost) where org_id = new.org_id and id = r.item_id;
    insert into public.inv_cost_log (org_id, item_id, source, ref, qty, unit_cost_minor, avg_before_minor, avg_after_minor, created_by)
    values (new.org_id, r.item_id, 'customer_return', new.number, r.qty, v_cost, v_avg, coalesce(v_new, v_cost), auth.uid());
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, metadata)
    values (new.org_id, auth.uid(), 'inventory.stock.returned', 'sales_note', new.id::text,
            format('%s: %s returned into stock at unit cost %s', new.number, r.qty, v_cost),
            jsonb_build_object('item_id', r.item_id, 'warehouse_id', r.warehouse_id, 'stock_move_id', v_move));
  end loop;
  return null;
end $$;
drop trigger if exists sal_notes_post_returns on public.sal_notes;
create trigger sal_notes_post_returns after update of status on public.sal_notes for each row execute function public.sal_notes_post_returns();

revoke all on function public.sal__issued_for(uuid, uuid, uuid), public.sal__returned_for(uuid, uuid, uuid, uuid), public.sal_notes_post_returns(),
  public.inv_stock_moves_guard() from public, anon, authenticated;
revoke all on function public.sal_submit_return_note(uuid, text, jsonb) from public, anon;
grant execute on function public.sal_submit_return_note(uuid, text, jsonb) to authenticated;

commit;

-- Verification (read-only): RLS on the new table, no user write grants, the trigger is present, the submit function is open to users only.
select relname, relrowsecurity from pg_class where relname = 'sal_note_returns';
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name = 'sal_note_returns' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select count(*) as return_trigger from pg_trigger where tgname = 'sal_notes_post_returns' and not tgisinternal;
select has_function_privilege('authenticated', 'public.sal_submit_return_note(uuid, text, jsonb)', 'execute') as users_can_return,
       has_function_privilege('anon', 'public.sal_submit_return_note(uuid, text, jsonb)', 'execute') as anon_can_return;
