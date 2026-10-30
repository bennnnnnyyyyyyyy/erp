-- 018_supplier_invoices.sql: supplier bills against already received purchasing lines.
begin;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='pur_order_lines_org_id_uq' and conrelid='public.pur_order_lines'::regclass) then
    alter table public.pur_order_lines add constraint pur_order_lines_org_id_uq unique(org_id,id);
  end if;
end $$;

create table if not exists public.pur_supplier_invoices (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  number text not null, supplier_id uuid not null, order_id uuid not null,
  invoice_date date not null, currency char(3) not null check(currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(org_id,id), unique(org_id,supplier_id,number),
  foreign key(org_id,supplier_id) references public.pur_suppliers(org_id,id),
  foreign key(org_id,order_id) references public.pur_orders(org_id,id)
);
create table if not exists public.pur_supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  invoice_id uuid not null, order_line_id uuid not null, qty numeric(18,3) not null check(qty > 0),
  unit_cost_minor bigint not null check(unit_cost_minor >= 0), created_at timestamptz not null default now(),
  foreign key(org_id,invoice_id) references public.pur_supplier_invoices(org_id,id),
  foreign key(org_id,order_line_id) references public.pur_order_lines(org_id,id)
);
create index if not exists pur_supplier_invoices_org_order_idx on public.pur_supplier_invoices(org_id,order_id,created_at desc);
create index if not exists pur_supplier_invoice_lines_org_invoice_idx on public.pur_supplier_invoice_lines(org_id,invoice_id);
create index if not exists pur_supplier_invoice_lines_org_order_line_idx on public.pur_supplier_invoice_lines(org_id,order_line_id);

alter table public.pur_supplier_invoices enable row level security;
alter table public.pur_supplier_invoice_lines enable row level security;
revoke all on public.pur_supplier_invoices,public.pur_supplier_invoice_lines from anon,authenticated;
grant select on public.pur_supplier_invoices,public.pur_supplier_invoice_lines to authenticated;
drop policy if exists pur_supplier_invoices_member_read on public.pur_supplier_invoices;
create policy pur_supplier_invoices_member_read on public.pur_supplier_invoices for select to authenticated using(public.is_org_member(org_id));
drop policy if exists pur_supplier_invoice_lines_member_read on public.pur_supplier_invoice_lines;
create policy pur_supplier_invoice_lines_member_read on public.pur_supplier_invoice_lines for select to authenticated using(public.is_org_member(org_id));

create or replace function public.pur_record_supplier_invoice(p_supplier_id uuid,p_order_id uuid,p_number text,p_invoice_date date,p_lines jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.pur__guard(array['owner','admin']); v_order public.pur_orders%rowtype; v_invoice uuid; v_line jsonb; v_order_line uuid; v_qty numeric; v_cost bigint; v_item uuid; v_received numeric; v_billed numeric; v_count int:=0; v_total bigint:=0;
begin
  if length(trim(coalesce(p_number,'')))=0 or p_invoice_date is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'INVALID_INPUT'; end if;
  select * into v_order from public.pur_orders where org_id=v_org and id=p_order_id and supplier_id=p_supplier_id and status='received' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.pur_supplier_invoices where org_id=v_org and supplier_id=p_supplier_id and lower(number)=lower(trim(p_number))) then raise exception 'DUPLICATE_INVOICE'; end if;
  insert into public.pur_supplier_invoices(org_id,number,supplier_id,order_id,invoice_date,currency,created_by) values(v_org,trim(p_number),p_supplier_id,p_order_id,p_invoice_date,v_order.currency,auth.uid()) returning id into v_invoice;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin v_order_line:=(v_line->>'orderLineId')::uuid; v_qty:=(v_line->>'qty')::numeric; exception when others then raise exception 'INVALID_INPUT'; end;
    if v_qty<=0 then raise exception 'INVALID_INPUT'; end if;
    select item_id,unit_cost_minor,qty into v_item,v_cost,v_received from public.pur_order_lines where org_id=v_org and order_id=p_order_id and id=v_order_line;
    if not found then raise exception 'INVALID_INPUT'; end if;
    select coalesce(sum(il.qty),0) into v_billed from public.pur_supplier_invoice_lines il join public.pur_supplier_invoices inv on inv.org_id=il.org_id and inv.id=il.invoice_id where il.org_id=v_org and il.order_line_id=v_order_line;
    if v_billed+v_qty>v_received then raise exception 'BILL_QTY_EXCEEDS_RECEIVED'; end if;
    insert into public.pur_supplier_invoice_lines(org_id,invoice_id,order_line_id,qty,unit_cost_minor) values(v_org,v_invoice,v_order_line,v_qty,v_cost);
    v_count:=v_count+1; v_total:=v_total+(v_qty*v_cost)::bigint;
  end loop;
  insert into public.audit_log(org_id,actor_user_id,action,entity_type,entity_id,summary) values(v_org,auth.uid(),'purchasing.supplier_invoice.recorded','supplier_invoice',v_invoice::text,format('Invoice %s recorded for %s minor units across %s line(s)',trim(p_number),v_total,v_count));
  return v_invoice;
end $$;

revoke all on function public.pur_record_supplier_invoice(uuid,uuid,text,date,jsonb) from public,anon;
grant execute on function public.pur_record_supplier_invoice(uuid,uuid,text,date,jsonb) to authenticated;
commit;

select relname from pg_class where relnamespace='public'::regnamespace and relname in ('pur_supplier_invoices','pur_supplier_invoice_lines') and relrowsecurity order by relname;
