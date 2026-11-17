-- 095_inv_item_groups.sql
-- Item groups and item codes: slice A of documentation/plans/MASTER_DATA_PLAN.md (approved by Ben on 17 Nov 2026, section 11).
--   * inv_item_groups: a tree of any depth; each group has a code (unique among its live siblings) and a name in English and Arabic.
--     No cycles; a group cannot be deleted while a live item or a live sub-group uses it. Owners and admins change groups; members read.
--   * inv_items.group_id: optional. Required for new items only when the company's code rule is "group codes".
--   * The company's item code rule (organizations.settings 'item_code_rule'): typed, prefix (the sql/075 format) or group
--     (group codes joined by the separator, then a sequence: group 10, sub-group 03, digits 3, separator "-" -> 10-03-007).
--     With no rule saved, a company that chose a sql/075 format keeps "prefix" and any other keeps "typed", so nothing changes.
--   * Codes never change: the SKU stays not editable (sql/062). Renaming or re-coding a group leaves existing item codes as they are,
--     and an item moved to another group keeps its code (the move is audited). Deleted items keep their code, so a code is never reused.
--   * inv_create_item gains p_group_id (last, optional; same drop-and-recreate as sql/046). A blank SKU under the prefix or group rule
--     gets the next code in the database. inv_next_sku() keeps its signature and answers through inv_next_item_code(null).
-- Every change writes its audit row in the same transaction. Depends on sql/001-094. Rerun-safe.
-- Then run sql/tests/090_inv_item_groups.sql.

begin;

-- ---------------------------------------------------------------- table

create table if not exists public.inv_item_groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  parent_id  uuid,
  code       text not null check (code ~ '^[A-Z0-9]{1,10}$'),
  name       text not null check (length(trim(name)) between 1 and 120),
  name_ar    text check (name_ar is null or length(trim(name_ar)) between 1 and 120),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, parent_id) references public.inv_item_groups (org_id, id),
  check (parent_id is null or parent_id <> id)
);
-- a code is unique among the live groups under the same parent (top-level groups share the zero id)
create unique index if not exists inv_item_groups_sibling_code_uq on public.inv_item_groups
  (org_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), code) where deleted_at is null;
create index if not exists inv_item_groups_org_parent_idx on public.inv_item_groups (org_id, parent_id);

drop trigger if exists inv_item_groups_updated_at on public.inv_item_groups;
create trigger inv_item_groups_updated_at before update on public.inv_item_groups for each row execute function public.set_updated_at();

alter table public.inv_item_groups enable row level security;
revoke all on public.inv_item_groups from anon, authenticated;
grant select on public.inv_item_groups to authenticated;
drop policy if exists inv_item_groups_member_read on public.inv_item_groups;
create policy inv_item_groups_member_read on public.inv_item_groups for select to authenticated using (public.is_org_member(org_id));

alter table public.inv_items add column if not exists group_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inv_items_group_fk') then
    alter table public.inv_items add constraint inv_items_group_fk foreign key (org_id, group_id) references public.inv_item_groups (org_id, id);
  end if;
end $$;
create index if not exists inv_items_org_group_idx on public.inv_items (org_id, group_id) where group_id is not null;

-- ---------------------------------------------------------------- helpers (not callable by users)

-- The company's code rule, with the defaults filled in: {"rule": typed|prefix|group, "separator": "-", "digits": 3}.
create or replace function public.inv__code_rule(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'rule', coalesce(o.settings -> 'item_code_rule' ->> 'rule', case when o.settings ? 'sku_format' then 'prefix' else 'typed' end),
    'separator', coalesce(o.settings -> 'item_code_rule' ->> 'separator', '-'),
    'digits', coalesce((o.settings -> 'item_code_rule' ->> 'digits')::int, 3))
  from public.organizations o where o.id = p_org;
$$;

-- A group's full code: its ancestors' codes and its own, joined by the separator (10, 03 -> 10-03).
create or replace function public.inv__group_full_code(p_org uuid, p_group_id uuid, p_separator text) returns text
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select g.id, g.parent_id, g.code, 0 as depth from public.inv_item_groups g where g.org_id = p_org and g.id = p_group_id
    union all
    select p.id, p.parent_id, p.code, up.depth + 1 from public.inv_item_groups p join up on p.org_id = p_org and p.id = up.parent_id
     where up.depth < 50
  )
  select string_agg(code, p_separator order by depth desc) from up;
$$;

-- The next free code for p_org under its rule (null under "typed", or under "group" without a group). Deleted items count too.
create or replace function public.inv__next_code(p_org uuid, p_group_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public.inv__code_rule(p_org); f jsonb; v_prefix text; v_digits int; v_max numeric;
begin
  if r ->> 'rule' = 'prefix' then
    select o.settings -> 'sku_format' into f from public.organizations o where o.id = p_org;
    if f is null then return null; end if;
    v_prefix := upper(coalesce(f ->> 'prefix', ''));
    v_digits := coalesce((f ->> 'digits')::int, 4);
  elsif r ->> 'rule' = 'group' then
    if p_group_id is null then return null; end if;
    v_prefix := public.inv__group_full_code(p_org, p_group_id, r ->> 'separator');
    if v_prefix is null then return null; end if;
    v_prefix := v_prefix || (r ->> 'separator');
    v_digits := (r ->> 'digits')::int;
  else
    return null;
  end if;
  select max(substr(i.sku, length(v_prefix) + 1)::numeric) into v_max
    from public.inv_items i
   where i.org_id = p_org and left(i.sku, length(v_prefix)) = v_prefix
     and substr(i.sku, length(v_prefix) + 1) ~ '^[0-9]{1,15}$';
  return v_prefix || lpad((coalesce(v_max, 0) + 1)::bigint::text, v_digits, '0');
end $$;

revoke all on function public.inv__code_rule(uuid), public.inv__group_full_code(uuid, uuid, text), public.inv__next_code(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- the code rule

create or replace function public.inv_set_item_code_rule(p_rule text, p_separator text default '-', p_digits int default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); v_before jsonb; v_after jsonb;
begin
  if p_rule is null or p_rule not in ('typed', 'prefix', 'group') then raise exception 'INVALID_INPUT' using detail = 'the rule is typed, prefix or group'; end if;
  if p_separator is null or p_separator not in ('-', '.', '/') then raise exception 'INVALID_INPUT' using detail = 'the separator is - . or /'; end if;
  if p_digits is null or p_digits < 1 or p_digits > 8 then raise exception 'INVALID_INPUT' using detail = 'digits must be 1 to 8'; end if;
  v_after := jsonb_build_object('rule', p_rule, 'separator', p_separator, 'digits', p_digits);
  select o.settings -> 'item_code_rule' into v_before from public.organizations o where o.id = v_org for update;
  if v_before is not distinct from v_after then return v_after; end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('item_code_rule', v_after) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.item_code_rule_changed', 'organization', v_org::text,
          format('Item code rule set to %s (separator %s, %s digits)', p_rule, p_separator, p_digits), v_before, v_after);
  return v_after;
end $$;

-- The rule in force (with defaults) and the sql/075 format. Read-only, every role.
create or replace function public.inv_item_code_rule() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']);
begin
  return public.inv__code_rule(v_org) || jsonb_build_object('format', (select o.settings -> 'sku_format' from public.organizations o where o.id = v_org));
end $$;

-- The next free code under the rule, for a group when the rule is "group". Read-only.
create or replace function public.inv_next_item_code(p_group_id uuid default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
begin
  if p_group_id is not null and not exists (select 1 from public.inv_item_groups g where g.org_id = v_org and g.id = p_group_id and g.deleted_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  return public.inv__next_code(v_org, p_group_id);
end $$;

-- sql/075's function, same signature: the next code without a group (null under the group rule).
create or replace function public.inv_next_sku() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return public.inv_next_item_code(null);
end $$;

-- ---------------------------------------------------------------- groups

create or replace function public.inv_create_item_group(p_parent_id uuid, p_code text, p_name text, p_name_ar text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); v_code text := upper(trim(coalesce(p_code, ''))); v_id uuid;
begin
  if v_code !~ '^[A-Z0-9]{1,10}$' then raise exception 'INVALID_INPUT' using detail = 'a group code is letters and digits, up to 10'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  if p_parent_id is not null and not exists (select 1 from public.inv_item_groups g where g.org_id = v_org and g.id = p_parent_id and g.deleted_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  begin
    insert into public.inv_item_groups (org_id, parent_id, code, name, name_ar)
    values (v_org, p_parent_id, v_code, trim(p_name), nullif(trim(p_name_ar), '')) returning id into v_id;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'another group at this level has that code';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'inventory.item_group.created', 'item_group', v_id::text, format('Item group %s %s created', v_code, trim(p_name)),
          jsonb_build_object('parentId', p_parent_id, 'code', v_code, 'name', trim(p_name), 'nameAr', nullif(trim(p_name_ar), '')));
  return v_id;
end $$;

-- Change a group's code, names or whether it takes new items. Existing item codes stay as they are.
create or replace function public.inv_update_item_group(p_group_id uuid, p_code text, p_name text, p_name_ar text default null, p_active boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); g public.inv_item_groups; v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_code !~ '^[A-Z0-9]{1,10}$' then raise exception 'INVALID_INPUT' using detail = 'a group code is letters and digits, up to 10'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  select * into g from public.inv_item_groups where org_id = v_org and id = p_group_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.code = v_code and g.name = trim(p_name) and g.name_ar is not distinct from nullif(trim(p_name_ar), '') and g.active = coalesce(p_active, true) then
    return;
  end if;
  begin
    update public.inv_item_groups set code = v_code, name = trim(p_name), name_ar = nullif(trim(p_name_ar), ''), active = coalesce(p_active, true)
     where id = g.id;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'another group at this level has that code';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item_group.updated', 'item_group', g.id::text, format('Item group %s %s changed', v_code, trim(p_name)),
          jsonb_build_object('code', g.code, 'name', g.name, 'nameAr', g.name_ar, 'active', g.active),
          jsonb_build_object('code', v_code, 'name', trim(p_name), 'nameAr', nullif(trim(p_name_ar), ''), 'active', coalesce(p_active, true)));
end $$;

-- Move a group under another (or to the top, null). Refused when the new parent is the group itself or one of its sub-groups.
create or replace function public.inv_move_item_group(p_group_id uuid, p_parent_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); g public.inv_item_groups;
begin
  select * into g from public.inv_item_groups where org_id = v_org and id = p_group_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.parent_id is not distinct from p_parent_id then return; end if;
  if p_parent_id is not null then
    if not exists (select 1 from public.inv_item_groups p where p.org_id = v_org and p.id = p_parent_id and p.deleted_at is null) then
      raise exception 'NOT_FOUND';
    end if;
    -- the new parent must not be this group or below it
    if exists (
      with recursive up as (
        select p.id, p.parent_id, 0 as depth from public.inv_item_groups p where p.org_id = v_org and p.id = p_parent_id
        union all
        select q.id, q.parent_id, up.depth + 1 from public.inv_item_groups q join up on q.org_id = v_org and q.id = up.parent_id where up.depth < 50
      ) select 1 from up where up.id = g.id
    ) then
      raise exception 'INVALID_INPUT' using detail = 'a group cannot move under itself or one of its sub-groups';
    end if;
  end if;
  begin
    update public.inv_item_groups set parent_id = p_parent_id where id = g.id;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'another group at that level has the same code';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item_group.moved', 'item_group', g.id::text, format('Item group %s %s moved', g.code, g.name),
          jsonb_build_object('parentId', g.parent_id), jsonb_build_object('parentId', p_parent_id));
end $$;

-- Soft delete. Refused while a live item or a live sub-group uses the group.
create or replace function public.inv_delete_item_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); g public.inv_item_groups;
begin
  select * into g from public.inv_item_groups where org_id = v_org and id = p_group_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.inv_items i where i.org_id = v_org and i.group_id = g.id and i.deleted_at is null)
     or exists (select 1 from public.inv_item_groups c where c.org_id = v_org and c.parent_id = g.id and c.deleted_at is null) then
    raise exception 'IN_USE' using detail = 'move or remove its items and sub-groups first';
  end if;
  update public.inv_item_groups set deleted_at = now() where id = g.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'inventory.item_group.deleted', 'item_group', g.id::text, format('Item group %s %s deleted', g.code, g.name),
          jsonb_build_object('parentId', g.parent_id, 'code', g.code, 'name', g.name, 'nameAr', g.name_ar));
end $$;

-- Put an item in a group (or none, unless the rule is "group"). The item keeps its code.
create or replace function public.inv_set_item_group(p_item_id uuid, p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']); i public.inv_items;
begin
  select * into i from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_group_id is null and public.inv__code_rule(v_org) ->> 'rule' = 'group' then
    raise exception 'INVALID_INPUT' using detail = 'an item group is required under the group code rule';
  end if;
  if p_group_id is not null and not exists (
    select 1 from public.inv_item_groups g where g.org_id = v_org and g.id = p_group_id and g.deleted_at is null and g.active) then
    raise exception 'NOT_FOUND';
  end if;
  if i.group_id is not distinct from p_group_id then return; end if;
  update public.inv_items set group_id = p_group_id where id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item.group_changed', 'item', i.id::text, format('Item %s moved to another group (code kept)', i.sku),
          jsonb_build_object('groupId', i.group_id), jsonb_build_object('groupId', p_group_id));
end $$;

-- ---------------------------------------------------------------- items: created with a group

-- sql/046's function with one optional parameter more (p_group_id) and the code rule. Otherwise unchanged.
drop function if exists public.inv_create_item(text, text, text, text, numeric, uuid, bigint);
create or replace function public.inv_create_item(
  p_sku text, p_name text, p_name_ar text default null, p_uom text default 'piece',
  p_opening_qty numeric default 0, p_warehouse_id uuid default null, p_unit_cost_minor bigint default null, p_group_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id   uuid;
  v_rule text := public.inv__code_rule(v_org) ->> 'rule';
  v_sku  text := upper(trim(coalesce(p_sku, '')));
begin
  if coalesce(p_opening_qty, 0) < 0 or coalesce(p_unit_cost_minor, 0) < 0 then raise exception 'INVALID_INPUT'; end if;
  if coalesce(p_opening_qty, 0) > 0 and not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'opening stock needs a warehouse';
  end if;
  if p_group_id is null and v_rule = 'group' then
    raise exception 'INVALID_INPUT' using detail = 'an item group is required under the group code rule';
  end if;
  if p_group_id is not null and not exists (
    select 1 from public.inv_item_groups g where g.org_id = v_org and g.id = p_group_id and g.deleted_at is null and g.active) then
    raise exception 'NOT_FOUND';
  end if;
  if v_sku = '' then v_sku := coalesce(public.inv__next_code(v_org, p_group_id), ''); end if;
  if v_sku = '' then raise exception 'INVALID_INPUT' using detail = 'an item code is required'; end if;
  insert into public.inv_items (org_id, sku, name, name_ar, uom, group_id)
  values (v_org, v_sku, trim(p_name), nullif(trim(p_name_ar), ''), coalesce(nullif(trim(p_uom), ''), 'piece'), p_group_id)
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.item.created', 'item', v_id::text, format('Item %s %s created', v_sku, trim(p_name)));
  if coalesce(p_opening_qty, 0) > 0 then
    perform public.inv__receipt(v_org, v_id, p_warehouse_id, p_opening_qty, 'opening stock', p_unit_cost_minor);
    if p_unit_cost_minor is not null then perform public.inv__apply_cost(v_org, v_id, p_opening_qty, p_unit_cost_minor, 'opening stock', 'manual_receipt'); end if;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (v_org, auth.uid(), 'inventory.stock.received', 'item', v_id::text, format('Opening stock %s received for %s', p_opening_qty, v_sku));
  end if;
  return v_id;
exception when unique_violation or check_violation then
  raise exception 'INVALID_INPUT' using detail = 'SKU already exists or a value is not valid';
end $$;

revoke all on function public.inv_set_item_code_rule(text, text, int), public.inv_item_code_rule(), public.inv_next_item_code(uuid),
  public.inv_next_sku(), public.inv_create_item_group(uuid, text, text, text), public.inv_update_item_group(uuid, text, text, text, boolean),
  public.inv_move_item_group(uuid, uuid), public.inv_delete_item_group(uuid), public.inv_set_item_group(uuid, uuid),
  public.inv_create_item(text, text, text, text, numeric, uuid, bigint, uuid) from public, anon;
grant execute on function public.inv_set_item_code_rule(text, text, int), public.inv_item_code_rule(), public.inv_next_item_code(uuid),
  public.inv_next_sku(), public.inv_create_item_group(uuid, text, text, text), public.inv_update_item_group(uuid, text, text, text, boolean),
  public.inv_move_item_group(uuid, uuid), public.inv_delete_item_group(uuid), public.inv_set_item_group(uuid, uuid),
  public.inv_create_item(text, text, text, text, numeric, uuid, bigint, uuid) to authenticated;

commit;

-- Verification (read-only): the table is locked to reads with RLS on; users can call the functions, anonymous cannot.
select (select relrowsecurity from pg_class where oid = 'public.inv_item_groups'::regclass) as groups_rls_on,
       has_table_privilege('authenticated', 'public.inv_item_groups', 'insert') as users_can_insert_groups,
       has_table_privilege('authenticated', 'public.inv_item_groups', 'truncate') as users_can_truncate_groups,
       has_function_privilege('authenticated', 'public.inv_create_item(text, text, text, text, numeric, uuid, bigint, uuid)', 'execute') as users_create_items,
       has_function_privilege('anon', 'public.inv_create_item_group(uuid, text, text, text)', 'execute') as anon_creates_groups,
       (select count(*) from pg_proc where proname = 'inv_create_item' and pronamespace = 'public'::regnamespace) as create_item_versions;
