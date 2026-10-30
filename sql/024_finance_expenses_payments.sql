-- 024_finance_expenses_payments.sql
-- Slice F, part 2 (documentation/plans/OWNER_INSIGHTS_PLAN.md section 4): expenses and payments, the other half of "am I making
-- or losing". New module `finance`. Expenses are recorded by category (rent, salaries, utilities, transport...). Payments record
-- money received against a customer invoice, or money paid against a supplier invoice or an expense. Rules enforced here:
-- amounts are positive integer minor units; currency comes from the document being paid; a payment can never exceed what is
-- still owed; void documents cannot be paid; nothing is edited or deleted, only voided; every change is audited. Money data is
-- visible to owner/admin only (members and viewers get nothing, enforced by row level security).
-- Depends on sql/001-023. Rerun-safe. Run the whole file, then sql/tests/020_finance_expenses_payments.sql.

begin;

-- ---------------------------------------------------------------- categories
create table if not exists public.fin_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  name       text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index if not exists fin_categories_org_name_uq on public.fin_categories(org_id, lower(name));

-- ---------------------------------------------------------------- expenses
create table if not exists public.fin_expenses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  number       text not null,
  expense_date date not null,
  category_id  uuid not null,
  supplier_id  uuid,
  amount_minor bigint not null check (amount_minor > 0),
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  note         text,
  status       text not null default 'recorded' check (status in ('recorded', 'void')),
  voided_at    timestamptz,
  voided_by    uuid references auth.users(id),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, category_id) references public.fin_categories(org_id, id),
  foreign key (org_id, supplier_id) references public.pur_suppliers(org_id, id)
);

-- ---------------------------------------------------------------- payments
create table if not exists public.fin_payments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  number              text not null,
  direction           text not null check (direction in ('in', 'out')),
  amount_minor        bigint not null check (amount_minor > 0),
  currency            char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_on             date not null,
  method              text not null check (method in ('cash', 'bank', 'card', 'cheque', 'other')),
  customer_invoice_id uuid,
  supplier_invoice_id uuid,
  expense_id          uuid,
  note                text,
  status              text not null default 'recorded' check (status in ('recorded', 'void')),
  voided_at           timestamptz,
  voided_by           uuid references auth.users(id),
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, customer_invoice_id) references public.sal_invoices(org_id, id),
  foreign key (org_id, supplier_invoice_id) references public.pur_supplier_invoices(org_id, id),
  foreign key (org_id, expense_id) references public.fin_expenses(org_id, id),
  -- money in is always for a customer invoice; money out is for exactly one of a supplier invoice or an expense
  check (
    (direction = 'in'  and customer_invoice_id is not null and supplier_invoice_id is null and expense_id is null) or
    (direction = 'out' and customer_invoice_id is null and ((supplier_invoice_id is not null)::int + (expense_id is not null)::int) = 1)
  )
);

create index if not exists fin_expenses_org_date_idx on public.fin_expenses(org_id, expense_date desc);
create index if not exists fin_payments_org_date_idx on public.fin_payments(org_id, paid_on desc);
create index if not exists fin_payments_org_cinv_idx on public.fin_payments(org_id, customer_invoice_id);
create index if not exists fin_payments_org_sinv_idx on public.fin_payments(org_id, supplier_invoice_id);
create index if not exists fin_payments_org_exp_idx on public.fin_payments(org_id, expense_id);

alter table public.fin_categories enable row level security;
alter table public.fin_expenses enable row level security;
alter table public.fin_payments enable row level security;
revoke all on public.fin_categories, public.fin_expenses, public.fin_payments from anon, authenticated;
grant select on public.fin_categories, public.fin_expenses, public.fin_payments to authenticated;

-- Money is for owner/admin only.
drop policy if exists fin_categories_finance_read on public.fin_categories;
create policy fin_categories_finance_read on public.fin_categories for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = fin_categories.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')));
drop policy if exists fin_expenses_finance_read on public.fin_expenses;
create policy fin_expenses_finance_read on public.fin_expenses for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = fin_expenses.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')));
drop policy if exists fin_payments_finance_read on public.fin_payments;
create policy fin_payments_finance_read on public.fin_payments for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = fin_payments.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')));

-- ---------------------------------------------------------------- functions
create or replace function public.fin__guard() returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := public.require_org_role(array['owner', 'admin']);
begin
  if not exists (select 1 from public.org_modules where org_id = v and module_key = 'finance' and disabled_at is null) then raise exception 'MODULE_DISABLED'; end if;
  return v;
end $$;

create or replace function public.fin__next(p_org uuid, p_key text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.inv_counters (org_id, key, value) values (p_org, p_key, 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v;
  return p_prefix || lpad(v::text, 4, '0');
end $$;

create or replace function public.fin_create_category(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard(); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT'; end if;
  insert into public.fin_categories (org_id, name) values (v_org, trim(p_name)) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.category.created', 'finance_category', v_id::text, trim(p_name));
  return v_id;
exception when unique_violation then raise exception 'DUPLICATE';
end $$;

create or replace function public.fin_record_expense(p_date date, p_category_id uuid, p_amount_minor bigint, p_supplier_id uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard(); v_cur char(3); v_id uuid; v_no text;
begin
  if p_date is null or p_amount_minor is null or p_amount_minor <= 0 then raise exception 'INVALID_INPUT'; end if;
  if not exists (select 1 from public.fin_categories where org_id = v_org and id = p_category_id) then raise exception 'NOT_FOUND'; end if;
  if p_supplier_id is not null and not exists (select 1 from public.pur_suppliers where org_id = v_org and id = p_supplier_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  select default_currency into v_cur from public.organizations where id = v_org;
  v_no := public.fin__next(v_org, 'expense', 'EXP-');
  insert into public.fin_expenses (org_id, number, expense_date, category_id, supplier_id, amount_minor, currency, note, created_by)
  values (v_org, v_no, p_date, p_category_id, p_supplier_id, p_amount_minor, v_cur, nullif(trim(p_note), ''), auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.expense.recorded', 'finance_expense', v_id::text, format('%s: %s minor units %s on %s', v_no, p_amount_minor, v_cur, p_date));
  return jsonb_build_object('id', v_id, 'number', v_no);
end $$;

create or replace function public.fin_void_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard(); e public.fin_expenses%rowtype;
begin
  select * into e from public.fin_expenses where org_id = v_org and id = p_expense_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.status = 'void' then raise exception 'INVALID_STATE'; end if;
  if exists (select 1 from public.fin_payments where org_id = v_org and expense_id = e.id and status = 'recorded') then raise exception 'HAS_PAYMENTS'; end if;
  update public.fin_expenses set status = 'void', voided_at = now(), voided_by = auth.uid() where id = e.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.expense.voided', 'finance_expense', e.id::text, format('%s voided', e.number));
end $$;

-- p_direction 'in' needs p_customer_invoice_id; 'out' needs exactly one of p_supplier_invoice_id or p_expense_id.
create or replace function public.fin_record_payment(p_direction text, p_amount_minor bigint, p_paid_on date, p_method text,
  p_customer_invoice_id uuid default null, p_supplier_invoice_id uuid default null, p_expense_id uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.fin__guard();
  v_cur char(3); v_total bigint; v_paid bigint; v_id uuid; v_no text;
begin
  if p_amount_minor is null or p_amount_minor <= 0 or p_paid_on is null or p_method not in ('cash', 'bank', 'card', 'cheque', 'other') then raise exception 'INVALID_INPUT'; end if;

  if p_direction = 'in' then
    if p_customer_invoice_id is null or p_supplier_invoice_id is not null or p_expense_id is not null then raise exception 'INVALID_INPUT'; end if;
    select i.currency into v_cur from public.sal_invoices i where i.org_id = v_org and i.id = p_customer_invoice_id and i.status = 'issued' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    select coalesce(sum(round(l.qty * l.unit_price_minor)), 0)::bigint into v_total from public.sal_invoice_lines l where l.org_id = v_org and l.invoice_id = p_customer_invoice_id;
    select coalesce(sum(amount_minor), 0) into v_paid from public.fin_payments where org_id = v_org and customer_invoice_id = p_customer_invoice_id and status = 'recorded';
  elsif p_direction = 'out' then
    if ((p_supplier_invoice_id is not null)::int + (p_expense_id is not null)::int) <> 1 or p_customer_invoice_id is not null then raise exception 'INVALID_INPUT'; end if;
    if p_supplier_invoice_id is not null then
      select i.currency into v_cur from public.pur_supplier_invoices i where i.org_id = v_org and i.id = p_supplier_invoice_id for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      select coalesce(sum(round(l.qty * l.unit_cost_minor)), 0)::bigint into v_total from public.pur_supplier_invoice_lines l where l.org_id = v_org and l.invoice_id = p_supplier_invoice_id;
      select coalesce(sum(amount_minor), 0) into v_paid from public.fin_payments where org_id = v_org and supplier_invoice_id = p_supplier_invoice_id and status = 'recorded';
    else
      select e.currency, e.amount_minor into v_cur, v_total from public.fin_expenses e where e.org_id = v_org and e.id = p_expense_id and e.status = 'recorded' for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      select coalesce(sum(amount_minor), 0) into v_paid from public.fin_payments where org_id = v_org and expense_id = p_expense_id and status = 'recorded';
    end if;
  else
    raise exception 'INVALID_INPUT';
  end if;

  if v_paid + p_amount_minor > v_total then raise exception 'OVERPAYMENT'; end if;

  v_no := public.fin__next(v_org, 'payment', 'PAY-');
  insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, supplier_invoice_id, expense_id, note, created_by)
  values (v_org, v_no, p_direction, p_amount_minor, v_cur, p_paid_on, p_method, p_customer_invoice_id, p_supplier_invoice_id, p_expense_id, nullif(trim(p_note), ''), auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.payment.recorded', 'finance_payment', v_id::text, format('%s %s: %s minor units %s by %s', v_no, case p_direction when 'in' then 'received' else 'paid' end, p_amount_minor, v_cur, p_method));
  return jsonb_build_object('id', v_id, 'number', v_no);
end $$;

create or replace function public.fin_void_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard(); p public.fin_payments%rowtype;
begin
  select * into p from public.fin_payments where org_id = v_org and id = p_payment_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.status = 'void' then raise exception 'INVALID_STATE'; end if;
  update public.fin_payments set status = 'void', voided_at = now(), voided_by = auth.uid() where id = p.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.payment.voided', 'finance_payment', p.id::text, format('%s voided', p.number));
end $$;

revoke all on function public.fin__guard(), public.fin__next(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fin_create_category(text), public.fin_record_expense(date, uuid, bigint, uuid, text), public.fin_void_expense(uuid),
  public.fin_record_payment(text, bigint, date, text, uuid, uuid, uuid, text), public.fin_void_payment(uuid) from public, anon;
grant execute on function public.fin_create_category(text), public.fin_record_expense(date, uuid, bigint, uuid, text), public.fin_void_expense(uuid),
  public.fin_record_payment(text, bigint, date, text, uuid, uuid, uuid, text), public.fin_void_payment(uuid) to authenticated;

-- "All apps on" now includes finance (same function as sql/021 plus one key).
create or replace function public.core_enable_all_modules(p_org_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k text; n int := 0;
begin
  if not exists (select 1 from public.organizations where id = p_org_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  foreach k in array array['inventory', 'tasks', 'messaging', 'purchasing', 'sales', 'finance'] loop
    if not exists (select 1 from public.org_modules where org_id = p_org_id and module_key = k and disabled_at is null) then
      insert into public.org_modules (org_id, module_key, enabled_at, disabled_at) values (p_org_id, k, now(), null)
      on conflict (org_id, module_key) do update set enabled_at = now(), disabled_at = null;
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
      values (p_org_id, 'module.enabled', 'module', k, k || ' switched on (all apps on by default)');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

commit;

-- Verification (read-only): three tables with RLS (expect three rows); members cannot call the money functions' tables.
select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('fin_categories', 'fin_expenses', 'fin_payments') and relrowsecurity order by relname;
