-- sql/tests/070_update_warehouse.sql
-- Editing a warehouse (sql/074). Always rolls back. Needs sql/001-074.
-- Covers: the owner renames and recodes a warehouse; old and new values are in the audit log; a blank name, a bad code and a code used by
-- another warehouse are refused; a member cannot edit; another company cannot edit it or see its history; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; w2 uuid; ok boolean; a jsonb; b jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'uw-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'uw-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'uw-x@tests.invalid');
  o := public.bootstrap_organization('Warehouse Edit A', 'wh-edit-a', 'uw-o@tests.invalid');
  ob := public.bootstrap_organization('Warehouse Edit B', 'wh-edit-b', 'uw-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  w := public.inv_create_warehouse('MAN', 'Man warehouse', null);
  w2 := public.inv_create_warehouse('SECOND', 'Second', null);

  -- W1: the owner fixes the name and the code
  perform public.inv_update_warehouse(w, 'Main warehouse', 'MAIN');
  if (select code || '|' || name from public.inv_warehouses where id = w) <> 'MAIN|Main warehouse' then raise exception 'FAIL W1a: not updated'; end if;
  perform public.inv_update_warehouse(w, 'Main store');   -- no code given: the code stays
  if (select code || '|' || name from public.inv_warehouses where id = w) <> 'MAIN|Main store' then raise exception 'FAIL W1b: code changed or name not updated'; end if;

  -- W2: audited with before and after
  reset role;
  select before, after into b, a from public.audit_log where org_id = o and action = 'inventory.warehouse.updated' and entity_id = w::text order by id asc limit 1;
  if b ->> 'name' <> 'Man warehouse' or a ->> 'name' <> 'Main warehouse' or b ->> 'code' <> 'MAN' or a ->> 'code' <> 'MAIN' then
    raise exception 'FAIL W2: audit before %, after %', b, a;
  end if;
  set local role authenticated;

  -- W3: refused input
  ok := false; begin perform public.inv_update_warehouse(w, '   '); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL W3a: blank name accepted'; end if;
  ok := false; begin perform public.inv_update_warehouse(w, 'X', 'bad code!'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL W3b: bad code accepted'; end if;
  ok := false; begin perform public.inv_update_warehouse(w, 'X', 'SECOND'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL W3c: a code used by another warehouse accepted'; end if;

  -- W4: roles
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_update_warehouse(w, 'By member'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL W4: a member edited a warehouse'; end if;

  -- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_update_warehouse(w, 'Taken over'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1a: another company edited the warehouse'; end if;
  if exists (select 1 from public.audit_log where entity_id = w::text) then raise exception 'FAIL I1b: another company sees the warehouse history'; end if;
  reset role;

  if has_function_privilege('anon', 'public.inv_update_warehouse(uuid, text, text)', 'execute') then
    raise exception 'FAIL A1: anonymous callers can edit warehouses';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
