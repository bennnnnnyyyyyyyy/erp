-- 092_inv_item_vat_rate.sql
-- An item's own VAT rate without the e-invoicing module (VAT follow-up, 17 Nov 2026). Until now inv_items.default_tax_rate_id could
-- only be set with the ETA item codes (eta_set_item_codes, sql/036), which needs e-invoicing switched on; without it every line took
-- the company default. inv_set_item_vat_rate sets (or clears) it: owners and admins, one of the company's VAT (T1) rates, audited.
-- Documents already issued keep the rate copied onto their lines. Depends on sql/001-091. Rerun-safe. Then sql/tests/087_item_vat_rate.sql.

begin;

create or replace function public.inv_set_item_vat_rate(p_item_id uuid, p_rate_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); i public.inv_items; v_label text; v_before text;
begin
  select * into i from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_rate_id is not null then
    select t.label || ' (' || trim_scale(t.rate) || '%)' into v_label from public.tax_rates t
     where t.org_id = v_org and t.id = p_rate_id and t.tax_type = 'T1' and t.deleted_at is null;
    if v_label is null then raise exception 'INVALID_INPUT' using detail = 'choose one of the company''s VAT rates'; end if;
  end if;
  if i.default_tax_rate_id is not distinct from p_rate_id then return; end if;
  select t.label into v_before from public.tax_rates t where t.org_id = v_org and t.id = i.default_tax_rate_id;
  update public.inv_items set default_tax_rate_id = p_rate_id where org_id = v_org and id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item.vat_rate_changed', 'inv_item', i.id::text,
          format('%s: VAT rate %s (new documents only)', i.sku, coalesce(v_label, 'company default')),
          jsonb_build_object('tax_rate_id', i.default_tax_rate_id, 'label', v_before), jsonb_build_object('tax_rate_id', p_rate_id, 'label', v_label));
end $$;
revoke all on function public.inv_set_item_vat_rate(uuid, uuid) from public, anon;
grant execute on function public.inv_set_item_vat_rate(uuid, uuid) to authenticated;

commit;

-- Verification (read-only): signed-in users can call it (the function admits owners and admins only), anonymous cannot.
select has_function_privilege('authenticated', 'public.inv_set_item_vat_rate(uuid, uuid)', 'execute') as users_can_set,
       has_function_privilege('anon', 'public.inv_set_item_vat_rate(uuid, uuid)', 'execute') as anon_can_set;
