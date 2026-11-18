-- 098_inv_item_groups_leaf.sql
-- Items only in groups without sub-groups (Ben's walkthrough, 18 Nov 2026, passed on by the master chat: "only groups with no
-- sub-groups can be chosen; main groups appear as headings"). The item form shows main groups as headings; the database re-checks:
--   * inv_create_item and inv_set_item_group refuse a group that has live sub-groups (INVALID_INPUT, "choose a sub-group").
--   * inv_create_item_group and inv_move_item_group refuse to put a sub-group under a group that holds live items (IN_USE), so an item
--     never ends up in a heading group. Items already in such a group (from before this migration) stay where they are, keep their
--     codes, and can be moved into a sub-group.
-- Each function is sql/095's, copied unchanged except for the one check (built by script from 095). Rerun-safe. Depends on sql/001-097.
-- Then run sql/tests/094_inv_item_groups_leaf.sql.

begin;

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
  if p_group_id is not null and exists (select 1 from public.inv_item_groups c where c.org_id = v_org and c.parent_id = p_group_id and c.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'choose a sub-group: this group has sub-groups';
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
  if p_group_id is not null and exists (select 1 from public.inv_item_groups c where c.org_id = v_org and c.parent_id = p_group_id and c.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'choose a sub-group: this group has sub-groups';
  end if;
  if i.group_id is not distinct from p_group_id then return; end if;
  update public.inv_items set group_id = p_group_id where id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item.group_changed', 'item', i.id::text, format('Item %s moved to another group (code kept)', i.sku),
          jsonb_build_object('groupId', i.group_id), jsonb_build_object('groupId', p_group_id));
end $$;

create or replace function public.inv_create_item_group(p_parent_id uuid, p_code text, p_name text, p_name_ar text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); v_code text := upper(trim(coalesce(p_code, ''))); v_id uuid;
begin
  if v_code !~ '^[A-Z0-9]{1,10}$' then raise exception 'INVALID_INPUT' using detail = 'a group code is letters and digits, up to 10'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  if p_parent_id is not null and not exists (select 1 from public.inv_item_groups g where g.org_id = v_org and g.id = p_parent_id and g.deleted_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  if p_parent_id is not null and exists (select 1 from public.inv_items i where i.org_id = v_org and i.group_id = p_parent_id and i.deleted_at is null) then
    raise exception 'IN_USE' using detail = 'that group holds items; move them into a sub-group first';
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
  if p_parent_id is not null and exists (select 1 from public.inv_items i where i.org_id = v_org and i.group_id = p_parent_id and i.deleted_at is null) then
    raise exception 'IN_USE' using detail = 'that group holds items; move them into a sub-group first';
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

commit;

-- Verification (read-only): one version of each function, still callable by signed-in users, not by anonymous ones; and how many live
-- items sit in a group that has sub-groups (they stay; the screens let them be moved).
select (select count(*) from pg_proc where proname = 'inv_create_item' and pronamespace = 'public'::regnamespace) as create_item_versions,
       has_function_privilege('authenticated', 'public.inv_set_item_group(uuid, uuid)', 'execute') as users_set_group,
       has_function_privilege('anon', 'public.inv_create_item_group(uuid, text, text, text)', 'execute') as anon_creates_groups,
       (select count(*) from public.inv_items i where i.deleted_at is null and i.group_id is not null
          and exists (select 1 from public.inv_item_groups c where c.org_id = i.org_id and c.parent_id = i.group_id and c.deleted_at is null)) as items_in_heading_groups;
