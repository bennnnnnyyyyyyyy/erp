-- 073_pur_order_confirmation.sql
-- Supplier confirmation and promised delivery date (Dynamics review gap 4).
--
-- An owner, admin or member records that the supplier confirmed an order, with the date the supplier promised and, optionally, the
-- supplier's own reference. The date can be changed later (suppliers slip); every change is audited with the old and new date. An open
-- order whose promised date has passed is "late" (pur_late_orders, for screens and alerts). Confirming needs an order that is open and
-- not waiting for approval or rejected (sql/069).
-- Rerun-safe. Ends with read-only checks.

begin;

alter table public.pur_orders add column if not exists promised_date date;
alter table public.pur_orders add column if not exists supplier_ref text;
alter table public.pur_orders add column if not exists confirmed_by uuid references auth.users(id);
alter table public.pur_orders add column if not exists confirmed_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pur_orders_confirmed_complete' and conrelid = 'public.pur_orders'::regclass) then
    alter table public.pur_orders add constraint pur_orders_confirmed_complete
      check (promised_date is null or (confirmed_by is not null and confirmed_at is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_orders_supplier_ref_len' and conrelid = 'public.pur_orders'::regclass) then
    alter table public.pur_orders add constraint pur_orders_supplier_ref_len check (supplier_ref is null or length(supplier_ref) <= 60);
  end if;
end $$;

create or replace function public.pur_confirm_order(p_order_id uuid, p_promised_date date, p_supplier_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.pur__guard(array['owner', 'admin', 'member']);
  o public.pur_orders;
  v_ref text := nullif(trim(coalesce(p_supplier_ref, '')), '');
begin
  if p_promised_date is null then raise exception 'INVALID_INPUT' using detail = 'the promised delivery date is needed'; end if;
  if v_ref is not null and length(v_ref) > 60 then raise exception 'INVALID_INPUT'; end if;
  select * into o from public.pur_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'ordered' or o.approval in ('pending', 'rejected') then
    raise exception 'INVALID_STATE' using detail = 'only an open, approved order can be confirmed';
  end if;
  if p_promised_date < (o.created_at at time zone 'UTC')::date then
    raise exception 'INVALID_INPUT' using detail = 'the promised date is before the order date';
  end if;
  update public.pur_orders
     set promised_date = p_promised_date, supplier_ref = v_ref, confirmed_by = auth.uid(), confirmed_at = now()
   where id = o.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(),
          case when o.promised_date is null then 'purchasing.order.confirmed' else 'purchasing.order.promised_date_changed' end,
          'purchase_order', o.id::text,
          format('%s confirmed by the supplier for %s%s', o.number, p_promised_date, case when v_ref is null then '' else ' (ref ' || v_ref || ')' end),
          jsonb_build_object('promisedDate', o.promised_date, 'supplierRef', o.supplier_ref),
          jsonb_build_object('promisedDate', p_promised_date, 'supplierRef', v_ref));
  return jsonb_build_object('id', o.id, 'promisedDate', p_promised_date, 'supplierRef', v_ref);
end $$;

-- Open orders past their promised date, oldest first (for the "needs you" lists and alerts). Reads with the caller's rights.
create or replace function public.pur_late_orders() returns table (id uuid, number text, supplier_id uuid, promised_date date, days_late int)
language sql stable security invoker set search_path = public as $$
  select o.id, o.number, o.supplier_id, o.promised_date, (current_date - o.promised_date)::int
    from public.pur_orders o
   where o.org_id = public.current_org_id() and o.deleted_at is null and o.status = 'ordered' and o.promised_date < current_date
   order by o.promised_date, o.number;
$$;

revoke all on function public.pur_confirm_order(uuid, date, text), public.pur_late_orders() from public, anon;
grant execute on function public.pur_confirm_order(uuid, date, text), public.pur_late_orders() to authenticated;

commit;

-- Read-only verification.
select has_function_privilege('anon', 'public.pur_confirm_order(uuid, date, text)', 'execute') as anon_confirms,
       has_function_privilege('anon', 'public.pur_late_orders()', 'execute') as anon_reads_late,
       (select count(*) from public.pur_orders where promised_date is not null) as confirmed_orders;
