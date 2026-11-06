-- sql/050_core_branches_party_codes.sql
-- Phase 2, slice 1 (documentation/plans/TREASURY_PLAN.md §3.1, §3.3): branches inside one company, and codes for customers and
-- suppliers. Rerun-safe. Needs sql/001-049.
--
-- * core_branches: code + name (Arabic and English), optional link to the ETA issuer branch (tax_branches, sql/036). Every company gets
--   a "MAIN" branch: existing ones here, new ones from a trigger on organizations (bootstrap_organization itself is untouched).
-- * inv_warehouses.branch_id: existing warehouses go into MAIN; a new warehouse without a branch goes into the company's first active
--   branch (trigger), so nothing that creates warehouses had to change.
-- * sal_customers.code, pur_suppliers.code: typed, or automatic (C-00001 / S-00001 from the company counter; prefixes are org settings
--   customer_code_prefix / supplier_code_prefix). Unique per company among active rows, case-insensitive. Existing rows get automatic
--   codes in creation order.
-- * Functions: core_save_branch, inv_set_warehouse_branch, sal_set_customer_code, pur_set_supplier_code; sal_create_customer and
--   pur_create_supplier gain an optional p_code (old calls keep working).

begin;

-- ---------------------------------------------------------------- branches

create table if not exists public.core_branches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  code           text not null check (code ~ '^[A-Za-z0-9-]{1,20}$'),
  name           text not null check (length(trim(name)) between 1 and 120),
  name_ar        text check (name_ar is null or length(trim(name_ar)) between 1 and 120),
  tax_branch_id  uuid,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (org_id, id),
  foreign key (org_id, tax_branch_id) references public.tax_branches(org_id, id)
);
create unique index if not exists core_branches_org_code_uq on public.core_branches (org_id, upper(code)) where deleted_at is null;
create index if not exists core_branches_org_idx on public.core_branches (org_id, active);
drop trigger if exists core_branches_updated_at on public.core_branches;
create trigger core_branches_updated_at before update on public.core_branches for each row execute function public.set_updated_at();

alter table public.core_branches enable row level security;
revoke all on public.core_branches from anon, authenticated;
grant select on public.core_branches to authenticated;
drop policy if exists core_branches_member_read on public.core_branches;
create policy core_branches_member_read on public.core_branches for select to authenticated using (public.is_org_member(org_id));

-- The company's main branch (internal; safe to repeat). Not audited separately: it is part of creating the company, which
-- bootstrap_organization already audits (sql/tests/001 T1d counts exactly that one row).
create or replace function public.core__seed_branch(p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.core_branches where org_id = p_org and upper(code) = 'MAIN' and deleted_at is null;
  if v_id is not null then return v_id; end if;
  insert into public.core_branches (org_id, code, name, name_ar) values (p_org, 'MAIN', 'Main', 'الفرع الرئيسي') returning id into v_id;
  return v_id;
end $$;
revoke all on function public.core__seed_branch(uuid) from public, anon, authenticated;

create or replace function public.core__trg_org_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.core__seed_branch(new.id);
  return null;
end $$;
revoke all on function public.core__trg_org_branch() from public, anon, authenticated;
drop trigger if exists core_org_seed_branch on public.organizations;
create trigger core_org_seed_branch after insert on public.organizations for each row execute function public.core__trg_org_branch();

-- Warehouses belong to a branch.
alter table public.inv_warehouses add column if not exists branch_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inv_warehouses_branch_fk') then
    alter table public.inv_warehouses add constraint inv_warehouses_branch_fk foreign key (org_id, branch_id) references public.core_branches(org_id, id);
  end if;
end $$;

create or replace function public.core__trg_warehouse_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    select b.id into new.branch_id from public.core_branches b
     where b.org_id = new.org_id and b.active and b.deleted_at is null order by (upper(b.code) = 'MAIN') desc, b.created_at limit 1;
  end if;
  return new;
end $$;
revoke all on function public.core__trg_warehouse_branch() from public, anon, authenticated;
drop trigger if exists inv_warehouses_default_branch on public.inv_warehouses;
create trigger inv_warehouses_default_branch before insert on public.inv_warehouses for each row execute function public.core__trg_warehouse_branch();

-- Seed every existing company and put its warehouses in MAIN.
do $$
declare o record; v_branch uuid;
begin
  for o in select id from public.organizations loop
    v_branch := public.core__seed_branch(o.id);
    update public.inv_warehouses set branch_id = v_branch where org_id = o.id and branch_id is null;
  end loop;
end $$;

-- Add or change a branch (p_id null = new). Owner or admin. A branch with active warehouses, or the last active branch, cannot be
-- deactivated.
create or replace function public.core_save_branch(p_id uuid, p_code text, p_name text, p_name_ar text default null, p_active boolean default true,
  p_tax_branch_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); b public.core_branches; v_id uuid; v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_code !~ '^[A-Z0-9-]{1,20}$' or length(trim(coalesce(p_name, ''))) not between 1 and 120 or p_active is null
     or (p_name_ar is not null and length(trim(p_name_ar)) > 120) then
    raise exception 'INVALID_INPUT' using detail = 'a code (letters, digits, dash; up to 20) and a name are required';
  end if;
  if p_tax_branch_id is not null and not exists (select 1 from public.tax_branches where org_id = v_org and id = p_tax_branch_id and deleted_at is null) then
    raise exception 'NOT_FOUND' using detail = 'tax branch';
  end if;
  if exists (select 1 from public.core_branches where org_id = v_org and upper(code) = v_code and deleted_at is null and id is distinct from p_id) then
    raise exception 'DUPLICATE' using detail = format('branch code %s is already used', v_code);
  end if;
  if p_id is null then
    insert into public.core_branches (org_id, code, name, name_ar, active, tax_branch_id)
    values (v_org, v_code, trim(p_name), nullif(trim(coalesce(p_name_ar, '')), ''), p_active, p_tax_branch_id) returning id into v_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'core.branch.created', 'branch', v_id::text, format('%s %s', v_code, trim(p_name)),
            jsonb_build_object('code', v_code, 'name', trim(p_name), 'active', p_active));
    return v_id;
  end if;
  select * into b from public.core_branches where org_id = v_org and id = p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.active and not p_active then
    if exists (select 1 from public.inv_warehouses where org_id = v_org and branch_id = b.id and deleted_at is null) then
      raise exception 'IN_USE' using detail = format('branch %s still has warehouses; move them first', b.code);
    end if;
    if not exists (select 1 from public.core_branches where org_id = v_org and active and deleted_at is null and id <> b.id) then
      raise exception 'IN_USE' using detail = 'a company needs at least one active branch';
    end if;
  end if;
  update public.core_branches set code = v_code, name = trim(p_name), name_ar = nullif(trim(coalesce(p_name_ar, '')), ''), active = p_active,
    tax_branch_id = p_tax_branch_id where id = b.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.branch.changed', 'branch', b.id::text, format('%s %s', v_code, trim(p_name)),
          jsonb_build_object('code', b.code, 'name', b.name, 'name_ar', b.name_ar, 'active', b.active),
          jsonb_build_object('code', v_code, 'name', trim(p_name), 'name_ar', nullif(trim(coalesce(p_name_ar, '')), ''), 'active', p_active));
  return b.id;
end $$;

-- Put a warehouse in a branch. Owner or admin.
create or replace function public.inv_set_warehouse_branch(p_warehouse_id uuid, p_branch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); w public.inv_warehouses; b public.core_branches;
begin
  select * into w from public.inv_warehouses where org_id = v_org and id = p_warehouse_id and deleted_at is null for update;
  select * into b from public.core_branches where org_id = v_org and id = p_branch_id and deleted_at is null;
  if w.id is null or b.id is null then raise exception 'NOT_FOUND'; end if;
  if not b.active then raise exception 'INVALID_STATE' using detail = 'that branch is inactive'; end if;
  if w.branch_id is not distinct from b.id then return; end if;
  update public.inv_warehouses set branch_id = b.id where id = w.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.warehouse.branch_changed', 'warehouse', w.id::text, format('%s moved to branch %s', w.code, b.code),
          jsonb_build_object('branch_id', w.branch_id), jsonb_build_object('branch_id', b.id));
end $$;

-- ---------------------------------------------------------------- party codes

alter table public.sal_customers add column if not exists code text;
alter table public.pur_suppliers add column if not exists code text;

-- The next automatic code for a company: prefix (org setting) + 5 digits from the counter, skipping any code already typed by hand.
create or replace function public.core__next_party_code(p_org uuid, p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v_prefix text; v bigint; v_code text;
begin
  select coalesce(nullif(trim(o.settings ->> (p_kind || '_code_prefix')), ''), case p_kind when 'customer' then 'C-' else 'S-' end)
    into v_prefix from public.organizations o where o.id = p_org;
  loop
    insert into public.inv_counters (org_id, key, value) values (p_org, 'party_' || p_kind, 1)
    on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v;
    v_code := v_prefix || lpad(v::text, 5, '0');
    exit when p_kind = 'customer' and not exists (select 1 from public.sal_customers where org_id = p_org and upper(code) = upper(v_code) and deleted_at is null);
    exit when p_kind = 'supplier' and not exists (select 1 from public.pur_suppliers where org_id = p_org and upper(code) = upper(v_code) and deleted_at is null);
  end loop;
  return v_code;
end $$;
revoke all on function public.core__next_party_code(uuid, text) from public, anon, authenticated;

create or replace function public.core__trg_party_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or length(trim(new.code)) = 0 then
    new.code := public.core__next_party_code(new.org_id, case tg_table_name when 'sal_customers' then 'customer' else 'supplier' end);
  else
    new.code := trim(new.code);
  end if;
  return new;
end $$;
revoke all on function public.core__trg_party_code() from public, anon, authenticated;
drop trigger if exists sal_customers_code on public.sal_customers;
create trigger sal_customers_code before insert on public.sal_customers for each row execute function public.core__trg_party_code();
drop trigger if exists pur_suppliers_code on public.pur_suppliers;
create trigger pur_suppliers_code before insert on public.pur_suppliers for each row execute function public.core__trg_party_code();

-- Existing rows: automatic codes in creation order.
do $$
declare r record;
begin
  for r in select id, org_id from public.sal_customers where code is null order by org_id, created_at, id loop
    update public.sal_customers set code = public.core__next_party_code(r.org_id, 'customer') where id = r.id;
  end loop;
  for r in select id, org_id from public.pur_suppliers where code is null order by org_id, created_at, id loop
    update public.pur_suppliers set code = public.core__next_party_code(r.org_id, 'supplier') where id = r.id;
  end loop;
end $$;

alter table public.sal_customers alter column code set not null;
alter table public.pur_suppliers alter column code set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_customers_code_format') then
    alter table public.sal_customers add constraint sal_customers_code_format check (code ~ '^[A-Za-z0-9-]{1,30}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_suppliers_code_format') then
    alter table public.pur_suppliers add constraint pur_suppliers_code_format check (code ~ '^[A-Za-z0-9-]{1,30}$');
  end if;
end $$;
create unique index if not exists sal_customers_org_code_uq on public.sal_customers (org_id, upper(code)) where deleted_at is null;
create unique index if not exists pur_suppliers_org_code_uq on public.pur_suppliers (org_id, upper(code)) where deleted_at is null;

-- Create functions with an optional typed code (same checks and audit as sql/017 and sql/019, plus the code).
drop function if exists public.sal_create_customer(text, text, text, text);
create or replace function public.sal_create_customer(p_name text, p_contact text default null, p_city text default null, p_phone text default null,
  p_code text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); v_id uuid; v_code text := nullif(trim(coalesce(p_code, '')), '');
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT'; end if;
  if v_code is not null and v_code !~ '^[A-Za-z0-9-]{1,30}$' then raise exception 'INVALID_INPUT' using detail = 'a code is letters, digits and dashes, up to 30'; end if;
  if v_code is not null and exists (select 1 from public.sal_customers where org_id = v_org and upper(code) = upper(v_code) and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = format('customer code %s is already used', v_code);
  end if;
  insert into public.sal_customers (org_id, name, contact, city, phone, code)
  values (v_org, trim(p_name), nullif(trim(p_contact), ''), nullif(trim(p_city), ''), nullif(trim(p_phone), ''), v_code) returning id, code into v_id, v_code;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.customer.created', 'customer', v_id::text, format('%s %s', v_code, trim(p_name)));
  return v_id;
end $$;

drop function if exists public.pur_create_supplier(text, text, text, text);
create or replace function public.pur_create_supplier(p_name text, p_contact text default null, p_city text default null, p_phone text default null,
  p_code text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); v_id uuid; v_code text := nullif(trim(coalesce(p_code, '')), '');
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT'; end if;
  if v_code is not null and v_code !~ '^[A-Za-z0-9-]{1,30}$' then raise exception 'INVALID_INPUT' using detail = 'a code is letters, digits and dashes, up to 30'; end if;
  if v_code is not null and exists (select 1 from public.pur_suppliers where org_id = v_org and upper(code) = upper(v_code) and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = format('supplier code %s is already used', v_code);
  end if;
  insert into public.pur_suppliers (org_id, name, contact, city, phone, code)
  values (v_org, trim(p_name), nullif(trim(p_contact), ''), nullif(trim(p_city), ''), nullif(trim(p_phone), ''), v_code) returning id, code into v_id, v_code;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'purchasing.supplier.created', 'supplier', v_id::text, format('%s %s', v_code, trim(p_name)));
  return v_id;
end $$;

-- Change a code later. Owner or admin.
create or replace function public.sal_set_customer_code(p_customer_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); c public.sal_customers; v_code text := trim(coalesce(p_code, ''));
begin
  if v_code !~ '^[A-Za-z0-9-]{1,30}$' then raise exception 'INVALID_INPUT' using detail = 'a code is letters, digits and dashes, up to 30'; end if;
  select * into c from public.sal_customers where org_id = v_org and id = p_customer_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.code = v_code then return; end if;
  if exists (select 1 from public.sal_customers where org_id = v_org and upper(code) = upper(v_code) and deleted_at is null and id <> c.id) then
    raise exception 'DUPLICATE' using detail = format('customer code %s is already used', v_code);
  end if;
  update public.sal_customers set code = v_code where id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.customer.code_changed', 'customer', c.id::text, format('%s: code %s → %s', c.name, c.code, v_code),
          jsonb_build_object('code', c.code), jsonb_build_object('code', v_code));
end $$;

create or replace function public.pur_set_supplier_code(p_supplier_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); s public.pur_suppliers; v_code text := trim(coalesce(p_code, ''));
begin
  if v_code !~ '^[A-Za-z0-9-]{1,30}$' then raise exception 'INVALID_INPUT' using detail = 'a code is letters, digits and dashes, up to 30'; end if;
  select * into s from public.pur_suppliers where org_id = v_org and id = p_supplier_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.code = v_code then return; end if;
  if exists (select 1 from public.pur_suppliers where org_id = v_org and upper(code) = upper(v_code) and deleted_at is null and id <> s.id) then
    raise exception 'DUPLICATE' using detail = format('supplier code %s is already used', v_code);
  end if;
  update public.pur_suppliers set code = v_code where id = s.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'purchasing.supplier.code_changed', 'supplier', s.id::text, format('%s: code %s → %s', s.name, s.code, v_code),
          jsonb_build_object('code', s.code), jsonb_build_object('code', v_code));
end $$;

revoke all on function public.core_save_branch(uuid, text, text, text, boolean, uuid), public.inv_set_warehouse_branch(uuid, uuid),
  public.sal_create_customer(text, text, text, text, text), public.pur_create_supplier(text, text, text, text, text),
  public.sal_set_customer_code(uuid, text), public.pur_set_supplier_code(uuid, text) from public, anon;
grant execute on function public.core_save_branch(uuid, text, text, text, boolean, uuid), public.inv_set_warehouse_branch(uuid, uuid),
  public.sal_create_customer(text, text, text, text, text), public.pur_create_supplier(text, text, text, text, text),
  public.sal_set_customer_code(uuid, text), public.pur_set_supplier_code(uuid, text) to authenticated;

commit;

-- Verification (read-only): every company has MAIN, every warehouse a branch, every customer and supplier a code; RLS on; no user writes.
select (select count(*) from public.organizations o where not exists (select 1 from public.core_branches b where b.org_id = o.id and upper(b.code) = 'MAIN')) as orgs_without_main,
       (select count(*) from public.inv_warehouses where branch_id is null) as warehouses_without_branch,
       (select count(*) from public.sal_customers where code is null) + (select count(*) from public.pur_suppliers where code is null) as parties_without_code;
select relrowsecurity as branches_rls from pg_class where relname = 'core_branches';
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name = 'core_branches' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select has_function_privilege('anon', 'public.core_save_branch(uuid, text, text, text, boolean, uuid)', 'execute') as anon_can_save_branch,
       has_function_privilege('authenticated', 'public.core__next_party_code(uuid, text)', 'execute') as users_can_call_internal;
