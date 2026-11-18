-- sql/tests/087_item_vat_rate.sql
-- sql/092: an item's VAT rate without e-invoicing. Always rolls back. Needs sql/001-092.
-- Covers: owner and admin set and clear it (audited, once per change); members cannot; only the company's live VAT rates; another
-- company can neither set it nor use its own rate on A's item. (That an invoice line takes the item's rate is tested in 082.)

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i1 uuid; r14 uuid; r5 uuid; rt uuid; rb uuid; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ivr-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'ivr-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'ivr-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'ivr-x@tests.invalid');
  o := public.bootstrap_organization('Item VAT A', 'item-vat-a', 'ivr-o@tests.invalid');
  ob := public.bootstrap_organization('Item VAT B', 'item-vat-b', 'ivr-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  -- e-invoicing off for A: the point of sql/092
  update public.org_modules set disabled_at = now() where org_id = o and module_key = 'einvoicing';
  r14 := gen_random_uuid(); r5 := gen_random_uuid(); rt := gen_random_uuid(); rb := gen_random_uuid();
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label, is_default) values
    (r14, o, 'T1', 'V009', 14, 'VAT 14%', true), (r5, o, 'T1', 'V010', 5, 'VAT 5%', false), (rb, ob, 'T1', 'V009', 14, 'VAT 14%', true);
  insert into public.tax_rates (id, org_id, tax_type, sub_type, rate, label) select rt, o, t.tax_type, t.sub_type, 8, 'Not VAT' from public.eta_tax_subtypes t where t.tax_type <> 'T1' limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('IV-1', 'Reduced item', null, 'piece', 0, w);
  -- ---- I1: the owner sets 5%; the same again writes nothing
  perform public.inv_set_item_vat_rate(i1, r5);
  perform public.inv_set_item_vat_rate(i1, r5);
  -- ---- I2: not a VAT rate, and a removed one, are refused
  ok := false; begin perform public.inv_set_item_vat_rate(i1, rt); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL I2a: a non-VAT rate was accepted'; end if;
  ok := false; begin perform public.inv_set_item_vat_rate(i1, rb); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL I2b: another company''s rate was accepted'; end if;
  -- ---- I3: a member cannot; an admin can clear it
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_set_item_vat_rate(i1, r14); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL I3a: a member set an item''s VAT rate'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.inv_set_item_vat_rate(i1, null);
  perform public.inv_set_item_vat_rate(i1, r5);
  reset role;
  select count(*) into n from public.inv_items where id = i1 and default_tax_rate_id = r5;
  if n <> 1 then raise exception 'FAIL I3b: the item''s rate is not 5%%'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'inventory.item.vat_rate_changed' and entity_id = i1::text;
  if n <> 3 then raise exception 'FAIL I4: % audit rows, expected 3 (set, cleared, set)', n; end if;
  -- ---- I5: another company cannot set A's item
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  ok := false; begin perform public.inv_set_item_vat_rate(i1, rb); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  reset role;
  if not ok then raise exception 'FAIL I5: company B changed company A''s item'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
