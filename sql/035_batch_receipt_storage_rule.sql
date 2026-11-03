-- 035_batch_receipt_storage_rule.sql
-- Makes receiving a batch follow the same storage rule as transfers (sql/034). sql/026 skipped the check when EITHER side had no storage
-- condition set, so a cold-storage item could be received into a warehouse with no condition. Now an item that needs a condition may only be
-- received into a warehouse with exactly that condition. Items with no condition still go anywhere. Same error code (STORAGE_MISMATCH).
-- Scope: only the manual "Receive a batch" function. Purchase-order receiving (sql/017) and the seed data do not use this check and are unchanged.
-- Approved by Ben on 2026-11-02 after a colleague's audit (documentation/reviews/2026-11-02-colleague-audit-response.md), replacing the earlier
-- deliberate "no check when either side is unset" design of sql/026.
-- Depends on sql/001-034. Rerun-safe. Run the whole file, then sql/tests/022_batches_expiry_storage.sql.

begin;

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
  -- An item that needs a storage condition may only be received into a warehouse with exactly that condition; a warehouse with NO condition set is
  -- refused as well. An item with no condition may be received anywhere. (sql/026 skipped the check when either side had no condition.)
  if it.storage_condition_id is not null and wh.storage_condition_id is distinct from it.storage_condition_id then raise exception 'STORAGE_MISMATCH'; end if;
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

revoke all on function public.inv_receive_batch(uuid, uuid, numeric, text, date, date, uuid) from public, anon;
grant execute on function public.inv_receive_batch(uuid, uuid, numeric, text, date, date, uuid) to authenticated;

commit;

-- Verification (read-only): expect true.
select has_function_privilege('authenticated', 'public.inv_receive_batch(uuid,uuid,numeric,text,date,date,uuid)', 'execute') as receive_batch_for_users;
