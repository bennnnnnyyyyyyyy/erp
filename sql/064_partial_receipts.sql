-- sql/064_partial_receipts.sql
-- Receive part of a purchase order (UX decision D3, Ben 9 Nov 2026). Rerun-safe. Needs sql/001-063.
--
-- Until now an order was received all at once. Now each line remembers how much has arrived (received_qty), and the person receiving
-- enters what actually came and answers "Is the rest still coming?":
--   yes -> the order stays open ('ordered'; the screens call it "Partly received") and can be received again later;
--   no  -> the order is closed as received, short. Nothing more can arrive on it.
-- No new statuses, so the order guard and every report that reads the status keep working.
-- Changes:
--   * pur_order_lines.received_qty, backfilled to the full quantity for orders already received;
--   * pur_receive_lines (new): receive the quantities given, per line;
--   * pur_receive_order: "receive everything" now receives what is still to come (the same as before for a fresh order);
--   * pur_cancel_order: an order with something received cannot be cancelled (that stock is real); close it short instead;
--   * pur_record_supplier_invoice: bills against what has arrived, also while the rest is still coming;
--   * inv__forecast_for: "on order" counts only what has not arrived yet.

begin;

alter table public.pur_order_lines add column if not exists received_qty numeric(18, 3) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pur_order_lines_received_qty_check' and conrelid = 'public.pur_order_lines'::regclass) then
    alter table public.pur_order_lines add constraint pur_order_lines_received_qty_check check (received_qty >= 0 and received_qty <= qty);
  end if;
end $$;

-- Orders received before this migration were received in full.
update public.pur_order_lines pl set received_qty = pl.qty
  from public.pur_orders po
 where po.org_id = pl.org_id and po.id = pl.order_id and po.status = 'received' and pl.received_qty = 0;

-- Receive what arrived. p_lines: [{"lineId": uuid, "qty": number}], qty 0 or more and no more than is still to come.
-- p_rest_coming false closes the order; it may then carry no quantities at all (closing an order that is partly received).
create or replace function public.pur_receive_lines(p_order_id uuid, p_lines jsonb, p_rest_coming boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.pur__guard(array['owner', 'admin', 'member']);
  v_order   public.pur_orders%rowtype;
  v_line    jsonb;
  v_line_id uuid;
  v_qty     numeric;
  l         public.pur_order_lines;
  v_got     numeric := 0;
  v_count   int := 0;
  v_left    numeric;
  v_closed  boolean;
begin
  if p_rest_coming is null or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
  select * into v_order from public.pur_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_order.status <> 'ordered' then raise exception 'INVALID_STATE'; end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin
      v_line_id := (v_line ->> 'lineId')::uuid; v_qty := coalesce((v_line ->> 'qty')::numeric, 0);
    exception when others then raise exception 'INVALID_INPUT';
    end;
    if v_qty < 0 then raise exception 'INVALID_INPUT'; end if;
    continue when v_qty = 0;
    select * into l from public.pur_order_lines where org_id = v_org and order_id = v_order.id and id = v_line_id for update;
    if not found then raise exception 'INVALID_INPUT' using detail = 'that line is not on this order'; end if;
    if l.received_qty + v_qty > l.qty then raise exception 'INVALID_INPUT' using detail = 'more than is still to come on this order'; end if;
    perform public.inv__receipt(v_org, l.item_id, v_order.warehouse_id, v_qty, v_order.number, l.unit_cost_minor, v_order.id);
    perform public.inv__apply_cost(v_org, l.item_id, v_qty, l.unit_cost_minor, v_order.number);
    update public.pur_order_lines set received_qty = received_qty + v_qty where id = l.id;
    v_got := v_got + v_qty; v_count := v_count + 1;
  end loop;

  select coalesce(sum(qty - received_qty), 0) into v_left from public.pur_order_lines where org_id = v_org and order_id = v_order.id;
  if v_got = 0 and (p_rest_coming or v_left = (select sum(qty) from public.pur_order_lines where org_id = v_org and order_id = v_order.id)) then
    -- Nothing arrived: nothing to record. Closing an order where nothing ever arrived is a cancellation, not a receipt.
    raise exception 'INVALID_INPUT' using detail = 'enter what arrived, or cancel the order';
  end if;

  v_closed := v_left = 0 or not p_rest_coming;
  if v_closed then
    update public.pur_orders set status = 'received', received_by = auth.uid(), received_at = now() where id = v_order.id;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), case when v_closed then 'purchasing.order.received' else 'purchasing.order.partly_received' end, 'purchase_order', v_order.id::text,
          format('%s: %s received on %s line(s)%s', v_order.number, v_got, v_count,
                 case when v_left = 0 then '; complete' when v_closed then format('; closed short, %s will not come', v_left) else format('; %s still to come', v_left) end));
  return jsonb_build_object('status', case when v_closed then 'received' else 'ordered' end, 'stillToCome', case when v_closed then 0 else v_left end);
end $$;

-- Receive everything that is still to come (the old one-click receipt).
create or replace function public.pur_receive_order(p_order_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin','member']); v_order public.pur_orders%rowtype; l record;
begin
  select * into v_order from public.pur_orders where org_id=v_org and id=p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if; if v_order.status <> 'ordered' then raise exception 'INVALID_STATE'; end if;
  for l in select id,item_id,qty-received_qty as qty,unit_cost_minor from public.pur_order_lines where org_id=v_org and order_id=v_order.id and received_qty < qty order by item_id for update loop
    perform public.inv__receipt(v_org,l.item_id,v_order.warehouse_id,l.qty,v_order.number,l.unit_cost_minor,v_order.id);
    perform public.inv__apply_cost(v_org,l.item_id,l.qty,l.unit_cost_minor,v_order.number);
    update public.pur_order_lines set received_qty = qty where id = l.id;
  end loop;
  update public.pur_orders set status='received',received_by=auth.uid(),received_at=now() where id=v_order.id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.received','purchase_order',v_order.id::text,format('%s received into stock',v_order.number));
end $$;

-- As sql/017, but an order with something received cannot be cancelled.
create or replace function public.pur_cancel_order(p_order_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner','admin']); v_order public.pur_orders%rowtype;
begin
  select * into v_order from public.pur_orders where org_id=v_org and id=p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if; if v_order.status <> 'ordered' then raise exception 'INVALID_STATE'; end if;
  if exists (select 1 from public.pur_order_lines where org_id=v_org and order_id=v_order.id and received_qty > 0) then
    raise exception 'INVALID_STATE' using detail = 'part of this order was received; close it instead';
  end if;
  update public.pur_orders set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now() where id=v_order.id;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.order.cancelled','purchase_order',v_order.id::text,format('%s cancelled',v_order.number));
end $$;

-- As sql/018, but billing is capped by what has arrived (received_qty), and an order that is still partly coming can be billed.
create or replace function public.pur_record_supplier_invoice(p_supplier_id uuid,p_order_id uuid,p_number text,p_invoice_date date,p_lines jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.pur__guard(array['owner','admin']); v_order public.pur_orders%rowtype; v_invoice uuid; v_line jsonb; v_order_line uuid; v_qty numeric; v_cost bigint; v_item uuid; v_received numeric; v_billed numeric; v_count int:=0; v_total bigint:=0;
begin
  if length(trim(coalesce(p_number,'')))=0 or p_invoice_date is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'INVALID_INPUT'; end if;
  select * into v_order from public.pur_orders po where po.org_id=v_org and po.id=p_order_id and po.supplier_id=p_supplier_id
     and (po.status='received' or (po.status='ordered' and exists(select 1 from public.pur_order_lines x where x.org_id=v_org and x.order_id=po.id and x.received_qty>0))) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.pur_supplier_invoices where org_id=v_org and supplier_id=p_supplier_id and lower(number)=lower(trim(p_number))) then raise exception 'DUPLICATE_INVOICE'; end if;
  insert into public.pur_supplier_invoices(org_id,number,supplier_id,order_id,invoice_date,currency,created_by) values(v_org,trim(p_number),p_supplier_id,p_order_id,p_invoice_date,v_order.currency,auth.uid()) returning id into v_invoice;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin v_order_line:=(v_line->>'orderLineId')::uuid; v_qty:=(v_line->>'qty')::numeric; exception when others then raise exception 'INVALID_INPUT'; end;
    if v_qty<=0 then raise exception 'INVALID_INPUT'; end if;
    select item_id,unit_cost_minor,received_qty into v_item,v_cost,v_received from public.pur_order_lines where org_id=v_org and order_id=p_order_id and id=v_order_line;
    if not found then raise exception 'INVALID_INPUT'; end if;
    select coalesce(sum(il.qty),0) into v_billed from public.pur_supplier_invoice_lines il join public.pur_supplier_invoices inv on inv.org_id=il.org_id and inv.id=il.invoice_id where il.org_id=v_org and il.order_line_id=v_order_line;
    if v_billed+v_qty>v_received then raise exception 'BILL_QTY_EXCEEDS_RECEIVED'; end if;
    insert into public.pur_supplier_invoice_lines(org_id,invoice_id,order_line_id,qty,unit_cost_minor) values(v_org,v_invoice,v_order_line,v_qty,v_cost);
    v_count:=v_count+1; v_total:=v_total+(v_qty*v_cost)::bigint;
  end loop;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.supplier_invoice.recorded','supplier_invoice',v_invoice::text,format('Invoice %s recorded for %s minor units across %s line(s)',trim(p_number),v_total,v_count));
  return v_invoice;
end $$;

-- As sql/030, with "on order" = what has not arrived yet on open orders.
create or replace function public.inv__forecast_for(v_org uuid)
returns table (item_id uuid, sku text, name text, uom text, available numeric, daily_rate numeric, days_of_cover int, runs_out_on date, history_days int, issues_count int, confidence text, lead_days int, on_order numeric, suggested_order numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with usage as (
    select m.item_id,
           sum(-m.qty) filter (where m.posted_at >= now() - interval '30 days') as p1,
           sum(-m.qty) filter (where m.posted_at < now() - interval '30 days' and m.posted_at >= now() - interval '60 days') as p2,
           sum(-m.qty) filter (where m.posted_at < now() - interval '60 days') as p3,
           count(*) as n, min(m.posted_at)::date as first_at
      from public.inv_stock_moves m
     where m.org_id = v_org and m.kind = 'issue' and m.posted_at >= now() - interval '90 days'
     group by m.item_id),
  stock as (
    select b.item_id, sum(b.on_hand - b.reserved) as avail from public.inv_stock_balances b where b.org_id = v_org group by b.item_id),
  lead as (
    select pl.item_id, round(avg(extract(epoch from (po.received_at - po.created_at)) / 86400))::int as days
      from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id
     where po.org_id = v_org and po.status = 'received' and po.received_at >= now() - interval '12 months' group by pl.item_id),
  ordered as (
    select pl.item_id, sum(pl.qty - pl.received_qty) as qty from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id
     where po.org_id = v_org and po.status = 'ordered' group by pl.item_id),
  calc as (
    select it.id, it.sku, it.name, it.uom, coalesce(s.avail, 0) as avail,
           (0.5 * coalesce(u.p1, 0) + 0.3 * coalesce(u.p2, 0) + 0.2 * coalesce(u.p3, 0)) / 30.0 as rate,
           coalesce(u.n, 0)::int as n, coalesce(current_date - u.first_at, 0)::int as hist,
           coalesce(l.days, 7)::int as lead, coalesce(o.qty, 0) as ord
      from public.inv_items it left join usage u on u.item_id = it.id left join stock s on s.item_id = it.id left join lead l on l.item_id = it.id left join ordered o on o.item_id = it.id
     where it.org_id = v_org and it.deleted_at is null)
  select c.id, c.sku, c.name, c.uom, c.avail, round(c.rate, 4),
         case when c.rate > 0 then least(floor(greatest(c.avail, 0) / c.rate), 3650)::int end,
         case when c.rate > 0 then current_date + least(floor(greatest(c.avail, 0) / c.rate), 3650)::int end,
         c.hist, c.n,
         case when c.rate <= 0 then 'none' when c.n >= 8 and c.hist >= 60 then 'good' else 'thin' end,
         c.lead, c.ord,
         case when c.rate > 0 then greatest(0, ceil(c.rate * (c.lead + 7) - c.avail - c.ord)) end
    from calc c
   order by case when c.rate > 0 then floor(greatest(c.avail, 0) / c.rate) end nulls last, c.sku;
end $$;

revoke all on function public.inv__forecast_for(uuid) from public, anon, authenticated;
revoke all on function public.pur_receive_lines(uuid, jsonb, boolean), public.pur_receive_order(uuid), public.pur_cancel_order(uuid),
  public.pur_record_supplier_invoice(uuid, uuid, text, date, jsonb) from public, anon;
grant execute on function public.pur_receive_lines(uuid, jsonb, boolean), public.pur_receive_order(uuid), public.pur_cancel_order(uuid),
  public.pur_record_supplier_invoice(uuid, uuid, text, date, jsonb) to authenticated;

commit;

-- Verification (read-only).
select count(*) filter (where po.status = 'received' and pl.received_qty <> pl.qty) as received_orders_not_full,
       count(*) filter (where po.status <> 'received' and pl.received_qty <> 0) as open_orders_with_receipts
  from public.pur_order_lines pl join public.pur_orders po on po.org_id = pl.org_id and po.id = pl.order_id;
select has_function_privilege('anon', 'public.pur_receive_lines(uuid, jsonb, boolean)', 'execute') as anon_receives;
