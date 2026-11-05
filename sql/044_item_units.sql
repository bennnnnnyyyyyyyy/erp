-- 044_item_units.sql
-- S5a of documentation/plans/SUPERFIX_WORKFLOW_PLAN.md: extra units per item with a conversion factor (box = 12 pieces).
-- Stock, the ledger and every existing line stay in the item's base unit (inv_items.uom, factor 1; decision D7). This slice adds:
--   * inv_item_units: item, unit code, factor (base units per one of this unit), whether it is offered for buying and/or selling;
--   * inv_set_item_unit / inv_remove_item_unit (owners and admins; audited; removal is a soft delete that keeps the history);
--   * inv_to_base_qty(item, unit, qty): the conversion every later slice uses, refusing an unknown unit (UNKNOWN_UNIT).
-- S5b (unit and factor stored on order and request lines, with prices per chosen unit) is a separate slice: converting a price per
-- carton to a price per piece loses money to rounding unless the line keeps its own unit, so it needs its own design review.
-- Depends on sql/001-043. Rerun-safe. Run the whole file, then sql/tests/039_item_units.sql.

begin;

create table if not exists public.inv_item_units (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  item_id     uuid not null,
  unit        text not null check (length(trim(unit)) between 1 and 32),
  factor      numeric(18, 6) not null check (factor > 0),
  for_purchase boolean not null default true,
  for_sale    boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);
-- One live row per item and unit (case-insensitive); removed rows stay as history.
create unique index if not exists inv_item_units_live_uq on public.inv_item_units (org_id, item_id, lower(unit)) where deleted_at is null;

alter table public.inv_item_units enable row level security;
revoke all on public.inv_item_units from anon, authenticated;
grant select on public.inv_item_units to authenticated;
drop policy if exists inv_item_units_member_read on public.inv_item_units;
create policy inv_item_units_member_read on public.inv_item_units for select to authenticated using (public.is_org_member(org_id));
drop trigger if exists inv_item_units_updated_at on public.inv_item_units;
create trigger inv_item_units_updated_at before update on public.inv_item_units for each row execute function public.set_updated_at();

-- Add a unit, or change its factor or flags. The base unit itself cannot be added (it is always factor 1).
create or replace function public.inv_set_item_unit(p_item_id uuid, p_unit text, p_factor numeric, p_for_purchase boolean default true, p_for_sale boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  v_base text; v_sku text; v_unit text := trim(coalesce(p_unit, '')); u public.inv_item_units; v_id uuid;
begin
  if length(v_unit) not between 1 and 32 or p_factor is null or p_factor <= 0 or p_for_purchase is null or p_for_sale is null then
    raise exception 'INVALID_INPUT' using detail = 'a unit name and a factor above zero are required';
  end if;
  select i.uom, i.sku into v_base, v_sku from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if lower(v_unit) = lower(v_base) then raise exception 'INVALID_INPUT' using detail = format('%s is the base unit (always 1)', v_base); end if;
  select * into u from public.inv_item_units x where x.org_id = v_org and x.item_id = p_item_id and lower(x.unit) = lower(v_unit) and x.deleted_at is null for update;
  if found then
    if u.factor = p_factor and u.for_purchase = p_for_purchase and u.for_sale = p_for_sale then return u.id; end if;
    update public.inv_item_units x set factor = p_factor, for_purchase = p_for_purchase, for_sale = p_for_sale where x.id = u.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
    values (v_org, auth.uid(), 'inventory.item_unit.changed', 'item', p_item_id::text, format('%s: 1 %s = %s %s', v_sku, u.unit, p_factor, v_base),
            jsonb_build_object('factor', u.factor, 'for_purchase', u.for_purchase, 'for_sale', u.for_sale),
            jsonb_build_object('factor', p_factor, 'for_purchase', p_for_purchase, 'for_sale', p_for_sale));
    return u.id;
  end if;
  insert into public.inv_item_units (org_id, item_id, unit, factor, for_purchase, for_sale, created_by)
  values (v_org, p_item_id, v_unit, p_factor, p_for_purchase, p_for_sale, auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'inventory.item_unit.added', 'item', p_item_id::text, format('%s: 1 %s = %s %s', v_sku, v_unit, p_factor, v_base),
          jsonb_build_object('unit', v_unit, 'factor', p_factor, 'for_purchase', p_for_purchase, 'for_sale', p_for_sale));
  return v_id;
end $$;

create or replace function public.inv_remove_item_unit(p_item_id uuid, p_unit text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); u public.inv_item_units;
begin
  select * into u from public.inv_item_units x where x.org_id = v_org and x.item_id = p_item_id and lower(x.unit) = lower(trim(coalesce(p_unit, ''))) and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.inv_item_units x set deleted_at = now() where x.id = u.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'inventory.item_unit.removed', 'item', p_item_id::text, format('Unit %s removed', u.unit), jsonb_build_object('unit', u.unit, 'factor', u.factor));
end $$;

-- qty in p_unit -> qty in the base unit. p_unit null or the base unit = factor 1. Unknown unit = UNKNOWN_UNIT. For the caller's own
-- organization only (members can read units, so they may convert).
create or replace function public.inv_to_base_qty(p_item_id uuid, p_unit text, p_qty numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']); v_base text; v_factor numeric;
begin
  if p_qty is null then raise exception 'INVALID_INPUT'; end if;
  select i.uom into v_base from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_unit is null or lower(trim(p_unit)) = lower(v_base) then return p_qty; end if;
  select x.factor into v_factor from public.inv_item_units x where x.org_id = v_org and x.item_id = p_item_id and lower(x.unit) = lower(trim(p_unit)) and x.deleted_at is null;
  if v_factor is null then raise exception 'UNKNOWN_UNIT' using detail = format('%s is not set up for this item', trim(p_unit)); end if;
  return round(p_qty * v_factor, 3);
end $$;

revoke all on function public.inv_set_item_unit(uuid, text, numeric, boolean, boolean), public.inv_remove_item_unit(uuid, text), public.inv_to_base_qty(uuid, text, numeric) from public, anon;
grant execute on function public.inv_set_item_unit(uuid, text, numeric, boolean, boolean), public.inv_remove_item_unit(uuid, text), public.inv_to_base_qty(uuid, text, numeric) to authenticated;

commit;

-- Verification (read-only): RLS on, no user write grants, functions open to signed-in users only.
select relname, relrowsecurity from pg_class where relname = 'inv_item_units';
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name = 'inv_item_units' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select has_function_privilege('anon', 'public.inv_set_item_unit(uuid, text, numeric, boolean, boolean)', 'execute') as anon_can_set_unit;
