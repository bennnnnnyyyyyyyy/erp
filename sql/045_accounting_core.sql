-- 045_accounting_core.sql
-- Phase 1 of documentation/plans/ROADMAP_ACCOUNTING_SUITE.md, slice 1 of documentation/plans/ACCOUNTING_PLAN.md (decisions in the
-- ADR-0004 draft, documentation/planning/DRAFT_ADR-0004-general-ledger.md). The general ledger's foundation, with no posting yet:
--   * acc_accounts: the chart of accounts, hierarchical, coded (child code starts with the parent's), Arabic and English names;
--   * acc_account_roles: which account each kind of posting uses, per company (settings, not code);
--   * acc_fiscal_years;
--   * acc_entries + acc_entry_lines: APPEND-ONLY journal; every entry balances (checked at commit); leaf accounts only;
--     an entry dated on or before the lock date is refused unless it is a backfill entry;
--   * memberships.is_head_accountant: set by the owner on an owner or admin; posts manual entries without approval (Ben, Q5);
--   * acc_prepare(): seeds the default Egyptian chart (plan section 3.1) and its roles if the company has none;
--   * acc__post(...): the one internal function that writes an entry (used by 046 posting and 048 manual journals);
--   * a guard so the `accounting` module can only be switched on by the switch-on function (047), and never switched off.
-- Nothing here posts anything, and no company's documents are affected until it switches accounting on (sql/047).
-- Reading is for owners and admins only (as the finance tables, sql/024).
-- Depends on sql/001-044. Rerun-safe. Run the whole file, then sql/tests/040_accounting_core.sql.

begin;

-- ---------------------------------------------------------------- the head-accountant flag

alter table public.memberships add column if not exists is_head_accountant boolean not null default false;

-- ---------------------------------------------------------------- helpers

-- Owner or admin of p_org (the people who may read the ledger). For RLS policies.
create or replace function public.acc__can_read(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m join public.organizations o on o.id = m.org_id
    where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null and o.deleted_at is null
      and m.role in ('owner', 'admin'));
$$;
revoke all on function public.acc__can_read(uuid) from public, anon;
grant execute on function public.acc__can_read(uuid) to authenticated;

-- The caller's organization after checking what they may do:
--   'read'  : owner or admin;
--   'chart' : owner, or an owner/admin marked head accountant (chart, roles, fiscal years, uncosted receipts);
--   'owner' : owner only.
create or replace function public.acc__guard(p_need text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_role text; v_head boolean;
begin
  select m.role, m.is_head_accountant into v_role, v_head
  from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if p_need = 'read' then return v_org; end if;
  if p_need = 'chart' and (v_role = 'owner' or coalesce(v_head, false)) then return v_org; end if;
  if p_need = 'owner' and v_role = 'owner' then return v_org; end if;
  raise exception 'FORBIDDEN';
end $$;
revoke all on function public.acc__guard(text) from public, anon, authenticated;

-- JE-000001 style numbers from the shared per-company counters.
create or replace function public.acc__next(p_org uuid, p_key text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.inv_counters (org_id, key, value) values (p_org, p_key, 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v;
  return p_prefix || lpad(v::text, 6, '0');
end $$;
revoke all on function public.acc__next(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- chart of accounts

create table if not exists public.acc_accounts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  code        text not null check (code ~ '^[0-9]{1,20}$'),
  name        text not null check (length(trim(name)) between 1 and 160),
  name_ar     text check (name_ar is null or length(trim(name_ar)) between 1 and 160),
  parent_id   uuid,
  kind        text not null check (kind in ('asset', 'liability', 'equity', 'expense', 'revenue')),
  active      boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (org_id, id),
  foreign key (org_id, parent_id) references public.acc_accounts (org_id, id)
);
create unique index if not exists acc_accounts_code_uq on public.acc_accounts (org_id, code) where deleted_at is null;
create index if not exists acc_accounts_parent_idx on public.acc_accounts (org_id, parent_id);

create table if not exists public.acc_account_roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  role_key    text not null check (role_key in (
                'inventory', 'receivables', 'cash', 'bank', 'card_clearing', 'cheque_in_clearing', 'cheque_out_clearing', 'other_clearing',
                'opening_balance', 'payables', 'grni', 'expense_payables', 'expense_default', 'stock_adjustment', 'internal_use',
                'price_variance', 'cogs', 'sales_revenue', 'sales_returns')),
  account_id  uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, role_key),
  foreign key (org_id, account_id) references public.acc_accounts (org_id, id)
);

create table if not exists public.acc_fiscal_years (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  name        text not null check (length(trim(name)) between 1 and 40),
  starts_on   date not null,
  ends_on     date not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  check (ends_on > starts_on),
  unique (org_id, id),
  unique (org_id, name)
);

-- ---------------------------------------------------------------- the journal (append-only)

create table if not exists public.acc_entries (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  number            text not null,
  entry_date        date not null,
  currency          char(3) not null check (currency ~ '^[A-Z]{3}$'),
  source_type       text not null check (source_type ~ '^[a-z][a-z_]{1,40}$'),
  source_id         text not null check (length(source_id) between 1 and 80),
  event             text not null check (event ~ '^[a-z][a-z_]{1,40}$'),
  memo              text check (memo is null or length(memo) <= 500),
  reverses_entry_id uuid,
  is_backfill       boolean not null default false,
  posted_by         uuid references auth.users(id),
  approved_by       uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  unique (org_id, source_type, source_id, event),
  foreign key (org_id, reverses_entry_id) references public.acc_entries (org_id, id)
);
create index if not exists acc_entries_date_idx on public.acc_entries (org_id, entry_date);

create table if not exists public.acc_entry_lines (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id),
  entry_id      uuid not null,
  line_no       int not null check (line_no > 0),
  account_id    uuid not null,
  debit_minor   bigint not null default 0 check (debit_minor >= 0),
  credit_minor  bigint not null default 0 check (credit_minor >= 0),
  party_type    text check (party_type in ('customer', 'supplier')),
  party_id      uuid,
  item_id       uuid,
  warehouse_id  uuid,
  memo          text check (memo is null or length(memo) <= 500),
  created_at    timestamptz not null default now(),
  check ((debit_minor > 0) <> (credit_minor > 0)),
  check ((party_type is null) = (party_id is null)),
  unique (org_id, entry_id, line_no),
  foreign key (org_id, entry_id) references public.acc_entries (org_id, id),
  foreign key (org_id, account_id) references public.acc_accounts (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id)
);
create index if not exists acc_entry_lines_account_idx on public.acc_entry_lines (org_id, account_id);
create index if not exists acc_entry_lines_entry_idx on public.acc_entry_lines (org_id, entry_id);
create index if not exists acc_entry_lines_party_idx on public.acc_entry_lines (org_id, party_type, party_id) where party_id is not null;

-- No update or delete, by anyone (the grants are revoked too; this also stops security-definer functions).
create or replace function public.acc__append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'APPEND_ONLY' using detail = format('%s rows cannot be changed or deleted; post a reversing entry', tg_table_name);
end $$;
drop trigger if exists acc_entries_append_only on public.acc_entries;
create trigger acc_entries_append_only before update or delete on public.acc_entries for each row execute function public.acc__append_only();
drop trigger if exists acc_entry_lines_append_only on public.acc_entry_lines;
create trigger acc_entry_lines_append_only before update or delete on public.acc_entry_lines for each row execute function public.acc__append_only();
drop trigger if exists acc_entries_no_truncate on public.acc_entries;
create trigger acc_entries_no_truncate before truncate on public.acc_entries for each statement execute function public.acc__append_only();
drop trigger if exists acc_entry_lines_no_truncate on public.acc_entry_lines;
create trigger acc_entry_lines_no_truncate before truncate on public.acc_entry_lines for each statement execute function public.acc__append_only();

-- Lock date (sql/040): a normal entry may not be dated on or before it. Backfill entries record what already happened (ADR-0004 §6).
create or replace function public.acc__entry_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.is_backfill then perform public.core__assert_open(new.org_id, new.entry_date); end if;
  return new;
end $$;
revoke all on function public.acc__entry_guard() from public, anon, authenticated;
drop trigger if exists acc_entries_guard on public.acc_entries;
create trigger acc_entries_guard before insert on public.acc_entries for each row execute function public.acc__entry_guard();

-- A line may only use an active leaf account of the same company.
create or replace function public.acc__line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.acc_accounts a where a.org_id = new.org_id and a.id = new.account_id and a.deleted_at is null and a.active) then
    raise exception 'ACCOUNT_INACTIVE' using detail = 'lines can only post to an active account';
  end if;
  if exists (select 1 from public.acc_accounts c where c.org_id = new.org_id and c.parent_id = new.account_id and c.deleted_at is null) then
    raise exception 'NOT_LEAF' using detail = 'lines can only post to an account with no sub-accounts';
  end if;
  return new;
end $$;
revoke all on function public.acc__line_guard() from public, anon, authenticated;
drop trigger if exists acc_entry_lines_guard on public.acc_entry_lines;
create trigger acc_entry_lines_guard before insert on public.acc_entry_lines for each row execute function public.acc__line_guard();

-- Every entry has at least two lines and its debits equal its credits. Checked at commit (deferred), from both tables, so an
-- entry with no lines and an entry whose lines were added later are both caught.
create or replace function public.acc__check_balance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_org uuid; v_n int; v_dr bigint; v_cr bigint;
begin
  if tg_table_name = 'acc_entries' then v_entry := new.id; v_org := new.org_id; else v_entry := new.entry_id; v_org := new.org_id; end if;
  select count(*), coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) into v_n, v_dr, v_cr
  from public.acc_entry_lines where org_id = v_org and entry_id = v_entry;
  if v_n < 2 or v_dr <> v_cr then
    raise exception 'UNBALANCED' using detail = format('entry %s: %s lines, debits %s, credits %s', v_entry, v_n, v_dr, v_cr);
  end if;
  return null;
end $$;
revoke all on function public.acc__check_balance() from public, anon, authenticated;
drop trigger if exists acc_entries_balanced on public.acc_entries;
create constraint trigger acc_entries_balanced after insert on public.acc_entries
  deferrable initially deferred for each row execute function public.acc__check_balance();
drop trigger if exists acc_entry_lines_balanced on public.acc_entry_lines;
create constraint trigger acc_entry_lines_balanced after insert on public.acc_entry_lines
  deferrable initially deferred for each row execute function public.acc__check_balance();

-- ---------------------------------------------------------------- row level security and grants

alter table public.acc_accounts      enable row level security;
alter table public.acc_account_roles enable row level security;
alter table public.acc_fiscal_years  enable row level security;
alter table public.acc_entries       enable row level security;
alter table public.acc_entry_lines   enable row level security;
revoke all on public.acc_accounts, public.acc_account_roles, public.acc_fiscal_years, public.acc_entries, public.acc_entry_lines from anon, authenticated;
grant select on public.acc_accounts, public.acc_account_roles, public.acc_fiscal_years, public.acc_entries, public.acc_entry_lines to authenticated;

drop policy if exists acc_accounts_read on public.acc_accounts;
create policy acc_accounts_read on public.acc_accounts for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists acc_account_roles_read on public.acc_account_roles;
create policy acc_account_roles_read on public.acc_account_roles for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists acc_fiscal_years_read on public.acc_fiscal_years;
create policy acc_fiscal_years_read on public.acc_fiscal_years for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists acc_entries_read on public.acc_entries;
create policy acc_entries_read on public.acc_entries for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists acc_entry_lines_read on public.acc_entry_lines;
create policy acc_entry_lines_read on public.acc_entry_lines for select to authenticated using (public.acc__can_read(org_id));

drop trigger if exists acc_accounts_updated_at on public.acc_accounts;
create trigger acc_accounts_updated_at before update on public.acc_accounts for each row execute function public.set_updated_at();
drop trigger if exists acc_account_roles_updated_at on public.acc_account_roles;
create trigger acc_account_roles_updated_at before update on public.acc_account_roles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- the accounting module: on only through switch-on, never off

-- 047's switch-on sets the transaction-local flag acc.switch_on = 'on' before it inserts the org_modules row. Any other path
-- (Settings -> Apps, core_set_module, a script) is refused, and once on the module cannot be switched off: documents would then
-- exist without their entries (ADR-0004 §1).
create or replace function public.acc__module_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.module_key = 'accounting' and coalesce(current_setting('acc.switch_on', true), '') <> 'on' then
    raise exception 'USE_SWITCH_ON' using detail = 'accounting is switched on from Accounting setup, which posts the existing documents first';
  end if;
  if tg_op = 'UPDATE' and new.module_key = 'accounting' then
    if new.disabled_at is not null then raise exception 'FORBIDDEN' using detail = 'accounting cannot be switched off once it is on'; end if;
    if old.disabled_at is not null and coalesce(current_setting('acc.switch_on', true), '') <> 'on' then raise exception 'USE_SWITCH_ON'; end if;
  end if;
  if tg_op = 'DELETE' and old.module_key = 'accounting' then raise exception 'FORBIDDEN'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.acc__module_guard() from public, anon, authenticated;
drop trigger if exists org_modules_accounting_guard on public.org_modules;
create trigger org_modules_accounting_guard before insert or update or delete on public.org_modules
  for each row execute function public.acc__module_guard();

-- True when accounting is on for p_org (used by every posting trigger in 046).
create or replace function public.acc__enabled(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_modules where org_id = p_org and module_key = 'accounting' and disabled_at is null);
$$;
revoke all on function public.acc__enabled(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- posting (internal)

-- The account a role points to for p_org; ACCOUNT_ROLE_MISSING names the role when none is set.
create or replace function public.acc__role_account(p_org uuid, p_role text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.acc_account_roles where org_id = p_org and role_key = p_role;
  if v is null then raise exception 'ACCOUNT_ROLE_MISSING' using detail = p_role; end if;
  return v;
end $$;
revoke all on function public.acc__role_account(uuid, text) from public, anon, authenticated;

-- Writes one entry and its lines. p_lines is a JSON array of objects:
--   {"account": uuid | "role": text, "debit": minor | "credit": minor, "partyType", "partyId", "itemId", "warehouseId", "memo"}
-- Lines with a zero amount are skipped. Returns the entry id. Idempotent per (source_type, source_id, event): posting the same event
-- twice returns the existing entry without writing anything. Balance, leaf and lock-date rules are enforced by the triggers above.
-- Internal: called only by posting triggers (046), switch-on (047) and manual journals (048), never by signed-in users directly.
create or replace function public.acc__post(
  p_org uuid, p_date date, p_currency text, p_source_type text, p_source_id text, p_event text, p_memo text,
  p_lines jsonb, p_is_backfill boolean default false, p_reverses uuid default null, p_approved_by uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no text; l jsonb; v_n int := 0; v_acct uuid; v_dr bigint; v_cr bigint;
begin
  select id into v_id from public.acc_entries where org_id = p_org and source_type = p_source_type and source_id = p_source_id and event = p_event;
  if v_id is not null then return v_id; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_INPUT' using detail = 'lines must be an array'; end if;
  v_no := public.acc__next(p_org, 'acc_entry', 'JE-');
  insert into public.acc_entries (org_id, number, entry_date, currency, source_type, source_id, event, memo, reverses_entry_id, is_backfill, posted_by, approved_by)
  values (p_org, v_no, p_date, p_currency, p_source_type, p_source_id, p_event, p_memo, p_reverses, coalesce(p_is_backfill, false), auth.uid(), p_approved_by)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_dr := coalesce((l ->> 'debit')::bigint, 0);
    v_cr := coalesce((l ->> 'credit')::bigint, 0);
    if v_dr < 0 or v_cr < 0 then raise exception 'INVALID_INPUT' using detail = 'amounts cannot be negative'; end if;
    continue when v_dr = 0 and v_cr = 0;
    v_acct := coalesce((l ->> 'account')::uuid, public.acc__role_account(p_org, l ->> 'role'));
    v_n := v_n + 1;
    insert into public.acc_entry_lines (org_id, entry_id, line_no, account_id, debit_minor, credit_minor, party_type, party_id, item_id, warehouse_id, memo)
    values (p_org, v_id, v_n, v_acct, v_dr, v_cr, l ->> 'partyType', (l ->> 'partyId')::uuid, (l ->> 'itemId')::uuid, (l ->> 'warehouseId')::uuid, l ->> 'memo');
  end loop;
  return v_id;
end $$;
revoke all on function public.acc__post(uuid, date, text, text, text, text, text, jsonb, boolean, uuid, uuid) from public, anon, authenticated;

-- A reversing entry: the original's lines with debit and credit swapped, linked to it, dated p_date. Idempotent per p_event.
create or replace function public.acc__reverse(p_org uuid, p_entry_id uuid, p_date date, p_event text, p_memo text, p_is_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.acc_entries; v_lines jsonb;
begin
  select * into e from public.acc_entries where org_id = p_org and id = p_entry_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('account', account_id, 'debit', credit_minor, 'credit', debit_minor, 'partyType', party_type,
           'partyId', party_id, 'itemId', item_id, 'warehouseId', warehouse_id, 'memo', memo) order by line_no), '[]'::jsonb)
    into v_lines from public.acc_entry_lines where org_id = p_org and entry_id = p_entry_id;
  return public.acc__post(p_org, p_date, e.currency, e.source_type, e.source_id, p_event, coalesce(p_memo, 'Reversal of ' || e.number),
                          v_lines, p_is_backfill, e.id, null);
end $$;
revoke all on function public.acc__reverse(uuid, uuid, date, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- the default chart (plan section 3.1)

-- Seeds the default chart and its roles for p_org if it has no accounts yet. Groups 1 and 2 follow the Egyptian unified chart
-- (documentation/reference/egypt-accounting/UNIFIED_CHART_OF_ACCOUNTS.md); the rest are our defaults. Every row is editable.
-- Returns the number of accounts added (0 when the company already has a chart).
create or replace function public.acc__seed_chart(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_parent uuid; v_n int := 0;
begin
  if exists (select 1 from public.acc_accounts where org_id = p_org and deleted_at is null) then return 0; end if;
  for r in
    select * from (values
      (1,  '1',   null,  'asset',     'Assets',                                'الأصول',                                   null),
      (2,  '11',  '1',   'asset',     'Fixed assets',                          'أصول ثابتة',                               null),
      (3,  '16',  '1',   'asset',     'Inventory',                             'مخزون',                                    null),
      (4,  '161', '16',  'asset',     'Goods for resale',                      'مخزون بضائع بغرض البيع',                    'inventory'),
      (5,  '17',  '1',   'asset',     'Customers and notes receivable',        'عملاء وأوراق قبض',                         null),
      (6,  '171', '17',  'asset',     'Customers',                             'العملاء',                                  'receivables'),
      (7,  '172', '17',  'asset',     'Cheques under collection',              'شيكات تحت التحصيل',                        'cheque_in_clearing'),
      (8,  '19',  '1',   'asset',     'Cash at banks and on hand',             'نقدية بالبنوك والصندوق',                    null),
      (9,  '191', '19',  'asset',     'Cash on hand',                          'النقدية بالصندوق',                          'cash'),
      (10, '192', '19',  'asset',     'Cash at banks',                         'النقدية بالبنوك',                           'bank'),
      (11, '193', '19',  'asset',     'Card payments awaiting settlement',     'مدفوعات البطاقات تحت التسوية',              'card_clearing'),
      (12, '194', '19',  'asset',     'Other payments awaiting settlement',    'مدفوعات أخرى تحت التسوية',                  'other_clearing'),
      (13, '2',   null,  'liability', 'Equity and liabilities',                'حقوق الملكية والالتزامات',                  null),
      (14, '21',  '2',   'equity',    'Paid-up capital',                       'رأس المال المدفوع',                         null),
      (15, '211', '21',  'equity',    'Paid-up capital',                       'رأس المال المدفوع',                         null),
      (16, '23',  '2',   'equity',    'Retained earnings (losses)',            'الأرباح والخسائر المرحلة',                   null),
      (17, '231', '23',  'equity',    'Opening balances',                      'أرصدة افتتاحية',                            'opening_balance'),
      (18, '28',  '2',   'liability', 'Suppliers and payables',                'موردون وأوراق دفع وحسابات دائنة',            null),
      (19, '281', '28',  'liability', 'Suppliers',                             'الموردون',                                  'payables'),
      (20, '282', '28',  'liability', 'Goods received not invoiced',           'بضاعة مستلمة لم ترد بشأنها فواتير',          'grni'),
      (21, '283', '28',  'liability', 'Accrued expenses and other payables',   'مصروفات مستحقة ودائنون متنوعون',            'expense_payables'),
      (22, '284', '28',  'liability', 'Partners'' current accounts',           'الحسابات الجارية للشركاء',                   null),
      (23, '285', '28',  'liability', 'Notes payable',                         'أوراق الدفع',                               null),
      (24, '286', '28',  'liability', 'Issued cheques not yet cashed',         'شيكات صادرة لم تصرف',                       'cheque_out_clearing'),
      (25, '3',   null,  'expense',   'Costs and expenses',                    'التكاليف والمصروفات',                       null),
      (26, '33',  '3',   'expense',   'Expenses',                              'مصروفات',                                   null),
      (27, '331', '33',  'expense',   'General expenses',                      'مصروفات عامة',                              'expense_default'),
      (28, '332', '33',  'expense',   'Stock shortages and count differences', 'عجز وفروق جرد المخزون',                     'stock_adjustment'),
      (29, '333', '33',  'expense',   'Internal use of inventory',             'استخدامات داخلية من المخزون',                'internal_use'),
      (30, '334', '33',  'expense',   'Purchase price differences',            'فروق أسعار المشتريات',                      'price_variance'),
      (31, '34',  '3',   'expense',   'Cost of sales',                         'تكلفة المبيعات',                            null),
      (32, '341', '34',  'expense',   'Cost of goods sold',                    'تكلفة البضاعة المباعة',                     'cogs'),
      (33, '4',   null,  'revenue',   'Revenues',                              'الإيرادات',                                 null),
      (34, '41',  '4',   'revenue',   'Operating revenue',                     'إيرادات النشاط',                            null),
      (35, '411', '41',  'revenue',   'Sales',                                 'المبيعات',                                  'sales_revenue'),
      (36, '412', '41',  'revenue',   'Sales returns and allowances',          'مردودات ومسموحات المبيعات',                 'sales_returns'),
      (37, '42',  '4',   'revenue',   'Other income',                          'إيرادات أخرى',                              null)
    ) as t(ord, code, parent_code, kind, name, name_ar, role_key)
    order by ord
  loop
    v_parent := null;
    if r.parent_code is not null then
      select id into v_parent from public.acc_accounts where org_id = p_org and code = r.parent_code and deleted_at is null;
    end if;
    insert into public.acc_accounts (org_id, code, name, name_ar, parent_id, kind, created_by)
    values (p_org, r.code, r.name, r.name_ar, v_parent, r.kind, auth.uid());
    v_n := v_n + 1;
    if r.role_key is not null then
      insert into public.acc_account_roles (org_id, role_key, account_id)
      select p_org, r.role_key, a.id from public.acc_accounts a where a.org_id = p_org and a.code = r.code and a.deleted_at is null
      on conflict (org_id, role_key) do nothing;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.acc__seed_chart(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- functions for signed-in users (change + audit, one transaction)

-- Accounting setup, step 1: seed the default chart if the company has none. Owner or head accountant. Safe to repeat.
create or replace function public.acc_prepare() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); v_n int;
begin
  v_n := public.acc__seed_chart(v_org);
  if v_n > 0 then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'accounting.chart.seeded', 'organization', v_org::text, format('Default chart of accounts added (%s accounts)', v_n),
            jsonb_build_object('accounts', v_n));
  end if;
  return jsonb_build_object('accountsAdded', v_n, 'accounts', (select count(*) from public.acc_accounts where org_id = v_org and deleted_at is null));
end $$;

-- Add an account. p_parent_id null = a new top-level group (kind required). A child's code must start with its parent's code and
-- be longer; its kind is the parent's, except that inside equity and liabilities either of the two may be chosen. A parent that
-- already has entry lines, or that a role points to, cannot get children (lines and roles must stay on leaf accounts).
create or replace function public.acc_create_account(p_parent_id uuid, p_code text, p_name text, p_name_ar text default null, p_kind text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); p public.acc_accounts; v_kind text; v_id uuid; v_code text := trim(coalesce(p_code, ''));
begin
  if v_code !~ '^[0-9]{1,20}$' or length(trim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception 'INVALID_INPUT' using detail = 'a numeric code and a name are required';
  end if;
  if p_parent_id is null then
    if p_kind is null or p_kind not in ('asset', 'liability', 'equity', 'expense', 'revenue') then raise exception 'INVALID_INPUT' using detail = 'a top-level account needs a kind'; end if;
    v_kind := p_kind;
  else
    select * into p from public.acc_accounts where org_id = v_org and id = p_parent_id and deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not (v_code like p.code || '%') or length(v_code) <= length(p.code) then
      raise exception 'INVALID_INPUT' using detail = format('the code must start with %s and be longer', p.code);
    end if;
    if exists (select 1 from public.acc_entry_lines where org_id = v_org and account_id = p.id) then
      raise exception 'HAS_ENTRIES' using detail = format('%s already has entries, so it cannot get sub-accounts', p.code);
    end if;
    if exists (select 1 from public.acc_account_roles where org_id = v_org and account_id = p.id) then
      raise exception 'IN_USE' using detail = format('%s is used by a posting role; point the role at another account first', p.code);
    end if;
    v_kind := p.kind;
    if p_kind is not null and p_kind <> p.kind then
      if p.kind in ('equity', 'liability') and p_kind in ('equity', 'liability') then v_kind := p_kind;
      else raise exception 'INVALID_INPUT' using detail = format('a sub-account of %s must be %s', p.code, p.kind); end if;
    end if;
  end if;
  if exists (select 1 from public.acc_accounts where org_id = v_org and code = v_code and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = format('code %s is already used', v_code);
  end if;
  insert into public.acc_accounts (org_id, code, name, name_ar, parent_id, kind, created_by)
  values (v_org, v_code, trim(p_name), nullif(trim(coalesce(p_name_ar, '')), ''), p_parent_id, v_kind, auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.account.added', 'account', v_id::text, format('%s %s', v_code, trim(p_name)),
          jsonb_build_object('code', v_code, 'name', trim(p_name), 'name_ar', p_name_ar, 'kind', v_kind, 'parent_id', p_parent_id));
  return v_id;
end $$;

-- Rename an account or make it inactive. An account a role points to, or with active sub-accounts, cannot be made inactive.
-- Codes do not change here (entries keep pointing at the same account either way; recoding is a later feature if needed).
create or replace function public.acc_update_account(p_id uuid, p_name text, p_name_ar text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); a public.acc_accounts;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 160 or p_active is null then raise exception 'INVALID_INPUT'; end if;
  select * into a from public.acc_accounts where org_id = v_org and id = p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.active and not p_active then
    if exists (select 1 from public.acc_account_roles where org_id = v_org and account_id = a.id) then
      raise exception 'IN_USE' using detail = format('%s is used by a posting role', a.code);
    end if;
    if exists (select 1 from public.acc_accounts where org_id = v_org and parent_id = a.id and deleted_at is null and active) then
      raise exception 'IN_USE' using detail = format('%s has active sub-accounts', a.code);
    end if;
  end if;
  if a.name = trim(p_name) and a.name_ar is not distinct from nullif(trim(coalesce(p_name_ar, '')), '') and a.active = p_active then return; end if;
  update public.acc_accounts set name = trim(p_name), name_ar = nullif(trim(coalesce(p_name_ar, '')), ''), active = p_active where id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'accounting.account.changed', 'account', a.id::text, format('%s %s', a.code, trim(p_name)),
          jsonb_build_object('name', a.name, 'name_ar', a.name_ar, 'active', a.active),
          jsonb_build_object('name', trim(p_name), 'name_ar', nullif(trim(coalesce(p_name_ar, '')), ''), 'active', p_active));
end $$;

-- Point a posting role at an account (an active leaf). Affects future entries only. Owner or head accountant.
create or replace function public.acc_set_account_role(p_role text, p_account_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); a public.acc_accounts; v_before uuid;
begin
  select * into a from public.acc_accounts where org_id = v_org and id = p_account_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not a.active then raise exception 'ACCOUNT_INACTIVE'; end if;
  if exists (select 1 from public.acc_accounts where org_id = v_org and parent_id = a.id and deleted_at is null) then raise exception 'NOT_LEAF'; end if;
  select account_id into v_before from public.acc_account_roles where org_id = v_org and role_key = p_role;
  if v_before = p_account_id then return; end if;
  insert into public.acc_account_roles (org_id, role_key, account_id) values (v_org, p_role, p_account_id)
  on conflict (org_id, role_key) do update set account_id = excluded.account_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'accounting.role.changed', 'account_role', p_role, format('%s now posts to %s %s', p_role, a.code, a.name),
          jsonb_build_object('account_id', v_before), jsonb_build_object('account_id', p_account_id));
end $$;

-- Owner only: mark an owner or admin as head accountant (or clear it). Audited.
create or replace function public.acc_set_head_accountant(p_membership_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('owner'); m public.memberships;
begin
  if p_on is null then raise exception 'INVALID_INPUT'; end if;
  select * into m from public.memberships where org_id = v_org and id = p_membership_id and disabled_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_on and m.role not in ('owner', 'admin') then
    raise exception 'INVALID_INPUT' using detail = 'only an owner or admin can be head accountant';
  end if;
  if m.is_head_accountant = p_on then return; end if;
  update public.memberships set is_head_accountant = p_on where id = m.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'accounting.head_accountant.changed', 'membership', m.id::text,
          case when p_on then 'Marked as head accountant' else 'No longer head accountant' end,
          jsonb_build_object('is_head_accountant', m.is_head_accountant), jsonb_build_object('is_head_accountant', p_on));
end $$;

-- Add a fiscal year. Years may not overlap. Owner or head accountant.
create or replace function public.acc_create_fiscal_year(p_name text, p_starts_on date, p_ends_on date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 or p_starts_on is null or p_ends_on is null or p_ends_on <= p_starts_on then
    raise exception 'INVALID_INPUT' using detail = 'a name and an end date after the start date are required';
  end if;
  if exists (select 1 from public.acc_fiscal_years where org_id = v_org and starts_on <= p_ends_on and ends_on >= p_starts_on) then
    raise exception 'INVALID_INPUT' using detail = 'fiscal years cannot overlap';
  end if;
  insert into public.acc_fiscal_years (org_id, name, starts_on, ends_on, created_by) values (v_org, trim(p_name), p_starts_on, p_ends_on, auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.fiscal_year.added', 'fiscal_year', v_id::text, format('%s: %s to %s', trim(p_name), p_starts_on, p_ends_on),
          jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on));
  return v_id;
end $$;

revoke all on function public.acc_prepare(), public.acc_create_account(uuid, text, text, text, text), public.acc_update_account(uuid, text, text, boolean),
  public.acc_set_account_role(text, uuid), public.acc_set_head_accountant(uuid, boolean), public.acc_create_fiscal_year(text, date, date) from public, anon;
grant execute on function public.acc_prepare(), public.acc_create_account(uuid, text, text, text, text), public.acc_update_account(uuid, text, text, boolean),
  public.acc_set_account_role(text, uuid), public.acc_set_head_accountant(uuid, boolean), public.acc_create_fiscal_year(text, date, date) to authenticated;

commit;

-- Verification (read-only): RLS on, no user write grants, internal functions closed, user functions open to signed-in users only.
select relname, relrowsecurity from pg_class where relname in ('acc_accounts', 'acc_account_roles', 'acc_fiscal_years', 'acc_entries', 'acc_entry_lines') order by 1;
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name like 'acc\_%' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select has_function_privilege('authenticated', 'public.acc__post(uuid, date, text, text, text, text, text, jsonb, boolean, uuid, uuid)', 'execute') as users_can_post_directly,
       has_function_privilege('authenticated', 'public.acc_prepare()', 'execute') as users_can_prepare,
       has_function_privilege('anon', 'public.acc_prepare()', 'execute') as anon_can_prepare;
select count(*) as accounting_modules_on from public.org_modules where module_key = 'accounting';
