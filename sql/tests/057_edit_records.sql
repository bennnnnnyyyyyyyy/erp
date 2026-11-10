-- sql/tests/057_edit_records.sql
-- Editing customers, suppliers and items (sql/062). Always rolls back. Needs sql/001-062.
-- Covers: owner edits name, contact, city and phone; the code and SKU never change; the old and new values are in the audit log; a
-- blank name and a name used by another customer are refused; a member cannot edit customers or suppliers but can edit items; a
-- viewer cannot edit items; another company cannot edit or see the change; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; c uuid; c2 uuid; s uuid; ok boolean; a jsonb; b jsonb; code text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'er-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'er-m@tests.invalid'),
    (v, 'authenticated', 'authenticated', 'er-v@tests.invalid'), (x, 'authenticated', 'authenticated', 'er-x@tests.invalid');
  o := public.bootstrap_organization('Edit Test A', 'edit-test-a', 'er-o@tests.invalid');
  ob := public.bootstrap_organization('Edit Test B', 'edit-test-b', 'er-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member'), (o, v, 'viewer');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('ED-1', 'Glovs', null, 'pair', 0, null);
  c := public.sal_create_customer('Delta Tradng', null, 'Cairo', '+20 100 000 0000');
  c2 := public.sal_create_customer('Nile Market', null, null, null);
  s := public.pur_create_supplier('Acme Suply', null, null, null);
  select sc.code into code from public.sal_customers sc where sc.id = c;

  -- ---- E1: the owner fixes typos; the code stays
  perform public.sal_update_customer(c, 'Delta Trading', 'Mona', 'Giza', '+20 100 111 2222');
  if (select name || '|' || coalesce(contact, '') || '|' || coalesce(city, '') || '|' || coalesce(phone, '') from public.sal_customers where id = c)
     <> 'Delta Trading|Mona|Giza|+20 100 111 2222' then raise exception 'FAIL E1a: customer not updated'; end if;
  if (select sc.code from public.sal_customers sc where sc.id = c) is distinct from code then raise exception 'FAIL E1b: the code changed'; end if;
  perform public.pur_update_supplier(s, 'Acme Supply', null, null, '0123');
  if (select name from public.pur_suppliers where id = s) <> 'Acme Supply' then raise exception 'FAIL E1c: supplier not updated'; end if;
  perform public.inv_update_item(i, 'Gloves', 'قفازات');
  if (select name || '|' || coalesce(name_ar, '') || '|' || sku || '|' || uom from public.inv_items where id = i) <> 'Gloves|قفازات|ED-1|pair' then
    raise exception 'FAIL E1d: item not updated, or its SKU or unit changed';
  end if;

  -- ---- E2: old and new values are audited
  reset role;
  select before, after into b, a from public.audit_log where org_id = o and action = 'sales.customer.updated' and entity_id = c::text order by id desc limit 1;
  if b ->> 'name' <> 'Delta Tradng' or a ->> 'name' <> 'Delta Trading' or b ->> 'city' <> 'Cairo' or a ->> 'city' <> 'Giza' then
    raise exception 'FAIL E2: audit before %, after %', b, a;
  end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'inventory.item.updated' and entity_id = i::text) then raise exception 'FAIL E2b: item change not audited'; end if;
  set local role authenticated;

  -- ---- E3: refused input
  ok := false; begin perform public.sal_update_customer(c, '   '); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL E3a: blank name accepted'; end if;
  ok := false; begin perform public.sal_update_customer(c, 'nile market'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL E3b: another customer''s name accepted'; end if;

  -- ---- E4: roles
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_update_customer(c, 'By member'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL E4a: a member edited a customer'; end if;
  ok := false; begin perform public.pur_update_supplier(s, 'By member'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL E4b: a member edited a supplier'; end if;
  perform public.inv_update_item(i, 'Gloves (pair)');
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_update_item(i, 'By viewer'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL E4c: a viewer edited an item'; end if;

  -- ---- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_update_customer(c, 'Taken over'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1a: another company edited a customer'; end if;
  ok := false; begin perform public.inv_update_item(i, 'Taken over'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1b: another company edited an item'; end if;
  if exists (select 1 from public.audit_log where entity_id = c::text) then raise exception 'FAIL I1c: another company sees the customer history'; end if;
  reset role;

  if has_function_privilege('anon', 'public.sal_update_customer(uuid, text, text, text, text, text, text, text, text, text, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.inv_update_item(uuid, text, text)', 'execute') then
    raise exception 'FAIL A1: anonymous callers can edit';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
