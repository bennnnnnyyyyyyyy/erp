-- sql/051_treasury.sql
-- Phase 2, slice 2 (documentation/plans/TREASURY_PLAN.md §3.2, §7): treasury accounts (cash boxes, bank accounts, clearing accounts),
-- payments through a treasury account (P13'), transfers between treasury accounts (P18). Rerun-safe. Needs sql/001-050.
--
-- * The `treasury` module needs accounting on: balances are the ledger's (one source of truth). Refused otherwise (trigger on
--   org_modules, like accounting's own guard in sql/045).
-- * trs_accounts: each has its own leaf asset account in the ledger (one treasury account per ledger account). trs_prepare seeds
--   "Main cash box" (cash role), "Main bank account" (bank role) and the four clearing accounts, so nothing already posted moves.
-- * fin_payments.treasury_account_id: required for a new cash or bank payment once treasury is on; must be a treasury account of
--   the matching kind and the payment's currency (trigger, so every path is covered). Card, cheque and "other" keep their clearing
--   roles and take no treasury account. The payment posts its money line to the treasury account's ledger account.
-- * trs_transfers: between two active treasury accounts in the same currency; posts Dr to / Cr from; void reverses it. Lock date.
-- * The database narrows "manage" to the owner and the head accountant (as for the chart); transfers to owners and admins.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.trs_accounts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  code               text not null check (code ~ '^[A-Za-z0-9-]{1,20}$'),
  name               text not null check (length(trim(name)) between 1 and 120),
  name_ar            text check (name_ar is null or length(trim(name_ar)) between 1 and 120),
  kind               text not null check (kind in ('cash', 'bank', 'clearing')),
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),
  branch_id          uuid,
  ledger_account_id  uuid not null,
  bank_name          text check (bank_name is null or length(trim(bank_name)) between 1 and 120),
  bank_account_no    text check (bank_account_no is null or length(trim(bank_account_no)) between 1 and 40),
  active             boolean not null default true,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.core_branches(org_id, id),
  foreign key (org_id, ledger_account_id) references public.acc_accounts(org_id, id)
);
create unique index if not exists trs_accounts_org_code_uq on public.trs_accounts (org_id, upper(code)) where deleted_at is null;
create unique index if not exists trs_accounts_ledger_uq on public.trs_accounts (org_id, ledger_account_id) where deleted_at is null;
drop trigger if exists trs_accounts_updated_at on public.trs_accounts;
create trigger trs_accounts_updated_at before update on public.trs_accounts for each row execute function public.set_updated_at();

create table if not exists public.trs_transfers (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  number           text not null,
  from_account_id  uuid not null,
  to_account_id    uuid not null,
  amount_minor     bigint not null check (amount_minor > 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  transfer_date    date not null,
  note             text check (note is null or length(note) <= 500),
  status           text not null default 'recorded' check (status in ('recorded', 'void')),
  entry_id         uuid,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  voided_by        uuid references auth.users(id),
  voided_at        timestamptz,
  unique (org_id, id),
  unique (org_id, number),
  constraint trs_transfers_two_accounts check (from_account_id <> to_account_id),
  constraint trs_transfers_void_has_who check (status <> 'void' or (voided_by is not null and voided_at is not null)),
  foreign key (org_id, from_account_id) references public.trs_accounts(org_id, id),
  foreign key (org_id, to_account_id) references public.trs_accounts(org_id, id)
);
create index if not exists trs_transfers_org_date_idx on public.trs_transfers (org_id, transfer_date desc);

alter table public.fin_payments add column if not exists treasury_account_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_payments_treasury_fk') then
    alter table public.fin_payments add constraint fin_payments_treasury_fk foreign key (org_id, treasury_account_id) references public.trs_accounts(org_id, id);
  end if;
end $$;
create index if not exists fin_payments_treasury_idx on public.fin_payments (org_id, treasury_account_id) where treasury_account_id is not null;

-- Read: owners, admins (as finance and accounting). No user writes.
alter table public.trs_accounts enable row level security;
alter table public.trs_transfers enable row level security;
revoke all on public.trs_accounts, public.trs_transfers from anon, authenticated;
grant select on public.trs_accounts, public.trs_transfers to authenticated;
drop policy if exists trs_accounts_read on public.trs_accounts;
create policy trs_accounts_read on public.trs_accounts for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists trs_transfers_read on public.trs_transfers;
create policy trs_transfers_read on public.trs_transfers for select to authenticated using (public.acc__can_read(org_id));

-- ---------------------------------------------------------------- module guard: treasury needs accounting

create or replace function public.trs__module_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.module_key = 'treasury' and new.disabled_at is null and not public.acc__enabled(new.org_id) then
    raise exception 'INVALID_STATE' using detail = 'switch accounting on first: treasury balances come from the ledger';
  end if;
  return new;
end $$;
revoke all on function public.trs__module_guard() from public, anon, authenticated;
drop trigger if exists trs_module_guard on public.org_modules;
create trigger trs_module_guard before insert or update on public.org_modules for each row execute function public.trs__module_guard();

-- 'manage' = owner or head accountant (acc__guard 'chart'); 'write' = owner or admin. Both need treasury on.
create or replace function public.trs__guard(p_need text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard(case when p_need = 'manage' then 'chart' else 'read' end);
begin
  if not exists (select 1 from public.org_modules where org_id = v_org and module_key = 'treasury' and disabled_at is null) then raise exception 'MODULE_DISABLED'; end if;
  return v_org;
end $$;
revoke all on function public.trs__guard(text) from public, anon, authenticated;

-- A ledger account's balance (debits minus credits) in one currency, up to a date (null = all).
create or replace function public.trs__ledger_balance(p_org uuid, p_account uuid, p_currency text, p_on date default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
    from public.acc_entry_lines l join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
   where l.org_id = p_org and l.account_id = p_account and e.currency = p_currency and (p_on is null or e.entry_date <= p_on);
$$;
revoke all on function public.trs__ledger_balance(uuid, uuid, text, date) from public, anon, authenticated;

-- The next free ledger code under group 19 for a new treasury account: 195..199, then 1901..1999.
create or replace function public.trs__next_ledger_code(p_org uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare c text;
begin
  for c in select x::text from generate_series(195, 199) x union all select '19' || lpad(x::text, 2, '0') from generate_series(1, 99) x loop
    if not exists (select 1 from public.acc_accounts where org_id = p_org and code = c and deleted_at is null) then return c; end if;
  end loop;
  raise exception 'INVALID_STATE' using detail = 'no free account code left under group 19';
end $$;
revoke all on function public.trs__next_ledger_code(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- treasury accounts

-- Add (p_id null) or change a treasury account. With p_create_ledger the ledger account is created under group 19; otherwise
-- p_ledger_account_id must be an active leaf asset account no other treasury account uses. The ledger account and the currency
-- cannot change once the account has entries; an account holding money cannot be deactivated (HAS_BALANCE).
create or replace function public.trs_save_account(p_id uuid, p_code text, p_name text, p_name_ar text, p_kind text, p_currency text default null,
  p_branch_id uuid default null, p_ledger_account_id uuid default null, p_create_ledger boolean default false,
  p_bank_name text default null, p_bank_account_no text default null, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.trs__guard('manage'); t public.trs_accounts; a public.acc_accounts; v_id uuid; v_ledger uuid := p_ledger_account_id;
  v_code text := upper(trim(coalesce(p_code, ''))); v_cur text; v_parent uuid; v_bal bigint;
begin
  if v_code !~ '^[A-Z0-9-]{1,20}$' or length(trim(coalesce(p_name, ''))) not between 1 and 120 or p_kind not in ('cash', 'bank', 'clearing') or p_active is null then
    raise exception 'INVALID_INPUT' using detail = 'a code, a name and a kind (cash, bank or clearing) are required';
  end if;
  select coalesce(upper(nullif(trim(p_currency), '')), o.default_currency) into v_cur from public.organizations o where o.id = v_org;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT' using detail = 'currency'; end if;
  if p_branch_id is not null and not exists (select 1 from public.core_branches where org_id = v_org and id = p_branch_id and deleted_at is null and active) then
    raise exception 'NOT_FOUND' using detail = 'branch';
  end if;
  if exists (select 1 from public.trs_accounts where org_id = v_org and upper(code) = v_code and deleted_at is null and id is distinct from p_id) then
    raise exception 'DUPLICATE' using detail = format('treasury code %s is already used', v_code);
  end if;

  if p_id is null then
    if coalesce(p_create_ledger, false) then
      select id into v_parent from public.acc_accounts where org_id = v_org and code = '19' and deleted_at is null;
      if v_parent is null then raise exception 'INVALID_STATE' using detail = 'the chart has no group 19; add the default chart first'; end if;
      v_ledger := public.acc_create_account(v_parent, public.trs__next_ledger_code(v_org), trim(p_name), nullif(trim(coalesce(p_name_ar, '')), ''), null);
    end if;
    select * into a from public.acc_accounts where org_id = v_org and id = v_ledger and deleted_at is null;
    if not found then raise exception 'INVALID_INPUT' using detail = 'a ledger account is required (or ask for one to be created)'; end if;
    if not a.active or a.kind <> 'asset' then raise exception 'ACCOUNT_INACTIVE' using detail = 'the ledger account must be an active asset account'; end if;
    if exists (select 1 from public.acc_accounts where org_id = v_org and parent_id = a.id and deleted_at is null) then raise exception 'NOT_LEAF'; end if;
    if exists (select 1 from public.trs_accounts where org_id = v_org and ledger_account_id = a.id and deleted_at is null) then
      raise exception 'DUPLICATE' using detail = format('ledger account %s already belongs to a treasury account', a.code);
    end if;
    insert into public.trs_accounts (org_id, code, name, name_ar, kind, currency, branch_id, ledger_account_id, bank_name, bank_account_no, active, created_by)
    values (v_org, v_code, trim(p_name), nullif(trim(coalesce(p_name_ar, '')), ''), p_kind, v_cur, p_branch_id, a.id,
            nullif(trim(coalesce(p_bank_name, '')), ''), nullif(trim(coalesce(p_bank_account_no, '')), ''), p_active, auth.uid())
    returning id into v_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'treasury.account.created', 'treasury_account', v_id::text, format('%s %s (%s, %s) on ledger %s', v_code, trim(p_name), p_kind, v_cur, a.code),
            jsonb_build_object('kind', p_kind, 'currency', v_cur, 'ledger_account_id', a.id, 'branch_id', p_branch_id));
    return v_id;
  end if;

  select * into t from public.trs_accounts where org_id = v_org and id = p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (v_ledger is not null and v_ledger <> t.ledger_account_id) or v_cur <> t.currency or p_kind <> t.kind then
    raise exception 'INVALID_INPUT' using detail = 'the kind, currency and ledger account of a treasury account cannot change; add a new one';
  end if;
  if t.active and not p_active then
    v_bal := public.trs__ledger_balance(v_org, t.ledger_account_id, t.currency);
    if v_bal <> 0 then raise exception 'HAS_BALANCE' using detail = format('%s still holds %s minor units; transfer it out first', t.code, v_bal); end if;
  end if;
  update public.trs_accounts set code = v_code, name = trim(p_name), name_ar = nullif(trim(coalesce(p_name_ar, '')), ''), branch_id = p_branch_id,
    bank_name = nullif(trim(coalesce(p_bank_name, '')), ''), bank_account_no = nullif(trim(coalesce(p_bank_account_no, '')), ''), active = p_active
   where id = t.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'treasury.account.changed', 'treasury_account', t.id::text, format('%s %s', v_code, trim(p_name)),
          jsonb_build_object('code', t.code, 'name', t.name, 'name_ar', t.name_ar, 'branch_id', t.branch_id, 'bank_name', t.bank_name, 'active', t.active),
          jsonb_build_object('code', v_code, 'name', trim(p_name), 'name_ar', nullif(trim(coalesce(p_name_ar, '')), ''), 'branch_id', p_branch_id,
                             'bank_name', nullif(trim(coalesce(p_bank_name, '')), ''), 'active', p_active));
  return t.id;
end $$;

-- The default treasury accounts, on the accounts the roles already point at (so nothing already posted moves). Safe to repeat.
create or replace function public.trs_prepare() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.trs__guard('manage'); v_cur text; v_branch uuid; r record; v_acct uuid; n int := 0;
begin
  select default_currency into v_cur from public.organizations where id = v_org;
  select id into v_branch from public.core_branches where org_id = v_org and upper(code) = 'MAIN' and deleted_at is null;
  for r in select * from (values
      ('cash', 'CASH-MAIN', 'Main cash box', 'الخزينة الرئيسية', 'cash', 1),
      ('bank', 'BANK-MAIN', 'Main bank account', 'الحساب البنكي الرئيسي', 'bank', 2),
      ('card_clearing', 'CARD-CLR', 'Card payments awaiting settlement', 'مدفوعات البطاقات تحت التسوية', 'clearing', 3),
      ('cheque_in_clearing', 'CHQ-IN', 'Cheques received, not yet collected', 'شيكات واردة تحت التحصيل', 'clearing', 4),
      ('cheque_out_clearing', 'CHQ-OUT', 'Cheques issued, not yet cashed', 'شيكات صادرة لم تُصرف', 'clearing', 5),
      ('other_clearing', 'OTHER-CLR', 'Other payments awaiting settlement', 'مدفوعات أخرى تحت التسوية', 'clearing', 6)
    ) as v(role, code, name, name_ar, kind, ord) order by ord loop
    v_acct := public.acc__role_account(v_org, r.role);
    continue when exists (select 1 from public.trs_accounts where org_id = v_org and ledger_account_id = v_acct and deleted_at is null);
    continue when exists (select 1 from public.trs_accounts where org_id = v_org and upper(code) = r.code and deleted_at is null);
    insert into public.trs_accounts (org_id, code, name, name_ar, kind, currency, branch_id, ledger_account_id, created_by)
    values (v_org, r.code, r.name, r.name_ar, r.kind, v_cur, v_branch, v_acct, auth.uid());
    n := n + 1;
  end loop;
  if n > 0 then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'treasury.prepared', 'organization', v_org::text, format('%s default treasury accounts added', n), jsonb_build_object('accounts', n));
  end if;
  return jsonb_build_object('accountsAdded', n, 'accounts', (select count(*) from public.trs_accounts where org_id = v_org and deleted_at is null));
end $$;

-- ---------------------------------------------------------------- payments through a treasury account

-- Every path that inserts a payment: the treasury account must fit (kind matches the method, same currency, active, same company),
-- and is required for cash and bank once treasury is on. Card, cheque and "other" post to clearing roles and take none.
create or replace function public.trs__trg_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.trs_accounts;
begin
  if new.treasury_account_id is null then
    if new.method in ('cash', 'bank') and exists (select 1 from public.org_modules where org_id = new.org_id and module_key = 'treasury' and disabled_at is null) then
      raise exception 'TREASURY_ACCOUNT_REQUIRED' using detail = format('a %s payment needs the cash box or bank account it went through', new.method);
    end if;
    return new;
  end if;
  if new.method not in ('cash', 'bank') then
    raise exception 'TREASURY_MISMATCH' using detail = 'card, cheque and other payments go to their clearing account; choose no treasury account';
  end if;
  select * into t from public.trs_accounts where org_id = new.org_id and id = new.treasury_account_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'treasury account'; end if;
  if not t.active then raise exception 'TREASURY_MISMATCH' using detail = format('%s is inactive', t.code); end if;
  if t.kind <> new.method then raise exception 'TREASURY_MISMATCH' using detail = format('a %s payment needs a %s account; %s is %s', new.method, new.method, t.code, t.kind); end if;
  if t.currency <> new.currency then raise exception 'TREASURY_MISMATCH' using detail = format('%s holds %s, the payment is %s', t.code, t.currency, new.currency); end if;
  return new;
end $$;
revoke all on function public.trs__trg_payment() from public, anon, authenticated;
drop trigger if exists trs_payment_account on public.fin_payments;
create trigger trs_payment_account before insert on public.fin_payments for each row execute function public.trs__trg_payment();

-- fin_record_payment (sql/024) with the treasury account. Same checks as before; the trigger above checks the account.
drop function if exists public.fin_record_payment(text, bigint, date, text, uuid, uuid, uuid, text);
create or replace function public.fin_record_payment(p_direction text, p_amount_minor bigint, p_paid_on date, p_method text,
  p_customer_invoice_id uuid default null, p_supplier_invoice_id uuid default null, p_expense_id uuid default null, p_note text default null,
  p_treasury_account_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.fin__guard();
  v_cur char(3); v_total bigint; v_paid bigint; v_id uuid; v_no text; v_via text;
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
  insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, supplier_invoice_id, expense_id, note, created_by, treasury_account_id)
  values (v_org, v_no, p_direction, p_amount_minor, v_cur, p_paid_on, p_method, p_customer_invoice_id, p_supplier_invoice_id, p_expense_id, nullif(trim(p_note), ''), auth.uid(), p_treasury_account_id)
  returning id into v_id;
  select ' via ' || code into v_via from public.trs_accounts where org_id = v_org and id = p_treasury_account_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.payment.recorded', 'finance_payment', v_id::text,
          format('%s %s: %s minor units %s by %s%s', v_no, case p_direction when 'in' then 'received' else 'paid' end, p_amount_minor, v_cur, p_method, coalesce(v_via, '')));
  return jsonb_build_object('id', v_id, 'number', v_no);
end $$;
revoke all on function public.fin_record_payment(text, bigint, date, text, uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.fin_record_payment(text, bigint, date, text, uuid, uuid, uuid, text, uuid) to authenticated;

-- P13': the money line goes to the treasury account's ledger account when the payment has one (sql/046 otherwise unchanged).
create or replace function public.acc__post_payment(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.fin_payments; v_money jsonb; v_other jsonb; v_party uuid; e public.fin_expenses; v_ledger uuid;
begin
  select * into p from public.fin_payments where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.method = 'other' and length(trim(coalesce(p.note, ''))) = 0 and not p_backfill then
    raise exception 'NOTE_REQUIRED' using detail = 'a payment by "other" needs a note saying what it was';
  end if;
  if p.treasury_account_id is not null then
    select ledger_account_id into v_ledger from public.trs_accounts where org_id = p_org and id = p.treasury_account_id;
    v_money := jsonb_build_object('account', v_ledger);
  else
    v_money := jsonb_build_object('role', public.acc__method_role(p.method, p.direction));
  end if;
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
revoke all on function public.acc__post_payment(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- transfers (P18)

create or replace function public.trs_record_transfer(p_from uuid, p_to uuid, p_amount_minor bigint, p_date date, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__guard('write'); f public.trs_accounts; t public.trs_accounts; v_id uuid; v_no text; v_entry uuid;
begin
  if p_from is null or p_to is null or p_amount_minor is null or p_amount_minor <= 0 or p_date is null or length(coalesce(p_note, '')) > 500 then
    raise exception 'INVALID_INPUT' using detail = 'from, to, an amount above zero and a date are required';
  end if;
  if p_from = p_to then raise exception 'SAME_ACCOUNT' using detail = 'choose two different accounts'; end if;
  select * into f from public.trs_accounts where org_id = v_org and id = p_from and deleted_at is null;
  select * into t from public.trs_accounts where org_id = v_org and id = p_to and deleted_at is null;
  if f.id is null or t.id is null then raise exception 'NOT_FOUND'; end if;
  if not f.active or not t.active then raise exception 'INVALID_STATE' using detail = 'both accounts must be active'; end if;
  if f.currency <> t.currency then raise exception 'CURRENCY_MISMATCH' using detail = format('%s holds %s and %s holds %s', f.code, f.currency, t.code, t.currency); end if;
  perform public.core__assert_open(v_org, p_date);
  v_no := public.acc__next(v_org, 'trs_transfer', 'TR-');
  insert into public.trs_transfers (org_id, number, from_account_id, to_account_id, amount_minor, currency, transfer_date, note, created_by)
  values (v_org, v_no, f.id, t.id, p_amount_minor, f.currency, p_date, nullif(trim(coalesce(p_note, '')), ''), auth.uid()) returning id into v_id;
  v_entry := public.acc__post(v_org, p_date, f.currency, 'treasury_transfer', v_id::text, 'transferred',
    format('Transfer %s: %s to %s%s', v_no, f.code, t.code, coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '')),
    jsonb_build_array(jsonb_build_object('account', t.ledger_account_id, 'debit', p_amount_minor),
                      jsonb_build_object('account', f.ledger_account_id, 'credit', p_amount_minor)));
  update public.trs_transfers set entry_id = v_entry where id = v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'treasury.transfer.recorded', 'treasury_transfer', v_id::text,
          format('%s: %s minor units %s from %s to %s on %s', v_no, p_amount_minor, f.currency, f.code, t.code, p_date),
          jsonb_build_object('entry_id', v_entry, 'from', f.id, 'to', t.id, 'amount_minor', p_amount_minor));
  return jsonb_build_object('id', v_id, 'number', v_no, 'entryId', v_entry);
end $$;

-- Void: the reversing entry is dated today (company time zone). Neither the transfer's date nor today may be on or before the lock.
create or replace function public.trs_void_transfer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__guard('write'); x public.trs_transfers; v_today date; v_rev uuid;
begin
  select * into x from public.trs_transfers where org_id = v_org and id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if x.status <> 'recorded' then raise exception 'INVALID_STATE' using detail = format('%s is already void', x.number); end if;
  v_today := public.acc__local_date(v_org, now());
  perform public.core__assert_open(v_org, x.transfer_date);
  perform public.core__assert_open(v_org, v_today);
  v_rev := public.acc__reverse(v_org, x.entry_id, greatest(v_today, x.transfer_date), 'voided', 'Void of transfer ' || x.number);
  update public.trs_transfers set status = 'void', voided_by = auth.uid(), voided_at = now() where id = x.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'treasury.transfer.voided', 'treasury_transfer', x.id::text, format('%s voided', x.number), jsonb_build_object('entry_id', v_rev));
end $$;

-- Balances of every treasury account on a date (null = today), from the ledger.
create or replace function public.trs_balances(p_on date default null)
returns table (account_id uuid, code text, name text, name_ar text, kind text, currency char(3), branch_id uuid, ledger_account_id uuid, active boolean, balance_minor bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.trs__guard('read');
begin
  return query
    select t.id, t.code, t.name, t.name_ar, t.kind, t.currency, t.branch_id, t.ledger_account_id, t.active,
           public.trs__ledger_balance(v_org, t.ledger_account_id, t.currency, p_on)
      from public.trs_accounts t
     where t.org_id = v_org and t.deleted_at is null
     order by t.kind, t.code;
end $$;

revoke all on function public.trs_save_account(uuid, text, text, text, text, text, uuid, uuid, boolean, text, text, boolean), public.trs_prepare(),
  public.trs_record_transfer(uuid, uuid, bigint, date, text), public.trs_void_transfer(uuid), public.trs_balances(date) from public, anon;
grant execute on function public.trs_save_account(uuid, text, text, text, text, text, uuid, uuid, boolean, text, text, boolean), public.trs_prepare(),
  public.trs_record_transfer(uuid, uuid, bigint, date, text), public.trs_void_transfer(uuid), public.trs_balances(date) to authenticated;

commit;

-- Verification (read-only): RLS on, no user writes, the payment trigger and module guard exist, internal functions closed, no company
-- has treasury on yet.
select relname, relrowsecurity from pg_class where relname in ('trs_accounts', 'trs_transfers') order by 1;
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name in ('trs_accounts', 'trs_transfers') and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select tgname from pg_trigger where tgname in ('trs_payment_account', 'trs_module_guard') order by 1;
select has_function_privilege('authenticated', 'public.trs__ledger_balance(uuid, uuid, text, date)', 'execute') as users_can_call_internal,
       has_function_privilege('anon', 'public.trs_record_transfer(uuid, uuid, bigint, date, text)', 'execute') as anon_can_transfer;
select count(*) as treasury_on from public.org_modules where module_key = 'treasury' and disabled_at is null;
