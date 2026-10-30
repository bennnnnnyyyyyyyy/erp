-- 020_sales_retry.sql
-- Closes the Sales gap in documentation/plans/SALES_PLAN.md: when the linked stock request is rejected or cancelled the order
-- can raise a new request (retry), and an order whose request was issued (delivered) can no longer be cancelled.
-- Delivered/approved are derived from the request's status (single source of truth), as the API already does.
-- Depends on sql/001-019. Rerun-safe. Run the whole file, then sql/tests/016_sales_retry.sql.

begin;

create or replace function public.sal_request_stock(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
  o     public.sal_orders%rowtype;
  v_old text;
  v_req jsonb;
begin
  select * into o from public.sal_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' then raise exception 'INVALID_STATE'; end if;
  if o.request_id is null then
    if o.status <> 'open' then raise exception 'INVALID_STATE'; end if;
  else
    select r.status into v_old from public.inv_requests r where r.org_id = v_org and r.id = o.request_id;
    -- only a dead request (rejected or cancelled) may be replaced; a live or issued one blocks a second request
    if v_old is null or v_old not in ('rejected', 'cancelled') then raise exception 'INVALID_STATE'; end if;
  end if;

  select public.inv_submit_request(o.warehouse_id, format('Sales order %s', o.number),
           coalesce(jsonb_agg(jsonb_build_object('itemId', item_id, 'qty', qty) order by item_id), '[]'::jsonb))
    into v_req from public.sal_order_lines where org_id = v_org and order_id = o.id;

  update public.sal_orders set status = 'stock_requested', request_id = (v_req ->> 'id')::uuid where id = o.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.order.stock_requested', 'sales_order', o.id::text,
          format('%s linked to request %s%s', o.number, v_req ->> 'number', case when v_old is null then '' else format(' (retry after %s request)', v_old) end));
  return v_req;
end $$;

create or replace function public.sal_cancel_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
  o     public.sal_orders%rowtype;
  v_rs  text;
begin
  select * into o from public.sal_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' then raise exception 'INVALID_STATE'; end if;
  if o.request_id is not null then
    select r.status into v_rs from public.inv_requests r where r.org_id = v_org and r.id = o.request_id;
    if v_rs = 'issued' then raise exception 'INVALID_STATE'; end if;                       -- already delivered
    if v_rs in ('submitted', 'approved') then perform public.inv_cancel_request(o.request_id); end if;  -- rejected/cancelled: nothing to cancel
  end if;
  update public.sal_orders set status = 'cancelled' where id = o.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.order.cancelled', 'sales_order', o.id::text, format('%s cancelled', o.number));
end $$;

revoke all on function public.sal_request_stock(uuid), public.sal_cancel_order(uuid) from public, anon;
grant execute on function public.sal_request_stock(uuid), public.sal_cancel_order(uuid) to authenticated;

commit;

-- Verification (read-only): both functions exist and anonymous cannot run them (expect two rows, anon_can false).
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('sal_request_stock', 'sal_cancel_order') order by 1;
