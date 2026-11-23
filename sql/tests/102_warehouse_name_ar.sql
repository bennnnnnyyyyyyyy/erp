-- sql/tests/102_warehouse_name_ar.sql
-- A warehouse's Arabic name (sql/105). Always rolls back. Needs sql/001-105.
-- Covers: N1 the owner sets and clears the Arabic name; N2 audited with before and after, nothing written when unchanged; N3 too long
-- is refused; N4 a member cannot set it; I1 another company cannot set it or see its history; N5 no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; ok boolean; a jsonb; b jsonb; n int;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'wa-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'wa-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'wa-x@tests.invalid');
  o := public.bootstrap_organization('Warehouse Arabic A', 'wh-ar-a', 'wa-o@tests.invalid');
  ob := public.bootstrap_organization('Warehouse Arabic B', 'wh-ar-b', 'wa-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  w := public.inv_create_warehouse('COLD', 'Cold room', null);

  -- N1: set, then clear
  perform public.inv_set_warehouse_name_ar(w, '  غرفة التبريد  ');
  if (select name_ar from public.inv_warehouses where id = w) is distinct from 'غرفة التبريد' then raise exception 'FAIL N1a: not set'; end if;

  -- N2: audited with before and after; the same value again writes nothing
  reset role;
  select before, after into b, a from public.audit_log where org_id = o and action = 'inventory.warehouse.updated' and entity_id = w::text order by id desc limit 1;
  if b ->> 'name_ar' is not null or a ->> 'name_ar' <> 'غرفة التبريد' then raise exception 'FAIL N2a: audit before %, after %', b, a; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'inventory.warehouse.updated' and entity_id = w::text;
  set local role authenticated;
  perform public.inv_set_warehouse_name_ar(w, 'غرفة التبريد');
  reset role;
  if (select count(*) from public.audit_log where org_id = o and action = 'inventory.warehouse.updated' and entity_id = w::text) <> n then
    raise exception 'FAIL N2b: an unchanged name was audited';
  end if;
  set local role authenticated;
  perform public.inv_set_warehouse_name_ar(w, '   ');
  if (select name_ar from public.inv_warehouses where id = w) is not null then raise exception 'FAIL N1b: blank did not clear'; end if;

  -- N3: too long
  ok := false; begin perform public.inv_set_warehouse_name_ar(w, repeat('م', 201)); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL N3: a 201-character name accepted'; end if;

  -- N4: a member
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_set_warehouse_name_ar(w, 'عضو'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL N4: a member set the Arabic name'; end if;

  -- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_set_warehouse_name_ar(w, 'استيلاء'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1a: another company set the Arabic name'; end if;
  if exists (select 1 from public.audit_log where entity_id = w::text) then raise exception 'FAIL I1b: another company sees the warehouse history'; end if;
  reset role;

  -- N5: no anonymous use
  if has_function_privilege('anon', 'public.inv_set_warehouse_name_ar(uuid, text)', 'execute') then
    raise exception 'FAIL N5: anonymous users can set warehouse names';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
