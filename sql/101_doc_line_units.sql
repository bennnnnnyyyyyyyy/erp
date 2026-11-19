-- 101_doc_line_units.sql
-- Master data plan slice D (Ben, 19 Nov 2026; ADR-0006): buy and sell in other units (a box of 12) while stock stays in the item's base unit.
-- Decision: a line stays stored in base units, as before (qty in pieces, price per piece), so invoicing, VAT, stock, costs and accounting
-- are unchanged. The line also keeps the unit it was typed in (unit, unit_factor) so every screen and print shows "3 box (36 piece)".
-- Prices come from the piece price (a box line suggests piece price x factor); a box price that does not split into whole minor units is
-- rounded per piece, and the screen shows the result before saving.
--   * sal_order_lines, pur_order_lines: unit (null = base unit) and unit_factor (base units per one unit, as set up in sql/044).
--   * inv_items: default_purchase_unit, default_sale_unit (null = base unit); new lines start with them. Column grants added here
--     (inv_items is read column by column; sql/tests/092).
--   * inv_set_item_default_units (owners and admins, audited).
--   * sal_set_order_line_units / pur_set_order_line_units: record the typed unit of each line of an order that has not moved yet (a sales
--     order still open, a purchase order still ordered with nothing received). The unit must be set up for that item and offered for
--     selling / buying. Whole pieces only: unless the base unit is a measure (kg, litre, metre, ...), the base quantity must be whole.
-- Depends on sql/001-100. Rerun-safe. Run the whole file, then sql/tests/098_doc_line_units.sql.

begin;

alter table public.sal_order_lines add column if not exists unit text check (unit is null or length(trim(unit)) between 1 and 32);
alter table public.sal_order_lines add column if not exists unit_factor numeric(18, 6) check (unit_factor is null or unit_factor > 0);
alter table public.pur_order_lines add column if not exists unit text check (unit is null or length(trim(unit)) between 1 and 32);
alter table public.pur_order_lines add column if not exists unit_factor numeric(18, 6) check (unit_factor is null or unit_factor > 0);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_order_lines_unit_pair') then
    alter table public.sal_order_lines add constraint sal_order_lines_unit_pair check ((unit is null) = (unit_factor is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_order_lines_unit_pair') then
    alter table public.pur_order_lines add constraint pur_order_lines_unit_pair check ((unit is null) = (unit_factor is null));
  end if;
end $$;

alter table public.inv_items add column if not exists default_purchase_unit text check (default_purchase_unit is null or length(trim(default_purchase_unit)) between 1 and 32);
alter table public.inv_items add column if not exists default_sale_unit text check (default_sale_unit is null or length(trim(default_sale_unit)) between 1 and 32);
grant select (default_purchase_unit, default_sale_unit) on public.inv_items to authenticated;

-- Base units that are measures may hold decimals (1.5 kg); any other base unit (piece, box, pair, ...) must stay whole.
create or replace function public.inv__unit_allows_decimals(p_unit text) returns boolean
language sql immutable set search_path = public as $$
  select lower(trim(coalesce(p_unit, ''))) = any (array['kg', 'kilo', 'kilogram', 'g', 'gram', 'gm', 'mg', 'ton', 'tonne', 't',
    'l', 'lt', 'ltr', 'litre', 'liter', 'ml', 'm', 'metre', 'meter', 'cm', 'mm', 'km', 'm2', 'sqm', 'm3', 'cbm',
    'كجم', 'كيلو', 'جم', 'جرام', 'لتر', 'مل', 'متر', 'سم'])
$$;

-- Default units for new lines. Null or the base unit = the base unit. A unit must be set up for the item and offered for that use.
create or replace function public.inv_set_item_default_units(p_item_id uuid, p_purchase_unit text, p_sale_unit text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']); it public.inv_items; v_buy text := nullif(trim(coalesce(p_purchase_unit, '')), '');
  v_sell text := nullif(trim(coalesce(p_sale_unit, '')), '');
begin
  select * into it from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if lower(v_buy) = lower(it.uom) then v_buy := null; end if;
  if lower(v_sell) = lower(it.uom) then v_sell := null; end if;
  if v_buy is not null then
    select x.unit into v_buy from public.inv_item_units x
     where x.org_id = v_org and x.item_id = p_item_id and lower(x.unit) = lower(v_buy) and x.for_purchase and x.deleted_at is null;
    if not found then raise exception 'UNKNOWN_UNIT' using detail = format('%s is not set up for buying this item', trim(p_purchase_unit)); end if;
  end if;
  if v_sell is not null then
    select x.unit into v_sell from public.inv_item_units x
     where x.org_id = v_org and x.item_id = p_item_id and lower(x.unit) = lower(v_sell) and x.for_sale and x.deleted_at is null;
    if not found then raise exception 'UNKNOWN_UNIT' using detail = format('%s is not set up for selling this item', trim(p_sale_unit)); end if;
  end if;
  if it.default_purchase_unit is not distinct from v_buy and it.default_sale_unit is not distinct from v_sell then return; end if;
  update public.inv_items i set default_purchase_unit = v_buy, default_sale_unit = v_sell where i.id = it.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item.default_units_changed', 'item', p_item_id::text,
          format('%s: buy in %s, sell in %s', it.sku, coalesce(v_buy, it.uom), coalesce(v_sell, it.uom)),
          jsonb_build_object('purchase_unit', it.default_purchase_unit, 'sale_unit', it.default_sale_unit),
          jsonb_build_object('purchase_unit', v_buy, 'sale_unit', v_sell));
end $$;

-- The typed unit of one line: {unit, factor}, or nulls for the base unit. Checks the use and whole pieces. Internal.
create or replace function public.inv__line_unit(p_org uuid, p_item_id uuid, p_unit text, p_qty numeric, p_use text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_base text; v_unit text := nullif(trim(coalesce(p_unit, '')), ''); u public.inv_item_units;
begin
  select i.uom into v_base from public.inv_items i where i.org_id = p_org and i.id = p_item_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_unit is null or lower(v_unit) = lower(v_base) then return jsonb_build_object('unit', null, 'factor', null); end if;
  select * into u from public.inv_item_units x
   where x.org_id = p_org and x.item_id = p_item_id and lower(x.unit) = lower(v_unit) and x.deleted_at is null
     and (case when p_use = 'sale' then x.for_sale else x.for_purchase end);
  if not found then
    raise exception 'UNKNOWN_UNIT' using detail = format('%s is not set up for %s this item', v_unit, case when p_use = 'sale' then 'selling' else 'buying' end);
  end if;
  if not public.inv__unit_allows_decimals(v_base) and p_qty <> trunc(p_qty) then
    raise exception 'INVALID_INPUT' using detail = format('%s %s is not a whole number of %s', trim(to_char(p_qty / u.factor, 'FM999999999990.###')), u.unit, v_base);
  end if;
  return jsonb_build_object('unit', u.unit, 'factor', u.factor);
end $$;

-- p_lines: [{itemId, unit}] for lines of this order (one line per item). Lines not listed keep their unit.
create or replace function public.sal_set_order_line_units(p_order_id uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']); o public.sal_orders; e jsonb; l public.sal_order_lines; u jsonb;
  v_changed int := 0; v_item uuid;
begin
  select * into o from public.sal_orders x where x.org_id = v_org and x.id = p_order_id and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'open' or o.request_id is not null then raise exception 'INVALID_STATE' using detail = 'the order is no longer open'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    begin v_item := (e->>'itemId')::uuid; exception when others then raise exception 'INVALID_INPUT'; end;
    select * into l from public.sal_order_lines x where x.org_id = v_org and x.order_id = o.id and x.item_id = v_item for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    u := public.inv__line_unit(v_org, v_item, e->>'unit', l.qty, 'sale');
    if l.unit is not distinct from (u->>'unit') and l.unit_factor is not distinct from (u->>'factor')::numeric then continue; end if;
    update public.sal_order_lines x set unit = u->>'unit', unit_factor = (u->>'factor')::numeric where x.id = l.id;
    v_changed := v_changed + 1;
  end loop;
  if v_changed > 0 then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'sales.order.units_set', 'sales_order', o.id::text, format('%s: units on %s line(s)', o.number, v_changed), p_lines);
  end if;
end $$;

create or replace function public.pur_set_order_line_units(p_order_id uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.pur__guard(array['owner', 'admin']); o public.pur_orders; e jsonb; l public.pur_order_lines; u jsonb;
  v_changed int := 0; v_item uuid;
begin
  select * into o from public.pur_orders x where x.org_id = v_org and x.id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'ordered' or exists (select 1 from public.pur_order_lines x where x.order_id = o.id and x.received_qty > 0) then
    raise exception 'INVALID_STATE' using detail = 'goods have already been received on this order';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    begin v_item := (e->>'itemId')::uuid; exception when others then raise exception 'INVALID_INPUT'; end;
    select * into l from public.pur_order_lines x where x.org_id = v_org and x.order_id = o.id and x.item_id = v_item and x.deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    u := public.inv__line_unit(v_org, v_item, e->>'unit', l.qty, 'purchase');
    if l.unit is not distinct from (u->>'unit') and l.unit_factor is not distinct from (u->>'factor')::numeric then continue; end if;
    update public.pur_order_lines x set unit = u->>'unit', unit_factor = (u->>'factor')::numeric where x.id = l.id;
    v_changed := v_changed + 1;
  end loop;
  if v_changed > 0 then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'purchasing.order.units_set', 'purchase_order', o.id::text, format('%s: units on %s line(s)', o.number, v_changed), p_lines);
  end if;
end $$;

revoke all on function public.inv__line_unit(uuid, uuid, text, numeric, text), public.inv__unit_allows_decimals(text) from public, anon, authenticated;
revoke all on function public.inv_set_item_default_units(uuid, text, text), public.sal_set_order_line_units(uuid, jsonb),
  public.pur_set_order_line_units(uuid, jsonb) from public, anon;
grant execute on function public.inv_set_item_default_units(uuid, text, text), public.sal_set_order_line_units(uuid, jsonb),
  public.pur_set_order_line_units(uuid, jsonb) to authenticated;

commit;

-- Verification (read-only).
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name in ('sal_order_lines', 'pur_order_lines') and column_name in ('unit', 'unit_factor'))
       or (table_name = 'inv_items' and column_name in ('default_purchase_unit', 'default_sale_unit')))) as new_columns,
  has_column_privilege('authenticated', 'public.inv_items', 'default_sale_unit', 'SELECT') as users_read_defaults,
  has_function_privilege('anon', 'public.sal_set_order_line_units(uuid, jsonb)', 'execute') as anon_sets_units,
  has_function_privilege('authenticated', 'public.inv__line_unit(uuid, uuid, text, numeric, text)', 'execute') as users_call_internal;
