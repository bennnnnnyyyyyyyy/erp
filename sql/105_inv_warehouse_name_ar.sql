-- sql/105_inv_warehouse_name_ar.sql
-- Arabic warehouse names (UX audit 20 Nov 2026, Arabic check: "Finished goods", "Cold room" stayed English in Arabic mode).
-- inv_warehouses.name_ar exists since sql/006 and inv_create_warehouse already saves it, but a warehouse's Arabic name could not be
-- changed later (sql/074 left it out). This adds one function for that. inv_update_warehouse (074) is not changed, so its callers and
-- test 070 stay as they are. Owners and admins only (the same people who create and edit warehouses); the old and new Arabic name are
-- written to the audit log in the same transaction. Blank clears it (the English name then shows in Arabic too).
-- Rerun-safe. Needs sql/001-074. Run the whole file, then sql/tests/102_warehouse_name_ar.sql.

begin;

create or replace function public.inv_set_warehouse_name_ar(p_warehouse_id uuid, p_name_ar text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  w public.inv_warehouses;
  v_ar text := nullif(trim(coalesce(p_name_ar, '')), '');
begin
  if length(coalesce(v_ar, '')) > 200 then raise exception 'INVALID_INPUT' using detail = 'the Arabic name is up to 200 characters'; end if;
  select * into w from public.inv_warehouses where org_id = v_org and id = p_warehouse_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if w.name_ar is not distinct from v_ar then return; end if;
  update public.inv_warehouses set name_ar = v_ar where id = w.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.warehouse.updated', 'warehouse', w.id::text, format('Arabic name of warehouse %s changed', w.code),
          jsonb_build_object('name_ar', w.name_ar), jsonb_build_object('name_ar', v_ar));
end $$;

revoke all on function public.inv_set_warehouse_name_ar(uuid, text) from public, anon;
grant execute on function public.inv_set_warehouse_name_ar(uuid, text) to authenticated;

commit;

-- Verification (read-only).
select has_function_privilege('anon', 'public.inv_set_warehouse_name_ar(uuid, text)', 'execute') as anon_sets_names,
       has_function_privilege('authenticated', 'public.inv_set_warehouse_name_ar(uuid, text)', 'execute') as users_set_names;
