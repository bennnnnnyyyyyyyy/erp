-- sql/062_edit_records.sql
-- Editing customers, suppliers and items after they are created (UX decision D4, Ben 9 Nov 2026). Rerun-safe. Needs sql/001-061.
--
-- Until now a typo in a name or phone could not be fixed. These functions change everything except the codes: customer and supplier
-- codes and item SKUs stay fixed, because they are printed on invoices and used in reports. Every change writes the old and new values
-- to the audit log in the same transaction. Who may edit is who may create: owners and admins for customers and suppliers; owners,
-- admins and members for items.

begin;

create or replace function public.sal_update_customer(p_customer_id uuid, p_name text, p_contact text default null, p_city text default null,
  p_phone text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); c public.sal_customers;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  select * into c from public.sal_customers where org_id = v_org and id = p_customer_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.sal_customers where org_id = v_org and id <> c.id and lower(name) = lower(trim(p_name)) and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = 'another customer already has that name';
  end if;
  update public.sal_customers
     set name = trim(p_name), contact = nullif(trim(p_contact), ''), city = nullif(trim(p_city), ''), phone = nullif(trim(p_phone), '')
   where id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.customer.updated', 'customer', c.id::text, format('Customer %s %s changed', c.code, trim(p_name)),
          jsonb_build_object('name', c.name, 'contact', c.contact, 'city', c.city, 'phone', c.phone),
          jsonb_build_object('name', trim(p_name), 'contact', nullif(trim(p_contact), ''), 'city', nullif(trim(p_city), ''), 'phone', nullif(trim(p_phone), '')));
end $$;

create or replace function public.pur_update_supplier(p_supplier_id uuid, p_name text, p_contact text default null, p_city text default null,
  p_phone text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); s public.pur_suppliers;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  select * into s from public.pur_suppliers where org_id = v_org and id = p_supplier_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.pur_suppliers where org_id = v_org and id <> s.id and lower(name) = lower(trim(p_name)) and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = 'another supplier already has that name';
  end if;
  update public.pur_suppliers
     set name = trim(p_name), contact = nullif(trim(p_contact), ''), city = nullif(trim(p_city), ''), phone = nullif(trim(p_phone), '')
   where id = s.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'purchasing.supplier.updated', 'supplier', s.id::text, format('Supplier %s %s changed', s.code, trim(p_name)),
          jsonb_build_object('name', s.name, 'contact', s.contact, 'city', s.city, 'phone', s.phone),
          jsonb_build_object('name', trim(p_name), 'contact', nullif(trim(p_contact), ''), 'city', nullif(trim(p_city), ''), 'phone', nullif(trim(p_phone), '')));
end $$;

-- Items: the name in English and Arabic. The SKU and the base unit stay fixed (quantities and unit conversions depend on the unit).
create or replace function public.inv_update_item(p_item_id uuid, p_name text, p_name_ar text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']); i public.inv_items;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  select * into i from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.inv_items set name = trim(p_name), name_ar = nullif(trim(p_name_ar), '') where id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item.updated', 'item', i.id::text, format('Item %s %s changed', i.sku, trim(p_name)),
          jsonb_build_object('name', i.name, 'nameAr', i.name_ar),
          jsonb_build_object('name', trim(p_name), 'nameAr', nullif(trim(p_name_ar), '')));
end $$;

revoke all on function public.sal_update_customer(uuid, text, text, text, text), public.pur_update_supplier(uuid, text, text, text, text),
  public.inv_update_item(uuid, text, text) from public, anon;
grant execute on function public.sal_update_customer(uuid, text, text, text, text), public.pur_update_supplier(uuid, text, text, text, text),
  public.inv_update_item(uuid, text, text) to authenticated;

commit;

-- Verification (read-only).
select has_function_privilege('anon', 'public.sal_update_customer(uuid, text, text, text, text)', 'execute') as anon_edits_customers,
       has_function_privilege('authenticated', 'public.inv_update_item(uuid, text, text)', 'execute') as users_edit_items;
