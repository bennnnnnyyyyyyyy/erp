-- 097_sal_prices.sql
-- Prices: slice C of documentation/plans/MASTER_DATA_PLAN.md (Ben, 18 Nov 2026: "Slice A approved on live. Start slice C"; decisions:
-- a new purchase price only suggests; price lists per customer group, with a customer groups table).
--   * pur_supplier_prices: the last cost per supplier and item (company currency of the document), recorded by triggers when a bill line
--     is recorded, and when a purchase order line is saved while that supplier and item have no bill price yet. Audited when it changes.
--     Nothing else changes: the item's sales price is never updated by a purchase ("suggest" only).
--   * sal_item_prices: one sales price per item and currency, before or with VAT as the company enters prices
--     (settings.prices_include_vat, copied when saved so a later change of the setting never silently changes a price's meaning).
--   * sal_customer_groups and sal_customers.customer_group_id; sal_price_lists per customer group and currency with a validity period
--     (from, optional to); never two lists for one group and currency on the same date; sal_price_list_items: a price per item.
--   * sal_prices_for(customer, items, date): the price list's price for the customer's group on that date, else the item's price, else
--     nothing. Order lines take it as a suggestion; the price on the line stays editable (sal_create_order is unchanged).
--   * sal_item_price_info(item): the sales price, list prices, each supplier's last cost and a suggested price (the highest recent cost
--     plus the company's optional markup, settings.default_markup_percent).
-- Every change writes its audit row in the same transaction. Tables: RLS, member read, writes only through functions.
-- sal_customers is read through a table grant, so its new column needs no column grant (checked at the end).
-- Depends on sql/001-096. Rerun-safe. Then run sql/tests/093_sal_prices.sql.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.sal_customer_groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  name       text not null check (length(trim(name)) between 1 and 120),
  name_ar    text check (name_ar is null or length(trim(name_ar)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id)
);
create unique index if not exists sal_customer_groups_name_uq on public.sal_customer_groups (org_id, lower(name)) where deleted_at is null;

alter table public.sal_customers add column if not exists customer_group_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_customers_group_fk') then
    alter table public.sal_customers add constraint sal_customers_group_fk foreign key (org_id, customer_group_id) references public.sal_customer_groups (org_id, id);
  end if;
end $$;
create index if not exists sal_customers_org_group_idx on public.sal_customers (org_id, customer_group_id) where customer_group_id is not null;

create table if not exists public.sal_item_prices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  item_id      uuid not null,
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_minor  bigint not null check (price_minor >= 0),
  includes_vat boolean not null default false,
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, item_id, currency),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);

create table if not exists public.sal_price_lists (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  name              text not null check (length(trim(name)) between 1 and 120),
  customer_group_id uuid not null,
  currency          char(3) not null check (currency ~ '^[A-Z]{3}$'),
  valid_from        date not null,
  valid_to          date,
  includes_vat      boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (org_id, id),
  foreign key (org_id, customer_group_id) references public.sal_customer_groups (org_id, id),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists sal_price_lists_org_group_idx on public.sal_price_lists (org_id, customer_group_id, currency, valid_from);

create table if not exists public.sal_price_list_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  price_list_id uuid not null,
  item_id       uuid not null,
  price_minor   bigint not null check (price_minor >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (price_list_id, item_id),
  foreign key (org_id, price_list_id) references public.sal_price_lists (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);
create index if not exists sal_price_list_items_org_item_idx on public.sal_price_list_items (org_id, item_id);

create table if not exists public.pur_supplier_prices (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  supplier_id     uuid not null,
  item_id         uuid not null,
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  last_cost_minor bigint not null check (last_cost_minor >= 0),
  source_kind     text not null check (source_kind in ('bill', 'order')),
  source_id       uuid not null,
  source_number   text,
  recorded_at     timestamptz not null default now(),
  unique (org_id, supplier_id, item_id, currency),
  foreign key (org_id, supplier_id) references public.pur_suppliers (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);
create index if not exists pur_supplier_prices_org_item_idx on public.pur_supplier_prices (org_id, item_id);

do $$ declare t text; begin
  foreach t in array array['sal_customer_groups', 'sal_item_prices', 'sal_price_lists', 'sal_price_list_items'] loop
    execute format('drop trigger if exists %1$s_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['sal_customer_groups', 'sal_item_prices', 'sal_price_lists', 'sal_price_list_items', 'pur_supplier_prices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %1$s_member_read on public.%1$s', t);
    execute format('create policy %1$s_member_read on public.%1$s for select to authenticated using (public.is_org_member(org_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- supplier prices, recorded from bills and orders

-- Not callable by users. Records the cost and writes an audit row when the price changes. A purchase order price never replaces a bill
-- price (the bill is what was actually charged).
create or replace function public.pur__record_supplier_price(p_org uuid, p_supplier uuid, p_item uuid, p_currency text, p_cost bigint,
  p_kind text, p_source uuid, p_number text) returns void
language plpgsql security definer set search_path = public as $$
declare old public.pur_supplier_prices;
begin
  select * into old from public.pur_supplier_prices
   where org_id = p_org and supplier_id = p_supplier and item_id = p_item and currency = p_currency for update;
  if found and p_kind = 'order' and old.source_kind = 'bill' then return; end if;
  if found and old.last_cost_minor = p_cost and old.source_kind = p_kind and old.source_id = p_source then return; end if;
  insert into public.pur_supplier_prices (org_id, supplier_id, item_id, currency, last_cost_minor, source_kind, source_id, source_number, recorded_at)
  values (p_org, p_supplier, p_item, p_currency, p_cost, p_kind, p_source, p_number, now())
  on conflict (org_id, supplier_id, item_id, currency) do update
    set last_cost_minor = excluded.last_cost_minor, source_kind = excluded.source_kind, source_id = excluded.source_id,
        source_number = excluded.source_number, recorded_at = excluded.recorded_at;
  if old.id is null or old.last_cost_minor is distinct from p_cost then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
    values (p_org, auth.uid(), 'purchasing.supplier_price.recorded', 'item', p_item::text,
            format('Last cost from %s %s: %s %s', p_kind, coalesce(p_number, ''), p_cost, p_currency),
            case when old.id is null then null else jsonb_build_object('lastCostMinor', old.last_cost_minor, 'source', old.source_kind) end,
            jsonb_build_object('supplierId', p_supplier, 'lastCostMinor', p_cost, 'currency', p_currency, 'source', p_kind, 'sourceId', p_source));
  end if;
end $$;

create or replace function public.pur__bill_line_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare b public.pur_supplier_invoices; v_item uuid;
begin
  select * into b from public.pur_supplier_invoices where org_id = new.org_id and id = new.invoice_id;
  select ol.item_id into v_item from public.pur_order_lines ol where ol.org_id = new.org_id and ol.id = new.order_line_id;
  if b.id is not null and v_item is not null then
    perform public.pur__record_supplier_price(new.org_id, b.supplier_id, v_item, b.currency, new.unit_cost_minor, 'bill', b.id, b.number);
  end if;
  return new;
end $$;
drop trigger if exists pur_supplier_invoice_lines_price on public.pur_supplier_invoice_lines;
create trigger pur_supplier_invoice_lines_price after insert on public.pur_supplier_invoice_lines
  for each row execute function public.pur__bill_line_price();

create or replace function public.pur__order_line_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.pur_orders;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and new.unit_cost_minor = old.unit_cost_minor then return new; end if;
  select * into o from public.pur_orders where org_id = new.org_id and id = new.order_id;
  if o.id is not null then
    perform public.pur__record_supplier_price(new.org_id, o.supplier_id, new.item_id, o.currency, new.unit_cost_minor, 'order', o.id, o.number);
  end if;
  return new;
end $$;
drop trigger if exists pur_order_lines_price on public.pur_order_lines;
create trigger pur_order_lines_price after insert or update of unit_cost_minor on public.pur_order_lines
  for each row execute function public.pur__order_line_price();

revoke all on function public.pur__record_supplier_price(uuid, uuid, uuid, text, bigint, text, uuid, text),
  public.pur__bill_line_price(), public.pur__order_line_price() from public, anon, authenticated;

-- ---------------------------------------------------------------- customer groups

create or replace function public.sal_save_customer_group(p_group_id uuid, p_name text, p_name_ar text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); g public.sal_customer_groups; v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  begin
    if p_group_id is null then
      insert into public.sal_customer_groups (org_id, name, name_ar) values (v_org, trim(p_name), nullif(trim(p_name_ar), '')) returning id into v_id;
      insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
      values (v_org, auth.uid(), 'sales.customer_group.created', 'customer_group', v_id::text, format('Customer group %s created', trim(p_name)),
              jsonb_build_object('name', trim(p_name), 'nameAr', nullif(trim(p_name_ar), '')));
      return v_id;
    end if;
    select * into g from public.sal_customer_groups where org_id = v_org and id = p_group_id and deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if g.name = trim(p_name) and g.name_ar is not distinct from nullif(trim(p_name_ar), '') then return g.id; end if;
    update public.sal_customer_groups set name = trim(p_name), name_ar = nullif(trim(p_name_ar), '') where id = g.id;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'another customer group has that name';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.customer_group.updated', 'customer_group', g.id::text, format('Customer group %s changed', trim(p_name)),
          jsonb_build_object('name', g.name, 'nameAr', g.name_ar), jsonb_build_object('name', trim(p_name), 'nameAr', nullif(trim(p_name_ar), '')));
  return g.id;
end $$;

-- Soft delete; refused while a live customer or a live price list uses it.
create or replace function public.sal_delete_customer_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); g public.sal_customer_groups;
begin
  select * into g from public.sal_customer_groups where org_id = v_org and id = p_group_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.sal_customers c where c.org_id = v_org and c.customer_group_id = g.id and c.deleted_at is null)
     or exists (select 1 from public.sal_price_lists l where l.org_id = v_org and l.customer_group_id = g.id and l.deleted_at is null) then
    raise exception 'IN_USE' using detail = 'move its customers and remove its price lists first';
  end if;
  update public.sal_customer_groups set deleted_at = now() where id = g.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'sales.customer_group.deleted', 'customer_group', g.id::text, format('Customer group %s deleted', g.name),
          jsonb_build_object('name', g.name, 'nameAr', g.name_ar));
end $$;

create or replace function public.sal_set_customer_group(p_customer_id uuid, p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); c public.sal_customers;
begin
  select * into c from public.sal_customers where org_id = v_org and id = p_customer_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_group_id is not null and not exists (select 1 from public.sal_customer_groups g where g.org_id = v_org and g.id = p_group_id and g.deleted_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  if c.customer_group_id is not distinct from p_group_id then return; end if;
  update public.sal_customers set customer_group_id = p_group_id where id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.customer.group_changed', 'customer', c.id::text, format('Customer %s moved to another group', c.name),
          jsonb_build_object('customerGroupId', c.customer_group_id), jsonb_build_object('customerGroupId', p_group_id));
end $$;

-- ---------------------------------------------------------------- item sales price

-- The item's sales price in the company currency (null removes it). Whether it includes VAT follows the company's setting at the time.
create or replace function public.sal_set_item_price(p_item_id uuid, p_price_minor bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); v_cur text; v_incl boolean; p public.sal_item_prices;
begin
  if p_price_minor is not null and p_price_minor < 0 then raise exception 'INVALID_INPUT' using detail = 'a price is zero or more'; end if;
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  select o.default_currency, coalesce((o.settings ->> 'prices_include_vat')::boolean, false) into v_cur, v_incl from public.organizations o where o.id = v_org;
  select * into p from public.sal_item_prices where org_id = v_org and item_id = p_item_id and currency = v_cur for update;
  if p_price_minor is null then
    if p.id is null then return; end if;
    delete from public.sal_item_prices where id = p.id;
  else
    if p.id is not null and p.price_minor = p_price_minor and p.includes_vat = v_incl then return; end if;
    insert into public.sal_item_prices (org_id, item_id, currency, price_minor, includes_vat, updated_by)
    values (v_org, p_item_id, v_cur, p_price_minor, v_incl, auth.uid())
    on conflict (org_id, item_id, currency) do update set price_minor = excluded.price_minor, includes_vat = excluded.includes_vat, updated_by = excluded.updated_by;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.item_price.changed', 'item', p_item_id::text, format('Sales price set to %s %s', coalesce(p_price_minor::text, 'none'), v_cur),
          case when p.id is null then null else jsonb_build_object('priceMinor', p.price_minor, 'includesVat', p.includes_vat) end,
          case when p_price_minor is null then null else jsonb_build_object('priceMinor', p_price_minor, 'currency', v_cur, 'includesVat', v_incl) end);
end $$;

-- The optional markup used for the suggested price (null = none). Owners and admins; audited.
create or replace function public.sal_set_default_markup(p_percent numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); v_before jsonb;
begin
  if p_percent is not null and (p_percent < 0 or p_percent > 1000) then raise exception 'INVALID_INPUT' using detail = 'markup is 0 to 1000 percent'; end if;
  select o.settings -> 'default_markup_percent' into v_before from public.organizations o where o.id = v_org for update;
  if v_before is not distinct from to_jsonb(p_percent) then return; end if;
  update public.organizations o set settings = case when p_percent is null then coalesce(o.settings, '{}'::jsonb) - 'default_markup_percent'
    else coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('default_markup_percent', p_percent) end where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.default_markup_changed', 'organization', v_org::text,
          format('Default markup set to %s', coalesce(p_percent::text || '%', 'none')), v_before, to_jsonb(p_percent));
end $$;

-- ---------------------------------------------------------------- price lists

-- Create (p_list_id null) or change a price list. Never two live lists for one group and currency on the same date.
create or replace function public.sal_save_price_list(p_list_id uuid, p_name text, p_customer_group_id uuid, p_valid_from date, p_valid_to date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); l public.sal_price_lists; v_cur text; v_incl boolean; v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  if p_valid_from is null or (p_valid_to is not null and p_valid_to < p_valid_from) then raise exception 'INVALID_INPUT' using detail = 'the dates are not valid'; end if;
  -- one writer at a time per group, so two people cannot create overlapping lists
  perform 1 from public.sal_customer_groups g where g.org_id = v_org and g.id = p_customer_group_id and g.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select o.default_currency, coalesce((o.settings ->> 'prices_include_vat')::boolean, false) into v_cur, v_incl from public.organizations o where o.id = v_org;
  if p_list_id is not null then
    select * into l from public.sal_price_lists where org_id = v_org and id = p_list_id and deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_cur := l.currency;
  end if;
  if exists (select 1 from public.sal_price_lists x
              where x.org_id = v_org and x.customer_group_id = p_customer_group_id and x.currency = v_cur and x.deleted_at is null
                and x.id is distinct from p_list_id
                and x.valid_from <= coalesce(p_valid_to, 'infinity'::date) and p_valid_from <= coalesce(x.valid_to, 'infinity'::date)) then
    raise exception 'DUPLICATE' using detail = 'another price list for this customer group covers some of these dates';
  end if;
  if p_list_id is null then
    insert into public.sal_price_lists (org_id, name, customer_group_id, currency, valid_from, valid_to, includes_vat)
    values (v_org, trim(p_name), p_customer_group_id, v_cur, p_valid_from, p_valid_to, v_incl) returning id into v_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'sales.price_list.created', 'price_list', v_id::text, format('Price list %s created', trim(p_name)),
            jsonb_build_object('name', trim(p_name), 'customerGroupId', p_customer_group_id, 'currency', v_cur, 'validFrom', p_valid_from,
                               'validTo', p_valid_to, 'includesVat', v_incl));
    return v_id;
  end if;
  if l.name = trim(p_name) and l.customer_group_id = p_customer_group_id and l.valid_from = p_valid_from and l.valid_to is not distinct from p_valid_to then
    return l.id;
  end if;
  update public.sal_price_lists set name = trim(p_name), customer_group_id = p_customer_group_id, valid_from = p_valid_from, valid_to = p_valid_to
   where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.price_list.updated', 'price_list', l.id::text, format('Price list %s changed', trim(p_name)),
          jsonb_build_object('name', l.name, 'customerGroupId', l.customer_group_id, 'validFrom', l.valid_from, 'validTo', l.valid_to),
          jsonb_build_object('name', trim(p_name), 'customerGroupId', p_customer_group_id, 'validFrom', p_valid_from, 'validTo', p_valid_to));
  return l.id;
end $$;

create or replace function public.sal_delete_price_list(p_list_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); l public.sal_price_lists;
begin
  select * into l from public.sal_price_lists where org_id = v_org and id = p_list_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.sal_price_lists set deleted_at = now() where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'sales.price_list.deleted', 'price_list', l.id::text, format('Price list %s deleted', l.name),
          jsonb_build_object('name', l.name, 'customerGroupId', l.customer_group_id, 'validFrom', l.valid_from, 'validTo', l.valid_to));
end $$;

-- An item's price on a list (null removes it).
create or replace function public.sal_set_price_list_item(p_list_id uuid, p_item_id uuid, p_price_minor bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); l public.sal_price_lists; p public.sal_price_list_items;
begin
  if p_price_minor is not null and p_price_minor < 0 then raise exception 'INVALID_INPUT' using detail = 'a price is zero or more'; end if;
  select * into l from public.sal_price_lists where org_id = v_org and id = p_list_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  select * into p from public.sal_price_list_items where price_list_id = l.id and item_id = p_item_id;
  if p_price_minor is null then
    if p.id is null then return; end if;
    delete from public.sal_price_list_items where id = p.id;
  else
    if p.id is not null and p.price_minor = p_price_minor then return; end if;
    insert into public.sal_price_list_items (org_id, price_list_id, item_id, price_minor) values (v_org, l.id, p_item_id, p_price_minor)
    on conflict (price_list_id, item_id) do update set price_minor = excluded.price_minor;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.price_list.item_changed', 'price_list', l.id::text,
          format('Price list %s: item price set to %s', l.name, coalesce(p_price_minor::text, 'none')),
          case when p.id is null then null else jsonb_build_object('itemId', p_item_id, 'priceMinor', p.price_minor) end,
          case when p_price_minor is null then null else jsonb_build_object('itemId', p_item_id, 'priceMinor', p_price_minor) end);
end $$;

-- ---------------------------------------------------------------- reading prices

-- The price a customer gets for each item on a date: the customer group's price list, else the item's sales price. Members too.
create or replace function public.sal_prices_for(p_customer_id uuid, p_item_ids uuid[], p_on date default null)
returns table (item_id uuid, price_minor bigint, currency text, includes_vat boolean, source text, price_list_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin', 'member', 'viewer']); v_cur text; v_group uuid; v_list uuid;
  v_day date;
begin
  select c.customer_group_id into v_group from public.sal_customers c where c.org_id = v_org and c.id = p_customer_id and c.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_day := coalesce(p_on, public.acc__local_date(v_org, now()));
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  if v_group is not null then
    select l.id into v_list from public.sal_price_lists l
     where l.org_id = v_org and l.customer_group_id = v_group and l.currency = v_cur and l.deleted_at is null
       and l.valid_from <= v_day and (l.valid_to is null or l.valid_to >= v_day)
     order by l.valid_from desc limit 1;
  end if;
  return query
  select i.id,
         coalesce(li.price_minor, ip.price_minor),
         v_cur::text,
         case when li.id is not null then l.includes_vat else ip.includes_vat end,
         case when li.id is not null then 'list' when ip.id is not null then 'item' end,
         case when li.id is not null then v_list end
    from public.inv_items i
    left join public.sal_price_list_items li on li.org_id = v_org and li.price_list_id = v_list and li.item_id = i.id
    left join public.sal_price_lists l on l.id = v_list
    left join public.sal_item_prices ip on ip.org_id = v_org and ip.item_id = i.id and ip.currency = v_cur
   where i.org_id = v_org and i.id = any (p_item_ids) and i.deleted_at is null;
end $$;

-- Everything about an item's prices for its page: sales price, list prices, each supplier's last cost and a suggested price.
create or replace function public.sal_item_price_info(p_item_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin', 'member', 'viewer']); v_cur text; v_markup numeric; v_cost bigint;
  v_price jsonb; v_lists jsonb; v_costs jsonb;
begin
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id) then raise exception 'NOT_FOUND'; end if;
  select o.default_currency, (o.settings ->> 'default_markup_percent')::numeric into v_cur, v_markup from public.organizations o where o.id = v_org;
  select jsonb_build_object('priceMinor', p.price_minor, 'currency', p.currency, 'includesVat', p.includes_vat, 'updatedAt', p.updated_at)
    into v_price from public.sal_item_prices p where p.org_id = v_org and p.item_id = p_item_id and p.currency = v_cur;
  select coalesce(jsonb_agg(jsonb_build_object('priceListId', l.id, 'name', l.name, 'customerGroupId', l.customer_group_id,
           'validFrom', l.valid_from, 'validTo', l.valid_to, 'priceMinor', li.price_minor, 'currency', l.currency, 'includesVat', l.includes_vat)
           order by l.valid_from desc), '[]'::jsonb)
    into v_lists from public.sal_price_list_items li join public.sal_price_lists l on l.id = li.price_list_id and l.deleted_at is null
   where li.org_id = v_org and li.item_id = p_item_id;
  select coalesce(jsonb_agg(jsonb_build_object('supplierId', sp.supplier_id, 'supplierName', s.name, 'lastCostMinor', sp.last_cost_minor,
           'currency', sp.currency, 'source', sp.source_kind, 'sourceNumber', sp.source_number, 'recordedAt', sp.recorded_at)
           order by sp.recorded_at desc), '[]'::jsonb)
    into v_costs from public.pur_supplier_prices sp join public.pur_suppliers s on s.org_id = sp.org_id and s.id = sp.supplier_id
   where sp.org_id = v_org and sp.item_id = p_item_id;
  -- the most recent cost in the company currency; with a markup the suggestion is that cost plus the markup, rounded to whole minor units
  select sp.last_cost_minor into v_cost from public.pur_supplier_prices sp
   where sp.org_id = v_org and sp.item_id = p_item_id and sp.currency = v_cur order by sp.recorded_at desc limit 1;
  return jsonb_build_object('currency', v_cur, 'salesPrice', v_price, 'priceLists', v_lists, 'supplierCosts', v_costs,
    'markupPercent', v_markup, 'latestCostMinor', v_cost,
    'suggestedPriceMinor', case when v_cost is null then null else round(v_cost * (1 + coalesce(v_markup, 0) / 100))::bigint end);
end $$;

revoke all on function public.sal_save_customer_group(uuid, text, text), public.sal_delete_customer_group(uuid),
  public.sal_set_customer_group(uuid, uuid), public.sal_set_item_price(uuid, bigint), public.sal_set_default_markup(numeric),
  public.sal_save_price_list(uuid, text, uuid, date, date), public.sal_delete_price_list(uuid), public.sal_set_price_list_item(uuid, uuid, bigint),
  public.sal_prices_for(uuid, uuid[], date), public.sal_item_price_info(uuid) from public, anon;
grant execute on function public.sal_save_customer_group(uuid, text, text), public.sal_delete_customer_group(uuid),
  public.sal_set_customer_group(uuid, uuid), public.sal_set_item_price(uuid, bigint), public.sal_set_default_markup(numeric),
  public.sal_save_price_list(uuid, text, uuid, date, date), public.sal_delete_price_list(uuid), public.sal_set_price_list_item(uuid, uuid, bigint),
  public.sal_prices_for(uuid, uuid[], date), public.sal_item_price_info(uuid) to authenticated;

commit;

-- Verification (read-only): RLS on the 5 new tables, reads only, the customer group column readable, anonymous users locked out.
select (select count(*) from pg_class where relname in ('sal_customer_groups', 'sal_item_prices', 'sal_price_lists', 'sal_price_list_items', 'pur_supplier_prices')
          and relnamespace = 'public'::regnamespace and relrowsecurity) as tables_with_rls,
       has_table_privilege('authenticated', 'public.pur_supplier_prices', 'insert') as users_insert_prices,
       has_column_privilege('authenticated', 'public.sal_customers', 'customer_group_id', 'select') as users_read_customer_group,
       has_function_privilege('anon', 'public.sal_prices_for(uuid, uuid[], date)', 'execute') as anon_reads_prices,
       (select count(*) from pg_trigger where tgname in ('pur_supplier_invoice_lines_price', 'pur_order_lines_price')) as price_triggers;
