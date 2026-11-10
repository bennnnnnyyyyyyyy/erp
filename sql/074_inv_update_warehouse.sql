-- sql/074_inv_update_warehouse.sql
-- Editing a warehouse's name and code after it is created (Ben's walkthrough, 10 Nov 2026: "i messed up the name of the warehouse").
-- Rerun-safe. Needs sql/001-073 (uses inv__guard from sql/006 and audit_log).
--
-- Owners and admins only (the same people who can create a warehouse). The old and new name and code are written to the audit log in the
-- same transaction. The Arabic name is not touched here (the screens no longer ask for it). Stock ledger rows point at the warehouse by id,
-- so renaming or recoding never changes history.

begin;

create or replace function public.inv_update_warehouse(p_warehouse_id uuid, p_name text, p_code text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  w public.inv_warehouses;
  v_name text := trim(coalesce(p_name, ''));
  v_code text := nullif(trim(coalesce(p_code, '')), '');
begin
  if length(v_name) = 0 or length(v_name) > 200 then raise exception 'INVALID_INPUT' using detail = 'a name is required (up to 200 characters)'; end if;
  select * into w from public.inv_warehouses where org_id = v_org and id = p_warehouse_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_code := coalesce(v_code, w.code);
  if v_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then raise exception 'INVALID_INPUT' using detail = 'the code is not valid'; end if;
  if exists (select 1 from public.inv_warehouses x where x.org_id = v_org and x.id <> w.id and x.code = v_code) then
    raise exception 'DUPLICATE' using detail = 'another warehouse already has that code';
  end if;
  update public.inv_warehouses set name = v_name, code = v_code where id = w.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.warehouse.updated', 'warehouse', w.id::text, format('Warehouse %s %s changed', v_code, v_name),
          jsonb_build_object('code', w.code, 'name', w.name), jsonb_build_object('code', v_code, 'name', v_name));
end $$;

revoke all on function public.inv_update_warehouse(uuid, text, text) from public, anon;
grant execute on function public.inv_update_warehouse(uuid, text, text) to authenticated;

commit;

-- Verification (read-only).
select has_function_privilege('anon', 'public.inv_update_warehouse(uuid, text, text)', 'execute') as anon_edits_warehouses,
       has_function_privilege('authenticated', 'public.inv_update_warehouse(uuid, text, text)', 'execute') as users_edit_warehouses;
