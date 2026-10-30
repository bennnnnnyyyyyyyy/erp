-- 022_customer_invoices.sql
-- Customer invoices for delivered sales orders (documentation/plans/CUSTOMER_INVOICES_PLAN.md).
-- Rules enforced here, not in the app: only a delivered order (its stock request is issued) can be invoiced; the invoiced
-- quantity of a line never exceeds the ordered (= delivered) quantity; the price is copied from the order line; an invoice
-- is never edited or deleted, only voided (which frees its quantity); every change is audited. No tax, payments or credit
-- notes in this slice. Money is integer minor units in the order's currency.
-- Depends on sql/001-021. Rerun-safe. Run the whole file, then sql/tests/018_customer_invoices.sql.

begin;

create table if not exists public.sal_invoices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  number       text not null,
  order_id     uuid not null,
  customer_id  uuid not null,
  invoice_date date not null,
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status       text not null default 'issued' check (status in ('issued', 'void')),
  voided_at    timestamptz,
  voided_by    uuid references auth.users(id),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, order_id) references public.sal_orders(org_id, id),
  foreign key (org_id, customer_id) references public.sal_customers(org_id, id)
);

create table if not exists public.sal_invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  invoice_id       uuid not null,
  order_line_id    uuid not null,
  qty              numeric(18,3) not null check (qty > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  created_at       timestamptz not null default now(),
  foreign key (org_id, invoice_id) references public.sal_invoices(org_id, id),
  foreign key (org_id, order_line_id) references public.sal_order_lines(org_id, id)
);

create index if not exists sal_invoices_org_order_idx on public.sal_invoices(org_id, order_id, created_at desc);
create index if not exists sal_invoice_lines_org_invoice_idx on public.sal_invoice_lines(org_id, invoice_id);
create index if not exists sal_invoice_lines_org_line_idx on public.sal_invoice_lines(org_id, order_line_id);

alter table public.sal_invoices enable row level security;
alter table public.sal_invoice_lines enable row level security;
revoke all on public.sal_invoices, public.sal_invoice_lines from anon, authenticated;
grant select on public.sal_invoices, public.sal_invoice_lines to authenticated;
drop policy if exists sal_invoices_member_read on public.sal_invoices;
create policy sal_invoices_member_read on public.sal_invoices for select to authenticated using (public.is_org_member(org_id));
drop policy if exists sal_invoice_lines_member_read on public.sal_invoice_lines;
create policy sal_invoice_lines_member_read on public.sal_invoice_lines for select to authenticated using (public.is_org_member(org_id));

-- p_lines: [{ "orderLineId": uuid, "qty": number }]. Price comes from the order line, never from the caller.
create or replace function public.sal_create_invoice(p_order_id uuid, p_invoice_date date, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.sal__guard(array['owner', 'admin']);
  o         public.sal_orders%rowtype;
  v_rs      text;
  v_id      uuid;
  v_no      text;
  v_n       bigint;
  e         jsonb;
  v_line    uuid;
  v_qty     numeric;
  v_ordered numeric;
  v_price   bigint;
  v_billed  numeric;
  v_count   int := 0;
  v_total   bigint := 0;
begin
  if p_invoice_date is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT'; end if;

  select * into o from public.sal_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' or o.request_id is null then raise exception 'NOT_DELIVERED'; end if;
  select r.status into v_rs from public.inv_requests r where r.org_id = v_org and r.id = o.request_id;
  if v_rs is distinct from 'issued' then raise exception 'NOT_DELIVERED'; end if;

  insert into public.inv_counters (org_id, key, value) values (v_org, 'sales_invoice', 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v_n;
  v_no := 'INV-' || lpad(v_n::text, 4, '0');

  insert into public.sal_invoices (org_id, number, order_id, customer_id, invoice_date, currency, created_by)
  values (v_org, v_no, o.id, o.customer_id, p_invoice_date, o.currency, auth.uid()) returning id into v_id;

  for e in select value from jsonb_array_elements(p_lines) loop
    begin v_line := (e ->> 'orderLineId')::uuid; v_qty := (e ->> 'qty')::numeric;
    exception when others then raise exception 'INVALID_INPUT'; end;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_INPUT'; end if;
    select l.qty, l.unit_price_minor into v_ordered, v_price from public.sal_order_lines l where l.org_id = v_org and l.order_id = o.id and l.id = v_line;
    if not found then raise exception 'INVALID_INPUT'; end if;
    select coalesce(sum(il.qty), 0) into v_billed
      from public.sal_invoice_lines il join public.sal_invoices i on i.org_id = il.org_id and i.id = il.invoice_id
     where il.org_id = v_org and il.order_line_id = v_line and i.status = 'issued' and i.id <> v_id;
    -- lines of this same invoice count too (the same order line twice in one request)
    select v_billed + coalesce(sum(il.qty), 0) into v_billed from public.sal_invoice_lines il where il.org_id = v_org and il.invoice_id = v_id and il.order_line_id = v_line;
    if v_billed + v_qty > v_ordered then raise exception 'INVOICE_QTY_EXCEEDS_DELIVERED'; end if;
    insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor) values (v_org, v_id, v_line, v_qty, v_price);
    v_count := v_count + 1; v_total := v_total + (v_qty * v_price)::bigint;
  end loop;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.invoice.created', 'sales_invoice', v_id::text, format('%s for %s: %s minor units across %s line(s)', v_no, o.number, v_total, v_count));
  return jsonb_build_object('id', v_id, 'number', v_no);
end $$;

create or replace function public.sal_void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin']);
  i     public.sal_invoices%rowtype;
begin
  select * into i from public.sal_invoices where org_id = v_org and id = p_invoice_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.status = 'void' then raise exception 'INVALID_STATE'; end if;
  update public.sal_invoices set status = 'void', voided_at = now(), voided_by = auth.uid() where id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.invoice.voided', 'sales_invoice', i.id::text, format('%s voided', i.number));
end $$;

revoke all on function public.sal_create_invoice(uuid, date, jsonb), public.sal_void_invoice(uuid) from public, anon;
grant execute on function public.sal_create_invoice(uuid, date, jsonb), public.sal_void_invoice(uuid) to authenticated;

commit;

-- Verification (read-only): both tables have RLS (expect two rows).
select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('sal_invoices', 'sal_invoice_lines') and relrowsecurity order by relname;
