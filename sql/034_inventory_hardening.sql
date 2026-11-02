-- 034_inventory_hardening.sql
-- Two small fixes found by the 2 Nov 2026 audits.
-- 1. Transfers: sql/033 refused a transfer only when BOTH the item and the destination warehouse had a storage condition and they differed,
--    so a cold-storage item could be sent to a warehouse with no condition set. Now an item that needs a condition can only go to a warehouse
--    with exactly that condition (a destination with none is refused). Items with no condition still go anywhere. Same error code
--    (STORAGE_MISMATCH), new detail text. NOT changed here: batch receipts (sql/026 inv_receive_batch) keep their older rule; changing it is
--    a separate decision (see the audit note in documentation/reviews).
-- 2. sql/023 created the trigger function inv_stock_moves_cost() without revoking the default execute grant, so the anonymous role could
--    execute it. It is a trigger function (it cannot be called directly) and it fires as a trigger regardless, but every other helper is
--    revoked, so this one is too.
-- Depends on sql/001-033. Rerun-safe. Run the whole file, then sql/tests/029_inventory_transfers.sql (which now also covers the rule above).

begin;

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
    -- An item that needs a storage condition may only go to a warehouse that has exactly that condition. A destination with NO condition
    -- set is refused as well (it cannot be shown to satisfy the requirement). An item with no condition may go to any warehouse.
    if it.storage_condition_id is not null and wt.storage_condition_id is distinct from it.storage_condition_id then
      raise exception 'STORAGE_MISMATCH' using detail = case
        when wt.storage_condition_id is null then format('%s needs a storage condition and the destination warehouse has none set', it.sku)
        else format('%s needs a different storage condition than the destination warehouse', it.sku) end;
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

revoke all on function public.inv_submit_transfer(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.inv_submit_transfer(uuid, uuid, text, jsonb) to authenticated;

revoke all on function public.inv_stock_moves_cost() from public, anon, authenticated;

commit;

-- Verification (read-only): expect true, false.
select has_function_privilege('authenticated', 'public.inv_submit_transfer(uuid,uuid,text,jsonb)', 'execute') as submit_transfer_for_users,
       has_function_privilege('anon', 'public.inv_stock_moves_cost()', 'execute') as cost_trigger_fn_for_anon;
